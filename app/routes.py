from flask import request, jsonify, render_template
import os
import json
import re
import hmac
import hashlib
import base64
import tempfile
import requests as _requests_lib

_ROUTES_DIR = os.path.dirname(os.path.abspath(__file__))
PENDIENTES_PATH = os.path.join(_ROUTES_DIR, "data", "preguntas_pendientes_preventa.json")


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
from app.utils import (
    enviar_whatsapp_reporte,
    jid_grupo_preventa_wa,
    jid_grupo_postventa_wa,
    meli_postventa_id_mensaje,
    meli_postventa_texto_para_notif,
)


def _jid_limpio(s: str) -> str:
    if not s:
        return ""
    return s.split("#")[0].strip()


def _grupos_web_pedido_cmd() -> set[str]:
    """Solo el grupo de pedidos web (Guias_Envios pagina web). Ver app/data/grupos_whatsapp_oficiales.json.

    Opcional: GRUPOS_WEB_PEDIDO_CMD_WA=coma,separada (solo si en el futuro se requiere más de un JID).
    """
    raw = os.getenv("GRUPOS_WEB_PEDIDO_CMD_WA", "").strip()
    if raw:
        return {j for p in raw.split(",") if (j := _jid_limpio(p))}
    solo = _jid_limpio(
        os.getenv("GRUPO_PEDIDOS_WEB_WA", "120363391665421264@g.us")
    )
    return {solo} if solo else set()


def _remote_es_grupo_web_pedido(remote_jid: str) -> bool:
    return _jid_limpio(remote_jid) in _grupos_web_pedido_cmd()


def _normalizar_texto_comando_wa(texto: str) -> str:
    """Quita negritas/cursivas típicas de WhatsApp y colapsa espacios."""
    t = (texto or "").strip()
    t = re.sub(r"[*_~`]+", "", t)
    t = " ".join(t.split())
    return t.strip()


def _token_tras_facturar(texto: str) -> str | None:
    t = _normalizar_texto_comando_wa(texto)
    m = re.search(r"\bfacturar\s+(\S+)", t, re.IGNORECASE)
    return m.group(1).strip() if m else None


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
                numero_destino=jid_grupo_preventa_wa(),
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
        grupo_prev = jid_grupo_preventa_wa()
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

from app.observability import bind_flask_request, log_json, spawn_thread

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
                print(
                    f"⚠️ [MELI-ORDER] No se pudo obtener el stock post-venta para el SKU {sku}"
                )
                continue

            # Aquí iría la nueva lógica para sincronizar con la página web
            print(f"   └──> SKU {sku} | Stock MeLi post-venta: {stock_post_venta}")

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
    GRUPO = jid_grupo_postventa_wa()
    try:
        from app.monitor import incrementar_metrica

        token = refrescar_token_meli()
        if not token:
            return

        headers = {"Authorization": f"Bearer {token}", "x-version": "2"}

        # MeLi puede enviar el resource de dos formas:
        # 1. Como path: "/messages/packs/{pack_id}/sellers/{seller_id}"
        # 2. Como message_id directo: "019d52f0c31d7eb3b8f6437ac713c247"
        partes = resource.strip("/").split("/")
        pack_id = None
        for i, p in enumerate(partes):
            if p == "packs" and i + 1 < len(partes):
                pack_id = partes[i + 1]
                break

        if not pack_id and partes and partes[0] == "orders" and len(partes) >= 2:
            pack_id = partes[1]

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

        res = _requests_lib.get(
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

            msg_id = meli_postventa_id_mensaje(msg)
            if not msg_id or msg_id in procesados:
                continue  # Ya notificado

            texto = meli_postventa_texto_para_notif(msg)
            if not texto:
                print(
                    f"⏭️ [POSVENTA] Mensaje {msg_id} sin texto ni adjuntos reconocibles, omitiendo"
                )
                continue

            nombre_comprador = msg.get("from", {}).get("name", f"Comprador {from_id}")
            sufijo = _sufijo_pack(pack_id)

            print(
                f"📨 [POSVENTA] Nuevo mensaje de {nombre_comprador} en pack {pack_id}: {texto[:60]}"
            )

            # Obtener productos de la orden para contexto
            productos_str = ""
            try:
                r_ord = _requests_lib.get(
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
    @app.before_request
    def _mckenna_bind_request_id():
        bind_flask_request(request)

    @app.route("/notifications", methods=["POST"])
    def notifications():
        """Recibe la notificación y responde 'OK' de inmediato a MeLi."""
        data = request.get_json()

        topic = data.get("topic") if data else None
        log_json(
            "meli_notification_received",
            topic=topic,
            resource=(data or {}).get("resource"),
        )

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
                    spawn_thread(procesar_nueva_pregunta, args=(question_id,))
                    try:
                        incrementar_metrica("preguntas_meli")
                    except Exception:
                        pass

        elif topic == "orders_v2":
            resource = data.get("resource", "")
            if resource:
                order_id = resource.split("/")[-1]
                print(f"🛒 [MELI] Nueva notificación de orden: {order_id}")
                spawn_thread(_procesar_orden_meli, args=(order_id,))
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
                spawn_thread(
                    _procesar_mensaje_posventa, args=(resource,), daemon=True
                )

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

        log_json(
            "whatsapp_webhook",
            sender_preview=str(data.get("sender", ""))[-24:],
            has_message=bool((data.get("mensaje") or "").strip()),
        )

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
        grupo_preventa = jid_grupo_preventa_wa()
        grupo_posventa = jid_grupo_postventa_wa()
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

        # --- Comandos pedidos web: facturar / envio (varios grupos operativos) ---
        if _remote_es_grupo_web_pedido(remote_jid) and message_text:
            tn = _normalizar_texto_comando_wa(message_text)
            destino_grupo = _jid_limpio(remote_jid)

            if re.search(r"\bfacturar\b", tn, re.IGNORECASE):

                def _wa_pedido_facturar(texto_norm: str, destino: str):
                    from app.tools import web_pedidos as wp

                    tok = _token_tras_facturar(texto_norm)
                    if not tok:
                        enviar_whatsapp_reporte(
                            "⚠️ Usa: *facturar 250* (últimos 3) o *facturar MCKG-…*",
                            numero_destino=destino,
                        )
                        return
                    ref_cmd, err = wp.resolver_referencia_desde_token(tok)
                    if err:
                        enviar_whatsapp_reporte(err, numero_destino=destino)
                        return
                    _ok, out = wp.marcar_solicitud_facturacion(ref_cmd)
                    enviar_whatsapp_reporte(out, numero_destino=destino)

                spawn_thread(
                    _wa_pedido_facturar,
                    args=(tn, destino_grupo),
                    daemon=True,
                )
                return jsonify({"status": "ok", "respuesta": None})

            if tn.lower().startswith("envio "):

                def _wa_pedido_envio(texto_norm: str, destino: str):
                    from app.tools import web_pedidos as wp

                    partes = texto_norm.split()
                    if len(partes) < 3:
                        enviar_whatsapp_reporte(
                            "⚠️ *envio 250 NUM_GUIA* [transportadora]\n"
                            "Ej: *envio 250 7005753156 Interrapidísimo*\n"
                            "Mismo día sin guía: *envio 250 flex*",
                            numero_destino=destino,
                        )
                        return
                    ref, err = wp.resolver_referencia_desde_token(partes[1].strip())
                    if err:
                        enviar_whatsapp_reporte(err, numero_destino=destino)
                        return
                    guia = partes[2].strip()
                    carrier = (
                        " ".join(partes[3:]).strip()
                        if len(partes) > 3
                        else ""
                    )
                    ok, out = wp.registrar_envio_y_notificar(ref, guia, carrier)
                    enviar_whatsapp_reporte(
                        f"{'✅' if ok else '❌'} {out}", numero_destino=destino
                    )

                spawn_thread(
                    _wa_pedido_envio,
                    args=(tn, destino_grupo),
                    daemon=True,
                )
                return jsonify({"status": "ok", "respuesta": None})

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
                    spawn_thread(
                        enviar_whatsapp_reporte,
                        args=(
                            "Hola, ha habido un problema con la validación de tu pago. Por favor rectifica y revisa por qué la transacción no ha sido recibida.",
                            target_num,
                        ),
                    )
                    spawn_thread(
                        enviar_whatsapp_reporte,
                        args=(
                            f"❌ Pago rechazado para ...{sufijo}",
                            grupo_contabilidad,
                        ),
                    )
                else:
                    spawn_thread(
                        enviar_whatsapp_reporte,
                        args=(
                            f"⚠️ No encontré pago pendiente con código {sufijo}.",
                            grupo_contabilidad,
                        ),
                    )
                return jsonify({"status": "ok", "respuesta": None})

            # Formato corto: "ok 463" (últimos 3 dígitos del número)
            if re.match(r"^ok\s+\d{3}$", msg_lower):
                sufijo = msg_lower.split()[1]
                target_num = _buscar_pago_por_sufijo(sufijo)
                if target_num:
                    spawn_thread(
                        procesar_confirmacion_pago_async, args=(target_num,)
                    )
                    spawn_thread(
                        enviar_whatsapp_reporte,
                        args=(
                            f"✅ Pago confirmado al cliente ...{sufijo}",
                            grupo_contabilidad,
                        ),
                    )
                else:
                    spawn_thread(
                        enviar_whatsapp_reporte,
                        args=(
                            f"⚠️ No encontré pago pendiente con código {sufijo}.",
                            grupo_contabilidad,
                        ),
                    )
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
                        spawn_thread(
                            enviar_whatsapp_reporte,
                            args=(msg_error, grupo_contabilidad),
                        )
                        return jsonify({"status": "ok", "respuesta": None})
                spawn_thread(
                    procesar_confirmacion_pago_async, args=(target_num,)
                )
                spawn_thread(
                    enviar_whatsapp_reporte,
                    args=(
                        f"✅ Confirmación enviada al cliente {target_num}",
                        grupo_contabilidad,
                    ),
                )
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
                        spawn_thread(
                            enviar_whatsapp_reporte,
                            args=(
                                f"✅ Factura *{factura_key}* aprobada. Creando en SIIGO...",
                                grupo_contabilidad,
                            ),
                        )
                else:
                    spawn_thread(
                        enviar_whatsapp_reporte,
                        args=(
                            "⚠️ No hay facturas pendientes de aprobación en este momento.",
                            grupo_contabilidad,
                        ),
                    )
                return jsonify({"status": "ok", "respuesta": None})

            elif msg_lower.startswith("pausar "):
                target_num = message_text.split(" ", 1)[1].strip()
                if target_num not in modos["numeros_en_humano"]:
                    modos["numeros_en_humano"].append(target_num)
                    guardar_modos_atencion(modos)
                spawn_thread(
                    enviar_whatsapp_reporte,
                    args=(
                        "En este momento te va a atender Jennifer García del área de ventas 🙏",
                        target_num,
                    ),
                )
                return jsonify({"status": "ok", "respuesta": None})

            elif msg_lower.startswith("activar "):
                target_num = message_text.split(" ", 1)[1].strip()
                if target_num in modos["numeros_en_humano"]:
                    modos["numeros_en_humano"].remove(target_num)
                    guardar_modos_atencion(modos)
                spawn_thread(
                    enviar_whatsapp_reporte,
                    args=(
                        "Hola veci, soy Hugo García nuevamente, ¿en qué le puedo ayudar?",
                        target_num,
                    ),
                )
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

                spawn_thread(_manejar_inv, args=(message_text,))
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

                spawn_thread(_manejar_posventa, args=(message_text,))
                return jsonify({"status": "ok", "respuesta": None})

            elif msg_lower.startswith("resp preventa "):
                print(f"📨 Comando preventa recibido del grupo: {message_text[:120]}")
                question_id, respuesta_humana = detectar_comando_preventa(message_text)
                print(
                    f"🔍 Detectado — ID: {question_id} | Respuesta: {str(respuesta_humana)[:60]}"
                )
                if question_id and respuesta_humana:
                    spawn_thread(
                        _procesar_respuesta_preventa,
                        args=(question_id, respuesta_humana),
                    )
                else:
                    spawn_thread(
                        enviar_whatsapp_reporte,
                        args=(
                            "⚠️ Formato inválido. Escribe así (sin llaves):\n"
                            f"resp preventa {question_id or '<ID>'}: tu respuesta va aquí",
                            grupo_preventa,
                        ),
                    )
                return jsonify({"status": "ok", "respuesta": None})

            elif msg_lower.startswith("resp "):
                # Intentar primero como comando preventa (formato corto: resp 497: ...)
                question_id, respuesta_humana = detectar_comando_preventa(message_text)
                if question_id and respuesta_humana:
                    print(
                        f"📨 Preventa (formato corto) — ID: {question_id} | Resp: {respuesta_humana[:60]}"
                    )
                    spawn_thread(
                        _procesar_respuesta_preventa,
                        args=(question_id, respuesta_humana),
                    )
                    return jsonify({"status": "ok", "respuesta": None})

                # Si no es preventa, tratar como respuesta directa: resp <numero>: <mensaje>
                partes = message_text.split(" ", 1)[1].split(":", 1)
                if len(partes) == 2 and partes[1].strip():
                    target_num = partes[0].strip()
                    resp_msg = partes[1].strip()
                    spawn_thread(
                        enviar_whatsapp_reporte, args=(resp_msg, target_num)
                    )
                    return jsonify({"status": "ok", "respuesta": None})
                # Sin mensaje o sin formato completo → ignorar silenciosamente

            return jsonify({"status": "ok", "respuesta": None})

        # --- SWITCH IA/HUMANO ---
        if not es_any_grupo_admin:
            modos = cargar_modos_atencion()
            if sender_id in modos["numeros_en_humano"]:
                # Reenviar al grupo de compras (atención general) y no procesar IA
                mensaje_reenvio = f"💬 CLIENTE {sender_id}: {message_text}"
                spawn_thread(
                    enviar_whatsapp_reporte,
                    args=(mensaje_reenvio, grupo_compras),
                )
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

            spawn_thread(
                enviar_whatsapp_reporte, args=(mensaje_aprobacion, grupo_compras)
            )

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

        from app.observability import get_request_id

        return jsonify(
            {
                "estado": "activo",
                "timestamp": datetime.now().isoformat(),
                "request_id": get_request_id(),
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
        log_json(
            "http_chat",
            session_preview=str(
                (data.get("session_id") or data.get("usuario_id") or "")[:40]
            ),
        )
        session_id = (data.get("session_id") or data.get("usuario_id") or "").strip()
        if not session_id:
            return (
                jsonify(
                    {
                        "error": "Campo 'session_id' (o 'usuario_id') requerido para aislar el historial del chat.",
                        "status": "error",
                    }
                ),
                400,
            )
        try:
            respuesta, _ = obtener_respuesta_ia(data["mensaje"], session_id)
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
            with open(PENDIENTES_PATH) as f:
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
        spawn_thread(
            _procesar_respuesta_preventa,
            args=(question_id, respuesta),
            daemon=True,
        )
        return jsonify({"ok": True})

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
