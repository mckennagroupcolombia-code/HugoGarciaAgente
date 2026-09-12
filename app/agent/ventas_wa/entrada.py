"""
Punto de entrada del agente de ventas WA desde la ruta /whatsapp.

Bandera WA_AGENTE_V2:
  off     (default) no hace nada; responde el flujo legacy.
  sombra  el flujo legacy sigue respondiendo; v2 corre en segundo plano y deja
          su borrador en ventas_wa.db (tabla turnos) SIN enviar nada al cliente
          ni al grupo. Gasta tokens: solo con autorización (regla llm_budget).
  activo  v2 responde al cliente y avisa al grupo de ventas.

Guardas propias (además de las de routes.py: grupos, silenciados, bot global):
  1. Si un asesor escribió en ese chat hace menos de WA_V2_PAUSA_HUMANO_HORAS,
     el bot no responde: el asesor tiene la conversación.
  2. Pausa manual por chat (tabla pausas).
  3. Agrupación: espera WA_V2_AGRUPAR_S segundos y responde una sola vez a la
     ráfaga de mensajes; las peticiones de los mensajes anteriores se retiran.
"""

from __future__ import annotations

import os
import time

from app.agent.ventas_wa import historial as hist
from app.agent.ventas_wa import pedido as ped_mod
from app.observability import log_json, spawn_thread


def modo() -> str:
    m = os.getenv("WA_AGENTE_V2", "off").strip().lower()
    return m if m in ("off", "sombra", "activo") else "off"


def _pausa_humano_horas() -> float:
    try:
        return float(os.getenv("WA_V2_PAUSA_HUMANO_HORAS", "12"))
    except ValueError:
        return 12.0


def motivo_silencio(jid: str, msgs: list[dict]) -> str | None:
    ultimo_asesor = hist.ultimo_mensaje_asesor(msgs)
    if ultimo_asesor and time.time() - ultimo_asesor < _pausa_humano_horas() * 3600:
        return "asesor_activo"
    from app.services.wa_jid import jids_relacionados

    if ped_mod.pausa_vigente(jids_relacionados(jid) or {jid}):
        return "pausa_manual"
    return None


def _debe_responder_este(msgs: list[dict], wa_id: str | None, ts_msg: float | None) -> bool:
    """Solo la petición del ÚLTIMO mensaje pendiente responde (agrupa ráfagas)."""
    pendientes = hist.pendientes_del_cliente(msgs)
    if not pendientes:
        return False  # alguien (asesor o bot) ya respondió mientras esperábamos
    ultimo = pendientes[-1]
    mi_id = hist.id_por_wa_id(wa_id)
    if mi_id is not None:
        return int(ultimo["id"]) == mi_id
    return ts_msg is None or float(ultimo.get("ts") or 0) <= float(ts_msg)


def atender(jid: str, *, wa_id: str | None = None, ts_msg: float | None = None, esperar: bool = True) -> dict:
    """
    Devuelve {"status": ..., "respuesta": str|None}. En modo sombra respuesta es None
    siempre (el borrador queda en la bitácora).
    """
    m = modo()
    if m == "off":
        return {"status": "v2_off", "respuesta": None}
    if esperar:
        time.sleep(max(0.0, float(os.getenv("WA_V2_AGRUPAR_S", "6"))))

    msgs = hist.mensajes(jid)
    if not _debe_responder_este(msgs, wa_id, ts_msg):
        return {"status": "v2_agrupado", "respuesta": None}
    silencio = motivo_silencio(jid, msgs)
    if silencio:
        log_json("wa_v2_silencio", jid=jid[-20:], motivo=silencio)
        return {"status": f"v2_{silencio}", "respuesta": None}

    from app.agent.ventas_wa.agente import ejecutar_turno

    try:
        from app.services.wa_jid import formato_display

        display = formato_display(jid)
    except Exception:
        display = jid
    pendientes = hist.pendientes_del_cliente(msgs)
    # Viene del chat web con su código: el pedido armado allá pasa a este chat.
    for x in pendientes:
        codigo = ped_mod.PAT_CODIGO.search(str(x.get("texto") or ""))
        if codigo and ped_mod.adoptar_pedido_web(codigo.group(0), jid):
            log_json("wa_v2_pedido_web_adoptado", jid=jid[-20:], codigo=codigo.group(0).upper())
            break
    res = ejecutar_turno(jid, display, msgs, modo=m)
    ped_mod.registrar_turno(
        jid=jid,
        modo=m,
        entrada=" | ".join(hist.texto_mensaje(x) for x in pendientes)[:2000],
        respuesta=res.respuesta,
        herramientas=",".join(res.herramientas),
        llamadas=res.llamadas,
        tokens_in=res.tokens_in,
        tokens_out=res.tokens_out,
        error=_error_con_supervision(res),
    )
    log_json(
        "wa_v2_turno",
        jid=jid[-20:],
        modo=m,
        llamadas=res.llamadas,
        herramientas=",".join(res.herramientas),
        handoff=(res.handoff or {}).get("tipo"),
        error=res.error,
    )
    if m == "sombra":
        return {"status": "v2_sombra", "respuesta": None}
    return {"status": "v2_ok" if not res.error else "v2_respaldo", "respuesta": res.respuesta}


def atender_en_sombra(jid: str, *, wa_id: str | None, ts_msg: float | None) -> None:
    """Corre v2 en segundo plano sin afectar la respuesta legacy."""
    spawn_thread(atender, args=(jid,), kwargs={"wa_id": wa_id, "ts_msg": ts_msg}, daemon=True)


def _error_con_supervision(res) -> str | None:
    """La bitácora guarda también lo que el supervisor frenó (aunque luego se corrigiera)."""
    partes = [res.error] if res.error else []
    for s in res.supervision:
        partes.append(f"[supervisor {s['nivel']}] " + " | ".join(s["problemas"])[:400])
    return "\n".join(partes) or None


# --- Chat web (burbuja del sitio) ---------------------------------------------------------


def modo_web() -> str:
    m = os.getenv("WEB_AGENTE_V2", "off").strip().lower()
    return m if m in ("off", "sombra", "activo") else "off"


def atender_web(sesion: str, mensaje: str, *, pagina: str = "", modo_forzado: str | None = None) -> dict:
    """
    Un turno del chat web. Devuelve {"respuesta", "acciones"}; en sombra solo deja
    el borrador en la bitácora (la respuesta la da el flujo legacy).
    El historial web vive en ventas_wa(_sombra).db → web_mensajes: nunca se mezcla
    con WhatsApp.
    """
    m = modo_forzado or modo_web()
    if m == "off":
        return {"status": "web_v2_off", "respuesta": None, "acciones": []}
    jid = f"web:{sesion}"
    # En sombra, historial y pedido van a la base de sombra; solo en este hilo.
    with ped_mod.usando_modo("sombra" if m == "sombra" else "activo"):
        ped_mod.guardar_mensaje_web(sesion, "cliente", mensaje, pagina)
        msgs = ped_mod.mensajes_web(sesion)
        from app.agent.ventas_wa.agente import ejecutar_turno

        res = ejecutar_turno(jid, "Visitante de la página web", msgs, modo=m, canal="web", pagina=pagina)
        if res.respuesta:
            ped_mod.guardar_mensaje_web(sesion, "hugo", res.respuesta, pagina)
        ped_mod.registrar_turno(
            jid=jid,
            modo=f"web_{m}",
            entrada=mensaje[:2000],
            respuesta=res.respuesta,
            herramientas=",".join(res.herramientas),
            llamadas=res.llamadas,
            tokens_in=res.tokens_in,
            tokens_out=res.tokens_out,
            error=_error_con_supervision(res),
        )
    log_json("web_v2_turno", sesion=sesion[-12:], modo=m, llamadas=res.llamadas, acciones=len(res.acciones), error=res.error)
    if m == "sombra":
        return {"status": "web_v2_sombra", "respuesta": None, "acciones": []}
    return {"status": "web_v2_ok" if not res.error else "web_v2_respaldo", "respuesta": res.respuesta, "acciones": res.acciones}
