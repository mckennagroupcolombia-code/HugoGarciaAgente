"""Helpers para códigos EAN-13 internos (planilla de etiquetas).

Estructura: 770 + producto(3) + presentación(3) + año(2) + bimestre(1) + check.
La presentación codifica el contenido neto:
  - kg / kilo / 1 kg / 1.000 g / 1000 g → 001
  - 50 g / 50 mL → 050
  - 5 mL → 005
  - 100 g → 100
  - valores de 3 dígitos se usan tal cual (125, 250, 500…)
  - SKUs compuestos (ej. C-SHA70550mL) toman el tamaño real del final (50, no 70550)
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Iterable

# Tamaños comunes; se prueban de mayor a menor longitud al final del número del SKU.
_PRESENTACIONES_CONOCIDAS = (
    1000, 500, 400, 250, 150, 125, 120, 100, 60, 50, 40, 30, 20, 15, 10, 5,
)


def normalizar_sku_ean(sku: str) -> str:
    return re.sub(r"\s+", "", (sku or "").strip().upper())


def _codigo_presentacion_desde_numero(n: int) -> str:
    if n <= 0:
        return "000"
    if n == 1000:
        return "001"
    if n > 999:
        return str(n)[-3:]
    return f"{n:03d}"


def _numero_presentacion_desde_cola(digitos: str) -> int | None:
    """Si el número pega marca+tamaño (70550), toma el tamaño final conocido."""
    raw = re.sub(r"\D", "", digitos or "")
    if not raw:
        return None
    if len(raw) <= 3:
        return int(raw)
    for cand in _PRESENTACIONES_CONOCIDAS:
        suf = str(cand)
        if raw.endswith(suf) and len(raw) > len(suf):
            return cand
    return int(raw[-3:])


def presentacion_ean_desde_sku(sku: str, nombre: str = "") -> str:
    """Infiere el código de 3 dígitos de presentación a partir del SKU/nombre."""
    sku = (sku or "").strip()
    nombre = (nombre or "").strip()
    blob = f"{sku} {nombre}".strip()

    # 1.000 g / 1000 g → 001 (equivalente a 1 kg)
    if re.search(r"(?:1[.,]000|1000)\s*g\b", blob, re.I):
        return "001"

    # Kg / kilo al final del SKU o en el texto (cualquier presentación en kilo → 001)
    if re.search(r"kg\s*$", sku, re.I) or re.search(r"\b(?:kg|kilos?)\b", blob, re.I):
        return "001"

    # Litro suelto (Lt / L sin cantidad) → 001 (unidad completa)
    cola = sku.split("-")[-1] if "-" in sku else sku
    if re.search(r"(?:lt|l)\s*$", sku, re.I) and not re.search(r"\d", cola):
        return "001"
    if re.search(r"\b(?:lt|litro|litros)\b", blob, re.I) and not re.search(
        r"\d+(?:[.,]\d+)?\s*(?:ml|lt|l)\b", blob, re.I
    ):
        return "001"

    # Preferir cantidad al final del SKU (convención SIIGO: …250g, …50mL)
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*(g|ml|lt|l)\s*$", sku, re.I)
    if not m:
        m = re.search(r"(\d+(?:[.,]\d+)?)\s*(g|ml|lt|l)\b", blob, re.I)
    if not m:
        return "000"

    unit = m.group(2).lower()
    if unit == "l":
        unit = "lt"
    digitos = m.group(1).replace(",", ".").split(".")[0]

    if unit == "kg":
        return "001"
    if unit == "lt" and digitos in {"1", "1.0", "1.00"}:
        return "001"

    n = _numero_presentacion_desde_cola(digitos)
    if n is None:
        return "000"
    if unit == "g" and n == 1000:
        return "001"
    return _codigo_presentacion_desde_numero(n)


def siguiente_numero_producto(numeros: Iterable[int], minimo: int = 1, maximo: int = 900) -> int | None:
    """Menor número libre en [minimo, maximo] (rellena huecos de códigos borrados)."""
    usados: set[int] = set()
    for n in numeros:
        try:
            v = int(n)
        except (TypeError, ValueError):
            continue
        if minimo <= v <= maximo:
            usados.add(v)
    for n in range(minimo, maximo + 1):
        if n not in usados:
            return n
    return None


def anio_bimestre_actual(ahora: datetime | None = None) -> tuple[int, int]:
    ahora = ahora or datetime.now()
    anio = ahora.year % 100
    bimestre = max(0, min(5, (ahora.month - 1) // 2))
    return anio, bimestre
