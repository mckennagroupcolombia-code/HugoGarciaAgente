"""Tests cuota de manejo / cuenta de cobro en compras exterior."""
from __future__ import annotations

import os


def test_calcular_cuota_mercancia_mas_5_pct():
    from app.services.cuenta_cobro_cuota_manejo import calcular_cuota

    calc = calcular_cuota(
        moneda="USD",
        trm=4000,
        lineas=[
            {"nombre": "A", "cantidad": 2, "precio_unit": 10, "subtotal": 20, "descuento": 0},
            {"nombre": "B", "cantidad": 1, "precio_unit": 5, "subtotal": 5, "descuento": 1},
        ],
        pct=5,
    )
    assert calc["valor_compra_cop"] == 96000.0
    assert calc["cuota_manejo_cop"] == 4800.0
    assert calc["total_cobro_cop"] == 100800.0


def test_flete_aparte_no_entra_en_total_mercancia():
    from app.services.cuenta_cobro_cuota_manejo import calcular_cuota

    calc = calcular_cuota(
        moneda="USD",
        trm=4000,
        lineas=[{"subtotal": 100, "descuento": 0}],
        flete=10,
        moneda_flete="USD",
        pct=5,
    )
    assert calc["valor_compra_cop"] == 400_000.0
    assert calc["cuota_manejo_cop"] == 20_000.0
    assert calc["total_cobro_cop"] == 420_000.0
    assert calc["flete_cop"] == 40_000.0


def test_aprobar_flete_genera_pdf_aparte(tmp_path, monkeypatch):
    import app.services.contabilidad_db as db
    from app.services import cuenta_cobro_cuota_manejo as mod

    monkeypatch.setattr(db, "_DB_PATH", str(tmp_path / "cf.db"))
    db._initialized = False
    monkeypatch.setattr(mod, "_CARPETA", str(tmp_path / "pdfs_f"))

    row = db.guardar_compra_exterior(
        moneda="USD",
        trm=4000,
        flete=5,
        moneda_flete="USD",
        proveedor="Shop",
        lineas=[{"nombre": "X", "subtotal": 50, "descuento": 0, "ok": True}],
        total_guardados=1,
    )
    assert row["cuenta_flete_estado"] == "pendiente"
    assert row["flete_cobro_cop"] == 20_000.0
    assert row["cuenta_flete_pendiente"] is True

    approved = db.aprobar_cuenta_cobro_compra(row["id"], accent_rgb="12 96 105", tipo="flete")
    assert approved is not None
    assert approved["cuenta_flete_estado"] == "aprobada"
    assert approved["tiene_cuenta_flete"] is True
    assert approved["cuenta_cobro_estado"] == "pendiente"  # mercancía sigue pendiente
    path_info = db.ruta_cuenta_cobro_compra(row["id"], tipo="flete")
    assert path_info is not None
    assert "FLETE" in path_info[1].upper()
    assert os.path.isfile(path_info[0])


def test_accent_to_hex():
    from app.services.cuenta_cobro_cuota_manejo import accent_to_hex

    assert accent_to_hex("12 96 105") == "#0c6069"
    assert accent_to_hex("#be4b63") == "#be4b63"
    assert accent_to_hex("rgb(190, 75, 99)") == "#be4b63"


def test_guardar_deja_pendiente_sin_pdf(tmp_path, monkeypatch):
    import app.services.contabilidad_db as db
    from app.services import cuenta_cobro_cuota_manejo as mod

    monkeypatch.setattr(db, "_DB_PATH", str(tmp_path / "c.db"))
    db._initialized = False
    monkeypatch.setattr(mod, "_CARPETA", str(tmp_path / "pdfs"))

    row = db.guardar_compra_exterior(
        moneda="USD",
        trm=4000,
        flete=10,
        moneda_flete="USD",
        proveedor="Shop",
        lineas=[{"nombre": "X", "cantidad": 1, "precio_unit": 50, "subtotal": 50, "descuento": 0, "ok": True}],
        total_guardados=1,
        fecha_compra="2026-08-05",
    )
    assert row["cuenta_cobro_estado"] == "pendiente"
    assert row["cuenta_cobro_pendiente"] is True
    assert row["tiene_cuenta_cobro"] is False
    assert row["total_cobro_cop"] == 210_000.0  # 200k + 10k
    assert not row.get("cuenta_cobro_path")
    assert db.ruta_cuenta_cobro_compra(row["id"]) is None


def test_aprobar_genera_pdf_con_accent(tmp_path, monkeypatch):
    import app.services.contabilidad_db as db
    from app.services import cuenta_cobro_cuota_manejo as mod

    monkeypatch.setattr(db, "_DB_PATH", str(tmp_path / "c2.db"))
    db._initialized = False
    monkeypatch.setattr(mod, "_CARPETA", str(tmp_path / "pdfs2"))

    row = db.guardar_compra_exterior(
        moneda="COP",
        trm=1,
        flete=0,
        moneda_flete="COP",
        proveedor="Local",
        lineas=[{"nombre": "Y", "subtotal": 100_000, "descuento": 0, "ok": True}],
        total_guardados=1,
    )
    approved = db.aprobar_cuenta_cobro_compra(row["id"], accent_rgb="190 75 99")
    assert approved is not None
    assert approved["cuenta_cobro_estado"] == "aprobada"
    assert approved["tiene_cuenta_cobro"] is True
    assert approved["total_cobro_cop"] == 105_000.0
    path_info = db.ruta_cuenta_cobro_compra(row["id"])
    assert path_info is not None
    assert os.path.isfile(path_info[0])
    assert os.path.getsize(path_info[0]) > 500


def test_detalle_productos_en_concepto(tmp_path, monkeypatch):
    from app.services import cuenta_cobro_cuota_manejo as mod
    from app.services.cuenta_cobro_cuota_manejo import detalle_productos_cop
    from PyPDF2 import PdfReader

    dets = detalle_productos_cop(
        moneda="USD",
        trm=4000,
        lineas=[
            {"nombre": "Glicerina USP", "cantidad": 2, "unidad": "kg", "subtotal": 40, "descuento": 0},
            {"nombre": "Urea cosmética", "cantidad": 1, "unidad": "kg", "subtotal": 25, "descuento": 5},
        ],
    )
    assert len(dets) == 2
    assert dets[0]["valor_cop"] == 160_000.0
    assert dets[1]["valor_cop"] == 80_000.0

    monkeypatch.setattr(mod, "_CARPETA", str(tmp_path))
    gen = mod.generar_pdf_cuenta_cobro(
        compra_id=9,
        moneda="USD",
        trm=4000,
        proveedor="Amazon",
        lineas=[
            {"nombre": "Glicerina USP", "cantidad": 2, "unidad": "kg", "subtotal": 40, "descuento": 0},
            {"nombre": "Urea cosmética", "cantidad": 1, "unidad": "kg", "subtotal": 25, "descuento": 5},
        ],
        accent_rgb="12 96 105",
    )
    assert gen["error"] is None
    assert gen["valor_compra_cop"] == 240_000.0
    text = "\n".join((p.extract_text() or "") for p in PdfReader(gen["path"]).pages)
    assert "Glicerina USP" in text
    assert "Urea cosmética" in text
    assert "Adquisición de" in text
