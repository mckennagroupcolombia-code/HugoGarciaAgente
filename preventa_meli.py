import json
import requests

# Ruta de sus credenciales
RUTA_CREDENCIALES = "/home/mckg/mi-agente/credenciales_meli.json"

def obtener_token_meli():
    # Aquí lee su credenciales_meli.json y saca el access_token vigente
    with open(RUTA_CREDENCIALES, 'r') as f:
        datos = json.load(f)
        return datos.get("access_token")

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

def analizar_y_crear_respuesta(texto_pregunta, item_id):
    """
    Aquí es donde ocurre la magia. 
    Más adelante podemos conectar esto con Google Sheets para buscar el item_id (MCO)
    en la Columna A de la 'Hoja 1' y ver el Stock en la Columna F, o conectar un agente de IA.
    """
    texto_lower = texto_pregunta.lower()
    
    # Lógica súper básica de ejemplo
    if "invima" in texto_lower:
        return "¡Hola! Sí, todos nuestros productos cuentan con su respectivo registro sanitario Invima. ¡Anímate a comprar!"
    elif "disponible" in texto_lower or "stock" in texto_lower:
        return "¡Hola! Sí tenemos disponibilidad inmediata de este producto. ¡Esperamos tu compra!"
    else:
        return "¡Hola! Gracias por comunicarte con McKenna Group. ¿En qué más te podemos ayudar?"

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
    
    respuesta_generada = analizar_y_crear_respuesta(texto_pregunta, item_id)
    
    enviar_respuesta_meli(question_id, respuesta_generada, token)

# --- Para probar el script manualmente ---
if __name__ == "__main__":
    # Puede poner un ID de pregunta real aquí para hacer pruebas
    # procesar_nueva_pregunta("1234567890")
    pass
