import json
import requests
import os

def activar_conexion_meli():
    ruta_creds = "credenciales_meli.json"
    
    # 1. Cargar tus credenciales base
    if not os.path.exists(ruta_creds):
        return f"❌ Error: No encontré el archivo '{ruta_creds}'."
    
    with open(ruta_creds, 'r') as f:
        config = json.load(f)

    # 2. Configurar el intercambio (Tu código TG ya está aquí adentro)
    url = "https://api.mercadolibre.com/oauth/token"
    payload = {
        'grant_type': 'authorization_code',
        'client_id': config.get("client_id") or config.get("app_id"),
        'client_secret': config.get("client_secret"),
        'code': 'TG-69c4c9ee8ce2de00010bfe3e-432439187',  # <--- TU CÓDIGO NUEVO
        'redirect_uri': config.get("redirect_uri")
    }
    
    print(f"🚀 Intentando conectar con App ID: {payload['client_id']}...")
    
    # 3. Llamada a Mercado Libre
    response = requests.post(url, data=payload)
    res_data = response.json()

    if response.status_code == 200:
        config['access_token'] = res_data['access_token']
        config['refresh_token'] = res_data['refresh_token']
        
        # 4. Guardar llaves nuevas
        with open(ruta_creds, 'w') as f:
            json.dump(config, f, indent=4)
        return "✅ ¡ÉXITO! Tokens actualizados en credenciales_meli.json."
    else:
        return f"❌ Error {response.status_code}: {res_data.get('message', res_data)}"

if __name__ == '__main__':
    print(activar_conexion_meli())
