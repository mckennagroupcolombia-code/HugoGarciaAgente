from flask import request, jsonify, render_template, send_from_directory
import os
import json
import re
import hmac
import hashlib
import base64
import tempfile
from datetime import datetime as _dt
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
    jid_grupo_inventario_wa,
    jid_grupo_preventa_wa,
    jid_grupo_postventa_wa,
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
from app.api_auth import chat_api_token_matches_request

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
from app.meli_postventa_notif import procesar_postventa_meli_desde_webhook
from app.meli_webhook_topics import meli_webhook_evaluar_despacho
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


def register_routes(app):
    @app.before_request
    def _mckenna_bind_request_id():
        bind_flask_request(request)

    @app.route("/notifications", methods=["POST"])
    def notifications():
        """Recibe la notificación y responde 'OK' de inmediato a MeLi."""
        data = request.get_json(force=True, silent=True)

        topic = data.get("topic") if data else None
        resource = (data or {}).get("resource", "")

        print(
            f"📬 [NOTIF] topic={topic!r} resource={resource!r}"
            f" payload={json.dumps(data, default=str)[:400] if data else '(vacío)'}"
        )
        log_json(
            "meli_notification_received",
            topic=topic,
            resource=resource,
        )

        if not data:
            print("⚠️ [NOTIF] Body vacío o JSON inválido — ignorado.")
            try:
                from app.meli_webhook_incidents import registrar_meli_webhook_incidente

                registrar_meli_webhook_incidente("notif_body_invalido", source="routes")
            except Exception:
                pass
            return jsonify({"status": "ok"}), 200

        from app.monitor import incrementar_metrica
        from app.meli_webhook_incidents import registrar_meli_webhook_incidente

        plan = meli_webhook_evaluar_despacho(topic, resource, data)
        t = plan["tipo"]

        if t == "preventa":
            question_id = plan["question_id"]
            limpiar_preguntas_antiguas()
            if question_id in preguntas_procesadas:
                print(f"⏭️ [PREVENTA] Pregunta {question_id} ya procesada (dedup).")
            else:
                preguntas_procesadas[question_id] = time.time()
                print(f"❓ [PREVENTA] Despachando pregunta {question_id}")
                spawn_thread(procesar_nueva_pregunta, args=(question_id,))
                try:
                    incrementar_metrica("preguntas_meli")
                except Exception:
                    pass
        elif t == "orden":
            order_id = plan["order_id"]
            print(f"🛒 [MELI-ORDER] Nueva orden: {order_id}")
            spawn_thread(_procesar_orden_meli, args=(order_id,))
            try:
                incrementar_metrica("ordenes_meli")
            except Exception:
                pass
        elif t == "postventa":
            print(f"📩 [MELI-MSG] Posventa topic={topic!r} resource={resource!r}")
            spawn_thread(
                procesar_postventa_meli_desde_webhook,
                args=(plan["resource"],),
                daemon=True,
            )
        elif t == "postventa_omitir_lectura":
            print(
                f"⏭️ [POSVENTA] Sin action 'created' — omitida. "
                f"actions={data.get('actions')!r}"
            )
        else:
            _noop_msgs = {
                "preventa_sin_resource": "⚠️ [PREVENTA] resource vacío, ignorado.",
                "preventa_sin_question_id": "⚠️ [PREVENTA] resource sin id de pregunta, ignorado.",
                "orden_sin_resource": "⚠️ [MELI-ORDER] orders_v2 sin resource, ignorado.",
                "postventa_sin_resource": "⚠️ [POSVENTA] messages sin resource, ignorado.",
                "topic_no_manejado": f"ℹ️ [NOTIF] topic={topic!r} no manejado (se ignora).",
            }
            print(_noop_msgs.get(t, f"ℹ️ [NOTIF] tipo plan={t!r}"))
            registrar_meli_webhook_incidente(
                "notif_sin_efecto_util",
                tipo=t,
                topic=topic,
                resource=(resource or "")[:500],
                source="routes",
            )

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
        grupo_inventario = jid_grupo_inventario_wa()

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
                    state_path = "/home/mckg/mi-agente/app/data/mensajes_posventa_pendientes.json"
                    pack_id = None
                    comprador = ""
                    clave_pendiente = None
                    try:
                        with open(state_path, "r", encoding="utf-8") as _f:
                            _state = json.load(_f)
                        pendientes = _state.get("pendientes", {})
                        sufijo_busqueda = sufijo.upper()
                        entrada = pendientes.get(sufijo_busqueda)
                        clave_candidata = sufijo_busqueda
                        if not entrada:
                            for k, v in pendientes.items():
                                if k.endswith(sufijo_busqueda) or sufijo_busqueda.endswith(k):
                                    entrada = v
                                    clave_candidata = k
                                    break
                        if entrada:
                            pack_id = entrada["pack_id"]
                            comprador = entrada.get("comprador", "")
                            clave_pendiente = clave_candidata
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
                        # Quitar de pendientes (clave real del dict o mismo pack_id)
                        try:
                            with open(state_path, "r", encoding="utf-8") as _f:
                                _state = json.load(_f)
                            pd = _state.get("pendientes", {})
                            if clave_pendiente and clave_pendiente in pd:
                                pd.pop(clave_pendiente, None)
                            else:
                                for k, v in list(pd.items()):
                                    if str(v.get("pack_id")) == str(pack_id):
                                        pd.pop(k, None)
                                        break
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

        if not chat_api_token_matches_request():
            return jsonify({"error": "No autorizado"}), 401
        data = request.get_json()
        if not data:
            return jsonify({"error": "JSON requerido"}), 400
        mensaje = (data.get("mensaje") or "").strip()
        adjuntos = data.get("adjuntos") or data.get("attachments")
        if not mensaje and not adjuntos:
            return jsonify({"error": "Campo 'mensaje' o adjuntos requerido"}), 400
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
            respuesta, _ = obtener_respuesta_ia(
                mensaje, session_id, adjuntos_payload=adjuntos
            )
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
        from flask import abort

        import re as _re

        if not _re.match(r"^[a-zA-Z0-9\-]+$", nombre_guia):
            abort(404)
        nombre_archivo = f"guia-{nombre_guia}.html"
        ruta_completa = os.path.join(_GUIAS_DIR, nombre_archivo)
        if not os.path.isfile(ruta_completa):
            abort(404)
        return send_from_directory(_GUIAS_DIR, nombre_archivo)

    # ══════════════════════════════════════════════════════════════════════════
    #  CORS middleware (manual) — permits requests from Vite dev & Tauri
    # ══════════════════════════════════════════════════════════════════════════
    _CORS_ORIGINS = {
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173",
        "tauri://localhost",
        "https://tauri.localhost",
    }

    @app.after_request
    def _cors_headers(response):
        origin = request.headers.get("Origin", "")
        if origin in _CORS_ORIGINS:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Headers"] = "Content-Type,Authorization"
            response.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS,DELETE"
            response.headers["Access-Control-Allow-Credentials"] = "true"
        return response

    @app.route("/api/<path:_path>", methods=["OPTIONS"])
    def _cors_preflight(_path):
        return "", 204

    # ══════════════════════════════════════════════════════════════════════════
    #  API endpoints — unified on :8081 for React SPA
    # ══════════════════════════════════════════════════════════════════════════

    def _api_token_valido():
        return chat_api_token_matches_request()

    def _api_lanzar_en_hilo(fn, *args, job: str | None = None):
        """Ejecuta fn(*args) en hilo daemon y registra resultado en panel_activity."""
        from app.panel_activity import run_logged_job

        label = job or getattr(fn, "__name__", "job")

        def _wrapped():
            run_logged_job(label, fn, args)

        spawn_thread(_wrapped, daemon=True)

    # -- Sync imports (same as webhook_meli.py) --
    from app.sync import (
        sincronizar_inteligente as _sync_inteligente,
        sincronizar_facturas_recientes as _sync_facturas_recientes,
        ejecutar_sincronizacion_y_reporte_stock as _sync_stock_reporte,
        sincronizar_manual_por_id as _sync_manual_id,
        sincronizar_por_dia_especifico as _sync_por_dia,
    )
    from app.services.google_services import leer_datos_hoja as _leer_hoja
    from app.services.meli import aprender_de_interacciones_meli as _aprender_meli

    @app.route("/api/status")
    def api_status():
        from app.observability import get_request_id
        return jsonify({
            "estado": "activo",
            "timestamp": _dt.now().isoformat(),
            "request_id": get_request_id(),
            "servicios": {
                "mercadolibre": os.path.exists("credenciales_meli.json"),
                "google": os.path.exists("credenciales_google.json"),
                "siigo": os.path.exists("credenciales_SIIGO.json"),
            },
            "version": "2.0.0",
        })

    @app.route("/api/preventa/pendientes")
    def api_preventa_pendientes():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        try:
            with open(PENDIENTES_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            pendientes = [
                p for p in data.get("preguntas", []) if not p.get("respondida")
            ]
            return jsonify({"preguntas": pendientes, "total": len(pendientes)})
        except FileNotFoundError:
            return jsonify({"preguntas": [], "total": 0})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/preventa/casos")
    def api_preventa_casos():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        try:
            ruta = os.path.join(_ROUTES_DIR, "..", "app", "training", "casos_preventa.json")
            ruta_abs = os.path.join(os.path.dirname(_ROUTES_DIR), "training", "casos_preventa.json")
            with open(ruta_abs, "r", encoding="utf-8") as f:
                data = json.load(f)
            casos = data.get("casos", [])
            return jsonify({"casos": casos[-50:], "total": len(casos)})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/sync/hoy", methods=["POST"])
    def api_sync_hoy():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        _api_lanzar_en_hilo(_sync_facturas_recientes, 1, job="sync_facturas_1d")
        return jsonify({
            "status": "iniciado",
            "mensaje": "Sync ultimo dia iniciado en segundo plano.",
            "timestamp": _dt.now().isoformat(),
        })

    @app.route("/api/sync/10dias", methods=["POST"])
    def api_sync_10dias():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        _api_lanzar_en_hilo(_sync_facturas_recientes, 10, job="sync_facturas_10d")
        return jsonify({
            "status": "iniciado",
            "mensaje": "Sync ultimos 10 dias iniciado en segundo plano.",
            "timestamp": _dt.now().isoformat(),
        })

    @app.route("/api/sync/completo", methods=["POST"])
    def api_sync_completo():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        _api_lanzar_en_hilo(_sync_stock_reporte, job="sync_completo_reporte_stock")
        return jsonify({
            "status": "iniciado",
            "mensaje": "Sync completo + reporte de stock iniciado.",
            "timestamp": _dt.now().isoformat(),
        })

    @app.route("/api/sync/inteligente", methods=["POST"])
    def api_sync_inteligente():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        _api_lanzar_en_hilo(_sync_inteligente, job="sync_inteligente")
        return jsonify({
            "status": "iniciado",
            "mensaje": "Sync inteligente (MeLi vs Siigo) iniciado.",
            "timestamp": _dt.now().isoformat(),
        })

    @app.route("/api/sync/pack", methods=["POST"])
    def api_sync_pack():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        data = request.get_json() or {}
        pack_id = str(data.get("pack_id", "")).strip()
        if not pack_id:
            return jsonify({"error": "Campo 'pack_id' requerido"}), 400
        _api_lanzar_en_hilo(_sync_manual_id, pack_id, job=f"sync_pack_{pack_id}")
        return jsonify({
            "status": "iniciado",
            "mensaje": f"Sync por Pack ID {pack_id} iniciado.",
            "timestamp": _dt.now().isoformat(),
        })

    @app.route("/api/sync/fecha", methods=["POST"])
    def api_sync_fecha():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        data = request.get_json() or {}
        fecha = str(data.get("fecha", "")).strip()
        if not fecha:
            return jsonify({"error": "Campo 'fecha' requerido (AAAA-MM-DD)"}), 400
        _api_lanzar_en_hilo(_sync_por_dia, fecha, job=f"sync_fecha_{fecha}")
        return jsonify({
            "status": "iniciado",
            "mensaje": f"Sync por fecha {fecha} iniciado.",
            "timestamp": _dt.now().isoformat(),
        })

    @app.route("/api/sync/stock", methods=["POST"])
    def api_sync_stock():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        _api_lanzar_en_hilo(_sync_stock_reporte, job="reporte_stock_whatsapp")
        return jsonify({
            "status": "iniciado",
            "mensaje": "Reporte de stock iniciado. Revisa Actividad del servidor y WhatsApp grupo inventario.",
            "timestamp": _dt.now().isoformat(),
        })

    @app.route("/api/sync/aprendizaje", methods=["POST"])
    def api_sync_aprendizaje():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        _api_lanzar_en_hilo(_aprender_meli, job="aprendizaje_meli")
        return jsonify({
            "status": "iniciado",
            "mensaje": "Aprendizaje IA iniciado.",
            "timestamp": _dt.now().isoformat(),
        })

    @app.route("/api/sync/gmail", methods=["POST"])
    def api_sync_gmail():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        try:
            from app.tools.importar_productos_siigo import procesar_facturas_para_importar_productos
            from app.tools.sincronizar_facturas_de_compra_siigo import sincronizar_facturas_de_compra_siigo
            body = request.get_json(silent=True) or {}
            solo_nit = body.get("nit")
            if solo_nit:
                sn = str(solo_nit).strip()
                _api_lanzar_en_hilo(
                    sincronizar_facturas_de_compra_siigo,
                    sn,
                    job=f"gmail_compra_nit_{sn}",
                )
            else:
                _api_lanzar_en_hilo(
                    procesar_facturas_para_importar_productos,
                    job="gmail_importar_xml",
                )
            return jsonify({
                "status": "iniciado",
                "mensaje": "Escaneo facturas de compra Gmail iniciado.",
                "timestamp": _dt.now().isoformat(),
            })
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/consultar/producto")
    def api_consultar_producto():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        nombre = request.args.get("nombre", "").strip()
        if not nombre:
            return jsonify({"error": "Parametro 'nombre' requerido"}), 400
        try:
            from app.panel_activity import log_line

            log_line(f"HTTP consultar_producto: {nombre[:120]!r}")
            resultado = _leer_hoja(nombre)
            if isinstance(resultado, str) and resultado.strip().startswith("❌"):
                log_line(f"✖ consultar_producto: {resultado[:600]}")
            else:
                log_line("✔ consultar_producto: consulta Sheets OK")
            return jsonify({"status": "ok", "resultado": resultado})
        except Exception as e:
            from app.panel_activity import log_line

            log_line(f"✖ consultar_producto excepción: {e!r}")
            return jsonify({"error": str(e)}), 500

    @app.route("/api/panel/logs", methods=["GET", "DELETE"])
    def api_panel_logs():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.panel_activity import clear_lines, get_lines

        if request.method == "DELETE":
            clear_lines()
            return jsonify({"ok": True})
        limit = request.args.get("limit", default=300, type=int) or 300
        return jsonify({"lines": get_lines(limit)})

    @app.route("/app/api/5s/workspace", methods=["GET", "PUT"])
    @app.route("/api/5s/workspace", methods=["GET", "PUT"])
    def api_5s_workspace():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services import cinco_s as _5s

        if request.method == "GET":
            return jsonify(_5s.read_workspace())
        try:
            body = request.get_json(silent=True) or {}
            if not isinstance(body, dict):
                body = {}
            saved = _5s.write_workspace(body)
            return jsonify(saved)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/app/api/5s/project", methods=["POST"])
    @app.route("/api/5s/project", methods=["POST"])
    def api_5s_project_create():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services import cinco_s as _5s

        body = request.get_json(silent=True) or {}
        tid = str(body.get("template_id", "")).strip()
        name = str(body.get("name", "")).strip()
        cat = str(body.get("category_id", "")).strip() or None
        if not tid:
            return jsonify({"error": "template_id requerido"}), 400
        ws = _5s.read_workspace()
        proj = _5s.new_project_from_template(tid, name, ws, category_id=cat)
        if not proj:
            return jsonify({"error": "Plantilla no encontrada"}), 404
        try:
            saved = _5s.write_workspace(ws)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except Exception as e:
            return jsonify({"error": str(e)}), 500
        return jsonify({"project": proj, "workspace": saved})

    @app.route("/app/api/5s/project/routine", methods=["POST"], strict_slashes=False)
    @app.route("/app/api/5s/routine", methods=["POST"], strict_slashes=False)
    @app.route("/api/5s/project/routine", methods=["POST"], strict_slashes=False)
    @app.route("/api/5s/routine", methods=["POST"], strict_slashes=False)
    def api_5s_routine_create():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services import cinco_s as _5s

        body = request.get_json(silent=True) or {}
        if not isinstance(body, dict):
            body = {}
        name = str(body.get("name", "")).strip()
        tags = body.get("tags") if isinstance(body.get("tags"), list) else []
        pre = body.get("preflight") if isinstance(body.get("preflight"), list) else []
        tasks = body.get("tasks") if isinstance(body.get("tasks"), list) else []
        ritual = str(body.get("ritual_notes", "")).strip()
        cat = str(body.get("category_id", "")).strip() or None
        also_tpl = bool(body.get("also_save_template"))
        raw_sup = body.get("supplies")
        supplies = raw_sup if isinstance(raw_sup, list) else None
        ws = _5s.read_workspace()
        proj, err = _5s.create_routine_project(
            ws,
            name,
            [str(x) for x in tags],
            [str(x) for x in pre],
            [str(x) for x in tasks],
            ritual,
            cat,
            also_tpl,
            supplies,
        )
        if err or not proj:
            return jsonify({"error": err or "no se pudo crear"}), 400
        try:
            saved = _5s.write_workspace(ws)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except Exception as e:
            return jsonify({"error": str(e)}), 500
        return jsonify({"project": proj, "workspace": saved})

    @app.route("/app/api/5s/suggest-routine", methods=["POST"], strict_slashes=False)
    @app.route("/api/5s/suggest-routine", methods=["POST"], strict_slashes=False)
    def api_5s_suggest_routine():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services import cinco_s as _5s

        body = request.get_json(silent=True) or {}
        if not isinstance(body, dict):
            body = {}
        desc = str(body.get("description", "")).strip()
        hints = body.get("hints")
        if hints is not None and not isinstance(hints, dict):
            hints = None
        sug, err = _5s.suggest_routine_json(desc, hints)
        if err or not sug:
            return jsonify({"ok": False, "suggestion": None, "error": err or "sin sugerencia"}), 200
        return jsonify({"ok": True, "suggestion": sug, "error": ""})

    @app.route("/app/api/5s/assistant", methods=["POST"])
    @app.route("/api/5s/assistant", methods=["POST"])
    def api_5s_assistant():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services import cinco_s as _5s

        body = request.get_json(silent=True) or {}
        msg = str(body.get("message", "")).strip()
        if not msg:
            return jsonify({"ok": False, "reply": "", "error": "Campo 'message' requerido"}), 400
        ctx = body.get("context")
        if ctx is not None and not isinstance(ctx, dict):
            ctx = None
        out = _5s.asistente_5s_detailed(msg, ctx)
        reply = (out.get("reply") or "").strip()
        if not reply:
            err = (out.get("error") or "Sin respuesta").strip()
            return jsonify({
                "ok": False,
                "reply": "",
                "error": err,
                "provider": out.get("provider") or "",
            })
        return jsonify({
            "ok": True,
            "reply": reply,
            "error": "",
            "provider": out.get("provider") or "",
        })

    @app.route("/app/api/5s/audio", methods=["POST"])
    @app.route("/api/5s/audio", methods=["POST"])
    def api_5s_audio_upload():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services import cinco_s as _5s

        f = request.files.get("file")
        if not f or not getattr(f, "filename", None):
            return jsonify({"error": "campo multipart 'file' requerido"}), 400
        if not str(f.filename).lower().endswith(".wav"):
            return jsonify({"error": "solo archivos .wav"}), 400
        try:
            fname = _5s.save_wav_upload(f)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except Exception as e:
            return jsonify({"error": str(e)}), 500
        prefix = "/app/api/5s/audio" if request.path.startswith("/app/api/") else "/api/5s/audio"
        return jsonify({"url": f"{prefix}/{fname}", "filename": fname})

    @app.route("/app/api/5s/audio/<fname>")
    @app.route("/api/5s/audio/<fname>")
    def api_5s_audio_get(fname):
        from app.services.cinco_s import CINCO_S_AUDIO_DIR

        safe = str(fname).strip()
        if not re.match(r"^[a-f0-9]{32}\.wav$", safe, re.I):
            return "", 404
        fp = os.path.join(CINCO_S_AUDIO_DIR, safe)
        if not os.path.isfile(fp):
            return "", 404
        return send_from_directory(CINCO_S_AUDIO_DIR, safe, mimetype="audio/wav")

    def _api_5s_project_delete_response(project_id):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services import cinco_s as _5s

        ws = _5s.read_workspace()
        if not _5s.remove_project(ws, project_id):
            return jsonify({"error": "tablero no encontrado"}), 404
        try:
            saved = _5s.write_workspace(ws)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except Exception as e:
            return jsonify({"error": str(e)}), 500
        return jsonify({"workspace": saved})

    @app.route("/app/api/5s/project/<project_id>/delete", methods=["POST"], strict_slashes=False)
    @app.route("/api/5s/project/<project_id>/delete", methods=["POST"], strict_slashes=False)
    def api_5s_project_delete_post(project_id):
        """Alias POST: muchos proxies bloquean DELETE; el panel usa esta ruta."""
        return _api_5s_project_delete_response(project_id)

    @app.route("/app/api/5s/project/<project_id>", methods=["DELETE"])
    @app.route("/api/5s/project/<project_id>", methods=["DELETE"])
    def api_5s_project_delete(project_id):
        return _api_5s_project_delete_response(project_id)

    def _api_5s_template_delete_response(template_id):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services import cinco_s as _5s

        ws = _5s.read_workspace()
        if not _5s.remove_template(ws, template_id):
            return jsonify({"error": "plantilla no encontrada"}), 404
        try:
            saved = _5s.write_workspace(ws)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except Exception as e:
            return jsonify({"error": str(e)}), 500
        return jsonify({"workspace": saved})

    @app.route("/app/api/5s/template/<template_id>/delete", methods=["POST"], strict_slashes=False)
    @app.route("/api/5s/template/<template_id>/delete", methods=["POST"], strict_slashes=False)
    def api_5s_template_delete_post(template_id):
        return _api_5s_template_delete_response(template_id)

    @app.route("/app/api/5s/template/<template_id>", methods=["PUT", "DELETE"])
    @app.route("/api/5s/template/<template_id>", methods=["PUT", "DELETE"])
    def api_5s_template_item(template_id):
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services import cinco_s as _5s

        if request.method == "DELETE":
            return _api_5s_template_delete_response(template_id)

        body = request.get_json(silent=True) or {}
        if not isinstance(body, dict):
            body = {}
        ws = _5s.read_workspace()
        saved = _5s.replace_template(ws, template_id, body)
        if saved is None:
            return jsonify({"error": "plantilla no encontrada o datos inválidos"}), 400
        return jsonify({"workspace": saved})

    @app.route("/app/api/5s/template", methods=["POST"])
    @app.route("/api/5s/template", methods=["POST"])
    def api_5s_template_create():
        if not _api_token_valido():
            return jsonify({"error": "No autorizado"}), 401
        from app.services import cinco_s as _5s

        body = request.get_json(silent=True) or {}
        if not isinstance(body, dict):
            body = {}
        ws = _5s.read_workspace()
        out, err = _5s.append_template(ws, body)
        if err:
            return jsonify({"error": err}), 400
        return jsonify({"workspace": out})

    # ══════════════════════════════════════════════════════════════════════════
    #  SPA — React build served from desktop/dist/
    # ══════════════════════════════════════════════════════════════════════════
    _SPA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "desktop", "dist")

    @app.route("/app/assets/<path:filename>")
    def serve_spa_assets(filename):
        """Serve JS/CSS hashed assets from the Vite build."""
        assets_dir = os.path.join(_SPA_DIR, "assets")
        return send_from_directory(assets_dir, filename)

    @app.route("/app/favicon.svg")
    def serve_spa_favicon():
        return send_from_directory(_SPA_DIR, "favicon.svg")

    @app.route("/app", methods=["GET", "HEAD"])
    @app.route("/app/<path:path>", methods=["GET", "HEAD"])
    def serve_spa(path=""):
        if not os.path.isdir(_SPA_DIR):
            return jsonify({"error": "SPA no compilada. Ejecutar: cd desktop && npm run build"}), 404
        return send_from_directory(_SPA_DIR, "index.html")
