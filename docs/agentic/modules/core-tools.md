# Module: Core Tools

## Proposito

Configurar IA principal, prompt, herramientas Claude y ciclo de tool-use para WhatsApp, `/chat` y CLI.
Desde 2026-05-24 el ciclo de tool-use fue extraído a `app/agent/` (AgentRun); `app/core.py` solo hace
validaciones de seguridad y delega a `AgentRun.execute()`.

## Archivos Ancla

- `app/core.py` — validaciones, instancia de `LLMRouter` + `AgentRun`, `obtener_respuesta_ia()`
- `app/agent/run.py` — `AgentRun`: ciclo tool-use con checkpointing y reintentos
- `app/agent/llm_router.py` — `LLMRouter`: multi-proveedor Claude/Gemini/Ollama
- `app/agent/tool_dispatcher.py` — ejecución de tools con registro episódico
- `app/agent/checkpoint_store.py` — SQLite `app/data/agent_checkpoints.sqlite3`
- `app/memory/` — Tricap Memory: working, episodic, semantic, compressor
- `app/tools/*`, `app/services/*` — implementaciones de las ~32 herramientas registradas
- `app/tools/system_tools.py` — tools de archivos con restricción de rutas opcional

## Flujo de Despacho (desde 2026-05-24)

```
obtener_respuesta_ia(pregunta, usuario_id, canal, ...)
  ├─ Validaciones de seguridad (si no hay cliente IA → devuelve "mantenimiento")
  ├─ router = LLMRouter(canal, claude_client, ...)
  ├─ agent_run = AgentRun(usuario_id, canal, router, tools_map, ...)
  └─ result = agent_run.execute(pregunta, messages, adjuntos)
       └─ for intento in range(3):
            for iter in range(20):
              response = router.complete(messages, tools, system)
              if needs_tools → dispatch → checkpoint → next iter
              if end_turn → cleanup → return AgentResult
```

Ver ficha completa: `docs/agentic/modules/agent-orchestrator.md`

## Invariantes

- Si `ANTHROPIC_API_KEY` falta, `cliente_ia = None`; `core.py` devuelve "mantenimiento" antes de llegar al orquestador.
- `AgentRun` no conoce qué modelo ejecuta; solo habla con `LLMRouter`.
- `GeminiProvider` y `OllamaProvider` no soportan tool-use; el router los salta si se necesitan tools.
- Preventa MeLi con ficha usa Gemini en servicio separado (`app/services/meli_preventa.py`), sin pasar por AgentRun.
- Tool nueva debe estar importada y registrada en `todas_las_herramientas` en `app/core.py`.
- No ejecutar sync sin intención explícita del usuario.
- File tools se restringen en producción con `AGENTE_RESTRICT_FILE_TOOLS` o `FLASK_ENV=production`.
- El checkpoint se guarda ANTES de continuar el ciclo, no al final del turno.

## Riesgos

- Import pesado en `app/core.py` puede romper arranque completo.
- Firma de tool cambia y Claude queda con schema desactualizado.
- Tool con efectos laterales expuesta sin guardrails.
- `OllamaProvider` requiere `ollama` en PATH y modelo descargado; falla silenciosamente si no.
- Checkpoints acumulados si el proceso se mata a mitad de turno; `purge_old(24h)` los limpia.

## Validacion

```bash
source venv/bin/activate
python3 -c "
from app.agent.checkpoint_store import save, load_latest, delete_run
from app.agent.llm_router import LLMRouter, ClaudeProvider, LLMResponse
from app.agent.tool_dispatcher import dispatch, apply_web_overrides
from app.agent.run import AgentRun, AgentResult
print('OK')
"
python -m pytest tests/ -q   # 96/96
python scripts/auditar_scripts_cron.py
```

## Checklist Tool Nueva

- Función tiene nombre claro.
- Import en `app/core.py`.
- Registro en `todas_las_herramientas`.
- Manejo de error devuelve texto útil (no stack trace).
- Sin secretos en logs.
- `_MAX_RESULT_CHARS = 8192` aplica en `tool_dispatcher.py`; no truncar manualmente.
- Validación agregada o documentada.
