import os
import requests
import threading
import time
from flask import Flask, request, jsonify
from app.core import obtener_respuesta_ia
from app.utils import enviar_whatsapp_reporte, refrescar_token_meli

app = Flask(__name__)

def obtener_nombre_producto(item_id):
    """Obtiene el título de la publicación de Mercado Libre."""
    token_actual = refrescar_token_meli() or os.environ.get("MELI_ACCESS_TOKEN")
    url = f"https://api.mercadolibre.com/items/{item_id}"
    headers = {"Authorization": f"Bearer {token_actual}"}
    try:
        res = requests.get(url, headers=headers)
        if res.status_code == 200:
            return res.json().get('title', 'Producto desconocido')
    except Exception as e:
        print(f"Error obteniendo nombre del producto: {e}")
    return "Producto desconocido"

def responder_en_mercado_libre(question_id, texto):
    """Envía la respuesta final a la API de Mercado Libre."""
    token_actual = refrescar_token_meli() or os.environ.get("MELI_ACCESS_TOKEN")
    url = "https://api.mercadolibre.com/answers"
    headers = {
        "Authorization": f"Bearer {token_actual}",
        "Content-Type": "application/json"
    }
    data = {"question_id": question_id, "text": texto}
    try:
        response = requests.post(url, json=data, headers=headers)
        return response.status_code
    except Exception as e:
        print(f"Error al responder en MeLi: {e}")
        return 500

def tarea_procesar_pregunta(data):
    """Hilo secundario para procesar la IA sin bloquear el webhook."""
    try:
        resource = data.get('resource') 
        question_id = resource.split('/')[-1]
        
        # 1. Obtener detalles de la pregunta
        token_actual = refrescar_token_meli() or os.environ.get("MELI_ACCESS_TOKEN")
        url_q = f"https://api.mercadolibre.com/questions/{question_id}"
        headers = {"Authorization": f"Bearer {token_actual}"}
        
        q_res = requests.get(url_q, headers=headers).json()
        pregunta_cliente = q_res.get('text', '')
        item_id = q_res.get('item_id', '')
        user_id = q_res.get('from', {}).get('id', 'desconocido')
        
        if not pregunta_cliente:
            return

        # 2. Obtener contexto y nombre del producto
        nombre_producto = obtener_nombre_producto(item_id)
        print(f"📩 Procesando pregunta de '{nombre_producto}': {pregunta_cliente}")

        # 3. EFECTO HUMANO: Esperar antes de responder (opcional aquí o en agente_pro)
        # Como agente_pro ya tiene un sleep(10), aquí se sumaría. 
        # Si prefieres que sea rápido en MeLi, puedes dejarlo así.
        
        # 4. INYECTAR CONTEXTO A LA IA
        pregunta_con_contexto = f"El cliente pregunta sobre el producto '{nombre_producto}': {pregunta_cliente}"
        respuesta_ia = obtener_respuesta_ia(pregunta_con_contexto, user_id)
        
        # 5. Responder en MeLi
        status = responder_en_mercado_libre(question_id, respuesta_ia)
        print(f"✅ Status MeLi para ID {question_id}: {status}")

        # 6. REPORTE POR WHATSAPP
        emoji_status = "✅" if status == 200 or status == 201 else "❌"
        mensaje_ws = (f"🔔 *REPORTE BOT MCKENNA*\n\n"
                     f"📦 *Producto:* {nombre_producto}\n"
                     f"🗣 *Cliente:* {pregunta_cliente}\n"
                     f"🤖 *IA:* {respuesta_ia}\n\n"
                     f"Status MeLi: {emoji_status}")
        
        enviar_whatsapp_reporte(mensaje_ws)
        
    except Exception as e:
        print(f"Error en la tarea de segundo plano: {e}")

@app.route('/notifications', methods=['POST'])
def notifications():
    """Recibe la notificación y responde 'OK' de inmediato a MeLi."""
    data = request.get_json()
    
    if data and data.get('topic') == 'questions':
        # Lanzamos el proceso en un hilo para no hacer esperar a MeLi
        hilo = threading.Thread(target=tarea_procesar_pregunta, args=(data,))
        hilo.start()
        
    # Respondemos 200 OK inmediatamente
    return jsonify({"status": "ok"}), 200

if __name__ == '__main__':
    # Este corre en el 8080. El agente_pro corre en el 8081.
    print("🚀 Webhook MeLi escuchando en puerto 8080...")
    app.run(host='0.0.0.0', port=8080)
