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

from preventa_meli import procesar_nueva_pregunta

# Memoria para deduplicación de preguntas
preguntas_procesadas = {}

def limpiar_preguntas_antiguas():
    """Elimina del registro las preguntas procesadas hace más de 5 minutos."""
    ahora = time.time()
    # 300 segundos = 5 minutos
    para_borrar = [q_id for q_id, timestamp in preguntas_procesadas.items() if ahora - timestamp > 300]
    for q_id in para_borrar:
        del preguntas_procesadas[q_id]

@app.route('/notifications', methods=['POST'])
def notifications():
    """Recibe la notificación y responde 'OK' de inmediato a MeLi."""
    data = request.get_json()
    
    if data and data.get('topic') == 'questions':
        resource = data.get('resource')
        if resource:
            question_id = resource.split('/')[-1]
            
            # Limpiar memoria antigua
            limpiar_preguntas_antiguas()
            
            # Verificar deduplicación
            if question_id in preguntas_procesadas:
                print(f"Pregunta {question_id} ya procesada. Omitiendo duplicado.")
            else:
                preguntas_procesadas[question_id] = time.time()
                # Lanzamos el proceso en un hilo para no hacer esperar a MeLi
                hilo = threading.Thread(target=procesar_nueva_pregunta, args=(question_id,))
                hilo.start()
        
    # Respondemos 200 OK inmediatamente
    return jsonify({"status": "ok"}), 200

# Mantenemos el endpoint de whatsapp por si lo estaban usando para pruebas locales
@app.route('/whatsapp', methods=['POST'])
def whatsapp_mock():
    data = request.get_json()
    if data and data.get('topic') == 'questions':
        resource = data.get('resource')
        if resource:
            question_id = resource.split('/')[-1]
            hilo = threading.Thread(target=procesar_nueva_pregunta, args=(question_id,))
            hilo.start()
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

@app.route('/confirmar-pago', methods=['POST'])
def confirmar_pago():
    data = request.get_json() or {}
    numero_cliente = data.get('numero_cliente')
    confirmado = data.get('confirmado', False)
    
    if not numero_cliente:
        return jsonify({"status": "error", "resultado": "Campo 'numero_cliente' requerido"}), 400
        
    if confirmado:
        mensaje_cliente = "Veci, le confirmamos que su pago ha sido recibido ✅ Estamos alistando su pedido y le avisamos cuando despachemos."
        enviar_whatsapp_reporte(mensaje_cliente, numero_destino=numero_cliente)
        return jsonify({"status": "success", "mensaje": f"Pago confirmado para {numero_cliente}"})
    else:
        mensaje_cliente = "Hola, ha habido un problema con la validación de tu pago. Por favor rectifica y revisa por qué la transacción no ha sido recibida."
        enviar_whatsapp_reporte(mensaje_cliente, numero_destino=numero_cliente)
        return jsonify({"status": "success", "mensaje": f"Pago rechazado para {numero_cliente}"})

@app.route('/training/agregar-caso', methods=['POST'])
def agregar_caso():
    import json
    data = request.get_json() or {}
    trigger = data.get('trigger', [])
    contexto = data.get('contexto', '')
    instruccion = data.get('instruccion', '')
    
    if not all([trigger, contexto, instruccion]):
        return jsonify({"status": "error", "resultado": "Faltan campos (trigger, contexto, instruccion)"}), 400
        
    try:
        archivo = 'app/training/casos_especiales.json'
        with open(archivo, 'r', encoding='utf-8') as f:
            contenido = json.load(f)
            
        nuevo_caso = {
            "id": f"caso_{int(time.time())}",
            "trigger": trigger if isinstance(trigger, list) else [trigger],
            "contexto": contexto,
            "instruccion": instruccion,
            "ejemplo_respuesta": data.get('ejemplo_respuesta', '')
        }
        
        contenido['casos'].append(nuevo_caso)
        
        with open(archivo, 'w', encoding='utf-8') as f:
            json.dump(contenido, f, indent=2, ensure_ascii=False)
            
        # Reiniciar contexto del agente
        configurar_ia(app)
        
        return jsonify({"status": "success", "mensaje": "Caso agregado y agente reentrenado"})
    except Exception as e:
        return jsonify({"status": "error", "resultado": str(e)}), 500

if __name__ == '__main__':
    # Este corre en el 8080. El agente_pro corre en el 8081.
    print("🚀 Webhook MeLi escuchando en puerto 8080...")
    app.run(host='0.0.0.0', port=8080)
