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

## Hoja 1 del Sheet al día con las publicaciones (desde 2026-09-29)

`app/services/sheet_productos.py::asegurar_fila` agrega la fila de una publicación de MeLi a la Hoja 1
(A=ID MeLi, B=SKU, C=presentación, D=nombre, E=precio, F=stock, G=vacía, H=link; I/J = TDS, no se tocan).
Antes nadie agregaba filas: 67 de 168 publicaciones registradas estaban fuera (tandas desde junio) y sin
fila el bot de preventa no encuentra la ficha (col. I) ni el barrido de stock ve el ítem.
- **Cuándo corre** (en segundo plano, nunca rompe la publicación): al crear una publicación
  (`meli_compliance.crear_publicacion_meli`), al asignar un `meli_item_id` a un SKU
  (`publicaciones.actualizar_publicacion`) y al escribir el SKU de un ID que no está en la hoja
  (`relacion_codigos_meli_siigo._actualizar_sku_en_sheets_por_meli_id`).
- **Idempotente:** no duplica por ID (col. A) ni por SKU; si hay fila con el SKU pero sin ID, la completa.
  Lo que no se pasa se lee en vivo de MeLi (título, precio, stock, permalink, `SELLER_SKU`).
  `SHEET_PRODUCTOS_AUTOFILA=0` lo apaga.
- ⚠️ **Nunca usar `append_row(table_range="A1")`**: el 29-sep sobrescribió el ENCABEZADO de la hoja (se
  restauró desde el respaldo). Se escribe en una fila calculada (`len(get_all_values())+1`) con `batch_update`.
- **Estado tras la depuración del 29-sep:** de 168 publicaciones registradas en `publicaciones_overrides.json`,
  las 35 que faltaban en el Sheet eran reales (las cifras «67» y «50» de un primer conteo estaban infladas porque
  17 IDs de la tanda de junio estaban guardados **sin el prefijo `MCO`** y no coincidían con la col. A). Se agregaron
  17 (psyllium, semillas, sales, maní, ajo negro, alginato) + 19 (aceites esenciales, alantoína, arcillas, mantecas…);
  todos los IDs de overrides llevan `MCO`; se quitaron 5 claves redundantes/erróneas (`C-ACEESEARBTE`,
  `C-MANNCACNAT500g`, `ACEESENLIM5mL`, `C-DIOTIT500`, `C-ELAHID30m` — esta última apuntaba a la publicación de betaína).
  Se borraron también 4 filas duplicadas del Sheet (karité, sebo, cera, neem).
- **Las 7 claves con «typo» (resueltas el 29-sep, una por una):** solo 4 eran typos y se renombraron
  (`C-ACIKOJDPAL30mL`→`C-ACDKOJDPAL30mL`, `C-JABPOTLt`→`OLTKLt`, `C-COCPROBET500m`→`C-COCPROBET500mL`,
  `FOR-GLUTAR2PmL`→`C-GLU2P500mL`, que era un ingrediente de receta y no el SKU de venta). `ALNT250` (código viejo,
  2.ª publicación de `C-ALA250g`) se quitó. `C-ACEESEYLAYLA5mL` y `C-EMBPAT30mL` **no son typos**: son kits reales en
  Alegra/web (el `SELLER_SKU` de MeLi es un alias o el del producto base) y se dejaron. **Regla:** el SKU de venta que
  manda es el de Alegra + tienda web; el `SELLER_SKU` de MeLi puede ser un alias — antes de renombrar una clave de
  overrides, buscarla en Alegra, en `cache.json` y en `alegra_sku_alias_venta.json`.
- **Siguen fuera del Sheet a propósito (decidir):** 7 SEGUNDAS publicaciones activas de un SKU que ya tiene otra
  (`C-ACENEE60mL`→MCO1335735933, `C-COCDESHIL250g/500g`, `C-MAL500g`, `C-ALA250g`→MCO1354834051,
  `OLTKLt`→MCO3793586824, `C-ACEESEYLA5mL`→MCO1671238305; el stock por SKU actualiza todas), 2 cerradas/borradas en MeLi
  (limón 5 mL) y 3 sin `SELLER_SKU` que no son materia prima (2 collares, envase de vidrio).
- ⚠️ **Trampa al auditar con MeLi:** `GET /items?ids=a,b,c` **deduplica los IDs repetidos** y devuelve menos resultados; hacer
  `zip(ids, resultados)` desalinea todo lo que sigue (un diagnóstico de «títulos desplazados» salió de ahí y era falso).
  Pedir cada ID por separado o indexar por `body.id`. Y normalizar siempre `MCO` antes de comparar con la col. A del Sheet.
- Las 22 filas de «Esencias hidrosolubles 120 mL» (`MCO573366687`) NO son duplicados: son las 22 variaciones de una misma
  publicación (una fila por aroma).
