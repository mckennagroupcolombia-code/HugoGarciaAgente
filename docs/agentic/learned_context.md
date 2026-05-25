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

### 2026-05-24 — Refactorización AgentRun + Tricap Memory

- **`ANTHROPIC_API_KEY` ausente = "mantenimiento" inmediato.** `core.py` valida antes de instanciar `AgentRun`; si `cliente_ia = None` y el canal necesita Claude, retorna mantenimiento desde la línea de guard. No llega al orquestador.
- **`LLMRouter` fallback automático.** Cadena: primario del canal → Claude → Gemini → Ollama. `GeminiProvider` y `OllamaProvider` lanzan `ProviderError` si se les pasan tools; el router los salta y escala.
- **`_safe_migrate()` es el patrón para migraciones SQLite.** Envuelve cada función de migración en `try/except sqlite3.OperationalError`. Migraciones que asumen tablas existentes fallan en DB fresca; `_safe_migrate` lo silencia sin ocultar errores de lógica real.
- **`monkeypatch.setattr(module, "DB_PATH", str(path))` en lugar de `setenv`.** Las constantes de módulo se fijan al importar; `os.environ` parchado después no las afecta. Usar `setattr` directamente sobre el atributo del módulo.
- **Tests de posventa MeLi deben patchar `app.meli_postventa_notif`, no `webhook_meli`.** Las funciones viven en `meli_postventa_notif`; el webhook solo las llama. Patchar el módulo equivocado no intercepta nada.
- **Respuesta de `/api/tickets/{id}/pasos/{paso_id}` es `{"pasos": [...], "auto_resuelto": bool}`.** No es lista plana. Tests deben hacer `data["pasos"] if isinstance(data, dict) else data`.
- **`obtener_respuesta_ia` acepta `canal=` como kwarg.** Mocks en tests deben usar `lambda _msg, _sender, **_kw: (...)` para no romper con kwargs inesperados.
- **Guard JID vacío en `routes.py`.** `"" == ""` es True, así que todos los grupos vacíos colisionaban con el primer grupo. Siempre envolver comparaciones de JID con `bool(jid) and remote_jid == jid`.

## Cómo Actualizar

- Agregar solo hechos reutilizables.
- Si el aprendizaje es bug con causa raiz, guardar tambien con `scripts/guardar_memoria_debug.py`.
- Si cambia contrato publico, actualizar `docs/agentic/CONTRACTS.md` y ficha de modulo.
