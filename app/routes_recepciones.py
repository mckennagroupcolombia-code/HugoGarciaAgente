"""
Recepción de mercancía — /api/recepciones/*. Lógica en app/services/recepcion_mercancia.py.

Permiso: administrador, o `recepcion-mercancia` / `pedidos` / `empaque` /
`control-inventario` / `stock` (lo mismo que dice panelAccess.ts). Sin LLM.
"""

from __future__ import annotations

import os
import uuid
from functools import wraps

from flask import jsonify, request, send_from_directory
from werkzeug.utils import secure_filename

from app.routes_canales import _auth

_PERMISOS = ("recepcion-mercancia", "pedidos", "empaque", "control-inventario", "stock")
_EXT_FOTO = {"png", "jpg", "jpeg", "gif", "webp", "heic", "pdf"}
_MAX_FOTO = 15 * 1024 * 1024


def _puede(usuario: dict | None) -> bool:
    if not usuario:
        return False
    try:
        from app.services.tickets_db import es_admin_efectivo

        if es_admin_efectivo(usuario):
            return True
    except Exception:
        pass
    permisos = usuario.get("permisos_secciones")
    if not permisos:  # sin mapa de permisos: mismo criterio que el panel
        return True
    return any(permisos.get(p) for p in _PERMISOS)


def _permiso(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if not _puede(getattr(request, "tickets_usuario", None)):
            return jsonify({"error": "Sin permiso para recepción de mercancía"}), 403
        return f(*args, **kwargs)

    return wrapper


def register_recepciones_routes(app):
    from app.services import recepcion_mercancia as R

    os.makedirs(R.UPLOADS_DIR, exist_ok=True)

    def _u():
        return request.tickets_usuario  # type: ignore[attr-defined]

    def _resp(fn, *a, **kw):
        try:
            return jsonify(fn(*a, **kw))
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except LookupError as e:
            return jsonify({"error": str(e)}), 404

    @app.route("/api/recepciones", methods=["GET"])
    @_auth
    @_permiso
    def recepciones_listar():
        return jsonify({"recepciones": R.listar(estado=request.args.get("estado") or None)})

    @app.route("/api/recepciones/compras-por-recibir", methods=["GET"])
    @_auth
    @_permiso
    def recepciones_compras():
        return jsonify({"compras": R.compras_por_recibir()})

    @app.route("/api/recepciones", methods=["POST"])
    @_auth
    @_permiso
    def recepciones_crear():
        d = request.get_json(silent=True) or {}
        sid = d.get("solicitud_pago_id")
        return _resp(R.crear, _u(), proveedor=d.get("proveedor") or "", referencia=d.get("referencia") or "",
                     notas=d.get("notas") or "", solicitud_pago_id=int(sid) if sid else None,
                     items=d.get("items") or [])

    @app.route("/api/recepciones/<int:rid>", methods=["GET"])
    @_auth
    @_permiso
    def recepciones_obtener(rid: int):
        r = R.obtener(rid)
        return (jsonify(r), 200) if r else (jsonify({"error": "Recepción no encontrada"}), 404)

    @app.route("/api/recepciones/<int:rid>/items", methods=["POST"])
    @_auth
    @_permiso
    def recepciones_item(rid: int):
        return _resp(R.agregar_item, rid, _u(), request.get_json(silent=True) or {})

    @app.route("/api/recepciones/<int:rid>/items/<int:item_id>", methods=["PATCH"])
    @_auth
    @_permiso
    def recepciones_contar(rid: int, item_id: int):
        d = request.get_json(silent=True) or {}
        return _resp(R.contar_item, rid, item_id, _u(), cantidad_recibida=d.get("cantidad_recibida"),
                     estado_item=d.get("estado_item"), observacion=d.get("observacion"))

    @app.route("/api/recepciones/<int:rid>/fotos", methods=["POST"])
    @_auth
    @_permiso
    def recepciones_foto(rid: int):
        f = request.files.get("foto")
        if not f or not f.filename:
            return jsonify({"error": "No llegó la foto"}), 400
        ext = f.filename.rsplit(".", 1)[-1].lower() if "." in f.filename else "jpg"
        if ext not in _EXT_FOTO:
            return jsonify({"error": "Formato no permitido"}), 400
        f.stream.seek(0, os.SEEK_END)
        if f.stream.tell() > _MAX_FOTO:
            return jsonify({"error": "La foto supera 15 MB"}), 400
        f.stream.seek(0)
        archivo = f"r{rid}_{uuid.uuid4().hex}.{ext}"
        f.save(os.path.join(R.UPLOADS_DIR, archivo))
        return _resp(R.agregar_foto, rid, _u(), archivo, f.filename)

    @app.route("/api/recepciones/fotos/<filename>", methods=["GET"])
    @_auth
    @_permiso
    def recepciones_ver_foto(filename: str):
        return send_from_directory(os.path.abspath(R.UPLOADS_DIR), secure_filename(filename))

    @app.route("/api/recepciones/<int:rid>/cerrar", methods=["POST"])
    @_auth
    @_permiso
    def recepciones_cerrar(rid: int):
        return _resp(R.cerrar, rid, _u(), (request.get_json(silent=True) or {}).get("notas") or "")

    @app.route("/api/recepciones/<int:rid>/anular", methods=["POST"])
    @_auth
    @_permiso
    def recepciones_anular(rid: int):
        return _resp(R.anular, rid, _u(), (request.get_json(silent=True) or {}).get("motivo") or "")
