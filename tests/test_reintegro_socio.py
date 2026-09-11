"""Reintegro al socio: el giro que extingue la deuda de 2380.

Es **la línea que aparece en el extracto bancario** — la compra no, porque salió
de la tarjeta personal del socio. Por eso el banco solo se acredita acá.
Ver `docs/agentic/modules/relaciones-socios-terceros.md`.
"""
from __future__ import annotations

import pytest


@pytest.fixture()
def mods(monkeypatch, tmp_path):
    db = str(tmp_path / "contabilidad_test.db")
    import app.services.contabilidad_core as cc
    import app.services.compras_socios as cs

    monkeypatch.setattr(cc, "_DB_PATH", db)
    monkeypatch.setattr(cc, "_initialized", False)
    cc.init_db()
    socio = cc.crear_tercero({
        "nombre": "Armando Garcia", "tipo": "socio", "tipo_persona": "natural",
        "identificacion": "1013630698", "usuario_id": 8,
    })
    with cc._conn() as con:
        banco = cc._cuenta_id_por_codigo(con, "1110")
        inventario = cc._cuenta_id_por_codigo(con, "1435")
        pasivo = cc._cuenta_id_por_codigo(con, "2380")
    medio = cc.crear_medio_pago({"nombre": "Bancolombia", "tipo": "banco", "cuenta_id": banco})
    # Una compra: mercancía a inventario contra la deuda con el socio
    cc.crear_movimiento(
        fecha="2026-09-02", concepto="Compra exterior",
        lineas=[
            {"cuenta_id": inventario, "debito": 1_000_000, "credito": 0, "descripcion": "Mercancía"},
            {"cuenta_id": pasivo, "debito": 0, "credito": 1_000_000, "tercero_id": socio["id"],
             "descripcion": "Por pagar al socio"},
        ],
        tipo_origen="auto_compra_exterior", referencia="auto:test",
    )
    return cc, cs, socio, medio


def test_el_saldo_sale_del_libro_no_de_las_compras(mods):
    _cc, cs, socio, _m = mods
    saldos = cs.saldo_socios()
    assert len(saldos) == 1
    assert saldos[0]["tercero_id"] == socio["id"]
    assert saldos[0]["saldo"] == pytest.approx(1_000_000, abs=1)
    assert saldos[0]["abonado"] == 0


def test_el_reintegro_acredita_el_banco_y_extingue_la_deuda(mods):
    cc, cs, socio, medio = mods
    r = cs.registrar_reintegro({
        "tercero_id": socio["id"], "monto": 1_000_000,
        "fecha": "2026-09-15", "medio_pago_id": medio["id"], "referencia": "TRF-900",
    })
    assert r["saldo_anterior"] == pytest.approx(1_000_000, abs=1)
    assert r["saldo_nuevo"] == 0

    mov = next(m for m in cc.listar_movimientos(limit=20) if m["referencia"] == "TRF-900")
    por_cuenta = {l["cuenta_codigo"]: l for l in mov["lineas"]}
    assert por_cuenta["2380"]["debito"] == pytest.approx(1_000_000, abs=1)
    assert por_cuenta["1110"]["credito"] == pytest.approx(1_000_000, abs=1)
    assert cc.balance_comprobacion()["cuadra"]


def test_el_reintegro_se_puede_vincular_al_extracto(mods):
    # `extracto_bancario.vincular()` usa este formato de id.
    _cc, cs, socio, medio = mods
    r = cs.registrar_reintegro({
        "tercero_id": socio["id"], "monto": 500_000,
        "fecha": "2026-09-15", "medio_pago_id": medio["id"],
    })
    assert r["movimiento_id_conciliacion"] == f"cc:{r['movimiento']['id']}"


def test_admite_abonos_parciales(mods):
    _cc, cs, socio, medio = mods
    cs.registrar_reintegro({"tercero_id": socio["id"], "monto": 400_000,
                            "fecha": "2026-09-15", "medio_pago_id": medio["id"]})
    saldos = cs.saldo_socios(socio["id"])
    assert saldos[0]["saldo"] == pytest.approx(600_000, abs=1)
    assert saldos[0]["abonado"] == pytest.approx(400_000, abs=1)


def test_no_deja_girar_mas_de_lo_adeudado(mods):
    # Girar de más dejaría 2380 en débito: el socio le quedaría debiendo a la
    # empresa. Puede ser legítimo, pero tiene que ser decisión explícita.
    _cc, cs, socio, medio = mods
    with pytest.raises(ValueError, match="supera lo que se le debe"):
        cs.registrar_reintegro({"tercero_id": socio["id"], "monto": 1_500_000,
                                "fecha": "2026-09-15", "medio_pago_id": medio["id"]})


def test_el_exceso_se_permite_si_es_explicito(mods):
    _cc, cs, socio, medio = mods
    r = cs.registrar_reintegro({"tercero_id": socio["id"], "monto": 1_500_000,
                                "fecha": "2026-09-15", "medio_pago_id": medio["id"],
                                "permitir_exceso": True})
    assert r["saldo_nuevo"] == pytest.approx(-500_000, abs=1)


def test_no_deja_girar_a_quien_no_se_le_debe(mods):
    cc, cs, _socio, medio = mods
    otro = cc.crear_tercero({"nombre": "Sin deuda", "tipo": "socio", "identificacion": "999"})
    with pytest.raises(ValueError, match="no se le debe nada"):
        cs.registrar_reintegro({"tercero_id": otro["id"], "monto": 100_000,
                                "fecha": "2026-09-15", "medio_pago_id": medio["id"]})


def test_el_detalle_muestra_cargas_y_abonos(mods):
    _cc, cs, socio, medio = mods
    cs.registrar_reintegro({"tercero_id": socio["id"], "monto": 300_000,
                            "fecha": "2026-09-15", "medio_pago_id": medio["id"]})
    d = cs.detalle_pendiente_socio(socio["id"])
    assert d["saldo"] == pytest.approx(700_000, abs=1)
    assert sum(m["carga"] for m in d["movimientos"]) == pytest.approx(1_000_000, abs=1)
    assert sum(m["abono"] for m in d["movimientos"]) == pytest.approx(300_000, abs=1)


def test_monto_invalido_se_rechaza(mods):
    _cc, cs, socio, medio = mods
    for monto in (0, -100):
        with pytest.raises(ValueError, match="monto"):
            cs.registrar_reintegro({"tercero_id": socio["id"], "monto": monto,
                                    "fecha": "2026-09-15", "medio_pago_id": medio["id"]})
