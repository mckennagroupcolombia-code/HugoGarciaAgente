"""Reconocimiento del IVA de las ventas.

Lo que se protege: que el IVA salga de las **facturas** y no de aplicar 19% al
total. No todo lleva IVA —hay materias primas excluidas (Art. 424 E.T.)— y
dividir por 1,19 a ciegas inventaría IVA sobre lo excluido y lo declararía de
más ante la DIAN.
"""

from __future__ import annotations

import pytest


@pytest.fixture()
def libro(monkeypatch, tmp_path):
    db = str(tmp_path / "contabilidad_test.db")
    import app.services.contabilidad_core as cc
    import app.services.iva_ventas as iva

    monkeypatch.setattr(cc, "_DB_PATH", db)
    monkeypatch.setattr(cc, "_initialized", False)
    cc.init_db()
    return cc, iva


def _facturas(monkeypatch, iva, filas):
    monkeypatch.setattr(iva, "facturas_del_periodo", lambda desde, hasta, **kw: filas)


def _venta(cc, monto: float, fecha="2026-09-10"):
    with cc._conn() as con:
        banco = cc._cuenta_id_por_codigo(con, "1110")
        ventas = cc._cuenta_id_por_codigo(con, "4135")
    return cc.crear_movimiento(
        fecha=fecha, concepto="Venta",
        lineas=[{"cuenta_id": banco, "debito": monto, "credito": 0},
                {"cuenta_id": ventas, "debito": 0, "credito": monto}],
    )


def test_el_iva_sale_de_las_facturas_no_de_dividir_por_119(libro, monkeypatch):
    """Dos facturas: una gravada y una excluida. El IVA es el de la gravada."""
    cc, iva = libro
    _facturas(monkeypatch, iva, [
        {"id": "1", "numero": "FE1", "fecha": "2026-09-05", "base": 100_000,
         "iva": 19_000, "total": 119_000, "anulada": False, "cliente": "A"},
        # Materia prima excluida: factura sin IVA.
        {"id": "2", "numero": "FE2", "fecha": "2026-09-06", "base": 50_000,
         "iva": 0, "total": 50_000, "anulada": False, "cliente": "B"},
    ])
    _venta(cc, 169_000)

    r = iva.resumen("2026-09-01", "2026-09-30")
    assert r["iva_generado"] == 19_000          # solo el de la gravada
    assert r["base_gravable"] == 150_000
    assert r["facturas_sin_iva"] == 1
    # Dividir el total por 1,19 habría dado ~$26.983 de IVA: $7.983 inventados.
    assert r["iva_generado"] != round(169_000 - 169_000 / 1.19, 2)


def test_una_factura_anulada_no_genera_iva(libro, monkeypatch):
    _cc, iva = libro
    _facturas(monkeypatch, iva, [
        {"id": "1", "numero": "FE1", "fecha": "2026-09-05", "base": 100_000,
         "iva": 19_000, "total": 119_000, "anulada": True, "cliente": "A"},
    ])
    assert iva.resumen("2026-09-01", "2026-09-30")["iva_generado"] == 0


def test_reconocer_saca_el_iva_de_ingresos_y_lo_deja_como_pasivo(libro, monkeypatch):
    cc, iva = libro
    _facturas(monkeypatch, iva, [
        {"id": "1", "numero": "FE1", "fecha": "2026-09-05", "base": 100_000,
         "iva": 19_000, "total": 119_000, "anulada": False, "cliente": "A"},
    ])
    _venta(cc, 119_000)

    r = iva.reconocer("2026-09-01", "2026-09-30", dry_run=False)
    assert r["estado"] == "reconocido"

    from app.services.contabilidad_mayor import extracto_cuenta
    # El ingreso baja al valor sin IVA y el IVA queda como pasivo.
    assert extracto_cuenta(codigo="4135")["saldo_final"] == 100_000
    assert extracto_cuenta(codigo="240805")["saldo_final"] == 19_000
    assert cc.balance_comprobacion()["cuadra"]


def test_reconocer_dos_veces_no_duplica(libro, monkeypatch):
    cc, iva = libro
    _facturas(monkeypatch, iva, [
        {"id": "1", "numero": "FE1", "fecha": "2026-09-05", "base": 100_000,
         "iva": 19_000, "total": 119_000, "anulada": False, "cliente": "A"},
    ])
    _venta(cc, 119_000)
    iva.reconocer("2026-09-01", "2026-09-30", dry_run=False)
    segunda = iva.reconocer("2026-09-01", "2026-09-30", dry_run=False)

    assert segunda["estado"] == "ya_reconocido"
    from app.services.contabilidad_mayor import extracto_cuenta
    assert extracto_cuenta(codigo="240805")["saldo_final"] == 19_000


def test_dry_run_no_escribe(libro, monkeypatch):
    cc, iva = libro
    _facturas(monkeypatch, iva, [
        {"id": "1", "numero": "FE1", "fecha": "2026-09-05", "base": 100_000,
         "iva": 19_000, "total": 119_000, "anulada": False, "cliente": "A"},
    ])
    _venta(cc, 119_000)
    r = iva.reconocer("2026-09-01", "2026-09-30", dry_run=True)

    assert r["estado"] == "simulado"
    from app.services.contabilidad_mayor import extracto_cuenta
    assert extracto_cuenta(codigo="4135")["saldo_final"] == 119_000   # intacto


def test_avisa_cuando_el_libro_y_las_facturas_no_cuadran(libro, monkeypatch):
    """Si no cuadran, el IVA se estaría calculando sobre una base que no es."""
    cc, iva = libro
    _facturas(monkeypatch, iva, [
        {"id": "1", "numero": "FE1", "fecha": "2026-09-05", "base": 100_000,
         "iva": 19_000, "total": 119_000, "anulada": False, "cliente": "A"},
    ])
    _venta(cc, 500_000)   # el libro tiene más ventas de las que se facturaron

    r = iva.resumen("2026-09-01", "2026-09-30")
    assert r["ingreso_en_libro"] == 500_000
    assert r["diferencia_libro_vs_facturas"] == 381_000
