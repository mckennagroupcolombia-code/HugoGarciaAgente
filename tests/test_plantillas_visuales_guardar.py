"""Fidelidad geométrica al guardar plantillas visuales (Studio)."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.tools import plantillas_visuales as pv


@pytest.fixture(autouse=True)
def _aislar_json_plantillas(tmp_path, monkeypatch):
    data_path = tmp_path / "plantillas_visuales.json"
    assets_dir = tmp_path / "assets"
    monkeypatch.setattr(pv, "_DATA_PATH", data_path)
    monkeypatch.setattr(pv, "_ASSETS_DIR", assets_dir)


def test_guardar_plantilla_preserva_posicion_y_tamano_elementos():
    doc = {
        "id": "tpl-test",
        "nombre": "Prueba fidelidad",
        "categoria": "etiquetas",
        "formato": {
            "id": "etiquetas-250g",
            "nombre": "250 g",
            "ancho_px": 287,
            "alto_px": 249,
            "ancho_mm": 76,
            "alto_mm": 66,
            "dpi": 96,
        },
        "fondo": "#ffffff",
        "elementos": [
            {
                "id": "t1",
                "type": "text",
                "x": 6.596532235465071,
                "y": 48.10904217324702,
                "width": 184.0865515579857,
                "height": 197.43075299329936,
                "rotation": 0,
                "zIndex": 1,
                "content": "Descripción",
                "fontSize": 5.75,
                "fontFamily": '"Montserrat", system-ui, sans-serif',
                "fontWeight": "500",
                "color": "#0f172a",
                "align": "justify",
                "textRole": "descripcion",
            },
            {
                "id": "l1",
                "type": "line",
                "x": 198.04005739314638,
                "y": 241.0551115091732,
                "x2": 198.04005739314638,
                "y2": 48.807783690003276,
                "width": 192.24732781916993,
                "height": 4,
                "rotation": 0,
                "zIndex": 20,
                "stroke": "#0396f1",
                "strokeWidth": 1,
            },
        ],
    }

    guardada = pv.guardar_plantilla(doc)
    assert guardada["elementos"] == doc["elementos"]

    recargada = pv.obtener_plantilla("tpl-test")
    assert recargada is not None
    assert recargada["elementos"] == doc["elementos"]

    raw = json.loads(pv._DATA_PATH.read_text(encoding="utf-8"))
    assert raw["plantillas"][0]["elementos"] == doc["elementos"]


def test_guardar_plantilla_preserva_ficha_mp():
    ficha = {
        "color": "#3d246b",
        "tipo_nombre": "Ficha MP",
        "datos": {"abreviatura": "SCI", "nombre": "Cocoil"},
        "estilo": {"tipoTitulo": 1.2, "tamIconos": 0.9},
    }
    doc = {
        "id": "tpl-ficha",
        "nombre": "SCI 250 g",
        "categoria": "etiquetas",
        "formato": {"id": "ficha-mp", "nombre": "Ficha MP", "ancho_px": 340, "alto_px": 529, "dpi": 96},
        "fondo": "#ffffff",
        "elementos": [],
        "ficha_mp": ficha,
    }
    guardada = pv.guardar_plantilla(doc)
    assert guardada["ficha_mp"] == ficha

    sin_ficha = {**doc, "nombre": "SCI 250 g v2"}
    sin_ficha.pop("ficha_mp")
    otra = pv.guardar_plantilla(sin_ficha)
    assert otra["ficha_mp"] == ficha
    assert otra["nombre"] == "SCI 250 g v2"
