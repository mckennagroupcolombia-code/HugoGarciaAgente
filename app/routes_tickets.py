import os
import uuid
from functools import wraps
from flask import request, jsonify, send_from_directory
from werkzeug.utils import secure_filename

from app.services.tickets_db import (
    init_db, login_usuario, get_usuario_by_token, logout_usuario,
    listar_roles, crear_rol, actualizar_rol,
    listar_departamentos, crear_departamento, actualizar_departamento,
    listar_usuarios, crear_usuario, actualizar_usuario,
    crear_ticket, listar_tickets, get_ticket,
    cambiar_estado, asignar_ticket, agregar_comentario,
    registrar_tiempo, dashboard_carga, UPLOADS_DIR,
    crear_mision, listar_misiones, get_mision, actualizar_mision, lanzar_mision,
    eliminar_mision, eliminar_ticket,
    agregar_participante, quitar_participante,
)

_ALLOWED = {"pdf", "png", "jpg", "jpeg", "gif", "webp"}


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

    @app.route("/api/tickets/auth/me", methods=["GET"])
    @_auth
    def tickets_me():
        return jsonify(request.tickets_usuario), 200

    @app.route("/api/tickets/auth/logout", methods=["POST"])
    @_auth
    def tickets_logout():
        token = request.headers.get("Authorization", "")[7:].strip()
        logout_usuario(token)
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

    # ── USUARIOS ─────────────────────────────────────────────────────────────

    @app.route("/api/tickets/usuarios", methods=["GET"])
    @_auth
    def tickets_get_usuarios():
        return jsonify(listar_usuarios()), 200

    @app.route("/api/tickets/usuarios", methods=["POST"])
    @_auth
    @_nivel_min(3)
    def tickets_crear_usuario():
        data = request.get_json(force=True) or {}
        nombre   = (data.get("nombre") or "").strip()
        username = (data.get("username") or "").strip()
        password = data.get("password") or ""
        rol_id   = data.get("rol_id")
        dept_id  = data.get("departamento_id")
        if not all([nombre, username, password, rol_id, dept_id]):
            return jsonify({"error": "Todos los campos son requeridos"}), 400
        usuario, err = crear_usuario(nombre, username, password, rol_id, dept_id)
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

    # ── TICKETS ───────────────────────────────────────────────────────────────

    @app.route("/api/tickets/", methods=["GET"])
    @_auth
    def tickets_list():
        filtros = {k: request.args.get(k) for k in ("estado", "categoria", "asignado_a", "prioridad")}
        filtros = {k: v for k, v in filtros.items() if v}
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

    @app.route("/api/tickets/<int:ticket_id>/estado", methods=["PUT"])
    @_auth
    def tickets_cambiar_estado(ticket_id):
        data = request.get_json(force=True) or {}
        ok, err = cambiar_estado(
            ticket_id, data.get("estado", ""),
            request.tickets_usuario, data.get("motivo", ""),
        )
        if not ok:
            return jsonify({"error": err}), 400
        return jsonify(get_ticket(ticket_id, request.tickets_usuario)), 200

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

    @app.route("/api/tickets/misiones/", methods=["GET"])
    @_auth
    def tickets_listar_misiones():
        return jsonify(listar_misiones()), 200

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
        m = get_mision(mision_id)
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
