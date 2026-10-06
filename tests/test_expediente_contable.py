"""Expediente contable: el libro por mes y por cuenta, como lo revisa el contador.

Lo que se protege: que el estado del mes salga solo de SQLite (sin Alegra ni MeLi),
que el banco compare el saldo del extracto con el saldo del libro en 1110, que la
verificación de banco solo aparezca en cuentas 1110*, que el auxiliar pagine y marque
cada fila, que el asiento liste sus documentos por la pasarela, y que un mes anterior
al corte sea «período del contador» sin cuentas.
"""

from __future__ import annotations

import pytest

CSV_BANCO = (
    "Fecha;Descripción;Valor;Saldo\n"
    "2026-09-02;PAGO A PROVE PROVEEDOR UNO;-400000;9600000\n"
    "2026-09-10;PAGO QR CLIENTE;150000;9750000\n"
)


@pytest.fixture()
def libro(monkeypatch, tmp_path):
    db = str(tmp_path / "contabilidad_test.db")
    import app.services.contabilidad_core as cc
    import app.services.extracto_bancario as eb

    monkeypatch.setattr(cc, "_DB_PATH", db)
    monkeypatch.setattr(cc, "_initialized", False)
    import app.services.contabilidad_db as cdb

    # extracto_bancario abre la base por contabilidad_db, no por contabilidad_core.
    monkeypatch.setattr(cdb, "_DB_PATH", db)
    monkeypatch.setattr(cdb, "_initialized", False, raising=False)
    monkeypatch.setattr(eb, "_EXTRACTOS_DIR", str(tmp_path / "extractos"))
    monkeypatch.setenv("CONTABILIDAD_FECHA_CORTE", "2026-09-01")
    cc.init_db()
    from app.services import dian_cruce, expediente_contable

    dian_cruce._memo.clear()
    expediente_contable._cache.clear()
    monkeypatch.setattr(dian_cruce, "DIAN_DIR", tmp_path / "dian_vacio")

    prov = cc.crear_tercero({"nombre": "Proveedor Uno", "tipo": "proveedor", "identificacion": "900111222"})
    with cc._conn() as con:
        banco = cc._cuenta_id_por_codigo(con, "1110")
        inventario = cc._cuenta_id_por_codigo(con, "1435")
        proveedores = cc._cuenta_id_por_codigo(con, "2205")
        ventas = cc._cuenta_id_por_codigo(con, "4135")
        mp = cc._cuenta_id_por_codigo(con, "130505")
    # Agosto (antes del corte): saldo inicial de banco.
    cc.crear_movimiento(fecha="2026-08-20", concepto="Saldo que viene", lineas=[
        {"cuenta_id": banco, "debito": 10_000_000, "credito": 0},
        {"cuenta_id": ventas, "debito": 0, "credito": 10_000_000},
    ])
    compra = cc.crear_movimiento(fecha="2026-09-01", concepto="Compra factura FEA1", referencia="compra:900111222:FEA1", lineas=[
        {"cuenta_id": inventario, "debito": 1_000_000, "credito": 0},
        {"cuenta_id": proveedores, "debito": 0, "credito": 1_000_000, "tercero_id": prov["id"]},
    ], tercero_id=prov["id"])
    pago = cc.crear_movimiento(fecha="2026-09-02", concepto="Pago al proveedor", lineas=[
        {"cuenta_id": proveedores, "debito": 400_000, "credito": 0, "tercero_id": prov["id"]},
        {"cuenta_id": banco, "debito": 0, "credito": 400_000},
    ], tercero_id=prov["id"])
    venta = cc.crear_movimiento(fecha="2026-09-05", concepto="Venta MeLi", lineas=[
        {"cuenta_id": mp, "debito": 63_800, "credito": 0},
        {"cuenta_id": ventas, "debito": 0, "credito": 63_800},
    ])
    cobro = cc.crear_movimiento(fecha="2026-09-10", concepto="Cobro QR cliente", lineas=[
        {"cuenta_id": banco, "debito": 150_000, "credito": 0},
        {"cuenta_id": ventas, "debito": 0, "credito": 150_000},
    ])
    cc.guardar_comprobante(pago["id"], b"%PDF-1.4 prueba", "giro.pdf", "application/pdf")
    ext = eb.importar_extracto(CSV_BANCO.encode("utf-8"), "banco_sep.csv", banco="Bancolombia", cuenta="0974")
    lineas = eb.obtener_extracto(ext["id"])["movimientos"]
    linea_pago = next(l for l in lineas if l["tipo"] == "debito")
    eb.vincular(linea_pago["id"], f"cc:{pago['id']}", notas="test")
    return {"cc": cc, "eb": eb, "compra": compra, "pago": pago, "venta": venta, "cobro": cobro,
            "extracto": ext, "lineas": lineas}


def test_el_mes_del_libro_propio_trae_estado_banco_y_cuentas(libro):
    from app.services.expediente_contable import expediente_mes

    e = expediente_mes("2026-09")
    assert e["tipo"] == "libro_propio"
    assert e["estado"]["cuadra"] is True
    b = e["estado"]["banco"]
    assert b["lineas"] == 2 and b["vinculadas"] == 1 and b["sin_vincular"] == 1
    # El saldo del libro en 1110 sale de mayor_cuenta: 10M que venían − 400k + 150k.
    assert b["saldo_libro_inicial"] == 10_000_000
    assert b["saldo_libro_final"] == 9_750_000
    assert b["saldo_extracto_final"] == 9_750_000 and b["saldo_metodo"] == "extracto"
    assert b["libro_sin_banco"] == 1          # el cobro QR no está vinculado
    codigos = {c["codigo"]: c for c in e["cuentas"]}
    assert codigos["1110"]["verificacion"]["banco"] == {"vinculados": 1, "sin_vincular": 1}
    assert codigos["2205"]["verificacion"]["banco"] is None
    assert codigos["2205"]["verificacion"]["con_soporte"] == 1      # el pago tiene comprobante
    assert codigos["1110"]["clave"] and codigos["2205"]["clave"]
    assert e["estado"]["cuentas_por_revisar"] >= 1
    assert any(f["ref"].startswith("extracto:") for f in e["fuentes"])


def test_un_mes_antes_del_corte_es_periodo_del_contador_sin_cuentas(libro):
    from app.services.expediente_contable import expediente_mes

    e = expediente_mes("2026-08")
    assert e["tipo"] == "periodo_contador"
    assert e["cuentas"] == []
    assert e["veredicto"]["nivel"] == "neutro"
    assert e["estado"]["libro"]["informativo"] is True


def test_el_auxiliar_pagina_y_marca_cada_fila(libro):
    from app.services.expediente_contable import auxiliar_cuenta

    a = auxiliar_cuenta("2026-09", "1110", limite=1)
    assert a["total"] == 2 and len(a["filas"]) == 1
    estados = {f["movimiento_id"]: f["verificaciones"]["banco"]["estado"] for f in auxiliar_cuenta("2026-09", "1110")["filas"]}
    assert estados[libro["pago"]["id"]] == "vinculado"
    assert estados[libro["cobro"]["id"]] == "sin_banco"
    por_dia = auxiliar_cuenta("2026-09", "4135", agrupar="dia")["por_dia"]
    assert [d["fecha"] for d in por_dia] == ["2026-09-05", "2026-09-10"]
    assert auxiliar_cuenta("2026-09", "2205")["filas"][0]["verificaciones"]["banco"]["estado"] == "no_aplica"


def test_el_asiento_lista_sus_documentos_y_su_linea_del_banco(libro):
    from app.services.expediente_contable import asiento

    a = asiento("2026-09", libro["pago"]["id"])
    assert a["cuadra"] is True
    refs = {d["ref"] for d in a["documentos"]}
    assert f"comprobante:{libro['pago']['id']}" in refs
    assert a["banco_linea"]["monto"] == 400_000
    assert a["soporte"] == {"estado": "si", "n": 1}
    with pytest.raises(ValueError):
        asiento("2026-09", 999_999)


def test_la_conciliacion_del_mes_separa_vinculadas_de_sin_asiento(libro):
    from app.services.expediente_contable import conciliacion_mes

    c = conciliacion_mes("2026-09")
    estados = sorted(l["estado"] for l in c["lineas"])
    assert estados == ["sin_asiento", "vinculada"]
    vinc = next(l for l in c["lineas"] if l["estado"] == "vinculada")
    assert vinc["asiento"]["contrapartida"] == "2205"
    assert [m["id"] for m in c["libro_sin_banco"]] == [libro["cobro"]["id"]]


def test_periodos_cubre_desde_2025_y_marca_el_corte(libro):
    from datetime import date

    from app.services.expediente_contable import periodos

    ps = periodos(hoy=date(2026, 10, 5))
    assert ps[0]["periodo"] == "2025-01" and ps[-1]["periodo"] == "2026-10"
    por = {p["periodo"]: p for p in ps}
    assert por["2026-08"]["tipo"] == "periodo_contador" and por["2026-09"]["tipo"] == "libro_propio"
    assert por["2026-09"]["asientos"] == 4 and por["2026-09"]["extracto"] is True


def test_el_periodo_se_valida():
    from app.services.expediente_contable import auxiliar_cuenta, expediente_mes

    with pytest.raises(ValueError):
        expediente_mes("2026-13")
    with pytest.raises(ValueError):
        auxiliar_cuenta("2026-09", "../x")
