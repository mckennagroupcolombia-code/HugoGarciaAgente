"""
Conciliación con el contador — /app → Contabilidad → Conciliación contador.

Endpoints bajo /api/conciliacion/* (y alias /app/api/...). Acceso: CHAT_API_TOKEN
(admin) o usuario de tickets con permiso `libro-mayor` o `conciliacion-contador` —
misma sensibilidad que el Libro Mayor (saldos con socios, retenciones por tercero).
Debe coincidir con `puedeVerModuloContabilidad` en desktop/src/lib/contabilidadAccess.ts.

Lógica: app/services/conciliacion_contador.py. Ninguna ruta llama a un LLM.
"""
from __future__ import annotations

from functools import wraps

from flask import jsonify, request


def _usuario_puede(usuario: dict | None) -> bool:
    if not usuario:
        return False
    try:
        from app.services.tickets_db import es_admin_efectivo

        if es_admin_efectivo(usuario):
            return True
    except Exception:
        if ((usuario.get("rol") or {}).get("nivel", 0)) >= 3:
            return True
    p = usuario.get("permisos_secciones") or {}
    return bool(p.get("libro-mayor") or p.get("conciliacion-contador"))


def _auth(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        from app.api_auth import bearer_token_from_request, chat_api_token_matches_request

        request.conciliacion_usuario = None  # type: ignore[attr-defined]
        if chat_api_token_matches_request():
            return f(*args, **kwargs)
        token = bearer_token_from_request()
        if not token:
            return jsonify({"error": "No autorizado"}), 401
        try:
            from app.services.tickets_db import aplicar_privilegios_admin_cynthia, get_usuario_by_token

            usuario = aplicar_privilegios_admin_cynthia(get_usuario_by_token(token))
        except Exception:
            usuario = None
        if not usuario:
            return jsonify({"error": "Sesión inválida o expirada"}), 401
        if not _usuario_puede(usuario):
            return jsonify({"error": "Conciliación requiere rol administrador o permiso 'libro-mayor'"}), 403
        request.conciliacion_usuario = usuario  # type: ignore[attr-defined]
        return f(*args, **kwargs)

    return wrapper


def _dual(app, rule: str, **opts):
    def deco(f):
        app.add_url_rule(rule, endpoint=f.__name__, view_func=f, **opts)
        app.add_url_rule("/app" + rule, endpoint=f.__name__ + "_app", view_func=f, **opts)
        return f

    return deco


def _body() -> dict:
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def register_conciliacion_routes(app) -> None:
    from app.services import conciliacion_contador as cc

    @_dual(app, "/api/conciliacion/resumen", methods=["GET"])
    @_auth
    def conciliacion_resumen():
        try:
            return jsonify(cc.resumen())
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @_dual(app, "/api/conciliacion/hallazgos", methods=["GET"])
    @_auth
    def conciliacion_hallazgos():
        estado = (request.args.get("estado") or "pendiente").strip()
        if estado not in ("todos", *cc.ESTADOS):
            estado = "pendiente"
        try:
            return jsonify({"hallazgos": cc.listar(estado), "estado": estado})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @_dual(app, "/api/conciliacion/analizar", methods=["POST"])
    @_auth
    def conciliacion_analizar():
        b = _body()
        try:
            job = cc.lanzar_analisis(bool(b.get("descargar_correo")))
            return jsonify({"ok": True, "job": job}), 202
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @_dual(app, "/api/conciliacion/job", methods=["GET"])
    @_auth
    def conciliacion_job():
        return jsonify(cc.estado_job())

    @_dual(app, "/api/conciliacion/hallazgos/<int:hid>/decidir", methods=["POST"])
    @_auth
    def conciliacion_decidir(hid: int):
        b = _body()
        accion = (b.get("accion") or "").strip()
        notas = str(b.get("notas") or "")
        usuario = getattr(request, "conciliacion_usuario", None)
        try:
            h = cc.decidir(hid, accion, usuario=usuario, notas=notas)
            return jsonify({"ok": True, "hallazgo": h, "mensaje": h.get("mensaje", "")})
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except Exception as e:
            return jsonify({"error": str(e)}), 500
