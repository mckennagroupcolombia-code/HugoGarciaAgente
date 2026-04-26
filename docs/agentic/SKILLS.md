# Skill Matrix

Skills son contexto modular cargado bajo demanda. Primero esta matriz; si un modulo se usa mucho, convertir su ficha en skill real bajo `.agents/skills/`.

## Matriz

| Intencion | Skill/contexto | Leer | Validar |
| --- | --- | --- | --- |
| Cambiar webhook MeLi | `webhook-meli` | `docs/agentic/modules/webhook-meli.md` | auditoria + tests de despacho/dedup si existen |
| Cambiar comandos WhatsApp | `whatsapp-routes` | `docs/agentic/modules/whatsapp-routes.md` | tests de parser/helper |
| Agregar tool Claude | `core-tools` | `docs/agentic/modules/core-tools.md` | tool importado + registrado + auditoria |
| Cambiar stock/facturas | `sync-stock` | `docs/agentic/modules/sync-stock.md` | mocks de MeLi/web/Siigo |
| Cambiar panel React | `desktop-panel` | `docs/agentic/modules/desktop-panel.md` | `npm run qa:full` |
| Cambiar systemd/ops | `ops-systemd` | `docs/agentic/modules/ops-systemd.md` | diagnostico en host |
| Agregar tests/CI | `backend-qa` | esta matriz + `tests/conftest.py` | `pytest` + workflow |
| Revisar diff/PR | `guardian-review` | `docs/agentic/modules/guardian-review.md` | modo reporte, no bloqueante al inicio |
| Instalar/evaluar Gentleman stack | `ecosystem` | `docs/agentic/ECOSYSTEM.md` | backup + entorno dev primero |

## Registro De Skills

| Skill | Triggers | Subagente sugerido | Archivos prohibidos sin plan |
| --- | --- | --- | --- |
| `webhook-meli` | MeLi, questions, orders_v2, messages, `/notifications` | `explore` + `verify` | `webhook_meli.py`, `app/meli_webhook_topics.py` |
| `whatsapp-routes` | WhatsApp, `resp`, `posventa`, comprobante, `/whatsapp` | `explore` | `app/routes.py` |
| `core-tools` | Claude, tool-use, herramienta nueva, prompt | `explore` + `review` | `app/core.py` |
| `sync-stock` | stock, factura, Siigo, MeLi sync, web sync | `explore` + `verify` | `app/sync.py`, `app/services/meli.py` |
| `desktop-panel` | React, panel, `/app`, hook, Vite | `explore` + `verify` | `desktop/src/api/client.ts`, `app/routes.py` |
| `ops-systemd` | systemd, nohup, puerto, servicio, cloudflared | `explore` | `scripts/systemd/*`, `start.sh` |
| `backend-qa` | pytest, CI, smoke, auditoria | `verify` | `.github/workflows/*`, `tests/*` |
| `guardian-review` | review, PR, commit, pre-commit, gga | `review` | hooks git, `.github/workflows/*` |
| `ecosystem` | gentle-ai, engram, agent-teams-lite, Gentleman-Skills, GGA, Dots | `explore` | configuracion global, MCP, memoria |

## Reglas de Lazy Loading

- Cargar solo una ficha principal y maximo dos secundarias.
- Si la ficha no alcanza, lanzar subagente `explore` en vez de leer archivos grandes completos.
- No meter manuales completos en prompt salvo duda de arquitectura global.
- Tras descubrir una regla estable, actualizar ficha o memoria.
- Convertir a skill real solo cuando una ficha se use varias veces o tenga pasos operativos precisos.
- Importar skills externas de `Gentleman-Skills` selectivamente. Prioridad McKenna: `react-19`, `typescript`, `pytest`, `playwright` y `github-pr`.
- Si se adopta `gentle-ai`, correr `skill-registry` despues de instalar/remover skills para regenerar contexto.

## Plantilla Para Skill Real

```markdown
---
name: modulo-x
description: Usar cuando el cambio toca X.
---

Contexto minimo:
- Archivo ancla:
- Invariantes:
- Comandos validacion:
- Riesgos:

Proceso:
1. Leer...
2. Cambiar...
3. Validar...
```
