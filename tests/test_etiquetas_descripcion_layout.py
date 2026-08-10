"""Layout de descripción alternativa en plantillas .ai (sin desborde)."""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from app.tools.etiquetas_ai_engine import (
    _detectar_separador_x_ai,
    _formatear_descripcion_etiqueta_ai,
    _meta_bloque_descripcion_ai,
    buscar_plantilla_ai,
    renderizar_desde_ai,
    _ai_a_svg,
    _detectar_muestras_ai,
)
from app.tools.etiquetas_svg_engine import renderizar_svg


@pytest.fixture
def citrato_alternativa() -> dict:
    data = json.loads(Path("app/data/etiquetas_studio.json").read_text(encoding="utf-8"))
    d = dict(data["C-CITMAG500g"]["_versiones"]["alternativa"])
    d["modo_etiqueta"] = "alternativa"
    return d


def test_formatear_cuerpo_unico_unifica_saltos_simples():
    texto = "Línea uno del párrafo.\nLínea dos del mismo párrafo.\n\nSegundo párrafo."
    lineas = _formatear_descripcion_etiqueta_ai(texto, max_chars=50, max_lineas=10, alternativa=True)
    assert lineas[0].startswith("Línea uno")
    assert "Línea dos" in lineas[0]
    assert any(ln.startswith("Segundo") for ln in lineas)


def test_formatear_descripcion_respeta_parrafos():
    texto = "Primer párrafo largo con varias palabras.\n\nSegundo bloque\n\n    Industria X: uso en bebidas."
    lineas = _formatear_descripcion_etiqueta_ai(texto, max_chars=42, max_lineas=8)
    assert lineas[0].startswith("Primer")
    assert "" in lineas
    assert any(ln.startswith("Industria X:") for ln in lineas)


def test_descripcion_justificada_solo_en_alternativa(citrato_alternativa):
    datos_alt = {**citrato_alternativa, "modo_etiqueta": "alternativa"}
    svg_alt, meta_alt = renderizar_svg(datos_alt)
    assert meta_alt.get("descripcion_reemplazos", 0) > 0
    bloque_alt = _extraer_bloque_descripcion(svg_alt, "Materia prima")
    assert re.search(r'<tspan x="[1-9][0-9.]*">', bloque_alt)

    datos_orig = {**citrato_alternativa, "modo_etiqueta": "original"}
    svg_orig, meta_orig = renderizar_svg(datos_orig)
    assert meta_orig.get("modo") == "ai_original"
    assert meta_orig.get("descripcion_reemplazos", 0) == 0
    assert "Materia prima pura de grado alimentario" not in svg_orig
    assert "El citrato de magnesio" in svg_orig.lower() or "citrato" in svg_orig.lower()


def test_descripcion_no_usa_posicionamiento_por_caracter(citrato_alternativa):
    svg, meta = renderizar_svg(citrato_alternativa)
    assert meta.get("descripcion_reemplazos", 0) > 0
    desc_block = _extraer_bloque_descripcion(svg, "Materia prima")
    assert desc_block
    # Justificación real: palabras con x explícito (no kerning Illustrator)
    assert 'x="0 3.' not in desc_block
    assert re.search(r'<tspan x="[1-9][0-9.]*">', desc_block)
    assert desc_block.count("<text") == 1


def test_normalizar_ortografia_puntuacion_descripcion():
    from app.tools.etiquetas_svg_engine import _normalizar_ortografia_puntuacion_etiqueta

    assert _normalizar_ortografia_puntuacion_etiqueta("hola , mundo .") == "hola, mundo."
    assert _normalizar_ortografia_puntuacion_etiqueta("99% puro") == "99 % puro"
    assert "Información Técnica y Regulatoria:" in _normalizar_ortografia_puntuacion_etiqueta(
        "Información Técnica y Regulatoria:"
    )


def test_descripcion_no_desborda_separador(citrato_alternativa):
    svg, _ = renderizar_svg(citrato_alternativa)
    sep_x = _detectar_separador_x_ai(svg)
    assert sep_x is not None
    bloque = _extraer_bloque_descripcion(svg, "Materia prima")
    tx = _bloque_tx(bloque)
    max_x_local = 0.0
    for m in re.finditer(r'<tspan x="([0-9.]+)"[^>]*>([^<]+)</tspan>', bloque):
        xpos = float(m.group(1))
        palabra = m.group(2)
        max_x_local = max(max_x_local, xpos + len(palabra) * 2.6)
    assert tx + max_x_local <= sep_x + 2.5
    for tspan in re.findall(r"<tspan[^>]*>([^<]*)</tspan>", bloque):
        if not tspan.strip():
            continue
        assert len(tspan) <= 50, f"Línea demasiado larga ({len(tspan)}): {tspan[:60]}…"


def test_b1_guia_y_ancho_pct(citrato_alternativa):
    svg_full, _ = renderizar_svg({**citrato_alternativa, "b1_ancho_pct": 100})
    assert 'id="mckenna-b1-guia"' in svg_full
    m_full = re.search(r'id="mckenna-b1-guia"[^>]*width="([0-9.]+)"', svg_full)
    assert m_full
    w_full = float(m_full.group(1))

    svg_80, _ = renderizar_svg({**citrato_alternativa, "b1_ancho_pct": 80})
    m_80 = re.search(r'id="mckenna-b1-guia"[^>]*width="([0-9.]+)"', svg_80)
    assert m_80
    w_80 = float(m_80.group(1))
    assert w_80 < w_full
    assert abs(w_80 / w_full - 0.8) < 0.02


def test_campos_diagramacion_marcados(citrato_alternativa):
    svg, _ = renderizar_svg(citrato_alternativa)
    assert 'data-mckenna-campo="b1"' in svg
    assert 'data-mckenna-campo="titulo"' in svg or 'data-mckenna-campo="subtitulo"' in svg


def test_diagramacion_aplica_color_y_posicion(citrato_alternativa):
    datos = {
        **citrato_alternativa,
        "diagramacion": {
            "subtitulo": {"color": "#336699", "x": 12.5, "y": 162.0},
        },
    }
    svg, _ = renderizar_svg(datos)
    assert "#336699" in svg
    assert "12.5" in svg and "162" in svg


def test_diagramacion_aplica_escala(citrato_alternativa):
    datos = {
        **citrato_alternativa,
        "diagramacion": {"subtitulo": {"escala": 1.2}},
    }
    svg, _ = renderizar_svg(datos)
    assert re.search(r"font-size:[0-9.]+px", svg)


def _extraer_bloque_descripcion(svg: str, muestra: str) -> str:
    idx = svg.find(muestra)
    if idx < 0 and " " in muestra:
        idx = svg.find(muestra.split()[0])
    if idx < 0:
        m = re.search(r'<text[^>]*data-mckenna-campo="b1"[^>]*>', svg)
        assert m, f"No se encontró {muestra!r} ni bloque b1 en SVG"
        start = m.start()
        end = svg.find("</text>", start) + len("</text>")
        return svg[start:end]
    start = svg.rfind("<text", 0, idx)
    end = svg.find("</text>", idx) + len("</text>")
    return svg[start:end]


def _bloque_tx(bloque: str) -> float:
    m = re.search(r'transform="matrix\(([^)]+)\)"', bloque)
    nums = [float(x) for x in re.findall(r"[-+]?\d*\.?\d+", m.group(1))]
    return nums[4]


def test_meta_bloque_detecta_ancho_util():
    d = {
        "archivo_ai": "CITRATO MAGNESIO 500g.ai",
        "tipo_etiqueta": "500 g",
        "nombre_producto": "X",
    }
    path = buscar_plantilla_ai(d)
    svg = _ai_a_svg(path)
    muestras = _detectar_muestras_ai(svg)
    primera = (muestras.get("_descripcion_lineas") or [""])[0]
    meta = _meta_bloque_descripcion_ai(svg, primera)
    assert meta is not None
    assert meta["max_chars"] <= 50
    assert meta["max_lines"] >= 23
    assert meta["max_width"] < 140


def test_descripcion_incluye_bloque_regulatorio(citrato_alternativa):
    texto = (
        "Materia prima pura de grado alimentario.\n\n"
        "Información Técnica y Regulatoria\n\n"
        "Nota Legal Importante: No es suplemento dietario terminado.\n\n"
        "Estándar de Calidad: USP 32.\n\n"
        "Cumplimiento Normativo (Colombia): Resolución 2674 de 2013, Art. 37-3."
    )
    datos = {**citrato_alternativa, "descripcion_etiqueta": texto}
    svg, meta = renderizar_svg(datos)
    assert meta.get("descripcion_reemplazos", 0) > 0
    assert "USP" in svg
    assert "2674" in svg
    assert "suplemento" in svg.lower()
