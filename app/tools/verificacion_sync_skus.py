"""
verificacion_sync_skus.py
Verifica la sincronización de SKUs entre MercadoLibre, WooCommerce y SIIGO.
Notifica al grupo de WhatsApp cuando hay novedades.
"""
import os
import json
import requests
from dotenv import load_dotenv

load_dotenv()

GRUPO_INVENTARIO = os.getenv("GRUPO_INVENTARIO_WA", "120363407538342427@g.us")
URL_WA = os.getenv("URL_API_WHATSAPP", "http://127.0.0.1:3000/enviar")


def _get_siigo_skus() -> dict:
    """Retorna dict {code: nombre} de todos los productos SIIGO."""
    from app.services.siigo import autenticar_siigo, PARTNER_ID
    token = autenticar_siigo()
    headers = {"Authorization": f"Bearer {token}", "Partner-Id": PARTNER_ID}
    productos = {}
    page = 1
    while True:
        r = requests.get(
            f"https://api.siigo.com/v1/products?page={page}&page_size=100",
            headers=headers, timeout=20
        ).json()
        results = r.get("results", [])
        for p in results:
            code = (p.get("code") or "").strip()
            if code:
                productos[code] = (p.get("name") or "").strip()
        pag = r.get("pagination", {})
        total = pag.get("total_results", 0)
        page_size = pag.get("page_size", 100)
        import math
        total_pages = math.ceil(total / page_size) if page_size else 1
        if page >= total_pages or not results:
            break
        page += 1
    return productos


def _get_meli_skus() -> dict:
    """Retorna dict {sku: titulo} de todas las publicaciones activas de MeLi."""
    with open("credenciales_meli.json") as f:
        creds = json.load(f)
    token = creds["access_token"]
    me = requests.get("https://api.mercadolibre.com/users/me",
                      headers={"Authorization": f"Bearer {token}"}).json()
    seller_id = me["id"]

    item_ids = []
    offset = 0
    while True:
        r = requests.get(
            f"https://api.mercadolibre.com/users/{seller_id}/items/search"
            f"?status=active&limit=100&offset={offset}",
            headers={"Authorization": f"Bearer {token}"}
        ).json()
        ids = r.get("results", [])
        if not ids:
            break
        item_ids.extend(ids)
        offset += len(ids)
        if offset >= r.get("paging", {}).get("total", 0):
            break

    skus = {}
    for i in range(0, len(item_ids), 20):
        batch = ",".join(item_ids[i:i + 20])
        items = requests.get(
            f"https://api.mercadolibre.com/items?ids={batch}",
            headers={"Authorization": f"Bearer {token}"}
        ).json()
        for it in items:
            body = it.get("body", {})
            sku = (body.get("seller_custom_field") or "").strip()
            if not sku:
                for a in body.get("attributes", []):
                    if a.get("id") == "SELLER_SKU":
                        sku = (a.get("value_name") or "").strip()
                        break
            if sku:
                skus[sku] = body.get("title", "")
    return skus


def _get_wc_skus() -> dict:
    """Retorna dict {sku: nombre} de todos los productos publicados en WooCommerce."""
    from woocommerce import API
    wcapi = API(
        url=os.getenv("WC_URL"),
        consumer_key=os.getenv("WC_KEY"),
        consumer_secret=os.getenv("WC_SECRET"),
        version="wc/v3", timeout=30
    )
    skus = {}
    page = 1
    while True:
        r = wcapi.get("products", params={"per_page": 100, "page": page, "status": "publish"}).json()
        if not r:
            break
        for p in r:
            sku = p.get("sku", "").strip()
            if sku:
                skus[sku] = p.get("name", "")
        if len(r) < 100:
            break
        page += 1
    return skus


def _enviar_whatsapp(texto: str):
    try:
        requests.post(URL_WA, json={"numero": GRUPO_INVENTARIO, "mensaje": texto}, timeout=15)
    except Exception as e:
        print(f"⚠️ Error enviando WhatsApp: {e}")


def verificar_sync_skus(notificar_wa: bool = True) -> str:
    """
    Verifica cuántos SKUs de MeLi no están en SIIGO y/o WooCommerce.
    Si hay novedades y notificar_wa=True, envía alerta al grupo Inventario.
    Retorna un resumen en texto.
    """
    print("🔍 Obteniendo SKUs de las tres plataformas...")
    siigo = _get_siigo_skus()
    meli  = _get_meli_skus()
    wc    = _get_wc_skus()

    total_meli = len(meli)
    total_siigo = len(siigo)
    total_wc = len(wc)

    # Análisis
    meli_sin_siigo = {sku: titulo for sku, titulo in meli.items() if sku not in siigo}
    meli_sin_wc    = {sku: titulo for sku, titulo in meli.items() if sku not in wc}
    wc_sin_sku     = 0  # ya calculado arriba sería WC products total - len(wc)
    sincronizados  = {sku for sku in meli if sku in siigo and sku in wc}

    lineas = [
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "📊 REPORTE SINCRONIZACIÓN SKUs",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        f"📦 MercadoLibre (activos con SKU): {total_meli}",
        f"🧾 SIIGO (productos):              {total_siigo}",
        f"🛒 WooCommerce (con SKU):          {total_wc}",
        "",
        f"✅ Sincronizados en las 3 plataformas: {len(sincronizados)}",
        f"⚠️  MeLi sin match en SIIGO:  {len(meli_sin_siigo)}",
        f"⚠️  MeLi sin match en WooCommerce: {len(meli_sin_wc)}",
    ]

    if meli_sin_siigo:
        lineas += ["", "🔴 SKUs de MeLi NO encontrados en SIIGO (requieren creación):"]
        for sku, titulo in sorted(meli_sin_siigo.items())[:20]:
            lineas.append(f"   • {sku} — {titulo[:50]}")
        if len(meli_sin_siigo) > 20:
            lineas.append(f"   ... y {len(meli_sin_siigo) - 20} más")

    if meli_sin_wc:
        lineas += ["", "🟡 SKUs de MeLi NO encontrados en WooCommerce (requieren asignación):"]
        for sku, titulo in sorted(meli_sin_wc.items())[:15]:
            lineas.append(f"   • {sku} — {titulo[:50]}")
        if len(meli_sin_wc) > 15:
            lineas.append(f"   ... y {len(meli_sin_wc) - 15} más")

    lineas += [
        "",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "Revisar y corregir manualmente en SIIGO / WooCommerce.",
    ]

    reporte = "\n".join(lineas)
    print(reporte)

    # Notificar WhatsApp si hay novedades
    if notificar_wa and (meli_sin_siigo or meli_sin_wc):
        msg = (
            f"🔔 *Alerta Sincronización SKUs — McKenna Group*\n\n"
            f"📦 MeLi activos con SKU: {total_meli}\n"
            f"✅ Sincronizados (MeLi+SIIGO+WC): {len(sincronizados)}\n"
            f"🔴 Sin match en SIIGO: *{len(meli_sin_siigo)}* productos\n"
            f"🟡 Sin match en WooCommerce: *{len(meli_sin_wc)}* productos\n\n"
            f"Se requiere revisión manual. Ejecuta la opción 13 del menú para ver el detalle completo."
        )
        _enviar_whatsapp(msg)
        print("📱 Alerta enviada al grupo Inventario.")

    return reporte
