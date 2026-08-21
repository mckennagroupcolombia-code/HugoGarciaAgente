"""Banners promocionales del inicio del sitio web (rotan en un carrusel).

website.py (8083) lee PAGINA_WEB/site/data/banners_promo.json (cache por mtime)
y solo pinta los banners vigentes (activo + dentro del rango de fechas, si
tiene). Se editan desde el panel de Operaciones vía app/routes.py
(`/api/web/banners`, Bearer).
"""

from __future__ import annotations

import copy
import json
import threading
import uuid
from datetime import date, datetime
from pathlib import Path

from app.tools._json_store import atomic_write_json

_ROOT = Path(__file__).resolve().parent.parent.parent  # /home/mckg/mi-agente
BANNERS_FILE = _ROOT / "PAGINA_WEB" / "site" / "data" / "banners_promo.json"

LINK_TIPOS_VALIDOS: tuple[str, ...] = ("catalogo", "producto", "whatsapp", "url")

_lock = threading.Lock()
_cache: list | None = None
_cache_mtime: float | None = None


def _parse_fecha(v) -> str | None:
    if not isinstance(v, str) or not v.strip():
        return None
    try:
        datetime.strptime(v.strip(), "%Y-%m-%d")
    except ValueError:
        raise ValueError(f"Fecha inválida (usar YYYY-MM-DD): {v!r}")
    return v.strip()


def _normalizar_banner(raw: dict, *, banner_id: str | None = None) -> dict:
    if not isinstance(raw, dict):
        raise ValueError("Cada banner debe ser un objeto JSON")
    titulo = (raw.get("titulo") or "").strip()
    if not titulo:
        raise ValueError("El banner necesita un título")
    link_tipo = raw.get("link_tipo") or "catalogo"
    if link_tipo not in LINK_TIPOS_VALIDOS:
        raise ValueError(f"link_tipo inválido: {link_tipo!r} (válidos: {LINK_TIPOS_VALIDOS})")
    return {
        "id": banner_id or f"b_{uuid.uuid4().hex[:10]}",
        "titulo": titulo,
        "texto": (raw.get("texto") or "").strip(),
        "etiqueta": (raw.get("etiqueta") or "").strip(),
        "activo": bool(raw.get("activo", True)),
        "vigente_desde": _parse_fecha(raw.get("vigente_desde")),
        "vigente_hasta": _parse_fecha(raw.get("vigente_hasta")),
        "link_tipo": link_tipo,
        "link_valor": (raw.get("link_valor") or "").strip(),
        "orden": int(raw.get("orden") or 0),
    }


def _leer_archivo() -> list:
    try:
        mtime = BANNERS_FILE.stat().st_mtime
    except OSError:
        return []
    try:
        data = json.loads(BANNERS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []
    return data if isinstance(data, list) else []


def cargar_banners(force: bool = False) -> list:
    """Todos los banners (admin) — vigentes o no. Cache por mtime; segura entre hilos."""
    global _cache, _cache_mtime
    with _lock:
        try:
            mtime = BANNERS_FILE.stat().st_mtime
        except OSError:
            mtime = None
        if not force and _cache is not None and mtime == _cache_mtime:
            return copy.deepcopy(_cache)
        data = _leer_archivo() if mtime is not None else []
        limpio = []
        for item in data:
            try:
                limpio.append(_normalizar_banner(item, banner_id=item.get("id") if isinstance(item, dict) else None))
            except ValueError:
                continue  # descarta entradas corruptas en vez de tumbar el sitio
        limpio.sort(key=lambda b: b["orden"])
        _cache = limpio
        _cache_mtime = mtime
        return copy.deepcopy(limpio)


def _persistir(lista: list) -> list:
    atomic_write_json(BANNERS_FILE, lista)
    global _cache, _cache_mtime
    with _lock:
        _cache = copy.deepcopy(lista)
        _cache_mtime = BANNERS_FILE.stat().st_mtime
    return copy.deepcopy(lista)


def crear_banner(datos: dict) -> dict:
    actual = cargar_banners(force=True)
    nuevo = _normalizar_banner(datos)
    if not datos.get("orden"):
        nuevo["orden"] = (max((b["orden"] for b in actual), default=-1)) + 1
    actual.append(nuevo)
    actual.sort(key=lambda b: b["orden"])
    _persistir(actual)
    return nuevo


def actualizar_banner(banner_id: str, datos: dict) -> dict:
    actual = cargar_banners(force=True)
    idx = next((i for i, b in enumerate(actual) if b["id"] == banner_id), None)
    if idx is None:
        raise ValueError(f"No existe el banner {banner_id!r}")
    fusionado = {**actual[idx], **datos}
    actualizado = _normalizar_banner(fusionado, banner_id=banner_id)
    actual[idx] = actualizado
    actual.sort(key=lambda b: b["orden"])
    _persistir(actual)
    return actualizado


def eliminar_banner(banner_id: str) -> None:
    actual = cargar_banners(force=True)
    restante = [b for b in actual if b["id"] != banner_id]
    if len(restante) == len(actual):
        raise ValueError(f"No existe el banner {banner_id!r}")
    _persistir(restante)


def banners_vigentes(hoy: date | None = None) -> list:
    """Solo activos y dentro de su rango de fechas (si lo tienen) — orden público."""
    hoy = hoy or date.today()
    hoy_str = hoy.strftime("%Y-%m-%d")
    out = []
    for b in cargar_banners():
        if not b["activo"]:
            continue
        if b["vigente_desde"] and hoy_str < b["vigente_desde"]:
            continue
        if b["vigente_hasta"] and hoy_str > b["vigente_hasta"]:
            continue
        out.append(b)
    return out
