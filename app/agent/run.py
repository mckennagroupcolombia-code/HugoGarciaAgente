"""
AgentRun — unidad de ejecución con estado determinista y checkpointing.

Reemplaza el bucle for-iter monolítico de core.py:obtener_respuesta_ia().

Responsabilidades:
  - Gestionar el ciclo tool-use con MAX_TOOL_ITERS
  - Hacer checkpoint después de cada iteración de tools
  - Re-inyectar contexto episódico (tools fallidos) en reintentos
  - Delegar al LLMRouter sin saber qué modelo ejecuta
  - Persistir historial via WorkingMemory
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any, Callable

from app.agent import checkpoint_store as cp_store
from app.agent.llm_router import LLMRouter, LLMResponse, AllProvidersExhausted
from app.agent.tool_dispatcher import dispatch, apply_web_overrides
from app.memory import episodic, working
from app.observability import log_json

MAX_TOOL_ITERS: int = 20
MAX_REINTENTOS: int = 3


@dataclass
class AgentResult:
    text: str
    messages: list[dict]
    provider: str = ""
    run_id: str = ""
    iterations: int = 0
    error: str | None = None


@dataclass
class AgentRun:
    """
    Estado completo de un turno de IA para un usuario.

    Uso:
        run = AgentRun(
            usuario_id="573001234567",
            canal="whatsapp",
            router=LLMRouter(...),
            tools_map={"nombre": fn, ...},
            tools_schema=[...],
            system_prompt="...",
        )
        result = run.execute(pregunta, messages_previos, adjuntos=[])
    """

    usuario_id: str
    canal: str
    router: LLMRouter
    tools_map: dict[str, Callable]
    tools_schema: list[dict]
    system_prompt: str = ""
    run_id: str = field(default_factory=lambda: str(uuid.uuid4()))

    def _is_web(self) -> bool:
        c = (self.canal or "").strip().lower()
        return c in ("web_chat", "web") or (self.usuario_id or "").lower().startswith("web-")

    def _build_enriched_system(self, attempt: int) -> str:
        """Enriquece el system prompt con contexto episódico en reintentos."""
        base = self.system_prompt
        if attempt == 0:
            return base
        failed_ctx = episodic.format_failed_context(self.run_id)
        if not failed_ctx:
            return base
        return f"{base}\n\n{failed_ctx}"

    def _save_checkpoint(self, messages: list[dict], iteration: int, meta: dict | None = None) -> None:
        cp_store.save(
            cp_store.AgentCheckpoint(
                run_id=self.run_id,
                iteration=iteration,
                messages=messages,
                metadata=meta or {},
            )
        )

    def _cleanup(self) -> None:
        cp_store.delete_run(self.run_id)
        episodic.cleanup(self.run_id)

    def execute(
        self,
        pregunta: str,
        messages: list[dict],
        adjuntos: list[tuple[str, bytes]] | None = None,
        user_msg_index: int = -1,
        n_adjuntos: int = 0,
    ) -> AgentResult:
        """
        Ejecuta el ciclo completo tool-use con checkpointing y reintentos.

        Args:
            pregunta: Texto visible del usuario (para logs y memoria).
            messages: Lista de mensajes incluyendo el turno usuario actual.
            adjuntos: Lista de (media_type, bytes) ya parseados.
            user_msg_index: Índice del turno usuario en messages (para sanitización).
            n_adjuntos: Cantidad de adjuntos (para sanitización de historial).

        Returns:
            AgentResult con texto final, historial actualizado y metadata.
        """
        adjuntos = adjuntos or []
        is_web = self._is_web()

        log_json(
            "agent_run_start",
            run_id=self.run_id,
            usuario_id=str(self.usuario_id)[:80],
            canal=self.canal,
            pregunta_chars=len(pregunta or ""),
        )

        last_error: str | None = None

        for attempt in range(MAX_REINTENTOS):
            system = self._build_enriched_system(attempt)
            current_messages = list(messages)
            iterations_used = 0

            # Intentar cargar checkpoint si hay uno (solo en reintentos post-fallo)
            if attempt > 0:
                cp = cp_store.load_latest(self.run_id)
                if cp and cp.messages:
                    current_messages = cp.messages
                    print(
                        f"♻️  [{self.run_id[:8]}] Retomando desde checkpoint "
                        f"iter={cp.iteration} (intento {attempt + 1})"
                    )

            try:
                for iter_n in range(MAX_TOOL_ITERS):
                    iterations_used = iter_n + 1

                    # Evicción de contexto si se acerca al límite
                    current_messages = working.evict_if_needed(current_messages)
                    # Garantiza secuencia user/assistant válida para la API
                    current_messages = working.sanitize_messages(current_messages)

                    response: LLMResponse = self.router.complete(
                        messages=current_messages,
                        tools=self.tools_schema if not is_web or self.tools_schema else None,
                        system=system,
                        max_tokens=4096,
                    )

                    print(
                        f"💰 [{self.run_id[:8]}] {response.provider} — "
                        f"in:{response.input_tokens} out:{response.output_tokens} "
                        f"stop:{response.stop_reason}"
                    )

                    if response.needs_tools:
                        # Serializar turno del asistente
                        asst_content = self.router.serialize_assistant_content(
                            response, raw_content=None
                        )
                        current_messages.append({"role": "assistant", "content": asst_content})

                        # Aplicar overrides web si aplica
                        tool_calls = (
                            apply_web_overrides(response.tool_calls, pregunta)
                            if is_web
                            else response.tool_calls
                        )

                        # Ejecutar tools
                        results = dispatch(
                            tool_calls=tool_calls,
                            tools_map=self.tools_map,
                            run_id=self.run_id,
                            iteration=iter_n,
                        )

                        # Agregar resultados al historial
                        tool_result_msg = self.router.build_tool_result_message(
                            tool_calls, results
                        )
                        current_messages.append(tool_result_msg)

                        # Checkpoint después de cada iteración de tools
                        self._save_checkpoint(
                            current_messages,
                            iter_n,
                            {"provider": response.provider, "attempt": attempt},
                        )

                    elif response.stop_reason in ("end_turn", "max_tokens"):
                        # Respuesta final
                        asst_content = self.router.serialize_assistant_content(
                            response, raw_content=None
                        )
                        final_messages = current_messages + [
                            {"role": "assistant", "content": asst_content}
                        ]

                        # Sanitizar y persistir historial
                        persisted = working.prepare_for_persist(
                            messages=final_messages,
                            user_msg_index=user_msg_index,
                            usuario_id=self.usuario_id,
                            pregunta=pregunta,
                            n_adjuntos=n_adjuntos,
                        )

                        if response.stop_reason == "max_tokens":
                            texto = (response.text or "").strip()
                            if texto:
                                texto += "\n\n(Si falta detalle, pregunte una cosa puntual.)"
                            else:
                                texto = "Veci, la respuesta se cortó por tamaño. ¿Puede ser más específico? 🙏"
                        else:
                            texto = response.text or "✅ Tarea ejecutada."

                        self._cleanup()

                        log_json(
                            "agent_run_end",
                            run_id=self.run_id,
                            iterations=iterations_used,
                            provider=response.provider,
                        )

                        return AgentResult(
                            text=texto,
                            messages=persisted,
                            provider=response.provider,
                            run_id=self.run_id,
                            iterations=iterations_used,
                        )

                    else:
                        # stop_reason inesperado
                        print(f"⚠️  [{self.run_id[:8]}] stop_reason inesperado: {response.stop_reason}")
                        persisted = working.prepare_for_persist(
                            current_messages, user_msg_index, self.usuario_id, pregunta, n_adjuntos
                        )
                        self._cleanup()
                        return AgentResult(
                            text="Veci, tuve un problema al completar la respuesta. ¿Intenta de nuevo? 🙏",
                            messages=persisted,
                            provider=response.provider,
                            run_id=self.run_id,
                            iterations=iterations_used,
                            error=f"unexpected_stop_reason:{response.stop_reason}",
                        )

                # Límite de iteraciones alcanzado
                print(f"⚠️  [{self.run_id[:8]}] Límite {MAX_TOOL_ITERS} iteraciones alcanzado")
                persisted = working.prepare_for_persist(
                    current_messages, user_msg_index, self.usuario_id, pregunta, n_adjuntos
                )
                self._cleanup()
                return AgentResult(
                    text=(
                        "Veci, me quedé a medias usando las herramientas internas. "
                        "¿Me escribe de nuevo una sola pregunta concreta? 🙏"
                    ),
                    messages=persisted,
                    run_id=self.run_id,
                    iterations=MAX_TOOL_ITERS,
                    error="max_tool_iters_reached",
                )

            except AllProvidersExhausted as e:
                last_error = str(e)
                print(f"❌ [{self.run_id[:8]}] Todos los proveedores fallaron: {e}")
                break

            except Exception as e:
                last_error = str(e)
                err_lower = last_error.lower()
                log_json(
                    "agent_run_error",
                    run_id=self.run_id,
                    attempt=attempt + 1,
                    error_type=type(e).__name__,
                    error=last_error[:300],
                )
                print(
                    f"⚠️  [{self.run_id[:8]}] Error intento {attempt + 1}/{MAX_REINTENTOS}: "
                    f"{type(e).__name__}: {last_error[:200]}"
                )

                is_overload = any(x in err_lower for x in ("overload", "529", "503"))
                is_rate = "429" in err_lower or "rate_limit" in err_lower
                is_auth = "authentication" in err_lower or "api_key" in err_lower

                if is_auth:
                    break
                if is_rate:
                    break
                if is_overload and attempt < MAX_REINTENTOS - 1:
                    import time
                    time.sleep((attempt + 1) * 5)
                    continue
                if attempt < MAX_REINTENTOS - 1:
                    continue
                break

        # Todos los intentos fallaron
        self._cleanup()
        err_lower = (last_error or "").lower()

        if "rate" in err_lower or "429" in err_lower:
            msg = "Veci, estamos atendiendo muchos clientes. Por favor espere un momento y escriba de nuevo 🙏"
        elif "overload" in err_lower or "529" in err_lower:
            msg = "Veci, tenemos alta demanda en este momento. Por favor escríbanos de nuevo en 2 minutos 🙏"
        elif "authentication" in err_lower:
            msg = "Veci, estamos en mantenimiento. Intente en unos minutos 🙏"
        else:
            msg = "Veci, tuve un problema técnico momentáneo. Por favor intente de nuevo 🙏"

        return AgentResult(
            text=msg,
            messages=[],
            run_id=self.run_id,
            error=last_error or "unknown",
        )
