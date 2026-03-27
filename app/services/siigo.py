
import os
import json
import time
import requests

# Variable de configuración para la API de Siigo
PARTNER_ID = "SiigoAPI"

def autenticar_siigo(forzar=False):
    """
    Autentica con la API de Siigo para obtener un token de acceso.
    Maneja el cacheo del token para no re-autenticar en cada llamada.
    """
    try:
        # TODO: Centralizar la gestión de credenciales en lugar de un path hard-coded.
        ruta_json = os.path.expanduser("~/mi-agente/credenciales_SIIGO.json")
        if not os.path.exists(ruta_json):
            print("⚠️ Error Crítico: El archivo de credenciales de SIIGO no se encuentra en '~/mi-agente/credenciales_SIIGO.json'")
            return None

        with open(ruta_json, "r") as f:
            creds = json.load(f)

        if not forzar and time.time() < creds.get("token_vencimiento", 0):
            return creds["access_token"]

        res = requests.post(
            "https://api.siigo.com/auth",
            json={"username": creds["username"], "access_key": creds["api_key"]},
            headers={"Partner-Id": PARTNER_ID},
            timeout=10
        )

        if res.status_code == 200:
            token = res.json().get("access_token")
            creds.update({"access_token": token, "token_vencimiento": time.time() + (23 * 3600)})
            with open(ruta_json, "w") as f:
                json.dump(creds, f)
            return token
        else:
            print(f"⚠️ Error de autenticación Siigo: {res.status_code} - {res.text}")

    except Exception as e:
        print(f"⚠️ Error crítico en autenticación Siigo: {e}")
    
    return None

def obtener_facturas_siigo_paginadas(fecha_inicio):
    """
    Obtiene todas las facturas de Siigo a partir de una fecha de inicio,
    manejando la paginación de la API.
    """
    token = autenticar_siigo()
    if not token:
        return []

    todas_las_facturas = []
    page = 1
    while True:
        try:
            res = requests.get(
                f"https://api.siigo.com/v1/invoices?created_start={fecha_inicio}&page={page}",
                headers={"Partner-Id": PARTNER_ID, "Authorization": f"Bearer {token}"},
                timeout=15
            )
            if res.status_code == 200:
                data = res.json()
                facturas_pagina = data.get('results')
                if facturas_pagina:
                    todas_las_facturas.extend(facturas_pagina)
                    if not data.get('pagination') or data['pagination']['total_results'] == len(todas_las_facturas):
                        break
                    page += 1
                else:
                    break
            else:
                print(f"⚠️ Error obteniendo facturas de Siigo (Página {page}): {res.status_code}")
                break
        except requests.RequestException as e:
            print(f"⚠️ Error de red obteniendo facturas de Siigo: {e}")
            break
    return todas_las_facturas

def descargar_factura_pdf_siigo(id_factura):
    """
    Descarga el PDF de una factura específica de Siigo en formato base64.
    """
    token = autenticar_siigo()
    if not token:
        return "❌ Error: No se pudo autenticar con Siigo."

    try:
        res = requests.get(
            f"https://api.siigo.com/v1/invoices/{id_factura}/pdf",
            headers={"Authorization": f"Bearer {token}", "Partner-Id": PARTNER_ID},
            timeout=15
        )
        if res.status_code == 200:
            return res.json().get('base64', '')
        else:
            print(f"⚠️ Error descargando PDF de Siigo (ID: {id_factura}): {res.status_code}")
            return "❌ Error"
    except requests.RequestException as e:
        print(f"⚠️ Error de red descargando PDF de Siigo: {e}")
        return f"⚠️ Error: {e}"
