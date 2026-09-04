"""
Autofactura MeLi al entregarse el pedido.

Disparado desde el tópico webhook 'shipments' (ver app/meli_webhook_topics.py):
cuando un envío queda en estado 'delivered', crea la factura de venta en Alegra
(migrado desde Siigo el 2026-09-03 — ver app/services/alegra.py) para esa
orden, igual que ya hace app/tools/web_pedidos.py para pedidos web.

Diferencia clave con web: MeLi no expone la cédula/NIT real del comprador (ni
en `orders/{id}.buyer` ni en `shipments/{id}.receiver_address`), así que estas
facturas siempre usan "consumidor final" con identificación genérica
(SIIGO_MELI_NIT_CONSUMIDOR_FINAL, default 222222222222) — decisión explícita
del negocio, no un dato que falte por descuido.

Gateado por MELI_AUTOFACTURA_ENTREGA_ACTIVO=1 (default 0 = modo sombra): hasta
que se confirme con tráfico real que el tópico 'shipments' efectivamente llega
al webhook, no se debe tocar Alegra/DIAN en automático. En modo sombra se
calcula todo (líneas, comprador, total) y se registra en el store local y en
el log de incidentes, sin llamar a crear_factura_venta_alegra.
"""

from __future__ import annotations

import json
import os
import threading
import time
from datetime import datetime

from app.meli_webhook_incidents import registrar_meli_webhook_incidente
from app.services.meli import (
    consultar_envio_meli,
    consultar_item_meli_basico,
    consultar_orden_meli_completa,
    meli_pack_tiene_documento_fiscal,
    subir_factura_meli,
)
from app.services.alegra import (
    buscar_producto_alegra_por_referencia,
    crear_factura_venta_alegra,
)
from app.utils import enviar_whatsapp_reporte, jid_grupo_facturacion_ventas_wa

ESTADO_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "meli_facturas_entrega.json")
_ESTADO_LOCK = threading.Lock()

NIT_CONSUMIDOR_FINAL_MELI = (os.getenv("SIIGO_MELI_NIT_CONSUMIDOR_FINAL", "222222222222") or "222222222222").strip()
NOMBRE_CONSUMIDOR_FINAL_MELI = "Consumidor Final"

_ESTADOS_TERMINALES = ("facturada", "en_proceso", "anulada", "ya_facturada_legado")


def _autofactura_activa() -> bool:
    return (os.getenv("MELI_AUTOFACTURA_ENTREGA_ACTIVO", "0") or "0").strip() == "1"


def _leer_estado_entregas() -> dict:
    try:
        with open(ESTADO_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, dict) and isinstance(data.get("procesadas"), dict):
                return data
    except Exception:
        pass
    return {"procesadas": {}}


def _guardar_estado_entregas(data: dict) -> None:
    try:
        with open(ESTADO_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"⚠️ [MELI-AUTOFACTURA] No se pudo guardar estado: {e}")


def _estado_existente_orden(order_id: str) -> dict | None:
    with _ESTADO_LOCK:
        return _leer_estado_entregas().get("procesadas", {}).get(str(order_id))


def _registrar_estado_orden(order_id: str, **campos) -> None:
    with _ESTADO_LOCK:
        data = _leer_estado_entregas()
        entrada = data["procesadas"].setdefault(str(order_id), {})
        entrada.update(campos)
        entrada["actualizado_en"] = datetime.now().isoformat(timespec="seconds")
        _guardar_estado_entregas(data)


def _extraer_datos_comprador_desde_envio(shipment: dict) -> dict:
    """
    MeLi no expone cédula/NIT del comprador en shipments/orders: se factura
    siempre a consumidor final (decisión de negocio, ver docstring del módulo).
    """
    receiver = (shipment or {}).get("receiver_address") or {}
    nombre = (receiver.get("receiver_name") or "").strip()
    telefono = (receiver.get("receiver_phone") or "").strip()
    calle = (receiver.get("address_line") or "").strip()
    ciudad = ((receiver.get("city") or {}).get("name") or "").strip()
    depto = ((receiver.get("state") or {}).get("name") or "").strip()
    direccion = ", ".join(x for x in (calle, ciudad, depto) if x)
    return {
        "nombre_cliente": nombre or NOMBRE_CONSUMIDOR_FINAL_MELI,
        "identificacion": NIT_CONSUMIDOR_FINAL_MELI,
        "direccion_envio": direccion,
        "telefono": telefono,
        "email": "",
    }


def _buscar_producto_alegra_con_reintentos(sku: str, intentos: int = 3) -> dict | None:
    """
    buscar_producto_alegra_por_referencia() devuelve None tanto si el SKU no existe en
    Alegra como si la consulta falló transitoriamente (timeout, 5xx) — no
    distingue los dos casos. Reintentar aquí evita marcar como "no existe en
    Alegra" (y disparar ticket de creación de producto) algo que en realidad
    fue un hipo momentáneo de la API.
    """
    for intento in range(intentos):
        producto = buscar_producto_alegra_por_referencia(sku)
        if producto:
            return producto
        if intento < intentos - 1:
            time.sleep(1.5 * (intento + 1))
    return None


def _construir_lineas_factura_desde_orden_meli(orden: dict) -> tuple[list[dict], str | None]:
    items = orden.get("order_items") or []
    if not items:
        return [], "La orden no tiene ítems."

    lines: list[dict] = []
    missing: list[str] = []
    for it in items:
        item_info = it.get("item") or {}
        item_id = item_info.get("id", "")
        qty = it.get("quantity") or 1
        precio = it.get("unit_price")
        if precio is None:
            precio = item_info.get("unit_price")

        # OJO: usar SIEMPRE el seller_custom_field que YA viene en la línea de la
        # orden (item_info) — es el de la VARIACIÓN específica comprada (color,
        # tamaño, etc.). consultar_item_meli_basico(item_id) reconsulta por el
        # item_id "padre" y puede devolver el SKU de otra variación del mismo
        # producto — bug confirmado en vivo el 2026-09-03 con un item con
        # variantes de color (order trajo AS-19, la reconsulta trajo GOTVID50mL).
        # Solo se recurre a la reconsulta si la orden no trajera el dato.
        sku = (item_info.get("seller_custom_field") or "").strip()
        if not sku:
            for attr in item_info.get("attributes") or []:
                if attr.get("id") == "SELLER_SKU":
                    sku = (attr.get("value_name") or "").strip()
                    break

        detalle = None
        if not sku and item_id:
            detalle = consultar_item_meli_basico(item_id)
            sku = (detalle or {}).get("seller_custom_field") or ""
            if not sku:
                for attr in (detalle or {}).get("attributes") or []:
                    if attr.get("id") == "SELLER_SKU":
                        sku = (attr.get("value_name") or "").strip()
                        break

        nombre = item_info.get("title") or (detalle or {}).get("title") or "Producto"

        if not sku:
            missing.append(f"{nombre} ({item_id}): sin SKU (seller_custom_field) en MeLi")
            continue
        if precio is None:
            missing.append(f"{sku}: sin precio unitario en la orden")
            continue
        alegra_prod = _buscar_producto_alegra_con_reintentos(sku)
        if not alegra_prod:
            missing.append(f"{sku}: no existe en Alegra")
            continue

        # OJO: el precio que va aquí es el FINAL (lo que pagó el comprador en MeLi,
        # con IVA incluido) tal cual — crear_factura_venta_alegra() ya descuenta el
        # IVA internamente usando el impuesto real configurado en la ficha del
        # producto en Alegra. NO restar el IVA en este punto (bug confirmado en vivo
        # el 2026-09-02: hacerlo dos veces, aquí y adentro, sub-factura la venta).
        line = {
            "codigo": sku,
            "nombre": nombre,
            "cantidad": float(qty),
            "precio_unitario": float(precio),
        }
        lines.append(line)

    if missing:
        return [], "No puedo emitir factura automática: " + "; ".join(missing)
    return lines, None


def procesar_entrega_meli_para_factura(shipping_id: str) -> None:
    """Punto de entrada desde el webhook (spawn_thread) para el tópico 'shipments'."""
    print(f"📦🚚 [MELI-AUTOFACTURA] Procesando envío {shipping_id}...")
    try:
        shipment = consultar_envio_meli(shipping_id)
        if not shipment:
            print(f"⚠️ [MELI-AUTOFACTURA] No se pudo consultar envío {shipping_id}.")
            return

        estado_envio = shipment.get("status")
        if estado_envio != "delivered":
            print(
                f"⏭️ [MELI-AUTOFACTURA] Envío {shipping_id} en estado {estado_envio!r} "
                "— se espera 'delivered'."
            )
            return

        order_id = shipment.get("order_id")
        if not order_id:
            print(f"⚠️ [MELI-AUTOFACTURA] Envío {shipping_id} entregado pero sin order_id — reviso manual.")
            registrar_meli_webhook_incidente(
                "autofactura_entrega_sin_order_id",
                shipping_id=str(shipping_id),
                source="meli_autofactura_entrega",
            )
            return
        order_id = str(order_id)

        previo = _estado_existente_orden(order_id)
        if previo and previo.get("estado") in _ESTADOS_TERMINALES:
            print(f"⏭️ [MELI-AUTOFACTURA] Orden {order_id} ya en estado {previo.get('estado')!r} — dedup.")
            return

        _registrar_estado_orden(order_id, shipping_id=str(shipping_id), estado="en_proceso")

        orden = consultar_orden_meli_completa(order_id)
        if not orden:
            _registrar_estado_orden(order_id, estado="error", error="No se pudo obtener la orden de MeLi.")
            return

        if orden.get("status") not in ("paid", "partially_paid"):
            _registrar_estado_orden(
                order_id,
                estado="omitida",
                error=f"Orden en estado {orden.get('status')!r}, no pagada.",
            )
            return

        # Pre-chequeo contra el índice legado (Siigo / astroselling.com) ANTES de
        # llamar a Alegra — no solo antes de subir el PDF a MeLi. Sin esto, cada
        # entrega nueva de una orden que Astroselling ya facturó ayer (backlog,
        # no facturación concurrente) genera OTRA factura DIAN duplicada en
        # Alegra igual, aunque después no se suba a MeLi. Confirmado en vivo
        # 2026-09-03: 8 duplicados nuevos (FE11-FE20) se crearon esta tarde por
        # tener el chequeo solo en el paso de subida, no acá.
        pack_id = str(orden.get("pack_id") or order_id).strip()
        try:
            from app.services.conciliacion_meli import leer_indice_facturacion_meli

            legado = leer_indice_facturacion_meli().get("indice", {}).get(pack_id)
        except Exception:
            legado = None
        if legado:
            _registrar_estado_orden(
                order_id,
                estado="ya_facturada_legado",
                pack_id=pack_id,
                legado_factura_numero=legado.get("factura_numero"),
                legado_integracion=legado.get("integracion"),
            )
            print(
                f"⏭️ [MELI-AUTOFACTURA] Orden {order_id} (pack {pack_id}) ya tiene factura "
                f"{legado.get('integracion')} {legado.get('factura_numero')} — no se factura de nuevo en Alegra."
            )
            return

        lines, line_error = _construir_lineas_factura_desde_orden_meli(orden)
        if line_error:
            _registrar_estado_orden(order_id, estado="error", error=line_error)
            if _autofactura_activa():
                enviar_whatsapp_reporte(
                    f"⚠️ *Autofactura MeLi*: orden {order_id} entregada pero no se pudo facturar:\n{line_error}",
                    numero_destino=jid_grupo_facturacion_ventas_wa(),
                )
            else:
                # Modo sombra: cero efectos externos, ni siquiera para reportar errores.
                print(
                    f"🧪 [MELI-AUTOFACTURA] MODO SOMBRA: orden {order_id} tendría error al facturar: {line_error}"
                )
                registrar_meli_webhook_incidente(
                    "autofactura_entrega_modo_sombra_error",
                    order_id=order_id,
                    shipping_id=str(shipping_id),
                    error=line_error,
                    source="meli_autofactura_entrega",
                )
            return

        datos_comprador = _extraer_datos_comprador_desde_envio(shipment)
        total = sum(l["cantidad"] * l["precio_unitario"] for l in lines)

        if not _autofactura_activa():
            _registrar_estado_orden(
                order_id,
                estado="pendiente_activacion",
                preview={"lineas": lines, "total": total, **datos_comprador},
            )
            print(
                "🧪 [MELI-AUTOFACTURA] MODO SOMBRA (MELI_AUTOFACTURA_ENTREGA_ACTIVO=0): "
                f"orden {order_id} SE HABRÍA facturado por ${total:,.0f} — no se llamó a Alegra."
            )
            registrar_meli_webhook_incidente(
                "autofactura_entrega_modo_sombra",
                order_id=order_id,
                shipping_id=str(shipping_id),
                total=total,
                source="meli_autofactura_entrega",
            )
            return

        result = crear_factura_venta_alegra(
            nombre_cliente=datos_comprador["nombre_cliente"],
            identificacion=datos_comprador["identificacion"],
            direccion_envio=datos_comprador["direccion_envio"],
            productos=lines,
            total=total,
            telefono=datos_comprador["telefono"],
            email=datos_comprador["email"],
            observaciones=f"Venta MercadoLibre — Orden {order_id} — Envío {shipping_id} (entregado).",
            purchase_order=order_id,
            descargar_pdf=True,
            enviar_dian=True,
            enviar_correo=False,
        )

        if result.get("ok"):
            numero = result.get("number") or result.get("invoice_id")

            # Sube el PDF a MeLi (fiscal_documents del pack) para que el comprador la vea
            # ahí — hasta ahora esto solo lo hacía Astroselling (externo) o el sync de
            # facturas de compra Siigo (Flujo F), nunca este flujo. Si el pack YA tiene un
            # documento fiscal (ej. Astroselling ya facturó esta misma venta, ver caso
            # FE2/FE3 duplicando FV-2-70961/FV-2-71112 el 2026-09-03), NO se sube el de
            # Alegra encima — MeLi solo admite un documento fiscal por pack y tipo, y
            # subir uno nuevo ahí sin resolver primero cuál es el válido perpetuaría la
            # doble factura en vez de solo evidenciarla (para eso ya está el aviso ⚠️ en
            # el panel Astro Killer).
            pack_id = str(orden.get("pack_id") or order_id).strip()
            pdf_subido = False
            aviso_pdf = ""
            if not result.get("pdf_base64"):
                aviso_pdf = "\n⚠️ No se pudo descargar el PDF de Alegra — súbelo a MeLi manualmente."
            elif meli_pack_tiene_documento_fiscal(pack_id):
                aviso_pdf = "\n⚠️ El pack ya tenía un documento fiscal en MeLi (revisar Astro Killer: posible doble) — no se subió el de Alegra."
            else:
                subida = subir_factura_meli(pack_id, result["pdf_base64"], formato="pdf", prefijo_archivo="Fac")
                pdf_subido = subida == "✅"
                if not pdf_subido:
                    aviso_pdf = f"\n⚠️ La factura se creó en Alegra pero no se pudo subir el PDF a MeLi: {subida}"

            _registrar_estado_orden(
                order_id,
                estado="facturada",
                proveedor="alegra",
                siigo_invoice_id=result.get("invoice_id"),
                siigo_invoice_number=result.get("number"),
                siigo_invoice_status=result.get("status"),
                siigo_invoice_cufe=result.get("cufe") or None,
                pdf_subido_meli=pdf_subido,
            )
            enviar_whatsapp_reporte(
                f"✅ *Autofactura MeLi*: orden {order_id} (envío {shipping_id}) entregada y facturada en Alegra.\n"
                f"Factura: {numero}\n"
                f"{result.get('url') or ''}"
                f"{aviso_pdf}",
                numero_destino=jid_grupo_facturacion_ventas_wa(),
            )
        else:
            _registrar_estado_orden(order_id, estado="error", error=result.get("error"))
            enviar_whatsapp_reporte(
                f"❌ *Autofactura MeLi*: orden {order_id} (envío {shipping_id}) entregada "
                f"pero falló la factura en Alegra:\n{result.get('error')}",
                numero_destino=jid_grupo_facturacion_ventas_wa(),
            )
    except Exception as e:
        print(f"❌ [MELI-AUTOFACTURA] Error procesando envío {shipping_id}: {e}")
        try:
            registrar_meli_webhook_incidente(
                "autofactura_entrega_excepcion",
                shipping_id=str(shipping_id),
                error=str(e)[:300],
                source="meli_autofactura_entrega",
            )
        except Exception:
            pass
