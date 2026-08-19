"""
Conexión OAuth con Gmail (mckenna.group.colombia@gmail.com) — panel visual para
ver el estado en tiempo real y reautorizar con un clic cuando el token expira o
es revocado, sin depender de correr `scripts/reautorizar_gmail.py` a mano en
terminal (ese script sigue funcionando igual, solo para uso local).

Calcado de app/routes_meli_oauth.py, con una diferencia deliberada: en vez del
paso "copiar/pegar código" de MeLi, el intercambio de código se completa solo
en /api/gmail-oauth/callback (patrón estándar "Sign in with Google" — la
navegación de vuelta de Google no puede llevar Authorization header).

Endpoints bajo /api/gmail-oauth/*. Acceso a estado/auth-url restringido a
administradores (mismo criterio que RRHH y MeLi OAuth: CHAT_API_TOKEN o
usuario de tickets con rol nivel >= 3). El callback no lleva ese auth porque
es una navegación directa del navegador, pero no hace nada sin un `state` de
un solo uso previamente emitido por un admin autenticado en /auth-url.
"""

import json
import os
import time
from functools import wraps

# Google casi siempre añade openid/userinfo.email/userinfo.profile a la
# pantalla de consentimiento aunque no los pidamos; sin esto, oauthlib rechaza
# el canje del código con "Scope has changed" apenas el usuario autoriza.
os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")

from flask import jsonify, request

from app.tools.sincronizar_facturas_de_compra_siigo import (
    GOOGLE_CREDS_PATH,
    SCOPES,
    TOKEN_GMAIL_PATH,
    estado_token_gmail,
)

META_PATH = os.path.join(os.path.dirname(__file__), "data", "gmail_oauth_meta.json")
REDIRECT_URI = "https://bot.mckennagroup.co/api/gmail-oauth/callback"

# state (de un solo uso) -> {"exp": epoch, "code_verifier": ...}. Vive en
# memoria del proceso; si el server se reinicia a mitad del flujo, el usuario
# regenera el link. code_verifier es obligatorio: este cliente OAuth de Google
# exige PKCE, y como /auth-url y /callback construyen objetos Flow distintos
# (requests separados), el code_verifier generado al armar la URL se perdería
# si no se persiste aquí junto al state — Google responde "Missing code
# verifier" en el canje si no viaja el mismo valor usado para el code_challenge.
_ESTADOS_PENDIENTES: dict[str, dict] = {}
_ESTADO_TTL_SEG = 15 * 60


def _limpiar_estados_expirados() -> None:
    ahora = time.time()
    for state in [s for s, d in _ESTADOS_PENDIENTES.items() if d["exp"] < ahora]:
        _ESTADOS_PENDIENTES.pop(state, None)


def _leer_meta() -> dict:
    try:
        with open(META_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _guardar_meta(data: dict) -> None:
    tmp = META_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, META_PATH)


def _cliente_configurado() -> bool:
    try:
        with open(GOOGLE_CREDS_PATH, "r", encoding="utf-8") as f:
            raw = json.load(f)
        info = raw.get("web") or raw.get("installed") or {}
        return bool(info.get("client_id") and info.get("client_secret"))
    except Exception:
        return False


def _construir_flow(code_verifier: str | None = None):
    from google_auth_oauthlib.flow import Flow

    return Flow.from_client_secrets_file(
        GOOGLE_CREDS_PATH,
        scopes=SCOPES,
        redirect_uri=REDIRECT_URI,
        code_verifier=code_verifier,
    )


def _pagina_html(titulo: str, mensaje: str, ok: bool) -> str:
    color = "#10b981" if ok else "#ef4444"
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>{titulo}</title>
<style>
body {{ font-family: system-ui, sans-serif; background:#0f1115; color:#e6e6e6;
        display:flex; align-items:center; justify-content:center; height:100vh; margin:0; }}
.card {{ max-width:28rem; padding:2rem; border-radius:12px; background:#1a1d24;
         border:1px solid #2a2e37; text-align:center; }}
h1 {{ font-size:1.1rem; color:{color}; margin:0 0 .75rem; }}
p {{ font-size:.9rem; color:#a3a8b3; line-height:1.5; }}
</style></head>
<body><div class="card"><h1>{titulo}</h1><p>{mensaje}</p></div></body></html>"""


# ── Auth (admin-only, calcado de _auth_meli_oauth en app/routes_meli_oauth.py) ─

def _usuario_puede_gmail_oauth(usuario: dict | None) -> bool:
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


def _auth_gmail_oauth(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        from app.api_auth import bearer_token_from_request, chat_api_token_matches_request

        if chat_api_token_matches_request():
            request.gmail_oauth_usuario = {"nombre": "Administrador (token)"}
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
        if not _usuario_puede_gmail_oauth(usuario):
            return jsonify({"error": "Conexión Gmail requiere rol administrador"}), 403
        request.gmail_oauth_usuario = usuario
        return f(*args, **kwargs)

    return wrapper


def register_gmail_oauth_routes(app):
    @app.route("/api/gmail-oauth/estado", methods=["GET"])
    @app.route("/app/api/gmail-oauth/estado", methods=["GET"])
    @_auth_gmail_oauth
    def gmail_oauth_estado():
        estado = estado_token_gmail()
        meta = _leer_meta()
        return jsonify(
            {
                "valido": bool(estado.get("valido")),
                "motivo": estado.get("motivo"),
                "expira": estado.get("expira"),
                "existe_token": os.path.exists(TOKEN_GMAIL_PATH),
                "cliente_configurado": _cliente_configurado(),
                "email": meta.get("email"),
                "conectado_en": meta.get("conectado_en"),
                "redirect_uri": REDIRECT_URI,
            }
        )

    @app.route("/api/gmail-oauth/auth-url", methods=["GET"])
    @app.route("/app/api/gmail-oauth/auth-url", methods=["GET"])
    @_auth_gmail_oauth
    def gmail_oauth_auth_url():
        if not _cliente_configurado():
            return jsonify({"error": "credenciales_google.json no tiene client_id/client_secret."}), 400
        try:
            flow = _construir_flow()
            url, state = flow.authorization_url(
                access_type="offline",
                prompt="consent",
                include_granted_scopes="true",
            )
        except Exception as e:
            return jsonify({"error": str(e)[:300]}), 500

        _limpiar_estados_expirados()
        _ESTADOS_PENDIENTES[state] = {
            "exp": time.time() + _ESTADO_TTL_SEG,
            "code_verifier": flow.code_verifier,
        }
        return jsonify({"url": url, "redirect_uri": REDIRECT_URI})

    @app.route("/api/gmail-oauth/callback", methods=["GET"])
    def gmail_oauth_callback():
        error = request.args.get("error")
        if error:
            return _pagina_html(
                "Autorización cancelada",
                f"Google reportó: {error}. Genera un nuevo link desde el panel e inténtalo de nuevo.",
                ok=False,
            )

        state = request.args.get("state") or ""
        code = request.args.get("code") or ""
        _limpiar_estados_expirados()
        if not state or state not in _ESTADOS_PENDIENTES:
            return _pagina_html(
                "Link inválido o expirado",
                "Genera un nuevo link de autorización desde Sistemas → Conexión Gmail y ábrelo de nuevo.",
                ok=False,
            )
        pendiente = _ESTADOS_PENDIENTES.pop(state, None)
        if not code:
            return _pagina_html(
                "Falta el código de autorización",
                "Google no devolvió un código. Genera un nuevo link e inténtalo de nuevo.",
                ok=False,
            )

        try:
            flow = _construir_flow(code_verifier=(pendiente or {}).get("code_verifier"))
            flow.fetch_token(code=code)
            creds = flow.credentials

            tmp = TOKEN_GMAIL_PATH + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                f.write(creds.to_json())
            os.replace(tmp, TOKEN_GMAIL_PATH)

            from googleapiclient.discovery import build

            perfil = build("gmail", "v1", credentials=creds).users().getProfile(userId="me").execute()
            email = perfil.get("emailAddress", "")
            from datetime import datetime

            _guardar_meta({"email": email, "conectado_en": datetime.now().isoformat()})
        except Exception as e:
            return _pagina_html(
                "No se pudo completar la conexión",
                f"Error al canjear el código: {str(e)[:300]}. Genera un nuevo link e inténtalo de nuevo.",
                ok=False,
            )

        return _pagina_html(
            "Gmail conectado ✅",
            f"Conectado como {email}. Puedes cerrar esta pestaña y volver al panel.",
            ok=True,
        )
