"""Avisos personales: un comunicado para una persona que aparece una sola vez al abrir la app.

Datos en app/data/avisos_personales.json: [{id, usuario_id, titulo, mensaje, firma, creado, visto}].
Se crean con `crear()` (por consola o desde otra herramienta); la persona lo ve en una ventana
al entrar y, al tocar «Entendido», queda marcado como visto. Sin LLM.
"""

from __future__ import annotations

import json
import os
import threading
import uuid
from datetime import datetime

_RUTA = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "avisos_personales.json")
_lock = threading.Lock()


def _cargar() -> list[dict]:
    try:
        with open(_RUTA, encoding="utf-8") as fh:
            return json.load(fh)
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def _guardar(avisos: list[dict]) -> None:
    tmp = _RUTA + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(avisos, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, _RUTA)


def crear(usuario_id: int, titulo: str, mensaje: str, firma: str = "") -> dict:
    aviso = {"id": uuid.uuid4().hex[:10], "usuario_id": int(usuario_id), "titulo": titulo.strip()[:120],
             "mensaje": mensaje.strip()[:4000], "firma": firma.strip()[:120],
             "creado": datetime.now().isoformat(timespec="seconds"), "visto": ""}
    with _lock:
        avisos = _cargar()
        avisos.append(aviso)
        _guardar(avisos)
    return aviso


def pendientes(usuario_id: int) -> list[dict]:
    return [a for a in _cargar() if a.get("usuario_id") == int(usuario_id) and not a.get("visto")]


def marcar_visto(aviso_id: str, usuario_id: int) -> bool:
    with _lock:
        avisos = _cargar()
        for a in avisos:
            if a.get("id") == aviso_id and a.get("usuario_id") == int(usuario_id):
                if not a.get("visto"):
                    a["visto"] = datetime.now().isoformat(timespec="seconds")
                    _guardar(avisos)
                return True
    return False
