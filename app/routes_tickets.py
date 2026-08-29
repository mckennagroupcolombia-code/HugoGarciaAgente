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
    actualizar_foto_usuario, eliminar_foto_usuario, actualizar_preferencias_ui,
    get_bolsillo_usuario, set_bolsillo_usuario,
    crear_ticket, listar_tickets, listar_compras_delegadas, get_ticket, actualizar_ticket,
    cambiar_estado, asignar_ticket, agregar_comentario,
    renovar_ticket,
    registrar_tiempo, dashboard_carga, actividad_equipo_hoy, UPLOADS_DIR,
    crear_mision, listar_misiones, get_mision, actualizar_mision, lanzar_mision,
    eliminar_mision, eliminar_ticket,
    agregar_participante, quitar_participante,
    listar_categorias, crear_categoria, eliminar_categoria,
    renovar_mision,
    agregar_etapa_mision, actualizar_etapa_mision, eliminar_etapa_mision,
    reordenar_etapas_mision,
    listar_pasos, agregar_paso, actualizar_paso_notas, actualizar_paso_descripcion,
    completar_paso, completar_paso_ticket,
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
    get_aliados_asignaciones, set_aliado_asignacion, TAREA_RECLAMO_MELI_ANULAR_FACTURA, TAREA_SYNC_FACTURAS_FALTANTES_SIIGO,
    listar_compras_ticket, agregar_compra_ticket, actualizar_compra_ticket, eliminar_compra_ticket,
    buscar_productos_para_compra,
    listar_notas, crear_nota, actualizar_nota, eliminar_nota,
    listar_conversaciones, marcar_ticket_visto, timeline_ticket,
)

_ALLOWED = {"pdf", "png", "jpg", "jpeg", "gif", "webp", "doc", "docx", "xls", "xlsx", "txt"}
_AVATAR_EXT = {"png", "jpg", "jpeg", "gif", "webp"}
_ALLOWED_LABEL = "PDF, JPG, PNG, GIF, WEBP, DOC, DOCX, XLS, XLSX, TXT"

_NOTIF_CONFIG_PATH = Path(__file__).parent / "data" / "config_notif_wa.json"

def _notif_config_load() -> dict:
    try:
        return json.loads(_NOTIF_CONFIG_PATH.read_text())
    except Exception:
        return {"sede_sur_acciones": True}

def _notif_config_save(cfg: dict) -> None:
    _NOTIF_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    _NOTIF_CONFIG_PATH.write_text(json.dumps(cfg, ensure_ascii=False, indent=2))

_GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
_GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"

# Estado OAuth: memoria + archivo (sobrevive reinicio breve de Flask durante el login).
_oauth_states: dict[str, dict] = {}
_OAUTH_STATE_TTL = 300  # 5 minutos
_OAUTH_STATE_FILE = os.path.join(os.path.dirname(__file__), "data", "oauth_states_panel.json")


def _oauth_states_load_disk() -> None:
    try:
        if not os.path.isfile(_OAUTH_STATE_FILE):
            return
        with open(_OAUTH_STATE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            now = time.time()
            for k, v in data.items():
                if not isinstance(v, dict):
                    continue
                if now - float(v.get("t", 0)) <= _OAUTH_STATE_TTL:
                    _oauth_states[k] = v
    except Exception:
        pass


def _oauth_states_save_disk() -> None:
    try:
        os.makedirs(os.path.dirname(_OAUTH_STATE_FILE), exist_ok=True)
        with open(_OAUTH_STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(_oauth_states, f)
    except Exception:
        pass


def _oauth_state_put(state: str, *, android: bool = False) -> None:
    _oauth_states_load_disk()
    now = time.time()
    expired = [k for k, v in _oauth_states.items() if now - float(v.get("t", 0)) > _OAUTH_STATE_TTL]
    for k in expired:
        del _oauth_states[k]
    _oauth_states[state] = {"t": now, "android": android}
    _oauth_states_save_disk()


def _oauth_state_pop(state: str) -> dict | None:
    _oauth_states_load_disk()
    entry = _oauth_states.pop(state, None)
    _oauth_states_save_disk()
    if entry is None:
        return None
    if isinstance(entry, (int, float)):
        return {"t": float(entry), "android": False}
    return entry


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


def _notificar_nueva_accion_wa(ticket: dict, quien: str) -> None:
    """Envía notificación al grupo SEDE SUR cuando se crea una nueva acción o solicitud."""
    if not _notif_config_load().get("sede_sur_acciones", True):
        return
    import threading
    from app.utils import enviar_whatsapp_reporte, jid_grupo_sede_sur_wa

    tipo = ticket.get("tipo", "accion")
    emoji = "⚡" if tipo == "accion" else "📋"
    tipo_label = "Acción nueva" if tipo == "accion" else "Solicitud nueva"
    numero = ticket.get("numero", "")
    titulo = ticket.get("titulo", "")
    asignado = ticket.get("asignado_a_nombre") or "Sin asignar"
    prioridad = ticket.get("prioridad", "media")
    pasos_total = ticket.get("pasos_total") or 0

    lineas = [
        f"{emoji} *{tipo_label}*",
        f"{numero} — {titulo}",
        f"👤 Asignado a: {asignado}  ·  Prioridad: {prioridad}",
    ]
    if pasos_total:
        lineas.append(f"📋 {pasos_total} paso{'s' if pasos_total != 1 else ''} para resolver")
    if quien:
        lineas.append(f"🏢 Creado por: {quien}")

    threading.Thread(
        target=enviar_whatsapp_reporte,
        kwargs={"texto_mensaje": "\n".join(lineas), "numero_destino": jid_grupo_sede_sur_wa()},
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
        from app.services.tickets_db import aplicar_privilegios_admin_cynthia

        request.tickets_usuario = aplicar_privilegios_admin_cynthia(usuario)
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


def _puede_crear_protocolos():
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            from app.services.tickets_db import puede_crear_protocolos
            usuario = getattr(request, "tickets_usuario", None)
            if not puede_crear_protocolos(usuario):
                return jsonify({"error": "Sin permisos para crear protocolos"}), 403
            return f(*args, **kwargs)
        return wrapper
    return decorator


def register_tickets_routes(app):
    init_db()

    # ── AUTH ────────────────────────────────────────────────────────────────

    @app.route("/api/tickets/auth/login", methods=["POST"])
    def tickets_login():
        import os as _os

        from app.services.tickets_db import (
            aplicar_privilegios_admin_cynthia,
            es_admin_efectivo,
        )

        data = request.get_json(force=True) or {}
        username = (data.get("username") or "").strip()
        password = data.get("password") or ""
        if not username or not password:
            return jsonify({"error": "username y password son requeridos"}), 400
        result, err = login_usuario(username, password)
        if err:
            return jsonify({"error": err}), 401
        usuario = aplicar_privilegios_admin_cynthia(result.get("usuario"))
        if usuario is not None:
            result = {**result, "usuario": usuario}
            if es_admin_efectivo(usuario):
                usuario["api_token"] = _os.environ.get("CHAT_API_TOKEN", "")
        return jsonify(result), 200

    # ── Google OAuth ─────────────────────────────────────────────────────────

    @app.route("/app/auth/google/start", methods=["GET"])
    def tickets_google_start():
        if not _google_oauth_configured():
            return "<p>Google OAuth no configurado. Agrega GOOGLE_OAUTH_CLIENT_ID y GOOGLE_OAUTH_CLIENT_SECRET al .env del agente.</p>", 503
        state = secrets.token_urlsafe(32)
        android = request.args.get("app", "").lower() in ("android", "1", "true")
        _oauth_state_put(state, android=android)
        return redirect(_build_google_url(state))

    @app.route("/app/auth/callback", methods=["GET"])
    def tickets_google_callback():
        state = request.args.get("state", "")
        code = request.args.get("code", "")
        error = request.args.get("error", "")

        stored = _oauth_state_pop(state) if state else None
        is_android = bool(stored and stored.get("android"))

        def _fail(msg: str):
            import urllib.parse
            q = urllib.parse.quote(msg, safe="")
            if is_android:
                return redirect(f"/app/auth/android-return?error={q}")
            return redirect(f"/app?auth_error={q}")

        if error:
            return _fail(error)

        if stored is None or (time.time() - float(stored.get("t", 0))) > _OAUTH_STATE_TTL:
            return _fail("state_invalido")

        if not code:
            return _fail("sin_codigo")

        profile = _exchange_google_code(code)
        if not profile:
            return _fail("oauth_fallido")

        result, err = login_usuario_google(profile["email"], profile["sub"])
        if err:
            return _fail(err)

        token = result["token"]
        if is_android:
            import urllib.parse
            q = urllib.parse.quote(token, safe="")
            return redirect(f"/app/auth/android-return?token={q}")
        return redirect(f"/app?_token={token}")

    @app.route("/app/auth/android-return", methods=["GET"])
    def tickets_android_auth_return():
        """Puente post-Google OAuth para APK.

        Custom Tabs en MIUI/HyperOS a menudo ignoran mckennaapp:// puro.
        Usamos intent:// con package + fallback HTTPS al panel con ?_token=.
        """
        import html
        import json
        import urllib.parse

        err = (request.args.get("error") or "").strip()
        if err:
            deeplink = f"mckennaapp://auth?error={urllib.parse.quote(err, safe='')}"
            panel = f"https://bot.mckennagroup.co/app?auth_error={urllib.parse.quote(err, safe='')}"
            intent_url = (
                f"intent://auth?error={urllib.parse.quote(err, safe='')}#Intent;"
                "scheme=mckennaapp;"
                "package=co.mckennagroup.panel;"
                f"S.browser_fallback_url={urllib.parse.quote(panel, safe='')};"
                "end"
            )
            msg = html.escape(err)
            href_i = html.escape(intent_url, quote=True)
            return (
                "<!DOCTYPE html><html><head><meta charset=utf-8>"
                '<meta name=viewport content="width=device-width,initial-scale=1">'
                f"<script>location.href={json.dumps(intent_url)};</script></head>"
                "<body style=\"font-family:system-ui,sans-serif;text-align:center;"
                "padding:2rem;background:#0f1117;color:#e8eaed\">"
                f"<p style=\"color:#f87171\">No se pudo iniciar sesión</p>"
                f"<p style=\"color:#9aa0a6;font-size:0.9rem\">{msg}</p>"
                f'<p style="margin-top:1.5rem"><a href="{href_i}" style="color:#7dd3c0">'
                "Volver a la app</a></p></body></html>"
            )

        token = (request.args.get("token") or "").strip()
        if not token:
            return redirect("/app?auth_error=sin_token")

        tok_q = urllib.parse.quote(token, safe="")
        deeplink = f"mckennaapp://auth?token={tok_q}"
        panel_https = f"https://bot.mckennagroup.co/app?_token={tok_q}"
        # Chrome/Custom Tab resuelve mejor intent:// con package que el esquema custom solo.
        intent_url = (
            f"intent://auth?token={tok_q}#Intent;"
            "scheme=mckennaapp;"
            "package=co.mckennagroup.panel;"
            f"S.browser_fallback_url={urllib.parse.quote(panel_https, safe='')};"
            "end"
        )

        href_intent = html.escape(intent_url, quote=True)
        href_deep = html.escape(deeplink, quote=True)
        href_https = html.escape(panel_https, quote=True)
        js_intent = json.dumps(intent_url)
        js_deep = json.dumps(deeplink)

        return (
            "<!DOCTYPE html><html><head><meta charset=utf-8>"
            '<meta name=viewport content="width=device-width,initial-scale=1">'
            f"<script>"
            f"var intentUrl={js_intent}, deepUrl={js_deep};"
            "function goApp(u){try{location.href=u;}catch(e){}}"
            "goApp(intentUrl);"
            "setTimeout(function(){goApp(deepUrl);},400);"
            "setTimeout(function(){goApp(intentUrl);},900);"
            "</script>"
            "</head><body style=\"font-family:system-ui,sans-serif;text-align:center;"
            "padding:2.5rem 1.25rem;background:#0f1117;color:#e8eaed;min-height:100vh;"
            "box-sizing:border-box\">"
            "<p style=\"font-size:1.1rem;margin:0 0 1rem\">Sesión lista. Abriendo McKenna…</p>"
            f'<p style="margin:1.5rem 0"><a href="{href_intent}" style="display:inline-block;'
            "padding:14px 22px;background:#0c6069;color:#fff;text-decoration:none;"
            'border-radius:10px;font-weight:700;font-size:1rem">Abrir panel McKenna</a></p>'
            f'<p style="margin:0.75rem 0"><a href="{href_deep}" style="color:#7dd3c0">'
            "Reintentar enlace de la app</a></p>"
            f'<p style="margin:0.75rem 0"><a href="{href_https}" style="color:#9aa0a6;font-size:0.9rem">'
            "Abrir en el navegador (mismo token)</a></p>"
            "<p style=\"margin-top:2rem;color:#9aa0a6;font-size:0.85rem\">"
            "Si no vuelve solo, toca <b>Abrir panel McKenna</b> y elige la app McKenna."
            "</p>"
            "</body></html>"
        )

    # ── AUTH ────────────────────────────────────────────────────────────────

    @app.route("/api/tickets/auth/me", methods=["GET"])
    @_auth
    def tickets_me():
        import os as _os

        from app.services.tickets_db import es_admin_efectivo

        u = dict(request.tickets_usuario)
        if es_admin_efectivo(u):
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
        if "documento_identidad" in data:
            doc = "".join(str(data.get("documento_identidad") or "").split())
            if not doc:
                return jsonify({
                    "error": "El documento de identidad es obligatorio para generar cuentas de cobro",
                }), 400
            if len(doc) < 5 or not any(c.isdigit() for c in doc):
                return jsonify({"error": "Documento de identidad inválido"}), 400
            payload["documento_identidad"] = doc
        if not payload:
            return jsonify({"error": "Indica nombre, documento o nueva contraseña"}), 400
        ok, err = actualizar_usuario(uid, payload)
        if not ok:
            return jsonify({"error": err or "No se pudo actualizar"}), 400
        token = request.headers.get("Authorization", "")[7:].strip()
        usuario = get_usuario_by_token(token)
        return jsonify({"ok": True, "usuario": usuario}), 200

    @app.route("/api/tickets/auth/me/preferencias", methods=["PUT"])
    @_auth
    def tickets_preferencias_me():
        data = request.get_json(force=True) or {}
        uid = request.tickets_usuario["id"]
        ok, err, merged = actualizar_preferencias_ui(uid, data)
        if not ok:
            return jsonify({"error": err or "No se pudo guardar"}), 400
        return jsonify({"ok": True, "preferencias_ui": merged}), 200

    @app.route("/api/tickets/auth/logout", methods=["POST"])
    @_auth
    def tickets_logout():
        from app.services.panel_presencia import cerrar_sesion_panel

        data = request.get_json(silent=True) or {}
        sid = (data.get("session_uuid") or "").strip()
        if sid:
            cerrar_sesion_panel(request.tickets_usuario["id"], sid)
        token = request.headers.get("Authorization", "")[7:].strip()
        logout_usuario(token)
        return jsonify({"ok": True}), 200

    # ── Presencia / sesión panel ─────────────────────────────────────────────

    @app.route("/api/tickets/panel/sesion/inicio", methods=["POST"])
    @app.route("/app/api/tickets/panel/sesion/inicio", methods=["POST"])
    @_auth
    def panel_sesion_inicio():
        from app.services.panel_presencia import iniciar_sesion_panel, registrar_evento_panel

        data = request.get_json(force=True) or {}
        sid = (data.get("session_uuid") or "").strip()
        if not sid:
            return jsonify({"error": "session_uuid requerido"}), 400
        uid = request.tickets_usuario["id"]
        ua = (request.headers.get("User-Agent") or "")[:500]
        panel = (data.get("panel") or "").strip()[:64] or None
        out = iniciar_sesion_panel(uid, sid, user_agent=ua, panel=panel)
        if not out.get("ok"):
            return jsonify(out), 400
        registrar_evento_panel(uid, "sesion_inicio", panel=panel, session_uuid=sid)
        return jsonify(out), 200

    @app.route("/api/tickets/panel/sesion/ping", methods=["POST"])
    @app.route("/app/api/tickets/panel/sesion/ping", methods=["POST"])
    @_auth
    def panel_sesion_ping():
        from app.services.panel_presencia import ping_sesion_panel, iniciar_sesion_panel

        data = request.get_json(force=True) or {}
        sid = (data.get("session_uuid") or "").strip()
        if not sid:
            return jsonify({"error": "session_uuid requerido"}), 400
        uid = request.tickets_usuario["id"]
        panel = (data.get("panel") or "").strip()[:64] or None
        out = ping_sesion_panel(uid, sid, panel=panel)
        if out.get("reiniciar"):
            ua = (request.headers.get("User-Agent") or "")[:500]
            out = iniciar_sesion_panel(uid, sid, user_agent=ua, panel=panel)
        if not out.get("ok"):
            return jsonify(out), 400
        return jsonify(out), 200

    @app.route("/api/tickets/panel/sesion/fin", methods=["POST"])
    @app.route("/app/api/tickets/panel/sesion/fin", methods=["POST"])
    @_auth
    def panel_sesion_fin():
        from app.services.panel_presencia import cerrar_sesion_panel, registrar_evento_panel

        data = request.get_json(force=True) or {}
        sid = (data.get("session_uuid") or "").strip()
        if not sid:
            return jsonify({"error": "session_uuid requerido"}), 400
        uid = request.tickets_usuario["id"]
        registrar_evento_panel(uid, "sesion_fin", session_uuid=sid)
        cerrar_sesion_panel(uid, sid)
        return jsonify({"ok": True}), 200

    @app.route("/api/tickets/panel/evento", methods=["POST"])
    @app.route("/app/api/tickets/panel/evento", methods=["POST"])
    @_auth
    def panel_evento():
        from app.services.panel_presencia import registrar_evento_panel

        data = request.get_json(force=True) or {}
        tipo = (data.get("tipo") or "").strip()
        if not tipo:
            return jsonify({"error": "tipo requerido"}), 400
        registrar_evento_panel(
            request.tickets_usuario["id"],
            tipo,
            panel=(data.get("panel") or "").strip()[:64] or None,
            detalle=data.get("detalle"),
            session_uuid=(data.get("session_uuid") or "").strip() or None,
        )
        return jsonify({"ok": True}), 200

    @app.route("/api/tickets/presencia/en-linea", methods=["GET"])
    @_auth
    def panel_presencia_en_linea():
        from app.services.panel_presencia import usuarios_en_linea_ahora

        return jsonify({"usuario_ids": sorted(usuarios_en_linea_ahora())}), 200

    @app.route("/api/tickets/panel/metricas", methods=["GET"])
    @_auth
    def panel_metricas_operadores():
        from app.services.panel_presencia import metricas_panel_operadores

        if (request.tickets_usuario.get("rol") or {}).get("nivel", 0) < 3:
            return jsonify({"error": "Solo administradores"}), 403
        fecha = (request.args.get("fecha") or "").strip()[:10] or None
        return jsonify(metricas_panel_operadores(fecha)), 200

    @app.route("/api/tickets/panel/mi-resumen", methods=["GET"])
    @_auth
    def panel_mi_resumen():
        from app.services.panel_presencia import metricas_panel_operadores

        fecha = (request.args.get("fecha") or "").strip()[:10] or None
        uid = request.tickets_usuario["id"]
        data = metricas_panel_operadores(fecha)
        mine = next((o for o in data["operadores"] if o["usuario_id"] == uid), None)
        return jsonify({"fecha": data["fecha"], "resumen": mine}), 200

    @app.route("/api/tickets/actividad-equipo", methods=["GET"])
    @_auth
    def tickets_actividad_equipo():
        """Feed de actividad del equipo hoy (acciones/solicitudes) para el banner de /app.

        Reemplaza el mensaje instantáneo al grupo SEDE SUR por cada cambio de
        estado: eso ahora se ve aquí en tiempo real, y el grupo solo recibe el
        aviso de ticket nuevo asignado + el resumen diario (ver
        scripts/resumen_actividad_sede_sur_cron.py).
        """
        return jsonify({"eventos": actividad_equipo_hoy()}), 200

    @app.route("/api/tickets/admin/metricas-acciones", methods=["GET"])
    @_auth
    def admin_metricas_acciones():
        usuario = request.tickets_usuario
        if (usuario.get("rol") or {}).get("nivel", 0) < 3:
            return jsonify({"error": "Solo administradores"}), 403
        try:
            dias = max(1, min(90, int(request.args.get("dias", "7") or "7")))
        except ValueError:
            dias = 7
        from app.services.tickets_db import _conn
        with _conn() as db:
            rows = db.execute("""
                SELECT t.asignado_a AS uid, t.estado, t.tipo, COUNT(*) AS n
                FROM tickets t
                WHERE t.asignado_a IS NOT NULL
                  AND t.tipo IN ('accion', 'solicitud')
                  AND (
                    t.estado IN ('pendiente', 'en_proceso', 'esperando_aprobacion')
                    OR (t.estado IN ('resuelto', 'rechazado', 'completado')
                        AND t.actualizado_en >= datetime('now', '-' || ? || ' days'))
                  )
                GROUP BY t.asignado_a, t.estado, t.tipo
            """, (str(dias),)).fetchall()
        by_user: dict = {}
        for r in rows:
            uid = r["uid"]
            if uid not in by_user:
                by_user[uid] = {
                    "uid": uid,
                    "acciones_activas": 0, "acciones_pendientes": 0, "acciones_resueltas": 0,
                    "solicitudes_activas": 0, "solicitudes_resueltas": 0,
                }
            u = by_user[uid]
            estado, tipo, n = r["estado"], r["tipo"], r["n"]
            if tipo == "accion":
                if estado == "en_proceso":
                    u["acciones_activas"] += n
                elif estado == "pendiente":
                    u["acciones_pendientes"] += n
                elif estado in ("resuelto", "rechazado", "completado"):
                    u["acciones_resueltas"] += n
            elif tipo == "solicitud":
                if estado in ("pendiente", "en_proceso", "esperando_aprobacion"):
                    u["solicitudes_activas"] += n
                elif estado in ("resuelto", "rechazado", "completado"):
                    u["solicitudes_resueltas"] += n
        return jsonify({"dias": dias, "usuarios": list(by_user.values())}), 200

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

    # ── BOLSILLO SEGURO ───────────────────────────────────────────────────────

    @app.route("/api/tickets/auth/bolsillo", methods=["GET"])
    @_auth
    def tickets_get_bolsillo():
        uid = request.tickets_usuario["id"]
        blob = get_bolsillo_usuario(uid)
        return jsonify({"blob": blob}), 200

    @app.route("/api/tickets/auth/bolsillo", methods=["PUT"])
    @_auth
    def tickets_set_bolsillo():
        uid = request.tickets_usuario["id"]
        data = request.get_json(force=True) or {}
        blob = data.get("blob") or ""
        if not isinstance(blob, str):
            return jsonify({"error": "blob debe ser string"}), 400
        if not set_bolsillo_usuario(uid, blob):
            return jsonify({"error": "Contenido demasiado grande"}), 413
        return jsonify({"ok": True}), 200

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

    # ── ALIADOS: asignación de labores ───────────────────────────────────────

    @app.route("/api/tickets/aliados/asignaciones", methods=["GET"])
    @_auth
    @_nivel_min(2)
    def tickets_get_aliados_asignaciones():
        return jsonify(
            {
                "tareas": [
                    {
                        "slug": TAREA_RECLAMO_MELI_ANULAR_FACTURA,
                        "nombre": "Reclamos/Devoluciones MeLi → Anular factura + Nota crédito (SIIGO)",
                    },
                    {
                        "slug": TAREA_SYNC_FACTURAS_FALTANTES_SIIGO,
                        "nombre": "Facturas faltantes MeLi↔Siigo → Sincronizar (SIIGO)",
                    },
                ],
                "asignaciones": get_aliados_asignaciones(),
            }
        ), 200

    @app.route("/api/tickets/aliados/asignaciones", methods=["PUT"])
    @_auth
    @_nivel_min(3)
    def tickets_set_aliado_asignacion_route():
        data = request.get_json(force=True) or {}
        tarea = (data.get("tarea_slug") or "").strip()
        usuario_id = data.get("usuario_id")
        if not tarea:
            return jsonify({"error": "tarea_slug requerido"}), 400
        try:
            res = set_aliado_asignacion(
                tarea,
                int(usuario_id) if usuario_id not in (None, "", 0) else None,
                actualizado_por=request.tickets_usuario["id"],
            )
            return jsonify(res), 200
        except Exception as e:
            return jsonify({"error": str(e)}), 400

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
        extras = {}
        if "telefono" in data:
            extras["telefono"] = data.get("telefono")
        if "documento_identidad" in data:
            extras["documento_identidad"] = data.get("documento_identidad")
        if "permisos_secciones" in data:
            extras["permisos_secciones"] = data.get("permisos_secciones")
        if extras and usuario:
            actualizar_usuario(usuario["id"], extras)
            from app.services.tickets_db import get_usuario_by_id
            refreshed = get_usuario_by_id(usuario["id"])
            if refreshed:
                usuario = refreshed
        return jsonify(usuario), 201

    @app.route("/api/tickets/usuarios/<int:user_id>", methods=["PUT"])
    @_auth
    @_nivel_min(3)
    def tickets_actualizar_usuario(user_id):
        ok, err = actualizar_usuario(user_id, request.get_json(force=True) or {})
        if not ok:
            return jsonify({"error": err}), 400
        return jsonify({"ok": True}), 200

    @app.route("/api/tickets/usuarios/<int:user_id>/probar-notificacion", methods=["POST"])
    @_auth
    @_nivel_min(3)
    def tickets_probar_notificacion(user_id):
        from app.services.tickets_notificaciones import (
            enviar_texto_operador, telefono_operador, normalizar_telefono_wa,
        )
        from app.services.tickets_db import get_usuario_by_id
        usuario = get_usuario_by_id(user_id) or {}
        nombre = (usuario.get("nombre") or "equipo").strip().split(" ")[0]
        texto = f"Hola {nombre}. Este es un mensaje de prueba del Centro de Mando — tu número quedó configurado correctamente."

        # Si viene un número explícito (p. ej. aún no guardado en el perfil), se usa ese
        # en vez del que ya está en la base de datos.
        body = request.get_json(silent=True) or {}
        numero_manual = normalizar_telefono_wa(str(body.get("numero") or ""))
        if numero_manual:
            from app.utils import enviar_whatsapp_reporte
            ok = enviar_whatsapp_reporte(texto, numero_destino=numero_manual)
        else:
            if not telefono_operador(user_id):
                return jsonify({"error": "Usuario sin teléfono configurado"}), 400
            ok = enviar_texto_operador(user_id, texto)

        if not ok:
            return jsonify({"error": "No se pudo enviar el mensaje de prueba"}), 502
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
        filtros = {k: request.args.get(k) for k in ("estado", "categoria", "asignado_a", "prioridad", "tipo", "subtipo")}
        filtros = {k: v for k, v in filtros.items() if v}
        if request.args.get("mis_solicitudes") in ("1", "true", "yes"):
            filtros["mis_solicitudes"] = True
        if request.args.get("sin_mision"):
            filtros["sin_mision"] = True
        if request.args.get("vista_equipo") in ("1", "true", "yes"):
            filtros["vista_equipo"] = True
        if request.args.get("activas") in ("1", "true", "yes"):
            filtros["activas"] = True
        return jsonify(listar_tickets(request.tickets_usuario, filtros)), 200

    @app.route("/api/tickets/compras-delegadas", methods=["GET"])
    @_auth
    def tickets_compras_delegadas():
        solo_activas = request.args.get("activas", "1") in ("1", "true", "yes")
        data = listar_compras_delegadas(request.tickets_usuario["id"], solo_activas=solo_activas)
        return jsonify(data), 200

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
                "tipo":        request.form.get("tipo") or "ticket",
            }
        else:
            data = request.get_json(force=True) or {}

        nivel_usuario = (usuario.get("rol") or {}).get("nivel", 0)
        if data.get("categoria") == "contratos":
            if nivel_usuario < 3:
                return jsonify({"error": "Solo administradores pueden gestionar contratos"}), 403
            if not data.get("asignado_a"):
                return jsonify({"error": "Debes asignar la solicitud de contrato a un aliado"}), 400
            data["tipo"] = "solicitud"

        tipo_ticket = data.get("tipo", "ticket")
        # Para acciones y solicitudes, descripcion es opcional
        if tipo_ticket in ("accion", "solicitud"):
            if not data.get("titulo") or not data.get("categoria"):
                return jsonify({"error": "titulo y categoria son requeridos"}), 400
        elif not data.get("titulo") or not data.get("categoria") or not data.get("descripcion"):
            return jsonify({"error": "titulo, categoria y descripcion son requeridos"}), 400

        archivo_nombre = None
        if is_multipart:
            f = request.files.get("soporte_archivo")
            if data["categoria"] in ("rrhh", "contratos") and not f:
                return jsonify({"error": "Este trámite requiere soporte documental"}), 400
            if f and f.filename:
                if not _ext_ok(f.filename):
                    return jsonify({"error": "Tipo de archivo no permitido (PDF, JPG, PNG)"}), 400
                ext = f.filename.rsplit(".", 1)[1].lower()
                archivo_nombre = f"{uuid.uuid4().hex}.{ext}"
                f.save(os.path.join(UPLOADS_DIR, archivo_nombre))
        elif data.get("categoria") in ("rrhh", "contratos"):
            return jsonify({"error": "Este trámite requiere soporte documental (multipart)"}), 400

        ticket, err = crear_ticket(data, usuario["id"], archivo_nombre)
        if err:
            return jsonify({"error": err}), 500
        if ticket and tipo_ticket in ("accion", "solicitud"):
            _notificar_nueva_accion_wa(ticket, usuario.get("nombre", ""))
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

    @app.route("/api/tickets/<int:ticket_id>/sub-tickets", methods=["GET"])
    @_auth
    def tickets_sub_tickets(ticket_id):
        from app.services.tickets_db import _conn
        with _conn() as db:
            rows = db.execute("""
                SELECT t.id, t.titulo, t.numero, t.estado,
                       t.asignado_a, ua.nombre AS asignado_a_nombre,
                       t.resuelto_en, t.actualizado_en, t.creado_en
                FROM tickets t
                LEFT JOIN usuarios ua ON ua.id = t.asignado_a
                WHERE t.ticket_padre_id = ?
                ORDER BY t.creado_en ASC
            """, (ticket_id,)).fetchall()
            return jsonify([dict(r) for r in rows])

    @app.route("/api/tickets/<int:ticket_id>", methods=["PUT"])
    @_auth
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
            resultado_cantidad=data.get("resultado_cantidad"),
            resultado_unidad=data.get("resultado_unidad"),
        )
        if not ok:
            return jsonify({"error": err}), 400
        ticket = get_ticket(ticket_id, request.tickets_usuario)
        # Estado real: una solicitud delegada pasa a revisión aunque se pida "resuelto"
        if (ticket or {}).get("estado") == "resuelto":
            from app.services.panel_presencia import log_panel_tarea

            tipo_evt = "solicitud_resuelta" if (ticket or {}).get("tipo") == "solicitud" else "ticket_resuelto"
            log_panel_tarea(
                request.tickets_usuario,
                tipo_evt,
                panel="tickets",
                detalle={"ticket_id": ticket_id, "tipo": (ticket or {}).get("tipo")},
            )
        # Notificación al creador: la dispara cambiar_estado() en tickets_db.py, que
        # conoce el estado FINAL real (ej. "resuelto" pedido por el ejecutor puede
        # quedar auto-ruteado a "esperando_aprobacion" — este `nuevo_estado` de acá
        # es el pedido, no el resultante, así que comparar contra él no lo detectaba).
        return jsonify(ticket), 200

    @app.route("/api/tickets/<int:ticket_id>/asignar", methods=["PUT"])
    @_auth
    def tickets_asignar(ticket_id):
        data = request.get_json(force=True) or {}
        ok, err = asignar_ticket(ticket_id, data.get("asignado_a"), request.tickets_usuario)
        if not ok:
            return jsonify({"error": err}), 400
        return jsonify(get_ticket(ticket_id, request.tickets_usuario)), 200

    @app.route("/api/tickets/<int:ticket_id>/comentarios", methods=["GET"])
    @_auth
    def tickets_listar_comentarios(ticket_id):
        from app.services.tickets_db import listar_comentarios
        return jsonify(listar_comentarios(ticket_id)), 200

    @app.route("/api/tickets/<int:ticket_id>/comentarios", methods=["POST"])
    @_auth
    def tickets_comentar(ticket_id):
        data = request.get_json(force=True) or {}
        texto = (data.get("texto") or "").strip()
        if not texto:
            return jsonify({"error": "texto requerido"}), 400
        new_id = agregar_comentario(
            ticket_id, request.tickets_usuario["id"],
            texto, bool(data.get("es_interno", False)),
        )
        return jsonify({"id": new_id, "ticket_id": ticket_id}), 201

    @app.route("/api/tickets/conversaciones", methods=["GET"])
    @_auth
    def tickets_conversaciones():
        tipo = (request.args.get("tipo") or "todas").strip().lower()
        scope = (request.args.get("scope") or "mias").strip().lower()
        return jsonify(listar_conversaciones(request.tickets_usuario, tipo=tipo, scope=scope)), 200

    @app.route("/api/tickets/<int:ticket_id>/timeline", methods=["GET"])
    @_auth
    def tickets_timeline(ticket_id):
        return jsonify(timeline_ticket(ticket_id)), 200

    @app.route("/api/tickets/<int:ticket_id>/visto", methods=["POST"])
    @_auth
    def tickets_marcar_visto(ticket_id):
        marcar_ticket_visto(ticket_id, request.tickets_usuario["id"])
        return jsonify({"ok": True}), 200

    @app.route("/api/tickets/comentarios/<int:comentario_id>", methods=["DELETE"])
    @_auth
    def tickets_eliminar_comentario(comentario_id):
        from app.services.tickets_db import eliminar_comentario
        ok, err = eliminar_comentario(comentario_id, request.tickets_usuario["id"])
        if not ok:
            return jsonify({"error": err}), 404 if "encontrado" in (err or "") else 403
        return jsonify({"ok": True}), 200

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
    @_nivel_min(1)
    def tickets_renovar_mision(mision_id):
        u = request.tickets_usuario
        username = (u.get("username") or "").lower()
        email = (u.get("email") or "").lower()
        if username == "admin" or "mckenna.group.colombia" in email:
            return jsonify({"error": "La cuenta orquestadora no puede iniciar misiones"}), 403
        uid = u["id"]
        # forzar=True: resetea tickets en cualquier estado (no solo resueltos)
        ok, result = renovar_mision(mision_id, uid, forzar=True)
        if not ok:
            return jsonify({"error": result}), 400
        # Iniciar corrida de tiempo automáticamente
        from app.services.misiones_timing import iniciar_corrida_mision, finalizar_corridas_abiertas_mision
        finalizar_corridas_abiertas_mision(mision_id)
        corrida, _ = iniciar_corrida_mision(mision_id, uid)
        return jsonify({
            "ok": True,
            "mision": get_mision(mision_id, usuario_id=uid),
            "corrida": corrida,
        }), 200

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
        # Editar descripción del paso
        if "descripcion" in data:
            pasos, err = actualizar_paso_descripcion(
                ticket_id, paso_id,
                data["descripcion"],
                data.get("notas"),
            )
            if err:
                return jsonify({"error": err}), 400
            if "completado" not in data:
                return jsonify(pasos), 200
        elif "notas" in data:
            pasos, err = actualizar_paso_notas(ticket_id, paso_id, data.get("notas", ""))
            if err:
                return jsonify({"error": err}), 400
            if "completado" not in data:
                return jsonify(pasos), 200
        raw = data.get("completado", 0)
        completado = 1 if raw in (1, True, "1", "true") else 0
        pasos, err, auto = establecer_paso_completado(
            ticket_id, paso_id, uid, completado,
            duracion_segundos=data.get("duracion_segundos"),
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
        from app.services.panel_presencia import log_panel_tarea

        log_panel_tarea(
            request.tickets_usuario,
            "paso_completado",
            panel="tickets",
            detalle={"ticket_id": ticket_id, "paso_id": paso_id},
        )
        return jsonify(pasos_ticket_json(ticket_id, pasos, auto)), 200

    @app.route("/api/tickets/pasos/<int:paso_id>/completar", methods=["POST"])
    @_auth
    def tickets_completar_paso(paso_id):
        pasos, err, auto = completar_paso(paso_id, request.tickets_usuario["id"])
        if err:
            return jsonify({"error": err}), 400
        from app.services.panel_presencia import log_panel_tarea

        tid = pasos[0]["ticket_id"] if pasos else None
        log_panel_tarea(
            request.tickets_usuario,
            "paso_completado",
            panel="tickets",
            detalle={"ticket_id": tid, "paso_id": paso_id},
        )
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

    # ── Config notificaciones WhatsApp ────────────────────────────────────────

    @app.route("/api/tickets/config/notif-wa", methods=["GET"])
    @_auth
    def tickets_get_notif_config():
        return jsonify(_notif_config_load()), 200

    @app.route("/api/tickets/config/notif-wa", methods=["PUT"])
    @_auth
    @_nivel_min(3)
    def tickets_set_notif_config():
        data = request.get_json(force=True) or {}
        cfg = _notif_config_load()
        if "sede_sur_acciones" in data:
            cfg["sede_sur_acciones"] = bool(data["sede_sur_acciones"])
        _notif_config_save(cfg)
        return jsonify(cfg), 200

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

    # ── DATOS SENSIBLES ───────────────────────────────────────────────────────

    @app.route("/api/tickets/<int:ticket_id>/sensible", methods=["GET"])
    @_auth
    def tickets_get_sensible(ticket_id):
        from app.services.tickets_db import get_datos_sensibles
        texto, err = get_datos_sensibles(ticket_id, request.tickets_usuario)
        if err:
            return jsonify({"error": err}), 403
        return jsonify({"texto": texto or ""}), 200

    @app.route("/api/tickets/<int:ticket_id>/sensible", methods=["PUT"])
    @_auth
    @_nivel_min(2)
    def tickets_set_sensible(ticket_id):
        from app.services.tickets_db import set_datos_sensibles
        data = request.get_json(force=True) or {}
        ok, err = set_datos_sensibles(ticket_id, data.get("texto", ""), request.tickets_usuario)
        if not ok:
            return jsonify({"error": err}), 400
        return jsonify({"ok": True}), 200

    # ── INTERVENCIÓN ──────────────────────────────────────────────────────────

    @app.route("/api/tickets/<int:ticket_id>/pedir-intervencion", methods=["POST"])
    @_auth
    def tickets_pedir_intervencion(ticket_id):
        from app.services.tickets_db import pedir_intervencion
        data = request.get_json(force=True) or {}
        titulo = (data.get("titulo") or "").strip()
        asignado_a = data.get("asignado_a")
        if not titulo or not asignado_a:
            return jsonify({"error": "titulo y asignado_a son requeridos"}), 400
        paso_id = data.get("paso_id")
        ticket, err = pedir_intervencion(
            ticket_id,
            titulo,
            int(asignado_a),
            data.get("descripcion", ""),
            request.tickets_usuario["id"],
            int(paso_id) if paso_id else None,
            subtipo=(data.get("subtipo") or "").strip() or None,
        )
        if err:
            return jsonify({"error": err}), 400
        return jsonify(ticket), 200

    # ── LISTA DE COMPRAS ──────────────────────────────────────────────────────

    @app.route("/api/tickets/<int:ticket_id>/lista-compras", methods=["GET"])
    @_auth
    def tickets_listar_compras(ticket_id):
        return jsonify(listar_compras_ticket(ticket_id)), 200

    @app.route("/api/tickets/<int:ticket_id>/lista-compras", methods=["POST"])
    @_auth
    def tickets_agregar_compra(ticket_id):
        data = request.get_json(force=True) or {}
        items, err = agregar_compra_ticket(ticket_id, data, request.tickets_usuario["id"])
        if err:
            return jsonify({"error": err}), 400
        return jsonify(items), 201

    @app.route("/api/tickets/lista-compras/<int:item_id>", methods=["PUT"])
    @_auth
    def tickets_actualizar_compra(item_id):
        data = request.get_json(force=True) or {}
        items, err = actualizar_compra_ticket(item_id, data)
        if err:
            return jsonify({"error": err}), 400
        return jsonify(items), 200

    @app.route("/api/tickets/lista-compras/<int:item_id>", methods=["DELETE"])
    @_auth
    def tickets_eliminar_compra(item_id):
        items, err = eliminar_compra_ticket(item_id)
        if err:
            return jsonify({"error": err}), 400
        return jsonify(items), 200

    @app.route("/api/tickets/productos/buscar", methods=["GET"])
    @_auth
    def tickets_buscar_productos():
        q = (request.args.get("q") or "").strip()
        if len(q) < 2:
            return jsonify([]), 200
        return jsonify(buscar_productos_para_compra(q)), 200

    @app.route("/api/tickets/extraer-lista-compras", methods=["POST"])
    @app.route("/app/api/tickets/extraer-lista-compras", methods=["POST"])
    @_auth
    def tickets_extraer_lista_compras():
        """OCR de pantallazo/foto → items para solicitud de compra o etiquetas.

        Form: imagen|archivo, modo=compra|etiqueta (default compra).
        """
        archivo = (
            request.files.get("imagen")
            or request.files.get("archivo")
            or (request.files.getlist("imagenes") or [None])[0]
        )
        if not archivo or not getattr(archivo, "filename", None):
            return jsonify({"error": "Envíe una imagen en «imagen» o «archivo»"}), 400
        blob = archivo.read()
        if not blob:
            return jsonify({"error": "Imagen vacía"}), 400
        modo = (request.form.get("modo") or request.args.get("modo") or "compra").strip()
        from app.services.compra_exterior_ocr import extraer_lista_compras_desde_imagen

        result = extraer_lista_compras_desde_imagen(blob, modo=modo)
        if result.get("error") and not result.get("items"):
            err = str(result["error"])
            code = 504 if "tardó" in err.lower() else 502
            if "GOOGLE_API_KEY" in err:
                code = 500
            elif "Presupuesto" in err:
                code = 429
            return jsonify(result), code
        return jsonify(result), 200

    # ── PROTOCOLOS ────────────────────────────────────────────────────────────

    @app.route("/api/tickets/protocolos", methods=["GET"])
    @_auth
    def tickets_listar_protocolos():
        from app.services.tickets_db import listar_protocolos
        alcance = request.args.get("alcance") or None
        return jsonify(listar_protocolos(request.tickets_usuario, alcance=alcance)), 200

    @app.route("/api/tickets/protocolos/<int:protocolo_id>", methods=["GET"])
    @_auth
    def tickets_obtener_protocolo(protocolo_id):
        from app.services.tickets_db import obtener_protocolo
        p = obtener_protocolo(protocolo_id)
        if not p:
            return jsonify({"error": "No encontrado"}), 404
        uid = request.tickets_usuario["id"]
        nivel = (request.tickets_usuario.get("rol") or {}).get("nivel", 1)
        if p.get("alcance") == "personal" and p.get("creado_por") != uid and nivel < 2:
            return jsonify({"error": "Sin acceso"}), 403
        return jsonify(p), 200

    @app.route("/api/tickets/acciones/frecuentes", methods=["GET"])
    @_auth
    def tickets_acciones_frecuentes():
        from app.services.tickets_db import listar_acciones_frecuentes
        try:
            limite = max(1, min(20, int(request.args.get("limite", "8") or "8")))
        except ValueError:
            limite = 8
        uid = request.tickets_usuario["id"]
        return jsonify({"acciones": listar_acciones_frecuentes(uid, limite=limite)}), 200

    @app.route("/api/tickets/acciones/historial", methods=["GET"])
    @_auth
    def tickets_acciones_historial():
        from app.services.tickets_db import es_admin_vista_equipo, listar_acciones_historial
        uid = request.tickets_usuario["id"]
        # Cynthia elevada a admin: historial personal, no el del equipo/administrador
        todos = es_admin_vista_equipo(request.tickets_usuario)
        return jsonify(listar_acciones_historial(uid, todos=todos)), 200

    @app.route("/api/tickets/acciones/repetir", methods=["POST"])
    @_auth
    def tickets_acciones_repetir():
        from app.services.tickets_db import crear_accion_desde_procedimiento
        data = request.get_json(force=True) or {}
        protocolo_id = data.get("protocolo_id")
        if not protocolo_id:
            return jsonify({"error": "protocolo_id requerido"}), 400
        try:
            protocolo_id = int(protocolo_id)
        except (TypeError, ValueError):
            return jsonify({"error": "protocolo_id inválido"}), 400
        solicitud_id = data.get("solicitud_padre_id")
        try:
            solicitud_id = int(solicitud_id) if solicitud_id else None
        except (TypeError, ValueError):
            solicitud_id = None
        ticket, err = crear_accion_desde_procedimiento(
            protocolo_id, request.tickets_usuario["id"], solicitud_id,
        )
        if err:
            return jsonify({"error": err}), 400
        return jsonify(ticket), 201

    @app.route("/api/tickets/<int:ticket_id>/plantilla-accion", methods=["GET"])
    @_auth
    def tickets_plantilla_accion(ticket_id):
        from app.services.tickets_db import obtener_plantilla_accion
        plantilla, err = obtener_plantilla_accion(
            ticket_id, request.tickets_usuario["id"],
        )
        if err:
            return jsonify({"error": err}), 400
        return jsonify(plantilla), 200

    @app.route("/api/tickets/<int:ticket_id>/delegar-compras", methods=["POST"])
    @_auth
    def tickets_delegar_compras(ticket_id):
        from app.services.tickets_db import crear_solicitud_compra_delegada
        data = request.get_json(force=True) or {}
        asignado = data.get("asignado_a")
        if not asignado:
            return jsonify({"error": "asignado_a requerido"}), 400
        try:
            asignado = int(asignado)
        except (TypeError, ValueError):
            return jsonify({"error": "asignado_a inválido"}), 400
        result, err = crear_solicitud_compra_delegada(
            ticket_id,
            asignado,
            data.get("items") or data.get("lista_compras") or [],
            request.tickets_usuario["id"],
        )
        if err:
            return jsonify({"error": err}), 400
        return jsonify(result), 201

    @app.route("/api/tickets/<int:accion_id>/bloqueo-compras", methods=["GET"])
    @_auth
    def tickets_bloqueo_compras(accion_id):
        from app.services.tickets_db import estado_bloqueo_compras_accion
        bloqueo = estado_bloqueo_compras_accion(
            accion_id, request.tickets_usuario["id"],
        )
        return jsonify({"bloqueo": bloqueo}), 200

    @app.route("/api/tickets/<int:ticket_id>/guardar-procedimiento", methods=["POST"])
    @_auth
    def tickets_guardar_procedimiento(ticket_id):
        from app.services.tickets_db import guardar_procedimiento_desde_accion
        data = request.get_json(force=True) or {}
        proc, err = guardar_procedimiento_desde_accion(
            ticket_id,
            request.tickets_usuario["id"],
            lista_compras=data.get("lista_compras"),
            alcance=data.get("alcance", "personal"),
        )
        if err:
            return jsonify({"error": err}), 400
        return jsonify(proc), 200

    @app.route("/api/tickets/<int:accion_id>/completar-accion", methods=["POST"])
    @_auth
    def tickets_completar_accion(accion_id):
        from app.services.tickets_db import (
            completar_accion_y_reportar_solicitud,
            guardar_procedimiento_desde_accion,
        )
        data = request.get_json(force=True) or {}
        uid = request.tickets_usuario["id"]
        if data.get("guardar_como_procedimiento"):
            guardar_procedimiento_desde_accion(
                accion_id, uid,
                lista_compras=data.get("lista_compras"),
                alcance=data.get("alcance_procedimiento", "personal"),
            )
        ticket, err = completar_accion_y_reportar_solicitud(
            accion_id,
            uid,
            reporte_texto=data.get("reporte", ""),
            marcar_solicitud_resuelta=bool(data.get("cerrar_solicitud", True)),
            resultado_cantidad=data.get("resultado_cantidad"),
            resultado_unidad=data.get("resultado_unidad"),
        )
        if err:
            return jsonify({"error": err}), 400
        return jsonify(ticket), 200

    @app.route("/api/tickets/protocolos/<int:protocolo_id>/promover", methods=["POST"])
    @_auth
    def tickets_promover_protocolo(protocolo_id):
        from app.services.tickets_db import promover_procedimiento_a_protocolo
        nivel = (request.tickets_usuario.get("rol") or {}).get("nivel", 1)
        proc, err = promover_procedimiento_a_protocolo(
            protocolo_id, request.tickets_usuario["id"], nivel,
        )
        if err:
            return jsonify({"error": err}), 400
        return jsonify(proc), 200

    @app.route("/api/tickets/protocolos/<int:protocolo_id>/hacer-personal", methods=["POST"])
    @_auth
    def tickets_hacer_personal_protocolo(protocolo_id):
        from app.services.tickets_db import hacer_procedimiento_personal
        nivel = (request.tickets_usuario.get("rol") or {}).get("nivel", 1)
        proc, err = hacer_procedimiento_personal(
            protocolo_id, request.tickets_usuario["id"], nivel,
        )
        if err:
            return jsonify({"error": err}), 400
        return jsonify(proc), 200

    @app.route("/api/tickets/protocolos/<int:protocolo_id>/visibilidad", methods=["POST"])
    @_auth
    def tickets_cambiar_visibilidad_protocolo(protocolo_id):
        from app.services.tickets_db import cambiar_visibilidad_protocolo
        nivel = (request.tickets_usuario.get("rol") or {}).get("nivel", 1)
        data  = request.get_json(force=True) or {}
        alcance     = data.get("alcance", "personal")
        usuario_ids = data.get("usuario_ids", [])
        proc, err = cambiar_visibilidad_protocolo(
            protocolo_id, alcance, usuario_ids,
            request.tickets_usuario["id"], nivel,
        )
        if err:
            return jsonify({"error": err}), 400
        return jsonify(proc), 200

    @app.route("/api/tickets/protocolos/upload-foto", methods=["POST"])
    @_auth
    def tickets_protocolo_upload_foto():
        """Sube una foto para adjuntar a un paso de procedimiento (sin ticket_id)."""
        f = request.files.get("archivo")
        if not f or not f.filename:
            return jsonify({"error": "No se recibió ningún archivo"}), 400
        if not _ext_ok(f.filename):
            return jsonify({"error": f"Tipo no permitido ({_ALLOWED_LABEL})"}), 400
        ext = f.filename.rsplit(".", 1)[1].lower()
        nombre_archivo = f"{uuid.uuid4().hex}.{ext}"
        f.save(os.path.join(UPLOADS_DIR, nombre_archivo))
        return jsonify({
            "nombre_archivo": nombre_archivo,
            "mime": f.content_type or f"image/{ext}",
        }), 201

    @app.route("/api/tickets/protocolos", methods=["POST"])
    @_auth
    @_puede_crear_protocolos()
    def tickets_crear_protocolo():
        from app.services.tickets_db import crear_protocolo
        data = request.get_json(force=True) or {}
        titulo = (data.get("titulo") or "").strip()
        if not titulo:
            return jsonify({"error": "El título es requerido"}), 400
        protocolo, err = crear_protocolo(
            titulo,
            data.get("descripcion", ""),
            data.get("categoria", ""),
            data.get("pasos", []),
            request.tickets_usuario["id"],
        )
        if err:
            return jsonify({"error": err}), 400
        return jsonify(protocolo), 201

    @app.route("/api/tickets/<int:ticket_id>/guardar-como-protocolo", methods=["POST"])
    @_auth
    @_puede_crear_protocolos()
    def tickets_guardar_protocolo(ticket_id):
        from app.services.tickets_db import crear_protocolo_desde_ticket
        data = request.get_json(force=True) or {}
        titulo = (data.get("titulo") or "").strip()
        if not titulo:
            return jsonify({"error": "El título es requerido"}), 400
        protocolo, err = crear_protocolo_desde_ticket(
            ticket_id,
            titulo,
            data.get("descripcion", ""),
            data.get("categoria", ""),
            request.tickets_usuario["id"],
        )
        if err:
            return jsonify({"error": err}), 400
        return jsonify(protocolo), 201

    @app.route("/api/tickets/protocolos/<int:protocolo_id>", methods=["PUT"])
    @_auth
    def tickets_actualizar_protocolo(protocolo_id):
        from app.services.tickets_db import actualizar_protocolo
        data = request.get_json(force=True) or {}
        nivel = (request.tickets_usuario.get("rol") or {}).get("nivel", 0)
        protocolo, err = actualizar_protocolo(
            protocolo_id,
            data.get("titulo", ""),
            data.get("descripcion", ""),
            data.get("categoria", ""),
            data.get("pasos", []),
            request.tickets_usuario["id"],
            nivel=nivel,
        )
        if err:
            code = 403 if "permisos" in err.lower() or "creador" in err.lower() else 400
            return jsonify({"error": err}), code
        return jsonify(protocolo), 200

    @app.route("/api/tickets/protocolos/<int:protocolo_id>", methods=["DELETE"])
    @_auth
    def tickets_eliminar_protocolo(protocolo_id):
        from app.services.tickets_db import eliminar_protocolo
        nivel = (request.tickets_usuario.get("rol") or {}).get("nivel", 0)
        ok, err = eliminar_protocolo(protocolo_id, request.tickets_usuario["id"], nivel=nivel)
        if err:
            code = 403 if "permisos" in err.lower() or "creador" in err.lower() or "supervisor" in err.lower() else 404
            return jsonify({"error": err}), code
        return jsonify({"ok": True}), 200

    @app.route("/api/tickets/<int:ticket_id>/vincular-protocolo", methods=["POST"])
    @_auth
    def tickets_vincular_protocolo(ticket_id):
        from app.services.tickets_db import vincular_protocolo_a_ticket
        data = request.get_json(force=True) or {}
        protocolo_id = data.get("protocolo_id")
        if not protocolo_id:
            return jsonify({"error": "protocolo_id es requerido"}), 400
        try:
            protocolo_id = int(protocolo_id)
        except (TypeError, ValueError):
            return jsonify({"error": "protocolo_id inválido"}), 400
        usuario = request.tickets_usuario
        nivel = (usuario.get("rol") or {}).get("nivel", 1)
        ticket, err = vincular_protocolo_a_ticket(
            ticket_id,
            protocolo_id,
            usuario["id"],
            nivel,
            bool(data.get("reemplazar_pasos")),
        )
        if err:
            code = 403 if "permisos" in err.lower() else 400
            return jsonify({"error": err}), code
        return jsonify(ticket), 200

    # ── ADJUNTOS ──────────────────────────────────────────────────────────────

    @app.route("/api/tickets/<int:ticket_id>/adjuntos", methods=["GET"])
    @_auth
    def tickets_listar_adjuntos(ticket_id):
        from app.services.tickets_db import listar_adjuntos
        return jsonify(listar_adjuntos(ticket_id)), 200

    @app.route("/api/tickets/<int:ticket_id>/adjuntos", methods=["POST"])
    @_auth
    def tickets_subir_adjunto(ticket_id):
        from app.services.tickets_db import registrar_adjunto
        f = request.files.get("archivo")
        if not f or not f.filename:
            return jsonify({"error": "No se recibió ningún archivo"}), 400
        if not _ext_ok(f.filename):
            return jsonify({"error": f"Tipo no permitido ({_ALLOWED_LABEL})"}), 400
        ext = f.filename.rsplit(".", 1)[1].lower()
        nombre_archivo = f"{uuid.uuid4().hex}.{ext}"
        f.save(os.path.join(UPLOADS_DIR, nombre_archivo))
        adj = registrar_adjunto(
            ticket_id, nombre_archivo,
            f.filename, f.content_type,
            request.tickets_usuario["id"],
        )
        return jsonify(adj), 201

    @app.route("/api/tickets/adjuntos/<int:adjunto_id>", methods=["DELETE"])
    @_auth
    def tickets_eliminar_adjunto(adjunto_id):
        from app.services.tickets_db import eliminar_adjunto
        nombre_archivo, err = eliminar_adjunto(adjunto_id, request.tickets_usuario["id"])
        if err:
            return jsonify({"error": err}), 404
        try:
            ruta = os.path.join(UPLOADS_DIR, nombre_archivo)
            if os.path.exists(ruta):
                os.remove(ruta)
        except Exception:
            pass
        return jsonify({"ok": True}), 200

    @app.route("/api/tickets/<int:ticket_id>/pasos/<int:paso_id>/adjuntos", methods=["GET"])
    @_auth
    def tickets_listar_adjuntos_paso(ticket_id, paso_id):
        from app.services.tickets_db import listar_adjuntos_paso
        return jsonify(listar_adjuntos_paso(paso_id)), 200

    @app.route("/api/tickets/<int:ticket_id>/pasos/<int:paso_id>/adjuntos", methods=["POST"])
    @_auth
    def tickets_subir_adjunto_paso(ticket_id, paso_id):
        from app.services.tickets_db import registrar_adjunto
        f = request.files.get("archivo")
        if not f or not f.filename:
            return jsonify({"error": "No se recibió ningún archivo"}), 400
        if not _ext_ok(f.filename):
            return jsonify({"error": f"Tipo no permitido ({_ALLOWED_LABEL})"}), 400
        ext = f.filename.rsplit(".", 1)[1].lower()
        nombre_archivo = f"{uuid.uuid4().hex}.{ext}"
        f.save(os.path.join(UPLOADS_DIR, nombre_archivo))
        adj = registrar_adjunto(
            ticket_id, nombre_archivo,
            f.filename, f.content_type,
            request.tickets_usuario["id"],
            paso_id=paso_id,
        )
        return jsonify(adj), 201

    # ── Pendientes ────────────────────────────────────────────────────────────

    @app.route("/api/tickets/pendientes", methods=["GET"])
    @_auth
    def tickets_listar_pendientes():
        from app.services.tickets_db import listar_pendientes
        return jsonify(listar_pendientes(request.tickets_usuario["id"])), 200

    @app.route("/api/tickets/pendientes", methods=["POST"])
    @_auth
    def tickets_crear_pendiente():
        from app.services.tickets_db import crear_pendiente
        data = request.get_json(force=True) or {}
        titulo = (data.get("titulo") or "").strip()
        if not titulo:
            return jsonify({"error": "El título es requerido"}), 400
        try:
            p = crear_pendiente(
                request.tickets_usuario["id"],
                titulo,
                descripcion=data.get("descripcion"),
                fecha_recordatorio=data.get("fecha_recordatorio"),
            )
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        return jsonify(p), 201

    @app.route("/api/tickets/pendientes/<int:pendiente_id>", methods=["PUT"])
    @_auth
    def tickets_actualizar_pendiente(pendiente_id):
        from app.services.tickets_db import actualizar_pendiente
        data = request.get_json(force=True) or {}
        p, err = actualizar_pendiente(
            pendiente_id,
            request.tickets_usuario["id"],
            titulo=data.get("titulo"),
            descripcion=data.get("descripcion"),
            fecha_recordatorio=data.get("fecha_recordatorio"),
        )
        if err:
            return jsonify({"error": err}), 404
        return jsonify(p), 200

    @app.route("/api/tickets/pendientes/<int:pendiente_id>", methods=["DELETE"])
    @_auth
    def tickets_descartar_pendiente(pendiente_id):
        from app.services.tickets_db import descartar_pendiente
        ok, err = descartar_pendiente(pendiente_id, request.tickets_usuario["id"])
        if err:
            return jsonify({"error": err}), 404
        return jsonify({"ok": True}), 200

    @app.route("/api/tickets/pendientes/<int:pendiente_id>/iniciar", methods=["POST"])
    @_auth
    def tickets_iniciar_pendiente(pendiente_id):
        from app.services.tickets_db import iniciar_pendiente
        data = request.get_json(force=True) or {}
        ok, err = iniciar_pendiente(
            pendiente_id,
            request.tickets_usuario["id"],
            ticket_id=data.get("ticket_id"),
        )
        if err:
            return jsonify({"error": err}), 404
        return jsonify({"ok": True}), 200

    # ── Recordatorios ─────────────────────────────────────────────────────────

    @app.route("/api/tickets/recordatorios", methods=["GET"])
    @_auth
    def tickets_listar_recordatorios():
        from app.services.tickets_db import listar_recordatorios
        return jsonify(listar_recordatorios(request.tickets_usuario["id"])), 200

    @app.route("/api/tickets/recordatorios", methods=["POST"])
    @_auth
    def tickets_crear_recordatorio():
        from app.services.tickets_db import crear_recordatorio
        d = request.get_json(force=True) or {}
        titulo = (d.get("titulo") or "").strip()
        if not titulo:
            return jsonify({"error": "El título es requerido"}), 400
        fecha = (d.get("fecha_inicio") or "").strip()
        if not fecha:
            from datetime import date
            fecha = date.today().isoformat()
        try:
            r = crear_recordatorio(
                request.tickets_usuario["id"], titulo,
                descripcion=d.get("descripcion"),
                tipo=d.get("tipo_rep", "una_vez"),
                fecha_inicio=fecha,
                cada_n=d.get("cada_n_dias"),
                dias_semana=d.get("dias_semana"),
                dias_mes=d.get("dias_mes"),
                hora=d.get("hora"),
                asignado_a=d.get("asignado_a"),
            )
        except Exception as e:
            return jsonify({"error": str(e)}), 400
        return jsonify(r), 201

    @app.route("/api/tickets/recordatorios/<int:rec_id>", methods=["PUT"])
    @_auth
    def tickets_actualizar_recordatorio(rec_id):
        from app.services.tickets_db import actualizar_recordatorio
        d = request.get_json(force=True) or {}
        r, err = actualizar_recordatorio(
            rec_id, request.tickets_usuario["id"],
            titulo=d.get("titulo"), descripcion=d.get("descripcion"),
            tipo=d.get("tipo_rep"), fecha_inicio=d.get("fecha_inicio"),
            cada_n=d.get("cada_n_dias"),
            dias_semana=d.get("dias_semana"), dias_mes=d.get("dias_mes"),
            hora=d.get("hora"),
            asignado_a=d.get("asignado_a", -1),
        )
        if err:
            return jsonify({"error": err}), 404
        return jsonify(r), 200

    @app.route("/api/tickets/recordatorios/<int:rec_id>/visto", methods=["POST"])
    @_auth
    def tickets_visto_recordatorio(rec_id):
        from app.services.tickets_db import marcar_visto_recordatorio
        r, err = marcar_visto_recordatorio(rec_id, request.tickets_usuario["id"])
        if err:
            return jsonify({"error": err}), 404
        return jsonify(r), 200

    @app.route("/api/tickets/recordatorios/<int:rec_id>", methods=["DELETE"])
    @_auth
    def tickets_eliminar_recordatorio(rec_id):
        from app.services.tickets_db import eliminar_recordatorio
        ok, err = eliminar_recordatorio(rec_id, request.tickets_usuario["id"])
        if err:
            return jsonify({"error": err}), 404
        return jsonify({"ok": True}), 200

    # ── Agente conversacional móvil ───────────────────────────────────────────

    @app.route("/api/tickets/agente-chat", methods=["POST"])
    @_auth
    def tickets_agente_chat():
        """
        Chat agéntico para registro de acciones en móvil.
        Usa Ollama/Gemma para NLG; comandos y detección de intención en agente_tickets_chat.py.
        """
        from app.services.agente_tickets_chat import (
            obtener_contexto, generar_respuesta, ejecutar_cmd,
            detectar_procs_relevantes, tiene_intent_accion,
            detectar_solicitud_context, construir_saludo_operativo,
        )
        data = request.get_json(force=True) or {}
        usuario = request.tickets_usuario
        nombre = (usuario.get("nombre") or "").split()[0]

        mensaje = (data.get("mensaje") or "").strip()
        historial = data.get("historial") or []
        cmd = data.get("accion_cmd") or None
        datos_cmd = data.get("accion_datos") or {}

        # 1. Ejecutar comando si viene uno
        resultado_cmd: dict | None = None
        if cmd:
            resultado_cmd = ejecutar_cmd(cmd, datos_cmd, usuario)

        # 2. Contexto fresco
        contexto = obtener_contexto(usuario)

        # 3. Detección de intención en texto libre (sin comando)
        procs_relevantes: list[dict] = []
        es_intent = False
        solicitud_ctx: dict = {"es_solicitud": False}
        if mensaje and not cmd:
            solicitud_ctx = detectar_solicitud_context(mensaje, historial)
            if not solicitud_ctx["es_solicitud"]:
                es_intent = tiene_intent_accion(mensaje)
                procs_relevantes = detectar_procs_relevantes(mensaje, contexto["protocolos"])

        # 4. Respuesta conversacional
        respuesta = ""
        sol = solicitud_ctx
        # No llamar al LLM cuando hay un comando explícito o cuando la solicitud
        # ya tiene persona y título identificados (evita respuestas genéricas del modelo)
        skip_llm = bool(cmd) or (
            sol.get("es_solicitud") and sol.get("usuario") and sol.get("titulo_sugerido")
        )
        if mensaje and not skip_llm:
            respuesta = generar_respuesta(mensaje, historial, contexto, usuario)

        # Fallbacks sin LLM
        if not respuesta:
            if resultado_cmd and not resultado_cmd.get("error"):
                if cmd == "crear_accion":
                    titulo = resultado_cmd.get("titulo", "")
                    n_pasos = len(resultado_cmd.get("pasos") or [])
                    if n_pasos:
                        respuesta = f"¡Listo, veci! '{titulo}' registrada con {n_pasos} paso{'s' if n_pasos != 1 else ''}. ¡De una, arrancamos!"
                    else:
                        respuesta = f"¡Listo, {nombre}! '{titulo}' registrada. ¡Hagámosle!"
                elif cmd == "completar_accion":
                    respuesta = f"¡Bueno pues, {nombre}! Acción cerrada. ¿Qué más hacemos?"
                elif cmd == "marcar_paso":
                    respuesta = "¡Listo el paso! Seguimos."
                elif cmd == "crear_solicitud":
                    asig = datos_cmd.get("asignado_a_nombre") or "la persona"
                    titulo_sol = datos_cmd.get("titulo") or resultado_cmd.get("titulo") or ""
                    if titulo_sol:
                        respuesta = f"Listo, creé la solicitud para {asig}: \"{titulo_sol}\". Ya le llega la notificación."
                    else:
                        respuesta = f"Listo, creé la solicitud para {asig}. Ya le llega la notificación."
            elif resultado_cmd and resultado_cmd.get("error"):
                respuesta = f"Tuve un problema: {resultado_cmd['error']}"
            elif sol.get("es_solicitud"):
                u_sol = sol.get("usuario")
                t_sol = sol.get("titulo_sugerido")
                if u_sol and t_sol:
                    respuesta = f"¿Le pido a {u_sol['nombre']} que {t_sol}?"
                elif u_sol:
                    respuesta = f"¿Qué necesita que haga {u_sol['nombre']}?"
                elif sol.get("persona_nombre"):
                    respuesta = f"No encontré a '{sol['persona_nombre']}' en el equipo. ¿Cómo se llama exactamente?"
                else:
                    respuesta = "¿Para quién es la solicitud?"
            elif es_intent and procs_relevantes:
                respuesta = "¿Cuál procedimiento usamos para eso?"
            elif es_intent:
                respuesta = f"¡De una, {nombre}! ¿La registramos como acción nueva?"
            elif not mensaje:
                respuesta = construir_saludo_operativo(nombre, contexto)
            else:
                respuesta = "¿En qué le ayudo?"

        return jsonify({
            "respuesta": respuesta,
            "contexto": contexto,
            "accion_resultado": resultado_cmd,
            "procs_relevantes": procs_relevantes,
            "es_intent": es_intent,
            "solicitud_ctx": {
                "es_solicitud": bool(sol.get("es_solicitud")),
                "persona_nombre": sol.get("persona_nombre"),
                "usuario": sol.get("usuario"),
                "titulo_sugerido": sol.get("titulo_sugerido"),
            },
        }), 200

    # ── Notas personales ──────────────────────────────────────────────────────

    @app.route("/api/tickets/notas", methods=["GET"])
    @_auth
    def tickets_notas_listar():
        uid = request.tickets_usuario["id"]
        return jsonify(listar_notas(uid)), 200

    @app.route("/api/tickets/notas", methods=["POST"])
    @_auth
    def tickets_notas_crear():
        uid = request.tickets_usuario["id"]
        contenido = (request.json or {}).get("contenido", "").strip()
        if not contenido:
            return jsonify({"error": "contenido requerido"}), 400
        return jsonify(crear_nota(uid, contenido)), 201

    @app.route("/api/tickets/notas/<int:nota_id>", methods=["PUT"])
    @_auth
    def tickets_notas_actualizar(nota_id):
        uid = request.tickets_usuario["id"]
        contenido = (request.json or {}).get("contenido", "").strip()
        if not contenido:
            return jsonify({"error": "contenido requerido"}), 400
        ok = actualizar_nota(nota_id, uid, contenido)
        return (jsonify({"ok": True}), 200) if ok else (jsonify({"error": "not found"}), 404)

    @app.route("/api/tickets/notas/<int:nota_id>", methods=["DELETE"])
    @_auth
    def tickets_notas_eliminar(nota_id):
        uid = request.tickets_usuario["id"]
        ok = eliminar_nota(nota_id, uid)
        return (jsonify({"ok": True}), 200) if ok else (jsonify({"error": "not found"}), 404)

    @app.route("/api/tickets/recordatorios/notificar-hoy", methods=["POST"])
    @_auth
    def tickets_notificar_recordatorios_hoy():
        """Envía nota de voz por cada recordatorio vencido del usuario autenticado."""
        from app.services.tickets_notificaciones import notificar_recordatorios_hoy
        uid = request.tickets_usuario["id"]
        notificados = notificar_recordatorios_hoy(uid)
        return jsonify({"notificados": notificados, "total": len(notificados)}), 200
