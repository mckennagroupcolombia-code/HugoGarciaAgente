
import os
import requests
import base64
import time
from datetime import datetime, timedelta

# Dependencias de IA y DB Vectorial para la función de aprendizaje
from google import genai
import chromadb

# --- Dependencias del proyecto antiguo ---
# TODO: Refactorizar para que `refrescar_token_meli` viva aquí.
from app.utils import refrescar_token_meli

# --- Funciones de Interacción con Mercado Libre ---

def _obtener_seller_id_meli(token: str) -> str | None:
    """
    GET /users/me → id numérico del vendedor. Necesario para /orders/search:
    el alias `seller=me` responde 403 "caller.id does not match buyer or seller"
    en esta cuenta (confirmado ago-2026) — hay que pasar el id numérico real.
    """
    try:
        res = requests.get(
            "https://api.mercadolibre.com/users/me",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        if res.status_code == 200:
            return str(res.json().get("id") or "").strip() or None
    except requests.RequestException:
        pass
    return None


def consultar_devoluciones_meli():
    """Consulta órdenes canceladas o devueltas en Mercado Libre."""
    print("📡 [MELI] Buscando devoluciones o cancelaciones...")
    token = refrescar_token_meli()
    if not token:
        return "❌ Error: No se pudo obtener el token de Mercado Libre."

    seller_id = _obtener_seller_id_meli(token)
    if not seller_id:
        return "❌ Error: No se pudo obtener el id de vendedor de Mercado Libre."

    # TODO: La fecha de inicio está hard-codeada al futuro, ajustar si es necesario.
    fecha_inicio = "2026-01-01T00:00:00.000-00:00"
    url = f"https://api.mercadolibre.com/orders/search?seller={seller_id}&order.date_created.from={fecha_inicio}"
    headers = {"Authorization": f"Bearer {token}"}

    try:
        res = requests.get(url, headers=headers, timeout=15)
        if res.status_code == 200:
            data = res.json().get('results', [])
            devoluciones = [o for o in data if o.get('status') in ['cancelled', 'invalid']]
            if not devoluciones:
                return "No hay devoluciones o cancelaciones registradas desde la fecha configurada."

            cuerpo_reporte = "LISTADO DE IDs DE DEVOLUCIÓN/CANCELACIÓN:\n"
            for o in devoluciones:
                cuerpo_reporte += f"- ID: {o.get('pack_id') or o.get('id')} | Estado: {o.get('status')}\n"
            return cuerpo_reporte
        return f"Error consultando Mercado Libre: {res.status_code} - {res.text}"
    except requests.RequestException as e:
        return f"Error de red consultando Mercado Libre: {e}"


def listar_ordenes_meli_por_estado(status: str, dias_atras: int = 90, fecha_hasta: str | None = None) -> list[dict]:
    """
    Todas las órdenes MeLi con el `status` dado (ej. "cancelled", "paid")
    desde hace `dias_atras` días, paginado completo. A diferencia de
    `consultar_devoluciones_meli` (texto, una sola página, pensado para el
    chat), esta devuelve los dicts crudos de la API.

    `fecha_hasta` (YYYY-MM-DD, opcional) acota `order.date_created.to` —
    IMPORTANTE: `/orders/search` rechaza offset > 10000 (confirmado ago-2026,
    ver `app.services.salud_negocio`), así que para rangos largos (varios
    meses) hay que llamar esta función una vez POR RANGO ACOTADO en vez de
    una sola vez con `dias_atras` grande — de lo contrario la paginación se
    corta silenciosamente (solo hace `print` del error y devuelve lo
    acumulado hasta ahí) y el resultado queda truncado sin avisar al llamador.
    """
    token = refrescar_token_meli()
    if not token:
        return []
    seller_id = _obtener_seller_id_meli(token)
    if not seller_id:
        return []

    fecha_inicio = (datetime.now() - timedelta(days=dias_atras)).strftime("%Y-%m-%dT00:00:00.000-00:00")
    url = "https://api.mercadolibre.com/orders/search"
    headers = {"Authorization": f"Bearer {token}"}
    params = {
        "seller": seller_id,
        "order.date_created.from": fecha_inicio,
        "order.status": status,
        "sort": "date_desc",
        "limit": 50,
        "offset": 0,
    }
    if fecha_hasta:
        params["order.date_created.to"] = f"{fecha_hasta}T23:59:59.999-00:00"

    todas: list[dict] = []
    offset = 0
    while True:
        params["offset"] = offset
        try:
            res = requests.get(url, headers=headers, params=params, timeout=20)
        except requests.RequestException:
            break
        if res.status_code == 429:
            # Rate limit — sin este reintento la paginación se corta a mitad de
            # camino y el llamador recibe una lista truncada sin saberlo
            # (confirmado ago-2026: pasó en pleno cálculo de salud del negocio).
            time.sleep(1.5)
            try:
                res = requests.get(url, headers=headers, params=params, timeout=20)
            except requests.RequestException:
                break
        if res.status_code != 200:
            print(f"⚠️ [MELI] Error listando órdenes '{status}' (offset {offset}): {res.status_code} {res.text[:200]}")
            break
        data = res.json()
        results = data.get("results", [])
        todas.extend(results)
        total = (data.get("paging") or {}).get("total", 0)
        offset += len(results)
        if offset >= total or not results:
            break
    return todas


def listar_ordenes_canceladas_meli(dias_atras: int = 90) -> list[dict]:
    """Compatibilidad: usada por el cron de notas crédito automáticas."""
    return listar_ordenes_meli_por_estado("cancelled", dias_atras=dias_atras)

def consultar_detalle_venta_meli(pack_id: str):
    """Consulta los detalles de una orden o paquete (pack) específico en Mercado Libre."""
    print(f"📡 [MELI] Consultando detalle de venta ID: {pack_id}")
    token = refrescar_token_meli()
    if not token:
        return "❌ Error: No se pudo obtener el token de Mercado Libre."
    
    url = f"https://api.mercadolibre.com/orders/{pack_id}"
    headers = {"Authorization": f"Bearer {token}"}
    try:
        res = requests.get(url, headers=headers, timeout=10)
        if res.status_code == 200:
            data = res.json()
            return (f"✅ Venta {pack_id} encontrada.\n"
                    f"- Fecha: {data.get('date_created')}\n"
                    f"- Estado: {data.get('status')}\n"
                    f"- Valor: ${data.get('total_amount')}")
        return f"No se encontró la venta {pack_id} (Código de error: {res.status_code})."
    except requests.RequestException as e:
        return f"Error de red consultando detalle de venta en Meli: {e}"


def consultar_envio_meli(shipping_id: str) -> dict | None:
    """GET /shipments/{id} crudo. None si falla la consulta. Usado para detectar 'delivered'."""
    token = refrescar_token_meli()
    if not token:
        return None
    try:
        res = requests.get(
            f"https://api.mercadolibre.com/shipments/{shipping_id}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
    except requests.RequestException:
        return None
    if res.status_code != 200:
        return None
    try:
        return res.json()
    except ValueError:
        return None


def consultar_orden_meli_completa(order_id: str, *, token: str | None = None) -> dict | None:
    """GET /orders/{id} crudo (a diferencia de consultar_detalle_venta_meli, que devuelve texto).

    `token`: opcional, para reusar un token ya refrescado en llamadas en lote
    (ej. Astro Killer armando el detalle de N ventas) — `refrescar_token_meli()`
    hace un refresh OAuth completo cada vez que se llama sin esto, y llamarlo
    una vez por orden en un loop es innecesariamente lento."""
    token = token or refrescar_token_meli()
    if not token:
        return None
    try:
        res = requests.get(
            f"https://api.mercadolibre.com/orders/{order_id}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
    except requests.RequestException:
        return None
    if res.status_code != 200:
        return None
    try:
        return res.json()
    except ValueError:
        return None


def consultar_billing_info_meli(order_id: str, *, token: str | None = None) -> dict | None:
    """GET /orders/{id}/billing_info — datos fiscales REALES del comprador (nombre,
    doc_type/doc_number, dirección) que el comprador cargó en MeLi para facturación.

    Confirmado en vivo el 2026-09-04 contra MCO: a diferencia de `orders/{id}.buyer`
    y `shipments/{id}.receiver_address` (que NO traen cédula/NIT), este endpoint sí
    lo expone — es lo que usaba Astroselling antes de la integración propia. 404 si
    la orden no tiene billing_info cargado; 403 si la orden no es de este vendedor.
    Devuelve el dict `billing_info` crudo (con `additional_info`) o None si falla."""
    token = token or refrescar_token_meli()
    if not token:
        return None
    try:
        res = requests.get(
            f"https://api.mercadolibre.com/orders/{order_id}/billing_info",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
    except requests.RequestException:
        return None
    if res.status_code != 200:
        return None
    try:
        return res.json().get("billing_info")
    except ValueError:
        return None


def consultar_item_meli_basico(item_id: str, *, token: str | None = None) -> dict | None:
    """GET /items/{id} crudo (seller_custom_field, title, etc.). `token`: ver
    `consultar_orden_meli_completa` — reusar en llamadas en lote."""
    token = token or refrescar_token_meli()
    if not token:
        return None
    try:
        res = requests.get(
            f"https://api.mercadolibre.com/items/{item_id}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
    except requests.RequestException:
        return None
    if res.status_code != 200:
        return None
    try:
        return res.json()
    except ValueError:
        return None


def actualizar_seller_custom_field_meli(item_id: str, sku: str) -> str:
    """PUT /items/{id} para cargar el SKU propio (seller_custom_field) en una publicación MeLi."""
    token = refrescar_token_meli()
    if not token:
        return "❌ Error: No se pudo obtener el token de Mercado Libre."
    sku = (sku or "").strip()
    if not sku:
        return "❌ Error: SKU vacío."
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    try:
        res = _request_meli(
            "PUT",
            f"https://api.mercadolibre.com/items/{item_id}",
            headers=headers,
            json={"seller_custom_field": sku},
        )
    except requests.RequestException as e:
        return f"❌ Error de red actualizando seller_custom_field de {item_id}: {e}"
    if res is not None and res.status_code in (200, 201):
        return f"✅ SKU '{sku}' cargado en {item_id}."
    detalle = f"{res.status_code} - {res.text}" if res is not None else "sin respuesta"
    return f"❌ Error actualizando seller_custom_field de {item_id}: {detalle}"


def meli_pack_tiene_documento_fiscal(pack_id: str, *, token: str | None = None) -> bool:
    """
    Indica si el pack ya tiene documento fiscal en MeLi.

    orders/search y GET /orders/{id} no incluyen fiscal_documents (suelen venir None);
    la fuente fiable es GET /packs/{pack_id}/fiscal_documents.
    """
    pack_id = str(pack_id or "").strip()
    if not pack_id:
        return False
    token = token or refrescar_token_meli()
    if not token:
        return False
    url = f"https://api.mercadolibre.com/packs/{pack_id}/fiscal_documents"
    headers = {"Authorization": f"Bearer {token}"}
    try:
        res = requests.get(url, headers=headers, timeout=15)
        if res.status_code != 200:
            return False
        docs = res.json().get("fiscal_documents") or []
        return bool(docs)
    except requests.RequestException:
        return False


def eliminar_documentos_fiscales_meli(pack_id: str, *, token: str | None = None) -> tuple[bool, str]:
    """
    DELETE /packs/{pack_id}/fiscal_documents — borra TODOS los documentos
    fiscales subidos a ese pack. MeLi solo admite un documento fiscal por
    pack y tipo (ver `subir_factura_meli`): para reemplazar la factura por
    una nota crédito (o viceversa) hay que borrar primero. Siigo conserva
    ambos documentos siempre; esto solo afecta lo que MeLi expone.
    """
    pack_id = str(pack_id or "").strip()
    if not pack_id:
        return False, "Sin pack_id."
    token = token or refrescar_token_meli()
    if not token:
        return False, "No se pudo obtener el token de Mercado Libre."
    url = f"https://api.mercadolibre.com/packs/{pack_id}/fiscal_documents"
    try:
        res = requests.delete(url, headers={"Authorization": f"Bearer {token}"}, timeout=20)
        if res.status_code in (200, 204, 404):
            # 404: ya no había documento — el resultado que queremos igual.
            return True, ""
        return False, f"{res.status_code} - {res.text[:300]}"
    except requests.RequestException as e:
        return False, str(e)


def subir_factura_meli(pack_id, documento_base64, formato: str = "pdf", prefijo_archivo: str = "Fac"):
    """
    Sube documento fiscal al pack en Mercado Libre (Colombia: PDF y/o XML DIAN).
    formato: \"pdf\" (default) o \"xml\" — ver docs MeLi `fiscal_documents`.
    prefijo_archivo: prefijo del nombre de archivo subido (default "Fac"; usar
    "NC" para notas crédito — así el listado de fiscal_documents del pack
    distingue cuál es cuál sin tener que abrir cada PDF).
    """
    try:
        fmt = (formato or "pdf").strip().lower()
        if fmt == "xml":
            mime, ext = "application/xml", "xml"
        else:
            fmt = "pdf"
            mime, ext = "application/pdf", "pdf"

        # Limpieza del string base64
        pdf_puro = str(documento_base64).strip().replace("\n", "").replace("\r", "")
        if "," in pdf_puro:
            pdf_puro = pdf_puro.split(",", 1)[1]

        padding = "=" * (-len(pdf_puro) % 4)
        pdf_decodificado = base64.b64decode(pdf_puro + padding, validate=True)
        if not _documento_fiscal_meli_valido(pdf_decodificado, fmt):
            return f"❌ Documento fiscal {fmt.upper()} vacío o inválido; no se subió a Mercado Libre."

        token = refrescar_token_meli()
        if not token:
            return "❌ Error: No se pudo obtener el token de Mercado Libre para la subida."

        url = f"https://api.mercadolibre.com/packs/{pack_id}/fiscal_documents"
        headers = {"Authorization": f"Bearer {token}"}
        files = {
            "fiscal_document": (f"{prefijo_archivo}_{pack_id}.{ext}", pdf_decodificado, mime)
        }
        
        res = requests.post(url, headers=headers, files=files, timeout=30)
        
        if res.status_code in [200, 201, 202]:
            return "✅"
        else:
            print(f"⚠️ Error subiendo factura a Meli (ID: {pack_id}): {res.status_code} - {res.text}")
            return f"❌ {res.text}"
            
    except Exception as e:
        print(f"⚠️ Error crítico subiendo factura a Meli: {e}")
        return f"⚠️ Error: {e}"


def _documento_fiscal_meli_valido(raw: bytes, formato: str) -> bool:
    if not raw or len(raw.strip()) < 32:
        return False
    if formato == "xml":
        inicio = raw.lstrip()[:256].lower()
        if not inicio.startswith((b"<?xml", b"<attached", b"<invoice", b"<creditnote", b"<applicationresponse")):
            return False
        muestra = raw[:200000].lower()
        return any(
            tag in muestra
            for tag in (
                b"<invoice",
                b":invoice",
                b"<attacheddocument",
                b":attacheddocument",
                b"<creditnote",
                b":creditnote",
            )
        )
    return raw.lstrip().startswith(b"%PDF")

def aprender_de_interacciones_meli():
    """Descarga preguntas recientes de MeLi, las resume con Gemini y las guarda como aprendizaje en ChromaDB."""
    print("🎓 [APRENDIZAJE MELI] Iniciando extracción y asimilación de conocimiento...")
    
    # --- Inicialización de servicios (a ser refactorizado a un config central) ---
    try:
        client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))
        chroma_client = chromadb.PersistentClient(path="./memoria_vectorial")
        coleccion_experiencia = chroma_client.get_or_create_collection(name="mckenna_brain")
    except Exception as e:
        return f"❌ Error Crítico: No se pudieron inicializar los servicios de IA/DB. Revisa la configuración. Error: {e}"

    # --- Lógica principal ---
    token = refrescar_token_meli()
    if not token:
        return "❌ Error: No se pudo obtener el token de Mercado Libre para el aprendizaje."

    url = "https://api.mercadolibre.com/my/received_questions/search?status=ANSWERED&limit=15"
    headers = {"Authorization": f"Bearer {token}"}

    try:
        res = requests.get(url, headers=headers)
        if res.status_code == 200:
            preguntas = res.json().get('questions', [])
            if not preguntas:
                return "✅ No hay interacciones nuevas para asimilar en este momento."

            # Construir un texto coherente para el resumen de la IA
            texto_bruto = "Historial de interacciones recientes con clientes en Mercado Libre:\n"
            for q in preguntas:
                texto_bruto += f"- Pregunta del cliente: {q.get('text')}\n  - Nuestra respuesta: {q.get('answer', {}).get('text')}\n\n"

            prompt = (
                f"Actúa como un técnico en farmacología experto en atención al cliente para materias primas y productos químicos. "
                f"Tu tarea es analizar el siguiente historial de preguntas y respuestas de Mercado Libre. "
                f"Identifica los patrones, las dudas más comunes, las soluciones aportadas y los problemas recurrentes (como envíos, dosificación, "
                f"falta de documentación, fichas técnicas o certificados de calidad). "
                f"Basándote en los parámetros del negocio, resuelve la problemática sugiriendo acciones concretas para que el agente virtual "
                f"(Hugo Garcia) o el equipo humano implementen. Resume esto en un párrafo conciso y denso, formulado como una "
                f"'lección aprendida' o una 'experiencia clave' para mejorar el servicio y la eficiencia, enfatizando la "
                f"precisión técnica y de seguridad farmacológica/química."
                f"\n--- HISTORIAL ---\n{texto_bruto}"
            )
            
            response = client.models.generate_content(
                model='gemini-2.5-pro',
                contents=prompt
            )
            aprendizaje_generado = response.text

            # Guardar el aprendizaje en la base de datos vectorial
            doc_id = f"exp_meli_{int(time.time())}"
            coleccion_experiencia.add(
                documents=[aprendizaje_generado],
                metadatas=[{"fuente": "meli_qa_auto", "fecha": str(datetime.now().date())}],
                ids=[doc_id]
            )
            
            print("✅ [CONOCIMIENTO ADQUIRIDO] La memoria del agente ha sido actualizada.")
            return f"Aprendizaje completado. Resumen asimilado: {aprendizaje_generado}"
        else:
            return f"❌ Error extrayendo datos de MeLi para aprendizaje: {res.status_code} - {res.text}"
    except Exception as e:
        return f"❌ Fallo crítico durante el proceso de aprendizaje: {e}"

def responder_solicitud_rut(order_id: str):
    """
    Envía el mensaje de solicitud de RUT a un cliente en Mercado Libre.
    Recibe el ID de la orden como string (ej: '1234567890').
    """
    try:
        # Limpia el ID para eliminar prefijos como "Venta #" y espacios.
        clean_id = str(order_id).replace("Venta #", "").strip()
        
        # TODO: Aquí se implementaría la lógica real para enviar el mensaje
        # a través de la API de mensajería de Mercado Libre.
        print(f"📦 [MELI-RUT] Enviando mensaje de RUT a la orden: {clean_id}")
        
        return f"✅ Solicitud de RUT procesada para la orden {clean_id}."
    except Exception as e:
        return f"❌ Error técnico en la herramienta de envío de RUT: {str(e)}"

def actualizar_stock_meli(sku: str, nuevo_stock: int) -> str:
    """
    Busca publicaciones activas en MeLi por SKU (seller_custom_field) y actualiza
    su available_quantity al valor indicado.
    Retorna un mensaje con el resultado de la operación por cada ítem encontrado.
    """
    print(f"📡 [MELI-STOCK] Actualizando stock de SKU '{sku}' a {nuevo_stock} unidades...")
    token = refrescar_token_meli()
    if not token:
        return "❌ Error: No se pudo obtener el token de Mercado Libre."

    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    try:
        # 1. Obtener el seller_id del vendedor autenticado
        res_me = requests.get("https://api.mercadolibre.com/users/me", headers=headers, timeout=10)
        if res_me.status_code != 200:
            return f"❌ Error obteniendo seller_id de MeLi: {res_me.status_code}"
        seller_id = res_me.json().get('id')

        # 2. Buscar publicaciones activas con ese SKU
        res_search = requests.get(
            f"https://api.mercadolibre.com/users/{seller_id}/items/search",
            params={"seller_sku": sku, "status": "active"},
            headers=headers,
            timeout=10
        )
        if res_search.status_code != 200:
            return f"❌ Error buscando ítems por SKU '{sku}' en MeLi: {res_search.status_code}"

        item_ids = res_search.json().get("results", [])
        if not item_ids:
            return f"⚠️ SKU '{sku}' no encontrado en publicaciones activas de MeLi."

        # 3. Actualizar available_quantity en cada publicación encontrada
        resultados = [_actualizar_stock_meli_item(item_id, nuevo_stock, headers) for item_id in item_ids]
        return " | ".join(resultados)

    except requests.RequestException as e:
        return f"⚠️ Error de red actualizando stock en MeLi (SKU: {sku}): {e}"
    except Exception as e:
        return f"❌ Error inesperado actualizando stock en MeLi (SKU: {sku}): {e}"


def actualizar_stock_meli_por_item_id(item_id: str, nuevo_stock: int) -> str:
    """
    Actualiza el stock directamente por item_id de MeLi (MCOxxxxxxxx), sin depender
    de que el SKU coincida con el atributo SELLER_SKU de la publicación (ese atributo
    suele diferir en mayúsculas/formato del SKU registrado en Sheets, lo que hace
    fallar la búsqueda por seller_sku en `actualizar_stock_meli`).
    """
    print(f"📡 [MELI-STOCK] Actualizando stock de item '{item_id}' a {nuevo_stock} unidades...")
    token = refrescar_token_meli()
    if not token:
        return "❌ Error: No se pudo obtener el token de Mercado Libre."

    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    return _actualizar_stock_meli_item(item_id, nuevo_stock, headers)


def _es_error_transitorio_meli(status_code: int, cuerpo: str = "") -> bool:
    """502/503/504 y mensajes de proxy (p.ej. Cloudflare/nginx 'no healthy upstream')."""
    if int(status_code or 0) in (429, 502, 503, 504):
        return True
    c = (cuerpo or "").lower()
    return any(
        x in c
        for x in (
            "no healthy upstream",
            "temporarily_unavailable",
            "temporarily unavailable",
            "service unavailable",
            "gateway timeout",
            "too many requests",
        )
    )


def _request_meli(
    method: str,
    url: str,
    *,
    headers: dict,
    json: dict | None = None,
    timeout: int = 20,
    intentos: int = 4,
):
    """HTTP a MeLi con reintentos ante caídas de proxy / rate limit."""
    ultimo = None
    for i in range(max(1, intentos)):
        try:
            res = requests.request(
                method.upper(), url, headers=headers, json=json, timeout=timeout
            )
            ultimo = res
            if res.status_code in (200, 201):
                return res
            if _es_error_transitorio_meli(res.status_code, res.text or "") and i < intentos - 1:
                espera = 0.7 * (i + 1)
                print(
                    f"⏳ [MELI-STOCK] {method} {res.status_code} transitorio — "
                    f"reintento {i + 2}/{intentos} en {espera:.1f}s"
                )
                time.sleep(espera)
                continue
            return res
        except requests.RequestException as e:
            if i >= intentos - 1:
                raise
            espera = 0.7 * (i + 1)
            print(f"⏳ [MELI-STOCK] red {e} — reintento {i + 2}/{intentos} en {espera:.1f}s")
            time.sleep(espera)
    return ultimo


def _reactivar_item_meli_si_pausada(
    item_id: str,
    headers: dict,
    nuevo_stock: int,
    *,
    estaba_pausada: bool | None = None,
) -> str:
    """
    MeLi pausa sola las publicaciones en cero (sub_status out_of_stock). En cuentas
    multi-bodega el PUT de stock suele aceptar antes de que el ítem refleje
    available_quantity; hay que esperar la propagación. Con stock > 0 MeLi a veces
    reactiva sola; si no, se hace PUT status=active.
    """
    if int(nuevo_stock) <= 0:
        return ""

    import time

    vista_pausada = bool(estaba_pausada)
    ultimo_status = ""
    ultimo_qty = None
    ultimo_err = ""

    for intento in range(10):
        try:
            res = requests.get(
                f"https://api.mercadolibre.com/items/{item_id}", headers=headers, timeout=10
            )
            if res.status_code != 200:
                time.sleep(1.2)
                continue
            item = res.json() or {}
            status = str(item.get("status") or "").lower()
            ultimo_status = status
            if item.get("variations"):
                qty = sum(int(v.get("available_quantity") or 0) for v in item["variations"])
            else:
                qty = int(item.get("available_quantity") or 0)
            ultimo_qty = qty

            if status in ("closed", "inactive"):
                return f" · ⚠️ no reactivable (estado {status})"

            if status != "active":
                vista_pausada = True

            if status == "active" and qty > 0:
                if vista_pausada or estaba_pausada:
                    print(
                        f"✅ [MELI-STOCK] {item_id} activa con {qty} uds "
                        f"(tras stock {nuevo_stock}, intento {intento + 1})"
                    )
                    return " · reactivada"
                return ""

            # Stock ya visible en el ítem pero sigue pausada → activar
            if status == "paused" and qty > 0:
                put = requests.put(
                    f"https://api.mercadolibre.com/items/{item_id}",
                    json={"status": "active"},
                    headers={**headers, "Content-Type": "application/json"},
                    timeout=15,
                )
                if put.status_code in (200, 201):
                    print(f"✅ [MELI-STOCK] {item_id} reactivada (stock ítem={qty})")
                    return " · reactivada"
                ultimo_err = f"{put.status_code}: {(put.text or '')[:100]}"
            elif status == "paused" and qty == 0 and intento >= 3:
                # Aún no propagó: intentar activar por si MeLi ya tiene stock interno
                put = requests.put(
                    f"https://api.mercadolibre.com/items/{item_id}",
                    json={"status": "active"},
                    headers={**headers, "Content-Type": "application/json"},
                    timeout=15,
                )
                if put.status_code in (200, 201):
                    print(f"✅ [MELI-STOCK] {item_id} reactivada (antes de reflejar qty)")
                    return " · reactivada"
                ultimo_err = f"{put.status_code}: {(put.text or '')[:100]}"

            time.sleep(1.5)
        except requests.RequestException as e:
            ultimo_err = str(e)
            time.sleep(1.2)
        except Exception as e:
            ultimo_err = str(e)
            time.sleep(1.2)

    detalle = ultimo_err or f"status={ultimo_status} qty={ultimo_qty}"
    return f" · ⚠️ stock enviado; MeLi aún no reactiva ({detalle})"


def cambiar_estado_publicacion_meli(item_id: str, nuevo_estado: str) -> dict:
    """
    Cambia el status de una publicación MeLi entre ``active`` y ``paused``.

    Returns:
        ``{ok, estado, estado_anterior, mensaje, stock?}``
    """
    item_id = (item_id or "").strip().upper()
    destino = (nuevo_estado or "").strip().lower()
    if not item_id:
        return {"ok": False, "mensaje": "meli_id requerido", "estado": None}
    if destino not in ("active", "paused"):
        return {
            "ok": False,
            "mensaje": "estado inválido (solo active o paused)",
            "estado": None,
        }

    token = refrescar_token_meli()
    if not token:
        return {"ok": False, "mensaje": "No se pudo obtener token MeLi", "estado": None}

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    try:
        res_get = requests.get(
            f"https://api.mercadolibre.com/items/{item_id}",
            headers=headers,
            timeout=12,
        )
        if res_get.status_code != 200:
            return {
                "ok": False,
                "mensaje": f"No se pudo leer ítem ({res_get.status_code})",
                "estado": None,
            }
        item = res_get.json() or {}
        actual = str(item.get("status") or "").lower()
        if item.get("variations"):
            qty = sum(int(v.get("available_quantity") or 0) for v in item["variations"])
        else:
            qty = int(item.get("available_quantity") or 0)

        if actual in ("closed", "inactive"):
            return {
                "ok": False,
                "estado": actual,
                "estado_anterior": actual,
                "stock": qty,
                "mensaje": f"No se puede cambiar: publicación {actual}",
            }
        if actual == "under_review":
            return {
                "ok": False,
                "estado": actual,
                "estado_anterior": actual,
                "stock": qty,
                "mensaje": "En revisión: MeLi bloquea el cambio de estado",
            }
        if actual == destino:
            return {
                "ok": True,
                "estado": actual,
                "estado_anterior": actual,
                "stock": qty,
                "mensaje": f"Ya estaba {destino}",
            }
        if destino == "active" and qty <= 0:
            return {
                "ok": False,
                "estado": actual,
                "estado_anterior": actual,
                "stock": qty,
                "mensaje": "Sin stock: pon unidades > 0 antes de activar",
            }

        put = requests.put(
            f"https://api.mercadolibre.com/items/{item_id}",
            json={"status": destino},
            headers=headers,
            timeout=15,
        )
        if put.status_code not in (200, 201):
            err = ""
            try:
                body = put.json() or {}
                err = str(body.get("message") or body.get("error") or "")[:180]
            except Exception:
                err = (put.text or "")[:180]
            return {
                "ok": False,
                "estado": actual,
                "estado_anterior": actual,
                "stock": qty,
                "mensaje": err or f"MeLi rechazó el cambio ({put.status_code})",
            }

        label = "Activa" if destino == "active" else "Pausada"
        print(f"✅ [MELI-STATUS] {item_id}: {actual} → {destino}")
        return {
            "ok": True,
            "estado": destino,
            "estado_anterior": actual,
            "stock": qty,
            "mensaje": f"Publicación {label.lower()} en MeLi",
        }
    except requests.RequestException as e:
        return {"ok": False, "mensaje": f"Error de red MeLi: {e}", "estado": None}


def _actualizar_stock_meli_item(item_id: str, nuevo_stock: int, headers: dict) -> str:
    """
    Actualiza stock de un ítem. Si tiene user_product_id (cuenta multi-bodega),
    escribe directo en seller_warehouse — evita PUT available_quantity que MeLi
    rechaza o a veces responde 503. Reintenta ante errores de proxy.
    """
    nuevo_stock = int(nuevo_stock)
    try:
        res_item = _request_meli(
            "GET",
            f"https://api.mercadolibre.com/items/{item_id}",
            headers=headers,
            timeout=15,
        )
        if res_item is not None and res_item.status_code == 200:
            if (res_item.json() or {}).get("user_product_id"):
                return _actualizar_stock_meli_multibodega(item_id, nuevo_stock, headers)

        res_put = _request_meli(
            "PUT",
            f"https://api.mercadolibre.com/items/{item_id}",
            headers=headers,
            json={"available_quantity": nuevo_stock},
            timeout=15,
        )
        if res_put is None:
            return f"❌ {item_id}: sin respuesta de MeLi al actualizar stock"
        if res_put.status_code in (200, 201):
            base = f"✅ {item_id} → {nuevo_stock} uds"
            return base + _reactivar_item_meli_si_pausada(item_id, headers, nuevo_stock)
        cuerpo = res_put.text or ""
        if "multi warehouse" in cuerpo:
            return _actualizar_stock_meli_multibodega(item_id, nuevo_stock, headers)
        if _es_error_transitorio_meli(res_put.status_code, cuerpo):
            # Último recurso: multi-bodega por si el GET falló o el ítem sí tiene UP
            msg_mb = _actualizar_stock_meli_multibodega(item_id, nuevo_stock, headers)
            if "✅" in msg_mb:
                return msg_mb
            return (
                f"❌ {item_id}: MeLi temporalmente no responde "
                f"({res_put.status_code}). Reintenta en unos segundos."
            )
        if "not_modifiable" in cuerpo:
            return (
                f"⚠️ {item_id}: está en Mercado Envíos Full — MeLi administra el stock según el "
                "inventario físico enviado a su bodega. No se puede (ni hace falta) fijarlo desde acá."
            )
        if "field_not_updatable" in cuerpo and nuevo_stock > 0:
            msg_mb = _actualizar_stock_meli_multibodega(item_id, nuevo_stock, headers)
            if "✅" in msg_mb:
                return msg_mb
            res_combo = _request_meli(
                "PUT",
                f"https://api.mercadolibre.com/items/{item_id}",
                headers={**headers, "Content-Type": "application/json"},
                json={"available_quantity": nuevo_stock, "status": "active"},
                timeout=20,
            )
            if res_combo is not None and res_combo.status_code in (200, 201):
                return f"✅ {item_id} → {nuevo_stock} uds · reactivada"
            return (
                f"❌ {item_id}: pausada y no se pudo actualizar/reactivar "
                f"({res_put.status_code}: {cuerpo[:120]})"
            )
        if "field_not_updatable" in cuerpo:
            return (
                f"❌ {item_id}: la publicación no está activa en MeLi (pausada/cerrada/en revisión) "
                "y no permite cambiar el stock. Reactívala en MeLi primero."
            )
        return f"❌ {item_id}: {res_put.status_code} - {cuerpo[:150]}"
    except requests.RequestException as e:
        return f"⚠️ Error de red actualizando stock en MeLi (item: {item_id}): {e}"
    except Exception as e:
        return f"❌ Error inesperado actualizando stock en MeLi (item: {item_id}): {e}"


def _actualizar_stock_meli_multibodega(item_id: str, nuevo_stock: int, headers: dict) -> str:
    """
    Cuentas MeLi con inventario "multi-bodega" no aceptan `available_quantity` en el
    ítem — el stock real vive en `/user-products/{user_product_id}/stock`, ubicación
    `seller_warehouse`. Requiere leer primero `x-version` (control de concurrencia)
    y el `store_id` de la bodega antes de escribir.
    Tras cargar stock > 0, reactiva si MeLi la tenía pausada por falta de inventario.
    """
    nuevo_stock = int(nuevo_stock)
    try:
        res_item = _request_meli(
            "GET",
            f"https://api.mercadolibre.com/items/{item_id}",
            headers=headers,
            timeout=15,
        )
        if res_item is None or res_item.status_code != 200:
            code = getattr(res_item, "status_code", "?")
            return f"❌ {item_id}: no se pudo leer el producto para stock multi-bodega ({code})"
        item_data = res_item.json() or {}
        user_product_id = item_data.get("user_product_id")
        estaba_pausada = str(item_data.get("status") or "").lower() == "paused"
        if not user_product_id:
            return f"❌ {item_id}: cuenta multi-bodega pero el ítem no tiene user_product_id asociado."

        res_stock = _request_meli(
            "GET",
            f"https://api.mercadolibre.com/user-products/{user_product_id}/stock",
            headers=headers,
            timeout=15,
        )
        if res_stock is None or res_stock.status_code != 200:
            code = getattr(res_stock, "status_code", "?")
            return f"❌ {item_id}: no se pudo leer stock multi-bodega ({code})"
        x_version = res_stock.headers.get("x-version", "")
        bodega = next(
            (l for l in res_stock.json().get("locations", []) if l.get("type") == "seller_warehouse"),
            None,
        )
        if not bodega:
            return f"❌ {item_id}: no tiene bodega propia (seller_warehouse) configurada en MeLi."

        put_headers = {**headers, "Content-Type": "application/json", "x-version": x_version}
        body = {
            "locations": [
                {
                    "type": "seller_warehouse",
                    "store_id": bodega.get("store_id"),
                    "network_node_id": bodega.get("network_node_id"),
                    "quantity": nuevo_stock,
                }
            ]
        }
        res_put = _request_meli(
            "PUT",
            f"https://api.mercadolibre.com/user-products/{user_product_id}/stock/type/seller_warehouse",
            headers=put_headers,
            json=body,
            timeout=20,
            intentos=5,
        )
        if res_put is not None and res_put.status_code in (200, 201):
            base = f"✅ {item_id} (multi-bodega) → {nuevo_stock} uds"
            return base + _reactivar_item_meli_si_pausada(
                item_id, headers, nuevo_stock, estaba_pausada=estaba_pausada
            )
        code = getattr(res_put, "status_code", "?")
        text = (getattr(res_put, "text", None) or "")[:150]
        if _es_error_transitorio_meli(int(code) if str(code).isdigit() else 0, text):
            return (
                f"❌ {item_id}: MeLi temporalmente no responde ({code}). "
                "Espera unos segundos y vuelve a Guardar."
            )
        return f"❌ {item_id} (multi-bodega): {code} - {text}"
    except requests.RequestException as e:
        return f"⚠️ Error de red actualizando stock multi-bodega en MeLi (item: {item_id}): {e}"
    except Exception as e:
        return f"❌ Error inesperado actualizando stock multi-bodega en MeLi (item: {item_id}): {e}"


def _item_ids_meli_por_sku(sku: str, seller_id, headers: dict) -> list[str]:
    """Resuelve item_ids MeLi: búsqueda por seller_sku, variantes de caso y fallbacks locales."""
    sku = (sku or "").strip()
    if not sku:
        return []

    seen: set[str] = set()
    item_ids: list[str] = []

    def _add(ids: list) -> None:
        for iid in ids or []:
            iid = str(iid).strip()
            if iid and iid not in seen:
                seen.add(iid)
                item_ids.append(iid)

    variants: list[str] = []
    for v in (sku, sku.upper(), sku.lower()):
        if v and v not in variants:
            variants.append(v)

    for variant in variants:
        for status in ("active", "paused"):
            try:
                res = requests.get(
                    f"https://api.mercadolibre.com/users/{seller_id}/items/search",
                    params={"seller_sku": variant, "status": status},
                    headers=headers,
                    timeout=12,
                )
                if res.status_code == 200:
                    _add(res.json().get("results") or [])
            except requests.RequestException:
                pass
        if item_ids:
            return item_ids

    try:
        from app.services.publicaciones import _meli_id_efectivo_sku

        mid = _meli_id_efectivo_sku(sku)
        if mid:
            _add([mid])
    except Exception:
        pass

    if not item_ids:
        try:
            from app.tools.meli_compliance_monitor import indice_reemplazos

            for key in (sku, sku.upper(), sku.lower()):
                entry = indice_reemplazos().get("by_sku", {}).get(key) or {}
                mid = (entry.get("item_id") or "").strip()
                if mid:
                    _add([mid])
                    break
        except Exception:
            pass

    return item_ids


def actualizar_precio_meli_por_sku(
    sku: str,
    nuevo_precio: float,
    meli_id: str | None = None,
) -> dict:
    """
    Busca publicaciones en MeLi por SKU (y fallbacks) y actualiza su precio.
    Si se pasa meli_id (p. ej. desde Ganancia), se usa de forma prioritaria.
    Retorna {"ok": bool, "msg": str, "items": list}.
    """
    token = refrescar_token_meli()
    if not token:
        return {"ok": False, "msg": "No se pudo obtener token MeLi"}

    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    try:
        res_me = requests.get("https://api.mercadolibre.com/users/me", headers=headers, timeout=10)
        if res_me.status_code != 200:
            return {"ok": False, "msg": f"Error obteniendo seller_id: {res_me.status_code}"}
        seller_id = res_me.json().get("id")

        item_ids: list[str] = []
        mid = (meli_id or "").strip().upper()
        if mid.startswith("MCO"):
            item_ids = [mid]
        if not item_ids:
            item_ids = _item_ids_meli_por_sku(sku, seller_id, headers)
        if not item_ids:
            return {
                "ok": False,
                "msg": (
                    f"SKU '{sku}' sin publicación MeLi vinculada "
                    "(revisa SELLER_SKU en la publicación o vínculo en Publicaciones)."
                ),
            }

        resultados = []
        all_ok = True
        precio_meli = int(round(float(nuevo_precio)))
        for item_id in item_ids:
            res_put = requests.put(
                f"https://api.mercadolibre.com/items/{item_id}",
                json={"price": precio_meli},
                headers=headers,
                timeout=15,
            )
            ok = res_put.status_code in (200, 201)
            err = ""
            if not ok:
                all_ok = False
                try:
                    err = res_put.json().get("message") or res_put.text[:180]
                except Exception:
                    err = (res_put.text or "")[:180]
            resultados.append(
                {
                    "item_id": item_id,
                    "ok": ok,
                    "status": res_put.status_code,
                    "error": err or None,
                }
            )

        ok_count = sum(1 for r in resultados if r["ok"])
        msg = f"{ok_count}/{len(resultados)} publicaciones actualizadas en MeLi"
        if not all_ok:
            detalle = next((r["error"] for r in resultados if not r["ok"] and r.get("error")), "")
            if detalle:
                msg = f"{msg} — {detalle}"
        return {"ok": all_ok, "msg": msg, "items": resultados}

    except requests.RequestException as e:
        return {"ok": False, "msg": f"Error de red MeLi: {e}"}


def buscar_ventas_acordar_entrega(dias: int = 3):
    """
    Busca ventas con envío 'A acordar con el comprador' en los últimos días.
    Utiliza la API de Mercado Libre para encontrar órdenes que requieren acción manual.
    """
    print(f"🚚 [MELI-ACORDAR] Buscando ventas para acordar entrega (últimos {dias} días)...")
    try:
        token = refrescar_token_meli()
        if not token:
            return "❌ Error: No se pudo obtener el token de Mercado Libre."
            
        headers = {"Authorization": f"Bearer {token}"}
        
        # 1. Obtener el ID del vendedor
        res_me = requests.get("https://api.mercadolibre.com/users/me", headers=headers)
        res_me.raise_for_status() # Lanza un error si la petición falla
        seller_id = res_me.json().get('id')
        
        # 2. Definir el rango de fechas para la búsqueda
        fecha_desde = (datetime.now() - timedelta(days=int(dias))).strftime("%Y-%m-%dT%H:%M:%S.000-00:00")
        
        # 3. Construir y ejecutar la consulta a la API de órdenes
        url = f"https://api.mercadolibre.com/orders/search?seller={seller_id}&order.date_created.from={fecha_desde}"
        res = requests.get(url, headers=headers).json()
        
        ordenes_encontradas = []
        for orden in res.get('results', []):
            shipping_info = orden.get('shipping', {})
            shipping_type = shipping_info.get('substatus') or shipping_info.get('shipping_mode')
            
            # Filtrar por órdenes pagadas y cuyo modo de envío sea para acordar.
            if orden.get('status') == 'paid' and shipping_type in ['to_agree', 'custom', 'not_specified']:
                ordenes_encontradas.append(str(orden.get('id')))
        
        if not ordenes_encontradas:
            return f"✅ No se encontraron ventas pendientes de 'Acordar entrega' en los últimos {dias} días."
            
        # Devolver un formato claro para que el agente lo procese
        ids_str = ",".join(ordenes_encontradas)
        return f"LISTA_PARA_PROCESAR: {ids_str} (Total: {len(ordenes_encontradas)} órdenes)"

    except requests.RequestException as e:
        return f"❌ Error de red buscando ventas para acordar: {e}"
    except Exception as e:
        return f"❌ Error inesperado en la búsqueda de ventas para acordar: {str(e)}"
