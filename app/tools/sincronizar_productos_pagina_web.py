import os
import sys
from pathlib import Path


def sincronizar_productos_pagina_web(productos_meli: list) -> str:
    """
    Sincroniza stock/precios hacia la tienda web McKenna.

    Si WEB_API_URL está configurada:
      - con `stock` en el payload → PUT /products/<sku> (actualiza stock_web)
      - solo `precio` (sin stock) → regenera cache.json desde Alegra; NO toca stock
        (evitar stock=0 accidental al cambiar precios desde Ganancia)
    Si no hay API: regenera `PAGINA_WEB/site/data/cache.json` desde Alegra.
    """
    api_url = (os.getenv("WEB_API_URL") or "").strip().rstrip("/")
    api_key = (os.getenv("WEB_API_KEY") or "").strip()

    if api_url and api_key and "tupaginaweb.com" not in api_url:
        return _sync_via_api_rest(productos_meli, api_url, api_key)
    return _rebuild_catalogo_web_cache()


def _sync_via_api_rest(productos_meli: list, api_url: str, api_key: str) -> str:
    import requests

    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    resultados = []
    exitos = errores = 0
    solo_precio = []

    for producto in productos_meli:
        sku = producto.get("sku")
        if not sku:
            resultados.append("⚠️ [WEB SYNC] Producto sin SKU ignorado.")
            errores += 1
            continue

        # Sin stock explícito: no llamar al PUT (que exige stock y antes defaultaba a 0,
        # ocultando el producto del catálogo web). Solo regenerar precios desde Siigo.
        if "stock" not in producto:
            solo_precio.append(sku)
            continue

        payload = {
            "sku": sku,
            "stock": producto.get("stock", 0),
            "price": producto.get("precio", 0),
        }
        try:
            response = requests.put(
                f"{api_url}/products/{sku}",
                json=payload,
                headers=headers,
                timeout=10,
            )
            if response.status_code in (200, 201):
                resultados.append(f"✅ [WEB SYNC] SKU {sku} actualizado.")
                exitos += 1
            else:
                resultados.append(
                    f"❌ [WEB SYNC] SKU {sku}: HTTP {response.status_code} — {response.text[:120]}"
                )
                errores += 1
        except requests.exceptions.RequestException as e:
            resultados.append(f"❌ [WEB SYNC] SKU {sku}: {e}")
            errores += 1

    if solo_precio:
        rebuild_msg = _rebuild_catalogo_web_cache()
        resultados.append(
            f"ℹ️ [WEB SYNC] Solo precio ({len(solo_precio)} SKU): {rebuild_msg}"
        )
        if rebuild_msg.startswith("✅"):
            exitos += len(solo_precio)
        else:
            errores += len(solo_precio)

    # "Errores: 0" no es un fallo — no usar substring "Error"
    ok_global = errores == 0
    resultados.append(f"Éxitos: {exitos}, Fallos: {errores}")
    summary = "\n".join(resultados)
    if not ok_global:
        return summary
    return summary


def _rebuild_catalogo_web_cache() -> str:
    """Regenera cache.json del sitio desde combos Alegra (precio web = lista − 10%)."""
    root = Path(__file__).resolve().parents[2]
    site_dir = root / "PAGINA_WEB" / "site"
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    if str(site_dir) not in sys.path:
        sys.path.insert(0, str(site_dir))

    try:
        from PAGINA_WEB.site import website

        website.get_catalog(force=True)
        cache = site_dir / "data" / "cache.json"
        return f"✅ Catálogo web regenerado desde Alegra ({cache})"
    except Exception as e:
        return f"❌ Error regenerando catálogo web: {e}"
