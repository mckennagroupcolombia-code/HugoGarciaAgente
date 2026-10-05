"""
Fórmulas de producto — API de Diseño de producto → Fórmulas.

Endpoints bajo /api/formulas/* (y alias /app/api/formulas/*). Acceso: CHAT_API_TOKEN
(admin) o usuario de tickets administrador o con permiso `formulas`: las fórmulas son
receta propia de la empresa, no las ve todo el equipo como las etiquetas.

Datos: app/services/formulas_db.py (app/data/formulas.json). Los ingredientes se buscan
en la copia local del catálogo de Alegra, sin combos. Ninguna ruta escribe en Alegra. Solo «Leer de pantallazo»
(POST /api/formulas/leer-captura) llama a Gemini Vision, y solo para transcribir la
captura: los porcentajes los calcula app/services/formulas_captura.py.
"""

from __future__ import annotations

from functools import wraps

from flask import jsonify, request


def _dual(app, rule: str, **opts):
    """Registra la ruta en /api/... y /app/api/... (ver docs/agentic/modules/desktop-panel.md)."""

    def deco(f):
        app.add_url_rule(rule, endpoint=f.__name__, view_func=f, **opts)
        app.add_url_rule("/app" + rule, endpoint=f.__name__ + "_app", view_func=f, **opts)
        return f

    return deco


def _auth(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        from app.api_auth import bearer_token_from_request, chat_api_token_matches_request

        if chat_api_token_matches_request():
            # El token de sistema no dice quién es; la identidad viaja en X-Tickets-Token.
            request.environ["fo_usuario"] = _usuario_por_token(request.headers.get("X-Tickets-Token") or "")
            return f(*args, **kwargs)
        token = bearer_token_from_request()
        if not token:
            return jsonify({"error": "No autorizado"}), 401
        usuario = _usuario_por_token(token)
        if not usuario:
            return jsonify({"error": "Sesión inválida o expirada"}), 401
        from app.services.acceso_paneles import puede_ver_panel

        if not puede_ver_panel(usuario, "formulas"):
            return jsonify({"error": "Fórmulas requiere rol administrador o permiso 'formulas'"}), 403
        request.environ["fo_usuario"] = usuario
        return f(*args, **kwargs)

    return wrapper


def _usuario_por_token(token: str) -> dict | None:
    if not token:
        return None
    try:
        from app.services.tickets_db import aplicar_privilegios_admin_cynthia, get_usuario_by_token

        return aplicar_privilegios_admin_cynthia(get_usuario_by_token(token))
    except Exception:
        return None


def _autor() -> str:
    usuario = request.environ.get("fo_usuario") or {}
    return str(usuario.get("nombre") or usuario.get("username") or "")


def register_formulas_routes(app):
    from app.services import formulas_db as fdb

    @_dual(app, "/api/formulas", methods=["GET"])
    @_auth
    def formulas_listar():
        return jsonify({"formulas": fdb.listar()})

    @_dual(app, "/api/formulas", methods=["POST"])
    @_auth
    def formulas_guardar():
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            return jsonify({"error": "Cuerpo inválido"}), 400
        try:
            return jsonify({"formula": fdb.guardar(body, _autor())})
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    @_dual(app, "/api/formulas/<formula_id>", methods=["DELETE"])
    @_auth
    def formulas_eliminar(formula_id: str):
        if not fdb.eliminar(formula_id):
            return jsonify({"error": "No existe esa fórmula"}), 404
        return jsonify({"ok": True})

    @_dual(app, "/api/formulas/materias", methods=["GET"])
    @_auth
    def formulas_materias():
        """Materias primas para el buscador de ingredientes (catálogo local, sin combos)."""
        q = (request.args.get("q") or "").strip()
        if len(q) < 2:
            return jsonify({"items": []})
        try:
            from app.services.alegra_catalogo_db import buscar_picker_local

            items = buscar_picker_local(q, max_items=20, excluir_combos=True)
        except Exception as e:
            return jsonify({"items": [], "error": str(e)})
        return jsonify({"items": [{"codigo": i["codigo"], "nombre": i["nombre"]} for i in items]})

    @_dual(app, "/api/formulas/leer-captura", methods=["POST"])
    @_auth
    def formulas_leer_captura():
        """Pantallazo de una fórmula → ingredientes con su porcentaje (no guarda nada)."""
        body = request.get_json(silent=True) or {}
        try:
            from app.services.formulas_captura import leer_captura

            return jsonify(leer_captura(str(body.get("imagen") or "")))
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except TimeoutError:
            return jsonify({"error": "La IA tardó demasiado leyendo la captura; inténtalo de nuevo."}), 504
        except Exception as e:
            return jsonify({"error": f"No se pudo leer la captura: {e}"[:300]}), 500
