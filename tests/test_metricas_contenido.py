"""Métricas de uso de recetas y guías vivas (Fase 4 del plan de guías vivas)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "PAGINA_WEB" / "site"))

from app.services import metricas_contenido as mc  # noqa: E402


@pytest.fixture()
def db(tmp_path, monkeypatch):
    path = tmp_path / "metricas.db"
    monkeypatch.setattr(mc, "DB_PATH", path)
    return path


def test_registrar_solo_eventos_de_la_lista(db):
    assert mc.registrar("receta_abierta", slug="serum", sesion="s1") is True
    assert mc.registrar("evento_inventado", slug="x", sesion="s1") is False
    assert mc.registrar("", slug="x") is False
    r = mc.resumen(7)
    assert r["totales"] == {"receta_abierta": 1}


def test_embudo_cuenta_sesiones_no_eventos(db):
    # una misma sesión repite pasos: cuenta una vez en el embudo
    for _ in range(3):
        mc.registrar("receta_abierta", slug="serum", sesion="a")
    mc.registrar("receta_paso", slug="serum", sesion="a", detalle="1")
    mc.registrar("receta_paso", slug="serum", sesion="a", detalle="2")
    mc.registrar("receta_terminada", slug="serum", sesion="a")
    mc.registrar("receta_carrito", slug="serum", sesion="a", detalle="2")
    mc.registrar("receta_abierta", slug="serum", sesion="b")
    mc.registrar("receta_abierta", slug="crema", sesion="c")
    r = mc.resumen(7)
    assert r["embudo"] == {"abrieron": 3, "empezaron": 1, "terminaron": 1, "al_carrito": 1, "unidades_al_carrito": 2}
    assert r["totales"]["receta_abierta"] == 5
    assert r["recetas"][0] == {"slug": "serum", "abiertas": 2, "terminadas": 1, "carrito": 1}
    assert r["serie"] and r["serie"][-1]["recetas"] == 3 and r["serie"][-1]["carrito"] == 1


def test_ranking_guias_y_productos(db):
    mc.registrar("guia_abierta", slug="acido-kojico", sesion="a")
    mc.registrar("guia_dosificador", slug="acido-kojico", sesion="a")
    mc.registrar("guia_dosificador", slug="acido-kojico", sesion="a")
    mc.registrar("guia_ph", slug="acido-kojico", sesion="b")
    mc.registrar("guia_receta_click", slug="acido-kojico", sesion="a", detalle="serum")
    mc.registrar("producto_aprende", slug="c-nia100g", sesion="a", detalle="/guias/niacinamida")
    r = mc.resumen(7)
    assert r["guias"] == [{"slug": "acido-kojico", "abiertas": 1, "dosificador": 1, "ph": 1, "a_receta": 1}]
    assert r["productos"] == [{"slug": "c-nia100g", "clics": 1, "sesiones": 1}]
    assert r["sesiones"]["guia_dosificador"] == 1


def test_resumen_vacio_no_falla(db):
    r = mc.resumen(30)
    assert r["totales"] == {} and r["embudo"]["abrieron"] == 0 and r["recetas"] == [] and r["serie"] == []


@pytest.fixture()
def client(db):
    import website

    website.app.config["TESTING"] = True
    with website.app.test_client() as c:
        yield c


def test_endpoint_web_acepta_evento_valido_y_rechaza_el_resto(client):
    r = client.post("/api/eventos-contenido", json={"evento": "guia_abierta", "slug": "Acido-Kojico!!", "sesion": "AB-12", "detalle": "x"})
    assert r.status_code == 204
    r = client.post("/api/eventos-contenido", json={"evento": "drop_table", "slug": "x"})
    assert r.status_code == 400
    r = client.post("/api/eventos-contenido", data="no json", content_type="text/plain")
    assert r.status_code == 400
    res = mc.resumen(1)
    assert res["totales"] == {"guia_abierta": 1}
    assert res["guias"][0]["slug"] == "acido-kojico"  # saneado: minúsculas, sin símbolos


def test_endpoint_web_limita_por_ip(client, monkeypatch):
    import website

    monkeypatch.setattr(website, "_EVENTOS_RATE_MAX", 3)
    website._EVENTOS_RATE.clear()
    codigos = [client.post("/api/eventos-contenido", json={"evento": "guia_ph", "slug": "x"}).status_code for _ in range(5)]
    assert codigos == [204, 204, 204, 429, 429]
    website._EVENTOS_RATE.clear()


def test_paginas_cargan_el_script_de_eventos(client):
    import website

    r = website._cargar_recetas()[0]
    assert "contenido-eventos.js" in client.get(f"/recetario/{r['slug']}").get_data(as_text=True)
    assert "contenido-eventos.js" in client.get("/guias/acido-kojico").get_data(as_text=True)
