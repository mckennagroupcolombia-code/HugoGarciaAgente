"""
Mapa de funciones del equipo — pestaña de RRHH · Compensaciones en /app.

La matriz persona × etapa de la operación, en vivo: qué hace cada quien, cuántas
veces, cuánto tarda en promedio, cuántas horas le dedica al mes, cuánto valen esas
horas (horas × tarifa del nivel de dificultad) y cómo se compara con lo que se le
paga. Nació como artefacto en la revisión de honorarios del 23-sep-2026; aquí se
calcula con los datos del panel (app/services/rendimiento.py) en lugar de cifras
fijas. Sin LLM.

La configuración con dinero (pagos, propuestas, tarifas, funciones anotadas a mano,
promedio de ventas de WhatsApp) vive en app/data/rrhh_valoracion.json, fuera de git:
son salarios. Sin ese archivo el mapa funciona igual y muestra las horas; los montos
quedan en cero hasta que administración los cargue.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import uuid
from datetime import datetime, timedelta

from app.services import rendimiento as R

_RUTA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "rrhh_valoracion.json")
_WA_DB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "wa_chats.db")
_lock = threading.Lock()

TARIFAS_DEFECTO = {"1": 11000, "2": 13000, "3": 16000, "4": 20000, "5": 24000}

# ── Mercado: salario de un empleado de tiempo completo → su equivalente en honorarios ──
# Un empleado recibe, además del salario: prima (8,33 %), cesantías (8,33 %), intereses
# de cesantías (1 %) y vacaciones (4,17 %) = 21,83 %, y aporta 8 % a salud y pensión
# (le queda el 92 %). Si gana hasta 2 SMMLV recibe auxilio de transporte.
# Quien cobra por honorarios no recibe nada de eso y paga su propia seguridad social:
# 40 % del ingreso como base × (12,5 % salud + 16 % pensión + 0,522 % ARL) ≈ 11,6 %.
# Honorario equivalente = (salario × 1,1383 + auxilio) / (1 − 0,116).
SMMLV_2026 = 1_750_905
AUXILIO_2026 = 249_095
_PRESTACIONES = 0.0833 + 0.0833 + 0.01 + 0.0417
_APORTE_EMPLEADO = 0.08
_PILA_INDEPENDIENTE = 0.40 * (0.125 + 0.16 + 0.00522)


def honorario_equivalente(salario: float) -> float:
    """Honorario mensual neto que deja al contratista igual que un empleado con ese salario."""
    salario = max(float(salario or 0), SMMLV_2026)
    paquete = salario * (1 - _APORTE_EMPLEADO + _PRESTACIONES) + (AUXILIO_2026 if salario <= 2 * SMMLV_2026 else 0)
    return paquete / (1 - _PILA_INDEPENDIENTE)
SEMANAS_MES = 4.345

ETAPAS = [
    ("abastecer", "Abastecer", {"compras", "exterior"}),
    ("disenar", "Diseñar", {"diseno", "docs", "publica", "catalogo"}),
    ("producir", "Producir y empacar", {"hongos", "empacar", "envasar", "preparar", "lote", "imprimir_et", "imprimir_studio"}),
    ("vender", "Vender", {"clientes", "meli_qa"}),
    ("entregar", "Entregar", {"alistar", "guias", "cuaderno", "embalar", "envio"}),
    ("facturar", "Facturar y pagar", {"facturar", "nc", "sol_pago", "aprobar"}),
    ("dirigir", "Dirigir y sistema", {"contab", "analisis"}),
    ("casa", "Casa", {"almuerzo", "desayuno", "aseo"}),
]
ETAPA_IDS = [e[0] for e in ETAPAS]
# Recorrido de un pedido: (etapa, función) que lo mueven, en orden.
RECORRIDO = [
    ("abastecer", "compras", "Compra insumos"), ("disenar", "diseno", "Etiqueta"),
    ("producir", "empacar", "Empaca"), ("vender", "clientes", "Atiende"),
    ("entregar", "alistar", "Alista y guía"), ("entregar", "envio", "Lleva el envío"),
    ("facturar", "facturar", "Factura"), ("dirigir", "contab", "Contabiliza"),
]


def etapa_de(funcion_id: str) -> str:
    if funcion_id.startswith("modulo_"):
        return "dirigir"
    for eid, _n, ids in ETAPAS:
        if funcion_id in ids:
            return eid
    return "dirigir"


# ─── Configuración ───────────────────────────────────────────────────────────

def _defecto() -> dict:
    return {"tarifas": dict(TARIFAS_DEFECTO), "personas": {}, "extras": [],
            "comision_pct": float(os.getenv("VENTAS_DIRECTAS_COMISION_PCT", "3") or 0),
            "ventas_wa_promedio": {"base": 0, "fuente": ""},
            # Horas adicionales (después de completar las pactadas): se reconocen aparte, con su propio valor.
            "horas_adicionales": {"recargo_pct": 0.0, "requieren_aprobacion": True}}


def cargar() -> dict:
    with _lock:
        try:
            with open(_RUTA, encoding="utf-8") as fh:
                d = json.load(fh)
        except (FileNotFoundError, json.JSONDecodeError):
            d = {}
    base = _defecto()
    base.update({k: v for k, v in d.items() if k in base})
    base["tarifas"] = {**TARIFAS_DEFECTO, **(d.get("tarifas") or {})}
    return base


def _guardar(d: dict) -> None:
    with _lock:
        os.makedirs(os.path.dirname(_RUTA), exist_ok=True)
        tmp = _RUTA + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(d, fh, ensure_ascii=False, indent=2)
        os.replace(tmp, _RUTA)


def actualizar_persona(usuario_id: int, datos: dict) -> dict:
    """Pago de hoy, propuesta, razón y parte variable (comisión) de una persona."""
    d = cargar()
    p = d["personas"].setdefault(str(int(usuario_id)), {})
    for k in ("pago_hoy", "propuesta", "fijo", "bono"):
        if k in datos:
            v = float(datos[k] or 0)
            if v < 0 or v > 100_000_000:
                raise ValueError(f"{k}: valor fuera de rango")
            p[k] = v
    if "razon" in datos:
        p["razon"] = str(datos["razon"] or "")[:600]
    if "rol" in datos:
        p["rol"] = str(datos["rol"] or "")[:120]
    if "comision" in datos:
        p["comision"] = bool(datos["comision"])
    if "mercado" in datos:
        m = datos["mercado"] or {}
        lo, hi = float(m.get("min") or 0), float(m.get("max") or 0)
        if lo < 0 or hi < lo or hi > 100_000_000:
            raise ValueError("Rango de mercado inválido")
        p["mercado"] = {"cargo": str(m.get("cargo") or "")[:160], "min": lo, "max": hi, "fuente": str(m.get("fuente") or "")[:400]}
    _guardar(d)
    return p


def actualizar_general(datos: dict) -> dict:
    d = cargar()
    if "tarifas" in datos:
        t = {str(k): float(v) for k, v in (datos["tarifas"] or {}).items() if str(k) in TARIFAS_DEFECTO}
        if any(v <= 0 or v > 500_000 for v in t.values()):
            raise ValueError("Tarifa fuera de rango")
        d["tarifas"].update(t)
    if "comision_pct" in datos:
        v = float(datos["comision_pct"] or 0)
        if not 0 <= v <= 30:
            raise ValueError("Comisión fuera de rango (0–30 %)")
        d["comision_pct"] = v
    if "horas_adicionales" in datos:
        x = datos["horas_adicionales"] or {}
        r = float(x.get("recargo_pct") or 0)
        if not -50 <= r <= 200:
            raise ValueError("Recargo de horas adicionales fuera de rango (−50 % a 200 %)")
        d["horas_adicionales"] = {"recargo_pct": r, "requieren_aprobacion": bool(x.get("requieren_aprobacion", True))}
    if "ventas_wa_promedio" in datos:
        x = datos["ventas_wa_promedio"] or {}
        d["ventas_wa_promedio"] = {"base": max(0.0, float(x.get("base") or 0)), "fuente": str(x.get("fuente") or "")[:400]}
    _guardar(d)
    return d


def agregar_extra(usuario_id: int, funcion: str, horas_semana: float, nivel: int, *,
                  etapa: str = "", nota: str = "", autor: str = "") -> dict:
    """Una función que la persona hace y el panel no registra (llamadas, grupos de WhatsApp…)."""
    funcion = (funcion or "").strip()
    if not funcion:
        raise ValueError("Escriba la función.")
    h = float(horas_semana or 0)
    if not 0 < h <= 60:
        raise ValueError("Las horas por semana van de 0,5 a 60.")
    if int(nivel) not in R.NIVELES:
        raise ValueError("Nivel inválido.")
    e = {"id": uuid.uuid4().hex[:10], "usuario_id": int(usuario_id), "funcion": funcion[:120],
         "horas_semana": h, "nivel": int(nivel), "etapa": etapa if etapa in ETAPA_IDS else "dirigir",
         "nota": (nota or "")[:200], "autor": autor[:80], "fecha": datetime.now().isoformat(timespec="seconds")}
    d = cargar()
    d["extras"].append(e)
    _guardar(d)
    return e


def quitar_extra(extra_id: str) -> bool:
    d = cargar()
    antes = len(d["extras"])
    d["extras"] = [e for e in d["extras"] if e.get("id") != extra_id]
    _guardar(d)
    return len(d["extras"]) < antes


# ─── WhatsApp con clientes ───────────────────────────────────────────────────

def _whatsapp(dias: int) -> dict:
    desde = int((datetime.utcnow() - timedelta(days=dias)).timestamp())
    try:
        c = sqlite3.connect(f"file:{_WA_DB}?mode=ro", uri=True, timeout=5)
        r = c.execute(
            """SELECT COUNT(DISTINCT jid), SUM(direccion='entrada'), SUM(enviado_por='humano'), SUM(enviado_por='bot')
               FROM mensajes WHERE ts>=? AND jid NOT LIKE '%@g.us'""", (desde,)).fetchone()
        c.close()
    except sqlite3.Error:
        return {}
    f = 30 / dias
    return {"chats": round((r[0] or 0) * f), "mensajes_clientes": round((r[1] or 0) * f),
            "respuestas_humanas": round((r[2] or 0) * f), "respuestas_bot": round((r[3] or 0) * f)}


# ─── Mapa ────────────────────────────────────────────────────────────────────

def mapa(dias: int = 30) -> dict:
    cfg = cargar()
    tar = {int(k): float(v) for k, v in cfg["tarifas"].items()}
    pct = float(cfg.get("comision_pct") or 0)
    ventas_prom = float((cfg.get("ventas_wa_promedio") or {}).get("base") or 0)
    try:
        from app.services.ventas_directas import comisiones_mes

        com_mes = comisiones_mes()
    except Exception:
        com_mes = None
    personas = []
    for u in R.equipo_para_selector():
        try:
            rd = R.rendimiento_usuario(u["id"], dias=dias)
        except ValueError:
            continue
        pc = cfg["personas"].get(str(u["id"]), {})
        celdas: dict[str, list] = {e: [] for e in ETAPA_IDS}
        for f in rd["funciones"]:
            f = dict(f)
            f["valor"] = round(f["horas"] * tar.get(f["nivel"], 0))
            f["tarifa"] = tar.get(f["nivel"], 0)
            f["manual"] = False
            celdas[etapa_de(f["id"])].append(f)
        for e in cfg["extras"]:
            if e.get("usuario_id") != u["id"]:
                continue
            h = round(float(e["horas_semana"]) * SEMANAS_MES, 1)
            celdas[e.get("etapa") or "dirigir"].append({
                "id": f"extra_{e['id']}", "extra_id": e["id"], "funcion": e["funcion"],
                "implica": e.get("nota") or "Anotada a mano: el panel no la registra.",
                "nivel": e["nivel"], "veces": 0, "horas": h, "promedio_min": None, "fuente": "anotada",
                "valor": round(h * tar.get(e["nivel"], 0)), "tarifa": tar.get(e["nivel"], 0), "manual": True})
        todas = [f for fs in celdas.values() for f in fs]
        if not todas and not pc:
            continue  # externos o personas sin actividad: no entran al mapa
        for fs in celdas.values():
            fs.sort(key=lambda f: -f["valor"])
        horas = round(sum(f["horas"] for f in todas), 1)
        valor = round(sum(f["valor"] for f in todas))
        pago = float(pc.get("pago_hoy") or 0)
        tarifa_media = valor / horas if horas else 0
        horas_pagadas = round(pago / tarifa_media, 1) if tarifa_media and pago else 0
        comision = None
        if pc.get("comision"):
            propias = next((v for v in (com_mes or {}).get("vendedores", []) if v["vendedor"] == u["username"]), None)
            comision = {"pct": pct, "base_promedio": ventas_prom, "promedio": round(ventas_prom * pct / 100),
                        "mes_actual": propias["comision"] if propias else 0,
                        "base_mes_actual": propias["base"] if propias else 0,
                        "fijo": float(pc.get("fijo") or 0), "bono": float(pc.get("bono") or 0)}
        carga = {"panel": 0.0, "cronometro": 0.0, "anotada": 0.0}
        for f in todas:
            k = "cronometro" if f["fuente"] == "cronómetro" else "anotada" if f["fuente"] == "anotada" else "panel"
            carga[k] += f["horas"]
        mercado = None
        mk = pc.get("mercado")
        if mk and mk.get("max"):
            eq_min, eq_max = honorario_equivalente(mk["min"]), honorario_equivalente(mk["max"])
            prop = min(horas / R.JORNADA_H, 1.0) if horas else 0
            mercado = {**mk, "piso_legal": SMMLV_2026, "honorario_min": round(eq_min), "honorario_max": round(eq_max),
                       "hora_min": round(eq_min / R.JORNADA_H), "hora_max": round(eq_max / R.JORNADA_H),
                       "por_sus_horas_min": round(eq_min * prop), "por_sus_horas_max": round(eq_max * prop),
                       "horas_referencia": R.JORNADA_H}
        personas.append({
            "usuario_id": u["id"], "username": u["username"], "nombre": u["nombre"],
            "rol": pc.get("rol") or "", "horas_mes": horas, "horas_mes_anterior": rd["horas_mes_anterior"],
            "dias_activos": rd["dias_activos"], "valor_mes": valor, "pago_hoy": pago,
            "propuesta": float(pc.get("propuesta") or 0), "razon": pc.get("razon") or "",
            "tarifa_media": round(tarifa_media), "horas_pagadas": horas_pagadas,
            "comision": comision, "tipos": rd["tipos"], "nota": rd["nota"],
            "carga": {k: round(v, 1) for k, v in carga.items()}, "celdas": celdas, "mercado": mercado,
        })
    personas.sort(key=lambda p: -p["valor_mes"])
    return {
        "periodo": {"dias": dias, "hasta": datetime.utcnow().date().isoformat()},
        "etapas": [{"id": e, "nombre": n} for e, n, _ in ETAPAS],
        "recorrido": [{"etapa": e, "funcion": f, "texto": t} for e, f, t in RECORRIDO],
        "tarifas": cfg["tarifas"], "niveles": R.NIVELES, "jornada": R.JORNADA_H,
        "comision_pct": pct, "ventas_wa_promedio": cfg.get("ventas_wa_promedio"),
        "comisiones_mes": com_mes, "whatsapp": _whatsapp(dias), "personas": personas,
        "config_cargada": bool(cfg["personas"]),
    }
