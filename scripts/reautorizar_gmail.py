#!/usr/bin/env python3
"""
Re-autoriza el acceso de Gmail.
Ejecutar desde el directorio raíz del proyecto:

    source venv/bin/activate
    python3 scripts/reautorizar_gmail.py

Abrirá el navegador para completar el OAuth de Google.
El token se guarda en app/tools/token_gmail.json.
"""

import os
import sys
import json

# Asegurar que el proyecto esté en el path
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(PROJECT_DIR)
sys.path.insert(0, PROJECT_DIR)

TOKEN_PATH  = os.path.join(PROJECT_DIR, "app", "tools", "token_gmail.json")
CREDS_PATH  = os.path.join(PROJECT_DIR, "credenciales_google.json")
SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.labels",
]

def main():
    if not os.path.exists(CREDS_PATH):
        print(f"❌ No encontrado: {CREDS_PATH}")
        print("   Descárgalo desde Google Cloud Console → APIs & Services → Credentials")
        sys.exit(1)

    # Detectar tipo de credencial
    with open(CREDS_PATH) as f:
        raw = json.load(f)
    cred_type = list(raw.keys())[0]  # "web" o "installed"
    print(f"ℹ  Tipo de credencial detectado: {cred_type}")

    # Eliminar token viejo
    if os.path.exists(TOKEN_PATH):
        os.remove(TOKEN_PATH)
        print(f"🗑  Token antiguo eliminado: {TOKEN_PATH}")

    # OAuth flow
    from google_auth_oauthlib.flow import InstalledAppFlow

    print("\n🌐 Abriendo navegador para autorizar acceso a Gmail...")
    print("   Si no abre automáticamente, copia la URL que aparece en la consola.\n")

    flow = InstalledAppFlow.from_client_secrets_file(CREDS_PATH, SCOPES)
    try:
        # prompt=consent fuerza que Google devuelva refresh_token en cada auth
        creds = flow.run_local_server(port=8085, open_browser=True, prompt="consent")
    except Exception as e:
        print(f"⚠  run_local_server falló ({e}), intentando con puerto 0 (aleatorio)...")
        creds = flow.run_local_server(port=0, open_browser=True, prompt="consent")

    # Guardar nuevo token
    with open(TOKEN_PATH, "w") as f:
        f.write(creds.to_json())
    print(f"\n✅ Token guardado en: {TOKEN_PATH}")

    # Prueba rápida
    from googleapiclient.discovery import build
    service = build("gmail", "v1", credentials=creds)
    profile = service.users().getProfile(userId="me").execute()
    print(f"✅ Gmail autorizado para: {profile['emailAddress']}")
    print("   Ya puedes usar 'Facturas Gmail' desde el panel.")

if __name__ == "__main__":
    main()
