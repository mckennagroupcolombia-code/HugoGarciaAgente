"""Fase D del plan de portada (sep-2026): trazabilidad condensada en la portada
(una sección, pestañas Mundo / Colombia) y página completa en /trazabilidad."""

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


def test_portada_trae_una_sola_seccion_de_trazabilidad_con_pestanas(client):
    html = client.get("/").get_data(as_text=True)
    assert html.count('id="trazabilidad"') == 1
    assert 'id="cobertura"' not in html  # ya no es sección propia
    assert 'data-tzc-tab="mundo"' in html and 'data-tzc-tab="colombia"' in html
    assert 'data-tzc-panel="colombia" hidden' in html
    assert 'href="/trazabilidad"' in html
    # lo pesado se fue a la página completa
    assert "tz-docs" not in html and "co-pending" not in html and "tz-chain" not in html.split('id="trazabilidad"')[1].split("blog-home")[0]
    # los datos de interacción y la geometría diferida siguen
    assert "data-tz-data" in html and "data-co-data" in html and html.count("data-lazy-svg") == 2


def test_pagina_trazabilidad_completa(client):
    r = client.get("/trazabilidad")
    assert r.status_code == 200
    html = r.get_data(as_text=True)
    for marca in ('id="trazabilidad"', 'id="cobertura"', "tz-docs", "co-pending", "tz-chain", "tz-cta"):
        assert marca in html, marca
    assert html.count("data-lazy-svg") == 2


def test_sitemap_y_tema(client):
    assert "/trazabilidad<" in client.get("/sitemap.xml").get_data(as_text=True)
    assert "cobertura" not in tw._ORDEN_CLASICO and "ruta_origen" in tw._ORDEN_CLASICO
    lay = tw._normalizar_layout({"orden": ["hero", "cobertura"]}, tw._ORDEN_CLASICO)
    assert lay["orden"][1] == "cobertura"  # si alguien la deja en su JSON no se rompe, solo no renderiza en el Clásico


def test_partial_completo_sigue_igual_para_pureza():
    """Sin la bandera `compacto`, los parciales rinden la versión completa."""
    from flask import render_template

    with website.app.test_request_context("/"):
        catalog = website.get_catalog()
        html = render_template("_cobertura.html", colombia=website._construir_colombia_mapa(), compacto=False)
        assert 'id="cobertura"' in html and "co-head" in html
        html = render_template("_ruta_origen.html", ruta_origen=website._construir_ruta_origen(catalog), colombia=website._construir_colombia_mapa(), compacto=True)
        assert 'class="tz-compact"' in html and "tz-head" not in html and "tz-docs" not in html
