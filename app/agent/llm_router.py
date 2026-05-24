"""
LLM Router — abstracción multi-proveedor agnóstica.

Encadena Claude → Gemini → Ollama automáticamente según el canal
y el estado de disponibilidad de cada proveedor.

Todos los proveedores exponen la misma interfaz: complete(messages, tools, **kw) -> LLMResponse.
AgentRun solo llama a LLMRouter.complete() sin saber qué modelo ejecuta.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from typing import Any, Callable


# ──────────────────────────────────────────────────────────────────────────────
# Tipos de respuesta unificados
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class ToolCall:
    id: str
    name: str
    input: dict[str, Any]


@dataclass
class LLMResponse:
    text: str
    stop_reason: str          # "end_turn" | "tool_use" | "max_tokens" | "error"
    tool_calls: list[ToolCall] = field(default_factory=list)
    input_tokens: int = 0
    output_tokens: int = 0
    provider: str = ""        # "claude" | "gemini" | "ollama"

    @property
    def needs_tools(self) -> bool:
        return self.stop_reason == "tool_use" and bool(self.tool_calls)


class ProviderError(Exception):
    pass


class AllProvidersExhausted(Exception):
    pass


# ──────────────────────────────────────────────────────────────────────────────
# Proveedores concretos
# ──────────────────────────────────────────────────────────────────────────────

class ClaudeProvider:
    """Anthropic Claude — soporta tool-use completo."""

    def __init__(self, client, model_id: str = "claude-sonnet-4-6"):
        self._client = client
        self._model_id = model_id

    def complete(
        self,
        messages: list[dict],
        tools: list[dict] | None = None,
        system: str = "",
        max_tokens: int = 4096,
        **_,
    ) -> LLMResponse:
        if self._client is None:
            raise ProviderError("Claude client no inicializado (ANTHROPIC_API_KEY)")
        try:
            kwargs: dict[str, Any] = dict(
                model=self._model_id,
                max_tokens=max_tokens,
                messages=messages,
            )
            if system:
                kwargs["system"] = system
            if tools:
                kwargs["tools"] = tools

            resp = self._client.messages.create(**kwargs)

            text = "".join(
                b.text for b in resp.content if hasattr(b, "text")
            )
            tool_calls: list[ToolCall] = []
            for b in resp.content:
                if getattr(b, "type", None) == "tool_use":
                    tool_calls.append(ToolCall(id=b.id, name=b.name, input=dict(b.input or {})))

            return LLMResponse(
                text=text,
                stop_reason=resp.stop_reason or "end_turn",
                tool_calls=tool_calls,
                input_tokens=resp.usage.input_tokens,
                output_tokens=resp.usage.output_tokens,
                provider="claude",
            )
        except Exception as e:
            raise ProviderError(f"Claude error: {e}") from e

    def serialize_content(self, response_obj: Any) -> list[dict]:
        """Serializa los bloques de respuesta de Anthropic a dicts JSON."""
        if isinstance(response_obj, str):
            return [{"type": "text", "text": response_obj}]
        result = []
        for block in response_obj:
            if isinstance(block, dict):
                result.append(block)
            elif getattr(block, "type", None) == "text":
                result.append({"type": "text", "text": block.text})
            elif getattr(block, "type", None) == "tool_use":
                result.append({
                    "type": "tool_use",
                    "id": block.id,
                    "name": block.name,
                    "input": block.input,
                })
            elif hasattr(block, "model_dump"):
                result.append(block.model_dump())
        return result

    @property
    def raw_client(self):
        return self._client

    def build_tool_result_message(self, tool_calls: list[ToolCall], results: list[str]) -> dict:
        return {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": tc.id,
                    "content": res,
                }
                for tc, res in zip(tool_calls, results)
            ],
        }


class GeminiProvider:
    """Google Gemini — texto sin tool-use nativo en este flujo."""

    def __init__(self, client, model_id: str = "gemini-2.5-pro"):
        self._client = client
        self._model_id = model_id

    def complete(
        self,
        messages: list[dict],
        tools: list[dict] | None = None,
        system: str = "",
        max_tokens: int = 4096,
        **_,
    ) -> LLMResponse:
        if self._client is None:
            raise ProviderError("Gemini client no inicializado (GOOGLE_API_KEY)")
        # Gemini no soporta tools en este flujo — solo texto
        if tools:
            raise ProviderError("GeminiProvider no soporta tool-use; usar ClaudeProvider")

        # Aplanar historial a texto
        parts: list[str] = []
        if system:
            parts.append(system)
        for m in messages[-12:]:
            role = m.get("role", "")
            c = m.get("content", "")
            if isinstance(c, str):
                txt = c
            elif isinstance(c, list):
                txt = " ".join(
                    b.get("text", "") for b in c
                    if isinstance(b, dict) and b.get("type") == "text"
                )
            else:
                txt = str(c)
            if txt:
                prefix = "Cliente" if role == "user" else "Asistente"
                parts.append(f"{prefix}: {txt}")

        prompt = "\n".join(parts)
        try:
            resp = self._client.models.generate_content(
                model=self._model_id,
                contents=prompt,
            )
            text = (getattr(resp, "text", "") or "").strip()
            return LLMResponse(
                text=text,
                stop_reason="end_turn" if text else "error",
                provider="gemini",
            )
        except Exception as e:
            raise ProviderError(f"Gemini error: {e}") from e


class OllamaProvider:
    """Ollama local — fallback de bajo costo para texto sin tools."""

    def __init__(self, model: str = "gemma4:26b", bin_path: str = "ollama"):
        self._model = model
        self._bin = bin_path

    def complete(
        self,
        messages: list[dict],
        tools: list[dict] | None = None,
        system: str = "",
        max_tokens: int = 2048,
        **_,
    ) -> LLMResponse:
        import subprocess

        if tools:
            raise ProviderError("OllamaProvider no soporta tool-use")

        parts: list[str] = []
        if system:
            parts.append(system)
        for m in messages[-6:]:
            c = m.get("content", "")
            txt = c if isinstance(c, str) else str(c)[:400]
            if txt:
                parts.append(txt)

        prompt = "\n".join(parts)[:8000]
        try:
            proc = subprocess.run(
                [self._bin, "run", self._model, prompt],
                capture_output=True, text=True, timeout=300, check=False,
            )
            if proc.returncode != 0:
                raise ProviderError(f"Ollama returncode={proc.returncode}: {proc.stderr[:200]}")
            text = (proc.stdout or "").strip()
            return LLMResponse(
                text=text or "[Ollama: respuesta vacía]",
                stop_reason="end_turn" if text else "error",
                provider="ollama",
            )
        except ProviderError:
            raise
        except Exception as e:
            raise ProviderError(f"Ollama error: {e}") from e


# ──────────────────────────────────────────────────────────────────────────────
# Router principal
# ──────────────────────────────────────────────────────────────────────────────

class LLMRouter:
    """
    Orquesta la cadena de proveedores para un canal dado.

    Orden de intento:
      1. Proveedor primario del canal (Claude o Gemini según canales_config)
      2. Claude (si primario era Gemini y se necesitan tools)
      3. Ollama (último recurso, sin tools)

    Si el primario falla MAX_PRIMARY_RETRIES veces consecutivas,
    escala automáticamente al siguiente en la cadena.
    """

    MAX_PRIMARY_RETRIES = 3
    RETRY_DELAYS = [2, 5, 10]  # segundos entre reintentos

    def __init__(
        self,
        canal: str,
        claude_client=None,
        gemini_client=None,
        claude_model: str = "claude-sonnet-4-6",
        gemini_model: str = "gemini-2.5-pro",
        ollama_model: str = "gemma4:26b",
    ):
        self._canal = canal
        self._claude = ClaudeProvider(claude_client, claude_model) if claude_client else None
        self._gemini = GeminiProvider(gemini_client, gemini_model) if gemini_client else None
        self._ollama = OllamaProvider(
            model=ollama_model,
            bin_path=os.getenv("OLLAMA_BIN", "ollama"),
        )

        self._primary = self._resolve_primary(canal)
        self._fallback_chain = self._build_fallback_chain()

    def _resolve_primary(self, canal: str):
        from app.services.canales_config import obtener_modelo_canal
        model_id = obtener_modelo_canal(canal)
        if model_id.startswith("gemini-") and self._gemini:
            self._gemini._model_id = model_id
            return self._gemini
        if model_id.startswith("claude-") and self._claude:
            self._claude._model_id = model_id
            return self._claude
        # Fallback: Claude si disponible, Gemini si no
        return self._claude or self._gemini

    def _build_fallback_chain(self) -> list:
        chain = []
        # Si primario es Gemini, Claude es el primer fallback (tiene tools)
        if self._primary is self._gemini and self._claude:
            chain.append(self._claude)
        elif self._primary is self._claude and self._gemini:
            chain.append(self._gemini)
        # Ollama siempre al final
        chain.append(self._ollama)
        return chain

    def complete(
        self,
        messages: list[dict],
        tools: list[dict] | None = None,
        system: str = "",
        max_tokens: int = 4096,
        force_provider: str | None = None,
    ) -> LLMResponse:
        """
        Intenta el proveedor primario; si falla MAX_PRIMARY_RETRIES,
        escala por la cadena de fallback.
        """
        if force_provider:
            provider = self._get_by_name(force_provider)
            if provider:
                return provider.complete(messages, tools=tools, system=system, max_tokens=max_tokens)

        # Intentar primario
        primary = self._primary
        if primary is not None:
            for attempt in range(self.MAX_PRIMARY_RETRIES):
                try:
                    return primary.complete(
                        messages, tools=tools, system=system, max_tokens=max_tokens
                    )
                except ProviderError as e:
                    err = str(e).lower()
                    is_overload = any(x in err for x in ("overload", "529", "503", "rate"))
                    if is_overload and attempt < self.MAX_PRIMARY_RETRIES - 1:
                        delay = self.RETRY_DELAYS[attempt]
                        time.sleep(delay)
                        continue
                    break  # error no transitorio → escalar

        # Escalar por la cadena
        for fallback in self._fallback_chain:
            # Si se necesitan tools y el fallback no las soporta, saltar
            if tools and not isinstance(fallback, ClaudeProvider):
                continue
            try:
                return fallback.complete(
                    messages, tools=tools, system=system, max_tokens=max_tokens
                )
            except ProviderError:
                continue

        raise AllProvidersExhausted(
            f"Canal '{self._canal}': todos los proveedores fallaron."
        )

    def _get_by_name(self, name: str):
        mapping = {"claude": self._claude, "gemini": self._gemini, "ollama": self._ollama}
        return mapping.get(name.lower())

    @property
    def claude_provider(self) -> ClaudeProvider | None:
        return self._claude

    def serialize_assistant_content(self, llm_response: LLMResponse, raw_content=None) -> list[dict]:
        """
        Convierte LLMResponse a formato de mensajes para el historial.
        Para Claude necesitamos el raw content (blobs originales).
        """
        if raw_content is not None and self._claude:
            return self._claude.serialize_content(raw_content)
        # Genérico
        blocks: list[dict] = []
        if llm_response.text:
            blocks.append({"type": "text", "text": llm_response.text})
        for tc in llm_response.tool_calls:
            blocks.append({
                "type": "tool_use",
                "id": tc.id,
                "name": tc.name,
                "input": tc.input,
            })
        return blocks

    def build_tool_result_message(
        self, tool_calls: list[ToolCall], results: list[str]
    ) -> dict:
        return {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": tc.id,
                    "content": res,
                }
                for tc, res in zip(tool_calls, results)
            ],
        }
