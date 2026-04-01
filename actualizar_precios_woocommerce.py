"""
Actualizar precios WooCommerce desde MercadoLibre
McKenna Group - 2026-03-31
"""

import os
import sys
import json
import math
import base64
from email.mime.text import MIMEText
from dotenv import load_dotenv
import requests

# Cargar variables de entorno
load_dotenv('/home/mckg/mi-agente/.env')

from woocommerce import API as WooCommerceAPI
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

# ─────────────────────────────────────────────
# CONFIGURACIÓN
# ─────────────────────────────────────────────
MELI_CREDS_PATH = os.getenv('MELI_CREDS_PATH', '/home/mckg/mi-agente/credenciales_meli.json')
GMAIL_TOKEN_PATH = '/home/mckg/mi-agente/app/tools/token_gmail.json'
GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.send']
EMAIL_DESTINO = 'cynthua0418@gmail.com'
FECHA_HOY = '2026-03-31'

# ─────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────

def formato_cop(valor):
    """Formatea un número como $XX.XXX COP"""
    try:
        v = int(round(float(valor)))
        s = f"{v:,}".replace(",", ".")
        return f"${s} COP"
    except Exception:
        return str(valor)

# ─────────────────────────────────────────────
# 1. CARGAR CREDENCIALES MELI
# ─────────────────────────────────────────────
print("=" * 60)
print("ACTUALIZADOR DE PRECIOS WOOCOMMERCE ← MERCADOLIBRE")
print("McKenna Group | " + FECHA_HOY)
print("=" * 60)

with open(MELI_CREDS_PATH) as f:
    meli_creds = json.load(f)

MELI_TOKEN = meli_creds['access_token']
MELI_SELLER_ID = meli_creds.get('seller_id') or meli_creds.get('user_id')

# Si no hay seller_id en el archivo, obtenerlo de la API
if not MELI_SELLER_ID:
    print("  Obteniendo seller_id desde API de MeLi...")
    r = requests.get(
        'https://api.mercadolibre.com/users/me',
        headers={'Authorization': f'Bearer {MELI_TOKEN}'},
        timeout=15
    )
    if r.status_code == 200:
        MELI_SELLER_ID = r.json()['id']
    else:
        print(f"  ERROR obteniendo seller_id: {r.status_code} {r.text}")
        sys.exit(1)

print(f"\n[MeLi] Seller ID: {MELI_SELLER_ID}")

# ─────────────────────────────────────────────
# 2. OBTENER TODOS LOS LISTINGS ACTIVOS DE MELI
# ─────────────────────────────────────────────
print("\n[MeLi] Obteniendo listings activos (con paginacion)...")

meli_headers = {'Authorization': f'Bearer {MELI_TOKEN}'}
all_item_ids = []
offset = 0
limit = 100

while True:
    url = (
        f"https://api.mercadolibre.com/users/{MELI_SELLER_ID}/items/search"
        f"?status=active&limit={limit}&offset={offset}"
    )
    r = requests.get(url, headers=meli_headers, timeout=20)
    if r.status_code != 200:
        print(f"  ERROR paginando listings: {r.status_code} {r.text}")
        break
    data = r.json()
    ids = data.get('results', [])
    all_item_ids.extend(ids)
    paging = data.get('paging', {})
    total = paging.get('total', 0)
    offset += limit
    print(f"  Página offset={offset - limit}: {len(ids)} items (total={total})")
    if offset >= total:
        break

print(f"  Total listings encontrados: {len(all_item_ids)}")

# ─────────────────────────────────────────────
# 3. BATCH GET DE ITEMS (20 a la vez)
# ─────────────────────────────────────────────
print("\n[MeLi] Obteniendo detalles de items en lotes de 20...")

meli_prices = {}  # {sku: {"price": float, "title": str, "item_id": str}}
batch_size = 20

for i in range(0, len(all_item_ids), batch_size):
    batch = all_item_ids[i:i + batch_size]
    ids_str = ",".join(batch)
    url = f"https://api.mercadolibre.com/items?ids={ids_str}"
    r = requests.get(url, headers=meli_headers, timeout=30)
    if r.status_code != 200:
        print(f"  ERROR batch {i//batch_size + 1}: {r.status_code}")
        continue

    results = r.json()
    for entry in results:
        if entry.get('code') != 200:
            continue
        item = entry.get('body', {})
        item_id = item.get('id', '')
        price = item.get('price')
        title = item.get('title', '')

        # Extraer SKU
        sku = item.get('seller_custom_field') or ''
        if not sku:
            for attr in item.get('attributes', []):
                if attr.get('id') == 'SELLER_SKU':
                    sku = attr.get('value_name', '')
                    break

        if sku and price is not None:
            meli_prices[sku.strip()] = {
                'price': float(price),
                'title': title,
                'item_id': item_id
            }

    print(f"  Lote {i//batch_size + 1}/{math.ceil(len(all_item_ids)/batch_size)}: {len(results)} items procesados")

print(f"  SKUs con precio en MeLi: {len(meli_prices)}")
if meli_prices:
    for sku, info in list(meli_prices.items())[:5]:
        print(f"    SKU={sku} | Precio={info['price']} | {info['title'][:50]}")

# ─────────────────────────────────────────────
# 4. OBTENER PRODUCTOS DE WOOCOMMERCE
# ─────────────────────────────────────────────
print("\n[WooCommerce] Obteniendo todos los productos...")

wcapi = WooCommerceAPI(
    url=os.getenv('WC_URL'),
    consumer_key=os.getenv('WC_KEY'),
    consumer_secret=os.getenv('WC_SECRET'),
    version='wc/v3',
    timeout=30
)

wc_products = []
page = 1
while True:
    resp = wcapi.get("products", params={"per_page": 100, "page": page, "status": "publish"})
    data = resp.json()
    if not data:
        break
    wc_products.extend(data)
    print(f"  Página {page}: {len(data)} productos")
    if len(data) < 100:
        break
    page += 1

print(f"  Total productos WooCommerce: {len(wc_products)}")

# ─────────────────────────────────────────────
# 5. ACTUALIZAR PRECIOS
# ─────────────────────────────────────────────
print("\n[Actualización] Sincronizando precios MeLi → WooCommerce...")
print("-" * 60)

updated = 0
skipped = 0
errors = 0
price_list = []  # Para el email

for product in wc_products:
    wc_id = product.get('id')
    wc_name = product.get('name', '')
    wc_sku = (product.get('sku') or '').strip()

    if not wc_sku or wc_sku not in meli_prices:
        skipped += 1
        continue

    meli_info = meli_prices[wc_sku]
    meli_price = meli_info['price']

    regular_price = int(round(meli_price))
    sale_price = int(round(meli_price * 0.85))
    descuento_pct = 15
    ahorro = regular_price - sale_price

    try:
        result = wcapi.put(
            f"products/{wc_id}",
            {
                "regular_price": str(regular_price),
                "sale_price": str(sale_price)
            }
        ).json()

        if 'id' in result:
            updated += 1
            print(
                f"  OK | {wc_name[:35]:<35} | MeLi: {formato_cop(meli_price):<18} "
                f"| Regular: {formato_cop(regular_price):<18} "
                f"| Oferta: {formato_cop(sale_price):<18} (-{descuento_pct}%)"
            )
            price_list.append({
                'producto': wc_name,
                'sku': wc_sku,
                'precio_meli': meli_price,
                'precio_regular': regular_price,
                'precio_oferta': sale_price,
                'ahorro': ahorro,
            })
        else:
            errors += 1
            print(f"  ERROR | {wc_name[:40]} | Respuesta inesperada: {result}")

    except Exception as e:
        errors += 1
        print(f"  EXCEPCION | {wc_name[:40]} | {e}")

print("-" * 60)
print(f"\nRESUMEN:")
print(f"  Productos actualizados : {updated}")
print(f"  Sin coincidencia de SKU : {skipped}")
print(f"  Errores                : {errors}")

# ─────────────────────────────────────────────
# 6. CONSTRUIR TABLA PRICE LIST
# ─────────────────────────────────────────────
price_list.sort(key=lambda x: x['producto'].lower())

# ─────────────────────────────────────────────
# 7. CONSTRUIR EMAIL HTML
# ─────────────────────────────────────────────
print("\n[Email] Construyendo HTML y enviando a " + EMAIL_DESTINO + "...")

rows_html = ""
for i, p in enumerate(price_list):
    bg = "#f9f9f9" if i % 2 == 0 else "#ffffff"
    rows_html += f"""
        <tr style="background-color:{bg};">
            <td style="padding:8px 12px; border-bottom:1px solid #eee;">{p['producto']}</td>
            <td style="padding:8px 12px; border-bottom:1px solid #eee; text-align:center; color:#555;">{p['sku']}</td>
            <td style="padding:8px 12px; border-bottom:1px solid #eee; text-align:right;">{formato_cop(p['precio_meli'])}</td>
            <td style="padding:8px 12px; border-bottom:1px solid #eee; text-align:right;">{formato_cop(p['precio_regular'])}</td>
            <td style="padding:8px 12px; border-bottom:1px solid #eee; text-align:right; color:#1a7f37; font-weight:bold;">{formato_cop(p['precio_oferta'])}</td>
            <td style="padding:8px 12px; border-bottom:1px solid #eee; text-align:right; color:#c0392b;">{formato_cop(p['ahorro'])}</td>
        </tr>"""

html_body = f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<style>
  body {{ font-family: Arial, sans-serif; background:#f5f5f5; color:#333; margin:0; padding:0; }}
  .container {{ max-width:900px; margin:30px auto; background:#fff; border-radius:8px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,.1); }}
  .header {{ background:#1a3c5e; color:#fff; padding:28px 32px; }}
  .header h1 {{ margin:0; font-size:22px; letter-spacing:.5px; }}
  .header p {{ margin:6px 0 0; font-size:13px; opacity:.8; }}
  .content {{ padding:28px 32px; }}
  .note {{ background:#eaf4fb; border-left:4px solid #1a7f9c; padding:12px 16px; border-radius:4px; margin-bottom:24px; font-size:13px; color:#2c6e8a; }}
  table {{ width:100%; border-collapse:collapse; font-size:13px; }}
  th {{ background:#1a3c5e; color:#fff; padding:10px 12px; text-align:left; }}
  th.num {{ text-align:right; }}
  .summary {{ margin-top:20px; font-size:13px; color:#666; }}
  .footer {{ background:#f0f0f0; text-align:center; padding:16px; font-size:11px; color:#888; border-top:1px solid #ddd; }}
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>McKenna Group</h1>
    <p>Lista de Precios Comparativa - Canal Web vs MercadoLibre</p>
  </div>
  <div class="content">
    <p style="font-size:13px; color:#666; margin-top:0;">Fecha: {FECHA_HOY}</p>
    <div class="note">
      Los precios del canal web incluyen un <strong>descuento del 15%</strong> frente a MercadoLibre.
      El cliente ahorra al comprar directamente, evitando las comisiones de la plataforma.
    </div>
    <table>
      <thead>
        <tr>
          <th>Producto</th>
          <th>SKU</th>
          <th class="num">Precio MeLi</th>
          <th class="num">Precio Web (regular)</th>
          <th class="num">Precio Web (oferta)</th>
          <th class="num">Ahorro</th>
        </tr>
      </thead>
      <tbody>
        {rows_html}
      </tbody>
    </table>
    <div class="summary">
      <strong>Resumen:</strong> {updated} productos actualizados &nbsp;|&nbsp;
      {skipped} sin coincidencia de SKU &nbsp;|&nbsp; {errors} errores
    </div>
  </div>
  <div class="footer">
    McKenna Group S.A.S &bull; Materias primas farmacéuticas &bull; {FECHA_HOY}<br>
    Este correo fue generado automáticamente por el sistema de gestión de precios.
  </div>
</div>
</body>
</html>"""

# ─────────────────────────────────────────────
# 8. ENVIAR EMAIL VÍA GMAIL API
# ─────────────────────────────────────────────
subject = f"Lista de Precios - McKenna Group ({FECHA_HOY})"

try:
    creds = Credentials.from_authorized_user_file(GMAIL_TOKEN_PATH, GMAIL_SCOPES)
    service = build('gmail', 'v1', credentials=creds)

    message = MIMEText(html_body, 'html')
    message['to'] = EMAIL_DESTINO
    message['subject'] = subject

    raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
    result = service.users().messages().send(userId='me', body={'raw': raw}).execute()

    print(f"  Email enviado exitosamente. Message ID: {result.get('id')}")
except Exception as e:
    print(f"  ERROR enviando email: {e}")

print("\n[Listo] Script finalizado.")
