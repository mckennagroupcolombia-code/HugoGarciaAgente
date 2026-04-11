"""
Observabilidad ligera: request_id por petición (contextvar) y logs JSON en una línea.

Uso en producción:
  - Opcional: cabecera X-Request-ID en clientes; si no viene, se genera UUID.
  - Hilos en segundo plano: usar spawn_thread() para propagar request_id al worker.

Variables de entorno (documentadas en .env.example):
  - AGENTE_LOG_JSON=1  → logs a stderr en una línea JSON (además de prints existentes).
"""

from __future__ import annotations

import json
import logging
import os
import threading
import uuid
from contextvars import ContextVar
from typing import Any, Callable

_request_id_ctx: ContextVar[str] = ContextVar("mckenna_request_id", default="")


def get_request_id() -> str:
    return _request_id_ctx.get() or ""


def set_request_id(rid: str) -> None:
    _request_id_ctx.set(rid or "")


def new_request_id() -> str:
    rid = str(uuid.uuid4())
    set_request_id(rid)
    return rid


def log_json(event: str, level: int = logging.INFO, **fields: Any) -> None:
    """Un evento por línea; apto para agregadores (CloudWatch, Loki, etc.)."""
    payload = {"event": event, "request_id": get_request_id(), **fields}
    line = json.dumps(payload, ensure_ascii=False, default=str)
    if os.getenv("AGENTE_LOG_JSON", "").strip().lower() in ("1", "true", "yes"):
        print(line, flush=True)
    logging.getLogger("mckenna.agent").log(level, line)


def bind_flask_request(flask_request) -> str:
    """Asigna request_id en g y contextvar. Devuelve el id usado."""
    from flask import g

    rid = (flask_request.headers.get("X-Request-ID") or "").strip()
    if not rid:
        rid = str(uuid.uuid4())
    g.request_id = rid
    set_request_id(rid)
    return rid


def spawn_thread(
    target: Callable,
    args: tuple = (),
    kwargs: dict | None = None,
    *,
    daemon: bool = False,
    request_id: str | None = None,
) -> threading.Thread:
    """
    Como threading.Thread(...).start() pero propaga request_id al hilo (Flask o explícito).
    """
    try:
        from flask import g, has_request_context
    except ImportError:
        has_request_context = lambda: False  # noqa: E731
        g = None

    kwargs = dict(kwargs or {})
    rid = request_id
    if rid is None and has_request_context() and g is not None:
        rid = getattr(g, "request_id", None) or ""
    rid = rid or ""

    def _runner() -> Any:
        token = None
        try:
            if rid:
                token = _request_id_ctx.set(rid)
            return target(*args, **kwargs)
        finally:
            if token is not None:
                _request_id_ctx.reset(token)

    t = threading.Thread(target=_runner, daemon=daemon)
    t.start()
    return t
