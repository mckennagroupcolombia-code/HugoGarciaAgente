# Module: Sync Stock And Invoices

## Proposito

Sincronizar stock entre MeLi y pagina web, y facturas entre MeLi y Alegra (Siigo solo historico hasta 2026-09-02). Alegra/Siigo no son fuente de stock.

## Archivos Ancla

- `app/sync.py`
- `app/services/inventario_control.py` (panel Control de Inventario: SWR, MeLi = stock vendible)
- `app/services/meli.py`
- `app/services/siigo.py`
- `app/tools/sincronizar_productos_pagina_web.py`
- `app/utils.py`

## Invariantes

- Cada plataforma autodecrementa su propio stock al vender.
- Venta MeLi: leer stock post-venta en MeLi y propagar a web.
- Venta web: leer stock web post-venta y propagar a MeLi.
- Alegra solo factura; no gobierna stock.
- Precio web = precio publicado en MeLi × 0.90 (10% de descuento comercial). Alegra replica el precio MeLi.
- Sincronizaciones largas deben correr en hilo o proceso controlado.
- `GET /api/inventario-control/resumen` sirve el último snapshot (TTL ~90s, stale hasta 6h) y refresca MeLi en segundo plano. El barrido vivo de MeLi no puede bloquear el GET del panel.

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
python3 scripts/consultar_memoria_debug.py --q "stock sync meli web Alegra facturas"
```

---

## Traído de CLAUDE.md (27-sep-2026)

> Texto movido tal cual al comprimir CLAUDE.md; allí queda un resumen con enlace aquí.

## Sincronización de Stock (Diseño Actual)

**Principio:** cada plataforma maneja su propio stock al vender. La otra se actualiza para quedar igual.

```
MeLi vende → MeLi autodecremente → leemos MeLi post-venta → actualizamos Web
Web vende  → Web autodecremente  → leemos Web post-venta   → actualizamos MeLi
```

**Función central:**
```python
# app/sync.py
sincronizar_stock_todas_las_plataformas(sku: str, nuevo_stock: int)
  # Página web vía `sincronizar_productos_pagina_web` (WEB_API_URL / WEB_API_KEY) y MeLi vía `actualizar_stock_meli`
  # Usar para sincronizaciones manuales, masivas u órdenes MeLi
```

**Funciones atómicas:**
```python
# app/tools/sincronizar_productos_pagina_web.py
sincronizar_productos_pagina_web(productos_meli: list)
  # Si WEB_API_URL/WEB_API_KEY están configurados: PUT real por SKU (stock numérico).
  # Si no: solo regenera PAGINA_WEB/site/data/cache.json desde Siigo (sin número de stock propio).

# app/services/meli.py
actualizar_stock_meli(sku: str, nuevo_stock: int) → str
  # Busca publicaciones activas por seller_sku (frágil: el atributo SELLER_SKU de MeLi
  # suele diferir en mayúsculas/formato del SKU en Sheets — preferir la variante por item_id abajo).

actualizar_stock_meli_por_item_id(item_id: str, nuevo_stock: int) → str
  # Igual pero directo por meli_id (MCOxxxxxxxx), sin depender del match de SKU.

sincronizar_stock_multicanal(sku, nuevo_stock, meli_id="", verificar_siigo=True) → dict
  # Usada por el panel Stock: desglosa el resultado por canal {meli, web, siigo}.
```

**IMPORTANTE — cuentas MeLi con inventario "multi-bodega":** si la tienda tiene
`stock por depósitos/ubicaciones` activado, MeLi **rechaza** `PUT /items/{id}` con
`available_quantity` (error `item.available_quantity.not_updatable` — "available_quantity
is not updatable for multi warehouse seller"). El stock real vive en
`GET /user-products/{user_product_id}/stock` (campo `locations`, tipo `seller_warehouse`,
con `store_id` y `quantity`); para escribir hay que usar
`PUT /user-products/{user_product_id}/stock/type/seller_warehouse` con header
`x-version` (tomado de la respuesta del GET anterior, control de concurrencia) y body
`{"locations": [{"type": "seller_warehouse", "store_id": ..., "quantity": N}]}`.
`_actualizar_stock_meli_item()` en `app/services/meli.py` intenta primero el PUT simple
y cae automáticamente a este mecanismo si detecta el error de multi-bodega — no asumir
que el PUT simple siempre funciona en cuentas nuevas o reconfiguradas.

**IMPORTANTE:** No existe sincronización con SIIGO por ahora. SIIGO solo se usa para facturación
(su `available_quantity` se puede leer vía `buscar_producto_siigo_por_sku` como referencia, pero nunca se escribe).

---
