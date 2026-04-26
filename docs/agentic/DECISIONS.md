# Decision Memory

Registro corto de decisiones agenticas y tecnicas. Para historia larga usar `HISTORIAL_MODIFICACIONES.md`; para bugs con causa raiz usar `app/data/debugging_resuelto.jsonl`.

## Regla

Guardar aqui decisiones que cambian como trabajamos o como se integra un modulo. Cada entrada debe tener contexto, decision, motivo y validacion.

## Plantilla

```markdown
## YYYY-MM-DD - Titulo

Contexto:

Decision:

Motivo:

Validacion:

Archivos:
```

## 2026-04-26 - Metodologia agentica por capas

Contexto:

El proyecto McKenna crece en varios servicios y los agentes gastan muchos tokens releyendo arquitectura global. El workshop JSCONF2026 propone orquestador, subagentes, memoria tipo Engram y skills lazy.

Decision:

Adoptar `docs/agentic/` como capa versionada de metodologia: indice, orquestacion, memoria, skills, contratos, checklist y fichas por modulo.

Motivo:

Reducir contexto por sesion, evitar perdida de vision global, facilitar cambios pequenos y exigir validacion proporcional.

Validacion:

- `venv/bin/python -m pytest tests/test_smoke.py`
- `AGENTE_AUDITORIA_SKIP_WA=1 AGENTE_AUDITORIA_CRON_QUIET=1 venv/bin/python scripts/auditar_scripts_cron.py`

Archivos:

- `docs/agentic/*`
- `tests/test_smoke.py`
- `.github/workflows/backend-qa.yml`

## 2026-04-26 - CI backend smoke minimo

Contexto:

Existia QA frontend, pero no workflow backend. La documentacion mencionaba smoke Python.

Decision:

Agregar `.github/workflows/backend-qa.yml` para `pytest tests/test_smoke.py` y auditoria de scripts en cambios backend/docs agentic.

Motivo:

Detectar errores de sintaxis, imports y contratos puros antes de produccion.

Validacion:

Smoke local verde y auditoria verde.

Archivos:

- `.github/workflows/backend-qa.yml`
- `tests/test_smoke.py`
- `requirements.txt`

## 2026-04-26 - Helper global 5S

Contexto:

Smoke detecto que `default_postflight_steps()` llamaba `_steps_from_labels`, pero el helper estaba definido dentro de `create_routine_project()`.

Decision:

Mover `_steps_from_labels` a helper global reusable en `app/services/cinco_s.py`.

Motivo:

El helper lo usan flujos de proyecto y rutina fuera del scope local anterior.

Validacion:

`tests/test_smoke.py` pasa rutas 5S que crean proyectos/rutinas.

Archivos:

- `app/services/cinco_s.py`
- `tests/test_smoke.py`

## 2026-04-26 - Ecosistema Gentleman como referencia de superagentes

Contexto:

Se evaluaron `gentle-ai`, `engram`, `agent-teams-lite`, `Gentleman-Skills`, `gentleman-guardian-angel` y `Gentleman.Dots` para ampliar la metodologia agentica McKenna.

Decision:

Documentar el ecosistema completo en `docs/agentic/ECOSYSTEM.md`, pero no instalar binarios globales ni hooks bloqueantes sin tarea separada, backup y validacion en entorno dev.

Motivo:

`gentle-ai` concentra SDD, skills, MCP, Engram, persona y subagentes; `agent-teams-lite` esta archivado/deprecado. Engram y GGA son útiles, pero deben entrar de forma controlada para no exponer secretos ni bloquear produccion.

Validacion:

Docs incorporan ruta de adopcion, reglas de seguridad y delegacion automatica por intencion.

Archivos:

- `docs/agentic/ECOSYSTEM.md`
- `docs/agentic/ORCHESTRATION.md`
- `docs/agentic/SKILLS.md`
- `docs/agentic/MEMORY.md`
