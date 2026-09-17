# Module: Webhook MeLi

## Proposito

Recibir notificaciones de MercadoLibre en puerto 8080 y despachar questions, orders_v2, messages y shipments (autofactura entrega) sin bloquear el webhook.

## Archivos Ancla

- `webhook_meli.py`
- `app/meli_webhook_topics.py`
- `app/meli_postventa_notif.py`
- `app/tools/meli_autofactura_entrega.py`
- `app/meli_mensaje_venta_sku.py` (mensaje al comprador por SKU vendido; config en `app/data/mensajes_venta_sku.json`)
- `preventa_meli.py`
- `app/sync.py`

## Invariantes

- Produccion debe apuntar callbacks MeLi a `webhook_meli.py` puerto 8080, no al Flask principal 8081.
- El proceso usa flock `.webhook_meli.lock`; en tests usar `WEBHOOK_MELI_SKIP_SINGLETON_LOCK=1`.
- Webhook responde 200 rapido y procesa en hilos.
- Deduplicacion de preguntas usa ventana corta para evitar doble respuesta.
- Posventa MeLi usa API messages con header `x-version: 2`.
- Topico `orders_v2` (orden pagada) -> `procesar_mensaje_venta_sku` por cada item: si el SKU esta en `app/data/mensajes_venta_sku.json`, escribe el texto en el chat posventa una sola vez por orden+SKU (registro `mensajes_venta_sku_enviados.json`) y avisa al grupo posventa. Apagado con `MELI_MENSAJE_VENTA_SKU_ACTIVO=0`. Sin enlaces ni datos de contacto en el texto (politica MeLi).
- Topico `shipments` -> `procesar_entrega_meli_para_factura` gateado por `MELI_AUTOFACTURA_ENTREGA_ACTIVO` (default 0 = modo sombra, no toca Siigo/DIAN). No activar sin confirmar trafico real del topico.

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
