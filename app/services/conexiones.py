"""Conexiones e integraciones: estado EN VIVO de cada una y cómo reconectarla.

Panel /app → Sistemas → Conexiones (28-sep-2026). Nació porque el token de Gmail
venció el 26-sep y nadie supo dónde mirar: la copia de abonos Bancolombia a la
asesora quedó detenida dos días. Antes cada reautorización vivía en un sitio
distinto (panel MeLi, panel Gmail, QR en el panel WhatsApp, scripts sueltos) y
el semáforo de `/api/status` solo miraba si existía el archivo de credenciales.

Cada integración se prueba de verdad contra su API con una llamada barata de
lectura. Ninguna consume tokens de LLM: Anthropic y Gemini se prueban listando
modelos, que no se factura. Resultado en caché `CACHE_S` segundos para que el
panel no golpee las APIs en cada recarga; `forzar=True` salta la caché.

Estados: ok | alerta | caido | sin_configurar.
"""

from __future__ import annotations

import json
import os
import smtplib
import threading
import time
from concurrent.futures import ThreadPoolExecutor, wait
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import requests

REPO = Path(__file__).resolve().parents[2]
CACHE_S = 60
TIMEOUT_S = 12
# Mientras la app OAuth de Google Cloud siga en modo «Testing», Google corta el
# refresh token a los 7 días exactos (19-sep 15:55 → 26-sep 15:30). Si se publica
# la app («In production»), poner GMAIL_OAUTH_MODO_PRUEBA=0 y desaparece el aviso.
GMAIL_DIAS_VIGENCIA_PRUEBA = 7

_cache: dict[str, dict[str, Any]] = {}
_lock = threading.Lock()


# ─────────────────────────────────────────────────────────────── utilidades

def _r(estado: str, detalle: str, **extra: Any) -> dict[str, Any]:
    return {"estado": estado, "detalle": detalle, **extra}


def _leer_json(ruta: str | Path) -> dict:
    try:
        with open(ruta, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _env(nombre: str) -> str:
    return (os.getenv(nombre) or "").strip().strip('"').strip("'")


def _http_error(resp: requests.Response) -> str:
    try:
        cuerpo = resp.json()
        msg = cuerpo.get("message") or cuerpo.get("error") or cuerpo
        if isinstance(msg, dict):
            msg = msg.get("message") or json.dumps(msg)[:160]
    except Exception:
        msg = (resp.text or "")[:160]
    return f"HTTP {resp.status_code}: {str(msg)[:200]}"


# ─────────────────────────────────────────────────────────────── chequeos

def _check_whatsapp_principal() -> dict:
    base = _env("WHATSAPP_BRIDGE_URL").rstrip("/")
    if not base:
        enviar = _env("URL_API_WHATSAPP") or "http://127.0.0.1:3000/enviar"
        base = enviar.rsplit("/", 1)[0] if "/enviar" in enviar else "http://127.0.0.1:3000"
    tok = _env("WHATSAPP_BRIDGE_INTERNAL_TOKEN")
    try:
        r = requests.get(f"{base}/session/status", headers={"X-Bridge-Token": tok} if tok else {}, timeout=6)
    except Exception as e:
        return _r("caido", f"El puente :3000 no responde ({type(e).__name__}).")
    if r.status_code != 200:
        return _r("caido", f"Puente :3000 → {_http_error(r)}")
    d = r.json()
    if d.get("waSesionOperativa") or d.get("conectado"):
        return _r("ok", f"Vinculado a +{d.get('numero') or '?'} ({d.get('pushname') or 'sin nombre'}).",
                  cuenta=d.get("numero"))
    if d.get("qrPendiente"):
        return _r("caido", "Sin sesión: hay un QR esperando ser escaneado.", qr=True)
    if d.get("sesionReseteando"):
        return _r("alerta", "Cambiando de cuenta; el QR sale en 1–2 min.")
    return _r("alerta", "El puente está arriba pero aún no hay sesión.")


def _check_whatsapp_supervisor() -> dict:
    base = _env("SUPERVISOR_BRIDGE_URL").rstrip("/") or f"http://127.0.0.1:{_env('SUPERVISOR_PORT') or '3001'}"
    tok = _env("WHATSAPP_SUPERVISOR_TOKEN")
    try:
        r = requests.get(f"{base}/status", headers={"X-Bridge-Token": tok} if tok else {}, timeout=6)
    except Exception as e:
        return _r("caido", f"El puente supervisor :3001 no responde ({type(e).__name__}).")
    if r.status_code != 200:
        return _r("caido", f"Supervisor :3001 → {_http_error(r)}")
    d = r.json()
    if d.get("listo"):
        return _r("ok", f"Vinculado a +{d.get('numero') or '?'} ({d.get('pushname') or 'sin nombre'}).",
                  cuenta=d.get("numero"))
    if d.get("ultimoQr"):
        return _r("caido", "Sin sesión: hay un QR esperando ser escaneado.", qr=True)
    return _r("alerta", "El puente está arriba pero aún no hay sesión.")


def _check_meli() -> dict:
    ruta = _env("MELI_CREDS_PATH") or str(REPO / "credenciales_meli.json")
    creds = _leer_json(ruta)
    if not creds:
        return _r("sin_configurar", "No hay credenciales_meli.json (o está vacío).")
    if not creds.get("refresh_token"):
        return _r("caido", "Falta el refresh_token: hay que autorizar la app de nuevo.")

    def _yo(token: str) -> requests.Response:
        return requests.get("https://api.mercadolibre.com/users/me",
                            headers={"Authorization": f"Bearer {token}"}, timeout=TIMEOUT_S)

    r = _yo(creds.get("access_token") or "")
    renovado = False
    if r.status_code in (401, 403):
        # El access_token dura 6 h; el renovado normal lo hacen los servicios. Si
        # venció, se intenta renovar una vez (con el mismo candado que el resto).
        from app.utils import refrescar_token_meli

        nuevo = refrescar_token_meli()
        if not nuevo:
            return _r("caido", "El token venció y la renovación falló: la app quedó desautorizada o inactiva.")
        r = _yo(nuevo if isinstance(nuevo, str) else _leer_json(ruta).get("access_token", ""))
        renovado = True
    if r.status_code != 200:
        return _r("caido", f"MercadoLibre → {_http_error(r)}")
    d = r.json()
    return _r("ok", f"Cuenta {d.get('nickname') or d.get('id')}" + (" (token renovado ahora)." if renovado else "."),
              cuenta=d.get("nickname"))


def _check_gmail() -> dict:
    from app.tools.sincronizar_facturas_de_compra_siigo import TOKEN_GMAIL_PATH, estado_token_gmail

    est = estado_token_gmail()
    meta = _leer_json(REPO / "app" / "data" / "gmail_oauth_meta.json")
    cuenta = meta.get("email") or "mckenna.group.colombia@gmail.com"
    if not est.get("valido"):
        motivo = est.get("motivo") or "token inválido"
        if not os.path.exists(TOKEN_GMAIL_PATH):
            motivo = "no hay token guardado (se borró al vencer)"
        return _r("caido", f"{cuenta}: {motivo}. Se detienen la copia de abonos Bancolombia y la lectura de facturas.",
                  cuenta=cuenta)
    if _env("GMAIL_OAUTH_MODO_PRUEBA") != "0" and meta.get("conectado_en"):
        try:
            vence = datetime.fromisoformat(meta["conectado_en"]) + timedelta(days=GMAIL_DIAS_VIGENCIA_PRUEBA)
            faltan = vence - datetime.now()
            txt = f"{cuenta} conectado. Vence ~{vence:%d-%b %H:%M} (app OAuth en modo prueba: 7 días)."
            if faltan < timedelta(days=2):
                return _r("alerta", txt + " Reconecta antes de que caiga.", cuenta=cuenta, vence=vence.isoformat())
            return _r("ok", txt, cuenta=cuenta, vence=vence.isoformat())
        except ValueError:
            pass
    return _r("ok", f"{cuenta} conectado.", cuenta=cuenta)


def _check_google_cuenta_servicio() -> dict:
    ruta = _env("GOOGLE_SERVICE_ACCOUNT_PATH") or str(REPO / "mi-agente-ubuntu-9043f67d9755.json")
    if not os.path.exists(ruta):
        return _r("sin_configurar", f"No está el JSON de la cuenta de servicio ({Path(ruta).name}).")
    try:
        from google.auth.transport.requests import Request
        from google.oauth2 import service_account

        cred = service_account.Credentials.from_service_account_file(
            ruta, scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"])
        cred.refresh(Request())
    except Exception as e:
        return _r("caido", f"La llave de la cuenta de servicio fue rechazada: {str(e)[:200]}")
    return _r("ok", f"{cred.service_account_email}", cuenta=cred.service_account_email)


def _check_alegra() -> dict:
    email, token = _env("ALEGRA_EMAIL"), _env("ALEGRA_TOKEN")
    if not email or not token:
        return _r("sin_configurar", "Faltan ALEGRA_EMAIL / ALEGRA_TOKEN en .env.")
    r = requests.get("https://api.alegra.com/api/v1/company", auth=(email, token), timeout=TIMEOUT_S)
    if r.status_code in (401, 403):
        return _r("caido", f"Alegra rechazó el token de {email}: {_http_error(r)}")
    if r.status_code != 200:
        return _r("alerta", f"Alegra → {_http_error(r)} (puede ser caída temporal de Alegra).")
    d = r.json()
    return _r("ok", f"{d.get('name') or 'Empresa'} · usuario {email}.", cuenta=email)


def _check_siigo() -> dict:
    ruta = os.path.expanduser("~/mi-agente/credenciales_SIIGO.json")
    creds = _leer_json(ruta)
    if not creds.get("username") or not creds.get("api_key"):
        return _r("sin_configurar", "No hay credenciales_SIIGO.json.")
    from app.services.siigo import PARTNER_ID

    r = requests.post("https://api.siigo.com/auth",
                      json={"username": creds["username"], "access_key": creds["api_key"]},
                      headers={"Partner-Id": PARTNER_ID}, timeout=TIMEOUT_S)
    if r.status_code != 200:
        return _r("caido", f"Siigo rechazó la llave: {_http_error(r)}")
    return _r("ok", f"Usuario {creds['username']} (legado: la facturación ya va por Alegra).", cuenta=creds["username"])


def _check_mercadopago() -> dict:
    token = _env("MP_ACCESS_TOKEN")
    if not token:
        return _r("sin_configurar", "Falta MP_ACCESS_TOKEN en .env.")
    r = requests.get("https://api.mercadopago.com/users/me", headers={"Authorization": f"Bearer {token}"},
                     timeout=TIMEOUT_S)
    if r.status_code != 200:
        return _r("caido", f"Mercado Pago → {_http_error(r)}")
    d = r.json()
    return _r("ok", f"Cuenta {d.get('nickname') or d.get('email') or d.get('id')}.", cuenta=d.get("nickname"))


def _check_smtp() -> dict:
    usuario = _env("SMTP_USER") or _env("EMAIL_SENDER")
    clave = _env("SMTP_PASSWORD") or _env("EMAIL_PASSWORD")
    host = _env("SMTP_HOST") or ("smtp.gmail.com" if usuario else "")
    if not usuario or not clave:
        return _r("sin_configurar", "Faltan SMTP_USER / SMTP_PASSWORD en .env.")
    try:
        with smtplib.SMTP(host, int(_env("SMTP_PORT") or 587), timeout=TIMEOUT_S) as s:
            s.starttls()
            s.login(usuario, clave.replace(" ", ""))
    except smtplib.SMTPAuthenticationError:
        return _r("caido", f"Gmail rechazó la contraseña de aplicación de {usuario}.", cuenta=usuario)
    except Exception as e:
        return _r("alerta", f"No se pudo hablar con {host}: {type(e).__name__}: {str(e)[:150]}", cuenta=usuario)
    return _r("ok", f"{usuario} vía {host}.", cuenta=usuario)


def _check_anthropic() -> dict:
    key = _env("ANTHROPIC_API_KEY")
    if not key:
        return _r("sin_configurar", "Falta ANTHROPIC_API_KEY en .env.")
    r = requests.get("https://api.anthropic.com/v1/models?limit=1",
                     headers={"x-api-key": key, "anthropic-version": "2023-06-01"}, timeout=TIMEOUT_S)
    if r.status_code in (401, 403):
        return _r("caido", f"La llave fue rechazada: {_http_error(r)}")
    if r.status_code != 200:
        return _r("alerta", f"Anthropic → {_http_error(r)}")
    return _r("ok", f"Llave válida (…{key[-4:]}). Prueba sin costo: solo lista modelos.")


def _check_gemini() -> dict:
    key = _env("GOOGLE_API_KEY")
    if not key:
        return _r("sin_configurar", "Falta GOOGLE_API_KEY en .env.")
    r = requests.get("https://generativelanguage.googleapis.com/v1beta/models",
                     params={"key": key, "pageSize": 1}, timeout=TIMEOUT_S)
    if r.status_code in (400, 401, 403):
        return _r("caido", f"La llave fue rechazada: {_http_error(r)}")
    if r.status_code != 200:
        return _r("alerta", f"Gemini → {_http_error(r)}")
    return _r("ok", f"Llave válida (…{key[-4:]}). Prueba sin costo: solo lista modelos.")


def _check_tunel() -> dict:
    url = "https://bot.mckennagroup.co/status"
    try:
        r = requests.get(url, timeout=TIMEOUT_S)
    except Exception as e:
        return _r("caido", f"{url} no responde ({type(e).__name__}): MeLi y los pagos web no pueden avisarnos.")
    if r.status_code != 200:
        return _r("caido", f"{url} → HTTP {r.status_code}.")
    return _r("ok", "bot.mckennagroup.co llega al servidor.")


# ─────────────────────────────────────────────────────────────── catálogo

# reconexion.tipo:
#   "qr"         — el panel muestra el QR del puente (ruta `qr_api`) para escanear.
#   "oauth_gmail" / "oauth_meli" — el panel incrusta el asistente OAuth que ya existía.
#   "guia"       — pasos manuales (llaves que se generan en la consola del proveedor).
CONEXIONES: list[dict[str, Any]] = [
    {
        "id": "whatsapp_principal", "nombre": "WhatsApp principal", "grupo": "Mensajería",
        "check": _check_whatsapp_principal,
        "que_se_cae": ["Bot de ventas y respuestas a clientes", "Avisos a los grupos (pagos, facturación, despachos)",
                       "Comandos del equipo (ok/no, resp, facturar…)"],
        "reconexion": {"tipo": "qr", "qr_api": "/api/bot/bridge/status"},
        "pasos": [
            "Ten a mano el celular de la línea de la empresa (+57 319 518 3596).",
            "Si el QR no aparece en 1–2 min, reinicia el puente: `sudo systemctl restart mckenna-whatsapp-bridge`.",
            "En el celular: WhatsApp → Dispositivos vinculados → Vincular un dispositivo → escanea el QR de aquí.",
            "Espera a que este recuadro pase a verde (puede tardar 1 min mientras sincroniza chats).",
        ],
    },
    {
        "id": "whatsapp_supervisor", "nombre": "WhatsApp supervisor", "grupo": "Mensajería",
        "check": _check_whatsapp_supervisor,
        "que_se_cae": ["Alertas de ventas y abonos por WhatsApp a la asesora", "Voz IA del supervisor"],
        "reconexion": {"tipo": "qr", "qr_api": "/api/supervisor/bridge/status"},
        "pasos": [
            "Ten a mano el celular personal vinculado al supervisor.",
            "Si el QR no aparece, reinicia: `sudo systemctl restart mckenna-whatsapp-supervisor`.",
            "WhatsApp → Dispositivos vinculados → Vincular un dispositivo → escanea el QR de aquí.",
        ],
    },
    {
        "id": "gmail", "nombre": "Gmail (OAuth)", "grupo": "Google",
        "check": _check_gmail,
        "que_se_cae": ["Copia de abonos Bancolombia a la asesora", "Facturas de compra desde el correo",
                       "Catálogos de proveedores y certificados de retención"],
        "reconexion": {"tipo": "oauth_gmail"},
        "pasos": [
            "Pulsa «Generar link de autorización» y ábrelo.",
            "Entra con mckenna.group.colombia@gmail.com (el buzón donde llegan las alertas de Bancolombia).",
            "Si Google avisa «app no verificada»: Configuración avanzada → Ir a (no seguro). Acepta todos los permisos.",
            "La pestaña dice «Gmail conectado ✅»; este recuadro pasa a verde solo.",
            "Para que no venza cada 7 días: Google Cloud Console → APIs y servicios → Pantalla de consentimiento "
            "OAuth → «Publicar app» (pasar a producción). Luego poner GMAIL_OAUTH_MODO_PRUEBA=0 en .env.",
        ],
    },
    {
        "id": "google_cuenta_servicio", "nombre": "Google Sheets y Drive (cuenta de servicio)", "grupo": "Google",
        "check": _check_google_cuenta_servicio,
        "que_se_cae": ["Catálogo y fichas en Google Sheets", "Documentos técnicos en Drive"],
        "reconexion": {"tipo": "guia"},
        "pasos": [
            "Google Cloud Console → IAM → Cuentas de servicio → la cuenta del proyecto mi-agente-ubuntu.",
            "Pestaña Claves → Agregar clave → JSON. Se descarga un archivo.",
            "Cópialo al servidor como mi-agente-ubuntu-9043f67d9755.json (o apunta GOOGLE_SERVICE_ACCOUNT_PATH a él).",
            "`sudo systemctl restart agente-pro webhook-meli` y pulsa «Probar de nuevo».",
        ],
    },
    {
        "id": "mercadolibre", "nombre": "MercadoLibre", "grupo": "Ventas",
        "check": _check_meli,
        "que_se_cae": ["Preguntas preventa y mensajes posventa", "Órdenes, stock y envíos", "Facturación de ventas MeLi"],
        "reconexion": {"tipo": "oauth_meli"},
        "pasos": [
            "Paso 1 del asistente: confirma el Client ID (y el Secret si la app es nueva).",
            "Paso 2: abre el link, entra con la cuenta vendedora de McKenna y autoriza.",
            "MeLi te lleva a una página con un código TG-…: cópialo y pégalo en el paso 3.",
            "Después revisa en developers.mercadolibre.com que los tópicos (questions, orders_v2, messages, shipments) sigan activos.",
        ],
    },
    {
        "id": "mercadopago", "nombre": "Mercado Pago", "grupo": "Ventas",
        "check": _check_mercadopago,
        "que_se_cae": ["Pagos de la tienda web", "Liberaciones y reembolsos"],
        "reconexion": {"tipo": "guia"},
        "pasos": [
            "mercadopago.com.co/developers → Tus integraciones → la app de McKenna → Credenciales de producción.",
            "Copia el Access Token (APP_USR-…).",
            "En el servidor: reemplaza MP_ACCESS_TOKEN en .env.",
            "`sudo systemctl restart agente-pro mckenna-website` y pulsa «Probar de nuevo».",
        ],
    },
    {
        "id": "alegra", "nombre": "Alegra", "grupo": "Contabilidad",
        "check": _check_alegra,
        "que_se_cae": ["Facturación electrónica (DIAN)", "Cotizaciones, compras y solicitudes de pago", "Espejo contable para el contador"],
        "reconexion": {"tipo": "guia"},
        "pasos": [
            "Alegra → Configuración → Integraciones → API: copia el token (o genera uno nuevo).",
            "En el servidor: actualiza ALEGRA_TOKEN (y ALEGRA_EMAIL si cambió el usuario) en .env.",
            "`sudo systemctl restart agente-pro webhook-meli` y pulsa «Probar de nuevo».",
        ],
    },
    {
        "id": "siigo", "nombre": "Siigo (legado)", "grupo": "Contabilidad",
        "check": _check_siigo,
        "que_se_cae": ["Consultas históricas de Siigo (la facturación ya no depende de Siigo)"],
        "reconexion": {"tipo": "guia"},
        "pasos": [
            "Siigo Nube → Alianzas → Mi credencial API: copia usuario y access key.",
            "Actualiza username / api_key en credenciales_SIIGO.json y pulsa «Probar de nuevo».",
        ],
    },
    {
        "id": "smtp", "nombre": "Correo saliente (SMTP)", "grupo": "Google",
        "check": _check_smtp,
        "que_se_cae": ["Correos de pedidos web y facturas a clientes", "Recuperación de compras abandonadas"],
        "reconexion": {"tipo": "guia"},
        "pasos": [
            "Cuenta de Google del remitente → Seguridad → Verificación en 2 pasos → Contraseñas de aplicaciones.",
            "Crea una nueva (nombre «mi-agente») y copia las 16 letras.",
            "En el servidor: reemplaza SMTP_PASSWORD en .env.",
            "`sudo systemctl restart agente-pro mckenna-website` y pulsa «Probar de nuevo».",
        ],
    },
    {
        "id": "anthropic", "nombre": "Claude (Anthropic)", "grupo": "IA",
        "check": _check_anthropic,
        "que_se_cae": ["Respuestas del bot en WhatsApp, web y preventa MeLi (queda Gemini de respaldo)"],
        "reconexion": {"tipo": "guia"},
        "pasos": [
            "console.anthropic.com → API Keys → Create key. Revisa también Billing (saldo y límites).",
            "En el servidor: reemplaza ANTHROPIC_API_KEY en .env.",
            "`sudo systemctl restart agente-pro webhook-meli` y pulsa «Probar de nuevo».",
        ],
    },
    {
        "id": "gemini", "nombre": "Gemini (Google AI)", "grupo": "IA",
        "check": _check_gemini,
        "que_se_cae": ["Respaldo del bot si Claude falla", "Escáner de documentos técnicos y guiones de contenido"],
        "reconexion": {"tipo": "guia"},
        "pasos": [
            "aistudio.google.com → Get API key → crea o copia la llave del proyecto.",
            "En el servidor: reemplaza GOOGLE_API_KEY en .env.",
            "`sudo systemctl restart agente-pro webhook-meli` y pulsa «Probar de nuevo».",
        ],
    },
    {
        "id": "tunel", "nombre": "Túnel público (bot.mckennagroup.co)", "grupo": "Infraestructura",
        "check": _check_tunel,
        "que_se_cae": ["Notificaciones de MeLi", "Callbacks de pagos y OAuth", "Acceso al panel desde fuera de la oficina"],
        "reconexion": {"tipo": "guia"},
        "pasos": [
            "En el servidor, mira si corre: `pgrep -af cloudflared`.",
            "Si no está, levántalo con `./start.sh` (arranca el túnel con CLOUDFLARE_TUNNEL_TOKEN).",
            "Si corre pero no responde: dash.cloudflare.com → Zero Trust → Networks → Tunnels: revisa que el túnel esté «Healthy».",
        ],
    },
]

_POR_ID = {c["id"]: c for c in CONEXIONES}


def _publico(c: dict) -> dict:
    return {k: v for k, v in c.items() if k != "check"}


def _correr(c: dict) -> dict:
    t0 = time.monotonic()
    try:
        res = c["check"]()
    except Exception as e:  # noqa: BLE001 — un chequeo roto no tumba el panel
        res = _r("alerta", f"No se pudo verificar: {type(e).__name__}: {str(e)[:200]}")
    res["ms"] = int((time.monotonic() - t0) * 1000)
    res["verificado_en"] = datetime.now().isoformat(timespec="seconds")
    return res


def estado_conexiones(forzar: bool = False, solo: str | None = None) -> dict:
    """Estado de todas las conexiones (o de `solo`), en paralelo y con caché."""
    objetivos = [_POR_ID[solo]] if solo and solo in _POR_ID else CONEXIONES
    ahora = time.time()
    with _lock:
        pendientes = [c for c in objetivos
                      if forzar or ahora - _cache.get(c["id"], {}).get("_ts", 0) > CACHE_S]
    if pendientes:
        with ThreadPoolExecutor(max_workers=len(pendientes)) as pool:
            futuros = {c["id"]: pool.submit(_correr, c) for c in pendientes}
            wait(futuros.values(), timeout=TIMEOUT_S + 8)
            for cid, fut in futuros.items():
                res = fut.result() if fut.done() else _r("alerta", "La verificación tardó demasiado.")
                res["_ts"] = time.time()
                with _lock:
                    _cache[cid] = res
    items = []
    for c in objetivos:
        res = {k: v for k, v in _cache.get(c["id"], {}).items() if k != "_ts"}
        items.append({**_publico(c), **res})
    resumen = {e: sum(1 for i in items if i.get("estado") == e) for e in ("ok", "alerta", "caido", "sin_configurar")}
    return {"items": items, "resumen": resumen}

