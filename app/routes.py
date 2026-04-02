
from flask import request, jsonify, render_template
import os
import json
import re
import hmac
import hashlib
import base64


PENDIENTES_PATH = 'app/data/preguntas_pendientes_preventa.json'


def encontrar_question_id_por_sufijo(sufijo: str):
    """Busca en pendientes el question_id que termina con `sufijo`."""
    try:
        with open(PENDIENTES_PATH) as f:
            data = json.load(f)
        for p in data.get('preguntas', []):
            if not p.get('respondida'):
                if str(p['question_id']).endswith(sufijo):
                    return str(p['question_id'])
    except Exception:
        pass
    return None


def detectar_comando_preventa(texto: str):
    """
    Detecta comandos de respuesta preventa en dos formatos:
      - Completo:  resp preventa 13553975455: mensaje
      - Abreviado: resp 455: mensaje  (últimos 3+ dígitos del question_id)
    Acepta con o sin llaves, mayúsculas/minúsculas.
    Retorna (question_id_completo, respuesta) o (None, None).
    """
    # Formato completo: resp preventa <digits>: <respuesta>
    patrones_completo = [
        r'resp\s+preventa\s+(\d+):\s*\{(.+?)\}\s*$',
        r'resp\s+preventa\s+(\d+):\s*(.+)',
    ]
    for patron in patrones_completo:
        m = re.search(patron, texto.strip(), re.IGNORECASE | re.DOTALL)
        if m:
            qid = m.group(1).strip()
            resp = m.group(2).strip().strip('{}').strip()
            return qid, resp

    # Formato abreviado: resp <3+dígitos>: <respuesta>
    patrones_corto = [
        r'^resp\s+(\d{2,}?):\s*\{(.+?)\}\s*$',
        r'^resp\s+(\d{2,}?):\s*(.+)',
    ]
    for patron in patrones_corto:
        m = re.search(patron, texto.strip(), re.IGNORECASE | re.DOTALL)
        if m:
            sufijo = m.group(1).strip()
            resp = m.group(2).strip().strip('{}').strip()
            qid_completo = encontrar_question_id_por_sufijo(sufijo)
            if qid_completo:
                return qid_completo, resp
            # Si no se encuentra en pendientes, no procesar
            return None, None

    return None, None

# --- Dependencias de Lógica de Negocio ---
# Estas son las funciones que nuestra ruta necesita para operar.
# TODO: Eventualmente, estas dependencias se deben limpiar y organizar.
from app.core import obtener_respuesta_ia
from modulo_posventa import responder_mensaje_posventa
from app.utils import enviar_whatsapp_reporte
from app.sync import sincronizar_stock_todas_las_plataformas, sincronizar_facturas_recientes

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
            producto=pendiente.get('titulo_producto', ''),
            pregunta=pendiente.get('pregunta', ''),
            respuesta=respuesta_humana
        )

        # Confirmar al grupo
        grupo = os.getenv("GRUPO_CONTABILIDAD_WA", "120363407538342427@g.us")
        emoji = "✅" if exito else "❌"
        enviar_whatsapp_reporte(
            f"{emoji} *Respuesta preventa {'enviada' if exito else 'FALLÓ'} al cliente*\n"
            f"📦 Producto: {pendiente.get('titulo_producto', '')}\n"
            f"💬 Respuesta: {respuesta_humana[:120]}{'...' if len(respuesta_humana) > 120 else ''}\n"
            f"📚 Guardada como caso de entrenamiento.",
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

def _sufijo_pago(numero: str) -> str:
    """Últimos 3 dígitos del número, para comando corto 'ok 463'."""
    digits = re.sub(r'\D', '', numero)
    return digits[-3:] if len(digits) >= 3 else digits

def _buscar_pago_por_sufijo(sufijo: str) -> str:
    """Retorna el número completo cuyo sufijo coincida y esté sin confirmar."""
    for num, datos in pagos_pendientes_confirmacion.items():
        if _sufijo_pago(num) == sufijo and not datos.get("confirmado"):
            return num
    return None

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
            
            # Rechazo corto: "no 463"
            if re.match(r'^no\s+\d{3}$', msg_lower):
                sufijo = msg_lower.split()[1]
                target_num = _buscar_pago_por_sufijo(sufijo)
                if target_num:
                    pagos_pendientes_confirmacion.pop(target_num, None)
                    borradores_aprobacion.pop(target_num, None)
                    threading.Thread(target=enviar_whatsapp_reporte, args=(
                        "Hola, ha habido un problema con la validación de tu pago. Por favor rectifica y revisa por qué la transacción no ha sido recibida.",
                        target_num
                    )).start()
                    threading.Thread(target=enviar_whatsapp_reporte, args=(f"❌ Pago rechazado para ...{sufijo}", grupo_contabilidad)).start()
                else:
                    threading.Thread(target=enviar_whatsapp_reporte, args=(f"⚠️ No encontré pago pendiente con código {sufijo}.", grupo_contabilidad)).start()
                return jsonify({"status": "ok", "respuesta": None})

            # Formato corto: "ok 463" (últimos 3 dígitos del número)
            if re.match(r'^ok\s+\d{3}$', msg_lower):
                sufijo = msg_lower.split()[1]
                target_num = _buscar_pago_por_sufijo(sufijo)
                if target_num:
                    threading.Thread(target=procesar_confirmacion_pago_async, args=(target_num,)).start()
                    threading.Thread(target=enviar_whatsapp_reporte, args=(f"✅ Pago confirmado al cliente ...{sufijo}", grupo_contabilidad)).start()
                else:
                    threading.Thread(target=enviar_whatsapp_reporte, args=(f"⚠️ No encontré pago pendiente con código {sufijo}.", grupo_contabilidad)).start()
                return jsonify({"status": "ok", "respuesta": None})

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
                        msg_error = f"⚠️ Hay {cantidad} pagos pendientes. Usa: ok <últimos 3 dígitos>" if cantidad > 1 else "⚠️ No hay pagos pendientes por confirmar."
                        threading.Thread(target=enviar_whatsapp_reporte, args=(msg_error, grupo_contabilidad)).start()
                        return jsonify({"status": "ok", "respuesta": None})
                threading.Thread(target=procesar_confirmacion_pago_async, args=(target_num,)).start()
                threading.Thread(target=enviar_whatsapp_reporte, args=(f"✅ Confirmación enviada al cliente {target_num}", grupo_contabilidad)).start()
                return jsonify({"status": "ok", "respuesta": None})
                
            # "OK" o "ok" a solas → aprueba factura de compra pendiente (si la hay)
            elif msg_lower.strip() == 'ok':
                from app import shared_state
                if shared_state.eventos_aprobacion_facturas:
                    factura_key = next(iter(shared_state.eventos_aprobacion_facturas))
                    entrada = shared_state.eventos_aprobacion_facturas.get(factura_key)
                    if entrada:
                        entrada["aprobado"] = True
                        entrada["event"].set()
                        threading.Thread(target=enviar_whatsapp_reporte, args=(
                            f"✅ Factura *{factura_key}* aprobada. Creando en SIIGO...",
                            grupo_contabilidad
                        )).start()
                else:
                    threading.Thread(target=enviar_whatsapp_reporte, args=(
                        "⚠️ No hay facturas pendientes de aprobación en este momento.",
                        grupo_contabilidad
                    )).start()
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
                # Intentar primero como comando preventa (formato corto: resp 497: ...)
                question_id, respuesta_humana = detectar_comando_preventa(message_text)
                if question_id and respuesta_humana:
                    print(f"📨 Preventa (formato corto) — ID: {question_id} | Resp: {respuesta_humana[:60]}")
                    threading.Thread(
                        target=_procesar_respuesta_preventa,
                        args=(question_id, respuesta_humana)
                    ).start()
                    return jsonify({"status": "ok", "respuesta": None})

                # Si no es preventa, tratar como respuesta directa: resp <numero>: <mensaje>
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

            codigo = _sufijo_pago(sender_id)
            num_corto = sender_id.replace("@c.us", "")[-7:]  # últimos 7 dígitos para mostrar
            mensaje_aprobacion = (
                f"🔔 *ALERTA DE PAGO*\n"
                f"Cliente *...{num_corto}* envió un comprobante de pago.\n\n"
                f"✅ *Para CONFIRMAR:*\n"
                f"   Escribe: *ok {codigo}*\n\n"
                f"❌ *Para RECHAZAR:*\n"
                f"   Escribe: *no {codigo}*\n\n"
                f"📎 Comprobante: {media_path}"
            )

            pagos_pendientes_confirmacion[sender_id] = {
                "timestamp": time.time(),
                "mensaje": mensaje_aprobacion,
                "confirmado": False,
                "codigo": codigo,
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

    def _procesar_webhook_woocommerce(payload: dict):
        """
        Procesa en hilo secundario un webhook de WooCommerce.
        Para order.created/updated: WooCommerce ya decrementó su propio stock.
        Leemos el stock post-venta de WC y lo propagamos a MeLi.
        """
        try:
            line_items = payload.get('line_items', [])
            if not line_items:
                print("⚠️ [WC-WEBHOOK] Orden sin line_items — ignorada.")
                return

            order_id = payload.get('id', 'desconocido')
            print(f"🛒 [WC-WEBHOOK] Procesando orden WooCommerce #{order_id} ({len(line_items)} ítem(s))...")

            from app.services.woocommerce import obtener_stock_woocommerce
            from app.services.meli import actualizar_stock_meli

            for item in line_items:
                sku = item.get('sku', '').strip()
                cantidad = int(item.get('quantity', 0))

                if not sku or cantidad <= 0:
                    print(f"⚠️ [WC-WEBHOOK] Ítem sin SKU o cantidad inválida: {item.get('name')}")
                    continue

                # WC ya decrementó su stock al procesar la orden.
                # Usamos ese valor post-venta como fuente de verdad para sincronizar MeLi.
                stock_post_venta = obtener_stock_woocommerce(sku)
                resultado_meli = actualizar_stock_meli(sku, stock_post_venta)
                print(f"   └──> SKU {sku} | -{cantidad} uds en WC | Stock post-venta: {stock_post_venta} | MeLi: {resultado_meli}")

        except Exception as e:
            print(f"❌ [WC-WEBHOOK] Error procesando webhook de WooCommerce: {e}")

    @app.route('/woocommerce', methods=['POST'])
    def woocommerce_webhook():
        """
        Endpoint que recibe los webhooks enviados por WooCommerce.
        Verifica la firma HMAC-SHA256, responde 200 OK de inmediato
        y procesa la lógica en un hilo secundario.
        """
        # Verificación de firma (si hay secreto configurado)
        wc_secret = os.getenv('WC_WEBHOOK_SECRET', '')
        if wc_secret:
            sig_header = request.headers.get('X-WC-Webhook-Signature', '')
            payload_bytes = request.get_data()
            firma_esperada = base64.b64encode(
                hmac.new(wc_secret.encode('utf-8'), payload_bytes, hashlib.sha256).digest()
            ).decode('utf-8')
            if not hmac.compare_digest(sig_header, firma_esperada):
                print(f"⚠️ [WC-WEBHOOK] Firma inválida — request rechazado.")
                return jsonify({"status": "unauthorized"}), 401

        payload = request.json or {}
        evento = request.headers.get('X-WC-Webhook-Topic', payload.get('_topic', ''))

        print(f"📨 [WC-WEBHOOK] Evento recibido: '{evento}' | Orden: {payload.get('id', 'N/A')}")

        if evento in ('order.created', 'order.updated'):
            status = payload.get('status', '')
            if status in ('processing', 'completed'):
                threading.Thread(
                    target=_procesar_webhook_woocommerce,
                    args=(payload,),
                    daemon=True
                ).start()
            else:
                print(f"⏭️ [WC-WEBHOOK] Orden con estado '{status}' — ignorada.")

        return jsonify({"status": "ok"}), 200
