"""Formulario de etiqueta física: cajas fijas, datos desde ficha técnica."""
from __future__ import annotations

import copy
import io
import json
from pathlib import Path

from PIL import Image, ImageDraw

from app.tools import plantillas_visuales as pv

REPO = Path(__file__).resolve().parents[1]
PLANTILLAS = REPO / "app/data/plantillas_visuales.json"
OUT = REPO / "app/data/verificacion_formulario_manteca"
MANTECA_ID = "24191d5d-bea"


def _manteca():
    data = json.loads(PLANTILLAS.read_text(encoding="utf-8"))
    return copy.deepcopy(next(p for p in data["plantillas"] if p["id"] == MANTECA_ID))


def test_manteca_es_formulario_con_cajas_variables():
    doc = _manteca()
    assert doc.get("formulario") is True
    campos = {
        el["campoProducto"]
        for el in doc["elementos"]
        if el.get("type") == "text" and el.get("campoProducto")
    }
    assert campos >= {
        "nombre", "tagline", "concentracionValor", "casNumero", "origen",
        "apariencia", "olor", "composicion", "grado", "almacenamiento", "peso", "ghs",
    }
    for el in doc["elementos"]:
        if el.get("campoProducto"):
            assert el.get("autofit") is True


def test_exportar_manteca_original_sin_avisos():
    avisos: list = []
    blob = pv.exportar_raster(_manteca(), "png", avisos_out=avisos)
    assert blob[:8] == b"\x89PNG\r\n\x1a\n"
    assert avisos == []


def test_autofit_apariencia_larga_cabe_en_caja():
    doc = _manteca()
    caja = next(el for el in doc["elementos"] if el.get("campoProducto") == "apariencia")
    largo = str(caja["content"]) + " al tacto"
    medidor = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    lineas, _fnt, size, lh, cabe = pv._ajustar_texto_a_caja(
        largo,
        str(caja.get("fontWeight") or "600"),
        size_base=float(caja["fontSize"]),
        lh_base=float(caja.get("lineHeight") or 1.2),
        ancho=float(caja["width"]),
        alto=float(caja["height"]),
        ss=1,
        min_font_size=caja.get("minFontSize"),
        medidor=medidor,
    )
    assert cabe is True
    assert size < float(caja["fontSize"])
    assert size * lh * len(lineas) <= float(caja["height"]) + 1e-6


def test_posiciones_no_cambian_al_rellenar():
    base = _manteca()
    geo = {
        el["id"]: (el["x"], el["y"], el["width"], el["height"], el.get("fontSize"))
        for el in base["elementos"]
    }
    pv._aplicar_datos_producto_a_elementos(
        base["elementos"],
        {
            "nombre": "UREA COSMETICA\nGRADO ALIMENTARIO",
            "apariencia": "Polvo cristalino blanco inodoro de granulometría fina",
            "peso": "500g",
        },
    )
    for el in base["elementos"]:
        assert (el["x"], el["y"], el["width"], el["height"], el.get("fontSize")) == geo[el["id"]]


def test_cajas_variables_no_se_solapan():
    doc = _manteca()
    cajas = [
        el
        for el in doc["elementos"]
        if el.get("type") == "text" and el.get("visible", True) is not False and el.get("campoProducto")
    ]
    for i, a in enumerate(cajas):
        ax2, ay2 = a["x"] + a["width"], a["y"] + a["height"]
        for b in cajas[i + 1 :]:
            bx2, by2 = b["x"] + b["width"], b["y"] + b["height"]
            solapa = not (
                ax2 <= b["x"] + 0.5
                or bx2 <= a["x"] + 0.5
                or ay2 <= b["y"] + 0.5
                or by2 <= a["y"] + 0.5
            )
            assert not solapa, f"{a['campoProducto']} solapa {b['campoProducto']}"
    tag = next(el for el in cajas if el["campoProducto"] == "tagline")
    assert tag["x"] + tag["width"] <= 165.5  # borde derecho de la barra naranja
    assert tag["y"] + tag["height"] <= 76.0  # no pisa ORIGEN


def test_exportar_manteca_comparacion_visual():
    OUT.mkdir(parents=True, exist_ok=True)
    orig = pv.exportar_raster(_manteca(), "png")
    (OUT / "manteca_original.png").write_bytes(orig)
    doc = _manteca()
    pv._aplicar_datos_producto_a_elementos(
        doc["elementos"],
        {
            "nombre": "UREA COSMETICA\nGRADO ALIMENTARIO",
            "tagline": "MATERIA PRIMA GRADO ALIMENTARIO",
            "concentracionValor": "99%",
            "casNumero": "57-13-6",
            "origen": "China",
            "apariencia": "Cristales blancos o ligeramente amarillentos, inodoros",
            "olor": "Inodoro",
            "composicion": "Urea",
            "grado": "Alimentario",
            "almacenamiento": "Lugar fresco y seco, envase bien cerrado.",
            "peso": "500g",
            "ghs": "NO GHS",
        },
    )
    avisos: list = []
    otra = pv.exportar_raster(doc, "png", avisos_out=avisos)
    (OUT / "manteca_urea_autofit.png").write_bytes(otra)
    assert Image.open(io.BytesIO(orig)).size == Image.open(io.BytesIO(otra)).size
    assert avisos == []
