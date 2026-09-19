"""Libro Mayor por cuenta contable: el árbol del PUC y el extracto de una cuenta.

Lo que se protege acá es lo que un contador daría por sentado y el panel no
tenía: que el árbol cuadre nivel por nivel, que una subcuenta no se coma ni
duplique el movimiento propio de su cuenta padre (1110 Bancos y 111010
MercadoPago mueven las dos), que el saldo corrido del extracto respete la
naturaleza de la cuenta, y que la contrapartida diga contra qué se movió cada
asiento.
"""

from __future__ import annotations

import pytest


@pytest.fixture()
def libro(monkeypatch, tmp_path):
    """Libro de prueba con un banco, una subcuenta del banco, un proveedor y
    ventas — lo mínimo para que el árbol tenga los cuatro niveles del PUC."""
    db = str(tmp_path / "contabilidad_test.db")
    import app.services.contabilidad_core as cc
    import app.services.contabilidad_mayor as cm

    monkeypatch.setattr(cc, "_DB_PATH", db)
    monkeypatch.setattr(cc, "_initialized", False)
    cc.init_db()

    prov = cc.crear_tercero({"nombre": "Proveedor Uno", "tipo": "proveedor"})
    otro = cc.crear_tercero({"nombre": "Proveedor Dos", "tipo": "proveedor"})
    # La subcuenta del banco no viene sembrada: se crea como la creó el usuario
    # en el libro real, y es justo el caso que el árbol tiene que colgar bien.
    mercadopago = cc.crear_cuenta(
        {"codigo": "111010", "nombre": "MercadoPago", "tipo": "activo", "naturaleza": "debito"}
    )["id"]
    with cc._conn() as con:
        banco = cc._cuenta_id_por_codigo(con, "1110")
        inventario = cc._cuenta_id_por_codigo(con, "1435")
        proveedores = cc._cuenta_id_por_codigo(con, "2205")
        ventas = cc._cuenta_id_por_codigo(con, "4135")

    # Julio: una compra a crédito (queda saldo inicial para agosto).
    cc.crear_movimiento(
        fecha="2026-07-10",
        concepto="Compra a crédito",
        lineas=[
            {"cuenta_id": inventario, "debito": 1_000_000, "credito": 0},
            {"cuenta_id": proveedores, "debito": 0, "credito": 1_000_000, "tercero_id": prov["id"]},
        ],
    )
    # Agosto: pago parcial al proveedor, una venta y un traslado a MercadoPago.
    cc.crear_movimiento(
        fecha="2026-08-05",
        concepto="Pago parcial al proveedor",
        lineas=[
            {"cuenta_id": proveedores, "debito": 400_000, "credito": 0, "tercero_id": prov["id"]},
            {"cuenta_id": banco, "debito": 0, "credito": 400_000},
        ],
    )
    cc.crear_movimiento(
        fecha="2026-08-07",
        concepto="Compra al otro proveedor",
        lineas=[
            {"cuenta_id": inventario, "debito": 250_000, "credito": 0},
            {"cuenta_id": proveedores, "debito": 0, "credito": 250_000, "tercero_id": otro["id"]},
        ],
    )
    cc.crear_movimiento(
        fecha="2026-08-12",
        concepto="Venta de contado",
        lineas=[
            {"cuenta_id": banco, "debito": 700_000, "credito": 0},
            {"cuenta_id": ventas, "debito": 0, "credito": 700_000},
        ],
    )
    cc.crear_movimiento(
        fecha="2026-08-20",
        concepto="Traslado a MercadoPago",
        lineas=[
            {"cuenta_id": mercadopago, "debito": 300_000, "credito": 0},
            {"cuenta_id": banco, "debito": 0, "credito": 300_000},
        ],
    )
    return cc, cm, {
        "banco": banco,
        "mercadopago": mercadopago,
        "proveedores": proveedores,
        "ventas": ventas,
        "prov": prov["id"],
        "otro": otro["id"],
    }


def _buscar(nodos, codigo):
    for n in nodos:
        if n["codigo"] == codigo:
            return n
        hallado = _buscar(n["hijos"], codigo)
        if hallado:
            return hallado
    return None


def test_el_arbol_arma_los_cuatro_niveles_del_puc(libro):
    _cc, cm, _ids = libro
    arbol = cm.arbol_cuentas(solo_con_movimiento=True)["arbol"]

    clase = _buscar(arbol, "1")
    assert clase is not None and clase["nivel"] == "clase"
    assert _buscar(arbol, "11")["nivel"] == "grupo"
    assert _buscar(arbol, "1110")["nivel"] == "cuenta"
    assert _buscar(arbol, "111010")["nivel"] == "subcuenta"
    # La subcuenta cuelga de su cuenta, no de la raíz.
    assert _buscar(_buscar(arbol, "1110")["hijos"], "111010") is not None


def test_la_cuenta_padre_suma_su_movimiento_propio_y_el_de_la_subcuenta(libro):
    _cc, cm, _ids = libro
    arbol = cm.arbol_cuentas(solo_con_movimiento=True)["arbol"]
    bancos = _buscar(arbol, "1110")

    # Propio: entró 700.000 de la venta y salieron 400.000 + 300.000.
    assert bancos["propio"]["debito"] == 700_000
    assert bancos["propio"]["credito"] == 700_000
    assert bancos["propio"]["saldo_final"] == 0
    # Acumulado: además los 300.000 que entraron a MercadoPago.
    assert bancos["debito"] == 1_000_000
    assert bancos["saldo_final"] == 300_000


def test_el_arbol_cuadra_por_partida_doble(libro):
    _cc, cm, _ids = libro
    res = cm.arbol_cuentas()
    assert res["cuadra"]
    assert res["total_debito"] == res["total_credito"]


def test_un_hijo_de_naturaleza_contraria_resta_en_el_padre(libro):
    """4175 Devoluciones en ventas es de naturaleza débito dentro de la clase 4,
    que es de crédito: acumularla con su propio signo inflaría los ingresos."""
    cc, cm, _ids = libro
    with cc._conn() as con:
        devoluciones = cc._cuenta_id_por_codigo(con, "4175")
        banco = cc._cuenta_id_por_codigo(con, "1110")
    cc.crear_movimiento(
        fecha="2026-08-25",
        concepto="Devolución de una venta",
        lineas=[
            {"cuenta_id": devoluciones, "debito": 100_000, "credito": 0},
            {"cuenta_id": banco, "debito": 0, "credito": 100_000},
        ],
    )
    clase4 = _buscar(cm.arbol_cuentas(solo_con_movimiento=True)["arbol"], "4")
    assert clase4["saldo_final"] == 600_000  # 700.000 vendidos - 100.000 devueltos


def test_el_extracto_trae_saldo_inicial_y_saldo_corrido(libro):
    _cc, cm, ids = libro
    e = cm.extracto_cuenta(ids["proveedores"], desde="2026-08-01", hasta="2026-08-31")

    # 2205 es de naturaleza crédito: el millón de julio es el saldo inicial.
    assert e["saldo_inicial"] == 1_000_000
    assert [m["saldo"] for m in e["movimientos"]] == [600_000, 850_000]
    assert e["total_debito"] == 400_000
    assert e["total_credito"] == 250_000
    assert e["saldo_final"] == 850_000


def test_cada_linea_dice_contra_que_cuenta_se_movio(libro):
    _cc, cm, ids = libro
    e = cm.extracto_cuenta(ids["proveedores"], desde="2026-08-01", hasta="2026-08-31")

    pago = e["movimientos"][0]
    assert [c["codigo"] for c in pago["contrapartida"]] == ["1110"]
    assert pago["contrapartida"][0]["lado"] == "credito"
    assert pago["contrapartida"][0]["valor"] == 400_000
    # La propia cuenta nunca aparece como su contrapartida.
    assert all(c["cuenta_id"] != ids["proveedores"] for c in pago["contrapartida"])


def test_el_extracto_se_puede_acotar_a_un_tercero(libro):
    _cc, cm, ids = libro
    e = cm.extracto_cuenta(
        ids["proveedores"], desde="2026-08-01", hasta="2026-08-31", tercero_id=ids["otro"]
    )
    assert len(e["movimientos"]) == 1
    # El otro proveedor no tenía nada antes de agosto.
    assert e["saldo_inicial"] == 0
    assert e["saldo_final"] == 250_000


def test_incluir_subcuentas_suma_lo_asentado_debajo(libro):
    _cc, cm, ids = libro
    solo = cm.extracto_cuenta(ids["banco"])
    con_sub = cm.extracto_cuenta(ids["banco"], incluir_subcuentas=True)

    assert solo["saldo_final"] == 0
    assert con_sub["saldo_final"] == 300_000
    assert len(con_sub["movimientos"]) == len(solo["movimientos"]) + 1


def test_el_resumen_por_tercero_reparte_el_movimiento(libro):
    _cc, cm, ids = libro
    e = cm.extracto_cuenta(ids["proveedores"], desde="2026-08-01", hasta="2026-08-31")
    por_nombre = {t["nombre"]: t for t in e["por_tercero"]}

    assert por_nombre["Proveedor Uno"]["saldo"] == -400_000  # se le pagó
    assert por_nombre["Proveedor Dos"]["saldo"] == 250_000  # se le debe
    assert sum(t["debito"] for t in e["por_tercero"]) == e["total_debito"]
    assert sum(t["credito"] for t in e["por_tercero"]) == e["total_credito"]


def test_un_asiento_anulado_no_entra_al_extracto_ni_al_arbol(libro):
    cc, cm, ids = libro
    antes = cm.extracto_cuenta(ids["proveedores"], desde="2026-08-01", hasta="2026-08-31")
    cc.anular_movimiento(antes["movimientos"][0]["movimiento_id"])
    despues = cm.extracto_cuenta(ids["proveedores"], desde="2026-08-01", hasta="2026-08-31")

    assert len(despues["movimientos"]) == len(antes["movimientos"]) - 1
    assert despues["saldo_final"] == 1_250_000
    assert cm.arbol_cuentas()["cuadra"]


def test_el_extracto_avisa_cuando_queda_recortado(libro):
    _cc, cm, ids = libro
    e = cm.extracto_cuenta(ids["proveedores"], limite=1)
    assert e["truncado"] is True
    assert len(e["movimientos"]) == 1


def test_el_csv_lleva_totales_y_una_fila_por_asiento(libro):
    _cc, cm, ids = libro
    e = cm.extracto_cuenta(ids["proveedores"], desde="2026-08-01", hasta="2026-08-31")
    csv = cm.extracto_csv(e)

    assert "2205" in csv and "Proveedores nacionales" in csv
    assert "Saldo inicial" in csv
    # La guía de la cuenta también va en el CSV: el contador lo abre en Excel
    # sin el panel al lado, y ahí es donde aparece «¿qué es este saldo?».
    assert "Qué va en esta cuenta" in csv
    # Título + período + guía + cabeceras + saldo inicial + 2 asientos + totales.
    assert len([l for l in csv.splitlines() if l.strip()]) == 8


def test_el_pdf_del_extracto_se_genera(libro, tmp_path):
    _cc, cm, ids = libro
    from app.tools.extracto_contable_pdf import generar_pdf_balance, generar_pdf_extracto

    destino = str(tmp_path / "extracto.pdf")
    generar_pdf_extracto(cm.extracto_cuenta(ids["proveedores"]), destino=destino)
    assert (tmp_path / "extracto.pdf").stat().st_size > 1000

    balance = str(tmp_path / "balance.pdf")
    generar_pdf_balance(cm.arbol_cuentas(solo_con_movimiento=True), destino=balance)
    assert (tmp_path / "balance.pdf").stat().st_size > 1000


def test_una_cuenta_inexistente_falla_con_mensaje_claro(libro):
    _cc, cm, _ids = libro
    with pytest.raises(ValueError):
        cm.extracto_cuenta(999_999)
    with pytest.raises(ValueError):
        cm.extracto_cuenta(codigo="9999")


def test_auxiliar_por_tercero_cuadra_con_el_extracto(libro):
    cc, cm = libro[0], libro[1]
    aux = cm.auxiliar_terceros()
    assert aux["terceros"], "el libro de prueba tiene terceros"
    for t in aux["terceros"]:
        if not t["tercero_id"]:
            continue
        for c in t["cuentas"]:
            e = cm.extracto_cuenta(c["cuenta_id"], tercero_id=t["tercero_id"])
            assert round(e["saldo_final"], 2) == c["saldo_final"]


def test_arbol_con_terceros_discrimina_la_cuenta(libro):
    cm = libro[1]
    arbol = cm.arbol_cuentas(con_terceros=True)

    def buscar(ns, codigo):
        for n in ns:
            if n["codigo"] == codigo:
                return n
            h = buscar(n["hijos"], codigo)
            if h:
                return h
        return None

    prov = buscar(arbol["arbol"], "2205")
    assert prov and prov.get("terceros")
    assert round(sum(t["saldo_final"] for t in prov["terceros"]), 2) == prov["propio"]["saldo_final"]
