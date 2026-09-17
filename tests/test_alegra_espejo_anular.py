"""Anular desde el panel el comprobante que un asiento tiene en Alegra.

Por qué importa: el contador arma las declaraciones con lo que ve en Alegra. Si
un asiento se anula y se rehace, el comprobante viejo se queda allá con las
cifras equivocadas — pasó el 16-sep-2026 con dos quincenas.
"""
from __future__ import annotations

import pytest


@pytest.fixture()
def mods(monkeypatch, tmp_path):
    db = str(tmp_path / "contabilidad_test.db")
    import app.services.alegra_espejo as ae
    import app.services.contabilidad_core as cc

    monkeypatch.setattr(cc, "_DB_PATH", db)
    monkeypatch.setattr(cc, "_initialized", False)
    monkeypatch.setenv("ALEGRA_ESPEJO_ACTIVO", "1")
    cc.init_db()
    with cc._conn() as con:
        gasto = cc._cuenta_id_por_codigo(con, "5135")
        banco = cc._cuenta_id_por_codigo(con, "1110")
    mov = cc.crear_movimiento(
        fecha="2026-09-15", concepto="Quincena",
        lineas=[{"cuenta_id": gasto, "debito": 100, "credito": 0},
                {"cuenta_id": banco, "debito": 0, "credito": 100}],
    )
    ae._registrar_espejo(mov["id"], "124", "2026-09-15", 100)
    return ae, cc, mov


class _Resp:
    def __init__(self, status): self.status_code, self.text = status, ""


def test_no_borra_el_comprobante_de_un_asiento_vivo(mods, monkeypatch):
    ae, _cc, mov = mods
    llamadas = []
    monkeypatch.setattr(ae.requests, "delete", lambda *a, **k: llamadas.append(a) or _Resp(200))
    r = ae.anular_espejo(mov["id"])
    assert r["status"] == "bloqueado"
    assert not llamadas                      # ni siquiera se intentó
    assert ae.espejo_existente(mov["id"]) == "124"


def test_anula_el_comprobante_del_asiento_anulado(mods, monkeypatch):
    ae, cc, mov = mods
    monkeypatch.setattr(ae.requests, "delete", lambda *a, **k: _Resp(200))
    cc.anular_movimiento(mov["id"])
    r = ae.anular_espejo(mov["id"])
    assert r["status"] == "success" and r["id"] == "124"
    assert ae.espejo_existente(mov["id"]) is None      # el enlace local también se limpia


def test_si_ya_no_estaba_en_alegra_limpia_el_enlace(mods, monkeypatch):
    ae, cc, mov = mods
    monkeypatch.setattr(ae.requests, "delete", lambda *a, **k: _Resp(404))
    cc.anular_movimiento(mov["id"])
    r = ae.anular_espejo(mov["id"])
    assert r["status"] == "success" and r["ya_no_estaba"] is True
    assert ae.espejo_existente(mov["id"]) is None


def test_sin_espejo_no_hace_nada(mods, monkeypatch):
    ae, cc, mov = mods
    monkeypatch.setattr(ae.requests, "delete", lambda *a, **k: _Resp(200))
    with cc._conn() as con:
        con.execute("DELETE FROM cc_alegra_espejo WHERE movimiento_id=?", (mov["id"],))
    assert ae.anular_espejo(mov["id"])["status"] == "sin_espejo"
