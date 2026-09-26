"""
Canales del producto — /api/canales-producto/* y alias /app/api/...

Panel Publicar → Canales del producto. Lógica en app/services/canales_producto.py.
Solo lectura, solo diagnóstico y sin LLM: la única llamada viva es el «verificar
en vivo» puntual por SKU (consulta Alegra como lo haría la facturación).

El permiso se valida también acá (no solo ocultando la pestaña): administrador, o
quien tenga `canales-producto` / `mapa-sistema` / `publicaciones`.
"""

from __future__ import annotations

from functools import wraps

from flask import jsonify, request

_PERMISOS = ("canales-producto", "mapa-sistema", "publicaciones")


def _usuario_puede(usuario: dict | None) -> bool:
    if not usuario:
        return False
    try:
        from app.services.tickets_db import es_admin_efectivo

        if es_admin_efectivo(usuario):
            return True
    except Exception:
        pass
    permisos = usuario.get("permisos_secciones") or {}
    # Sin mapa de permisos NO se abre: es una vista de administración.
    return any(permisos.get(p) for p in _PERMISOS)


def _auth(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        from app.api_auth import bearer_token_from_request, chat_api_token_matches_request
        from app.services.tickets_db import aplicar_privilegios_admin_cynthia, get_usuario_by_token

        if chat_api_token_matches_request():
            return f(*args, **kwargs)
        usuario = None
        try:
            tok = (request.headers.get("X-Tickets-Token") or "").strip() or bearer_token_from_request()
            usuario = aplicar_privilegios_admin_cynthia(get_usuario_by_token(tok)) if tok else None
        except Exception:
            usuario = None
        if not usuario:
            return jsonify({"error": "No autorizado"}), 401
        if not _usuario_puede(usuario):
            return jsonify({"error": "Canales del producto es una vista de administración"}), 403
        return f(*args, **kwargs)

    return wrapper


def _dual(app, rule: str, **opts):
    def deco(f):
        app.add_url_rule(rule, endpoint=f.__name__, view_func=f, **opts)
        app.add_url_rule("/app" + rule, endpoint=f.__name__ + "_app", view_func=f, **opts)
        return f

    return deco


def register_canales_producto_routes(app):
    from app.services import canales_producto as C

    @_dual(app, "/api/canales-producto/tabla", methods=["GET"])
    @_auth
    def canales_producto_tabla():
        refrescar = request.args.get("refrescar") == "1"
        return jsonify(C.tabla_maestra(refrescar=refrescar))

    @_dual(app, "/api/canales-producto/categorias", methods=["GET"])
    @_auth
    def canales_producto_categorias():
        return jsonify(C.categorias_por_producto())

    @_dual(app, "/api/canales-producto/verificar/<path:sku>", methods=["POST"])
    @_auth
    def canales_producto_verificar(sku: str):
        return jsonify(C.verificar_en_vivo(sku))

    @_dual(app, "/api/canales-producto/invalidar", methods=["POST"])
    @_auth
    def canales_producto_invalidar():
        C.invalidar()
        return jsonify({"ok": True})
