"""
Auditor de canales de atención (WhatsApp y chat web) — supervisión nivel 3.

Cada 30 min (scripts/auditor_canales_cron.py), sin IA:
  - clientes de WhatsApp sin respuesta (último mensaje del cliente, 20 min–12 h);
  - pedidos "listos para cerrar" sin que un asesor escriba después del aviso
    → re-alerta a WA_V2_ALERTA_DESTINO (máx. una cada 2 h por pedido);
  - chats atascados en modo humano (> 24 h);
  - salud del puente WhatsApp (sesión, adjuntos no descargados, errores de lectura);
  - gasto LLM del día frente al tope;
  - turnos del agente con error o frenados por el supervisor.
Solo avisa al grupo de sistemas si hay algo accionable y distinto del último aviso.

Una vez al día (--diario), una revisión con IA de una muestra de turnos del
agente que PROPONE mejoras (catálogo, instrucciones); no aplica nada solo.
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import subprocess
import time
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
ESTADO = REPO / "app" / "data" / "auditor_canales.json"
SIN_RESPUESTA_MIN = int(os.getenv("AUDITOR_SIN_RESPUESTA_MIN", "20"))
PEDIDO_SIN_ATENDER_MIN = int(os.getenv("AUDITOR_PEDIDO_SIN_ATENDER_MIN", "30"))
REAVISO_PEDIDO_H = 2
REAVISO_GRUPO_H = 2


def _leer_estado() -> dict:
    try:
        return json.loads(ESTADO.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _guardar_estado(e: dict) -> None:
    ESTADO.write_text(json.dumps(e, ensure_ascii=False, indent=2), encoding="utf-8")


def _hallazgo(tipo: str, severidad: str, detalle: str, **extra) -> dict:
    return {"tipo": tipo, "severidad": severidad, "detalle": detalle, **extra}


# --- Revisiones ----------------------------------------------------------------------


def clientes_sin_respuesta(ahora: float) -> list[dict]:
    from app.routes import cargar_modos_atencion
    from app.services.wa_chats import listar_conversaciones
    from app.services.wa_jid import en_lista_modo, formato_display

    modos = cargar_modos_atencion()
    out = []
    for c in listar_conversaciones(limit=120):
        jid = c.get("jid", "")
        if jid.endswith("@g.us") or c.get("direccion") != "entrada":
            continue
        espera = ahora - float(c.get("ts") or 0)
        if not (SIN_RESPUESTA_MIN * 60 <= espera <= 12 * 3600):
            continue
        if en_lista_modo(jid, modos.get("numeros_silenciados", [])):
            continue
        out.append({"jid": jid, "display": formato_display(jid), "min": int(espera // 60), "texto": (c.get("texto") or "")[:80]})
    return sorted(out, key=lambda x: -x["min"])


def pedidos_sin_atender(ahora: float, estado: dict, *, enviar: bool) -> list[dict]:
    from app.agent.ventas_wa import historial as hist
    from app.agent.ventas_wa import pedido as ped_mod
    from app.services.wa_jid import formato_display

    avisados = estado.setdefault("pedidos_realertados", {})
    out = []
    for p in ped_mod.listar_para_panel("activo", dias=3):
        if p["estado"] != "esperando_asesor" or not p["handoff_ts"] or p["jid"].startswith("web:"):
            continue
        if ahora - p["handoff_ts"] < PEDIDO_SIN_ATENDER_MIN * 60:
            continue
        ultimo_asesor = hist.ultimo_mensaje_asesor(hist.mensajes(p["jid"], limite=40)) or 0
        if ultimo_asesor > p["handoff_ts"]:
            continue  # un asesor ya escribió después del aviso
        minutos = int((ahora - p["handoff_ts"]) // 60)
        item = {"id": p["id"], "jid": p["jid"], "display": formato_display(p["jid"]), "min": minutos, "total": p["total"]}
        out.append(item)
        if enviar and ahora - float(avisados.get(str(p["id"]), 0)) >= REAVISO_PEDIDO_H * 3600:
            from app.agent.ventas_wa.herramientas import enviar_alerta_asesor

            nombre = p["cliente"].get("nombre") or item["display"]
            total = f"${int(p['total']):,}".replace(",", ".") if p["total"] else "sin total"
            texto = (
                f"⏰ *Pedido WA sin cerrar hace {minutos} min*\n👤 {nombre} ({item['display']})\n"
                f"💵 Total referencial: {total}\nNadie le ha escrito desde el aviso. Ábrelo en /app → Agente WA → Pedidos IA."
            )
            enviar_alerta_asesor(texto)
            avisados[str(p["id"])] = ahora
    return out


def humanos_atascados(ahora: float) -> list[str]:
    from app.routes import cargar_modos_atencion

    modos = cargar_modos_atencion()
    ts = modos.get("timestamps", {})
    return [j for j in modos.get("numeros_en_humano", []) if ahora - float(ts.get(j) or 0) > 24 * 3600]


def salud_puente() -> list[dict]:
    out = []
    try:
        import requests

        base = os.getenv("WHATSAPP_BRIDGE_URL", "http://127.0.0.1:3000").rstrip("/")
        tok = os.getenv("WHATSAPP_BRIDGE_INTERNAL_TOKEN", "").strip()
        r = requests.get(f"{base}/session/status", headers={"X-Bridge-Token": tok} if tok else {}, timeout=8)
        data = r.json() if r.ok else {}
        if not data.get("conectado", data.get("sistema_listo")):
            out.append(_hallazgo("puente", "alta", f"WhatsApp no está conectado ({data.get('mensaje') or r.status_code})."))
    except Exception as e:
        out.append(_hallazgo("puente", "alta", f"El puente de WhatsApp no responde: {str(e)[:120]}"))
    try:
        log = subprocess.run(
            ["journalctl", "-u", os.getenv("WHATSAPP_BRIDGE_UNIT", "mckenna-whatsapp-bridge"), "--since", "30 min ago", "--no-pager"],
            capture_output=True, text=True, timeout=20,
        ).stdout
        adj = log.count("Adjunto no descargado")
        sync = log.count("/chats/sync:")
        if adj:
            out.append(_hallazgo("puente", "media", f"{adj} adjunto(s) de clientes no se pudieron descargar en 30 min (revisar en el teléfono)."))
        if sync >= 5:
            out.append(_hallazgo("puente", "baja", f"La sincronización de chats del panel falló {sync} veces en 30 min."))
    except Exception:
        pass
    return out


def presupuesto() -> list[dict]:
    from app.services.llm_budget import gasto_hoy

    tope = float(os.getenv("LLM_BUDGET_TOPE_USD", "3.0"))
    g = float(gasto_hoy().get("gasto_usd", 0.0))
    if g >= 0.8 * tope:
        return [_hallazgo("presupuesto", "alta" if g >= tope else "media", f"Gasto IA de hoy US${g:.2f} de un tope de US${tope:.2f}.")]
    return []


def turnos_con_problemas(desde: float) -> list[dict]:
    from app.agent.ventas_wa import pedido as ped_mod

    out = []
    for modo in ("activo", "sombra"):
        ruta = ped_mod.ruta_db(modo)
        if not os.path.exists(ruta):
            continue
        try:
            con = sqlite3.connect(f"file:{ruta}?mode=ro", uri=True, timeout=5)
            con.row_factory = sqlite3.Row
            filas = con.execute(
                "SELECT jid, modo, error FROM turnos WHERE ts >= ? AND error IS NOT NULL ORDER BY ts DESC LIMIT 50", (desde,)
            ).fetchall()
            con.close()
        except sqlite3.Error:
            continue
        for r in filas:
            out.append({"jid": r["jid"], "modo": r["modo"], "error": (r["error"] or "")[:200]})
    return out


# --- Orquestación -------------------------------------------------------------------


def auditar(*, enviar: bool = True) -> dict:
    ahora = time.time()
    estado = _leer_estado()
    hallazgos: list[dict] = []

    sin_resp = clientes_sin_respuesta(ahora)
    if sin_resp:
        top = ", ".join(f"{x['display']} ({x['min']} min)" for x in sin_resp[:5])
        hallazgos.append(_hallazgo("sin_respuesta", "alta" if any(x["min"] >= 60 for x in sin_resp) else "media",
                                   f"{len(sin_resp)} cliente(s) de WhatsApp esperando respuesta: {top}", items=sin_resp[:20]))
    pend = pedidos_sin_atender(ahora, estado, enviar=enviar)
    if pend:
        hallazgos.append(_hallazgo("pedido_sin_cerrar", "alta", f"{len(pend)} pedido(s) listos para cerrar sin atender (se re-alertó al asesor).", items=pend))
    atascados = humanos_atascados(ahora)
    if atascados:
        hallazgos.append(_hallazgo("modo_humano", "baja", f"{len(atascados)} chat(s) en modo humano hace más de 24 h: el bot no les responde."))
    hallazgos += salud_puente()
    hallazgos += presupuesto()
    malos = turnos_con_problemas(ahora - 1800)
    frenados = [t for t in malos if "[supervisor" in t["error"]]
    if malos:
        hallazgos.append(_hallazgo("agente", "media" if len(malos) > len(frenados) else "baja",
                                   f"{len(malos)} turno(s) del agente con error en 30 min ({len(frenados)} frenados/corregidos por el supervisor).",
                                   items=malos[:10]))

    reporte = {"ts": ahora, "fecha": datetime.now().isoformat(timespec="seconds"), "hallazgos": hallazgos}
    estado["ultimo"] = reporte

    accionables = [h for h in hallazgos if h["severidad"] in ("alta", "media")]
    if enviar and accionables:
        firma = hashlib.sha1("|".join(sorted(f"{h['tipo']}:{h['detalle'][:60]}" for h in accionables)).encode()).hexdigest()[:12]
        if firma != estado.get("ultima_firma") or ahora - float(estado.get("ultimo_aviso_ts", 0)) >= REAVISO_GRUPO_H * 3600:
            from app.utils import enviar_whatsapp_reporte, jid_grupo_alertas_sistemas_wa

            iconos = {"alta": "🔴", "media": "🟠"}
            texto = "🛰️ *Auditor de canales (WhatsApp + web)*\n" + "\n".join(
                f"{iconos[h['severidad']]} {h['detalle']}" for h in accionables
            )
            if os.getenv("AUDITOR_CANALES_SKIP_WA", "0") != "1":
                enviar_whatsapp_reporte(texto, numero_destino=jid_grupo_alertas_sistemas_wa())
            estado["ultima_firma"] = firma
            estado["ultimo_aviso_ts"] = ahora
    _guardar_estado(estado)
    return reporte


PROMPT_AUDITORIA = """Eres el auditor de calidad de los agentes de venta de McKenna Group (materias primas; WhatsApp y chat web). Recibes una muestra de turnos: lo que escribió el cliente y lo que respondió (o habría respondido, en modo sombra) el agente, con los errores o rechazos del supervisor.

Reglas del negocio: precios solo del catálogo web; el agente no cierra ventas ni da datos de pago; no promete tiempos; no repite preguntas; pasa a un asesor en reclamos, descuentos, COA, productos fuera de la web.

Devuelve en español, breve y accionable:
1. Los 3-5 problemas más importantes que viste (con el ejemplo).
2. Para cada uno, la corrección concreta que propones (cambio en instrucciones, producto/sinónimo faltante en el catálogo, regla del supervisor), sin aplicarla.
3. Una línea con la calificación general de 1 a 10."""


def auditoria_diaria(*, enviar: bool = True, max_turnos: int = 12) -> str:
    """Una sola llamada a la IA sobre una muestra del día (pasa por llm_budget como lote)."""
    from app.agent.ventas_wa import pedido as ped_mod
    from app.agent.ventas_wa.agente import modelo
    from app.services.llm_budget import permitir_llamada, registrar_llamada, usage_anthropic

    desde = time.time() - 86400
    muestra = []
    for modo in ("activo", "sombra"):
        ruta = ped_mod.ruta_db(modo)
        if not os.path.exists(ruta):
            continue
        con = sqlite3.connect(f"file:{ruta}?mode=ro", uri=True, timeout=5)
        con.row_factory = sqlite3.Row
        filas = con.execute(
            """SELECT modo, entrada, respuesta, herramientas, error FROM turnos WHERE ts >= ?
               ORDER BY (error IS NOT NULL) DESC, ts DESC LIMIT ?""",
            (desde, max_turnos),
        ).fetchall()
        con.close()
        muestra += [dict(r) for r in filas]
    muestra = muestra[:max_turnos]
    if not muestra:
        return "Sin turnos del agente en las últimas 24 h."
    key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    mod = modelo()
    ok, motivo = permitir_llamada(mod, contexto="auditor_canales")
    if not key or not ok:
        return f"Auditoría IA no ejecutada: {'sin API key' if not key else motivo}"
    import anthropic

    texto_muestra = "\n\n".join(
        f"[{i+1}] canal/modo: {t['modo']}\nCLIENTE: {t['entrada']}\nAGENTE: {t['respuesta']}\n"
        f"herramientas: {t['herramientas']}\nerror/supervisor: {t['error'] or '-'}"
        for i, t in enumerate(muestra)
    )[:30000]
    resp = anthropic.Anthropic(api_key=key, timeout=120.0).messages.create(
        model=mod, max_tokens=4000, system=PROMPT_AUDITORIA, messages=[{"role": "user", "content": texto_muestra}]
    )
    t_in, t_out = usage_anthropic(resp)
    registrar_llamada(mod, tokens_in=t_in, tokens_out=t_out, contexto="auditor_canales")
    informe = "".join(getattr(b, "text", "") for b in resp.content if getattr(b, "type", "") == "text").strip()
    estado = _leer_estado()
    estado["auditoria_diaria"] = {"fecha": datetime.now().isoformat(timespec="seconds"), "turnos": len(muestra), "informe": informe}
    _guardar_estado(estado)
    if enviar and informe and os.getenv("AUDITOR_CANALES_SKIP_WA", "0") != "1":
        from app.utils import enviar_whatsapp_reporte, jid_grupo_alertas_sistemas_wa

        enviar_whatsapp_reporte("🧠 *Auditoría diaria de los agentes de venta*\n\n" + informe[:3500], numero_destino=jid_grupo_alertas_sistemas_wa())
    return informe


def ultimo_reporte() -> dict:
    e = _leer_estado()
    return {"ultimo": e.get("ultimo"), "auditoria_diaria": e.get("auditoria_diaria")}
