"""
Fichas de etiqueta guardadas — persistencia del formulario "Ficha de
etiqueta" (Studio Visual → Formularios etiquetados,
desktop/src/components/etiqueta-ficha/ProductLabelForm.tsx).

Antes los datos del formulario (ProductLabelData) solo vivían en un
useState de React: se perdían al recargar la página o cambiar de panel, y
lo único que quedaba era el PNG final exportado. Este módulo permite
guardar cada ficha con un nombre elegido a mano por el operador (no
derivado del nombre del producto) y reabrirla después.
"""
from __future__ import annotations

import contextlib
import copy
import fcntl
import json
import os
import shutil
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

_REPO = Path(__file__).resolve().parents[2]
_DATA_PATH = _REPO / "app" / "data" / "etiquetas_fichas.json"
# Cambia todos los días y puede llevar logos como data URL — mismo patrón
# que plantillas_visuales.json: vive en app/data por convención de rutas
# pero fuera de git (ver .gitignore).
_MAX_FICHAS = 500

# Cache en memoria invalidada por mtime — mismo patrón que
# app/tools/plantillas_visuales.py (evita releer/parseo en cada request de
# listado). `_load_all` devuelve copia profunda para que nadie mute el cache.
_cache: dict[str, Any] = {"mtime": None, "items": None}
_LOCK = threading.RLock()


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


class AlmacenFichasIlegible(RuntimeError):
    """El JSON existe pero no se pudo leer. NUNCA se trata como «vacío»."""


def _leer_disco() -> list[dict]:
    with open(_DATA_PATH, encoding="utf-8") as f:
        raw = json.load(f)
    items = raw.get("fichas") if isinstance(raw, dict) else None
    if not isinstance(items, list):
        raise ValueError("estructura inesperada")
    return items


def _load_all() -> list[dict]:
    """Lee el almacén.

    Incidente 2026-09-19: un error de lectura se tomaba como lista vacía y la
    escritura no era atómica. Con dos guardados a la vez (lote de etiquetas +
    autoguardado del formulario) sobre un archivo de 6 MB, una lectura a mitad de
    escritura devolvió [] y el guardado siguiente dejó 3 fichas de 190: se
    perdieron todas las plantillas. Ahora: reintenta, y si sigue ilegible LANZA
    (así nadie guarda encima), y `_save_all` escribe a un temporal + os.replace
    bajo candado.
    """
    try:
        mtime = _DATA_PATH.stat().st_mtime
    except OSError:
        _cache["mtime"] = None
        _cache["items"] = []
        return []
    if _cache["items"] is None or _cache["mtime"] != mtime:
        ultimo: Exception | None = None
        for _ in range(5):
            try:
                _cache["items"] = _leer_disco()
                _cache["mtime"] = mtime
                break
            except Exception as exc:  # escritura en curso de otro proceso
                ultimo = exc
                time.sleep(0.15)
        else:
            raise AlmacenFichasIlegible(f"{_DATA_PATH.name} ilegible: {ultimo!r}")
    return copy.deepcopy(_cache["items"])


def _save_all(items: list[dict]) -> None:
    _DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    trimmed = items[:_MAX_FICHAS]
    # Copia de la versión anterior: si algo sale mal, hay de dónde volver.
    if _DATA_PATH.is_file():
        try:
            shutil.copy2(_DATA_PATH, _DATA_PATH.with_suffix(".json.bak"))
        except OSError:
            pass
    tmp = _DATA_PATH.with_suffix(f".json.tmp{os.getpid()}")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"fichas": trimmed}, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, _DATA_PATH)  # atómico: nadie ve un archivo a medias
    try:
        _cache["mtime"] = _DATA_PATH.stat().st_mtime
    except OSError:
        _cache["mtime"] = None
    _cache["items"] = copy.deepcopy(trimmed)


@contextlib.contextmanager
def _candado():
    """Un solo lector-modificador-escritor a la vez, entre hilos Y procesos."""
    with _LOCK:
        _DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(_DATA_PATH.with_suffix(".lock"), "w") as lk:
            fcntl.flock(lk, fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(lk, fcntl.LOCK_UN)


def listar_fichas(q: str = "") -> list[dict]:
    items = _load_all()
    q = (q or "").strip().lower()
    if q:
        items = [f for f in items if q in (f.get("nombre") or "").lower()]
    items.sort(key=lambda f: f.get("actualizado") or "", reverse=True)
    return items


def obtener_ficha(ficha_id: str) -> dict | None:
    ficha_id = (ficha_id or "").strip()
    if not ficha_id:
        return None
    for f in _load_all():
        if f.get("id") == ficha_id:
            return f
    return None


def guardar_ficha(body: dict) -> dict:
    """Crea o actualiza (si trae 'id' existente) una ficha guardada.

    'nombre' es obligatorio y siempre lo escribe el operador a mano — nunca
    se deriva de data.productName ni de ningún otro campo del formulario.
    """
    if not isinstance(body, dict):
        raise ValueError("Cuerpo inválido")
    ficha_id = (body.get("id") or "").strip() or uuid.uuid4().hex[:12]
    nombre = (body.get("nombre") or "").strip()
    if not nombre:
        raise ValueError("Falta el nombre de la ficha")
    data = body.get("data")
    if not isinstance(data, dict):
        raise ValueError("Falta 'data' de la ficha")

    with _candado():
        return _guardar_ficha_bajo_candado(body, ficha_id, nombre, data)


def _guardar_ficha_bajo_candado(body: dict, ficha_id: str, nombre: str, data: dict) -> dict:
    todos = _load_all()
    existente = next((f for f in todos if f.get("id") == ficha_id), None)
    now = _now()

    entry: dict[str, Any] = {
        "id": ficha_id,
        "nombre": nombre,
        # Copia fiel sin alterar tipos/orden de las claves del formulario.
        "data": json.loads(json.dumps(data, ensure_ascii=False)),
        "creado": (existente or {}).get("creado") or now,
        "actualizado": now,
    }
    tipo_nombre = (body.get("tipo_nombre") or "").strip()
    if tipo_nombre:
        entry["tipo_nombre"] = tipo_nombre
    # Categoría de producto (aceites, frutos secos, conservantes…): decide de
    # qué plantilla parte una ficha nueva. La lista vive en el panel
    # (desktop/src/lib/categoriasEtiqueta.ts); aquí solo se persiste el id.
    categoria = (body.get("categoria") or "").strip()
    if categoria:
        entry["categoria"] = categoria
    # Marca de "esta etiqueta ES la plantilla de su categoría": el formato ya
    # ajustado que se despliega sobre todos los productos de la familia. Se
    # guarda aquí (no en plantillas_visuales) porque es del motor de formulario.
    if body.get("es_plantilla_categoria"):
        entry["es_plantilla_categoria"] = True
    # De qué plantilla salió esta etiqueta. Distingue lo hecho con el flujo nuevo
    # de las fichas sueltas del catálogo viejo, que no tienen plantilla detrás.
    plantilla_id = (body.get("plantilla_id") or "").strip()
    if plantilla_id:
        entry["plantilla_id"] = plantilla_id
    attribute_icons = body.get("attribute_icons")
    if isinstance(attribute_icons, dict) and attribute_icons:
        entry["attribute_icons"] = json.loads(json.dumps(attribute_icons, ensure_ascii=False))
    text_styles = body.get("text_styles")
    if isinstance(text_styles, dict) and text_styles:
        entry["text_styles"] = json.loads(json.dumps(text_styles, ensure_ascii=False))

    items = [f for f in todos if f.get("id") != ficha_id]
    items.insert(0, entry)
    _save_all(items)
    return entry


def eliminar_ficha(ficha_id: str) -> bool:
    ficha_id = (ficha_id or "").strip()
    if not ficha_id:
        return False
    with _candado():
        antes = _load_all()
        items = [f for f in antes if f.get("id") != ficha_id]
        if len(items) == len(antes):
            return False
        _save_all(items)
        return True
