"""
Renueva los tokens OAuth de Mercado Libre de forma interactiva.

Pasos:
  1. Pide app_id y client_secret (o los lee del JSON si ya existen)
  2. Abre la URL de autorización para obtener el código TG
  3. Intercambia el código por tokens reales
  4. Guarda access_token + refresh_token en credenciales_meli.json
"""
import json
import os
import sys
import subprocess
import requests
from dotenv import load_dotenv

load_dotenv()

RUTA_CREDS = os.getenv("MELI_CREDS_PATH") or os.path.join(
    os.path.dirname(__file__), "..", "credenciales_meli.json"
)
RUTA_CREDS = os.path.abspath(RUTA_CREDS)
REDIRECT_URI = "https://www.google.com/"


def leer_creds_actuales() -> dict:
    if os.path.exists(RUTA_CREDS):
        try:
            with open(RUTA_CREDS, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def preguntar(prompt: str, default: str = "") -> str:
    if default:
        respuesta = input(f"{prompt} [{default}]: ").strip()
        return respuesta or default
    while True:
        respuesta = input(f"{prompt}: ").strip()
        if respuesta:
            return respuesta
        print("  ⚠️  No puede estar vacío.")


def abrir_url(url: str):
    try:
        subprocess.Popen(
            ["xdg-open", url],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        pass


def main():
    print("\n╔══════════════════════════════════════════════╗")
    print("║   Renovar OAuth Mercado Libre — McKenna       ║")
    print("╚══════════════════════════════════════════════╝\n")

    creds = leer_creds_actuales()

    # ── Paso 1: credenciales de la app ──────────────────────────────────────
    print("── Paso 1: datos de la app MeLi ──")
    app_id = preguntar("  App ID (client_id)", creds.get("app_id", ""))
    client_secret = preguntar("  Client Secret", creds.get("client_secret", ""))

    # ── Paso 2: URL de autorización ─────────────────────────────────────────
    auth_url = (
        f"https://auth.mercadolibre.com.co/authorization"
        f"?response_type=code&client_id={app_id}&redirect_uri={REDIRECT_URI}"
    )
    print("\n── Paso 2: autorizar en MeLi ──")
    print(f"\n  👉  Abre esta URL en tu navegador:\n\n  {auth_url}\n")
    abrir_url(auth_url)
    print("  MeLi te redirigirá a google.com?code=TG-xxxxxxxx")
    print("  Copia solo la parte del code (TG-...)\n")

    codigo_tg = preguntar("  Pega el código TG aquí")
    if not codigo_tg.startswith("TG-"):
        print(f"  ⚠️  El código debería empezar con TG- (recibido: {codigo_tg[:20]})")

    # ── Paso 3: intercambiar código por tokens ──────────────────────────────
    print("\n── Paso 3: intercambiando código con MeLi... ──")
    payload = {
        "grant_type": "authorization_code",
        "client_id": app_id,
        "client_secret": client_secret,
        "code": codigo_tg.strip(),
        "redirect_uri": REDIRECT_URI,
    }
    try:
        resp = requests.post(
            "https://api.mercadolibre.com/oauth/token", data=payload, timeout=15
        )
    except requests.RequestException as e:
        print(f"\n  ❌ Error de red: {e}")
        sys.exit(1)

    data = resp.json()

    if resp.status_code != 200:
        msg = data.get("error_description") or data.get("message") or str(data)
        print(f"\n  ❌ MeLi respondió {resp.status_code}: {msg}")
        sys.exit(1)

    access_token = data["access_token"]
    refresh_token = data["refresh_token"]

    # ── Paso 4: obtener seller_id ────────────────────────────────────────────
    seller_id = creds.get("seller_id") or creds.get("user_id") or 0
    try:
        me = requests.get(
            "https://api.mercadolibre.com/users/me",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
        )
        if me.status_code == 200:
            seller_id = int(me.json().get("id", seller_id))
    except requests.RequestException:
        pass

    # ── Paso 5: guardar ──────────────────────────────────────────────────────
    creds.update(
        {
            "app_id": app_id,
            "client_secret": client_secret,
            "access_token": access_token,
            "refresh_token": refresh_token,
            "user_id": seller_id,
            "seller_id": seller_id,
        }
    )
    with open(RUTA_CREDS, "w", encoding="utf-8") as f:
        json.dump(creds, f, indent=4)

    print(f"\n  ✅ Tokens guardados en {RUTA_CREDS}")
    print(f"     access_token  : {len(access_token)} chars  ({access_token[:30]}...)")
    print(f"     refresh_token : {len(refresh_token)} chars  ({refresh_token[:20]}...)")
    print(f"     seller_id     : {seller_id}")
    print("\n  🎉 Conexión MeLi lista.\n")


if __name__ == "__main__":
    main()
