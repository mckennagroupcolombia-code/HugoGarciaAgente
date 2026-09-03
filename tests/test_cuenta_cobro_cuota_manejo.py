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


def test_accent_rgb_de_perfil_y_resolver():
    from app.services.cuenta_cobro_cuota_manejo import (
        accent_rgb_de_perfil,
        resolver_accent_cuenta_cobro,
    )

    armando = {
        "nombre": "Armando",
        "preferencias_ui": {"panel": {"accentRgb": "190 75 99"}},
    }
    assert accent_rgb_de_perfil(armando) == "190 75 99"
    # Emisor gana sobre el accent enviado por el cliente (tema de quien opera el panel)
    assert resolver_accent_cuenta_cobro("12 96 105", emisor_perfil=armando) == "190 75 99"
    assert resolver_accent_cuenta_cobro("", emisor_perfil=armando) == "190 75 99"
    assert resolver_accent_cuenta_cobro("42 125 78", emisor_perfil=None) == "42 125 78"
    assert resolver_accent_cuenta_cobro("", emisor_perfil=None) == "12 96 105"
    assert accent_rgb_de_perfil({"preferencias_ui": {"panel": {"accentRgb": "#e85c80"}}}) == "232 92 128"


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
    assert "Valores en pesos (COP)" in text
    assert "TRM BanRep 4000" in text


def test_resolver_cop_mal_etiquetado_usa_trm_dia(monkeypatch):
    from app.services.cuenta_cobro_cuota_manejo import resolver_tasa_cuenta_cobro

    monkeypatch.setattr(
        "app.services.trm.obtener_trm",
        lambda fecha=None, **kw: {"valor": 4012.45, "fecha": "2026-08-21"},
    )
    out = resolver_tasa_cuenta_cobro(
        moneda="COP",
        trm=1,
        fecha_compra="2026-08-21",
        lineas=[{"nombre": "Agitador", "subtotal": 531.51, "descuento": 0.01}],
    )
    assert out["error"] is None
    assert out["moneda"] == "USD"
    assert out["trm"] == 4012.45
    assert out["trm_fuente"] == "banrep"
    assert out["corregido"] is True


def test_resolver_cop_real_no_convierte():
    from app.services.cuenta_cobro_cuota_manejo import resolver_tasa_cuenta_cobro

    out = resolver_tasa_cuenta_cobro(
        moneda="COP",
        trm=1,
        fecha_compra="2026-08-21",
        lineas=[{"nombre": "Local", "subtotal": 180_000, "descuento": 0}],
        consultar_banrep=False,
    )
    assert out["moneda"] == "COP"
    assert out["trm"] == 1.0
    assert out["corregido"] is False


def test_guardar_cop_usd_liquida_cuenta_en_pesos(tmp_path, monkeypatch):
    import app.services.contabilidad_db as db
    from app.services import cuenta_cobro_cuota_manejo as mod

    monkeypatch.setattr(db, "_DB_PATH", str(tmp_path / "c_trm.db"))
    db._initialized = False
    monkeypatch.setattr(mod, "_CARPETA", str(tmp_path / "pdfs_trm"))
    monkeypatch.setattr(
        "app.services.trm.obtener_trm",
        lambda fecha=None, **kw: {"valor": 4000.0, "fecha": "2026-08-21"},
    )

    row = db.guardar_compra_exterior(
        moneda="COP",
        trm=1,
        flete=0,
        moneda_flete="COP",
        proveedor="Marketplace",
        lineas=[
            {
                "nombre": "Agitador Magnético Con Plancha Calefactora",
                "codigo": "AGTMGNPLN",
                "cantidad": 3,
                "unidad": "un",
                "precio_unit": 177.17,
                "subtotal": 531.51,
                "descuento": 0.01,
                "ok": True,
            }
        ],
        total_guardados=1,
        fecha_compra="2026-08-21",
        trm_fuente="cop",
    )
    assert row["moneda"] == "USD"
    assert row["trm"] == 4000.0
    assert row["valor_compra_cop"] == 2_126_000.0
    assert row["cuota_manejo_cop"] == 106_300.0
    assert row["total_cobro_cop"] == 2_232_300.0
    assert row["cuenta_cobro_estado"] == "pendiente"


def test_datos_emisor_usa_perfil_asignado():
    from app.services.cuenta_cobro_cuota_manejo import datos_emisor

    out = datos_emisor(
        {
            "nombre": "Armando García Velandia",
            "documento_identidad": "1013630698",
            "email": "armando@example.com",
        }
    )
    assert out["nombre"] == "Armando García Velandia"
    assert out["documento"] == "1013630698"
    assert out["email"] == "armando@example.com"


def test_pdf_cuenta_cobro_muestra_numero_pedido_documento(tmp_path, monkeypatch):
    from app.services import cuenta_cobro_cuota_manejo as mod
    from PyPDF2 import PdfReader

    monkeypatch.setattr(mod, "_CARPETA", str(tmp_path))
    gen = mod.generar_pdf_cuenta_cobro(
        compra_id=42,
        moneda="USD",
        trm=4000,
        proveedor="MakingCosmetics",
        fecha_compra="2026-08-20",
        numero_pedido="SO-118877",
        lineas=[{"nombre": "Urea", "cantidad": 1, "unidad": "kg", "subtotal": 25, "descuento": 0}],
        accent_rgb="12 96 105",
    )
    assert gen["error"] is None
    text = "\n".join((p.extract_text() or "") for p in PdfReader(gen["path"]).pages)
    assert "Pedido SO-118877" in text
    assert "Pedido Nº 42" not in text


def test_etiqueta_pedido_prioriza_numero_documento():
    from app.services.cuenta_cobro_cuota_manejo import _etiqueta_pedido_cuenta

    assert _etiqueta_pedido_cuenta(7, "INV-9090") == "Pedido INV-9090"
    assert _etiqueta_pedido_cuenta(7, "") == "Pedido Nº 7"
    assert _etiqueta_pedido_cuenta(7, "", compras_ids=[3, 5]) == "Pedidos Nº 3, Nº 5"


def test_guardar_compra_persiste_numero_pedido(tmp_path, monkeypatch):
    import app.services.contabilidad_db as db

    monkeypatch.setattr(db, "_DB_PATH", str(tmp_path / "pedido.db"))
    db._initialized = False
    row = db.guardar_compra_exterior(
        moneda="USD",
        trm=4000,
        flete=0,
        moneda_flete="USD",
        proveedor="MakingCosmetics",
        numero_pedido="SO-118877",
        lineas=[
            {
                "nombre": "Urea",
                "codigo": "UREA250",
                "cantidad": 1,
                "unidad": "kg",
                "precio_unit": 25,
                "subtotal": 25,
                "descuento": 0,
                "ok": True,
            }
        ],
        total_guardados=1,
        fecha_compra="2026-08-20",
        trm_fuente="banrep",
    )
    assert row["numero_pedido"] == "SO-118877"
    got = db.obtener_compra_exterior(int(row["id"]))
    assert got is not None
    assert got["numero_pedido"] == "SO-118877"


def test_pdf_cuenta_cobro_usa_nombre_del_emisor_asignado(tmp_path, monkeypatch):
    from app.services import cuenta_cobro_cuota_manejo as mod
    from PyPDF2 import PdfReader

    monkeypatch.setattr(mod, "_CARPETA", str(tmp_path))
    gen = mod.generar_pdf_cuenta_cobro(
        compra_id=11,
        moneda="COP",
        trm=1,
        proveedor="Amazon",
        lineas=[{"nombre": "Glicerina", "subtotal": 100_000, "descuento": 0}],
        accent_rgb="12 96 105",
        emisor_perfil={
            "nombre": "Armando García Velandia",
            "documento_identidad": "1013630698",
        },
    )
    assert gen["error"] is None
    text = "\n".join((p.extract_text() or "") for p in PdfReader(gen["path"]).pages)
    assert "Armando García Velandia" in text
    assert "1013630698" in text
    assert "Cynthia Ruiz" not in text


def test_guardar_y_aprobar_persiste_emisor_asignado(tmp_path, monkeypatch):
    import app.services.contabilidad_db as db
    from app.services import cuenta_cobro_cuota_manejo as mod

    monkeypatch.setattr(db, "_DB_PATH", str(tmp_path / "emisor.db"))
    db._initialized = False
    monkeypatch.setattr(mod, "_CARPETA", str(tmp_path / "pdfs_emisor"))
    monkeypatch.setattr(
        "app.services.cuenta_cobro_cuota_manejo.perfil_emisor_por_id",
        lambda uid: {
            "id": int(uid),
            "nombre": "Armando García Velandia",
            "documento_identidad": "1013630698",
        }
        if uid
        else None,
    )

    row = db.guardar_compra_exterior(
        moneda="COP",
        trm=1,
        flete=0,
        moneda_flete="COP",
        proveedor="Amazon",
        lineas=[{"nombre": "Y", "subtotal": 80_000, "descuento": 0, "ok": True}],
        total_guardados=1,
        emisor_usuario_id=7,
    )
    assert row["emisor_usuario_id"] == 7
    assert row["emisor_nombre"] == "Armando García Velandia"

    approved = db.aprobar_cuenta_cobro_compra(
        row["id"],
        accent_rgb="12 96 105",
        emisor_perfil={
            "id": 7,
            "nombre": "Armando García Velandia",
            "documento_identidad": "1013630698",
        },
    )
    assert approved is not None
    assert approved["emisor_usuario_id"] == 7
    assert approved["emisor_nombre"] == "Armando García Velandia"
    path_info = db.ruta_cuenta_cobro_compra(row["id"])
    assert path_info is not None
    from PyPDF2 import PdfReader

    text = "\n".join((p.extract_text() or "") for p in PdfReader(path_info[0]).pages)
    assert "Armando García Velandia" in text
    assert "Pedido" in text
    assert str(row["id"]) in text


def test_envio_liquida_flete_con_fecha_envio(tmp_path, monkeypatch):
    """Varias compras, un paquete: flete COP = flete × TRM del día de envío, no de cada factura."""
    import app.services.contabilidad_db as db

    monkeypatch.setattr(db, "_DB_PATH", str(tmp_path / "envios.db"))
    db._initialized = False
    monkeypatch.setattr(
        "app.services.trm.obtener_trm",
        lambda fecha=None, **kw: {"valor": 4200.0, "fecha": str(fecha or "")[:10]},
    )

    a = db.guardar_compra_exterior(
        moneda="USD",
        trm=4000,
        flete=0,
        moneda_flete="USD",
        proveedor="A",
        fecha_compra="2026-08-01",
        lineas=[
            {
                "nombre": "A",
                "cantidad": 1,
                "unidades_por_pack": 10,
                "precio_unit": 10,
                "subtotal": 10,
                "descuento": 0,
                "ok": True,
            }
        ],
        total_guardados=1,
    )
    b = db.guardar_compra_exterior(
        moneda="USD",
        trm=4100,
        flete=0,
        moneda_flete="USD",
        proveedor="B",
        fecha_compra="2026-08-10",
        lineas=[
            {
                "nombre": "B",
                "cantidad": 1,
                "unidades_por_pack": 30,
                "precio_unit": 20,
                "subtotal": 20,
                "descuento": 0,
                "ok": True,
            }
        ],
        total_guardados=1,
    )
    env, err = db.crear_envio_compras(
        [a["id"], b["id"]],
        fecha_envio="2026-08-20",
        flete=40,
        moneda_flete="USD",
    )
    assert err == ""
    assert env is not None
    assert env["fecha_envio"] == "2026-08-20"
    assert env["trm"] == 4200.0
    assert env["flete_cobro_cop"] == 168_000.0
    assert env["cuenta_flete_pendiente"] is True
    assert sorted(env["compra_ids"]) == sorted([a["id"], b["id"]])

    a2 = db.obtener_compra_exterior(a["id"])
    b2 = db.obtener_compra_exterior(b["id"])
    assert a2["envio_id"] == env["id"]
    assert b2["envio_id"] == env["id"]
    assert not a2.get("cuenta_flete_pendiente")
    assert (a2.get("flete_cobro_cop") or 0) == 0
    assert a2["valor_compra_cop"] == 40_000.0
    assert b2["valor_compra_cop"] == 82_000.0
    # 1 pack + 1 pack → 50% / 50% del flete (no por ml/g)
    costo_a = a2["lineas"][0].get("costo_unitario") or a2["lineas"][0].get("costo_unitario_cop")
    costo_b = b2["lineas"][0].get("costo_unitario") or b2["lineas"][0].get("costo_unitario_cop")
    assert round(float(costo_a), 2) == 12_400.0  # (40000 + 84000) / 10
    assert round(float(costo_b), 2) == 5_533.33  # (82000 + 84000) / 30
    assert round(float(a2["lineas"][0].get("flete_asignado_cop") or 0), 2) == 84_000.0
    assert round(float(b2["lineas"][0].get("flete_asignado_cop") or 0), 2) == 84_000.0


def test_envio_flete_por_porcentaje_paquetes(tmp_path, monkeypatch):
    """2 packs vs 8 packs → 20% / 80% del flete del envío."""
    import app.services.contabilidad_db as db

    monkeypatch.setattr(db, "_DB_PATH", str(tmp_path / "envios_packs.db"))
    db._initialized = False
    monkeypatch.setattr(
        "app.services.trm.obtener_trm",
        lambda fecha=None, **kw: {"valor": 4000.0, "fecha": "2026-08-20"},
    )
    a = db.guardar_compra_exterior(
        moneda="USD",
        trm=4000,
        flete=0,
        moneda_flete="USD",
        proveedor="A",
        fecha_compra="2026-08-01",
        lineas=[
            {
                "nombre": "A",
                "cantidad": 2,
                "unidades_por_pack": 100,
                "precio_unit": 5,
                "subtotal": 10,
                "descuento": 0,
                "ok": True,
            }
        ],
        total_guardados=1,
    )
    b = db.guardar_compra_exterior(
        moneda="USD",
        trm=4000,
        flete=0,
        moneda_flete="USD",
        proveedor="B",
        fecha_compra="2026-08-10",
        lineas=[
            {
                "nombre": "B",
                "cantidad": 8,
                "unidades_por_pack": 10,
                "precio_unit": 10,
                "subtotal": 80,
                "descuento": 0,
                "ok": True,
            }
        ],
        total_guardados=1,
    )
    env, err = db.crear_envio_compras(
        [a["id"], b["id"]], fecha_envio="2026-08-20", flete=100, moneda_flete="USD"
    )
    assert err == ""
    assert env["flete_cobro_cop"] == 400_000.0
    a2 = db.obtener_compra_exterior(a["id"])
    b2 = db.obtener_compra_exterior(b["id"])
    # 2/10=20% → 80000; 8/10=80% → 320000
    assert round(float(a2["lineas"][0].get("flete_asignado_cop") or 0), 2) == 80_000.0
    assert round(float(b2["lineas"][0].get("flete_asignado_cop") or 0), 2) == 320_000.0
    # A: pack 5 USD→20k + flete/pack 40k → /100 = 600
    # B: pack 10 USD→40k + flete/pack 40k → /10 = 8000
    costo_a = a2["lineas"][0].get("costo_unitario") or a2["lineas"][0].get("costo_unitario_cop")
    costo_b = b2["lineas"][0].get("costo_unitario") or b2["lineas"][0].get("costo_unitario_cop")
    assert round(float(costo_a), 2) == 600.0
    assert round(float(costo_b), 2) == 8_000.0


def test_recalcular_costos_unitarios_envio_boton(tmp_path, monkeypatch):
    import app.services.contabilidad_db as db

    monkeypatch.setattr(db, "_DB_PATH", str(tmp_path / "envios_recalc.db"))
    db._initialized = False
    monkeypatch.setattr(
        "app.services.trm.obtener_trm",
        lambda fecha=None, **kw: {"valor": 4000.0, "fecha": "2026-08-20"},
    )
    a = db.guardar_compra_exterior(
        moneda="USD",
        trm=4000,
        flete=0,
        moneda_flete="USD",
        proveedor="A",
        fecha_compra="2026-08-01",
        lineas=[
            {
                "nombre": "A",
                "cantidad": 1,
                "unidades_por_pack": 10,
                "precio_unit": 10,
                "subtotal": 10,
                "descuento": 0,
                "ok": True,
            }
        ],
        total_guardados=1,
    )
    b = db.guardar_compra_exterior(
        moneda="USD",
        trm=4000,
        flete=0,
        moneda_flete="USD",
        proveedor="B",
        fecha_compra="2026-08-10",
        lineas=[
            {
                "nombre": "B",
                "cantidad": 1,
                "unidades_por_pack": 10,
                "precio_unit": 10,
                "subtotal": 10,
                "descuento": 0,
                "ok": True,
            }
        ],
        total_guardados=1,
    )
    env, err = db.crear_envio_compras(
        [a["id"], b["id"]], fecha_envio="2026-08-20", flete=20, moneda_flete="USD"
    )
    assert err == ""
    # Simula costos viejos sin flete
    with db._conn() as con:
        con.execute(
            "UPDATE compras_exterior SET lineas_json=? WHERE id=?",
            (
                '[{"nombre":"A","cantidad":1,"unidades_por_pack":10,"precio_unit":10,'
                '"subtotal":10,"descuento":0,"costo_unitario":4000,"ok":true}]',
                a["id"],
            ),
        )
    env2, compras, err2 = db.recalcular_costos_unitarios_envio(env["id"])
    assert err2 == ""
    assert env2 is not None
    assert len(compras) == 2
    ca = next(c for c in compras if c["id"] == a["id"])
    costo = ca["lineas"][0].get("costo_unitario") or ca["lineas"][0].get("costo_unitario_cop")
    # 50% de 20 USD × 4000 = 40000 flete; (40000 + 40000)/10 = 8000
    assert round(float(costo), 2) == 8_000.0


def test_envio_cuenta_flete_pdf(tmp_path, monkeypatch):
    import app.services.contabilidad_db as db
    from app.services import cuenta_cobro_cuota_manejo as mod

    monkeypatch.setattr(db, "_DB_PATH", str(tmp_path / "envios_pdf.db"))
    db._initialized = False
    monkeypatch.setattr(mod, "_CARPETA", str(tmp_path / "pdfs_env"))
    monkeypatch.setattr(
        "app.services.trm.obtener_trm",
        lambda fecha=None, **kw: {"valor": 4000.0, "fecha": "2026-08-20"},
    )
    a = db.guardar_compra_exterior(
        moneda="USD",
        trm=4000,
        flete=0,
        moneda_flete="USD",
        proveedor="A",
        fecha_compra="2026-08-01",
        lineas=[{"nombre": "X", "subtotal": 10, "descuento": 0, "ok": True}],
        total_guardados=1,
    )
    b = db.guardar_compra_exterior(
        moneda="USD",
        trm=4000,
        flete=0,
        moneda_flete="USD",
        proveedor="B",
        fecha_compra="2026-08-10",
        lineas=[{"nombre": "Y", "subtotal": 20, "descuento": 0, "ok": True}],
        total_guardados=1,
    )
    env, err = db.crear_envio_compras(
        [a["id"], b["id"]], fecha_envio="2026-08-20", flete=5, moneda_flete="USD"
    )
    assert err == ""
    approved, err2 = db.aprobar_cuenta_flete_envio(
        env["id"],
        accent_rgb="12 96 105",
        emisor_perfil={
            "id": 7,
            "nombre": "Armando García Velandia",
            "documento_identidad": "1013630698",
        },
    )
    assert err2 == ""
    assert approved["tiene_cuenta_flete"] is True
    path_info = db.ruta_cuenta_flete_envio(env["id"])
    assert path_info is not None
    assert os.path.isfile(path_info[0])


