"""
Autenticación sitio web McKenna: OAuth Google (clientes) y sesión admin (pedidos).
No guardar tokens OAuth en sesión; solo email verificado + sub de Google.
Panel /admin/pedidos: token WEB_ADMIN_TOKEN/ADMIN_TOKEN y/o correos en WEB_ORDER_ADMIN_EMAILS.
"""
from __future__ import annotations

import logging
import os
import re
import secrets
import time
from collections import defaultdict
from typing import Any
from urllib.parse import urlencode

import requests

log = logging.getLogger("site_auth")

# ── Sesión cliente (prefijo para no chocar con carrito Flask) ─────────────
SESSION_CUSTOMER_EMAIL = "mckg_cust_email"
SESSION_CUSTOMER_SUB = "mckg_cust_sub"
SESSION_OAUTH_STATE = "mckg_oauth_state"
SESSION_POST_LOGIN_NEXT = "mckg_oauth_next"

# ── Sesión admin ───────────────────────────────────────────────────────────
SESSION_ADMIN_OK = "mckg_admin_ok"
SESSION_ADMIN_CSRF = "mckg_admin_csrf"

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"

# Anti fuerza bruta login admin: máx intentos por ventana
_ADMIN_FAILS: defaultdict[str, list[float]] = defaultdict(list)
_ADMIN_MAX_ATTEMPTS = 8
_ADMIN_WINDOW_SEC = 900

_site_url = lambda: os.getenv("SITE_URL", os.getenv("WEB_SITE_URL", "https://mckennagroup.co")).rstrip("/")


def google_oauth_configured() -> bool:
    cid = (os.getenv("GOOGLE_OAUTH_CLIENT_ID") or "").strip()
    csec = (os.getenv("GOOGLE_OAUTH_CLIENT_SECRET") or "").strip()
    return bool(cid and csec)


def google_redirect_uri() -> str:
    explicit = (os.getenv("GOOGLE_OAUTH_REDIRECT_URI") or "").strip()
    if explicit:
        return explicit.rstrip("/")
    return f"{_site_url()}/auth/google/callback"


def build_google_authorize_url(state: str) -> str:
    cid = (os.getenv("GOOGLE_OAUTH_CLIENT_ID") or "").strip()
    params = {
        "client_id": cid,
        "redirect_uri": google_redirect_uri(),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "online",
        "include_granted_scopes": "true",
        "prompt": "select_account",
    }
    return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"


def exchange_code_for_profile(code: str) -> dict[str, Any] | None:
    """Intercambia code por userinfo. No devuelve ni registra access_token."""
    cid = (os.getenv("GOOGLE_OAUTH_CLIENT_ID") or "").strip()
    csec = (os.getenv("GOOGLE_OAUTH_CLIENT_SECRET") or "").strip()
    if not code or not cid or not csec:
        return None
    try:
        res = requests.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": cid,
                "client_secret": csec,
                "redirect_uri": google_redirect_uri(),
                "grant_type": "authorization_code",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=15,
        )
        if res.status_code != 200:
            log.warning("Google token exchange HTTP %s", res.status_code)
            return None
        data = res.json()
        access = (data.get("access_token") or "").strip()
        if not access:
            return None
        ui = requests.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access}"},
            timeout=10,
        )
        if ui.status_code != 200:
            log.warning("Google userinfo HTTP %s", ui.status_code)
            return None
        info = ui.json()
        email = (info.get("email") or "").strip().lower()
        sub = (info.get("sub") or "").strip()
        verified = info.get("email_verified") is True
        if not email or not sub or not verified:
            log.warning("Google userinfo: email no verificado o datos incompletos")
            return None
        return {"email": email, "sub": sub}
    except Exception as e:
        log.warning("OAuth Google: %s", e)
        return None


def new_oauth_state() -> str:
    return secrets.token_urlsafe(32)


def admin_panel_token() -> str:
    t = (os.getenv("WEB_ADMIN_TOKEN") or "").strip()
    if t:
        return t
    return (os.getenv("ADMIN_TOKEN") or "").strip()


def order_admin_google_emails() -> frozenset[str]:
    """Correos (minúsculas) que, tras OAuth Google verificado, acceden a /admin/pedidos."""
    raw = (os.getenv("WEB_ORDER_ADMIN_EMAILS") or os.getenv("WEB_ORDER_ADMIN_EMAIL") or "").strip()
    if raw.startswith("\ufeff"):
        raw = raw.lstrip("\ufeff").strip()
    if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in "\"'":
        raw = raw[1:-1].strip()
    if not raw:
        return frozenset()
    out: set[str] = set()
    for part in re.split(r"[;,]", raw):
        e = part.strip().strip("'\"").lower()
        if e and "@" in e:
            out.add(e)
    return frozenset(out)


def session_is_google_order_admin(sess: dict) -> bool:
    emails = order_admin_google_emails()
    if not emails:
        return False
    e = (sess.get(SESSION_CUSTOMER_EMAIL) or "").strip().lower()
    return bool(e) and e in emails


def session_admin_orders_authorized(sess: dict) -> bool:
    """Token admin (WEB_ADMIN_TOKEN) o sesión Google con correo en WEB_ORDER_ADMIN_EMAILS."""
    if sess.get(SESSION_ADMIN_OK):
        return True
    return session_is_google_order_admin(sess)


def admin_panel_enabled() -> bool:
    """Panel /admin/pedidos: token de servicio y/o lista de correos admin OAuth."""
    return bool(admin_panel_token()) or bool(order_admin_google_emails())


def new_admin_csrf() -> str:
    return secrets.token_urlsafe(32)


def admin_csrf_ok(sess: dict, form_token: str | None) -> bool:
    if not form_token:
        return False
    expected = (sess.get(SESSION_ADMIN_CSRF) or "").strip()
    if not expected:
        return False
    return secrets.compare_digest(form_token.encode("utf-8"), expected.encode("utf-8"))


def admin_login_allowed(remote_addr: str) -> bool:
    now = time.time()
    ip = remote_addr or "unknown"
    window = _ADMIN_FAILS[ip]
    window[:] = [t for t in window if now - t < _ADMIN_WINDOW_SEC]
    return len(window) < _ADMIN_MAX_ATTEMPTS


def record_admin_login_fail(remote_addr: str) -> None:
    _ADMIN_FAILS[remote_addr or "unknown"].append(time.time())


def verify_admin_token(form_token: str) -> bool:
    expected = admin_panel_token()
    if not expected or not form_token:
        return False
    return secrets.compare_digest(
        form_token.strip().encode("utf-8"),
        expected.encode("utf-8"),
    )


def session_cookie_secure() -> bool:
    return (os.getenv("WEB_SESSION_SECURE", "").strip() in ("1", "true", "yes", "on"))
