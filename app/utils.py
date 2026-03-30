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
        with open(MELI_CREDS_PATH, 'r') as f:
            config = json.load(f)

        payload = {
            'grant_type': 'refresh_token',
            'client_id': config.get('app_id'),
            'client_secret': config.get('client_secret'),
            'refresh_token': config.get('refresh_token')
        }

        res = requests.post("https://api.mercadolibre.com/oauth/token", data=payload, timeout=10)
        res.raise_for_status()  # Lanza una excepción para errores HTTP (4xx o 5xx)

        new_data = res.json()
        if 'access_token' in new_data:
            # Actualizar solo los tokens, preservando el resto del archivo.
            config['access_token'] = new_data['access_token']
            # A menudo, también se devuelve un nuevo refresh_token.
            if 'refresh_token' in new_data:
                config['refresh_token'] = new_data['refresh_token']

            with open(MELI_CREDS_PATH, 'w') as f:
                json.dump(config, f, indent=4)

            print("✅ Token de Mercado Libre refrescado exitosamente.")
            return config['access_token']
        else:
            print(f"❌ Error: La respuesta de la API de Meli no contenía un 'access_token'. Respuesta: {new_data}")
            return None

    except requests.exceptions.HTTPError as http_err:
        print(f"❌ Error HTTP al refrescar token de Meli: {http_err}")
        print(f"   └──> Respuesta del servidor: {res.text}")
    except Exception as e:
        print(f"❌ Error crítico al refrescar el token de Meli: {e}")

    return None

# --- Comunicación con el Servidor de Notificaciones (WhatsApp) ---
# Las constantes de URL y teléfono se cargan desde variables de entorno.
URL_API_WHATSAPP = os.getenv("URL_API_WHATSAPP", "http://127.0.0.1:3000/enviar")
URL_API_WHATSAPP_ARCHIVO = os.getenv("URL_API_WHATSAPP_ARCHIVO", "http://127.0.0.1:3000/enviar-archivo")
TELEFONO_GRUPO_REPORTE = os.getenv("TELEFONO_GRUPO_REPORTE", "120363407538342427@g.us")

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
            else:
                print(f"❌ Error al enviar reporte a WhatsApp. Código: {res.status_code}, Respuesta: {res.text}")
                # No reintentar en errores no recuperables (ej. 4xx)
                return False

        except requests.RequestException as e:
            print(f"❌ Error de conexión con el servidor de notificaciones: {e}")
            # No reintentar si la conexión es rechazada, puede que el server esté caído.
            return False

    print(f"❌ Fallo el envío a WhatsApp después de {max_intentos} intentos.")
    return False

def enviar_whatsapp_archivo(file_path: str, texto_mensaje: str = "", file_name: str = None):
    """
    Envía un archivo (PDF, Imagen, etc.) al grupo de WhatsApp designado para reportes.
    """
    payload = {
        "numero": TELEFONO_GRUPO_REPORTE,
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
