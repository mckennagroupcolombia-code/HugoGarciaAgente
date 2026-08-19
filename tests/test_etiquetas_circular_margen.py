"""Margen de troquel circular: el título en arco no debe llegar al borde."""
from __future__ import annotations

from app.tools.etiquetas_studio import (
    MARGEN_SEGURO_CIRCULAR_MM,
    caja_imagen_pdf_etiqueta,
    dims_pagina_impresion_mm,
    es_tipo_etiqueta_circular,
    mm_troquel_circular,
    page_size_cups_mm,
)


def test_detecta_circular_por_nombre():
    assert es_tipo_etiqueta_circular("Circular")
    assert es_tipo_etiqueta_circular("Circular 50")
    assert es_tipo_etiqueta_circular("Circle 50")
    assert es_tipo_etiqueta_circular("Circular 70")
    assert not es_tipo_etiqueta_circular("125 g", 70, 70)
    assert not es_tipo_etiqueta_circular("250 g", 76, 66)


def test_detecta_circular_cuadrado_50_56_mm():
    assert es_tipo_etiqueta_circular("Personalizado", 50, 50)
    assert es_tipo_etiqueta_circular("", 53, 53)
    assert es_tipo_etiqueta_circular(None, 55, 55)
    assert not es_tipo_etiqueta_circular("Personalizado", 70, 70)


def test_personalizado_53_imprime_como_circular_50():
    """53 mm = 50 mm de troquel + gap. Diecut_Gap no admite el gap en PageSize."""
    assert mm_troquel_circular("Personalizado", 53, 53) == (50.0, 50.0)
    assert dims_pagina_impresion_mm("Personalizado", 53, 53) == (50.0, 50.0)
    assert mm_troquel_circular("Circular 50", 53, 53) == (50.0, 50.0)
    assert mm_troquel_circular("Circular", 55, 55) == (55.0, 55.0)
    assert mm_troquel_circular("125 g", 70, 70) is None
    assert dims_pagina_impresion_mm("125 g", 70, 70) == (70.0, 70.0)
    assert dims_pagina_impresion_mm("250 g", 76, 66) == (76.0, 66.0)


def test_circle_2_12_in_imprime_como_circular_50():
    """PNG CIRCLE 53.9 mm (2.12 in) es pitch 50 + gap; PageSize 55 mm avanza 2 blancas."""
    assert mm_troquel_circular("CIRCLE", 53.9, 53.9) == (50.0, 50.0)
    assert dims_pagina_impresion_mm("CIRCLE", 53.9, 53.9) == (50.0, 50.0)
    assert mm_troquel_circular("circle", 53.8, 53.8) == (50.0, 50.0)
    assert page_size_cups_mm(*dims_pagina_impresion_mm("CIRCLE", 53.9, 53.9)) == "Custom.50x50mm"
    assert mm_troquel_circular("Circular", 55, 55) == (55.0, 55.0)


def test_page_size_cups_sin_decimales_enteros():
    assert page_size_cups_mm(50.0, 50.0) == "Custom.50x50mm"
    assert page_size_cups_mm(53.0, 53.0) == "Custom.53x53mm"
    assert page_size_cups_mm(76.0, 66.0) == "Custom.76x66mm"


def test_caja_pdf_circular_deja_margen_simetrico():
    page = 55 * 2.83465
    x, y, w, h = caja_imagen_pdf_etiqueta(page, page, "Circular", 55, 55)
    assert x > 0 and y > 0
    assert w < page and h < page
    pt = 2.83465
    lado = MARGEN_SEGURO_CIRCULAR_MM * pt
    assert abs(x - lado) < 0.2
    assert abs(y - lado) < 0.2
    assert abs((page - w) / 2 - lado) < 0.2
    # Simétrico: el extra superior metía LOT/tinta en el gap y saltaba etiquetas.
    assert abs((page - (y + h)) - y) < 0.2


def test_caja_pdf_personalizado_50_es_circular():
    page = 50 * 2.83465
    x, y, w, h = caja_imagen_pdf_etiqueta(page, page, "Personalizado", 50, 50)
    assert x > 0 and w < page and h < page
    assert abs((page - (y + h)) - y) < 0.2


def test_caja_pdf_circular_50_deja_margen():
    page = 50 * 2.83465
    x, y, w, h = caja_imagen_pdf_etiqueta(page, page, "Circular 50", 50, 50)
    assert x > 0 and w < page
    x2, y2, w2, h2 = caja_imagen_pdf_etiqueta(page, page, "Circle 50", 50, 50)
    assert (x2, y2, w2, h2) == (x, y, w, h)
    page_w, page_h = 76 * 2.83465, 66 * 2.83465
    x, y, w, h = caja_imagen_pdf_etiqueta(page_w, page_h, "250 g", 76, 66)
    assert (x, y, w, h) == (0.0, 0.0, page_w, page_h)


def test_encajar_svg_circular_reduce_escala():
    from app.tools.etiquetas_ai_engine import _encajar_svg_en_marco_formato

    svg = '<svg viewBox="0 0 55 55"><circle cx="27.5" cy="27.5" r="27.5"/></svg>'
    out = _encajar_svg_en_marco_formato(svg, 55, 55, tipo="Circular")
    assert "scale(" in out
    # Con margen 3.5 mm a cada lado, escala < 1
    assert "scale(1.000000)" not in out
    out50 = _encajar_svg_en_marco_formato(svg, 50, 50, tipo="Circular 50")
    assert "scale(1.000000)" not in out50
    out_circle = _encajar_svg_en_marco_formato(svg, 50, 50, tipo="Circle 50")
    assert "scale(1.000000)" not in out_circle
    rect = _encajar_svg_en_marco_formato(svg, 76, 66, tipo="250 g")
    assert "scale(1.000000)" in rect or "scale(1.2" in rect  # 76/55 > 1, contain by height 66/55
