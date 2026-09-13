"""Fase 3 del plan de guías vivas (sep-2026): cruces producto ↔ guía ↔ receta."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "PAGINA_WEB" / "site"))

import website  # noqa: E402


def test_vitamina_c_no_enlaza_la_guia_de_vitamina_e():
    c = website.contenido_para_producto(["VITAMINA C ACIDO ASCORBICO 250g"])
    assert [g["titulo"] for g in c["guias"]] == ["Ácido Ascórbico"]
    e = website.contenido_para_producto(["VITAMINA E 30mL"])
    assert [g["titulo"] for g in e["guias"]] == ["Vitamina E"]


def test_contenido_para_producto_trae_datos_para_tarjetas():
    c = website.contenido_para_producto(["Ácido Kójico 30ml"])
    assert c["guias"] and c["guias"][0]["url"] == "/guias/acido-kojico"
    g = c["guias"][0]
    assert g["viva"] is True and g["conc_max_pct"] and g["ph"] and g["n_faq"] >= 1
    n = website.contenido_para_producto(["Niacinamida 100g"])
    assert n["recetas"], "la niacinamida aparece en varias recetas"
    r = n["recetas"][0]
    assert r["url"].startswith("/recetario/") and r["paso1"] and r["n_pasos"] >= 1 and r["titulo2"]


def test_contenido_para_producto_une_nombres_sin_repetir():
    c = website.contenido_para_producto(["Niacinamida 100g", "NIACINAMIDA 500g", "", None])
    urls = [g["url"] for g in c["guias"]] + [r["url"] for r in c["recetas"]]
    assert len(urls) == len(set(urls))


def test_guias_para_receta_cruza_por_ingrediente_y_producto():
    receta = {"ings": [
        {"n": "Vitamina C (ác. ascórbico)", "producto": "VITAMINA C ACIDO ASCORBICO 250g"},
        {"n": "Agua destilada", "propio": True},
        {"n": "Aloe vera 90%"},
    ]}
    guias = website.guias_para_receta(receta)
    titulos = [g["titulo"] for g in guias]
    assert "Ácido Ascórbico" in titulos and "Vitamina E" not in titulos
    assert any(g["ingrediente"] == "Vitamina C (ác. ascórbico)" for g in guias)


def test_recetas_para_guia():
    recetas = website.recetas_para_guia({"title_short": "Niacinamida"})
    assert recetas and all(r["url"].startswith("/recetario/") for r in recetas)
    assert website.recetas_para_guia({"title_short": "Ingrediente Inexistente Zzz"}) == []


@pytest.fixture()
def client():
    website.app.config["TESTING"] = True
    with website.app.test_client() as c:
        yield c


def test_producto_muestra_seccion_aprende_a_usarlo(client):
    p = next((x for s in website.get_catalog() for x in s["products"] if "niacinamida" in (x.get("name") or "").lower()), None)
    assert p, "no hay niacinamida en el catálogo"
    html = client.get(f"/producto/{p['slug']}", follow_redirects=True).get_data(as_text=True)
    assert "Aprende a usarlo" in html
    assert "/guias/niacinamida" in html
    assert "Preparar paso a paso" in html


def test_receta_enlaza_guias_de_sus_activos(client):
    r = website._cargar_recetas()[0]
    html = client.get(f"/recetario/{r['slug']}").get_data(as_text=True)
    assert "Guías vivas de los activos" in html
    assert "/guias/acido-ascorbico" in html


def test_guia_viva_lista_recetas_que_la_usan(client):
    html = client.get("/guias/niacinamida").get_data(as_text=True)
    assert 'id="recetas"' in html
    assert html.count("gv-rc ") >= 1
