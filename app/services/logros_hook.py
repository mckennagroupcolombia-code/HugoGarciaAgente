"""
El árbitro de las misiones: al terminar bien una petición de su catálogo, paga las monedas a
quien la hizo y le avisa al panel en la cabecera `X-Mck-Monedas` (el navegador muestra la moneda).

Solo mira las rutas del catálogo; cualquier otra petición pasa sin tocar la base. Un fallo aquí
nunca rompe la respuesta: la acción ya se hizo, a lo sumo no se paga.
"""
from __future__ import annotations

import json
from typing import Callable
from urllib.parse import quote

from flask import request

# (método, regla de Flask) → (misión, de dónde sale la referencia, condición opcional sobre el JSON
# de la respuesta). La referencia evita cobrar dos veces lo mismo el mismo día: un argumento de la
# ruta (`"ticket_id"`), un campo del JSON de la respuesta (`"json:id"`) o nada (`None`: cada
# petición es una misión distinta, limitada por el tope diario).
Condicion = Callable[[dict], bool]
_ESTADOS_ENTREGADA = {"resuelto", "esperando_aprobacion"}

CATALOGO: dict[tuple[str, str], tuple[str, str | None, Condicion | None]] = {
    # Tareas y equipo
    ("POST", "/api/tickets/<int:ticket_id>/comentarios"): ("ticket_comentario", "ticket_id", None),
    ("POST", "/api/tickets/"): ("ticket_creado", "json:id", None),
    ("POST", "/api/tickets/<int:ticket_id>/adjuntos"): ("evidencia", "json:id", None),
    ("POST", "/api/tickets/<int:ticket_id>/pasos/<int:paso_id>/adjuntos"): ("evidencia", "json:id", None),
    ("POST", "/api/tickets/pasos/<int:paso_id>/completar"): ("ticket_paso", "paso_id", None),
    ("POST", "/api/tickets/<int:ticket_id>/pasos/<int:paso_id>/completar"): ("ticket_paso", "paso_id", None),
    ("POST", "/api/tickets/recetas/corridas/<int:corrida_id>/procesos/<int:proceso_id>/completar"): (
        "produccion_proceso", "proceso_id", None),
    ("POST", "/api/tickets/<int:accion_id>/completar-accion"): ("accion_completada", "accion_id", None),
    ("POST", "/api/5s/routine"): ("rutina_5s", None, None),
    ("PUT", "/api/tickets/<int:ticket_id>/estado"): (
        "ticket_resuelto", "ticket_id", lambda j: j.get("estado") in _ESTADOS_ENTREGADA),
    ("POST", "/api/tickets/misiones/corridas/<int:corrida_id>/finalizar"): ("mision_corrida", "corrida_id", None),
    ("POST", "/api/tickets/corridas/<int:corrida_id>/finalizar"): ("mision_corrida", "corrida_id", None),
    ("POST", "/api/tickets/protocolos"): ("protocolo", "json:id", None),
    ("POST", "/api/tickets/<int:ticket_id>/guardar-como-protocolo"): ("protocolo", "ticket_id", None),
    ("POST", "/api/tickets/<int:ticket_id>/guardar-procedimiento"): ("protocolo", "ticket_id", None),
    ("POST", "/api/tickets/recetas/corridas/<int:corrida_id>/finalizar"): ("produccion_lote", "corrida_id", None),
    # Ventas y clientes
    ("POST", "/api/responder-preventa"): ("respuesta_cliente", None, None),
    ("POST", "/api/responder-postventa"): ("respuesta_cliente", None, None),
    ("POST", "/api/responder-ventas-email"): ("respuesta_cliente", None, None),
    ("POST", "/api/facturacion/ventas-unificadas/marcar-revisado"): ("venta_revisada", None, None),
    ("POST", "/api/facturacion/ventas-unificadas/facturar-ahora"): ("factura_emitida", None, None),
    ("POST", "/api/facturacion/facturar-directo"): ("factura_emitida", None, None),
    ("POST", "/api/pedidos/web/facturar"): ("factura_emitida", None, None),
    # Despachos e inventario
    ("POST", "/api/guias/rotulos"): ("rotulos", None, None),
    ("POST", "/api/stock/ajustar"): ("conteo_stock", None, None),
    ("POST", "/api/inventario-control/revisar"): ("conteo_stock", None, None),
    ("POST", "/api/empaque/ventas/<canal>/<path:venta_id>/evidencias"): ("empaque_evidencia", "venta_id", None),
    ("POST", "/api/inventario-control/solicitar-compra"): ("solicitud_compra", None, None),
    # Contabilidad y pagos
    ("POST", "/api/contabilidad/cc/movimientos/<int:movimiento_id>/comprobante"): ("comprobante", "movimiento_id", None),
    ("POST", "/api/contabilidad/cc/gastos-personales/<int:gasto_id>/comprobante"): ("comprobante", "gasto_id", None),
    ("POST", "/api/mensajeria/lotes/<int:lote_id>/comprobante"): ("comprobante", "lote_id", None),
    ("POST", "/api/contabilidad/cc/movimientos"): ("movimiento_contable", "json:id", None),
    ("POST", "/api/contabilidad/cc/gastos-personales"): ("movimiento_contable", "json:id", None),
    ("POST", "/api/contabilidad/extractos/vincular"): ("conciliacion", None, None),
    ("POST", "/api/pagos/solicitudes"): ("pago_solicitado", "json:id", None),
    ("POST", "/api/pagos/solicitudes/<int:sid>/aprobar"): ("pago_aprobado", "sid", None),
    ("POST", "/api/facturas/<sufijo>/procesar"): ("factura_proveedor", "sufijo", None),
    ("POST", "/api/pagos/solicitudes/<int:sid>/confirmar-pago"): ("pago_confirmado", "sid", None),
    ("POST", "/api/contabilidad/extractos/vincular-lote"): ("conciliacion_lote", None, None),
    # Catálogo y publicaciones
    ("POST", "/api/etiquetas/codigos-ean"): ("ean_asignado", "json:id", None),
    ("POST", "/api/publicaciones/<sku>/imagen"): ("publicacion_imagen", "sku", None),
    ("PUT", "/api/publicaciones/<sku>/imagenes/web"): ("publicacion_imagen", "sku", None),
    ("PUT", "/api/publicaciones/<sku>/imagenes/meli"): ("publicacion_imagen", "sku", None),
    ("PUT", "/api/publicaciones/<sku>"): ("publicacion_editada", "sku", None),
    ("POST", "/api/meli/compliance/republicar"): ("meli_republicar", None, None),
    ("POST", "/api/meli/compliance/crear-nueva"): ("meli_crear", None, None),
    # Calidad
    ("POST", "/api/lotes/<ref>"): ("lote_documentado", "ref", None),
    ("POST", "/api/coa/generar"): ("documento_calidad", None, None),
    ("POST", "/api/sds/generar"): ("documento_calidad", None, None),
}


def _usuario_id() -> int | None:
    """Quién hizo la petición: el JWT de tickets (Bearer en /api/tickets/*, `X-Tickets-Token`
    en el resto). El CHAT_API_TOKEN de administración no identifica a nadie y no cobra."""
    tickets = getattr(request, "tickets_usuario", None)
    if tickets and tickets.get("id"):
        return int(tickets["id"])
    from app.services.tickets_db import get_usuario_by_token

    for tok in (
        (request.headers.get("X-Tickets-Token") or "").strip(),
        (request.headers.get("Authorization") or "")[7:].strip(),
    ):
        if tok:
            u = get_usuario_by_token(tok)
            if u and u.get("id"):
                return int(u["id"])
    return None


def _cobrar(response):
    if request.method not in ("POST", "PUT", "PATCH") or not (200 <= response.status_code < 300):
        return response
    regla = request.url_rule.rule if request.url_rule else ""
    # El panel también llama las rutas con el prefijo /app (proxy); la regla es la misma sin él.
    entrada = CATALOGO.get((request.method, regla)) or CATALOGO.get((request.method, regla.removeprefix("/app")))
    if not entrada:
        return response
    try:
        mision, fuente_ref, condicion = entrada
        cuerpo: dict = {}
        if response.is_json:
            j = response.get_json(silent=True)
            cuerpo = j if isinstance(j, dict) else {}
        if condicion and not condicion(cuerpo):
            return response
        uid = _usuario_id()
        if not uid:
            return response
        ref = ""
        if fuente_ref and fuente_ref.startswith("json:"):
            ref = str(cuerpo.get(fuente_ref[5:]) or "")
        elif fuente_ref:
            ref = str((request.view_args or {}).get(fuente_ref) or "")
        if not ref:
            # Sin referencia cada petición cuenta aparte; la frena el tope diario de la misión.
            from datetime import datetime

            ref = f"{regla}@{datetime.now().isoformat(timespec='microseconds')}"
        from app.services.logros_usuario import registrar_mision

        pago = registrar_mision(uid, mision, ref)
        if pago.get("pagada"):
            response.headers["X-Mck-Monedas"] = quote(json.dumps(pago, ensure_ascii=False))
    except Exception as e:  # noqa: BLE001 — el premio nunca tumba la acción
        print(f"⚠️ [LOGROS] no se pudo pagar {request.method} {request.path}: {e}", flush=True)
    return response


def registrar_arbitro(app) -> None:
    app.after_request(_cobrar)
