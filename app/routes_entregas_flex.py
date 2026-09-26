"""
Entregas Flex de MeLi — /api/entregas-flex/* y alias /app/api/...

Panel Atención → Entregas Flex. Lógica en app/services/entregas_flex.py.
El permiso se valida también acá (no solo ocultando la pestaña): lo ve un
administrador o quien tenga `entregas-flex`, `pedidos`, `empaque` o
`guias-envio` — los mismos que despachan.
"""

from __future__ import annotations

from functools import wraps

from flask import jsonify, request

_PERMISOS = ("entregas-flex", "pedidos", "empaque", "guias-envio")


def _usuario_puede(usuario: dict | None) -> bool:
    if not usuario:
        return False
    try:
        from app.services.tickets_db import es_admin_efectivo

        if es_admin_efectivo(usuario):
            return True
    except Exception:
        pass
    permisos = usuario.get("permisos_secciones")
    # Sin mapa de permisos = usuario heredado sin restricciones (igual que en el panel).
    if not permisos:
        return True
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
            return jsonify({"error": "Entregas Flex requiere el permiso 'entregas-flex' (o Pedidos/Empaque)"}), 403
        return f(*args, **kwargs)

    return wrapper


def _dual(app, rule: str, **opts):
    def deco(f):
        app.add_url_rule(rule, endpoint=f.__name__, view_func=f, **opts)
        app.add_url_rule("/app" + rule, endpoint=f.__name__ + "_app", view_func=f, **opts)
        return f

    return deco


def register_entregas_flex_routes(app):
    from app.services import entregas_flex as E

    @_dual(app, "/api/entregas-flex/resumen", methods=["GET"])
    @_auth
    def entregas_flex_resumen():
        try:
            semanas = int(request.args.get("semanas") or 12)
        except ValueError:
            semanas = 12
        return jsonify(E.resumen(semanas))

    @_dual(app, "/api/entregas-flex/estado", methods=["GET"])
    @_auth
    def entregas_flex_estado():
        return jsonify(E.estado_sync())

    @_dual(app, "/api/entregas-flex/sincronizar", methods=["POST"])
    @_auth
    def entregas_flex_sincronizar():
        data = request.get_json(silent=True) or {}
        try:
            dias = max(1, min(int(data.get("dias") or 10), 90))
        except (TypeError, ValueError):
            dias = 10
        r = E.sincronizar_en_segundo_plano(dias)
        return jsonify(r), (202 if r.get("ok") else 409)
