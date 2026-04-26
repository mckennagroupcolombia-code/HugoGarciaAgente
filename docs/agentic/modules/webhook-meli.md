# Module: Webhook MeLi

## Proposito

Recibir notificaciones de MercadoLibre en puerto 8080 y despachar questions, orders_v2 y messages sin bloquear el webhook.

## Archivos Ancla

- `webhook_meli.py`
- `app/meli_webhook_topics.py`
- `app/meli_postventa_notif.py`
- `preventa_meli.py`
- `app/sync.py`

## Invariantes

- Produccion debe apuntar callbacks MeLi a `webhook_meli.py` puerto 8080, no al Flask principal 8081.
- El proceso usa flock `.webhook_meli.lock`; en tests usar `WEBHOOK_MELI_SKIP_SINGLETON_LOCK=1`.
- Webhook responde 200 rapido y procesa en hilos.
- Deduplicacion de preguntas usa ventana corta para evitar doble respuesta.
- Posventa MeLi usa API messages con header `x-version: 2`.

## Riesgos

- Doble proceso en puerto 8080.
- Divergencia entre ruta legacy `/notifications` en 8081 y webhook real 8080.
- Cambios en parsing de `resource` rompen posventa o preventa.
- Llamadas reales a MeLi en tests si no se mockean.

## Validacion

- `pytest tests/test_smoke.py`
- `python scripts/auditar_scripts_cron.py`
- En host: `./scripts/diagnostico_servicios_mcKenna.sh`

## Memoria Antes de Cambiar

Buscar:

```bash
python3 scripts/consultar_memoria_debug.py --q "webhook meli notifications questions orders messages"
```
