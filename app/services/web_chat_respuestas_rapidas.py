"""Respuestas rápidas del panel Chat web (por operario + globales)."""

from __future__ import annotations

import json
import os
import secrets
import threading
from typing import Any

_DATA_PATH = os.path.join(
    os.path.dirname(__file__), "..", "data", "web_chat_respuestas_rapidas.json"
)
_LOCK = threading.Lock()
_MAX_POR_USUARIO = 40
_MAX_GLOBAL = 30


def _load() -> dict[str, Any]:
    try:
        with open(_DATA_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        data = {}
    if not isinstance(data, dict):
        data = {}
    data.setdefault("global", [])
    data.setdefault("usuarios", {})
    if not isinstance(data["global"], list):
        data["global"] = []
    if not isinstance(data["usuarios"], dict):
        data["usuarios"] = {}
    return data


def _save(data: dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(_DATA_PATH), exist_ok=True)
    with open(_DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _norm_item(raw: dict) -> dict | None:
    texto = str(raw.get("texto") or "").strip()
    if not texto:
        return None
    titulo = str(raw.get("titulo") or "").strip() or texto[:48] + ("…" if len(texto) > 48 else "")
    return {
        "id": str(raw.get("id") or secrets.token_urlsafe(8)),
        "titulo": titulo[:80],
        "texto": texto[:4000],
    }


def listar_para_usuario(usuario_id: int | None) -> dict[str, list[dict]]:
    with _LOCK:
        data = _load()
    global_items = [x for x in (_norm_item(i) for i in data["global"]) if x]
    mine: list[dict] = []
    if usuario_id is not None:
        raw_mine = data["usuarios"].get(str(usuario_id), [])
        if isinstance(raw_mine, list):
            mine = [x for x in (_norm_item(i) for i in raw_mine) if x]
    return {"global": global_items, "mine": mine}


def agregar(
    *,
    usuario_id: int | None,
    texto: str,
    titulo: str = "",
    scope: str = "mine",
) -> tuple[dict | None, str | None]:
    item = _norm_item({"titulo": titulo, "texto": texto})
    if not item:
        return None, "El texto no puede estar vacío"
    scope = (scope or "mine").strip().lower()
    with _LOCK:
        data = _load()
        if scope == "global":
            items = data["global"]
            if len(items) >= _MAX_GLOBAL:
                return None, f"Máximo {_MAX_GLOBAL} respuestas globales"
            items.append(item)
            data["global"] = items
        else:
            if usuario_id is None:
                return None, "Inicia sesión con tu cuenta para guardar respuestas personales"
            key = str(usuario_id)
            items = data["usuarios"].setdefault(key, [])
            if not isinstance(items, list):
                items = []
            if len(items) >= _MAX_POR_USUARIO:
                return None, f"Máximo {_MAX_POR_USUARIO} respuestas personales"
            items.append(item)
            data["usuarios"][key] = items
        _save(data)
    return item, None


def eliminar(
    *,
    item_id: str,
    usuario_id: int | None,
    scope: str = "mine",
    es_admin: bool = False,
) -> tuple[bool, str | None]:
    item_id = (item_id or "").strip()
    if not item_id:
        return False, "id requerido"
    scope = (scope or "mine").strip().lower()
    with _LOCK:
        data = _load()
        if scope == "global":
            if not es_admin:
                return False, "Solo administradores pueden borrar respuestas globales"
            antes = len(data["global"])
            data["global"] = [
                i for i in data["global"]
                if str(i.get("id")) != item_id
            ]
            ok = len(data["global"]) < antes
        else:
            if usuario_id is None:
                return False, "Sesión no válida"
            key = str(usuario_id)
            items = data["usuarios"].get(key, [])
            if not isinstance(items, list):
                items = []
            antes = len(items)
            items = [i for i in items if str(i.get("id")) != item_id]
            data["usuarios"][key] = items
            ok = len(items) < antes
        if ok:
            _save(data)
    return ok, None if ok else "No encontrada"
