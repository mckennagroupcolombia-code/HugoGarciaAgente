# Module: Telemetria

## Proposito

Telemetria interna unificada de toda la aplicacion (bot-mckenna/ en Node + los tres
procesos Flask: agente_pro.py :8081, webhook_meli.py :8080, website.py :8083): logs
estructurados, contadores de eventos tecnicos, captura de errores/excepciones no
manejadas y un panel de visualizacion. Sin servicios externos (Sentry/Grafana), sin
SQLite y sin LLM.

## Archivos Ancla

- `app/services/telemetria.py` — modulo central (registrar_error, errores_recientes,
  resumen_errores, incrementar_evento, resumen_metricas).
- `app/observability.py` — `spawn_thread()` envuelve el target y registra en
  telemetria cualquier excepcion no manejada del hilo antes de re-lanzarla.
- `app/routes.py` — `POST /api/telemetria/evento`, `GET /api/telemetria/resumen`,
  `GET /api/telemetria/errores`, y `_api_500` enriquecido.
- `webhook_meli.py`, `PAGINA_WEB/site/website.py` — `@app.errorhandler(500)` propio.
- `app/monitor.py::_autocorregir_y_reportar` — registra en telemetria ademas de la
  autocorreccion/alerta WhatsApp existente (no la reemplaza).
- `bot-mckenna/server.js` — `logEvent()`, `process.on('uncaughtException'/'unhandledRejection')`,
  POST fire-and-forget a `/api/telemetria/evento`.
- `desktop/src/hooks/useTelemetria.ts`, `desktop/src/components/TelemetriaPanel.tsx`
  (Sistemas → Telemetria).

## Invariantes

- Storage: JSONL (`app/data/telemetria_errores.jsonl`) + JSON con historico diario
  (`app/data/telemetria_metricas.json`), ambos con `fcntl.flock` (mismo patron que
  `app/services/llm_budget.py`) porque escriben tres procesos Flask a la vez. Ambos
  archivos estan en `.gitignore` (cambian a diario).
- No es tool de Claude (`app/core.py` no la registra) — infraestructura pasiva.
- No debe usarse para resumir/clasificar errores con un LLM sin pasar por
  `app/services/llm_budget.py`.
- `POST /api/telemetria/evento` y `GET /api/telemetria/resumen` van sin auth
  (localhost-only, mismo criterio que `/api/costos-ia`/`/api/metricas`;
  `_check_acceso_red` en `app/routes.py` ya bloquea IPs no-127.*).
  `GET /api/telemetria/errores` **si** requiere Bearer (`_api_token_valido()`)
  porque expone traceback/paths internos.
- `spawn_thread()` sigue muriendo igual tras una excepcion (no cambia el
  comportamiento observable) — solo queda registrada antes de re-lanzarse.
- `telemetria_metricas.json` es para eventos tecnicos nuevos; no duplica ni
  reemplaza los 4 contadores de negocio de `app/data/metricas_diarias.json`
  (`/api/metricas`). `app/meli_webhook_incidents.py` tampoco se toca/migra.
- Node: `logEvent()` es fire-and-forget (`.catch(() => {})`, timeout corto) —
  nunca debe bloquear ni tumbar el flujo de mensajes de WhatsApp si Python esta
  caido. `activityLog`/`/monitor`/`/monitor/json` de Node siguen igual, sin tocar.

## Riesgos

- Si Python (:8081) esta caido, los eventos de Node se pierden (aceptado:
  `activityLog` de Node sigue como respaldo minimo, y `/api/telemetria/resumen`
  detecta el servicio caido por otra via).
- Volumen de errores muy alto podria saturar el JSONL entre truncados (~5MB /
  ~10000 lineas) — si eso pasa seguido, es sintoma de un bug real que hay que
  arreglar, no de la telemetria.
- `telemetria.py` no debe importarse en el top-level de `app/observability.py`
  (ciclo de imports) — el import dentro de `spawn_thread()`/`registrar_error` es
  siempre lazy.

## Validacion

```bash
pytest tests/test_smoke.py
cd desktop && npx tsc -b && npm run build
```

Prueba manual end-to-end: forzar una excepcion en un hilo via `spawn_thread()` y
confirmar que aparece en `app/data/telemetria_errores.jsonl` /
`GET /api/telemetria/errores`; abrir Sistemas → Telemetria en el panel.

## Memoria Antes de Cambiar

```bash
python3 scripts/consultar_memoria_debug.py --q "telemetria observability spawn_thread errores"
```
