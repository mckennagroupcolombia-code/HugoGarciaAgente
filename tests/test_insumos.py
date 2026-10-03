"""Insumos: foto de referencia, equivalencias de SKU y contador de unidades (25-sep-2026)."""
from __future__ import annotations

import io
import json

import pytest


@pytest.fixture()
def I(monkeypatch, tmp_path):
    from app.services import insumos

    eq = tmp_path / "eq.json"
    eq.write_text(json.dumps({"equivalencias": {
        "PASBLA180mL": {"usar": "PAS180BLAUn", "motivo": "duplicado"},
    }}), encoding="utf-8")
    monkeypatch.setattr(insumos, "DB_PATH", str(tmp_path / "insumos.db"))
    monkeypatch.setattr(insumos, "FOTOS_DIR", tmp_path / "fotos")
    monkeypatch.setattr(insumos, "EQUIV_PATH", eq)
    items = {
        "PAS180BLAUn": {"reference": "PAS180BLAUn", "name": "PASTILLERO 180mL BLANCO", "type": "product", "status": "active", "unit": "unit"},
        "PASBLA180mL": {"reference": "PASBLA180mL", "name": "PASTILLERO BLANCO 180mL", "type": "product", "status": "active", "unit": "unit"},
        "TAP38": {"reference": "TAP38", "name": "TAPA 38", "type": "product", "status": "active", "unit": "unit"},
        "VIEJO": {"reference": "VIEJO", "name": "INSUMO QUE NADIE USA", "type": "product", "status": "active", "unit": "unit"},
        "BKR10ML": {"reference": "BKR10ML", "name": "BEAKER 10mL", "type": "product", "status": "active", "unit": "unit"},
        "C-A100g": {"reference": "C-A100g", "name": "COMBO A", "type": "kit", "status": "active", "unit": "unit"},
        "C-B100g": {"reference": "C-B100g", "name": "COMBO B", "type": "kit", "status": "active", "unit": "unit"},
    }
    recetas = {"C-A100g": [("PASBLA180mL", 1), ("TAP38", 1)], "C-B100g": [("PAS180BLAUn", 2)]}
    monkeypatch.setattr(insumos, "_catalogo", lambda: (items, recetas))
    monkeypatch.setattr(insumos, "_entradas", lambda desde: {
        "PAS180BLAUN": [{"fecha": "2026-09-10", "cantidad": 200, "proveedor": "Duque", "ref": "x", "asiento": 1, "precio": 742}],
    })
    monkeypatch.setattr(insumos, "_ventas", lambda desde: [
        ("2026-09-05", "C-A100g", 3), ("2026-09-20", "C-B100g", 4),
        ("2026-09-21", "BKR10ML", 2), ("2026-09-21", "C-NOEXISTE", 1), ("2026-09-21", "ENVÍO", 1),
    ])
    insumos.invalidar_cache()
    yield insumos
    insumos.invalidar_cache()


def _fila(I, sku):
    return next(f for f in I.resumen(refrescar=True)["filas"] if f["sku"] == sku)


def test_la_equivalencia_suma_en_el_sku_canonico(I):
    assert I.canonico("PASBLA180mL") == "PAS180BLAUn"
    assert I.canonico("pasbla180ml") == "PAS180BLAUn"
    f = _fila(I, "PAS180BLAUn")
    # C-A usa el viejo (3 ventas × 1) y C-B el canónico (4 ventas × 2): todo en uno.
    assert f["consumido"] == 11
    assert f["n_combos"] == 2
    assert f["equivalentes"] == ["PASBLA180mL"]
    assert all(x["sku"] != "PASBLA180mL" for x in I.resumen()["filas"])


def test_la_existencia_arranca_con_el_primer_lote_registrado(I):
    """Sin conteo: lo comprado menos lo consumido DESDE la primera compra (10-sep).
    La venta del 5-sep salió del inventario viejo y no se descuenta."""
    f = _fila(I, "PAS180BLAUn")
    assert f["existencia"] == 200 - 8          # solo C-B del 20-sep: 4 × 2
    assert f["existencia_base"] == "lotes" and f["existencia_desde"] == "2026-09-10"
    assert f["estado"] == "ok"


def test_sin_lote_ni_conteo_no_se_inventa_existencia(I):
    f = _fila(I, "TAP38")                      # se vende, pero nunca se registró una compra
    assert f["existencia"] is None
    assert f["estado"] == "sin_lote"


def test_la_existencia_parte_del_ultimo_conteo(I):
    I.registrar_conteo("PAS180BLAUn", 50, {"nombre": "Stella"}, fecha="2026-09-15T08:00:00")
    f = _fila(I, "PAS180BLAUn")
    # Después del 15-sep: no hay compras y se venden 4 × 2 = 8 (la venta del 5-sep ya pasó).
    assert f["existencia"] == 42
    assert f["existencia_base"] == "conteo"
    assert f["estado"] == "ok"
    assert f["conteo"]["por"] == "Stella"


def test_el_conteo_de_un_sku_viejo_va_al_canonico(I):
    r = I.registrar_conteo("PASBLA180mL", 10, None, fecha="2026-09-25")
    assert r["sku"] == "PAS180BLAUn"


def test_existencia_negativa_pide_revisar(I):
    I.registrar_conteo("TAP38", 0, None, fecha="2026-09-01")
    assert _fila(I, "TAP38")["estado"] == "revisar"


def test_un_insumo_sin_combos_compras_ni_ventas_es_sin_uso(I):
    assert _fila(I, "VIEJO")["estado"] == "sin_uso"


def test_un_producto_vendido_suelto_se_consume_a_si_mismo(I):
    assert _fila(I, "BKR10ML")["consumido"] == 2


def test_las_ventas_sin_receta_se_reportan_y_el_envio_no(I):
    r = I.resumen(refrescar=True)
    assert r["ventas_sin_resolver"] == {"C-NOEXISTE": 1}


def test_la_foto_se_reduce_y_se_guarda_en_el_canonico(I):
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (3000, 2000), "white").save(buf, "PNG")
    info = I.guardar_foto("PASBLA180mL", buf.getvalue(), "foto.png", {"nombre": "Cynthia"})
    assert info["sku"] == "PAS180BLAUn" and info["subida_por"] == "Cynthia"
    ruta = I.ruta_foto("PAS180BLAUn")
    assert ruta and ruta.suffix == ".jpg"
    assert max(Image.open(ruta).size) <= 1000
    assert _fila(I, "PAS180BLAUn")["foto"] is True


def test_no_se_sube_foto_a_un_combo(I):
    with pytest.raises(ValueError, match="no es un producto de inventario"):
        I.guardar_foto("C-A100g", b"x")


def test_una_compra_no_acepta_un_sku_reemplazado():
    """El archivo real de equivalencias trae PASBLA180mL → PAS180BLAUn."""
    from app.services.pagos_proveedor import validar_compra

    items = [{"sku": "PASBLA180mL", "nombre": "PASTILLERO", "cantidad": 1, "precio": 100, "total": 119}]
    with pytest.raises(ValueError, match="usa PAS180BLAUn"):
        validar_compra(items, 119)
