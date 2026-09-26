"""
Canales internos del panel — /api/canales/* y el resumen de la campana /api/mensajes/resumen.

Lógica en app/services/canales_internos.py (y notificaciones_panel.py). Autenticación
por sesión de tickets (Bearer o ?token= para imágenes), como el resto de la Agenda.
Sin LLM.
"""

from __future__ import annotations

import os
import uuid

from flask import jsonify, request, send_file, send_from_directory
from werkzeug.utils import secure_filename

_EXT_ADJUNTO = {"pdf", "png", "jpg", "jpeg", "gif", "webp", "heic", "doc", "docx", "xls", "xlsx", "txt", "csv"}
_MAX_ADJUNTO = 15 * 1024 * 1024


def _auth(f):
    """Sesión de la persona: el panel manda el token de API como Bearer y la sesión en
    `X-Tickets-Token` (api/client.ts); las imágenes llegan con `?token=`. Aquí importa
    QUIÉN escribe, así que el token de API solo no basta."""
    from functools import wraps

    @wraps(f)
    def wrapper(*args, **kwargs):
        from app.api_auth import bearer_token_from_request
        from app.services.tickets_db import aplicar_privilegios_admin_cynthia, get_usuario_by_token

        usuario = None
        for tok in (
            (request.headers.get("X-Tickets-Token") or "").strip(),
            (request.args.get("token") or "").strip(),
            (bearer_token_from_request() or "").strip(),
        ):
            if tok:
                usuario = get_usuario_by_token(tok)
                if usuario:
                    break
        if not usuario:
            return jsonify({"error": "Sesión inválida o expirada"}), 401
        request.tickets_usuario = aplicar_privilegios_admin_cynthia(usuario)  # type: ignore[attr-defined]
        return f(*args, **kwargs)

    return wrapper


def register_canales_routes(app):
    from app.services import canales_internos as CI

    os.makedirs(CI.UPLOADS_DIR, exist_ok=True)

    def _u() -> dict:
        return request.tickets_usuario  # type: ignore[attr-defined]

    @app.route("/api/canales", methods=["GET"])
    @_auth
    def canales_listar():
        u = _u()
        admin = CI.puede_administrar(u)
        return jsonify({
            "canales": CI.listar_canales(u, incluir_archivados=request.args.get("archivados") == "1"),
            "puede_administrar": admin,
            "grupos_wa": CI.grupos_oficiales() if admin else [],
        })

    @app.route("/api/canales", methods=["POST"])
    @_auth
    def canales_crear():
        u = _u()
        if not CI.puede_administrar(u):
            return jsonify({"error": "Crear canales es de supervisión o administración"}), 403
        d = request.get_json(silent=True) or {}
        try:
            canal = CI.crear_canal(
                u, d.get("nombre") or "", descripcion=d.get("descripcion") or "",
                miembros=d.get("miembros") or [], wa_jid=d.get("wa_jid") or "",
                espejo_salida=bool(d.get("espejo_salida")),
            )
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        return jsonify(canal), 201

    @app.route("/api/canales/<int:canal_id>", methods=["PATCH"])
    @_auth
    def canales_actualizar(canal_id: int):
        u = _u()
        if not CI.puede_administrar(u):
            return jsonify({"error": "Editar canales es de supervisión o administración"}), 403
        d = request.get_json(silent=True) or {}
        try:
            canal = CI.actualizar_canal(canal_id, u, **{k: d.get(k) for k in
                                        ("nombre", "descripcion", "espejo_salida", "archivado", "wa_jid", "miembros") if k in d})
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        if not canal:
            return jsonify({"error": "Canal no encontrado"}), 404
        return jsonify(canal)

    @app.route("/api/canales/<int:canal_id>/mensajes", methods=["GET"])
    @_auth
    def canales_mensajes(canal_id: int):
        msgs = CI.listar_mensajes(
            canal_id, _u(),
            despues_de=int(request.args.get("despues_de") or 0),
            antes_de=int(request.args.get("antes_de") or 0),
            limite=int(request.args.get("limite") or 80),
        )
        if msgs is None:
            return jsonify({"error": "Canal no encontrado"}), 404
        return jsonify({"mensajes": msgs})

    @app.route("/api/canales/<int:canal_id>/mensajes", methods=["POST"])
    @_auth
    def canales_enviar(canal_id: int):
        u = _u()
        adjunto = None
        if request.files:
            f = request.files.get("archivo")
            texto = request.form.get("texto") or ""
            if f and f.filename:
                ext = f.filename.rsplit(".", 1)[-1].lower() if "." in f.filename else ""
                if ext not in _EXT_ADJUNTO:
                    return jsonify({"error": "Tipo de archivo no permitido"}), 400
                f.stream.seek(0, os.SEEK_END)
                if f.stream.tell() > _MAX_ADJUNTO:
                    return jsonify({"error": "El archivo supera 15 MB"}), 400
                f.stream.seek(0)
                archivo = f"{uuid.uuid4().hex}.{ext}"
                f.save(os.path.join(CI.UPLOADS_DIR, archivo))
                adjunto = {"archivo": archivo, "nombre": f.filename[:160], "mime": f.content_type or ""}
        else:
            texto = (request.get_json(silent=True) or {}).get("texto") or ""
        try:
            msg = CI.enviar_mensaje(canal_id, u, texto, adjunto=adjunto)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except PermissionError as e:
            return jsonify({"error": str(e)}), 403
        except LookupError as e:
            return jsonify({"error": str(e)}), 404
        return jsonify(msg), 201

    @app.route("/api/canales/<int:canal_id>/leido", methods=["POST"])
    @_auth
    def canales_leido(canal_id: int):
        CI.marcar_leido(canal_id, _u())
        return jsonify({"ok": True})

    @app.route("/api/canales/mensajes/<int:mensaje_id>", methods=["DELETE"])
    @_auth
    def canales_eliminar_mensaje(mensaje_id: int):
        if not CI.eliminar_mensaje(mensaje_id, _u()):
            return jsonify({"error": "No se puede eliminar ese mensaje"}), 403
        return jsonify({"ok": True})

    @app.route("/api/canales/uploads/<filename>", methods=["GET"])
    @_auth
    def canales_archivo(filename: str):
        return send_from_directory(os.path.abspath(CI.UPLOADS_DIR), secure_filename(filename))

    @app.route("/api/canales/media-wa/<int:mensaje_id>", methods=["GET"])
    @_auth
    def canales_media_wa(mensaje_id: int):
        """Foto que llegó por el grupo de WhatsApp enlazado (vive en comprobantes/)."""
        ruta = CI.media_wa_de_mensaje(mensaje_id, _u())
        if not ruta:
            return jsonify({"error": "Archivo no encontrado"}), 404
        return send_file(ruta, conditional=True)

    # ── Campana: notificaciones del panel ─────────────────────────────────────
    @app.route("/api/notificaciones", methods=["GET"])
    @_auth
    def notificaciones_listar():
        from app.services import notificaciones_panel as NP

        uid = int(_u()["id"])
        return jsonify({
            "notificaciones": NP.listar(uid, solo_no_leidas=request.args.get("no_leidas") == "1"),
            "no_leidas": NP.contar_no_leidas(uid),
            "preferencia": NP.preferencia(uid),
        })

    @app.route("/api/notificaciones/leidas", methods=["POST"])
    @_auth
    def notificaciones_leidas():
        from app.services import notificaciones_panel as NP

        ids = (request.get_json(silent=True) or {}).get("ids") or None
        return jsonify({"marcadas": NP.marcar_leidas(int(_u()["id"]), ids)})

    @app.route("/api/notificaciones/preferencia", methods=["PUT"])
    @_auth
    def notificaciones_preferencia():
        from app.services import notificaciones_panel as NP

        pref = str((request.get_json(silent=True) or {}).get("preferencia") or "")
        try:
            return jsonify({"preferencia": NP.fijar_preferencia(int(_u()["id"]), pref)})
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    @app.route("/api/mensajes/resumen", methods=["GET"])
    @_auth
    def mensajes_resumen():
        """Lo que pinta la campana: una sola consulta barata cada pocos segundos."""
        u = _u()
        out = {"canales_no_leidos": 0, "notificaciones_no_leidas": 0}
        try:
            out["canales_no_leidos"] = CI.no_leidos_total(u)
        except Exception:
            pass
        try:
            from app.services import notificaciones_panel as NP

            out["notificaciones_no_leidas"] = NP.contar_no_leidas(int(u["id"]))
        except Exception:
            pass
        return jsonify(out)
