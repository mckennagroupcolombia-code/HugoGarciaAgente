import os
import requests
import threading
import time
from flask import Flask, request, jsonify, render_template
from dotenv import load_dotenv
from app.core import obtener_respuesta_ia, configurar_ia
from app.utils import enviar_whatsapp_reporte, refrescar_token_meli

load_dotenv()
app = Flask(__name__, template_folder='app/templates')
configurar_ia(app)

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

@app.route('/status', methods=['GET'])
def status():
    import os
    from datetime import datetime
    return jsonify({
        "estado": "activo",
        "timestamp": datetime.now().isoformat(),
        "servicios": {
            "mercadolibre": os.path.exists("credenciales_meli.json"),
            "google": os.path.exists("credenciales_google.json"),
            "siigo": os.path.exists("credenciales_SIIGO.json")
        },
        "version": "1.0.0"
    })

@app.route('/chat', methods=['POST'])
def chat():
    import os
    from datetime import datetime
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if token != os.getenv('CHAT_API_TOKEN', ''):
        return jsonify({"error": "No autorizado"}), 401
    data = request.get_json()
    if not data or 'mensaje' not in data:
        return jsonify({"error": "Campo 'mensaje' requerido"}), 400
    try:
        respuesta, _ = obtener_respuesta_ia(data['mensaje'], 'usuario_api')
        return jsonify({
            "respuesta": respuesta,
            "timestamp": datetime.now().isoformat(),
            "status": "ok"
        })
    except Exception as e:
        return jsonify({"error": str(e), "status": "error"}), 500

@app.route('/panel')
def panel():
    return render_template('chat.html')

# ── HELPER: verificación de token ────────────────────────────────────────────
def _token_valido():
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    return token == os.getenv('CHAT_API_TOKEN', '')

def _lanzar_en_hilo(fn, *args):
    """Ejecuta fn(*args) en segundo plano y devuelve respuesta inmediata."""
    threading.Thread(target=fn, args=args, daemon=True).start()

# ── ENDPOINTS DE SINCRONIZACIÓN ───────────────────────────────────────────────
from datetime import datetime as _dt
from app.sync import (
    sincronizar_inteligente,
    sincronizar_facturas_recientes,
    ejecutar_sincronizacion_y_reporte_stock,
    sincronizar_manual_por_id,
    sincronizar_por_dia_especifico,
)
from app.services.google_services import leer_datos_hoja
from app.services.meli import aprender_de_interacciones_meli
from app.tools.sincronizar_facturas_de_compra_siigo import sincronizar_facturas_de_compra_siigo

@app.route('/sync/hoy', methods=['POST'])
def sync_hoy():
    if not _token_valido():
        return jsonify({"status": "error", "resultado": "No autorizado"}), 401
    _lanzar_en_hilo(sincronizar_facturas_recientes, 1)
    return jsonify({"status": "iniciado", "mensaje": "🔄 Sync último día iniciado en segundo plano.", "timestamp": _dt.now().isoformat()})

@app.route('/sync/10dias', methods=['POST'])
def sync_10dias():
    if not _token_valido():
        return jsonify({"status": "error", "resultado": "No autorizado"}), 401
    _lanzar_en_hilo(sincronizar_facturas_recientes, 10)
    return jsonify({"status": "iniciado", "mensaje": "🔄 Sync últimos 10 días iniciado en segundo plano.", "timestamp": _dt.now().isoformat()})

@app.route('/sync/completo', methods=['POST'])
def sync_completo():
    if not _token_valido():
        return jsonify({"status": "error", "resultado": "No autorizado"}), 401
    _lanzar_en_hilo(ejecutar_sincronizacion_y_reporte_stock)
    return jsonify({"status": "iniciado", "mensaje": "📊 Sync completo + reporte de stock iniciado.", "timestamp": _dt.now().isoformat()})

@app.route('/sync/inteligente', methods=['POST'])
def sync_inteligente():
    if not _token_valido():
        return jsonify({"status": "error", "resultado": "No autorizado"}), 401
    _lanzar_en_hilo(sincronizar_inteligente)
    return jsonify({"status": "iniciado", "mensaje": "🧠 Sync inteligente (MeLi vs Siigo) iniciado.", "timestamp": _dt.now().isoformat()})

@app.route('/consultar/producto', methods=['GET'])
def consultar_producto():
    if not _token_valido():
        return jsonify({"status": "error", "resultado": "No autorizado"}), 401
    nombre = request.args.get('nombre', '').strip()
    if not nombre:
        return jsonify({"status": "error", "resultado": "Parámetro 'nombre' requerido"}), 400
    try:
        resultado = leer_datos_hoja(nombre)
        return jsonify({"status": "ok", "resultado": resultado, "timestamp": _dt.now().isoformat()})
    except Exception as e:
        return jsonify({"status": "error", "resultado": str(e)}), 500

@app.route('/sync/pack', methods=['POST'])
def sync_pack():
    if not _token_valido():
        return jsonify({"status": "error", "resultado": "No autorizado"}), 401
    data = request.get_json() or {}
    pack_id = str(data.get('pack_id', '')).strip()
    if not pack_id:
        return jsonify({"status": "error", "resultado": "Campo 'pack_id' requerido"}), 400
    _lanzar_en_hilo(sincronizar_manual_por_id, pack_id)
    return jsonify({"status": "iniciado", "mensaje": f"🛠 Sync por Pack ID {pack_id} iniciado.", "timestamp": _dt.now().isoformat()})

@app.route('/sync/fecha', methods=['POST'])
def sync_fecha():
    if not _token_valido():
        return jsonify({"status": "error", "resultado": "No autorizado"}), 401
    data = request.get_json() or {}
    fecha = str(data.get('fecha', '')).strip()
    if not fecha:
        return jsonify({"status": "error", "resultado": "Campo 'fecha' requerido (formato AAAA-MM-DD)"}), 400
    _lanzar_en_hilo(sincronizar_por_dia_especifico, fecha)
    return jsonify({"status": "iniciado", "mensaje": f"📅 Sync por fecha {fecha} iniciado.", "timestamp": _dt.now().isoformat()})

@app.route('/sync/aprendizaje', methods=['POST'])
def sync_aprendizaje():
    if not _token_valido():
        return jsonify({"status": "error", "resultado": "No autorizado"}), 401
    _lanzar_en_hilo(aprender_de_interacciones_meli)
    return jsonify({"status": "iniciado", "mensaje": "🎓 Aprendizaje IA iniciado. Se analizarán las últimas interacciones de MeLi.", "timestamp": _dt.now().isoformat()})

@app.route('/sync/gmail', methods=['POST'])
def sync_gmail():
    if not _token_valido():
        return jsonify({"status": "error", "resultado": "No autorizado"}), 401
    _lanzar_en_hilo(sincronizar_facturas_de_compra_siigo)
    return jsonify({"status": "iniciado", "mensaje": "🔄 Sync de facturas de compra SIIGO desde Gmail iniciado.", "timestamp": _dt.now().isoformat()})

@app.route('/sync/stock', methods=['POST'])
def sync_stock():
    if not _token_valido():
        return jsonify({"status": "error", "resultado": "No autorizado"}), 401
    _lanzar_en_hilo(ejecutar_sincronizacion_y_reporte_stock)
    return jsonify({"status": "iniciado", "mensaje": "📊 Reporte de stock iniciado. El resultado llegará por WhatsApp.", "timestamp": _dt.now().isoformat()})

if __name__ == '__main__':
    # Este corre en el 8080. El agente_pro corre en el 8081.
    print("🚀 Webhook MeLi escuchando en puerto 8080...")
    app.run(host='0.0.0.0', port=8080)
