"""
Chat con clientes (WhatsApp, burbuja web): catálogo/ficha en Python + LLM solo texto.

No usa AgentRun ni tool-use API: el LLM (Claude por defecto, ver
app.services.canales_config) solo redacta sobre el contexto ya resuelto en
Python. Evita el costo de un loop de herramientas y el fallo de Gemini con
tool-use. Gemini/Ollama quedan como red de seguridad si Claude falla o el
presupuesto LLM lo bloquea (ver _completar_claude / _completar_gemini).
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from typing import Callable

from app.observability import log_json
from app.services.local_ai import resolver_modelo_ollama

CANALES_CLIENTE = frozenset({"whatsapp", "web_chat"})

_FALLBACK_GEMINI = (
    os.getenv("AGENTE_CLIENTE_FALLBACK_GEMINI", "gemini-2.5-flash").strip()
    or "gemini-2.5-flash"
)

# Prompt específico para Gemini en WhatsApp de clientes.
# NO menciona herramientas ni APIs internas — Gemini no las puede ejecutar.
SYSTEM_PROMPT_WHATSAPP_GEMINI = """Eres Hugo, el asistente virtual (IA) de McKenna Group S.A.S., empresa colombiana de materias primas farmacéuticas y cosméticas con sede en Bogotá. Atiendes clientes por WhatsApp.

IDENTIDAD Y TONO:
- Habla en español colombiano bogotano. Usa "veci", "con mucho gusto", "claro que sí", "de una".
- TRANSPARENCIA: eres un asistente virtual y el cliente tiene derecho a saberlo. En tu primer mensaje preséntate como tal; si preguntan si eres un robot/IA, confírmalo con naturalidad y sigue ayudando. Nunca finjas ser una persona.
- Sé directo y breve. Responde SOLO lo que el cliente pregunta. No ofrezcas extras no solicitados.
- Primera vez que el cliente escribe: "Hola veci, soy Hugo, el asistente virtual de McKenna Group. ¿En qué le puedo colaborar?"
- Si ya hay historial en la conversación, NO repitas el saludo inicial.

PRECIOS Y PRODUCTOS — REGLA CRÍTICA:
- SOLO usa precios y datos que aparezcan en el [Catálogo McKenna] o [✅ Producto encontrado] inyectados en el mensaje ACTUAL o en el historial de esta conversación.
- PROHIBIDO tomar precios de la [Memoria de casos similares]: esa memoria es solo para estilo y contexto general; sus precios pueden estar vencidos.
- Si no tienes el precio o el dato en el contexto, di: "Veci, ese dato se lo confirma un asesor del equipo" (fuera de horario: "se lo confirma un asesor en horario laboral"). NUNCA inventes ni supongas un precio, y NUNCA digas que TÚ lo vas a verificar o averiguar después: este canal no te permite escribir por iniciativa propia.
- NUNCA escribas "$[Prec", "[precio]", "[consultar]" ni ningún placeholder.
- Si el contexto muestra el precio, cítalo directamente en el formato del equipo: "Glicerina vegetal x 500 gr: 22.500".
- No repitas el precio si ya lo diste en el historial de esta conversación.
- Si el producto figura agotado o sin disponibilidad clara, dilo honesto ("está agotada, veci"); si preguntan cuándo llega: "aún no tenemos fecha exacta de llegada". No inventes fechas.

DATOS DE PAGO — REGLA CRÍTICA (incumplirla causó que apagaran este canal):
- PROHIBIDO ABSOLUTAMENTE inventar, recordar o completar números de cuenta bancaria, Nequi, Daviplata, llaves, QR o NIT. Ningún dato de pago sale de tu memoria de entrenamiento.
- Solo puedes compartir los datos del bloque "DATOS DE PAGO AUTORIZADOS" si viene anexo a estas instrucciones. Si el método que pide el cliente no está ahí, responde que un asesor le comparte los datos, sin dar ningún número.
- NO manejamos Nequi ni pago contra entrega.

LÍMITES DEL CANAL — NO PROMETAS LO QUE NO PUEDES HACER:
- No puedes enviar correos, PDFs, links de pago ni llamar. Todo pasa por este chat, o lo hace un asesor.
- No prometas "le envío la cotización al correo" ni "le escribo más tarde": di que el asesor confirma y envía lo que falte.
- No prometas despacho ni facturación inmediata fuera del horario laboral: el despacho se coordina en horario laboral (L-V; en Bogotá entrega el mismo día si el pago queda confirmado a tiempo).

HISTORIAL — REGLA CRÍTICA:
- Lee el historial completo de la conversación ANTES de responder.
- Si el cliente ya dio su nombre, correo o dirección en el historial, NO los vuelvas a pedir.
- Si ya discutiste un producto, recuerda cuál era sin pedirle que lo repita.
- Si el cliente dice "sí", "dale", "de acuerdo", "ok" o similar, asume que confirma lo último discutido. No pidas clarificación innecesaria.
- Mantén hilo: si se habló de glicerina, "eso" y "ese" se refieren a glicerina.

ENVÍOS:
- Bogotá: $8.800 hasta 1 kg, entrega el mismo día lunes a viernes con mensajero.
- Resto del país: $18.000 hasta 1 kg por Interrapidísimo, 2-4 días hábiles. Por cada kg adicional suman $2.000.
- McKenna es tienda virtual; no hay punto físico ni recogida en bodega.

COTIZACIONES:
- Para hacer una cotización necesitas: nombre completo o razón social, cédula/NIT, correo electrónico, dirección de entrega, lista de productos con cantidad.
- Confirma totales solo con precios del catálogo inyectado. Si falta el precio de algún producto, indícalo explícitamente.

IMÁGENES:
- Si el cliente envía una imagen sin contexto, pregunta brevemente: "¿Es comprobante de pago, consulta de producto o soporte técnico?"

FORMATO:
- Respuestas cortas. Máximo 3-4 líneas salvo cotizaciones formales.
- Evita listas largas de bullets. Usa negritas solo para precios y nombres de producto.
- Sin markdown excesivo: no uses **, ##, --- salvo para precios y nombres.
"""


def es_canal_cliente(canal_id: str) -> bool:
    return (canal_id or "").strip() in CANALES_CLIENTE


def _ollama_base_url() -> str:
    return (
        os.getenv("AGENTE_OLLAMA_URL", "").strip()
        or os.getenv("OLLAMA_API_URL", "").strip()
        or os.getenv("OLLAMA_HOST", "").strip()
        or "http://127.0.0.1:11434"
    ).rstrip("/")


def _es_modelo_api(modelo_id: str) -> bool:
    m = (modelo_id or "").strip()
    return m.startswith("claude-") or m.startswith("gemini-")


def _es_modelo_ollama(modelo_id: str) -> bool:
    return bool((modelo_id or "").strip()) and not _es_modelo_api(modelo_id)


def _completar_ollama(
    modelo: str,
    system: str,
    historial: list[dict],
    mensaje_usuario: str,
    max_tokens: int = 2048,
) -> str | None:
    modelo_efectivo = resolver_modelo_ollama(modelo)
    messages: list[dict] = []
    if system:
        messages.append({"role": "system", "content": system[:12000]})
    for m in historial[-10:]:
        role = m.get("role", "")
        if role not in ("user", "assistant"):
            continue
        c = m.get("content", "")
        if isinstance(c, list):
            c = " ".join(
                b.get("text", "")
                for b in c
                if isinstance(b, dict) and b.get("type") == "text"
            )
        txt = str(c).strip()[:4000]
        if txt:
            messages.append({"role": role, "content": txt})
    messages.append({"role": "user", "content": mensaje_usuario[:8000]})

    payload = json.dumps(
        {
            "model": modelo_efectivo,
            "messages": messages,
            "stream": False,
            "options": {"num_predict": max_tokens, "temperature": 0.45},
        }
    ).encode()
    url = f"{_ollama_base_url()}/api/chat"
    try:
        req = urllib.request.Request(
            url,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode())
        text = ((data.get("message") or {}).get("content") or "").strip()
        return text or None
    except Exception as e:
        log_json(
            "cliente_chat_ollama_error",
            model=modelo_efectivo,
            error=str(e)[:200],
        )
        return None


def _completar_gemini(
    cliente_gemini,
    modelo_id: str,
    system: str,
    historial_texto: str,
    mensaje: str,
) -> str | None:
    if cliente_gemini is None:
        return None
    modelo = (modelo_id or _FALLBACK_GEMINI).strip()
    if not modelo.startswith("gemini-"):
        modelo = _FALLBACK_GEMINI

    from app.services.llm_budget import permitir_llamada, registrar_llamada, usage_gemini

    ok, motivo = permitir_llamada(modelo, contexto="cliente_chat")
    if not ok:
        log_json("cliente_chat_budget_bloqueado", model=modelo, motivo=motivo[:150])
        return None

    prompt = (
        f"{system}\n\n"
        f"Historial reciente:\n{historial_texto or '[sin historial]'}\n\n"
        f"Mensaje actual del cliente:\n{mensaje}\n\n"
        "Responde solo con el texto final para el cliente (tono Hugo García, veci)."
    )
    try:
        # Temperatura baja (0.3) para respuestas factuales; reduce alucinación de precios.
        # Gemini 2.5 Pro es un modelo "thinking": no limitar max_output_tokens < 2000
        # o el modelo falla al parsear la respuesta (NoneType subscriptable).
        try:
            from google.genai import types as _gtypes
            cfg = _gtypes.GenerateContentConfig(temperature=0.3)
            resp = cliente_gemini.models.generate_content(model=modelo, contents=prompt, config=cfg)
        except Exception:
            resp = cliente_gemini.models.generate_content(model=modelo, contents=prompt)
        txt = (getattr(resp, "text", "") or "").strip()
        t_in, t_out = usage_gemini(resp)
        registrar_llamada(
            modelo,
            tokens_in=t_in,
            tokens_out=t_out,
            contexto="cliente_chat",
            chars_prompt=len(prompt),
            chars_respuesta=len(txt),
        )
        return txt or None
    except Exception as e:
        log_json("cliente_chat_gemini_error", model=modelo, error=str(e)[:200])
        return None


def _completar_claude(
    cliente_claude,
    modelo_id: str,
    system: str,
    historial: list[dict],
    mensaje_usuario: str,
    max_tokens: int = 1024,
) -> str | None:
    if cliente_claude is None:
        return None
    modelo = (modelo_id or "").strip()
    if not modelo.startswith("claude-"):
        modelo = "claude-sonnet-4-6"

    from app.agent.llm_router import ClaudeProvider, ProviderError
    from app.services.llm_budget import permitir_llamada, registrar_llamada

    ok, motivo = permitir_llamada(modelo, contexto="cliente_chat")
    if not ok:
        log_json("cliente_chat_budget_bloqueado", model=modelo, motivo=motivo[:150])
        return None

    messages: list[dict] = []
    for m in historial[-10:]:
        role = m.get("role", "")
        if role not in ("user", "assistant"):
            continue
        c = m.get("content", "")
        if isinstance(c, list):
            c = " ".join(
                b.get("text", "")
                for b in c
                if isinstance(b, dict) and b.get("type") == "text"
            )
        txt = str(c).strip()[:4000]
        if txt:
            messages.append({"role": role, "content": txt})
    # Claude exige que el primer turno sea "user".
    while messages and messages[0]["role"] != "user":
        messages.pop(0)
    messages.append({"role": "user", "content": mensaje_usuario[:8000]})

    try:
        resp = ClaudeProvider(cliente_claude, model_id=modelo).complete(
            messages, system=system, max_tokens=max_tokens
        )
    except ProviderError as e:
        log_json("cliente_chat_claude_error", model=modelo, error=str(e)[:200])
        return None

    registrar_llamada(
        modelo,
        tokens_in=resp.input_tokens,
        tokens_out=resp.output_tokens,
        contexto="cliente_chat",
        chars_prompt=len(system) + len(mensaje_usuario),
        chars_respuesta=len(resp.text or ""),
    )
    return (resp.text or "").strip() or None


def _historial_plano(historial: list, extraer_texto: Callable, max_turnos: int = 25) -> str:
    """Genera historial en texto plano para el prompt de Gemini/Ollama."""
    partes: list[str] = []
    for m in (historial or [])[-max_turnos:]:
        role = m.get("role", "")
        txt = extraer_texto(m.get("content"))
        if txt:
            pref = "Cliente" if role == "user" else "Asesor"
            # Limpiar prefijo "Usuario_XXX: " que agrega el sistema
            txt = re.sub(r"^Usuario_[^:]+:\s*", "", txt).strip()
            partes.append(f"{pref}: {txt[:800]}")
    return "\n".join(partes)


def responder_canal_cliente(
    *,
    pregunta: str,
    usuario_id: str,
    historial: list,
    system_prompt: str,
    canal: str,
    modelo_id: str,
    es_web: bool,
    cliente_gemini,
    cliente_claude=None,
    memoria_vectorial: str = "",
    contexto_catalogo: str | None,
    contexto_ficha: str | None,
    extraer_texto_visible: Callable,
    sanitizar_web: Callable[[str], str] | None = None,
    extra_sistema: str = "",
) -> tuple[str | None, str]:
    """
    Genera respuesta solo texto. Retorna (texto, proveedor_usado).
    proveedor_usado: ollama | gemini | claude | vacío si falló.
    """
    bloques_ctx: list[str] = []
    if contexto_catalogo:
        bloques_ctx.append(contexto_catalogo)
    if contexto_ficha:
        bloques_ctx.append(
            f"[Ficha técnica — uso interno, no cite URLs internas]\n{contexto_ficha}"
        )
    if memoria_vectorial:
        bloques_ctx.append(
            "[Memoria de casos similares — solo estilo/contexto; "
            f"PROHIBIDO tomar precios o datos de pago de aquí]\n{memoria_vectorial}"
        )

    extra = ""
    if bloques_ctx:
        extra = "\n\n".join(bloques_ctx) + "\n\n"

    mensaje_llm = f"{extra}Mensaje del cliente:\n{pregunta}".strip()
    hist_plano = _historial_plano(historial, extraer_texto_visible)

    extra_web = ""
    if es_web:
        extra_web = (
            "\nCANAL WEB: Responda con el contexto de catálogo. "
            "Si incluye Link MercadoLibre, inclúyalo siempre. "
            "No redirija a WhatsApp salvo para cotización formal o pago."
        )

    # Para Gemini/Claude en WhatsApp (modelos API sin tools en este flujo): usar
    # prompt limpio, sin refs a herramientas internas.
    # Para web y Ollama: usar el prompt heredado con el sufijo MODO CLIENTE.
    es_gemini = modelo_id.startswith("gemini-") or _FALLBACK_GEMINI.startswith("gemini-")
    if (es_gemini or modelo_id.startswith("claude-")) and not es_web:
        sys = SYSTEM_PROMPT_WHATSAPP_GEMINI
        try:
            from app.core import cargar_datos_pago

            sys += "\n" + cargar_datos_pago()
        except Exception:
            pass
        if extra_sistema:
            sys += "\n" + extra_sistema
    else:
        sys = (
            f"{system_prompt}\n\n"
            "MODO CLIENTE: Responde en español colombiano (veci). "
            "Use SOLO datos del contexto inyectado para precios, stock y uso. "
            "No invente presentaciones ni precios. "
            "No mencione SIIGO, combo, ERP ni herramientas internas."
            f"{extra_web}"
        )

    texto: str | None = None
    proveedor = ""

    if _es_modelo_ollama(modelo_id):
        texto = _completar_ollama(modelo_id, sys, historial, mensaje_llm)
        proveedor = "ollama"
    elif modelo_id.startswith("gemini-"):
        texto = _completar_gemini(cliente_gemini, modelo_id, sys, hist_plano, mensaje_llm)
        proveedor = "gemini"
    elif modelo_id.startswith("claude-"):
        texto = _completar_claude(cliente_claude, modelo_id, sys, historial, mensaje_llm)
        proveedor = "claude"

    if not texto and _FALLBACK_GEMINI and modelo_id != _FALLBACK_GEMINI:
        texto = _completar_gemini(cliente_gemini, _FALLBACK_GEMINI, sys, hist_plano, mensaje_llm)
        proveedor = "gemini_fallback"

    if not texto and _es_modelo_ollama(modelo_id) is False:
        texto = _completar_ollama(
            os.getenv("LOCAL_AI_MODEL", "gemma4:e4b"),
            sys,
            historial,
            mensaje_llm,
        )
        proveedor = "ollama_fallback"

    if not texto:
        return None, ""

    if es_web and sanitizar_web:
        texto = sanitizar_web(texto)

    log_json(
        "cliente_chat_ok",
        canal=canal,
        usuario_id=str(usuario_id)[:40],
        proveedor=proveedor,
        chars=len(texto),
    )
    return texto, proveedor
