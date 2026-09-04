"""
Cotización y facturación directa — venta ad-hoc (no ligada a una orden de
MeLi/pedidos web, ej. cliente mayorista que negocia por WhatsApp) desde el
panel Facturación → Cotizar/Facturar.

Decisión de diseño (2026-09-03): esto vive como panel operado por un humano,
NO como capacidad autónoma de Hugo en el chat del cliente. Tocar el loop de
tool-use del WhatsApp de cliente para que el propio LLM arme facturas DIAN
reales desde texto libre es un cambio de arquitectura de mayor riesgo — ver
CLAUDE.md, sección "Pendiente" de IA Principal. El cliente sigue recibiendo
todo por WhatsApp (cotización y factura se envían ahí); solo la creación
queda en una UI determinística con producto/cliente verificados antes de
enviar, en vez de que el LLM los infiera del texto de la conversación.

Reutiliza:
- Cotización: app/tools/cotizacion_pdf.py (PDF con membrete, SIN implicación
  DIAN — es solo informativo, no se timbra ante la DIAN).
- Factura: app/services/alegra.py::crear_factura_venta_alegra (factura
  electrónica real, timbrada).
- Envío: app/utils.py::enviar_whatsapp_archivo / enviar_whatsapp_reporte.
"""

from __future__ import annotations

import base64
import os
import re
import tempfile
from datetime import datetime


def _telefono_a_jid(numero: str) -> str | None:
    """Espejo de app.routes._normalizar_numero_wa — evita import circular con
    routes.py (que importa medio proyecto)."""
    numero = (numero or "").strip()
    if not numero:
        return None
    if numero.endswith("@lid") or numero.endswith("@c.us") or numero.endswith("@g.us"):
        return numero
    digits = re.sub(r"\D", "", numero)
    if len(digits) == 10 and digits.startswith("3"):
        return f"57{digits}@c.us"
    if len(digits) == 12 and digits.startswith("57") and digits[2] == "3":
        return f"{digits}@c.us"
    return None


def _numero_cotizacion() -> str:
    return f"COT-{datetime.now().strftime('%Y%m%d%H%M%S')}"


def generar_y_enviar_cotizacion(
    *,
    cliente: dict,
    productos: list[dict],
    telefono: str,
    notas: str = "",
) -> dict:
    """
    `cliente`: {"nombre", "identificacion"/"nit" (opcional), "correo"
      (opcional), "direccion" (opcional)}.
    `productos`: [{"codigo", "nombre", "cantidad", "precio_unitario"}] —
      `precio_unitario` YA incluye IVA (lo que pagaría el cliente), igual
      convención que el resto del sistema (MeLi/web).

    Sin implicación DIAN — un PDF informativo válido por 15 días (ver
    cotizacion_pdf.py). No exige que `codigo` sea un SKU real de Alegra; si
    lo es, se usa para traer el IVA real del producto en vez de asumir 19%.
    """
    from app.services.alegra import buscar_producto_alegra_por_referencia
    from app.tools.cotizacion_pdf import enviar_cotizacion

    jid = _telefono_a_jid(telefono)
    if not jid:
        return {"ok": False, "error": f"Teléfono inválido: {telefono!r} (10 dígitos empezando en 3, o con 57 adelante)."}
    if not productos:
        return {"ok": False, "error": "La cotización no tiene productos."}

    lineas = []
    total = 0.0
    for p in productos:
        codigo = str(p.get("codigo") or "").strip()
        nombre = str(p.get("nombre") or codigo or "Producto").strip()
        cantidad = float(p.get("cantidad") or 1)
        precio_unit = float(p.get("precio_unitario") or 0)
        subtotal = round(cantidad * precio_unit, 2)
        total += subtotal
        lineas.append({
            "nombre": nombre, "sku": codigo, "cantidad": cantidad,
            "precio_unit": precio_unit, "subtotal": subtotal,
        })

    # IVA informativo: si algún producto es un SKU real de Alegra, usa su tasa
    # real; si no, 19% general — la cotización no se timbra ante la DIAN, este
    # cálculo es solo para que el total mostrado sea realista.
    tasa_iva = 0.19
    for p in productos:
        codigo = str(p.get("codigo") or "").strip()
        if not codigo:
            continue
        prod = buscar_producto_alegra_por_referencia(codigo)
        if prod and prod.get("tax_rate_total"):
            tasa_iva = float(prod["tax_rate_total"]) / 100
            break

    iva = round(total - (total / (1 + tasa_iva)), 2) if total else 0.0
    subtotal_sin_iva = round(total - iva, 2)

    cotizacion = {
        "numero": _numero_cotizacion(),
        "fecha": datetime.now().strftime("%d/%m/%Y"),
        "cliente": {
            "nombre": cliente.get("nombre") or "Cliente",
            "nit": cliente.get("identificacion") or cliente.get("nit") or "",
            "correo": cliente.get("correo") or cliente.get("email") or "",
            "direccion": cliente.get("direccion") or "",
        },
        "productos": lineas,
        "subtotal": subtotal_sin_iva,
        "iva": iva,
        "total": round(total, 2),
        "notas": notas,
    }

    try:
        ruta = enviar_cotizacion(cotizacion, jid)
    except Exception as e:
        return {"ok": False, "error": f"No se pudo generar/enviar la cotización: {e}"}

    return {"ok": True, "numero": cotizacion["numero"], "total": cotizacion["total"], "pdf_path": ruta}


def generar_y_enviar_factura_directa(
    *,
    cliente: dict,
    productos: list[dict],
    telefono: str,
    referencia: str = "",
) -> dict:
    """
    Factura electrónica real en Alegra para una venta directa. `cliente` debe
    traer identificación real (nombre + identificación son obligatorios) —
    a diferencia de MeLi, acá SÍ conocemos al comprador, así que no aplica
    "consumidor final" genérico salvo que el operador lo escriba a propósito.
    """
    from app.services.alegra import crear_factura_venta_alegra
    from app.utils import enviar_whatsapp_archivo, enviar_whatsapp_reporte, jid_grupo_facturacion_ventas_wa

    jid = _telefono_a_jid(telefono)
    if not jid:
        return {"ok": False, "error": f"Teléfono inválido: {telefono!r} (10 dígitos empezando en 3, o con 57 adelante)."}
    if not productos:
        return {"ok": False, "error": "La factura no tiene productos."}

    nombre_cliente = str(cliente.get("nombre") or "").strip()
    identificacion = str(cliente.get("identificacion") or cliente.get("nit") or "").strip()
    if not nombre_cliente or not identificacion:
        return {"ok": False, "error": "Faltan nombre o identificación del cliente — obligatorios para facturar."}

    lineas = []
    total = 0.0
    for p in productos:
        codigo = str(p.get("codigo") or "").strip()
        try:
            cantidad = float(p.get("cantidad") or 1)
            precio_unit = float(p.get("precio_unitario") or 0)
        except (TypeError, ValueError):
            return {"ok": False, "error": f"Cantidad/precio inválido: {p!r}"}
        if not codigo or cantidad <= 0 or precio_unit < 0:
            return {"ok": False, "error": f"Línea inválida: {p!r}"}
        total += cantidad * precio_unit
        lineas.append({
            "codigo": codigo, "nombre": p.get("nombre") or codigo,
            "cantidad": cantidad, "precio_unitario": precio_unit,
        })

    result = crear_factura_venta_alegra(
        nombre_cliente=nombre_cliente,
        identificacion=identificacion,
        direccion_envio=cliente.get("direccion") or "",
        productos=lineas,
        total=round(total, 2),
        email=cliente.get("correo") or cliente.get("email") or "",
        telefono=telefono,
        observaciones=f"Venta directa (WhatsApp/app){f' — {referencia}' if referencia else ''}.",
        purchase_order=referencia,
        descargar_pdf=True,
        enviar_dian=True,
        enviar_correo=False,
    )
    if not result.get("ok"):
        return {"ok": False, "error": result.get("error") or "Error desconocido creando la factura en Alegra."}

    numero = result.get("number") or result.get("invoice_id")
    pdf_b64 = result.get("pdf_base64")
    enviado_cliente = False
    aviso = ""
    if pdf_b64:
        tmp_dir = tempfile.mkdtemp(prefix="factura_directa_")
        tmp_path = os.path.join(tmp_dir, f"Factura_{numero}.pdf")
        with open(tmp_path, "wb") as f:
            f.write(base64.b64decode(pdf_b64))
        caption = (
            f"🧾 *Factura electrónica {numero}*\n"
            f"👤 {nombre_cliente}\n"
            f"💵 Total: *${total:,.0f} COP*\n"
        )
        enviado_cliente = bool(enviar_whatsapp_archivo(tmp_path, caption, numero_destino=jid))
        if not enviado_cliente:
            aviso = " (no se pudo enviar el PDF por WhatsApp al cliente — revisar manual)"
    else:
        aviso = " (factura creada pero sin PDF para enviar — revisar manual)"

    enviar_whatsapp_reporte(
        f"🧾 *Factura directa* {numero} — {nombre_cliente} — ${total:,.0f} COP.{aviso}",
        numero_destino=jid_grupo_facturacion_ventas_wa(),
    )

    return {
        "ok": True,
        "numero": numero,
        "total": round(total, 2),
        "cufe": result.get("cufe"),
        "url": result.get("url"),
        "enviado_whatsapp": enviado_cliente,
    }
