import threading
import gspread
import os
import subprocess
import warnings
import sqlite3
import time
import unicodedata
import base64
import logging
import requests
import json
import re
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import herramientas_agente as tools

# --- NUEVAS LIBRERÍAS DE IA Y VECTORES ---
import google.generativeai as genai
import chromadb # Base de datos vectorial para experiencias

# --- IMPORTACIONES CORE ---
from core_sync import GOOGLE_CREDS_PATH, SPREADSHEET_ID, refrescar_token_meli, ejecutar_sincronizacion_y_reporte
from modulo_posventa import responder_mensaje_posventa, responder_solicitud_rut
from herramientas_agente import buscar_ventas_acordar_entrega


import core_sync 

warnings.filterwarnings("ignore", category=FutureWarning)

app = Flask(__name__)

# ==========================================
# 🛡️ MEMORIA CACHÉ Y ANTIDUPLICADOS
# ==========================================
ultimos_mensajes_cache = {} 
borradores_aprobacion = {}
reportes_enviados_recientemente = {} 
PARTNER_ID = "SiigoAPI"

# 1. Base de Datos Local (SQLite - Datos Duros)
# Crea la DB si no existe. Asegúrate de tener las tablas necesarias creadas en tu entorno.
def get_sqlite_conn():
    return sqlite3.connect('mckenna_business.db')

# 2. Base de Datos Vectorial (ChromaDB - Experiencias y Conceptos)
# Crea una carpeta local llamada "memoria_vectorial" para guardar el aprendizaje
chroma_client = chromadb.PersistentClient(path="./memoria_vectorial")
coleccion_experiencia = chroma_client.get_or_create_collection(name="mckenna_brain")

# Configurar API de Google Gemini
genai.configure(api_key=os.environ.get("GOOGLE_API_KEY"))

# ==========================================
# 🧠 INSTRUCCIONES DEL SISTEMA (PROMPT MAESTRO)
# ==========================================
INSTRUCCIONES_MCKENNA = """
Rol: Hugo García (McKenna Group). Operador Ejecutivo.

REGLAS ANTIBUCLE Y DE AHORRO:
1. NO EJECUTES SINCRONIZACIONES (inteligente, manual o de fechas) a menos que el usuario use la palabra "Sincronizar" o "Sync". 
2. Para preguntas de estado como "¿Cómo va la conexión?", usa 'refrescar_token_meli'. Si el token sale bien, responde: "✅ Conexión activa y token refrescado." 
3. PROHIBIDO imprimir listas largas de IDs en el chat. Si hay pendientes, solo di la cantidad: "Hay X facturas pendientes".
4. Si una herramienta pide confirmación (s/n) en consola, elude esa herramienta si estás en modo chat automático, a menos que sea estrictamente necesario.

Tono: Directo, sin rodeos, ejecutivo rolo.

REGLAS DE CONTROL DE HERRAMIENTAS:
1. NO EJECUTES 'sincronizar_inteligente' ni 'sincronizar_facturas_recientes' si el usuario solo hace preguntas de estado (ej: "¿Cómo va la conexión?").
2. Para verificar la conexión, usa ÚNICAMENTE 'refrescar_token_meli'. Si funciona, responde: "✅ Conexión con MeLi activa."
3. PROHIBIDO mostrar listas de IDs de facturas en el chat. Si hay pendientes, di: "Hay [X] facturas pendientes por sincronizar."
4. No pidas confirmaciones de WhatsApp (s/n) en el modo chat a menos que te lo ordenen explícitamente.


"""

# ==========================================
# 🛠️ HERRAMIENTA: MEMORIA Y APRENDIZAJE
# ==========================================

def query_sqlite(consulta_sql: str):
    """Consulta la base de datos local (SQLite) para DATOS DUROS."""
    print(f"🔍 [SQL] Buscando datos exactos: {consulta_sql}")
    try:
        conn = get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute(consulta_sql)
        resultados = cursor.fetchall()
        conn.close()
        return f"Resultados en SQLite: {resultados}" if resultados else "No se encontraron datos en SQLite."
    except Exception as e:
        return f"Error consultando SQLite: {e}"

def query_vector_db(concepto: str):
    """Busca en ChromaDB para CONCEPTOS, HISTORIAL y EXPERIENCIAS."""
    print(f"🧠 [VECTOR] Consultando memoria experiencial sobre: {concepto}")
    try:
        # Busca los 2 recuerdos más relevantes
        resultados = coleccion_experiencia.query(query_texts=[concepto], n_results=2)
        if resultados and resultados['documents'] and resultados['documents'][0]:
            experiencias = "\n".join(resultados['documents'][0])
            return f"Recuerdos encontrados:\n{experiencias}"
        return "No tengo recuerdos o experiencias previas registradas sobre este tema."
    except Exception as e:
        return f"Error accediendo a memoria vectorial: {e}"

def aprender_de_interacciones_meli():
    """Descarga preguntas recientes de MeLi, las resume con Gemini y las guarda como aprendizaje en ChromaDB."""
    print("🎓 [APRENDIZAJE] Iniciando extracción de interacciones en Mercado Libre...")
    token = refrescar_token_meli()
    # Consulta las preguntas respondidas de tu cuenta para aprender de ellas
    url = "https://api.mercadolibre.com/my/received_questions/search?status=ANSWERED&limit=15"
    headers = {"Authorization": f"Bearer {token}"}
    
    try:
        res = requests.get(url, headers=headers)
        if res.status_code == 200:
            preguntas = res.json().get('questions', [])
            if not preguntas: return "✅ No hay interacciones nuevas para asimilar hoy."
            
            # 1. Preparar texto bruto
            texto_bruto = "Interacciones recientes con clientes:\n"
            for q in preguntas:
                texto_bruto += f"- Cliente: {q.get('text')}\n  McKenna: {q.get('answer', {}).get('text')}\n\n"
            
            # 2. Resumir y extraer valor con IA
            model = genai.GenerativeModel('gemini-flash-lite-latest')
            prompt = f"Actúa como analista de atención al cliente. Resume las dudas principales y las soluciones dadas en este historial. Crea un párrafo denso y útil con 'lecciones aprendidas' para mejorar el servicio:\n{texto_bruto}"
            aprendizaje = model.generate_content(prompt).text
            
            # 3. Guardar en memoria vectorial (ChromaDB)
            doc_id = f"exp_meli_{int(time.time())}"
            coleccion_experiencia.add(
                documents=[aprendizaje],
                metadatas=[{"fuente": "meli_qa", "fecha": str(datetime.now().date())}],
                ids=[doc_id]
            )
            print("✅ [APRENDIZAJE GUARDADO] Hugo ha evolucionado.")
            return f"Aprendizaje completado y guardado en memoria vectorial. Resumen: {aprendizaje}"
        else:
            return f"❌ Error extrayendo datos de MeLi: {res.status_code}"
    except Exception as e:
        return f"❌ Fallo crítico en aprendizaje: {e}"

# ==========================================
# 🛠️ HERRAMIENTA: CONEXIONES EXTERNAS
# ==========================================

def enviar_email_reporte(destinatario: str, asunto: str, cuerpo: str):
    """Envía un correo real usando SMTP."""
    print(f"📧 [EMAIL] Enviando reporte a {destinatario}...")
    remitente = "mckenna.group.colombia@gmail.com" 
    password = "efbe pnij iccy ryrh"  # Tu contraseña de aplicación

    msg = MIMEMultipart()
    import herramientas_agente as tools
    msg['From'] = remitente
    msg['To'] = destinatario
    msg['Subject'] = asunto
    msg.attach(MIMEText(cuerpo, 'plain'))

    try:
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        server.login(remitente, password)
        server.send_message(msg)
        server.quit()
        return f"✅ Correo enviado con éxito a {destinatario}."
    except Exception as e:
        return f"❌ Error enviando correo: {e}"

def consultar_devoluciones_meli():
    """Consulta órdenes canceladas o devueltas en Mercado Libre."""
    print("📡 [MELI] Buscando devoluciones o cancelaciones...")
    token = refrescar_token_meli()
    fecha_inicio = "2026-01-01T00:00:00.000-00:00"
    url = f"https://api.mercadolibre.com/orders/search?seller=me&order.date_created.from={fecha_inicio}"
    headers = {"Authorization": f"Bearer {token}"}
    
    try:
        res = requests.get(url, headers=headers)
        if res.status_code == 200:
            data = res.json().get('results', [])
            devoluciones = [o for o in data if o.get('status') in ['cancelled', 'invalid']]
            if not devoluciones: return "No hay devoluciones registradas desde enero."
            
            cuerpo = "LISTADO DE IDs DE DEVOLUCIÓN:\n"
            for o in devoluciones:
                cuerpo += f"- ID: {o.get('pack_id') or o.get('id')} | Estado: {o.get('status')}\n"
            return cuerpo
        return f"Error MeLi: {res.status_code}"
    except Exception as e:
        return f"Error técnico: {e}"

def consultar_detalle_venta_meli(pack_id: str):
    """Consulta detalles reales de una orden/pack específico."""
    print(f"📡 [MELI] Consultando detalle de venta ID: {pack_id}")
    token = refrescar_token_meli()
    url = f"https://api.mercadolibre.com/orders/{pack_id}"
    headers = {"Authorization": f"Bearer {token}"}
    try:
        res = requests.get(url, headers=headers)
        if res.status_code == 200:
            data = res.json()
            return f"✅ Venta {pack_id} encontrada.\n- Fecha: {data.get('date_created')}\n- Estado: {data.get('status')}\n- Valor: ${data.get('total_amount')}"
        return f"No se encontró la venta {pack_id} (Status {res.status_code})."
    except Exception as e:
        return f"Error MeLi: {e}"

# --- HERRAMIENTAS SIIGO ---
def autenticar_siigo(forzar=False):
    try:
        ruta_json = os.path.expanduser("~/mi-agente/credenciales_SIIGO.json")
        with open(ruta_json, "r") as f: creds = json.load(f)
        if not forzar and time.time() < creds.get("token_vencimiento", 0): return creds["access_token"]
        res = requests.post("https://api.siigo.com/auth", json={"username": creds["username"], "access_key": creds["api_key"]}, headers={"Partner-Id": PARTNER_ID}, timeout=10)
        if res.status_code == 200:
            token = res.json().get("access_token")
            creds.update({"access_token": token, "token_vencimiento": time.time() + (23 * 3600)})
            with open(ruta_json, "w") as f: json.dump(creds, f)
            return token
    except Exception as e: print(f"⚠️ Error Siigo Auth: {e}")
    return None

def obtener_facturas_siigo_paginadas(fecha_inicio):
    token = autenticar_siigo()
    todas = []; page = 1
    while True:
        try:
            res = requests.get(f"https://api.siigo.com/v1/invoices?created_start={fecha_inicio}&page={page}", headers={"Partner-Id": PARTNER_ID, "Authorization": f"Bearer {token}"}, timeout=15)
            if res.status_code == 200 and res.json().get('results'):
                todas.extend(res.json().get('results'))
                page += 1
            else: break
        except: break
    return todas

def descargar_factura_pdf_siigo(id_factura):
    token = autenticar_siigo()
    try:
        res = requests.get(f"https://api.siigo.com/v1/invoices/{id_factura}/pdf", headers={"Authorization": f"Bearer {token}", "Partner-Id": PARTNER_ID}, timeout=15)
        return res.json().get('base64', '') if res.status_code == 200 else "❌ Error"
    except Exception as e: return f"⚠️ Error: {e}"

def subir_factura_meli(pack_id, pdf_b64):
    try:
        token = refrescar_token_meli()
        pdf_puro = str(pdf_b64).strip().replace("\n", "").replace("\r", "")
        if "," in pdf_puro: pdf_puro = pdf_puro.split(",")[1]
        res = requests.post(f"https://api.mercadolibre.com/packs/{pack_id}/fiscal_documents", headers={"Authorization": f"Bearer {token}"}, files={'file': (f"Fac_{pack_id}.pdf", base64.b64decode(pdf_puro), 'application/pdf')}, timeout=30)
        return "✅" if res.status_code in [200, 201, 202] else f"❌ {res.text}"
    except Exception as e: return f"⚠️ Error: {e}"

# --- LOGICAS DE SINCRONIZACIÓN ---

def sincronizar_facturas_recientes(dias=1):
    """Corregido: Ahora sí acepta el parámetro 'dias' desde el menú."""
    print(f"\n🚀 [SYNC RECIENTE] Revisando facturas Siigo (Últimos {dias} días)...")
    token = autenticar_siigo()
    fecha_inicio = (datetime.now() - timedelta(days=dias)).strftime("%Y-%m-%d")
    url = f"https://api.siigo.com/v1/invoices?created_start={fecha_inicio}"
    
    try:
        res = requests.get(url, headers={"Partner-Id": PARTNER_ID, "Authorization": f"Bearer {token}"})
        facturas = res.json().get('results', [])
        print(f"📊 Analizando {len(facturas)} facturas...")
        procesadas = 0
        for f in facturas:
            texto = f"{f.get('observations') or ''} {f.get('purchase_order') or ''}"
            match = re.search(r'\d{12,20}', texto)
            if match:
                pack_id = match.group()
                print(f"⚙️ Procesando Pack {pack_id}...")
                pdf = descargar_factura_pdf_siigo(f.get('id'))
                if "❌" not in pdf and "✅" in subir_factura_meli(pack_id, pdf):
                    procesadas += 1
        return f"✅ Revisión terminada. Subidas: {procesadas}"
    except Exception as e: return f"❌ Error Opción 3: {e}"


def sincronizar_por_dia_especifico(fecha_consulta):
    print(f"\n📅 [DÍA] Buscando facturas del {fecha_consulta}...")
    token = autenticar_siigo()
    url = f"https://api.siigo.com/v1/invoices?created_start={fecha_consulta}&created_end={fecha_consulta}"
    res = requests.get(url, headers={"Partner-Id": PARTNER_ID, "Authorization": f"Bearer {token}"})
    facturas = res.json().get('results', [])
    exitos = 0
    for f in facturas:
        texto = f"{f.get('observations') or ''} {f.get('purchase_order') or ''}"
        match = re.search(r'\d{12,20}', texto)
        if match:
            p_id = match.group()
            pdf = descargar_factura_pdf_siigo(f.get('id'))
            if "❌" not in pdf and "✅" in subir_factura_meli(p_id, pdf):
                exitos += 1
                print(f"✅ Sincronizado: {p_id}")
    return f"✅ Fin del día {fecha_consulta}. Subidas: {exitos}"

def sincronizar_manual_por_id(pack_id):
    print(f"\n🔎 [MANUAL] Buscando Pack ID: {pack_id}...")
    token = autenticar_siigo()
    fecha_inicio = (datetime.now() - timedelta(days=60)).strftime("%Y-%m-%d")
    url = f"https://api.siigo.com/v1/invoices?created_start={fecha_inicio}"
    res = requests.get(url, headers={"Partner-Id": PARTNER_ID, "Authorization": f"Bearer {token}"})
    if res.status_code == 200:
        for fac in res.json().get('results', []):
            obs = str(fac.get('observations') or "") + " " + str(fac.get('purchase_order') or "")
            # Limpiamos el ID para evitar fallos por espacios
            if str(pack_id).strip() in obs:
                print(f"✨ ¡Bingo! Encontrada factura {fac.get('id')}. Subiendo...")
                pdf = descargar_factura_pdf_siigo(fac.get('id'))
                return f"🚀 Resultado: {subir_factura_meli(pack_id, pdf)}"
    return "❌ No se encontró factura en los últimos 60 días."
    
    

def sincronizar_inteligente():
    """
    Sincroniza facturas entre Siigo y MeLi de forma controlada.
    Evita saturar la memoria de la IA con reportes excesivos.
    """
    print("\n🧠 [SYNC INTELIGENTE] Iniciando cruce de datos...")
    try:
        token_meli = refrescar_token_meli()
        res_me = requests.get("https://api.mercadolibre.com/users/me", headers={"Authorization": f"Bearer {token_meli}"})
        seller_id = res_me.json().get('id')
        
        # 1. Buscar órdenes sin factura en MeLi (últimos 15 días)
        fecha_hace_15 = (datetime.now() - timedelta(days=15)).strftime("%Y-%m-%dT%H:%M:%S.000-00:00")
        url_meli = f"https://api.mercadolibre.com/orders/search?seller={seller_id}&order.date_created.from={fecha_hace_15}"
        
        pendientes = []
        r_meli = requests.get(url_meli, headers={"Authorization": f"Bearer {token_meli}"}).json()
        
        for ord in r_meli.get('results', []):
            if not ord.get('fiscal_documents'):
                # Usamos set() para evitar duplicados si la API de MeLi se repite
                p_id = str(ord.get('pack_id') or ord.get('id'))
                if p_id not in pendientes:
                    pendientes.append(p_id)
        
        if not pendientes: 
            return "✅ MeLi está al día. No hay facturas pendientes por subir."
        
        # 2. Buscar facturas en Siigo
        token_siigo = autenticar_siigo()
        fecha_siigo = (datetime.now() - timedelta(days=15)).strftime('%Y-%m-%d')
        url_siigo = f"https://api.siigo.com/v1/invoices?created_start={fecha_siigo}"
        
        r_siigo = requests.get(url_siigo, headers={
            "Partner-Id": PARTNER_ID, 
            "Authorization": f"Bearer {token_siigo}"
        }).json()
        
        procesadas = 0
        exitosas = []
        
        # 3. Emparejamiento
        for fac in r_siigo.get('results', []):
            txt = f"{fac.get('observations') or ''} {fac.get('purchase_order') or ''}"
            for p_id in pendientes:
                if p_id in txt and p_id not in exitosas:
                    pdf = descargar_factura_pdf_siigo(fac.get('id'))
                    if "❌" not in pdf:
                        res_subida = subir_factura_meli(p_id, pdf)
                        if "✅" in res_subida:
                            procesadas += 1
                            exitosas.append(p_id)
        
        # 4. Manejo del reporte (Aquí es donde se rompía Hugo)
        faltantes = [p for p in pendientes if p not in exitosas]
        
        if faltantes:
            # Solo enviamos al reporte externo, NO se lo devolvemos completo a la IA
            resumen_reporte = f"⚠️ *ALERTA FACTURACIÓN*\nFaltan {len(faltantes)} facturas en Siigo."
            
            # Limitamos la lista para que el mensaje de WhatsApp/Logs no sea infinito
            lista_ids = "\n".join([f"- {f}" for f in faltantes[:20]]) # Solo los primeros 20
            reporte_completo = f"{resumen_reporte}\nMostrando primeros 20:\n{lista_ids}"
            
            if len(faltantes) > 20:
                reporte_completo += f"\n... y {len(faltantes) - 20} más."
            
            enviar_reporte_controlado(reporte_completo)
            
            # A la IA le damos un mensaje corto y técnico
            return f"✅ Sync terminada. Subidas: {procesadas}. Pendientes: {len(faltantes)}. El reporte detallado fue enviado a Control."
            
        return f"✅ Sync terminada con éxito total. Se subieron {procesadas} facturas."

    except Exception as e:
        print(f"❌ Error en Sync Inteligente: {e}")
        return f"Error técnico durante la sincronización: {str(e)}"
# ==========================================
# 🛠️ HERRAMIENTAS DE NEGOCIO Y WHATSAPP
# ==========================================
def leer_datos_hoja(producto_buscar: str):
    """Lee inventario desde Google Sheets."""
    try:
        gc = gspread.service_account(filename=GOOGLE_CREDS_PATH)
        sheet = gc.open_by_key(SPREADSHEET_ID).worksheet("BASE DE DATOS MCKENNA GROUP S.A.S")
        resultados = []
        p_clave = producto_buscar.lower().split()
        for row in sheet.get_all_values()[1:]:
            if len(row) >= 5 and all(p in row[3].lower() for p in p_clave):
                resultados.append(f"- {row[3]} | Precio: ${row[4]} | Stock: {row[5]}")
        return "\n".join(resultados) if resultados else "No encontré el producto."
    except Exception as e: return f"Error Excel: {e}"

def consultar_flete(ciudad: str):
    """Devuelve tarifas fijas de envío."""
    tar = {"bogota": 10500, "medellin": 13500, "cali": 13500, "barranquilla": 14500}
    return f"El flete a {ciudad.title()} cuesta ${tar.get(ciudad.lower().strip(), 14500):,}."

def enviar_reporte_controlado(mensaje):
    """Envía un reporte a WhatsApp previa confirmación en consola."""
    print("\n" + "═"*40 + f"\n📋 REPORTE:\n{mensaje}\n" + "═"*40)
    if input("¿Enviar a WhatsApp? (s/n): ").lower() == 's':
        return core_sync.enviar_whatsapp_reporte(mensaje)
    return False
    
def parchear_funcion(nombre_archivo, nombre_funcion, nuevo_codigo):
    # ... (todo tu código actual de parcheo) ...
    
    # Al final, justo antes del return de éxito, agrega esto:
    try:
        limpiar_archivos_temporales() # Limpieza automática
        return f"✅ Función {nombre_funcion} actualizada y casa limpia."
    except:
        return f"✅ Función {nombre_funcion} actualizada (limpieza falló)."

def crear_nuevo_script(nombre_archivo, contenido):
    # ... (todo tu código actual de creación) ...

    # Al final, antes del return:
    try:
        limpiar_archivos_temporales() # Limpieza automática
        return f"✅ Script {nombre_archivo} creado y casa limpia."
    except:
        return f"✅ Script {nombre_archivo} creado."
    

# ==========================================
# 🧠 CEREBRO IA (NÚCLEO PRINCIPAL)
# ==========================================

def obtener_respuesta_ia(pregunta, usuario_id, historial=None):
    try:
        # 1. Configuración del modelo (Gemini 2.5 Flash para velocidad y costo)
        model = genai.GenerativeModel(
            'gemini-2.5-flash',
            tools=[
                query_sqlite, query_vector_db, aprender_de_interacciones_meli,
                consultar_flete, leer_datos_hoja, enviar_email_reporte,
                consultar_devoluciones_meli, consultar_detalle_venta_meli,
                sincronizar_manual_por_id, sincronizar_inteligente,
                sincronizar_por_dia_especifico, core_sync.enviar_whatsapp_reporte,
                refrescar_token_meli, 
                tools.listar_archivos_proyecto, tools.crear_backup,
                tools.parchear_funcion, tools.leer_funcion,
                tools.crear_nuevo_script, tools.ejecutar_script_python,
                tools.limpiar_archivos_temporales,
                buscar_ventas_acordar_entrega,
                responder_solicitud_rut
            ],
            system_instruction=INSTRUCCIONES_MCKENNA
        )

        # ✂️ TRUNCADO DE HISTORIAL (Evita saturación de tokens)
        historial_reducido = historial[-4:] if historial else []
        
        # 🚀 INICIO DE CHAT
        chat = model.start_chat(history=historial_reducido, enable_automatic_function_calling=True)
        
        # ✉️ ENVÍO DE MENSAJE
        response = chat.send_message(f"Usuario {usuario_id}: {pregunta}")
        
        # 📊 MONITOREO DE TOKENS
        if hasattr(response, 'usage_metadata'):
            u = response.usage_metadata
            print(f"💰 Tokens: In={u.prompt_token_count} | Out={u.candidates_token_count} | Total={u.total_token_count}")

        # Extraemos el texto de la respuesta de forma segura
        respuesta_texto = response.text if hasattr(response, 'text') else "✅ Tarea ejecutada (sin respuesta de texto)."
        
        return respuesta_texto, chat.history

    except Exception as e:
        error_str = str(e)
        # 🚨 DETECCIÓN DE ERROR DE SECUENCIA (400)
        if "400" in error_str or "function response turn" in error_str:
            print(f"⚠️ BLOQUEO DETECTADO (Error 400). Limpiando historial del usuario {usuario_id}...")
            # Devolvemos un mensaje de error amigable y el HISTORIAL VACÍO []
            # Esto sobreescribirá la DB y liberará a Hugo del bucle.
            return f"❌ Ups, se me cruzaron los cables con el historial (Error 400). Ya reinicié mi memoria. ¿Me podrías repetir el ID de la venta?", []
        
        # Otros errores genéricos
        print(f"⚠️ Error inesperado en IA: {e}")
        return f"❌ Error técnico: {e}", []
     
        

# ==========================================
# 🌐 SERVIDOR WEB FLASK (WHATSAPP WEBHOOK)
# ==========================================
@app.route('/whatsapp', methods=['POST'])
def whatsapp_endpoint():
    data = request.json
    uid = data.get('sender', 'desconocido')
    msg = data.get('mensaje', '').strip()
    es_postventa = data.get('es_postventa', False) 
    order_id = data.get('order_id', uid)

    if msg.lower().startswith("hugo dale ok"):
        if (target := msg.split()[-1]) in borradores_aprobacion:
            responder_mensaje_posventa(target, borradores_aprobacion.pop(target))
            return jsonify({"status": "sent", "respuesta": "¡Listo veci! Mensaje enviado."})
        return jsonify({"status": "error", "respuesta": "Borrador no encontrado."})

    if es_postventa and order_id in borradores_aprobacion:
        return jsonify({"status": "already_waiting"})

    respuesta_ia, _ = obtener_respuesta_ia(msg, uid)
    
    if es_postventa:
        borradores_aprobacion[order_id] = respuesta_ia 
        core_sync.enviar_whatsapp_reporte(f"🔔 *APROBACIÓN*\n📦 {order_id}\n🤖 {respuesta_ia}")
        return jsonify({"status": "waiting"})

    return jsonify({"status": "success", "respuesta": respuesta_ia})

# ==========================================
# 🖥️ INTERFAZ DE TERMINAL (CLI)
# ==========================================
def chat_manual():
    time.sleep(3) 
    sesion_historial = [] 

    while True:
        print("\n" + "═"*45)
        print("🛠️  CENTRO DE MANDO MCKENNA GROUP S.A.S.")
        print("═"*45)
        print("1. 💬 [CHAT] Modo conversación HÍBRIDA (IA + Memoria)")
        print("2. 🧠 [SYNC] Inteligente (MeLi -> Siigo)")
        print("3. 📦 [SYNC] Recientes (Ayer/Hoy)")
        print("4. 📦 [SYNC] Recientes (Últimos 10 días)")
        print("5. 📊 [TOTAL] Sincronización Total + Reporte Stock")
        print("6. 🔍 [DATA] Consultar Producto en Excel")
        print("7. 🛠️  [MANUAL] Sincronizar por Pack ID Específico")
        print("8. 🎓 [IA] Forzar Aprendizaje de MeLi (ChromaDB)")
        print("9. 📅 [FECHA] Sincronizar por dia especifico")
        print("10. 🚪 [EXIT] Apagar servidor")
        print("═"*45)
        
        op = input("Seleccione (1-10): ")

        if op == "1":
            print("\n--- 💬 MODO CHAT ACTIVADO (Escribe 'salir' para volver) ---")
            while True:
                user_input = input("👤 Tú: ")
                if user_input.lower() in ["salir", "exit", "menu", "volver"]:
                    print("--- 🔙 Volviendo al menú principal ---\n")
                    break
                
                respuesta, nuevo_historial = obtener_respuesta_ia(user_input, "usuario_terminal", historial=sesion_historial)
                if nuevo_historial: sesion_historial = nuevo_historial
                print(f"\n🤖 Hugo: {respuesta}\n")

        elif op == "2": print(sincronizar_inteligente())
        elif op == "3": print(sincronizar_facturas_recientes(dias=1))
        elif op == "4": print(sincronizar_facturas_recientes(dias=10))
        elif op == "5": print(ejecutar_sincronizacion_y_reporte())
        elif op == "6": print(leer_datos_hoja(input("🔍 Nombre del producto: ")))
        elif op == "7": print(sincronizar_manual_por_id(input("📝 Ingrese el Pack ID: ")))
        elif op == "8": print(aprender_de_interacciones_meli())
        elif op == "9": print(sincronizar_por_dia_especifico(input("📅 Fecha (AAAA-MM-DD): ")))
        elif op == "10": print("Apagando sistema...");break
        else: print("❌ Opción no válida, veci.")

# ==========================================
# 🚀 EJECUCIÓN PRINCIPAL
# ==========================================
if __name__ == "__main__":
    logging.getLogger('werkzeug').setLevel(logging.ERROR)
    threading.Thread(target=chat_manual, daemon=True).start()
    app.run(host='0.0.0.0', port=8081)

