import os
import json
import requests
import time
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


def refrescar_token_meli():
    """
    Refresca el token de acceso de Mercado Libre usando el refresh_token.

    Esta función es crucial para mantener la comunicación con la API de Meli.
    Ha sido mejorada con un manejo de errores más detallado.
    """
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
            return config['access_token']
        else:
            print(f"❌ Error: La respuesta de la API de Meli no contenía un 'access_token'. Respuesta: {new_data}")
            return None

    except requests.exceptions.HTTPError as http_err:
        print(f"Error HTTP al refrescar token de Meli: {http_err}")
        print(f"   └──> Respuesta del servidor: {res.text}")
        desc = (res.text or "")[:300]
        try:
            err_j = res.json()
            desc = str(err_j.get("message") or err_j.get("error") or err_j)[:300]
        except (json.JSONDecodeError, ValueError, TypeError):
            pass
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


def meli_postventa_id_mensaje(msg: dict) -> str:
    """ID estable para deduplicar (MeLi usa `id` o `message_id` según versión de API)."""
    return str(msg.get("id") or msg.get("message_id") or "").strip()


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

    attachments = msg.get("attachments") or []
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
            fn = (a.get("original_filename") or a.get("filename") or "").strip()
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
    destino = numero_destino if numero_destino else TELEFONO_GRUPO_REPORTE
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
    destino = numero_destino if numero_destino else TELEFONO_GRUPO_REPORTE
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
