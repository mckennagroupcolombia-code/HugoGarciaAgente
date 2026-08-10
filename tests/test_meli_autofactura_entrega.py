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
    # MeLi nunca expone cédula/NIT real: siempre consumidor final genérico.
    assert datos["identificacion"] == m.NIT_CONSUMIDOR_FINAL_MELI
    assert datos["email"] == ""


def test_extraer_datos_comprador_desde_envio_sin_receiver():
    from app.tools import meli_autofactura_entrega as m

    datos = m._extraer_datos_comprador_desde_envio({})

    assert datos["nombre_cliente"] == m.NOMBRE_CONSUMIDOR_FINAL_MELI
    assert datos["identificacion"] == m.NIT_CONSUMIDOR_FINAL_MELI
    assert datos["direccion_envio"] == ""


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
    monkeypatch.setattr(m, "buscar_producto_siigo_por_sku", lambda sku: {"code": sku})

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
    monkeypatch.setattr(m, "buscar_producto_siigo_por_sku", lambda sku: None)

    lines, error = m._construir_lineas_factura_desde_orden_meli(orden)

    assert lines == []
    assert "RARO-1" in error and "no existe en Siigo" in error


def test_construir_lineas_factura_sin_sku_en_meli(monkeypatch):
    from app.tools import meli_autofactura_entrega as m

    orden = {
        "order_items": [
            {"item": {"id": "MCO1", "title": "Sin sku"}, "quantity": 1, "unit_price": 1000}
        ]
    }
    monkeypatch.setattr(m, "consultar_item_meli_basico", lambda item_id: {"seller_custom_field": ""})
    monkeypatch.setattr(m, "buscar_producto_siigo_por_sku", lambda sku: {"code": sku})

    lines, error = m._construir_lineas_factura_desde_orden_meli(orden)

    assert lines == []
    assert "sin SKU" in error


def test_procesar_entrega_modo_sombra_no_llama_siigo(monkeypatch, tmp_path):
    """MELI_AUTOFACTURA_ENTREGA_ACTIVO=0 (default): calcula y registra, pero no toca Siigo/DIAN."""
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
    monkeypatch.setattr(m, "buscar_producto_siigo_por_sku", lambda sku: {"code": sku})

    llamadas_siigo = []
    monkeypatch.setattr(m, "crear_factura_venta_siigo", lambda **kw: llamadas_siigo.append(kw) or {"ok": True})

    reportes = []
    monkeypatch.setattr(m, "enviar_whatsapp_reporte", lambda texto, numero_destino=None: reportes.append(texto))
    monkeypatch.setattr(m, "registrar_meli_webhook_incidente", lambda *a, **kw: None)

    m.procesar_entrega_meli_para_factura("SHIP-1")

    assert llamadas_siigo == []  # modo sombra: nunca se llega a tocar Siigo/DIAN
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
        "order_items": [
            {"item": {"id": "MCO2", "title": "Producto B"}, "quantity": 1, "unit_price": 5000}
        ],
    }

    monkeypatch.setattr(m, "consultar_envio_meli", lambda shipping_id: shipment)
    monkeypatch.setattr(m, "consultar_orden_meli_completa", lambda order_id: orden)
    monkeypatch.setattr(m, "consultar_item_meli_basico", lambda item_id: {"seller_custom_field": "PROD-B"})
    monkeypatch.setattr(m, "buscar_producto_siigo_por_sku", lambda sku: {"code": sku})
    monkeypatch.setattr(
        m,
        "crear_factura_venta_siigo",
        lambda **kw: {"ok": True, "invoice_id": "inv1", "number": "FE-1", "status": "Accepted", "cufe": "abc", "url": "https://x"},
    )

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


def test_procesar_entrega_dedup_orden_ya_facturada(monkeypatch, tmp_path):
    from app.tools import meli_autofactura_entrega as m

    estado_path = tmp_path / "meli_facturas_entrega.json"
    estado_path.write_text(
        json.dumps({"procesadas": {"ORD-3": {"estado": "facturada"}}}), encoding="utf-8"
    )
    monkeypatch.setattr(m, "ESTADO_PATH", str(estado_path))

    shipment = {"status": "delivered", "order_id": "ORD-3"}
    monkeypatch.setattr(m, "consultar_envio_meli", lambda shipping_id: shipment)

    llamado = []
    monkeypatch.setattr(m, "consultar_orden_meli_completa", lambda order_id: llamado.append(order_id))

    m.procesar_entrega_meli_para_factura("SHIP-3")

    assert llamado == []  # no vuelve a consultar/facturar una orden ya facturada


def test_procesar_entrega_ignora_estados_no_delivered(monkeypatch, tmp_path):
    from app.tools import meli_autofactura_entrega as m

    estado_path = tmp_path / "meli_facturas_entrega.json"
    monkeypatch.setattr(m, "ESTADO_PATH", str(estado_path))
    monkeypatch.setattr(m, "consultar_envio_meli", lambda shipping_id: {"status": "shipped", "order_id": "ORD-4"})

    llamado = []
    monkeypatch.setattr(m, "consultar_orden_meli_completa", lambda order_id: llamado.append(order_id))

    m.procesar_entrega_meli_para_factura("SHIP-4")

    assert llamado == []
