"""
Registro en memoria de acciones disparadas desde el panel React (últimas N líneas).
Sirve para GET /api/panel/logs y depuración sin depender solo de journalctl.
"""

from __future__ import annotations

import threading
import traceback
from collections import deque
from datetime import datetime

_MAX = 800
_lines: deque[str] = deque(maxlen=_MAX)
_lock = threading.Lock()


def log_line(message: str) -> None:
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"{ts} {message}"
    with _lock:
        _lines.append(line)


def get_lines(limit: int = 300) -> list[str]:
    lim = max(1, min(limit, _MAX))
    with _lock:
        return list(_lines)[-lim:]


def clear_lines() -> None:
    with _lock:
        _lines.clear()


def run_logged_job(job_name: str, fn, args: tuple = ()) -> None:
    """Ejecuta fn(*args) en contexto de log (para usar dentro de spawn_thread)."""
    log_line(f"▶ {job_name} — inicio")
    try:
        out = fn(*args)
        if isinstance(out, str):
            o = out.strip()
            if o.startswith("❌") or o.startswith("⚠️"):
                log_line(f"✖ {job_name} — {out[:1200]}")
            else:
                log_line(f"✔ {job_name} — {out[:1200]}")
        elif out is None:
            log_line(f"✔ {job_name} — terminado (sin retorno)")
        else:
            log_line(f"✔ {job_name} — {repr(out)[:800]}")
    except Exception as e:
        log_line(f"✖ {job_name} — excepción: {e!r}")
        log_line(traceback.format_exc()[-3500:])
