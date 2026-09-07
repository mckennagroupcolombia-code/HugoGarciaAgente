"""Aplicación masiva de una plantilla ficha MP a varios SKUs
(`aplicar_plantilla_lote`) — reemplazo real de "repetir el formulario a
mano por producto"."""
from __future__ import annotations

import pytest

from app.tools import plantillas_visuales as pv


@pytest.fixture(autouse=True)
def _aislar_almacenamiento(tmp_path, monkeypatch):
    monkeypatch.setattr(pv, "_DATA_PATH", tmp_path / "plantillas_visuales.json")
    monkeypatch.setattr(pv, "_ASSETS_DIR", tmp_path / "assets")
    monkeypatch.setattr(pv, "_RENDERS_DIR", tmp_path / "renders_etiquetas")


def _plantilla_ficha_mp():
    return {
        "id": "tpl-manteca-cacao",
        "nombre": "MANTECA DE CACAO REFINADA 1000g",
        "categoria": "etiquetas",
        "formato": {"ancho_px": 287, "alto_px": 249, "dpi": 96},
        "fondo": "#ffffff",
        "elementos": [
            {
                "id": "nombre", "type": "text", "x": 10, "y": 10, "width": 260, "height": 30,
                "zIndex": 1, "content": "MANTECA DE CACAO REFINADA", "fontSize": 14,
                "lineHeight": 1.2, "fontWeight": "700", "color": "#000", "align": "left",
                "campoProducto": "nombre", "autofit": True,
            },
            {
                "id": "desc", "type": "text", "x": 10, "y": 45, "width": 260, "height": 40,
                "zIndex": 1, "content": "Descripción por defecto", "fontSize": 8,
                "lineHeight": 1.2, "fontWeight": "400", "color": "#000", "align": "left",
                "campoProducto": "descripcion", "autofit": True, "minFontSize": 5,
            },
            {
                "id": "marca", "type": "text", "x": 10, "y": 220, "width": 260, "height": 15,
                "zIndex": 1, "content": "McKenna Group S.A.S.", "fontSize": 6,
                "lineHeight": 1.2, "fontWeight": "400", "color": "#000", "align": "left",
            },
        ],
        "ficha_mp": {"color": "#3d246b", "tipo_nombre": "MP 76x66", "datos": {}, "estilo": {}},
    }


def test_aplicar_plantilla_lote_rechaza_plantilla_sin_ficha_mp():
    doc = _plantilla_ficha_mp()
    del doc["ficha_mp"]
    pv.guardar_plantilla(doc)
    with pytest.raises(ValueError):
        pv.aplicar_plantilla_lote("tpl-manteca-cacao", [{"sku": "MP-001", "datos": {}}])


def test_aplicar_plantilla_lote_genera_archivo_por_sku():
    pv.guardar_plantilla(_plantilla_ficha_mp())
    productos = [
        {"sku": "MP-001", "datos": {"nombre": "MANTECA DE CACAO REFINADA 1000g", "descripcion": "Uso cosmético."}},
        {"sku": "MP-002", "datos": {"nombre": "MANTECA DE CACAO REFINADA 500g", "descripcion": "Uso alimenticio."}},
    ]
    resultados = pv.aplicar_plantilla_lote("tpl-manteca-cacao", productos)
    assert len(resultados) == 2
    for r, prod in zip(resultados, productos):
        assert r["ok"] is True
        assert r["sku"] == prod["sku"]
        from pathlib import Path

        destino = Path(r["ruta"])
        assert destino.is_file()
        assert destino.parent.name == prod["sku"]
        assert (destino.parent / "ficha_tecnica.json").is_file()


def test_aplicar_plantilla_lote_marca_requiere_revision():
    pv.guardar_plantilla(_plantilla_ficha_mp())
    descripcion_imposible = "Descripción " + ("muy larga " * 60)
    resultados = pv.aplicar_plantilla_lote(
        "tpl-manteca-cacao",
        [{"sku": "MP-003", "datos": {"nombre": "Manteca", "descripcion": descripcion_imposible}}],
    )
    assert resultados[0]["ok"] is True
    assert resultados[0]["requiere_revision"] is True
    assert resultados[0]["motivo"]


def test_aplicar_plantilla_lote_rechaza_sku_reservado():
    pv.guardar_plantilla(_plantilla_ficha_mp())
    resultados = pv.aplicar_plantilla_lote(
        "tpl-manteca-cacao",
        [{"sku": "staging_nuevo_patron", "datos": {}}],
    )
    assert resultados[0]["ok"] is False
