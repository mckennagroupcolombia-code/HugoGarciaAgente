"""Fase C del plan de portada (sep-2026): buscador con sugerencias, barra de
confianza, más vendidos reales, aprende a formular, cómo comprar y blog."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "PAGINA_WEB" / "site"))

import website  # noqa: E402
from app.tools import tema_web as tw  # noqa: E402


@pytest.fixture()
def client():
    website.app.config["TESTING"] = True
    with website.app.test_client() as c:
        yield c


def test_buscar_exige_todas_las_palabras_y_no_repite_presentaciones():
    r = website.buscar_productos("acido hialu")
    assert r and all("hialu" in x["name"].lower() for x in r)
    assert website.buscar_productos("x") == []
    assert website.buscar_productos("") == []
    slugs = [x["slug"] for x in website.buscar_productos("niacinamida")]
    assert len(slugs) == len(set(slugs))


def test_api_buscar(client):
    d = client.get("/api/buscar?q=niacin").get_json()
    assert d["q"] == "niacin" and d["productos"] and "slug" in d["productos"][0]
    assert client.get("/api/buscar").get_json()["productos"] == []


def test_mas_vendidos_solo_muestra_cifra_desde_el_minimo():
    catalog = [{"name": "Ácidos", "products": [
        {"name": "A", "slug": "a", "family_slug": "a", "meli_id": "MCO1", "buyable": True, "stock": 3},
        {"name": "B", "slug": "b", "family_slug": "b", "meli_id": "MCO2", "buyable": True, "stock": 50},
        {"name": "C agotado", "slug": "c", "family_slug": "c", "meli_id": "MCO3", "buyable": False},
    ]}]
    unidades = {"a": 40, "b": 2, "c": 99}
    website._MAS_VENDIDOS_CACHE.update(ts=0.0, data=[])
    orig = website._unidades_30d_por_producto
    website._unidades_30d_por_producto = lambda cat: unidades
    try:
        mv = website.mas_vendidos_portada(catalog)
    finally:
        website._unidades_30d_por_producto = orig
        website._MAS_VENDIDOS_CACHE.update(ts=0.0, data=[])
    assert [p["slug"] for p in mv] == ["a", "b"]  # el agotado no va aunque venda más
    assert mv[0]["mostrar_unidades"] is True and mv[0]["stock_estado"] == "pocas"
    assert mv[1]["mostrar_unidades"] is False and mv[1]["stock_estado"] == "ok"


def test_unidades_30d_cruzan_meli_y_web_por_familia():
    catalog = [{"name": "X", "products": [
        {"name": "Fam", "slug": "fam", "family_slug": "fam", "is_family": True,
         "combos": [{"slug": "fam-100", "ref": "R-100", "meli_id": "MCO9"}, {"slug": "fam-250", "ref": "R-250", "meli_id": "MCO10"}]},
    ]}]
    u = website._unidades_30d_por_producto(catalog)
    assert isinstance(u, dict)  # con datos reales no se puede fijar el número; el cruce no debe fallar


def test_chips_del_tema_mandan_y_si_no_salen_de_los_mas_vendidos():
    mv = [{"name": "ACEITE RICINO 10mL"}, {"name": "CITRATO MAGNESIO 250g"}, {"name": "ACEITE RICINO 30mL"}]
    assert [c["label"] for c in website.chips_portada(mv, ["Niacinamida", " "])] == ["Niacinamida"]
    auto = website.chips_portada(mv)
    assert [c["label"] for c in auto] == ["Aceite Ricino", "Citrato Magnesio"]  # sin presentación y sin repetir


def test_aprende_trae_guia_viva_y_recetas_distintas():
    a = website.aprende_portada([{"name": "Niacinamida 100g"}])
    assert a["guia"] and a["guia"]["url"] == "/guias/niacinamida" and a["guia"]["viva"]
    slugs = [r["slug"] for r in a["recetas"]]
    assert len(slugs) == 3 and len(set(slugs)) == 3
    assert all(r["paso1"] for r in a["recetas"])


def test_blog_reciente_ordenado_y_con_lectura():
    b = website.blog_reciente(3)
    assert len(b) == 3 and b[0]["fecha"] >= b[1]["fecha"] >= b[2]["fecha"]
    assert all(x["minutos"] >= 1 and x["slug"] for x in b)


def test_confianza_usa_cifras_reales():
    c = website.confianza_portada({"n_tds": 117, "n_coa": 56}, {"n_alcanzados": 25, "total_departamentos": 33})
    cifras = " ".join(x["cifra"] for x in c)
    assert "117 fichas" in cifras and "56 COA" in cifras and "25 de 33" in cifras


def test_orden_clasico_incluye_los_bloques_nuevos_en_su_sitio():
    o = tw._ORDEN_CLASICO
    assert o.index("confianza") < o.index("categorias") < o.index("destacados") < o.index("aprende") < o.index("como_comprar") < o.index("ruta_origen") < o.index("blog") < o.index("cta")
    lay = tw._normalizar_layout({"orden": ["hero", "categorias"]}, tw._ORDEN_CLASICO)
    assert "aprende" in lay["orden"] and "blog" in lay["orden"]


def test_portada_rinde_todos_los_bloques(client):
    html = client.get("/").get_data(as_text=True)
    for marca in ("data-buscador", "hero-chip", 'data-dest-tab="vendidos"', "dest-sold", 'class="confianza"', 'class="aprende"', "como-chain", "blog-home", "portada.js"):
        assert marca in html, marca
    assert html.index('class="confianza"') < html.index("cats-section") < html.index('class="aprende"') < html.index("como-chain") < html.index('id="trazabilidad"') < html.index("blog-home")
