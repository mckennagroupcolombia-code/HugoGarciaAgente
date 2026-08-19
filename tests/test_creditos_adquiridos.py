"""Cálculo y persistencia de créditos adquiridos."""
from __future__ import annotations

import pytest


@pytest.fixture()
def creditos_mod(monkeypatch, tmp_path):
    db = tmp_path / "contabilidad_test.db"
    import app.services.contabilidad_db as cdb
    import app.services.creditos_adquiridos as ca

    monkeypatch.setattr(cdb, "_DB_PATH", str(db))
    monkeypatch.setattr(cdb, "_initialized", False)
    cdb.init_db()
    ca.ensure_creditos_tables()
    return ca


def test_cuota_francesa_nominal_mensual(creditos_mod):
    # 1.000.000 a 12% N.A.M.V. a 12 meses → cuota clásica ~88.848,79
    cuota = creditos_mod.calcular_cuota(
        1_000_000, 12.0, 12, tipo_tasa="NA_MV", sistema="frances", periodicidad="mensual"
    )
    assert cuota == pytest.approx(88848.79, abs=0.05)


def test_tasa_ea_mayor_que_nominal(creditos_mod):
    r_ea = creditos_mod.tasa_periodo(24.0, "EA", "mensual")
    r_na = creditos_mod.tasa_periodo(24.0, "NA_MV", "mensual")
    assert r_ea < r_na
    assert r_na == pytest.approx(0.02)


def test_tabla_francesa_cierra_saldo(creditos_mod):
    tabla = creditos_mod.tabla_amortizacion(
        5_000_000, 18.0, 6, tipo_tasa="EA", sistema="frances", periodicidad="mensual"
    )
    assert len(tabla) == 6
    assert tabla[-1]["saldo"] == pytest.approx(0, abs=1)
    capital = sum(r["capital"] for r in tabla)
    assert capital == pytest.approx(5_000_000, abs=1)


def test_aleman_cuota_decrece(creditos_mod):
    tabla = creditos_mod.tabla_amortizacion(
        2_400_000, 12.0, 12, tipo_tasa="NA_MV", sistema="aleman", periodicidad="mensual"
    )
    cuotas = [r["cuota"] for r in tabla]
    assert cuotas[0] > cuotas[-1]
    assert tabla[0]["capital"] == pytest.approx(200_000, abs=1)


def test_interes_solo_capital_al_final(creditos_mod):
    tabla = creditos_mod.tabla_amortizacion(
        1_000_000, 12.0, 4, tipo_tasa="NA_MV", sistema="interes_solo", periodicidad="mensual"
    )
    assert all(r["capital"] == 0 for r in tabla[:-1])
    assert tabla[-1]["capital"] == pytest.approx(1_000_000, abs=1)


def test_crud_y_pago_reduce_saldo(creditos_mod):
    c = creditos_mod.crear_credito(
        {
            "nombre": "Bancolombia capital de trabajo",
            "acreedor": "Bancolombia",
            "tipo": "prestamo_bancario",
            "monto_original": 10_000_000,
            "tasa_anual_pct": 24,
            "tipo_tasa": "EA",
            "sistema": "frances",
            "plazo_meses": 12,
            "periodicidad": "mensual",
            "fecha_desembolso": "2026-01-15",
            "fecha_primera_cuota": "2026-02-15",
            "dia_pago": 15,
        }
    )
    assert c["id"]
    assert c["cuota_periodo"] > 0
    assert c["saldo"] == pytest.approx(10_000_000)
    assert c["n_cuotas"] == 12

    pago = creditos_mod.registrar_pago(
        c["id"],
        {"fecha": "2026-02-15", "monto": c["cuota_periodo"]},
    )
    assert pago["capital"] > 0
    assert pago["intereses"] > 0
    after = creditos_mod.obtener_credito(c["id"], con_tabla=False)
    assert after["saldo"] < 10_000_000
    assert after["cuotas_pagadas"] == 1
    assert after["proxima_cuota_fecha"] == "2026-03-15"

    lista = creditos_mod.listar_creditos()
    assert len(lista) == 1
    res = creditos_mod.resumen()
    assert res["activos"] == 1
    assert res["deuda_vigente"] == after["saldo"]

    assert creditos_mod.eliminar_pago(pago["id"]) is True
    restored = creditos_mod.obtener_credito(c["id"], con_tabla=False)
    assert restored["saldo"] == pytest.approx(10_000_000)
    assert creditos_mod.eliminar_credito(c["id"]) is True
    assert creditos_mod.listar_creditos() == []


def test_simular_incluye_seguro(creditos_mod):
    sim = creditos_mod.simular(
        {
            "monto_original": 1_000_000,
            "tasa_anual_pct": 12,
            "tipo_tasa": "NA_MV",
            "plazo_meses": 12,
            "sistema": "frances",
            "seguro_cuota": 10_000,
        }
    )
    assert sim["cuota"] == pytest.approx(88848.79 + 10_000, abs=0.1)
    assert sim["total_intereses"] > 0


def test_validacion_monto(creditos_mod):
    with pytest.raises(ValueError):
        creditos_mod.crear_credito({"nombre": "x", "monto_original": 0, "plazo_meses": 6})


def test_pagos_en_rango_para_libro(creditos_mod):
    c = creditos_mod.crear_credito(
        {
            "nombre": "Leasing camioneta",
            "acreedor": "Davivienda",
            "monto_original": 3_000_000,
            "tasa_anual_pct": 15,
            "plazo_meses": 6,
            "fecha_desembolso": "2026-01-01",
            "fecha_primera_cuota": "2026-02-01",
        }
    )
    creditos_mod.registrar_pago(c["id"], {"fecha": "2026-02-01", "monto": 550_000})
    rows = creditos_mod.pagos_en_rango("2026-02-01", "2026-02-28")
    assert len(rows) == 1
    assert rows[0]["acreedor"] == "Davivienda"
    assert rows[0]["monto"] == 550_000
    assert creditos_mod.pagos_en_rango("2026-03-01", "2026-03-31") == []
