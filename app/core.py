import os
from google import genai

# --- Importación de Herramientas desde los Nuevos Módulos ---
# Cada función es una herramienta que el agente puede decidir usar.

# Herramientas de memoria y base de datos
from app.tools.memoria import query_sqlite, query_vector_db

# Herramientas de servicios externos
from app.services.google_services import leer_datos_hoja, buscar_producto_completo as _buscar_producto_completo
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
    ejecutar_script_python,
    consultar_tarifa_envio,
    consultar_tarifa_mercadoenvios
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

def buscar_producto_completo(consulta: str) -> str:
    """
    Busca información completa de un producto del catálogo McKenna Group.
    Retorna nombre oficial de SIIGO, precio, stock disponible y ficha técnica.
    Usar cuando un cliente pregunte por disponibilidad, precio o características
    de un producto en WhatsApp.
    """
    resultado = _buscar_producto_completo(consulta)
    if resultado:
        precio_fmt = f"${resultado['precio']:,.0f} COP" if resultado['precio'] else "Consultar"
        unidad = resultado['unidad'] or ""
        ficha = resultado['ficha_tecnica'] or "No disponible"
        return (
            f"✅ Producto encontrado en catálogo McKenna Group:\n"
            f"- Nombre oficial: {resultado['nombre_siigo']}\n"
            f"- SKU/Referencia: {resultado['referencia']}\n"
            f"- Precio: {precio_fmt}\n"
            f"- Unidad: {unidad}\n"
            f"- Stock disponible: {resultado['stock_siigo']}\n"
            f"- Ficha técnica: {ficha}"
        )
    return f"Producto '{consulta}' no encontrado en el catálogo."


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

REGLAS SOBRE NOMBRES Y PRECIOS DE PRODUCTOS:
- En conversaciones de WHATSAPP: SIEMPRE usa 'buscar_producto_completo' para consultar un producto. Usa el nombre oficial que retorna SIIGO, no el nombre de la publicación de MercadoLibre. Usa el precio de SIIGO.
- En respuestas de PREVENTA en MercadoLibre: puedes mencionar el nombre de la publicación, pero consulta la ficha técnica real desde Google Sheets.
- NUNCA uses nombres de publicaciones de MercadoLibre al hablar con clientes por WhatsApp.
- El SKU es la referencia oficial del producto en todas las facturas y cotizaciones.
"""

# Variables globales — client debe vivir junto a modelo_ia para evitar
# que el garbage collector lo destruya y rompa la sesión de chat.
cliente_ia = None
modelo_ia = None

import json

def cargar_casos_especiales():
    try:
        with open('app/training/casos_especiales.json', 'r', encoding='utf-8') as f:
            data = json.load(f)
            casos = data.get('casos', [])
            if not casos: return ""
            texto = "\n\n=== CASOS ESPECIALES DE ENTRENAMIENTO ===\n"
            for caso in casos:
                texto += f"- Contexto: {caso.get('contexto')}\n"
                texto += f"  Instrucción: {caso.get('instruccion')}\n"
            return texto
    except Exception as e:
        print(f"Error cargando casos especiales: {e}")
        return ""

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
            crear_cotizacion_preliminar, crear_factura_completa_siigo, consultar_tarifa_envio, consultar_tarifa_mercadoenvios,
            buscar_producto_completo
        ]
        
        instrucciones_completas = INSTRUCCIONES_MCKENNA + cargar_casos_especiales()

        modelo_ia = client.chats.create(
            # TODO: El nombre del modelo debería ser configurable.
            model="gemini-2.5-pro",
            config=genai.types.GenerateContentConfig(
                tools=todas_las_herramientas,
                system_instruction=instrucciones_completas,
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
    Reintenta automáticamente ante errores 503/429 de Gemini.
    """
    import time as _time

    if not modelo_ia:
        return "Veci, estamos en mantenimiento. Intente en unos minutos 🙏", []

    MAX_REINTENTOS = 3

    for intento in range(MAX_REINTENTOS):
        try:
            print(f"🗣️  Usuario [{usuario_id}] pregunta: \'{pregunta}\'")
            response = modelo_ia.send_message(f"Usuario_{usuario_id}: {pregunta}")

            if hasattr(response, 'usage_metadata'):
                usage = response.usage_metadata
                print(f"💰 Tokens Usados: Entrada={usage.prompt_token_count}, Salida={usage.candidates_token_count}, Total={usage.total_token_count}")

            if not pregunta.startswith("BOT_"):
                respuesta_texto = response.text if hasattr(response, 'text') and response.text else "✅ Tarea ejecutada en segundo plano."
                return respuesta_texto, modelo_ia.get_history()
            else:
                return "", modelo_ia.get_history()

        except Exception as e:
            error_str = str(e)
            print(f"⚠️ Error IA (intento {intento+1}/{MAX_REINTENTOS}): {error_str}")

            if "function response turn" in error_str:
                return "Veci, tuve un problema con la sesión. Por favor repita su mensaje 🙏", []

            if '503' in error_str or 'UNAVAILABLE' in error_str:
                if intento < MAX_REINTENTOS - 1:
                    espera = (intento + 1) * 5
                    print(f"⚠️ Gemini 503 — reintento {intento+1} en {espera}s")
                    _time.sleep(espera)
                    continue
                print("❌ Gemini 503 agotó reintentos")
                return (
                    "Veci, tenemos alta demanda en este momento. "
                    "Por favor escríbanos de nuevo en 2 minutos 🙏",
                    []
                )

            if '429' in error_str or 'RATE_LIMIT' in error_str:
                print("⚠️ Rate limit Gemini")
                return (
                    "Veci, estamos atendiendo muchos clientes. "
                    "Por favor espere un momento y escriba de nuevo 🙏",
                    []
                )

            print(f"❌ Error IA inesperado: {e}")
            return "Veci, tuve un problema técnico momentáneo. Por favor intente de nuevo 🙏", []

    return "Veci, intente de nuevo en un momento 🙏", []
