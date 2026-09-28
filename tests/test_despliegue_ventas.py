"""Despliegue gradual tras el cese: solo se vende lo que hoy se factura."""

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
    assert V.fuera_de_despliegue(_lineas("C-OTRO100G", "VENTA-VARIO-GRAVADO::1")) == []


def test_despliegue_filtra_skus_y_genericos(despliegue):
    assert D.sku_habilitado("c-lecsoy500g")
    assert not D.sku_habilitado("C-OTRO100G")
    fuera = V.fuera_de_despliegue(_lineas("C-LecSoy500g", "C-OTRO100G", "VENTA-VARIO-GRAVADO::1"))
    assert fuera == ["C-OTRO100G", "VENTA-VARIO-GRAVADO::1"]


def test_cotizar_rechaza_fuera_de_despliegue_pero_no_venta_meli(despliegue):
    v = V.guardar({"cliente": {"nombre": "X"}, "lineas": _lineas("C-OTRO100G")}, usuario="jerry")
    assert v["fuera_despliegue"] == ["C-OTRO100G"]
    r = V.cotizar(v["id"], enviar_whatsapp=False, registrar_en_alegra=False)
    assert not r["ok"] and "volvieron a publicarse" in r["error"]
    assert V._error_despliegue({"origen": "meli", "lineas": _lineas("C-OTRO100G")}) is None


def test_meli_no_reactiva_fuera_de_despliegue(despliegue, monkeypatch):
    from app.services import meli

    monkeypatch.setattr(meli, "pausa_global_meli_activa", lambda: False)
    assert meli.meli_item_reactivable("mco1")
    assert not meli.meli_item_reactivable("MCO2")


def test_envios_siempre_pasan(despliegue):
    assert V.fuera_de_despliegue(_lineas("WEB-ENVIO-15000", "web-envio-var", "C-OTRO100G")) == ["C-OTRO100G"]
