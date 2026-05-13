import base64
import copy
import os
import inspect
import json
import re
import sqlite3
import time as _time
import traceback
from typing import get_type_hints, get_origin, get_args, Union

# Adjuntos en /chat (imágenes comprobante, PDF)
_MAX_ADJUNTOS_CHAT = 5
_MAX_BYTES_ADJUNTO_CHAT = 4_500_000
_CHAT_MEDIA_OK = frozenset(
    {"image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"}
)

import anthropic
from google import genai

_LOG_ERRORES = os.path.join(os.path.dirname(__file__), "..", "log_errores_ia.txt")


def _log_error(contexto: str, exc: Exception):
    """Registra el error completo en archivo para diagnóstico."""
    from datetime import datetime

    try:
        with open(_LOG_ERRORES, "a", encoding="utf-8") as f:
            f.write(f"\n{'=' * 60}\n")
            f.write(f"[{datetime.now().isoformat()}] {contexto}\n")
            f.write(f"Tipo: {type(exc).__name__}\n")
            f.write(f"Error: {exc}\n")
            f.write(traceback.format_exc())
    except Exception:
        pass


# --- Importación de Herramientas desde los Nuevos Módulos ---

from app.tools.memoria import query_sqlite, query_vector_db
from app.services.autocorrector import manejar_incidente_autocorreccion
from app.services.google_services import (
    leer_datos_hoja,
    buscar_producto_completo as _buscar_producto_completo,
)
from app.services.siigo import *
from app.services.meli import (
    aprender_de_interacciones_meli,
    consultar_devoluciones_meli,
    consultar_detalle_venta_meli,
    responder_solicitud_rut,
    buscar_ventas_acordar_entrega,
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
    consultar_tarifa_mercadoenvios,
)
from app.sync import (
    sincronizar_manual_por_id,
    sincronizar_inteligente,
    sincronizar_por_dia_especifico,
)
from app.tools.importar_productos_siigo import procesar_facturas_para_importar_productos
from app.tools.sincronizar_precios import sincronizar_precios_meli_sheets
from app.tools.generar_catalogo import generar_catalogo_pdf
from app.tools.generar_guias_masivas import generar_guias_masivas_web
from app.tools.pipeline_contenido_facebook import publicar_contenido_redes_sociales_ia
from app.utils import refrescar_token_meli, enviar_whatsapp_reporte
from app.observability import log_json, spawn_thread
from app.tools.script_audit import auditar_scripts


def _resumen_disponibilidad_para_agente(stock_raw) -> str:
    """
    Convierte el valor de stock del Sheet a texto para el LLM sin exponer cifra exacta al cliente.
    """
    if stock_raw is None:
        return "- Disponibilidad: dato no claro en catálogo; ofrece confirmar con el equipo."
    s = str(stock_raw).strip()
    if not s:
        return "- Disponibilidad: dato no claro en catálogo; ofrece confirmar con el equipo."
    low = s.lower()
    try:
        n = float(s.replace(",", ".").replace(" ", ""))
        if n > 0:
            return (
                "- Disponibilidad: Sí, hay existencias en catálogo. "
                "IMPORTANTE: no menciones cantidad numérica al cliente; solo disponible o no. "
                "Si el cliente pide una cantidad específica y según este dato alcanza, confírmala."
            )
        return "- Disponibilidad: No / sin existencias según catálogo."
    except ValueError:
        if any(x in low for x in ("agot", "sin stock", "no dispon", "no hay")):
            return "- Disponibilidad: No según catálogo."
        if any(x in low for x in ("dispon", "en stock", "hay ", "activo")):
            return "- Disponibilidad: Sí (según texto en hoja); no des cifras exactas al cliente."
        return (
            "- Disponibilidad: interpreta el valor de hoja con cuidado; no inventes cifras. "
            f'Referencia interna (no citar tal cual al cliente si es numérico ambiguo): "{s[:80]}"'
        )


def buscar_producto_completo(consulta: str) -> str:
    """
    Busca información completa de un producto del catálogo McKenna Group (Google Sheets).
    Incluye disponibilidad en forma resumida (sin cantidad exacta) para cumplir política WhatsApp.
    Usar cuando un cliente pregunte por disponibilidad, precio o características en WhatsApp.
    """
    resultado = _buscar_producto_completo(consulta)
    if resultado:
        precio_fmt = (
            f"${resultado['precio']:,.0f} COP" if resultado["precio"] else "Consultar"
        )
        unidad = resultado["unidad"] or ""
        ficha = resultado["ficha_tecnica"] or "No disponible"
        disp = _resumen_disponibilidad_para_agente(resultado.get("stock_siigo"))
        return (
            f"✅ Producto encontrado en catálogo McKenna Group:\n"
            f"- Nombre oficial: {resultado['nombre_siigo']}\n"
            f"- SKU/Referencia: {resultado['referencia']}\n"
            f"- Precio: {precio_fmt}\n"
            f"- Unidad: {unidad}\n"
            f"{disp}\n"
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
3. CONSULTA DE INVENTARIO: Si el cliente pregunta por un producto en WhatsApp, usa SIEMPRE 'buscar_producto_completo' (lee el catálogo en Sheets). NO uses 'leer_datos_hoja' para ese fin salvo que 'buscar_producto_completo' no baste. La herramienta ya resume disponibilidad sin cifra exacta: NO DIGAS cantidad numérica de stock al cliente; solo disponible o no. Si pide una cantidad específica y el contexto indica que hay existencias suficientes, confírmala.
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
7. IMÁGENES SIN CONTEXTO DE PAGO: si recibes un mensaje tipo "El cliente envió una imagen por WhatsApp." y no hay señales explícitas de pago/comprobante, NO asumas pago. Responde pidiendo intención de forma breve (ej. "¿Desea cotización, validación de producto o soporte técnico?").

REGLAS DE CONTROL DE HERRAMIENTAS:
1. NO EJECUTTES 'sincronizar_inteligente' ni 'sincronizar_facturas_recientes' si el usuario solo hace preguntas de estado (ej: "¿Cómo va la conexión?").
2. Para verificar la conexión, usa ÚNICAMENTE 'refrescar_token_meli'. Si funciona, responde: "✅ Conexión con MeLi activa."
3. PROHIBIDO mostrar listas de IDs de facturas en el chat. Si hay pendientes, di: "Hay [X] facturas pendientes por sincronizar."
4. No pidas confirmaciones de WhatsApp (s/n) en el modo chat a menos que te lo ordenen explícitamente.

REGLAS SOBRE NOMBRES Y PRECIOS DE PRODUCTOS:
- En conversaciones de WHATSAPP: SIEMPRE usa 'buscar_producto_completo' para consultar un producto (no repitas cantidades de inventario al cliente). Usa el nombre oficial que retorna el catálogo (columna SIIGO), no el nombre de la publicación de MercadoLibre. Usa el precio del catálogo.
- En respuestas de PREVENTA en MercadoLibre: puedes mencionar el nombre de la publicación, pero consulta la ficha técnica real desde Google Sheets.
- NUNCA uses nombres de publicaciones de MercadoLibre al hablar con clientes por WhatsApp.
- El SKU es la referencia oficial del producto en todas las facturas y cotizaciones.
"""

# ==========================================
# Globals
# ==========================================
cliente_ia = None  # anthropic.Anthropic instance
cliente_gemini = None  # google.genai.Client instance
_tools_schema: list = []  # Claude tool definitions (JSON schema)
_tools_map: dict = {}  # name → callable
_system_prompt: str = ""
# Per-user conversation history: user_id → list of message dicts
_historiales: dict = {}
_CONVERSACIONES_DB = os.getenv(
    "AGENTE_CONVERSACIONES_DB",
    os.path.join(os.path.dirname(__file__), "data", "conversaciones_whatsapp.sqlite3"),
)
_MAX_HISTORIAL_PERSISTENTE = int(os.getenv("AGENTE_MAX_HISTORIAL_CLIENTE", "40"))

def _mensaje_amigable_badrequest(error_text: str) -> str:
    """
    Mapea errores 400 comunes a mensajes claros para cliente final.
    Evita culpar al usuario cuando el problema es de saldo/proveedor.
    """
    t = (error_text or "").lower()
    if "credit balance is too low" in t or "billing" in t:
        return (
            "Veci, estamos en mantenimiento temporal por capacidad del servicio de IA. "
            "Por favor intente de nuevo en unos minutos 🙏"
        )
    if "prompt is too long" in t or "too many tokens" in t:
        return "Veci, el mensaje está muy largo. ¿Me lo envía en partes, por favor? 🙏"
    return (
        "Veci, tuve un problema técnico procesando este mensaje. "
        "¿Puede reenviarlo, por favor? 🙏"
    )


def _ensure_conversaciones_db() -> None:
    os.makedirs(os.path.dirname(_CONVERSACIONES_DB), exist_ok=True)
    with sqlite3.connect(_CONVERSACIONES_DB) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS conversaciones_whatsapp (
                usuario_id TEXT NOT NULL,
                idx INTEGER NOT NULL,
                role TEXT NOT NULL,
                content_json TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (usuario_id, idx)
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_conversaciones_usuario "
            "ON conversaciones_whatsapp(usuario_id, idx)"
        )


def _cargar_historial_persistente(usuario_id: str) -> list:
    if not usuario_id:
        return []
    try:
        _ensure_conversaciones_db()
        with sqlite3.connect(_CONVERSACIONES_DB) as conn:
            rows = conn.execute(
                """
                SELECT role, content_json
                FROM conversaciones_whatsapp
                WHERE usuario_id = ?
                ORDER BY idx ASC
                """,
                (usuario_id,),
            ).fetchall()
        historial = []
        for role, content_json in rows:
            try:
                content = json.loads(content_json)
            except json.JSONDecodeError:
                content = content_json
            historial.append({"role": role, "content": content})
        return historial[-_MAX_HISTORIAL_PERSISTENTE:]
    except Exception as e:
        _log_error(f"Cargar historial persistente usuario={usuario_id}", e)
        return []


def _guardar_historial_persistente(usuario_id: str, messages: list) -> None:
    if not usuario_id:
        return
    try:
        limpio = messages[-_MAX_HISTORIAL_PERSISTENTE:]
        _ensure_conversaciones_db()
        with sqlite3.connect(_CONVERSACIONES_DB) as conn:
            conn.execute(
                "DELETE FROM conversaciones_whatsapp WHERE usuario_id = ?",
                (usuario_id,),
            )
            conn.executemany(
                """
                INSERT INTO conversaciones_whatsapp
                    (usuario_id, idx, role, content_json)
                VALUES (?, ?, ?, ?)
                """,
                [
                    (
                        usuario_id,
                        idx,
                        msg.get("role", ""),
                        json.dumps(msg.get("content", ""), ensure_ascii=False),
                    )
                    for idx, msg in enumerate(limpio)
                ],
            )
    except Exception as e:
        _log_error(f"Guardar historial persistente usuario={usuario_id}", e)


def _memoria_vectorial_para_chat(pregunta: str) -> str:
    if os.getenv("AGENTE_USAR_MEMORIA_VECTORIAL_CHAT", "1").strip() == "0":
        return ""
    if not (pregunta or "").strip():
        return ""
    try:
        memoria = query_vector_db(pregunta[:500])
    except Exception as e:
        _log_error("Memoria vectorial chat", e)
        return ""
    baja = (memoria or "").lower()
    if not memoria or "error:" in baja or "no tengo recuerdos" in baja:
        return ""
    return memoria[:1800]


# Compat stub (routes.py podría referenciar esto)
modelo_ia = None
_gemini_modelo_chat = "gemini-2.5-pro"
_permitir_fallback_claude = os.getenv("AGENTE_PERMITIR_FALLBACK_CLAUDE", "0").strip() == "1"


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
        if name == "self":
            continue

        ann = hints.get(name, param.annotation)

        # Si el tipo es Optional[X] o tiene default → no es required
        is_optional = param.default is not inspect.Parameter.empty
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
        },
    }
    if required:
        schema["input_schema"]["required"] = required

    return schema


def _parse_adjuntos_chat(raw) -> list[tuple[str, bytes]]:
    """Lista de (media_type, bytes) desde JSON `adjuntos` / `attachments`. Errores → ValueError."""
    if not raw:
        return []
    if not isinstance(raw, list):
        raise ValueError("adjuntos debe ser una lista")
    if len(raw) > _MAX_ADJUNTOS_CHAT:
        raise ValueError(f"Máximo {_MAX_ADJUNTOS_CHAT} archivos por mensaje")
    out: list[tuple[str, bytes]] = []
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError("cada adjunto debe ser un objeto")
        mt = (item.get("media_type") or item.get("mime") or "").strip().lower()
        if mt == "image/jpg":
            mt = "image/jpeg"
        b64 = item.get("data_base64") or item.get("data") or ""
        if not isinstance(b64, str) or not b64.strip():
            raise ValueError("cada adjunto necesita data_base64")
        if "," in b64 and b64.lstrip().startswith("data:"):
            b64 = b64.split(",", 1)[1]
        try:
            raw_bytes = base64.b64decode(b64, validate=True)
        except Exception as e:
            raise ValueError(f"Base64 inválido: {e}") from e
        if len(raw_bytes) > _MAX_BYTES_ADJUNTO_CHAT:
            raise ValueError(
                f"Archivo demasiado grande (máx. {_MAX_BYTES_ADJUNTO_CHAT // 1_000_000} MB por archivo)"
            )
        if mt not in _CHAT_MEDIA_OK:
            raise ValueError(f"Tipo no soportado: {mt}")
        out.append((mt, raw_bytes))
    return out


def _bloques_claude_adjuntos(media_type: str, data: bytes) -> dict:
    b64 = base64.b64encode(data).decode("ascii")
    if media_type == "application/pdf":
        return {
            "type": "document",
            "source": {
                "type": "base64",
                "media_type": "application/pdf",
                "data": b64,
            },
        }
    return {
        "type": "image",
        "source": {"type": "base64", "media_type": media_type, "data": b64},
    }


def _sanitizar_turno_usuario_binario(
    messages: list,
    user_msg_index: int,
    usuario_id: str,
    pregunta: str,
    n_adjuntos: int,
) -> list:
    """Quita base64 del turno usuario en `user_msg_index` antes de guardar historial en RAM."""
    if n_adjuntos <= 0 or user_msg_index < 0 or user_msg_index >= len(messages):
        return messages
    snap = copy.deepcopy(messages)
    c = snap[user_msg_index].get("content")
    if not isinstance(c, list):
        return messages
    snap[user_msg_index]["content"] = (
        f"Usuario_{usuario_id}: {pregunta or '[adjunto]'} "
        f"[{n_adjuntos} archivo(s) enviado(s); ya procesados en este turno]"
    )
    return snap


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
            result.append(
                {
                    "type": "tool_use",
                    "id": block.id,
                    "name": block.name,
                    "input": block.input,
                }
            )
        else:
            # fallback
            if hasattr(block, "model_dump"):
                result.append(block.model_dump())
    return result


# ==========================================
# Carga de casos de entrenamiento
# ==========================================


def cargar_casos_especiales():
    try:
        with open("app/training/casos_especiales.json", "r", encoding="utf-8") as f:
            data = json.load(f)
            casos = data.get("casos", [])
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
    Configura clientes LLM y registra herramientas para fallback con Claude.
    """
    global cliente_ia, cliente_gemini, _tools_schema, _tools_map, _system_prompt

    try:
        anthropic_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
        gemini_key = os.getenv("GOOGLE_API_KEY", "").strip()
        cliente_ia = anthropic.Anthropic(api_key=anthropic_key) if anthropic_key else None
        cliente_gemini = genai.Client(api_key=gemini_key) if gemini_key else None

        todas_las_herramientas = [
            query_sqlite,
            query_vector_db,
            leer_datos_hoja,
            aprender_de_interacciones_meli,
            consultar_devoluciones_meli,
            consultar_detalle_venta_meli,
            responder_solicitud_rut,
            buscar_ventas_acordar_entrega,
            enviar_email_reporte,
            listar_archivos_proyecto,
            crear_backup,
            parchear_funcion,
            leer_funcion,
            crear_nuevo_script,
            ejecutar_script_python,
            sincronizar_manual_por_id,
            sincronizar_inteligente,
            sincronizar_por_dia_especifico,
            refrescar_token_meli,
            enviar_whatsapp_reporte,
            procesar_facturas_para_importar_productos,
            sincronizar_precios_meli_sheets,
            generar_catalogo_pdf,
            generar_guias_masivas_web,
            publicar_contenido_redes_sociales_ia,
            crear_cotizacion_siigo,
            crear_cotizacion_preliminar,
            crear_factura_completa_siigo,
            consultar_tarifa_envio,
            consultar_tarifa_mercadoenvios,
            buscar_producto_completo,
            auditar_scripts,
        ]

        _tools_map = {fn.__name__: fn for fn in todas_las_herramientas}
        _tools_schema = [_fn_to_tool_schema(fn) for fn in todas_las_herramientas]

        _system_prompt = INSTRUCCIONES_MCKENNA + cargar_casos_especiales()

        proveedor = []
        if cliente_gemini:
            proveedor.append("Gemini 2.5 Pro (primario)")
        if cliente_ia and _permitir_fallback_claude:
            proveedor.append("Claude (fallback + tools)")
        elif cliente_ia:
            proveedor.append("Claude (desactivado por AGENTE_PERMITIR_FALLBACK_CLAUDE=0)")
        print(f"🤖 Cerebro IA configurado: {', '.join(proveedor) or 'sin proveedor activo'} — {len(_tools_schema)} herramientas.")

    except Exception as e:
        print(f"❌ Error crítico al configurar la IA: {e}")
        cliente_ia = None
        cliente_gemini = None


def _extraer_texto_visible_mensaje(content) -> str:
    """Texto legible del cliente (sin tool_use ni bloques binarios)."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        partes: list[str] = []
        for b in content:
            if isinstance(b, dict) and b.get("type") == "text":
                partes.append(b.get("text", "") or "")
            elif hasattr(b, "type") and getattr(b, "type", None) == "text":
                partes.append(getattr(b, "text", "") or "")
        return " ".join(t for t in partes if t).strip()
    return str(content or "")


def _ultimo_texto_asistente_previo(messages: list) -> str | None:
    """Último turno assistant con texto, ignorando el user final."""
    if len(messages) < 2 or messages[-1].get("role") != "user":
        return None
    for i in range(len(messages) - 2, -1, -1):
        if messages[i].get("role") != "assistant":
            continue
        t = _extraer_texto_visible_mensaje(messages[i].get("content"))
        if t.strip():
            return t
    return None


def _asistente_pidio_cantidad_tras_producto(texto_asistente: str) -> bool:
    low = texto_asistente.lower()
    if "referencia:" not in low and "sku/referencia:" not in low:
        return False
    disparadores = (
        "cotización",
        "cotizacion",
        "cantidad",
        "cuánt",
        "cuant",
        "me indica",
        "indica la cantidad",
        "cuántas unidades",
        "cuantas unidades",
        "cuántos",
        "cuantos",
    )
    return any(d in low for d in disparadores)


def _extraer_referencia_desde_texto_asistente(texto: str) -> str | None:
    for pat in (
        r"sku/referencia:\s*([^\n]+)",
        r"referencia:\s*([^\n]+)",
    ):
        m = re.search(pat, texto, flags=re.I)
        if m:
            ref = m.group(1).strip()
            if ref:
                return ref.split()[0]
    return None


def _extraer_nombre_producto_desde_texto_asistente(texto: str) -> str | None:
    m = re.search(r"(?:nombre oficial|producto):\s*([^\n]+)", texto, flags=re.I)
    if m:
        n = m.group(1).strip()
        return n or None
    return None


def _parse_cantidad_respuesta_cliente(texto: str) -> float | None:
    t = (texto or "").strip().lower()
    if not t:
        return None
    if t in ("una", "un", "uno", "1u"):
        return 1.0
    if re.match(r"^\d+(?:[.,]\d+)?$", t):
        return float(t.replace(",", "."))
    m = re.match(r"^(\d+(?:[.,]\d+)?)\s*(unidad|unidades|uds?\.?|u)\s*$", t)
    if m:
        return float(m.group(1).replace(",", "."))
    if re.match(r"^\d+\s*(ml|l|g|gr|kg|oz)\s*$", t):
        return 1.0
    return None


def _fmt_precio_cop(n: float) -> str:
    return f"${n:,.0f} COP"


def resolver_cantidad_tras_oferta_producto(messages: list, pregunta: str) -> str | None:
    """
    Si el asistente acaba de ofrecer producto con referencia y pidió cantidad,
    interpreta la respuesta del usuario como cantidad (p. ej. "1", "1 unidad", "120 ml")
    y devuelve texto de confirmación con subtotal. Si no aplica, None.
    """
    cant = _parse_cantidad_respuesta_cliente(pregunta or "")
    if cant is None or cant <= 0 or cant > 1_000_000:
        return None
    asst = _ultimo_texto_asistente_previo(messages)
    if not asst or not _asistente_pidio_cantidad_tras_producto(asst):
        return None
    sku = _extraer_referencia_desde_texto_asistente(asst)
    if not sku:
        return None
    prod = buscar_producto_siigo_por_sku(sku)
    if not prod:
        return None
    precio = float(prod.get("precio") or 0)
    if precio <= 0:
        return None
    nombre = (prod.get("nombre") or "").strip() or (
        _extraer_nombre_producto_desde_texto_asistente(asst) or sku
    )
    subtotal = precio * cant
    qtxt = str(int(cant)) if abs(cant - round(cant)) < 1e-9 else str(cant)
    return (
        f"Listo veci, te anoto {qtxt} unidad(es) de {nombre} (ref. {sku}).\n"
        f"Precio unitario: {_fmt_precio_cop(precio)} — subtotal: {_fmt_precio_cop(subtotal)}.\n"
        "¿Me comparte nombre o razón social y NIT o cédula para seguir con la cotización?"
    )


def _historial_a_texto_simple(messages: list) -> str:
    """Convierte historial mixto a texto corto compatible con Gemini."""
    partes = []
    for m in messages[-12:]:
        role = m.get("role", "")
        content = m.get("content", "")
        if isinstance(content, str):
            texto = content
        elif isinstance(content, list):
            textos = []
            for b in content:
                if isinstance(b, dict) and b.get("type") == "text":
                    textos.append(b.get("text", ""))
                elif hasattr(b, "text"):
                    textos.append(getattr(b, "text", ""))
            texto = " ".join(t for t in textos if t).strip()
        else:
            texto = str(content)
        if texto:
            pref = "Cliente" if role == "user" else "Asistente"
            partes.append(f"{pref}: {texto}")
    return "\n".join(partes).strip()


def _responder_con_gemini_primario(
    pregunta: str, usuario_id: str, messages: list, adjuntos: list[tuple[str, bytes]]
) -> str | None:
    """
    Primer intento de respuesta: Gemini 2.5 Pro.
    Retorna texto o None para activar fallback a Claude.
    """
    if not cliente_gemini:
        return None
    if adjuntos:
        # Gemini primario por ahora solo texto en este flujo.
        # Si hay adjuntos, delega a fallback (Claude) que ya maneja binarios robustamente.
        return None

    contexto = _historial_a_texto_simple(messages)
    memoria_vectorial = _memoria_vectorial_para_chat(pregunta)
    prompt = (
        f"{_system_prompt}\n\n"
        f"ID de conversación: {usuario_id}\n"
        f"Historial reciente:\n{contexto or '[sin historial]'}\n\n"
        f"Memoria vectorial relevante:\n{memoria_vectorial or '[sin recuerdos relevantes]'}\n\n"
        f"Mensaje actual del cliente:\n{pregunta}\n\n"
        "Responde solo texto final para cliente."
    )
    try:
        resp = cliente_gemini.models.generate_content(
            model=_gemini_modelo_chat,
            contents=prompt,
        )
        txt = (getattr(resp, "text", "") or "").strip()
        return txt or None
    except Exception as e:
        _log_error(f"GeminiError usuario={usuario_id} msg='{(pregunta or '')[:80]}'", e)
        return None


# ==========================================
# Respuesta de IA — loop de tool dispatch
# ==========================================


def obtener_respuesta_ia(
    pregunta: str,
    usuario_id: str,
    historial: list = None,
    adjuntos_payload: list = None,
):
    """
    Usa Gemini 2.5 Pro como primera opción. Si falla o requiere binarios/tools,
    hace fallback a Claude con loop de herramientas.

    adjuntos_payload: lista de dicts {media_type, data_base64} (imagen/PDF) vía /chat.
    """
    if not cliente_gemini and not cliente_ia:
        return "Veci, estamos en mantenimiento. Intente en unos minutos 🙏", []

    try:
        adjuntos = _parse_adjuntos_chat(adjuntos_payload)
    except ValueError as ve:
        return f"Veci, no pude leer el adjunto: {ve} 🙏", []

    n_adj = len(adjuntos)
    texto_usuario = f"Usuario_{usuario_id}: {pregunta or ''}".strip()
    if not (pregunta or "").strip() and not adjuntos:
        return "Veci, escribe un mensaje o adjunta un archivo 🙏", []

    # Recuperar historial previo del usuario (o usar el pasado como parámetro)
    if historial:
        messages = list(historial)
    else:
        messages = list(
            _historiales.get(usuario_id)
            or _cargar_historial_persistente(usuario_id)
        )

    user_msg_index = len(messages)
    if adjuntos:
        bloques: list = [{"type": "text", "text": texto_usuario or f"Usuario_{usuario_id}: [adjunto]"}]
        for mt, raw in adjuntos:
            bloques.append(_bloques_claude_adjuntos(mt, raw))
        messages.append({"role": "user", "content": bloques})
    else:
        messages.append({"role": "user", "content": texto_usuario})

    # Respuesta a cantidad tras ofertar producto (evita que "1" o "1 unidad" disparen nueva búsqueda).
    if not adjuntos:
        resp_cant = resolver_cantidad_tras_oferta_producto(messages, pregunta or "")
        if resp_cant:
            final_messages = messages + [{"role": "assistant", "content": resp_cant}]
            final_messages = final_messages[-_MAX_HISTORIAL_PERSISTENTE:]
            _historiales[usuario_id] = final_messages
            _guardar_historial_persistente(usuario_id, final_messages)
            return resp_cant, final_messages

    # 1) Ruta primaria: Gemini 2.5 Pro
    respuesta_gemini = _responder_con_gemini_primario(
        pregunta=pregunta or "",
        usuario_id=usuario_id,
        messages=messages,
        adjuntos=adjuntos,
    )
    if respuesta_gemini:
        final_messages = messages + [{"role": "assistant", "content": respuesta_gemini}]
        final_messages = final_messages[-_MAX_HISTORIAL_PERSISTENTE:]
        _historiales[usuario_id] = final_messages
        _guardar_historial_persistente(usuario_id, final_messages)
        return respuesta_gemini, final_messages

    # 2) Fallback: Claude (tools/binarios), solo si está habilitado explícitamente.
    if not _permitir_fallback_claude:
        return (
            "Veci, el servicio IA está en ajuste técnico temporal. "
            "Por favor intente de nuevo en un momento 🙏",
            [],
        )
    if not cliente_ia:
        return "Veci, estamos en mantenimiento temporal. Intente de nuevo en unos minutos 🙏", []

    log_json(
        "ia_turn_start",
        usuario_id=str(usuario_id)[:80],
        pregunta_chars=len(pregunta or ""),
        adjuntos_n=n_adj,
    )

    def _persistir_historial(msgs: list) -> list:
        limpio = _sanitizar_turno_usuario_binario(
            msgs, user_msg_index, usuario_id, (pregunta or "").strip(), n_adj
        )
        limpio = limpio[-_MAX_HISTORIAL_PERSISTENTE:]
        _historiales[usuario_id] = limpio
        _guardar_historial_persistente(usuario_id, limpio)
        return limpio

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
                    current_messages.append(
                        {"role": "assistant", "content": asst_content}
                    )

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
                                log_json(
                                    "tool_ok",
                                    tool=block.name,
                                    result_chars=len(result_str),
                                    truncated=len(str(result)) > 8192,
                                )
                            except Exception as tool_exc:
                                result_str = (
                                    f"[TOOL_ERROR] La herramienta '{block.name}' falló: {tool_exc}. "
                                    "No asumas que se ejecutó bien; corrige argumentos o informa al usuario."
                                )
                                spawn_thread(
                                    manejar_incidente_autocorreccion,
                                    kwargs={
                                        "error": f"ToolError {block.name}: {tool_exc}",
                                        "contexto": json.dumps(
                                            block.input, ensure_ascii=False
                                        )[:2000],
                                        "origen": "tool_use",
                                    },
                                    daemon=True,
                                )
                                _log_error(
                                    f"Tool {block.name} args={block.input}", tool_exc
                                )
                                log_json(
                                    "tool_error",
                                    tool=block.name,
                                    error_type=type(tool_exc).__name__,
                                    error=str(tool_exc)[:500],
                                )
                        else:
                            result_str = (
                                f"[TOOL_ERROR] Herramienta '{block.name}' no existe en el mapa. "
                                "Elige otra acción."
                            )
                            log_json("tool_missing", tool=block.name)

                        print(f"   ↳ {result_str[:120]}")
                        tool_results.append(
                            {
                                "type": "tool_result",
                                "tool_use_id": block.id,
                                "content": result_str,
                            }
                        )

                    # 3. Devolver resultados a Claude y continuar
                    current_messages.append({"role": "user", "content": tool_results})

                elif response.stop_reason == "end_turn":
                    # Extraer texto final
                    texto = "".join(
                        block.text
                        for block in response.content
                        if hasattr(block, "text")
                    )

                    # Actualizar historial persistente del usuario
                    final_messages = current_messages + [
                        {
                            "role": "assistant",
                            "content": _serializar_content(response.content),
                        }
                    ]
                    limpio = _persistir_historial(final_messages)

                    if not (pregunta or "").startswith("BOT_"):
                        return (
                            texto or "✅ Tarea ejecutada en segundo plano.",
                            limpio,
                        )
                    else:
                        return "", limpio

                elif response.stop_reason == "max_tokens":
                    # Respuesta cortada por límite de tokens — devolver lo que haya
                    texto = "".join(
                        block.text
                        for block in response.content
                        if hasattr(block, "text")
                    )
                    print(f"⚠️ Respuesta cortada por max_tokens")
                    final_messages = current_messages + [
                        {
                            "role": "assistant",
                            "content": _serializar_content(response.content),
                        }
                    ]
                    limpio = _persistir_historial(final_messages)
                    user_text = texto.strip() or (
                        "Veci, la respuesta se cortó por tamaño. ¿Puede ser más específico? 🙏"
                    )
                    if texto.strip():
                        user_text = (
                            f"{user_text}\n\n(Ajuste: si falta detalle, pregunte una cosa puntual.)"
                        )
                    return user_text, limpio

                else:
                    print(f"⚠️ stop_reason inesperado: {response.stop_reason}")
                    limpio = _persistir_historial(current_messages)
                    return (
                        "Veci, tuve un problema al completar la respuesta. "
                        "¿Intenta de nuevo en un momentico? 🙏",
                        limpio,
                    )
            else:
                print(
                    f"⚠️ Límite de {MAX_TOOL_ITERS} iteraciones de herramientas alcanzado"
                )
                limpio = _persistir_historial(current_messages)
                return (
                    "Veci, me quedé a medias usando las herramientas internas. "
                    "¿Me escribe de nuevo una sola pregunta concreta? 🙏",
                    limpio,
                )

        except anthropic.BadRequestError as e:
            # Esquemas de herramientas inválidos o mensaje malformado
            _log_error(
                f"BadRequestError usuario={usuario_id} msg='{(pregunta or '')[:80]}'", e
            )
            spawn_thread(
                manejar_incidente_autocorreccion,
                kwargs={
                    "error": f"AnthropicBadRequest: {e}",
                    "contexto": f"usuario_id={usuario_id} pregunta={(pregunta or '')[:400]}",
                    "origen": "core_badrequest",
                },
                daemon=True,
            )
            print(f"❌ Error de request Claude (BadRequest): {e}")
            # Limpiar historial de este usuario para evitar reenviar mensajes corruptos
            _historiales.pop(usuario_id, None)
            return (_mensaje_amigable_badrequest(str(e)), [])

        except anthropic.AuthenticationError as e:
            _log_error("AuthenticationError — verificar ANTHROPIC_API_KEY", e)
            spawn_thread(
                manejar_incidente_autocorreccion,
                kwargs={
                    "error": f"AnthropicAuthError: {e}",
                    "contexto": f"usuario_id={usuario_id}",
                    "origen": "core_auth",
                },
                daemon=True,
            )
            print(f"❌ Error de autenticación Claude: {e}")
            return "Veci, estamos en mantenimiento. Intente en unos minutos 🙏", []

        except Exception as e:
            error_str = str(e)
            _log_error(f"Error IA intento={intento + 1} usuario={usuario_id}", e)
            spawn_thread(
                manejar_incidente_autocorreccion,
                kwargs={
                    "error": f"CoreException {type(e).__name__}: {error_str}",
                    "contexto": f"usuario_id={usuario_id} pregunta={(pregunta or '')[:400]}",
                    "origen": "core_general",
                },
                daemon=True,
            )
            print(
                f"⚠️ Error IA (intento {intento + 1}/{MAX_REINTENTOS}): {type(e).__name__}: {error_str}"
            )

            if (
                "overloaded" in error_str.lower()
                or "529" in error_str
                or "503" in error_str
            ):
                if intento < MAX_REINTENTOS - 1:
                    espera = (intento + 1) * 5
                    print(f"⚠️ Claude sobrecargado — reintento en {espera}s")
                    _time.sleep(espera)
                    continue
                return (
                    "Veci, tenemos alta demanda en este momento. "
                    "Por favor escríbanos de nuevo en 2 minutos 🙏",
                    [],
                )

            if "429" in error_str or "rate_limit" in error_str.lower():
                return (
                    "Veci, estamos atendiendo muchos clientes. "
                    "Por favor espere un momento y escriba de nuevo 🙏",
                    [],
                )

            print(f"❌ Error IA inesperado ({type(e).__name__}): {e}")
            return (
                "Veci, tuve un problema técnico momentáneo. Por favor intente de nuevo 🙏",
                [],
            )

    return "Veci, intente de nuevo en un momento 🙏", []
