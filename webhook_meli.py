import os
import re
import json
import requests
import time
from flask import Flask, request, jsonify, render_template
from dotenv import load_dotenv
from app.core import obtener_respuesta_ia, configurar_ia
from app.utils import (
    enviar_whatsapp_reporte,
    refrescar_token_meli,
    jid_grupo_postventa_wa,
    meli_postventa_id_mensaje,
    meli_postventa_texto_para_notif,
)

load_dotenv()
app = Flask(__name__, template_folder="app/templates")
configurar_ia(app)

from app.observability import bind_flask_request, log_json, spawn_thread


@app.before_request
def _webhook_bind_request_id():
    bind_flask_request(request)


def obtener_nombre_producto(item_id):
    """Obtiene el título de la publicación de Mercado Libre."""
    token_actual = refrescar_token_meli() or os.environ.get("MELI_ACCESS_TOKEN")
    url = f"https://api.mercadolibre.com/items/{item_id}"
    headers = {"Authorization": f"Bearer {token_actual}"}
    try:
        res = requests.get(url, headers=headers)
        if res.status_code == 200:
            return res.json().get("title", "Producto desconocido")
    except Exception as e:
        print(f"Error obteniendo nombre del producto: {e}")
    return "Producto desconocido"


def responder_en_mercado_libre(question_id, texto):
    """Envía la respuesta final a la API de Mercado Libre."""
    token_actual = refrescar_token_meli() or os.environ.get("MELI_ACCESS_TOKEN")
    url = "https://api.mercadolibre.com/answers"
    headers = {
        "Authorization": f"Bearer {token_actual}",
        "Content-Type": "application/json",
    }
    data = {"question_id": question_id, "text": texto}
    try:
        response = requests.post(url, json=data, headers=headers)
        return response.status_code
    except Exception as e:
        print(f"Error al responder en MeLi: {e}")
        return 500


from preventa_meli import procesar_nueva_pregunta
from app.sync import sincronizar_stock_todas_las_plataformas

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
                    f"⚠️ [MELI-ORDER] No se pudo leer available_quantity en MeLi para ítem {item_id} (SKU {sku}) — omitiendo sync hacia la web."
                )
                continue

            try:
                stock_int = int(stock_post_venta)
            except (TypeError, ValueError):
                print(
                    f"⚠️ [MELI-ORDER] Stock post-venta no numérico para SKU {sku!r}: {stock_post_venta!r}"
                )
                continue

            # MeLi ya reflejó la venta; propagamos el mismo stock a la página web (y re-afirmamos en MeLi vía sync central).
            resultado_sync = sincronizar_stock_todas_las_plataformas(sku, stock_int)
            print(
                f"   └──> SKU {sku} | Stock post-venta MeLi: {stock_int} | sync: {resultado_sync[:200]}..."
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
    GRUPO = jid_grupo_postventa_wa()
    try:
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

        if not pack_id:
            # El resource no contenía /packs/{id} — intentar múltiples estrategias
            msg_id_directo = resource.strip("/")
            print(
                f"🔍 [POSVENTA] Resource sin pack_id explícito: '{msg_id_directo}'. Intentando resolver..."
            )

            # Estrategia 1: Usar el resource como ruta API directa
            for url_intento in [
                f"https://api.mercadolibre.com/{msg_id_directo}",
                f"https://api.mercadolibre.com/messages/{msg_id_directo}",
            ]:
                try:
                    res_msg = requests.get(url_intento, headers=headers, timeout=10)
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

            # Estrategia 2: Buscar en órdenes recientes del vendedor
            if not pack_id:
                try:
                    print(
                        f"🔍 [POSVENTA] Buscando en órdenes recientes del vendedor..."
                    )
                    res_orders = requests.get(
                        f"https://api.mercadolibre.com/orders/search?seller={_SELLER_ID}&sort=date_desc&limit=10",
                        headers=headers,
                        timeout=10,
                    )
                    if res_orders.status_code == 200:
                        for orden in res_orders.json().get("results", []):
                            oid = str(orden.get("id", ""))
                            res_msgs = requests.get(
                                f"https://api.mercadolibre.com/messages/packs/{oid}/sellers/{_SELLER_ID}?tag=post_sale",
                                headers=headers,
                                timeout=8,
                            )
                            if res_msgs.status_code == 200:
                                msgs = res_msgs.json().get("messages", [])
                                # Buscar si algún mensaje coincide con el resource UUID
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


@app.route("/notifications", methods=["POST"])
def notifications():
    """Recibe la notificación y responde 'OK' de inmediato a MeLi."""
    data = request.get_json()

    topic = data.get("topic") if data else None
    log_json(
        "meli_notification_received",
        topic=topic,
        resource=(data or {}).get("resource"),
        source="webhook_meli",
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
            f"📩 [MELI-MSG] Notificación messages recibida. Resource: '{resource}' | Payload completo: {json.dumps(data, default=str)[:500]}"
        )
        if resource:
            spawn_thread(
                _procesar_mensaje_posventa, args=(resource,), daemon=True
            )

    # Respondemos 200 OK inmediatamente
    return jsonify({"status": "ok"}), 200


# Mantenemos el endpoint de whatsapp por si lo estaban usando para pruebas locales
@app.route("/whatsapp", methods=["POST"])
def whatsapp_mock():
    data = request.get_json()
    if data and data.get("topic") == "questions":
        resource = data.get("resource")
        if resource:
            question_id = resource.split("/")[-1]
            spawn_thread(procesar_nueva_pregunta, args=(question_id,))
    return jsonify({"status": "ok"}), 200


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
    return render_template("chat.html")


# ── HELPER: verificación de token ────────────────────────────────────────────
def _token_valido():
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    return token == os.getenv("CHAT_API_TOKEN", "")


def _lanzar_en_hilo(fn, *args):
    """Ejecuta fn(*args) en segundo plano y devuelve respuesta inmediata."""
    spawn_thread(fn, args=args, daemon=True)


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
from app.tools.importar_productos_siigo import procesar_facturas_para_importar_productos
from app.tools.sincronizar_facturas_de_compra_siigo import (
    sincronizar_facturas_de_compra_siigo,
)


@app.route("/sync/hoy", methods=["POST"])
def sync_hoy():
    if not _token_valido():
        return jsonify({"status": "error", "resultado": "No autorizado"}), 401
    _lanzar_en_hilo(sincronizar_facturas_recientes, 1)
    return jsonify(
        {
            "status": "iniciado",
            "mensaje": "🔄 Sync último día iniciado en segundo plano.",
            "timestamp": _dt.now().isoformat(),
        }
    )


@app.route("/sync/10dias", methods=["POST"])
def sync_10dias():
    if not _token_valido():
        return jsonify({"status": "error", "resultado": "No autorizado"}), 401
    _lanzar_en_hilo(sincronizar_facturas_recientes, 10)
    return jsonify(
        {
            "status": "iniciado",
            "mensaje": "🔄 Sync últimos 10 días iniciado en segundo plano.",
            "timestamp": _dt.now().isoformat(),
        }
    )


@app.route("/sync/completo", methods=["POST"])
def sync_completo():
    if not _token_valido():
        return jsonify({"status": "error", "resultado": "No autorizado"}), 401
    _lanzar_en_hilo(ejecutar_sincronizacion_y_reporte_stock)
    return jsonify(
        {
            "status": "iniciado",
            "mensaje": "📊 Sync completo + reporte de stock iniciado.",
            "timestamp": _dt.now().isoformat(),
        }
    )


@app.route("/sync/inteligente", methods=["POST"])
def sync_inteligente():
    if not _token_valido():
        return jsonify({"status": "error", "resultado": "No autorizado"}), 401
    _lanzar_en_hilo(sincronizar_inteligente)
    return jsonify(
        {
            "status": "iniciado",
            "mensaje": "🧠 Sync inteligente (MeLi vs Siigo) iniciado.",
            "timestamp": _dt.now().isoformat(),
        }
    )


@app.route("/consultar/producto", methods=["GET"])
def consultar_producto():
    if not _token_valido():
        return jsonify({"status": "error", "resultado": "No autorizado"}), 401
    nombre = request.args.get("nombre", "").strip()
    if not nombre:
        return jsonify(
            {"status": "error", "resultado": "Parámetro 'nombre' requerido"}
        ), 400
    try:
        resultado = leer_datos_hoja(nombre)
        return jsonify(
            {"status": "ok", "resultado": resultado, "timestamp": _dt.now().isoformat()}
        )
    except Exception as e:
        return jsonify({"status": "error", "resultado": str(e)}), 500


@app.route("/sync/pack", methods=["POST"])
def sync_pack():
    if not _token_valido():
        return jsonify({"status": "error", "resultado": "No autorizado"}), 401
    data = request.get_json() or {}
    pack_id = str(data.get("pack_id", "")).strip()
    if not pack_id:
        return jsonify(
            {"status": "error", "resultado": "Campo 'pack_id' requerido"}
        ), 400
    _lanzar_en_hilo(sincronizar_manual_por_id, pack_id)
    return jsonify(
        {
            "status": "iniciado",
            "mensaje": f"🛠 Sync por Pack ID {pack_id} iniciado.",
            "timestamp": _dt.now().isoformat(),
        }
    )


@app.route("/sync/fecha", methods=["POST"])
def sync_fecha():
    if not _token_valido():
        return jsonify({"status": "error", "resultado": "No autorizado"}), 401
    data = request.get_json() or {}
    fecha = str(data.get("fecha", "")).strip()
    if not fecha:
        return jsonify(
            {
                "status": "error",
                "resultado": "Campo 'fecha' requerido (formato AAAA-MM-DD)",
            }
        ), 400
    _lanzar_en_hilo(sincronizar_por_dia_especifico, fecha)
    return jsonify(
        {
            "status": "iniciado",
            "mensaje": f"📅 Sync por fecha {fecha} iniciado.",
            "timestamp": _dt.now().isoformat(),
        }
    )


@app.route("/sync/aprendizaje", methods=["POST"])
def sync_aprendizaje():
    if not _token_valido():
        return jsonify({"status": "error", "resultado": "No autorizado"}), 401
    _lanzar_en_hilo(aprender_de_interacciones_meli)
    return jsonify(
        {
            "status": "iniciado",
            "mensaje": "🎓 Aprendizaje IA iniciado. Se analizarán las últimas interacciones de MeLi.",
            "timestamp": _dt.now().isoformat(),
        }
    )


@app.route("/sync/gmail", methods=["POST"])
def sync_gmail():
    if not _token_valido():
        return jsonify({"status": "error", "resultado": "No autorizado"}), 401
    body = request.get_json(silent=True) or {}
    solo_nit = body.get("nit")
    if solo_nit:
        _lanzar_en_hilo(lambda: sincronizar_facturas_de_compra_siigo(solo_nit=solo_nit))
        return jsonify(
            {
                "status": "iniciado",
                "mensaje": f"🔄 Sync facturas de compra (NIT: {solo_nit}) iniciado.",
                "timestamp": _dt.now().isoformat(),
            }
        )
    _lanzar_en_hilo(procesar_facturas_para_importar_productos)
    return jsonify(
        {
            "status": "iniciado",
            "mensaje": "🔄 Escaneo de facturas de compra desde Gmail iniciado.",
            "timestamp": _dt.now().isoformat(),
        }
    )


@app.route("/sync/stock", methods=["POST"])
def sync_stock():
    if not _token_valido():
        return jsonify({"status": "error", "resultado": "No autorizado"}), 401
    _lanzar_en_hilo(ejecutar_sincronizacion_y_reporte_stock)
    return jsonify(
        {
            "status": "iniciado",
            "mensaje": "📊 Reporte de stock iniciado. El resultado llegará por WhatsApp.",
            "timestamp": _dt.now().isoformat(),
        }
    )


@app.route("/confirmar-pago", methods=["POST"])
def confirmar_pago():
    data = request.get_json() or {}
    numero_cliente = data.get("numero_cliente")
    confirmado = data.get("confirmado", False)

    if not numero_cliente:
        return jsonify(
            {"status": "error", "resultado": "Campo 'numero_cliente' requerido"}
        ), 400

    if confirmado:
        mensaje_cliente = "Veci, le confirmamos que su pago ha sido recibido ✅ Estamos alistando su pedido y le avisamos cuando despachemos."
        enviar_whatsapp_reporte(mensaje_cliente, numero_destino=numero_cliente)
        try:
            incrementar_metrica("pagos_confirmados")
        except Exception:
            pass
        return jsonify(
            {"status": "success", "mensaje": f"Pago confirmado para {numero_cliente}"}
        )
    else:
        mensaje_cliente = "Hola, ha habido un problema con la validación de tu pago. Por favor rectifica y revisa por qué la transacción no ha sido recibida."
        enviar_whatsapp_reporte(mensaje_cliente, numero_destino=numero_cliente)
        return jsonify(
            {"status": "success", "mensaje": f"Pago rechazado para {numero_cliente}"}
        )


@app.route("/training/agregar-caso", methods=["POST"])
def agregar_caso():
    import json

    data = request.get_json() or {}
    trigger = data.get("trigger", [])
    contexto = data.get("contexto", "")
    instruccion = data.get("instruccion", "")

    if not all([trigger, contexto, instruccion]):
        return jsonify(
            {
                "status": "error",
                "resultado": "Faltan campos (trigger, contexto, instruccion)",
            }
        ), 400

    try:
        archivo = "app/training/casos_especiales.json"
        with open(archivo, "r", encoding="utf-8") as f:
            contenido = json.load(f)

        nuevo_caso = {
            "id": f"caso_{int(time.time())}",
            "trigger": trigger if isinstance(trigger, list) else [trigger],
            "contexto": contexto,
            "instruccion": instruccion,
            "ejemplo_respuesta": data.get("ejemplo_respuesta", ""),
        }

        contenido["casos"].append(nuevo_caso)

        with open(archivo, "w", encoding="utf-8") as f:
            json.dump(contenido, f, indent=2, ensure_ascii=False)

        # Reiniciar contexto del agente
        configurar_ia(app)

        return jsonify(
            {"status": "success", "mensaje": "Caso agregado y agente reentrenado"}
        )
    except Exception as e:
        return jsonify({"status": "error", "resultado": str(e)}), 500


from app.monitor import incrementar_metrica


if __name__ == "__main__":
    # Este corre en el 8080. El agente_pro corre en el 8081.
    print("🚀 Webhook MeLi escuchando en puerto 8080...")
    app.run(host="0.0.0.0", port=8080)
