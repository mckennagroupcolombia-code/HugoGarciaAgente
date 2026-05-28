"""Notificaciones al grupo WhatsApp de pedidos web por interacciones del chat burbuja."""

from __future__ import annotations

import json
import os
import re
import threading
from datetime import datetime
from urllib.parse import urlparse

from app.observability import log_json, spawn_thread
from app.utils import enviar_whatsapp_reporte


_CONFIG_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "web_chat_notify.json")
_CONFIG_LOCK = threading.Lock()


def _coerce_bool(value: object, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    s = str(value).strip().lower()
    if s in ("1", "true", "yes", "on"):
        return True
    if s in ("0", "false", "no", "off"):
        return False
    return default


def _env_default_enabled() -> bool:
    return os.getenv("AGENTE_WEB_CHAT_NOTIFY_WA", "1").strip() not in (
        "0",
        "false",
        "no",
        "off",
    )


def get_web_chat_notify_state() -> dict:
    """
    Lee el estado persistido (si existe) o cae al default por env.
    Retorna dict: {enabled: bool, source: str}
    """
    default_enabled = _env_default_enabled()
    with _CONFIG_LOCK:
        try:
            with open(_CONFIG_PATH, encoding="utf-8") as f:
                data = json.load(f) or {}
        except Exception:
            data = {}
    enabled = _coerce_bool(data.get("enabled"), default_enabled)
    source = "config" if "enabled" in (data or {}) else "env"
    return {"enabled": enabled, "source": source}


def set_web_chat_notify_enabled(*, enabled: bool, updated_by: str = "panel") -> dict:
    state = {
        "enabled": bool(enabled),
        "updated_at": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        "updated_by": (updated_by or "panel")[:64],
    }
    with _CONFIG_LOCK:
        os.makedirs(os.path.dirname(_CONFIG_PATH), exist_ok=True)
        with open(_CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2, ensure_ascii=False)
    log_json(
        "web_chat_notify_config_set",
        enabled=state["enabled"],
        updated_by=state["updated_by"],
    )
    # Siempre reporta la fuente como config tras set.
    return {"enabled": state["enabled"], "source": "config"}


def _notify_enabled() -> bool:
    return bool(get_web_chat_notify_state().get("enabled"))


def jid_grupo_pedidos_web_wa() -> str:
    """Guias_Envios pagina web — mismo JID que comandos facturar/envío."""
    raw = os.getenv("GRUPOS_WEB_PEDIDO_CMD_WA", "").strip()
    if raw:
        for part in raw.split(","):
            j = part.strip()
            if j:
                return j
    return (
        os.getenv("GRUPO_PEDIDOS_WEB_WA", "120363391665421264@g.us").strip()
        or "120363391665421264@g.us"
    )


def _trunc(texto: str, max_len: int) -> str:
    t = (texto or "").strip()
    if len(t) <= max_len:
        return t
    return t[: max_len - 1].rstrip() + "…"


def _etiqueta_origen(source: str, upstream_error: str) -> str:
    src = (source or "agent").strip().lower()
    if src == "catalog_fallback":
        return "Catálogo (fallback)"
    if src == "offline":
        return "Sin conexión IA"
    if upstream_error:
        return f"Agente ({upstream_error[:40]})"
    return "Agente IA"


def _pagina_corta(page_url: str) -> str:
    u = (page_url or "").strip()
    if not u:
        return "—"
    try:
        p = urlparse(u)
        path = (p.path or "/").strip() or "/"
        if p.netloc:
            return f"{p.netloc}{path}"[:120]
    except Exception:
        pass
    return _trunc(u, 120)


def formatear_mensaje_grupo_web_chat(
    *,
    session_id: str,
    user_message: str,
    agent_reply: str,
    source: str = "agent",
    page_url: str = "",
    upstream_error: str = "",
) -> str:
    sid = (session_id or "").strip()
    sid_corto = sid[-12:] if len(sid) > 12 else sid or "—"
    ahora = datetime.now().strftime("%d/%m/%Y %H:%M")
    origen = _etiqueta_origen(source, upstream_error)

    lineas = [
        "💬 *CHAT WEB* — burbuja tienda",
        f"🕐 {ahora} · {origen}",
        "",
        "👤 *Cliente:*",
        _trunc(user_message, 900),
        "",
        "🤖 *Hugo:*",
        _trunc(agent_reply, 1200),
        "",
        f"📍 {_pagina_corta(page_url)}",
        f"🔗 Sesión: …{sid_corto}",
        "",
        "_Seguimiento en panel → Chat web_",
    ]
    return "\n".join(lineas)


def notificar_interaccion_web_chat_grupo(
    *,
    session_id: str,
    user_message: str,
    agent_reply: str,
    source: str = "agent",
    page_url: str = "",
    upstream_error: str = "",
    async_send: bool = True,
) -> bool:
    """
    Envía al grupo GRUPO_PEDIDOS_WEB_WA (Guias_Envios pagina web).
    Por defecto en hilo daemon para no bloquear /chat.
    """
    if not _notify_enabled():
        return False
    msg = (user_message or "").strip()
    reply = (agent_reply or "").strip()
    if not msg and not reply:
        return False

    texto = formatear_mensaje_grupo_web_chat(
        session_id=session_id,
        user_message=msg,
        agent_reply=reply,
        source=source,
        page_url=page_url,
        upstream_error=upstream_error,
    )
    destino = jid_grupo_pedidos_web_wa()

    def _enviar():
        ok = enviar_whatsapp_reporte(texto, numero_destino=destino)
        log_json(
            "web_chat_notify_wa",
            ok=ok,
            destino_preview=destino[:24],
            session_preview=session_id[:24],
            source=source,
        )

    if async_send:
        spawn_thread(_enviar, daemon=True)
        return True
    return bool(_enviar())
