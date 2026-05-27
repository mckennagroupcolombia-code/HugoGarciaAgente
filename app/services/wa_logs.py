"""
Registro liviano de eventos del canal WhatsApp.
Escribe en app/data/wa_interactions.json (buffer circular de MAX_EVENTOS).
Tipos de evento:
  handoff_humano   – cliente pidió asesor humano
  handoff_bot      – bot reactivado para ese número
  bot_pausado_auto – bot pausado automáticamente (ráfaga / loop / repet.)
  silenciado       – número agregado a lista de silenciados
  activado         – número retirado de silenciados
  modo_humano      – mensaje recibido con número en modo humano (reenvío al grupo)
  bot_pausado_global – mensaje ignorado por pausa global o fuera de horario
  manual_humano    – operador agregó número a modo humano desde el panel
  manual_quita_humano – operador quitó número de modo humano desde el panel
  manual_silenciar – operador silenció número desde el panel
  manual_activar   – operador activó número desde el panel
"""
import json
import time
import os

_PATH = os.path.join("app", "data", "wa_interactions.json")
_MAX_EVENTOS = 300


def _load() -> dict:
    try:
        with open(_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"eventos": []}


def _save(data: dict) -> None:
    with open(_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def registrar(tipo: str, sender: str = "", detalle: str = "") -> None:
    """Registra un evento en el log de interacciones WA."""
    try:
        data = _load()
        data.setdefault("eventos", [])
        data["eventos"].append(
            {
                "ts": time.time(),
                "tipo": tipo,
                "sender": sender,
                "detalle": (detalle or "")[:300],
            }
        )
        if len(data["eventos"]) > _MAX_EVENTOS:
            data["eventos"] = data["eventos"][-_MAX_EVENTOS:]
        _save(data)
    except Exception:
        pass  # el logging nunca debe romper el flujo principal


def listar(limit: int = 100, sender: str | None = None) -> list[dict]:
    """Devuelve eventos recientes (más nuevos primero)."""
    try:
        data = _load()
        items = data.get("eventos", [])
        if sender:
            items = [i for i in items if i.get("sender") == sender]
        return list(reversed(items[-limit:]))
    except Exception:
        return []
