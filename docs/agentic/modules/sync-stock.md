# Module: Sync Stock And Invoices

## Proposito

Sincronizar stock entre MeLi y pagina web, y facturas entre MeLi y Siigo. Siigo no es fuente de stock.

## Archivos Ancla

- `app/sync.py`
- `app/services/meli.py`
- `app/services/siigo.py`
- `app/tools/sincronizar_productos_pagina_web.py`
- `app/utils.py`

## Invariantes

- Cada plataforma autodecrementa su propio stock al vender.
- Venta MeLi: leer stock post-venta en MeLi y propagar a web.
- Venta web: leer stock web post-venta y propagar a MeLi.
- Siigo solo factura; no gobierna stock.
- Sincronizaciones largas deben correr en hilo o proceso controlado.

## Riesgos

- Actualizar stock desde fuente equivocada.
- SKU MeLi (`seller_custom_field`) no siempre coincide con SKU catalogo.
- API web depende de `WEB_API_URL` y `WEB_API_KEY`.
- Facturacion cruza pack/order IDs; errores pueden subir PDF al pack incorrecto.

## Validacion

- Tests unitarios con mocks para transformaciones y decisiones.
- `python scripts/auditar_scripts_cron.py`.
- Prueba manual por pack/sku en entorno controlado si toca API externa.

## Memoria Antes de Cambiar

```bash
python3 scripts/consultar_memoria_debug.py --q "stock sync meli web siigo facturas"
```
