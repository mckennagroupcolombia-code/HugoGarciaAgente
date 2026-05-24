"""
Tool Dispatcher — ejecuta herramientas y registra resultados.

Extraído del bucle interno de core.py. Desacoplado del LLM:
recibe una lista de ToolCall y devuelve una lista de resultados string.

También registra cada intento en la memoria episódica y dispara
la compresión asíncrona en caso de error.
"""

from __future__ import annotations

import json
from typing import Callable

from app.agent.llm_router import ToolCall
from app.memory import episodic
from app.memory import compressor
from app.observability import log_json

_MAX_RESULT_CHARS = 8192


def dispatch(
    tool_calls: list[ToolCall],
    tools_map: dict[str, Callable],
    run_id: str,
    iteration: int,
    llm_fn=None,
) -> list[str]:
    """
    Ejecuta cada ToolCall usando tools_map.

    Args:
        tool_calls: Lista de llamadas solicitadas por el LLM.
        tools_map: Diccionario name → callable.
        run_id: ID del AgentRun actual (para registro episódico).
        iteration: Iteración actual del bucle de tools.
        llm_fn: Función LLM opcional para destilación en compressor.

    Returns:
        Lista de strings de resultado (uno por tool_call, en el mismo orden).
    """
    results: list[str] = []

    for tc in tool_calls:
        fn = tools_map.get(tc.name)
        print(f"🔧 [{run_id[:8]}] Tool: {tc.name}  args: {json.dumps(tc.input)[:120]}")

        if fn is None:
            result_str = (
                f"[TOOL_ERROR] Herramienta '{tc.name}' no existe en el mapa. "
                "Elige otra acción disponible."
            )
            log_json("tool_missing", tool=tc.name, run_id=run_id)
            episodic.record(
                episodic.ToolAttempt(
                    run_id=run_id,
                    iteration=iteration,
                    tool_name=tc.name,
                    tool_input=tc.input,
                    result=result_str,
                    error="tool_not_found",
                )
            )
            results.append(result_str)
            continue

        try:
            raw = fn(**tc.input)
            result_str = str(raw)[:_MAX_RESULT_CHARS]
            log_json(
                "tool_ok",
                tool=tc.name,
                run_id=run_id,
                result_chars=len(result_str),
                truncated=len(str(raw)) > _MAX_RESULT_CHARS,
            )
            episodic.record(
                episodic.ToolAttempt(
                    run_id=run_id,
                    iteration=iteration,
                    tool_name=tc.name,
                    tool_input=tc.input,
                    result=result_str,
                )
            )
        except Exception as exc:
            error_msg = str(exc)
            result_str = (
                f"[TOOL_ERROR] La herramienta '{tc.name}' falló: {error_msg}. "
                "No asumas que se ejecutó bien; corrige argumentos o informa al usuario."
            )
            log_json(
                "tool_error",
                tool=tc.name,
                run_id=run_id,
                error_type=type(exc).__name__,
                error=error_msg[:500],
            )
            episodic.record(
                episodic.ToolAttempt(
                    run_id=run_id,
                    iteration=iteration,
                    tool_name=tc.name,
                    tool_input=tc.input,
                    result=result_str,
                    error=error_msg,
                )
            )
            # Compresión asíncrona — no bloquea el turno actual
            compressor.compress_and_store_threaded(
                tool_name=tc.name,
                error=error_msg,
                context=json.dumps(tc.input, ensure_ascii=False)[:800],
                origen="tool_dispatcher",
                llm_fn=llm_fn,
            )

        print(f"   ↳ {result_str[:150]}")
        results.append(result_str)

    return results


def apply_web_overrides(
    tool_calls: list[ToolCall],
    pregunta_visible: str,
) -> list[ToolCall]:
    """
    Para el canal web_chat, redirige buscar_producto_completo →
    buscar_productos_combo_siigo (catálogo SIIGO, no Sheets).
    """
    out: list[ToolCall] = []
    for tc in tool_calls:
        if tc.name == "buscar_producto_completo":
            new_input = {
                "consulta": (
                    tc.input.get("nombre_producto")
                    or tc.input.get("consulta")
                    or pregunta_visible
                    or ""
                )
            }
            out.append(ToolCall(
                id=tc.id,
                name="buscar_productos_combo_siigo",
                input=new_input,
            ))
        else:
            out.append(tc)
    return out
