"""
Grabaciones de pantalla — /api/grabaciones/* y alias /app/api/...

Panel Supervisor → «Grabar pantalla». Lógica en app/tools/grabacion_pantalla.py.
El envío de clips va por el bridge supervisor (:3001 /enviar-video), el mismo
que manda la nota de voz TTS. Ningún endpoint llama a un LLM.

Autorización: la misma que /api/supervisor/bridge/enviar-voz (CHAT_API_TOKEN o
sesión válida del panel). Los archivos de video (<video src>) no llevan Bearer:
el id aleatorio de la grabación hace de token de capacidad, igual que
/api/contenido/video/<job_id>.
"""

from __future__ import annotations

import os
from functools import wraps

from flask import g, jsonify, request, send_file


def _auth(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        from app.api_auth import bearer_token_from_request, chat_api_token_matches_request
        from app.services.tickets_db import get_usuario_by_token

        usuario = None
        try:
            xt = (request.headers.get("X-Tickets-Token") or "").strip()
            if xt:
                usuario = get_usuario_by_token(xt)
            if not usuario and not chat_api_token_matches_request():
                tok = bearer_token_from_request()
                usuario = get_usuario_by_token(tok) if tok else None
        except Exception:
            usuario = None
        if not usuario and not chat_api_token_matches_request():
            return jsonify({"error": "No autorizado"}), 401
        g.grabaciones_usuario = (usuario or {}).get("username") or "sistema"
        return f(*args, **kwargs)

    return wrapper


def _dual(app, rule: str, **opts):
    def deco(f):
        app.add_url_rule(rule, endpoint=f.__name__, view_func=f, **opts)
        app.add_url_rule("/app" + rule, endpoint=f.__name__ + "_app", view_func=f, **opts)
        return f

    return deco


def _supervisor_post(path: str, body: dict, timeout: int):
    import requests

    base = os.getenv("SUPERVISOR_BRIDGE_URL", "").strip().rstrip("/") or (
        f"http://127.0.0.1:{os.getenv('SUPERVISOR_PORT', '3001')}"
    )
    tok = os.getenv("WHATSAPP_SUPERVISOR_TOKEN", "").strip()
    headers = {"X-Bridge-Token": tok} if tok else {}
    return requests.post(f"{base}{path}", json=body, headers=headers, timeout=timeout)


def register_grabaciones_routes(app):
    from app.tools import grabacion_pantalla as G

    def _err(e: Exception):
        if isinstance(e, G.GrabacionError):
            return jsonify({"error": str(e)}), 400
        return jsonify({"error": f"Error interno: {e}"}), 500

    @_dual(app, "/api/grabaciones", methods=["GET"])
    @_auth
    def grab_listar():
        return jsonify({"grabaciones": G.listar_grabaciones()})

    @_dual(app, "/api/grabaciones", methods=["POST"])
    @_auth
    def grab_crear():
        data = request.get_json(silent=True) or {}
        try:
            return jsonify(G.crear_grabacion(data.get("titulo") or "", g.grabaciones_usuario, data.get("recorte"))), 201
        except Exception as e:
            return _err(e)

    @_dual(app, "/api/grabaciones/<gid>", methods=["GET"])
    @_auth
    def grab_obtener(gid: str):
        try:
            return jsonify(G.obtener_grabacion(gid))
        except Exception as e:
            return _err(e)

    @_dual(app, "/api/grabaciones/<gid>", methods=["PATCH"])
    @_auth
    def grab_actualizar(gid: str):
        data = request.get_json(silent=True) or {}
        try:
            return jsonify(G.actualizar_grabacion(
                gid,
                titulo=data.get("titulo"),
                recorte=data["recorte"] if "recorte" in data else "__sin_cambio__",
            ))
        except Exception as e:
            return _err(e)

    @_dual(app, "/api/grabaciones/<gid>", methods=["DELETE"])
    @_auth
    def grab_eliminar(gid: str):
        try:
            G.eliminar_grabacion(gid)
            return jsonify({"ok": True})
        except Exception as e:
            return _err(e)

    @_dual(app, "/api/grabaciones/<gid>/trozo", methods=["POST"])
    @_auth
    def grab_trozo(gid: str):
        archivo = request.files.get("trozo")
        try:
            seq = int(request.form.get("seq", ""))
        except ValueError:
            return jsonify({"error": "seq requerido"}), 400
        if not archivo:
            return jsonify({"error": "Falta el campo multipart «trozo»"}), 400
        try:
            meta = G.agregar_trozo(gid, seq, archivo.read())
            return jsonify({"ok": True, "trozos": meta["trozos"], "bytes": meta["bytes"]})
        except Exception as e:
            return _err(e)

    @_dual(app, "/api/grabaciones/<gid>/finalizar", methods=["POST"])
    @_auth
    def grab_finalizar(gid: str):
        try:
            return jsonify(G.finalizar_grabacion(gid))
        except Exception as e:
            return _err(e)

    @_dual(app, "/api/grabaciones/<gid>/clips", methods=["POST"])
    @_auth
    def grab_clip_crear(gid: str):
        data = request.get_json(silent=True) or {}
        try:
            clip = G.crear_clip(
                gid,
                data.get("inicio"),
                data.get("fin"),
                data.get("nombre") or "",
                recorte=data["recorte"] if "recorte" in data else "__grabacion__",
            )
            return jsonify(clip), 202
        except Exception as e:
            return _err(e)

    @_dual(app, "/api/grabaciones/<gid>/clips/<cid>", methods=["DELETE"])
    @_auth
    def grab_clip_eliminar(gid: str, cid: str):
        try:
            G.eliminar_clip(gid, cid)
            return jsonify({"ok": True})
        except Exception as e:
            return _err(e)

    @_dual(app, "/api/grabaciones/<gid>/clips/<cid>/enviar", methods=["POST"])
    @_auth
    def grab_clip_enviar(gid: str, cid: str):
        data = request.get_json(silent=True) or {}
        numero = (data.get("numero") or "").strip()
        caption = (data.get("mensaje") or "").strip()[:1000]
        if not numero:
            return jsonify({"error": "numero requerido"}), 400
        ruta = G.ruta_clip(gid, cid)
        if not ruta:
            return jsonify({"error": "El clip no existe o aún se está procesando"}), 404

        from app.services.wa_jid import jid_preferido_para_envio
        numero = jid_preferido_para_envio(numero)
        try:
            r = _supervisor_post(
                "/enviar-video",
                {"numero": numero, "filePath": str(ruta), "caption": caption,
                 "fileName": f"clip_{cid}.mp4"},
                timeout=120,
            )
        except Exception as e:
            return jsonify({"error": f"Bridge supervisor no disponible: {e}"}), 503
        if r.status_code == 200:
            G.registrar_envio(gid, cid, numero)
            return jsonify({"status": "enviado", "numero": numero})
        try:
            err = r.json().get("error") or f"Error HTTP {r.status_code} del bridge"
        except Exception:
            err = f"Error HTTP {r.status_code} del bridge"
        if r.status_code == 404:
            err = "El bridge supervisor no tiene /enviar-video (proceso viejo). Reinícialo."
        code = r.status_code if r.status_code in (400, 401, 422, 503) else 502
        return jsonify({"error": err}), code

    # ── Archivos (sin Bearer: el id aleatorio es el token de capacidad) ─────

    @_dual(app, "/api/grabaciones/<gid>/video", methods=["GET"])
    def grab_video(gid: str):
        ruta = G.ruta_video(gid)
        if not ruta:
            return jsonify({"error": "No encontrado"}), 404
        return send_file(ruta, mimetype="video/webm", conditional=True)

    @_dual(app, "/api/grabaciones/<gid>/clips/<cid>/archivo", methods=["GET"])
    def grab_clip_archivo(gid: str, cid: str):
        ruta = G.ruta_clip(gid, cid)
        if not ruta:
            return jsonify({"error": "No encontrado"}), 404
        descargar = request.args.get("descargar") == "1"
        return send_file(
            ruta, mimetype="video/mp4", conditional=True,
            as_attachment=descargar, download_name=f"clip_{cid}.mp4",
        )
