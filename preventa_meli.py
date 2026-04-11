import json
import requests
from app.services.meli_preventa import manejar_pregunta_preventa
from app.utils import refrescar_token_meli, jid_grupo_preventa_wa

# Ruta de sus credenciales
RUTA_CREDENCIALES = "/home/mckg/mi-agente/credenciales_meli.json"

def obtener_token_meli():
    # Usamos la función oficial que refresca el token automáticamente
    return refrescar_token_meli()

def obtener_detalle_pregunta(question_id, token):
    """Consulta a MeLi qué fue exactamente lo que preguntó el cliente."""
    url = f"https://api.mercadolibre.com/questions/{question_id}?api_version=4"
    headers = {"Authorization": f"Bearer {token}"}
    
    respuesta = requests.get(url, headers=headers)
    if respuesta.status_code == 200:
        return respuesta.json()
    else:
        print(f"Paila, error al obtener pregunta: {respuesta.text}")
        return None

def obtener_nombre_producto_meli(item_id, token):
    url = f"https://api.mercadolibre.com/items/{item_id}"
    headers = {"Authorization": f"Bearer {token}"}
    try:
        res = requests.get(url, headers=headers)
        if res.status_code == 200:
            return res.json().get('title', 'Producto desconocido')
    except Exception as e:
        print(f"Error obteniendo nombre del producto: {e}")
    return "Producto desconocido"

def analizar_y_crear_respuesta(texto_pregunta, item_id, token, question_id=None):
    """
    Gestiona la pregunta de preventa: responde o delega al grupo.
    Retorna (respuesta_texto, fue_respondida).
    """
    nombre_producto = obtener_nombre_producto_meli(item_id, token)
    return manejar_pregunta_preventa(question_id, nombre_producto, texto_pregunta)

def enviar_respuesta_meli(question_id, texto_respuesta, token):
    """Dispara la respuesta oficial a la publicación de Mercado Libre."""
    url = "https://api.mercadolibre.com/answers"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    payload = {
        "question_id": question_id,
        "text": texto_respuesta
    }
    
    respuesta = requests.post(url, headers=headers, json=payload)
    if respuesta.status_code == 200:
        print(f"¡Coronamos! Respuesta enviada a la pregunta {question_id}")
        return True
    else:
        print(f"Error enviando respuesta: {respuesta.text}")
        return False

def procesar_nueva_pregunta(question_id):
    """Función principal que orquesta todo el camello."""
    try:
        from app.observability import log_json

        log_json("preventa_procesar_pregunta_start", question_id=str(question_id))
    except Exception:
        pass

    token = obtener_token_meli()
    if not token:
        print("No hay token, revise las credenciales.")
        return
        
    print(f"Procesando la pregunta ID: {question_id}...")
    
    datos_pregunta = obtener_detalle_pregunta(question_id, token)
    if not datos_pregunta:
        return
        
    texto_pregunta = datos_pregunta.get("text", "")
    item_id = datos_pregunta.get("item_id", "") # Este es el famoso MCO
    
    print(f"El cliente preguntó: '{texto_pregunta}' en el producto {item_id}")
    
    nombre_producto = obtener_nombre_producto_meli(item_id, token)
    respuesta_generada, fue_respondida = analizar_y_crear_respuesta(
        texto_pregunta, item_id, token, question_id=question_id
    )

    if not fue_respondida:
        # Sin ficha → delegado al grupo, ya se envió la alerta
        print(f"⏳ Preventa: pregunta {question_id} delegada al grupo humano")
        return

    # Con ficha → responder al cliente en MeLi
    status = enviar_respuesta_meli(question_id, respuesta_generada, token)

    from app.utils import enviar_whatsapp_reporte

    emoji_status = "✅" if status else "❌"
    mensaje_ws = (
        f"🔔 *REPORTE PREVENTA MELI*\n\n"
        f"📦 *Producto:* {nombre_producto}\n"
        f"🗣 *Cliente Preguntó:* {texto_pregunta}\n"
        f"🤖 *IA Respondió:* {respuesta_generada}\n\n"
        f"Status Respuesta: {emoji_status}"
    )
    ok_wa = enviar_whatsapp_reporte(
        mensaje_ws, numero_destino=jid_grupo_preventa_wa()
    )
    if not ok_wa:
        print(
            f"❌ Preventa: el reporte a WhatsApp NO se envió (revisar bridge :3000 / "
            f"logs). Pregunta MeLi {question_id} respondida={'sí' if status else 'no'}. "
            f"Grupo configurado: {jid_grupo_preventa_wa()}"
        )

# --- Para probar el script manualmente ---
if __name__ == "__main__":
    # Puede poner un ID de pregunta real aquí para hacer pruebas
    # procesar_nueva_pregunta("1234567890")
    pass
