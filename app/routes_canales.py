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

_EXT_ADJUNTO = {"pdf", "png", "jpg", "jpeg", "gif", "webp", "heic", "doc", "docx", "xls", "xlsx", "txt", "csv",
                # notas de voz: WebM/Opus (Chrome, Android), M4A (Safari, iPhone), OGG (WhatsApp)
                "webm", "ogg", "oga", "opus", "mp3", "m4a", "aac", "wav"}
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
        from app.services.canales_vinculos import catalogo, tipos_solicitud

        return jsonify({
            "tipos_solicitud": tipos_solicitud(),
            "canales": CI.listar_canales(u, incluir_archivados=request.args.get("archivados") == "1"),
            "puede_administrar": admin,
            "modulos": catalogo(),
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
                espejo_salida=bool(d.get("espejo_salida")), modulo=d.get("modulo") or "",
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
                                        ("nombre", "descripcion", "espejo_salida", "archivado", "wa_jid", "miembros", "modulo") if k in d})
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

    @app.route("/api/canales/vinculos", methods=["GET"])
    @_auth
    def canales_vinculos_buscar():
        """Elementos de un módulo para vincular en un mensaje (según los permisos del panel)."""
        from app.services.canales_vinculos import buscar

        try:
            items = buscar(request.args.get("modulo") or "", request.args.get("q") or "", _u())
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except PermissionError as e:
            return jsonify({"error": str(e), "items": []}), 403
        return jsonify({"items": items})

    @app.route("/api/canales/<int:canal_id>/mensajes", methods=["POST"])
    @_auth
    def canales_enviar(canal_id: int):
        import json as _json

        from app.services.canales_vinculos import normalizar_ref

        u = _u()
        adjunto = None
        ref_raw = None
        if request.files:
            f = request.files.get("archivo")
            texto = request.form.get("texto") or ""
            responde_raw = request.form.get("responde_a")
            try:
                ref_raw = _json.loads(request.form.get("ref") or "null")
            except ValueError:
                ref_raw = None
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
            cuerpo = request.get_json(silent=True) or {}
            texto = cuerpo.get("texto") or ""
            ref_raw = cuerpo.get("ref")
            responde_raw = cuerpo.get("responde_a")
        try:
            responde_a = int(responde_raw) if responde_raw not in (None, "", "null") else None
        except (TypeError, ValueError):
            responde_a = None
        try:
            msg = CI.enviar_mensaje(canal_id, u, texto, adjunto=adjunto, ref=normalizar_ref(ref_raw),
                                    responde_a=responde_a)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except PermissionError as e:
            return jsonify({"error": str(e)}), 403
        except LookupError as e:
            return jsonify({"error": str(e)}), 404
        return jsonify(msg), 201

    @app.route("/api/canales/novedades", methods=["GET"])
    @_auth
    def canales_novedades():
        """Mensajes nuevos de otros (para el aviso con la app abierta)."""
        from app.services.canales_avisos import novedades

        return jsonify(novedades(_u(), int(request.args.get("desde") or 0), inicio=request.args.get("inicio") == "1"))

    @app.route("/api/canales/push", methods=["POST"])
    @_auth
    def canales_push_registrar():
        """Este dispositivo quiere avisos de los grupos con la app cerrada (Web Push)."""
        from app.services.canales_avisos import registrar_suscripcion

        try:
            registrar_suscripcion(int(_u()["id"]), (request.get_json(silent=True) or {}).get("subscription") or {})
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        return jsonify({"ok": True})

    @app.route("/api/canales/<int:canal_id>/solicitudes", methods=["GET"])
    @_auth
    def canales_solicitudes(canal_id: int):
        items = CI.listar_solicitudes(canal_id, _u())
        if items is None:
            return jsonify({"error": "Canal no encontrado"}), 404
        return jsonify({"solicitudes": items})

    @app.route("/api/canales/<int:canal_id>/solicitudes", methods=["POST"])
    @_auth
    def canales_vincular_solicitud(canal_id: int):
        """La solicitud ya se creó con POST /api/tickets/ (avisos de siempre); aquí queda en el grupo."""
        d = request.get_json(silent=True) or {}
        try:
            out = CI.vincular_solicitud(
                canal_id, _u(), int(d.get("ticket_id") or 0),
                mensaje_id=int(d["mensaje_id"]) if d.get("mensaje_id") else None,
                fecha_limite=d.get("fecha_limite") or "",
                tipo=str(d.get("tipo") or ""), ref=d.get("ref"),
            )
        except (LookupError, ValueError) as e:
            return jsonify({"error": str(e)}), 404
        return jsonify(out), 201

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
