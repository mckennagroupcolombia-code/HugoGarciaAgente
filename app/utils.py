import os
import json
import requests
import time
import hashlib
from dotenv import load_dotenv

# Cargar variables de entorno desde el archivo .env
load_dotenv()

# =========================================
#  UTILIDADES GENERALES Y DE COMUNICACIÓN
# =========================================
#
#  Este módulo contiene funciones de apoyo que son utilizadas por
#  diferentes partes de la aplicación. Originalmente estaban en
#  `core_sync.py`, pero han sido refactorizadas para una mayor
#  claridad y para eliminar dependencias circulares.
#
# =========================================

# --- Configuración de Mercado Libre ---
# La ruta a las credenciales de Meli se carga desde las variables de entorno.
MELI_CREDS_PATH = os.getenv("MELI_CREDS_PATH")
DEBUG_LOG_PATH = "/home/mckg/mi-agente/.cursor/debug-3731ff.log"
DEBUG_SESSION_ID = "3731ff"


def _debug_log(run_id: str, hypothesis_id: str, location: str, message: str, data: dict) -> None:
    # #region agent log
    try:
        payload = {
            "sessionId": DEBUG_SESSION_ID,
            "runId": run_id,
            "hypothesisId": hypothesis_id,
            "location": location,
            "message": message,
            "data": data,
            "timestamp": int(time.time() * 1000),
        }
        with open(DEBUG_LOG_PATH, "a", encoding="utf-8") as fp:
            fp.write(json.dumps(payload, ensure_ascii=True) + "\n")
    except Exception:
        pass
    # #endregion


def _cargar_config_meli_desde_archivo() -> dict | None:
    """Lee credenciales MeLi desde disco; retorna None si no hay JSON utilizable."""
    if not MELI_CREDS_PATH or not os.path.exists(MELI_CREDS_PATH):
        return None
    try:
        with open(MELI_CREDS_PATH, "r", encoding="utf-8") as f:
            raw = f.read()
        if not raw.strip():
            return None
        return json.loads(raw)
    except (OSError, json.JSONDecodeError):
        return None


def _persistir_seller_id_meli_en_config(config: dict, access_token: str) -> None:
    """
    Tras un token válido, alinea seller_id y user_id en el dict de credenciales
    con GET /users/me (mismo id para cuenta vendedor).
    Falla en silencio si la API no responde; no bloquea el refresh.
    """
    try:
        r = requests.get(
            "https://api.mercadolibre.com/users/me",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
        )
        if r.status_code != 200:
            return
        me = r.json()
        uid = me.get("id")
        if uid is None:
            return
        uid_int = int(uid)
        config["user_id"] = uid_int
        config["seller_id"] = uid_int
    except (ValueError, TypeError, requests.RequestException):
        pass


def _token_meli_es_valido(access_token: str) -> bool:
    """Valida token MeLi con GET /users/me."""
    token = str(access_token or "").strip()
    if not token:
        return False
    try:
        r = requests.get(
            "https://api.mercadolibre.com/users/me",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        return r.status_code == 200
    except requests.RequestException:
        return False


def refrescar_token_meli():
    """
    Refresca el token de acceso de Mercado Libre usando el refresh_token.

    Esta función es crucial para mantener la comunicación con la API de Meli.
    Ha sido mejorada con un manejo de errores más detallado.
    """
    run_id = f"meli-refresh-{int(time.time())}"
    if not MELI_CREDS_PATH or not os.path.exists(MELI_CREDS_PATH):
        print(f"❌ Error Crítico: No se encuentra el archivo de credenciales de Meli. Asegúrate de que la variable de entorno MELI_CREDS_PATH esté bien configurada.")
        if MELI_CREDS_PATH:
             print(f"   └──> Ruta configurada: {MELI_CREDS_PATH}")
        return None

    try:
        with open(MELI_CREDS_PATH, "r", encoding="utf-8") as f:
            raw = f.read()
        if not raw.strip():
            print(
                f"Credenciales MeLi vacías (0 bytes o solo espacios): {MELI_CREDS_PATH}\n"
                f"   └──> Restaurar credenciales_meli.json desde backup u OAuth."
            )
            notificar_sistemas_meli_cred(
                "*MeLi: archivo de credenciales vacío*\n\n"
                f"Ruta: `{MELI_CREDS_PATH}`\n"
                "Sin esto no hay preventa, postventa ni sync. Restaurar JSON con "
                "`app_id`, `client_secret`, `refresh_token` (y tokens) o repetir OAuth."
            )
            return None

        config = json.loads(raw)
        if not all(
            [
                config.get("app_id"),
                config.get("client_secret"),
                config.get("refresh_token"),
            ]
        ):
            print(
                "credenciales_meli.json incompleto: faltan app_id, client_secret o refresh_token."
            )
            notificar_sistemas_meli_cred(
                "*MeLi: credenciales incompletas*\n\n"
                f"Archivo: `{MELI_CREDS_PATH}`\n"
                "Faltan `app_id`, `client_secret` o `refresh_token`."
            )
            return None

        payload = {
            'grant_type': 'refresh_token',
            'client_id': config.get('app_id'),
            'client_secret': config.get('client_secret'),
            'refresh_token': config.get('refresh_token')
        }
        attempted_refresh_token = str(config.get("refresh_token") or "").strip()

        res = requests.post("https://api.mercadolibre.com/oauth/token", data=payload, timeout=10)
        res.raise_for_status()  # Lanza una excepción para errores HTTP (4xx o 5xx)

        try:
            new_data = res.json()
        except json.JSONDecodeError:
            snippet = (res.text or "")[:500]
            print(
                f"OAuth MeLi no devolvió JSON (HTTP {res.status_code}). Cuerpo: {snippet!r}"
            )
            notificar_sistemas_meli_cred(
                "*MeLi: respuesta OAuth no JSON*\n\n"
                f"HTTP {res.status_code}. Revisar red o api.mercadolibre.com.\n"
                f"Inicio respuesta: `{snippet[:120]}`"
            )
            return None
        if 'access_token' in new_data:
            # Actualizar solo los tokens, preservando el resto del archivo.
            config['access_token'] = new_data['access_token']
            # A menudo, también se devuelve un nuevo refresh_token.
            if 'refresh_token' in new_data:
                config['refresh_token'] = new_data['refresh_token']

            _persistir_seller_id_meli_en_config(config, config["access_token"])

            with open(MELI_CREDS_PATH, "w", encoding="utf-8") as f:
                json.dump(config, f, indent=4)

            print("✅ Token de Mercado Libre refrescado exitosamente.")
            _debug_log(
                run_id,
                "H2",
                "app/utils.py:refrescar_token_meli:success",
                "Refresh success",
                {"rotated_refresh_token": bool("refresh_token" in new_data)},
            )
            return config['access_token']
        else:
            print(f"❌ Error: La respuesta de la API de Meli no contenía un 'access_token'. Respuesta: {new_data}")
            return None

    except requests.exceptions.HTTPError as http_err:
        print(f"Error HTTP al refrescar token de Meli: {http_err}")
        print(f"   └──> Respuesta del servidor: {res.text}")
        desc = (res.text or "")[:300]
        err_code = ""
        try:
            err_j = res.json()
            desc = str(err_j.get("message") or err_j.get("error") or err_j)[:300]
            err_code = str(err_j.get("error") or "").strip().lower()
        except (json.JSONDecodeError, ValueError, TypeError):
            pass
        if err_code == "invalid_grant":
            cfg = _cargar_config_meli_desde_archivo() or {}
            fallback_token = str(cfg.get("access_token") or "").strip()
            current_refresh_token = str(cfg.get("refresh_token") or "").strip()
            creds_mtime_age_sec = None
            if MELI_CREDS_PATH and os.path.exists(MELI_CREDS_PATH):
                try:
                    creds_mtime_age_sec = int(time.time() - os.path.getmtime(MELI_CREDS_PATH))
                except OSError:
                    creds_mtime_age_sec = -1
            _debug_log(
                run_id,
                "H8",
                "app/utils.py:refrescar_token_meli:invalid_grant_snapshot",
                "Invalid grant runtime snapshot",
                {
                    "attempted_refresh_token_len": len(attempted_refresh_token),
                    "current_refresh_token_len": len(current_refresh_token),
                    "refresh_token_same": attempted_refresh_token == current_refresh_token,
                    "attempted_refresh_token_hash8": hashlib.sha256(attempted_refresh_token.encode("utf-8")).hexdigest()[:8] if attempted_refresh_token else "",
                    "current_refresh_token_hash8": hashlib.sha256(current_refresh_token.encode("utf-8")).hexdigest()[:8] if current_refresh_token else "",
                    "creds_mtime_age_sec": creds_mtime_age_sec,
                    "fallback_token_available": bool(fallback_token),
                },
            )
            if fallback_token:
                if _token_meli_es_valido(fallback_token):
                    print(
                        "⚠️ OAuth devolvió invalid_grant, pero access_token en disco sigue válido. "
                        "Posible rotación concurrente de refresh_token; usando token actual."
                    )
                    return fallback_token
                print(
                    "❌ OAuth devolvió invalid_grant y access_token en disco NO es válido. "
                    "Se requiere renovar OAuth de Mercado Libre."
                )
        notificar_sistemas_meli_cred(
            "*MeLi: falló refresco de token (HTTP)*\n\n"
            f"Detalle: `{desc}`\n"
            "Si el refresh expiró, generar nuevo token en la app de MeLi (OAuth)."
        )
    except json.JSONDecodeError as e:
        print(
            f"credenciales_meli.json no es JSON válido: {e}\n"
            f"   └──> Archivo: {MELI_CREDS_PATH}"
        )
        notificar_sistemas_meli_cred(
            "*MeLi: JSON de credenciales inválido*\n\n"
            f"`{MELI_CREDS_PATH}` — corregir o restaurar desde backup."
        )
    except Exception as e:
        print(f"Error crítico al refrescar el token de Meli: {e}")

    return None


_MELI_SELLER_ID_DEFAULT = 432439187


def obtener_seller_id_meli() -> int:
    """
    User ID del vendedor autenticado (URLs post_sale, orders/search, filtro from).
    Prioriza seller_id / user_id en credenciales JSON; fallback al ID histórico del repo.
    """
    path = MELI_CREDS_PATH or ""
    try:
        if path and os.path.isfile(path):
            with open(path, "r", encoding="utf-8") as f:
                c = json.load(f)
            sid = c.get("seller_id") or c.get("user_id")
            if sid is not None and str(sid).strip() != "":
                sid_int = int(sid)
                if sid_int > 0:
                    return sid_int
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        pass
    return _MELI_SELLER_ID_DEFAULT


# --- Comunicación con el Servidor de Notificaciones (WhatsApp) ---
# Las constantes de URL y teléfono se cargan desde variables de entorno.
URL_API_WHATSAPP = os.getenv("URL_API_WHATSAPP", "http://127.0.0.1:3000/enviar")
URL_API_WHATSAPP_ARCHIVO = os.getenv("URL_API_WHATSAPP_ARCHIVO", "http://127.0.0.1:3000/enviar-archivo")
TELEFONO_GRUPO_REPORTE = os.getenv("TELEFONO_GRUPO_REPORTE", "120363407538342427@g.us")


_JID_PREVENTA_DEFAULT = "120363393955474672@g.us"
_JID_POSTVENTA_DEFAULT = "120363406693905719@g.us"
_JID_ALERTAS_SISTEMAS_DEFAULT = "120363425113254825@g.us"


def _wa_jid_env(name: str, default_jid: str) -> str:
    """Lee JID de entorno; quita comentario inline (#) como en systemd EnvironmentFile."""
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default_jid
    return raw.split("#")[0].strip() or default_jid


def jid_grupo_alertas_sistemas_wa() -> str:
    """Backup nocturno, auditoría de scripts (cron) y alertas operativas del agente."""
    return _wa_jid_env("GRUPO_ALERTAS_SISTEMAS_WA", _JID_ALERTAS_SISTEMAS_DEFAULT)


def jid_grupo_preventa_wa() -> str:
    """Solo preventa MeLi — GRUPO_PREVENTA_WA o default oficial Preventa_Meli."""
    return _wa_jid_env("GRUPO_PREVENTA_WA", _JID_PREVENTA_DEFAULT)


def jid_grupo_postventa_wa() -> str:
    """Solo mensajes postventa MeLi — GRUPO_POSTVENTA_WA o default oficial Postventa_Meli."""
    return _wa_jid_env("GRUPO_POSTVENTA_WA", _JID_POSTVENTA_DEFAULT)


_JID_INVENTARIO_DEFAULT = "120363407538342427@g.us"


def jid_grupo_inventario_wa() -> str:
    """Stock, reportes de inventario, SKUs — GRUPO_INVENTARIO_WA (quita # comentario systemd)."""
    return _wa_jid_env("GRUPO_INVENTARIO_WA", _JID_INVENTARIO_DEFAULT)


def _normalizar_destino_wa(destino: str | None) -> str:
    """JID o número: strip y comentario inline (#) por si llega desde .env sin pasar por _wa_jid_env."""
    if not destino:
        return ""
    return destino.split("#", 1)[0].strip()


def meli_postventa_id_mensaje(msg: dict) -> str:
    """ID estable para deduplicar (MeLi usa `id` o `message_id` según versión de API)."""
    return str(msg.get("id") or msg.get("message_id") or "").strip()


def meli_postventa_remitente_user_id(msg: dict) -> str:
    """
    user_id del remitente en mensajes postventa (API /messages/packs/... puede variar forma de `from`).
    Si `from` no es dict (p. ej. int), evita AttributeError que antes podía tumbar todo el lote.
    """
    f = msg.get("from")
    if isinstance(f, dict):
        uid = f.get("user_id")
        if uid is not None and str(uid).strip() != "":
            return str(uid).strip()
        return ""
    if isinstance(f, (int, float)):
        return str(int(f))
    if isinstance(f, str) and f.strip():
        return f.strip()
    for k in ("from_user_id", "sender_id"):
        v = msg.get(k)
        if v is not None and str(v).strip() != "":
            return str(v).strip()
    return ""


def meli_postventa_nombre_remitente(msg: dict, remitente_uid: str) -> str:
    f = msg.get("from")
    if isinstance(f, dict):
        n = (f.get("name") or "").strip()
        if n:
            return n
    return f"Comprador {remitente_uid}" if remitente_uid else "Comprador"


def meli_postventa_texto_para_notif(msg: dict) -> str:
    """
    Texto legible para alerta WhatsApp.
    MeLi a veces devuelve `text` como string, a veces como {"plain": "..."}.
    Si el comprador solo adjunta PDF/imagen (RUT, factura), `text` viene vacío pero hay `attachments`.
    Sin esto, el mensaje se ignoraba silenciosamente (`continue` con texto vacío).
    """
    raw = msg.get("text")
    if isinstance(raw, str):
        t = raw.strip()
    elif isinstance(raw, dict):
        inner = raw.get("plain") or raw.get("text") or ""
        t = inner.strip() if isinstance(inner, str) else (str(inner).strip() if inner else "")
    elif raw is None:
        t = ""
    else:
        t = str(raw).strip()

    if not t:
        alt = msg.get("text_translated")
        if isinstance(alt, str) and alt.strip():
            t = alt.strip()

    attachments = (
        msg.get("attachments")
        or msg.get("message_attachments")
        or []
    )
    if isinstance(attachments, dict):
        attachments = [attachments]
    if not isinstance(attachments, list):
        attachments = []

    if t:
        return t

    if not attachments:
        return ""

    nombres = []
    for a in attachments[:8]:
        if isinstance(a, dict):
            fn = (
                a.get("original_filename")
                or a.get("filename")
                or a.get("name")
                or ""
            ).strip()
            if not fn and a.get("id") is not None:
                fn = str(a.get("id")).strip()
            if fn:
                nombres.append(fn)
    if nombres:
        arch = ", ".join(nombres)
    else:
        arch = f"{len(attachments)} archivo(s)"
    return (
        f"[Solo adjunto(s) en MeLi: {arch}] "
        f"— revisar conversación en Mercado Libre (p. ej. RUT / factura en PDF)."
    )


def enviar_whatsapp_reporte(texto_mensaje: str, numero_destino: str = None):
    """
    Envía un mensaje de texto al grupo de WhatsApp designado para reportes.
    Utiliza un servidor intermediario (Node.js) para la conexión con WhatsApp.
    """
    destino = _normalizar_destino_wa(
        numero_destino if numero_destino else TELEFONO_GRUPO_REPORTE
    )
    payload = {"numero": destino, "mensaje": texto_mensaje}
    max_intentos = 3

    for i in range(max_intentos):
        try:
            res = requests.post(URL_API_WHATSAPP, json=payload, timeout=30)

            if res.status_code == 200:
                print("✅ Reporte enviado a WhatsApp con éxito.")
                return True
            # Puente Node suele responder 503 mientras WhatsApp aún no está listo ("Sincronizando...")
            if res.status_code == 503 and i < max_intentos - 1:
                print(
                    f"⚠️ WhatsApp bridge 503 (intento {i + 1}/{max_intentos}), "
                    f"reintentando en 5s…"
                )
                time.sleep(5)
                continue
            print(
                f"❌ Error al enviar reporte a WhatsApp. Código: {res.status_code}, "
                f"Respuesta: {res.text}"
            )
            return False

        except requests.RequestException as e:
            if i < max_intentos - 1:
                print(
                    f"⚠️ Conexión al bridge WhatsApp falló ({e}), "
                    f"reintento {i + 1}/{max_intentos} en 3s…"
                )
                time.sleep(3)
                continue
            print(f"❌ Error de conexión con el servidor de notificaciones: {e}")
            return False

    return False

def enviar_whatsapp_archivo(file_path: str, texto_mensaje: str = "", file_name: str = None, numero_destino: str = None):
    """
    Envía un archivo (PDF, Imagen, etc.) al grupo de WhatsApp designado para reportes.
    """
    destino = _normalizar_destino_wa(
        numero_destino if numero_destino else TELEFONO_GRUPO_REPORTE
    )
    payload = {
        "numero": destino,
        "mensaje": texto_mensaje,
        "filePath": file_path,
        "fileName": file_name
    }

    try:
        res = requests.post(URL_API_WHATSAPP_ARCHIVO, json=payload, timeout=60)
        if res.status_code == 200:
            print(f"✅ Archivo {file_path} enviado a WhatsApp con éxito.")
            return True
        else:
            print(f"❌ Error al enviar archivo a WhatsApp. Código: {res.status_code}, Respuesta: {res.text}")
            return False
    except requests.RequestException as e:
        print(f"❌ Error de conexión al enviar archivo por WhatsApp: {e}")
        return False


_meli_cred_whatsapp_ultimo_ts = 0.0
MELI_CRED_WHATSAPP_COOLDOWN_SEC = 1800


def notificar_sistemas_meli_cred(mensaje: str) -> None:
    """Aviso al grupo GRUPO_ALERTAS_SISTEMAS_WA (con cooldown) cuando MeLi no es operable."""
    global _meli_cred_whatsapp_ultimo_ts
    now = time.time()
    if now - _meli_cred_whatsapp_ultimo_ts < MELI_CRED_WHATSAPP_COOLDOWN_SEC:
        return
    _meli_cred_whatsapp_ultimo_ts = now
    try:
        enviar_whatsapp_reporte(
            mensaje, numero_destino=jid_grupo_alertas_sistemas_wa()
        )
    except Exception:
        pass
