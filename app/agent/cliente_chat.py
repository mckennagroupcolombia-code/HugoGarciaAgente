"""
Chat con clientes (WhatsApp, burbuja web): catálogo/ficha en Python + LLM solo texto.

No usa AgentRun ni tool-use API: evita costo Claude y el fallo Gemini+tools.
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
    prompt = (
        f"{system}\n\n"
        f"Historial reciente:\n{historial_texto or '[sin historial]'}\n\n"
        f"Mensaje actual del cliente:\n{mensaje}\n\n"
        "Responde solo con el texto final para el cliente (tono Hugo García, veci)."
    )
    try:
        resp = cliente_gemini.models.generate_content(model=modelo, contents=prompt)
        txt = (getattr(resp, "text", "") or "").strip()
        return txt or None
    except Exception as e:
        log_json("cliente_chat_gemini_error", model=modelo, error=str(e)[:200])
        return None


def _historial_plano(historial: list, extraer_texto: Callable) -> str:
    partes: list[str] = []
    for m in (historial or [])[-12:]:
        role = m.get("role", "")
        txt = extraer_texto(m.get("content"))
        if txt:
            pref = "Cliente" if role == "user" else "Asistente"
            partes.append(f"{pref}: {txt[:500]}")
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
    memoria_vectorial: str,
    contexto_catalogo: str | None,
    contexto_ficha: str | None,
    extraer_texto_visible: Callable,
    sanitizar_web: Callable[[str], str] | None = None,
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
            f"[Memoria de casos similares]\n{memoria_vectorial}"
        )

    extra = ""
    if bloques_ctx:
        extra = "\n\n".join(bloques_ctx) + "\n\n"

    mensaje_llm = f"{extra}Mensaje del cliente:\n{pregunta}".strip()
    hist_plano = _historial_plano(historial, extraer_texto_visible)

    sys = (
        f"{system_prompt}\n\n"
        "MODO CLIENTE: Responde en español colombiano (veci). "
        "Use SOLO datos del contexto inyectado para precios, stock y uso. "
        "No invente presentaciones ni precios. "
        "No mencione SIIGO, combo, ERP ni herramientas internas."
    )

    texto: str | None = None
    proveedor = ""

    if _es_modelo_ollama(modelo_id):
        texto = _completar_ollama(modelo_id, sys, historial, mensaje_llm)
        proveedor = "ollama"
    elif modelo_id.startswith("gemini-"):
        texto = _completar_gemini(cliente_gemini, modelo_id, sys, hist_plano, mensaje_llm)
        proveedor = "gemini"

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
