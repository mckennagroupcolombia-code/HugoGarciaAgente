"""
Tarifas Interrapidísimo 2026 por zona y peso — cálculo único para todos los canales.

Fuente de datos: app/data/tarifas_interrapidisimo.json (claves `zonas`,
`zona_por_departamento`, `zona_por_ciudad`). El JSON se relee si cambia en disco,
así que ajustar tarifas no requiere reiniciar servicios.

Consumidores: PAGINA_WEB/site/website.py (checkout), app/tools/despacho.py (guías)
y app/tools/system_tools.py (cotizaciones del agente WhatsApp).
"""

from __future__ import annotations

import json
import math
import os
import re
import unicodedata
from pathlib import Path

_TARIFAS_PATH = Path(__file__).resolve().parents[1] / "data" / "tarifas_interrapidisimo.json"
_ZONA_DEFAULT = "nacional_2"

_cache: dict = {"mtime": None, "data": {}}


def _datos() -> dict:
    try:
        mtime = os.path.getmtime(_TARIFAS_PATH)
        if _cache["mtime"] != mtime:
            _cache["data"] = json.loads(_TARIFAS_PATH.read_text(encoding="utf-8"))
            _cache["mtime"] = mtime
    except Exception:
        pass
    return _cache["data"] or {}


def normalizar_lugar(s: str) -> str:
    s = unicodedata.normalize("NFD", (s or "").lower().strip())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def zona_envio(ciudad: str, depto: str = "") -> str:
    """Zona tarifaria (local/regional/nacional_1/nacional_2/dificil_acceso)."""
    data = _datos()
    por_ciudad = data.get("zona_por_ciudad", {})
    nc = normalizar_lugar(ciudad)
    if nc:
        if nc in por_ciudad:
            return por_ciudad[nc]
        for k, z in por_ciudad.items():
            if nc.startswith(k) or k.startswith(nc):
                return z
    return data.get("zona_por_departamento", {}).get((depto or "").strip(), _ZONA_DEFAULT)


def tarifa_zona_peso(zona: str, peso_kg: float) -> int:
    """Costo según tabla 2026 por zona y peso (kg redondeado hacia arriba, mín. 1)."""
    zonas = _datos().get("zonas", {})
    z = zonas.get(zona) or zonas.get(_ZONA_DEFAULT) or {}
    if not z:
        return 18500
    kg = max(1, math.ceil(peso_kg))
    valor_5kg = z["kilo_2"] + 3 * z["incremento_kg_2_5"]
    if kg <= 1:
        return int(z["kilo_1"])
    if kg <= 5:
        return int(z["kilo_2"] + (kg - 2) * z["incremento_kg_2_5"])
    if kg <= 10:
        if "kilo_6_10" in z:
            v = z["kilo_6_10"]
        else:
            v = z["kilo_6_10_base"] + (kg - 6) * z["incremento_kg_6_10"]
        # nunca cobrar menos que el tramo anterior (la tabla 6-10 arranca por debajo del 5 kg en algunas zonas)
        return int(max(v, valor_5kg))
    v10 = tarifa_zona_peso(zona, 10)
    return int(max(z.get("kilo_11_20", v10), v10))


def cotizar_envio(ciudad: str, depto: str = "", peso_kg: float = 1.0) -> dict:
    zona = zona_envio(ciudad, depto)
    z = _datos().get("zonas", {}).get(zona, {})
    return {
        "zona": zona,
        "zona_nombre": z.get("nombre", zona),
        "peso_kg": max(1, math.ceil(peso_kg)),
        "costo": tarifa_zona_peso(zona, peso_kg),
        "dias": int(z.get("dias", 3)),
    }


_PESO_NOMBRE_RE = re.compile(
    r"(\d+(?:[.,]\d+)?)\s*(kg|kilos?|g|gr|gramos?|ml|cc|lts?|litros?|lb|libras?)\b", re.I
)
_PESO_UNIDAD_KG = {
    "kg": 1.0, "kilo": 1.0, "kilos": 1.0,
    "g": 0.001, "gr": 0.001, "gramo": 0.001, "gramos": 0.001,
    "ml": 0.001, "cc": 0.001,
    "lt": 1.0, "lts": 1.0, "litro": 1.0, "litros": 1.0,
    "lb": 0.5, "libra": 0.5, "libras": 0.5,
}


def peso_unitario_kg(nombre: str) -> float:
    """Peso aproximado de una unidad a partir de la presentación en el nombre (1 kg si no se reconoce)."""
    n = normalizar_lugar(nombre)
    m = _PESO_NOMBRE_RE.search(n)
    if m:
        unidad = m.group(2).lower()
        factor = _PESO_UNIDAD_KG.get(unidad, _PESO_UNIDAD_KG.get(unidad.rstrip("s"), 1.0))
        return max(0.05, float(m.group(1).replace(",", ".")) * factor)
    # presentaciones sin número: "... Kg", "... Lb", "... Lt", "... Gl" (galón)
    toks = set(n.split())
    if toks & {"gl", "galon"}:
        return 4.0
    if toks & {"lb", "libra"}:
        return 0.5
    if toks & {"kg", "kilo", "lt", "litro"}:
        return 1.0
    return 1.0


def peso_carrito_kg(cart: dict) -> float:
    total = 0.0
    for item in (cart or {}).values():
        qty = max(1, int(item.get("qty", 1) or 1))
        total += peso_unitario_kg(item.get("name", "")) * qty
    return max(1.0, total)
