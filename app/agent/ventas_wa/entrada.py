"""
Punto de entrada del agente de ventas WA desde la ruta /whatsapp.

Bandera WA_AGENTE_V2:
  off     (default) no hace nada; responde el flujo legacy.
  sombra  el flujo legacy sigue respondiendo; v2 corre en segundo plano y deja
          su borrador en ventas_wa.db (tabla turnos) SIN enviar nada al cliente
          ni al grupo. Gasta tokens: solo con autorización (regla llm_budget).
  activo  v2 responde al cliente y avisa al grupo de ventas.

Guardas propias (además de las de routes.py: grupos, silenciados, bot global):
  1. Turnos con el asesor (decisión del negocio, 29-sep-2026): si un asesor
     escribió en ese chat hace menos de WA_V2_PAUSA_HUMANO_HORAS, el asesor tiene
     la conversación. En horario del equipo el bot espera WA_V2_ESPERA_ASESOR_MIN
     (10) y, si el asesor no respondió, retoma SOLO si lo amerita
     (_amerita_retomar + herramienta omitir_turno) y siguiendo el hilo. Fuera de
     horario el bot tiene el control: solo espera WA_V2_ESPERA_ASESOR_FUERA_MIN
     (3) si el asesor acaba de escribir.
  2. Pausa manual por chat (tabla pausas).
  3. Agrupación: espera WA_V2_AGRUPAR_S segundos y responde una sola vez a la
     ráfaga de mensajes; las peticiones de los mensajes anteriores se retiran.
  4. Anti-pisada: si el asesor escribió mientras el modelo pensaba, la respuesta
     se descarta.
  5. Un turno a la vez por chat: lo que el cliente escribe mientras el modelo
     piensa se atiende en el turno siguiente (_reordenar_rezagados).
"""

from __future__ import annotations

import os
import re
import threading
import time

from app.agent.ventas_wa import historial as hist
from app.agent.ventas_wa import pedido as ped_mod
from app.observability import log_json, spawn_thread

# Auditoría 7-oct-2026: un mensaje que llegaba mientras el modelo pensaba (10-25 s)
# se perdía si su hilo despertaba después de guardada la respuesta (quedaba ANTES de
# ella y parecía respondido: «¿el pago es contra entrega?», «¿todavía hacen domicilio?»)
# o se respondía dos veces si despertaba antes (dos turnos en paralelo, turnos 80/81).
_locks_guard = threading.Lock()
_locks: dict[str, threading.Lock] = {}
_consumido: dict[str, float] = {}  # jid -> ts del último mensaje del cliente que entró a un turno
_espera_envio: dict[str, bool] = {}  # jid -> el turno anterior dejó una respuesta por enviar
_VENTANA_REZAGO_S = 600


def _lock_de(jid: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(jid, threading.Lock())


def _reordenar_rezagados(jid: str, msgs: list[dict]) -> list[dict]:
    """
    Mensajes del cliente posteriores al último que entró a un turno pero anteriores a la
    respuesta de Hugo: esa respuesta no los vio. Si después solo habló el bot, se mueven
    al final para que sigan pendientes. Si habló un asesor, ya los atendió él.
    """
    corte = _consumido.get(jid)
    if not corte or time.time() - corte > _VENTANA_REZAGO_S:
        return msgs
    pendientes = {id(m) for m in hist.pendientes_del_cliente(msgs)}
    rezagados = [
        m
        for i, m in enumerate(msgs)
        if hist._rol(m) == "cliente"
        and float(m.get("ts") or 0) > corte
        and id(m) not in pendientes
        and not any(hist._rol(x) == "asesor" for x in msgs[i + 1 :])
    ]
    if not rezagados:
        return msgs
    ids = {id(m) for m in rezagados}
    resto = [m for m in msgs if id(m) not in ids]
    # Justo después de la última salida: quedan antes de los pendientes reales.
    corte_idx = max((i for i, m in enumerate(resto) if hist._rol(m) != "cliente"), default=-1) + 1
    return resto[:corte_idx] + rezagados + resto[corte_idx:]


def _esperar_envio_previo(jid: str, timeout_s: float = 15.0) -> None:
    """La respuesta del turno anterior la guarda el puente después de enviarla: se espera."""
    if not _espera_envio.pop(jid, False):
        return
    corte = _consumido.get(jid, 0.0)
    limite = time.time() + timeout_s
    while time.time() < limite:
        if any(hist._rol(m) == "hugo" and float(m.get("ts") or 0) > corte for m in hist.mensajes(jid, limite=20)):
            return
        time.sleep(1.0)


def modo() -> str:
    m = os.getenv("WA_AGENTE_V2", "off").strip().lower()
    return m if m in ("off", "sombra", "activo") else "off"


def _env_float(nombre: str, default: float) -> float:
    try:
        return float(os.getenv(nombre, str(default)))
    except ValueError:
        return default


def _pausa_humano_horas() -> float:
    return _env_float("WA_V2_PAUSA_HUMANO_HORAS", 12)


def en_horario_equipo() -> bool:
    from app.agent.ventas_wa.agente import en_horario_equipo as _en

    return _en()


def evaluar_silencio(jid: str, msgs: list[dict], *, retomando: bool = False) -> tuple[str | None, int]:
    """
    (motivo, minutos_de_espera). motivo None = responder ahora. "asesor_activo" con
    minutos > 0 = programar un reintento; "pausa_manual" = no responder.
    """
    from app.services.wa_jid import jids_relacionados

    if ped_mod.pausa_vigente(jids_relacionados(jid) or {jid}):
        return "pausa_manual", 0
    if retomando:
        return None, 0
    ultimo_asesor = hist.ultimo_mensaje_asesor(msgs)
    if not ultimo_asesor:
        return None, 0
    hace = time.time() - ultimo_asesor
    if en_horario_equipo():
        if hace < _pausa_humano_horas() * 3600:
            return "asesor_activo", int(_env_float("WA_V2_ESPERA_ASESOR_MIN", 10))
        return None, 0
    espera_fuera = _env_float("WA_V2_ESPERA_ASESOR_FUERA_MIN", 3)
    if hace < espera_fuera * 60:
        return "asesor_activo", int(espera_fuera)
    return None, 0


def motivo_silencio(jid: str, msgs: list[dict]) -> str | None:
    return evaluar_silencio(jid, msgs)[0]


# --- ¿Amerita retomar? (sin IA) --------------------------------------------------------

_PAT_CORTESIA = re.compile(
    r"^\W*(?:(?:muchas\s+)?gracias|ok(?:ay|ey)?|vale|listo|dale|perfecto|de acuerdo|bueno|s[ií]|no|"
    r"buen[oa]s?(?:\s+(?:d[ií]as|tardes|noches))?|hasta luego|chao|adi[oó]s|un abrazo|bendiciones|👍|🙏|👌|😊)"
    r"[\s\W]*$",
    re.I,
)
_PAT_ASESOR_LO_LLEVA = re.compile(
    r"\b(gu[ií]a|factura|proforma|valid[oa]|pago confirmado|un momento|te confirmo|ya te (env[ií]o|comparto)|"
    r"m[aá]s tarde|ma[ñn]ana te|en un rato|ya (reviso|miro|verifico))\b",
    re.I,
)
_PAT_PIDE_PERSONA = re.compile(r"\b(jenn?if+er|asesor(a)?|humano|una persona|alguien)\b", re.I)


def _amerita_retomar(msgs: list[dict]) -> tuple[bool, str]:
    """Puerta determinista antes de gastar un turno del modelo al retomar un chat del asesor."""
    pendientes = hist.pendientes_del_cliente(msgs)
    if not pendientes:
        return False, "sin pendientes"
    textos = [str(m.get("texto") or "").strip() for m in pendientes]
    con_texto = [t for t in textos if t and t != "[adjunto]"]
    if not con_texto:
        return False, "solo adjuntos (los revisa el equipo)"
    if all(_PAT_CORTESIA.match(t) for t in con_texto):
        return False, "solo cortesía o cierre"
    if any(_PAT_PIDE_PERSONA.search(t) for t in con_texto):
        return False, "el cliente pide a una persona"
    ultimo_asesor = next((m for m in reversed(msgs) if hist._rol(m) == "asesor"), None)
    if ultimo_asesor and _PAT_ASESOR_LO_LLEVA.search(str(ultimo_asesor.get("texto") or "")):
        return False, "el asesor dejó algo pendiente de su parte"
    return True, ""


def _avisar_espera(jid: str, msgs: list[dict], minutos: int, motivo: str, modo_actual: str) -> None:
    """DM al asesor: el cliente lleva N min esperando (máx. uno cada 2 h por chat)."""
    if modo_actual != "activo" or ped_mod.aviso_espera_reciente(jid, horas=2):
        return
    pendientes = hist.pendientes_del_cliente(msgs)
    ultimo = hist.texto_mensaje(pendientes[-1]) if pendientes else ""
    try:
        from app.services.wa_jid import formato_display

        display = formato_display(jid)
    except Exception:
        display = jid
    texto = (
        f"⏰ *Cliente esperando hace {minutos} min*\n👤 {display}\n💬 \"{ultimo[:200]}\"\n"
        f"Hugo no intervino ({motivo}). Es tuyo: respóndele por WhatsApp."
    )
    try:
        from app.agent.ventas_wa.herramientas import enviar_alerta_asesor

        if enviar_alerta_asesor(texto):
            ped_mod.marcar_aviso_espera(jid)
    except Exception as e:
        print(f"[ventas_wa] no se pudo avisar la espera: {e}")


def _registrar_estado(jid: str, m: str, msgs: list[dict], estado: str, motivo: str = "", res=None) -> None:
    pendientes = hist.pendientes_del_cliente(msgs)
    ped_mod.registrar_turno(
        jid=jid,
        modo=m,
        entrada=" | ".join(hist.texto_mensaje(x) for x in pendientes)[:2000],
        respuesta=getattr(res, "respuesta", None),
        herramientas=",".join(getattr(res, "herramientas", []) or []),
        llamadas=getattr(res, "llamadas", 0) or 0,
        tokens_in=getattr(res, "tokens_in", 0) or 0,
        tokens_out=getattr(res, "tokens_out", 0) or 0,
        error=_error_con_supervision(res) if res is not None else None,
        estado=estado,
        motivo=(motivo or "")[:300] or None,
    )


def _registrar_interaccion(jid: str, res, msgs: list[dict]) -> None:
    try:
        from app.services import clientes_wa

        pendientes = hist.pendientes_del_cliente(msgs)
        entrada = " | ".join(hist.texto_mensaje(x) for x in pendientes)
        handoff = (res.handoff or {}).get("tipo") if res.handoff else None
        productos = []
        for ev in res.herramientas:
            if ev == "actualizar_pedido":
                p = ped_mod.activo(jid, crear=False)
                productos = [i.ref for i in p.items] if p else []
        clientes_wa.registrar_interaccion(
            jid,
            canal="whatsapp",
            intencion=clientes_wa.intencion_de_turno(res.herramientas, handoff, entrada),
            productos=productos,
            handoff=handoff,
            atendido_por="bot_v2",
            detalle=entrada[:300],
        )
    except Exception as e:
        print(f"[ventas_wa] clientes_wa interacción: {e}")


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


def atender(
    jid: str,
    *,
    wa_id: str | None = None,
    ts_msg: float | None = None,
    esperar: bool = True,
    retomando_min: int | None = None,
) -> dict:
    """
    Devuelve {"status": ..., "respuesta": str|None}. En modo sombra respuesta es None
    siempre (el borrador queda en la bitácora). Con retomando_min el turno viene del
    reintento diferido: el asesor no respondió en ese tiempo.
    """
    m = modo()
    if m == "off":
        return {"status": "v2_off", "respuesta": None}
    if esperar:
        time.sleep(max(0.0, float(os.getenv("WA_V2_AGRUPAR_S", "6"))))

    # El puente Node corta la petición a los 120 s: la espera por el turno anterior
    # tiene que dejar tiempo para el propio (si se agota, lo cubre el auditor de
    # «clientes sin respuesta»).
    lk = _lock_de(jid)
    if not lk.acquire(timeout=60):
        log_json("wa_v2_turno_ocupado", jid=jid[-20:])
        return {"status": "v2_ocupado", "respuesta": None}
    try:
        _esperar_envio_previo(jid)
        return _atender_turno(jid, m, wa_id=wa_id, ts_msg=ts_msg, retomando_min=retomando_min)
    finally:
        lk.release()


def _atender_turno(jid: str, m: str, *, wa_id: str | None, ts_msg: float | None, retomando_min: int | None) -> dict:
    msgs = _reordenar_rezagados(jid, hist.mensajes(jid))
    if not _debe_responder_este(msgs, wa_id, ts_msg):
        return {"status": "v2_agrupado", "respuesta": None}
    retomando = retomando_min is not None
    silencio, espera_min = evaluar_silencio(jid, msgs, retomando=retomando)
    if silencio == "asesor_activo" and espera_min > 0:
        log_json("wa_v2_silencio", jid=jid[-20:], motivo=silencio, reintento_min=espera_min)
        _registrar_estado(jid, m, msgs, "diferido", f"asesor activo; reintento en {espera_min} min")
        spawn_thread(_atender_diferido, args=(jid, wa_id, ts_msg, espera_min), daemon=True)
        return {"status": "v2_asesor_activo", "respuesta": None}
    if silencio:
        log_json("wa_v2_silencio", jid=jid[-20:], motivo=silencio)
        return {"status": f"v2_{silencio}", "respuesta": None}
    if retomando:
        ok, motivo = _amerita_retomar(msgs)
        if not ok:
            log_json("wa_v2_sin_merito", jid=jid[-20:], motivo=motivo)
            _registrar_estado(jid, m, msgs, "sin_merito", motivo)
            _avisar_espera(jid, msgs, retomando_min, motivo, m)
            return {"status": "v2_sin_merito", "respuesta": None}

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
    if pendientes:
        _consumido[jid] = max(float(x.get("ts") or 0) for x in pendientes)
    t0 = time.time()
    res = ejecutar_turno(jid, display, msgs, modo=m, retomando_min=retomando_min)

    estado, motivo = "respondido", ""
    if res.omitido:
        estado, motivo = "omitido", res.omitido
    elif m == "activo":
        # Anti-pisada: si el asesor escribió mientras el modelo pensaba, no se envía.
        ultimo_asesor = hist.ultimo_mensaje_asesor(hist.mensajes(jid, limite=20))
        if ultimo_asesor and ultimo_asesor > t0:
            estado, motivo = "descartado_asesor", "el asesor escribió durante el turno"
            log_json("wa_v2_descartado_asesor", jid=jid[-20:])
    if m == "sombra":
        estado = "sombra" if estado == "respondido" else estado
    _registrar_estado(jid, m, msgs, estado, motivo, res)
    log_json(
        "wa_v2_turno",
        jid=jid[-20:],
        modo=m,
        estado=estado,
        retomando=retomando,
        llamadas=res.llamadas,
        herramientas=",".join(res.herramientas),
        handoff=(res.handoff or {}).get("tipo"),
        error=res.error,
    )
    if m == "activo":
        _registrar_interaccion(jid, res, msgs)
    if estado == "omitido" and retomando:
        _avisar_espera(jid, msgs, retomando_min, motivo, m)
    if m == "sombra":
        return {"status": "v2_sombra", "respuesta": None}
    if estado in ("omitido", "descartado_asesor"):
        return {"status": f"v2_{estado}", "respuesta": None}
    _espera_envio[jid] = bool(res.respuesta)
    return {"status": "v2_ok" if not res.error else "v2_respaldo", "respuesta": res.respuesta}


def _atender_diferido(jid: str, wa_id: str | None, ts_msg: float | None, minutos: int) -> None:
    """Reintento cuando el asesor tenía el chat: si sigue sin responder, el bot evalúa retomar."""
    time.sleep(max(1.0, minutos * 60))
    try:
        r = atender(jid, wa_id=wa_id, ts_msg=ts_msg, esperar=False, retomando_min=minutos)
        log_json("wa_v2_reintento", jid=jid[-20:], status=r.get("status"))
        if r.get("respuesta") and modo() == "activo":
            from app.routes import _normalizar_respuesta_cliente
            from app.services import wa_chats
            from app.utils import enviar_whatsapp_reporte

            texto = _normalizar_respuesta_cliente(r["respuesta"])
            # Se registra como salida del bot ANTES de enviar: el eco del puente (fromMe)
            # llega como "humano" y wa_chats.guardar lo empareja con este registro en vez
            # de crear uno humano, que haría callar al bot 12 h en este chat.
            wa_chats.guardar(jid, "salida", texto, enviado_por="bot")
            enviar_whatsapp_reporte(texto, numero_destino=jid)
    except Exception as e:
        log_json("wa_v2_reintento_error", jid=jid[-20:], error=str(e)[:200])


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
