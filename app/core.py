import os
from google import genai

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
from app.tools.sincronizar_facturas_de_compra_siigo import sincronizar_facturas_de_compra_siigo

# TODO: Estas dependencias de `core_sync` deben ser eliminadas y refactorizadas.
from app.utils import refrescar_token_meli, enviar_whatsapp_reporte

# ==========================================
# 🧠 INSTRUCCIONES DEL SISTEMA (PROMPT MAESTRO)
# ==========================================
INSTRUCCIONES_MCKENNA = """
Rol: Hugo García (McKenna Group). Operador Ejecutivo de ventas y farmacología en materias primas.

REGLAS ANTIBUCLE Y DE AHORRO:
1. NO EJECUTTES SINCRONIZACIONES (inteligente, manual o de fechas) a menos que el usuario use la palabra "Sincronizar" o "Sync".
2. Para preguntas de estado como "¿Cómo va la conexión?", usa 'refrescar_token_meli'. Si el token sale bien, responde: "✅ Conexión activa y token refrescado."
3. PROHIBIDO imprimir listas largas de IDs en el chat. Si hay pendientes, solo di la cantidad: "Hay X facturas pendientes".
4. Si una herramienta pide confirmación (s/n) en consola, elude esa herramienta si estás en modo chat automático, a menos que sea estrictamente necesario.

Tono: Directo, sin rodeos, ejecutivo rolo.

REGLAS DE INTERACCIÓN WHATSAPP Y VENTAS:
1. NO SUFIERAS ni ofrezcas opciones extra que el cliente no ha pedido (ej: no digas "¿Desea que le envíe el catálogo?", "¿Desea que le diga el precio del envío?", etc.). Limítate a responder puntualmente lo que el cliente pregunta.
2. SALUDO INICIAL: Si es la primera interacción y el cliente solo saluda (ej. "Buenas tardes"), responde EXACTAMENTE así: "Hola Soy hugo Garcia de mckenna Group S.A.S, cuenteme en que le puedo servir veci!". Si el cliente pregunta algo de inmediato, omite los títulos largos y responde directamente a la pregunta.
3. CONSULTA DE INVENTARIO: Si el cliente pregunta por un producto, debes usar las herramientas para consultar la hoja de Google Sheets (leer_datos_hoja) y verificar la disponibilidad. MUY IMPORTANTE: NO DIGAS al cliente la cantidad exacta que hay en stock. Solo dile si está disponible o no. Si el cliente luego solicita una cantidad específica que sí está disponible, entonces le confirmas que sí la hay.
4. JERGA COLOMBIANA PARA CANTIDADES: Cuando el cliente diga algo como "deme 500 y 500" o "deme 250", si estabas hablando de productos en gramos, asume que se refiere a 1 UNIDAD de la presentación de 500g o 250g, NO a 500 unidades del producto. No te enredes con esto.
5. COTIZACIONES: Si el cliente desea realizar una cotización, pregúntale paso a paso:
   a. Nombre completo o razón social y número de identificación (NIT/Cédula).
   b. Correo electrónico.
   c. Dirección de envío.
   d. Lista de productos solicitados con su respectivo precio y cantidad.
   e. Total de la cotización.
   Una vez recopilada esta información, utiliza la herramienta de crear cotización preliminar (local) para generarla. Esto NO usará SIIGO inicialmente. 
   Indícale al cliente que una vez realice el pago y envíe el comprobante, procederás a generar la Factura Electrónica oficial y enviarle el reporte con los datos de envío.

6. FACTURACIÓN ELECTRÓNICA Y DESPACHO:
   Una vez el cliente envíe el comprobante de pago:
   a. Usa la herramienta 'crear_factura_completa_siigo' pasando los datos de la cotización preliminar y la ruta del archivo del comprobante (si está disponible).
   b. Esta herramienta se encargará de crear la factura oficial en SIIGO, adjuntar el comprobante y enviar el reporte automático al grupo de WhatsApp con la factura PDF y el resumen de despacho.

REGLAS DE CONTROL DE HERRAMIENTAS:
1. NO EJECUTTES 'sincronizar_inteligente' ni 'sincronizar_facturas_recientes' si el usuario solo hace preguntas de estado (ej: "¿Cómo va la conexión?").
2. Para verificar la conexión, usa ÚNICAMENTE 'refrescar_token_meli'. Si funciona, responde: "✅ Conexión con MeLi activa."
3. PROHIBIDO mostrar listas de IDs de facturas en el chat. Si hay pendientes, di: "Hay [X] facturas pendientes por sincronizar."
4. No pidas confirmaciones de WhatsApp (s/n) en el modo chat a menos que te lo ordenen explícitamente.
"""

# Variables globales — client debe vivir junto a modelo_ia para evitar
# que el garbage collector lo destruya y rompa la sesión de chat.
cliente_ia = None
modelo_ia = None

def configurar_ia(app):
    """
    Configura e inicializa el modelo de IA con todas las herramientas disponibles.
    """
    global cliente_ia, modelo_ia
    try:
        cliente_ia = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))
        client = cliente_ia
        
        # Agrupamos todas las funciones importadas en una lista de herramientas para el modelo.
        # Asumiendo que crear_cotizacion_siigo se exportó en app.services.siigo
        todas_las_herramientas = [
            query_sqlite, query_vector_db, leer_datos_hoja, aprender_de_interacciones_meli,
            consultar_devoluciones_meli, consultar_detalle_venta_meli, responder_solicitud_rut,
            buscar_ventas_acordar_entrega, enviar_email_reporte, listar_archivos_proyecto,
            crear_backup, parchear_funcion, leer_funcion, crear_nuevo_script, ejecutar_script_python,
            sincronizar_manual_por_id, sincronizar_inteligente, sincronizar_por_dia_especifico,
            refrescar_token_meli, enviar_whatsapp_reporte,
            sincronizar_facturas_de_compra_siigo, crear_cotizacion_siigo,
            crear_cotizacion_preliminar, crear_factura_completa_siigo
        ]
        
        modelo_ia = client.chats.create(
            # TODO: El nombre del modelo debería ser configurable.
            model="gemini-2.5-pro",
            config=genai.types.GenerateContentConfig(
                tools=todas_las_herramientas,
                system_instruction=INSTRUCCIONES_MCKENNA,
            )
        )
        print("🤖 Cerebro del Agente (IA) configurado y listo.")

    except Exception as e:
        print(f"❌ Error Crítico al configurar la IA: {e}")
        modelo_ia = None

def obtener_respuesta_ia(pregunta: str, usuario_id: str, historial: list = None):
    """
    Procesa una pregunta de usuario, la envía al modelo de IA y gestiona el historial de chat.
    Limpia el historial de interacciones de funciones rotas para evitar el error 400 de Gemini.
    """
    if not modelo_ia:
        return "Error: El modelo de IA no está configurado. Revisa los logs de inicio.", []

    try:
        print(f"🗣️  Usuario [{usuario_id}] pregunta: \'{pregunta}\'")
        response = modelo_ia.send_message(f"Usuario_{usuario_id}: {pregunta}") # Prefijo al mensaje del usuario

        # Imprimir el uso de tokens para monitoreo.
        if hasattr(response, 'usage_metadata'):
            usage = response.usage_metadata
            print(f"💰 Tokens Usados: Entrada={usage.prompt_token_count}, Salida={usage.candidates_token_count}, Total={usage.total_token_count}")

        # Si la IA ejecutó una herramienta, la respuesta de texto puede estar vacía.
        # Solo respondemos si el mensaje proviene de un usuario real (no de otro bot).
        if not pregunta.startswith("BOT_"):
            respuesta_texto = response.text if hasattr(response, 'text') and response.text else "✅ Tarea ejecutada en segundo plano."
            return respuesta_texto, modelo_ia.get_history()
        else:
            return "", modelo_ia.get_history() # No responder si el mensaje es de un bot

    except Exception as e:
        error_str = str(e)
        print(f"⚠️ Error durante la generación de respuesta de la IA: {error_str}")
        # Manejo de error común de historial corrupto
        if "function response turn" in error_str:
            return "❌ Se produjo un error con el historial de la conversación. He reiniciado mi memoria a corto plazo. Por favor, repite tu última pregunta.", []
        
        return f"❌ Error técnico inesperado en el núcleo de la IA: {e}", historial
