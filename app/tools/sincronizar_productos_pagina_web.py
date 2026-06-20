import os
import sys
from pathlib import Path


def sincronizar_productos_pagina_web(productos_meli: list) -> str:
    """
    Sincroniza precios hacia la tienda web McKenna.

    Si WEB_API_URL está configurada, hace PUT por SKU.
    Si no, regenera `PAGINA_WEB/site/data/cache.json` desde Siigo (fuente real del catálogo).
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

    for producto in productos_meli:
        sku = producto.get("sku")
        if not sku:
            resultados.append("⚠️ [WEB SYNC] Producto sin SKU ignorado.")
            errores += 1
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

    resultados.append(f"Éxitos: {exitos}, Errores: {errores}")
    return "\n".join(resultados)


def _rebuild_catalogo_web_cache() -> str:
    """Regenera cache.json del sitio desde combos Siigo (precio web = lista × 0.835)."""
    root = Path(__file__).resolve().parents[2]
    site_dir = root / "PAGINA_WEB" / "site"
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))

    try:
        os.chdir(site_dir)
        from website import get_catalog  # noqa: WPS433 — módulo Flask del sitio

        get_catalog(force=True)
        cache = site_dir / "data" / "cache.json"
        return f"✅ Catálogo web regenerado desde Siigo ({cache})"
    except Exception as e:
        return f"❌ Error regenerando catálogo web: {e}"
