"""
Memoria de Trabajo — gestión de la ventana de contexto activa del LLM.

Funciones:
  - Evicción por número de turnos y estimación de tokens
  - Sanitización de binarios (base64) antes de persistir
  - Resumen comprimido de turnos viejos (evita saturar el contexto)
"""

from __future__ import annotations

import copy
import re
from typing import Any

MAX_TURNS: int = 40
# Estimación conservadora: 1 token ≈ 4 chars
_CHARS_PER_TOKEN = 4
MAX_TOKENS_ESTIMATE: int = 12_000
_KEEP_RECENT: int = 8  # turnos recientes siempre intactos


def _estimate_tokens(messages: list[dict]) -> int:
    total = 0
    for m in messages:
        c = m.get("content", "")
        if isinstance(c, str):
            total += len(c) // _CHARS_PER_TOKEN
        elif isinstance(c, list):
            for block in c:
                if isinstance(block, dict):
                    total += len(str(block.get("text", ""))) // _CHARS_PER_TOKEN
    return total


def _text_from_message(m: dict) -> str:
    c = m.get("content", "")
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        parts = []
        for b in c:
            if isinstance(b, dict) and b.get("type") == "text":
                parts.append(b.get("text", ""))
        return " ".join(p for p in parts if p)
    return str(c)


def _strip_binary_blocks(messages: list[dict]) -> list[dict]:
    """Quita bloques image/document (base64) de mensajes para la copia persistida."""
    result = []
    for m in messages:
        c = m.get("content")
        if isinstance(c, list):
            clean_blocks = []
            for b in c:
                if isinstance(b, dict) and b.get("type") in ("image", "document"):
                    clean_blocks.append({"type": "text", "text": "[adjunto eliminado para historial]"})
                else:
                    clean_blocks.append(b)
            result.append({**m, "content": clean_blocks})
        else:
            result.append(m)
    return result


def _summarize_turns(turns: list[dict], max_chars: int = 600) -> str:
    """Resumen simple sin LLM de los turnos viejos (para evicción ligera)."""
    parts = []
    for t in turns:
        role = t.get("role", "?")
        txt = _text_from_message(t)[:150]
        if txt:
            parts.append(f"{role}: {txt}")
    summary = " | ".join(parts)
    return summary[:max_chars]


def evict_if_needed(
    messages: list[dict],
    summarize_fn=None,
) -> list[dict]:
    """
    Devuelve la lista de mensajes dentro del límite.

    Si supera MAX_TURNS o MAX_TOKENS_ESTIMATE:
      - Mantiene los últimos _KEEP_RECENT turnos intactos.
      - Comprime los anteriores en un bloque de resumen.
      - summarize_fn(turns) -> str  puede ser una llamada LLM opcional.
    """
    if len(messages) <= _KEEP_RECENT:
        return messages

    within_count = len(messages) <= MAX_TURNS
    within_tokens = _estimate_tokens(messages) <= MAX_TOKENS_ESTIMATE

    if within_count and within_tokens:
        return messages

    old = messages[:-_KEEP_RECENT]
    recent = messages[-_KEEP_RECENT:]

    if summarize_fn is not None:
        try:
            summary_text = summarize_fn(old)
        except Exception:
            summary_text = _summarize_turns(old)
    else:
        summary_text = _summarize_turns(old)

    summary_msg = {
        "role": "user",
        "content": (
            f"[Resumen de {len(old)} turnos anteriores para ahorro de contexto]\n"
            f"{summary_text}"
        ),
    }
    return [summary_msg] + recent


def prepare_for_persist(
    messages: list[dict],
    user_msg_index: int = -1,
    usuario_id: str = "",
    pregunta: str = "",
    n_adjuntos: int = 0,
) -> list[dict]:
    """
    Pipeline completo antes de guardar en SQLite:
      1. Strip de binarios del turno usuario con adjuntos
      2. Evicción por límite de turnos
    """
    clean = _strip_binary_blocks(messages)

    # Reemplazar el bloque del usuario con adjuntos por un placeholder texto
    if n_adjuntos > 0 and 0 <= user_msg_index < len(clean):
        snap = copy.deepcopy(clean)
        snap[user_msg_index]["content"] = (
            f"Usuario_{usuario_id}: {pregunta or '[adjunto]'} "
            f"[{n_adjuntos} archivo(s) ya procesados]"
        )
        clean = snap

    # Limitar a MAX_TURNS
    return clean[-MAX_TURNS:]


def trim(messages: list[dict]) -> list[dict]:
    """Versión simple: solo aplica límite de turnos sin resumen."""
    return messages[-MAX_TURNS:]
