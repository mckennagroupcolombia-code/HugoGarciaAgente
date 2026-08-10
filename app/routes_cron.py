"""
Tareas Programadas — panel Sistemas (/app) para controlar la frecuencia de los
crons de la app sin tocar el crontab del sistema (ver app/services/cron_scheduler.py
para el mecanismo de auto-límite).

Endpoints bajo /api/cron/*. Acceso: solo administrador (es_admin_efectivo) —
controla cuándo corren jobs de compliance/auditoría/costos, no se abre a
permisos de sección todavía.
"""

from __future__ import annotations

from functools import wraps

from flask import jsonify, request


def _auth_cron(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        from app.api_auth import bearer_token_from_request, chat_api_token_matches_request

        if chat_api_token_matches_request():
            request.cron_usuario = {"nombre": "Administrador (token)", "rol": {"nivel": 3}}
            return f(*args, **kwargs)
        token = bearer_token_from_request()
        if not token:
            return jsonify({"error": "No autorizado"}), 401
        try:
            from app.services.tickets_db import (
                aplicar_privilegios_admin_cynthia,
                es_admin_efectivo,
                get_usuario_by_token,
            )
            usuario = aplicar_privilegios_admin_cynthia(get_usuario_by_token(token))
        except Exception:
            usuario = None
        if not usuario:
            return jsonify({"error": "Sesión inválida o expirada"}), 401
        if not es_admin_efectivo(usuario):
            return jsonify({"error": "Tareas Programadas requiere rol administrador"}), 403
        request.cron_usuario = usuario
        return f(*args, **kwargs)

    return wrapper


def register_cron_routes(app):
    @app.route("/api/cron/tareas", methods=["GET"])
    @_auth_cron
    def cron_listar_tareas():
        from app.services.cron_scheduler import listar_tareas
        return jsonify({"tareas": listar_tareas()})

    @app.route("/api/cron/tareas/<job_id>/frecuencia", methods=["POST"])
    @_auth_cron
    def cron_establecer_frecuencia(job_id: str):
        from app.services.cron_scheduler import establecer_frecuencia

        body = request.get_json(silent=True) or {}
        try:
            intervalo_horas = float(body.get("intervalo_horas"))
        except (TypeError, ValueError):
            return jsonify({"error": "intervalo_horas debe ser numérico"}), 400

        ok, err = establecer_frecuencia(job_id, intervalo_horas)
        if not ok:
            return jsonify({"error": err}), 400
        return jsonify({"ok": True})
