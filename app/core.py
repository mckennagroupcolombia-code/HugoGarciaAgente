
import os
import google.generativeai as genai

# --- Importación de Herramientas desde los Nuevos Módulos ---
# Cada función es una herramienta que el agente puede decidir usar.

# Herramientas de memoria y base de datos
from app.tools.memoria import query_sqlite, query_vector_db

# Herramientas de servicios externos
from app.services.google_services import leer_datos_hoja
from app.services.siigo import *
from app.services.meli import (
    aprender_de_interacciones_meli, 
    consultar_devoluciones_meli, 
    consultar_detalle_venta_meli,
    responder_solicitud_rut,
    buscar_ventas_acordar_entrega
)

# Herramientas de sistema y comunicación
from app.tools.system_tools import (
    enviar_email_reporte,
    listar_archivos_proyecto,
    crear_backup,
    parchear_funcion,
    leer_funcion,
    crear_nuevo_script,
    ejecutar_script_python
)

# Herramientas de sincronización
from app.sync import (
    sincronizar_manual_por_id, 
    sincronizar_inteligente,
    sincronizar_por_dia_especifico
)

# TODO: Estas dependencias de `core_sync` deben ser eliminadas y refactorizadas.
from core_sync import refrescar_token_meli, enviar_whatsapp_reporte

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

# Variable global para el modelo de IA
modelo_ia = None

def configurar_ia(app):
    """
    Configura e inicializa el modelo de IA con todas las herramientas disponibles.
    """
    global modelo_ia
    try:
        genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))
        
        # Agrupamos todas las funciones importadas en una lista de herramientas para el modelo.
        todas_las_herramientas = [
            query_sqlite, query_vector_db, leer_datos_hoja, aprender_de_interacciones_meli,
            consultar_devoluciones_meli, consultar_detalle_venta_meli, responder_solicitud_rut,
            buscar_ventas_acordar_entrega, enviar_email_reporte, listar_archivos_proyecto,
            crear_backup, parchear_funcion, leer_funcion, crear_nuevo_script, ejecutar_script_python,
            sincronizar_manual_por_id, sincronizar_inteligente, sincronizar_por_dia_especifico,
            refrescar_token_meli, enviar_whatsapp_reporte
        ]
        
        modelo_ia = genai.GenerativeModel(
            # TODO: El nombre del modelo debería ser configurable.
            'gemini-1.5-flash', 
            tools=todas_las_herramientas,
            system_instruction=INSTRUCCIONES_MCKENNA
        )
        print("🤖 Cerebro del Agente (IA) configurado y listo.")

    except Exception as e:
        print(f"❌ Error Crítico al configurar la IA: {e}")
        modelo_ia = None

def obtener_respuesta_ia(pregunta: str, usuario_id: str, historial: list = None):
    """
    Procesa una pregunta de usuario, la envía al modelo de IA y gestiona el historial de chat.
    """
    if not modelo_ia:
        return "Error: El modelo de IA no está configurado. Revisa los logs de inicio.", []

    try:
        # Usar el historial de chat proporcionado, limitado a los últimos 4 intercambios.
        historial_reducido = historial[-4:] if historial else []
        chat = modelo_ia.start_chat(
            history=historial_reducido, 
            enable_automatic_function_calling=True
        )
        
        print(f"🗣️  Usuario [{usuario_id}] pregunta: '{pregunta}'")
        response = chat.send_message(f"Usuario {usuario_id}: {pregunta}")

        # Imprimir el uso de tokens para monitoreo.
        if hasattr(response, 'usage_metadata'):
            usage = response.usage_metadata
            print(f"💰 Tokens Usados: Entrada={usage.prompt_token_count}, Salida={usage.candidates_token_count}, Total={usage.total_token_count}")

        # Si la IA ejecutó una herramienta, la respuesta de texto puede estar vacía.
        respuesta_texto = response.text if hasattr(response, 'text') and response.text else "✅ Tarea ejecutada en segundo plano."
        return respuesta_texto, chat.history

    except Exception as e:
        error_str = str(e)
        print(f"⚠️ Error durante la generación de respuesta de la IA: {error_str}")
        # Manejo de error común de historial corrupto
        if "function response turn" in error_str:
            return "❌ Se produjo un error con el historial de la conversación. He reiniciado mi memoria a corto plazo. Por favor, repite tu última pregunta.", []
        
        return f"❌ Error técnico inesperado en el núcleo de la IA: {e}", historial
