"""
Registro en memoria de acciones del panel React (últimas N líneas).
Captura stdout de hilos de trabajo para mostrar en terminal en tiempo real.
"""

from __future__ import annotations

import sys
import threading
import traceback
from collections import deque
from datetime import datetime

_MAX = 800
_lines: deque[str] = deque(maxlen=_MAX)
_lock = threading.Lock()
_line_count = 0  # Contador monotónico; nunca decrece

# Captura stdout por hilo
_thread_captures: dict[int, "_StreamCapture"] = {}
_captures_lock = threading.Lock()
_original_stdout = sys.stdout
_routing_installed = False
_routing_lock = threading.Lock()

# Hilo activo actual (solo uno a la vez por convención del panel)
_active_job: dict | None = None  # {"name": str, "tid": int}
_active_lock = threading.Lock()


def log_line(message: str) -> None:
    global _line_count
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"{ts} {message}"
    with _lock:
        _lines.append(line)
        _line_count += 1


def get_count() -> int:
    with _lock:
        return _line_count


def get_lines(limit: int = 300) -> list[str]:
    lim = max(1, min(limit, _MAX))
    with _lock:
        return list(_lines)[-lim:]


def get_lines_with_count(limit: int = 300) -> tuple[list[str], int]:
    """Retorna (líneas, count_actual) atómicamente."""
    lim = max(1, min(limit, _MAX))
    with _lock:
        return list(_lines)[-lim:], _line_count


def clear_lines() -> None:
    with _lock:
        _lines.clear()


def get_active_job() -> dict | None:
    with _active_lock:
        return dict(_active_job) if _active_job else None


def cancel_active_job() -> str:
    """
    Inyecta SystemExit en el hilo activo para interrumpirlo.
    Retorna mensaje descriptivo del resultado.
    """
    import ctypes

    with _active_lock:
        job = _active_job
    if not job:
        return "No hay ningún job en ejecución."

    tid = job["tid"]
    name = job["name"]
    res = ctypes.pythonapi.PyThreadState_SetAsyncExc(
        ctypes.c_ulong(tid),
        ctypes.py_object(SystemExit),
    )
    if res == 1:
        log_line(f"⛔ {name} — cancelado por el usuario")
        return f"Job '{name}' cancelado."
    elif res == 0:
        log_line(f"⚠️ No se encontró el hilo de '{name}' (puede haber terminado ya).")
        return f"Hilo de '{name}' no encontrado — puede haber terminado."
    else:
        # res > 1 → múltiples hilos afectados, revertir
        ctypes.pythonapi.PyThreadState_SetAsyncExc(ctypes.c_ulong(tid), None)
        return "Error al cancelar: múltiples hilos afectados (revertido)."


# ── Captura stdout por hilo ──────────────────────────────────────────────────

class _StreamCapture:
    """Captura texto escrito en él, divide en líneas y llama log_line."""

    def __init__(self) -> None:
        self._buf = ""

    def write(self, text: str) -> int:
        self._buf += text
        while "\n" in self._buf:
            line, self._buf = self._buf.split("\n", 1)
            stripped = line.rstrip()
            if stripped:
                log_line(stripped)
        return len(text)

    def flush(self) -> None:
        if self._buf.strip():
            log_line(self._buf.strip())
            self._buf = ""


class _ThreadRoutingStdout:
    """Reemplaza sys.stdout y redirige por hilo a la captura registrada."""

    def write(self, text: str) -> int:
        tid = threading.get_ident()
        with _captures_lock:
            cap = _thread_captures.get(tid)
        if cap is not None:
            return cap.write(text)
        orig = _original_stdout
        if orig is not None:
            try:
                return orig.write(text)
            except Exception:
                return len(text)
        return len(text)

    def flush(self) -> None:
        tid = threading.get_ident()
        with _captures_lock:
            cap = _thread_captures.get(tid)
        if cap is not None:
            cap.flush()
        elif _original_stdout is not None:
            try:
                _original_stdout.flush()
            except Exception:
                pass

    def isatty(self) -> bool:
        return False

    def readable(self) -> bool:
        return False

    def writable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return False

    @property
    def encoding(self) -> str:
        return getattr(_original_stdout, "encoding", "utf-8")

    @property
    def errors(self) -> str:
        return getattr(_original_stdout, "errors", "replace")


def _install_routing_stdout() -> None:
    """Instala el router de stdout una sola vez (idempotente)."""
    global _routing_installed, _original_stdout
    with _routing_lock:
        if _routing_installed:
            return
        if not isinstance(sys.stdout, _ThreadRoutingStdout):
            _original_stdout = sys.stdout
            sys.stdout = _ThreadRoutingStdout()
        _routing_installed = True


# ── Ejecución de jobs con captura ───────────────────────────────────────────

def run_logged_job(job_name: str, fn, args: tuple = ()) -> None:
    """Ejecuta fn(*args) capturando su stdout hacia panel_activity."""
    global _active_job

    _install_routing_stdout()
    log_line(f"▶ {job_name} — inicio")

    cap = _StreamCapture()
    tid = threading.get_ident()
    with _captures_lock:
        _thread_captures[tid] = cap
    with _active_lock:
        _active_job = {"name": job_name, "tid": tid}
    try:
        out = fn(*args)
        cap.flush()
        with _captures_lock:
            _thread_captures.pop(tid, None)
        with _active_lock:
            if _active_job and _active_job.get("tid") == tid:
                _active_job = None

        if isinstance(out, str):
            o = out.strip()
            if o.startswith("❌") or o.startswith("⚠️"):
                log_line(f"✖ {job_name} — {out[:1200]}")
            else:
                log_line(f"✔ {job_name} — {out[:1200]}")
        elif out is None:
            log_line(f"✔ {job_name} — terminado")
        else:
            log_line(f"✔ {job_name} — {repr(out)[:800]}")
    except SystemExit:
        cap.flush()
        with _captures_lock:
            _thread_captures.pop(tid, None)
        with _active_lock:
            if _active_job and _active_job.get("tid") == tid:
                _active_job = None
        log_line(f"⛔ {job_name} — interrumpido")
    except Exception as e:
        cap.flush()
        with _captures_lock:
            _thread_captures.pop(tid, None)
        with _active_lock:
            if _active_job and _active_job.get("tid") == tid:
                _active_job = None
        log_line(f"✖ {job_name} — excepción: {e!r}")
        log_line(traceback.format_exc()[-3500:])
