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
from app.services.siigo import (
    buscar_productos_combo_siigo as _buscar_productos_combo_siigo,
    buscar_combos_siigo_estructurado,
)
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
from app.tools.sede_sur import (
    crear_ticket_sede_sur,
    resolver_ticket_sede_sur,
    listar_tickets_sede_sur,
)


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


def buscar_productos_combo_siigo(consulta: str) -> str:
    """
    Busca presentaciones tipo Combo activas en SIIGO (catálogo web comprable).
    Usar en chat web para precios y presentaciones. No usar catálogo legacy de Sheets.
    """
    return _buscar_productos_combo_siigo(consulta)


def _wa_publico_display() -> str:
    """Número WhatsApp público para clientes (web)."""
    raw = (
        os.getenv("MCKENNA_WA_PUBLIC")
        or os.getenv("WEB_WA_NUMBER")
        or "573195183596"
    ).strip()
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 12 and digits.startswith("57"):
        return f"+{digits[:2]} {digits[2:5]} {digits[5:8]} {digits[8:]}"
    return f"+{digits}" if digits else "+57 319 518 3596"


def _nota_seguimiento_whatsapp_web() -> str:
    """Recordatorio estándar: cotización/seguimiento por WhatsApp (web no identifica al visitante)."""
    num = _wa_publico_display()
    wa_digits = re.sub(
        r"\D",
        "",
        os.getenv("MCKENNA_WA_PUBLIC") or os.getenv("WEB_WA_NUMBER") or "573195183596",
    )
    return (
        f"\n\nPara seguimiento de cotización o pedido, continúe por WhatsApp al {num} "
        f"(https://wa.me/{wa_digits}). "
        "En la web el chat no queda ligado a su celular si abre otra pestaña o borra datos del navegador."
    )


INSTRUCCIONES_WEB_CHAT = """
CANAL CHAT WEB (burbuja mckennagroup.co):
1. SOLO ofrezca presentaciones y precios que devuelva buscar_productos_combo_siigo (catálogo interno).
2. PROHIBIDO al cliente mencionar SIIGO, combo, ERP, Sheets o configuración interna. Diga "materia prima", "presentación" o "referencia".
3. PROHIBIDO inventar presentaciones ni precios sin consultar buscar_productos_combo_siigo.
4. Si preguntan USO, DOSIS, "cómo tomar", recomendación de consumo o formulación: NO liste precios otra vez.
   Responda la consulta técnica (usa buscar_productos_combo_siigo + contexto de ficha si aplica). Aclare que vendemos materia prima, no producto terminado.
5. DISPONIBILIDAD Y PRECIOS: Responda con el catálogo inyectado. Si no hay match, diga que no aparece en catálogo web ahora,
   sugiera mckennagroup.co/tienda y ofrezca WhatsApp solo como canal para confirmar stock especial — no obligue a cambiar de canal para una simple consulta.
6. DOCUMENTOS (COA, ficha técnica, ficha de seguridad/MSDS): Use los enlaces del contexto si vienen inyectados.
   Si no hay PDF, pida correo electrónico para enviarlos; puede mencionar guías en mckennagroup.co/guias. No sustituya documentos por lista de precios.
7. COTIZACIÓN DE PRECIOS por producto/presentación (ej. "cotización de 1 kg de cada uno"): responda con precios del catálogo en este chat.
8. La referencia (Ref.) es el SKU oficial para pedido.
9. WHATSAPP (explícito): Use WhatsApp solo para pago, link de pago, comprobante, facturación de pedido, seguimiento de pedido
   o cotización formal que el cliente quiera cerrar con asesor. Indique número +57 319 518 3596 (wa.me/573195183596).
   No redirija a WhatsApp por preguntas de producto, documentos o listas de ingredientes que puede resolver aquí.
10. No prometa "le escribo después en este chat" ni que recordará su sesión si cierra el navegador.
"""


def _prompt_sede_sur() -> str:
    """System prompt dinámico para el canal MCKG SEDE SUR (equipo interno)."""
    from datetime import datetime
    hoy = datetime.now()
    dias = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
    return f"""Eres el asistente operativo interno de McKenna Group para el equipo de SEDE SUR.
Hoy es {dias[hoy.weekday()]} {hoy.strftime('%d/%m/%Y')}.

ROL Y TONO:
- Asistente interno del equipo, NO agente de ventas al cliente.
- Directo, sin formalidades. Usa nombres propios del equipo.
- Responde en español colombiano, conciso (máx 3 líneas salvo que pidan detalle).

REGLAS ESTRICTAS DE COMPORTAMIENTO:
- NUNCA saludes espontáneamente. Prohibido iniciar respuestas con "¡Hola equipo!", "Buenos días", "Estoy listo para atender" ni variantes.
- Si alguien solo saluda o manda un mensaje social (hola, buenas, etc.) SIN hacer una pregunta o asignar una tarea, NO respondas nada.
- NO confirmes tu presencia ni disponibilidad si no te lo piden explícitamente.
- NO uses emojis innecesarios salvo ✅ para confirmaciones de tickets.

INTERPRETACIÓN DE MARCADORES (el sistema ya ejecutó la acción antes de pasarte el mensaje):
- [TICKET CREADO: TKT-2026-XXXX asignado a Nombre | ...]
  → Confirma: "✅ TKT-2026-XXXX creado para Nombre: <título>"
- [TICKET RESUELTO: TKT-2026-XXXX — '<título>' — marcado como RESUELTO]
  → Anuncia: "✅ Nombre resolvió TKT-2026-XXXX: <título>"
- [ERROR al resolver ticket ...]  o  [NO SE PUDO CREAR TICKET ...]
  → Explica el error en 1 línea y sugiere cómo corregirlo.

EJEMPLOS DE INTERPRETACIÓN:
  "[TICKET CREADO: TKT-2026-0017 asignado a Cynthia Ruiz | Prioridad: media | Categoría: ventas]\nMensaje: @Cynthia Revisar el grupo de postventa"
  → ✅ TKT-2026-0017 creado para Cynthia Ruiz: Revisar el grupo de postventa

  "[TICKET RESUELTO: TKT-2026-0017 — 'Revisar el grupo de postventa' — marcado como RESUELTO]\nMensaje: resuelto TKT-2026-0017"
  → ✅ Cynthia resolvió TKT-2026-0017: Revisar el grupo de postventa

  "Llegan 2 cajas de la USA entre mañana y el sábado"
  → Responde con novedad. Si aplica, sugiere crear ticket de recepción.
"""


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
# Chat web necesita tools (combos SIIGO); por defecto Claude activo solo en web aunque el global esté en 0.
_permitir_claude_web_chat = os.getenv("AGENTE_WEB_CHAT_CLAUDE", "1").strip() != "0"


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
            buscar_productos_combo_siigo,
            auditar_scripts,
            crear_ticket_sede_sur,
            resolver_ticket_sede_sur,
            listar_tickets_sede_sur,
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


def _es_usuario_web_chat(usuario_id: str) -> bool:
    uid = (usuario_id or "").strip().lower()
    return uid.startswith("web-")


def resolver_cantidad_tras_oferta_producto(
    messages: list, pregunta: str, usuario_id: str = ""
) -> str | None:
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
    base = (
        f"Listo veci, te anoto {qtxt} unidad(es) de {nombre} (ref. {sku}).\n"
        f"Precio unitario: {_fmt_precio_cop(precio)} — subtotal: {_fmt_precio_cop(subtotal)}.\n"
        "¿Me comparte nombre o razón social y NIT o cédula para seguir con la cotización?"
    )
    if _es_usuario_web_chat(usuario_id):
        base += _nota_seguimiento_whatsapp_web()
    return base


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


def _es_canal_web_chat(canal: str, usuario_id: str) -> bool:
    c = (canal or "").strip().lower()
    if c in ("web_chat", "web"):
        return True
    uid = (usuario_id or "").strip().lower()
    return uid.startswith("web-")


_SALUDOS_WEB = frozenset(
    {
        "hola",
        "buenas",
        "buenos dias",
        "buenas tardes",
        "buenas noches",
        "buen dia",
        "hey",
        "hi",
        "hello",
        "ok",
        "gracias",
        "muchas gracias",
        "vale",
        "listo",
        "perfecto",
        "entiendo",
        "entendido",
        "de acuerdo",
    }
)

_SALUDO_PURO_RE = re.compile(
    r"^(?:"
    r"hola|hey|hi|hello|buenas?|"
    r"buenos?\s+d[ií]as?|buen\s+d[ií]a|"
    r"buenas?\s+tardes|buenas?\s+noches|"
    r"qu[eé]\s+tal"
    r")(?:[\s,!.]+(?:"
    r"hola|hey|hi|hello|buenas?|"
    r"buenos?\s+d[ií]as?|buen\s+d[ií]a|"
    r"buenas?\s+tardes|buenas?\s+noches|"
    r"qu[eé]\s+tal"
    r"))*$",
    re.IGNORECASE,
)

_PATRONES_CORRECCION_WEB = (
    r"\bte\s+confundiste\b",
    r"\bno\s+es\s+conmigo\b",
    r"\bno\s+te\s+ped[ií]\b",
    r"\beso\s+no\s+es\b",
    r"\bno\s+era\s+eso\b",
    r"\bmal\s+entendiste\b",
    r"\bno\s+entendiste\b",
)


def _normalizar_texto_web(texto: str) -> str:
    low = re.sub(r"\s+", " ", (texto or "").strip().lower())
    return re.sub(r"[!?.…,;:]+$", "", low).strip()


def _es_saludo_puro_web(texto: str) -> bool:
    low = _normalizar_texto_web(texto)
    if not low:
        return False
    if low in _SALUDOS_WEB:
        return True
    return bool(_SALUDO_PURO_RE.match(low))


def _mensaje_parece_correccion_cliente_web(texto: str) -> bool:
    low = _normalizar_texto_web(texto)
    if not low:
        return False
    return any(re.search(p, low) for p in _PATRONES_CORRECCION_WEB)


def _respuesta_saludo_web() -> str:
    return (
        "Hola veci, soy Hugo García de McKenna Group S.A.S. "
        "¿En qué le puedo servir? Puede consultarme precios, disponibilidad, "
        "ficha técnica o uso de materias primas."
    )


def _respuesta_correccion_web() -> str:
    return (
        "Disculpe veci, me equivoqué 🙏 ¿Me indica qué producto o consulta necesita? "
        "Así le respondo puntual."
    )


def _es_reconocimiento_corto_web(texto: str) -> bool:
    low = _normalizar_texto_web(texto)
    if low in _SALUDOS_WEB:
        return True
    if _es_saludo_puro_web(texto):
        return True
    return bool(re.match(r"^(ok|entiendo|entendido|gracias|vale|listo|si|sí)\b", low))


def _mensaje_parece_consulta_tecnica_web(texto: str) -> bool:
    """Uso, dosis, propiedades físicas — no es búsqueda de catálogo/precio."""
    from app.web_chat_escalacion import mensaje_pide_propiedad_fisica

    low = re.sub(r"\s+", " ", (texto or "").strip().lower())
    if len(low) < 4:
        return False
    if mensaje_pide_propiedad_fisica(texto):
        return True
    patrones = (
        r"\b(como|cómo)\s+(se\s+)?(toma|tomar|usa|usar|aplica|aplicar|prepara|preparar|debe)",
        r"\bdebe\s+tomar\b",
        r"\b(cuantos|cuántos)\s+gramos\b",
        r"\bgramos\s+(al|por)\s+d[ií]a\b",
        r"\b(dosis|dosificaci[oó]n|ingerir|consumir|recomendaci[oó]n)\b",
        r"\bmodo\s+de\s+(uso|empleo|preparaci[oó]n)\b",
        r"\buna\s+pregunta\b",
        r"\b(formulaci[oó]n|mezclar|diluir)\b",
        r"\bpara\s+que\s+sirve\b",
    )
    if any(re.search(p, low) for p in patrones):
        return True
    if "proteína" in low or "proteina" in low:
        if any(w in low for w in ("tomar", "toma", "dia", "día", "gramos", "dosis", "debe")):
            return True
    return False


def _mensaje_parece_solicitud_documentos_web(texto: str) -> bool:
    from app.web_chat_documentos import mensaje_pide_documentacion_web

    return mensaje_pide_documentacion_web(texto)


def _mensaje_parece_consulta_catalogo_web(texto: str) -> bool:
    """Precio, disponibilidad o nombre de producto — respuesta directa de catálogo."""
    if _mensaje_parece_solicitud_documentos_web(texto):
        return False
    if _mensaje_parece_consulta_tecnica_web(texto):
        return False
    if _es_saludo_puro_web(texto):
        return False
    if _mensaje_parece_correccion_cliente_web(texto):
        return False
    low = re.sub(r"\s+", " ", (texto or "").strip().lower())
    if len(low) < 3:
        return False
    if low in _SALUDOS_WEB:
        return False
    if re.match(r"^(ok|gracias|si|no|vale|listo)\b", low):
        return False
    if re.search(r"\b(cuanto|cuánto)\s+(cuesta|vale|es|sale|cobra|est[aá])\b", low):
        return True
    disparadores = (
        "precio",
        "cuesta",
        "tienen",
        "tiene",
        "venden",
        "manejan",
        "dispon",
        "stock",
        "presentacion",
        "presentación",
        "referencia",
        "cotiz",
        "comprar",
        "pedir",
        "necesito precio",
        "aminoacido",
        "aminoácido",
        "proteina",
        "proteína",
    )
    if any(d in low for d in disparadores):
        return True
    if _es_seleccion_presentacion_web(texto):
        return True
    tokens = re.findall(r"[a-záéíóúüñ]{4,}", low)
    return len(tokens) >= 1 and len(low) >= 4 and "?" not in low


def _es_seleccion_presentacion_web(texto: str) -> bool:
    """Cliente elige variante corta (ej. 'concentrada suero de leche')."""
    low = (texto or "").strip().lower()
    if not low or len(low) > 70:
        return False
    if re.fullmatch(r"\d{1,2}", low):
        return False
    if _es_saludo_puro_web(texto):
        return False
    if _mensaje_parece_consulta_tecnica_web(texto):
        return False
    if any(w in low for w in ("?", "como ", "cómo ", "cuantos", "cuántos", "precio", "cuesta")):
        return False
    return True


def _mensaje_parece_consulta_producto(texto: str) -> bool:
    """Compat: catálogo o consulta técnica con producto."""
    return _mensaje_parece_consulta_catalogo_web(texto) or _mensaje_parece_consulta_tecnica_web(
        texto
    )


def _contexto_historial_web(messages: list) -> str:
    partes: list[str] = []
    for m in (messages or [])[-8:]:
        texto = _extraer_texto_visible_mensaje(m.get("content"))
        if texto:
            partes.append(texto[:600])
    return " ".join(partes)[-1200:]


def _termino_busqueda_producto_web(pregunta: str, messages: list) -> str:
    pregunta = (pregunta or "").strip()
    if _es_seleccion_presentacion_web(pregunta):
        prod = _extraer_producto_reciente_historial_web(messages)
        low = (pregunta or "").strip().lower()
        # Alias comunes: "la grande/mediana/pequeña"
        if re.search(r"\bgrande\b", low) and not re.search(r"\b(kg|kilo)\b", low):
            pregunta = f"{pregunta} kg"
        elif re.search(r"\bmediana\b", low) and not re.search(r"\b500\s*g\b|\b500g\b", low):
            pregunta = f"{pregunta} 500g"
        elif re.search(r"\bpeque(n|ñ)a\b", low) and not re.search(r"\b250\s*g\b|\b250g\b", low):
            pregunta = f"{pregunta} 250g"
        if prod:
            return f"{prod} {pregunta}".strip()
        return pregunta
    if _mensaje_parece_consulta_catalogo_web(pregunta):
        return pregunta
    if _mensaje_parece_consulta_tecnica_web(pregunta):
        prod = _extraer_producto_reciente_historial_web(messages)
        if prod:
            return prod
        return pregunta
    return pregunta


def _extraer_producto_reciente_historial_web(messages: list) -> str:
    for m in reversed((messages or [])[-12:]):
        if m.get("role") != "assistant":
            continue
        text = _extraer_texto_visible_mensaje(m.get("content"))
        for line in text.split("\n"):
            line = line.strip()
            if line.startswith("- ") and "Ref." in line:
                nombre = line[2:].split(":")[0].strip()
                if nombre:
                    return nombre
        m_star = re.search(r"\*([^*]+)\*", text)
        if m_star:
            return m_star.group(1).strip()
    return ""


def _filtrar_items_por_seleccion_cliente(
    items: list[dict], pregunta: str
) -> list[dict]:
    """Si el cliente eligió una variante corta, mostrar solo la coincidencia fuerte."""
    if not _es_seleccion_presentacion_web(pregunta):
        return items
    low = _normalizar_busqueda_combo_web(pregunta)
    if not low:
        return items
    palabras = [w for w in low.split() if len(w) >= 4]
    # Sinónimos comunes en chat
    if "kilo" in low or "kilito" in low:
        palabras.extend(["kg"])
    if "grande" in low:
        palabras.extend(["kg"])
    if "mediana" in low:
        palabras.extend(["500g"])
    if "pequena" in low or "pequeña" in low:
        palabras.extend(["250g"])
    if re.search(r"\b1\s*(kilo|kg)\b", low):
        palabras.extend(["kg"])
    filtrados: list[tuple[int, dict]] = []
    for it in items:
        blob = _normalizar_busqueda_combo_web(f"{it.get('name', '')} {it.get('ref', '')}")
        score = sum(3 for w in palabras if w in blob)
        # Priorización directa por gramaje/cantidad pedida
        if "500g" in low and ("500g" in blob or " 500 g" in blob):
            score += 10
        if "250g" in low and ("250g" in blob or " 250 g" in blob):
            score += 10
        if "100g" in low and ("100g" in blob or " 100 g" in blob):
            score += 10
        if ("kilo" in low or "kg" in low) and (" kg" in f" {blob} " or blob.endswith("kg")):
            score += 12
        if "grande" in low and (" kg" in f" {blob} " or blob.endswith("kg")):
            score += 8
        if "mediana" in low and ("500g" in blob or " 500 g" in blob):
            score += 8
        if ("pequena" in low or "pequeña" in low) and ("250g" in blob or " 250 g" in blob):
            score += 8
        if low in blob or all(w in blob for w in palabras[:3] if len(palabras) >= 2):
            score += 8
        if score > 0:
            filtrados.append((score, it))
    if not filtrados:
        return items
    filtrados.sort(key=lambda x: -x[0])
    if filtrados[0][0] >= 6:
        return [filtrados[0][1]]
    return items


def _filtrar_items_por_consulta_web(items: list[dict], consulta: str) -> list[dict]:
    """
    Reduce 'falsos positivos' del catálogo web.

    Ej: si el cliente pregunta "citrato de magnesio", no mostrar citrato de potasio/calcio.
    Estrategia:
      - Extraer tokens significativos de la consulta (>=4 chars, sin stopwords).
      - Mantener solo items cuyo (name+ref) contenga TODOS los tokens.
      - Si no hay match estricto, devolver items originales (no esconder todo).
    """
    if not items:
        return items
    q = _normalizar_busqueda_combo_web(consulta)
    if len(q) < 4:
        return items
    stop = {
        "de",
        "del",
        "la",
        "el",
        "los",
        "las",
        "para",
        "por",
        "con",
        "sin",
        "y",
        "o",
        "un",
        "una",
        "unos",
        "unas",
        "presentacion",
        "presentaciones",
        "precio",
        "cuesta",
        "vale",
        "tienen",
        "tiene",
        "disponible",
        "disponibilidad",
        "stock",
        "catalogo",
        "catálogo",
    }
    tokens = [t for t in q.split() if len(t) >= 4 and t not in stop and not t.isdigit()]
    if not tokens:
        return items

    def blob(it: dict) -> str:
        return _normalizar_busqueda_combo_web(f"{it.get('name','')} {it.get('ref','')}")

    strict = [it for it in items if all(tok in blob(it) for tok in tokens)]
    return strict or items


def _normalizar_busqueda_combo_web(texto: str) -> str:
    import unicodedata

    t = (texto or "").strip().lower()
    t = unicodedata.normalize("NFD", t)
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    t = re.sub(r"[^a-z0-9\s]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def _formatear_respuesta_directa_combos_web(
    items: list[dict], consulta: str, pregunta_cliente: str = ""
) -> str:
    items = _filtrar_items_por_consulta_web(items, consulta or pregunta_cliente or "")
    items = _filtrar_items_por_seleccion_cliente(items, pregunta_cliente or consulta)
    if not items:
        return (
            "Veci, por ahora no tenemos esa referencia publicada en el catálogo web. "
            "Puede revisar mckennagroup.co o escribirnos por WhatsApp y le confirmamos."
        )
    if len(items) == 1:
        it = items[0]
        precio = (
            f"${it['precio_web']:,.0f} COP"
            if it.get("precio_web", 0) > 0
            else "precio a confirmar"
        )
        return (
            f"Claro, veci. Tenemos *{it['name']}* como materia prima. "
            f"Presentación: {precio} — Ref. {it['ref']}. "
            "¿Cuántas unidades necesita?"
        )

    pregunta_low = _normalizar_busqueda_combo_web(pregunta_cliente or consulta)
    es_pregunta_disponibilidad = bool(
        re.search(r"\b(tienen|tiene|hay|disponible|disponibilidad|stock)\b", pregunta_low)
    )

    # Prioriza presentaciones más comunes para respuestas cortas.
    def _score_presentacion(it: dict) -> int:
        name = _normalizar_busqueda_combo_web(str(it.get("name") or ""))
        score = 0
        if "250g" in name or " 250 g" in name:
            score += 35
        if "500g" in name or " 500 g" in name:
            score += 30
        if " kg" in f" {name} " or name.endswith("kg"):
            score += 25
        if "100g" in name or " 100 g" in name:
            score += 15
        # Favorece también referencias simples frente a combos largos.
        score -= max(0, len(name) // 40)
        return score

    ordenados = sorted(items, key=_score_presentacion, reverse=True)
    top = (ordenados[:3] if es_pregunta_disponibilidad else ordenados[:8])

    # Formato más visual para chat web (sin tablas).
    lineas = []
    if es_pregunta_disponibilidad:
        lineas.append("Sí, veci ✅ Tenemos disponibilidad.")
        lineas.append("Le comparto las presentaciones más pedidas:")
    else:
        lineas.append("Listo veci. Estas son las presentaciones disponibles en catálogo:")
    for i, it in enumerate(top, 1):
        precio = (
            f"${it['precio_web']:,.0f} COP"
            if it.get("precio_web", 0) > 0
            else "consultar precio"
        )
        nombre = str(it.get("name") or "").strip()
        ref = str(it.get("ref") or "").strip()
        if nombre and len(nombre) > 90:
            nombre = nombre[:88] + "…"
        lineas.append(f"{i}) *{nombre}*")
        lineas.append(f"   {precio} — Ref. {ref}")
        lineas.append("")
    if len(items) > len(top):
        lineas.append(
            f"(Mostrando {len(top)} opciones. Si me dice el gramaje exacto, le filtro la referencia ideal.)"
        )
        lineas.append("")
    lineas.append("¿Cuál presentación le sirve?")
    return "\n".join(lineas)


def _respuesta_directa_web_si_combos(
    pregunta: str, messages: list
) -> str | None:
    """
    Respuesta sin LLM solo para consultas de catálogo/precio (no uso ni dosis).
    """
    if _es_reconocimiento_corto_web(pregunta):
        return None
    if _mensaje_parece_consulta_tecnica_web(pregunta):
        return None
    if not _mensaje_parece_consulta_catalogo_web(pregunta):
        return None
    termino = _termino_busqueda_producto_web(pregunta, messages)
    if len((termino or "").strip()) < 3:
        return None
    try:
        items, estado = buscar_combos_siigo_estructurado(termino)
    except Exception as e:
        _log_error("respuesta_directa_web_combos", e)
        return None
    if items:
        return _formatear_respuesta_directa_combos_web(
            items, termino, pregunta_cliente=pregunta
        )
    if estado and "No encontré combo" in estado:
        display = _wa_publico_display()
        return (
            f"Veci, no encontré esa presentación en nuestro catálogo web en este momento. "
            f"Revise https://mckennagroup.co/tienda o cuénteme la referencia exacta y le confirmo. "
            f"Si prefiere hablar con un asesor: WhatsApp {display}."
        )
    return None


def _enriquecer_pregunta_tecnica_web(pregunta: str, messages: list) -> str:
    prod = _extraer_producto_reciente_historial_web(messages)
    base = (pregunta or "").strip()
    if prod:
        return (
            f"[Contexto: el cliente consulta sobre la materia prima '{prod}' "
            f"que ya se ofreció en el chat. Vendemos materia prima, NO producto terminado.]\n\n"
            f"Pregunta del cliente: {base}\n\n"
            "Responda uso, dosis orientativa o cómo se suele emplear en formulación. "
            "No repita lista de precios. Si no tiene dato exacto en ficha, dé orientación "
            "general prudente y sugiera validar con su formulador o WhatsApp."
        )
    return (
        f"{base}\n\n"
        "(Consulta técnica de uso/dosis — materia prima McKenna, no producto terminado.)"
    )


def _sanitizar_respuesta_web_chat(texto: str) -> str:
    """Quita ruido de tool-use y términos internos que no debe ver el cliente."""
    if not texto:
        return texto
    t = re.sub(
        r"`?tools\.\w+\([^)]*\)`?",
        "",
        texto,
        flags=re.IGNORECASE,
    )
    t = re.sub(
        r"presentaciones?\s+combo\s+siigo\s+activas?",
        "presentaciones disponibles en catálogo",
        t,
        flags=re.IGNORECASE,
    )
    t = re.sub(
        r"combo\s+siigo",
        "presentación en catálogo",
        t,
        flags=re.IGNORECASE,
    )
    t = re.sub(r"\bSIIGO\b", "", t, flags=re.IGNORECASE)
    t = re.sub(r"\s{2,}", " ", t)
    t = re.sub(r"\n{3,}", "\n\n", t).strip()
    return t


def _preflight_contexto_combos_web(pregunta: str, messages: list | None = None) -> str | None:
    if _mensaje_parece_consulta_tecnica_web(pregunta):
        return None
    termino = _termino_busqueda_producto_web(pregunta, messages or [])
    if not _mensaje_parece_consulta_catalogo_web(pregunta) and not _mensaje_parece_consulta_catalogo_web(
        termino
    ):
        if not messages:
            return None
    try:
        datos = _buscar_productos_combo_siigo(termino)
    except Exception as e:
        _log_error("preflight_combos_web", e)
        return None
    if not datos:
        return None
    return datos


def _preflight_contexto_whatsapp(pregunta: str, messages: list | None = None) -> str | None:
    """Catálogo Sheets + ficha en columna I (sin tool-use API)."""
    if _es_reconocimiento_corto_web(pregunta):
        return None
    if not _mensaje_parece_consulta_catalogo_web(pregunta):
        return None
    termino = _termino_busqueda_producto_web(pregunta, messages or [])
    if len((termino or "").strip()) < 3:
        return None
    try:
        datos = buscar_producto_completo(termino)
    except Exception as e:
        _log_error("preflight_catalogo_whatsapp", e)
        return None
    if not datos or "no encontrado" in (datos or "").lower():
        return None
    return datos


def _preflight_ficha_tecnica(pregunta: str, messages: list | None = None) -> str | None:
    if not _mensaje_parece_consulta_tecnica_web(pregunta):
        return None
    termino = _termino_busqueda_producto_web(pregunta, messages or [])
    if len((termino or "").strip()) < 3:
        return None
    try:
        from app.services.google_services import buscar_ficha_tecnica_producto

        ficha = buscar_ficha_tecnica_producto(termino)
    except Exception as e:
        _log_error("preflight_ficha_tecnica", e)
        return None
    if not ficha:
        return None
    return str(ficha)[:3500]


def _responder_con_gemini_primario(
    pregunta: str,
    usuario_id: str,
    messages: list,
    adjuntos: list[tuple[str, bytes]],
    system_prompt: str | None = None,
    modelo_id: str | None = None,
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
    sys_txt = system_prompt or _system_prompt
    prompt = (
        f"{sys_txt}\n\n"
        f"ID de conversación: {usuario_id}\n"
        f"Historial reciente:\n{contexto or '[sin historial]'}\n\n"
        f"Memoria vectorial relevante:\n{memoria_vectorial or '[sin recuerdos relevantes]'}\n\n"
        f"Mensaje actual del cliente:\n{pregunta}\n\n"
        "Responde solo texto final para cliente."
    )
    try:
        modelo_gemini = (modelo_id or _gemini_modelo_chat).strip()
        if not modelo_gemini.startswith("gemini-"):
            modelo_gemini = _gemini_modelo_chat
        resp = cliente_gemini.models.generate_content(
            model=modelo_gemini,
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
    canal: str = "",
    page_url: str = "",
):
    """
    Usa Gemini 2.5 Pro como primera opción. Si falla o requiere binarios/tools,
    hace fallback a Claude con loop de herramientas.

    adjuntos_payload: lista de dicts {media_type, data_base64} (imagen/PDF) vía /chat.
    canal: 'web_chat' fuerza reglas y catálogo solo combos SIIGO (sin Gemini sin tools).
    """
    from app.services.canales_config import obtener_modelo_canal

    es_web = _es_canal_web_chat(canal, usuario_id)
    canal_efectivo = "web_chat" if es_web else ((canal or "").strip() or "whatsapp")
    modelo_canal = obtener_modelo_canal(canal_efectivo)
    if canal_efectivo == "sede_sur":
        system_prompt_efectivo = _prompt_sede_sur()
    elif es_web:
        system_prompt_efectivo = _system_prompt + INSTRUCCIONES_WEB_CHAT
    else:
        system_prompt_efectivo = _system_prompt
    if not cliente_gemini and not cliente_ia:
        return "Veci, estamos en mantenimiento. Intente en unos minutos 🙏", []

    try:
        adjuntos = _parse_adjuntos_chat(adjuntos_payload)
    except ValueError as ve:
        return f"Veci, no pude leer el adjunto: {ve} 🙏", []

    n_adj = len(adjuntos)
    pregunta_visible = (pregunta or "").strip()

    # Recuperar historial previo del usuario (o usar el pasado como parámetro)
    if historial:
        messages = list(historial)
    else:
        messages = list(
            _historiales.get(usuario_id)
            or _cargar_historial_persistente(usuario_id)
        )

    # ── Chat web: contacto, documentos, escalación pago/pedido ──
    if es_web and pregunta_visible and not adjuntos:
        from app.web_chat_intents import (
            manejar_escalacion_web,
            manejar_pregunta_contacto_web,
        )
        from app.web_chat_documentos import manejar_documentos_web
        from app.web_chat_escalacion import (
            manejar_escalacion_tecnica_web,
            manejar_seguimiento_codigo_web,
        )

        hist_txt_web = _contexto_historial_web(messages)

        seguimiento = manejar_seguimiento_codigo_web(pregunta_visible)
        if seguimiento:
            seg_out = _sanitizar_respuesta_web_chat(seguimiento)
            messages.append(
                {"role": "user", "content": f"Usuario_{usuario_id}: {pregunta_visible}"}
            )
            final_messages = messages + [{"role": "assistant", "content": seg_out}]
            final_messages = final_messages[-_MAX_HISTORIAL_PERSISTENTE:]
            _historiales[usuario_id] = final_messages
            _guardar_historial_persistente(usuario_id, final_messages)
            return seg_out, final_messages

        if _es_saludo_puro_web(pregunta_visible):
            saludo_out = _sanitizar_respuesta_web_chat(_respuesta_saludo_web())
            messages.append(
                {"role": "user", "content": f"Usuario_{usuario_id}: {pregunta_visible}"}
            )
            final_messages = messages + [{"role": "assistant", "content": saludo_out}]
            final_messages = final_messages[-_MAX_HISTORIAL_PERSISTENTE:]
            _historiales[usuario_id] = final_messages
            _guardar_historial_persistente(usuario_id, final_messages)
            return saludo_out, final_messages

        if _mensaje_parece_correccion_cliente_web(pregunta_visible):
            corr_out = _sanitizar_respuesta_web_chat(_respuesta_correccion_web())
            messages.append(
                {"role": "user", "content": f"Usuario_{usuario_id}: {pregunta_visible}"}
            )
            final_messages = messages + [{"role": "assistant", "content": corr_out}]
            final_messages = final_messages[-_MAX_HISTORIAL_PERSISTENTE:]
            _historiales[usuario_id] = final_messages
            _guardar_historial_persistente(usuario_id, final_messages)
            return corr_out, final_messages

        contacto = manejar_pregunta_contacto_web(pregunta_visible)
        if contacto:
            contacto_out = _sanitizar_respuesta_web_chat(contacto)
            messages.append(
                {"role": "user", "content": f"Usuario_{usuario_id}: {pregunta_visible}"}
            )
            final_messages = messages + [
                {"role": "assistant", "content": contacto_out}
            ]
            final_messages = final_messages[-_MAX_HISTORIAL_PERSISTENTE:]
            _historiales[usuario_id] = final_messages
            _guardar_historial_persistente(usuario_id, final_messages)
            return contacto_out, final_messages

        docs = manejar_documentos_web(
            user_message=pregunta_visible,
            historial_texto=hist_txt_web,
        )
        if docs:
            docs_out = _sanitizar_respuesta_web_chat(docs)
            messages.append(
                {"role": "user", "content": f"Usuario_{usuario_id}: {pregunta_visible}"}
            )
            final_messages = messages + [{"role": "assistant", "content": docs_out}]
            final_messages = final_messages[-_MAX_HISTORIAL_PERSISTENTE:]
            _historiales[usuario_id] = final_messages
            _guardar_historial_persistente(usuario_id, final_messages)
            return docs_out, final_messages

        escalada = manejar_escalacion_web(
            session_id=usuario_id,
            user_message=pregunta_visible,
            historial=messages,
            page_url=page_url or "",
        )
        if escalada:
            escalada_out = _sanitizar_respuesta_web_chat(escalada)
            messages.append(
                {"role": "user", "content": f"Usuario_{usuario_id}: {pregunta_visible}"}
            )
            final_messages = messages + [
                {"role": "assistant", "content": escalada_out}
            ]
            final_messages = final_messages[-_MAX_HISTORIAL_PERSISTENTE:]
            _historiales[usuario_id] = final_messages
            _guardar_historial_persistente(usuario_id, final_messages)
            return escalada_out, final_messages

        prod_ctx = _extraer_producto_reciente_historial_web(messages)
        memoria_esc = _memoria_vectorial_para_chat(pregunta_visible)
        ficha_esc: str | None = None
        if prod_ctx or _mensaje_parece_consulta_tecnica_web(pregunta_visible):
            try:
                from app.services.google_services import buscar_ficha_tecnica_producto

                term_ficha = prod_ctx or pregunta_visible
                ficha_esc = buscar_ficha_tecnica_producto(term_ficha)
            except Exception:
                ficha_esc = None
        escalada_tec = manejar_escalacion_tecnica_web(
            pregunta=pregunta_visible,
            session_id=usuario_id,
            producto=prod_ctx,
            page_url=page_url or "",
            ficha=ficha_esc,
            memoria_vec=memoria_esc,
        )
        if escalada_tec:
            esc_out = _sanitizar_respuesta_web_chat(escalada_tec)
            messages.append(
                {"role": "user", "content": f"Usuario_{usuario_id}: {pregunta_visible}"}
            )
            final_messages = messages + [{"role": "assistant", "content": esc_out}]
            final_messages = final_messages[-_MAX_HISTORIAL_PERSISTENTE:]
            _historiales[usuario_id] = final_messages
            _guardar_historial_persistente(usuario_id, final_messages)
            return esc_out, final_messages

    # ── Handoff humano (solo WhatsApp; web usa web_chat_intents arriba) ─────
    low0 = re.sub(r"\s+", " ", (pregunta_visible or "").strip().lower())
    if not es_web and any(
        k in low0
        for k in (
            "asesor humano",
            "agente humano",
            "hablar con un asesor",
            "hablar con una asesora",
            "hablar con una persona",
            "me atiende una persona",
            "quiero hablar con un asesor",
            "soporte humano",
            "atencion humana",
        )
    ):
        try:
            path = os.path.join("app", "data", "modos_atencion.json")
            try:
                data = json.load(open(path, encoding="utf-8"))
            except FileNotFoundError:
                data = {}
            data.setdefault("numeros_en_humano", [])
            data.setdefault("timestamps", {})
            data.setdefault("bot_auto_pausados", {})
            if usuario_id not in data["numeros_en_humano"]:
                data["numeros_en_humano"].append(usuario_id)
            data["timestamps"][usuario_id] = time.time()
            data["bot_auto_pausados"][usuario_id] = {
                "timestamp": time.time(),
                "razon": "cliente solicitó humano",
                "ultimo_mensaje": (pregunta_visible or "")[:500],
            }
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
        except Exception:
            pass

        msg = "Listo veci 🙏 A continuación sigue la conversación con un asesor humano."
        user_msg_index = len(messages)
        messages.append({"role": "user", "content": f"Usuario_{usuario_id}: {pregunta_visible}"})
        final_messages = messages + [{"role": "assistant", "content": msg}]
        final_messages = final_messages[-_MAX_HISTORIAL_PERSISTENTE:]
        _historiales[usuario_id] = final_messages
        _guardar_historial_persistente(usuario_id, final_messages)
        return msg, final_messages

    if es_web and not adjuntos:
        directa = _respuesta_directa_web_si_combos(pregunta_visible, messages)
        if directa:
            user_msg_index = len(messages)
            messages.append(
                {"role": "user", "content": f"Usuario_{usuario_id}: {pregunta_visible}"}
            )
            final_messages = messages + [
                {"role": "assistant", "content": directa}
            ]
            final_messages = final_messages[-_MAX_HISTORIAL_PERSISTENTE:]
            _historiales[usuario_id] = final_messages
            _guardar_historial_persistente(usuario_id, final_messages)
            return _sanitizar_respuesta_web_chat(directa), final_messages

    contexto_combos = (
        _preflight_contexto_combos_web(pregunta_visible, messages) if es_web else None
    )
    if _mensaje_parece_consulta_tecnica_web(pregunta_visible):
        pregunta_para_ia = _enriquecer_pregunta_tecnica_web(pregunta_visible, messages)
    elif contexto_combos and pregunta_visible:
        pregunta_para_ia = (
            f"[Catálogo web verificado — uso interno, no mencionar SIIGO/combo al cliente]\n"
            f"{contexto_combos}\n\n"
            f"Pregunta del cliente: {pregunta_visible}"
        )
    else:
        pregunta_para_ia = pregunta_visible
    texto_usuario = f"Usuario_{usuario_id}: {pregunta_para_ia}".strip()
    if not pregunta_visible and not adjuntos:
        return "Veci, escribe un mensaje o adjunta un archivo 🙏", []

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
        resp_cant = resolver_cantidad_tras_oferta_producto(
            messages, pregunta or "", usuario_id=usuario_id
        )
        if resp_cant:
            final_messages = messages + [{"role": "assistant", "content": resp_cant}]
            final_messages = final_messages[-_MAX_HISTORIAL_PERSISTENTE:]
            _historiales[usuario_id] = final_messages
            _guardar_historial_persistente(usuario_id, final_messages)
            return resp_cant, final_messages

    # ── Canales cliente (WA / web): catálogo en Python + LLM solo texto ───────
    from app.services.canales_config import es_canal_cliente
    from app.agent.cliente_chat import responder_canal_cliente

    if es_canal_cliente(canal_efectivo) and not (pregunta or "").startswith("BOT_"):
        # Handoff a humano (cliente lo pide): responder una vez y dejar chat en modo humano.
        low = re.sub(r"\s+", " ", (pregunta_visible or "").strip().lower())
        if any(
            k in low
            for k in (
                "asesor humano",
                "agente humano",
                "hablar con un asesor",
                "hablar con una asesora",
                "hablar con una persona",
                "me atiende una persona",
                "quiero hablar con un asesor",
                "soporte humano",
                "atencion humana",
            )
        ):
            try:
                path = os.path.join("app", "data", "modos_atencion.json")
                try:
                    data = json.load(open(path, encoding="utf-8"))
                except FileNotFoundError:
                    data = {}
                data.setdefault("numeros_en_humano", [])
                data.setdefault("timestamps", {})
                data.setdefault("bot_auto_pausados", {})
                if usuario_id not in data["numeros_en_humano"]:
                    data["numeros_en_humano"].append(usuario_id)
                data["timestamps"][usuario_id] = time.time()
                data["bot_auto_pausados"][usuario_id] = {
                    "timestamp": time.time(),
                    "razon": "cliente solicitó humano",
                    "ultimo_mensaje": (pregunta_visible or "")[:500],
                }
                with open(path, "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
            except Exception:
                pass

            msg = "Listo veci 🙏 A continuación sigue la conversación con un asesor humano."
            final_messages = messages + [{"role": "assistant", "content": msg}]
            final_messages = final_messages[-_MAX_HISTORIAL_PERSISTENTE:]
            _historiales[usuario_id] = final_messages
            _guardar_historial_persistente(usuario_id, final_messages)
            return msg, final_messages

        if adjuntos:
            return (
                "Veci, recibí su archivo. Un asesor lo revisará en breve. "
                "Si es comprobante de pago, quedamos atentos ✅",
                messages,
            )

        ctx_catalogo = contexto_combos
        if not es_web:
            ctx_catalogo = ctx_catalogo or _preflight_contexto_whatsapp(
                pregunta_visible, messages
            )
        ctx_ficha = _preflight_ficha_tecnica(pregunta_visible, messages)
        memoria_vec = _memoria_vectorial_para_chat(pregunta_visible)

        # Si el cliente pregunta por algo específico pero no hay evidencia en catálogo/ficha,
        # NO inventar: pedir precisión antes de llamar al LLM.
        if (
            not ctx_catalogo
            and not ctx_ficha
            and not memoria_vec
            and _mensaje_parece_consulta_producto(pregunta_visible)
        ):
            if es_web:
                aclarar = (
                    "Veci, ¿me confirma cuál presentación está buscando (250g, 500g o kilo) "
                    "y si es para consumo o para formulación? Así le respondo exacto."
                )
            else:
                aclarar = (
                    "Veci, ¿me confirma el nombre exacto del producto y la presentación (250g, 500g o kilo)? "
                    "Así le confirmo disponibilidad y precio."
                )
            final_messages = messages + [{"role": "assistant", "content": aclarar}]
            final_messages = final_messages[-_MAX_HISTORIAL_PERSISTENTE:]
            _historiales[usuario_id] = final_messages
            _guardar_historial_persistente(usuario_id, final_messages)
            return aclarar, final_messages

        texto_cli, _prov = responder_canal_cliente(
            pregunta=pregunta_para_ia,
            usuario_id=usuario_id,
            historial=messages[:-1],
            system_prompt=system_prompt_efectivo,
            canal=canal_efectivo,
            modelo_id=modelo_canal,
            es_web=es_web,
            cliente_gemini=cliente_gemini,
            memoria_vectorial=memoria_vec,
            contexto_catalogo=ctx_catalogo,
            contexto_ficha=ctx_ficha,
            extraer_texto_visible=_extraer_texto_visible_mensaje,
            sanitizar_web=_sanitizar_respuesta_web_chat if es_web else None,
        )
        if texto_cli:
            final_messages = messages + [{"role": "assistant", "content": texto_cli}]
            final_messages = final_messages[-_MAX_HISTORIAL_PERSISTENTE:]
            _historiales[usuario_id] = final_messages
            _guardar_historial_persistente(usuario_id, final_messages)
            salida = _sanitizar_respuesta_web_chat(texto_cli) if es_web else texto_cli
            return salida, final_messages

        return (
            "Veci, tuve un problema técnico momentáneo. Por favor intente de nuevo 🙏",
            [],
        )

    # ── Validaciones de proveedor requerido (operaciones / CLI con tools) ───
    from app.services.canales_config import canal_acepta_ollama as _canal_acepta_ollama
    _es_canal_ollama = _canal_acepta_ollama(canal_efectivo) and not modelo_canal.startswith(("claude-", "gemini-"))
    claude_ok = (
        _permitir_fallback_claude
        or (es_web and _permitir_claude_web_chat)
        or modelo_canal.startswith("claude-")
        or _es_canal_ollama  # Ollama escala a Claude si necesita tools
    )
    if modelo_canal.startswith("claude-") and not cliente_ia:
        return "Veci, Claude no está configurado (ANTHROPIC_API_KEY). 🙏", []
    if not modelo_canal.startswith(("claude-", "gemini-")) and not _es_canal_ollama:
        return (
            "Veci, este canal requiere Claude o Gemini con herramientas. "
            "Cámbielo en Panel → Chat de Agentes → Canales activos. 🙏",
            [],
        )
    if not claude_ok and not modelo_canal.startswith("gemini-"):
        if es_web:
            return (
                "Veci, no pude procesar su mensaje en este momento. "
                "Para precios y presentaciones revise el catálogo en la web "
                "o escríbanos por WhatsApp 🙏",
                [],
            )
        return (
            "Veci, el servicio IA está en ajuste técnico temporal. "
            "Por favor intente de nuevo en un momento 🙏",
            [],
        )

    # ── Despacho vía AgentRun (sistema desacoplado con checkpointing) ────────
    from app.agent.run import AgentRun
    from app.agent.llm_router import LLMRouter

    log_json(
        "ia_turn_start",
        usuario_id=str(usuario_id)[:80],
        pregunta_chars=len(pregunta or ""),
        adjuntos_n=n_adj,
    )
    print(f"🗣️  Usuario [{usuario_id}] pregunta: '{pregunta}'")

    router = LLMRouter(
        canal=canal_efectivo,
        claude_client=cliente_ia,
        gemini_client=cliente_gemini,
        claude_model=modelo_canal if modelo_canal.startswith("claude-") else "claude-sonnet-4-6",
        gemini_model=modelo_canal if modelo_canal.startswith("gemini-") else "gemini-2.5-pro",
    )

    agent_run = AgentRun(
        usuario_id=usuario_id,
        canal=canal_efectivo,
        router=router,
        tools_map=_tools_map,
        tools_schema=_tools_schema,
        system_prompt=system_prompt_efectivo,
    )

    result = agent_run.execute(
        pregunta=pregunta or "",
        messages=messages,
        adjuntos=adjuntos,
        user_msg_index=user_msg_index,
        n_adjuntos=n_adj,
    )

    # Actualizar caché en RAM y persistir historial
    if result.messages:
        _historiales[usuario_id] = result.messages
        _guardar_historial_persistente(usuario_id, result.messages)
    elif result.error and any(
        x in (result.error or "").lower()
        for x in ("badrequest", "bad_request", "malformed")
    ):
        # Historial corrupto — limpiar para evitar ciclos de error
        _historiales.pop(usuario_id, None)

    # Comando interno BOT_: no retornar texto al canal
    if (pregunta or "").startswith("BOT_"):
        return "", result.messages

    salida = result.text or "✅ Tarea ejecutada."
    if es_web:
        salida = _sanitizar_respuesta_web_chat(salida)

    return salida, result.messages
