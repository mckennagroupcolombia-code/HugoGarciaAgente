import os
import json
import math
import time
from pathlib import Path
from datetime import datetime

import requests
import gspread

def sincronizar_precios_meli_sheets() -> str:
    """
    Sincroniza los precios desde MercadoLibre hacia Google Sheets y luego invalida 
    la caché de la página web para que tome los nuevos precios.
    Retorna un resumen de la sincronización.
    """
    # ─────────────────────────────────────────────
    # CONFIG
    # ─────────────────────────────────────────────
    MELI_CREDS_PATH = os.getenv('MELI_CREDS_PATH', '/home/mckg/mi-agente/credenciales_meli.json')
    CREDS_PATH      = os.getenv('GOOGLE_SERVICE_ACCOUNT_PATH', '/home/mckg/mi-agente/mi-agente-ubuntu-9043f67d9755.json')
    SHEET_ID        = "1v8_8Ibnq0yPkFlS1t-NGM2UMaNd5dxIDjJApl3NbHMg"
    CACHE_FILE      = Path('/home/mckg/mi-agente/PAGINA_WEB/site/data/cache.json')
    
    salida = []
    salida.append("🔄 Iniciando sincronización de precios MeLi → Sheets...")

    # 1. TOKEN MELI
    try:
        with open(MELI_CREDS_PATH) as f:
            meli_creds = json.load(f)
    except Exception as e:
        return f"❌ Error leyendo credenciales de MeLi: {e}"

    MELI_TOKEN = meli_creds.get('access_token')
    if not MELI_TOKEN:
        return "❌ Error: No se encontró access_token en las credenciales de MeLi."

    MELI_SELLER_ID = meli_creds.get('seller_id') or meli_creds.get('user_id')

    if not MELI_SELLER_ID:
        r = requests.get(
            'https://api.mercadolibre.com/users/me',
            headers={'Authorization': f'Bearer {MELI_TOKEN}'}, timeout=15)
        if r.status_code == 200:
            MELI_SELLER_ID = r.json()['id']
        else:
            return f"❌ ERROR obteniendo seller_id: {r.status_code} {r.text}"

    # 2. OBTENER TODOS LOS LISTINGS ACTIVOS
    meli_headers = {'Authorization': f'Bearer {MELI_TOKEN}'}
    all_item_ids = []
    offset = 0

    while True:
        url = (f"https://api.mercadolibre.com/users/{MELI_SELLER_ID}/items/search"
               f"?status=active&limit=100&offset={offset}")
        r = requests.get(url, headers=meli_headers, timeout=20)
        if r.status_code != 200:
            salida.append(f"⚠️ Error obteniendo items: {r.status_code}")
            break
        data = r.json()
        ids = data.get('results', [])
        all_item_ids.extend(ids)
        total = data.get('paging', {}).get('total', 0)
        offset += 100
        if offset >= total:
            break

    salida.append(f"📦 {len(all_item_ids)} listings activos encontrados en MeLi.")

    # 3. BATCH GET: precio base
    meli_data = {}
    for i in range(0, len(all_item_ids), 20):
        batch = all_item_ids[i:i+20]
        ids_str = ",".join(batch)
        r = requests.get(
            f"https://api.mercadolibre.com/items?ids={ids_str}",
            headers=meli_headers, timeout=30)
        if r.status_code != 200:
            continue

        for entry in r.json():
            if entry.get('code') != 200:
                continue
            item = entry.get('body', {})
            item_id = item.get('id', '')
            price = item.get('price')
            title = item.get('title', '')

            sku = item.get('seller_custom_field') or ''
            if not sku:
                for attr in item.get('attributes', []):
                    if attr.get('id') == 'SELLER_SKU':
                        sku = attr.get('value_name', '')
                        break

            if price is not None:
                meli_data[item_id] = {
                    'price': float(price),
                    'sku': sku.strip(),
                    'title': title,
                }
        time.sleep(0.2)
    
    salida.append(f"💵 Se obtuvieron precios para {len(meli_data)} items.")

    # 4. LEER GOOGLE SHEETS
    try:
        gc = gspread.service_account(filename=CREDS_PATH)
        wb = gc.open_by_key(SHEET_ID)
        ws = wb.sheet1
        rows = ws.get_all_values()
    except Exception as e:
        return f"❌ Error leyendo Google Sheets: {e}"

    if not rows:
        return "❌ Error: La hoja de Sheets está vacía."

    header = [h.strip().upper() for h in rows[0]]
    idx_meli = 0
    idx_sku  = next((i for i, h in enumerate(header) if "SKU" in h), 1)
    idx_nom  = next((i for i, h in enumerate(header) if "NOMBRE" in h), 3)
    idx_prec = next((i for i, h in enumerate(header) if "PRECIO" in h), 4)

    # 5. CRUZAR Y CONSTRUIR ACTUALIZACIONES
    id_to_row = {}
    for row_num, row in enumerate(rows[1:], start=2):
        meli_id = str(row[idx_meli]).strip().upper() if row[idx_meli] else ""
        if meli_id.startswith("MCO"):
            id_to_row[meli_id] = row_num

    sku_to_row = {}
    for row_num, row in enumerate(rows[1:], start=2):
        sku = row[idx_sku].strip() if len(row) > idx_sku else ""
        if sku:
            sku_to_row[sku.upper()] = row_num

    actualizaciones = []

    for item_id, info in meli_data.items():
        precio_nuevo = info['price']
        row_num = id_to_row.get(item_id.upper())
        
        if not row_num and info['sku']:
            row_num = sku_to_row.get(info['sku'].upper())

        if not row_num:
            continue

        row = rows[row_num - 1]
        precio_actual_raw = row[idx_prec].strip() if len(row) > idx_prec else ""
        
        try:
            precio_actual = float(precio_actual_raw.replace(",", "").replace("$", "").replace(" ", ""))
        except Exception:
            precio_actual = 0

        diferencia = abs(precio_nuevo - precio_actual)
        if diferencia > 1:
            actualizaciones.append((row_num, precio_nuevo, info['title'], precio_actual, item_id))

    if not actualizaciones:
        salida.append("✅ Precios ya están sincronizados. Sin cambios en Sheets.")
    else:
        col_letra = chr(ord('A') + idx_prec)
        batch_data = []
        for row_num, precio_nuevo, nombre, precio_viejo, item_id in actualizaciones:
            celda = f"{col_letra}{row_num}"
            batch_data.append({"range": celda, "values": [[int(round(precio_nuevo))]]})
        
        actualizadas = 0
        errores = 0
        lote_size = 50
        for i in range(0, len(batch_data), lote_size):
            lote = batch_data[i:i+lote_size]
            try:
                ws.batch_update(lote)
                actualizadas += len(lote)
                if i + lote_size < len(batch_data):
                    time.sleep(2)
            except Exception as e:
                errores += len(lote)
                salida.append(f"⚠️ Error actualizando lote en Sheets: {e}")
        
        salida.append(f"✅ Se actualizaron {actualizadas} precios en Sheets (Errores: {errores}).")

    # 6. INVALIDAR CACHE WEB
    try:
        if CACHE_FILE.exists():
            CACHE_FILE.unlink()
            salida.append("🗑️ Caché web invalidada exitosamente.")
    except Exception as e:
        salida.append(f"⚠️ No se pudo invalidar la caché web: {e}")

    return "\n".join(salida)
