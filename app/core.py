import os
import inspect
import json
import time as _time
import traceback
from typing import get_type_hints, get_origin, get_args, Union

import anthropic

_LOG_ERRORES = os.path.join(os.path.dirname(__file__), '..', 'log_errores_ia.txt')

def _log_error(contexto: str, exc: Exception):
    """Registra el error completo en archivo para diagnóstico."""
    from datetime import datetime
    try:
        with open(_LOG_ERRORES, 'a', encoding='utf-8') as f:
            f.write(f"\n{'='*60}\n")
            f.write(f"[{datetime.now().isoformat()}] {contexto}\n")
            f.write(f"Tipo: {type(exc).__name__}\n")
            f.write(f"Error: {exc}\n")
            f.write(traceback.format_exc())
    except Exception:
        pass

# --- Importación de Herramientas desde los Nuevos Módulos ---

from app.tools.memoria import query_sqlite, query_vector_db
from app.services.google_services import leer_datos_hoja, buscar_producto_completo as _buscar_producto_completo
from app.services.siigo import *
from app.services.meli import (
    aprender_de_interacciones_meli,
    consultar_devoluciones_meli,
    consultar_detalle_venta_meli,
    responder_solicitud_rut,
    buscar_ventas_acordar_entrega
)
from app.services.woocommerce import (
    obtener_todos_los_productos_woocommerce,
    actualizar_stock_woocommerce,
    sincronizar_catalogo_woocommerce
)
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
from app.sync import (
    sincronizar_manual_por_id,
    sincronizar_inteligente,
    sincronizar_por_dia_especifico
)
from app.tools.sincronizar_facturas_de_compra_siigo import sincronizar_facturas_de_compra_siigo
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

# ==========================================
# Globals
# ==========================================
cliente_ia = None          # anthropic.Anthropic instance
_tools_schema: list = []   # Claude tool definitions (JSON schema)
_tools_map: dict   = {}    # name → callable
_system_prompt: str = ""
# Per-user conversation history: user_id → list of message dicts
_historiales: dict = {}

# Compat stub (routes.py podría referenciar esto)
modelo_ia = None


# ==========================================
# Utilidades de schema
# ==========================================

def _py_type_to_json(annotation) -> str:
    """Convierte una anotación de tipo Python a un tipo JSON Schema."""
    if annotation is inspect.Parameter.empty:
        return "string"
    origin = get_origin(annotation)
    if origin is Union:
        # Optional[X] = Union[X, None] — usa el tipo interno
        args = [a for a in get_args(annotation) if a is not type(None)]
        return _py_type_to_json(args[0]) if args else "string"
    type_map = {
        str: "string",
        int: "integer",
        float: "number",
        bool: "boolean",
        list: "array",
        dict: "object",
        bytes: "string",
    }
    return type_map.get(annotation, "string")


def _fn_to_tool_schema(fn) -> dict:
    """Genera el schema de herramienta Claude a partir de una función Python."""
    sig = inspect.signature(fn)
    doc = (inspect.getdoc(fn) or fn.__name__)[:1024]

    try:
        hints = get_type_hints(fn)
    except Exception:
        hints = {}

    properties = {}
    required = []

    for name, param in sig.parameters.items():
        if name == 'self':
            continue

        ann = hints.get(name, param.annotation)

        # Si el tipo es Optional[X] o tiene default → no es required
        is_optional = (param.default is not inspect.Parameter.empty)
        origin = get_origin(ann)
        if origin is Union and type(None) in get_args(ann):
            is_optional = True

        json_type = _py_type_to_json(ann)
        properties[name] = {"type": json_type, "description": name}

        if not is_optional:
            required.append(name)

    schema: dict = {
        "name": fn.__name__,
        "description": doc,
        "input_schema": {
            "type": "object",
            "properties": properties,
        }
    }
    if required:
        schema["input_schema"]["required"] = required

    return schema


def _serializar_content(content) -> list:
    """
    Convierte los bloques de respuesta de Anthropic a dicts serializables
    para poder incluirlos en mensajes posteriores.
    """
    if isinstance(content, str):
        return [{"type": "text", "text": content}]
    result = []
    for block in content:
        if isinstance(block, dict):
            result.append(block)
        elif block.type == "text":
            result.append({"type": "text", "text": block.text})
        elif block.type == "tool_use":
            result.append({
                "type": "tool_use",
                "id": block.id,
                "name": block.name,
                "input": block.input,
            })
        else:
            # fallback
            if hasattr(block, 'model_dump'):
                result.append(block.model_dump())
    return result


# ==========================================
# Carga de casos de entrenamiento
# ==========================================

def cargar_casos_especiales():
    try:
        with open('app/training/casos_especiales.json', 'r', encoding='utf-8') as f:
            data = json.load(f)
            casos = data.get('casos', [])
            if not casos:
                return ""
            texto = "\n\n=== CASOS ESPECIALES DE ENTRENAMIENTO ===\n"
            for caso in casos:
                texto += f"- Contexto: {caso.get('contexto')}\n"
                texto += f"  Instrucción: {caso.get('instruccion')}\n"
            return texto
    except Exception as e:
        print(f"Error cargando casos especiales: {e}")
        return ""


# ==========================================
# Inicialización
# ==========================================

def configurar_ia(app):
    """
    Configura el cliente Anthropic y registra todas las herramientas disponibles
    como schemas JSON para el model de Claude.
    """
    global cliente_ia, _tools_schema, _tools_map, _system_prompt

    try:
        api_key = os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            raise ValueError("ANTHROPIC_API_KEY no está configurado en .env")

        cliente_ia = anthropic.Anthropic(api_key=api_key)

        todas_las_herramientas = [
            query_sqlite, query_vector_db, leer_datos_hoja,
            aprender_de_interacciones_meli, consultar_devoluciones_meli,
            consultar_detalle_venta_meli, responder_solicitud_rut,
            buscar_ventas_acordar_entrega,
            enviar_email_reporte, listar_archivos_proyecto,
            crear_backup, parchear_funcion, leer_funcion,
            crear_nuevo_script, ejecutar_script_python,
            sincronizar_manual_por_id, sincronizar_inteligente,
            sincronizar_por_dia_especifico,
            refrescar_token_meli, enviar_whatsapp_reporte,
            sincronizar_facturas_de_compra_siigo,
            crear_cotizacion_siigo, crear_cotizacion_preliminar,
            crear_factura_completa_siigo,
            consultar_tarifa_envio, consultar_tarifa_mercadoenvios,
            buscar_producto_completo,
            obtener_todos_los_productos_woocommerce,
            actualizar_stock_woocommerce, sincronizar_catalogo_woocommerce,
        ]

        _tools_map    = {fn.__name__: fn for fn in todas_las_herramientas}
        _tools_schema = [_fn_to_tool_schema(fn) for fn in todas_las_herramientas]

        _system_prompt = INSTRUCCIONES_MCKENNA + cargar_casos_especiales()

        print(f"🤖 Cerebro del Agente (Claude claude-sonnet-4-6) configurado — {len(_tools_schema)} herramientas registradas.")

    except Exception as e:
        print(f"❌ Error crítico al configurar la IA: {e}")
        cliente_ia = None


# ==========================================
# Respuesta de IA — loop de tool dispatch
# ==========================================

def obtener_respuesta_ia(pregunta: str, usuario_id: str, historial: list = None):
    """
    Envía la pregunta a Claude, ejecuta las herramientas que Claude solicite
    en un loop, y retorna la respuesta final de texto junto con el historial
    actualizado de la conversación.
    """
    if not cliente_ia:
        return "Veci, estamos en mantenimiento. Intente en unos minutos 🙏", []

    # Recuperar historial previo del usuario (o usar el pasado como parámetro)
    if historial:
        messages = list(historial)
    else:
        messages = list(_historiales.get(usuario_id, []))

    messages.append({"role": "user", "content": f"Usuario_{usuario_id}: {pregunta}"})

    MAX_REINTENTOS = 3

    MAX_TOOL_ITERS = 20  # evitar loops infinitos de herramientas

    for intento in range(MAX_REINTENTOS):
        try:
            print(f"🗣️  Usuario [{usuario_id}] pregunta: '{pregunta}'")
            current_messages = list(messages)

            # ── Loop de herramientas ──────────────────────────────────────
            for _iter in range(MAX_TOOL_ITERS):
                response = cliente_ia.messages.create(
                    model="claude-sonnet-4-6",
                    max_tokens=4096,
                    system=_system_prompt,
                    tools=_tools_schema,
                    messages=current_messages,
                )

                print(
                    f"💰 Tokens Claude — entrada: {response.usage.input_tokens}, "
                    f"salida: {response.usage.output_tokens}"
                )

                if response.stop_reason == "tool_use":
                    # 1. Guardar el turno del asistente (incluye texto + tool_use)
                    asst_content = _serializar_content(response.content)
                    current_messages.append({"role": "assistant", "content": asst_content})

                    # 2. Ejecutar cada herramienta y recoger resultados
                    tool_results = []
                    for block in response.content:
                        if block.type != "tool_use":
                            continue

                        fn = _tools_map.get(block.name)
                        print(f"🔧 Herramienta: {block.name}  args: {block.input}")

                        if fn:
                            try:
                                result = fn(**block.input)
                                result_str = str(result)[:8192]
                            except Exception as tool_exc:
                                result_str = f"Error ejecutando {block.name}: {tool_exc}"
                                _log_error(f"Tool {block.name} args={block.input}", tool_exc)
                        else:
                            result_str = f"Herramienta '{block.name}' no encontrada."

                        print(f"   ↳ {result_str[:120]}")
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": result_str,
                        })

                    # 3. Devolver resultados a Claude y continuar
                    current_messages.append({"role": "user", "content": tool_results})

                elif response.stop_reason == "end_turn":
                    # Extraer texto final
                    texto = "".join(
                        block.text for block in response.content
                        if hasattr(block, "text")
                    )

                    # Actualizar historial persistente del usuario
                    final_messages = current_messages + [
                        {"role": "assistant", "content": _serializar_content(response.content)}
                    ]
                    # Mantener últimos 40 mensajes para controlar costo de contexto
                    _historiales[usuario_id] = final_messages[-40:]

                    if not pregunta.startswith("BOT_"):
                        return texto or "✅ Tarea ejecutada en segundo plano.", final_messages
                    else:
                        return "", final_messages

                elif response.stop_reason == "max_tokens":
                    # Respuesta cortada por límite de tokens — devolver lo que haya
                    texto = "".join(
                        block.text for block in response.content
                        if hasattr(block, "text")
                    )
                    print(f"⚠️ Respuesta cortada por max_tokens")
                    return texto or "Veci, la respuesta fue muy larga. ¿Puede ser más específico?", current_messages

                else:
                    print(f"⚠️ stop_reason inesperado: {response.stop_reason}")
                    break
            else:
                print(f"⚠️ Límite de {MAX_TOOL_ITERS} iteraciones de herramientas alcanzado")

            return "✅ Proceso completado.", current_messages

        except anthropic.BadRequestError as e:
            # Esquemas de herramientas inválidos o mensaje malformado
            _log_error(f"BadRequestError usuario={usuario_id} msg='{pregunta[:80]}'", e)
            print(f"❌ Error de request Claude (BadRequest): {e}")
            # Limpiar historial de este usuario para evitar reenviar mensajes corruptos
            _historiales.pop(usuario_id, None)
            return "Veci, hubo un error en el formato del mensaje. Por favor inténtelo de nuevo 🙏", []

        except anthropic.AuthenticationError as e:
            _log_error("AuthenticationError — verificar ANTHROPIC_API_KEY", e)
            print(f"❌ Error de autenticación Claude: {e}")
            return "Veci, estamos en mantenimiento. Intente en unos minutos 🙏", []

        except Exception as e:
            error_str = str(e)
            _log_error(f"Error IA intento={intento+1} usuario={usuario_id}", e)
            print(f"⚠️ Error IA (intento {intento+1}/{MAX_REINTENTOS}): {type(e).__name__}: {error_str}")

            if "overloaded" in error_str.lower() or "529" in error_str or "503" in error_str:
                if intento < MAX_REINTENTOS - 1:
                    espera = (intento + 1) * 5
                    print(f"⚠️ Claude sobrecargado — reintento en {espera}s")
                    _time.sleep(espera)
                    continue
                return (
                    "Veci, tenemos alta demanda en este momento. "
                    "Por favor escríbanos de nuevo en 2 minutos 🙏",
                    []
                )

            if "429" in error_str or "rate_limit" in error_str.lower():
                return (
                    "Veci, estamos atendiendo muchos clientes. "
                    "Por favor espere un momento y escriba de nuevo 🙏",
                    []
                )

            print(f"❌ Error IA inesperado ({type(e).__name__}): {e}")
            return "Veci, tuve un problema técnico momentáneo. Por favor intente de nuevo 🙏", []

    return "Veci, intente de nuevo en un momento 🙏", []
