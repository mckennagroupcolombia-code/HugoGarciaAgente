#!/usr/bin/env python3
"""
Sincronización WooCommerce ← MercadoLibre
==========================================
1. Obtiene SKUs válidos de SIIGO
2. Obtiene publicaciones activas de MeLi con SKU en SIIGO
3. Elimina TODOS los productos actuales de WooCommerce
4. Crea productos nuevos en WooCommerce replicando los de MeLi

Uso:
    python3 sincronizar_wc_desde_meli.py [--dry-run]

    --dry-run : solo muestra qué haría, sin modificar nada
"""

import os
import sys
import json
import time
import html
import argparse
import requests
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

# ─── Configuración ──────────────────────────────────────────────────────────
MELI_CREDS = os.getenv('MELI_CREDS_PATH', 'credenciales_meli.json')
WC_URL     = os.getenv('WC_URL', 'https://mckennagroup.co')
WC_KEY     = os.getenv('WC_KEY')
WC_SECRET  = os.getenv('WC_SECRET')

DRY_RUN = '--dry-run' in sys.argv

# ─── Clientes API ───────────────────────────────────────────────────────────
from woocommerce import API as WooCommerceAPI
wcapi = WooCommerceAPI(
    url=WC_URL,
    consumer_key=WC_KEY,
    consumer_secret=WC_SECRET,
    version="wc/v3",
    timeout=60,
)


def meli_token():
    with open(MELI_CREDS) as f:
        return json.load(f)['access_token']


def meli_get(path, **params):
    token = meli_token()
    r = requests.get(
        f'https://api.mercadolibre.com{path}',
        headers={'Authorization': f'Bearer {token}'},
        params=params,
        timeout=20,
    )
    r.raise_for_status()
    return r.json()


# ═══════════════════════════════════════════════════════════════════════════
# PASO 1 — SKUs de SIIGO
# ═══════════════════════════════════════════════════════════════════════════

def obtener_skus_siigo() -> set:
    print('\n📦 [1/5] Obteniendo SKUs de SIIGO...')
    sys.path.insert(0, os.path.dirname(__file__))
    from app.tools.verificacion_sync_skus import _get_siigo_skus
    skus = set(_get_siigo_skus().keys())
    print(f'   ✅ {len(skus)} SKUs en SIIGO')
    return skus


# ═══════════════════════════════════════════════════════════════════════════
# PASO 2 — Publicaciones activas de MeLi
# ═══════════════════════════════════════════════════════════════════════════

def _extraer_sku(item: dict) -> str:
    """Extrae el SKU del campo seller_custom_field o del atributo SELLER_SKU."""
    sku = (item.get('seller_custom_field') or '').strip()
    if not sku:
        for attr in item.get('attributes', []):
            if attr.get('id') == 'SELLER_SKU':
                sku = (attr.get('value_name') or '').strip()
                break
    return sku


def obtener_productos_meli(skus_siigo: set) -> list:
    print('\n🛍  [2/5] Obteniendo publicaciones activas de MeLi...')
    me = meli_get('/users/me')
    seller_id = me['id']

    # Recolectar todos los IDs activos
    all_ids, offset = [], 0
    while True:
        data = meli_get(f'/users/{seller_id}/items/search',
                        status='active', limit=100, offset=offset)
        ids = data.get('results', [])
        all_ids.extend(ids)
        offset += len(ids)
        if offset >= data.get('paging', {}).get('total', 0) or not ids:
            break
        time.sleep(0.2)

    print(f'   Publicaciones activas: {len(all_ids)}')

    # Obtener detalles en lotes de 20
    productos = []
    for i in range(0, len(all_ids), 20):
        lote = all_ids[i:i+20]
        resp = requests.get(
            f'https://api.mercadolibre.com/items?ids={",".join(lote)}',
            headers={'Authorization': f'Bearer {meli_token()}'},
            timeout=30,
        )
        for item_wrap in resp.json():
            if item_wrap.get('code') != 200:
                continue
            item = item_wrap['body']
            sku = _extraer_sku(item)
            if sku and sku in skus_siigo:
                productos.append(item)
        time.sleep(0.3)

    print(f'   ✅ {len(productos)} productos con SKU en SIIGO')
    return productos


# ═══════════════════════════════════════════════════════════════════════════
# PASO 3 — Descripciones y categorías de MeLi
# ═══════════════════════════════════════════════════════════════════════════

_cat_cache: dict = {}


def obtener_categoria_meli(cat_id: str) -> str:
    if cat_id in _cat_cache:
        return _cat_cache[cat_id]
    try:
        data = meli_get(f'/categories/{cat_id}')
        nombre = data.get('name', 'Productos')
    except Exception:
        nombre = 'Productos'
    _cat_cache[cat_id] = nombre
    return nombre


def obtener_descripcion_meli(item_id: str) -> str:
    try:
        data = meli_get(f'/items/{item_id}/description')
        texto = data.get('plain_text') or data.get('text') or ''
        # Escapar HTML básico
        return html.escape(texto).replace('\n', '<br>') if texto.strip() else ''
    except Exception:
        return ''


def construir_descripcion_atributos(item: dict) -> str:
    """Construye una descripción HTML con los atributos del producto."""
    attrs = item.get('attributes', [])
    if not attrs:
        return ''
    filas = []
    for a in attrs:
        nombre = a.get('name', '')
        valor  = a.get('value_name', '')
        if nombre and valor and nombre not in ('SKU', 'SELLER_SKU'):
            filas.append(f'<tr><td><strong>{html.escape(nombre)}</strong></td>'
                         f'<td>{html.escape(str(valor))}</td></tr>')
    if not filas:
        return ''
    return '<table><tbody>' + ''.join(filas) + '</tbody></table>'


def enriquecer_productos(productos: list) -> list:
    """Agrega descripción y nombre de categoría a cada producto."""
    print(f'\n📝 [3/5] Obteniendo descripciones y categorías ({len(productos)} productos)...')
    for idx, item in enumerate(productos, 1):
        cat_id = item.get('category_id', '')
        item['_categoria_nombre'] = obtener_categoria_meli(cat_id) if cat_id else 'Productos'

        desc = obtener_descripcion_meli(item['id'])
        if not desc:
            desc = construir_descripcion_atributos(item)
        item['_descripcion'] = desc

        if idx % 10 == 0:
            print(f'   ... {idx}/{len(productos)}')
        time.sleep(0.15)  # Rate limiting MeLi

    print('   ✅ Listo')
    return productos


# ═══════════════════════════════════════════════════════════════════════════
# PASO 4 — Eliminar productos de WooCommerce
# ═══════════════════════════════════════════════════════════════════════════

def obtener_todos_ids_wc() -> list:
    ids, page = [], 1
    while True:
        r = wcapi.get('products', params={'per_page': 100, 'page': page, 'status': 'any', 'fields': 'id'})
        if r.status_code != 200:
            print(f'   ⚠️ Error listando productos WC: {r.status_code}')
            break
        batch = [p['id'] for p in r.json()]
        if not batch:
            break
        ids.extend(batch)
        if len(batch) < 100:
            break
        page += 1
    return ids


def eliminar_todos_wc(dry_run: bool):
    print('\n🗑  [4/5] Eliminando productos de WooCommerce...')
    ids = obtener_todos_ids_wc()
    print(f'   Productos encontrados: {len(ids)}')
    if not ids:
        print('   (Nada que eliminar)')
        return

    if dry_run:
        print(f'   [DRY-RUN] Se eliminarían {len(ids)} productos')
        return

    eliminados = 0
    for i in range(0, len(ids), 100):
        lote = ids[i:i+100]
        payload = {'delete': lote}
        r = wcapi.post('products/batch', data=payload)
        if r.status_code in (200, 201):
            eliminados += len(lote)
            print(f'   Eliminados {eliminados}/{len(ids)}...')
        else:
            print(f'   ⚠️ Error en batch delete: {r.status_code} — {r.text[:200]}')
        time.sleep(1)

    print(f'   ✅ {eliminados} productos eliminados')


# ═══════════════════════════════════════════════════════════════════════════
# PASO 5 — Crear productos en WooCommerce
# ═══════════════════════════════════════════════════════════════════════════

_wc_cat_cache: dict = {}


def obtener_o_crear_categoria_wc(nombre: str) -> int:
    if nombre in _wc_cat_cache:
        return _wc_cat_cache[nombre]
    # Buscar si ya existe
    r = wcapi.get('products/categories', params={'search': nombre, 'per_page': 10})
    if r.status_code == 200:
        for cat in r.json():
            if cat['name'].lower() == nombre.lower():
                _wc_cat_cache[nombre] = cat['id']
                return cat['id']
    # Crear nueva
    r = wcapi.post('products/categories', data={'name': nombre})
    if r.status_code in (200, 201):
        cat_id = r.json()['id']
        _wc_cat_cache[nombre] = cat_id
        return cat_id
    # Fallback: sin categoría
    return 0


def meli_a_wc_payload(item: dict) -> dict:
    """Convierte un item de MeLi al payload de WooCommerce."""
    sku       = _extraer_sku(item)
    titulo    = (item.get('title') or '').strip()
    precio    = item.get('price') or item.get('original_price') or 0
    stock     = item.get('available_quantity', 0)
    desc      = item.get('_descripcion', '')
    cat_nombre = item.get('_categoria_nombre', 'Productos')

    # Imágenes: usar URL de tamaño grande
    imagenes = []
    for pic in item.get('pictures', []):
        url = pic.get('url') or pic.get('secure_url') or ''
        # MeLi URLs: reemplazar tamaño a fullHD
        url = url.replace('-O.jpg', '-F.jpg').replace('-N.jpg', '-F.jpg')
        if url:
            imagenes.append({'src': url, 'alt': titulo})

    # Atributos como metadatos de producto
    atributos_wc = []
    for a in item.get('attributes', []):
        nombre_attr = (a.get('name') or '').strip()
        valor_attr  = (a.get('value_name') or '').strip()
        if nombre_attr and valor_attr and nombre_attr not in ('SKU', 'SELLER_SKU'):
            atributos_wc.append({
                'name': nombre_attr,
                'options': [valor_attr],
                'visible': True,
            })

    payload = {
        'name':             titulo,
        'type':             'simple',
        'status':           'publish',
        'sku':              sku,
        'regular_price':    str(int(precio)),
        'description':      desc,
        'short_description': titulo,
        'manage_stock':     True,
        'stock_quantity':   int(stock),
        'stock_status':     'instock' if stock > 0 else 'outofstock',
        'images':           imagenes,
        'attributes':       atributos_wc,
        'meta_data': [
            {'key': '_meli_id',        'value': item.get('id', '')},
            {'key': '_meli_permalink', 'value': item.get('permalink', '')},
        ],
    }

    if cat_nombre:
        cat_id = obtener_o_crear_categoria_wc(cat_nombre)
        if cat_id:
            payload['categories'] = [{'id': cat_id}]

    return payload


def deduplicar_por_sku(productos: list) -> list:
    """Elimina duplicados de SKU: conserva el de mayor stock."""
    vistos = {}
    for p in productos:
        sku = _extraer_sku(p)
        if sku not in vistos:
            vistos[sku] = p
        else:
            # Conservar el que tiene más stock disponible
            if p.get('available_quantity', 0) > vistos[sku].get('available_quantity', 0):
                vistos[sku] = p
    unicos = list(vistos.values())
    duplicados = len(productos) - len(unicos)
    if duplicados:
        print(f'   ⚠️  {duplicados} SKU(s) duplicados eliminados (se conservó el de mayor stock)')
    return unicos


def crear_productos_wc(productos: list, dry_run: bool):
    productos = deduplicar_por_sku(productos)
    print(f'\n✨ [5/5] Creando {len(productos)} productos en WooCommerce...')

    if dry_run:
        print('   [DRY-RUN] Los siguientes productos se crearían:')
        for p in productos[:10]:
            sku = _extraer_sku(p)
            print(f'   • {sku} — {p.get("title","")[:60]}')
        if len(productos) > 10:
            print(f'   ... y {len(productos)-10} más')
        return 0, 0

    creados, errores = 0, 0
    # Lotes de 20 (WC batch create tiene límites)
    LOTE = 20
    for i in range(0, len(productos), LOTE):
        lote = productos[i:i+LOTE]
        payloads = [meli_a_wc_payload(p) for p in lote]

        r = wcapi.post('products/batch', data={'create': payloads})
        if r.status_code in (200, 201):
            resp_data = r.json()
            creados_batch = len(resp_data.get('create', []))
            creados += creados_batch
            # Reportar errores individuales
            for prod_resp in resp_data.get('create', []):
                if 'error' in prod_resp:
                    errores += 1
                    print(f'   ❌ Error: {prod_resp["error"].get("message", "")}')
            print(f'   Creados {creados}/{len(productos)}...')
        else:
            print(f'   ⚠️ Error en batch create (lote {i//LOTE+1}): '
                  f'{r.status_code} — {r.text[:300]}')
            errores += len(lote)

        time.sleep(1.5)

    print(f'\n   ✅ Creados: {creados} | Errores: {errores}')
    return creados, errores


# ═══════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════

def main():
    if DRY_RUN:
        print('🔍 MODO DRY-RUN — No se modificará nada\n')
    else:
        print('🚀 SINCRONIZACIÓN WooCommerce ← MercadoLibre\n')

    skus_siigo  = obtener_skus_siigo()
    productos   = obtener_productos_meli(skus_siigo)

    if not productos:
        print('\n⚠️ No se encontraron productos con SKU en SIIGO. Abortando.')
        return

    productos = enriquecer_productos(productos)

    eliminar_todos_wc(dry_run=DRY_RUN)
    creados, errores = crear_productos_wc(productos, dry_run=DRY_RUN)

    if not DRY_RUN:
        print(f'\n🎉 Sincronización completada.')
        print(f'   Productos creados en WooCommerce: {creados}')
        print(f'   Errores: {errores}')
        # Guardar reporte
        reporte = {
            'fecha': time.strftime('%Y-%m-%dT%H:%M:%S'),
            'total_siigo': len(skus_siigo),
            'total_meli_activos': 0,
            'total_sincronizados': len(productos),
            'creados_wc': creados,
            'errores': errores,
        }
        with open('reporte_sync_wc.json', 'w') as f:
            json.dump(reporte, f, indent=2)
        print('   Reporte guardado en reporte_sync_wc.json')


if __name__ == '__main__':
    main()
