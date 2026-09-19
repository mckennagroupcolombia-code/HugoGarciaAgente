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
    # Por defecto, sin notas crédito y sin red: un test que quiera probarlas las
    # inyecta. Sin esto cada test salía a Siigo y a Alegra de verdad.
    monkeypatch.setattr(iva, "notas_credito_del_periodo", lambda d, h: [])
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


def test_el_iva_de_siigo_sale_de_los_impuestos_del_item(monkeypatch):
    """Siigo no da subtotal ni total de impuestos: el IVA vive en los ítems.

    Antes del 2026-09-02 las facturas están en Siigo, y leer solo Alegra
    devolvía cero IVA para julio y agosto — dos meses que sí lo tuvieron.
    """
    import app.services.iva_ventas as iva

    monkeypatch.setattr(
        "app.services.siigo.obtener_facturas_siigo_paginadas",
        lambda fecha: [
            {"id": "u1", "prefix": "FV", "number": 10, "date": "2026-08-15", "total": 78710.0,
             "customer": {"identification": "900"},
             "items": [{"price": 14214.28, "quantity": 1,
                        "taxes": [{"type": "IVA", "percentage": 19.0, "value": 2700.71}]},
                       {"price": 50000.0, "quantity": 1,
                        "taxes": [{"type": "IVA", "percentage": 19.0, "value": 9500.0}]}]},
            # Fuera de rango: no debe colarse.
            {"id": "u2", "prefix": "FV", "number": 11, "date": "2026-07-30", "total": 1000.0,
             "customer": {}, "items": []},
        ],
    )
    fs = iva._facturas_siigo("2026-08-01", "2026-08-31")
    assert len(fs) == 1
    assert fs[0]["iva"] == 12200.71               # 2.700,71 + 9.500
    assert fs[0]["base"] == round(78710.0 - 12200.71, 2)
    assert fs[0]["sistema"] == "siigo"


def test_un_periodo_anterior_a_la_migracion_no_consulta_alegra(monkeypatch):
    """Alegra no existe antes del corte: preguntarle devolvería cero y el mes
    quedaría sin IVA reconocido."""
    import app.services.iva_ventas as iva

    monkeypatch.setattr(iva, "_facturas_siigo", lambda d, h: [
        {"id": "u1", "numero": "FV10", "fecha": "2026-08-15", "base": 66509.29,
         "iva": 12200.71, "total": 78710.0, "anulada": False, "cliente": "900", "sistema": "siigo"},
    ])
    def _no_llamar(*a, **k):
        raise AssertionError("no debería consultar Alegra para un período anterior al corte")
    monkeypatch.setattr(iva, "_headers", _no_llamar)

    fs = iva.facturas_del_periodo("2026-08-01", "2026-08-31")
    assert [f["sistema"] for f in fs] == ["siigo"]


def test_las_notas_credito_restan_del_iva(libro, monkeypatch):
    """Sin esto se declara IVA de una venta que se anuló.

    Agosto-2026 tuvo 712 notas crédito por $44.441.972 —la campaña de
    corrección del IVA duplicado de astroselling— con $4.560.640 de IVA.
    Contar solo las facturas lo dejaba como deuda con la DIAN.
    """
    cc, iva = libro
    _facturas(monkeypatch, iva, [
        {"id": "1", "numero": "FE1", "fecha": "2026-08-05", "base": 100_000,
         "iva": 19_000, "total": 119_000, "anulada": False, "cliente": "A"},
    ])
    monkeypatch.setattr(iva, "notas_credito_del_periodo", lambda d, h: [
        {"id": "nc1", "numero": "NC1", "fecha": "2026-08-20",
         "total": 59_500, "iva": 9_500, "sistema": "siigo"},
    ])
    _venta(cc, 119_000, fecha="2026-08-05")

    r = iva.resumen("2026-08-01", "2026-08-31")
    assert r["notas_credito"] == 1
    assert r["iva_anulado"] == 9_500
    assert r["iva_generado"] == 9_500            # 19.000 − 9.500
    assert r["total_facturado"] == 59_500        # 119.000 − 59.500
    assert r["base_gravable"] == 50_000          # 100.000 − 50.000


def test_sin_notas_credito_el_iva_no_cambia(libro, monkeypatch):
    cc, iva = libro
    _facturas(monkeypatch, iva, [
        {"id": "1", "numero": "FE1", "fecha": "2026-08-05", "base": 100_000,
         "iva": 19_000, "total": 119_000, "anulada": False, "cliente": "A"},
    ])
    monkeypatch.setattr(iva, "notas_credito_del_periodo", lambda d, h: [])
    _venta(cc, 119_000, fecha="2026-08-05")

    r = iva.resumen("2026-08-01", "2026-08-31")
    assert r["iva_generado"] == 19_000 and r["iva_anulado"] == 0
