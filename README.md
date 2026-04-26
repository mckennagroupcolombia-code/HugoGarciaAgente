# McKenna Group — Agente Hugo García

[![Desktop QA](https://github.com/mckg/mi-agente/actions/workflows/desktop-qa.yml/badge.svg)](https://github.com/mckg/mi-agente/actions/workflows/desktop-qa.yml)

Automatización para McKenna Group S.A.S.: WhatsApp (Claude), preventa MercadoLibre (Gemini + fichas), facturación Siigo, stock tienda web ↔ MeLi, panel y monitor.

## Documentación

- **[CLAUDE.md](CLAUDE.md)** — Arquitectura, variables de entorno (incl. `GRUPO_PREVENTA_WA`, `GRUPO_POSTVENTA_WA`), flujos, endpoints y convenciones del repo (referencia principal para desarrollo e IAs).
- **[docs/agentic/INDEX.md](docs/agentic/INDEX.md)** — Metodología agentica: orquestador, memoria local, skills por módulo, fichas de contexto y checklist para cambios seguros con menos tokens.
- **[MANUAL.md](MANUAL.md)** — Recorrido técnico por módulos clave (`agente_pro.py`, `webhook_meli.py`, `core`, `routes`, CLI, servicios, posventa MeLi y utilidades de reporte WA).
- **Manual de usuario (PDF)** — `source venv/bin/activate && python3 scripts/generar_manual.py` (opcional `--enviar` envía a cynthua0418@gmail.com). Incluye postventa MeLi, observabilidad (`request_id`, logs JSON), auditoría de scripts (cron), backup nocturno + push Git opcional y grupo `GRUPO_ALERTAS_SISTEMAS_WA`.
- **Cron auditoría** — `./scripts/instalar_cron_mcKenna.sh` (idempotente). **Tests backend** — `pytest tests/test_smoke.py`. **QA panel** — `cd desktop && npm run qa:full`.
- **Memoria vectorial de debugging** — `python3 scripts/guardar_memoria_debug.py ...` para guardar bugs resueltos y `python3 scripts/consultar_memoria_debug.py --q "..."` para recuperar fixes históricos (colección `mckenna_debug_memory`).
- **WhatsApp bridge** — [bot-mckenna/README.md](bot-mckenna/README.md)

## Arranque rápido

```bash
source venv/bin/activate
python3 agente_pro.py          # Flask :8081 + menú CLI
python3 webhook_meli.py        # Webhook MeLi :8080 — en MeLi: https://bot.mckennagroup.co/notifications
cd bot-mckenna && npm ci && npm start   # Puente WA :3000
```

Nota operativa: el bridge WhatsApp se ejecuta solo desde `mi-agente/bot-mckenna` (ruta legacy fuera del repo eliminada para evitar duplicados de puerto 3000).

Detalle, `.env` y producción: ver **CLAUDE.md** → secciones «Cómo correr el proyecto» y «Variables de Entorno».

## Actualizar repositorio (git)

Usar flujo seguro para no romper cambios locales:

```bash
git status --short --branch
git branch -vv
git fetch origin
git pull --rebase origin main
```

Si hay cambios sin commit (working tree sucio), hacer commit o `git stash` antes de `pull`.
