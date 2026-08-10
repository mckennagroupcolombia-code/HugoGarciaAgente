"""Líneas comerciales oficiales y color de acento por categoría."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "PAGINA_WEB" / "site"))

import website as web  # noqa: E402


def test_colores_oficiales_de_linea():
    assert web.color_categoria("Cosmética") == "#990099"
    assert web.color_categoria("cosmetica") == "#990099"
    assert web.color_categoria("Aceites, ceras y grasas") == "#FFA500"
    assert web.color_categoria("ACEITES CERAS Y GRASAS") == "#FFA500"
    assert web.color_categoria("Alimentario") == "#1F91DC"
    assert web.color_categoria("Industria") == "#5C6570"
    assert web.color_categoria("Laboratorio") == "#10173C"
    assert web.color_categoria("Agro") == "#359441"


def test_subcategoria_hereda_color_de_linea():
    assert web.color_categoria("Humectantes") == "#990099"
    assert web.color_categoria("Aceites") == "#FFA500"
    assert web.color_categoria("Ceras y Mantecas") == "#FFA500"
    assert web.color_categoria("Edulcorantes") == "#1F91DC"
    assert web.color_categoria("Equipos y Materiales") == "#10173C"
    assert web.color_categoria("Agrícola") == "#359441"
    assert web.color_categoria("Otros") == "#5C6570"
    assert web.color_categoria(None) == "#5C6570"


def test_lineas_desde_catalogo_cuenta_fichas():
    catalog = [
        {"name": "Aceites", "products": [{}, {}]},
        {"name": "Humectantes", "products": [{}]},
        {"name": "Agrícola", "products": [{}, {}, {}]},
    ]
    lineas = web.lineas_desde_catalogo(catalog)
    assert [L["id"] for L in lineas] == [
        "cosmetica",
        "aceites-ceras-grasas",
        "alimentario",
        "industria",
        "laboratorio",
        "agro",
    ]
    by_id = {L["id"]: L for L in lineas}
    assert by_id["aceites-ceras-grasas"]["n_productos"] == 2
    assert by_id["cosmetica"]["n_productos"] == 1
    assert by_id["agro"]["n_productos"] == 3
    assert by_id["aceites-ceras-grasas"]["color"] == "#FFA500"


def test_seccion_catalogo_lleva_color_de_linea():
    combos = [
        {
            "name": "ACEITE NEEM 60mL",
            "ref": "C-NEEM60",
            "slug": "c-neem60",
            "precio": "$10.000",
            "precio_meli": "$12.000",
            "precio_num": 10000,
            "lista_num": 12000,
            "ahorro": "$2.000",
            "ahorro_num": 2000,
            "stock": 5,
            "buyable": True,
            "cat": "Aceites",
            "cat_color": "#FFA500",
            "photo": "",
            "meli_id": "",
            "desc": "",
            "ficha": None,
            "is_combo": True,
        }
    ]
    sections = web._catalog_sections_from_combos(combos)
    aceites = next(s for s in sections if s["name"] == "Aceites")
    assert aceites["color"] == "#FFA500"
