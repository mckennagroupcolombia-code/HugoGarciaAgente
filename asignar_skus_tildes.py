#!/usr/bin/env python3
"""
asignar_skus_tildes.py
Asigna SKUs de SIIGO a productos WooCommerce que no tienen SKU,
usando normalización de tildes/acentos y fuzzy matching (umbral 0.65).
"""

import os
import sys
import unicodedata
import re
import time
import requests
from dotenv import load_dotenv

# --- Cargar variables de entorno ---
load_dotenv('/home/mckg/mi-agente/.env')

# --- WooCommerce API ---
try:
    from woocommerce import API
    wcapi = API(
        url=os.getenv('WC_URL'),
        consumer_key=os.getenv('WC_KEY'),
        consumer_secret=os.getenv('WC_SECRET'),
        version="wc/v3",
        timeout=30
    )
except ImportError:
    print("ERROR: woocommerce-api no instalado. Ejecuta: pip install woocommerce")
    sys.exit(1)

# --- Fuzzy matching ---
try:
    from rapidfuzz import fuzz
    USE_RAPIDFUZZ = True
    print("INFO: Usando rapidfuzz para matching.")
except ImportError:
    from difflib import SequenceMatcher
    USE_RAPIDFUZZ = False
    print("INFO: rapidfuzz no disponible, usando difflib.SequenceMatcher.")

THRESHOLD = 0.65

# ─────────────────────────────────────────────
# Normalización
# ─────────────────────────────────────────────
def normalizar(texto):
    """Convierte a minúsculas, elimina tildes/acentos y caracteres especiales."""
    if not texto:
        return ""
    # Descomponer en forma NFKD y quitar combining chars (tildes, acentos)
    nfkd = unicodedata.normalize('NFKD', texto.lower())
    sin_tildes = ''.join(c for c in nfkd if not unicodedata.combining(c))
    # Eliminar caracteres especiales, dejar solo alfanuméricos y espacios
    limpio = re.sub(r'[^a-z0-9\s]', ' ', sin_tildes)
    # Normalizar espacios múltiples
    return re.sub(r'\s+', ' ', limpio).strip()


# ─────────────────────────────────────────────
# Similitud entre dos textos normalizados
# ─────────────────────────────────────────────
def similitud(a, b):
    if not a or not b:
        return 0.0
    if USE_RAPIDFUZZ:
        # token_sort_ratio es resistente a orden de palabras, retorna 0-100
        return fuzz.token_sort_ratio(a, b) / 100.0
    else:
        return SequenceMatcher(None, a, b).ratio()


# ─────────────────────────────────────────────
# Obtener productos WooCommerce SIN SKU
# ─────────────────────────────────────────────
def obtener_wc_sin_sku():
    print("\n[1/3] Obteniendo productos WooCommerce sin SKU...")
    productos = []
    page = 1
    per_page = 100
    while True:
        try:
            resp = wcapi.get("products", params={"per_page": per_page, "page": page, "status": "any"})
            if resp.status_code != 200:
                print(f"  ERROR al consultar WooCommerce (página {page}): {resp.status_code} - {resp.text[:200]}")
                break
            data = resp.json()
            if not data:
                break
            for p in data:
                sku_actual = (p.get('sku') or '').strip()
                if not sku_actual:  # Solo los que NO tienen SKU
                    productos.append({
                        'id': p['id'],
                        'nombre': p.get('name', ''),
                        'sku': sku_actual
                    })
            if len(data) < per_page:
                break
            page += 1
            time.sleep(0.2)  # Respetar rate limit
        except Exception as e:
            print(f"  ERROR inesperado obteniendo WC (página {page}): {e}")
            break

    print(f"  -> {len(productos)} productos WooCommerce sin SKU encontrados.")
    return productos


# ─────────────────────────────────────────────
# Obtener todos los productos SIIGO
# ─────────────────────────────────────────────
def autenticar_siigo():
    import json
    ruta_json = os.path.expanduser("~/mi-agente/credenciales_SIIGO.json")
    if not os.path.exists(ruta_json):
        print(f"  ERROR: credenciales_SIIGO.json no encontrado en {ruta_json}")
        return None
    with open(ruta_json, "r") as f:
        creds = json.load(f)
    # Usar token cacheado si no ha vencido
    if time.time() < creds.get("token_vencimiento", 0):
        return creds["access_token"]
    # Re-autenticar
    res = requests.post(
        "https://api.siigo.com/auth",
        json={"username": creds["username"], "access_key": creds["api_key"]},
        headers={"Partner-Id": "SiigoAPI"},
        timeout=10
    )
    if res.status_code == 200:
        token = res.json().get("access_token")
        creds.update({"access_token": token, "token_vencimiento": time.time() + (23 * 3600)})
        with open(ruta_json, "w") as f:
            json.dump(creds, f)
        return token
    else:
        print(f"  ERROR autenticando SIIGO: {res.status_code} - {res.text[:200]}")
        return None


def obtener_siigo_productos():
    print("[2/3] Obteniendo productos SIIGO...")
    token = autenticar_siigo()
    if not token:
        return []

    productos = []
    page = 1
    while True:
        try:
            res = requests.get(
                f"https://api.siigo.com/v1/products?page={page}&page_size=100",
                headers={"Authorization": f"Bearer {token}", "Partner-Id": "SiigoAPI"},
                timeout=15
            )
            if res.status_code != 200:
                print(f"  ERROR SIIGO productos (página {page}): {res.status_code} - {res.text[:200]}")
                break
            data = res.json()
            results = data.get('results', [])
            if not results:
                break
            for p in results:
                productos.append({
                    'code': p.get('code', ''),
                    'nombre': p.get('name', ''),
                })
            # Verificar si hay más páginas
            pagination = data.get('pagination', {})
            total = pagination.get('total_results', len(productos))
            if len(productos) >= total:
                break
            page += 1
            time.sleep(0.1)
        except Exception as e:
            print(f"  ERROR inesperado obteniendo SIIGO (página {page}): {e}")
            break

    print(f"  -> {len(productos)} productos SIIGO encontrados.")
    return productos


# ─────────────────────────────────────────────
# Matching fuzzy con nombres normalizados
# ─────────────────────────────────────────────
def encontrar_mejor_match(nombre_wc_norm, siigo_normalizados):
    """
    Retorna (indice_siigo, score) del mejor match, o (None, 0) si ninguno supera el umbral.
    siigo_normalizados: lista de (nombre_normalizado, indice_original)
    """
    mejor_idx = None
    mejor_score = 0.0
    for norm_siigo, idx_siigo in siigo_normalizados:
        score = similitud(nombre_wc_norm, norm_siigo)
        if score > mejor_score:
            mejor_score = score
            mejor_idx = idx_siigo
    if mejor_score >= THRESHOLD:
        return mejor_idx, mejor_score
    return None, 0.0


# ─────────────────────────────────────────────
# Actualizar SKU en WooCommerce
# ─────────────────────────────────────────────
def actualizar_sku_wc(product_id, sku):
    try:
        resp = wcapi.put(f"products/{product_id}", {"sku": sku})
        if resp.status_code in (200, 201):
            return True
        else:
            print(f"    ERROR actualizando WC id={product_id}: {resp.status_code} - {resp.text[:200]}")
            return False
    except Exception as e:
        print(f"    ERROR inesperado actualizando WC id={product_id}: {e}")
        return False


# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────
def main():
    print("=" * 60)
    print("  ASIGNACION DE SKUs CON NORMALIZACION DE TILDES")
    print(f"  Umbral de similitud: {THRESHOLD}")
    print("=" * 60)

    # 1. WooCommerce: solo productos sin SKU
    wc_sin_sku = obtener_wc_sin_sku()
    if not wc_sin_sku:
        print("\nNo hay productos WooCommerce sin SKU. Nada que hacer.")
        return

    # 2. SIIGO: todos los productos
    siigo_productos = obtener_siigo_productos()
    if not siigo_productos:
        print("\nNo se pudieron obtener productos de SIIGO. Abortando.")
        return

    # 3. Pre-normalizar nombres SIIGO
    siigo_normalizados = [
        (normalizar(p['nombre']), idx)
        for idx, p in enumerate(siigo_productos)
    ]

    print(f"\n[3/3] Ejecutando fuzzy matching sobre {len(wc_sin_sku)} productos WC sin SKU...")
    print("-" * 60)

    asignados = 0
    errores = 0
    sin_match = 0
    resultados = []

    for wc_prod in wc_sin_sku:
        nombre_wc = wc_prod['nombre']
        nombre_wc_norm = normalizar(nombre_wc)

        if not nombre_wc_norm:
            sin_match += 1
            continue

        idx_match, score = encontrar_mejor_match(nombre_wc_norm, siigo_normalizados)

        if idx_match is None:
            sin_match += 1
            continue

        siigo_match = siigo_productos[idx_match]
        sku_nuevo = siigo_match['code']
        nombre_siigo = siigo_match['nombre']

        if not sku_nuevo:
            print(f"  SKIP: '{nombre_wc}' -> SIIGO '{nombre_siigo}' no tiene code/SKU.")
            sin_match += 1
            continue

        # Asignar SKU en WooCommerce
        ok = actualizar_sku_wc(wc_prod['id'], sku_nuevo)
        if ok:
            asignados += 1
            msg = (f"  ASIGNADO: WC id={wc_prod['id']} | '{nombre_wc}' "
                   f"-> SKU '{sku_nuevo}' (SIIGO: '{nombre_siigo}') | score={score:.2f}")
            print(msg)
            resultados.append({
                'wc_id': wc_prod['id'],
                'wc_nombre': nombre_wc,
                'siigo_nombre': nombre_siigo,
                'sku': sku_nuevo,
                'score': round(score, 3)
            })
        else:
            errores += 1

        time.sleep(0.15)  # Evitar rate limit WC

    # ─── Resumen final ───
    print("\n" + "=" * 60)
    print("  RESUMEN")
    print("=" * 60)
    print(f"  Productos WC sin SKU evaluados : {len(wc_sin_sku)}")
    print(f"  Nuevos SKUs asignados          : {asignados}")
    print(f"  Sin match (score < {THRESHOLD}) : {sin_match}")
    print(f"  Errores al actualizar WC       : {errores}")

    if resultados:
        print("\n  Detalle de asignaciones:")
        for r in resultados:
            print(f"    - [{r['wc_id']}] '{r['wc_nombre']}' => SKU '{r['sku']}' "
                  f"(SIIGO: '{r['siigo_nombre']}', score={r['score']})")
    else:
        print("\n  No se asignaron nuevos SKUs.")

    print("=" * 60)


if __name__ == "__main__":
    main()
