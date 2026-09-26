"""Precios indexados a la TRM: cálculo, anclas, propuesta y aplicación (sin red)."""
from __future__ import annotations

import pytest

from app.services import precios_trm as P


@pytest.fixture
def entorno(tmp_path, monkeypatch):
    monkeypatch.setattr(P, "_DB_PATH", tmp_path / "precios_trm.db")
    monkeypatch.setattr(P, "_CONFIG_PATH", tmp_path / "precios_trm_config.json")
    estado = {
        "trm": 4000.0,
        "catalogo": {
            "SKU-A": {"sku": "SKU-A", "precio_meli": 50000.0, "meli_id": "MCO1", "meli_estado": "active", "nombre": "Producto A"},
            "SKU-B": {"sku": "SKU-B", "precio_meli": 20000.0, "meli_id": "MCO2", "meli_estado": "paused", "nombre": "Producto B"},
        },
        "escritos": [],
    }
    monkeypatch.setattr(P, "_trm_hoy", lambda: {"valor": estado["trm"], "vigencia_desde": "2026-09-16"})
    monkeypatch.setattr(P, "_catalogo", lambda: ({k: dict(v) for k, v in estado["catalogo"].items()}, None))

    def _canales(sku, precio, meli_id):
        estado["escritos"].append((sku, precio))
        estado["catalogo"][sku.upper()]["precio_meli"] = precio
        return True, "ok"

    monkeypatch.setattr(P, "_aplicar_en_canales", _canales)
    return estado


def test_calcular_ajuste_traslado_y_redondeo():
    r = P.calcular_ajuste(50000, 4000, 4200, traslado_pct=60, umbral_pct=2, redondeo=100)
    assert r == {"precio_nuevo": 51500.0, "variacion_trm_pct": 5.0, "ajuste_pct": 3.0}


def test_calcular_ajuste_baja_tambien():
    r = P.calcular_ajuste(50000, 4000, 3800, traslado_pct=100, umbral_pct=2, redondeo=100)
    assert r["precio_nuevo"] == 47500.0


def test_conservar_900():
    kw = dict(traslado_pct=100, umbral_pct=2, redondeo=100, conservar_900=True)
    assert P.calcular_ajuste(11900, 4000, 4400, **kw)["precio_nuevo"] == 12900.0   # 13.090 → 12.900
    assert P.calcular_ajuste(23900, 4000, 3800, **kw)["precio_nuevo"] == 22900.0   # 22.705 → 22.900
    # Ajuste menor a medio salto de mil: se queda igual, no se propone.
    assert P.calcular_ajuste(11900, 4000, 4120, **kw) is None
    # Precio que no termina en 900: redondeo normal.
    assert P.calcular_ajuste(50000, 4000, 4200, **kw)["precio_nuevo"] == 52500.0


def test_calcular_ajuste_bajo_umbral_no_propone():
    assert P.calcular_ajuste(50000, 4000, 4040, traslado_pct=100, umbral_pct=2, redondeo=100) is None


def test_primera_corrida_solo_ancla(entorno):
    r = P.proponer()
    assert r["anclas_nuevas"] == 2 and r["propuestas"] == 0


def test_trm_base_inicial_propone_desde_el_primer_dia(entorno):
    P.guardar_config({"trm_base_inicial": 3800})
    r = P.proponer()
    assert r["propuestas"] == 2 and r["suben"] == 2


def test_propone_y_reemplaza_la_anterior(entorno):
    P.proponer()
    entorno["trm"] = 4200.0
    assert P.proponer()["propuestas"] == 2
    assert P.proponer()["propuestas"] == 2
    assert len(P.estado()["pendientes"]) == 2


def test_cambio_manual_reinicia_ancla(entorno):
    P.proponer()
    entorno["catalogo"]["SKU-A"]["precio_meli"] = 55000.0
    entorno["trm"] = 4200.0
    r = P.proponer()
    assert r["reancladas"] == 1 and r["propuestas"] == 1  # solo SKU-B


def test_trm_absurda_no_propone(entorno):
    P.proponer()
    entorno["trm"] = 6000.0
    with pytest.raises(RuntimeError):
        P.proponer()


def test_aplicar_escribe_y_mueve_ancla(entorno):
    P.proponer()
    entorno["trm"] = 4200.0
    P.proponer()
    ids = [p["id"] for p in P.estado()["pendientes"] if p["sku"] == "SKU-A"]
    filas = [dict(p) for p in P.estado()["pendientes"] if p["id"] in ids]
    P._aplicar_lote(filas)  # sin hilo
    assert entorno["escritos"] == [("SKU-A", 51500.0)]
    # Con el ancla en (51.500, 4.200) la misma TRM ya no propone nada para A.
    r = P.proponer()
    assert r["propuestas"] == 1 and r["reancladas"] == 0


def test_aplicar_no_toca_si_meli_cambio(entorno):
    P.proponer()
    entorno["trm"] = 4200.0
    P.proponer()
    filas = [p for p in P.estado()["pendientes"] if p["sku"] == "SKU-A"]
    entorno["catalogo"]["SKU-A"]["precio_meli"] = 49000.0
    P._aplicar_lote(filas)
    assert entorno["escritos"] == []
    assert P.estado()["historial"][0]["estado"] == "desactualizado"


def test_descartar(entorno):
    P.proponer()
    entorno["trm"] = 4200.0
    P.proponer()
    ids = [p["id"] for p in P.estado()["pendientes"]]
    assert P.descartar(ids, "armando") == 2
    assert P.estado()["pendientes"] == []


def test_config_valida(entorno):
    with pytest.raises(ValueError):
        P.guardar_config({"redondeo": 7})
    assert P.guardar_config({"traslado_pct": 80})["traslado_pct"] == 80
