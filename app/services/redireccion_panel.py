# -*- coding: utf-8 -*-
"""Redirigir al panel, sin bloquear WhatsApp.

Lo que alguien escribe desde su teléfono no se puede frenar por software. Lo que sí se
puede es contestar en el mismo grupo, una vez, con el enlace a donde eso se registra
ahora (recepción de mercancía, tareas de la Agenda…). Reglas y textos en
`app/data/redireccion_panel.json` (lector: este módulo; escritor: una persona a mano).
Con `"activo": false` no escribe nada.

Freno: un aviso por (regla, grupo) cada `throttle_min` minutos, en memoria — tras un
reinicio puede repetirse uno, lo que es aceptable. Sin LLM.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
import unicodedata

_RUTA = os.path.join(os.path.dirname(__file__), "..", "data", "redireccion_panel.json")
_ultimo: dict[tuple[str, str], float] = {}
_lock = threading.Lock()


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFD", (s or "").lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def _config() -> dict:
    try:
        with open(_RUTA, encoding="utf-8") as fh:
            return json.load(fh) or {}
    except Exception:
        return {}


def aviso_para(jid: str, texto: str, *, ahora: float | None = None, config: dict | None = None) -> str | None:
    """El aviso que corresponde a este mensaje de grupo, o None (no aplica / frenado / apagado)."""
    cfg = config if config is not None else _config()
    if not cfg.get("activo") or "@g.us" not in (jid or ""):
        return None
    t = _norm(texto)
    if not t.strip():
        return None
    ahora = ahora if ahora is not None else time.time()
    ventana = float(cfg.get("throttle_min") or 120) * 60
    base = str(cfg.get("url_base") or "").rstrip("/")
    for regla in cfg.get("reglas") or []:
        try:
            if not re.search(regla.get("patron") or r"$^", t):
                continue
        except re.error:
            continue
        clave = (str(regla.get("id")), jid)
        with _lock:
            previo = _ultimo.get(clave)
            if previo is not None and ahora - previo < ventana:
                return None
            _ultimo[clave] = ahora
        url = f"{base}?panel={regla.get('panel')}" if base and regla.get("panel") else base
        return str(regla.get("texto") or "").replace("{url}", url).strip() or None
    return None


def procesar_mensaje_grupo(jid: str, texto: str) -> bool:
    """Si aplica, responde en el grupo (en segundo plano). True si se programó un aviso."""
    aviso = aviso_para(jid, texto)
    if not aviso:
        return False

    def _run():
        try:
            from app.utils import enviar_whatsapp_reporte

            enviar_whatsapp_reporte(aviso, numero_destino=jid)
        except Exception as e:
            print(f"[redireccion_panel] {e}")

    threading.Thread(target=_run, name="redireccion-panel", daemon=True).start()
    return True
