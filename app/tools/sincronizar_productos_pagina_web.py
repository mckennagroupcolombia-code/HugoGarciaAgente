import requests
import os


def sincronizar_productos_pagina_web(productos_meli: list):
    """
    Sincroniza los productos de MercadoLibre con la página web de McKenna.
    Esta función utiliza una API REST para actualizar el stock y precios.

    Args:
        productos_meli (list): Una lista de diccionarios, cada uno representando un producto
                               obtenido de MercadoLibre (ej. [{"sku": "AS-123", "stock": 50, "precio": 15000}]).
    """
    # ========================================================
    # CONFIGURACIÓN DE LA API DE LA PÁGINA WEB
    # TODO: Configurar estas variables en el archivo .env
    # ========================================================
    API_URL_BASE = os.getenv("WEB_API_URL", "https://api.tupaginaweb.com/v1")
    API_KEY = os.getenv("WEB_API_KEY", "tu_api_key_aqui")

    headers = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}

    print(
        f"\n🌐 [WEB SYNC] Iniciando sincronización de {len(productos_meli)} productos hacia la página web..."
    )

    resultados = []
    exitos = 0
    errores = 0

    for producto in productos_meli:
        sku = producto.get("sku")

        if not sku:
            msg = "⚠️ [WEB SYNC] Producto sin SKU ignorado."
            print(msg)
            resultados.append(msg)
            errores += 1
            continue

        # Aquí construimos el payload según lo que requiera la API de la web.
        # Esto es solo un ejemplo.
        payload = {
            "sku": sku,
            "stock": producto.get("stock", 0),
            "price": producto.get("precio", 0),
        }

        try:
            # Ejemplo de endpoint PUT para actualizar producto por SKU
            endpoint = f"{API_URL_BASE}/products/{sku}"
            response = requests.put(endpoint, json=payload, headers=headers, timeout=10)

            if response.status_code in (200, 201):
                msg = f"✅ [WEB SYNC] SKU {sku} actualizado correctamente."
                print(msg)
                resultados.append(msg)
                exitos += 1
            else:
                msg = f"❌ [WEB SYNC] Error al actualizar SKU {sku}: HTTP {response.status_code} - {response.text}"
                print(msg)
                resultados.append(msg)
                errores += 1

        except requests.exceptions.RequestException as e:
            msg = f"❌ [WEB SYNC] Error de conexión al actualizar SKU {sku}: {e}"
            print(msg)
            resultados.append(msg)
            errores += 1

    resumen = f"\n✅ Sincronización completada. Éxitos: {exitos}, Errores: {errores}"
    print(resumen)
    resultados.append(resumen)

    return "\n".join(resultados)
