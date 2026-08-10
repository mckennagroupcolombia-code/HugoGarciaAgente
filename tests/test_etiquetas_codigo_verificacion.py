"""Código de verificación como elemento de diagramación en Studio Etiquetas
(ambos motores: SVG genérico y .ai).

Clave: a diferencia de "legal"/"lote", ninguna de las 26 plantillas .ai tiene
aún una posición configurada para este campo nuevo — por eso SIEMPRE debe
dibujarse (con placeholder si no hay lote registrado), para que aparezca
seleccionable/arrastrable en el editor incluso sin `spec` ni código real."""

from __future__ import annotations

from app.tools.etiquetas_ai_engine import (
    _inyectar_codigo_verificacion_ai,
    _marcar_campos_diagramacion_ai,
)
from app.tools.etiquetas_svg_engine import (
    _CODIGO_VERIFICACION_PLACEHOLDER,
    _fragmento_codigo_verificacion,
)


def test_fragmento_codigo_sin_spec_usa_posicion_por_defecto() -> None:
    frag = _fragmento_codigo_verificacion({}, {"codigo_verificacion": "K7X2QA"})
    assert frag is not None
    assert "K7X2QA" in frag


def test_fragmento_codigo_sin_valor_muestra_placeholder() -> None:
    spec = {"codigo_verificacion": {"x": 10, "y": 20}}
    frag = _fragmento_codigo_verificacion(spec, {})
    assert frag is not None
    assert _CODIGO_VERIFICACION_PLACEHOLDER in frag

    frag2 = _fragmento_codigo_verificacion(spec, {"codigo_verificacion": "  "})
    assert frag2 is not None
    assert _CODIGO_VERIFICACION_PLACEHOLDER in frag2


def test_fragmento_codigo_placeholder_desactivable() -> None:
    spec = {"codigo_verificacion": {"x": 10, "y": 20}}
    assert _fragmento_codigo_verificacion(
        spec, {"placeholders_lote_vencimiento": False}
    ) is None


def test_fragmento_codigo_con_datos_completos() -> None:
    spec = {"codigo_verificacion": {"x": 10, "y": 20, "font_size": 3}}
    frag = _fragmento_codigo_verificacion(spec, {"codigo_verificacion": "K7X2QA"})
    assert frag is not None
    assert "K7X2QA" in frag
    assert 'id="mckenna-codigo-verificacion"' in frag
    assert 'matrix(1 0 0 -1 10.00 20.00)' in frag


_SVG_BASE = '<svg xmlns="http://www.w3.org/2000/svg"><g id="arte"></g></svg>'


def test_inyectar_codigo_verificacion_ai_agrega_fragmento() -> None:
    spec = {"codigo_verificacion": {"x": 5, "y": 5}}
    datos = {"codigo_verificacion": "ABCD34"}
    out = _inyectar_codigo_verificacion_ai(_SVG_BASE, datos, spec)
    assert "ABCD34" in out
    assert 'id="mckenna-codigo-verificacion"' in out
    assert out.rstrip().endswith("</svg>")


def test_inyectar_codigo_verificacion_ai_no_duplica() -> None:
    spec = {"codigo_verificacion": {"x": 5, "y": 5}}
    datos = {"codigo_verificacion": "ABCD34"}
    una_vez = _inyectar_codigo_verificacion_ai(_SVG_BASE, datos, spec)
    dos_veces = _inyectar_codigo_verificacion_ai(una_vez, datos, spec)
    assert dos_veces == una_vez


def test_inyectar_codigo_verificacion_ai_sin_codigo_usa_placeholder() -> None:
    spec = {"codigo_verificacion": {"x": 5, "y": 5}}
    out = _inyectar_codigo_verificacion_ai(_SVG_BASE, {}, spec)
    assert out != _SVG_BASE
    assert 'id="mckenna-codigo-verificacion"' in out


def test_inyectar_codigo_verificacion_ai_placeholder_desactivado_no_cambia() -> None:
    spec = {"codigo_verificacion": {"x": 5, "y": 5}}
    out = _inyectar_codigo_verificacion_ai(
        _SVG_BASE, {"placeholders_lote_vencimiento": False}, spec
    )
    assert out == _SVG_BASE


def test_marcar_campos_diagramacion_ai_tagea_codigo_inyectado() -> None:
    spec = {"codigo_verificacion": {"x": 5, "y": 5}}
    datos = {"codigo_verificacion": "ABCD34"}
    svg = _inyectar_codigo_verificacion_ai(_SVG_BASE, datos, spec)
    out = _marcar_campos_diagramacion_ai(svg, {}, datos)
    assert 'data-mckenna-campo="codigo_verificacion"' in out


def test_marcar_campos_diagramacion_ai_tagea_placeholder() -> None:
    """El caso real que reportó el usuario: SKU sin lote registrado aún — el
    campo debe poder seleccionarse/posicionarse igual (con placeholder)."""
    spec = {"codigo_verificacion": {"x": 5, "y": 5}}
    svg = _inyectar_codigo_verificacion_ai(_SVG_BASE, {}, spec)
    out = _marcar_campos_diagramacion_ai(svg, {}, {})
    assert 'data-mckenna-campo="codigo_verificacion"' in out
