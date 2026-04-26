# Learned Context

Resumen portable para otro dev/agente. Mantener corto; mover detalle a fichas o memoria debug.

## Arquitectura Operativa

- `webhook_meli.py` es dueño productivo de `/notifications` en puerto 8080.
- `agente_pro.py` sirve Flask principal en 8081, WhatsApp, `/chat`, `/api/*` y SPA `/app`.
- `bot-mckenna/` es unico bridge WhatsApp soportado en puerto 3000.
- No mezclar procesos systemd y nohup para mismo puerto.

## Invariantes Negocio

- Stock se sincroniza entre MeLi y pagina web; Siigo solo factura.
- Preventa MeLi con ficha usa Gemini; WhatsApp/chat usa Claude.
- Si Gemini falla en preventa, se delega al grupo; no responder fallback generico al cliente.
- Posventa MeLi usa API messages con `x-version: 2`.

## Validaciones Confiables

- Backend smoke: `venv/bin/python -m pytest tests/test_smoke.py`.
- Auditoria scripts: `AGENTE_AUDITORIA_SKIP_WA=1 AGENTE_AUDITORIA_CRON_QUIET=1 venv/bin/python scripts/auditar_scripts_cron.py`.
- Panel: `cd desktop && npm run qa:full`.

## Aprendizajes Recientes

- `app/services/cinco_s.py`: `_steps_from_labels` debe ser helper global; `default_postflight_steps()` lo usa fuera de `create_routine_project()`.
- CI backend necesita dependencias de import de `app.core` aunque el test no llame APIs externas.
- `tests/conftest.py` fuerza `WEBHOOK_MELI_SKIP_SINGLETON_LOCK=1` para no chocar con flock.
- Ecosistema Gentleman: `gentle-ai` reemplaza `agent-teams-lite` como instalador/gestor central; ATL queda como referencia archivada.
- Engram es candidato para memoria persistente agent-agnostic; usar primero en dev y filtrar secretos antes de sync.
- Guardian Angel/GGA puede servir como review AI pre-commit/PR, inicialmente solo modo reporte.

## Cómo Actualizar

- Agregar solo hechos reutilizables.
- Si el aprendizaje es bug con causa raiz, guardar tambien con `scripts/guardar_memoria_debug.py`.
- Si cambia contrato publico, actualizar `docs/agentic/CONTRACTS.md` y ficha de modulo.
