"""Layout de etiqueta: fracciones → px del lienzo elegido."""
from __future__ import annotations

from app.tools.plantillas_etiqueta_vision import layout_a_elementos, materializar_plantilla_layout


def test_layout_a_elementos_escala_fracciones_al_canvas():
    raw = [
        {
            "type": "text",
            "x": 0.1,
            "y": 0.2,
            "w": 0.8,
            "h": 0.1,
            "content": "CREATINA",
            "fontSize": 0.05,
            "fontWeight": "800",
            "align": "center",
            "color": "#0b4199",
        },
        {
            "type": "line",
            "x": 0.05,
            "y": 0.5,
            "x2": 0.95,
            "y2": 0.5,
            "stroke": "#0b4199",
            "strokeWidth": 1,
        },
        {
            "type": "rect",
            "x": 0,
            "y": 0,
            "w": 1,
            "h": 0.15,
            "fill": "#ffffff",
            "stroke": "#000000",
            "strokeWidth": 1,
        },
    ]
    els = layout_a_elementos(raw, 200, 400)
    assert len(els) == 3
    text = next(e for e in els if e["type"] == "text")
    assert text["x"] == 20.0
    assert text["y"] == 80.0
    assert text["width"] == 160.0
    assert text["height"] == 40.0
    assert text["fontSize"] == 20.0  # 0.05 * 400
    assert text["content"] == "CREATINA"
    line = next(e for e in els if e["type"] == "line")
    assert line["x"] == 10.0
    assert line["x2"] == 190.0
    rect = next(e for e in els if e["type"] == "rect")
    assert rect["width"] == 200.0
    assert rect["height"] == 60.0


def test_materializar_respeta_canvas_distinto():
    raw = {
        "nombre": "Prod",
        "fondo": "#fff",
        "elementos": [
            {"type": "text", "x": 0, "y": 0, "w": 1, "h": 0.2, "content": "A", "fontSize": 0.1},
        ],
    }
    a = materializar_plantilla_layout(raw, 100, 100)
    b = materializar_plantilla_layout(raw, 300, 150)
    assert a["elementos"][0]["width"] == 100.0
    assert b["elementos"][0]["width"] == 300.0
    assert a["elementos"][0]["fontSize"] == 10.0
    assert b["elementos"][0]["fontSize"] == 15.0  # 0.1 * 150
