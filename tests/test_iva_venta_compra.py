"""IVA de venta = el que cobra el proveedor (regla de Armando, 7-oct-2026).

Lo que se protege: que la tarifa probada en una compra pase a la materia prima y a los
combos que solo la reempacan — y a nada más. Una fórmula que mezcla varias materias primas
es otro producto; un 0 % de quien nunca cobra IVA no dice la tarifa; un cambio de tarifa del
mismo insumo puede ser un error de factura y se revisa a mano.
"""
from __future__ import annotations

import pytest

from app.services import iva_venta_compra as I


def _kit(ref, comps):
    return {"reference": ref, "name": ref, "type": "kit", "componentes": comps}


def _mp(ref, nombre):
    return {"reference": ref, "name": nombre, "type": "product"}


@pytest.fixture()
def escenario(monkeypatch):
    aprendido = {
        "VITCg": {"iva_pct": 0.0, "ultimo_proveedor": "FACTORES Y MERCADEO S.A.", "ultima_fecha": "2026-09-12"},
        "GLIg": {"iva_pct": 19.0, "ultimo_proveedor": "FACTORES Y MERCADEO S.A.", "ultima_fecha": "2026-09-12"},
        "HARg": {"iva_pct": 5.0, "ultimo_proveedor": "D1 S A S", "ultima_fecha": "2026-07-29"},
        "COLL": {"iva_pct": 0.0, "ultimo_proveedor": "Persona Natural", "ultima_fecha": "2026-10-04"},
        "BOLTRA13X21ZIP": {"iva_pct": 19.0, "ultimo_proveedor": "C.I. S.A.S.", "ultima_fecha": "2026-09-02"},
    }
    items = {
        "VITCG": _mp("VITCg", "VITAMINA C G"),
        "GLIG": _mp("GLIg", "GLICERINA G"),
        "HARG": _mp("HARg", "HARINA G"),
        "COLL": _mp("COLL", "COLLAR PERRO"),
        "BOLTRA13X21ZIP": _mp("BOLTRA13X21ZIP", "BOLSA ZIPLOC"),
        "C-VITC100G": _kit("C-VITC100g", [{"codigo": "VITCg", "nombre": "VITAMINA C G"},
                                          {"codigo": "ETQ250g", "nombre": "ETIQUETA 3X2"},
                                          {"codigo": "BOLTRA13X21ZIP", "nombre": "SEMILLA GIRASOL g"},
                                          {"codigo": "OPRMNM4MN", "nombre": "OPERATIVOS"}]),
        "C-SERUM": _kit("C-SERUM", [{"codigo": "VITCg", "nombre": "VITAMINA C G"},
                                    {"codigo": "GLIg", "nombre": "GLICERINA G"},
                                    {"codigo": "FARAZU30mL", "nombre": "FARMA AZUL 30 ML"}]),
        "C-HARKG": _kit("C-HARKg", [{"codigo": "HARg", "nombre": "HARINA G"},
                                    {"codigo": "BOTERO1", "nombre": "BOTERO HARINA"}]),
    }
    tasas = {"VITCG": 19.0, "GLIG": 19.0, "HARG": 19.0, "COLL": 19.0, "BOLTRA13X21ZIP": 0.0,
             "C-VITC100G": 19.0, "C-SERUM": 19.0, "C-HARKG": 5.0}
    import app.services.pagos_proveedor as pp

    monkeypatch.setattr(pp, "iva_compras_conocido", lambda: aprendido)
    monkeypatch.setattr(I, "_catalogo", lambda: (items, tasas))
    return aprendido


def _refs(p):
    return {c["ref"]: c["tax_id"] for c in p["cambios"]}


def test_materia_prima_y_combo_puro_toman_la_tarifa_de_compra(escenario):
    p = I.plan()
    assert _refs(p)["VITCg"] == "2"          # excluido
    assert _refs(p)["C-VITC100g"] == "2"     # bolsa (por código), etiqueta y operativos no cuentan
    assert _refs(p)["HARg"] == "3"           # 5 %


def test_formula_con_varias_materias_primas_no_se_toca(escenario):
    p = I.plan()
    assert "C-SERUM" not in _refs(p)
    assert any(o.get("ref") == "C-SERUM" and "mezcla" in o["motivo"] for o in p["omitidos"])


def test_cero_de_quien_nunca_cobra_iva_no_dice_nada(escenario):
    p = I.plan()
    assert "COLL" not in _refs(p)
    assert any(o["compra"] == "COLL" for o in p["omitidos"])


def test_cinco_por_ciento_prueba_que_el_proveedor_cobra_iva(escenario):
    # D1 no tiene compras al 19 % aprendidas, pero cobrar 5 % ya lo hace responsable.
    assert "HARg" in _refs(I.plan())


def test_empaque_no_cambia_y_lo_que_ya_coincide_tampoco(escenario):
    refs = _refs(I.plan())
    assert "BOLTRA13X21ZIP" not in refs     # bolsa: no se vende
    assert "GLIg" not in refs and "C-HARKg" not in refs   # ya están en su tarifa


def test_cambio_de_tarifa_del_mismo_insumo_se_revisa_a_mano(escenario):
    p = I.plan(["VITCg"], previos={"VITCG": 19.0})
    assert not p["cambios"]
    assert p["omitidos"][0].get("cambio_de_tarifa")


def test_mismo_proveedor_con_otra_razon_social():
    assert I._prov("QUIMICA INTERKROL LTDA") == I._prov("QUIMICA INTERKROL LIMITADA")


def test_apagado_avisa_sin_tocar_alegra(escenario, monkeypatch):
    monkeypatch.setenv("IVA_VENTA_COMPRA_ACTIVO", "0")
    monkeypatch.setenv("IVA_VENTA_COMPRA_SKIP_WA", "1")
    monkeypatch.setattr(I, "_registrar", lambda e: None)
    llamado = []
    monkeypatch.setattr(I, "aplicar", lambda *a, **k: llamado.append(1) or [])
    I.al_aprender([{"sku": "VITCg", "iva_pct": 0.0, "previo": None}], proveedor="FACTORES", en_hilo=False)
    assert not llamado
