import datetime
import requests
import json
from app.utils import refrescar_token_meli, obtener_seller_id_meli


def _post_mensaje_pack(pack_id, vendedor_id, comprador_id, texto, headers, order_resource_id=None):
    url_msg = (
        f"https://api.mercadolibre.com/messages/packs/{pack_id}/"
        f"sellers/{vendedor_id}?tag=post_sale"
    )

    payloads = []
    if order_resource_id:
        payloads.append(
            {
                "from": {"user_id": int(vendedor_id)},
                "to": {"user_id": int(comprador_id)},
                "text": str(texto),
                "message_resources": [{"id": str(order_resource_id), "name": "orders"}],
            }
        )

    payloads.append(
        {
            "from": {"user_id": int(vendedor_id)},
            "to": {"user_id": int(comprador_id)},
            "text": str(texto),
        }
    )

    for idx, payload in enumerate(payloads, start=1):
        response = requests.post(url_msg, json=payload, headers=headers, timeout=20)
        if response.status_code in [200, 201]:
            print(f"🚀 ¡MENSAJE ENVIADO EXITOSAMENTE! intento={idx}")
            return True
        print(
            f"⚠️ Fallo enviando a MeLi intento={idx} status={response.status_code}: "
            f"{response.text[:500]}"
        )

    return False


def _inferir_comprador_desde_mensajes(pack_id, vendedor_id, headers):
    url_msg = (
        f"https://api.mercadolibre.com/messages/packs/{pack_id}/"
        f"sellers/{vendedor_id}?tag=post_sale"
    )
    res = requests.get(url_msg, headers=headers, timeout=10)
    if res.status_code != 200:
        print(f"⚠️ No pude leer mensajes del pack {pack_id}. Status: {res.status_code}")
        return None

    for msg in res.json().get("messages", []):
        remitente = msg.get("from")
        if isinstance(remitente, dict):
            uid = remitente.get("user_id")
        else:
            uid = remitente
        if uid and str(uid) != str(vendedor_id):
            return str(uid)
    return None


def responder_mensaje_posventa(order_id, texto, comprador_id=None):
    """
    Envía respuesta postventa por MeLi.
    Acepta order_id o pack_id. Si recibe pack_id, usa comprador_id de la cola.
    """
    try:
        # 0. LIMPIEZA CRÍTICA: Convertimos "2000015703413240.0" -> 2000015703413240 -> "2000015703413240"
        # Esto elimina el error 404 causado por el .0 que Hugo a veces arrastra.
        clean_id = str(int(float(str(order_id).replace("Venta #", "").strip())))
        
        token = refrescar_token_meli()
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "x-version": "2" 
        }
        
        # 1. Primero probar como order_id. En postventa la cola suele guardar pack_id.
        url_orden = f"https://api.mercadolibre.com/orders/{clean_id}"
        res_orden = requests.get(url_orden, headers=headers, timeout=10)
        
        if res_orden.status_code == 200:
            data = res_orden.json()
            vendedor_id = data["seller"]["id"]
            comprador_id_final = data["buyer"]["id"]
            pack_id = data.get("pack_id") or clean_id

            print(f"📡 Enviando a MeLi (Order: {clean_id} | Pack: {pack_id})...")
            return _post_mensaje_pack(
                pack_id,
                vendedor_id,
                comprador_id_final,
                texto,
                headers,
                order_resource_id=clean_id,
            )

        print(
            f"⚠️ {clean_id} no abrió como orden (status {res_orden.status_code}); "
            "tratando como pack_id."
        )
        vendedor_id = obtener_seller_id_meli()
        comprador_id_final = comprador_id or _inferir_comprador_desde_mensajes(
            clean_id, vendedor_id, headers
        )
        if not comprador_id_final:
            print(f"❌ No pude inferir comprador para pack {clean_id}.")
            return False

        print(f"📡 Enviando a MeLi (Pack: {clean_id} | Comprador: {comprador_id_final})...")
        return _post_mensaje_pack(
            clean_id,
            vendedor_id,
            comprador_id_final,
            texto,
            headers,
        )
            
    except Exception as e:
        print(f"❌ Error crítico en responder_mensaje_posventa: {e}")
        return False

def responder_solicitud_rut(order_id):
    """Herramienta principal que llama Hugo"""
    mensaje = (
        "Cordial saludo, somos McKenna Group. Para procesar su envio, "
        "agradecemos nos comparta por este medio una foto o PDF de su RUT o en su defecto el numero de telefono. "
        "Esto es necesario para generar la guia de transporte y enviar su envio cuanto antes. Gracias!"
    )
    # Ejecutamos y devolvemos texto descriptivo para que la IA no se confunda
    exito = responder_mensaje_posventa(order_id, mensaje)
    return "✅ Éxito: Mensaje de RUT enviado." if exito else "❌ Falló: No se pudo enviar el mensaje."
