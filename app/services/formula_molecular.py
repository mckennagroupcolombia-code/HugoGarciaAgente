"""Fórmulas moleculares: dígitos como subíndices (C6H12O6 → C₆H₁₂O₆ / HTML <sub>)."""

from __future__ import annotations

import re

from markupsafe import Markup, escape

_SUB = str.maketrans("0123456789", "₀₁₂₃₄₅₆₇₈₉")
_UNSUB = str.maketrans("₀₁₂₃₄₅₆₇₈₉", "0123456789")

# Tras símbolo de elemento o cierre de grupo: subíndice. Coeficientes (2H2O, ·5H2O) no.
_DIGITOS_SUB = re.compile(r"(?<=[A-Za-z)\]}])(\d+)")


def _ascii_digitos(texto: str) -> str:
    return (texto or "").translate(_UNSUB)


def formatear_formula_molecular(texto: str) -> str:
    """Convierte dígitos de fórmula a subíndices Unicode. Idempotente."""
    s = _ascii_digitos(texto)
    return _DIGITOS_SUB.sub(lambda m: m.group(1).translate(_SUB), s)


def formula_a_html_sub(texto: str) -> Markup:
    """HTML con <sub> para PDF (Montserrat no trae glifos Unicode de subíndice)."""
    s = _ascii_digitos(texto)
    html = _DIGITOS_SUB.sub(r"<sub>\1</sub>", str(escape(s)))
    return Markup(html)
