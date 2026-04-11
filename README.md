# McKenna Group — Agente Hugo García

Automatización para McKenna Group S.A.S.: WhatsApp (Claude), preventa MercadoLibre (Gemini + fichas), facturación Siigo, stock tienda web ↔ MeLi, panel y monitor.

## Documentación

- **[CLAUDE.md](CLAUDE.md)** — Arquitectura, variables de entorno (incl. `GRUPO_PREVENTA_WA`, `GRUPO_POSTVENTA_WA`), flujos, endpoints y convenciones del repo (referencia principal para desarrollo e IAs).
- **[MANUAL.md](MANUAL.md)** — Recorrido técnico por módulos clave (`agente_pro.py`, `webhook_meli.py`, `core`, `routes`, CLI, servicios, posventa MeLi y utilidades de reporte WA).
- **Manual de usuario (PDF)** — `source venv/bin/activate && python3 scripts/generar_manual.py` (opcional `--enviar` envía a cynthua0418@gmail.com). Incluye postventa MeLi, observabilidad (`request_id`, logs JSON), auditoría de scripts (cron), backup nocturno + push Git opcional y grupo `GRUPO_ALERTAS_SISTEMAS_WA`.
- **Cron auditoría** — `./scripts/instalar_cron_mcKenna.sh` (idempotente). **Tests** — `pytest tests/test_smoke.py`.
- **WhatsApp bridge** — [bot-mckenna/README.md](bot-mckenna/README.md)

## Arranque rápido

```bash
source venv/bin/activate
python3 agente_pro.py          # Flask :8081 + menú CLI
python3 webhook_meli.py        # Webhook MeLi :8080
cd bot-mckenna && npm ci && npm start   # Puente WA :3000
```

Detalle, `.env` y producción: ver **CLAUDE.md** → secciones «Cómo correr el proyecto» y «Variables de Entorno».
