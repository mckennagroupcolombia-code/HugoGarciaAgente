"""Tienda web agrupada y nombrada como el Árbol del producto (28-sep-2026)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "PAGINA_WEB" / "site"))

import website as web  # noqa: E402


def _combo_arbol(name: str, ref: str, cat: str = "Ácidos", precio: int = 10000) -> dict:
    return {
        "name": name, "ref": ref, "slug": ref.lower(), "precio": f"${precio}", "precio_meli": "",
        "precio_num": precio, "lista_num": precio, "ahorro": "", "ahorro_num": 0, "stock": 5,
        "buyable": True, "cat": cat, "cat_color": "#000", "photo": "", "meli_id": "", "desc": "",
        "ficha": None, "is_combo": True,
    }


def _con_arbol(monkeypatch, tmp_path, datos: dict | None):
    f = tmp_path / "familias_arbol.json"
    if datos is not None:
        f.write_text(json.dumps(datos), encoding="utf-8")
    monkeypatch.setattr(web, "FAMILIAS_ARBOL_FILE", f)
def test_arbol_une_nombres_distintos_de_la_misma_materia_prima(monkeypatch, tmp_path):
    _con_arbol(monkeypatch, tmp_path, {
        "C-ACISAL100G": {"familia": "ACISALg", "nombre": "ÁCIDO SALICÍLICO"},
        "C-ACISAL500G": {"familia": "ACISALg", "nombre": "ÁCIDO SALICÍLICO"},
    })
    cards = web._agrupar_combos_por_presentacion(
        [_combo_arbol("ACISAL100g", "C-ACISAL100g"), _combo_arbol("ACIDO SALICILICO 500g", "C-ACISAL500g", precio=30000)],
        set(),
    )
    assert len(cards) == 1
    assert cards[0]["is_family"] and cards[0]["name"] == "Ácido Salicílico"


def test_arbol_no_separa_alias_que_no_esta_en_el_arbol(monkeypatch, tmp_path):
    """DEXKg (alias sin C-) no está en el árbol; C-DEXKg sí: siguen siendo una tarjeta."""
    _con_arbol(monkeypatch, tmp_path, {"C-DEXKG": {"familia": "DEXg", "nombre": "DEXTROSA"}})
    cards = web._agrupar_combos_por_presentacion(
        [_combo_arbol("DEXTROSA Kg", "C-DEXKg", "Edulcorantes"), _combo_arbol("DEXTROSA Kg", "DEXKg", "Edulcorantes")],
        set(),
    )
    assert len(cards) == 1


def test_arbol_renombra_sin_tocar_el_combo_original(monkeypatch, tmp_path):
    _con_arbol(monkeypatch, tmp_path, {"C-ACDLAC85P30ML": {"familia": "ACILACmL", "nombre": "ÁCIDO LÁCTICO"}})
    combo = _combo_arbol("ACIDO LACTICO 85% 30mL", "C-ACDLAC85P30mL")
    cards = web._agrupar_combos_por_presentacion([combo], set())
    assert cards[0]["name"] == "Ácido Láctico 85% 30mL"   # conserva la concentración
    assert combo["name"] == "ACIDO LACTICO 85% 30mL"       # cache.json y el cruce MeLi no cambian


def test_sin_archivo_del_arbol_agrupa_como_antes(monkeypatch, tmp_path):
    _con_arbol(monkeypatch, tmp_path, None)
    cards = web._agrupar_combos_por_presentacion([_combo_arbol("ACISAL100g", "C-ACISAL100g")], set())
    assert cards[0]["name"] == "ACISAL100g"


def test_secciones_en_orden_alfabetico_sin_que_la_tilde_mande_al_final(monkeypatch, tmp_path):
    _con_arbol(monkeypatch, tmp_path, None)
    monkeypatch.setattr(web, "_filtrar_combos_publicados_meli", lambda c: c)
    secs = web._catalog_sections_from_combos([
        _combo_arbol("ZINC OXIDO 100g", "C-ZIN100g", "Otros"),
        _combo_arbol("ACIDO MALICO 100g", "C-MAL100g", "Ácidos"),
        _combo_arbol("ACEITE NEEM 60mL", "C-NEE60mL", "Aceites"),
        _combo_arbol("Ácido ascórbico 100g", "C-ASC100g", "Ácidos"),
    ])
    assert [s["name"] for s in secs] == ["Aceites", "Ácidos", "Otros"]
    assert [p["name"] for p in secs[1]["products"]] == ["Ácido ascórbico 100g", "ACIDO MALICO 100g"]


def test_title_catalog_guion_y_siglas():
    assert web._title_catalog_es("L-ARGININA BASE") == "L-Arginina Base"
    assert web._title_catalog_es("AMINOÁCIDO BCAA INSTANT (M)") == "Aminoácido BCAA Instant (M)"


def test_seo_producto_familia_con_rango_de_precios(monkeypatch, tmp_path):
    monkeypatch.setattr(web, "SEO_PRODUCTOS_FILE", tmp_path / "no-existe.json")
    p = {"slug": "psyllium-en-escamas", "name": "Psyllium", "ref": "C-PSYESC250g", "cat": "Frutos secos y semillas",
         "is_family": True, "n_presentaciones": 2, "buyable": True,
         "combos": [{"precio_num": 27900}, {"precio_num": 51300}]}
    seo = web._producto_seo(p, ["/imagenes-productos-catalogo/C-PSYESC250g.png"])
    assert seo["canonical"] == f"{web.SITE_URL}/producto/psyllium-en-escamas"
    tipos = [d["@type"] for d in seo["jsonld"]]
    assert tipos == ["BreadcrumbList", "Product"]
    oferta = seo["jsonld"][1]["offers"]
    assert (oferta["@type"], oferta["lowPrice"], oferta["highPrice"]) == ("AggregateOffer", 27900, 51300)
    assert "gtin13" not in seo["jsonld"][1]   # EAN internos, no GS1
    assert seo["jsonld"][1]["image"][0].startswith("https://")


def test_seo_sin_precio_no_declara_product():
    seo = web._producto_seo({"slug": "x", "name": "X", "solo_vitrina": True}, [])
    assert [d["@type"] for d in seo["jsonld"]] == ["BreadcrumbList"]


def test_receta_cruzada_no_borra_un_producto(monkeypatch, tmp_path):
    """C-AMILCAR100g (L-Carnitina) apuntaba a la materia prima de L-Teanina: unirlas borraba
    la carnitina en el dedupe por tamaño. Con el mismo tamaño en los dos grupos no se unen."""
    _con_arbol(monkeypatch, tmp_path, {
        "C-AMILCAR100G": {"familia": "AMITEAg", "nombre": "L TEANINA"},
        "C-LTEA100G": {"familia": "AMITEAg", "nombre": "L TEANINA"},
    })
    cards = web._agrupar_combos_por_presentacion(
        [_combo_arbol("AMINOACIDO L CARNITINA 100g", "C-AMILCAR100g", "Suplementarios"),
         _combo_arbol("L TEANINA 100g", "C-LTEA100g", "Suplementarios")],
        set(),
    )
    assert sorted(c["ref"] for c in cards) == ["C-AMILCAR100g", "C-LTEA100g"]
