"""
Registro persistente de problemas en notificaciones MeLi → WhatsApp.

Append JSONL en app/data/webhook_meli_incidents.jsonl (una línea = un evento).
Sirve para contar cuántas veces falló el mismo caso sin depender de journalctl
ni del historial del chat con la IA.
"""

from __future__ import annotations

import json
import os
import threading
import time
from typing import Any

_APP_DIR = os.path.dirname(os.path.abspath(__file__))
INCIDENTS_PATH = os.path.join(_APP_DIR, "data", "webhook_meli_incidents.jsonl")
_MAX_BYTES = 2_000_000
_lock = threading.Lock()


def registrar_meli_webhook_incidente(event: str, **fields: Any) -> None:
    """
    event: identificador corto, p.ej. topic_no_manejado, postventa_pack_irresoluble.
    fields: topic, resource, source, detail, etc.
    """
    rec = {
        "ts": time.time(),
        "iso": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime()),
        "event": event,
        **fields,
    }
    line = json.dumps(rec, ensure_ascii=False, default=str)
    try:
        with _lock:
            os.makedirs(os.path.dirname(INCIDENTS_PATH), exist_ok=True)
            if os.path.isfile(INCIDENTS_PATH) and os.path.getsize(INCIDENTS_PATH) > _MAX_BYTES:
                _truncar_jsonl(INCIDENTS_PATH)
            with open(INCIDENTS_PATH, "a", encoding="utf-8") as f:
                f.write(line + "\n")
    except OSError as e:
        print(f"⚠️ meli_webhook_incidents: no se pudo escribir: {e}")


def _truncar_jsonl(path: str) -> None:
    """Mantiene las últimas ~8000 líneas si el archivo crece demasiado."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            lines = f.readlines()
        tail = lines[-8000:] if len(lines) > 8000 else lines
        with open(path, "w", encoding="utf-8") as f:
            f.writelines(tail)
    except OSError:
        pass


def contar_incidentes_por_evento(limite_lineas: int = 50_000) -> dict[str, int]:
    """Útil para diagnóstico en consola o tests; lee hasta limite_lineas desde el final."""
    if not os.path.isfile(INCIDENTS_PATH):
        return {}
    try:
        with open(INCIDENTS_PATH, "rb") as f:
            f.seek(0, os.SEEK_END)
            sz = f.tell()
            chunk = min(sz, 2_000_000)
            f.seek(max(0, sz - chunk))
            raw = f.read().decode("utf-8", errors="replace")
        lines = [ln for ln in raw.splitlines() if ln.strip()][-limite_lineas:]
    except OSError:
        return {}
    out: dict[str, int] = {}
    for ln in lines:
        try:
            ev = json.loads(ln).get("event", "")
            if ev:
                out[ev] = out.get(ev, 0) + 1
        except json.JSONDecodeError:
            continue
    return out


def ultimo_incidente(event: str | None = None, limite_lineas: int = 50_000) -> dict[str, Any] | None:
    """Devuelve el último incidente, opcionalmente filtrado por event."""
    if not os.path.isfile(INCIDENTS_PATH):
        return None
    try:
        with open(INCIDENTS_PATH, "rb") as f:
            f.seek(0, os.SEEK_END)
            sz = f.tell()
            chunk = min(sz, 2_000_000)
            f.seek(max(0, sz - chunk))
            raw = f.read().decode("utf-8", errors="replace")
        lines = [ln for ln in raw.splitlines() if ln.strip()][-limite_lineas:]
    except OSError:
        return None
    for ln in reversed(lines):
        try:
            rec = json.loads(ln)
        except json.JSONDecodeError:
            continue
        if event is None or rec.get("event") == event:
            return rec
    return None
