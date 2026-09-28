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

---

## Traído de CLAUDE.md (27-sep-2026)

> Texto movido tal cual al comprimir CLAUDE.md; allí queda un resumen con enlace aquí.

### A. Pregunta de cliente en MeLi (Preventa)

```
MeLi → POST /notifications (puerto 8080)
  └─ topic: "questions"
  └─ hilo: procesar_nueva_pregunta(question_id)   # preventa_meli + LLM si hay ficha
       ├─ GET /questions/{id} → texto pregunta + item_id
       ├─ GET /items/{item_id} → nombre del producto
       ├─ manejar_pregunta_preventa()
       │    ├─ buscar_ficha_tecnica_producto(nombre) → Google Sheets col I
       │    ├─ CON ficha → generar_respuesta_con_ficha() — modelo del canal `meli_preventa`
       │    │    (Claude por defecto, Gemini como red de seguridad, ver canales_config.py)
       │    │    ├─ LLM OK → POST /answers → responde en MeLi ✅
       │    │    └─ Claude y Gemini fallan → delega al grupo ❓
       │    └─ SIN ficha → guardar_pregunta_pendiente() → alerta grupo ❓
       └─ Reporte al grupo WhatsApp con resultado

  └─ topic: "messages" → posventa MeLi (alertas al grupo, ver webhook_meli.py)
```

**Posventa MeLi (mensajes post-compra):** Las peticiones a la API de mensajes de MeLi usan cabecera **`x-version: 2`** (formato actual de la API). El `resource` del webhook suele ser ruta de pack (`/messages/packs/{pack_id}/…`). En **`app/routes.py`**, si el path es **`/orders/{order_id}`**, se usa ese id como `pack_id` para listar mensajes; **`webhook_meli.py`** resuelve `pack_id` con lógica adicional cuando no viene en la ruta (mensaje por id, metadatos, búsqueda). Para deduplicar alertas se usa `id` o `message_id` según devuelva MeLi (`meli_postventa_id_mensaje` en `app/utils.py`). El texto para WhatsApp se arma con `meli_postventa_texto_para_notif`: admite `text` como string o como objeto (`plain`), y si el comprador solo envía **adjuntos** (PDF RUT, imagen) sin texto, la alerta indica nombres de archivo y pide revisar la conversación en MeLi. Los reportes a WhatsApp vía `enviar_whatsapp_reporte` **reintentan** ante **503** del puente Node (WhatsApp sincronizando) y ante fallos de conexión breves. Si falla el envío al grupo tras una respuesta automática de preventa, `preventa_meli.py` deja traza en consola (la pregunta puede haberse respondido en MeLi igualmente).

### B. Orden pagada en MeLi (Stock sync)

```
MeLi → POST /notifications (puerto 8080)
  └─ topic: "orders_v2", status: "paid"
  └─ hilo: _procesar_orden_meli(order_id)
       ├─ GET /orders/{id} → lista de items
       └─ Por cada item:
            ├─ GET /items/{item_id} → seller_custom_field (SKU) + available_quantity
            └─ sincronizar_stock_todas_las_plataformas(sku, stock_post_venta) → web (API) + MeLi
```

## Sistema de Preventa MeLi


### Archivos de persistencia

```python
# Preguntas sin responder (queue):
app/data/preguntas_pendientes_preventa.json
{
  "preguntas": [{
    "question_id": "13553987497",
    "titulo_producto": "Jabón Potásico...",
    "pregunta": "¿Se puede aplicar a flores?",
    "timestamp": "2026-04-01T00:00:00",
    "respondida": false
  }]
}

# Casos aprendidos (few-shot):
app/training/casos_preventa.json
{
  "casos": [{
    "producto": "Urea Cosmética 250 Gr",
    "pregunta": "¿Viene en polvo o líquida?",
    "respuesta": "Hola veci, viene en estado sólido...",
    "timestamp": "2026-03-31T13:17:48"
  }]
}
```

### Árbol de decisión

```
Nueva pregunta MeLi
  │
  ├─ Ficha técnica en Sheets → SI
  │    └─ LLM del canal `meli_preventa` genera respuesta (Claude primero, Gemini de respaldo)
  │         ├─ OK → responde automáticamente en MeLi
  │         └─ Claude y Gemini fallan (503, timeout, presupuesto) → ❓ delega al grupo
  │
  └─ Ficha técnica → NO → ❓ delega al grupo

Comando del grupo:
  "resp <últimos3digID>: <respuesta>"
  → Responde en MeLi
  → Guarda como caso de entrenamiento
```

### Errores comunes en preventa

- **El agente responde genéricamente**: `generar_respuesta_con_ficha()` falló y devolvió el fallback. **Fix aplicado**: ahora devuelve `None` en error y delega al grupo.
- **Pregunta sin ficha**: producto no tiene datos en columna I de Sheets. Solución: llenar la ficha técnica en el Sheet.

---
