# Agentic Index

Mapa rapido para trabajar el proyecto con agentes sin cargar todo el repo.

## Regla Base

El orquestador lee este indice, consulta memoria si aplica, carga solo la ficha/skill del modulo afectado y delega exploracion a subagentes cuando el cambio cruza varias capas. No pegar `CLAUDE.md` completo salvo arquitectura global incierta.

## Por Tipo de Cambio

| Cambio | Leer primero | Archivos ancla | Validar |
| --- | --- | --- | --- |
| Webhook MeLi | `docs/agentic/modules/webhook-meli.md` | `webhook_meli.py`, `app/meli_webhook_topics.py`, `preventa_meli.py` | `pytest tests/test_smoke.py`, `python scripts/auditar_scripts_cron.py` |
| WhatsApp/rutas | `docs/agentic/modules/whatsapp-routes.md` | `app/routes.py`, `modulo_posventa.py`, `app/utils.py` | tests de helpers + auditoria |
| Tools Claude | `docs/agentic/modules/core-tools.md` | `app/core.py`, `app/tools/*`, `app/services/*` | import + tool registrado + auditoria |
| Stock/facturas | `docs/agentic/modules/sync-stock.md` | `app/sync.py`, `app/services/meli.py`, `app/services/siigo.py` | tests puros/mocks + auditoria |
| Panel React | `docs/agentic/modules/desktop-panel.md` | `desktop/src/api/client.ts`, hooks, panel afectado, `app/routes.py` | `cd desktop && npm run qa:full` |
| Operacion/systemd | `docs/agentic/modules/ops-systemd.md` | `scripts/systemd/*`, `scripts/*.sh`, `start.sh` | diagnostico en maquina destino |
| Tests/CI | `docs/agentic/modules/backend-qa.md` | `tests/*`, `.github/workflows/*`, `app/tools/script_audit.py` | `pytest`, workflow local si aplica |
| Contratos API | `docs/agentic/CONTRACTS.md` | `app/routes.py`, `webhook_meli.py`, `desktop/src/api/client.ts` | smoke + cliente afectado |
| Aprendizaje/sync | `docs/agentic/learned_context.md` | `HISTORIAL_MODIFICACIONES.md`, `app/data/debugging_resuelto.jsonl` | revisar que no tenga secretos |
| Ecosistema Gentleman | `docs/agentic/ECOSYSTEM.md` | `docs/agentic/*`, `.agents/skills/*`, `.cursor/skills*` | no instalar sin backup |
| Revision AI | `docs/agentic/modules/guardian-review.md` | `CLAUDE.md`, `docs/agentic/CONTRACTS.md`, workflows QA | modo reporte antes de bloquear |

## Protocolo Corto

1. Identificar modulo principal y secundarios.
2. Consultar memoria (`docs/agentic/MEMORY.md`) por bugs/invariantes relacionados.
3. Cargar ficha/skill del modulo.
4. Explorar con subagentes readonly si hay mas de 3 archivos o capas.
5. Planear cambio con riesgos y validacion.
6. Implementar acotado.
7. Ejecutar validacion proporcional.
8. Actualizar contratos si cambio entrada/salida publica.
9. Guardar aprendizaje reusable si hubo bug, contrato nuevo o decision.

## No Negociables

- MeLi callbacks productivos van a `webhook_meli.py` en puerto 8080.
- No mezclar systemd y nohup para el mismo puerto.
- Stock no sale de Siigo; Siigo solo factura.
- `app/core.py`: herramienta nueva debe importarse, registrarse y quedar auditada.
- JSON persistente en `app/data/` necesita contrato de lector/escritor.
- `agent-teams-lite` es referencia historica; preferir `gentle-ai` si se instala stack externo.
- Engram/sync nunca debe guardar secretos ni credenciales.
