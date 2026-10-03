"""La cookie que abre el panel.

`/app` y sus assets —el bundle de React— se servían a cualquiera que llegara al
dominio (verificado el 21-sep-2026: `GET https://bot.mckennagroup.co/app` → 200
sin sesión). Ahí van la estructura de módulos, los textos internos de cada panel
y la superficie de la API: es el mapa de la casa. Ahora el bundle pide sesión.

Lo único público es la pantalla de ingreso (`app/templates/ingreso_panel.html`),
HTML plano sin nada del proyecto adentro.

La cookie es HttpOnly (no la lee ningún script) y dura lo mismo que la sesión en
la tabla `sesiones`: 8 horas. No reemplaza al token Bearer —la API sigue igual—,
solo decide a quién se le entrega el bundle.
"""

from __future__ import annotations

from pathlib import Path

from flask import request

_PAGINA_INGRESO = Path(__file__).resolve().parent / "templates" / "ingreso_panel.html"

COOKIE = "mck_panel"
DURACION = 8 * 60 * 60


def gate_activo() -> bool:
    """Interruptor de emergencia: `PANEL_SIN_SESION=1` en el .env vuelve a
    servir el panel a cualquiera. Está para que un problema de ingreso se
    resuelva sin esperar a nadie, no para dejarlo así."""
    import os

    return (os.getenv("PANEL_SIN_SESION") or "").strip() != "1"


def _seguro() -> bool:
    # Detrás de Cloudflare la petición llega por HTTP: el proto real viene en el
    # encabezado. En local (http://127.0.0.1:8081) la cookie no puede ser Secure
    # o el navegador la descarta.
    proto = (request.headers.get("X-Forwarded-Proto") or "").split(",")[0].strip().lower()
    return proto == "https" or request.is_secure


def token_de_peticion() -> str:
    return (request.cookies.get(COOKIE) or "").strip()


def usuario_de_cookie():
    tok = token_de_peticion()
    if not tok:
        return None
    try:
        from app.services.tickets_db import get_usuario_by_token

        return get_usuario_by_token(tok)
    except Exception:
        return None


def usuario_de_token(token: str):
    token = (token or "").strip()
    if not token:
        return None
    try:
        from app.services.tickets_db import get_usuario_by_token

        return get_usuario_by_token(token)
    except Exception:
        return None


def es_colaborador(usuario) -> bool:
    """¿A este usuario le toca el build de colaboradores (dist-colab/)?"""
    if not usuario:
        return False
    try:
        from app.services.colaboradores import es_colaborador_externo

        return es_colaborador_externo(usuario)
    except Exception:
        return False


def token_valido(token: str) -> bool:
    token = (token or "").strip()
    if not token:
        return False
    try:
        from app.services.tickets_db import get_usuario_by_token

        return bool(get_usuario_by_token(token))
    except Exception:
        return False


def marcar(resp, token: str):
    """Deja la cookie del panel en la respuesta (login, Google, /app?_token=)."""
    if token:
        resp.set_cookie(COOKIE, token, max_age=DURACION, httponly=True,
                        secure=_seguro(), samesite="Lax", path="/app")
    return resp


def borrar(resp):
    resp.set_cookie(COOKIE, "", max_age=0, httponly=True, secure=_seguro(),
                    samesite="Lax", path="/app")
    return resp


def pagina_ingreso() -> str:
    """La pantalla de ingreso: HTML plano, sin nada del proyecto adentro."""
    return _PAGINA_INGRESO.read_text(encoding="utf-8")
