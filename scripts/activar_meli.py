"""
Activa / renueva la conexión OAuth con Mercado Libre.

Uso:
    python3 scripts/activar_meli.py <TG-xxxx> [code_verifier]

Obtener el código TG:
    1. Ve a https://auth.mercadolibre.com.co/authorization?response_type=code&client_id=<APP_ID>&redirect_uri=<REDIRECT_URI>
    2. Acepta los permisos → MeLi te redirige a REDIRECT_URI?code=TG-xxxx
    3. Pega ese código como argumento.

El código caduca en ~10 minutos y es de un solo uso.

PKCE: las apps nuevas de MeLi exigen `code_verifier`/`code_challenge` (las viejas no).
Si al canjear el código sale "code_verifier is a required parameter", genera el link
de autorización con `generar_pkce()` (agrega code_challenge a la URL) y pasa el mismo
code_verifier como segundo argumento al canjear el código.
"""
import base64
import hashlib
import json
import secrets
import sys
import os
import requests
from dotenv import load_dotenv

load_dotenv()


def generar_pkce() -> tuple[str, str]:
    """(code_verifier, code_challenge) para el flujo PKCE que exigen las apps nuevas de MeLi."""
    code_verifier = base64.urlsafe_b64encode(secrets.token_bytes(64)).rstrip(b"=").decode("ascii")
    code_challenge = base64.urlsafe_b64encode(
        hashlib.sha256(code_verifier.encode("ascii")).digest()
    ).rstrip(b"=").decode("ascii")
    return code_verifier, code_challenge


def activar_conexion_meli(codigo_tg: str | None = None, code_verifier: str | None = None):
    ruta_creds = os.getenv("MELI_CREDS_PATH") or "credenciales_meli.json"

    if not os.path.exists(ruta_creds):
        return f"❌ No encontré credenciales en '{ruta_creds}'."

    with open(ruta_creds, "r", encoding="utf-8") as f:
        config = json.load(f)

    app_id = config.get("app_id") or config.get("client_id")
    client_secret = config.get("client_secret")
    redirect_uri = config.get("redirect_uri", "https://bot.mckennagroup.co/callback")

    if not app_id or not client_secret:
        return "❌ Faltan app_id / client_secret en credenciales_meli.json."

    if not codigo_tg:
        verifier, challenge = generar_pkce()
        auth_url = (
            f"https://auth.mercadolibre.com.co/authorization"
            f"?response_type=code&client_id={app_id}&redirect_uri={redirect_uri}"
            f"&code_challenge={challenge}&code_challenge_method=S256"
        )
        return (
            "❌ No se proporcionó código TG.\n\n"
            f"👉 Genera uno abriendo esta URL:\n{auth_url}\n\n"
            f"⚠️ Guarda este code_verifier (lo necesitas para el siguiente paso):\n{verifier}\n\n"
            "Luego corre:\n    python3 scripts/activar_meli.py TG-xxxxxxxx " + verifier
        )

    payload = {
        "grant_type": "authorization_code",
        "client_id": app_id,
        "client_secret": client_secret,
        "code": codigo_tg.strip(),
        "redirect_uri": redirect_uri,
    }
    if code_verifier:
        payload["code_verifier"] = code_verifier.strip()

    print(f"🚀 Intercambiando código con App ID {app_id}...")
    response = requests.post(
        "https://api.mercadolibre.com/oauth/token", data=payload, timeout=15
    )
    res_data = response.json()

    if response.status_code == 200:
        config["access_token"] = res_data["access_token"]
        config["refresh_token"] = res_data["refresh_token"]
        # Persistir seller_id desde /users/me
        try:
            me = requests.get(
                "https://api.mercadolibre.com/users/me",
                headers={"Authorization": f"Bearer {res_data['access_token']}"},
                timeout=10,
            )
            if me.status_code == 200:
                uid = me.json().get("id")
                if uid:
                    config["user_id"] = int(uid)
                    config["seller_id"] = int(uid)
                    print(f"✅ seller_id actualizado: {uid}")
        except requests.RequestException:
            pass

        with open(ruta_creds, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=4)

        rt_len = len(res_data["refresh_token"])
        at_len = len(res_data["access_token"])
        return (
            f"✅ Tokens actualizados en {ruta_creds}\n"
            f"   access_token  : {at_len} chars\n"
            f"   refresh_token : {rt_len} chars\n"
            f"   seller_id     : {config.get('seller_id', 'no obtenido')}"
        )
    else:
        msg = res_data.get("message") or res_data.get("error_description") or str(res_data)
        return f"❌ Error {response.status_code}: {msg}"


if __name__ == "__main__":
    codigo = sys.argv[1] if len(sys.argv) > 1 else None
    verifier_arg = sys.argv[2] if len(sys.argv) > 2 else None
    print(activar_conexion_meli(codigo, verifier_arg))
