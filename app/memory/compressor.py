"""
Compresor asíncrono de errores antes de vectorizar.

En lugar de guardar el traceback crudo, destila el fallo en una regla técnica
de ≤2 oraciones y la almacena en memoria semántica con metadata estructurada.

Esto previene que embeddings de errores verbose contaminen búsquedas futuras.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

from app.memory import semantic as sem

# Prompt de destilación — sin LLM externo si no está disponible (fallback a plantilla)
_DISTILL_PROMPT = """\
Eres ingeniero senior. Lee el error y extrae UNA regla técnica en ≤2 oraciones.
Formato obligatorio: "Cuando [condición], siempre [acción] porque [razón]."
No incluyas nombres de archivo ni números de línea. Solo la regla reutilizable.

Tool: {tool_name}
Error: {error}
Contexto: {context}
"""


def _distill_with_llm(tool_name: str, error: str, context: str, llm_fn) -> str | None:
    """Usa el LLM para destilar. llm_fn(prompt) -> str."""
    if llm_fn is None:
        return None
    prompt = _DISTILL_PROMPT.format(
        tool_name=tool_name,
        error=error[:400],
        context=context[:600],
    )
    try:
        result = llm_fn(prompt)
        if result and len(result) > 10:
            return result.strip()
    except Exception:
        pass
    return None


def _distill_template(tool_name: str, error: str) -> str:
    """Fallback sin LLM: plantilla estructurada."""
    err_short = error[:200].replace("\n", " ")
    return (
        f"Cuando se llama '{tool_name}', puede fallar con: {err_short}. "
        "Verificar argumentos y disponibilidad del servicio antes de invocar."
    )


def compress_and_store(
    tool_name: str,
    error: str,
    context: str = "",
    origen: str = "tool_use",
    llm_fn=None,
    extra_metadata: dict[str, Any] | None = None,
) -> str:
    """
    Destila el error en una regla técnica y la almacena en memoria semántica.

    Args:
        tool_name: Nombre de la herramienta que falló.
        error: Mensaje de error o traceback.
        context: Contexto adicional (args, usuario, etc.).
        origen: Etiqueta de origen para filtrado.
        llm_fn: Función callable(prompt: str) -> str para destilación (opcional).
        extra_metadata: Metadatos adicionales a persistir.

    Returns:
        doc_id del documento almacenado, o "" si no se pudo guardar.
    """
    regla = _distill_with_llm(tool_name, error, context, llm_fn)
    if not regla:
        regla = _distill_template(tool_name, error)

    meta: dict[str, Any] = {
        "tipo": "regla_tecnica",
        "tool": tool_name,
        "origen": origen,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "error_preview": error[:100],
    }
    if extra_metadata:
        meta.update(extra_metadata)

    doc_id = sem.store_incident(
        error=regla,
        causa=f"Detectado en runtime (tool: {tool_name})",
        solucion=regla,
        origen=origen,
        metadata=meta,
    )
    return doc_id


def compress_and_store_threaded(
    tool_name: str,
    error: str,
    context: str = "",
    origen: str = "tool_use",
    llm_fn=None,
) -> None:
    """
    Versión no bloqueante. Lanza compress_and_store en un hilo daemon.
    Úsala cuando no puedes esperar el resultado.
    """
    import threading

    t = threading.Thread(
        target=compress_and_store,
        kwargs={
            "tool_name": tool_name,
            "error": error,
            "context": context,
            "origen": origen,
            "llm_fn": llm_fn,
        },
        daemon=True,
    )
    t.start()
