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


def test_sin_whatsapp_se_factura_igual(monkeypatch):
    """Venta de MeLi: no hay teléfono y el operador ponía «.». Antes fallaba con
    «Teléfono inválido» y la factura nunca salía (COT-20260922-001)."""
    import app.services.alegra as A

    llamadas = []
    monkeypatch.setattr(A, "crear_factura_venta_alegra",
                        lambda **kw: llamadas.append(kw) or {"ok": True, "invoice_id": 5, "number": "FE5"})
    monkeypatch.setattr("app.utils.enviar_whatsapp_reporte", lambda *a, **k: True)
    for tel in (".", "", " - "):
        v = _venta(telefono=tel)
        r = V.facturar(v["id"])
        assert r["ok"], r
        assert llamadas[-1]["telefono"] == ""
    # Un número a medio escribir sí se detiene: probablemente es un error de digitación.
    v = _venta(telefono="300123")
    assert "Teléfono inválido" in V.facturar(v["id"])["error"]


def test_venta_meli_queda_ligada_al_pack(monkeypatch):
    import app.services.alegra as A

    llamadas, subidas, marcadas = [], [], []
    monkeypatch.setattr(V, "_claves_meli", lambda ref: {"ok": True, "pack_id": "2000015079567449",
                                                        "order_ids": ["2000018509417474"], "orden": {}})
    monkeypatch.setattr(V, "_bloqueo_meli", lambda pack, ords, **kw: None)
    monkeypatch.setattr(A, "crear_factura_venta_alegra",
                        lambda **kw: llamadas.append(kw) or {"ok": True, "invoice_id": 9, "number": "FE9",
                                                             "pdf_base64": "JVBER"})
    monkeypatch.setattr("app.services.meli.subir_factura_meli", lambda *a, **k: subidas.append(a) or "✅")
    monkeypatch.setattr("app.tools.meli_autofactura_entrega._registrar_estado_orden",
                        lambda oid, **kw: marcadas.append((oid, kw)))
    monkeypatch.setattr("app.utils.enviar_whatsapp_reporte", lambda *a, **k: True)

    v = _venta(telefono=".", origen="meli", origen_ref="2000015079567449")
    r = V.facturar(v["id"])
    assert r["ok"], r
    assert llamadas[0]["purchase_order"] == "2000015079567449"
    assert "2000015079567449" in llamadas[0]["observaciones"]
    assert subidas and subidas[0][0] == "2000015079567449"
    assert marcadas[0][0] == "2000018509417474" and marcadas[0][1]["estado"] == "facturada"


def test_venta_meli_ya_facturada_no_emite(monkeypatch):
    import app.services.alegra as A

    llamadas = []
    monkeypatch.setattr(V, "_claves_meli", lambda ref: {"ok": True, "pack_id": "1", "order_ids": ["2"], "orden": {}})
    monkeypatch.setattr(V, "_bloqueo_meli", lambda pack, ords, **kw: "La venta de MeLi 1 ya tiene factura en Alegra (FE7).")
    monkeypatch.setattr(A, "crear_factura_venta_alegra", lambda **kw: llamadas.append(kw))
    v = _venta(origen="meli", origen_ref="1")
    r = V.facturar(v["id"], enviar_whatsapp=False)
    assert not r["ok"] and "FE7" in r["error"] and not llamadas
    assert V.obtener(v["id"])["estado"] == "borrador"


def test_identificacion_fiscal_empresa_va_como_nit():
    """Sin tipo, Alegra adivinaba por longitud y EQUISURE S.A.S (FE465) quedó como CC."""
    f = V.identificacion_fiscal
    assert f({"nombre": "EQUISURE S.A.S", "identificacion": "901504420"}) == ("NIT", "901504420", None)
    # Como lo entrega MeLi: base + DV pegado.
    assert f({"nombre": "JP BIOINGENIERIA S A S", "identificacion": "9004092166"}) == ("NIT", "900409216", None)
    assert f({"nombre": "x", "identificacion": "900.409.216-6"}) == ("NIT", "900409216", None)
    assert f({"nombre": "Sofía Agudelo", "identificacion": "1092943750"}) == ("CC", "1092943750", None)
    assert f({"nombre": "Ana", "identificacion": "901504420", "tipo_documento": "CC"})[0] == "CC"
    # DV que no cuadra: se detiene antes de emitir.
    assert f({"nombre": "x", "identificacion": "900409216-5"})[2]
    assert f({"nombre": "JP SAS", "identificacion": "9004092165"})[2]


def test_factura_manda_el_tipo_a_alegra(monkeypatch):
    import app.services.alegra as A

    llamadas = []
    monkeypatch.setattr(A, "crear_factura_venta_alegra",
                        lambda **kw: llamadas.append(kw) or {"ok": True, "invoice_id": 1, "number": "FE1"})
    monkeypatch.setattr("app.utils.enviar_whatsapp_reporte", lambda *a, **k: True)
    v = _venta(telefono="", cliente={"nombre": "JP BIOINGENIERIA S.A.S.", "identificacion": "900409216-6"})
    assert V.facturar(v["id"])["ok"]
    assert llamadas[0]["tipo_documento"] == "NIT" and llamadas[0]["identificacion"] == "900409216"
