"""Pagos de impuestos desde los recibos del contador.

Protege tres cosas: que cada recibo salde la cuenta que le corresponde (el 490
de reteIVA no baja la 2365), que un recibo ya registrado —por este camino o por
el extracto— no se ofrezca otra vez, y que el asiento lleve la referencia
`dian:490:<n>` que usa Conciliación contador.
"""
from __future__ import annotations

import json

import pytest

DECLS = [
    {"tipo": "350", "anio": 2026, "periodo": 8, "numero_formulario": "3510697738909",
     "compras": {"pj_base": 19314000, "pj_retencion": 483000, "pn_base": 0, "pn_retencion": 0},
     "renglones": {"129": 184000, "130": 299000, "134": 242000, "138": 541000}},
    {"tipo": "490", "anio": 2026, "concepto": "61", "periodo": 8, "numero_formulario": "4911173603268",
     "formulario_pagado": "3510697738909", "fecha_pago": "2026-09-16", "valor_impuesto": 299000,
     "valor_sancion": 0, "valor_mora": 0, "archivo": ""},
    {"tipo": "490", "anio": 2026, "concepto": "62", "periodo": 8, "numero_formulario": "4911173604811",
     "formulario_pagado": "3510697738909", "fecha_pago": "2026-09-16", "valor_impuesto": 242000,
     "valor_sancion": 0, "valor_mora": 0, "archivo": ""},
    {"tipo": "PAGO_SDH", "impuesto": "RTICA", "anio": 2026, "periodo": 3,
     "numero_formulario": "2026331014012927161", "fecha_pago": "2026-07-17", "total_a_pagar_TP": 412000},
    {"tipo": "300", "anio": 2026, "periodo": 2, "numero_formulario": "3004736141719",
     "total_saldo_a_pagar_88": 0, "total_saldo_a_favor_89": 80000},
]


@pytest.fixture()
def mods(monkeypatch, tmp_path):
    db = str(tmp_path / "contabilidad_test.db")
    import app.services.contabilidad_core as cc
    import app.services.pagos_impuestos as pi
    import app.services.pagos_wizard as w
    from app.services import tickets_db

    for mod in (cc, w):
        monkeypatch.setattr(mod, "_DB_PATH", db)
        monkeypatch.setattr(mod, "_initialized", False)
    monkeypatch.setattr(tickets_db, "DB_PATH", str(tmp_path / "tickets_test.db"))
    docs = tmp_path / "docs"
    (docs / "2026").mkdir(parents=True)
    (docs / "2026" / "declaraciones_contador.json").write_text(json.dumps({"declaraciones": DECLS}))
    monkeypatch.setattr(pi, "_DOCS", docs)
    w.init_db()
    with cc._conn() as con:
        banco = cc._cuenta_id_por_codigo(con, "1110")
        c2365 = cc._cuenta_id_por_codigo(con, "2365")
    medio = cc.crear_medio_pago({"nombre": "Bancolombia", "tipo": "banco", "cuenta_id": banco})
    # Retención causada en agosto.
    gasto = None
    with cc._conn() as con:
        gasto = cc._cuenta_id_por_codigo(con, "1435")
    cc.crear_movimiento("2026-08-20", "Compra con retención", [
        {"cuenta_id": gasto, "debito": 483000},
        {"cuenta_id": c2365, "credito": 483000},
    ])
    return cc, w, pi, medio


def _por_numero(pi, n):
    return next(r for r in pi.recibos("2026-01-01")["recibos"] if r["numero"] == n)


def test_cada_recibo_va_a_su_cuenta(mods):
    _cc, _w, pi, _m = mods
    assert _por_numero(pi, "4911173603268")["cuenta"] == "2365"
    assert _por_numero(pi, "4911173604811")["cuenta"] == "2367"
    assert _por_numero(pi, "2026331014012927161")["cuenta"] == "2368"
    assert pi.recibos()["sin_pago"][0]["saldo_a_favor"] == 80000


def test_avisa_lo_que_falta_causar(mods):
    _cc, _w, pi, _m = mods
    reteiva = _por_numero(pi, "4911173604811")
    assert any("Falta causar $242.000" in a for a in reteiva["avisos"])
    renta = _por_numero(pi, "4911173603268")
    assert not any("Falta causar" in a for a in renta["avisos"])
    assert any("renglón 129" in a for a in renta["avisos"])


def test_solicitar_y_aprobar_deja_el_asiento_con_la_referencia_del_recibo(mods):
    cc, w, pi, m = mods
    sol = pi.crear_solicitud_desde_recibo("4911173603268", m["id"])
    assert sol["monto"] == 299000
    assert sol["cuenta_debito"] == "2365"
    assert _por_numero(pi, "4911173603268")["estado"] == "solicitado"
    with pytest.raises(ValueError, match="ya está"):
        pi.crear_solicitud_desde_recibo("4911173603268", m["id"])
    w.aprobar(sol["id"], espejar=False)
    mov = cc.obtener_movimiento(w.obtener(sol["id"])["movimiento_id"])
    assert mov["referencia"] == "dian:490:4911173603268"
    codigos = {l["cuenta_codigo"]: (l["debito"], l["credito"]) for l in mov["lineas"]}
    assert codigos["2365"] == (299000, 0)
    assert _por_numero(pi, "4911173603268")["estado"] == "registrado"


def test_pago_registrado_por_el_extracto_no_se_ofrece_otra_vez(mods):
    cc, _w, pi, _m = mods
    with cc._conn() as con:
        banco = cc._cuenta_id_por_codigo(con, "1110")
        c2365 = cc._cuenta_id_por_codigo(con, "2365")
    cc.crear_movimiento("2026-09-17", "PAGO PSE DIAN", [
        {"cuenta_id": c2365, "debito": 299000},
        {"cuenta_id": banco, "credito": 299000},
    ])
    r = _por_numero(pi, "4911173603268")
    assert r["estado"] == "registrado" and r.get("por_otra_via")
