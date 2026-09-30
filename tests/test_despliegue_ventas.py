"""Despliegue gradual tras el cese: MeLi y web solo venden lo que hoy se factura."""

from __future__ import annotations

import json

import pytest

from app.services import despliegue_ventas as D
from app.services import ventas_directas as V

PRODUCTOS = {
    "C-LECSOY500G": {"id": "48", "price": 19800.0, "tax_ids": ["4"], "tax_rate_total": 19.0},
    "C-OTRO100G": {"id": "49", "price": 9000.0, "tax_ids": ["4"], "tax_rate_total": 19.0},
}


@pytest.fixture
def despliegue():
    D.ARCHIVO.write_text(json.dumps({
        "activo": True,
        "desde": "2026-09-27T20:00:00",
        "skus": {"C-LECSOY500G": {"nombre": "Lecitina", "meli_ids": ["MCO1"]}},
    }), encoding="utf-8")
    yield


@pytest.fixture(autouse=True)
def _vd(tmp_path, monkeypatch):
    monkeypatch.setattr(V, "_DB", str(tmp_path / "vd.db"))
    monkeypatch.setattr(V, "_producto_alegra", lambda c: PRODUCTOS.get(c.upper()))


def _lineas(*codigos):
    return [{"codigo": c, "nombre": c, "cantidad": 1, "precio_unitario": 1000} for c in codigos]


def test_sin_despliegue_no_restringe():
    assert D.skus_habilitados() is None
    assert D.sku_habilitado("CUALQUIERA")


def test_despliegue_filtra_skus(despliegue):
    assert D.sku_habilitado("c-lecsoy500g")
    assert not D.sku_habilitado("C-OTRO100G")


def test_ventas_directas_no_se_restringen(despliegue):
    # Cotizar/Facturar (WhatsApp) vende cualquier SKU activo en Alegra, también los
    # combos sin publicación en MeLi (29-sep-2026). El despliegue solo rige MeLi y web.
    v = V.guardar({"cliente": {"nombre": "X"}, "lineas": _lineas("C-OTRO100G")}, usuario="jerry")
    assert "fuera_despliegue" not in v


def test_meli_no_reactiva_fuera_de_despliegue(despliegue, monkeypatch):
    from app.services import meli

    monkeypatch.setattr(meli, "pausa_global_meli_activa", lambda: False)
    assert meli.meli_item_reactivable("mco1")
    assert not meli.meli_item_reactivable("MCO2")

