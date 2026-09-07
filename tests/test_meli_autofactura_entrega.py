from __future__ import annotations

import json


def test_extraer_datos_comprador_desde_envio_completo():
    from app.tools import meli_autofactura_entrega as m

    shipment = {
        "status": "delivered",
        "receiver_address": {
            "receiver_name": "Juan Pérez",
            "receiver_phone": "3001234567",
            "address_line": "Calle 1 # 2-3",
            "city": {"name": "Bogotá"},
            "state": {"name": "Bogotá D.C."},
        },
    }
    datos = m._extraer_datos_comprador_desde_envio(shipment)

    assert datos["nombre_cliente"] == "Juan Pérez"
    assert datos["telefono"] == "3001234567"
    assert datos["direccion_envio"] == "Calle 1 # 2-3, Bogotá, Bogotá D.C."
    # Esto es solo el fallback (sin billing_info): consumidor final genérico.
    assert datos["identificacion"] == m.NIT_CONSUMIDOR_FINAL_MELI
    assert datos["email"] == ""


def test_extraer_datos_comprador_desde_envio_sin_receiver():
    from app.tools import meli_autofactura_entrega as m

    datos = m._extraer_datos_comprador_desde_envio({})

    assert datos["nombre_cliente"] == m.NOMBRE_CONSUMIDOR_FINAL_MELI
    assert datos["identificacion"] == m.NIT_CONSUMIDOR_FINAL_MELI
    assert datos["direccion_envio"] == ""


def test_parsear_billing_info_persona_natural():
    from app.tools import meli_autofactura_entrega as m

    billing_info = {
        "doc_number": "1006508537",
        "doc_type": "CC",
        "additional_info": [
            {"type": "FIRST_NAME", "value": "Yenfer Arledy"},
            {"type": "LAST_NAME", "value": "Ramirez Grisales"},
            {"type": "STREET_NAME", "value": "Calle 4"},
            {"type": "STREET_NUMBER", "value": "#9-55"},
            {"type": "NEIGHBORHOOD", "value": "La Esperanza"},
            {"type": "CITY_NAME", "value": "Neiva"},
            {"type": "STATE_NAME", "value": "Huila"},
        ],
    }

    datos = m._parsear_billing_info(billing_info)

    assert datos["nombre_cliente"] == "Yenfer Arledy Ramirez Grisales"
    assert datos["identificacion"] == "1006508537"
    assert datos["direccion_envio"] == "Calle 4 #9-55, La Esperanza, Neiva, Huila"


def test_parsear_billing_info_empresa():
    from app.tools import meli_autofactura_entrega as m

    billing_info = {
        "doc_number": "9014241759",
        "doc_type": "NIT",
        "additional_info": [{"type": "BUSINESS_NAME", "value": "IMPORDISCOL SAS"}],
    }

    datos = m._parsear_billing_info(billing_info)

    assert datos["nombre_cliente"] == "IMPORDISCOL SAS"
    assert datos["identificacion"] == "9014241759"


def test_parsear_billing_info_sin_doc_number():
    from app.tools import meli_autofactura_entrega as m

    assert m._parsear_billing_info({}) is None
    assert m._parsear_billing_info({"doc_number": "", "additional_info": []}) is None


def test_parsear_billing_info_sin_nombre():
    from app.tools import meli_autofactura_entrega as m

    # doc_number sin nombre asociado: no es suficiente para facturar a nombre real.
    assert m._parsear_billing_info({"doc_number": "12345", "additional_info": []}) is None


def test_extraer_datos_comprador_usa_billing_info_si_hay(monkeypatch):
    from app.tools import meli_autofactura_entrega as m

    monkeypatch.setattr(
        m,
        "consultar_billing_info_meli",
        lambda order_id: {
            "doc_number": "1006508537",
            "additional_info": [
                {"type": "FIRST_NAME", "value": "Yenfer"},
                {"type": "LAST_NAME", "value": "Ramirez"},
            ],
        },
    )
    shipment = {
        "receiver_address": {
            "receiver_phone": "3001234567",
            "address_line": "Calle 1",
            "city": {"name": "Bogotá"},
        }
    }

    datos = m._extraer_datos_comprador("2000017797611848", shipment)

    assert datos["nombre_cliente"] == "Yenfer Ramirez"
    assert datos["identificacion"] == "1006508537"
    assert datos["telefono"] == "3001234567"  # billing_info no trae teléfono


def test_extraer_datos_comprador_cae_a_consumidor_final_sin_billing_info(monkeypatch):
    from app.tools import meli_autofactura_entrega as m

    monkeypatch.setattr(m, "consultar_billing_info_meli", lambda order_id: None)
    shipment = {"receiver_address": {"receiver_name": "Juan Pérez", "receiver_phone": "3001234567"}}

    datos = m._extraer_datos_comprador("2000000000000000", shipment)

    assert datos["nombre_cliente"] == "Juan Pérez"
    assert datos["identificacion"] == m.NIT_CONSUMIDOR_FINAL_MELI


def test_construir_lineas_factura_ok(monkeypatch):
    from app.tools import meli_autofactura_entrega as m

    orden = {
        "order_items": [
            {
                "item": {"id": "MCO123", "title": "Ácido Hialurónico 50g"},
                "quantity": 2,
                "unit_price": 15000,
            }
        ]
    }

    monkeypatch.setattr(
        m, "consultar_item_meli_basico", lambda item_id: {"seller_custom_field": "AH-50", "title": "Ácido Hialurónico 50g"}
    )
    monkeypatch.setattr(m, "buscar_producto_alegra_por_referencia", lambda sku: {"id": "1", "name": sku, "price": 0})

    lines, error = m._construir_lineas_factura_desde_orden_meli(orden)

    assert error is None
    assert lines == [
        {"codigo": "AH-50", "nombre": "Ácido Hialurónico 50g", "cantidad": 2.0, "precio_unitario": 15000.0}
    ]


def test_construir_lineas_factura_sin_items():
    from app.tools import meli_autofactura_entrega as m

    lines, error = m._construir_lineas_factura_desde_orden_meli({"order_items": []})

    assert lines == []
    assert "no tiene ítems" in error


def test_construir_lineas_factura_sin_sku_en_siigo(monkeypatch):
    from app.tools import meli_autofactura_entrega as m

    orden = {
        "order_items": [
            {"item": {"id": "MCO999", "title": "Producto raro"}, "quantity": 1, "unit_price": 1000}
        ]
    }
    monkeypatch.setattr(m, "consultar_item_meli_basico", lambda item_id: {"seller_custom_field": "RARO-1"})
    monkeypatch.setattr(m, "buscar_producto_alegra_por_referencia", lambda sku: None)
    monkeypatch.setattr(m.time, "sleep", lambda _s: None)  # sin esperar los reintentos reales

    lines, error = m._construir_lineas_factura_desde_orden_meli(orden)

    assert lines == []
    assert "RARO-1" in error and "no existe en Alegra" in error


def test_construir_lineas_factura_reintenta_tras_fallo_transitorio_siigo(monkeypatch):
    """Un None puntual de Alegra (timeout/5xx) no debe marcarse como 'no existe' si reintentar funciona."""
    from app.tools import meli_autofactura_entrega as m

    orden = {
        "order_items": [
            {"item": {"id": "MCO1", "title": "Producto"}, "quantity": 1, "unit_price": 1000}
        ]
    }
    monkeypatch.setattr(m, "consultar_item_meli_basico", lambda item_id: {"seller_custom_field": "SKU-1"})
    monkeypatch.setattr(m.time, "sleep", lambda _s: None)

    llamadas = []

    def _fake_buscar(sku):
        llamadas.append(sku)
        return None if len(llamadas) < 2 else {"id": "1", "name": sku, "price": 0}

    monkeypatch.setattr(m, "buscar_producto_alegra_por_referencia", _fake_buscar)

    lines, error = m._construir_lineas_factura_desde_orden_meli(orden)

    assert error is None
    assert lines == [{"codigo": "SKU-1", "nombre": "Producto", "cantidad": 1.0, "precio_unitario": 1000.0}]
    assert len(llamadas) == 2  # falló una vez, el reintento lo resolvió


def test_construir_lineas_factura_sin_sku_en_meli(monkeypatch):
    from app.tools import meli_autofactura_entrega as m

    orden = {
        "order_items": [
            {"item": {"id": "MCO1", "title": "Sin sku"}, "quantity": 1, "unit_price": 1000}
        ]
    }
    monkeypatch.setattr(m, "consultar_item_meli_basico", lambda item_id: {"seller_custom_field": ""})
    monkeypatch.setattr(m, "buscar_producto_alegra_por_referencia", lambda sku: {"id": "1", "name": sku, "price": 0})

    lines, error = m._construir_lineas_factura_desde_orden_meli(orden)

    assert lines == []
    assert "sin SKU" in error


def test_procesar_entrega_modo_sombra_no_llama_siigo(monkeypatch, tmp_path):
    """MELI_AUTOFACTURA_ENTREGA_ACTIVO=0 (default): calcula y registra, pero no toca Alegra/DIAN."""
    from app.tools import meli_autofactura_entrega as m

    estado_path = tmp_path / "meli_facturas_entrega.json"
    monkeypatch.setattr(m, "ESTADO_PATH", str(estado_path))
    monkeypatch.delenv("MELI_AUTOFACTURA_ENTREGA_ACTIVO", raising=False)

    shipment = {
        "status": "delivered",
        "order_id": "ORD-1",
        "receiver_address": {"receiver_name": "Ana Gómez", "address_line": "Cra 9 # 10-11", "city": {"name": "Bogotá"}},
    }
    orden = {
        "status": "paid",
        "order_items": [
            {"item": {"id": "MCO1", "title": "Producto A"}, "quantity": 1, "unit_price": 20000}
        ],
    }

    monkeypatch.setattr(m, "consultar_envio_meli", lambda shipping_id: shipment)
    monkeypatch.setattr(m, "consultar_orden_meli_completa", lambda order_id: orden)
    monkeypatch.setattr(m, "consultar_item_meli_basico", lambda item_id: {"seller_custom_field": "PROD-A"})
    monkeypatch.setattr(m, "buscar_producto_alegra_por_referencia", lambda sku: {"id": "1", "name": sku, "price": 0})

    llamadas_alegra = []
    monkeypatch.setattr(m, "crear_factura_venta_alegra", lambda **kw: llamadas_alegra.append(kw) or {"ok": True})

    reportes = []
    monkeypatch.setattr(m, "enviar_whatsapp_reporte", lambda texto, numero_destino=None: reportes.append(texto))
    monkeypatch.setattr(m, "registrar_meli_webhook_incidente", lambda *a, **kw: None)

    m.procesar_entrega_meli_para_factura("SHIP-1")

    assert llamadas_alegra == []  # modo sombra: nunca se llega a tocar Alegra/DIAN
    assert reportes == []  # tampoco se manda reporte de éxito/error en modo sombra

    estado = json.loads(estado_path.read_text(encoding="utf-8"))
    entrada = estado["procesadas"]["ORD-1"]
    assert entrada["estado"] == "pendiente_activacion"
    assert entrada["preview"]["total"] == 20000.0


def test_procesar_entrega_activo_llama_siigo_y_reporta(monkeypatch, tmp_path):
    from app.tools import meli_autofactura_entrega as m

    estado_path = tmp_path / "meli_facturas_entrega.json"
    monkeypatch.setattr(m, "ESTADO_PATH", str(estado_path))
    monkeypatch.setenv("MELI_AUTOFACTURA_ENTREGA_ACTIVO", "1")

    shipment = {"status": "delivered", "order_id": "ORD-2", "receiver_address": {}}
    orden = {
        "status": "paid",
        "pack_id": "ORD-2",
        "order_items": [
            {"item": {"id": "MCO2", "title": "Producto B"}, "quantity": 1, "unit_price": 5000}
        ],
    }

    monkeypatch.setattr(m, "consultar_envio_meli", lambda shipping_id: shipment)
    monkeypatch.setattr(m, "consultar_orden_meli_completa", lambda order_id: orden)
    monkeypatch.setattr(m, "consultar_item_meli_basico", lambda item_id: {"seller_custom_field": "PROD-B"})
    monkeypatch.setattr(m, "buscar_producto_alegra_por_referencia", lambda sku: {"id": "1", "name": sku, "price": 0})
    monkeypatch.setattr(
        m,
        "crear_factura_venta_alegra",
        lambda **kw: {
            "ok": True, "invoice_id": "1", "number": "FE-1", "status": "Accepted", "cufe": "abc",
            "url": "https://app.alegra.com/invoice/view/id/1", "pdf_base64": None,
        },
    )
    monkeypatch.setattr(m, "meli_pack_tiene_documento_fiscal", lambda pack_id: False)
    monkeypatch.setattr(m, "subir_factura_meli", lambda *a, **kw: "✅")

    reportes = []
    monkeypatch.setattr(m, "enviar_whatsapp_reporte", lambda texto, numero_destino=None: reportes.append(texto))
    monkeypatch.setattr(m, "registrar_meli_webhook_incidente", lambda *a, **kw: None)

    m.procesar_entrega_meli_para_factura("SHIP-2")

    estado = json.loads(estado_path.read_text(encoding="utf-8"))
    entrada = estado["procesadas"]["ORD-2"]
    assert entrada["estado"] == "facturada"
    assert entrada["siigo_invoice_number"] == "FE-1"
    assert len(reportes) == 1
    assert "FE-1" in reportes[0]


def test_procesar_entrega_no_refactura_si_pack_ya_en_indice_legado(monkeypatch, tmp_path):
    """Pre-chequeo ANTES de llamar a Alegra: si el pack ya tiene factura en el
    índice legado (Siigo/astroselling), no se crea otra factura en Alegra —
    ni siquiera para luego descubrir el duplicado al subir el PDF a MeLi.
    Bug real confirmado en vivo 2026-09-03: sin este chequeo temprano, cada
    entrega nueva de un pack ya facturado por Astroselling generaba OTRA
    factura DIAN en Alegra (8 casos el mismo día, FE11-FE20)."""
    from app.tools import meli_autofactura_entrega as m

    estado_path = tmp_path / "meli_facturas_entrega.json"
    monkeypatch.setattr(m, "ESTADO_PATH", str(estado_path))
    monkeypatch.setenv("MELI_AUTOFACTURA_ENTREGA_ACTIVO", "1")

    shipment = {"status": "delivered", "order_id": "ORD-7", "receiver_address": {}}
    orden = {
        "status": "paid",
        "pack_id": "PACK-7",
        "order_items": [
            {"item": {"id": "MCO7", "title": "Producto E"}, "quantity": 1, "unit_price": 5000}
        ],
    }

    monkeypatch.setattr(m, "consultar_envio_meli", lambda shipping_id: shipment)
    monkeypatch.setattr(m, "consultar_orden_meli_completa", lambda order_id: orden)

    from app.services import conciliacion_meli as cm

    monkeypatch.setattr(
        cm, "leer_indice_facturacion_meli",
        lambda: {"indice": {"PACK-7": {"factura_numero": "FV-2-99999", "integracion": "astroselling"}}},
    )

    llamadas_alegra = []
    monkeypatch.setattr(m, "crear_factura_venta_alegra", lambda **kw: llamadas_alegra.append(kw) or {"ok": True})

    reportes = []
    monkeypatch.setattr(m, "enviar_whatsapp_reporte", lambda texto, numero_destino=None: reportes.append(texto))
    monkeypatch.setattr(m, "registrar_meli_webhook_incidente", lambda *a, **kw: None)

    m.procesar_entrega_meli_para_factura("SHIP-7")

    assert llamadas_alegra == []  # nunca se llega a llamar Alegra
    assert reportes == []  # tampoco genera ruido en WhatsApp — es el camino normal
    estado = json.loads(estado_path.read_text(encoding="utf-8"))
    entrada = estado["procesadas"]["ORD-7"]
    assert entrada["estado"] == "ya_facturada_legado"
    assert entrada["legado_factura_numero"] == "FV-2-99999"


def test_procesar_entrega_sube_pdf_a_meli(monkeypatch, tmp_path):
    """Con PDF disponible y el pack sin documento fiscal previo, se sube a MeLi."""
    from app.tools import meli_autofactura_entrega as m

    estado_path = tmp_path / "meli_facturas_entrega.json"
    monkeypatch.setattr(m, "ESTADO_PATH", str(estado_path))
    monkeypatch.setenv("MELI_AUTOFACTURA_ENTREGA_ACTIVO", "1")

    shipment = {"status": "delivered", "order_id": "ORD-5", "receiver_address": {}}
    orden = {
        "status": "paid",
        "pack_id": "PACK-5",
        "order_items": [
            {"item": {"id": "MCO5", "title": "Producto C"}, "quantity": 1, "unit_price": 5000}
        ],
    }

    monkeypatch.setattr(m, "consultar_envio_meli", lambda shipping_id: shipment)
    monkeypatch.setattr(m, "consultar_orden_meli_completa", lambda order_id: orden)
    monkeypatch.setattr(m, "consultar_item_meli_basico", lambda item_id: {"seller_custom_field": "PROD-C"})
    monkeypatch.setattr(m, "buscar_producto_alegra_por_referencia", lambda sku: {"id": "1", "name": sku, "price": 0})
    monkeypatch.setattr(
        m,
        "crear_factura_venta_alegra",
        lambda **kw: {
            "ok": True, "invoice_id": "1", "number": "FE-1", "status": "Accepted", "cufe": "abc",
            "url": "https://app.alegra.com/invoice/view/id/1", "pdf_base64": "QkFTRTY0",
        },
    )
    monkeypatch.setattr(m, "meli_pack_tiene_documento_fiscal", lambda pack_id: False)

    subidas = []
    monkeypatch.setattr(m, "subir_factura_meli", lambda pack_id, b64, **kw: subidas.append((pack_id, b64)) or "✅")

    reportes = []
    monkeypatch.setattr(m, "enviar_whatsapp_reporte", lambda texto, numero_destino=None: reportes.append(texto))
    monkeypatch.setattr(m, "registrar_meli_webhook_incidente", lambda *a, **kw: None)

    m.procesar_entrega_meli_para_factura("SHIP-5")

    assert subidas == [("PACK-5", "QkFTRTY0")]
    estado = json.loads(estado_path.read_text(encoding="utf-8"))
    assert estado["procesadas"]["ORD-5"]["pdf_subido_meli"] is True
    assert "⚠️" not in reportes[0]


def test_procesar_entrega_no_duplica_pdf_si_pack_ya_tiene_fiscal(monkeypatch, tmp_path):
    """Si el pack ya tiene documento fiscal (ej. Astroselling ya facturó), NO sube el de Alegra encima."""
    from app.tools import meli_autofactura_entrega as m

    estado_path = tmp_path / "meli_facturas_entrega.json"
    monkeypatch.setattr(m, "ESTADO_PATH", str(estado_path))
    monkeypatch.setenv("MELI_AUTOFACTURA_ENTREGA_ACTIVO", "1")

    shipment = {"status": "delivered", "order_id": "ORD-6", "receiver_address": {}}
    orden = {
        "status": "paid",
        "pack_id": "PACK-6",
        "order_items": [
            {"item": {"id": "MCO6", "title": "Producto D"}, "quantity": 1, "unit_price": 5000}
        ],
    }

    monkeypatch.setattr(m, "consultar_envio_meli", lambda shipping_id: shipment)
    monkeypatch.setattr(m, "consultar_orden_meli_completa", lambda order_id: orden)
    monkeypatch.setattr(m, "consultar_item_meli_basico", lambda item_id: {"seller_custom_field": "PROD-D"})
    monkeypatch.setattr(m, "buscar_producto_alegra_por_referencia", lambda sku: {"id": "1", "name": sku, "price": 0})
    monkeypatch.setattr(
        m,
        "crear_factura_venta_alegra",
        lambda **kw: {
            "ok": True, "invoice_id": "1", "number": "FE-1", "status": "Accepted", "cufe": "abc",
            "url": "https://app.alegra.com/invoice/view/id/1", "pdf_base64": "QkFTRTY0",
        },
    )
    monkeypatch.setattr(m, "meli_pack_tiene_documento_fiscal", lambda pack_id: True)

    subidas = []
    monkeypatch.setattr(m, "subir_factura_meli", lambda pack_id, b64, **kw: subidas.append((pack_id, b64)) or "✅")

    # OJO: sin este mock, un pack ya facturado (la rama "posible duplicado")
    # crea un ticket REAL en app/data/tickets.db — confirmado en vivo el
    # 2026-09-06: esta prueba dejó un ticket con datos ficticios (ORD-6/PACK-6)
    # en la base de producción, que hubo que borrar a mano.
    tickets_creados = []
    monkeypatch.setattr(
        m, "crear_o_actualizar_ticket_revision_facturacion",
        lambda casos: (tickets_creados.append(casos), (True, "🎫 Ticket #999 creado"))[1],
    )

    reportes = []
    monkeypatch.setattr(m, "enviar_whatsapp_reporte", lambda texto, numero_destino=None: reportes.append(texto))
    monkeypatch.setattr(m, "registrar_meli_webhook_incidente", lambda *a, **kw: None)

    m.procesar_entrega_meli_para_factura("SHIP-6")

    assert subidas == []  # no se sube el PDF de Alegra encima del que ya existe
    estado = json.loads(estado_path.read_text(encoding="utf-8"))
    assert estado["procesadas"]["ORD-6"]["pdf_subido_meli"] is False
    assert tickets_creados and tickets_creados[0][0]["order_id"] == "ORD-6"
    assert tickets_creados[0][0]["tipo"] == "posible_duplicado"
    assert "Ticket #999" in reportes[0]


def test_procesar_entrega_pack_multiorden_factura_todas_las_ordenes(monkeypatch, tmp_path):
    """Regresión del bug real (pack 2000014868087133, 2026-09-05): un carrito con
    varios productos genera varias órdenes que comparten un mismo shipment/pack.
    `shipments/{id}.order_id` solo trae UNA de ellas — deben facturarse TODAS."""
    from app.tools import meli_autofactura_entrega as m

    estado_path = tmp_path / "meli_facturas_entrega.json"
    monkeypatch.setattr(m, "ESTADO_PATH", str(estado_path))
    monkeypatch.setenv("MELI_AUTOFACTURA_ENTREGA_ACTIVO", "1")

    # El shipment solo reporta ORD-7A, pero el pack tiene dos órdenes hermanas.
    shipment = {"status": "delivered", "order_id": "ORD-7A", "receiver_address": {}}
    ordenes = {
        "ORD-7A": {
            "status": "paid",
            "pack_id": "PACK-7",
            "order_items": [
                {"item": {"id": "MCO7A", "title": "Producto E"}, "quantity": 1, "unit_price": 11500}
            ],
        },
        "ORD-7B": {
            "status": "paid",
            "pack_id": "PACK-7",
            "order_items": [
                {"item": {"id": "MCO7B", "title": "Producto F"}, "quantity": 1, "unit_price": 30999}
            ],
        },
    }

    monkeypatch.setattr(m, "consultar_envio_meli", lambda shipping_id: shipment)
    monkeypatch.setattr(m, "consultar_orden_meli_completa", lambda order_id: ordenes[order_id])
    monkeypatch.setattr(m, "consultar_pack_meli", lambda pack_id: {"orders": [{"id": "ORD-7A"}, {"id": "ORD-7B"}]})
    monkeypatch.setattr(
        m,
        "consultar_item_meli_basico",
        lambda item_id: {"seller_custom_field": "PROD-E" if item_id == "MCO7A" else "PROD-F"},
    )
    monkeypatch.setattr(m, "buscar_producto_alegra_por_referencia", lambda sku: {"id": "1", "name": sku, "price": 0})

    facturas_creadas = []

    def _fake_crear_factura(**kw):
        facturas_creadas.append(kw)
        numero = f"FE-{len(facturas_creadas)}"
        return {
            "ok": True, "invoice_id": numero, "number": numero, "status": "Accepted", "cufe": "abc",
            "url": f"https://app.alegra.com/invoice/view/id/{numero}", "pdf_base64": "QkFTRTY0",
        }

    monkeypatch.setattr(m, "crear_factura_venta_alegra", _fake_crear_factura)
    monkeypatch.setattr(m, "meli_pack_tiene_documento_fiscal", lambda pack_id: False)

    subidas = []
    monkeypatch.setattr(m, "subir_factura_meli", lambda pack_id, b64, **kw: subidas.append(pack_id) or "✅")

    tickets = []
    monkeypatch.setattr(m, "crear_o_actualizar_ticket_revision_facturacion", lambda casos: (tickets.append(casos), (True, ""))[1])

    reportes = []
    monkeypatch.setattr(m, "enviar_whatsapp_reporte", lambda texto, numero_destino=None: reportes.append(texto))
    monkeypatch.setattr(m, "registrar_meli_webhook_incidente", lambda *a, **kw: None)

    m.procesar_entrega_meli_para_factura("SHIP-7")

    # Las DOS órdenes del pack se facturaron por separado en Alegra (una por producto).
    assert len(facturas_creadas) == 2
    assert {kw["purchase_order"] for kw in facturas_creadas} == {"ORD-7A", "ORD-7B"}
    assert {kw["total"] for kw in facturas_creadas} == {11500.0, 30999.0}

    estado = json.loads(estado_path.read_text(encoding="utf-8"))
    assert estado["procesadas"]["ORD-7A"]["estado"] == "facturada"
    assert estado["procesadas"]["ORD-7B"]["estado"] == "facturada"

    # MeLi solo admite un documento fiscal por pack: se sube UNA sola vez, no dos,
    # y la segunda orden NO debe generar un ticket de "posible duplicado".
    assert subidas == ["PACK-7"]
    assert tickets == []
    assert estado["procesadas"]["ORD-7A"]["pdf_subido_meli"] is True
    assert estado["procesadas"]["ORD-7B"]["pdf_subido_meli"] is True
    assert len(reportes) == 2
    assert not any("posible duplicado" in r.lower() for r in reportes)


def test_procesar_entrega_dedup_orden_ya_facturada(monkeypatch, tmp_path):
    """No se vuelve a facturar una orden ya terminal, aun si hay que resolver el
    pack (single-order) para llegar a esa conclusión — ver
    test_procesar_entrega_pack_multiorden_dedup_parcial para el caso multi-orden,
    donde SÍ hace falta resolver el pack porque el shipment puede reportar
    precisamente la orden que ya estaba facturada."""
    from app.tools import meli_autofactura_entrega as m

    estado_path = tmp_path / "meli_facturas_entrega.json"
    estado_path.write_text(
        json.dumps({"procesadas": {"ORD-3": {"estado": "facturada"}}}), encoding="utf-8"
    )
    monkeypatch.setattr(m, "ESTADO_PATH", str(estado_path))

    shipment = {"status": "delivered", "order_id": "ORD-3"}
    monkeypatch.setattr(m, "consultar_envio_meli", lambda shipping_id: shipment)
    monkeypatch.setattr(m, "consultar_orden_meli_completa", lambda order_id: {"pack_id": "PACK-3"})
    monkeypatch.setattr(m, "consultar_pack_meli", lambda pack_id: {"orders": [{"id": "ORD-3"}]})

    llamado = []
    monkeypatch.setattr(m, "crear_factura_venta_alegra", lambda **kw: llamado.append(kw))

    m.procesar_entrega_meli_para_factura("SHIP-3")

    assert llamado == []  # no vuelve a facturar una orden ya facturada


def test_procesar_entrega_pack_multiorden_dedup_parcial(monkeypatch, tmp_path):
    """El shipment reporta justo la orden YA facturada del pack — el bug real
    (2026-09-06, pack 2000014868087133) era que esto hacía abortar todo el
    procesamiento antes de descubrir las hermanas pendientes. Debe facturar
    solo la hermana pendiente, sin re-facturar la que ya estaba lista."""
    from app.tools import meli_autofactura_entrega as m

    estado_path = tmp_path / "meli_facturas_entrega.json"
    estado_path.write_text(
        json.dumps({"procesadas": {"ORD-8A": {
            "estado": "facturada", "pdf_subido_meli": True, "pack_id": "PACK-8",
        }}}),
        encoding="utf-8",
    )
    monkeypatch.setattr(m, "ESTADO_PATH", str(estado_path))
    monkeypatch.setenv("MELI_AUTOFACTURA_ENTREGA_ACTIVO", "1")

    # El shipment reporta ORD-8A (ya facturada); ORD-8B es la hermana pendiente.
    shipment = {"status": "delivered", "order_id": "ORD-8A", "receiver_address": {}}
    ordenes = {
        "ORD-8A": {"status": "paid", "pack_id": "PACK-8", "order_items": []},
        "ORD-8B": {
            "status": "paid",
            "pack_id": "PACK-8",
            "order_items": [
                {"item": {"id": "MCO8B", "title": "Producto G"}, "quantity": 1, "unit_price": 17425}
            ],
        },
    }

    monkeypatch.setattr(m, "consultar_envio_meli", lambda shipping_id: shipment)
    monkeypatch.setattr(m, "consultar_orden_meli_completa", lambda order_id: ordenes[order_id])
    monkeypatch.setattr(m, "consultar_pack_meli", lambda pack_id: {"orders": [{"id": "ORD-8A"}, {"id": "ORD-8B"}]})
    monkeypatch.setattr(m, "consultar_item_meli_basico", lambda item_id: {"seller_custom_field": "PROD-G"})
    monkeypatch.setattr(m, "buscar_producto_alegra_por_referencia", lambda sku: {"id": "1", "name": sku, "price": 0})

    facturas_creadas = []
    monkeypatch.setattr(
        m,
        "crear_factura_venta_alegra",
        lambda **kw: (facturas_creadas.append(kw), {
            "ok": True, "invoice_id": "9", "number": "FE-9", "status": "Accepted", "cufe": "abc",
            "url": "https://app.alegra.com/invoice/view/id/9", "pdf_base64": "QkFTRTY0",
        })[1],
    )
    monkeypatch.setattr(m, "subir_factura_meli", lambda pack_id, b64, **kw: "✅")
    monkeypatch.setattr(m, "meli_pack_tiene_documento_fiscal", lambda pack_id: True)  # ya lo subió ORD-8A antes
    monkeypatch.setattr(m, "crear_o_actualizar_ticket_revision_facturacion", lambda casos: (True, ""))
    monkeypatch.setattr(m, "enviar_whatsapp_reporte", lambda texto, numero_destino=None: None)
    monkeypatch.setattr(m, "registrar_meli_webhook_incidente", lambda *a, **kw: None)

    m.procesar_entrega_meli_para_factura("SHIP-8")

    # Solo se facturó la hermana pendiente (ORD-8B), nunca ORD-8A de nuevo.
    assert len(facturas_creadas) == 1
    assert facturas_creadas[0]["purchase_order"] == "ORD-8B"

    estado = json.loads(estado_path.read_text(encoding="utf-8"))
    assert estado["procesadas"]["ORD-8B"]["estado"] == "facturada"
    assert estado["procesadas"]["ORD-8A"]["estado"] == "facturada"  # sin cambios


def test_procesar_entrega_ignora_estados_no_delivered(monkeypatch, tmp_path):
    from app.tools import meli_autofactura_entrega as m

    estado_path = tmp_path / "meli_facturas_entrega.json"
    monkeypatch.setattr(m, "ESTADO_PATH", str(estado_path))
    monkeypatch.setattr(m, "consultar_envio_meli", lambda shipping_id: {"status": "shipped", "order_id": "ORD-4"})

    llamado = []
    monkeypatch.setattr(m, "consultar_orden_meli_completa", lambda order_id: llamado.append(order_id))

    m.procesar_entrega_meli_para_factura("SHIP-4")

    assert llamado == []
