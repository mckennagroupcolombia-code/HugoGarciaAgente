
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

def consultar_devoluciones_meli():
    """Consulta órdenes canceladas o devueltas en Mercado Libre."""
    print("📡 [MELI] Buscando devoluciones o cancelaciones...")
    token = refrescar_token_meli()
    if not token:
        return "❌ Error: No se pudo obtener el token de Mercado Libre."

    # TODO: La fecha de inicio está hard-codeada al futuro, ajustar si es necesario.
    fecha_inicio = "2026-01-01T00:00:00.000-00:00"
    url = f"https://api.mercadolibre.com/orders/search?seller=me&order.date_created.from={fecha_inicio}"
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


def subir_factura_meli(pack_id, documento_base64, formato: str = "pdf"):
    """
    Sube documento fiscal al pack en Mercado Libre (Colombia: PDF y/o XML DIAN).
    formato: \"pdf\" (default) o \"xml\" — ver docs MeLi `fiscal_documents`.
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
            "fiscal_document": (f"Fac_{pack_id}.{ext}", pdf_decodificado, mime)
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


def _actualizar_stock_meli_item(item_id: str, nuevo_stock: int, headers: dict) -> str:
    """
    PUT de available_quantity sobre un ítem puntual. Si la cuenta usa inventario
    multi-bodega (MeLi rechaza ese campo con "multi warehouse seller"), reintenta
    con el endpoint de stock por ubicación (`/user-products/{id}/stock/type/seller_warehouse`).
    """
    try:
        res_put = requests.put(
            f"https://api.mercadolibre.com/items/{item_id}",
            json={"available_quantity": int(nuevo_stock)},
            headers=headers,
            timeout=10,
        )
        if res_put.status_code in (200, 201):
            return f"✅ {item_id} → {nuevo_stock} uds"
        cuerpo = res_put.text
        if "multi warehouse" in cuerpo:
            return _actualizar_stock_meli_multibodega(item_id, nuevo_stock, headers)
        if "not_modifiable" in cuerpo:
            return (
                f"⚠️ {item_id}: está en Mercado Envíos Full — MeLi administra el stock según el "
                "inventario físico enviado a su bodega. No se puede (ni hace falta) fijarlo desde acá."
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
    """
    try:
        res_item = requests.get(
            f"https://api.mercadolibre.com/items/{item_id}", headers=headers, timeout=10
        )
        if res_item.status_code != 200:
            return f"❌ {item_id}: no se pudo leer el producto para stock multi-bodega ({res_item.status_code})"
        user_product_id = res_item.json().get("user_product_id")
        if not user_product_id:
            return f"❌ {item_id}: cuenta multi-bodega pero el ítem no tiene user_product_id asociado."

        res_stock = requests.get(
            f"https://api.mercadolibre.com/user-products/{user_product_id}/stock",
            headers=headers,
            timeout=10,
        )
        if res_stock.status_code != 200:
            return f"❌ {item_id}: no se pudo leer stock multi-bodega ({res_stock.status_code})"
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
                    "quantity": int(nuevo_stock),
                }
            ]
        }
        res_put = requests.put(
            f"https://api.mercadolibre.com/user-products/{user_product_id}/stock/type/seller_warehouse",
            headers=put_headers,
            json=body,
            timeout=10,
        )
        if res_put.status_code in (200, 201):
            return f"✅ {item_id} (multi-bodega) → {nuevo_stock} uds"
        return f"❌ {item_id} (multi-bodega): {res_put.status_code} - {res_put.text[:150]}"
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


def actualizar_precio_meli_por_sku(sku: str, nuevo_precio: float) -> dict:
    """
    Busca publicaciones en MeLi por SKU (y fallbacks) y actualiza su precio.
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
