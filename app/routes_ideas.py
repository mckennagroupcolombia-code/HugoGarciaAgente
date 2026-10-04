"""
Ideas de producto — API de Diseño de producto → Desarrollar idea (cladograma).

Endpoints bajo /api/ideas/* (y alias /app/api/ideas/*). Acceso: CHAT_API_TOKEN
(admin) o usuario de tickets administrador o con permiso `ideas`.

Datos: app/services/ideas_db.py (app/data/ideas.json). Desarrollar y ramificar
llaman a Gemini en un job en segundo plano (POST → job_id, GET del estado): la
IA tarda 30-60 s y el túnel de Cloudflare corta a ~100 s.
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
            request.environ["id_usuario"] = _usuario_por_token(request.headers.get("X-Tickets-Token") or "")
            return f(*args, **kwargs)
        token = bearer_token_from_request()
        if not token:
            return jsonify({"error": "No autorizado"}), 401
        usuario = _usuario_por_token(token)
        if not usuario:
            return jsonify({"error": "Sesión inválida o expirada"}), 401
        from app.services.acceso_paneles import puede_ver_panel

        if not puede_ver_panel(usuario, "ideas"):
            return jsonify({"error": "Desarrollar idea requiere rol administrador o permiso 'ideas'"}), 403
        request.environ["id_usuario"] = usuario
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
    usuario = request.environ.get("id_usuario") or {}
    return str(usuario.get("nombre") or usuario.get("username") or "")


def register_ideas_routes(app):
    from app.services import ideas_db as idb
    from app.services.coa_scan_jobs import estado_coa_scan_job, iniciar_job

    @_dual(app, "/api/ideas", methods=["GET"])
    @_auth
    def ideas_listar():
        return jsonify({"ideas": idb.listar()})

    @_dual(app, "/api/ideas", methods=["POST"])
    @_auth
    def ideas_guardar():
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            return jsonify({"error": "Cuerpo inválido"}), 400
        try:
            return jsonify({"idea": idb.guardar(body, _autor())})
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    @_dual(app, "/api/ideas/<idea_id>", methods=["DELETE"])
    @_auth
    def ideas_eliminar(idea_id: str):
        if not idb.eliminar(idea_id):
            return jsonify({"error": "No existe esa idea"}), 404
        return jsonify({"ok": True})

    @_dual(app, "/api/ideas/desarrollar", methods=["POST"])
    @_auth
    def ideas_desarrollar():
        body = request.get_json(silent=True) or {}
        titulo = str(body.get("titulo") or "").strip()
        if not titulo:
            return jsonify({"error": "Escribe primero la idea"}), 400
        job_id = iniciar_job(idb.desarrollar, titulo, str(body.get("descripcion") or ""))
        return jsonify({"ok": True, "status": "pending", "job_id": job_id}), 202

    @_dual(app, "/api/ideas/ramificar", methods=["POST"])
    @_auth
    def ideas_ramificar():
        body = request.get_json(silent=True) or {}
        ruta = body.get("ruta") if isinstance(body.get("ruta"), list) else []
        if not ruta:
            return jsonify({"error": "Falta el nodo a ramificar"}), 400
        existentes = body.get("existentes") if isinstance(body.get("existentes"), list) else []
        job_id = iniciar_job(
            idb.ramificar,
            str(body.get("titulo") or ""),
            str(body.get("descripcion") or ""),
            [str(r) for r in ruta],
            [str(e) for e in existentes],
        )
        return jsonify({"ok": True, "status": "pending", "job_id": job_id}), 202

    @_dual(app, "/api/ideas/job/<job_id>", methods=["GET"])
    @_auth
    def ideas_job(job_id: str):
        job = estado_coa_scan_job(job_id)
        if not job:
            return jsonify({"ok": False, "status": "error", "error": "La consulta expiró; vuelve a pedirla"}), 404
        if job.get("status") == "error":
            return jsonify({"ok": False, "status": "error", "error": job.get("error") or "La IA no respondió"})
        if job.get("status") == "done":
            return jsonify({"ok": True, "status": "done", **(job.get("resultado") or {})})
        return jsonify({"ok": True, "status": job.get("status") or "pending", "progreso": job.get("progreso") or ""})
