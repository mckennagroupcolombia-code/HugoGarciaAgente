"""Conciliación con el contador — cruce de lo declarado contra el Libro Mayor, paso a paso.

Por qué existe: el cruce del 13-sep-2026 (docs/agentic/PENDIENTES-CONTABILIDAD.md, punto 4)
encontró cinco cosas que ningún panel mostraba — pagos de retención sin registrar, compras a
socios que solo el contador tenía, un tercero mal tipado, retenciones indebidas a alguien
del Régimen SIMPLE, declaraciones que nunca llegaron por correo. Todo eso vivía en un
markdown. Aquí cada inconsistencia es un **hallazgo** con clave estable, que el usuario
recorre uno por uno (wizard), decide, y si hace falta convierte en TKT del Centro de Mando
para resolverlo con el contador.

Fuentes (todas ya existentes, ninguna llama a un LLM):
  - `docs/contabilidad/<año>/declaraciones_contador.json` — lo que extrajo
    `scripts/extraer_declaraciones_contador.py` de los PDF del contador (350, 490, 300,
    RTICA, ICA, certificados). Si no existen, el primer hallazgo es «bajar los soportes».
  - `app/data/contabilidad.db` — cuenta 2365 y terceros del Libro Mayor.
  - `app/services/calendario_tributario.py` — vencimientos del 350.

Tabla propia `cc_conciliacion_hallazgos` en contabilidad.db. `analizar()` es idempotente: la
clave del hallazgo es determinista (tipo + periodo/tercero), así que correrlo dos veces
actualiza cifras sin duplicar, y lo que el usuario ya decidió no se pisa. Un hallazgo que
deja de detectarse se marca `vigente=0` (se resolvió por otra vía) sin borrar la historia.

Cambios que este módulo SÍ hace sobre la base cuando el usuario lo decide (y solo entonces):
marcar un tercero como persona natural o como Régimen SIMPLE, y registrar el pago de un recibo
490 que ya está probado (asiento 2365 → Bancos con el PDF del recibo como soporte; idempotente
por referencia `dian:490:<número>`). Todo lo demás va por ticket, porque toca la contabilidad y
necesita a alguien que responda por ello.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import threading
from calendar import monthrange
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

_ROOT = Path(__file__).resolve().parents[2]
_DOCS = _ROOT / "docs" / "contabilidad"
_initialized = False
_lock = threading.Lock()
_job: dict[str, Any] = {"estado": "idle", "mensaje": "", "inicio": None, "fin": None, "resultado": None}

# Tolerancia para dar por igual lo declarado (redondeado a miles en el 350) y el libro.
TOLERANCIA_ABS = 2_000
TOLERANCIA_PCT = 0.01

MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
         "septiembre", "octubre", "noviembre", "diciembre"]

# Marcador en la descripción del ticket para poder re-enlazar hallazgo ↔ ticket.
MARCADOR_TICKET = "SYS_CONCILIACION_HALLAZGO:"

ESTADOS = ("pendiente", "ticket", "resuelto", "descartado")

# Acciones que el wizard ofrece. `muta_datos` = toca la base (solo metadatos de terceros).
ACCIONES = {
    "crear_ticket": {"label": "Crear TKT para resolverlo", "muta_datos": False},
    "resolver": {"label": "Ya está resuelto", "muta_datos": False},
    "descartar": {"label": "No aplica / descartar", "muta_datos": False},
    "marcar_natural": {"label": "Marcar tercero como persona natural", "muta_datos": True},
    "marcar_simple": {"label": "Marcar tercero como Régimen SIMPLE (no se le retiene)", "muta_datos": True},
    "registrar_pago": {"label": "Registrar el pago en el Libro Mayor (2365 → Bancos)", "muta_datos": True},
    "reabrir": {"label": "Reabrir", "muta_datos": False},
}


def _conn():
    import app.services.contabilidad_core as cc

    return cc._conn()


def init_db() -> None:
    global _initialized
    if _initialized:
        return
    import app.services.contabilidad_core as cc

    cc.init_db()
    with _conn() as con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS cc_conciliacion_hallazgos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            clave TEXT NOT NULL UNIQUE,
            tipo TEXT NOT NULL,
            titulo TEXT NOT NULL,
            resumen TEXT NOT NULL DEFAULT '',
            detalle TEXT NOT NULL DEFAULT '',
            por_que TEXT NOT NULL DEFAULT '',
            accion_sugerida TEXT NOT NULL DEFAULT '',
            periodo TEXT NOT NULL DEFAULT '',
            severidad TEXT NOT NULL DEFAULT 'media',
            monto REAL NOT NULL DEFAULT 0,
            datos_json TEXT NOT NULL DEFAULT '{}',
            acciones_json TEXT NOT NULL DEFAULT '[]',
            tercero_id INTEGER,
            estado TEXT NOT NULL DEFAULT 'pendiente',
            decision TEXT NOT NULL DEFAULT '',
            notas TEXT NOT NULL DEFAULT '',
            ticket_id INTEGER,
            ticket_numero TEXT NOT NULL DEFAULT '',
            ticket_estado TEXT NOT NULL DEFAULT '',
            decidido_por INTEGER,
            decidido_por_nombre TEXT NOT NULL DEFAULT '',
            decidido_en TEXT NOT NULL DEFAULT '',
            vigente INTEGER NOT NULL DEFAULT 1,
            visto_en TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_cc_conc_estado ON cc_conciliacion_hallazgos(estado, vigente);
        CREATE TABLE IF NOT EXISTS cc_conciliacion_corridas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            inicio TEXT NOT NULL,
            fin TEXT NOT NULL DEFAULT '',
            descargo_correo INTEGER NOT NULL DEFAULT 0,
            nuevos INTEGER NOT NULL DEFAULT 0,
            actualizados INTEGER NOT NULL DEFAULT 0,
            cerrados INTEGER NOT NULL DEFAULT 0,
            resumen_json TEXT NOT NULL DEFAULT '{}',
            error TEXT NOT NULL DEFAULT ''
        );
        """)
        cols = {r["name"] for r in con.execute("PRAGMA table_info(cc_terceros)")}
        if "regimen_simple" not in cols:
            # Régimen SIMPLE (Art. 911 ET): no se le practica retefuente ni reteICA. No viaja en
            # el XML DIAN (ahí dice R-99-PN como todo el mundo); se sabe por el RUT o el pie de
            # la factura. Sin esta bandera el motor volvía a retenerle a Alexandra cada mes.
            con.execute("ALTER TABLE cc_terceros ADD COLUMN regimen_simple INTEGER NOT NULL DEFAULT 0")
    _initialized = True


def _ensure() -> None:
    if not _initialized:
        init_db()


# ───────────────────────────────────────────── utilidades ────────────────


def _cop(v: float | int | None) -> str:
    return f"${round(float(v or 0)):,}".replace(",", ".")


def _mes_nombre(anio: int, mes: int) -> str:
    return f"{MESES[mes - 1]} {anio}"


def _cargar_declaraciones() -> list[dict]:
    decls: list[dict] = []
    if not _DOCS.exists():
        return decls
    for p in sorted(_DOCS.glob("*/declaraciones_contador.json")):
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
            decls += d.get("declaraciones", [])
        except Exception:
            continue
    return decls


def _parece_cedula(identificacion: str) -> bool:
    d = re.sub(r"\D", "", identificacion or "")
    if not d or len(d) > 10:
        return False
    # NIT de persona jurídica: 9 dígitos que empiezan por 8 o 9. Cédulas: ≤8 dígitos
    # (viejas) o 10 dígitos que empiezan por 1 (nuevas).
    if len(d) == 9 and d[0] in "89":
        return False
    return len(d) <= 8 or (len(d) == 10 and d[0] == "1")


def _libro_2365(anio: int) -> dict[int, dict]:
    """Por mes: créditos (causación) por tercero y débitos (pagos) con fecha."""
    out: dict[int, dict] = {
        m: {"pj": 0.0, "pn": 0.0, "sin_tercero": 0.0, "pagos": [], "terceros": {}} for m in range(1, 13)
    }
    with _conn() as con:
        rows = con.execute(
            """
            SELECT m.id AS movimiento_id, m.fecha, m.referencia, m.concepto, m.tipo_origen,
                   l.credito, l.debito,
                   t.id AS tercero_id, t.nombre AS tercero, t.tipo_persona, t.identificacion,
                   COALESCE(t.regimen_simple, 0) AS regimen_simple
              FROM cc_movimiento_lineas l
              JOIN cc_movimientos m ON m.id = l.movimiento_id AND m.estado <> 'anulado'
              JOIN cc_plan_cuentas c ON c.id = l.cuenta_id
              LEFT JOIN cc_terceros t ON t.id = COALESCE(l.tercero_id, m.tercero_id)
             WHERE c.codigo LIKE '2365%' AND substr(m.fecha, 1, 4) = ?
             ORDER BY m.fecha
            """,
            (str(anio),),
        ).fetchall()
    for r in rows:
        mes = int(r["fecha"][5:7])
        if r["debito"]:
            out[mes]["pagos"].append({
                "movimiento_id": r["movimiento_id"], "fecha": r["fecha"],
                "valor": round(float(r["debito"])), "concepto": r["concepto"], "referencia": r["referencia"],
            })
        if r["credito"]:
            tp = (r["tipo_persona"] or "").lower()
            clave = "pn" if tp == "natural" else ("pj" if tp else "sin_tercero")
            out[mes][clave] += float(r["credito"])
            nombre = r["tercero"] or "(sin tercero)"
            t = out[mes]["terceros"].setdefault(nombre, {
                "tercero_id": r["tercero_id"], "tipo_persona": tp or "?",
                "identificacion": r["identificacion"] or "", "regimen_simple": int(r["regimen_simple"] or 0),
                "retencion": 0.0, "asientos": [],
            })
            t["retencion"] += float(r["credito"])
            t["asientos"].append({
                "movimiento_id": r["movimiento_id"], "fecha": r["fecha"],
                "valor": round(float(r["credito"])), "referencia": r["referencia"],
            })
    return out


def _todos_pagos_2365() -> list[dict]:
    with _conn() as con:
        rows = con.execute(
            """
            SELECT m.id AS movimiento_id, m.fecha, l.debito AS valor
              FROM cc_movimiento_lineas l
              JOIN cc_movimientos m ON m.id = l.movimiento_id AND m.estado <> 'anulado'
              JOIN cc_plan_cuentas c ON c.id = l.cuenta_id
             WHERE c.codigo LIKE '2365%' AND l.debito > 0
            """
        ).fetchall()
    return [dict(r) for r in rows]


# ───────────────────────────────────────────── detectores ────────────────


def _h(clave: str, tipo: str, titulo: str, *, resumen: str, por_que: str, accion: str,
       periodo: str = "", severidad: str = "media", monto: float = 0, datos: dict | None = None,
       acciones: list[str] | None = None, tercero_id: int | None = None, detalle: str = "") -> dict:
    return {
        "clave": clave, "tipo": tipo, "titulo": titulo, "resumen": resumen, "detalle": detalle,
        "por_que": por_que, "accion_sugerida": accion, "periodo": periodo, "severidad": severidad,
        "monto": round(float(monto or 0)), "datos": datos or {},
        "acciones": acciones or ["crear_ticket", "resolver", "descartar"], "tercero_id": tercero_id,
    }


def _det_sin_soportes(decls: list[dict]) -> list[dict]:
    if decls:
        return []
    return [_h(
        "soportes:sin_descargar", "soportes", "No hay declaraciones del contador para cruzar",
        resumen="Todavía no se han bajado del correo los formularios 350/490/300/RTICA que envía el contador.",
        por_que="Sin lo declarado no hay contra qué comparar el Libro Mayor. Los soportes se bajan del Gmail "
                "de la empresa con un clic (botón «Bajar del correo y analizar»).",
        accion="Pulsar «Bajar del correo y analizar». Tarda uno o dos minutos la primera vez.",
        severidad="alta", acciones=["descartar"],
    )]


def _det_350_vs_libro(decls: list[dict]) -> list[dict]:
    out: list[dict] = []
    f350 = [d for d in decls if d.get("tipo") == "350" and d.get("anio") and d.get("periodo")]
    anios = sorted({d["anio"] for d in f350})
    for anio in anios:
        libro = _libro_2365(anio)
        for d in sorted((x for x in f350 if x["anio"] == anio), key=lambda x: x["periodo"]):
            mes = int(d["periodo"])
            if not 1 <= mes <= 12:
                continue
            l = libro[mes]
            c = d.get("compras", {})
            dec_pj, dec_pn = float(c.get("pj_retencion") or 0), float(c.get("pn_retencion") or 0)
            lib_pj, lib_pn = l["pj"] + l["sin_tercero"], l["pn"]
            per = f"{anio}-{mes:02d}"
            nombre = _mes_nombre(anio, mes)
            terceros = {
                k: {"retencion": round(v["retencion"]), "tipo_persona": v["tipo_persona"], "tercero_id": v["tercero_id"]}
                for k, v in l["terceros"].items()
            }
            # Si el libro no tiene NADA en ese año, no tiene sentido un hallazgo por mes
            # (es historia anterior al Libro Mayor); se cubre con un solo aviso por año.
            libro_vacio_anio = not any(libro[m]["terceros"] or libro[m]["pagos"] for m in range(1, 13))
            if libro_vacio_anio:
                continue
            dif_pj = dec_pj - lib_pj
            tol = max(TOLERANCIA_ABS, dec_pj * TOLERANCIA_PCT)
            if abs(dif_pj) > tol:
                sentido = "declaró MÁS de lo que el libro causó" if dif_pj > 0 else "declaró MENOS de lo que el libro causó"
                out.append(_h(
                    f"350_pj:{per}", "350_pj",
                    f"Retención a personas jurídicas de {nombre}: el 350 {sentido}",
                    resumen=f"Formulario 350 renglón 49: {_cop(dec_pj)} · Libro Mayor (2365, jurídicas): {_cop(lib_pj)} · "
                            f"diferencia {_cop(dif_pj)}.",
                    por_que="Si el contador declaró más, tiene una factura que el libro no causó (o la causó en otro "
                            "mes). Si declaró menos, el libro tiene una retención que nunca se pagó a la DIAN. "
                            "Cualquiera de los dos deja la 2365 descuadrada.",
                    accion="Pedir al contador el detalle por tercero del renglón 36/49 de ese periodo y cruzarlo "
                           "contra los asientos `ret:<factura>` del libro.",
                    periodo=per, severidad="media" if abs(dif_pj) < 50_000 else "alta", monto=abs(dif_pj),
                    datos={"declarado_pj": dec_pj, "libro_pj": round(lib_pj), "diferencia": round(dif_pj),
                           "base_declarada_pj": c.get("pj_base"), "terceros_libro": terceros,
                           "formulario": d.get("numero_formulario"), "archivo": d.get("archivo")},
                ))
            dif_pn = dec_pn - lib_pn
            if dif_pn > max(TOLERANCIA_ABS, dec_pn * TOLERANCIA_PCT):
                out.append(_h(
                    f"350_pn:{per}", "350_pn",
                    f"Retención a personas naturales de {nombre}: {_cop(dif_pn)} declarados que el libro no tiene",
                    resumen=f"Formulario 350 renglón 102: {_cop(dec_pn)} sobre una base de {_cop(c.get('pn_base'))} · "
                            f"Libro Mayor (2365, naturales): {_cop(lib_pn)}.",
                    por_que="En McKenna la retención a personas naturales sale casi toda de las compras a los socios "
                            "(Cynthia y Armando compran a título personal y le venden a la empresa) y a proveedores "
                            "persona natural. Si el contador la declaró y el libro no la tiene, esas compras nunca "
                            "entraron a Préstamos → Compras de socios ni a la 2380, y la cuenta con el socio está "
                            "incompleta.",
                    accion="Pedir al contador el detalle por tercero de los renglones 86/102 de ese periodo y cargar "
                           "cada compra en Compras de socios (o como compra a proveedor natural).",
                    periodo=per, severidad="alta" if dif_pn >= 100_000 else "media", monto=dif_pn,
                    datos={"declarado_pn": dec_pn, "libro_pn": round(lib_pn), "diferencia": round(dif_pn),
                           "base_declarada_pn": c.get("pn_base"), "terceros_libro": terceros,
                           "formulario": d.get("numero_formulario"), "archivo": d.get("archivo")},
                ))
            elif dif_pn < -max(TOLERANCIA_ABS, dec_pn * TOLERANCIA_PCT):
                out.append(_h(
                    f"350_pn_exceso:{per}", "350_pn",
                    f"El libro causó {_cop(-dif_pn)} más retención a personas naturales que lo declarado en {nombre}",
                    resumen=f"Formulario 350 renglón 102: {_cop(dec_pn)} · Libro Mayor (2365, naturales): {_cop(lib_pn)}.",
                    por_que="Una retención causada en el libro que el contador no declaró es dinero que se le descontó "
                            "a alguien (o que se asumió) y nunca llegó a la DIAN. Suele ser un tercero en Régimen "
                            "SIMPLE o una factura que el contador no recibió.",
                    accion="Revisar los terceros naturales del mes en el libro y confirmar con el contador si esa "
                           "retención va en el 350 siguiente o si no debía practicarse.",
                    periodo=per, severidad="media", monto=-dif_pn,
                    datos={"declarado_pn": dec_pn, "libro_pn": round(lib_pn), "terceros_libro": terceros},
                ))
    return out


def _det_pagos_490(decls: list[dict]) -> list[dict]:
    out: list[dict] = []
    pagos = _todos_pagos_2365()
    for d in decls:
        if d.get("tipo") != "490" or d.get("concepto") != "61" or not d.get("fecha_pago"):
            continue
        valor = float(d.get("valor_impuesto") or 0)
        if valor <= 0:
            continue
        try:
            f = date.fromisoformat(d["fecha_pago"])
        except ValueError:
            continue
        # Solo tiene sentido si el libro ya vive en ese año (hay algo en la 2365 de ese año).
        anio = f.year
        libro = _libro_2365(anio)
        if not any(libro[m]["terceros"] or libro[m]["pagos"] for m in range(1, 13)):
            continue
        hallado = None
        for p in pagos:
            try:
                fp = date.fromisoformat(p["fecha"][:10])
            except ValueError:
                continue
            if abs((fp - f).days) <= 7 and abs(float(p["valor"]) - valor) < 1:
                hallado = p
                break
        if hallado:
            continue
        per = f"{d.get('anio')}-{int(d.get('periodo') or 0):02d}"
        nombre = _mes_nombre(int(d["anio"]), int(d["periodo"])) if d.get("anio") and d.get("periodo") else per
        out.append(_h(
            f"pago_490:{per}", "pago_490",
            f"El pago de la retención de {nombre} ({_cop(valor)}, {d['fecha_pago']}) no está en el Libro Mayor",
            resumen=f"Recibo 490 concepto 61 pagado el {d['fecha_pago']} por {_cop(valor)}. En la cuenta 2365 no hay "
                    f"ningún débito por ese valor cerca de esa fecha.",
            por_que="Mientras el pago no esté, la 2365 muestra como deuda con la DIAN algo que ya se pagó y Bancos "
                    "no refleja la salida. El saldo de retenciones por pagar queda inflado exactamente en ese valor.",
            accion="Registrar el egreso contra 2365 con la fecha del recibo (Contabilidad → Ingresos/Egresos, o "
                   "clasificando la línea del extracto si ya está cargado).",
            periodo=per, severidad="alta", monto=valor,
            acciones=["registrar_pago", "crear_ticket", "resolver", "descartar"],
            datos={"fecha_pago": d["fecha_pago"], "valor": valor, "formulario_350": d.get("formulario_pagado"),
                   "numero_490": d.get("numero_formulario"), "archivo": d.get("archivo"),
                   "anio": d.get("anio"), "mes": d.get("periodo")},
        ))
    return out


def _det_declaraciones_faltantes(decls: list[dict]) -> list[dict]:
    """Periodos ya vencidos sin 350 en el correo, y el próximo por vencer sin 350 todavía."""
    out: list[dict] = []
    try:
        from app.services.calendario_tributario import info_vencimiento_retencion
    except Exception:
        info_vencimiento_retencion = None  # type: ignore
    tengo = {(d["anio"], d["periodo"]) for d in decls if d.get("tipo") == "350" and d.get("anio") and d.get("periodo")}
    if not tengo:
        return out
    hoy = date.today()
    # Arranca en el primer año del que hay al menos tres 350: un formulario suelto (el
    # periodo 12 del año anterior llega en enero) no significa que se tenga ese año.
    por_anio: dict[int, int] = {}
    for a, _ in tengo:
        por_anio[a] = por_anio.get(a, 0) + 1
    anios_ok = [a for a, n in por_anio.items() if n >= 3]
    if not anios_ok:
        return out
    anio_min = min(anios_ok)
    periodos: list[tuple[int, int]] = []
    a, m = anio_min, 1
    # hasta el mes anterior al actual (el periodo del mes en curso aún no se declara)
    while (a, m) < (hoy.year, hoy.month):
        periodos.append((a, m))
        m += 1
        if m > 12:
            a, m = a + 1, 1
    faltan_vencidos: list[str] = []
    for (a, m) in periodos:
        if (a, m) in tengo:
            continue
        venc = None
        if info_vencimiento_retencion:
            try:
                info = info_vencimiento_retencion(a, m)
                venc = info.get("fecha") if isinstance(info, dict) else None
            except Exception:
                venc = None
        try:
            venc_d = date.fromisoformat(str(venc)) if venc else None
        except ValueError:
            venc_d = None
        if venc_d and venc_d >= hoy:
            # Próximo por vencer: hallazgo aparte con estimado del libro.
            libro = _libro_2365(a)[m]
            estimado = libro["pj"] + libro["pn"] + libro["sin_tercero"]
            dias = (venc_d - hoy).days
            out.append(_h(
                f"350_por_vencer:{a}-{m:02d}", "por_vencer",
                f"Retención de {_mes_nombre(a, m)}: vence el {venc_d.isoformat()} y aún no llegó el 350",
                resumen=f"El Libro Mayor lleva {_cop(estimado)} causados en la 2365 para ese mes "
                        f"({len(libro['terceros'])} terceros). Faltan {dias} día(s).",
                por_que="El contador arma el 350 con lo que le llega; lo que el libro tiene y él no (o al revés) "
                        "es exactamente lo que después toca conciliar. Es más barato cruzarlo antes de presentar.",
                accion="Enviarle al contador el resumen de la 2365 del mes (Préstamos → retenciones → correo al "
                       "contador) y pedirle el borrador del 350 antes de la fecha.",
                periodo=f"{a}-{m:02d}", severidad="alta" if dias <= 5 else "media", monto=estimado,
                datos={"vence": venc_d.isoformat(), "dias": dias,
                       "terceros_libro": {k: round(v["retencion"]) for k, v in libro["terceros"].items()}},
            ))
        else:
            faltan_vencidos.append(f"{a}-{m:02d}")
    if faltan_vencidos:
        out.append(_h(
            f"350_faltantes:{faltan_vencidos[0]}..{faltan_vencidos[-1]}", "faltantes",
            f"{len(faltan_vencidos)} formulario(s) 350 no están en el correo: {', '.join(faltan_vencidos)}",
            resumen="Periodos ya vencidos de los que no hay PDF del 350 en el Gmail de la empresa.",
            por_que="Sin el formulario no se puede cruzar ese mes. O el contador no lo envió, o lo mandó desde otro "
                    "correo, o no se presentó — las tres cosas hay que saberlas.",
            accion="Pedirle al contador esos formularios (con su recibo 490) por correo a la cuenta de la empresa.",
            periodo=faltan_vencidos[0], severidad="media", monto=0,
            datos={"periodos": faltan_vencidos},
        ))
    return out


def _det_terceros(decls: list[dict]) -> list[dict]:
    """Terceros con retención en el libro cuyo tipo de persona no cuadra con su identificación,
    y terceros marcados Régimen SIMPLE a los que igual se les retuvo."""
    out: list[dict] = []
    with _conn() as con:
        rows = con.execute(
            """
            SELECT t.id, t.nombre, t.identificacion, t.tipo_persona, COALESCE(t.regimen_simple, 0) AS regimen_simple,
                   COUNT(*) AS n, ROUND(SUM(l.credito)) AS retenido, MIN(m.fecha) AS desde, MAX(m.fecha) AS hasta,
                   GROUP_CONCAT(m.id) AS movimientos
              FROM cc_movimiento_lineas l
              JOIN cc_movimientos m ON m.id = l.movimiento_id AND m.estado <> 'anulado'
              JOIN cc_plan_cuentas c ON c.id = l.cuenta_id
              JOIN cc_terceros t ON t.id = COALESCE(l.tercero_id, m.tercero_id)
             WHERE c.codigo LIKE '2365%' AND l.credito > 0
             GROUP BY t.id
            """
        ).fetchall()
    for r in rows:
        tp = (r["tipo_persona"] or "").lower()
        if r["regimen_simple"]:
            movs = [int(x) for x in (r["movimientos"] or "").split(",") if x]
            out.append(_h(
                f"ret_simple:{r['id']}", "ret_simple",
                f"Se le retuvo {_cop(r['retenido'])} a {r['nombre']}, que está en Régimen SIMPLE",
                resumen=f"{r['n']} asiento(s) de retención entre {r['desde']} y {r['hasta']} "
                        f"(movimientos {', '.join(map(str, movs))}).",
                por_que="Art. 911 E.T.: a un contribuyente del SIMPLE no se le practica retención en la fuente a "
                        "título de renta ni reteICA. Si se declaró en el 350, se pagó a la DIAN algo que no se debía; "
                        "si además se le pagó la factura completa, ese dinero salió del bolsillo de McKenna.",
                accion="Pedir al contador que la descuente como retención practicada en exceso o indebida "
                       "(renglón 129 del 350 siguiente, Art. 1.2.4.16 DUR 1625) y anular los asientos en el libro.",
                severidad="alta", monto=r["retenido"], tercero_id=r["id"],
                datos={"tercero": r["nombre"], "identificacion": r["identificacion"], "movimientos": movs,
                       "desde": r["desde"], "hasta": r["hasta"]},
            ))
        elif tp == "juridica" and _parece_cedula(r["identificacion"]):
            out.append(_h(
                f"tercero_tipo:{r['id']}", "tercero_tipo",
                f"{r['nombre']} figura como persona jurídica pero su identificación parece una cédula",
                resumen=f"Identificación {r['identificacion']} · {r['n']} retención(es) por {_cop(r['retenido'])} "
                        f"entre {r['desde']} y {r['hasta']}.",
                por_que="El tipo de persona decide en qué columna del 350 va la retención (jurídicas 36/49, "
                        "naturales 86/102) y qué tarifa aplica. Mal tipado, el cruce contra el contador nunca "
                        "cuadra y el certificado anual sale mal. Si además es Régimen SIMPLE, no debía retenerse.",
                accion="Confirmar con el RUT o el pie de su factura: marcar como persona natural y, si dice "
                       "«Régimen SIMPLE», marcarlo también.",
                severidad="media", monto=r["retenido"], tercero_id=r["id"],
                acciones=["marcar_natural", "marcar_simple", "crear_ticket", "descartar"],
                datos={"tercero": r["nombre"], "identificacion": r["identificacion"], "tipo_persona": tp},
            ))
    return out


def _det_alegra_vs_libro(decls: list[dict]) -> list[dict]:
    """Retención que está en el Libro Mayor pero que el contador NO ve en Alegra.

    El contador arma el 350 con lo que hay en Alegra. Si una retención solo vive
    en el libro propio, la declara de menos y la DIAN cobra sanción e intereses
    por el faltante. Este detector pone números a ese hueco antes de que se
    pague la declaración, que es cuando todavía se puede corregir sin costo."""
    from app.services import alegra_espejo

    anio = date.today().year
    libro = _libro_2365(anio)
    causado = {m: libro[m]["pj"] + libro[m]["pn"] + libro[m]["sin_tercero"] for m in range(1, 13)}
    total_libro = sum(causado.values())
    if total_libro <= 0:
        return []
    visible = alegra_espejo.retenciones_visibles_en_alegra(anio)
    if visible.get("parcial"):
        # Lectura incompleta (Alegra cortó la paginación con un 503): comparar
        # contra un total a medias acusaría de un faltante que no existe.
        return [
            _h(
                f"alegra_lectura_parcial_{anio}",
                "alegra",
                f"La lectura de Alegra quedó incompleta ({anio}): no se puede comparar todavía",
                resumen=f"{visible.get('error')}. Se alcanzaron a leer {visible.get('journals', 0)} comprobantes.",
                por_que=(
                    "Comparar el libro contra una lectura a medias daría un faltante inventado. Se prefiere no "
                    "afirmar nada antes que mandarle al contador una cifra equivocada."
                ),
                accion="Volver a analizar en unos minutos; suele ser un 503 pasajero de Alegra.",
                periodo=str(anio),
                severidad="baja",
                acciones=["resolver", "descartar"],
            )
        ]
    if visible.get("error"):
        return [
            _h(
                f"alegra_sin_lectura_{anio}",
                "alegra",
                f"No se pudo leer qué ve el contador en Alegra ({anio})",
                resumen=visible["error"],
                por_que=(
                    "El contador prepara el 350 con lo que hay en Alegra. Si no se puede leer Alegra, no hay forma "
                    "de saber si lo que él ve coincide con la retención que el Libro Mayor dice que se practicó."
                ),
                accion="Revisar ALEGRA_EMAIL / ALEGRA_TOKEN en el entorno y volver a analizar.",
                periodo=str(anio),
                severidad="media",
                acciones=["resolver", "descartar"],
            )
        ]
    en_alegra = {int(m): float(v) for m, v in (visible.get("por_mes") or {}).items()}
    total_alegra = sum(en_alegra.values())
    falta = round(total_libro - total_alegra)
    if falta < 50_000:
        return []
    meses = [
        {
            "mes": m,
            "nombre": _mes_nombre(anio, m),
            "libro": round(causado[m]),
            "alegra": round(en_alegra.get(m, 0)),
            "invisible": round(causado[m] - en_alegra.get(m, 0)),
        }
        for m in range(1, 13)
        if causado[m] or en_alegra.get(m)
    ]
    detalle = "\n".join(
        f"  {x['nombre']}: libro {_cop(x['libro'])} · Alegra {_cop(x['alegra'])} · no ve {_cop(x['invisible'])}"
        for x in meses
    )
    return [
        _h(
            f"alegra_vs_libro_{anio}",
            "alegra",
            f"El contador no ve en Alegra {_cop(falta)} de retención practicada en {anio}",
            resumen=(
                f"El Libro Mayor tiene {_cop(total_libro)} acreditados en la 2365 durante {anio}; en Alegra solo hay "
                f"{_cop(total_alegra)} ({visible.get('journals', 0)} comprobantes contables y {visible.get('bills', 0)} "
                f"facturas de compra). La diferencia es {_cop(falta)}."
            ),
            por_que=(
                "El contador declara el 350 con lo que ve en Alegra. Todo lo que solo esté en el Libro Mayor queda "
                "fuera de la declaración: se paga de menos y la DIAN lo cobra después con sanción por inexactitud e "
                "intereses. Hay que decidir entre dos caminos, y el costo de no decidir crece cada mes."
            ),
            accion=(
                "Opción A: encender el espejo a Alegra (ALEGRA_ESPEJO_ACTIVO=1) para que cada asiento del Libro Mayor "
                "quede también como comprobante contable allá. Opción B: darle al contador acceso de solo lectura al "
                "Libro Mayor del panel. En cualquier caso, pasarle este detalle antes de que presente el próximo 350."
            ),
            periodo=str(anio),
            severidad="alta",
            monto=falta,
            datos={"meses": meses, "total_libro": round(total_libro), "total_alegra": round(total_alegra), "detalle_alegra": (visible.get("detalle") or [])[:40]},
            detalle=detalle,
        )
    ]


def _det_retencion_prestamos(decls: list[dict]) -> list[dict]:
    """Retención del 7 % sobre intereses de préstamos que está por practicarse.

    Es el caso más delicado: nace de un pago que hace McKenna, no de una factura
    de proveedor, así que no aparece por ningún otro lado. Si el espejo a Alegra
    está apagado, el contador no se enteraría de que hay que declararla."""
    from app.services import alegra_espejo

    with _conn() as con:
        try:
            filas = con.execute(
                """
                SELECT c.fecha_vencimiento, c.retencion, c.estado, t.nombre AS tercero
                  FROM cc_prestamo_cuotas c
                  JOIN cc_prestamos p ON p.id = c.prestamo_id
                  LEFT JOIN cc_terceros t ON t.id = p.tercero_id
                 WHERE c.retencion > 0 AND p.estado <> 'cancelado'
                 ORDER BY c.fecha_vencimiento
                """
            ).fetchall()
        except sqlite3.OperationalError:
            return []
    if not filas:
        return []
    pendientes = [dict(r) for r in filas if (r["estado"] or "") != "pagada"]
    if not pendientes:
        return []
    espejo_activo = (os.getenv("ALEGRA_ESPEJO_ACTIVO", "0") or "0").strip() == "1"
    doc_soporte = (os.getenv("PRESTAMOS_DOC_SOPORTE_ACTIVO", "0") or "0").strip() == "1"
    if espejo_activo and doc_soporte:
        return []
    primera = pendientes[0]["fecha_vencimiento"][:10]
    mes_primera = primera[:7]
    ret_mes = sum(float(x["retencion"] or 0) for x in pendientes if (x["fecha_vencimiento"] or "")[:7] == mes_primera)
    total = sum(float(x["retencion"] or 0) for x in pendientes)
    terceros = sorted({x["tercero"] or "(sin tercero)" for x in pendientes})
    apagado = []
    if not espejo_activo:
        apagado.append("el espejo a Alegra (ALEGRA_ESPEJO_ACTIVO=0)")
    if not doc_soporte:
        apagado.append("el documento soporte de los intereses (PRESTAMOS_DOC_SOPORTE_ACTIVO=0)")
    return [
        _h(
            "prestamos_retencion_invisible",
            "alegra",
            (
                f"La retención de los préstamos ({_cop(ret_mes)} desde {primera}) "
                + ("aún no tiene documento soporte" if espejo_activo else "no llegará a Alegra")
            ),
            resumen=(
                f"Hay {len(pendientes)} cuotas por pagar con retención del 7 % sobre intereses, {_cop(total)} en total, "
                f"a {len(terceros)} prestamistas. La primera vence el {primera} y ese mes suma {_cop(ret_mes)}. "
                f"Está apagado {' y '.join(apagado)}."
            ),
            por_que=(
                "Esta retención nace de un pago de McKenna al prestamista, no de una factura de proveedor: no aparece "
                "en ningún documento que el contador reciba por otra vía. Si no se espeja a Alegra ni se emite el "
                "documento soporte, la practica McKenna, la descuenta del giro y nadie la declara — el dinero queda "
                "retenido sin consignar a la DIAN, que es justo lo que sanciona el Art. 402 del Código Penal."
            ),
            accion=(
                "Antes del primer pago: avisarle al contador que estas retenciones existen y acordar por dónde las va "
                "a ver (con el espejo encendido el asiento llega solo a Alegra; el detalle por tercero lo manda el cron "
                "del día 3). Para el documento soporte ya no falta nada técnico —la retención del 7 % está creada en "
                "Alegra y el documento sale con ella—: falta decidir encenderlo (PRESTAMOS_DOC_SOPORTE_ACTIVO=1), "
                "sabiendo que una vez emitido viaja a la DIAN y solo se corrige con nota de ajuste."
            ),
            periodo=mes_primera,
            severidad="alta",
            monto=round(ret_mes),
            datos={
                "primera_cuota": primera,
                "retencion_primer_mes": round(ret_mes),
                "retencion_total_futura": round(total),
                "cuotas_pendientes": len(pendientes),
                "prestamistas": terceros,
                "espejo_activo": espejo_activo,
                "doc_soporte_activo": doc_soporte,
            },
            detalle="\n".join(
                f"  {x['fecha_vencimiento'][:10]} · {x['tercero']}: {_cop(x['retencion'])}" for x in pendientes[:12]
            ),
        )
    ]


DETECTORES = (
    _det_sin_soportes,
    _det_350_vs_libro,
    _det_pagos_490,
    _det_declaraciones_faltantes,
    _det_terceros,
    _det_alegra_vs_libro,
    _det_retencion_prestamos,
)


# ───────────────────────────────────────────── persistencia ──────────────


def _fila(r: sqlite3.Row) -> dict:
    d = dict(r)
    try:
        d["datos"] = json.loads(d.pop("datos_json") or "{}")
    except Exception:
        d["datos"] = {}
    try:
        d["acciones"] = json.loads(d.pop("acciones_json") or "[]")
    except Exception:
        d["acciones"] = []
    d["acciones_info"] = [{"id": a, **ACCIONES[a]} for a in d["acciones"] if a in ACCIONES]
    return d


def analizar(descargar_correo: bool = False) -> dict:
    """Corre los detectores y sincroniza la tabla. Devuelve el resumen de la corrida."""
    _ensure()
    inicio = datetime.now().isoformat(timespec="seconds")
    error = ""
    descargo = 0
    if descargar_correo:
        try:
            descargo = _descargar_y_extraer()
        except Exception as e:  # el análisis sigue con lo que haya
            error = f"Correo: {e}"
    decls = _cargar_declaraciones()
    hallazgos: list[dict] = []
    for det in DETECTORES:
        try:
            hallazgos += det(decls)
        except Exception as e:
            error += f" | {det.__name__}: {e}"
    ahora = datetime.now().isoformat(timespec="seconds")
    nuevos = actualizados = cerrados = 0
    claves = {h["clave"] for h in hallazgos}
    with _conn() as con:
        existentes = {r["clave"]: dict(r) for r in con.execute("SELECT * FROM cc_conciliacion_hallazgos")}
        for h in hallazgos:
            ex = existentes.get(h["clave"])
            if ex is None:
                con.execute(
                    """INSERT INTO cc_conciliacion_hallazgos
                       (clave, tipo, titulo, resumen, detalle, por_que, accion_sugerida, periodo, severidad, monto,
                        datos_json, acciones_json, tercero_id, visto_en, vigente)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)""",
                    (h["clave"], h["tipo"], h["titulo"], h["resumen"], h["detalle"], h["por_que"],
                     h["accion_sugerida"], h["periodo"], h["severidad"], h["monto"],
                     json.dumps(h["datos"], ensure_ascii=False), json.dumps(h["acciones"]), h["tercero_id"], ahora),
                )
                nuevos += 1
            else:
                # Se refrescan cifras y textos; estado/decisión/ticket son del usuario y no se tocan.
                # Si estaba cerrado por "dejó de detectarse" y vuelve, reabre.
                reabre = not ex["vigente"] and ex["estado"] == "resuelto" and (ex["decision"] == "auto")
                con.execute(
                    """UPDATE cc_conciliacion_hallazgos
                          SET titulo=?, resumen=?, detalle=?, por_que=?, accion_sugerida=?, periodo=?, severidad=?,
                              monto=?, datos_json=?, acciones_json=?, tercero_id=?, visto_en=?, vigente=1,
                              estado=CASE WHEN ? THEN 'pendiente' ELSE estado END,
                              decision=CASE WHEN ? THEN '' ELSE decision END,
                              updated_at=?
                        WHERE clave=?""",
                    (h["titulo"], h["resumen"], h["detalle"], h["por_que"], h["accion_sugerida"], h["periodo"],
                     h["severidad"], h["monto"], json.dumps(h["datos"], ensure_ascii=False), json.dumps(h["acciones"]),
                     h["tercero_id"], ahora, 1 if reabre else 0, 1 if reabre else 0, ahora, h["clave"]),
                )
                actualizados += 1
        for clave, ex in existentes.items():
            if clave in claves or not ex["vigente"]:
                continue
            # Dejó de detectarse: si estaba pendiente, se cierra solo (resuelto por otra vía).
            con.execute(
                """UPDATE cc_conciliacion_hallazgos
                      SET vigente=0, updated_at=?,
                          estado=CASE WHEN estado IN ('pendiente','ticket') THEN 'resuelto' ELSE estado END,
                          decision=CASE WHEN estado IN ('pendiente','ticket') THEN 'auto' ELSE decision END,
                          decidido_en=CASE WHEN estado IN ('pendiente','ticket') THEN ? ELSE decidido_en END
                    WHERE clave=?""",
                (ahora, ahora, clave),
            )
            cerrados += 1
        con.execute(
            """INSERT INTO cc_conciliacion_corridas (inicio, fin, descargo_correo, nuevos, actualizados, cerrados,
                                                    resumen_json, error)
               VALUES (?,?,?,?,?,?,?,?)""",
            (inicio, ahora, descargo, nuevos, actualizados, cerrados,
             json.dumps({"hallazgos": len(hallazgos), "declaraciones": len(decls)}), error.strip(" |")),
        )
    _sincronizar_tickets()
    return {"inicio": inicio, "fin": ahora, "nuevos": nuevos, "actualizados": actualizados, "cerrados": cerrados,
            "hallazgos": len(hallazgos), "declaraciones": len(decls), "descargados": descargo, "error": error.strip(" |")}


def _descargar_y_extraer() -> int:
    """Baja del Gmail lo nuevo del contador y vuelve a extraer los PDF. Importa los scripts por ruta
    (no son paquete) para no duplicar su lógica aquí."""
    import importlib.util

    def _mod(nombre: str):
        p = _ROOT / "scripts" / f"{nombre}.py"
        spec = importlib.util.spec_from_file_location(nombre, p)
        m = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
        assert spec and spec.loader
        spec.loader.exec_module(m)
        return m

    desc = _mod("descargar_soportes_contador")
    stats = desc.descargar(desde="2025-01-01", hasta=None, todo=False, dry_run=False, max_msgs=500)
    ext = _mod("extraer_declaraciones_contador")
    anios = sorted(int(p.name) for p in _DOCS.glob("20*") if (p / "Soportes_Contador").exists())
    for a in anios:
        ext.procesar_anio(a)
    return int(stats.get("nuevos", 0))


def _sincronizar_tickets() -> None:
    """Refleja el estado del ticket del Centro de Mando en el hallazgo (resuelto ↔ resuelto)."""
    try:
        from app.services import tickets_db as _tdb
    except Exception:
        return
    with _conn() as con:
        filas = con.execute(
            "SELECT id, ticket_id, estado FROM cc_conciliacion_hallazgos WHERE ticket_id IS NOT NULL"
        ).fetchall()
        if not filas:
            return
        try:
            tdb = sqlite3.connect(_tdb.DB_PATH)
            tdb.row_factory = sqlite3.Row
            estados = {r["id"]: (r["numero"], r["estado"]) for r in tdb.execute(
                "SELECT id, numero, estado FROM tickets WHERE id IN (%s)" % ",".join("?" * len(filas)),
                [f["ticket_id"] for f in filas],
            )}
            tdb.close()
        except Exception:
            return
        ahora = datetime.now().isoformat(timespec="seconds")
        for f in filas:
            num, est = estados.get(f["ticket_id"], ("", ""))
            if not est:
                continue
            nuevo_estado = f["estado"]
            if est == "resuelto" and f["estado"] == "ticket":
                nuevo_estado = "resuelto"
            con.execute(
                "UPDATE cc_conciliacion_hallazgos SET ticket_numero=?, ticket_estado=?, estado=?, updated_at=? WHERE id=?",
                (num, est, nuevo_estado, ahora, f["id"]),
            )


def listar(estado: str = "pendiente") -> list[dict]:
    _ensure()
    _sincronizar_tickets()
    with _conn() as con:
        if estado == "todos":
            rows = con.execute(
                """SELECT * FROM cc_conciliacion_hallazgos
                    ORDER BY CASE estado WHEN 'pendiente' THEN 0 WHEN 'ticket' THEN 1 ELSE 2 END,
                             CASE severidad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, periodo, id"""
            ).fetchall()
        else:
            rows = con.execute(
                """SELECT * FROM cc_conciliacion_hallazgos WHERE estado=? AND vigente=1
                    ORDER BY CASE severidad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, periodo, id""",
                (estado,),
            ).fetchall()
    return [_fila(r) for r in rows]


def resumen() -> dict:
    _ensure()
    with _conn() as con:
        # Lo decidido cuenta como avance aunque ya no se detecte (se resolvió justamente por eso);
        # lo pendiente solo cuenta mientras siga vigente.
        por_estado = {r["estado"]: r["n"] for r in con.execute(
            "SELECT estado, COUNT(*) AS n FROM cc_conciliacion_hallazgos "
            "WHERE vigente=1 OR estado IN ('ticket','resuelto','descartado') GROUP BY estado"
        )}
        monto_pend = con.execute(
            "SELECT COALESCE(SUM(monto),0) AS m FROM cc_conciliacion_hallazgos WHERE vigente=1 AND estado='pendiente'"
        ).fetchone()["m"]
        hoy = date.today().isoformat()
        decididos_hoy = con.execute(
            "SELECT COUNT(*) AS n FROM cc_conciliacion_hallazgos WHERE substr(decidido_en,1,10)=?", (hoy,)
        ).fetchone()["n"]
        ultima = con.execute("SELECT * FROM cc_conciliacion_corridas ORDER BY id DESC LIMIT 1").fetchone()
        # Racha: días consecutivos (hacia atrás desde hoy) con al menos una decisión.
        dias = {r["d"] for r in con.execute(
            "SELECT DISTINCT substr(decidido_en,1,10) AS d FROM cc_conciliacion_hallazgos WHERE decidido_en<>''"
        )}
    racha = 0
    d = date.today()
    while d.isoformat() in dias:
        racha += 1
        d -= timedelta(days=1)
    total = sum(por_estado.values())
    cerrados = por_estado.get("resuelto", 0) + por_estado.get("descartado", 0)
    soportes = {}
    for p in sorted(_DOCS.glob("*/declaraciones_contador.json")):
        try:
            j = json.loads(p.read_text(encoding="utf-8"))
            soportes[p.parent.name] = {"documentos": j.get("documentos", 0), "por_tipo": j.get("por_tipo", {})}
        except Exception:
            continue
    return {
        "total": total,
        "pendientes": por_estado.get("pendiente", 0),
        "con_ticket": por_estado.get("ticket", 0),
        "resueltos": por_estado.get("resuelto", 0),
        "descartados": por_estado.get("descartado", 0),
        "avance_pct": round(100 * (cerrados + por_estado.get("ticket", 0)) / total) if total else 0,
        "monto_pendiente": round(float(monto_pend or 0)),
        "decididos_hoy": decididos_hoy,
        "racha_dias": racha,
        "ultima_corrida": dict(ultima) if ultima else None,
        "soportes": soportes,
        "job": dict(_job),
    }


# ───────────────────────────────────────────── decisiones ────────────────


def _usuario_para_ticket() -> int | None:
    """A quién se asigna el TKT: el aliado configurado para esta tarea (Sistemas → Aliados); si no,
    quien coordina con el contador (PRESTAMOS_USUARIO_CONTABILIDAD, lo tributario va a Armando); si
    no, el aliado de retenciones de préstamos."""
    try:
        from app.services import tickets_db as _tdb

        asig = _tdb.get_aliados_asignaciones()
        uid = (asig.get(getattr(_tdb, "TAREA_CONCILIACION_CONTADOR", "conciliacion_contador")) or {}).get("usuario_id")
        if uid:
            return int(uid)
        username = (os.getenv("PRESTAMOS_USUARIO_CONTABILIDAD") or "").strip().lower()
        if username:
            db = sqlite3.connect(_tdb.DB_PATH)
            row = db.execute("SELECT id FROM usuarios WHERE lower(username)=? AND activo=1", (username,)).fetchone()
            db.close()
            if row:
                return int(row[0])
        uid = (asig.get(_tdb.TAREA_PRESTAMOS_DECLARAR_RETENCIONES) or {}).get("usuario_id")
        if uid:
            return int(uid)
    except Exception:
        return None
    return None


def _texto_ticket(h: dict, notas: str) -> str:
    datos = h.get("datos") or {}
    lineas = [
        f"Hallazgo de conciliación con el contador — **{h['titulo']}**",
        "",
        h["resumen"],
        "",
        f"**Por qué importa:** {h['por_que']}",
        "",
        f"**Acción sugerida:** {h['accion_sugerida']}",
    ]
    if h.get("periodo"):
        lineas.append(f"Periodo: {h['periodo']}")
    if h.get("monto"):
        lineas.append(f"Monto: {_cop(h['monto'])}")
    if datos.get("terceros_libro"):
        lineas.append("")
        lineas.append("Terceros en el Libro Mayor ese mes:")
        for k, v in datos["terceros_libro"].items():
            ret = v["retencion"] if isinstance(v, dict) else v
            tp = f" ({v.get('tipo_persona')})" if isinstance(v, dict) else ""
            lineas.append(f"- {k}{tp}: {_cop(ret)}")
    if datos.get("movimientos"):
        lineas.append(f"Asientos del libro: {', '.join(map(str, datos['movimientos']))}")
    if datos.get("archivo"):
        lineas.append(f"Soporte: {datos['archivo']}")
    if notas.strip():
        lineas += ["", f"Notas de quien lo revisó: {notas.strip()}"]
    lineas += ["", "Al resolverlo, dejar en comentarios qué se acordó con el contador y qué asiento se hizo.",
               f"{MARCADOR_TICKET} {h['clave']}"]
    return "\n".join(lineas)


def decidir(hallazgo_id: int, accion: str, *, usuario: dict | None, notas: str = "") -> dict:
    """Aplica la decisión del usuario sobre un hallazgo. Devuelve el hallazgo actualizado."""
    _ensure()
    if accion not in ACCIONES:
        raise ValueError(f"Acción desconocida: {accion}")
    with _conn() as con:
        r = con.execute("SELECT * FROM cc_conciliacion_hallazgos WHERE id=?", (int(hallazgo_id),)).fetchone()
    if not r:
        raise ValueError("Hallazgo no encontrado")
    h = _fila(r)
    if accion not in h["acciones"] and accion != "reabrir":
        raise ValueError("Esa acción no aplica a este hallazgo")
    uid = int(usuario["id"]) if usuario and usuario.get("id") else None
    unombre = (usuario or {}).get("nombre") or (usuario or {}).get("username") or ""
    ahora = datetime.now().isoformat(timespec="seconds")
    campos: dict[str, Any] = {"decision": accion, "notas": notas or h["notas"], "decidido_por": uid,
                              "decidido_por_nombre": unombre, "decidido_en": ahora, "updated_at": ahora}
    mensaje = ""

    if accion == "crear_ticket":
        from app.services import tickets_db as _tdb

        _tdb.init_db()
        if h.get("ticket_id"):
            raise ValueError(f"Ya tiene el ticket {h.get('ticket_numero') or h['ticket_id']}")
        creador = uid
        if not creador:
            db = sqlite3.connect(_tdb.DB_PATH)
            row = db.execute("SELECT id FROM usuarios WHERE username='admin'").fetchone() or \
                db.execute("SELECT id FROM usuarios WHERE activo=1 ORDER BY id LIMIT 1").fetchone()
            db.close()
            creador = int(row[0]) if row else None
        if not creador:
            raise ValueError("No hay usuario con quien crear el ticket")
        asignado = _usuario_para_ticket()
        data = {
            "tipo": "solicitud" if asignado and asignado != creador else "accion",
            "titulo": f"Conciliación contador · {h['titulo']}"[:180],
            "categoria": "contabilidad",
            "descripcion": _texto_ticket(h, notas),
            "prioridad": "alta" if h["severidad"] == "alta" else "media",
            "asignado_a": asignado,
        }
        ticket, err = _tdb.crear_ticket(data, creador, None)
        if err:
            raise ValueError(f"No se pudo crear el ticket: {err}")
        campos.update({"estado": "ticket", "ticket_id": int(ticket["id"]), "ticket_numero": ticket.get("numero") or "",
                       "ticket_estado": ticket.get("estado") or ""})
        mensaje = f"Ticket {ticket.get('numero')} creado"
    elif accion == "resolver":
        campos["estado"] = "resuelto"
        mensaje = "Marcado como resuelto"
    elif accion == "descartar":
        campos["estado"] = "descartado"
        mensaje = "Descartado"
    elif accion == "reabrir":
        campos.update({"estado": "pendiente", "decision": ""})
        mensaje = "Reabierto"
    elif accion == "registrar_pago":
        mov = _registrar_pago_490(h, uid)
        campos["estado"] = "resuelto"
        campos["notas"] = (notas.strip() + " · " if notas.strip() else "") + f"Asiento #{mov['id']} registrado"
        mensaje = f"Asiento #{mov['id']} registrado: 2365 → Bancos por {_cop(mov['valor'])} el {mov['fecha']}"
    elif accion in ("marcar_natural", "marcar_simple"):
        if not h.get("tercero_id"):
            raise ValueError("El hallazgo no tiene tercero")
        with _conn() as con:
            if accion == "marcar_natural":
                con.execute("UPDATE cc_terceros SET tipo_persona='natural' WHERE id=?", (h["tercero_id"],))
                mensaje = "Tercero marcado como persona natural"
            else:
                con.execute(
                    "UPDATE cc_terceros SET tipo_persona='natural', regimen_simple=1, "
                    "notas=CASE WHEN notas LIKE '%Régimen SIMPLE%' THEN notas ELSE notas || ' · Régimen SIMPLE (no se le retiene, Art. 911 ET)' END "
                    "WHERE id=?",
                    (h["tercero_id"],),
                )
                mensaje = "Tercero marcado como Régimen SIMPLE; el próximo análisis mostrará las retenciones indebidas"
        campos["estado"] = "resuelto"

    sets = ", ".join(f"{k}=?" for k in campos)
    with _conn() as con:
        con.execute(f"UPDATE cc_conciliacion_hallazgos SET {sets} WHERE id=?", (*campos.values(), h["id"]))
        r = con.execute("SELECT * FROM cc_conciliacion_hallazgos WHERE id=?", (h["id"],)).fetchone()
    out = _fila(r)
    out["mensaje"] = mensaje
    if accion in ("marcar_natural", "marcar_simple", "registrar_pago"):
        # Re-analizar en caliente para que el wizard muestre de inmediato lo que cambia.
        try:
            analizar(descargar_correo=False)
        except Exception:
            pass
    return out


def _registrar_pago_490(h: dict, uid: int | None) -> dict:
    """Asiento del pago de retención probado por un recibo 490: Débito 2365 / Crédito Bancos.

    Mismo asiento que deja `extracto_clasificado` cuando la línea del banco existe (#1389, #1555);
    aquí la prueba es el recibo de la DIAN porque el extracto de ese mes no está cargado. Si luego se
    carga, la línea PSE se vincula a este asiento en vez de crear otro.
    """
    import app.services.contabilidad_core as cc

    datos = h.get("datos") or {}
    valor = round(float(datos.get("valor") or h.get("monto") or 0))
    fecha = str(datos.get("fecha_pago") or "").strip()
    if valor <= 0 or not fecha:
        raise ValueError("El hallazgo no trae valor o fecha del recibo 490")
    numero = str(datos.get("numero_490") or "").strip()
    referencia = f"dian:490:{numero}" if numero else f"dian:490:{h['periodo']}"
    with _conn() as con:
        ya = con.execute(
            "SELECT id FROM cc_movimientos WHERE referencia=? AND estado<>'anulado'", (referencia,)
        ).fetchone()
        if ya:
            raise ValueError(f"Ese pago ya está registrado (asiento #{ya['id']})")
        c2365 = con.execute("SELECT id FROM cc_plan_cuentas WHERE codigo='2365' AND activa=1").fetchone()
        banco = con.execute(
            "SELECT m.cuenta_id FROM cc_medios_pago m JOIN cc_plan_cuentas c ON c.id=m.cuenta_id "
            "WHERE m.activo=1 AND c.codigo='1110' ORDER BY m.id LIMIT 1"
        ).fetchone()
    if not c2365 or not banco:
        raise ValueError("Falta la cuenta 2365 o un medio de pago bancario activo")
    anio, mes = datos.get("anio"), datos.get("mes")
    periodo_txt = _mes_nombre(int(anio), int(mes)) if anio and mes else h.get("periodo", "")
    concepto = (f"Pago retención en la fuente a la DIAN — formulario 350 de {periodo_txt}"
                + (f" (recibo 490 No. {numero})" if numero else ""))
    mov = cc.crear_movimiento(
        fecha, concepto,
        [
            {"cuenta_id": c2365["id"], "debito": valor, "descripcion": f"Recibo 490 {numero} · PSE DIAN".strip()},
            {"cuenta_id": banco["cuenta_id"], "credito": valor, "descripcion": "Banco"},
        ],
        referencia=referencia, tipo_origen="conciliacion_contador",
        plantilla_datos={"hallazgo": h["clave"], "formulario_350": datos.get("formulario_350"), "numero_490": numero},
        created_by=uid,
    )
    mov_id = int(mov["id"] if isinstance(mov, dict) else mov)
    archivo = datos.get("archivo")
    if archivo:
        ruta = _ROOT / archivo
        if ruta.exists():
            try:
                cc.guardar_comprobante(mov_id, ruta.read_bytes(), ruta.name, "application/pdf")
            except Exception:
                pass
    return {"id": mov_id, "valor": valor, "fecha": fecha}


# ───────────────────────────────────────────── job en segundo plano ──────


def lanzar_analisis(descargar_correo: bool) -> dict:
    """Corre `analizar()` en un hilo (la descarga del correo puede tardar más que el timeout del proxy)."""
    with _lock:
        if _job["estado"] == "corriendo":
            return dict(_job)
        _job.update({"estado": "corriendo", "mensaje": "Bajando soportes del correo…" if descargar_correo else "Cruzando…",
                     "inicio": datetime.now().isoformat(timespec="seconds"), "fin": None, "resultado": None})

    def _run():
        try:
            res = analizar(descargar_correo=descargar_correo)
            with _lock:
                _job.update({"estado": "ok", "mensaje": f"{res['hallazgos']} hallazgo(s), {res['nuevos']} nuevo(s)",
                             "fin": datetime.now().isoformat(timespec="seconds"), "resultado": res})
        except Exception as e:
            with _lock:
                _job.update({"estado": "error", "mensaje": str(e), "fin": datetime.now().isoformat(timespec="seconds")})

    try:
        from app.observability import spawn_thread

        spawn_thread(_run, (), daemon=True)
    except Exception:
        threading.Thread(target=_run, daemon=True).start()
    return dict(_job)


def estado_job() -> dict:
    with _lock:
        return dict(_job)
