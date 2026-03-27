
from flask import request, jsonify

# --- Dependencias de Lógica de Negocio ---
# Estas son las funciones que nuestra ruta necesita para operar.
# TODO: Eventualmente, estas dependencias se deben limpiar y organizar.
from agente_pro import obtener_respuesta_ia
from modulo_posventa import responder_mensaje_posventa
from core_sync import enviar_whatsapp_reporte

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
