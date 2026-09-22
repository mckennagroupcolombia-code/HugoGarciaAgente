"""API de Colaboradores (diagramas compartidos). Ver app/services/colaboradores.py."""

from __future__ import annotations

from functools import wraps

from flask import g, jsonify, request, send_file


def _usuario():
    from app.api_auth import bearer_token_from_request
    from app.services.tickets_db import aplicar_privilegios_admin_cynthia, get_usuario_by_token

    try:
        tok = (request.headers.get("X-Tickets-Token") or "").strip() or bearer_token_from_request()
        return aplicar_privilegios_admin_cynthia(get_usuario_by_token(tok)) if tok else None
    except Exception:
        return None


def _miembro(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        from app.services import colaboradores as col

        u = _usuario()
        if not u:
            return jsonify({"error": "No autorizado"}), 401
        if not col.es_miembro(u):
            return jsonify({"error": "Colaboradores es un espacio entre Armando y sus colaboradores."}), 403
        g.colab_usuario = u
        return f(*args, **kwargs)

    return wrapper


def _suyo(f):
    """El diagrama pedido tiene que ser de la pareja de quien lo pide.

    Sin esto, `colaborador_externo` era la llave de TODO el espacio: un segundo
    colaborador abriría los diagramas del primero con solo cambiar el id.
    """
    @wraps(f)
    def wrapper(did: int, *args, **kwargs):
        from app.services import colaboradores as col

        if not col.puede_ver(did, g.colab_usuario):
            return jsonify({"error": "No encontrado"}), 404
        return f(did, *args, **kwargs)

    return wrapper


def register_colaboradores_routes(app):
    from app.services import colaboradores as col

    @app.route("/api/colaboradores/diagramas", methods=["GET"])
    @app.route("/app/api/colaboradores/diagramas", methods=["GET"])
    @_miembro
    def colab_listar():
        return jsonify({"diagramas": col.listar(g.colab_usuario, request.args.get("archivados") == "1"),
                        "yo": {"id": g.colab_usuario.get("id"), "nombre": g.colab_usuario.get("nombre")},
                        "carriles": col.CARRILES, "tipos": {k: v[1] for k, v in col.TIPOS.items()}})

    @app.route("/api/colaboradores/diagramas", methods=["POST"])
    @app.route("/app/api/colaboradores/diagramas", methods=["POST"])
    @_miembro
    def colab_crear():
        d = request.get_json(silent=True) or {}
        try:
            return jsonify(col.crear(d.get("titulo") or "", int(g.colab_usuario["id"]),
                                     d.get("descripcion") or "", d.get("doc"),
                                     d.get("colaborador_id"))), 201
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    @app.route("/api/colaboradores/diagramas/<int:did>", methods=["GET"])
    @app.route("/app/api/colaboradores/diagramas/<int:did>", methods=["GET"])
    @_miembro
    def colab_obtener(did: int):
        d = col.obtener(did, g.colab_usuario)
        return (jsonify(d), 200) if d else (jsonify({"error": "No encontrado"}), 404)

    @app.route("/api/colaboradores/diagramas/<int:did>", methods=["PUT"])
    @app.route("/app/api/colaboradores/diagramas/<int:did>", methods=["PUT"])
    @_miembro
    @_suyo
    def colab_guardar(did: int):
        d = request.get_json(silent=True) or {}
        try:
            return jsonify(col.guardar(did, d.get("doc") or {}, int(d.get("version") or 0),
                                       int(g.colab_usuario["id"]), titulo=d.get("titulo"),
                                       descripcion=d.get("descripcion"), resumen=d.get("resumen") or ""))
        except col.Conflicto as c:
            return jsonify({"error": "conflicto", "mensaje": str(c), "actual": c.actual}), 409
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    @app.route("/api/colaboradores/diagramas/<int:did>/versiones", methods=["GET"])
    @app.route("/app/api/colaboradores/diagramas/<int:did>/versiones", methods=["GET"])
    @_miembro
    @_suyo
    def colab_versiones(did: int):
        return jsonify({"versiones": col.versiones(did)})

    @app.route("/api/colaboradores/diagramas/<int:did>/restaurar", methods=["POST"])
    @app.route("/app/api/colaboradores/diagramas/<int:did>/restaurar", methods=["POST"])
    @_miembro
    @_suyo
    def colab_restaurar(did: int):
        d = request.get_json(silent=True) or {}
        try:
            return jsonify(col.restaurar(did, int(d.get("a_version") or 0), int(d.get("version") or 0),
                                         int(g.colab_usuario["id"])))
        except col.Conflicto as c:
            return jsonify({"error": "conflicto", "mensaje": str(c), "actual": c.actual}), 409
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    @app.route("/api/colaboradores/diagramas/<int:did>/archivar", methods=["POST"])
    @app.route("/app/api/colaboradores/diagramas/<int:did>/archivar", methods=["POST"])
    @_miembro
    @_suyo
    def colab_archivar(did: int):
        d = request.get_json(silent=True) or {}
        return jsonify(col.archivar(did, bool(d.get("archivado", True))))

    @app.route("/api/colaboradores/diagramas/<int:did>/archify", methods=["POST"])
    @app.route("/app/api/colaboradores/diagramas/<int:did>/archify", methods=["POST"])
    @_miembro
    @_suyo
    def colab_exportar(did: int):
        try:
            return jsonify(col.exportar_archify(did))
        except (ValueError, RuntimeError) as e:
            return jsonify({"error": str(e)}), 400

    @app.route("/api/colaboradores/diagramas/<int:did>/archify/<int:version>", methods=["GET"])
    @app.route("/app/api/colaboradores/diagramas/<int:did>/archify/<int:version>", methods=["GET"])
    @_miembro
    @_suyo
    def colab_archify_html(did: int, version: int):
        p = col.ruta_export(did, version)
        if not p:
            return jsonify({"error": "Esa versión no se ha exportado a Archify"}), 404
        return send_file(str(p), mimetype="text/html")
