"""Autofit real de texto en el motor de render — causa raíz del bug de
aplicación masiva: el texto se sobreponía al elemento siguiente porque
`exportar_raster`/`exportar_pdf` nunca comparaban la altura del texto
contra la altura de su caja."""
from __future__ import annotations

from PIL import Image, ImageDraw

from app.tools import plantillas_visuales as pv


def _medidor():
    return ImageDraw.Draw(Image.new("RGB", (8, 8)))


def test_ajustar_texto_a_caja_no_reduce_si_ya_cabe():
    # Ancho generoso -> siempre 1 línea, sin importar métricas de fuente.
    lineas, _fnt, size, lh, cabe = pv._ajustar_texto_a_caja(
        "Descripción de prueba corta", "400",
        size_base=20.0, lh_base=1.2,
        ancho=1000.0, alto=100.0, ss=1, min_font_size=None, medidor=_medidor(),
    )
    assert cabe is True
    assert size == 20.0
    assert len(lineas) == 1


def test_ajustar_texto_a_caja_reduce_size_hasta_caber():
    # 1 línea garantizada (ancho enorme); alto exige reducir de 20 a <=12.5.
    lineas, _fnt, size, lh, cabe = pv._ajustar_texto_a_caja(
        "Descripción de prueba corta", "400",
        size_base=20.0, lh_base=1.2,
        ancho=1000.0, alto=15.0, ss=1, min_font_size=None, medidor=_medidor(),
    )
    assert cabe is True
    assert size < 20.0
    assert len(lineas) * size * lh <= 15.0 + 1e-6


def test_ajustar_texto_a_caja_marca_no_cabe_al_minimo():
    lineas, _fnt, size, lh, cabe = pv._ajustar_texto_a_caja(
        "Descripción de prueba corta", "400",
        size_base=20.0, lh_base=1.2,
        ancho=1000.0, alto=1.0, ss=1, min_font_size=15.0, medidor=_medidor(),
    )
    assert cabe is False
    assert size >= 15.0


def _doc_texto(*, autofit: bool, content: str, min_font_size=None):
    el = {
        "id": "t1", "type": "text", "x": 5, "y": 5, "width": 60, "height": 20,
        "zIndex": 1, "content": content, "fontSize": 16, "lineHeight": 1.2,
        "fontWeight": "400", "color": "#000000", "align": "left",
        "nombreCapa": "Descripción",
    }
    if autofit:
        el["autofit"] = True
        if min_font_size is not None:
            el["minFontSize"] = min_font_size
    return {
        "formato": {"ancho_px": 100, "alto_px": 50, "dpi": 96},
        "fondo": "#ffffff",
        "elementos": [el],
    }


def test_exportar_raster_sin_autofit_no_reporta_avisos():
    # Plantilla ya guardada (sin campo `autofit`) exporta igual que hoy: sin
    # excepción y sin avisos, aunque el texto sea largo para la caja.
    doc = _doc_texto(
        autofit=False,
        content="Un texto bastante largo que se saldría de la caja diseñada",
    )
    avisos: list = []
    blob = pv.exportar_raster(doc, "png", avisos_out=avisos)
    assert blob
    assert avisos == []


def test_exportar_raster_reporta_avisos_out_cuando_no_cabe():
    doc = _doc_texto(
        autofit=True,
        content=(
            "Un texto extremadamente largo que ni reduciendo la fuente al "
            "minimo configurado va a caber en una caja tan angosta y baja"
        ),
        min_font_size=15,
    )
    avisos: list = []
    blob = pv.exportar_raster(doc, "png", avisos_out=avisos)
    assert blob
    assert len(avisos) == 1
    assert avisos[0]["elemento"] == "t1"
    assert avisos[0]["nombreCapa"] == "Descripción"


def test_nombre_sku_seguro_rechaza_carpetas_reservadas():
    import pytest

    with pytest.raises(ValueError):
        pv._nombre_sku_seguro("etiquetas_nuevas_svg")
    with pytest.raises(ValueError):
        pv._nombre_sku_seguro("")
    assert pv._nombre_sku_seguro("MP-001") == "MP-001"
