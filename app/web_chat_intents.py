"""
Intenciones del chat web (burbuja): pago/pedido/cotización → WhatsApp + alerta equipo.

Evita que el LLM aplique el flujo de comprobantes de WhatsApp en la burbuja.
"""

from __future__ import annotations

import json
import os
import re
import time

from app.observability import log_json, spawn_thread

_MODOS_PATH = os.path.join(
    os.path.dirname(__file__), "data", "modos_atencion.json"
)

# Dedup en memoria: evita re-alertar la misma sesión aunque el archivo se
# sobrescriba por una condición de carrera entre threads.
_sesiones_alertadas: dict[str, float] = {}
_DEDUP_SEGUNDOS = int(os.getenv("WEB_ESCALACION_DEDUP_MIN", "60")) * 60

# Pago, pedido, cotización, datos bancarios / link
_PATRONES_PAGO_PEDIDO: list[str] = [
    r"\blink\s+de\s+pago\b",
    r"\benlace\s+de\s+pago\b",
    r"\bdatos\s+de\s+(pago|cuenta|transferencia)\b",
    r"\b(n[uú]mero|numero)\s+de\s+cuenta\b",
    r"\bcuenta\s+bancaria\b",
    r"\bcomo\s+(pago|pagamos|pagarl[oa]|realizo|hago)\b",
    r"\b(concluir|cerrar|finalizar|completar|realizar|hacer)\s+(el\s+)?pago\b",
    r"\bpago\s+de\s+(un\s+)?pedido\b",
    r"\bpagar\s+(el\s+)?pedido\b",
    r"\b(estado|seguimiento)\s+(de\s+)?(mi\s+)?pedido\b",
    r"\bmi\s+pedido\b",
    r"\bcotizaci[oó]n\s+(formal|del\s+pedido|para\s+pagar|cerrada)\b",
    r"\b(enviar|mandar|recibir)\s+.*\bcotizaci[oó]n\b",
    r"\bcotizaci[oó]n\b.*\b(enviar|mandar|recibir|link|pago|pedido)\b",
    r"\b(factura|facturaci[oó]n)\s+(del\s+)?pedido\b",
    r"\bfacturar\s+(el\s+)?pedido\b",
    r"\bno\s+(me\s+)?(han\s+)?(enviado|enviaron|mandaron|lleg[oó])\b",
    r"\bnunca\s+me\s+enviaron\b",
    r"\bwhatsapp\s+no\s+(responde|contesta|atiende)\b",
    r"\b(nequi|daviplata|pse)\b",
    r"\btransferencia\s+bancaria\b",
    r"\bcomprobante\s+de\s+pago\b",
    r"\brealizar\s+el\s+pago\b",
]

_PATRONES_HUMANO: list[str] = [
    r"\b(asesor|agente)\s+humano\b",
    r"\bhablar\s+con\s+(un|una)\s+(asesor|agente|persona)\b",
    r"\bquiero\s+hablar\s+con\b",
    r"\batenci[oó]n\s+humana\b",
    r"\bsoporte\s+humano\b",
    r"\bpersona\s+real\b",
]

_PATRONES_FRUSTRACION: list[str] = [
    r"\bpesima\s+atenci[oó]n\b",
    r"\bp[eé]simo\s+servicio\b",
    r"\bno\s+comprende\b",
    r"\bno\s+entiende\b",
    r"\bno\s+es\s+clar[ao]\b",
    r"\bfrustrad[oa]\b",
    r"\bque\s+rabia\b",
]


def _normalizar(texto: str) -> str:
    t = (texto or "").strip().lower()
    t = re.sub(r"\s+", " ", t)
    return t


def wa_publico() -> tuple[str, str]:
    """(display +57 …, dígitos para wa.me)"""
    raw = (
        os.getenv("MCKENNA_WA_PUBLIC")
        or os.getenv("WEB_WA_NUMBER")
        or "573195183596"
    ).strip()
    digits = re.sub(r"\D", "", raw) or "573195183596"
    if len(digits) == 12 and digits.startswith("57"):
        display = f"+{digits[:2]} {digits[2:5]} {digits[5:8]} {digits[8:]}"
    else:
        display = f"+{digits}"
    return display, digits


def _coincide(texto: str, patrones: list[str]) -> bool:
    low = _normalizar(texto)
    if not low:
        return False
    return any(re.search(p, low, re.IGNORECASE) for p in patrones)


def _es_cotizacion_precios_producto(texto: str) -> bool:
    """Cotizar ingredientes/presentaciones — no escalar a flujo de pago."""
    low = _normalizar(texto)
    if not re.search(r"\bcotiz", low):
        return False
    if re.search(
        r"\b(cada\s+uno|por\s+presentaci|1\s*kg|kilogramo|kilo|lista|productos?|"
        r"ingredientes?|materias?\s+primas?|precio|cu[aá]nto|unidades?|gramos?|"
        r"presentaci[oó]n|evaluar|formulaci[oó]n)\b",
        low,
    ):
        return True
    if re.search(r"\bcotizaci[oó]n\s+de\b", low):
        return True
    return False


def manejar_pregunta_contacto_web(texto: str) -> str | None:
    """Número o enlace de WhatsApp sin respuesta vaga."""
    low = _normalizar(texto)
    if not low:
        return None
    pide_wa = bool(re.search(r"\b(whatsapp|wa\.me)\b", low))
    pide_num = bool(
        re.search(
            r"\b(numero|n[uú]mero|celular|tel[eé]fono|contacto|escribir|escr[ií]banos)\b",
            low,
        )
        or re.search(r"\ba\s+que\b", low)
    )
    if not (pide_wa or (pide_num and "whatsapp" in low)):
        if not re.search(r"\b(a\s+que|cu[aá]l)\s+(numero|n[uú]mero|whatsapp)\b", low):
            return None
    display, digits = wa_publico()
    return (
        f"Veci, nuestro WhatsApp de ventas es **{display}**:\n"
        f"https://wa.me/{digits}\n\n"
        "Ahí retoman cotizaciones formales, pedidos, comprobantes y envío de documentos "
        "con su historial. En esta burbuja puede consultar **precios, disponibilidad** y "
        "enlaces a COA/ficha cuando estén en archivo."
    )


def clasificar_escalacion_web(texto: str, historial_texto: str = "") -> str | None:
    """
    Retorna: 'humano' | 'pago_pedido' | 'frustracion_pago' | None
    """
    low = _normalizar(texto)
    ctx = _normalizar(historial_texto)
    if _es_cotizacion_precios_producto(low):
        return None
    if _coincide(low, _PATRONES_HUMANO):
        return "humano"
    if _coincide(low, _PATRONES_PAGO_PEDIDO):
        return "pago_pedido"
    if _coincide(low, _PATRONES_FRUSTRACION) and (
        _coincide(low, _PATRONES_PAGO_PEDIDO) or _coincide(ctx, _PATRONES_PAGO_PEDIDO)
    ):
        return "frustracion_pago"
    if re.search(r"\bcotizaci[oó]n\b", low) and re.search(
        r"\b(enviar|mandar|recibir|link|datos|pago|pedido)\b", low
    ):
        return "pago_pedido"
    return None


def activar_pausa_web(session_id: str, razon: str, ultimo_mensaje: str) -> None:
    try:
        try:
            with open(_MODOS_PATH, encoding="utf-8") as f:
                data = json.load(f)
        except FileNotFoundError:
            data = {}
        data.setdefault("numeros_en_humano", [])
        data.setdefault("timestamps", {})
        data.setdefault("bot_auto_pausados", {})
        sid = (session_id or "").strip()
        if sid and sid not in data["numeros_en_humano"]:
            data["numeros_en_humano"].append(sid)
        data["timestamps"][sid] = time.time()
        data["bot_auto_pausados"][sid] = {
            "timestamp": time.time(),
            "razon": razon[:120],
            "ultimo_mensaje": (ultimo_mensaje or "")[:500],
        }
        with open(_MODOS_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except Exception as e:
        log_json("web_chat_pausa_error", error=str(e)[:200])


def sesion_web_en_pausa(session_id: str) -> dict | None:
    if not (session_id or "").strip().startswith("web-"):
        return None
    try:
        with open(_MODOS_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return None
    pausas = data.get("bot_auto_pausados") or {}
    return pausas.get(session_id)


def mensaje_escalacion_pago_pedido() -> str:
    display, digits = wa_publico()
    return (
        "Veci, para **cerrar un pago**, **link de pago**, **facturación** o **seguimiento de pedido** "
        "el canal indicado es **WhatsApp** (queda su hilo con un asesor).\n\n"
        "En esta burbuja le ayudamos con **precios, disponibilidad, uso en formulación** y "
        "**enlaces a COA/ficha técnica** cuando están en archivo.\n\n"
        f"Escríbanos al {display}:\n"
        f"https://wa.me/{digits}\n\n"
        "Si ya pagó, envíe el comprobante **por ese WhatsApp** (no por aquí), "
        "con su nombre y la referencia del pedido. En breve le responden 🙏"
    )


def mensaje_escalacion_humano() -> str:
    return (
        "Listo veci 🙏 A continuación sigue la conversación con un asesor humano. "
        "Para cotización o pedido, continúe también por WhatsApp para que quede su hilo atado a su línea."
    )


def mensaje_sesion_ya_escalada() -> str:
    display, digits = wa_publico()
    return (
        f"Veci, su caso ya está en manos del equipo. Por favor continúe por WhatsApp al {display} "
        f"(https://wa.me/{digits}) para pago, cotización o seguimiento. "
        "En breve le responden 🙏"
    )


def _jid_escalacion_web() -> str:
    """Grupo de destino para alertas de escalación del chat web.

    Usa GRUPO_ESCALACION_WEB_WA si está configurado; si no, cae en
    GRUPO_CONTABILIDAD_WA (equipo de ventas). NO usa Guias_Envios.
    """
    explicit = os.getenv("GRUPO_ESCALACION_WEB_WA", "").strip()
    if explicit:
        return explicit
    return os.getenv("GRUPO_CONTABILIDAD_WA", "120363407538342427@g.us").strip()


def alertar_grupo_escalacion(
    *,
    session_id: str,
    user_message: str,
    tipo: str,
    page_url: str = "",
) -> None:
    sid = (session_id or "").strip()[:40]
    # Dedup en memoria: si ya alertamos esta sesión hace < DEDUP_SEGUNDOS, saltar
    ahora = time.time()
    ultima = _sesiones_alertadas.get(sid, 0.0)
    if ahora - ultima < _DEDUP_SEGUNDOS:
        return
    _sesiones_alertadas[sid] = ahora

    def _enviar():
        try:
            from app.utils import enviar_whatsapp_reporte

            tipo_txt = {
                "pago_pedido": "Pago / pedido / cotización",
                "humano": "Solicita asesor humano",
                "frustracion_pago": "Cliente frustrado (pago/pedido)",
            }.get(tipo, tipo)
            texto = (
                f"🚨 *CHAT WEB — escalación*\n"
                f"Tipo: {tipo_txt}\n"
                f"Sesión: `{sid}`\n"
                f"Página: {(page_url or '—')[:120]}\n\n"
                f"Cliente: {(user_message or '')[:700]}\n\n"
                "_Atender por WhatsApp; la burbuja quedó en pausa._"
            )
            enviar_whatsapp_reporte(texto, numero_destino=_jid_escalacion_web())
        except Exception as e:
            log_json("web_chat_escalacion_wa_error", error=str(e)[:200])

    spawn_thread(_enviar, daemon=True)


def manejar_escalacion_web(
    *,
    session_id: str,
    user_message: str,
    historial: list | None = None,
    page_url: str = "",
) -> str | None:
    """
    Si aplica escalación web, devuelve texto para el cliente y pausa el bot.
    Si no aplica, retorna None (flujo normal).
    """
    if not (session_id or "").strip().startswith("web-"):
        return None

    pausa = sesion_web_en_pausa(session_id)
    if pausa:
        return mensaje_sesion_ya_escalada()

    hist_txt = ""
    if historial:
        for m in historial[-6:]:
            c = m.get("content", "")
            if isinstance(c, str):
                hist_txt += " " + c
            elif isinstance(c, list):
                for b in c:
                    if isinstance(b, dict) and b.get("type") == "text":
                        hist_txt += " " + str(b.get("text", ""))

    tipo = clasificar_escalacion_web(user_message, hist_txt)
    if not tipo:
        return None

    if tipo == "humano":
        msg = mensaje_escalacion_humano()
        razon = "cliente solicitó humano (web)"
    else:
        msg = mensaje_escalacion_pago_pedido()
        razon = f"web_{tipo}"

    activar_pausa_web(session_id, razon, user_message)
    alertar_grupo_escalacion(
        session_id=session_id,
        user_message=user_message,
        tipo=tipo if tipo != "humano" else "humano",
        page_url=page_url,
    )
    log_json(
        "web_chat_escalado",
        session_id=session_id[:40],
        tipo=tipo,
        pregunta_chars=len(user_message or ""),
    )
    return msg
