#!/usr/bin/env python3
"""
Sincroniza precios desde MercadoLibre → Google Sheets → invalida cache web

Regla: precio_sheets = precio_base_meli (sin envío, sin comisiones agregadas)
La web aplica después su propio descuento del 16.5% (comisión MeLi).

Uso:
  source venv/bin/activate
  python3 sincronizar_precios_meli_sheets.py
"""

import os
import sys
import json
import math
import time
from pathlib import Path
from datetime import datetime

from dotenv import load_dotenv
load_dotenv('/home/mckg/mi-agente/.env')

import requests
import gspread

# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────
MELI_CREDS_PATH = os.getenv('MELI_CREDS_PATH', '/home/mckg/mi-agente/credenciales_meli.json')
CREDS_PATH      = os.getenv('GOOGLE_SERVICE_ACCOUNT_PATH',
                             '/home/mckg/mi-agente/mi-agente-ubuntu-9043f67d9755.json')
SHEET_ID        = "1v8_8Ibnq0yPkFlS1t-NGM2UMaNd5dxIDjJApl3NbHMg"
CACHE_FILE      = Path('/home/mckg/mi-agente/PAGINA_WEB/site/data/cache.json')
FECHA_HOY       = datetime.now().strftime('%Y-%m-%d %H:%M')

print("=" * 65)
print("SINCRONIZADOR DE PRECIOS  MeLi → Google Sheets → Web")
print(f"McKenna Group | {FECHA_HOY}")
print("=" * 65)

# ─────────────────────────────────────────────
# 1. TOKEN MELI
# ─────────────────────────────────────────────
with open(MELI_CREDS_PATH) as f:
    meli_creds = json.load(f)

MELI_TOKEN    = meli_creds['access_token']
MELI_SELLER_ID = meli_creds.get('seller_id') or meli_creds.get('user_id')

if not MELI_SELLER_ID:
    r = requests.get(
        'https://api.mercadolibre.com/users/me',
        headers={'Authorization': f'Bearer {MELI_TOKEN}'}, timeout=15)
    if r.status_code == 200:
        MELI_SELLER_ID = r.json()['id']
    else:
        print(f"ERROR obteniendo seller_id: {r.status_code} {r.text}")
        sys.exit(1)

print(f"\n[MeLi] Seller ID: {MELI_SELLER_ID}")

# ─────────────────────────────────────────────
# 2. OBTENER TODOS LOS LISTINGS ACTIVOS
# ─────────────────────────────────────────────
print("\n[MeLi] Obteniendo listings activos...")
meli_headers = {'Authorization': f'Bearer {MELI_TOKEN}'}
all_item_ids = []
offset = 0

while True:
    url = (f"https://api.mercadolibre.com/users/{MELI_SELLER_ID}/items/search"
           f"?status=active&limit=100&offset={offset}")
    r = requests.get(url, headers=meli_headers, timeout=20)
    if r.status_code != 200:
        print(f"  ERROR: {r.status_code} {r.text}")
        break
    data  = r.json()
    ids   = data.get('results', [])
    all_item_ids.extend(ids)
    total = data.get('paging', {}).get('total', 0)
    offset += 100
    if offset >= total:
        break

print(f"  {len(all_item_ids)} listings encontrados")

# ─────────────────────────────────────────────
# 3. BATCH GET: precio base por item_id y SKU
# ─────────────────────────────────────────────
print("\n[MeLi] Obteniendo precios base (sin envío)...")
# {meli_id: {"price": float, "sku": str, "title": str}}
meli_data = {}

for i in range(0, len(all_item_ids), 20):
    batch   = all_item_ids[i:i+20]
    ids_str = ",".join(batch)
    r = requests.get(
        f"https://api.mercadolibre.com/items?ids={ids_str}",
        headers=meli_headers, timeout=30)
    if r.status_code != 200:
        print(f"  ERROR lote {i//20+1}: {r.status_code}")
        continue

    for entry in r.json():
        if entry.get('code') != 200:
            continue
        item     = entry.get('body', {})
        item_id  = item.get('id', '')
        # price = precio base del producto; shipping_cost es SEPARADO
        price    = item.get('price')
        title    = item.get('title', '')

        # Extraer SKU (seller_custom_field tiene prioridad)
        sku = item.get('seller_custom_field') or ''
        if not sku:
            for attr in item.get('attributes', []):
                if attr.get('id') == 'SELLER_SKU':
                    sku = attr.get('value_name', '')
                    break

        if price is not None:
            meli_data[item_id] = {
                'price': float(price),
                'sku':   sku.strip(),
                'title': title,
            }

    print(f"  Lote {i//20+1}/{math.ceil(len(all_item_ids)/20)}: OK")
    time.sleep(0.2)  # respetar rate limit

print(f"  {len(meli_data)} items con precio")

# ─────────────────────────────────────────────
# 4. LEER GOOGLE SHEETS
# ─────────────────────────────────────────────
print("\n[Sheets] Leyendo catálogo...")
gc = gspread.service_account(filename=CREDS_PATH)
wb = gc.open_by_key(SHEET_ID)
ws = wb.sheet1
rows = ws.get_all_values()

header   = [h.strip().upper() for h in rows[0]]
idx_meli = 0   # Columna A: meli_id
idx_sku  = next((i for i, h in enumerate(header) if "SKU"    in h), 1)
idx_nom  = next((i for i, h in enumerate(header) if "NOMBRE" in h), 3)
idx_prec = next((i for i, h in enumerate(header) if "PRECIO" in h), 4)

print(f"  Columnas: meli_id={idx_meli}, sku={idx_sku}, nombre={idx_nom}, precio={idx_prec}")
print(f"  {len(rows)-1} productos en Sheets")

# ─────────────────────────────────────────────
# 5. CRUZAR Y CONSTRUIR ACTUALIZACIONES
# ─────────────────────────────────────────────
print("\n[Match] Cruzando MeLi ↔ Sheets por meli_id...")

# Índice: {meli_id.upper(): row_number_1based}
id_to_row = {}
for row_num, row in enumerate(rows[1:], start=2):
    meli_id = str(row[idx_meli]).strip().upper() if row[idx_meli] else ""
    if meli_id.startswith("MCO"):
        id_to_row[meli_id] = row_num

# También índice por SKU para fallback
sku_to_row = {}
for row_num, row in enumerate(rows[1:], start=2):
    sku = row[idx_sku].strip() if len(row) > idx_sku else ""
    if sku:
        sku_to_row[sku.upper()] = row_num

actualizaciones = []  # [(row_num, precio_nuevo, nombre, precio_viejo)]

for item_id, info in meli_data.items():
    precio_nuevo = info['price']
    nombre_meli  = info['title']

    # Buscar por meli_id
    row_num = id_to_row.get(item_id.upper())

    # Fallback: buscar por SKU
    if not row_num and info['sku']:
        row_num = sku_to_row.get(info['sku'].upper())

    if not row_num:
        continue

    row = rows[row_num - 1]
    precio_actual_raw = row[idx_prec].strip() if len(row) > idx_prec else ""
    nombre_sheets     = row[idx_nom].strip() if len(row) > idx_nom else ""

    try:
        precio_actual = float(
            precio_actual_raw.replace(",", "").replace("$", "").replace(" ", "")
        )
    except Exception:
        precio_actual = 0

    diferencia = abs(precio_nuevo - precio_actual)
    if diferencia > 1:  # actualizar si hay diferencia de más de $1
        actualizaciones.append((row_num, precio_nuevo, nombre_sheets or nombre_meli,
                                 precio_actual, item_id))

print(f"  {len(actualizaciones)} productos con precio diferente al de Sheets")

if not actualizaciones:
    print("\n✓ Precios ya están sincronizados. Sin cambios.")
else:
    print(f"\n[Sheets] Actualizando {len(actualizaciones)} precios...")
    print("-" * 65)

    # Columna de precio en letra (A=1, B=2, ...)
    col_letra = chr(ord('A') + idx_prec)

    # Usar batch_update para evitar rate limit (1 sola petición)
    batch_data = []
    for row_num, precio_nuevo, nombre, precio_viejo, item_id in actualizaciones:
        celda = f"{col_letra}{row_num}"
        batch_data.append({"range": celda, "values": [[int(round(precio_nuevo))]]})
        diff_pct = ((precio_nuevo - precio_viejo) / precio_viejo * 100
                    if precio_viejo else 0)
        signo = "▲" if diff_pct > 0 else "▼"
        print(f"  {signo} {nombre[:45]:<45} "
              f"${precio_viejo:>9,.0f} → ${precio_nuevo:>9,.0f}  "
              f"({diff_pct:+.1f}%)")

    actualizadas, errores = 0, 0
    # Enviar en lotes de 50 para no saturar
    lote_size = 50
    for i in range(0, len(batch_data), lote_size):
        lote = batch_data[i:i+lote_size]
        try:
            ws.batch_update(lote)
            actualizadas += len(lote)
            print(f"  ✓ Lote {i//lote_size+1}: {len(lote)} celdas actualizadas")
            if i + lote_size < len(batch_data):
                time.sleep(2)   # pausa entre lotes
        except Exception as e:
            errores += len(lote)
            print(f"  ERROR lote {i//lote_size+1}: {e}")

    print("-" * 65)
    print(f"\nRESUMEN:")
    print(f"  Actualizados : {actualizadas}")
    print(f"  Errores      : {errores}")

# ─────────────────────────────────────────────
# 6. INVALIDAR CACHE WEB
# ─────────────────────────────────────────────
print("\n[Cache] Invalidando cache del sitio web...")
try:
    if CACHE_FILE.exists():
        CACHE_FILE.unlink()
        print(f"  ✓ {CACHE_FILE} eliminado — el sitio reconstruirá el catálogo")
    else:
        print("  Cache no existía, nada que eliminar")
except Exception as e:
    print(f"  ERROR eliminando cache: {e}")

print("\n[Listo] Sincronización completada.")
print("  El sitio web cargará los nuevos precios en la próxima visita.")
