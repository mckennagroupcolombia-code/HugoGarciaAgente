
from flask import request, jsonify, render_template

# --- Dependencias de Lógica de Negocio ---
# Estas son las funciones que nuestra ruta necesita para operar.
# TODO: Eventualmente, estas dependencias se deben limpiar y organizar.
from app.core import obtener_respuesta_ia
from modulo_posventa import responder_mensaje_posventa
from app.utils import enviar_whatsapp_reporte

# --- Estado Temporal ---
# TODO: Este diccionario en memoria se pierde si el servidor se reinicia.
# Se debe reemplazar por una solución persistente como Redis o una DB.
borradores_aprobacion = {}

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

        sender_id = data.get('sender', 'desconocido')
        message_text = data.get('mensaje', '').strip()
        is_after_sale = data.get('es_postventa', False)
        order_id = data.get('order_id', sender_id)
        has_media = data.get('has_media', False)
        media_type = data.get('media_type', '')

        # --- Flujo de Aprobación para Comprobantes de Pago ---
        if message_text.lower().startswith("pago ok"):
            target_sender = message_text.split()[-1]
            if target_sender in borradores_aprobacion:
                # Comprobante validado
                borradores_aprobacion.pop(target_sender)
                # Aquí se debería continuar con el proceso normal, e.g., avisar que se recibió el pago y se generará la factura.
                # Para simplificar la prueba, enviamos un mensaje de vuelta indicando éxito.
                return jsonify({"status": "success", "respuesta": f"¡Perfecto! Hemos validado tu pago. En breve te enviaremos la factura correspondiente."})
            else:
                return jsonify({"status": "error", "respuesta": f"No encontré un comprobante pendiente para el número '{target_sender}'."})
                
        elif message_text.lower().startswith("pago no"):
            target_sender = message_text.split()[-1]
            if target_sender in borradores_aprobacion:
                borradores_aprobacion.pop(target_sender)
                return jsonify({"status": "success", "respuesta": f"Hola, ha habido un problema con la validación de tu pago. Por favor rectifica y revisa por qué la transacción no ha sido recibida."})
            else:
                return jsonify({"status": "error", "respuesta": f"No encontré un comprobante pendiente para el número '{target_sender}'."})

        # --- Detección de Comprobantes de Pago ---
        if has_media and media_type == 'image':
            keywords_pago = ["bancolombia", "tarjeta", "credito", "nequi", "mercadopago", "efectivo", "contado", "pago", "transferencia", "comprobante"]
            is_payment = any(keyword in message_text.lower() for keyword in keywords_pago)
            
            # Si tiene imagen y menciona métodos de pago, asumimos que es comprobante
            if is_payment or message_text == "":
                borradores_aprobacion[sender_id] = "esperando_validacion_pago"
                
                # Notificar al canal de control para que un humano apruebe.
                mensaje_aprobacion = (
                    f"💰 *COMPROBANTE DE PAGO RECIBIDO*\n"
                    f"👤 Cliente: `{sender_id}`\n"
                    f"¿Es válido el comprobante de pago enviado por el cliente?\n\n"
                    f"Para confirmar, responde: `pago ok {sender_id}`\n"
                    f"Si el pago no es válido, responde: `pago no {sender_id}`"
                )
                enviar_whatsapp_reporte(mensaje_aprobacion)
                
                return jsonify({
                    "status": "waiting_for_payment_approval",
                    "respuesta": "Hemos recibido tu comprobante. Nuestro equipo lo está validando. Te avisaremos en cuanto esté confirmado."
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

        # --- Procesamiento del Mensaje por la IA ---
        respuesta_ia, _ = obtener_respuesta_ia(message_text, sender_id)

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
