"""Tests de enrutamiento y búsqueda del chat web (catálogo SIIGO)."""
from __future__ import annotations

from app.core import (
    _es_seleccion_presentacion_web,
    _extraer_items_lista_productos_web,
    _filtrar_items_por_consulta_web,
    _mensaje_lista_multiproducto_web,
    _mensaje_pide_lista_productos_web,
    _nota_producto_alternativo_web,
    _respuesta_enlace_meli_web,
    _respuesta_multiproducto_web,
)
from app.services.siigo import buscar_combos_siigo_estructurado


_COMBOS_FIXTURE = [
    {
        "code": "C-ACEGIR500mL",
        "name": "ACEITE GIRASOL 500mL",
        "active": True,
        "prices": [{"price_list": [{"value": 23000}]}],
    },
    {
        "code": "C-ACEESELIM5mL",
        "name": "ACEITE ESENCIAL LIMON 5mL",
        "active": True,
        "prices": [{"price_list": [{"value": 17000}]}],
    },
    {
        "code": "C-BTMS250g",
        "name": "BTMS 50 250g",
        "active": True,
        "prices": [{"price_list": [{"value": 46000}]}],
    },
]


def test_ylang_no_matchea_aceites_esenciales(monkeypatch):
    monkeypatch.setattr(
        "app.services.siigo.listar_productos_combo_siigo",
        lambda: _COMBOS_FIXTURE,
    )
    items, estado = buscar_combos_siigo_estructurado("esencia de ylang ylang")
    assert not items
    assert "No encontré combo" in estado


def test_girasol_matchea_producto_correcto(monkeypatch):
    monkeypatch.setattr(
        "app.services.siigo.listar_productos_combo_siigo",
        lambda: _COMBOS_FIXTURE,
    )
    items, _ = buscar_combos_siigo_estructurado("Aceite de girasol")
    assert items
    assert items[0]["name"] == "ACEITE GIRASOL 500mL"


def test_filtro_consulta_no_devuelve_falsos_positivos():
    items = [
        {"name": "ACEITE ESENCIAL LIMON 5mL", "ref": "C-ACEESELIM5mL"},
        {"name": "ACEITE GIRASOL 500mL", "ref": "C-ACEGIR500mL"},
    ]
    filtrados = _filtrar_items_por_consulta_web(items, "ylang ylang")
    assert filtrados == []


def test_seleccion_presentacion_no_confunde_producto_nuevo():
    assert not _es_seleccion_presentacion_web("Ylang Ylang")
    assert not _es_seleccion_presentacion_web("Aceite de girasol")
    assert _es_seleccion_presentacion_web("250g")


def test_quiero_unos_productos_pide_lista():
    assert _mensaje_pide_lista_productos_web("Quiero unos productos")


def test_lista_multiproducto_extrae_items():
    q = "Necesito estos productos: D-pantenol, sharomix, betaina de coco y BTMS-25"
    assert _mensaje_lista_multiproducto_web(q)
    items = _extraer_items_lista_productos_web(q)
    assert "D-pantenol" in items
    assert "BTMS-25" in items
    assert len(items) == 4


def test_hola_con_coma_no_es_multiproducto():
    q = "Hola, tienes esencia de ylang ylang ?"
    assert _respuesta_multiproducto_web(q) is None


def test_nota_btms25_vs_btms50():
    nota = _nota_producto_alternativo_web(
        "BTMS-25",
        [{"name": "BTMS 50 250g", "ref": "C-BTMS250g"}],
    )
    assert "BTMS 50" in nota


def test_btms25_enlace_cercano(monkeypatch):
    monkeypatch.setattr(
        "app.services.siigo.listar_productos_combo_siigo",
        lambda: _COMBOS_FIXTURE,
    )
    monkeypatch.setattr(
        "app.core._meli_url_desde_ref_web",
        lambda ref: "https://articulo.mercadolibre.com.co/MCO-TEST",
    )
    resp = _respuesta_enlace_meli_web("Dame el enlace de BTMS 25 en Mercadolibre")
    assert resp
    assert "BTMS 50" in resp
    assert "MCO-TEST" in resp
