"""
Precios indexados a la TRM — /api/precios-trm/* (y alias /app/api/...).

Cambia precios reales del catálogo entero, así que solo lo usa un
administrador (o CHAT_API_TOKEN). Lógica en app/services/precios_trm.py.
"""

from __future__ import annotations

from functools import wraps

from flask import g, jsonify, request


def _auth(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        from app.api_auth import bearer_token_from_request, chat_api_token_matches_request
        from app.services.tickets_db import (
            aplicar_privilegios_admin_cynthia,
            es_admin_efectivo,
            get_usuario_by_token,
        )

        # La persona va en X-Tickets-Token aunque el Bearer sea el token de sistema.
        usuario = None
        xt = (request.headers.get("X-Tickets-Token") or "").strip()
        try:
            if xt:
                usuario = aplicar_privilegios_admin_cynthia(get_usuario_by_token(xt))
            if not usuario and not chat_api_token_matches_request():
                tok = bearer_token_from_request()
                usuario = aplicar_privilegios_admin_cynthia(get_usuario_by_token(tok)) if tok else None
        except Exception:
            usuario = None

        if chat_api_token_matches_request():
            g.precios_trm_usuario = (usuario or {}).get("username") or "sistema"
            return f(*args, **kwargs)
        if not usuario:
            return jsonify({"error": "No autorizado"}), 401
        if not es_admin_efectivo(usuario):
            return jsonify({"error": "Ajustar precios por TRM requiere nivel administrador"}), 403
        g.precios_trm_usuario = usuario.get("username") or "?"
        return f(*args, **kwargs)

    return wrapper


def _dual(app, rule: str, **opts):
    def deco(f):
        app.add_url_rule(rule, endpoint=f.__name__, view_func=f, **opts)
        app.add_url_rule("/app" + rule, endpoint=f.__name__ + "_app", view_func=f, **opts)
        return f
    return deco


def _ids() -> list[int]:
    data = request.get_json(silent=True) or {}
    try:
        return [int(i) for i in data.get("ids") or []]
    except (TypeError, ValueError):
        return []


def register_precios_trm_routes(app):
    from app.services import precios_trm as P

    @_dual(app, "/api/precios-trm", methods=["GET"])
    @_auth
    def precios_trm_estado():
        return jsonify(P.estado())

    @_dual(app, "/api/precios-trm/config", methods=["PUT"])
    @_auth
    def precios_trm_config():
        try:
            return jsonify({"ok": True, "config": P.guardar_config(request.get_json(silent=True) or {})})
        except (TypeError, ValueError) as e:
            return jsonify({"error": str(e)}), 400

    @_dual(app, "/api/precios-trm/proponer", methods=["POST"])
    @_auth
    def precios_trm_proponer():
        try:
            return jsonify(P.proponer())
        except RuntimeError as e:
            return jsonify({"error": str(e)}), 502

    @_dual(app, "/api/precios-trm/aplicar", methods=["POST"])
    @_auth
    def precios_trm_aplicar():
        r = P.aplicar(_ids(), g.precios_trm_usuario)
        return jsonify(r), (200 if r.get("ok") else 400)

    @_dual(app, "/api/precios-trm/descartar", methods=["POST"])
    @_auth
    def precios_trm_descartar():
        return jsonify({"ok": True, "descartadas": P.descartar(_ids(), g.precios_trm_usuario)})
