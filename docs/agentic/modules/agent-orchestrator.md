# Module: Agent Orchestrator (app/agent/)

## Propósito

Capa de orquestación determinista que reemplaza el bucle monolítico de `core.py`.
Desacopla el ciclo de tool-use del modelo LLM, añade checkpointing y reintento con
contexto episódico, y expone una interfaz agnóstica al proveedor de IA.

Creado en sesión 2026-05-24 como parte de la Refactorización Agéntica Completa.

## Archivos del Paquete

```
app/agent/
├── __init__.py
├── checkpoint_store.py   — persistencia SQLite de estado por iteración
├── llm_router.py         — router multi-proveedor Claude/Gemini/Ollama
├── run.py                — AgentRun: ciclo tool-use con checkpointing
└── tool_dispatcher.py    — ejecución de tools con registro episódico
```

## Componentes Clave

### AgentRun (`run.py`)

Estado completo de un turno. `execute()` corre el ciclo:

```
for intento in range(MAX_REINTENTOS=3):
    for iter in range(MAX_TOOL_ITERS=20):
        response = router.complete(messages, tools, system)
        if needs_tools → dispatch → checkpoint → next iter
        if end_turn → persist → return AgentResult
    # límite → return error legible
# AllProvidersExhausted → return mensaje según tipo error
```

- Re-inyecta contexto episódico de herramientas fallidas en reintentos (attempt > 0).
- Guarda checkpoint después de cada iteración de tools (no después de la respuesta final).
- Llama `working.evict_if_needed` antes de cada LLM call.
- Retorna `AgentResult(text, messages, provider, run_id, iterations, error)`.

### LLMRouter (`llm_router.py`)

Tres proveedores concretos con interfaz uniforme `complete() → LLMResponse`:

| Proveedor | Tool-use | Fallback |
|---|---|---|
| `ClaudeProvider` | ✅ completo | Primario para WhatsApp/chat |
| `GeminiProvider` | ❌ solo texto | Se usa para canales que lo configuren |
| `OllamaProvider` | ❌ solo texto | Último recurso local (subprocess) |

Cadena de fallback automática:
- Primario = proveedor del canal según `obtener_modelo_canal()`.
- Si primario falla `MAX_PRIMARY_RETRIES=3` veces → escala a la cadena.
- Si se necesitan tools y el fallback no las soporta → se salta ese proveedor.
- Si todos fallan → lanza `AllProvidersExhausted`.

`LLMResponse` tiene `.needs_tools` (bool), `.stop_reason`, `.tool_calls`, `.text`.

### ToolDispatcher (`tool_dispatcher.py`)

```python
dispatch(tool_calls, tools_map, run_id, iteration) → list[str]
```

- Ejecuta cada `ToolCall` con `fn(**tc.input)`.
- Trunca resultado a `_MAX_RESULT_CHARS = 8192`.
- Registra cada intento en memoria episódica (`episodic.record`).
- En error: lanza `compress_and_store_threaded` (no bloquea el turno).
- `apply_web_overrides`: redirige `buscar_producto_completo → buscar_productos_combo_siigo` para canal `web_chat`.

### CheckpointStore (`checkpoint_store.py`)

SQLite en `app/data/agent_checkpoints.sqlite3`.

```python
save(AgentCheckpoint)          # INSERT OR REPLACE por run_id + iteration
load_latest(run_id)            # checkpoint más reciente del run
delete_run(run_id)             # limpieza al terminar turno
purge_old(max_age_hours=24)    # evita acumulación
```

## Integración con core.py

`obtener_respuesta_ia()` en `app/core.py` instancia el router y el run al final
de su función (tras todas las validaciones previas) y delega completamente:

```python
router = LLMRouter(canal=canal_efectivo, claude_client=cliente_ia, ...)
agent_run = AgentRun(usuario_id=..., canal=..., router=..., ...)
result = agent_run.execute(pregunta, messages, adjuntos, ...)
```

Las validaciones de seguridad (`if not cliente_ia and not cliente_gemini → mantenimiento`,
`if modelo_canal.startswith("claude-") and not cliente_ia → error config`) siguen
en `core.py` ANTES del dispatch.

## Invariantes

- `AgentRun` no sabe qué modelo ejecuta; solo habla con `LLMRouter`.
- El checkpoint se guarda ANTES de continuar el ciclo, no al final del turno.
- En reintentos, el contexto episódico de tools fallidas se inyecta en el system prompt.
- `GeminiProvider` y `OllamaProvider` rechazan `ProviderError` si se pasan tools (no las soportan).
- La sesión se limpia (`_cleanup`) siempre: en éxito, en error de límite y en AllProvidersExhausted.

## Riesgos

- Si `ANTHROPIC_API_KEY` no está en `.env`, `cliente_ia = None` y el router no tiene
  proveedor con tool-use; devuelve "mantenimiento" desde `core.py` línea 1164.
- Checkpoints acumulados si el proceso se mata a mitad de turno; `purge_old` los limpia en 24h.
- `OllamaProvider` requiere `ollama` en PATH y modelo descargado; falla silenciosamente si no.

## Validación

```bash
# Importar todos los módulos del paquete
source venv/bin/activate
python3 -c "
from app.agent.checkpoint_store import save, load_latest, delete_run
from app.agent.llm_router import LLMRouter, ClaudeProvider, LLMResponse
from app.agent.tool_dispatcher import dispatch, apply_web_overrides
from app.agent.run import AgentRun, AgentResult
print('OK')
"

# Suite completa
python3 -m pytest tests/ -q
```

## Historia

- `2026-05-24`: Creado en refactorización completa. Reemplaza ~325 líneas del bucle
  monolítico en `core.py` (líneas 1235–1559). Suite pasa 96/96 tests.
