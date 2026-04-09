from flask import request, jsonify, render_template
import os
import json
import re
import hmac
import hashlib
import base64
import tempfile
import requests as _requests_lib


PENDIENTES_PATH = "app/data/preguntas_pendientes_preventa.json"


def encontrar_question_id_por_sufijo(sufijo: str):
    """Busca en pendientes el question_id que termina con `sufijo`."""
    try:
        with open(PENDIENTES_PATH) as f:
            data = json.load(f)
        for p in data.get("preguntas", []):
            if not p.get("respondida"):
                if str(p["question_id"]).endswith(sufijo):
                    return str(p["question_id"])
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
        r"resp\s+preventa\s+(\d+):\s*\{(.+?)\}\s*$",
        r"resp\s+preventa\s+(\d+):\s*(.+)",
    ]
    for patron in patrones_completo:
        m = re.search(patron, texto.strip(), re.IGNORECASE | re.DOTALL)
        if m:
            qid = m.group(1).strip()
            resp = m.group(2).strip().strip("{}").strip()
            if len(qid) < 8:
                qid_completo = encontrar_question_id_por_sufijo(qid)
                if qid_completo:
                    qid = qid_completo
            return qid, resp

    # Formato abreviado: resp <3+dígitos>: <respuesta>
    patrones_corto = [
        r"^resp\s+(\d{2,}?):\s*\{(.+?)\}\s*$",
        r"^resp\s+(\d{2,}?):\s*(.+)",
    ]
    for patron in patrones_corto:
        m = re.search(patron, texto.strip(), re.IGNORECASE | re.DOTALL)
        if m:
            sufijo = m.group(1).strip()
            resp = m.group(2).strip().strip("{}").strip()
            qid_completo = encontrar_question_id_por_sufijo(sufijo)
            # Modificación: si no lo encontramos como preventa, tal vez no estaba en pendientes
            # pero no queremos que falle silenciosamente si el usuario usó el comando de preventa.
            if qid_completo:
                return qid_completo, resp
            else:
                # Si el usuario explicitamente usó "resp preventa 155:"
                if "preventa" in texto.lower():
                    # Tratar de encontrarlo aunque esté respondida, para no confundir
                    pass
            # Si no se encuentra en pendientes, no procesar
            return None, None

    return None, None


# --- Dependencias de Lógica de Negocio ---
# Estas son las funciones que nuestra ruta necesita para operar.
# TODO: Eventualmente, estas dependencias se deben limpiar y organizar.
from app.core import obtener_respuesta_ia
from modulo_posventa import responder_mensaje_posventa
from app.utils import enviar_whatsapp_reporte
from app.sync import (
    sincronizar_stock_todas_las_plataformas,
    sincronizar_facturas_recientes,
)


def _procesar_respuesta_preventa(question_id: str, respuesta_humana: str):
    """
    Procesa "resp preventa {question_id}: {respuesta}":
    1. Busca la pregunta pendiente
    2. Responde en MeLi
    3. Guarda el caso como few-shot
    4. Confirma al grupo
    """
    try:
        from app.services.meli_preventa import (
            obtener_pregunta_pendiente,
            guardar_caso_preventa,
        )
        from app.utils import refrescar_token_meli

        pendiente = obtener_pregunta_pendiente(question_id)
        if not pendiente:
            enviar_whatsapp_reporte(
                f"⚠️ No encontré pregunta pendiente con ID {question_id}",
                numero_destino=os.getenv(
                    "GRUPO_PREVENTA_WA", "120363393955474672@g.us"
                ),
            )
            return

        # Responder en MeLi
        token = refrescar_token_meli()
        if token:
            import requests as req

            res = req.post(
                "https://api.mercadolibre.com/answers",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json={"question_id": int(question_id), "text": respuesta_humana},
                timeout=15,
            )
            exito = res.status_code == 200
            if not exito:
                print(f"❌ Preventa: MeLi API falló con {res.status_code} - {res.text}")
        else:
            exito = False

        # Guardar como caso de entrenamiento
        guardar_caso_preventa(
            producto=pendiente.get("titulo_producto", ""),
            pregunta=pendiente.get("pregunta", ""),
            respuesta=respuesta_humana,
        )

        # Confirmar al grupo preventa
        grupo_prev = os.getenv("GRUPO_PREVENTA_WA", "120363393955474672@g.us")
        emoji = "✅" if exito else "❌"
        enviar_whatsapp_reporte(
            f"{emoji} *Respuesta preventa {'enviada' if exito else 'FALLÓ'} al cliente*\n"
            f"📦 Producto: {pendiente.get('titulo_producto', '')}\n"
            f"💬 Respuesta: {respuesta_humana[:120]}{'...' if len(respuesta_humana) > 120 else ''}\n"
            f"📚 Guardada como caso de entrenamiento.",
            numero_destino=grupo_prev,
        )
        print(f"✅ Preventa: respuesta humana procesada para question_id {question_id}")

    except Exception as e:
        print(f"❌ Preventa: error procesando respuesta humana: {e}")


def cargar_modos_atencion():
    try:
        with open("app/data/modos_atencion.json", "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {"numeros_en_humano": [], "timestamps": {}}


def guardar_modos_atencion(data):
    with open("app/data/modos_atencion.json", "w", encoding="utf-8") as f:
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
    digits = re.sub(r"\D", "", numero)
    return digits[-3:] if len(digits) >= 3 else digits


def _buscar_pago_por_sufijo(sufijo: str) -> str:
    """Retorna el número completo cuyo sufijo coincida y esté sin confirmar."""
    for num, datos in pagos_pendientes_confirmacion.items():
        if _sufijo_pago(num) == sufijo and not datos.get("confirmado"):
            return num
    return None


def transcribir_audio_whatsapp(media_path: str, message_id: str = "") -> str | None:
    """Descarga y transcribe un audio de WhatsApp usando OpenAI Whisper."""
    try:
        import openai

        openai_key = os.getenv("OPENAI_API_KEY", "")
        if not openai_key:
            print("⚠ Whisper: OPENAI_API_KEY no configurada")
            return None

        ev_url = os.getenv("EVOLUTION_API_URL", "http://localhost:5000")
        ev_key = os.getenv("EVOLUTION_API_KEY", "")
        inst = os.getenv("INSTANCE_NAME", "Mckenna Group")

        audio_bytes = None

        # Intento 1: descargar via Evolution API getBase64FromMediaMessage
        if message_id:
            try:
                r = _requests_lib.post(
                    f"{ev_url}/chat/getBase64FromMediaMessage/{inst}",
                    headers={"apikey": ev_key, "Content-Type": "application/json"},
                    json={
                        "message": {"key": {"id": message_id}},
                        "convertToMp4": False,
                    },
                    timeout=15,
                )
                if r.ok:
                    b64 = r.json().get("base64", "")
                    if b64:
                        audio_bytes = base64.b64decode(b64)
            except Exception as e:
                print(f"⚠ Whisper getBase64: {e}")

        # Intento 2: leer del path local si existe
        if not audio_bytes and media_path and os.path.exists(media_path):
            with open(media_path, "rb") as f:
                audio_bytes = f.read()

        if not audio_bytes:
            return None

        # Guardar en temp y transcribir
        suffix = ".ogg"
        if media_path and "." in media_path:
            suffix = "." + media_path.rsplit(".", 1)[-1]
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        client = openai.OpenAI(api_key=openai_key)
        with open(tmp_path, "rb") as af:
            result = client.audio.transcriptions.create(
                model="whisper-1", file=af, language="es"
            )
        os.unlink(tmp_path)
        return result.text.strip()
    except Exception as e:
        print(f"❌ Whisper error: {e}")
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


# --- Lógica de MercadoLibre (Migrada de webhook_meli.py) ---
import time
from preventa_meli import procesar_nueva_pregunta
from app.utils import refrescar_token_meli

# Memoria para deduplicación de preguntas
preguntas_procesadas = {}


def limpiar_preguntas_antiguas():
    """Elimina del registro las preguntas procesadas hace más de 5 minutos."""
    ahora = time.time()
    # 300 segundos = 5 minutos
    para_borrar = [
        q_id
        for q_id, timestamp in preguntas_procesadas.items()
        if ahora - timestamp > 300
    ]
    for q_id in para_borrar:
        del preguntas_procesadas[q_id]


def _procesar_orden_meli(order_id: str):
    """
    Obtiene los detalles de una orden de MeLi y descuenta el stock en WooCommerce
    por cada ítem vendido.
    """
    print(f"📦 [MELI-ORDER] Procesando orden {order_id} para sync de stock...")
    try:
        token = refrescar_token_meli()
        if not token:
            print(f"❌ [MELI-ORDER] No se pudo obtener token para orden {order_id}")
            return

        res = requests.get(
            f"https://api.mercadolibre.com/orders/{order_id}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        if res.status_code != 200:
            print(
                f"⚠️ [MELI-ORDER] Error obteniendo orden {order_id}: {res.status_code}"
            )
            return

        orden = res.json()
        if orden.get("status") not in ["paid", "partially_paid"]:
            print(
                f"⏭️ [MELI-ORDER] Orden {order_id} con estado '{orden.get('status')}' — ignorada."
            )
            return

        for item in orden.get("order_items", []):
            item_info = item.get("item", {})
            item_id = item_info.get("id", "")
            cantidad_vendida = item.get("quantity", 0)

            # Obtener SKU y stock post-venta del ítem desde MeLi
            # MeLi ya autodecrementó su available_quantity al procesar la orden.
            try:
                res_item = requests.get(
                    f"https://api.mercadolibre.com/items/{item_id}",
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=10,
                )
                if res_item.status_code == 200:
                    item_data = res_item.json()
                    sku = item_data.get("seller_custom_field", "")
                    stock_post_venta = item_data.get("available_quantity")
                else:
                    sku = ""
                    stock_post_venta = None
            except Exception:
                sku = ""
                stock_post_venta = None

            if not sku:
                print(
                    f"⚠️ [MELI-ORDER] Ítem {item_id} sin SKU — no se puede sincronizar stock."
                )
                continue

            if stock_post_venta is None:
                # Fallback: calcular desde WooCommerce si no se pudo leer MeLi
                from app.services.woocommerce import obtener_stock_woocommerce

                stock_post_venta = max(
                    0, obtener_stock_woocommerce(sku) - cantidad_vendida
                )
                print(
                    f"⚠️ [MELI-ORDER] Usando fallback WC para SKU {sku}: {stock_post_venta} uds"
                )

            # Sincronizar WooCommerce al nivel actual de MeLi (MeLi ya está actualizado)
            from app.services.woocommerce import actualizar_stock_woocommerce

            resultado_wc = actualizar_stock_woocommerce(sku, stock_post_venta)
            print(
                f"   └──> SKU {sku} | Stock MeLi post-venta: {stock_post_venta} | WC: {resultado_wc}"
            )

    except Exception as e:
        print(f"❌ [MELI-ORDER] Error procesando orden {order_id}: {e}")


_POSVENTA_STATE_PATH = os.path.join(
    "/home/mckg/mi-agente", "app", "data", "mensajes_posventa_pendientes.json"
)
_SELLER_ID = 432439187


def _cargar_state_posventa() -> dict:
    try:
        if os.path.exists(_POSVENTA_STATE_PATH):
            with open(_POSVENTA_STATE_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return {"pendientes": {}, "procesados": []}


def _guardar_state_posventa(data: dict):
    os.makedirs(os.path.dirname(_POSVENTA_STATE_PATH), exist_ok=True)
    with open(_POSVENTA_STATE_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _sufijo_pack(pack_id: str) -> str:
    """Últimos 4 dígitos del pack_id para comando corto."""
    digits = re.sub(r"\D", "", str(pack_id))
    return digits[-4:] if len(digits) >= 4 else digits


def _procesar_mensaje_posventa(resource: str):
    """
    Recibe notificación de mensaje postventa de MeLi.
    Si el mensaje es del comprador (no nuestro), alerta al grupo de WhatsApp
    con el comando de respuesta correcto: posventa <código>: <respuesta>

    Deduplicación por message_id (persistente en JSON), sin filtro por tiempo.
    """
    GRUPO = os.getenv("GRUPO_POSTVENTA_WA", "120363406693905719@g.us")
    try:
        token = refrescar_token_meli()
        if not token:
            return

        headers = {"Authorization": f"Bearer {token}"}

        # MeLi puede enviar el resource de dos formas:
        # 1. Como path: "/messages/packs/{pack_id}/sellers/{seller_id}"
        # 2. Como message_id directo: "019d52f0c31d7eb3b8f6437ac713c247"
        partes = resource.strip("/").split("/")
        pack_id = None
        for i, p in enumerate(partes):
            if p == "packs" and i + 1 < len(partes):
                pack_id = partes[i + 1]
                break

        if not pack_id:
            msg_id_directo = resource.strip("/")
            print(
                f"🔍 [POSVENTA] Resource sin pack_id explícito: '{msg_id_directo}'. Intentando resolver..."
            )

            for url_intento in [
                f"https://api.mercadolibre.com/{msg_id_directo}",
                f"https://api.mercadolibre.com/messages/{msg_id_directo}",
            ]:
                try:
                    res_msg = _requests_lib.get(
                        url_intento, headers=headers, timeout=10
                    )
                    print(f"   -> Intento {url_intento} -> {res_msg.status_code}")
                    if res_msg.status_code == 200:
                        msg_data = res_msg.json()
                        for mr in msg_data.get("message_resources", []):
                            if mr.get("name") in ("orders", "packs"):
                                pack_id = str(mr.get("id", ""))
                                break
                        if not pack_id:
                            pack_id = str(
                                msg_data.get("pack_id", "")
                                or msg_data.get("order_id", "")
                                or ""
                            )
                        if pack_id:
                            print(f"✅ [POSVENTA] pack_id resuelto: {pack_id}")
                            break
                except Exception as e_url:
                    print(f"   -> Error: {e_url}")

            if not pack_id:
                try:
                    print(
                        f"🔍 [POSVENTA] Buscando en órdenes recientes del vendedor..."
                    )
                    res_orders = _requests_lib.get(
                        f"https://api.mercadolibre.com/orders/search?seller={_SELLER_ID}&sort=date_desc&limit=10",
                        headers=headers,
                        timeout=10,
                    )
                    if res_orders.status_code == 200:
                        for orden in res_orders.json().get("results", []):
                            oid = str(orden.get("id", ""))
                            res_msgs = _requests_lib.get(
                                f"https://api.mercadolibre.com/messages/packs/{oid}/sellers/{_SELLER_ID}?tag=post_sale",
                                headers=headers,
                                timeout=8,
                            )
                            if res_msgs.status_code == 200:
                                msgs = res_msgs.json().get("messages", [])
                                for m in msgs:
                                    if str(m.get("id", "")) == msg_id_directo:
                                        pack_id = oid
                                        print(
                                            f"✅ [POSVENTA] pack_id encontrado por búsqueda: {pack_id}"
                                        )
                                        break
                            if pack_id:
                                break
                except Exception as e_search:
                    print(f"⚠️ [POSVENTA] Error buscando en órdenes: {e_search}")

            if not pack_id:
                print(
                    f"⚠️ [POSVENTA] No se pudo resolver pack_id para resource: {resource}"
                )
                return

        res = requests.get(
            f"https://api.mercadolibre.com/messages/packs/{pack_id}/sellers/{_SELLER_ID}?tag=post_sale",
            headers=headers,
            timeout=10,
        )
        if res.status_code != 200:
            print(
                f"⚠️ [POSVENTA] Error obteniendo mensajes del pack {pack_id}: {res.status_code}"
            )
            return

        state = _cargar_state_posventa()
        procesados = set(state.get("procesados", []))

        mensajes = res.json().get("messages", [])
        nuevos = 0
        for msg in mensajes:
            from_id = str(msg.get("from", {}).get("user_id", ""))
            if from_id == str(_SELLER_ID):
                continue  # Mensaje nuestro, ignorar

            msg_id = str(msg.get("id", ""))
            if not msg_id or msg_id in procesados:
                continue  # Ya notificado

            texto = msg.get("text", "").strip()
            if not texto:
                continue

            nombre_comprador = msg.get("from", {}).get("name", f"Comprador {from_id}")
            sufijo = _sufijo_pack(pack_id)

            print(
                f"📨 [POSVENTA] Nuevo mensaje de {nombre_comprador} en pack {pack_id}: {texto[:60]}"
            )

            # Obtener productos de la orden para contexto
            productos_str = ""
            try:
                r_ord = requests.get(
                    f"https://api.mercadolibre.com/orders/{pack_id}",
                    headers=headers,
                    timeout=8,
                )
                if r_ord.status_code == 200:
                    prods = [
                        i.get("item", {}).get("title", "")
                        for i in r_ord.json().get("order_items", [])
                        if i.get("item", {}).get("title")
                    ]
                    if prods:
                        productos_str = "\n".join(f"  • {p}" for p in prods)
            except Exception:
                pass

            # Guardar en cola de pendientes
            state["pendientes"][sufijo] = {
                "pack_id": pack_id,
                "comprador": nombre_comprador,
                "from_id": from_id,
                "texto": texto,
                "msg_id": msg_id,
                "productos": productos_str,
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
            }
            procesados.add(msg_id)

            notif = (
                f"💬 *MENSAJE POSTVENTA MELI*\n\n"
                f"📦 *Pack:* `{pack_id}`  _(código: *{sufijo}*)_\n"
                f"👤 *Comprador:* {nombre_comprador}\n"
            )
            if productos_str:
                notif += f"🛍 *Productos:*\n{productos_str}\n"
            notif += (
                f"🗣 *Mensaje:* {texto}\n\n"
                f"Para responder escribe en el grupo:\n"
                f"*posventa {sufijo}: tu respuesta aquí*"
            )
            enviar_whatsapp_reporte(notif, numero_destino=GRUPO)
            try:
                incrementar_metrica("mensajes_posventa")
            except Exception:
                pass
            nuevos += 1

        # Limpiar procesados: guardar solo los últimos 500 para no crecer indefinidamente
        state["procesados"] = list(procesados)[-500:]
        _guardar_state_posventa(state)

        if nuevos:
            print(f"✅ [POSVENTA] {nuevos} mensaje(s) nuevos notificados al grupo.")

    except Exception as e:
        print(f"❌ [POSVENTA] Error procesando mensaje: {e}")


def register_routes(app):
    @app.route("/notifications", methods=["POST"])
    def notifications():
        """Recibe la notificación y responde 'OK' de inmediato a MeLi."""
        data = request.get_json()

        topic = data.get("topic") if data else None

        if topic == "questions":
            resource = data.get("resource")
            if resource:
                question_id = resource.split("/")[-1]

                # Limpiar memoria antigua
                limpiar_preguntas_antiguas()

                # Verificar deduplicación
                if question_id in preguntas_procesadas:
                    print(f"Pregunta {question_id} ya procesada. Omitiendo duplicado.")
                else:
                    preguntas_procesadas[question_id] = time.time()
                    hilo = threading.Thread(
                        target=procesar_nueva_pregunta, args=(question_id,)
                    )
                    hilo.start()
                    try:
                        incrementar_metrica("preguntas_meli")
                    except Exception:
                        pass

        elif topic == "orders_v2":
            resource = data.get("resource", "")
            if resource:
                order_id = resource.split("/")[-1]
                print(f"🛒 [MELI] Nueva notificación de orden: {order_id}")
                hilo = threading.Thread(target=_procesar_orden_meli, args=(order_id,))
                hilo.start()
                try:
                    incrementar_metrica("ordenes_meli")
                except Exception:
                    pass

        elif topic == "messages":
            resource = data.get("resource", "")
            print(
                f"📩 [MELI-MSG] Notificación messages recibida. Resource: '{resource}' | Payload: {json.dumps(data, default=str)[:500]}"
            )
            if resource:
                hilo = threading.Thread(
                    target=_procesar_mensaje_posventa, args=(resource,), daemon=True
                )
                hilo.start()

        # Respondemos 200 OK inmediatamente
        return jsonify({"status": "ok"}), 200

    """
    Registra todas las rutas de la aplicación en la instancia de Flask.
    Esto sigue el patrón de "Application Factory" para una mejor organización.
    """

    @app.route("/whatsapp", methods=["POST"])
    def whatsapp_endpoint():
        """
        Endpoint principal que recibe los webhooks de WhatsApp.
        Procesa los mensajes, gestiona un flujo de aprobación para posventa y responde.
        """
        data = request.json
        if not data:
            return jsonify(
                {
                    "status": "error",
                    "respuesta": "Request inválido, no se recibió JSON.",
                }
            ), 400

        try:
            from app.monitor import incrementar_metrica

            incrementar_metrica("mensajes_whatsapp")
        except Exception:
            pass

        sender_id = data.get("sender", "desconocido")
        message_text = data.get("mensaje", "").strip()
        is_after_sale = data.get("es_postventa", False)
        order_id = data.get("order_id", sender_id)

        # Adaptación para aceptar hasMedia o has_media según venga del node o de otro lado
        has_media = data.get("hasMedia", data.get("has_media", False))
        media_type = data.get("mediaType", data.get("media_type", ""))
        media_path = data.get("mediaPath", "")
        es_grupo_contabilidad = data.get("es_grupo_contabilidad", False)

        # IDs de los grupos por área
        grupo_compras = os.getenv(
            "GRUPO_FACTURACION_COMPRAS_WA", "120363408323873426@g.us"
        )
        grupo_preventa = os.getenv("GRUPO_PREVENTA_WA", "120363393955474672@g.us")
        grupo_posventa = os.getenv("GRUPO_POSTVENTA_WA", "120363406693905719@g.us")
        grupo_inventario = os.getenv("GRUPO_INVENTARIO_WA", "120363407538342427@g.us")

        # Detectar de qué grupo proviene el mensaje (por flag explícito o por remoteJid/sender)
        remote_jid = data.get("remoteJid") or data.get("grupo_id", "")
        if not remote_jid and "@g.us" in sender_id:
            remote_jid = sender_id

        es_grupo_compras = es_grupo_contabilidad or remote_jid == grupo_compras
        es_grupo_preventa_cmd = remote_jid == grupo_preventa
        es_grupo_posventa_cmd = remote_jid == grupo_posventa
        es_any_grupo_admin = (
            es_grupo_compras or es_grupo_preventa_cmd or es_grupo_posventa_cmd
        )

        # Alias para compatibilidad con código existente
        grupo_contabilidad = grupo_compras

        # --- COMANDOS DE GRUPOS ADMIN ---
        if es_any_grupo_admin:
            modos = cargar_modos_atencion()
            msg_lower = message_text.lower()

            # Rechazo corto: "no 463"
            if re.match(r"^no\s+\d{3}$", msg_lower):
                sufijo = msg_lower.split()[1]
                target_num = _buscar_pago_por_sufijo(sufijo)
                if target_num:
                    pagos_pendientes_confirmacion.pop(target_num, None)
                    borradores_aprobacion.pop(target_num, None)
                    threading.Thread(
                        target=enviar_whatsapp_reporte,
                        args=(
                            "Hola, ha habido un problema con la validación de tu pago. Por favor rectifica y revisa por qué la transacción no ha sido recibida.",
                            target_num,
                        ),
                    ).start()
                    threading.Thread(
                        target=enviar_whatsapp_reporte,
                        args=(
                            f"❌ Pago rechazado para ...{sufijo}",
                            grupo_contabilidad,
                        ),
                    ).start()
                else:
                    threading.Thread(
                        target=enviar_whatsapp_reporte,
                        args=(
                            f"⚠️ No encontré pago pendiente con código {sufijo}.",
                            grupo_contabilidad,
                        ),
                    ).start()
                return jsonify({"status": "ok", "respuesta": None})

            # Formato corto: "ok 463" (últimos 3 dígitos del número)
            if re.match(r"^ok\s+\d{3}$", msg_lower):
                sufijo = msg_lower.split()[1]
                target_num = _buscar_pago_por_sufijo(sufijo)
                if target_num:
                    threading.Thread(
                        target=procesar_confirmacion_pago_async, args=(target_num,)
                    ).start()
                    threading.Thread(
                        target=enviar_whatsapp_reporte,
                        args=(
                            f"✅ Pago confirmado al cliente ...{sufijo}",
                            grupo_contabilidad,
                        ),
                    ).start()
                else:
                    threading.Thread(
                        target=enviar_whatsapp_reporte,
                        args=(
                            f"⚠️ No encontré pago pendiente con código {sufijo}.",
                            grupo_contabilidad,
                        ),
                    ).start()
                return jsonify({"status": "ok", "respuesta": None})

            if msg_lower.startswith("ok confirmado"):
                partes = message_text.split(" ", 2)
                if len(partes) >= 3 and partes[2].strip():
                    # Formato completo: "ok confirmado {numero}"
                    target_num = partes[2].strip()
                else:
                    # Sin número: buscar el único pago pendiente
                    pendientes = [
                        k
                        for k, v in pagos_pendientes_confirmacion.items()
                        if not v.get("confirmado")
                    ]
                    if len(pendientes) == 1:
                        target_num = pendientes[0]
                    else:
                        cantidad = len(pendientes)
                        msg_error = (
                            f"⚠️ Hay {cantidad} pagos pendientes. Usa: ok <últimos 3 dígitos>"
                            if cantidad > 1
                            else "⚠️ No hay pagos pendientes por confirmar."
                        )
                        threading.Thread(
                            target=enviar_whatsapp_reporte,
                            args=(msg_error, grupo_contabilidad),
                        ).start()
                        return jsonify({"status": "ok", "respuesta": None})
                threading.Thread(
                    target=procesar_confirmacion_pago_async, args=(target_num,)
                ).start()
                threading.Thread(
                    target=enviar_whatsapp_reporte,
                    args=(
                        f"✅ Confirmación enviada al cliente {target_num}",
                        grupo_contabilidad,
                    ),
                ).start()
                return jsonify({"status": "ok", "respuesta": None})

            # "OK" o "ok" a solas → aprueba factura de compra pendiente (si la hay)
            elif msg_lower.strip() == "ok":
                from app import shared_state

                if shared_state.eventos_aprobacion_facturas:
                    factura_key = next(iter(shared_state.eventos_aprobacion_facturas))
                    entrada = shared_state.eventos_aprobacion_facturas.get(factura_key)
                    if entrada:
                        entrada["aprobado"] = True
                        entrada["event"].set()
                        threading.Thread(
                            target=enviar_whatsapp_reporte,
                            args=(
                                f"✅ Factura *{factura_key}* aprobada. Creando en SIIGO...",
                                grupo_contabilidad,
                            ),
                        ).start()
                else:
                    threading.Thread(
                        target=enviar_whatsapp_reporte,
                        args=(
                            "⚠️ No hay facturas pendientes de aprobación en este momento.",
                            grupo_contabilidad,
                        ),
                    ).start()
                return jsonify({"status": "ok", "respuesta": None})

            elif msg_lower.startswith("pausar "):
                target_num = message_text.split(" ", 1)[1].strip()
                if target_num not in modos["numeros_en_humano"]:
                    modos["numeros_en_humano"].append(target_num)
                    guardar_modos_atencion(modos)
                threading.Thread(
                    target=enviar_whatsapp_reporte,
                    args=(
                        "En este momento te va a atender Jennifer García del área de ventas 🙏",
                        target_num,
                    ),
                ).start()
                return jsonify({"status": "ok", "respuesta": None})

            elif msg_lower.startswith("activar "):
                target_num = message_text.split(" ", 1)[1].strip()
                if target_num in modos["numeros_en_humano"]:
                    modos["numeros_en_humano"].remove(target_num)
                    guardar_modos_atencion(modos)
                threading.Thread(
                    target=enviar_whatsapp_reporte,
                    args=(
                        "Hola veci, soy Hugo García nuevamente, ¿en qué le puedo ayudar?",
                        target_num,
                    ),
                ).start()
                return jsonify({"status": "ok", "respuesta": None})

            # ── Comandos de facturas de compra: inv ok/skip/inventario/gasto/lista ──
            elif msg_lower.startswith("inv "):

                def _manejar_inv(texto):
                    from app.tools.importar_productos_siigo import (
                        procesar_respuesta_factura_compra,
                        listar_facturas_pendientes,
                    )

                    partes = texto.split()
                    if len(partes) >= 2 and partes[1].lower() == "lista":
                        resultado = listar_facturas_pendientes()
                    elif len(partes) >= 3:
                        cmd = partes[1].lower()  # ok | skip | inventario | gasto
                        sufijo = partes[2].upper()
                        resultado = procesar_respuesta_factura_compra(cmd, sufijo)
                    else:
                        resultado = (
                            "⚠️ Formato inválido. Comandos disponibles:\n"
                            "  *inv ok <código>*          → procesar (proveedor conocido)\n"
                            "  *inv skip <código>*        → omitir factura\n"
                            "  *inv inventario <código>*  → clasificar como materia prima\n"
                            "  *inv gasto <código>*       → clasificar como gasto/consumible\n"
                            "  *inv lista*                → ver facturas pendientes"
                        )
                    enviar_whatsapp_reporte(
                        resultado, numero_destino=grupo_contabilidad
                    )

                threading.Thread(target=_manejar_inv, args=(message_text,)).start()
                return jsonify({"status": "ok", "respuesta": None})

            # ── Respuesta a mensajes postventa MeLi: posventa <código>: <texto> ──
            elif msg_lower.startswith("posventa "):

                def _manejar_posventa(texto_cmd):
                    m = re.match(
                        r"^posventa\s+(\S+):\s*(.+)",
                        texto_cmd.strip(),
                        re.IGNORECASE | re.DOTALL,
                    )
                    if not m:
                        enviar_whatsapp_reporte(
                            "⚠️ Formato: *posventa <código>: tu respuesta*\n"
                            "Ejemplo: posventa 3240: Hola, su pedido ya fue despachado.",
                            numero_destino=grupo_posventa,
                        )
                        return

                    sufijo = m.group(1).strip()
                    respuesta = m.group(2).strip()

                    # Buscar pack_id en la cola de pendientes
                    import time as _time

                    state_path = "/home/mckg/mi-agente/app/data/mensajes_posventa_pendientes.json"
                    pack_id = None
                    comprador = ""
                    try:
                        with open(state_path, "r", encoding="utf-8") as _f:
                            _state = json.load(_f)
                        pendientes = _state.get("pendientes", {})
                        # Buscar por sufijo exacto o parcial
                        sufijo_up = sufijo.upper()
                        entrada = pendientes.get(sufijo_up)
                        if not entrada:
                            for k, v in pendientes.items():
                                if k.endswith(sufijo_up) or sufijo_up.endswith(k):
                                    entrada = v
                                    sufijo_up = k
                                    break
                        if entrada:
                            pack_id = entrada["pack_id"]
                            comprador = entrada.get("comprador", "")
                    except Exception as _e:
                        print(f"⚠️ [POSVENTA-CMD] Error leyendo state: {_e}")

                    if not pack_id:
                        # Intentar usar el sufijo directamente como pack_id completo
                        if sufijo.isdigit() and len(sufijo) > 8:
                            pack_id = sufijo
                        else:
                            enviar_whatsapp_reporte(
                                f"⚠️ No encontré mensaje postventa pendiente con código *{sufijo}*.\n"
                                f"Verifica el código en la alerta original o responde directo en MeLi.",
                                numero_destino=grupo_posventa,
                            )
                            return

                    from modulo_posventa import responder_mensaje_posventa

                    exito = responder_mensaje_posventa(pack_id, respuesta)

                    if exito:
                        # Quitar de pendientes
                        try:
                            with open(state_path, "r", encoding="utf-8") as _f:
                                _state = json.load(_f)
                            _state.get("pendientes", {}).pop(
                                sufijo_up if "sufijo_up" in dir() else sufijo, None
                            )
                            with open(state_path, "w", encoding="utf-8") as _f:
                                json.dump(_state, _f, indent=2, ensure_ascii=False)
                        except Exception:
                            pass
                        enviar_whatsapp_reporte(
                            f"✅ *Respuesta postventa enviada*\n"
                            f"👤 Comprador: {comprador or pack_id}\n"
                            f"📦 Pack: {pack_id}\n"
                            f"💬 Respuesta: {respuesta[:120]}{'…' if len(respuesta) > 120 else ''}",
                            numero_destino=grupo_posventa,
                        )
                    else:
                        enviar_whatsapp_reporte(
                            f"❌ *Error enviando respuesta postventa* al pack {pack_id}.\n"
                            f"Intenta responder directamente en MeLi.",
                            numero_destino=grupo_posventa,
                        )

                threading.Thread(target=_manejar_posventa, args=(message_text,)).start()
                return jsonify({"status": "ok", "respuesta": None})

            elif msg_lower.startswith("resp preventa "):
                print(f"📨 Comando preventa recibido del grupo: {message_text[:120]}")
                question_id, respuesta_humana = detectar_comando_preventa(message_text)
                print(
                    f"🔍 Detectado — ID: {question_id} | Respuesta: {str(respuesta_humana)[:60]}"
                )
                if question_id and respuesta_humana:
                    threading.Thread(
                        target=_procesar_respuesta_preventa,
                        args=(question_id, respuesta_humana),
                    ).start()
                else:
                    threading.Thread(
                        target=enviar_whatsapp_reporte,
                        args=(
                            "⚠️ Formato inválido. Escribe así (sin llaves):\n"
                            f"resp preventa {question_id or '<ID>'}: tu respuesta va aquí",
                            grupo_preventa,
                        ),
                    ).start()
                return jsonify({"status": "ok", "respuesta": None})

            elif msg_lower.startswith("resp "):
                # Intentar primero como comando preventa (formato corto: resp 497: ...)
                question_id, respuesta_humana = detectar_comando_preventa(message_text)
                if question_id and respuesta_humana:
                    print(
                        f"📨 Preventa (formato corto) — ID: {question_id} | Resp: {respuesta_humana[:60]}"
                    )
                    threading.Thread(
                        target=_procesar_respuesta_preventa,
                        args=(question_id, respuesta_humana),
                    ).start()
                    return jsonify({"status": "ok", "respuesta": None})

                # Si no es preventa, tratar como respuesta directa: resp <numero>: <mensaje>
                partes = message_text.split(" ", 1)[1].split(":", 1)
                if len(partes) == 2 and partes[1].strip():
                    target_num = partes[0].strip()
                    resp_msg = partes[1].strip()
                    threading.Thread(
                        target=enviar_whatsapp_reporte, args=(resp_msg, target_num)
                    ).start()
                    return jsonify({"status": "ok", "respuesta": None})
                # Sin mensaje o sin formato completo → ignorar silenciosamente

            return jsonify({"status": "ok", "respuesta": None})

        # --- SWITCH IA/HUMANO ---
        if not es_any_grupo_admin:
            modos = cargar_modos_atencion()
            if sender_id in modos["numeros_en_humano"]:
                # Reenviar al grupo de compras (atención general) y no procesar IA
                mensaje_reenvio = f"💬 CLIENTE {sender_id}: {message_text}"
                threading.Thread(
                    target=enviar_whatsapp_reporte,
                    args=(mensaje_reenvio, grupo_compras),
                ).start()
                return jsonify({"status": "human_mode", "respuesta": None})

        # --- Flujo de Aprobación para Comprobantes de Pago (legacy) ---
        if message_text.lower().startswith("pago no"):
            target_sender = message_text.split()[-1]
            if target_sender in borradores_aprobacion:
                borradores_aprobacion.pop(target_sender)
                return jsonify(
                    {
                        "status": "success",
                        "respuesta": f"Hola, ha habido un problema con la validación de tu pago. Por favor rectifica y revisa por qué la transacción no ha sido recibida.",
                    }
                )
            else:
                return jsonify(
                    {
                        "status": "error",
                        "respuesta": f"No encontré un comprobante pendiente para el número '{target_sender}'.",
                    }
                )

        # --- Notas de Voz: transcripción con Whisper ----------------------
        message_id = data.get("messageId", data.get("message_id", ""))
        if has_media and media_type in ("audio", "ptt", "voice"):
            transcripcion = transcribir_audio_whatsapp(media_path, message_id)
            if transcripcion:
                print(f"🎙 Whisper transcribió: {transcripcion[:80]}...")
                message_text = transcripcion
            else:
                return jsonify(
                    {
                        "status": "ok",
                        "respuesta": "Veci, recibí tu nota de voz pero no pude escucharla bien. ¿Puedes escribirme tu consulta? 🙏",
                    }
                )

        # --- Detección de Comprobantes de Pago ---
        keywords_pago_sin_img = [
            "soporte",
            "comprobante",
            "transferí",
            "consigné",
            "ya pagué",
            "ya transferí",
            "mira el soporte",
            "ahí te envié",
            "te mando el soporte",
        ]
        keywords_pago_ignorar = [
            "y al nequi?",
            "cómo pago",
            "forma de pago",
            "cuánto es",
            "datos de pago",
        ]

        is_payment_keyword_sin_img = any(
            keyword in message_text.lower() for keyword in keywords_pago_sin_img
        )
        is_ignored_keyword = any(
            keyword in message_text.lower() for keyword in keywords_pago_ignorar
        )

        if has_media and media_type == "image":
            borradores_aprobacion[sender_id] = {
                "estado": "esperando_validacion_pago",
                "ruta_imagen": media_path,
            }

            codigo = _sufijo_pago(sender_id)
            num_corto = sender_id.replace("@c.us", "")[
                -7:
            ]  # últimos 7 dígitos para mostrar
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

            threading.Thread(
                target=enviar_whatsapp_reporte, args=(mensaje_aprobacion, grupo_compras)
            ).start()

            return jsonify(
                {
                    "status": "waiting_for_payment_approval",
                    "respuesta": "Veci, recibí su comprobante. En un momento nuestro equipo de contabilidad lo verifica y le confirmamos. ¡Gracias por su compra!",
                }
            )

        elif is_payment_keyword_sin_img and not is_ignored_keyword and not has_media:
            return jsonify(
                {
                    "status": "missing_image",
                    "respuesta": "Veci, parece que el mensaje llegó sin la imagen adjunta. ¿Puede intentar enviarla de nuevo? 📎",
                }
            )

        # --- Flujo de Aprobación para Mensajes de Posventa ---
        if message_text.lower().startswith("hugo dale ok"):
            target_order_id = message_text.split()[-1]
            if target_order_id in borradores_aprobacion:
                message_to_send = borradores_aprobacion.pop(target_order_id)

                # Delegar el envío real a la función correspondiente.
                resultado_envio = responder_mensaje_posventa(
                    target_order_id, message_to_send
                )
                print(f"Resultado del envío a posventa: {resultado_envio}")

                return jsonify(
                    {
                        "status": "sent",
                        "respuesta": f"¡Listo! Mensaje enviado para la orden {target_order_id}.",
                    }
                )
            else:
                return jsonify(
                    {
                        "status": "error",
                        "respuesta": f"No encontré un borrador pendiente de aprobación para la orden '{target_order_id}'.",
                    }
                )

        # --- Control para Evitar Duplicados ---
        if is_after_sale and order_id in borradores_aprobacion:
            return jsonify(
                {
                    "status": "already_waiting",
                    "respuesta": f"Ya existe una respuesta pendiente de aprobación para la orden {order_id}.",
                }
            )

        # --- Escalación al Grupo ---
        keywords_escalacion = [
            "quiero hablar con una persona",
            "hablar con alguien",
            "asesor",
            "agente humano",
            "devolución",
            "reclamo",
            "garantía",
            "descuento",
            "precio especial",
            "más barato",
            "mas barato",
        ]
        if any(keyword in message_text.lower() for keyword in keywords_escalacion):
            mensaje_aprobacion = (
                f"❓ CONSULTA IA - Cliente {sender_id} preguntó: {message_text}\n"
                f"Responder con: 'resp {sender_id}: {{respuesta}}'"
            )
            enviar_whatsapp_reporte(
                mensaje_aprobacion, numero_destino=grupo_contabilidad
            )
            return jsonify(
                {
                    "status": "escalated",
                    "respuesta": "Veci, déjame consultar esa información con mi equipo y le confirmo en un momento 🙏",
                }
            )

        # --- Procesamiento del Mensaje por la IA ---
        respuesta_ia, _ = obtener_respuesta_ia(message_text, sender_id)

        incertidumbre_ia = ["no tengo información", "no puedo", "no estoy seguro"]
        if any(frase in respuesta_ia.lower() for frase in incertidumbre_ia):
            mensaje_aprobacion = (
                f"❓ CONSULTA IA - Cliente {sender_id} preguntó: {message_text}\n"
                f"Responder con: 'resp {sender_id}: {{respuesta}}'"
            )
            enviar_whatsapp_reporte(
                mensaje_aprobacion, numero_destino=grupo_contabilidad
            )
            return jsonify(
                {
                    "status": "escalated",
                    "respuesta": "Veci, déjame consultar esa información con mi equipo y le confirmo en un momento 🙏",
                }
            )

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
            enviar_whatsapp_reporte(mensaje_aprobacion, numero_destino=grupo_posventa)

            return jsonify(
                {
                    "status": "waiting_for_approval",
                    "respuesta": "La respuesta del agente ha sido generada y está pendiente de aprobación.",
                }
            )
        else:
            # Si es un chat normal, respondemos directamente.
            return jsonify({"status": "success", "respuesta": respuesta_ia})

    @app.route("/status", methods=["GET"])
    def status():
        import os
        from datetime import datetime

        return jsonify(
            {
                "estado": "activo",
                "timestamp": datetime.now().isoformat(),
                "servicios": {
                    "mercadolibre": os.path.exists("credenciales_meli.json"),
                    "google": os.path.exists("credenciales_google.json"),
                    "siigo": os.path.exists("credenciales_SIIGO.json"),
                },
                "version": "1.0.0",
            }
        )

    @app.route("/chat", methods=["POST"])
    def chat():
        import os
        from datetime import datetime

        token = request.headers.get("Authorization", "").replace("Bearer ", "")
        if token != os.getenv("CHAT_API_TOKEN", ""):
            return jsonify({"error": "No autorizado"}), 401
        data = request.get_json()
        if not data or "mensaje" not in data:
            return jsonify({"error": "Campo 'mensaje' requerido"}), 400
        try:
            respuesta, _ = obtener_respuesta_ia(data["mensaje"], "usuario_api")
            return jsonify(
                {
                    "respuesta": respuesta,
                    "timestamp": datetime.now().isoformat(),
                    "status": "ok",
                }
            )
        except Exception as e:
            return jsonify({"error": str(e), "status": "error"}), 500

    @app.route("/panel")
    def panel():
        import json as _json
        from app.services.meli_preventa import obtener_preguntas_pendientes

        # Métricas del día
        metricas = {}
        try:
            with open("app/data/metricas_diarias.json") as f:
                metricas = _json.load(f)
        except Exception:
            pass

        # Preguntas preventa pendientes
        preguntas = []
        try:
            preguntas = [
                p for p in obtener_preguntas_pendientes() if not p.get("respondida")
            ]
        except Exception:
            pass

        # Casos IA aprendidos
        casos_ia = 0
        try:
            with open("app/training/casos_preventa.json") as f:
                casos_ia = len(_json.load(f).get("casos", []))
        except Exception:
            pass

        # Tasa automatización preventa (respondidas automáticamente vs total)
        tasa_preventa = 0
        try:
            with open("app/data/preguntas_pendientes_preventa.json") as f:
                todas = _json.load(f).get("preguntas", [])
            respondidas_auto = sum(
                1
                for p in todas
                if p.get("respondida") and not p.get("respuesta_humana")
            )
            total_preg = len(todas)
            tasa_preventa = (
                round((respondidas_auto / total_preg) * 100) if total_preg > 0 else 0
            )
        except Exception:
            pass

        integraciones = [
            ("Gemini 2.5-Pro", "🤖", "Motor IA conversacional"),
            ("MercadoLibre", "🛒", "Preventa · Posventa · Stock"),
            ("SIIGO ERP", "📊", "Facturación electrónica DIAN"),
            ("WooCommerce", "🛍️", "mckennagroup.co"),
            ("Google Sheets", "📋", "Catálogo y fichas técnicas"),
            ("Gmail API", "📧", "Facturas de proveedores"),
            ("WhatsApp WA", "💬", "Evolution API · Node.js"),
            ("Cloudflare", "☁️", "Túnel HTTPS seguro"),
        ]

        return render_template(
            "panel.html",
            metricas=metricas,
            preguntas_pendientes=preguntas,
            casos_ia=casos_ia,
            tasa_preventa=tasa_preventa,
            uptime="99.8%",
            integraciones=integraciones,
            facturas=[],
            log_actividad=[],
        )

    @app.route("/api/metricas")
    def api_metricas():
        import json as _json

        try:
            with open("app/data/metricas_diarias.json") as f:
                data = _json.load(f)
            # Verificar token MeLi
            try:
                from app.utils import refrescar_token_meli

                data["token_meli"] = bool(refrescar_token_meli())
            except Exception:
                data["token_meli"] = False
            return jsonify(data)
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/responder-preventa", methods=["POST"])
    def api_responder_preventa():
        data = request.get_json()
        question_id = str(data.get("question_id", ""))
        respuesta = data.get("respuesta", "").strip()
        if not question_id or not respuesta:
            return jsonify({"ok": False, "error": "Faltan campos"}), 400
        import threading as _th

        _th.Thread(
            target=_procesar_respuesta_preventa,
            args=(question_id, respuesta),
            daemon=True,
        ).start()
        return jsonify({"ok": True})

    def _procesar_webhook_woocommerce(payload: dict):
        """
        Procesa en hilo secundario un webhook de WooCommerce.
        Para order.created/updated: WooCommerce ya decrementó su propio stock.
        Leemos el stock post-venta de WC y lo propagamos a MeLi.
        """
        try:
            line_items = payload.get("line_items", [])
            if not line_items:
                print("⚠️ [WC-WEBHOOK] Orden sin line_items — ignorada.")
                return

            order_id = payload.get("id", "desconocido")
            print(
                f"🛒 [WC-WEBHOOK] Procesando orden WooCommerce #{order_id} ({len(line_items)} ítem(s))..."
            )

            from app.services.woocommerce import obtener_stock_woocommerce
            from app.services.meli import actualizar_stock_meli

            for item in line_items:
                sku = item.get("sku", "").strip()
                cantidad = int(item.get("quantity", 0))

                if not sku or cantidad <= 0:
                    print(
                        f"⚠️ [WC-WEBHOOK] Ítem sin SKU o cantidad inválida: {item.get('name')}"
                    )
                    continue

                # WC ya decrementó su stock al procesar la orden.
                # Usamos ese valor post-venta como fuente de verdad para sincronizar MeLi.
                stock_post_venta = obtener_stock_woocommerce(sku)
                resultado_meli = actualizar_stock_meli(sku, stock_post_venta)
                print(
                    f"   └──> SKU {sku} | -{cantidad} uds en WC | Stock post-venta: {stock_post_venta} | MeLi: {resultado_meli}"
                )

        except Exception as e:
            print(f"❌ [WC-WEBHOOK] Error procesando webhook de WooCommerce: {e}")

    @app.route("/woocommerce", methods=["POST"])
    def woocommerce_webhook():
        """
        Endpoint que recibe los webhooks enviados por WooCommerce.
        Verifica la firma HMAC-SHA256, responde 200 OK de inmediato
        y procesa la lógica en un hilo secundario.
        """
        # Verificación de firma (si hay secreto configurado)
        wc_secret = os.getenv("WC_WEBHOOK_SECRET", "")
        if wc_secret:
            sig_header = request.headers.get("X-WC-Webhook-Signature", "")
            payload_bytes = request.get_data()
            firma_esperada = base64.b64encode(
                hmac.new(
                    wc_secret.encode("utf-8"), payload_bytes, hashlib.sha256
                ).digest()
            ).decode("utf-8")
            if not hmac.compare_digest(sig_header, firma_esperada):
                print(f"⚠️ [WC-WEBHOOK] Firma inválida — request rechazado.")
                return jsonify({"status": "unauthorized"}), 401

        payload = request.json or {}
        evento = request.headers.get("X-WC-Webhook-Topic", payload.get("_topic", ""))

        print(
            f"📨 [WC-WEBHOOK] Evento recibido: '{evento}' | Orden: {payload.get('id', 'N/A')}"
        )

        if evento in ("order.created", "order.updated"):
            status = payload.get("status", "")
            if status in ("processing", "completed"):
                threading.Thread(
                    target=_procesar_webhook_woocommerce, args=(payload,), daemon=True
                ).start()
            else:
                print(f"⏭️ [WC-WEBHOOK] Orden con estado '{status}' — ignorada.")

        return jsonify({"status": "ok"}), 200

    # ── Guías de productos (HTML standalone, sin wrapper del tema) ────────────
    _GUIAS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "PAGINA_WEB")

    @app.route("/guia/<nombre_guia>")
    def servir_guia(nombre_guia):
        """
        Sirve archivos HTML de guías de productos desde PAGINA_WEB/.
        URL: /guia/kit-acidos  → PAGINA_WEB/guia-kit-acidos.html
        """
        from flask import send_from_directory, abort

        # Sanitizar: solo letras, números, guiones
        import re as _re

        if not _re.match(r"^[a-zA-Z0-9\-]+$", nombre_guia):
            abort(404)
        nombre_archivo = f"guia-{nombre_guia}.html"
        ruta_completa = os.path.join(_GUIAS_DIR, nombre_archivo)
        if not os.path.isfile(ruta_completa):
            abort(404)
        return send_from_directory(_GUIAS_DIR, nombre_archivo)
