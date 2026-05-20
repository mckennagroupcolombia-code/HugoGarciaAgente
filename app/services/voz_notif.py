"""
Cola persistente de notificaciones de voz.
Cualquier script Python puede importar agregar_notificacion_voz() para que
el panel Voz IA las anuncie automáticamente por Qwen3 TTS.

Uso:
    from app.services.voz_notif import agregar_notificacion_voz
    agregar_notificacion_voz("Backup completado exitosamente.", nivel="info")
    agregar_notificacion_voz("Error al sincronizar MeLi: timeout.", nivel="alerta")
    agregar_notificacion_voz("Stock crítico: Urea 250g agotada.", nivel="urgente")
"""
from __future__ import annotations
import json
import os
import uuid
from datetime import datetime

_NOTIF_FILE = os.path.join(os.path.dirname(__file__), "../data/voz_notificaciones.json")
_MAX = 100

_NIVELES = {"info", "alerta", "urgente"}


def agregar_notificacion_voz(texto: str, nivel: str = "info") -> str:
    """Agrega una notificación a la cola. Retorna el ID."""
    if nivel not in _NIVELES:
        nivel = "info"
    notif = {
        "id": uuid.uuid4().hex[:10],
        "texto": texto.strip(),
        "nivel": nivel,
        "timestamp": datetime.now().isoformat(),
    }
    _escribir([notif] + _leer())   # más reciente primero, capped a _MAX
    return notif["id"]


def leer_notificaciones() -> list[dict]:
    return _leer()


def marcar_leidas(ids: list[str] | None = None) -> int:
    antes = _leer()
    if ids is None:
        _escribir([])
        return len(antes)
    restantes = [n for n in antes if n["id"] not in ids]
    _escribir(restantes)
    return len(antes) - len(restantes)


# ── helpers ────────────────────────────────────────────────────────────────

def _leer() -> list[dict]:
    try:
        with open(_NOTIF_FILE, encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, list) else data.get("notificaciones", [])
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def _escribir(notifs: list[dict]) -> None:
    os.makedirs(os.path.dirname(_NOTIF_FILE), exist_ok=True)
    with open(_NOTIF_FILE, "w", encoding="utf-8") as f:
        json.dump(notifs[:_MAX], f, ensure_ascii=False, indent=2)
