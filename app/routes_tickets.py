import json
import os
import secrets
import time
import uuid
from functools import wraps
from pathlib import Path
from urllib.parse import urlencode
import requests as _requests
from flask import request, jsonify, send_from_directory, redirect
from werkzeug.utils import secure_filename

from app.services.tickets_db import (
    init_db, login_usuario, login_usuario_google, get_usuario_by_token, logout_usuario,
    listar_roles, crear_rol, actualizar_rol,
    listar_departamentos, crear_departamento, actualizar_departamento,
    listar_usuarios, crear_usuario, actualizar_usuario, desactivar_usuario,
    actualizar_foto_usuario, eliminar_foto_usuario,
    crear_ticket, listar_tickets, get_ticket, actualizar_ticket,
    cambiar_estado, asignar_ticket, agregar_comentario,
    renovar_ticket,
    registrar_tiempo, dashboard_carga, UPLOADS_DIR,
    crear_mision, listar_misiones, get_mision, actualizar_mision, lanzar_mision,
    eliminar_mision, eliminar_ticket,
    agregar_participante, quitar_participante,
    listar_categorias, crear_categoria, eliminar_categoria,
    renovar_mision,
    agregar_etapa_mision, actualizar_etapa_mision, eliminar_etapa_mision,
    reordenar_etapas_mision,
    listar_pasos, agregar_paso, actualizar_paso_notas, completar_paso, completar_paso_ticket,
    establecer_paso_completado,
    pasos_ticket_json,
    eliminar_paso, reordenar_pasos,
    listar_materiales, get_material, crear_material, actualizar_material, eliminar_materiales_catalogo,
    listar_zonas_trabajo, crear_zona_trabajo, actualizar_zona_trabajo, eliminar_zona_trabajo,
    listar_materiales_ticket, agregar_material_ticket, actualizar_material_ticket, eliminar_material_ticket,
    get_observaciones_materiales, set_observaciones_materiales,
    registrar_consumo, historial_consumo,
    listar_ordenes_compra, crear_orden_compra, actualizar_orden_compra,
    get_dependencias_mision, agregar_dependencia_mision, eliminar_dependencia_mision,
    set_producto_resultante,
)

_ALLOWED = {"pdf", "png", "jpg", "jpeg", "gif", "webp"}
_AVATAR_EXT = {"png", "jpg", "jpeg", "gif", "webp"}

_GRUPO_SEDE_SUR_WA = os.getenv("GRUPO_SEDE_SUR_WA", "120363023555909043@g.us")

_ESTADO_EMOJI = {
    "resuelto":   "✅",
    "en_proceso": "🔄",
    "pendiente":  "⏳",
    "rechazado":  "❌",
}


_GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
_GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"

# Estado OAuth en memoria: {state: expiry_epoch}
_oauth_states: dict[str, float] = {}
_OAUTH_STATE_TTL = 300  # 5 minutos


def _panel_redirect_uri() -> str:
    explicit = (os.getenv("PANEL_GOOGLE_REDIRECT_URI") or "").strip()
    if explicit:
        return explicit
    return "https://bot.mckennagroup.co/app/auth/callback"


def _google_oauth_configured() -> bool:
    return bool(
        (os.getenv("GOOGLE_OAUTH_CLIENT_ID") or "").strip()
        and (os.getenv("GOOGLE_OAUTH_CLIENT_SECRET") or "").strip()
    )


def _build_google_url(state: str) -> str:
    cid = (os.getenv("GOOGLE_OAUTH_CLIENT_ID") or "").strip()
    params = {
        "client_id": cid,
        "redirect_uri": _panel_redirect_uri(),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "online",
        "prompt": "select_account",
    }
    return f"{_GOOGLE_AUTH_URL}?{urlencode(params)}"


def _exchange_google_code(code: str) -> dict | None:
    cid = (os.getenv("GOOGLE_OAUTH_CLIENT_ID") or "").strip()
    csec = (os.getenv("GOOGLE_OAUTH_CLIENT_SECRET") or "").strip()
    try:
        res = _requests.post(
            _GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": cid,
                "client_secret": csec,
                "redirect_uri": _panel_redirect_uri(),
                "grant_type": "authorization_code",
            },
            timeout=15,
        )
        if res.status_code != 200:
            return None
        access = (res.json().get("access_token") or "").strip()
        if not access:
            return None
        ui = _requests.get(
            _GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access}"},
            timeout=10,
        )
        if ui.status_code != 200:
            return None
        info = ui.json()
        email = (info.get("email") or "").strip().lower()
        sub = (info.get("sub") or "").strip()
        if not email or not sub or not info.get("email_verified"):
            return None
        return {"email": email, "sub": sub, "nombre": info.get("name", ""), "picture": info.get("picture", "")}
    except Exception:
        return None


def _notificar_estado_accion_wa(ticket: dict, nuevo_estado: str, quien: str) -> None:
    """Envía notificación al grupo SEDE SUR cuando cambia el estado de una acción."""
    import threading
    from app.utils import enviar_whatsapp_reporte

    emoji = _ESTADO_EMOJI.get(nuevo_estado, "📋")
    asignado = ticket.get("asignado_a_nombre") or "Sin asignar"
    numero = ticket.get("numero", "")
    titulo = ticket.get("titulo", "")

    if nuevo_estado == "resuelto":
        texto = f"{emoji} *Acción completada*\n{numero} — {titulo}\n👤 Resuelto por {quien or asignado}"
    elif nuevo_estado == "en_proceso":
        texto = f"{emoji} *Acción iniciada*\n{numero} — {titulo}\n👤 Iniciado por {quien or asignado}"
    else:
        texto = f"{emoji} *Acción pausada*\n{numero} — {titulo}\n👤 {quien or asignado}"

    threading.Thread(
        target=enviar_whatsapp_reporte,
        kwargs={"texto_mensaje": texto, "numero_destino": _GRUPO_SEDE_SUR_WA},
        daemon=True,
    ).start()


def _ext_ok(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in _ALLOWED


def _auth(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        token = ""
        auth = request.headers.get("Authorization", "")
        if auth.lower().startswith("bearer "):
            token = auth[7:].strip()
        if not token:
            token = request.args.get("token", "")
        if not token:
            return jsonify({"error": "No autorizado"}), 401
        usuario = get_usuario_by_token(token)
        if not usuario:
            return jsonify({"error": "Sesión inválida o expirada"}), 401
        request.tickets_usuario = usuario
        return f(*args, **kwargs)
    return wrapper


def _nivel_min(n: int):
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            nivel = (getattr(request, "tickets_usuario", {}).get("rol") or {}).get("nivel", 0)
            if nivel < n:
                return jsonify({"error": "Sin permisos suficientes"}), 403
            return f(*args, **kwargs)
        return wrapper
    return decorator


def register_tickets_routes(app):
    init_db()

    # ── AUTH ────────────────────────────────────────────────────────────────

    @app.route("/api/tickets/auth/login", methods=["POST"])
    def tickets_login():
        data = request.get_json(force=True) or {}
        username = (data.get("username") or "").strip()
        password = data.get("password") or ""
        if not username or not password:
            return jsonify({"error": "username y password son requeridos"}), 400
        result, err = login_usuario(username, password)
        if err:
            return jsonify({"error": err}), 401
        return jsonify(result), 200

    # ── Google OAuth ─────────────────────────────────────────────────────────

    @app.route("/app/auth/google/start", methods=["GET"])
    def tickets_google_start():
        if not _google_oauth_configured():
            return "<p>Google OAuth no configurado. Agrega GOOGLE_OAUTH_CLIENT_ID y GOOGLE_OAUTH_CLIENT_SECRET al .env del agente.</p>", 503
        state = secrets.token_urlsafe(32)
        now = time.time()
        # Limpiar estados expirados
        expired = [k for k, v in _oauth_states.items() if now - v > _OAUTH_STATE_TTL]
        for k in expired:
            del _oauth_states[k]
        _oauth_states[state] = now
        return redirect(_build_google_url(state))

    @app.route("/app/auth/callback", methods=["GET"])
    def tickets_google_callback():
        state = request.args.get("state", "")
        code = request.args.get("code", "")
        error = request.args.get("error", "")

        if error:
            return redirect(f"/app?auth_error={error}")

        # Validar state (anti-CSRF)
        stored_at = _oauth_states.pop(state, None)
        if stored_at is None or (time.time() - stored_at) > _OAUTH_STATE_TTL:
            return redirect("/app?auth_error=state_invalido")

        if not code:
            return redirect("/app?auth_error=sin_codigo")

        profile = _exchange_google_code(code)
        if not profile:
            return redirect("/app?auth_error=oauth_fallido")

        result, err = login_usuario_google(profile["email"], profile["sub"])
        if err:
            import urllib.parse
            return redirect(f"/app?auth_error={urllib.parse.quote(err)}")

        return redirect(f"/app?_token={result['token']}")

    # ── AUTH ────────────────────────────────────────────────────────────────

    @app.route("/api/tickets/auth/me", methods=["GET"])
    @_auth
    def tickets_me():
        import os as _os
        u = dict(request.tickets_usuario)
        if (u.get("rol") or {}).get("nivel", 0) >= 3:
            u["api_token"] = _os.environ.get("CHAT_API_TOKEN", "")
        return jsonify(u), 200

    @app.route("/api/tickets/auth/me", methods=["PUT"])
    @_auth
    def tickets_actualizar_me():
        data = request.get_json(force=True) or {}
        uid = request.tickets_usuario["id"]
        payload: dict = {}
        nombre = (data.get("nombre") or "").strip()
        if nombre:
            payload["nombre"] = nombre
        password = data.get("password") or ""
        if password:
            payload["password"] = password
        if not payload:
            return jsonify({"error": "Indica nombre o nueva contraseña"}), 400
        ok, err = actualizar_usuario(uid, payload)
        if not ok:
            return jsonify({"error": err or "No se pudo actualizar"}), 400
        token = request.headers.get("Authorization", "")[7:].strip()
        usuario = get_usuario_by_token(token)
        return jsonify({"ok": True, "usuario": usuario}), 200

    @app.route("/api/tickets/auth/logout", methods=["POST"])
    @_auth
    def tickets_logout():
        token = request.headers.get("Authorization", "")[7:].strip()
        logout_usuario(token)
        return jsonify({"ok": True}), 200

    @app.route("/api/tickets/auth/me/foto", methods=["POST"])
    @_auth
    def tickets_subir_foto_me():
        uid = request.tickets_usuario["id"]
        f = request.files.get("foto")
        if not f or not f.filename:
            return jsonify({"error": "Archivo foto requerido"}), 400
        if not _ext_ok(f.filename):
            return jsonify({"error": "Tipo de archivo no permitido (JPG, PNG, GIF, WEBP)"}), 400
        ext = f.filename.rsplit(".", 1)[1].lower()
        if ext not in _AVATAR_EXT:
            return jsonify({"error": "Solo imágenes (JPG, PNG, GIF, WEBP)"}), 400
        archivo = f"avatar_{uid}_{uuid.uuid4().hex[:12]}.{ext}"
        f.save(os.path.join(UPLOADS_DIR, archivo))
        ok, err = actualizar_foto_usuario(uid, archivo)
        if not ok:
            try:
                os.remove(os.path.join(UPLOADS_DIR, archivo))
            except OSError:
                pass
            return jsonify({"error": err or "No se pudo guardar la foto"}), 400
        token = request.headers.get("Authorization", "")[7:].strip()
        usuario = get_usuario_by_token(token)
        return jsonify({"ok": True, "usuario": usuario}), 200

    @app.route("/api/tickets/auth/me/foto", methods=["DELETE"])
    @_auth
    def tickets_eliminar_foto_me():
        uid = request.tickets_usuario["id"]
        ok, err = eliminar_foto_usuario(uid)
        if not ok:
            return jsonify({"error": err or "No se pudo eliminar la foto"}), 400
        token = request.headers.get("Authorization", "")[7:].strip()
        usuario = get_usuario_by_token(token)
        return jsonify({"ok": True, "usuario": usuario}), 200

    # ── ROLES ────────────────────────────────────────────────────────────────

    @app.route("/api/tickets/roles", methods=["GET"])
    @_auth
    def tickets_get_roles():
        return jsonify(listar_roles()), 200

    @app.route("/api/tickets/roles", methods=["POST"])
    @_auth
    @_nivel_min(3)
    def tickets_crear_rol():
        data = request.get_json(force=True) or {}
        nombre = (data.get("nombre") or "").strip()
        if not nombre:
            return jsonify({"error": "nombre requerido"}), 400
        rol = crear_rol(nombre, int(data.get("nivel", 1)), data.get("descripcion", ""))
        if not rol:
            return jsonify({"error": "Ya existe un rol con ese nombre"}), 409
        return jsonify(rol), 201

    @app.route("/api/tickets/roles/<int:rol_id>", methods=["PUT"])
    @_auth
    @_nivel_min(3)
    def tickets_actualizar_rol(rol_id):
        actualizar_rol(rol_id, request.get_json(force=True) or {})
        return jsonify({"ok": True}), 200

    # ── DEPARTAMENTOS ────────────────────────────────────────────────────────

    @app.route("/api/tickets/departamentos", methods=["GET"])
    @_auth
    def tickets_get_departamentos():
        return jsonify(listar_departamentos()), 200

    @app.route("/api/tickets/departamentos", methods=["POST"])
    @_auth
    @_nivel_min(3)
    def tickets_crear_departamento():
        data = request.get_json(force=True) or {}
        nombre = (data.get("nombre") or "").strip()
        if not nombre:
            return jsonify({"error": "nombre requerido"}), 400
        dept = crear_departamento(nombre, data.get("descripcion", ""), data.get("color", "#0c6069"))
        if not dept:
            return jsonify({"error": "Ya existe un departamento con ese nombre"}), 409
        return jsonify(dept), 201

    @app.route("/api/tickets/departamentos/<int:dept_id>", methods=["PUT"])
    @_auth
    @_nivel_min(3)
    def tickets_actualizar_departamento(dept_id):
        actualizar_departamento(dept_id, request.get_json(force=True) or {})
        return jsonify({"ok": True}), 200

    # ── USUARIOS ─────────────────────────────────────────────────────────────

    @app.route("/api/tickets/usuarios", methods=["GET"])
    @_auth
    def tickets_get_usuarios():
        return jsonify(listar_usuarios()), 200

    @app.route("/api/tickets/usuarios", methods=["POST"])
    @_auth
    @_nivel_min(2)
    def tickets_crear_usuario():
        data = request.get_json(force=True) or {}
        nombre   = (data.get("nombre") or "").strip()
        username = (data.get("username") or "").strip()
        rol_id   = data.get("rol_id")
        if not all([nombre, username, rol_id]):
            return jsonify({"error": "Nombre, alias y rol son requeridos"}), 400
        usuario, err = crear_usuario(
            nombre=nombre,
            username=username,
            rol_id=int(rol_id),
            departamentos_ids=data.get("departamentos_ids") or [],
            password=data.get("password") or None,
            email=data.get("email") or None,
        )
        if err:
            return jsonify({"error": err}), 409
        return jsonify(usuario), 201

    @app.route("/api/tickets/usuarios/<int:user_id>", methods=["PUT"])
    @_auth
    @_nivel_min(3)
    def tickets_actualizar_usuario(user_id):
        ok, err = actualizar_usuario(user_id, request.get_json(force=True) or {})
        if not ok:
            return jsonify({"error": err}), 400
        return jsonify({"ok": True}), 200

    @app.route("/api/tickets/usuarios/<int:user_id>/permisos", methods=["PUT"])
    @_auth
    @_nivel_min(3)
    def tickets_actualizar_permisos(user_id):
        from app.services.tickets_db import actualizar_permisos_secciones
        permisos = request.get_json(force=True) or {}
        ok, err = actualizar_permisos_secciones(user_id, permisos, request.tickets_usuario["id"])
        if not ok:
            return jsonify({"error": err}), 403
        return jsonify({"ok": True}), 200

    @app.route("/api/tickets/usuarios/<int:user_id>", methods=["DELETE"])
    @_auth
    @_nivel_min(2)
    def tickets_desactivar_usuario(user_id):
        ok, err = desactivar_usuario(user_id, request.tickets_usuario["id"])
        if not ok:
            return jsonify({"error": err}), 400
        return jsonify({"ok": True}), 200

    # ── TICKETS ───────────────────────────────────────────────────────────────

    @app.route("/api/tickets/", methods=["GET"])
    @_auth
    def tickets_list():
        filtros = {k: request.args.get(k) for k in ("estado", "categoria", "asignado_a", "prioridad", "tipo")}
        filtros = {k: v for k, v in filtros.items() if v}
        if request.args.get("sin_mision"):
            filtros["sin_mision"] = True
        return jsonify(listar_tickets(request.tickets_usuario, filtros)), 200

    @app.route("/api/tickets/", methods=["POST"])
    @_auth
    def tickets_crear():
        usuario = request.tickets_usuario
        is_multipart = request.content_type and "multipart/form-data" in request.content_type
        if is_multipart:
            data = {
                "titulo":      request.form.get("titulo", ""),
                "categoria":   request.form.get("categoria", ""),
                "descripcion": request.form.get("descripcion", ""),
                "prioridad":   request.form.get("prioridad", "media"),
                "asignado_a":  request.form.get("asignado_a") or None,
            }
        else:
            data = request.get_json(force=True) or {}

        if not data.get("titulo") or not data.get("categoria") or not data.get("descripcion"):
            return jsonify({"error": "titulo, categoria y descripcion son requeridos"}), 400

        archivo_nombre = None
        if is_multipart:
            f = request.files.get("soporte_archivo")
            if data["categoria"] == "rrhh" and not f:
                return jsonify({"error": "Los tickets de RRHH requieren soporte documental"}), 400
            if f and f.filename:
                if not _ext_ok(f.filename):
                    return jsonify({"error": "Tipo de archivo no permitido (PDF, JPG, PNG)"}), 400
                ext = f.filename.rsplit(".", 1)[1].lower()
                archivo_nombre = f"{uuid.uuid4().hex}.{ext}"
                f.save(os.path.join(UPLOADS_DIR, archivo_nombre))
        elif data.get("categoria") == "rrhh":
            return jsonify({"error": "Los tickets de RRHH requieren soporte documental (multipart)"}), 400

        ticket, err = crear_ticket(data, usuario["id"], archivo_nombre)
        if err:
            return jsonify({"error": err}), 500
        return jsonify(ticket), 201

    @app.route("/api/tickets/<int:ticket_id>", methods=["DELETE"])
    @_auth
    @_nivel_min(3)
    def tickets_eliminar(ticket_id):
        ok, err = eliminar_ticket(ticket_id, request.tickets_usuario)
        if not ok:
            return jsonify({"error": err}), 400
        return jsonify({"ok": True}), 200

    @app.route("/api/tickets/<int:ticket_id>", methods=["GET"])
    @_auth
    def tickets_get_one(ticket_id):
        t = get_ticket(ticket_id, request.tickets_usuario)
        if not t:
            return jsonify({"error": "No encontrado o sin acceso"}), 404
        return jsonify(t), 200

    @app.route("/api/tickets/<int:ticket_id>", methods=["PUT"])
    @_auth
    @_nivel_min(2)
    def tickets_actualizar(ticket_id):
        data = request.get_json(force=True) or {}
        t, err = actualizar_ticket(ticket_id, data, request.tickets_usuario)
        if err:
            return jsonify({"error": err}), 400
        return jsonify(t), 200

    @app.route("/api/tickets/<int:ticket_id>/renovar", methods=["POST"])
    @_auth
    @_nivel_min(2)
    def tickets_renovar(ticket_id):
        uid = request.tickets_usuario["id"]
        ok, err = renovar_ticket(ticket_id, uid)
        if not ok:
            return jsonify({"error": err}), 400
        return jsonify(get_ticket(ticket_id, request.tickets_usuario)), 200

    @app.route("/api/tickets/<int:ticket_id>/estado", methods=["PUT"])
    @_auth
    def tickets_cambiar_estado(ticket_id):
        data = request.get_json(force=True) or {}
        nuevo_estado = data.get("estado", "")
        ok, err = cambiar_estado(
            ticket_id, nuevo_estado,
            request.tickets_usuario, data.get("motivo", ""),
        )
        if not ok:
            return jsonify({"error": err}), 400
        ticket = get_ticket(ticket_id, request.tickets_usuario)
        if ticket and ticket.get("tipo") == "accion" and nuevo_estado in ("resuelto", "en_proceso", "pendiente"):
            _notificar_estado_accion_wa(ticket, nuevo_estado, request.tickets_usuario.get("nombre", ""))
        return jsonify(ticket), 200

    @app.route("/api/tickets/<int:ticket_id>/asignar", methods=["PUT"])
    @_auth
    def tickets_asignar(ticket_id):
        data = request.get_json(force=True) or {}
        ok, err = asignar_ticket(ticket_id, data.get("asignado_a"), request.tickets_usuario)
        if not ok:
            return jsonify({"error": err}), 400
        return jsonify(get_ticket(ticket_id, request.tickets_usuario)), 200

    @app.route("/api/tickets/<int:ticket_id>/comentarios", methods=["POST"])
    @_auth
    def tickets_comentar(ticket_id):
        data = request.get_json(force=True) or {}
        texto = (data.get("texto") or "").strip()
        if not texto:
            return jsonify({"error": "texto requerido"}), 400
        agregar_comentario(
            ticket_id, request.tickets_usuario["id"],
            texto, bool(data.get("es_interno", False)),
        )
        return jsonify(get_ticket(ticket_id, request.tickets_usuario)), 200

    @app.route("/api/tickets/<int:ticket_id>/tiempo", methods=["POST"])
    @_auth
    def tickets_tiempo(ticket_id):
        data = request.get_json(force=True) or {}
        try:
            horas = float(data.get("horas", 0))
        except (TypeError, ValueError):
            return jsonify({"error": "horas debe ser un número"}), 400
        if horas <= 0:
            return jsonify({"error": "horas debe ser mayor a 0"}), 400
        registrar_tiempo(ticket_id, request.tickets_usuario["id"], horas, data.get("notas", ""))
        return jsonify(get_ticket(ticket_id, request.tickets_usuario)), 200

    from app.services.ticket_timing import (
        iniciar_corrida_ticket,
        get_corrida_ticket,
        pausar_corrida_ticket,
        reanudar_corrida_ticket,
        guardar_corrida_ticket,
        finalizar_corrida_ticket,
    )

    @app.route("/api/tickets/<int:ticket_id>/corridas/iniciar", methods=["POST"])
    @_auth
    def tickets_iniciar_corrida_ticket(ticket_id):
        uid = request.tickets_usuario["id"]
        data = request.get_json(force=True) or {}
        c, err = iniciar_corrida_ticket(
            ticket_id, uid, segundos_previos=data.get("segundos_previos", 0),
        )
        if err:
            return jsonify({"error": err}), 400
        return jsonify(get_ticket(ticket_id, request.tickets_usuario)), 200

    @app.route("/api/tickets/corridas/<int:corrida_id>", methods=["GET"])
    @_auth
    def tickets_get_corrida_ticket(corrida_id):
        uid = request.tickets_usuario["id"]
        c = get_corrida_ticket(corrida_id, uid)
        if not c:
            return jsonify({"error": "No encontrada"}), 404
        return jsonify(c), 200

    @app.route("/api/tickets/corridas/<int:corrida_id>/pausar", methods=["POST"])
    @_auth
    def tickets_pausar_corrida_ticket(corrida_id):
        uid = request.tickets_usuario["id"]
        c, err = pausar_corrida_ticket(corrida_id, uid)
        if err:
            return jsonify({"error": err}), 400
        return jsonify(get_ticket(c["ticket_id"], request.tickets_usuario)), 200

    @app.route("/api/tickets/corridas/<int:corrida_id>/reanudar", methods=["POST"])
    @_auth
    def tickets_reanudar_corrida_ticket(corrida_id):
        uid = request.tickets_usuario["id"]
        c, err = reanudar_corrida_ticket(corrida_id, uid)
        if err:
            return jsonify({"error": err}), 400
        return jsonify(get_ticket(c["ticket_id"], request.tickets_usuario)), 200

    @app.route("/api/tickets/corridas/<int:corrida_id>/guardar", methods=["POST"])
    @_auth
    def tickets_guardar_corrida_ticket(corrida_id):
        uid = request.tickets_usuario["id"]
        c, err = guardar_corrida_ticket(corrida_id, uid)
        if err:
            return jsonify({"error": err}), 400
        return jsonify(get_ticket(c["ticket_id"], request.tickets_usuario)), 200

    @app.route("/api/tickets/corridas/<int:corrida_id>/finalizar", methods=["POST"])
    @_auth
    def tickets_finalizar_corrida_ticket(corrida_id):
        uid = request.tickets_usuario["id"]
        c, err = finalizar_corrida_ticket(corrida_id, uid)
        if err:
            return jsonify({"error": err}), 400
        return jsonify(get_ticket(c["ticket_id"], request.tickets_usuario)), 200

    @app.route("/api/tickets/dashboard/carga", methods=["GET"])
    @_auth
    @_nivel_min(2)
    def tickets_dashboard_carga():
        return jsonify(dashboard_carga()), 200

    @app.route("/api/tickets/uploads/<filename>", methods=["GET"])
    @_auth
    def tickets_serve_file(filename):
        safe = secure_filename(filename)
        return send_from_directory(UPLOADS_DIR, safe)

    # ── MISIONES ──────────────────────────────────────────────────────────────

    # ── Categorías ────────────────────────────────────────────────────────────

    @app.route("/api/tickets/categorias/", methods=["GET"])
    @_auth
    def tickets_listar_categorias():
        return jsonify(listar_categorias()), 200

    @app.route("/api/tickets/categorias/", methods=["POST"])
    @_auth
    @_nivel_min(3)
    def tickets_crear_categoria():
        data = request.get_json(force=True) or {}
        slug   = (data.get("slug") or "").strip().lower().replace(" ", "_")
        nombre = (data.get("nombre") or "").strip()
        color  = data.get("color", "#0c6069")
        icono  = data.get("icono", "📋")
        cat, err = crear_categoria(slug, nombre, color, icono)
        if err:
            return jsonify({"error": err}), 400
        return jsonify(cat), 201

    @app.route("/api/tickets/categorias/<slug>", methods=["DELETE"])
    @_auth
    @_nivel_min(3)
    def tickets_eliminar_categoria(slug):
        ok, err = eliminar_categoria(slug)
        if not ok:
            return jsonify({"error": err}), 400
        return jsonify({"ok": True}), 200

    # ── Misiones ──────────────────────────────────────────────────────────────

    @app.route("/api/tickets/misiones/", methods=["GET"])
    @_auth
    def tickets_listar_misiones():
        tablero = request.args.get("tablero") in ("1", "true", "yes")
        usuario = request.tickets_usuario
        return jsonify(listar_misiones(usuario if tablero else None, tablero=tablero)), 200

    @app.route("/api/tickets/misiones/", methods=["POST"])
    @_auth
    def tickets_crear_mision():
        data = request.get_json(force=True) or {}
        if not data.get("titulo"):
            return jsonify({"error": "titulo requerido"}), 400
        if not data.get("etapas"):
            return jsonify({"error": "Se requiere al menos una etapa"}), 400
        mision, err = crear_mision(data, request.tickets_usuario["id"])
        if err:
            return jsonify({"error": err}), 400
        return jsonify(mision), 201

    @app.route("/api/tickets/misiones/<int:mision_id>", methods=["GET"])
    @_auth
    def tickets_get_mision(mision_id):
        uid = request.tickets_usuario["id"]
        m = get_mision(mision_id, usuario_id=uid)
        if not m:
            return jsonify({"error": "No encontrada"}), 404
        return jsonify(m), 200

    @app.route("/api/tickets/misiones/<int:mision_id>", methods=["DELETE"])
    @_auth
    @_nivel_min(3)
    def tickets_eliminar_mision(mision_id):
        ok, err = eliminar_mision(mision_id, request.tickets_usuario)
        if not ok:
            return jsonify({"error": err}), 400
        return jsonify({"ok": True}), 200

    @app.route("/api/tickets/misiones/<int:mision_id>", methods=["PUT"])
    @_auth
    def tickets_actualizar_mision(mision_id):
        data = request.get_json(force=True) or {}
        result, err = actualizar_mision(mision_id, data)
        if err:
            return jsonify({"error": err}), 400
        return jsonify(result), 200

    @app.route("/api/tickets/misiones/<int:mision_id>/lanzar", methods=["POST"])
    @_auth
    @_nivel_min(2)
    def tickets_lanzar_mision(mision_id):
        data = request.get_json(force=True) or {}
        asignaciones = data.get("asignaciones", {})
        ok, err = lanzar_mision(mision_id, asignaciones, request.tickets_usuario)
        if not ok:
            return jsonify({"error": err}), 400
        return jsonify(get_mision(mision_id)), 200

    @app.route("/api/tickets/misiones/<int:mision_id>/renovar", methods=["POST"])
    @_auth
    @_nivel_min(2)
    def tickets_renovar_mision(mision_id):
        uid = request.tickets_usuario["id"]
        ok, result = renovar_mision(mision_id, uid)
        if not ok:
            return jsonify({"error": result}), 400
        return jsonify({"ok": True, "proxima_renovacion": result, "mision": get_mision(mision_id, usuario_id=uid)}), 200

    from app.services.misiones_timing import (
        iniciar_corrida_mision,
        get_corrida_mision,
        pausar_corrida_mision,
        reanudar_corrida_mision,
        guardar_corrida_mision,
        finalizar_corrida_mision,
    )

    @app.route("/api/tickets/misiones/<int:mision_id>/corridas/iniciar", methods=["POST"])
    @_auth
    def tickets_iniciar_corrida_mision(mision_id):
        uid = request.tickets_usuario["id"]
        data = request.get_json(force=True) or {}
        segundos_previos = data.get("segundos_previos", 0)
        c, err = iniciar_corrida_mision(mision_id, uid, segundos_previos=segundos_previos)
        if err:
            return jsonify({"error": err}), 400
        return jsonify(c), 201

    @app.route("/api/tickets/misiones/corridas/<int:corrida_id>", methods=["GET"])
    @_auth
    def tickets_get_corrida_mision(corrida_id):
        uid = request.tickets_usuario["id"]
        c = get_corrida_mision(corrida_id, uid)
        if not c:
            return jsonify({"error": "No encontrada"}), 404
        return jsonify(c), 200

    @app.route("/api/tickets/misiones/corridas/<int:corrida_id>/pausar", methods=["POST"])
    @_auth
    def tickets_pausar_corrida_mision(corrida_id):
        uid = request.tickets_usuario["id"]
        c, err = pausar_corrida_mision(corrida_id, uid)
        if err:
            return jsonify({"error": err}), 400
        return jsonify(c), 200

    @app.route("/api/tickets/misiones/corridas/<int:corrida_id>/reanudar", methods=["POST"])
    @_auth
    def tickets_reanudar_corrida_mision(corrida_id):
        uid = request.tickets_usuario["id"]
        c, err = reanudar_corrida_mision(corrida_id, uid)
        if err:
            return jsonify({"error": err}), 400
        return jsonify(c), 200

    @app.route("/api/tickets/misiones/corridas/<int:corrida_id>/guardar", methods=["POST"])
    @_auth
    def tickets_guardar_corrida_mision(corrida_id):
        uid = request.tickets_usuario["id"]
        c, err = guardar_corrida_mision(corrida_id, uid)
        if err:
            return jsonify({"error": err}), 400
        return jsonify(c), 200

    @app.route("/api/tickets/misiones/corridas/<int:corrida_id>/finalizar", methods=["POST"])
    @_auth
    def tickets_finalizar_corrida_mision(corrida_id):
        uid = request.tickets_usuario["id"]
        c, err = finalizar_corrida_mision(corrida_id, uid)
        if err:
            return jsonify({"error": err}), 400
        return jsonify(c), 200

    @app.route("/api/tickets/misiones/<int:mision_id>/etapas", methods=["POST"])
    @_auth
    def tickets_agregar_etapa(mision_id):
        data = request.get_json(force=True) or {}
        titulo = (data.get("titulo") or "").strip()
        descripcion = data.get("descripcion") or ""
        asignado_a = data.get("asignado_a") or None
        if asignado_a:
            asignado_a = int(asignado_a)
        mision, err = agregar_etapa_mision(
            mision_id, titulo, descripcion, asignado_a, request.tickets_usuario["id"],
            pasos=data.get("pasos"),
            frecuencia=data.get("frecuencia"),
            materiales=data.get("materiales"),
        )
        if err:
            return jsonify({"error": err}), 400
        return jsonify(mision), 201

    @app.route("/api/tickets/misiones/<int:mision_id>/etapas/<int:etapa_id>", methods=["PUT"])
    @_auth
    def tickets_actualizar_etapa(mision_id, etapa_id):
        data = request.get_json(force=True) or {}
        mision, err = actualizar_etapa_mision(
            mision_id, etapa_id,
            data.get("titulo", ""), data.get("descripcion", "")
        )
        if err:
            return jsonify({"error": err}), 400
        return jsonify(mision), 200

    @app.route("/api/tickets/misiones/<int:mision_id>/etapas/<int:etapa_id>", methods=["DELETE"])
    @_auth
    def tickets_eliminar_etapa(mision_id, etapa_id):
        mision, err = eliminar_etapa_mision(mision_id, etapa_id, request.tickets_usuario)
        if err:
            return jsonify({"error": err}), 400
        return jsonify(mision), 200

    @app.route("/api/tickets/misiones/<int:mision_id>/etapas/orden", methods=["PUT"])
    @_auth
    def tickets_reordenar_etapas(mision_id):
        data = request.get_json(force=True) or {}
        etapa_ids = data.get("etapa_ids", [])
        if not etapa_ids or not isinstance(etapa_ids, list):
            return jsonify({"error": "etapa_ids requerido"}), 400
        mision, err = reordenar_etapas_mision(mision_id, [int(x) for x in etapa_ids])
        if err:
            return jsonify({"error": err}), 400
        return jsonify(mision), 200

    # ── PARTICIPANTES ─────────────────────────────────────────────────────────

    @app.route("/api/tickets/<int:ticket_id>/participantes", methods=["POST"])
    @_auth
    def tickets_agregar_participante(ticket_id):
        data = request.get_json(force=True) or {}
        usuario_id = data.get("usuario_id")
        if not usuario_id:
            return jsonify({"error": "usuario_id requerido"}), 400
        rol = data.get("rol", "colaborador")
        if rol not in ("colaborador", "revisor", "observador"):
            return jsonify({"error": "rol debe ser colaborador, revisor u observador"}), 400
        agregar_participante(ticket_id, int(usuario_id), rol)
        return jsonify(get_ticket(ticket_id, request.tickets_usuario)), 200

    @app.route("/api/tickets/<int:ticket_id>/participantes/<int:user_id>", methods=["DELETE"])
    @_auth
    def tickets_quitar_participante(ticket_id, user_id):
        quitar_participante(ticket_id, user_id)
        return jsonify(get_ticket(ticket_id, request.tickets_usuario)), 200

    # ── PASOS DE TICKET ───────────────────────────────────────────────────────

    @app.route("/api/tickets/<int:ticket_id>/pasos", methods=["GET"])
    @_auth
    def tickets_listar_pasos(ticket_id):
        return jsonify(listar_pasos(ticket_id)), 200

    @app.route("/api/tickets/<int:ticket_id>/pasos", methods=["POST"])
    @_auth
    def tickets_agregar_paso(ticket_id):
        data = request.get_json(force=True) or {}
        pasos, err = agregar_paso(
            ticket_id,
            data.get("descripcion", ""),
            request.tickets_usuario["id"],
            notas=data.get("notas"),
        )
        if err:
            return jsonify({"error": err}), 400
        return jsonify(pasos), 201

    @app.route("/api/tickets/<int:ticket_id>/pasos/<int:paso_id>", methods=["PUT"])
    @_auth
    def tickets_establecer_paso(ticket_id, paso_id):
        data = request.get_json(force=True, silent=True) or {}
        uid = request.tickets_usuario["id"]
        if "notas" in data:
            pasos, err = actualizar_paso_notas(ticket_id, paso_id, data.get("notas", ""))
            if err:
                return jsonify({"error": err}), 400
            if "completado" not in data:
                return jsonify(pasos), 200
        raw = data.get("completado", 0)
        completado = 1 if raw in (1, True, "1", "true") else 0
        pasos, err, auto = establecer_paso_completado(
            ticket_id, paso_id, uid, completado,
        )
        if err:
            return jsonify({"error": err}), 400
        return jsonify(pasos_ticket_json(ticket_id, pasos, auto)), 200

    @app.route("/api/tickets/<int:ticket_id>/pasos/<int:paso_id>/completar", methods=["POST"])
    @_auth
    def tickets_completar_paso_ticket(ticket_id, paso_id):
        pasos, err, auto = completar_paso_ticket(
            ticket_id, paso_id, request.tickets_usuario["id"]
        )
        if err:
            return jsonify({"error": err}), 400
        return jsonify(pasos_ticket_json(ticket_id, pasos, auto)), 200

    @app.route("/api/tickets/pasos/<int:paso_id>/completar", methods=["POST"])
    @_auth
    def tickets_completar_paso(paso_id):
        pasos, err, auto = completar_paso(paso_id, request.tickets_usuario["id"])
        if err:
            return jsonify({"error": err}), 400
        tid = pasos[0]["ticket_id"] if pasos else None
        body = pasos if tid is None else pasos_ticket_json(tid, pasos, auto)
        return jsonify(body), 200

    @app.route("/api/tickets/pasos/<int:paso_id>", methods=["DELETE"])
    @_auth
    def tickets_eliminar_paso(paso_id):
        pasos, err = eliminar_paso(paso_id)
        if err:
            return jsonify({"error": err}), 400
        return jsonify(pasos), 200

    @app.route("/api/tickets/<int:ticket_id>/pasos/orden", methods=["PUT"])
    @_auth
    def tickets_reordenar_pasos(ticket_id):
        data = request.get_json(force=True) or {}
        pasos, err = reordenar_pasos(ticket_id, [int(x) for x in data.get("paso_ids", [])])
        if err:
            return jsonify({"error": err}), 400
        return jsonify(pasos), 200

    # ── ZONAS DE TRABAJO ──────────────────────────────────────────────────────

    @app.route("/api/tickets/zonas-trabajo", methods=["GET"])
    @_auth
    def tickets_listar_zonas():
        return jsonify(listar_zonas_trabajo()), 200

    @app.route("/api/tickets/zonas-trabajo", methods=["POST"])
    @_auth
    @_nivel_min(2)
    def tickets_crear_zona():
        data = request.get_json(force=True) or {}
        zona, err = crear_zona_trabajo(data)
        if err:
            return jsonify({"error": err}), 400
        return jsonify(zona), 201

    @app.route("/api/tickets/zonas-trabajo/<int:zona_id>", methods=["PUT"])
    @_auth
    @_nivel_min(2)
    def tickets_actualizar_zona(zona_id):
        data = request.get_json(force=True) or {}
        zona, err = actualizar_zona_trabajo(zona_id, data)
        if err:
            return jsonify({"error": err}), 400
        return jsonify(zona), 200

    @app.route("/api/tickets/zonas-trabajo/<int:zona_id>", methods=["DELETE"])
    @_auth
    @_nivel_min(2)
    def tickets_eliminar_zona(zona_id):
        res, err = eliminar_zona_trabajo(zona_id)
        if err:
            return jsonify({"error": err}), 400
        return jsonify({"ok": True, **res}), 200

    # ── CATÁLOGO DE MATERIALES ────────────────────────────────────────────────

    @app.route("/api/tickets/materiales", methods=["GET"])
    @_auth
    def tickets_listar_materiales():
        todos = request.args.get("todos") == "1"
        zona_id = request.args.get("zona_id")
        zid = int(zona_id) if zona_id not in (None, "") else None
        return jsonify(listar_materiales(solo_activos=not todos, zona_id=zid)), 200

    @app.route("/api/tickets/materiales", methods=["POST"])
    @_auth
    @_nivel_min(2)
    def tickets_crear_material():
        data = request.get_json(force=True) or {}
        mat, err = crear_material(data)
        if err:
            return jsonify({"error": err}), 400
        return jsonify(mat), 201

    @app.route("/api/tickets/materiales/eliminar", methods=["POST"])
    @_auth
    @_nivel_min(2)
    def tickets_eliminar_materiales():
        data = request.get_json(force=True) or {}
        res, err = eliminar_materiales_catalogo(data.get("ids") or [])
        if err:
            return jsonify({"error": err}), 400
        return jsonify(res), 200

    @app.route("/api/tickets/materiales/<int:material_id>", methods=["GET"])
    @_auth
    def tickets_get_material(material_id):
        m = get_material(material_id)
        if not m:
            return jsonify({"error": "No encontrado"}), 404
        return jsonify(m), 200

    @app.route("/api/tickets/materiales/<int:material_id>", methods=["PUT"])
    @_auth
    @_nivel_min(2)
    def tickets_actualizar_material(material_id):
        data = request.get_json(force=True) or {}
        mat, err = actualizar_material(material_id, data)
        if err:
            return jsonify({"error": err}), 400
        return jsonify(mat), 200

    @app.route("/api/tickets/materiales/<int:material_id>", methods=["DELETE"])
    @_auth
    @_nivel_min(2)
    def tickets_eliminar_material(material_id):
        res, err = eliminar_materiales_catalogo([material_id])
        if err:
            return jsonify({"error": err}), 400
        if res.get("errores"):
            return jsonify({"error": res["errores"][0].get("error", "No se pudo eliminar")}), 400
        return jsonify({"ok": True, "id": material_id}), 200

    # ── MATERIALES DE TICKET ──────────────────────────────────────────────────

    @app.route("/api/tickets/<int:ticket_id>/materiales", methods=["GET"])
    @_auth
    def tickets_listar_materiales_ticket(ticket_id):
        return jsonify(listar_materiales_ticket(ticket_id)), 200

    @app.route("/api/tickets/<int:ticket_id>/materiales/observaciones", methods=["GET"])
    @_auth
    def tickets_get_observaciones_materiales(ticket_id):
        data, err = get_observaciones_materiales(ticket_id)
        if err:
            return jsonify({"error": err}), 404
        return jsonify(data), 200

    @app.route("/api/tickets/<int:ticket_id>/materiales/observaciones", methods=["PUT"])
    @_auth
    def tickets_set_observaciones_materiales(ticket_id):
        data = request.get_json(force=True) or {}
        res, err = set_observaciones_materiales(ticket_id, data.get("observaciones", ""))
        if err:
            return jsonify({"error": err}), 400
        return jsonify(res), 200

    @app.route("/api/tickets/<int:ticket_id>/materiales", methods=["POST"])
    @_auth
    def tickets_agregar_material_ticket(ticket_id):
        data = request.get_json(force=True) or {}
        mats, err = agregar_material_ticket(
            ticket_id, 
            int(data.get("material_id", 0)), 
            float(data.get("cantidad", 0)),
            data.get("notas")
        )
        if err:
            return jsonify({"error": err}), 400
        return jsonify(mats), 201

    @app.route("/api/tickets/ticket_materiales/<int:tm_id>", methods=["PUT"])
    @_auth
    def tickets_actualizar_material_ticket(tm_id):
        data = request.get_json(force=True) or {}
        # We allow partial updates for cantidad and notas
        cantidad = data.get("cantidad")
        if cantidad is not None:
            try:
                cantidad = float(cantidad)
            except (ValueError, TypeError):
                return jsonify({"error": "cantidad debe ser un número"}), 400

        mats, err = actualizar_material_ticket(
            tm_id, 
            cantidad=cantidad,
            notas=data.get("notas")
        )
        if err:
            return jsonify({"error": err}), 400
        return jsonify(mats), 200

    @app.route("/api/tickets/ticket_materiales/<int:tm_id>", methods=["DELETE"])
    @_auth
    def tickets_eliminar_material_ticket(tm_id):
        mats, err = eliminar_material_ticket(tm_id)
        if err:
            return jsonify({"error": err}), 400
        return jsonify(mats), 200

    # ── CONSUMO ───────────────────────────────────────────────────────────────

    @app.route("/api/tickets/<int:ticket_id>/consumo", methods=["POST"])
    @_auth
    def tickets_registrar_consumo(ticket_id):
        data = request.get_json(force=True) or {}
        res, err = registrar_consumo(
            ticket_id,
            int(data.get("material_id", 0)),
            float(data.get("cantidad", 0)),
            data.get("tipo", "consumo"),
            data.get("notas", ""),
            request.tickets_usuario["id"]
        )
        if err:
            return jsonify({"error": err}), 400
        return jsonify(res), 200

    @app.route("/api/tickets/<int:ticket_id>/consumo", methods=["GET"])
    @_auth
    def tickets_historial_consumo_ticket(ticket_id):
        return jsonify(historial_consumo(ticket_id=ticket_id)), 200

    @app.route("/api/tickets/materiales/<int:material_id>/consumo", methods=["GET"])
    @_auth
    def tickets_historial_consumo_material(material_id):
        return jsonify(historial_consumo(material_id=material_id)), 200

    # ── ÓRDENES DE COMPRA ─────────────────────────────────────────────────────

    @app.route("/api/tickets/ordenes-compra", methods=["GET"])
    @_auth
    def tickets_listar_ordenes():
        estado = request.args.get("estado")
        return jsonify(listar_ordenes_compra(estado or None)), 200

    @app.route("/api/tickets/ordenes-compra", methods=["POST"])
    @_auth
    @_nivel_min(2)
    def tickets_crear_orden():
        data = request.get_json(force=True) or {}
        oc, err = crear_orden_compra(
            int(data.get("material_id", 0)),
            float(data.get("cantidad", 0)),
            float(data.get("precio_unitario", 0)),
            data.get("proveedor", ""),
            data.get("notas", ""),
            request.tickets_usuario["id"]
        )
        if err:
            return jsonify({"error": err}), 400
        return jsonify(oc), 201

    @app.route("/api/tickets/ordenes-compra/<int:orden_id>", methods=["PUT"])
    @_auth
    @_nivel_min(2)
    def tickets_actualizar_orden(orden_id):
        data = request.get_json(force=True) or {}
        ocs, err = actualizar_orden_compra(orden_id, data, request.tickets_usuario["id"])
        if err:
            return jsonify({"error": err}), 400
        return jsonify(ocs), 200

    # ── DEPENDENCIAS DE MISIÓN ────────────────────────────────────────────────

    @app.route("/api/tickets/misiones/<int:mision_id>/dependencias", methods=["GET"])
    @_auth
    def tickets_get_dependencias(mision_id):
        return jsonify(get_dependencias_mision(mision_id)), 200

    @app.route("/api/tickets/misiones/<int:mision_id>/dependencias", methods=["POST"])
    @_auth
    def tickets_agregar_dependencia(mision_id):
        data = request.get_json(force=True) or {}
        tipo = data.get("tipo") or "mision"
        ref = data.get("referencia_id") or data.get("depende_de_id")
        if not ref:
            return jsonify({"error": "referencia_id requerido"}), 400
        result, err = agregar_dependencia_mision(mision_id, int(ref), tipo=tipo)
        if err:
            return jsonify({"error": err}), 400
        return jsonify(result), 201

    @app.route(
        "/api/tickets/misiones/<int:mision_id>/dependencias/<tipo>/<int:ref_id>",
        methods=["DELETE"],
    )
    @_auth
    def tickets_eliminar_dependencia_typed(mision_id, tipo, ref_id):
        if tipo not in ("mision", "receta"):
            return jsonify({"error": "tipo inválido"}), 400
        result, err = eliminar_dependencia_mision(mision_id, ref_id, tipo=tipo)
        if err:
            return jsonify({"error": err}), 400
        return jsonify(result), 200

    @app.route("/api/tickets/misiones/<int:mision_id>/dependencias/<int:dep_id>", methods=["DELETE"])
    @_auth
    def tickets_eliminar_dependencia(mision_id, dep_id):
        result, err = eliminar_dependencia_mision(mision_id, dep_id, tipo="mision")
        if err:
            return jsonify({"error": err}), 400
        return jsonify(result), 200

    # ── PRODUCTO RESULTANTE ───────────────────────────────────────────────────

    @app.route("/api/tickets/misiones/<int:mision_id>/producto-resultante", methods=["PUT"])
    @_auth
    def tickets_set_producto_resultante(mision_id):
        data = request.get_json(force=True) or {}
        material_id = data.get("material_id")  # None = desvincular
        result, err = set_producto_resultante(
            mision_id, int(material_id) if material_id else None
        )
        if err:
            return jsonify({"error": err}), 400
        return jsonify(result), 200

    # ── RECETAS OPERATIVAS (inventario + procesos + cronómetro) ───────────────

    from app.services.recetas_ops import (
        listar_recetas_ops,
        get_receta_ops,
        crear_receta_ops,
        actualizar_receta_ops,
        eliminar_receta_ops,
        guardar_lineas_receta,
        guardar_procesos_receta,
        iniciar_corrida,
        get_corrida,
        pausar_corrida,
        reanudar_corrida,
        guardar_corrida,
        completar_proceso_corrida,
        finalizar_corrida,
    )

    def _nivel_usuario():
        return (request.tickets_usuario.get("rol") or {}).get("nivel") or 1

    @app.route("/api/tickets/recetas", methods=["GET"])
    @_auth
    def tickets_listar_recetas():
        uid = request.tickets_usuario["id"]
        return jsonify(listar_recetas_ops(uid)), 200

    @app.route("/api/tickets/recetas", methods=["POST"])
    @_auth
    def tickets_crear_receta():
        data = request.get_json(force=True) or {}
        r, err = crear_receta_ops(data)
        if err:
            return jsonify({"error": err}), 400
        return jsonify(r), 201

    @app.route("/api/tickets/recetas/<int:receta_id>", methods=["GET"])
    @_auth
    def tickets_get_receta(receta_id):
        uid = request.tickets_usuario["id"]
        r = get_receta_ops(receta_id, uid)
        if not r:
            return jsonify({"error": "Receta no encontrada"}), 404
        return jsonify(r), 200

    @app.route("/api/tickets/recetas/<int:receta_id>", methods=["PUT"])
    @_auth
    def tickets_actualizar_receta(receta_id):
        data = request.get_json(force=True) or {}
        r, err = actualizar_receta_ops(receta_id, data, _nivel_usuario())
        if err:
            return jsonify({"error": err}), 400
        return jsonify(r), 200

    @app.route("/api/tickets/recetas/<int:receta_id>/archivar", methods=["POST"])
    @_auth
    def tickets_archivar_receta_post(receta_id):
        """Alias POST: algunos proxies bloquean DELETE."""
        ok, err = eliminar_receta_ops(receta_id, _nivel_usuario())
        if err:
            return jsonify({"error": err}), 400
        return jsonify({"ok": ok}), 200

    @app.route("/api/tickets/recetas/<int:receta_id>", methods=["DELETE"])
    @_auth
    def tickets_eliminar_receta(receta_id):
        ok, err = eliminar_receta_ops(receta_id, _nivel_usuario())
        if err:
            return jsonify({"error": err}), 400
        return jsonify({"ok": ok}), 200

    @app.route("/api/tickets/recetas/<int:receta_id>/lineas", methods=["PUT"])
    @_auth
    def tickets_guardar_lineas_receta(receta_id):
        data = request.get_json(force=True) or {}
        lineas = data.get("lineas") if isinstance(data.get("lineas"), list) else data if isinstance(data, list) else []
        r, err = guardar_lineas_receta(receta_id, lineas, _nivel_usuario())
        if err:
            return jsonify({"error": err}), 400
        return jsonify(r), 200

    @app.route("/api/tickets/recetas/<int:receta_id>/procesos", methods=["PUT"])
    @_auth
    def tickets_guardar_procesos_receta(receta_id):
        data = request.get_json(force=True) or {}
        procesos = data.get("procesos") if isinstance(data.get("procesos"), list) else []
        r, err = guardar_procesos_receta(receta_id, procesos, _nivel_usuario())
        if err:
            return jsonify({"error": err}), 400
        return jsonify(r), 200

    @app.route("/api/tickets/recetas/<int:receta_id>/iniciar", methods=["POST"])
    @_auth
    def tickets_iniciar_corrida(receta_id):
        uid = request.tickets_usuario["id"]
        data = request.get_json(silent=True) or {}
        segundos_previos = data.get("segundos_previos", 0)
        c, err = iniciar_corrida(receta_id, uid, segundos_previos=segundos_previos)
        if err:
            return jsonify({"error": err}), 400
        return jsonify(c), 201

    @app.route("/api/tickets/recetas/corridas/<int:corrida_id>", methods=["GET"])
    @_auth
    def tickets_get_corrida(corrida_id):
        uid = request.tickets_usuario["id"]
        c = get_corrida(corrida_id, uid)
        if not c:
            return jsonify({"error": "Corrida no encontrada"}), 404
        return jsonify(c), 200

    @app.route("/api/tickets/recetas/corridas/<int:corrida_id>/pausar", methods=["POST"])
    @_auth
    def tickets_pausar_corrida(corrida_id):
        uid = request.tickets_usuario["id"]
        c, err = pausar_corrida(corrida_id, uid)
        if err:
            return jsonify({"error": err}), 400
        return jsonify(c), 200

    @app.route("/api/tickets/recetas/corridas/<int:corrida_id>/reanudar", methods=["POST"])
    @_auth
    def tickets_reanudar_corrida(corrida_id):
        uid = request.tickets_usuario["id"]
        c, err = reanudar_corrida(corrida_id, uid)
        if err:
            return jsonify({"error": err}), 400
        return jsonify(c), 200

    @app.route("/api/tickets/recetas/corridas/<int:corrida_id>/procesos/<int:proceso_id>/completar", methods=["POST"])
    @_auth
    def tickets_completar_proceso_corrida(corrida_id, proceso_id):
        uid = request.tickets_usuario["id"]
        c, err = completar_proceso_corrida(corrida_id, uid, proceso_id)
        if err:
            return jsonify({"error": err}), 400
        return jsonify(c), 200

    @app.route("/api/tickets/recetas/corridas/<int:corrida_id>/guardar", methods=["POST"])
    @_auth
    def tickets_guardar_corrida(corrida_id):
        uid = request.tickets_usuario["id"]
        c, err = guardar_corrida(corrida_id, uid)
        if err:
            return jsonify({"error": err}), 400
        return jsonify(c), 200

    @app.route("/api/tickets/recetas/corridas/<int:corrida_id>/finalizar", methods=["POST"])
    @_auth
    def tickets_finalizar_corrida(corrida_id):
        uid = request.tickets_usuario["id"]
        c, err = finalizar_corrida(corrida_id, uid)
        if err:
            return jsonify({"error": err}), 400
        return jsonify(c), 200
