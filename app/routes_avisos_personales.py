"""Avisos personales — /api/avisos-personales/*. Lógica en app/services/avisos_personales.py.

Cada persona solo ve y marca sus propios avisos (sesión de tickets, igual que Grupos)."""

from __future__ import annotations

from flask import jsonify, request

from app.routes_canales import _auth


def register_avisos_personales_routes(app):
    from app.services import avisos_personales as A

    @app.route("/api/avisos-personales/pendientes", methods=["GET"])
    @_auth
    def avisos_personales_pendientes():
        return jsonify({"avisos": A.pendientes(request.tickets_usuario["id"])})

    @app.route("/api/avisos-personales/<aviso_id>/visto", methods=["POST"])
    @_auth
    def avisos_personales_visto(aviso_id):
        if not A.marcar_visto(aviso_id, request.tickets_usuario["id"]):
            return jsonify({"error": "No existe"}), 404
        return jsonify({"ok": True})
