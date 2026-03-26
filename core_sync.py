import os
import time
import json
import requests
import gspread
from google.oauth2.credentials import Credentials

# ==========================================
# CONFIGURACIÓN DE RUTAS
# ==========================================
BASE_DIR_CREDS = "/home/mckg/mi-agente"
GOOGLE_CREDS_PATH = os.path.join(BASE_DIR_CREDS, "client_secret_cloud.json")
MELI_CREDS_PATH = os.path.join(BASE_DIR_CREDS, "credenciales_meli.json")
SPREADSHEET_ID = '1v8_8Ibnq0yPkFlS1t-NGM2UMaNd5dxIDjJApl3NbHMg'

TELEFONO_GRUPO = "120363407538342427@g.us" 
URL_API_LOCAL = "http://127.0.0.1:3000/enviar"

# ==========================================
# FUNCIONES DE APOYO
# ==========================================

def refrescar_token_meli():
    """Refresca el token de acceso de Mercado Libre."""
    try:
        if not os.path.exists(MELI_CREDS_PATH): 
            print("❌ Error: No se encuentra credenciales_meli.json en la ruta:", MELI_CREDS_PATH)
            return None
        with open(MELI_CREDS_PATH, 'r') as f:
            config = json.load(f)
        url = "https://api.mercadolibre.com/oauth/token"
        payload = {
            'grant_type': 'refresh_token',
            'client_id': config['app_id'],
            'client_secret': config['client_secret'],
            'refresh_token': config['refresh_token']
        }
        response = requests.post(url, data=payload)
        new_data = response.json()
        if 'access_token' in new_data:
            print(f"✅ Token refrescado exitosamente. Guardando nuevo access_token...")
            config['access_token'] = new_data['access_token']
            with open(MELI_CREDS_PATH, 'w') as f:
                json.dump(config, f, indent=4)
            return config['access_token']
        else:
            print(f"❌ Error en respuesta JSON de ML al refrescar: {new_data}")
    except Exception as e: 
        print(f"❌ Error crítico refrescando token: {e}")
    return None

def enviar_whatsapp_reporte(texto):
    """Envía el reporte al servidor Node.js (Hugo)."""
    payload = {"numero": TELEFONO_GRUPO, "mensaje": texto}
    intentos = 0
    max_intentos = 5
    
    while intentos < max_intentos:
        try:
            res = requests.post(URL_API_LOCAL, json=payload, timeout=35)
            if res.status_code == 200:
                print("✅ Reporte entregado a Node.js con éxito.")
                return True
            elif res.status_code == 503:
                print("⏳ Node.js dice que WhatsApp está cargando. Esperando 15s...")
                time.sleep(15)
                intentos += 1
            else:
                print(f"❌ Error de Node.js: {res.status_code}")
                return False
        except Exception as e:
            print(f"❌ Error de conexión con Node.js: {e}")
            return False
    return False

# ==========================================
# LÓGICA DE SINCRONIZACIÓN Y REPORTE
# ==========================================

def ejecutar_sincronizacion_y_reporte():
    print("🚀 INICIANDO ESCANEO DE PRODUCTOS...")
    token = refrescar_token_meli()
    if not token: return "❌ Error: Token de ML no disponible."

    try:
        gc = gspread.service_account(filename=GOOGLE_CREDS_PATH)
        sh = gc.open_by_key(SPREADSHEET_ID)
        sheet = sh.worksheet("Hoja 1") 
        data = sheet.get_all_values()
        
        ml_ids_list = []
        fila_map = {}
        nombre_map = {}

        # 1. LECTURA DEL EXCEL (Ajustado a sus columnas)
        # Empezamos desde la fila 2 (índice 1 de data)
        for i, row in enumerate(data[1:], start=2):
            if len(row) < 1: continue 
            
            # Columna A (Índice 0) -> Códigos MCO
            id_meli = str(row[0]).strip().upper() 
            
            if id_meli.startswith("MCO"):
                ml_ids_list.append(id_meli)
                fila_map[id_meli] = i
                
                # Columna D (Índice 3) -> Nombre del Producto
                nombre = str(row[3]).strip() if len(row) > 3 else "Producto sin nombre"
                nombre_map[id_meli] = nombre

        if not ml_ids_list:
            return "⚠️ No se encontraron códigos MCO en la Columna A."
            
        print(f"✅ Se detectaron {len(ml_ids_list)} productos en el Excel. Consultando a Mercado Libre...")

        headers = {'Authorization': f'Bearer {token}'}
        updates = []
        productos_agotados = []
        productos_criticos = []

        # 2. CONSULTA A MERCADO LIBRE
        for i in range(0, len(ml_ids_list), 20):
            lote = ml_ids_list[i:i+20]
            ids_query = ",".join(lote)
            res = requests.get(f"https://api.mercadolibre.com/items?ids={ids_query}", headers=headers)
            items_json = res.json()
            
            for r in items_json:
                if r.get('code') == 200:
                    item = r['body']
                    ml_id = item.get('id')
                    # Usamos el nombre bonito del Excel
                    nombre_final = nombre_map.get(ml_id) or item.get('title')
                    
                    # Calcular stock total (sumando si hay variaciones)
                    stock_actual = 0
                    if item.get('variations'):
                        stock_actual = sum(int(v.get('available_quantity', 0)) for v in item['variations'])
                    else:
                        stock_actual = int(item.get('available_quantity', 0))

                    # Clasificar para el reporte de WhatsApp
                    if stock_actual == 0:
                        productos_agotados.append(f"🚫 {nombre_final}")
                    elif stock_actual == 1:
                        productos_criticos.append(f"⚠️ {nombre_final}")

                    # Preparar actualización en Sheets: Columna F (Stock MercadoLibre)
                    updates.append({'range': f'F{fila_map[ml_id]}', 'values': [[stock_actual]]})
                else:
                    # El chismoso para saber si Mercado Libre rechaza algún código
                    print(f"⚠️ Mercado Libre rechazó un ID. Detalle: {r.get('body')}")

        # 3. ACTUALIZACIÓN EN GOOGLE SHEETS
        if updates:
            sheet.batch_update(updates)
            print("✅ Stock actualizado correctamente en Google Sheets.")

        # 4. CONSTRUCCIÓN DEL MENSAJE PARA WHATSAPP
        reporte = "📊 *ALERTA DE STOCK MCKENNA*\n"
        reporte += "───────────────────\n"
        
        hay_novedades = False

        if productos_agotados:
            hay_novedades = True
            reporte += f"\n*❌ AGOTADOS ({len(productos_agotados)}):*\n"
            reporte += "\n".join(productos_agotados[:20])
            if len(productos_agotados) > 20:
                reporte += f"\n_... y {len(productos_agotados)-20} más._\n"

        if productos_criticos:
            hay_novedades = True
            reporte += f"\n*⚠️ ÚLTIMA UNIDAD ({len(productos_criticos)}):*\n"
            reporte += "\n".join(productos_criticos[:20])
            if len(productos_criticos) > 20:
                reporte += f"\n_... y {len(productos_criticos)-20} más._\n"

        if not hay_novedades:
            reporte += "✅ Todo el stock se encuentra por encima de 1 unidad."

        reporte += "\n───────────────────\n"
        reporte += f"🤖 _Total procesados: {len(ml_ids_list)}_"

        # 5. ENVÍO FINAL
        if enviar_whatsapp_reporte(reporte):
            return f"✅ Reporte enviado al grupo. Agotados: {len(productos_agotados)}, Críticos: {len(productos_criticos)}"
        return "⚠️ Inventario actualizado en el Excel, pero hubo un error al enviar el WhatsApp."

    except Exception as e:
        return f"❌ Error crítico en el proceso: {str(e)}"

if __name__ == "__main__":
    resultado = ejecutar_sincronizacion_y_reporte()
    print(resultado)
