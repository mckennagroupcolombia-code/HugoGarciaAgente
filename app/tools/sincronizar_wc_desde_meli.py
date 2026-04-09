"""
Skill para sincronizar WooCommerce copiando los productos de MercadoLibre 
que tienen un SKU válido en SIIGO.
"""

import os
import json
import time
import html
import requests
from dotenv import load_dotenv

from woocommerce import API as WooCommerceAPI
from app.utils import refrescar_token_meli
from app.tools.verificacion_sync_skus import _get_siigo_skus

load_dotenv(os.path.join(os.path.dirname(__file__), '../../.env'))

# ─── Configuración ──────────────────────────────────────────────────────────
WC_URL     = os.getenv('WC_URL', 'https://mckennagroup.co')
WC_KEY     = os.getenv('WC_KEY')
WC_SECRET  = os.getenv('WC_SECRET')

_cat_cache = {}
_wc_cat_cache = {}

def _meli_get(token: str, path: str, **params):
    r = requests.get(
        f'https://api.mercadolibre.com{path}',
        headers={'Authorization': f'Bearer {token}'},
        params=params,
        timeout=20,
    )
    r.raise_for_status()
    return r.json()

def _extraer_sku(item: dict) -> str:
    sku = (item.get('seller_custom_field') or '').strip()
    if not sku:
        for attr in item.get('attributes', []):
            if attr.get('id') == 'SELLER_SKU':
                sku = (attr.get('value_name') or '').strip()
                break
    return sku

def _obtener_categoria_meli(token: str, cat_id: str) -> str:
    if cat_id in _cat_cache: return _cat_cache[cat_id]
    try:
        data = _meli_get(token, f'/categories/{cat_id}')
        nombre = data.get('name', 'Productos')
    except Exception:
        nombre = 'Productos'
    _cat_cache[cat_id] = nombre
    return nombre

def _obtener_descripcion_meli(token: str, item_id: str) -> str:
    try:
        data = _meli_get(token, f'/items/{item_id}/description')
        texto = data.get('plain_text') or data.get('text') or ''
        return html.escape(texto).replace('\n', '<br>') if texto.strip() else ''
    except Exception:
        return ''

def _construir_descripcion_atributos(item: dict) -> str:
    attrs = item.get('attributes', [])
    if not attrs: return ''
    filas = []
    for a in attrs:
        nombre = a.get('name', '')
        valor  = a.get('value_name', '')
        if nombre and valor and nombre not in ('SKU', 'SELLER_SKU'):
            filas.append(f'<tr><td><strong>{html.escape(nombre)}</strong></td><td>{html.escape(str(valor))}</td></tr>')
    if not filas: return ''
    return '<table><tbody>' + ''.join(filas) + '</tbody></table>'

def _obtener_o_crear_categoria_wc(wcapi, nombre: str) -> int:
    if nombre in _wc_cat_cache: return _wc_cat_cache[nombre]
    r = wcapi.get('products/categories', params={'search': nombre, 'per_page': 10})
    if r.status_code == 200:
        for cat in r.json():
            if cat['name'].lower() == nombre.lower():
                _wc_cat_cache[nombre] = cat['id']
                return cat['id']
    r = wcapi.post('products/categories', data={'name': nombre})
    if r.status_code in (200, 201):
        cat_id = r.json()['id']
        _wc_cat_cache[nombre] = cat_id
        return cat_id
    return 0

def _meli_a_wc_payload(wcapi, item: dict) -> dict:
    sku = _extraer_sku(item)
    titulo = (item.get('title') or '').strip()
    precio = item.get('price') or item.get('original_price') or 0
    stock = item.get('available_quantity', 0)
    desc = item.get('_descripcion', '')
    cat_nombre = item.get('_categoria_nombre', 'Productos')

    imagenes = []
    for pic in item.get('pictures', []):
        url = pic.get('url') or pic.get('secure_url') or ''
        url = url.replace('-O.jpg', '-F.jpg').replace('-N.jpg', '-F.jpg')
        if url: imagenes.append({'src': url, 'alt': titulo})

    atributos_wc = []
    for a in item.get('attributes', []):
        nombre_attr = (a.get('name') or '').strip()
        valor_attr  = (a.get('value_name') or '').strip()
        if nombre_attr and valor_attr and nombre_attr not in ('SKU', 'SELLER_SKU'):
            atributos_wc.append({'name': nombre_attr, 'options': [valor_attr], 'visible': True})

    payload = {
        'name': titulo, 'type': 'simple', 'status': 'publish', 'sku': sku,
        'regular_price': str(int(precio)), 'description': desc, 'short_description': titulo,
        'manage_stock': True, 'stock_quantity': int(stock),
        'stock_status': 'instock' if stock > 0 else 'outofstock',
        'images': imagenes, 'attributes': atributos_wc,
        'meta_data': [
            {'key': '_meli_id', 'value': item.get('id', '')},
            {'key': '_meli_permalink', 'value': item.get('permalink', '')}
        ]
    }
    if cat_nombre:
        cat_id = _obtener_o_crear_categoria_wc(wcapi, cat_nombre)
        if cat_id: payload['categories'] = [{'id': cat_id}]
    return payload

def sincronizar_catalogo_wc_desde_meli(dry_run: bool = False) -> str:
    """
    Sincroniza WooCommerce borrando todo y recreando los productos desde MercadoLibre
    que tengan un SKU válido en SIIGO.
    """
    salida = ["🚀 Iniciando SINCRONIZACIÓN WooCommerce ← MercadoLibre..."]
    
    if not all([WC_URL, WC_KEY, WC_SECRET]):
        return "❌ Error: Faltan credenciales de WooCommerce."

    wcapi = WooCommerceAPI(url=WC_URL, consumer_key=WC_KEY, consumer_secret=WC_SECRET, version="wc/v3", timeout=60)
    
    # 1. Obtener SKUs SIIGO
    try:
        skus_siigo = set(_get_siigo_skus().keys())
        salida.append(f"✅ {len(skus_siigo)} SKUs en SIIGO.")
    except Exception as e:
        return f"❌ Error obteniendo SKUs de SIIGO: {e}"

    # 2. Obtener MeLi
    try:
        token = refrescar_token_meli()
        me = _meli_get(token, '/users/me')
        seller_id = me['id']

        all_ids, offset = [], 0
        while True:
            data = _meli_get(token, f'/users/{seller_id}/items/search', status='active', limit=100, offset=offset)
            ids = data.get('results', [])
            all_ids.extend(ids)
            offset += len(ids)
            if offset >= data.get('paging', {}).get('total', 0) or not ids: break

        productos = []
        for i in range(0, len(all_ids), 20):
            lote = all_ids[i:i+20]
            resp = requests.get(f'https://api.mercadolibre.com/items?ids={",".join(lote)}', headers={'Authorization': f'Bearer {token}'}, timeout=30)
            for item_wrap in resp.json():
                if item_wrap.get('code') != 200: continue
                item = item_wrap['body']
                sku = _extraer_sku(item)
                if sku and sku in skus_siigo:
                    productos.append(item)
        salida.append(f"✅ {len(productos)} productos activos de MeLi con SKU en SIIGO.")
    except Exception as e:
        return f"❌ Error obteniendo productos de MeLi: {e}"

    if not productos:
        return "⚠️ No se encontraron productos con SKU en SIIGO. Abortando sincronización."

    # 3. Enriquecer MeLi
    try:
        for item in productos:
            cat_id = item.get('category_id', '')
            item['_categoria_nombre'] = _obtener_categoria_meli(token, cat_id) if cat_id else 'Productos'
            desc = _obtener_descripcion_meli(token, item['id'])
            if not desc: desc = _construir_descripcion_atributos(item)
            item['_descripcion'] = desc
        salida.append("✅ Categorías y descripciones descargadas de MeLi.")
    except Exception as e:
        salida.append(f"⚠️ Aviso: Error parcial obteniendo detalles de MeLi: {e}")

    # Deduplicar
    vistos = {}
    for p in productos:
        sku = _extraer_sku(p)
        if sku not in vistos or p.get('available_quantity', 0) > vistos[sku].get('available_quantity', 0):
            vistos[sku] = p
    productos = list(vistos.values())

    if dry_run:
        salida.append(f"\n🔍 [DRY-RUN] Se crearían {len(productos)} productos en WC. No se modificó nada.")
        return "\n".join(salida)

    # 4. Eliminar WC
    try:
        ids_wc, page = [], 1
        while True:
            r = wcapi.get('products', params={'per_page': 100, 'page': page, 'status': 'any', 'fields': 'id'})
            if r.status_code != 200: break
            batch = [p['id'] for p in r.json()]
            if not batch: break
            ids_wc.extend(batch)
            if len(batch) < 100: break
            page += 1

        eliminados = 0
        for i in range(0, len(ids_wc), 100):
            lote = ids_wc[i:i+100]
            r = wcapi.post('products/batch', data={'delete': lote})
            if r.status_code in (200, 201): eliminados += len(lote)
        salida.append(f"🗑️ {eliminados} productos eliminados de WooCommerce.")
    except Exception as e:
        salida.append(f"⚠️ Error eliminando productos de WC: {e}")

    # 5. Crear en WC
    creados, errores = 0, 0
    try:
        LOTE = 20
        for i in range(0, len(productos), LOTE):
            lote = productos[i:i+LOTE]
            payloads = [_meli_a_wc_payload(wcapi, p) for p in lote]
            r = wcapi.post('products/batch', data={'create': payloads})
            if r.status_code in (200, 201):
                resp_data = r.json()
                creados += len(resp_data.get('create', []))
                for prod_resp in resp_data.get('create', []):
                    if 'error' in prod_resp: errores += 1
            else:
                errores += len(lote)
        salida.append(f"✨ Creados en WooCommerce: {creados} | Errores: {errores}")
    except Exception as e:
        salida.append(f"❌ Error creando productos en WooCommerce: {e}")

    return "\n".join(salida)
