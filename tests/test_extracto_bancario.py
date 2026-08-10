"""Tests del vínculo extracto bancario ↔ libro ingresos/egresos."""
from __future__ import annotations

import os
import tempfile

import pytest


@pytest.fixture()
def extracto_db(monkeypatch, tmp_path):
    """DB contabilidad aislada + carpeta de extractos."""
    db = tmp_path / "contabilidad_test.db"
    extractos_dir = tmp_path / "extractos"
    extractos_dir.mkdir()

    import app.services.contabilidad_db as cdb
    import app.services.extracto_bancario as eb

    monkeypatch.setattr(cdb, "_DB_PATH", str(db))
    monkeypatch.setattr(cdb, "_initialized", False)
    monkeypatch.setattr(eb, "_EXTRACTOS_DIR", str(extractos_dir))
    cdb.init_db()
    eb.ensure_extracto_tables()
    return eb


def test_parse_csv_debito_credito(extracto_db):
    csv = (
        "Fecha;Descripción;Débito;Crédito;Saldo\n"
        "01/08/2026;PAGO PROVEEDOR XYZ;1500000;;5000000\n"
        "02/08/2026;ABONO CLIENTE;;2500000;7500000\n"
    ).encode("utf-8")
    rows = extracto_db.parse_extracto_bytes(csv, "extracto.csv")
    assert len(rows) == 2
    assert rows[0]["tipo"] == "debito"
    assert rows[0]["monto"] == 1_500_000
    assert rows[0]["fecha"] == "2026-08-01"
    assert rows[1]["tipo"] == "credito"
    assert rows[1]["monto"] == 2_500_000


def test_parse_monto_colombiano(extracto_db):
    assert extracto_db._parse_monto("1.234.567,89") == pytest.approx(1234567.89)
    assert extracto_db._parse_monto("(50.000)") == pytest.approx(-50000)
    assert extracto_db._parse_monto("-12.500,5") == pytest.approx(-12500.5)


def test_id_movimiento_estable(extracto_db):
    row = {
        "fecha": "2026-08-01",
        "tipo": "egreso",
        "fuente": "compra_gmail",
        "referencia": "FV-1",
        "monto": 1000.0,
        "concepto": "Pago factura",
        "contraparte": "Prov",
        "extra": {},
    }
    a = extracto_db.id_movimiento_ledger(row)
    b = extracto_db.id_movimiento_ledger(dict(row))
    assert a == b
    assert len(a) == 20


def test_importar_vincular_desvincular(extracto_db):
    csv = (
        "Fecha,Descripcion,Valor Debito,Valor Credito\n"
        "05/08/2026,Transferencia salida,80000,\n"
        "06/08/2026,Consignacion,,120000\n"
    ).encode("utf-8")
    ex = extracto_db.importar_extracto(csv, "banco.csv", banco="Bancolombia", cuenta="****99")
    assert ex["lineas_count"] == 2
    assert ex["periodo_desde"] == "2026-08-05"

    mov_id = "abc123deadbeef000001"
    linea_debito = next(m for m in ex["movimientos"] if m["tipo"] == "debito")
    vinculo = extracto_db.vincular(linea_debito["id"], mov_id)
    assert vinculo["movimiento_id"] == mov_id

    mapa = extracto_db.mapa_vinculos_por_movimiento([mov_id])
    assert mov_id in mapa
    assert mapa[mov_id]["monto"] == 80_000

    cands = extracto_db.candidatos_para_movimiento(
        fecha="2026-08-06", monto=120_000, tipo_libro="ingreso"
    )
    assert len(cands) == 1
    assert cands[0]["tipo"] == "credito"

    assert extracto_db.desvincular(movimiento_id=mov_id) is True
    assert extracto_db.mapa_vinculos_por_movimiento([mov_id]) == {}


def test_candidatos_respeta_tipo(extracto_db):
    csv = (
        "Fecha;Detalle;Débito;Crédito\n"
        "10/08/2026;Mismo monto;50000;\n"
        "10/08/2026;Mismo monto;;50000\n"
    ).encode("utf-8")
    extracto_db.importar_extracto(csv, "t.csv")
    solo_egreso = extracto_db.candidatos_para_movimiento(
        fecha="2026-08-10", monto=50_000, tipo_libro="egreso"
    )
    assert all(c["tipo"] == "debito" for c in solo_egreso)
    solo_ingreso = extracto_db.candidatos_para_movimiento(
        fecha="2026-08-10", monto=50_000, tipo_libro="ingreso"
    )
    assert all(c["tipo"] == "credito" for c in solo_ingreso)


def test_parse_pdf_texto(extracto_db):
    import fitz

    doc = fitz.open()
    page = doc.new_page()
    y = 72
    for line in (
        "Fecha  Descripcion  Valor  Saldo",
        "01/08/2026  Pago proveedor ABC  150000,00  5000000,00",
        "02/08/2026  Abono cliente  2500000,00  7500000,00",
    ):
        page.insert_text((50, y), line, fontsize=11)
        y += 18
    pdf = doc.tobytes()
    doc.close()

    rows = extracto_db.parse_extracto_bytes(pdf, "extracto.pdf")
    assert len(rows) == 2
    assert rows[0]["fecha"] == "2026-08-01"
    assert rows[0]["tipo"] == "debito"
    assert rows[0]["monto"] == 150_000
    assert rows[1]["tipo"] == "credito"
    assert rows[1]["monto"] == 2_500_000


def test_consultar_por_concepto(extracto_db):
    csv = (
        "Fecha;Descripción;Débito;Crédito\n"
        "01/08/2026;PAGO PSE PROVEEDOR XYZ;150000;;\n"
        "02/08/2026;ABONO NOMINA;;2500000\n"
        "03/08/2026;PAGO PSE OTRO;80000;;\n"
    ).encode("utf-8")
    extracto_db.importar_extracto(csv, "c.csv", banco="Test")
    r = extracto_db.consultar_por_concepto("PSE")
    assert r["cantidad"] == 2
    assert r["suma_debitos"] == 230_000
    assert r["suma_creditos"] == 0
    assert r["neto"] == -230_000
    r2 = extracto_db.consultar_por_concepto("nomina")
    assert r2["cantidad"] == 1
    assert r2["suma_creditos"] == 2_500_000
