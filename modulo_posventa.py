import datetime
import requests
import json
from app.utils import refrescar_token_meli

def responder_mensaje_posventa(order_id, texto):
    """
    Versión Blindada: Limpia IDs con decimales y usa el flujo unificado de MeLi.
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
        
        # 1. Obtener datos de la orden (Usando el ID limpio)
        url_orden = f"https://api.mercadolibre.com/orders/{clean_id}"
        res_orden = requests.get(url_orden, headers=headers)
        
        if res_orden.status_code != 200:
            print(f"❌ Orden {clean_id} no accesible. Status: {res_orden.status_code}")
            return False
            
        data = res_orden.json()
        vendedor_id = data['seller']['id']
        comprador_id = data['buyer']['id']
        pack_id = data.get('pack_id') or clean_id

        # 2. PAYLOAD UNIFICADO
        payload = {
            "from": { "user_id": int(vendedor_id) },
            "to": { "user_id": int(comprador_id) },
            "text": str(texto),
            "message_resources": [
                {
                    "id": str(clean_id),
                    "name": "orders"
                }
            ]
        }

        # 3. ENDPOINT DE MENSAJERÍA
        url_msg = f"https://api.mercadolibre.com/messages/packs/{pack_id}/sellers/{vendedor_id}?tag=post_sale"
        
        print(f"📡 Enviando a MeLi (ID Limpio: {clean_id} | Pack: {pack_id})...")
        
        response = requests.post(url_msg, json=payload, headers=headers)
        
        if response.status_code in [200, 201]:
            print(f"🚀 ¡MENSAJE ENVIADO EXITOSAMENTE!")
            return True
        else:
            # Reintento con formato clásico si el unificado falla
            print(f"⚠️ Fallo Unificado ({response.status_code}), intentando formato clásico...")
            payload_clasico = {
                "from": { "user_id": int(vendedor_id) },
                "to": [{ "user_id": int(comprador_id) }],
                "text": str(texto)
            }
            response = requests.post(url_msg, json=payload_clasico, headers=headers)
            
            if response.status_code in [200, 201]:
                print("🚀 ¡Enviado con formato clásico!")
                return True
            else:
                print(f"❌ Error final de MeLi: {response.text}")
                return False
            
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
