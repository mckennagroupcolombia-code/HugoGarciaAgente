import os
import sys


def _webhook_meli_singleton_lock():
    """
    Una sola instancia del proceso webhook (evita doble carga de app.core / Claude).
    Segunda ejecución sale antes de importar Flask y el agente.
    Desactivar solo para depuración: WEBHOOK_MELI_SKIP_SINGLETON_LOCK=1
    """
    if os.environ.get("WEBHOOK_MELI_SKIP_SINGLETON_LOCK", "").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    ):
        return None
    import fcntl
    import time
    from pathlib import Path

    lock_path = Path(__file__).resolve().parent / ".webhook_meli.lock"
    # "a+" evita truncar el archivo antes de flock (truncar con "w" rompe locks ajenos).
    last_err: BlockingIOError | None = None
    for attempt in range(25):  # ~5 s: carrera tras systemctl stop / SIGTERM lento
        fp = open(lock_path, "a+", encoding="utf-8")
        try:
            fcntl.flock(fp.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            last_err = None
            break
        except BlockingIOError as e:
            last_err = e
            fp.close()
            time.sleep(0.2)

    if last_err is not None:
        hint = ""
        try:
            txt = lock_path.read_text(encoding="utf-8").strip().splitlines()
            if txt and txt[0].isdigit():
                pid = int(txt[0])
                hint = f" PID registrado en .webhook_meli.lock: {pid} (comprueba: ps -p {pid} -o args=)"
        except OSError:
            pass
        print(
            "webhook_meli: otra instancia ya está en ejecución (archivo bloqueado)."
            + hint
            + "  Revisa: pgrep -af webhook_meli.py  |  Si no debe haber ninguno: "
            "pkill -f webhook_meli.py; rm -f .webhook_meli.lock; sudo systemctl start webhook-meli",
            file=sys.stderr,
        )
        raise SystemExit(1)

    fp.seek(0)
    fp.truncate()
    fp.write(str(os.getpid()))
    fp.flush()
    return fp


# Mantener FD abierto durante toda la vida del proceso (libera flock al salir).
# No hacemos bind "probe" al 8080 antes de importar: en reinicios de systemd suele
# quedar TIME_WAIT y bind() sin SO_REUSEADDR devuelve EADDRINUSE → exit 1 en bucle.
_WEBHOOK_SINGLETON_LOCK_FP = _webhook_meli_singleton_lock()

import json
import requests
import time
from flask import Flask, request, jsonify, render_template
from dotenv import load_dotenv
from app.core import obtener_respuesta_ia, configurar_ia
from app.utils import enviar_whatsapp_reporte, refrescar_token_meli

_REPO_ROOT = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(_REPO_ROOT, ".env"))
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
from app.meli_postventa_notif import procesar_postventa_meli_desde_webhook
from app.meli_webhook_topics import meli_webhook_evaluar_despacho
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
        source="webhook_meli",
    )

    if not data:
        print("⚠️ [NOTIF] Body vacío o JSON inválido — ignorado.")
        try:
            from app.meli_webhook_incidents import registrar_meli_webhook_incidente

            registrar_meli_webhook_incidente("notif_body_invalido", source="webhook_meli")
        except Exception:
            pass
        return jsonify({"status": "ok"}), 200

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
        registrar_meli_webhook_incidente(
            "postventa_webhook_recibido",
            topic=topic,
            resource=(resource or "")[:500],
            source="webhook_meli",
        )
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
            "orden_omitir_accion_pasiva": (
                f"⏭️ [MELI-ORDER] Evento pasivo omitido. "
                f"actions={data.get('actions')!r}"
            ),
            "postventa_sin_resource": "⚠️ [POSVENTA] messages sin resource, ignorado.",
            "topic_no_manejado": f"ℹ️ [NOTIF] topic={topic!r} no manejado (se ignora).",
        }
        print(_noop_msgs.get(t, f"ℹ️ [NOTIF] tipo plan={t!r}"))
        registrar_meli_webhook_incidente(
            "notif_sin_efecto_util",
            tipo=t,
            topic=topic,
            resource=(resource or "")[:500],
            source="webhook_meli",
        )

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

    from app.api_auth import chat_api_token_matches_request

    if not chat_api_token_matches_request():
        return jsonify({"error": "No autorizado"}), 401
    data = request.get_json()
    if not data:
        return jsonify({"error": "JSON requerido"}), 400
    mensaje = (data.get("mensaje") or "").strip()
    adjuntos = data.get("adjuntos") or data.get("attachments")
    if not mensaje and not adjuntos:
        return jsonify({"error": "Campo 'mensaje' o adjuntos requerido"}), 400
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
    return render_template("chat.html")


# ── HELPER: verificación de token ────────────────────────────────────────────
def _token_valido():
    from app.api_auth import chat_api_token_matches_request

    return chat_api_token_matches_request()


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
