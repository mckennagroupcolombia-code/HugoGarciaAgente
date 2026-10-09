"""
Revisión global de pesos, medidas y empaques — /api/revision-empaque/*.
Lógica en app/services/revision_empaque.py. Sin LLM.

Ver y diligenciar: el asignado de la revisión, quien la creó y los administradores.
Refrescar MeLi y aplicar: solo quien la creó o un administrador (`puede_aprobar`).

/api/revision-empaque/sku/<sku>/*: la pieza «Envío» de un combo en el Árbol del producto.
Las abre el mismo permiso del árbol (`routes_mapa_sistema._auth_studio`): quien diseña el
producto también lo pesa y lo mide. Aplicar en MeLi sigue siendo de `puede_aprobar`.
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

    def _por_sku(fn, *args):
        """Como `_responder`, pero con el permiso del Árbol del producto."""
        from app.routes_mapa_sistema import _usuario_puede
        from app.services.tickets_db import puede_ver_etiquetas_avanzado

        if not (_usuario_puede(_u()) or puede_ver_etiquetas_avanzado(_u())):
            return jsonify({"error": "Pesar y medir desde el árbol requiere el Studio visual o el taller de combos"}), 403
        return _responder(fn, *args)

    @app.route("/api/revision-empaque/sku/<sku>", methods=["GET"])
    @_auth
    def revision_empaque_sku(sku: str):
        return _por_sku(R.producto_arbol, sku, _u())

    @app.route("/api/revision-empaque/sku/<sku>/incluir", methods=["POST"])
    @_auth
    def revision_empaque_sku_incluir(sku: str):
        return _por_sku(R.incluir_sku, sku, _u())

    @app.route("/api/revision-empaque/sku/<sku>/producto", methods=["POST"])
    @_auth
    def revision_empaque_sku_producto(sku: str):
        return _por_sku(R.guardar_producto_arbol, sku, request.get_json(silent=True) or {}, _u())

    @app.route("/api/revision-empaque/sku/<sku>/medidas", methods=["POST"])
    @_auth
    def revision_empaque_sku_medidas(sku: str):
        return _por_sku(R.guardar_medidas_propias_arbol, sku, request.get_json(silent=True) or {}, _u())

    @app.route("/api/revision-empaque/sku/<sku>/grupo", methods=["POST"])
    @_auth
    def revision_empaque_sku_grupo(sku: str):
        return _por_sku(R.guardar_grupo_arbol, sku, request.get_json(silent=True) or {}, _u())

    @app.route("/api/revision-empaque/sku/<sku>/meli/releer", methods=["POST"])
    @_auth
    def revision_empaque_sku_releer(sku: str):
        return _por_sku(R.releer_meli_arbol, sku, _u())

    @app.route("/api/revision-empaque/sku/<sku>/meli/aplicar", methods=["POST"])
    @_auth
    def revision_empaque_sku_aplicar(sku: str):
        return _por_sku(R.aplicar_meli_arbol, sku, _u())

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
