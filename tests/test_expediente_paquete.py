"""Paquete mensual del expediente: un ZIP que se puede corroborar sin el panel.

Lo que se protege: que el ZIP traiga LEEME, manifest y el diario; que el sha256 del
manifest coincida con cada archivo; que un mismo documento referenciado por dos
asientos entre una sola vez con dos refs; y que la firma deje de estar vigente al
crear un asiento nuevo.
"""

from __future__ import annotations

import hashlib
import io
import json
import zipfile

import pytest


@pytest.fixture()
def libro(monkeypatch, tmp_path):
    db = str(tmp_path / "contabilidad_test.db")
    import app.services.contabilidad_core as cc
    import app.services.contabilidad_db as cdb
    from app.services import dian_cruce, expediente_contable, expediente_paquete

    monkeypatch.setattr(cc, "_DB_PATH", db)
    monkeypatch.setattr(cc, "_initialized", False)
    monkeypatch.setattr(cdb, "_DB_PATH", db)
    monkeypatch.setattr(cc, "_COMPROBANTES_DIR", str(tmp_path / "comprobantes" / "contabilidad"))
    monkeypatch.setattr(expediente_paquete, "_CACHE_DIR", tmp_path / "paq")
    monkeypatch.setattr(expediente_paquete, "_REPO", tmp_path)
    monkeypatch.setattr(dian_cruce, "DIAN_DIR", tmp_path / "dian_vacio")
    monkeypatch.setenv("CONTABILIDAD_FECHA_CORTE", "2026-09-01")
    import app.services.expediente_documentos as ed

    monkeypatch.setattr(ed, "_REPO", tmp_path)
    monkeypatch.setattr(ed, "RAICES", (tmp_path / "comprobantes",))
    cc.init_db()
    dian_cruce._memo.clear()
    expediente_contable._cache.clear()
    with cc._conn() as con:
        banco = cc._cuenta_id_por_codigo(con, "1110")
        gasto = cc._cuenta_id_por_codigo(con, "523550")
    a = cc.crear_movimiento(fecha="2026-09-03", concepto="Pago 1", lineas=[
        {"cuenta_id": gasto, "debito": 1000, "credito": 0}, {"cuenta_id": banco, "debito": 0, "credito": 1000}])
    b = cc.crear_movimiento(fecha="2026-09-04", concepto="Pago 2", lineas=[
        {"cuenta_id": gasto, "debito": 2000, "credito": 0}, {"cuenta_id": banco, "debito": 0, "credito": 2000}])
    mismo = b"%PDF-1.4 el mismo comprobante"
    cc.guardar_comprobante(a["id"], mismo, "giro.pdf", "application/pdf")
    cc.guardar_comprobante(b["id"], mismo, "giro.pdf", "application/pdf")
    return {"cc": cc, "ep": expediente_paquete, "a": a, "b": b}


def test_el_zip_trae_indices_y_sha_verificables_y_no_duplica(libro):
    ep = libro["ep"]
    r = ep.generar("2026-09")
    assert r["estado"] == "listo"
    z = zipfile.ZipFile(io.BytesIO(ep.ruta_zip("2026-09").read_bytes()))
    nombres = set(z.namelist())
    assert {"LEEME.md", "manifest.json", "03_diario/libro_diario.csv", "01_balance/balance_comprobacion.csv",
            "04_banco/conciliacion.csv", "07_soportes/INDICE_SOPORTES.csv"} <= nombres
    m = json.loads(z.read("manifest.json"))
    assert m["periodo"] == "2026-09" and m["version"] == 1
    for a in m["archivos"]:
        assert hashlib.sha256(z.read(a["ruta"])).hexdigest() == a["sha256"], a["ruta"]
    soportes = [a for a in m["archivos"] if a["tipo"] == "comprobante"]
    assert len(soportes) == 1 and sorted(soportes[0]["asientos"]) == sorted([libro["a"]["id"], libro["b"]["id"]])
    assert len(soportes[0]["refs"]) == 2
    assert "Cómo corroborar" in z.read("LEEME.md").decode("utf-8")
    assert ep.estado("2026-09")["firma_vigente"] is True


def test_un_asiento_nuevo_desactualiza_el_paquete(libro):
    ep, cc = libro["ep"], libro["cc"]
    ep.generar("2026-09")
    assert ep.estado("2026-09")["firma_vigente"] is True
    with cc._conn() as con:
        banco = cc._cuenta_id_por_codigo(con, "1110")
        gasto = cc._cuenta_id_por_codigo(con, "523550")
    cc.crear_movimiento(fecha="2026-09-20", concepto="Pago 3", lineas=[
        {"cuenta_id": gasto, "debito": 500, "credito": 0}, {"cuenta_id": banco, "debito": 0, "credito": 500}])
    assert ep.estado("2026-09")["firma_vigente"] is False


def test_sin_paquete_el_estado_es_no_y_el_periodo_se_valida(libro):
    ep = libro["ep"]
    assert ep.estado("2026-08")["estado"] == "no"
    assert ep.ruta_zip("2026-08") is None
    with pytest.raises(ValueError):
        ep.estado("20260-9")
