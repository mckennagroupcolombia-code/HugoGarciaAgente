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

## 2026-08-23 - Competencia MeLi por pantallazo, no por API ajena

Contexto:

MeLi responde 403 y penaliza `/sites/MCO/search` y GET de ítems de otros vendedores. El panel ya abría el listado en el navegador, pero el operador tenía que anotar precios a mano.

Decision:

En cada clic de «Buscar en MeLi» se abre el listado y se arma un reporte a partir del pantallazo (pestaña compartida, Ctrl+V o archivo). Gemini Flash extrae precios visibles. El servidor no visita Mercado Libre.

Motivo:

Es la única vía que respeta la política de MeLi y le da al operador el reporte por publicación que pedía.

Validacion:

`./venv/bin/python -m pytest tests/test_analisis_competencia_precios.py tests/test_smoke.py::test_api_competencia_precios_json_en_ambos_prefijos -q`

Archivos:

- `app/tools/analisis_competencia_precios.py`, `app/routes.py`
- `CompetenciaPreciosPanel.tsx`, `useCompetenciaPrecios.ts`
- `docs/agentic/modules/competencia-precios.md`

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

## 2026-05-24 - Refactorización agéntica completa: AgentRun + Tricap Memory

Contexto:

`app/core.py` tenía un bucle monolítico de ~325 líneas (1235–1559) mezclando tool-use, reintentos, checkpointing y lógica de memoria. Los tests fallaban en 10 puntos por bugs estructurales acumulados (JID vacío, migraciones SQLite en DB fresca, mocks incompletos, formato de respuesta cambiado).

Decision:

1. Extraer el ciclo tool-use a `app/agent/` (AgentRun + LLMRouter + ToolDispatcher + CheckpointStore).
2. Implementar Tricap Memory en `app/memory/` (working, episodic, semantic, compressor).
3. Reducir `obtener_respuesta_ia()` a validaciones + instancia de router y run.
4. Corregir los 10 fallos de test: guard JID vacío, `_safe_migrate()`, mocks de módulos correctos, fixture `monkeypatch.setattr` en lugar de `setenv`.

Motivo:

Desacoplar el modelo LLM del ciclo de control, añadir checkpointing real, habilitar fallback multi-proveedor sin cambiar lógica de negocio, y hacer los tests deterministas.

Validacion:

- `pytest tests/ -q` → 96/96 (antes 86/96).
- Import check del paquete `app.agent` sin credenciales.
- `scripts/auditar_scripts_cron.py` verde.

Archivos:

- `app/agent/__init__.py`, `run.py`, `llm_router.py`, `tool_dispatcher.py`, `checkpoint_store.py`
- `app/memory/__init__.py`, `working.py`, `episodic.py`, `semantic.py`, `compressor.py`
- `app/core.py` (líneas 1235–1559 reemplazadas)
- `app/services/tickets_db.py` (guard `_safe_migrate`, `_add_col`, `_migrate_categorias`)
- `app/routes.py` (guard JID vacío)
- `tests/test_notificaciones_meli_grupos.py`, `test_web_pedidos_comandos.py`, `test_tickets_pasos.py`, `test_whatsapp_pago_y_media.py`
- `docs/agentic/modules/agent-orchestrator.md` (ficha nueva)

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

## 2026-08-04 - Metodologia de recaps + panel de control de versiones

Contexto:

El repo se trabaja bajo cuenta git compartida ("McKenna Group Colombia") sin autoria individual por commit, y los cambios significativos quedaban solo en mensajes de commit o en la memoria de cada sesion de IA, sin un registro visible para el equipo.

Decision:

1. Protocolo obligatorio en `docs/agentic/TEAM_WORKFLOW.md`: identificar al desarrollador activo, firmar commits con `--author`, sincronizar con `git fetch`/`git pull` antes de programar, y agregar un recap estructurado en `docs/team-recaps.md` en el mismo commit del cambio.
2. Exponer ese historial en el panel `/app`: endpoints de solo lectura `GET /api/git/log` (grafo de commits) y `GET /api/team-recaps` (recaps parseados), y un panel nuevo "Control de Versiones" en el hub Sistemas con un grafo tipo cladograma dibujado en SVG y una lista de recaps.

Motivo:

Dar trazabilidad real de quien hizo que cambio pese a la cuenta compartida, y hacer visible para todo el equipo (no solo en un archivo perdido) el trabajo de cada sesion de IA.

Validacion:

- `venv/bin/python -m pytest tests/test_smoke.py`
- `cd desktop && npm run qa:full`
- Revision manual del panel Sistemas → Control de Versiones contra `git log --graph --oneline --all`.

Archivos:

- `docs/agentic/TEAM_WORKFLOW.md`, `docs/team-recaps.md`
- `app/tools/git_history.py`, `app/tools/team_recaps.py`, `app/routes.py`
- `desktop/src/components/ControlVersionesPanel.tsx`, `desktop/src/lib/gitGraphLayout.ts`, `desktop/src/hooks/useGitLog.ts`, `desktop/src/hooks/useTeamRecaps.ts`
