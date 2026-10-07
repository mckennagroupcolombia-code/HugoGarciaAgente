"""Pasarela de documentos del expediente: una referencia `tipo:id` por soporte.

Lo que se protege: que nada salga de las raíces permitidas (ni con `..` ni con rutas
absolutas), que un comprobante y la factura de una solicitud se resuelvan, y que una
factura de venta que no está en disco se declare «en Alegra» con su enlace sin salir a
la red durante la vista.
"""

from __future__ import annotations

import json

import pytest


@pytest.fixture()
def libro(monkeypatch, tmp_path):
    import app.services.contabilidad_core as cc
    from app.services import expediente_documentos as ed

    db = str(tmp_path / "contabilidad_test.db")
    monkeypatch.setattr(cc, "_DB_PATH", db)
    monkeypatch.setattr(cc, "_initialized", False)
    monkeypatch.setattr(cc, "_COMPROBANTES_DIR", str(tmp_path / "comprobantes" / "contabilidad"))
    monkeypatch.setattr(ed, "_REPO", tmp_path)
    monkeypatch.setattr(ed, "_COMPROBANTES", tmp_path / "comprobantes")
    monkeypatch.setattr(ed, "_FACTURAS", tmp_path / "facturas_descargadas")
    monkeypatch.setattr(ed, "RAICES", (tmp_path / "comprobantes", tmp_path / "facturas_descargadas"))
    cc.init_db()
    with cc._conn() as con:
        banco = cc._cuenta_id_por_codigo(con, "1110")
        gasto = cc._cuenta_id_por_codigo(con, "523550")
        ventas = cc._cuenta_id_por_codigo(con, "4135")
        con.execute("CREATE TABLE IF NOT EXISTS cc_solicitudes_pago (id INTEGER PRIMARY KEY, factura_numero TEXT, "
                    "factura_archivo TEXT, factura_nombre TEXT, comprobante_archivo TEXT, comprobante_nombre TEXT, referencia TEXT)")
        (tmp_path / "comprobantes" / "solicitudes_pago").mkdir(parents=True)
        (tmp_path / "comprobantes" / "solicitudes_pago" / "sol7_factura.pdf").write_bytes(b"%PDF-1.4 factura")
        con.execute("INSERT INTO cc_solicitudes_pago (id, factura_numero, factura_archivo, factura_nombre) VALUES (7, 'FEA1', "
                    "'comprobantes/solicitudes_pago/sol7_factura.pdf', 'Factura FEA1.pdf')")
    pago = cc.crear_movimiento(fecha="2026-09-02", concepto="Pago", lineas=[
        {"cuenta_id": gasto, "debito": 1000, "credito": 0}, {"cuenta_id": banco, "debito": 0, "credito": 1000}],
        plantilla_datos={"solicitud_id": 7})
    cc.guardar_comprobante(pago["id"], b"%PDF-1.4 giro", "giro.pdf", "application/pdf")
    venta = cc.crear_movimiento(fecha="2026-09-05", concepto="Venta Alegra", referencia="auto:x", tipo_origen="auto_siigo_venta",
                                plantilla_datos={"fuente": "siigo_venta", "referencia": "FE310"},
                                lineas=[{"cuenta_id": banco, "debito": 5000, "credito": 0}, {"cuenta_id": ventas, "debito": 0, "credito": 5000}])
    return {"cc": cc, "ed": ed, "pago": pago, "venta": venta, "tmp": tmp_path}


def test_el_asiento_reune_comprobante_y_factura_de_la_solicitud(libro):
    ed, cc = libro["ed"], libro["cc"]
    docs = ed.documentos_de_asiento(cc.obtener_movimiento(libro["pago"]["id"]))
    por_tipo = {d["tipo"]: d for d in docs}
    assert por_tipo["comprobante"]["disponible_local"] and por_tipo["comprobante"]["sha256"]
    assert por_tipo["factura_compra"]["ref"] == "solicitud_factura:7"
    assert por_tipo["factura_compra"]["titulo"] == "Factura FEA1.pdf"


def test_una_factura_de_venta_que_no_esta_en_disco_se_declara_en_alegra(libro, monkeypatch):
    ed, cc = libro["ed"], libro["cc"]
    llamadas = []
    monkeypatch.setattr("app.services.contabilidad_documentos._pdf_alegra", lambda *a: llamadas.append(a) or (None, "sin red"))
    docs = ed.documentos_de_asiento(cc.obtener_movimiento(libro["venta"]["id"]))
    fe = next(d for d in docs if d["tipo"] == "factura_venta")
    assert fe["ref"] == "fe:FE310" and fe["disponible_local"] is False
    assert fe["enlace_externo"] == "https://app.alegra.com/invoice/view/id/310"
    assert llamadas == []                      # la vista nunca sale a la red
    assert ed.resolver("fe:FE310") is None     # al abrirla sí se intenta, y sin red no hay archivo
    assert llamadas and llamadas[0][:2] == ("invoices", 310)


def test_resolver_sirve_lo_permitido_y_rechaza_lo_demas(libro):
    ed = libro["ed"]
    ruta, mime, nombre = ed.resolver(f"comprobante:{libro['pago']['id']}")
    assert ruta.is_file() and mime == "application/pdf" and nombre == "giro.pdf"
    ruta, _, nombre = ed.resolver("solicitud_factura:7")
    assert ruta.name == "sol7_factura.pdf" and nombre == "Factura FEA1.pdf"
    assert ed.resolver("solicitud_factura:../7") is None
    assert ed.resolver("declaracion:/etc/passwd") is None
    assert ed.resolver("certificado:../../.env") is None
    assert ed.resolver("loquesea") is None
    assert ed.resolver("comprobante:999999") is None


def test_nada_fuera_de_las_raices(libro):
    ed = libro["ed"]
    fuera = libro["tmp"] / "secreto.txt"
    fuera.write_text("x")
    assert ed._dentro(fuera) is False
    assert ed._dentro(libro["tmp"] / "comprobantes" / "solicitudes_pago" / "sol7_factura.pdf") is True
