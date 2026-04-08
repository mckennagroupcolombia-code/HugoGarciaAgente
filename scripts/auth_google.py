import os
from google_auth_oauthlib.flow import InstalledAppFlow
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request

# SCOPES para lectura, escritura y envío
SCOPES = [
    'https://www.googleapis.com/auth/drive.metadata.readonly',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/spreadsheets'
]

def generar_token():
    # El archivo que bajaste de Google Cloud (App de Escritorio)
    ARCHIVO_CREDENCIALES = 'credenciales_google.json'
    # El nombre que tú elegiste para guardar el permiso
    ARCHIVO_TOKEN_SALIDA = 'client_secret_cloud.json'

    if not os.path.exists(ARCHIVO_CREDENCIALES):
        print(f"❌ Error: No se encuentra '{ARCHIVO_CREDENCIALES}' en la carpeta.")
        return

    try:
        # Iniciamos el flujo de autenticación
        flow = InstalledAppFlow.from_client_secrets_file(ARCHIVO_CREDENCIALES, SCOPES)
        
        # Esto abrirá tu navegador automáticamente
        creds = flow.run_local_server(port=8080)
        
        # Guardamos el resultado con el nombre que elegiste
        with open(ARCHIVO_TOKEN_SALIDA, 'w') as token:
            token.write(creds.to_json())
            
        print(f"\n✅ ¡ÉXITO! Se ha creado el archivo: {ARCHIVO_TOKEN_SALIDA}")
        print("Ya puedes cerrar este script y ejecutar el agente.")
        
    except Exception as e:
        print(f"❌ Error durante la autenticación: {e}")
        print("\n💡 TIP: Asegúrate de que en Google Cloud elegiste 'App de escritorio'.")

if __name__ == '__main__':
    generar_token()
