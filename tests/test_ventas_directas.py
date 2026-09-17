"""Ventas directas: IVA por línea, precio base hacia Alegra y sin doble factura."""

from __future__ import annotations

import pytest

from app.services import ventas_directas as V

PRODUCTOS = {
    # Lista de Alegra = precio final con IVA (así la deja precios_canales).
    "C-LECSOY500g": {"id": "48", "price": 19800.0, "tax_ids": ["4"], "tax_rate_total": 19.0},
    "EXENTO-1": {"id": "70", "price": 5000.0, "tax_ids": [], "tax_rate_total": 0},
    "WEB-ENVIO-VAR": {"id": "600", "price": 0.0, "tax_ids": [], "tax_rate_total": 0},
}


@pytest.fixture(autouse=True)
def _aislado(tmp_path, monkeypatch):
    monkeypatch.setattr(V, "_DB", str(tmp_path / "vd.db"))
    monkeypatch.setattr(V, "_producto_alegra", lambda c: PRODUCTOS.get(c))
    monkeypatch.setattr(V, "_cerrar_pedido_origen", lambda v: None)


def _venta(**extra):
    datos = {
        "cliente": {"nombre": "UNIVERSIDAD SANTIAGO DE CALI", "identificacion": "890303797"},
        "telefono": "3001234567",
        "lineas": [
            {"codigo": "C-LECSOY500g", "nombre": "Lecitina", "cantidad": 2, "precio_unitario": 17820},
            {"codigo": "EXENTO-1", "nombre": "Exento", "cantidad": 1, "precio_unitario": 5000},
        ],
        "envio": 18000,
    }
    datos.update(extra)
    return V.guardar(datos, usuario="jerry")


def test_iva_por_linea_y_envio_sin_iva():
    c = V.calcular(_venta()["lineas"], 18000)
    lec, exento = c["lineas"]
    assert lec["iva_pct"] == 19.0 and exento["iva_pct"] == 0
    # El total es lo que paga el cliente: el IVA sale de adentro, no se suma.
    assert c["total"] == 2 * 17820 + 5000 + 18000
    assert c["iva"] == pytest.approx(35640 - 35640 / 1.19, abs=0.01)
    assert c["subtotal"] + c["iva"] == pytest.approx(c["total"], abs=0.01)


def test_numero_consecutivo_por_dia():
    a, b = _venta(), _venta()
    assert a["numero"].startswith("COT-") and a["numero"] != b["numero"]
    assert a["estado"] == "borrador" and a["creado_por"] == "jerry"


def test_sku_inexistente_se_marca_y_no_factura():
    v = _venta(lineas=[{"codigo": "NO-EXISTE", "cantidad": 1, "precio_unitario": 100}])
    assert v["sin_alegra"] == ["NO-EXISTE"]
    r = V.facturar(v["id"], enviar_whatsapp=False)
    assert not r["ok"] and "NO-EXISTE" in r["error"]
    assert V.obtener(v["id"])["estado"] == "borrador"


def test_cotizacion_alegra_manda_precio_base(monkeypatch):
    enviado = {}

    class Resp:
        status_code = 201

        def json(self):
            return {"id": 9, "number": "2", "total": 58640}

    def fake_post(url, headers, json, timeout):
        enviado.update(url=url, payload=json)
        return Resp()

    import requests

    import app.services.alegra as A

    monkeypatch.setattr(requests, "post", fake_post)
    monkeypatch.setattr(A, "_alegra_headers", lambda: {})
    monkeypatch.setattr(A, "_resolver_o_crear_contacto_alegra", lambda **kw: ("55", ""))
    r = V.crear_cotizacion_alegra(_venta())
    assert r["ok"] and "aviso" not in r, r
    assert enviado["url"].endswith("/estimates")
    lec, exento, envio = enviado["payload"]["items"]
    assert lec["price"] == pytest.approx(17820 / 1.19, abs=0.01) and lec["tax"] == [{"id": "4"}]
    assert exento["price"] == 5000 and "tax" not in exento
    assert envio["id"] == "600" and envio["price"] == 18000


def test_aviso_si_alegra_calcula_otro_total(monkeypatch):
    import requests

    import app.services.alegra as A

    class Resp:
        status_code = 201

        def json(self):
            return {"id": 9, "number": "2", "total": 99999}

    monkeypatch.setattr(requests, "post", lambda *a, **k: Resp())
    monkeypatch.setattr(A, "_alegra_headers", lambda: {})
    monkeypatch.setattr(A, "_resolver_o_crear_contacto_alegra", lambda **kw: ("55", ""))
    assert "aviso" in V.crear_cotizacion_alegra(_venta())


def test_facturar_una_sola_vez(monkeypatch):
    import app.services.alegra as A

    llamadas = []

    def fake_factura(**kw):
        llamadas.append(kw)
        return {"ok": True, "invoice_id": 77, "number": "FE999", "cufe": "x", "url": "u", "pdf_path": None}

    monkeypatch.setattr(A, "crear_factura_venta_alegra", fake_factura)
    monkeypatch.setattr("app.utils.enviar_whatsapp_reporte", lambda *a, **k: True)
    v = _venta()
    r = V.facturar(v["id"], usuario="jerry", medio_pago="CREDIT_TRANSFER", enviar_whatsapp=False)
    assert r["ok"], r
    assert r["venta"]["estado"] == "facturada" and r["venta"]["factura_numero"] == "FE999"
    # El envío viaja como producto y el total es el que paga el cliente.
    kw = llamadas[0]
    assert kw["total"] == 2 * 17820 + 5000 + 18000
    assert [p["codigo"] for p in kw["productos"]] == ["C-LECSOY500g", "EXENTO-1", "WEB-ENVIO-VAR"]

    segunda = V.facturar(v["id"], enviar_whatsapp=False)
    assert not segunda["ok"] and "FE999" in segunda["error"]
    assert len(llamadas) == 1
    with pytest.raises(ValueError):
        V.guardar({"lineas": []}, venta_id=v["id"])
    assert not V.anular(v["id"])["ok"]


def test_fallo_de_alegra_devuelve_la_venta_a_su_estado(monkeypatch):
    import app.services.alegra as A

    monkeypatch.setattr(A, "crear_factura_venta_alegra", lambda **kw: {"ok": False, "error": "DIAN caída"})
    v = _venta()
    r = V.facturar(v["id"], enviar_whatsapp=False)
    assert not r["ok"] and "DIAN" in r["error"]
    assert V.obtener(v["id"])["estado"] == "borrador"


def test_desde_pedido_ia_usa_el_chat_como_destino():
    datos = V.venta_desde_pedido_ia({
        "id": 12, "jid": "730000000000@lid",
        "items": [{"ref": "C-LECSOY500g", "nombre": "Lecitina", "precio": 17820, "cantidad": 3}],
        "cliente": {"nombre": "Ana", "documento": "123", "direccion": "Cra 1", "ciudad": "Cali"},
        "envio": 12000,
    })
    assert datos["telefono"] == "730000000000@lid"
    assert datos["origen"] == "pedido_ia" and datos["origen_ref"] == "12"
    v = V.guardar(datos)
    assert v["total"] == 3 * 17820 + 12000
    assert v["cliente"]["identificacion"] == "123"
