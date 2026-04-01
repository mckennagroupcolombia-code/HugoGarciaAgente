import os
import requests
from woocommerce import API


# --- Funciones de Interacción con WooCommerce ---

def get_wc_client():
    """
    Retorna un cliente autenticado de la API REST de WooCommerce (wc/v3).
    Lee las credenciales desde las variables de entorno WC_URL, WC_KEY y WC_SECRET.
    """
    url = os.getenv("WC_URL")
    key = os.getenv("WC_KEY")
    secret = os.getenv("WC_SECRET")

    if not all([url, key, secret]):
        print("⚠️ [WOOCOMMERCE] Faltan variables de entorno: WC_URL, WC_KEY o WC_SECRET.")
        return None

    return API(
        url=url,
        consumer_key=key,
        consumer_secret=secret,
        version="wc/v3",
        timeout=15
    )


def obtener_stock_woocommerce(sku: str):
    """
    Consulta el stock actual de un producto en WooCommerce por su SKU.
    Retorna el número entero de unidades disponibles, o 0 si no lo encuentra.
    """
    print(f"📡 [WOOCOMMERCE] Consultando stock para SKU: {sku}")
    wcapi = get_wc_client()
    if not wcapi:
        return 0

    try:
        res = wcapi.get("products", params={"sku": sku, "per_page": 1})
        if res.status_code == 200:
            productos = res.json()
            if productos:
                stock = productos[0].get("stock_quantity")
                return int(stock) if stock is not None else 0
            print(f"⚠️ [WOOCOMMERCE] SKU '{sku}' no encontrado.")
            return 0
        print(f"⚠️ [WOOCOMMERCE] Error consultando stock (SKU: {sku}): {res.status_code} - {res.text}")
        return 0
    except requests.RequestException as e:
        print(f"⚠️ Error de red consultando stock en WooCommerce: {e}")
        return 0
    except Exception as e:
        print(f"❌ Error inesperado consultando stock en WooCommerce: {e}")
        return 0


def actualizar_stock_woocommerce(sku: str, nuevo_stock: int):
    """
    Busca un producto por SKU en WooCommerce y actualiza su stock_quantity.
    Retorna mensaje de éxito o error con emoji.
    """
    print(f"📡 [WOOCOMMERCE] Actualizando stock de SKU '{sku}' a {nuevo_stock} unidades...")
    wcapi = get_wc_client()
    if not wcapi:
        return "❌ Error: No se pudo conectar con WooCommerce. Verifica WC_URL, WC_KEY y WC_SECRET."

    try:
        # 1. Buscar el producto por SKU para obtener su ID
        res_buscar = wcapi.get("products", params={"sku": sku, "per_page": 1})
        if res_buscar.status_code != 200 or not res_buscar.json():
            return f"❌ Error: No se encontró ningún producto con SKU '{sku}' en WooCommerce."

        producto_id = res_buscar.json()[0].get("id")

        # 2. Actualizar el stock
        res_update = wcapi.put(f"products/{producto_id}", data={
            "stock_quantity": int(nuevo_stock),
            "manage_stock": True
        })

        if res_update.status_code in [200, 201]:
            nombre = res_update.json().get("name", sku)
            return f"✅ Stock actualizado: '{nombre}' (SKU: {sku}) → {nuevo_stock} unidades."
        return f"❌ Error actualizando stock en WooCommerce: {res_update.status_code} - {res_update.text}"

    except requests.RequestException as e:
        return f"⚠️ Error de red actualizando stock en WooCommerce: {e}"
    except Exception as e:
        return f"❌ Error inesperado actualizando stock en WooCommerce: {e}"


def obtener_todos_los_productos_woocommerce():
    """
    Obtiene la lista completa de productos publicados en WooCommerce con su SKU,
    nombre y stock actual. Maneja paginación si hay más de 100 productos.
    """
    print("📡 [WOOCOMMERCE] Obteniendo catálogo completo de productos...")
    wcapi = get_wc_client()
    if not wcapi:
        return []

    todos_los_productos = []
    page = 1

    while True:
        try:
            res = wcapi.get("products", params={
                "status": "publish",
                "per_page": 100,
                "page": page,
                "fields": "id,name,sku,stock_quantity"
            })

            if res.status_code == 200:
                pagina = res.json()
                if not pagina:
                    break

                for p in pagina:
                    todos_los_productos.append({
                        "id": p.get("id"),
                        "nombre": p.get("name", ""),
                        "sku": p.get("sku", ""),
                        "stock": p.get("stock_quantity") or 0
                    })

                # Si la página devuelve menos de 100 items, es la última
                if len(pagina) < 100:
                    break
                page += 1
            else:
                print(f"⚠️ [WOOCOMMERCE] Error obteniendo productos (página {page}): {res.status_code}")
                break

        except requests.RequestException as e:
            print(f"⚠️ Error de red obteniendo productos de WooCommerce: {e}")
            break
        except Exception as e:
            print(f"❌ Error inesperado obteniendo productos de WooCommerce: {e}")
            break

    print(f"✅ [WOOCOMMERCE] {len(todos_los_productos)} productos obtenidos.")
    return todos_los_productos


def sincronizar_catalogo_woocommerce(productos: list):
    """
    Actualiza masivamente el stock de una lista de productos en WooCommerce.
    productos: lista de dicts con claves 'sku' y 'stock'.
    Retorna un resumen con cuántos se actualizaron correctamente y cuántos fallaron.
    """
    print(f"📡 [WOOCOMMERCE] Iniciando sincronización masiva de {len(productos)} productos...")
    wcapi = get_wc_client()
    if not wcapi:
        return "❌ Error: No se pudo conectar con WooCommerce. Verifica WC_URL, WC_KEY y WC_SECRET."

    exitosos = 0
    fallidos = 0
    errores = []

    for item in productos:
        sku = item.get("sku", "").strip()
        nuevo_stock = item.get("stock")

        if not sku or nuevo_stock is None:
            fallidos += 1
            errores.append(f"Item inválido (sin SKU o sin stock): {item}")
            continue

        try:
            res_buscar = wcapi.get("products", params={"sku": sku, "per_page": 1})
            if res_buscar.status_code != 200 or not res_buscar.json():
                fallidos += 1
                errores.append(f"SKU '{sku}' no encontrado en WooCommerce.")
                continue

            producto_id = res_buscar.json()[0].get("id")
            res_update = wcapi.put(f"products/{producto_id}", data={
                "stock_quantity": int(nuevo_stock),
                "manage_stock": True
            })

            if res_update.status_code in [200, 201]:
                exitosos += 1
            else:
                fallidos += 1
                errores.append(f"SKU '{sku}': {res_update.status_code} - {res_update.text[:80]}")

        except requests.RequestException as e:
            fallidos += 1
            errores.append(f"SKU '{sku}': Error de red - {e}")
        except Exception as e:
            fallidos += 1
            errores.append(f"SKU '{sku}': Error inesperado - {e}")

    resumen = (
        f"✅ Sincronización WooCommerce completada.\n"
        f"- Actualizados: {exitosos}\n"
        f"- Fallidos: {fallidos}"
    )
    if errores:
        detalle = "\n".join(f"  • {e}" for e in errores[:10])
        resumen += f"\n⚠️ Detalle de errores:\n{detalle}"
        if len(errores) > 10:
            resumen += f"\n  ... y {len(errores) - 10} más."

    print(resumen)
    return resumen


def crear_webhook_woocommerce(evento: str, url_destino: str = ""):
    """
    Registra un webhook en WooCommerce para notificar al agente cuando ocurra un evento.
    evento: nombre del evento WooCommerce, ej: 'order.created', 'order.updated'.
    url_destino: URL del endpoint del agente (por defecto apunta al puerto 8081).
    """
    print(f"📡 [WOOCOMMERCE] Registrando webhook para evento '{evento}'...")
    wcapi = get_wc_client()
    if not wcapi:
        return "❌ Error: No se pudo conectar con WooCommerce. Verifica WC_URL, WC_KEY y WC_SECRET."

    if not url_destino:
        agente_url = os.getenv("WC_WEBHOOK_URL", "http://localhost:8081")
        url_destino = f"{agente_url.rstrip('/')}/woocommerce/webhook"

    payload = {
        "name": f"Agente McKenna — {evento}",
        "status": "active",
        "topic": evento,
        "delivery_url": url_destino
    }

    try:
        res = wcapi.post("webhooks", data=payload)

        if res.status_code in [200, 201]:
            webhook_id = res.json().get("id")
            return (
                f"✅ Webhook registrado exitosamente.\n"
                f"- Evento: {evento}\n"
                f"- URL destino: {url_destino}\n"
                f"- ID webhook: {webhook_id}"
            )
        return f"❌ Error registrando webhook en WooCommerce: {res.status_code} - {res.text}"

    except requests.RequestException as e:
        return f"⚠️ Error de red registrando webhook en WooCommerce: {e}"
    except Exception as e:
        return f"❌ Error inesperado registrando webhook en WooCommerce: {e}"
