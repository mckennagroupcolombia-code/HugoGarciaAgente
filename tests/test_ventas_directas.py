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
    # `facturar()` causa la venta en el Libro Mayor al instante. Sin esto, cada
    # corrida escribía en el contabilidad.db REAL: el 22-sep-2026 dejó tres
    # «Venta Alegra» falsas (FE999, FE5, FE1 por $58.640, asientos 5762-5764)
    # que inflaban 4135 y Bancos en $175.920 hasta que se anularon el 28-sep.
    import app.services.contabilidad_core as cc

    monkeypatch.setattr(cc, "_DB_PATH", str(tmp_path / "contabilidad.db"))
    monkeypatch.setattr(cc, "_initialized", False)
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


def test_factura_creada_pero_rechazada_por_dian_no_se_emite_otra(monkeypatch):
    """RED CHOCOLATE SAS (28-sep-2026): la DIAN rechazó el correo, Alegra dejó la
    factura creada y cada reintento sacó otra (FE711-716, FE908, FE910)."""
    import app.services.alegra as A

    llamadas = []

    def fake_factura(**kw):
        llamadas.append(kw)
        return {"ok": False, "error": "Error al crear factura en Alegra: correo inválido", "creada_sin_timbrar": True,
                "invoice_id": "910", "number": "FE910", "url": "https://app.alegra.com/invoice/view/id/910"}

    timbradas = []

    def fake_timbrar(fid, **kw):
        timbradas.append(fid)
        return {"ok": True, "invoice_id": fid, "number": "FE910", "cufe": "c", "url": "u", "pdf_path": None}

    monkeypatch.setattr(A, "crear_factura_venta_alegra", fake_factura)
    monkeypatch.setattr(A, "timbrar_factura_existente_alegra", fake_timbrar)
    monkeypatch.setattr(A, "_resolver_o_crear_contacto_alegra", lambda **kw: ("573", ""))
    monkeypatch.setattr("app.utils.enviar_whatsapp_reporte", lambda *a, **k: True)
    v = _venta()
    r = V.facturar(v["id"], enviar_whatsapp=False)
    assert not r["ok"] and "FE910" in r["error"]
    guardada = V.obtener(v["id"])
    assert guardada["estado"] == "borrador" and guardada["factura_id"] == "910"
    assert not V.anular(v["id"])["ok"]
    # Reintentar = timbrar ESA factura, no crear otra.
    r2 = V.facturar(v["id"], enviar_whatsapp=False)
    assert r2["ok"], r2
    assert len(llamadas) == 1 and timbradas == ["910"]
    assert r2["venta"]["estado"] == "facturada" and r2["venta"]["factura_numero"] == "FE910"


def test_alegra_devuelve_la_factura_que_quedo_creada(monkeypatch):
    import requests

    import app.services.alegra as A

    class Resp:
        status_code = 400
        text = "{}"

        def json(self):
            return {"error": {"message": "No cumple:<ul><li>El formato del correo es inválido.</li></ul>", "code": 3051},
                    "invoice": {"id": "910", "numberTemplate": {"fullNumber": "FE910"}}}

    monkeypatch.setattr(requests, "post", lambda *a, **k: Resp())
    monkeypatch.setattr(A, "_alegra_headers", lambda: {})
    monkeypatch.setattr(A, "_resolver_o_crear_contacto_alegra", lambda **kw: ("573", ""))
    monkeypatch.setattr(A, "resolver_producto_venta_alegra", lambda c: {"id": "1", "tax_ids": [], "tax_rate_total": 0})
    r = A.crear_factura_venta_alegra(nombre_cliente="RED CHOCOLATE SAS", identificacion="900614242", direccion_envio="",
                                     productos=[{"codigo": "X", "nombre": "X", "cantidad": 1, "precio_unitario": 1000}],
                                     total=1000, email="facturacion@redchocolate.net")
    assert not r["ok"] and r["creada_sin_timbrar"] and r["invoice_id"] == "910" and r["number"] == "FE910"
    assert "<li>" not in r["error"] and "FE910" in r["error"]


def test_nit_de_empresa_es_persona_juridica():
    import app.services.alegra as A

    assert A._tipo_persona_contacto("NIT", "900614242", "RED CHOCOLATE SAS") == {"kindOfPerson": "LEGAL_ENTITY"}
    assert A._tipo_persona_contacto("CC", "1032410986", "Carlos Santos")["kindOfPerson"] == "PERSON_ENTITY"


def test_correo_con_espacio_se_corrige_y_uno_invalido_no_llega_a_alegra(monkeypatch):
    import requests

    import app.services.alegra as A

    assert A.normalizar_email_factura("facturacion @redchocolate.net") == ("facturacion@redchocolate.net", None)
    assert A.normalizar_email_factura("") == ("", None)
    assert A.normalizar_email_factura("facturacion@redchocolate")[1]

    def no_post(*a, **k):
        raise AssertionError("no debe llamar a Alegra con un correo inválido")

    monkeypatch.setattr(requests, "post", no_post)
    monkeypatch.setattr(A, "_alegra_headers", lambda: {})
    r = A.crear_factura_venta_alegra(nombre_cliente="X SAS", identificacion="900614242", direccion_envio="",
                                     productos=[{"codigo": "X", "nombre": "X", "cantidad": 1, "precio_unitario": 1000}],
                                     total=1000, email="ventas@@x")
    assert not r["ok"] and "correo" in r["error"]


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


def test_dos_telefonos_en_el_campo_usa_el_primero():
    """COT-20260928-001: «3173033440-3204642331» bloqueaba la factura por «Teléfono inválido»."""
    esperado = "573173033440@c.us"
    for tel in ("3173033440-3204642331", "3173033440 / 3204642331", "317 303 3440 y 320 464 2331",
                "3173033440, 3204642331", "300123-3173033440"):
        assert V._destino_whatsapp(tel, True) == (esperado, None), tel
    # Un solo número con separadores sigue siendo ese número, no un trozo.
    assert V._destino_whatsapp("317-303-3440", True) == (esperado, None)
    assert V._destino_whatsapp("318746 2545", True) == ("573187462545@c.us", None)
    # Ninguno válido: se sigue deteniendo.
    assert "Teléfono inválido" in V._destino_whatsapp("300123-45 / 3201", True)[1]


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


# ── Alta de cliente desde el paso «¿A quién le vendemos?» ──────────────────────

@pytest.fixture
def _libro(tmp_path, monkeypatch):
    import app.services.contabilidad_core as cc

    monkeypatch.setattr(cc, "_DB_PATH", str(tmp_path / "contabilidad.db"))
    monkeypatch.setattr(cc, "_initialized", False)
    cc.init_db()
    return cc


def _alegra_falso(llamadas, *, creado=True, error=""):
    def fake(**kw):
        llamadas.append(kw)
        if error:
            return None, error
        if kw.get("resultado") is not None:
            kw["resultado"]["creado"] = creado
        return "777", ""
    return fake


def test_crear_cliente_nace_en_alegra_y_en_el_libro(monkeypatch, _libro):
    from app.services import alegra as A

    llamadas: list = []
    monkeypatch.setattr(A, "_resolver_o_crear_contacto_alegra", _alegra_falso(llamadas))
    r = V.crear_cliente({"nombre": "EQUISURE S.A.S", "identificacion": "900409216-6",
                         "correo": "pagos@equisure.co", "telefono": "3001234567"}, usuario="jerry")
    assert r["ok"], r
    assert r["alegra_id"] == "777" and r["alegra_creado"] is True
    # Alegra recibe el tipo real y la base del NIT sin el dígito de verificación.
    assert llamadas[0]["tipo_documento"] == "NIT" and llamadas[0]["identificacion"] == "900409216"
    assert llamadas[0]["email"] == "pagos@equisure.co" and llamadas[0]["telefono"] == "3001234567"
    # Y el tercero del Libro Mayor queda listo para que la venta se cause con él.
    t = _libro.obtener_tercero(r["tercero_id"])
    assert t["tipo"] == "cliente" and t["tipo_persona"] == "juridica" and t["email"] == "pagos@equisure.co"
    assert _libro.mismo_documento(t["identificacion"], "900409216")


def test_crear_cliente_no_duplica_el_tercero_y_completa_datos(monkeypatch, _libro):
    from app.services import alegra as A

    monkeypatch.setattr(A, "_resolver_o_crear_contacto_alegra", _alegra_falso([], creado=False))
    previo = _libro.crear_tercero({"nombre": "Juan Pérez", "tipo": "cliente", "identificacion": "1013630698",
                                   "tipo_persona": "natural"})
    r = V.crear_cliente({"nombre": "Juan Pérez", "identificacion": "1013630698", "tipo_documento": "CC",
                         "correo": "juan@correo.co"})
    assert r["ok"] and r["alegra_creado"] is False
    assert r["tercero_id"] == previo["id"]
    assert len([t for t in _libro.listar_terceros(solo_activos=False) if t["tipo"] == "cliente"]) == 1
    assert _libro.obtener_tercero(previo["id"])["email"] == "juan@correo.co"


def test_crear_cliente_si_alegra_rechaza_no_toca_el_libro(monkeypatch, _libro):
    from app.services import alegra as A

    monkeypatch.setattr(A, "_resolver_o_crear_contacto_alegra", _alegra_falso([], error="HTTP 400 correo inválido"))
    r = V.crear_cliente({"nombre": "Prueba", "identificacion": "79000000"})
    assert not r["ok"] and "Alegra" in r["error"]
    assert not [t for t in _libro.listar_terceros(solo_activos=False) if t["tipo"] == "cliente"]


def test_crear_cliente_valida_el_nit():
    r = V.crear_cliente({"nombre": "EQUISURE S.A.S", "identificacion": "900409216-1"})
    assert not r["ok"] and "dígito de verificación" in r["error"]
    r = V.crear_cliente({"nombre": "Sin cédula"})
    assert not r["ok"]


def test_comision_whatsapp_por_mes_y_vendedor(monkeypatch):
    monkeypatch.setattr(V, "COMISION_PCT", 3.0)
    a = _venta()
    b = V.guardar({"cliente": {"nombre": "Otra"}, "telefono": "3000000000",
                   "lineas": [{"codigo": "EXENTO-1", "nombre": "Exento", "cantidad": 20, "precio_unitario": 5000}]},
                  usuario="stella")
    m = V.guardar({"origen": "meli", "origen_ref": "2000001", "cliente": {"nombre": "Empresa"},
                   "lineas": [{"codigo": "EXENTO-1", "nombre": "Exento", "cantidad": 10, "precio_unitario": 5000}]},
                  usuario="jerry")
    anulada = _venta()
    for v in (a, b, m):
        V._actualizar(v["id"], estado="facturada", facturado="2026-09-20T10:00:00", facturado_por="jerry")
    V._actualizar(anulada["id"], estado="anulada")

    r = V.comisiones_mes("2026-09")
    por = {x["vendedor"]: x for x in r["vendedores"]}
    assert set(por) == {"jerry", "stella"}  # la anulada y la de MeLi no cuentan
    assert por["jerry"]["ventas"] == 1 and por["jerry"]["total"] == round(a["total"])
    # base = productos sin IVA ni envío
    base_a = a["subtotal"] - a["envio"]
    assert por["jerry"]["base"] == round(base_a) and por["jerry"]["comision"] == round(base_a * 0.03)
    assert por["stella"]["base"] == 100000 and por["stella"]["comision"] == 3000
    assert r["excluidas_meli"] == {"ventas": 1, "total": 50000}
    # un vendedor solo se ve a sí mismo; otro mes no trae nada
    assert [x["vendedor"] for x in V.comisiones_mes("2026-09", vendedor="stella")["vendedores"]] == ["stella"]
    assert V.comisiones_mes("2026-08")["vendedores"] == []
    with pytest.raises(ValueError):
        V.comisiones_mes("sep-2026")


# ── Taller «Por facturar»: cobros que ya tienen factura, resolución y copia por WhatsApp ──


def _cobro(id_, fecha, monto):
    return {"linea": {"id": id_, "fecha": fecha, "monto": monto, "descripcion": "PAGO LLAVE X", "banco_nombre": "X"},
            "chats": [], "estado": "sin_rastro"}


def test_cobro_con_factura_existente_se_marca_y_no_se_refactura(monkeypatch):
    import app.services.wa_busqueda as wb

    monkeypatch.setattr(wb, "cobros_sin_factura", lambda d="", h="": {
        "desde": "2026-09-01", "hasta": "2026-09-26",
        "cobros": [_cobro(1, "2026-09-14", 60000), _cobro(2, "2026-09-14", 99999), _cobro(3, "2026-09-01", 50000)],
    })
    monkeypatch.setattr(V, "_facturas_del_libro", lambda d, h: [
        {"movimiento_id": "cc:10", "numero": "FE795", "fecha": "2026-09-25", "monto": 60000.0, "identificacion": "222222222",
         "cliente": "CF", "venta_id": None, "lineas": []},
        # mismo valor pero 40 días después del cobro: no es de esta venta
        {"movimiento_id": "cc:11", "numero": "FE900", "fecha": "2026-10-11", "monto": 50000.0, "identificacion": "",
         "cliente": "", "venta_id": None, "lineas": []},
    ])
    r = V.casos_por_facturar()
    por_id = {c["cobro"]["id"]: c for c in r["casos"]}
    assert por_id[1]["estado_factura"] == "con_factura"
    assert por_id[1]["facturas_candidatas"][0]["numero"] == "FE795"
    assert por_id[2]["estado_factura"] == "sin_factura"
    assert por_id[3]["estado_factura"] == "sin_factura"
    assert r["con_factura"] == 1


def test_resolver_cobro_lo_saca_de_la_cola_y_pide_nota(monkeypatch):
    import app.services.wa_busqueda as wb

    monkeypatch.setattr(wb, "cobros_sin_factura", lambda d="", h="": {"desde": "a", "hasta": "b", "cobros": [_cobro(7, "2026-09-02", 1000)]})
    monkeypatch.setattr(V, "_facturas_del_libro", lambda d, h: [])
    assert not V.resolver_cobro(7, "siigo", "")["ok"]
    assert not V.resolver_cobro(7, "otro", "algo largo")["ok"]
    assert V.resolver_cobro(7, "siigo", "FV-2-12345", usuario="jerry")["ok"]
    assert V.casos_por_facturar()["n"] == 0


def test_vincular_rechaza_movimiento_que_no_es_del_libro():
    assert not V.vincular_cobro_a_factura(1, "auto:abc")["ok"]


def test_whatsapp_archivo_manda_ruta_absoluta(monkeypatch):
    """El puente corre desde bot-mckenna/: una ruta relativa daba 400 y la factura no llegaba."""
    import os

    from app import utils

    vistos = {}

    class _R:
        status_code = 200
        text = ""

    monkeypatch.setattr(utils.requests, "post", lambda url, json=None, timeout=None: vistos.update(json) or _R())
    assert utils.enviar_whatsapp_archivo("facturas_descargadas/Factura_FE1.pdf", "x", numero_destino="573001234567@c.us")
    assert os.path.isabs(vistos["filePath"]) and vistos["filePath"].endswith("facturas_descargadas/Factura_FE1.pdf")


def test_soporte_despues_de_facturar_se_adjunta_una_vez(monkeypatch, tmp_path):
    """28-sep-2026: el soporte se puede pegar tras emitir la factura (llega al grupo),
    pero no se reemplaza ni se borra: es el rastro de la factura."""
    import app.services.alegra as A

    monkeypatch.setattr(V, "_SOPORTES_DIR", str(tmp_path / "soportes"))
    monkeypatch.setattr(A, "crear_factura_venta_alegra",
                        lambda **kw: {"ok": True, "invoice_id": 1, "number": "FE1", "cufe": "", "url": "", "pdf_path": None})
    monkeypatch.setattr("app.utils.enviar_whatsapp_reporte", lambda *a, **k: True)
    enviados = []
    monkeypatch.setattr("app.utils.enviar_whatsapp_archivo", lambda ruta, texto="", *a, **k: enviados.append(texto) or True)
    v = _venta()
    assert V.facturar(v["id"], medio_pago="CREDIT_TRANSFER", enviar_whatsapp=False)["ok"]

    r = V.guardar_soporte(v["id"], b"png", "pegado.png", "image/png")
    assert r["soporte_path"] and enviados == ["Soporte de pago del cliente — factura FE1"]
    with pytest.raises(ValueError):
        V.guardar_soporte(v["id"], b"otro", "otro.png", "image/png")
    assert not V.eliminar_soporte(v["id"])
    assert V.obtener(v["id"])["soporte_path"] == r["soporte_path"]
