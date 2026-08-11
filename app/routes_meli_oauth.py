"""
Conexión OAuth con Mercado Libre — panel visual para reactivar la app cuando
queda inactiva o se crea una nueva (Client ID/Secret + código de autorización
TG-xxxx), sin depender de correr `scripts/activar_meli.py` a mano en terminal.

Endpoints bajo /api/meli-oauth/*. Acceso restringido a administradores (mismo
criterio que RRHH: CHAT_API_TOKEN o usuario de tickets con rol nivel >= 3) —
sin permiso granular, porque maneja credenciales OAuth críticas de producción.

El client_secret nunca se devuelve en las respuestas (solo si está configurado).
"""

import json
import os
from functools import wraps

from flask import jsonify, request

_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_REDIRECT_URI_DEFAULT = "https://bot.mckennagroup.co/callback"


def _ruta_credenciales() -> str:
    return os.getenv("MELI_CREDS_PATH") or os.path.join(_BASE, "credenciales_meli.json")


def _leer_credenciales() -> dict:
    try:
        with open(_ruta_credenciales(), "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _guardar_credenciales(data: dict) -> None:
    ruta = _ruta_credenciales()
    tmp = ruta + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4)
    os.replace(tmp, ruta)


# ── Auth (admin-only, calcado de _auth_rrhh en app/routes_rrhh.py) ─────────────

def _usuario_puede_meli_oauth(usuario: dict | None) -> bool:
    if not usuario:
        return False
    try:
        from app.services.tickets_db import es_admin_efectivo

        if es_admin_efectivo(usuario):
            return True
    except Exception:
        if ((usuario.get("rol") or {}).get("nivel", 0)) >= 3:
            return True
    return False


def _auth_meli_oauth(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        from app.api_auth import bearer_token_from_request, chat_api_token_matches_request

        if chat_api_token_matches_request():
            request.meli_oauth_usuario = {"nombre": "Administrador (token)"}
            return f(*args, **kwargs)
        token = bearer_token_from_request()
        if not token:
            return jsonify({"error": "No autorizado"}), 401
        try:
            from app.services.tickets_db import (
                aplicar_privilegios_admin_cynthia,
                get_usuario_by_token,
            )

            usuario = aplicar_privilegios_admin_cynthia(get_usuario_by_token(token))
        except Exception:
            usuario = None
        if not usuario:
            return jsonify({"error": "Sesión inválida o expirada"}), 401
        if not _usuario_puede_meli_oauth(usuario):
            return jsonify({"error": "Conexión MeLi requiere rol administrador"}), 403
        request.meli_oauth_usuario = usuario
        return f(*args, **kwargs)

    return wrapper


def register_meli_oauth_routes(app):
    @app.route("/api/meli-oauth/estado", methods=["GET"])
    @app.route("/app/api/meli-oauth/estado", methods=["GET"])
    @_auth_meli_oauth
    def meli_oauth_estado():
        creds = _leer_credenciales()
        ruta = _ruta_credenciales()
        return jsonify(
            {
                "existe_archivo": os.path.exists(ruta),
                "app_id": creds.get("app_id") or creds.get("client_id") or "",
                "tiene_client_secret": bool(creds.get("client_secret")),
                "tiene_access_token": bool(creds.get("access_token")),
                "tiene_refresh_token": bool(creds.get("refresh_token")),
                "seller_id": creds.get("seller_id") or creds.get("user_id") or None,
                "redirect_uri": creds.get("redirect_uri") or _REDIRECT_URI_DEFAULT,
            }
        )

    @app.route("/api/meli-oauth/credenciales", methods=["POST"])
    @app.route("/app/api/meli-oauth/credenciales", methods=["POST"])
    @_auth_meli_oauth
    def meli_oauth_credenciales():
        body = request.get_json(silent=True) or {}
        app_id = str(body.get("app_id") or "").strip()
        client_secret = str(body.get("client_secret") or "").strip()
        redirect_uri = str(body.get("redirect_uri") or "").strip()
        if not app_id:
            return jsonify({"error": "app_id (Client ID) es obligatorio."}), 400

        creds = _leer_credenciales()
        creds["app_id"] = app_id
        if client_secret:
            creds["client_secret"] = client_secret
        if redirect_uri:
            creds["redirect_uri"] = redirect_uri
        _guardar_credenciales(creds)
        return jsonify(
            {
                "ok": True,
                "app_id": creds["app_id"],
                "tiene_client_secret": bool(creds.get("client_secret")),
            }
        )

    @app.route("/api/meli-oauth/auth-url", methods=["GET"])
    @app.route("/app/api/meli-oauth/auth-url", methods=["GET"])
    @_auth_meli_oauth
    def meli_oauth_auth_url():
        creds = _leer_credenciales()
        app_id = creds.get("app_id") or creds.get("client_id") or ""
        if not app_id:
            return jsonify({"error": "Primero guarda el Client ID (app_id) en el paso 1."}), 400
        redirect_uri = creds.get("redirect_uri") or _REDIRECT_URI_DEFAULT

        from scripts.activar_meli import generar_pkce

        code_verifier, code_challenge = generar_pkce()
        url = (
            "https://auth.mercadolibre.com.co/authorization"
            f"?response_type=code&client_id={app_id}&redirect_uri={redirect_uri}"
            f"&code_challenge={code_challenge}&code_challenge_method=S256"
        )
        # PKCE: el code_verifier viaja de vuelta al front y este lo reenvía intacto
        # en /activar — no se persiste en servidor, es de un solo uso por intento.
        return jsonify({"url": url, "redirect_uri": redirect_uri, "code_verifier": code_verifier})

    @app.route("/api/meli-oauth/activar", methods=["POST"])
    @app.route("/app/api/meli-oauth/activar", methods=["POST"])
    @_auth_meli_oauth
    def meli_oauth_activar():
        body = request.get_json(silent=True) or {}
        codigo = str(body.get("codigo_tg") or body.get("codigo") or "").strip()
        code_verifier = str(body.get("code_verifier") or "").strip() or None
        if not codigo:
            return jsonify({"error": "Falta el código TG-xxxx (paso 3)."}), 400

        from scripts.activar_meli import activar_conexion_meli

        resultado = activar_conexion_meli(codigo, code_verifier)
        ok = isinstance(resultado, str) and resultado.startswith("✅")
        creds = _leer_credenciales() if ok else {}
        return (
            jsonify(
                {
                    "ok": ok,
                    "mensaje": resultado,
                    "seller_id": creds.get("seller_id") if ok else None,
                }
            ),
            # 400, no 502: Cloudflare intercepta 502 y lo reemplaza con su propia
            # página de error genérica, ocultando el mensaje real del backend.
            200 if ok else 400,
        )
