"""País de origen de las materias primas, por línea comercial con override por SKU.

website.py (8083) lee PAGINA_WEB/site/data/origen_materias.json (cache por mtime)
para pintar la sección "Ruta de tu materia prima" del inicio. Se edita desde el
panel de Operaciones vía app/routes.py (`/api/web/origen-materias`, Bearer).

Modelo: cada una de las 6 líneas comerciales tiene un país por defecto
(`lineas_default`); un SKU puntual puede tener un país propio (`overrides_sku`)
que pisa el default de su línea. Así el catálogo completo queda resuelto con
solo 6 filas, y se puede afinar producto por producto después.
"""

from __future__ import annotations

import copy
import threading
from datetime import datetime
from pathlib import Path

from app.tools._json_store import atomic_write_json, deep_merge

_ROOT = Path(__file__).resolve().parent.parent.parent  # /home/mckg/mi-agente
ORIGEN_MATERIAS_FILE = _ROOT / "PAGINA_WEB" / "site" / "data" / "origen_materias.json"

# Debe coincidir con LINEAS_OFICIALES en PAGINA_WEB/site/website.py.
LINEAS_VALIDAS: tuple[str, ...] = (
    "aceites-ceras-grasas",
    "agro",
    "alimentario",
    "cosmetica",
    "industria",
    "laboratorio",
)

# Coordenadas aproximadas (lat/lon) para los orígenes más comunes de McKenna.
# Es un catálogo de referencia, no exhaustivo: se completa con lo que se use.
_PAISES_SUGERIDOS: dict = {
    "China": {"lat": 35.0, "lon": 105.0, "puerto_entrada": "Buenaventura"},
    "India": {"lat": 21.0, "lon": 78.0, "puerto_entrada": "Cartagena"},
    "Estados Unidos": {"lat": 39.0, "lon": -98.0, "puerto_entrada": "Cartagena"},
    "Alemania": {"lat": 51.0, "lon": 10.0, "puerto_entrada": "Cartagena"},
    "España": {"lat": 40.0, "lon": -3.7, "puerto_entrada": "Cartagena"},
    "Malasia": {"lat": 4.2, "lon": 101.9, "puerto_entrada": "Buenaventura"},
    "Indonesia": {"lat": -0.8, "lon": 113.9, "puerto_entrada": "Buenaventura"},
    "Brasil": {"lat": -14.2, "lon": -51.9, "puerto_entrada": "Cartagena"},
    "Colombia": {"lat": 4.6, "lon": -74.1, "puerto_entrada": "Nacional"},
}

ORIGEN_MATERIAS_DEFAULTS: dict = {
    "actualizado": None,
    "paises": {},
    "lineas_default": {},
    "overrides_sku": {},
}

_lock = threading.Lock()
_cache: dict = {}
_cache_mtime: float | None = None


def _normalizar(data: dict) -> dict:
    out = copy.deepcopy(ORIGEN_MATERIAS_DEFAULTS)
    merged = deep_merge(out, data if isinstance(data, dict) else {})

    paises: dict = {}
    raw_paises = merged.get("paises")
    if isinstance(raw_paises, dict):
        for nombre, info in raw_paises.items():
            if not isinstance(nombre, str) or not nombre.strip():
                continue
            info = info if isinstance(info, dict) else {}
            entry: dict = {}
            for k in ("lat", "lon"):
                v = info.get(k)
                if isinstance(v, (int, float)):
                    entry[k] = float(v)
            puerto = info.get("puerto_entrada")
            if isinstance(puerto, str) and puerto.strip():
                entry["puerto_entrada"] = puerto.strip()
            paises[nombre.strip()] = entry
    merged["paises"] = paises

    lineas_default: dict = {}
    raw_lineas = merged.get("lineas_default")
    if isinstance(raw_lineas, dict):
        for lid, pais in raw_lineas.items():
            if lid in LINEAS_VALIDAS and isinstance(pais, str) and pais.strip():
                lineas_default[lid] = pais.strip()
    merged["lineas_default"] = lineas_default

    overrides: dict = {}
    raw_overrides = merged.get("overrides_sku")
    if isinstance(raw_overrides, dict):
        for sku, pais in raw_overrides.items():
            if isinstance(sku, str) and sku.strip() and isinstance(pais, str) and pais.strip():
                overrides[sku.strip()] = pais.strip()
    merged["overrides_sku"] = overrides

    # Cualquier país usado en lineas_default/overrides_sku que no tenga
    # coordenadas propias hereda las sugeridas si existen (o queda sin
    # coordenadas: el mapa lo omite pero el dato de texto se conserva).
    for pais in set(lineas_default.values()) | set(overrides.values()):
        if pais not in merged["paises"]:
            sugerido = _PAISES_SUGERIDOS.get(pais)
            merged["paises"][pais] = copy.deepcopy(sugerido) if sugerido else {}

    return merged


def cargar_origen_materias(force: bool = False) -> dict:
    """Config completa (defaults + archivo). Cache por mtime; segura entre hilos."""
    global _cache, _cache_mtime
    with _lock:
        try:
            mtime = ORIGEN_MATERIAS_FILE.stat().st_mtime
        except OSError:
            mtime = None
        if not force and _cache and mtime == _cache_mtime:
            return copy.deepcopy(_cache)
        data: dict = {}
        if mtime is not None:
            try:
                import json

                data = json.loads(ORIGEN_MATERIAS_FILE.read_text(encoding="utf-8"))
            except Exception:
                data = {}
        merged = _normalizar(data)
        _cache = merged
        _cache_mtime = mtime
        return copy.deepcopy(merged)


def guardar_origen_materias(cambios: dict) -> dict:
    """Aplica cambios (merge) sobre la config actual y persiste (escritura atómica)."""
    if not isinstance(cambios, dict):
        raise ValueError("La configuración de origen de materias debe ser un objeto JSON")
    if "lineas_default" in cambios and cambios["lineas_default"] is not None and not isinstance(
        cambios["lineas_default"], dict
    ):
        raise ValueError("lineas_default debe ser un objeto JSON")
    if "overrides_sku" in cambios and cambios["overrides_sku"] is not None and not isinstance(
        cambios["overrides_sku"], dict
    ):
        raise ValueError("overrides_sku debe ser un objeto JSON")
    if "paises" in cambios and cambios["paises"] is not None and not isinstance(cambios["paises"], dict):
        raise ValueError("paises debe ser un objeto JSON")

    actual = cargar_origen_materias(force=True)
    nuevo = _normalizar(deep_merge(actual, cambios))
    nuevo["actualizado"] = datetime.now().isoformat(timespec="seconds")
    atomic_write_json(ORIGEN_MATERIAS_FILE, nuevo)

    global _cache, _cache_mtime
    with _lock:
        _cache = nuevo
        _cache_mtime = ORIGEN_MATERIAS_FILE.stat().st_mtime
    return copy.deepcopy(nuevo)


def resolver_pais_linea(linea_id: str, cfg: dict | None = None) -> str | None:
    cfg = cfg or cargar_origen_materias()
    return cfg.get("lineas_default", {}).get(linea_id)


def resolver_pais_sku(sku: str, linea_id: str, cfg: dict | None = None) -> str | None:
    """País resuelto para un SKU: override puntual si existe, si no el de su línea."""
    cfg = cfg or cargar_origen_materias()
    override = cfg.get("overrides_sku", {}).get(sku)
    if override:
        return override
    return resolver_pais_linea(linea_id, cfg)


def resumen(cfg: dict | None = None) -> dict:
    """Estado de cobertura para mostrar en el panel: sin depender del catálogo."""
    cfg = cfg or cargar_origen_materias()
    lineas_default = cfg.get("lineas_default", {})
    overrides = cfg.get("overrides_sku", {})
    return {
        "lineas_cubiertas": sum(1 for lid in LINEAS_VALIDAS if lineas_default.get(lid)),
        "total_lineas": len(LINEAS_VALIDAS),
        "overrides_sku": len(overrides),
        "paises_usados": sorted(set(lineas_default.values()) | set(overrides.values())),
    }
