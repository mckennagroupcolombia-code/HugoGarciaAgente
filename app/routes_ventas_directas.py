"""
Ventas directas (WhatsApp) — /api/ventas-directas/* y alias /app/api/...

Wizard de Facturación → Cotizar/Facturar. Lógica en
app/services/ventas_directas.py. Crea facturas DIAN reales, así que el backend
exige el permiso explícito `cotizar-facturar` (o nivel administrador), igual
que el panel: ocultar la pestaña no basta para restringir la API.
"""

from __future__ import annotations

from functools import wraps

from flask import g, jsonify, request


def _usuario_puede(usuario: dict | None) -> bool:
    if not usuario:
        return False
    try:
        from app.services.tickets_db import es_admin_efectivo

        if es_admin_efectivo(usuario):
            return True
    except Exception:
        pass
    return bool((usuario.get("permisos_secciones") or {}).get("cotizar-facturar"))


def _auth(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        from app.api_auth import bearer_token_from_request, chat_api_token_matches_request
        from app.services.tickets_db import aplicar_privilegios_admin_cynthia, get_usuario_by_token

        usuario = None
        try:
            xt = (request.headers.get("X-Tickets-Token") or "").strip()
            if xt:
                usuario = aplicar_privilegios_admin_cynthia(get_usuario_by_token(xt))
            if not usuario and not chat_api_token_matches_request():
                tok = bearer_token_from_request()
                usuario = aplicar_privilegios_admin_cynthia(get_usuario_by_token(tok)) if tok else None
        except Exception:
            usuario = None

        if chat_api_token_matches_request():
            g.ventas_directas_usuario = (usuario or {}).get("username") or "sistema"
            g.ventas_directas_admin = True
            return f(*args, **kwargs)
        if not usuario:
            return jsonify({"error": "No autorizado"}), 401
        if not _usuario_puede(usuario):
            return jsonify({"error": "Cotizar/Facturar requiere el permiso 'cotizar-facturar'"}), 403
        g.ventas_directas_usuario = usuario.get("username") or "?"
        try:
            from app.services.tickets_db import es_admin_efectivo

            g.ventas_directas_admin = bool(es_admin_efectivo(usuario))
        except Exception:
            g.ventas_directas_admin = False
        return f(*args, **kwargs)

    return wrapper


def _dual(app, rule: str, **opts):
    def deco(f):
        app.add_url_rule(rule, endpoint=f.__name__, view_func=f, **opts)
        app.add_url_rule("/app" + rule, endpoint=f.__name__ + "_app", view_func=f, **opts)
        return f

    return deco


def register_ventas_directas_routes(app):
    from app.services import ventas_directas as V

    @_dual(app, "/api/ventas-directas/comisiones", methods=["GET"])
    @_auth
    def vd_comisiones():
        """Ventas de WhatsApp facturadas en el mes y la comisión de quien las
        atendió. Un vendedor ve solo lo suyo; administración ve a todos."""
        vendedor = None if getattr(g, "ventas_directas_admin", False) else g.ventas_directas_usuario
        try:
            return jsonify(V.comisiones_mes(request.args.get("mes") or None, vendedor=vendedor))
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    @_dual(app, "/api/ventas-directas", methods=["GET"])
    @_auth
    def vd_listar():
        try:
            limite = int(request.args.get("limit") or 50)
        except ValueError:
            limite = 50
        return jsonify({"ventas": V.listar(request.args.get("estado") or "", (request.args.get("q") or "").strip(), limite)})

    @_dual(app, "/api/ventas-directas/<int:venta_id>", methods=["GET"])
    @_auth
    def vd_obtener(venta_id: int):
        venta = V.obtener(venta_id)
        return (jsonify(venta), 200) if venta else (jsonify({"error": "No existe"}), 404)

    @_dual(app, "/api/ventas-directas/calcular", methods=["POST"])
    @_auth
    def vd_calcular():
        data = request.get_json(silent=True) or {}
        return jsonify(V.calcular(data.get("lineas") or [], data.get("envio") or 0))

    @_dual(app, "/api/ventas-directas/precio", methods=["GET"])
    @_auth
    def vd_precio():
        codigo = (request.args.get("codigo") or "").strip()
        if not codigo:
            return jsonify({"error": "codigo es obligatorio"}), 400
        return jsonify(V.precio_sugerido(codigo))

    @_dual(app, "/api/ventas-directas/vista-previa.pdf", methods=["POST"])
    @_auth
    def vd_vista_previa_pdf():
        """El PDF exacto que recibiría el cliente, con lo que hay en pantalla. No guarda nada."""
        import io

        from flask import send_file

        try:
            pdf = V.vista_previa_pdf(request.get_json(silent=True) or {})
        except Exception as e:  # noqa: BLE001
            return jsonify({"error": f"No se pudo generar la vista previa: {e}"}), 500
        return send_file(io.BytesIO(pdf), mimetype="application/pdf", download_name="cotizacion-borrador.pdf")

    @_dual(app, "/api/ventas-directas/clientes", methods=["POST"])
    @_auth
    def vd_crear_cliente():
        """Alta de cliente desde el paso 2 del wizard: contacto en Alegra + tercero del Libro Mayor."""
        try:
            r = V.crear_cliente(request.get_json(silent=True) or {}, usuario=g.ventas_directas_usuario)
        except Exception as e:  # noqa: BLE001
            return jsonify({"ok": False, "error": str(e)}), 502
        return jsonify(r), (200 if r.get("ok") else 400)

    @_dual(app, "/api/ventas-directas", methods=["POST"])
    @_auth
    def vd_crear():
        try:
            return jsonify({"ok": True, "venta": V.guardar(request.get_json(silent=True) or {}, usuario=g.ventas_directas_usuario)})
        except ValueError as e:
            return jsonify({"ok": False, "error": str(e)}), 400

    @_dual(app, "/api/ventas-directas/<int:venta_id>", methods=["PUT"])
    @_auth
    def vd_actualizar(venta_id: int):
        try:
            venta = V.guardar(request.get_json(silent=True) or {}, usuario=g.ventas_directas_usuario, venta_id=venta_id)
            return jsonify({"ok": True, "venta": venta})
        except ValueError as e:
            return jsonify({"ok": False, "error": str(e)}), 400

    @_dual(app, "/api/ventas-directas/<int:venta_id>/cotizar", methods=["POST"])
    @_auth
    def vd_cotizar(venta_id: int):
        data = request.get_json(silent=True) or {}
        r = V.cotizar(
            venta_id,
            enviar_whatsapp=bool(data.get("enviar_whatsapp", True)),
            registrar_en_alegra=bool(data.get("registrar_en_alegra", True)),
        )
        return jsonify(r), (200 if r.get("ok") else 400)

    @_dual(app, "/api/ventas-directas/<int:venta_id>/facturar", methods=["POST"])
    @_auth
    def vd_facturar(venta_id: int):
        data = request.get_json(silent=True) or {}
        r = V.facturar(
            venta_id,
            usuario=g.ventas_directas_usuario,
            medio_pago=str(data.get("medio_pago") or ""),
            enviar_whatsapp=bool(data.get("enviar_whatsapp", True)),
        )
        return jsonify(r), (200 if r.get("ok") else 400)

    @_dual(app, "/api/ventas-directas/<int:venta_id>/anular", methods=["POST"])
    @_auth
    def vd_anular(venta_id: int):
        r = V.anular(venta_id)
        return jsonify(r), (200 if r.get("ok") else 400)

    @_dual(app, "/api/ventas-directas/<int:venta_id>/pdf", methods=["GET"])
    @_auth
    def vd_pdf(venta_id: int):
        import os

        from flask import send_file

        from app.tools.cotizacion_pdf import CARPETA

        venta = V.obtener(venta_id)
        if not venta:
            return jsonify({"error": "No existe"}), 404
        ruta = os.path.join(CARPETA, f"{venta['numero']}.pdf")
        if not os.path.isfile(ruta):
            return jsonify({"error": "La cotización aún no tiene PDF"}), 404
        return send_file(ruta, mimetype="application/pdf", download_name=f"{venta['numero']}.pdf")

    @_dual(app, "/api/ventas-directas/meli/<ref>", methods=["GET"])
    @_auth
    def vd_venta_meli(ref: str):
        """Comprador, productos y si ya está facturada una venta de MeLi (pack u orden)."""
        try:
            r = V.consultar_venta_meli(ref)
        except Exception as e:  # noqa: BLE001
            r = {"ok": False, "error": f"No se pudo consultar MeLi: {e}"}
        return jsonify(r), (200 if r.get("ok") else 400)

    @_dual(app, "/api/ventas-directas/pedidos-ia", methods=["GET"])
    @_auth
    def vd_pedidos_ia():
        from app.services.wa_jid import formato_display

        pedidos = V.pedidos_ia_para_facturar()
        for p in pedidos:
            p["display"] = formato_display(p["jid"])
        return jsonify({"pedidos": pedidos})

    @_dual(app, "/api/ventas-directas/desde-pedido/<int:pedido_id>", methods=["POST"])
    @_auth
    def vd_desde_pedido(pedido_id: int):
        """Crea (o devuelve la ya creada) la venta directa de un pedido del agente IA."""
        pedidos = {p["id"]: p for p in V.pedidos_ia_para_facturar(dias=30)}
        p = pedidos.get(pedido_id)
        if not p:
            return jsonify({"ok": False, "error": "Pedido no encontrado (o sin productos)."}), 404
        if p.get("venta_directa"):
            return jsonify({"ok": True, "venta": V.obtener(p["venta_directa"]["id"]), "existente": True})
        venta = V.guardar(V.venta_desde_pedido_ia(p), usuario=g.ventas_directas_usuario)
        return jsonify({"ok": True, "venta": venta, "existente": False})
