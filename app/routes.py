
from flask import request, jsonify, render_template
import os
import json
import re


def detectar_comando_preventa(texto: str):
    """
    Detecta 'resp preventa {id}: {respuesta}' en variantes:
      - con o sin llaves en la respuesta
      - mayúsculas/minúsculas
    Retorna (question_id, respuesta) o (None, None).
    """
    patrones = [
        r'resp\s+preventa\s+(\d+):\s*\{(.+?)\}\s*$',  # con llaves
        r'resp\s+preventa\s+(\d+):\s*(.+)',             # sin llaves
    ]
    for patron in patrones:
        m = re.search(patron, texto.strip(), re.IGNORECASE | re.DOTALL)
        if m:
            qid = m.group(1).strip()
            resp = m.group(2).strip().strip('{}').strip()
            return qid, resp
    return None, None

# --- Dependencias de Lógica de Negocio ---
# Estas son las funciones que nuestra ruta necesita para operar.
# TODO: Eventualmente, estas dependencias se deben limpiar y organizar.
from app.core import obtener_respuesta_ia
from modulo_posventa import responder_mensaje_posventa
from app.utils import enviar_whatsapp_reporte

def _procesar_respuesta_preventa(question_id: str, respuesta_humana: str):
    """
    Procesa "resp preventa {question_id}: {respuesta}":
    1. Busca la pregunta pendiente
    2. Responde en MeLi
    3. Guarda el caso como few-shot
    4. Confirma al grupo
    """
    try:
        from app.services.meli_preventa import obtener_pregunta_pendiente, guardar_caso_preventa
        from app.utils import refrescar_token_meli

        pendiente = obtener_pregunta_pendiente(question_id)
        if not pendiente:
            enviar_whatsapp_reporte(
                f"⚠️ No encontré pregunta pendiente con ID {question_id}",
                numero_destino=os.getenv("GRUPO_CONTABILIDAD_WA", "120363407538342427@g.us")
            )
            return

        # Responder en MeLi
        token = refrescar_token_meli()
        if token:
            import requests as req
            res = req.post(
                "https://api.mercadolibre.com/answers",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json={"question_id": int(question_id), "text": respuesta_humana},
                timeout=15
            )
            exito = res.status_code == 200
        else:
            exito = False

        # Guardar como caso de entrenamiento
        guardar_caso_preventa(
            producto=pendiente.get('producto', ''),
            pregunta=pendiente.get('pregunta', ''),
            respuesta=respuesta_humana
        )

        # Confirmar al grupo
        grupo = os.getenv("GRUPO_CONTABILIDAD_WA", "120363407538342427@g.us")
        estado = "✅ enviada" if exito else "❌ error al enviar"
        enviar_whatsapp_reporte(
            f"{'✅' if exito else '❌'} Respuesta preventa {estado} al cliente\n"
            f"Producto: {pendiente.get('producto', '')}\n"
            f"Respuesta guardada como caso de entrenamiento.",
            numero_destino=grupo
        )
        print(f"✅ Preventa: respuesta humana procesada para question_id {question_id}")

    except Exception as e:
        print(f"❌ Preventa: error procesando respuesta humana: {e}")


def cargar_modos_atencion():
    try:
        with open('app/data/modos_atencion.json', 'r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        return {"numeros_en_humano": [], "timestamps": {}}

def guardar_modos_atencion(data):
    with open('app/data/modos_atencion.json', 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)

import time
import threading

# --- Estado Temporal ---
# TODO: Este diccionario en memoria se pierde si el servidor se reinicia.
# Se debe reemplazar por una solución persistente como Redis o una DB.
borradores_aprobacion = {}

pagos_pendientes_confirmacion = {}

def procesar_confirmacion_pago_async(numero_cliente):
    # Aquí podríamos añadir lógica extra asíncrona si se requiere
    # por ahora solo enviamos el mensaje sin bloquear la respuesta de flask
    try:
        if numero_cliente in pagos_pendientes_confirmacion:
            pagos_pendientes_confirmacion[numero_cliente]["confirmado"] = True
            mensaje_cliente = "Veci, le confirmamos que su pago ha sido recibido ✅ Estamos alistando su pedido y le avisamos cuando despachemos."
            enviar_whatsapp_reporte(mensaje_cliente, numero_destino=numero_cliente)
            del pagos_pendientes_confirmacion[numero_cliente]
    except Exception as e:
        print(f"Error procesando confirmación de pago: {e}")

def register_routes(app):
    """
    Registra todas las rutas de la aplicación en la instancia de Flask.
    Esto sigue el patrón de "Application Factory" para una mejor organización.
    """

    @app.route('/whatsapp', methods=['POST'])
    def whatsapp_endpoint():
        """
        Endpoint principal que recibe los webhooks de WhatsApp.
        Procesa los mensajes, gestiona un flujo de aprobación para posventa y responde.
        """
        data = request.json
        if not data:
            return jsonify({"status": "error", "respuesta": "Request inválido, no se recibió JSON."}), 400

        try:
            from app.monitor import incrementar_metrica
            incrementar_metrica('mensajes_whatsapp')
        except Exception:
            pass

        sender_id = data.get('sender', 'desconocido')
        message_text = data.get('mensaje', '').strip()
        is_after_sale = data.get('es_postventa', False)
        order_id = data.get('order_id', sender_id)
        
        # Adaptación para aceptar hasMedia o has_media según venga del node o de otro lado
        has_media = data.get('hasMedia', data.get('has_media', False))
        media_type = data.get('mediaType', data.get('media_type', ''))
        media_path = data.get('mediaPath', '')
        es_grupo_contabilidad = data.get('es_grupo_contabilidad', False)

        grupo_contabilidad = os.getenv("GRUPO_CONTABILIDAD_WA", "120363407538342427@g.us")
        
        # --- COMANDOS DEL GRUPO DE CONTABILIDAD ---
        if es_grupo_contabilidad:
            modos = cargar_modos_atencion()
            msg_lower = message_text.lower()
            
            if msg_lower.startswith("ok confirmado"):
                partes = message_text.split(" ", 2)
                if len(partes) >= 3 and partes[2].strip():
                    # Formato completo: "ok confirmado {numero}"
                    target_num = partes[2].strip()
                else:
                    # Sin número: buscar el único pago pendiente
                    pendientes = [k for k, v in pagos_pendientes_confirmacion.items() if not v.get("confirmado")]
                    if len(pendientes) == 1:
                        target_num = pendientes[0]
                    else:
                        cantidad = len(pendientes)
                        msg_error = f"⚠️ Hay {cantidad} pagos pendientes. Especifica el número: 'ok confirmado {{numero}}'" if cantidad > 1 else "⚠️ No hay pagos pendientes por confirmar."
                        threading.Thread(target=enviar_whatsapp_reporte, args=(msg_error, grupo_contabilidad)).start()
                        return jsonify({"status": "ok", "respuesta": None})
                threading.Thread(target=procesar_confirmacion_pago_async, args=(target_num,)).start()
                threading.Thread(target=enviar_whatsapp_reporte, args=(f"✅ Confirmación enviada al cliente {target_num}", grupo_contabilidad)).start()
                return jsonify({"status": "ok", "respuesta": None})
                
            elif msg_lower.startswith("pausar "):
                target_num = message_text.split(" ", 1)[1].strip()
                if target_num not in modos["numeros_en_humano"]:
                    modos["numeros_en_humano"].append(target_num)
                    guardar_modos_atencion(modos)
                threading.Thread(target=enviar_whatsapp_reporte, args=("En este momento te va a atender Jennifer García del área de ventas 🙏", target_num)).start()
                return jsonify({"status": "ok", "respuesta": None})
                
            elif msg_lower.startswith("activar "):
                target_num = message_text.split(" ", 1)[1].strip()
                if target_num in modos["numeros_en_humano"]:
                    modos["numeros_en_humano"].remove(target_num)
                    guardar_modos_atencion(modos)
                threading.Thread(target=enviar_whatsapp_reporte, args=("Hola veci, soy Hugo García nuevamente, ¿en qué le puedo ayudar?", target_num)).start()
                return jsonify({"status": "ok", "respuesta": None})
                
            elif msg_lower.startswith("resp preventa "):
                print(f"📨 Comando preventa recibido del grupo: {message_text[:120]}")
                question_id, respuesta_humana = detectar_comando_preventa(message_text)
                print(f"🔍 Detectado — ID: {question_id} | Respuesta: {str(respuesta_humana)[:60]}")
                if question_id and respuesta_humana:
                    threading.Thread(
                        target=_procesar_respuesta_preventa,
                        args=(question_id, respuesta_humana)
                    ).start()
                else:
                    threading.Thread(
                        target=enviar_whatsapp_reporte,
                        args=(
                            "⚠️ Formato inválido. Escribe así (sin llaves):\n"
                            f"resp preventa {question_id or '<ID>'}: tu respuesta va aquí",
                            grupo_contabilidad
                        )
                    ).start()
                return jsonify({"status": "ok", "respuesta": None})

            elif msg_lower.startswith("resp "):
                partes = message_text.split(" ", 1)[1].split(":", 1)
                if len(partes) == 2 and partes[1].strip():
                    target_num = partes[0].strip()
                    resp_msg = partes[1].strip()
                    threading.Thread(target=enviar_whatsapp_reporte, args=(resp_msg, target_num)).start()
                    return jsonify({"status": "ok", "respuesta": None})
                # Sin mensaje o sin formato completo → ignorar silenciosamente
            
            return jsonify({"status": "ok", "respuesta": None})
        
        # --- SWITCH IA/HUMANO ---
        if not es_grupo_contabilidad:
            modos = cargar_modos_atencion()
            if sender_id in modos["numeros_en_humano"]:
                # Reenviar al grupo y no procesar IA
                mensaje_reenvio = f"💬 CLIENTE {sender_id}: {message_text}"
                threading.Thread(target=enviar_whatsapp_reporte, args=(mensaje_reenvio, grupo_contabilidad)).start()
                return jsonify({"status": "human_mode", "respuesta": None})

        # --- Flujo de Aprobación para Comprobantes de Pago (legacy) ---
        if message_text.lower().startswith("pago no"):
            target_sender = message_text.split()[-1]
            if target_sender in borradores_aprobacion:
                borradores_aprobacion.pop(target_sender)
                return jsonify({"status": "success", "respuesta": f"Hola, ha habido un problema con la validación de tu pago. Por favor rectifica y revisa por qué la transacción no ha sido recibida."})
            else:
                return jsonify({"status": "error", "respuesta": f"No encontré un comprobante pendiente para el número '{target_sender}'."})

        # --- Detección de Comprobantes de Pago ---
        keywords_pago_sin_img = ["soporte", "comprobante", "transferí", "consigné", "ya pagué", "ya transferí", "mira el soporte", "ahí te envié", "te mando el soporte"]
        keywords_pago_ignorar = ["y al nequi?", "cómo pago", "forma de pago", "cuánto es", "datos de pago"]
        
        is_payment_keyword_sin_img = any(keyword in message_text.lower() for keyword in keywords_pago_sin_img)
        is_ignored_keyword = any(keyword in message_text.lower() for keyword in keywords_pago_ignorar)
        
        if (has_media and media_type == 'image'):
            borradores_aprobacion[sender_id] = {"estado": "esperando_validacion_pago", "ruta_imagen": media_path}
            
            mensaje_aprobacion = (
                f"🔔 ALERTA PAGO - Cliente: {sender_id} envió un comprobante.\n"
                f"Ruta imagen: {media_path}\n"
                f"Por favor confirmar con: 'ok confirmado {sender_id}'"
            )
            
            pagos_pendientes_confirmacion[sender_id] = {
                "timestamp": time.time(),
                "mensaje": mensaje_aprobacion,
                "confirmado": False
            }
            
            threading.Thread(target=enviar_whatsapp_reporte, args=(mensaje_aprobacion, grupo_contabilidad)).start()
            
            return jsonify({
                "status": "waiting_for_payment_approval",
                "respuesta": "Veci, recibí su comprobante. En un momento nuestro equipo de contabilidad lo verifica y le confirmamos. ¡Gracias por su compra!"
            })
            
        elif is_payment_keyword_sin_img and not is_ignored_keyword and not has_media:
            return jsonify({
                "status": "missing_image",
                "respuesta": "Veci, parece que el mensaje llegó sin la imagen adjunta. ¿Puede intentar enviarla de nuevo? 📎"
            })

        # --- Flujo de Aprobación para Mensajes de Posventa ---
        if message_text.lower().startswith("hugo dale ok"):
            target_order_id = message_text.split()[-1]
            if target_order_id in borradores_aprobacion:
                message_to_send = borradores_aprobacion.pop(target_order_id)
                
                # Delegar el envío real a la función correspondiente.
                resultado_envio = responder_mensaje_posventa(target_order_id, message_to_send)
                print(f"Resultado del envío a posventa: {resultado_envio}")
                
                return jsonify({"status": "sent", "respuesta": f"¡Listo! Mensaje enviado para la orden {target_order_id}."})
            else:
                return jsonify({"status": "error", "respuesta": f"No encontré un borrador pendiente de aprobación para la orden '{target_order_id}'."})

        # --- Control para Evitar Duplicados ---
        if is_after_sale and order_id in borradores_aprobacion:
            return jsonify({
                "status": "already_waiting",
                "respuesta": f"Ya existe una respuesta pendiente de aprobación para la orden {order_id}."
            })

        # --- Escalación al Grupo ---
        keywords_escalacion = [
            "quiero hablar con una persona", "hablar con alguien", "asesor", "agente humano",
            "devolución", "reclamo", "garantía",
            "descuento", "precio especial", "más barato", "mas barato"
        ]
        if any(keyword in message_text.lower() for keyword in keywords_escalacion):
            mensaje_aprobacion = (
                f"❓ CONSULTA IA - Cliente {sender_id} preguntó: {message_text}\n"
                f"Responder con: 'resp {sender_id}: {{respuesta}}'"
            )
            enviar_whatsapp_reporte(mensaje_aprobacion, numero_destino=grupo_contabilidad)
            return jsonify({
                "status": "escalated",
                "respuesta": "Veci, déjame consultar esa información con mi equipo y le confirmo en un momento 🙏"
            })

        # --- Procesamiento del Mensaje por la IA ---
        respuesta_ia, _ = obtener_respuesta_ia(message_text, sender_id)
        
        incertidumbre_ia = ["no tengo información", "no puedo", "no estoy seguro"]
        if any(frase in respuesta_ia.lower() for frase in incertidumbre_ia):
            mensaje_aprobacion = (
                f"❓ CONSULTA IA - Cliente {sender_id} preguntó: {message_text}\n"
                f"Responder con: 'resp {sender_id}: {{respuesta}}'"
            )
            enviar_whatsapp_reporte(mensaje_aprobacion, numero_destino=grupo_contabilidad)
            return jsonify({
                "status": "escalated",
                "respuesta": "Veci, déjame consultar esa información con mi equipo y le confirmo en un momento 🙏"
            })

        # --- Gestión de la Respuesta ---
        if is_after_sale:
            # Si es posventa, no respondemos de inmediato. Guardamos como borrador.
            borradores_aprobacion[order_id] = respuesta_ia
            
            # Notificar al canal de control para que un humano apruebe.
            mensaje_aprobacion = (
                f"🔔 *RESPUESTA PENDIENTE DE APROBACIÓN*\n"
                f"📦 Orden: `{order_id}`\n"
                f"🤖 Mensaje propuesto: _{respuesta_ia}_\n\n"
                f"Para enviar, responde al bot: `hugo dale ok {order_id}`"
            )
            enviar_whatsapp_reporte(mensaje_aprobacion)
            
            return jsonify({
                "status": "waiting_for_approval",
                "respuesta": "La respuesta del agente ha sido generada y está pendiente de aprobación."
            })
        else:
            # Si es un chat normal, respondemos directamente.
            return jsonify({"status": "success", "respuesta": respuesta_ia})

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
