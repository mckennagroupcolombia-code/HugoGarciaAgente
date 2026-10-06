"""Cruce de los listados de la DIAN contra el libro, documento por documento.

Lo que se protege: que la fecha «DD-MM-AAAA» de la DIAN se lea bien, que importar dos
veces no duplique, y que cada documento caiga en el estado correcto: cuadra, difiere,
solo en la DIAN o solo en el libro — con ventas por número FE (aunque el asiento
traiga la cédula del cliente), compras por NIT + número y documentos soporte por el
número de `cc_doc_soporte`.
"""

from __future__ import annotations

import pytest

COLUMNAS = ["Tipo de documento", "CUFE/CUDE", "Folio", "Prefijo", "Divisa", "Forma de Pago", "Medio de Pago",
            "Fecha Emisión", "Fecha Recepción", "NIT Emisor", "Nombre Emisor", "NIT Receptor", "Nombre Receptor",
            "IVA", "ICA", "IC", "INC", "Timbre", "INC Bolsas", "IN Carbono", "IN Combustibles", "IC Datos", "ICL",
            "INPP", "IBUA", "ICUI", "Rete IVA", "Rete Renta", "Rete ICA", "Total", "Estado", "Grupo"]


def _fila(tipo, cufe, folio, prefijo, fecha, nit_e, nom_e, nit_r, nom_r, iva, total, grupo, rete_renta=0):
    f = {c: 0 for c in COLUMNAS}
    f.update({"Tipo de documento": tipo, "CUFE/CUDE": cufe, "Folio": folio, "Prefijo": prefijo, "Divisa": "COP",
              "Forma de Pago": "1", "Medio de Pago": "10", "Fecha Emisión": fecha, "Fecha Recepción": "",
              "NIT Emisor": nit_e, "Nombre Emisor": nom_e, "NIT Receptor": nit_r, "Nombre Receptor": nom_r,
              "IVA": iva, "Rete Renta": rete_renta, "Total": total, "Estado": "Aprobado con notificación", "Grupo": grupo})
    return [f[c] for c in COLUMNAS]


@pytest.fixture()
def escenario(monkeypatch, tmp_path):
    import openpyxl

    import app.services.contabilidad_core as cc
    from app.services import dian_cruce

    db = str(tmp_path / "contabilidad_test.db")
    monkeypatch.setattr(cc, "_DB_PATH", db)
    monkeypatch.setattr(cc, "_initialized", False)
    monkeypatch.setenv("EMPRESA_NIT", "901316016-3")
    cc.init_db()
    dian_cruce._memo.clear()
    carpeta = tmp_path / "DIAN_listados"
    carpeta.mkdir()
    monkeypatch.setattr(dian_cruce, "DIAN_DIR", carpeta)

    cliente = cc.crear_tercero({"nombre": "Cliente Siigo", "tipo": "cliente", "identificacion": "52218143"})
    prov = cc.crear_tercero({"nombre": "Proveedor Uno", "tipo": "proveedor", "identificacion": "900111222"})
    fidel = cc.crear_tercero({"nombre": "Fidel Rocha", "tipo": "otro", "identificacion": "9385573"})
    with cc._conn() as con:
        banco = cc._cuenta_id_por_codigo(con, "1110")
        inventario = cc._cuenta_id_por_codigo(con, "1435")
        proveedores = cc._cuenta_id_por_codigo(con, "2205")
        ventas = cc._cuenta_id_por_codigo(con, "4135")
        gasto = cc._cuenta_id_por_codigo(con, "523550")
    import json

    def venta(fecha, ref, total, tercero=None):
        return cc.crear_movimiento(
            fecha=fecha, concepto="Venta Alegra", tercero_id=tercero,
            referencia=f"auto:{ref}", tipo_origen="auto_siigo_venta",
            plantilla_datos={"fuente": "siigo_venta", "referencia": ref, "monto": total},
            lineas=[{"cuenta_id": banco, "debito": total, "credito": 0}, {"cuenta_id": ventas, "debito": 0, "credito": total}],
        )

    v_ok = venta("2026-09-03", "FE4", 28_900, cliente["id"])      # en ambos, cuadra (trae cédula del cliente)
    v_dif = venta("2026-09-04", "FE5", 19_000)                     # en ambos, difiere
    v_solo = venta("2026-09-06", "FE9", 50_000)                    # solo en el libro
    v_ago = venta("2026-08-30", "FE2", 12_000)                     # FE de sept para una venta de agosto
    compra = cc.crear_movimiento(fecha="2026-09-10", concepto="Compra", referencia="compra:900111222:FEA18834",
                                 tercero_id=prov["id"], lineas=[
        {"cuenta_id": inventario, "debito": 7_414_698, "credito": 0},
        {"cuenta_id": proveedores, "debito": 0, "credito": 7_414_698, "tercero_id": prov["id"]}])
    ds = cc.crear_movimiento(fecha="2026-09-18", concepto="Mensajería", tercero_id=fidel["id"], lineas=[
        {"cuenta_id": gasto, "debito": 2_026_657, "credito": 0, "tercero_id": fidel["id"]},
        {"cuenta_id": banco, "debito": 0, "credito": 2_026_657}])
    with cc._conn() as con:
        con.execute("CREATE TABLE IF NOT EXISTS cc_doc_soporte (id INTEGER PRIMARY KEY, solicitud_id INTEGER, movimiento_id INTEGER, "
                    "tercero_id INTEGER, fecha TEXT, valor REAL, alegra_id TEXT, numero TEXT, cuds TEXT, estado TEXT, mensaje TEXT)")
        con.execute("INSERT INTO cc_doc_soporte (solicitud_id, movimiento_id, numero, estado) VALUES (1, ?, 'DSMG1', 'success')", (ds["id"],))

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(COLUMNAS)
    E = "901316016"
    ws.append(_fila("Factura electrónica", "cufe-fe4", "4", "FE", "03-09-2026", E, "MCKENNA", "52218143", "Cliente", 4_615, 28_900, "Emitido"))
    ws.append(_fila("Factura electrónica", "cufe-fe5", "5", "FE", "04-09-2026", E, "MCKENNA", "222222222", "Consumidor", 2_500, 28_899.99, "Emitido"))
    ws.append(_fila("Factura electrónica", "cufe-fe2", "2", "FE", "02-09-2026", E, "MCKENNA", "222222222", "Consumidor", 0, 12_000, "Emitido"))
    ws.append(_fila("Factura electrónica", "cufe-fe7", "7", "FE", "05-09-2026", E, "MCKENNA", "222222222", "Consumidor", 0, 9_900, "Emitido"))
    ws.append(_fila("Nota de crédito electrónica", "cufe-nc1", "1", "NC", "07-09-2026", E, "MCKENNA", "222222222", "Consumidor", 0, 5_000, "Emitido"))
    ws.append(_fila("Documento soporte con no obligados", "cuds-1", "1", "DSMG", "18-09-2026", E, "MCKENNA", "9385573", "FIDEL", 0, 2_026_657, "Emitido"))
    ws.append(_fila("Factura electrónica", "cufe-fea", "18834", "FEA", "10-09-2026", "900111222", "PROVEEDOR UNO", E, "MCKENNA", 1_183_000, 7_414_698, "Recibido", rete_renta=0))
    ws.append(_fila("Factura electrónica", "cufe-inter", "79228259", "FE", "12-09-2026", "800251569", "INTER RAPIDISIMO", E, "MCKENNA", 10_000, 67_000, "Recibido"))
    wb.save(carpeta / "dian_2026-09-01_2026-09-30.xlsx")
    return {"cc": cc, "dian": dian_cruce, "v_ok": v_ok, "v_dif": v_dif, "v_solo": v_solo, "v_ago": v_ago,
            "compra": compra, "ds": ds, "carpeta": carpeta}


def test_la_fecha_de_la_dian_se_lee_bien():
    from datetime import datetime

    from app.services.dian_cruce import _fecha_dian

    assert _fecha_dian("26-09-2026") == "2026-09-26"
    assert _fecha_dian("2026-09-06T19:33:53") == "2026-09-06"
    assert _fecha_dian(datetime(2026, 9, 1, 8, 0)) == "2026-09-01"
    assert _fecha_dian("") == ""


def test_importar_es_idempotente(escenario):
    d = escenario["dian"]
    r1 = d.importar()
    assert r1["archivos"] == 1 and r1["insertados"] == 8 and r1["errores"] == []
    r2 = d.importar()
    assert r2["archivos"] == 0 and r2["omitidos"] == 1 and r2["insertados"] == 0
    r3 = d.importar(todos=True)
    assert r3["actualizados"] == 8 and r3["insertados"] == 0
    assert d.periodos_con_listado() == ["2026-09"]


def test_el_cruce_clasifica_cada_documento(escenario):
    d = escenario["dian"]
    c = d.cruce_mes("2026-09")
    assert c["listado"] is True
    por_doc = {f["documento"]: f for f in c["emitidos"]["filas"]}
    assert por_doc["FE4"]["estado"] == "cuadra" and por_doc["FE4"]["movimiento_id"] == escenario["v_ok"]["id"]
    assert por_doc["FE5"]["estado"] == "difiere" and por_doc["FE5"]["diferencia"] == pytest.approx(9_899.99)
    # FE2 es de septiembre pero la venta se asentó en agosto: igual se encuentra.
    assert por_doc["FE2"]["estado"] == "cuadra" and por_doc["FE2"]["asiento_periodo"] == "2026-08"
    assert por_doc["FE7"]["estado"] == "solo_dian"
    assert por_doc["FE9"]["estado"] == "solo_libro" and por_doc["FE9"]["total_libro"] == 50_000
    t = c["emitidos"]["totales"]
    assert (t["cuadran"], t["difieren"], t["solo_dian"], t["solo_libro"]) == (2, 1, 1, 1)
    assert c["notas_credito"]["totales"]["solo_dian"] == 1
    ds = c["documentos_soporte"]["filas"][0]
    assert ds["estado"] == "cuadra" and ds["movimiento_id"] == escenario["ds"]["id"]
    rec = {f["documento"]: f for f in c["recibidos"]["filas"]}
    assert rec["FEA18834"]["estado"] == "cuadra" and rec["FEA18834"]["cuenta_codigo"] == "1435"
    assert rec["FE79228259"]["estado"] == "solo_dian"
    assert c["recibidos"]["totales"]["solo_libro"] == 0


def test_el_resumen_por_cuenta_y_por_asiento(escenario):
    d = escenario["dian"]
    d.cruce_mes("2026-09")
    r = d.resumen_para_cuenta("2026-09", "4135")
    assert r == {"en_ambos": 3, "cuadran": 2, "difieren": 1, "solo_libro": 1, "solo_dian": 2}   # FE7 + NC1
    assert d.resumen_para_cuenta("2026-09", "1110") is None
    # «Solo DIAN» de compras cuelga de proveedores, no de inventario.
    assert d.resumen_para_cuenta("2026-09", "2205")["solo_dian"] == 1
    assert d.resumen_para_cuenta("2026-09", "1435")["solo_dian"] == 0
    por_mov = d.estados_por_movimiento("2026-09")
    assert por_mov[escenario["v_dif"]["id"]]["estado"] == "difiere"
    assert por_mov[escenario["compra"]["id"]]["documento"] == "FEA18834"
    assert d.retenciones_sufridas("2026-09") == {"rete_iva": 0.0, "rete_renta": 0.0, "rete_ica": 0.0}
