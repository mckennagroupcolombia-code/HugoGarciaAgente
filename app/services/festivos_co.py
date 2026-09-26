"""Festivos nacionales de Colombia (días de descanso obligatorio), sin dependencias.

Reglas:
- Fijos: 1 ene, 1 may, 20 jul, 7 ago, 8 dic, 25 dic; Jueves y Viernes Santo.
- Ley Emiliani (Ley 51 de 1983): se pasan al lunes siguiente 6 ene, 19 mar, 29 jun, 15 ago, 12 oct,
  1 nov, 11 nov, y desde 2026 el 9 de julio (Ley 2578 de 2026, Virgen de Chiquinquirá).
- Según la Pascua, en lunes: Ascensión (+43), Corpus Christi (+64), Sagrado Corazón (+71).
"""

from __future__ import annotations

from datetime import date, timedelta
from functools import lru_cache


def _pascua(anio: int) -> date:
    a, b, c = anio % 19, anio // 100, anio % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l_ = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l_) // 451
    mes = (h + l_ - 7 * m + 114) // 31
    dia = (h + l_ - 7 * m + 114) % 31 + 1
    return date(anio, mes, dia)


def _lunes(d: date) -> date:
    return d + timedelta(days=(7 - d.weekday()) % 7)


@lru_cache(maxsize=16)
def festivos(anio: int) -> frozenset[date]:
    fijos = [date(anio, 1, 1), date(anio, 5, 1), date(anio, 7, 20), date(anio, 8, 7), date(anio, 12, 8), date(anio, 12, 25)]
    emiliani = [(1, 6), (3, 19), (6, 29), (8, 15), (10, 12), (11, 1), (11, 11)]
    if anio >= 2026:
        emiliani.append((7, 9))
    p = _pascua(anio)
    return frozenset(
        fijos
        + [_lunes(date(anio, m, d)) for m, d in emiliani]
        + [p - timedelta(days=3), p - timedelta(days=2), p + timedelta(days=43), p + timedelta(days=64), p + timedelta(days=71)]
    )


def es_festivo(d: date) -> bool:
    return d in festivos(d.year)


def es_habil(d: date) -> bool:
    """Lunes a viernes que no es festivo."""
    return d.weekday() < 5 and not es_festivo(d)
