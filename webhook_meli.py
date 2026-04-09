import os
import re
import json
import requests
import threading
import time
from flask import Flask, request, jsonify, render_template
from dotenv import load_dotenv
from app.core import obtener_respuesta_ia, configurar_ia
from app.utils import enviar_whatsapp_reporte, refrescar_token_meli

load_dotenv()
app = Flask(__name__, template_folder="app/templates")
configurar_ia(app)


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
            f"📩 [MELI-MSG] Notificación messages recibida. Resource: '{resource}' | Payload completo: {json.dumps(data, default=str)[:500]}"
        )
        if resource:
            hilo = threading.Thread(
                target=_procesar_mensaje_posventa, args=(resource,), daemon=True
            )
            hilo.start()

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
            hilo = threading.Thread(target=procesar_nueva_pregunta, args=(question_id,))
            hilo.start()
    return jsonify({"status": "ok"}), 200


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
    return render_template("chat.html")


# ── HELPER: verificación de token ────────────────────────────────────────────
def _token_valido():
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    return token == os.getenv("CHAT_API_TOKEN", "")


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


from app.monitor import iniciar_monitor, incrementar_metrica

iniciar_monitor()


# ── MONITOR DE PREGUNTAS SIN RESPONDER ────────────────────────────────────────
def _monitor_preguntas_sin_responder():
    """
    Cada 10 minutos consulta MeLi por preguntas sin responder.
    - Si encuentra una nueva → la procesa por el flujo de preventa.
    - Si ya está en cola (pendiente) desde hace más de 10 min → re-notifica al grupo.
    """
    import json
    from datetime import datetime, timedelta

    PENDIENTES_PATH = "app/data/preguntas_pendientes_preventa.json"
    GRUPO = os.getenv("GRUPO_PREVENTA_WA", "120363393955474672@g.us")
    INTERVALO = 1800  # 30 minutos

    while True:
        time.sleep(INTERVALO)
        try:
            token = refrescar_token_meli()
            if not token:
                continue

            res = requests.get(
                "https://api.mercadolibre.com/my/received_questions/search?status=UNANSWERED&limit=20",
                headers={"Authorization": f"Bearer {token}"},
                timeout=15,
            )
            if res.status_code != 200:
                continue

            preguntas_meli = res.json().get("questions", [])

            # Leer cola local
            try:
                with open(PENDIENTES_PATH, "r", encoding="utf-8") as f:
                    data = json.load(f)
                pendientes = data.get("preguntas", [])
            except Exception:
                pendientes = []

            ids_unanswered_meli = {str(q["id"]) for q in preguntas_meli}
            ids_conocidos = {str(p["question_id"]) for p in pendientes}
            modificado = False
            ahora = datetime.now()

            # Auto-marcar como respondidas las que ya no están en UNANSWERED de MeLi
            for p in pendientes:
                if (
                    not p.get("respondida")
                    and str(p["question_id"]) not in ids_unanswered_meli
                ):
                    p["respondida"] = True
                    p["nota"] = f"Auto-marcada respondida por monitor {ahora.date()}"
                    modificado = True
                    print(f"✅ [MONITOR] Auto-marcada respondida: {p['question_id']}")

            # Procesar nuevas y enviar recordatorios solo de las realmente pendientes en MeLi
            for q in preguntas_meli:
                qid = str(q["id"])

                if qid not in ids_conocidos:
                    # Nueva — procesar por flujo preventa
                    print(f"🔍 [MONITOR] Nueva pregunta detectada: {qid}")
                    hilo = threading.Thread(
                        target=procesar_nueva_pregunta, args=(qid,), daemon=True
                    )
                    hilo.start()
                else:
                    # Ya en cola y confirmada UNANSWERED en MeLi → reintentar IA, o recordatorio
                    p = next(
                        (
                            x
                            for x in pendientes
                            if str(x["question_id"]) == qid and not x.get("respondida")
                        ),
                        None,
                    )
                    if p:
                        ts = datetime.fromisoformat(p["timestamp"])
                        minutos = (ahora - ts).total_seconds() / 60
                        if minutos >= 30:
                            # Intentar responder automáticamente antes de escalar al humano
                            titulo = p.get("titulo_producto", "")
                            pregunta_txt = p.get("pregunta", "")
                            respondida_ahora = False
                            try:
                                from app.services.google_services import (
                                    buscar_ficha_tecnica_producto,
                                )
                                from app.services.meli_preventa import (
                                    generar_respuesta_con_ficha,
                                    guardar_caso_preventa,
                                )

                                ficha = buscar_ficha_tecnica_producto(titulo)
                                if ficha:
                                    respuesta_ia = generar_respuesta_con_ficha(
                                        titulo, pregunta_txt, ficha
                                    )
                                    if respuesta_ia:
                                        token_r = refrescar_token_meli()
                                        r_ans = requests.post(
                                            "https://api.mercadolibre.com/answers",
                                            headers={
                                                "Authorization": f"Bearer {token_r}",
                                                "Content-Type": "application/json",
                                            },
                                            json={
                                                "question_id": int(qid),
                                                "text": respuesta_ia,
                                            },
                                            timeout=10,
                                        )
                                        if r_ans.status_code == 200:
                                            p["respondida"] = True
                                            p["nota"] = (
                                                f"Respondida automáticamente por monitor (reintento) {ahora.date()}"
                                            )
                                            guardar_caso_preventa(
                                                titulo, pregunta_txt, respuesta_ia
                                            )
                                            respondida_ahora = True
                                            print(
                                                f"✅ [MONITOR] Pregunta {qid} respondida automáticamente en reintento."
                                            )
                                            enviar_whatsapp_reporte(
                                                f"✅ *PREVENTA RESPONDIDA (reintento)*\n"
                                                f"📦 Producto: {titulo}\n"
                                                f"🗣 Cliente: {pregunta_txt}\n"
                                                f"🤖 IA Respondió: {respuesta_ia[:300]}",
                                                numero_destino=GRUPO,
                                            )
                            except Exception as e_retry:
                                print(
                                    f"⚠️ [MONITOR] Reintento IA falló para {qid}: {e_retry}"
                                )

                            if not respondida_ahora:
                                # IA no pudo → recordatorio al humano
                                sufijo = qid[-3:]
                                enviar_whatsapp_reporte(
                                    f"⏰ *RECORDATORIO PREVENTA PENDIENTE*\n"
                                    f"📦 Producto: {titulo}\n"
                                    f"🗣 Cliente: {pregunta_txt}\n"
                                    f"⌛ Sin responder hace {int(minutos)} min\n\n"
                                    f"✍️ Escribe: resp {sufijo}: tu respuesta",
                                    numero_destino=GRUPO,
                                )

                            # Actualizar timestamp para no re-ejecutar hasta 30 min después
                            p["timestamp"] = ahora.isoformat()
                            modificado = True

            # Persistir cambios — RE-LEER archivo para no sobreescribir cambios
            # hechos por obtener_pregunta_pendiente() durante el procesamiento
            if modificado:
                try:
                    # Re-leer el archivo actual para ver si algo cambió
                    try:
                        with open(PENDIENTES_PATH, "r", encoding="utf-8") as f:
                            data_actual = json.load(f)
                        pendientes_actual = data_actual.get("preguntas", [])
                    except Exception:
                        pendientes_actual = []

                    # Crear lookup de estado actual en disco
                    estado_disco = {str(p["question_id"]): p for p in pendientes_actual}

                    # Merge: solo aplicar nuestros cambios si el disco no marcó respondida
                    for p in pendientes:
                        qid = str(p["question_id"])
                        p_disco = estado_disco.get(qid)
                        if (
                            p_disco
                            and p_disco.get("respondida")
                            and not p.get("respondida")
                        ):
                            # El disco ya lo marcó respondida (operador respondió) — respetar
                            continue
                        if p_disco:
                            # Actualizar solo campos que el monitor cambió
                            if p.get("respondida") and not p_disco.get("respondida"):
                                p_disco["respondida"] = True
                                p_disco["nota"] = p.get("nota", "")
                            if p.get("timestamp") != p_disco.get("timestamp"):
                                p_disco["timestamp"] = p["timestamp"]

                    # Agregar preguntas nuevas que no estaban en disco
                    ids_disco = set(estado_disco.keys())
                    for p in pendientes:
                        if str(p["question_id"]) not in ids_disco:
                            pendientes_actual.append(p)

                    with open(PENDIENTES_PATH, "w", encoding="utf-8") as f:
                        json.dump(
                            {"preguntas": pendientes_actual},
                            f,
                            indent=2,
                            ensure_ascii=False,
                        )
                except Exception as e_write:
                    print(f"⚠️ [MONITOR] Error escribiendo pendientes: {e_write}")

        except Exception as e:
            print(f"⚠️ [MONITOR] Error en ciclo de revisión: {e}")


threading.Thread(target=_monitor_preguntas_sin_responder, daemon=True).start()
print("✅ Monitor de preguntas sin responder iniciado (cada 10 min)")


if __name__ == "__main__":
    # Este corre en el 8080. El agente_pro corre en el 8081.
    print("🚀 Webhook MeLi escuchando en puerto 8080...")
    app.run(host="0.0.0.0", port=8080)
