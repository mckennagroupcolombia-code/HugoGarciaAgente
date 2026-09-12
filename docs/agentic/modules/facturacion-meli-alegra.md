# Facturación MeLi ↔ Alegra — empalme de migración, packs y regularización (sep-2026)

Ficha de módulo para cualquier agente que toque facturación de ventas MeLi después de la
migración Siigo → Alegra (3-sep-2026). Resume qué estaba roto, por qué "lo que ya estaba
corregido" volvió a fallar, qué se cambió el 9-sep-2026 y qué decisiones quedan abiertas.

## 1. Cronología del empalme (hechos verificados)

| Fecha | Hecho |
|---|---|
| 2026-09-02 | `FECHA_CORTE_MIGRACION_ALEGRA`. astroselling seguía facturando en **Siigo al comprar** (46 facturas ese día). |
| 2026-09-03 | Arranca la facturación en Alegra. astroselling emite sus **últimas 44 facturas en Siigo**. |
| 2026-09-03 | Webhook `webhook_meli.py` arranca 23:37 con el código de ese momento (importante abajo). |
| 2026-09-04 → 09 | La autofactura de Alegra (`MELI_AUTOFACTURA_ENTREGA_ACTIVO=1`) factura **al entregar**. Todo lo comprado el 2–3 de sep y entregado después queda facturado **dos veces** (Siigo al comprar + Alegra al entregar). |
| 2026-09-06 | Se escribe el fix "multi-orden" en `meli_autofactura_entrega.py` (facturar todas las órdenes hermanas de un pack). **Nunca corrió**: el proceso del webhook no se reinició hasta el 9-sep. |
| 2026-09-06/07 | Siigo pasa a **solo lectura** (`read_only` en `log_cron.txt`). Desde ahí no se puede emitir nada allá, ni notas crédito. |
| 2026-09-09 | Diagnóstico y correcciones de esta ficha. Autofactura apagada, botón consolida por pack, cruce comprado vs facturado, histórico, regularización, tickets. |

## 2. Los bugs, uno por uno

1. **Pack multi-producto facturado a medias.** Un carrito de N productos son N órdenes MeLi con el
   mismo `pack_id` y un solo envío. `GET /shipments/{id}` reporta UNA orden; el código viejo facturaba
   solo esa. El fix del 6-sep existía en disco pero el webhook llevaba desde el 3-sep en memoria con
   el código anterior. Lección: **un fix en un módulo importado por un servicio de larga vida no existe
   hasta que ese servicio se reinicia** — verificar `ps -o lstart` del proceso contra la fecha del commit.
2. **Aun con el fix, N facturas por carrito.** El diseño era "una factura Alegra por orden"; MeLi solo
   admite **un documento fiscal por pack**, así que el comprador veía una sola. El operador corregía a
   mano anulando y reemitiendo consolidado. Ahora `facturar_pack_meli_manual()` emite **una** factura
   con todos los productos del carrito (`purchase_order = pack_id`).
3. **Cruce comprado vs facturado por orden, no por pack.** `_detalle_venta_meli` compara una orden
   (1 producto) contra su factura (1 producto) → "coincide" aunque falten 6. Ahora
   `construir_cruce_pack()` en `facturacion_ventas_unificado.py` cruza TODO el carrito contra TODAS
   las facturas vigentes del pack (las anuladas por NC no cuentan). Estado nuevo:
   `facturada_parcial` → badge "🔴 Facturada INCOMPLETA".
4. **SKU leído de un solo campo.** MeLi trae el SKU en `seller_custom_field` (variación) **o** en
   `seller_sku`; hay publicaciones con uno solo de los dos. Se leen ambos, `seller_custom_field` primero.
5. **Falsos faltantes cuando MeLi no responde.** Si una orden hermana no devuelve detalle, el cruce
   inventaba un faltante. Ahora reintenta y, si sigue sin dato, marca `concluyente=False`
   ("No verificable") en vez de acusar una discrepancia inexistente.
6. **Clasificación CC/NIT en Alegra por longitud del número.** `_resolver_o_crear_contacto_alegra`
   decidía `NIT` solo si el número tenía >10 dígitos; un NIT colombiano tiene 9–10, igual que una
   cédula → casi todo NIT quedaba como `CC`. Ahora se pasa `tipo_documento` (el `doc_type` real de
   MeLi) y, para NIT, se **recorta el dígito de verificación** que MeLi manda pegado (10 dígitos =
   base 9 + DV): Alegra calcula el DV solo y lo guarda aparte en `identificationObject.dv`. Caso
   Fork Catering: A71352 (Siigo) salió con DV 5 por este mismo error de doble cálculo.
7. **Ítems inactivos en facturas.** `buscar_producto_alegra_por_referencia` devolvía el primer ítem
   sin mirar `status`. Alegra **acepta ítems inactivos en facturas nuevas pero no en notas crédito**
   (error 9053): se generaban facturas que después no se pueden anular. Ahora prefiere el ítem activo.
8. **Catálogo: recrear productos inactiva los que ya tienen facturas.** Al "recrear" un producto el
   viejo pasa a `CODIGO-LEGACY` inactivo; las facturas ya emitidas siguen apuntando a ese ítem. Para
   anularlas, `scripts/regularizar_packs_parciales.py::_anular` reactiva temporalmente solo esos
   ítems, anula y los vuelve a inactivar ("opción 1").

## 3. Empalme Siigo–Alegra (barrido 30 días, 1.684 órdenes, 9-sep-2026)

| Situación | Packs | Alegra vigente |
|---|---|---|
| Solo Siigo (pre-migración) | 576 | — |
| Solo Alegra (post-migración) | 121 | — |
| Sin factura (tránsito/margen) | 249 | — |
| Ya resueltos (NC del 3-sep) | 15 | — |
| **Duplicado completo** (Siigo y Alegra cubren todo) | **28** | $1.125.642 |
| **Duplicado parcial** (Siigo completa + Alegra parcial) | **13** | $328.176 |

Regla adoptada: **la factura de Siigo es la válida** (fue primero, es documento DIAN aceptado); la de
Alegra se anula con NC `VOID_ELECTRONIC_INVOICE` y **no se reemite nada**. Reemitir sería una tercera
factura. Excepción documentada: pack `2000018230210348` (Fork Catering, FE198) es una reemisión
deliberada — ver §6.

**Resultado de la regularización (9-sep-2026, 15:49–16:50):** 38 packs resueltos con
`scripts/regularizar_packs_parciales.py` — 13 duplicados (solo NC en Alegra: NC58–NC70) y 25
carritos facturados a medias (consolidada nueva + NC de la parcial + PDF reemplazado en MeLi:
FE203–FE228, NC71–NC95); más 2 consolidados a mano antes del script (FE200/FE201, NC56/NC57) y
FE197 duplicada anulada con NC55. Todo timbrado y aceptado por la DIAN. Log por caso:
`app/data/regularizacion_packs_log.jsonl`. Un caso (FE195, pack 2000014816067223, duplicado de
Siigo FV-2-71396) quedó fuera al principio por una NC manual sin timbre ("1", id 29, plantilla 2)
creada durante una prueba en la UI de Alegra; se eliminó esa NC (era borrable por no estar timbrada)
y el script la anuló con NC97. Lección: una NC creada en la UI con otra plantilla y sin enviar a la
DIAN "tapa" la factura en los cruces (aparece como anulada) sin anularla fiscalmente.

Cómo se cruza: id MeLi (pack u orden) dentro de `observations`/`purchase_order` de Siigo; en Alegra
`anotation`/`purchase_order` (orden, o pack_id si es consolidada). Para juntarlos hace falta el mapa
orden→pack de MeLi (`listar_ordenes_meli_por_estado` por **ventanas de 3 días** — ver §5.3).

## 4. Catálogo Siigo vs Alegra (9-sep-2026)

- Alegra: 537 ítems (532 activos). Siigo: 2.029 productos (1.796 activos), con familias `D-…`
  duplicadas (inactivas en Siigo, pero astroselling seguía facturando con ellas) y cientos de
  productos auto-creados por astroselling con códigos basura (`MCO…`, `AS-9`, `OILESN…`).
- De 578 SKUs facturados en Siigo jul–sep: 209 activos en Alegra, 152 existen con otro prefijo
  (`D-`→`C-`, sin problema), **217 sin ítem activo** (1.329 ventas). Listado completo para cruce por
  nombre: `docs/facturacion/skus_siigo_sin_alegra.md`.
- Reactivados el 9-sep (estaban inactivos sin gemelo activo y son de rotación): `C-AGUDES250mL`,
  `C-ACERIC250mL`, `C-BICSOD500g`, `C-MANCACREFKg`. Creados: `C-CREMON250g` (id 620),
  `C-VITCACIASC100g` (id 621).
- **No usar "eliminar" del panel de catálogo sobre un producto con facturas**: inactiva el ítem y
  rompe la anulación de todas sus facturas.

## 5. Herramientas

### 5.1 Panel Facturación → Ventas (`VentasAstroKillerPanel.tsx`)
- **Una fila = una venta (pack), no una orden.** `listar_ventas_meli_unificado` agrupa las órdenes
  hermanas en una sola fila (`ordenes_ids`), con el carrito completo en "Vendido en MeLi", el total
  que pagó el cliente y todas las facturas del pack. Antes cada producto del carrito era una fila
  con su propio total y el operador veía "1 producto, $65.700" para una venta de $103.944 (pack
  2000014944634019, 9-sep-2026). La búsqueda encuentra la fila por cualquier orden o por el pack.
- **En vivo / Histórico**: en vivo consulta MeLi (lento, tope 150 filas); histórico lee
  `app/data/facturacion_ventas_cache.db` (`facturacion_ventas_cache.py`), sin tope, con la fecha del
  último estado conocido y botón 🔄 por fila (`POST /api/facturacion/ventas-unificadas/refrescar/<id>`).
- **Solo pendientes**: filtra a `NEEDS_REVIEW` (parcial, sin facturar vencida, PDF sin subir, cancelada
  sin NC). Es el filtro con el que llega el checklist de Contabilidad (`cta=facturacion_ventas`).
- **Cruce comprado vs facturado** por pack en cada fila; **Facturar ahora** consolida el carrito y
  aborta si alguna orden ya está facturada, si MeLi ya tiene documento fiscal o si falta un SKU.
- Llegada con contexto: `useAppStore.ventasBoot = {busqueda | soloPendientes}` (desde un paso de
  ticket o desde Contabilidad → Inicio).

### 5.2 `scripts/regularizar_packs_parciales.py`
Simulación por defecto; emitir exige `--ejecutar --si-estoy-seguro --limite N`. Clasifica cada pack
multi-orden en: **A)** parcial real → emitir consolidada y luego anular la parcial; **B)** duplicado
(Siigo cubre el carrito) → solo anular Alegra; **C)** revisión humana (SKU faltante, orden ilegible,
Siigo parcial). Re-verifica contra Alegra justo antes de cada emisión, registra en
`app/data/regularizacion_packs_log.jsonl` (`ok` solo si realmente se resolvió) y consulta Siigo desde
`dias + MARGEN_DIAS_SIIGO` (la entrega llega días después de la compra).

### 5.3 Trampas de API aprendidas
- **Dos fechas de corte, no una.** `FECHA_CORTE_MIGRACION_ALEGRA = 2026-09-02` (arranque de Alegra) y
  `FECHA_ULTIMA_FACTURA_SIIGO = 2026-09-03` (última emisión de astroselling en Siigo).
  `obtener_facturas_hibridas` toma Siigo hasta la segunda y Alegra desde la primera; antes cortaba
  Siigo en la primera y 90 facturas de Siigo (2–3 sep) no existían para el índice legado ni el panel.
- `/orders/search` de MeLi **corta la paginación en silencio** y devuelve lo más reciente: dos corridas
  del mismo rango dieron 45 y 3 casos. Pedir por ventanas cortas (`_ordenes_paid_por_ventanas`).
- Alegra `/invoices` **ignora** `purchase_order`/`query`: no hay filtro server-side por venta.
- Alegra `identificationObject.number` = base del NIT, `dv` lo calcula Alegra.
- Alegra NC "sin referencia" (tipo DIAN 22) es para facturas **de Alegra** ya aceptadas; **no** sirve
  para anular una factura de Siigo. Siigo en solo lectura tampoco. → decisión contable, no técnica.

## 6. Decisiones abiertas (contador)
- **A71352 (Siigo, Fork Catering, NIT con DV errado)**: no se puede anular en Siigo (solo lectura) ni
  desde Alegra. Se emitió FE198 con el NIT correcto. Cómo cerrar A71352 (ajuste interno / reactivar
  Siigo puntualmente / carta al cliente) es decisión del contador. Hasta entonces FE198 está en
  `EXCLUIR_PACKS` del script.
- **Facturas Siigo de órdenes canceladas** (p. ej. FV-2-71049): el cron de NC ya no las intenta; quedan
  como `siigo_solo_lectura` en su estado y se reportan una vez.
- **217 SKUs** de Siigo sin ítem activo en Alegra: cruce por nombre con quien conozca el catálogo.

## 7. Tickets (Centro de Mando) — qué cambió el 9-sep
- Ticket diario "Sync facturas faltantes MeLi↔Alegra": **apagado** (`SYNC_TICKET_FALTANTES_ACTIVO=0`).
  Tenía un bug de dedupe (buscaba `tipo='accion'`, el ticket asignado se guarda como `solicitud`) y
  creaba uno nuevo cada día con 35→98 pasos repetidos; su categoría `sin_cruce` era "todo lo no
  facturado aún". Lo cubre Facturación → Ventas.
- "Notas crédito automáticas: error al emitir": ya no intenta Siigo (solo lectura) y **reutiliza** el
  ticket abierto (comentario por corrida) en vez de crear uno diario.
- Ticket "Revisión facturación MeLi": se cierra solo cuando todos sus pasos están completos
  (`cerrar_tickets_revision_completados`). Cada paso con id de venta tiene botón **"Abrir en
  Facturación ↗"** (no más copiar/pegar IDs).
- Checklist Contabilidad → Inicio: "Facturación MeLi pendiente" cuenta desde el histórico del panel
  y lleva a Facturación → Ventas con "Solo pendientes".

## 8. Estado operativo
- `MELI_AUTOFACTURA_ENTREGA_ACTIVO=0` (manual con botón, hasta validar catálogo y cierre del empalme).
- `webhook-meli` y `agente-pro` bajo systemd (un solo proceso cada uno). **Reiniciar tras cambiar
  código** de `app/tools/meli_autofactura_entrega.py` o `app/services/facturacion_ventas_unificado.py`.
