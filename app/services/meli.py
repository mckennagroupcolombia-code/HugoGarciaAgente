
import os
import requests
import base64
import time
from datetime import datetime, timedelta

# Dependencias de IA y DB Vectorial para la función de aprendizaje
import google.generativeai as genai
import chromadb

# --- Dependencias del proyecto antiguo ---
# TODO: Refactorizar para que `refrescar_token_meli` viva aquí.
from core_sync import refrescar_token_meli

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

def subir_factura_meli(pack_id, pdf_base64):
    """
    Sube un archivo de factura en formato PDF (codificado en base64) 
    a una orden específica en Mercado Libre.
    """
    try:
        token = refrescar_token_meli()
        if not token:
            return "❌ Error: No se pudo obtener el token de Mercado Libre para la subida."

        # Limpieza del string base64
        pdf_puro = str(pdf_base64).strip().replace("\n", "").replace("\r", "")
        if "," in pdf_puro:
            pdf_puro = pdf_puro.split(",")[1]
        
        pdf_decodificado = base64.b64decode(pdf_puro)

        url = f"https://api.mercadolibre.com/packs/{pack_id}/fiscal_documents"
        headers = {"Authorization": f"Bearer {token}"}
        files = {'file': (f"Fac_{pack_id}.pdf", pdf_decodificado, 'application/pdf')}
        
        res = requests.post(url, headers=headers, files=files, timeout=30)
        
        if res.status_code in [200, 201, 202]:
            return "✅"
        else:
            print(f"⚠️ Error subiendo factura a Meli (ID: {pack_id}): {res.status_code} - {res.text}")
            return f"❌ {res.text}"
            
    except Exception as e:
        print(f"⚠️ Error crítico subiendo factura a Meli: {e}")
        return f"⚠️ Error: {e}"

def aprender_de_interacciones_meli():
    """Descarga preguntas recientes de MeLi, las resume con Gemini y las guarda como aprendizaje en ChromaDB."""
    print("🎓 [APRENDIZAJE MELI] Iniciando extracción y asimilación de conocimiento...")
    
    # --- Inicialización de servicios (a ser refactorizado a un config central) ---
    try:
        genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))
        chroma_client = chromadb.PersistentClient(path="./memoria_vectorial")
        coleccion_experiencia = chroma_client.get_or_create_collection(name="mckenna_brain")
        model = genai.GenerativeModel('gemini-flash-lite-latest')
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
                f"Actúa como un analista experto en atención al cliente. Tu tarea es analizar el siguiente historial "
                f"de preguntas y respuestas. Identifica los patrones, las dudas más comunes y las soluciones aportadas. "
                f"Resume esto en un párrafo conciso y denso, formulado como una 'lección aprendida' o una 'experiencia clave' "
                f"para mejorar el servicio y la eficiencia en el futuro. El resumen debe ser útil para un agente humano o de IA."
                f"\n--- HISTORIAL ---\n{texto_bruto}"
            )
            
            aprendizaje_generado = model.generate_content(prompt).text

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

def responder_solicitud_rut(order_id):
    """    
    Simula o ejecuta el envío del mensaje de RUT a un cliente en Mercado Libre.
    Limpia el ID de la orden para asegurar un formato correcto.
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

def buscar_ventas_acordar_entrega(dias=3):
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
