"""
Revisión global de pesos, medidas y empaques — /api/revision-empaque/*.
Lógica en app/services/revision_empaque.py. Sin LLM.

Ver y diligenciar: el asignado de la revisión, quien la creó y los administradores.
Refrescar MeLi y aplicar: solo quien la creó o un administrador (`puede_aprobar`).
"""

from __future__ import annotations

from flask import jsonify, request

from app.routes_canales import _auth


def register_revision_empaque_routes(app):
    from app.services import revision_empaque as R

    def _u():
        return request.tickets_usuario  # type: ignore[attr-defined]

    def _responder(fn, *args):
        try:
            return jsonify(fn(*args))
        except PermissionError as e:
            return jsonify({"error": str(e)}), 403
        except LookupError as e:
            return jsonify({"error": str(e)}), 404
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except RuntimeError as e:
            return jsonify({"error": str(e)}), 502

    @app.route("/api/revision-empaque/por-ticket/<int:ticket_id>", methods=["GET"])
    @_auth
    def revision_empaque_por_ticket(ticket_id: int):
        rid = R.revision_de_ticket(ticket_id)
        if not rid:
            return jsonify({"error": "Esta solicitud no tiene revisión"}), 404
        return _responder(R.estado, rid, _u())

    @app.route("/api/revision-empaque/<int:rid>", methods=["GET"])
    @_auth
    def revision_empaque_estado(rid: int):
        return _responder(R.estado, rid, _u())

    @app.route("/api/revision-empaque/<int:rid>/producto/<path:sku>", methods=["POST"])
    @_auth
    def revision_empaque_producto(rid: int, sku: str):
        return _responder(R.guardar_producto, rid, sku, request.get_json(silent=True) or {}, _u())

    @app.route("/api/revision-empaque/<int:rid>/grupo", methods=["POST"])
    @_auth
    def revision_empaque_grupo(rid: int):
        d = request.get_json(silent=True) or {}
        return _responder(R.guardar_grupo, rid, str(d.get("clave") or ""), d, _u())

    @app.route("/api/revision-empaque/<int:rid>/entregar", methods=["POST"])
    @_auth
    def revision_empaque_entregar(rid: int):
        return _responder(R.entregar, rid, _u())

    @app.route("/api/revision-empaque/<int:rid>/meli/refrescar", methods=["POST"])
    @_auth
    def revision_empaque_refrescar(rid: int):
        return _responder(R.refrescar_meli, rid, _u())

    @app.route("/api/revision-empaque/<int:rid>/meli/aplicar", methods=["POST"])
    @_auth
    def revision_empaque_aplicar(rid: int):
        d = request.get_json(silent=True) or {}
        skus = [str(s) for s in (d.get("skus") or []) if str(s).strip()]
        return _responder(R.aplicar_meli, rid, skus, _u())
