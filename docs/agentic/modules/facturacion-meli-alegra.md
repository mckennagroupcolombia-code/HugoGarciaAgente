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

## 9. Medio de pago DIAN y notificación FAZ09 (12-sep-2026)

Dos cosas distintas que se veían como "la factura FE357 falló":

**(a) FAZ09 — no falló nada.** Las 150 facturas emitidas hasta esa fecha quedaron
`STAMPED_AND_ACCEPTED_WITH_OBSERVATIONS` con la notificación *"Regla FAZ09: debe existir el
grupo de información de identificación del bien o servicio"*. Es una **notificación**, no un
rechazo: la factura tiene CUFE y es 100% válida. La causa: los 548 ítems de Alegra tenían
`productKey` (código UNSPSC) en `null`. Corregido con `scripts/alegra_codigos_unspsc.py`
(códigos a nivel segmento: 12000000 químicos, 24000000 envases, 50000000 alimentos,
51000000 farma, 78000000 fletes). Aplica de la siguiente emisión en adelante — el código
viaja en el XML, las ya emitidas no se pueden corregir.

Dos síntomas lo enmascaraban: el panel leía `stamp["status"]` (no existe; el campo es
`legalStatus`) y caía a `"closed"`, y los `warnings` de la DIAN no se propagaban a ningún
lado. Ambos arreglados: `crear_factura_venta_alegra` devuelve el `legalStatus` real y una
lista `avisos_dian`, que el reporte de WhatsApp muestra.

**(b) El medio de pago sí estaba mal.** `paymentMethod` era el literal `"CASH"` — efectivo
ante la DIAN — en todas las facturas, cuando el cobro es 100% digital: FE357 se pagó con
saldo de Mercado Pago (`account_money`), y en la web el reparto real es PSE 36, botón
Bancolombia 18, tarjetas 14, Efecty 4. Ahora sale de la pasarela:
`alegra.medio_pago_alegra()` / `medio_pago_meli_desde_orden()` traducen el identificador de
MeLi/Mercado Pago al catálogo DIAN v2.1, y los call-sites (MeLi, pedidos web, facturación
directa) pasan `medio_pago=`. Un medio desconocido cae a `CREDIT_TRANSFER`, **nunca** a
efectivo. `paymentForm` sí se queda en `CASH`: ahí significa "de contado", no "billetes".

Las facturas ya emitidas conservan el medio equivocado; corregirlo exigiría nota crédito +
reexpedición. Es decisión del contador si vale la pena (el medio de pago no altera bases ni
impuestos).

## 10. Revisión por venta en vez de ticket global (21-sep-2026)

**Por qué.** El panel decía «120 casos por revisar». Cruzados contra Alegra ese día:
- **94 «sin facturar»** → **85 ya tenían factura** (FE400–FE433 del 16-sep, FE556–FE571 del mismo
  21-sep…). El histórico es una foto: la venta se facturó después y nadie volvió a consultarla. Causas:
  «Facturar ahora» no actualizaba la fila; el refresco individual no guardaba las ventas en tránsito y
  solo cruzaba facturas por `order_id` (las del botón van contra el `pack_id`, distinto aunque el
  carrito tenga una sola orden); y el margen de 48h caía a la **fecha de creación del envío** si faltaba
  `date_delivered` (un pedido recién entregado aparecía vencido). Solo 9 estaban realmente sin factura.
- **24 «posible doble»** → reales: FV-2-713xx/714xx de astroselling en Siigo + FE de Alegra vigente
  (1–3 sep). Son los «duplicados completos» de packs de **una sola orden**: `regularizar_packs_parciales.py`
  salta los packs con menos de 2 órdenes (`if len(ords) < 2: continue`), así que nunca se anularon.
  Aparte, `posible_duplicado` contaba facturas de Alegra **ya anuladas** con NC → casos resueltos reaparecían.
- **2 «falta subir a MeLi»** (FE494, FE151).

**Qué cambió.**
- `posible_duplicado` solo si la factura de Alegra sigue vigente (sin NC), en listado, pack diferido y
  consulta individual.
- `_fecha_entrega_envio()`: `date_delivered` → `last_updated` → None (= en margen). Nunca `date_created`.
- `consultar_venta_individual`: facturas siempre a nivel pack; guarda también en tránsito; una cancelada
  con factura solo es «resuelta» si tiene NC (antes bastaba con que existiera la factura).
- «Facturar ahora» invalida los cachés y reconsulta la venta al terminar (devuelve `venta`).
- **Revalidación del histórico** (`revalidar_historial_en_segundo_plano`, `filas_para_revalidar`): las
  filas cuya foto envejece (accionables, en tránsito, en margen, dobles) se reconsultan en segundo plano
  al leer el histórico (como mucho cada 5 min, 60 filas) o con el botón «Revalidar pendientes»
  (`POST …/revalidar`). Precarga la base de Alegra una vez por corrida; sin LLM.
- **Revisado sin ticket**: `POST …/marcar-revisado` → tabla `revisiones_venta` del mismo SQLite;
  `revisado_map_facturacion()` junta esa tabla con los pasos de los tickets viejos. `anotar_filas()`
  pone `revisado` e `intervencion` **al servir** (no en la foto), así se ven al instante.
- **Pedir intervención** (`POST …/pedir-intervencion`, `revision_facturacion.pedir_intervencion`): en
  cualquier venta MeLi el operador elige a quién y el problema (incluido «error al facturar», que se
  precarga con el mensaje de Alegra). Crea UNA solicitud por venta, título
  `Intervención facturación MeLi · <pack_id> · <problema>`, con facturas, Siigo, cruce, productos y
  enlace a MeLi. Si ya hay una abierta para ese pack, agrega el mensaje como comentario. La fila
  muestra «TKT-… · con <nombre>» y deja de contar como «por revisar» (se cuenta aparte).
- Se quitó el botón «Generar ticket de revisión». El cron `revision_facturacion` ya **no** arma el
  ticket global ni pide sugerencias de IA: recalcula, revalida, cierra los globales viejos completos y
  manda un WhatsApp solo con casos **nuevos** sin revisar ni intervención (tabla `avisos_revision`).
  El endpoint `generar-ticket-revision` sigue vivo por compatibilidad, sin uso en el panel.

## 13. Cierre de mes: lo vendido en el mes se factura en el mes (27-sep-2026)

**Por qué.** Revisión de fin de septiembre: 21 ventas MeLi del mes seguían sin factura
(11 `sin_facturar`, 5 `en_margen_entrega`, 5 `en_transito` — las 21 ya estaban `shipped` como
mínimo, ninguna sin despachar). El flujo H de CLAUDE.md (facturar al entregar, margen de 48h)
es correcto el resto del mes, pero deja ventas de septiembre colgando para facturarse en
octubre si nadie interviene a mano — y el IVA/la renta del período tienen que cuadrar con lo
realmente vendido ESE mes, pedido explícito del usuario ("esto no aplica para cierre de mes").

**Regla implementada.** `app/services/conciliacion_meli.py::en_ventana_cierre_mes(fecha_venta)`:
activa en los últimos `FACTURACION_CIERRE_MES_DIAS` (default 3) días del mes de la venta, y
sin límite de tiempo después si el mes ya cerró y la venta sigue sin facturar (la "cola" no
vence sola). Dentro de esa ventana:
- Una venta entregada dentro del margen de 48h deja de esperar: pasa a facturable de una vez.
- Una venta ya **despachada** (`shipped`) también se puede facturar, sin esperar la confirmación
  `delivered` de MeLi — esto SÍ es una excepción real a la barrera dura que exige `delivered`
  antes de emitir (`app/tools/meli_autofactura_entrega.py::_bloqueo_por_envio`).
- Una venta que todavía NO se despachó (pending/handling/ready_to_ship) sigue bloqueada aunque
  sea cierre de mes: facturar algo que puede cancelarse antes de salir de bodega es justo el
  riesgo que el margen evita el resto del año — decisión explícita del usuario al alcance de
  esta regla (se le preguntó y prefirió NO forzar lo no despachado).

**Estado nuevo:** `sin_facturar_cierre_mes` (badge 🔴 en el panel, en `NEEDS_REVIEW` y
`FACTURABLE` de `VentasAstroKillerPanel.tsx`, con motivo propio en
`problema_de_venta()`/`ETIQUETA_PROBLEMA`). Reemplaza a `en_transito`/`en_margen_entrega`
únicamente dentro de la ventana de cierre — el disparo automático por webhook
(`procesar_entrega_meli_para_factura`, gateado por `MELI_AUTOFACTURA_ENTREGA_ACTIVO`) NO cambió:
sigue exigiendo `delivered` siempre, la excepción es solo para el botón manual "Facturar ahora".

Tests: `tests/test_facturacion_revision_por_venta.py`.

## 11. Doble emisión Alegra↔Alegra, reembolsos y bandeja de resolución (21-sep-2026, tarde)

**Incidente.** El 18 y 21-sep «Facturar ahora» emitió **22 facturas de más en 15 ventas ($1.724.532)**:
FE453/455, FE451/452, FE576/577, FE561/562, FE553/554, FE550/551, FE547-549, FE545/546, FE540/541,
FE538/539, FE534/535, FE532/533, FE525-527, **FE516-FE521 (6 en 24 s)**, FE479/480. Causa: la ruta de
carritos multi-orden (`facturar_pack_meli_manual`) no marcaba «en proceso»; sus barreras (estado local,
documento fiscal en MeLi) se escriben al TERMINAR y la emisión tarda 30-100 s, así que peticiones
simultáneas sobre la misma venta (reintentos tras el corte de Cloudflare, doble clic, dos pestañas)
pasaban todas. El panel no lo mostraba: solo detectaba el doble Siigo↔Alegra.

**Arreglos.**
- Candado por venta en `facturar_pack_meli_manual` (`_EN_CURSO`) + verificación DIRECTA en Alegra
  (`_facturas_alegra_existentes`, últimas 60 facturas por orden de compra/anotación/observaciones)
  justo antes de emitir. La lógica de emisión quedó en `_facturar_pack_meli_manual_sin_candado`.
- `_venta_no_cuadra`: no se factura si una orden está cancelada o MeLi reembolsó plata (reclamo /
  mediación): se explica y se pide intervención. Caso 2000018509202610: 2 unidades, mediación
  5579357205 (PDD9955) devolvió una; FE448 por una unidad es correcta.
- `construir_cruce_pack`: `reembolsado` (faltante explicado por reembolso = coincide con lo pagado),
  `equivalencias` (mismo producto con otro código: misma cantidad y monto ±2 %, p. ej.
  C-ACEESECORCED5mL → C-ACEESECORTCED5mL, que no está en `alegra_sku_alias_venta.json`) y
  `excedentes` (más unidades facturadas que vendidas). `_marcar_duplicado_alegra`: ≥2 facturas
  vigentes + excedentes = `duplicado_alegra` / `posible_duplicado`.
- `app/services/facturacion_resolucion.py`: `contexto_venta` (reporte «¿Por qué pasó?» con reclamos,
  reembolsos, cancelaciones, envío y hora de emisión de cada factura; tabla `contexto_venta`, se arma
  solo al revalidar ventas raras), `plan_anular_sobrantes`/`anular_sobrantes` (Siigo manda → anular las
  de Alegra; Alegra↔Alegra → se conserva la primera; reactivación temporal de ítems inactivos ante 9053;
  relee NC antes de emitir) y `subir_pdf_meli`.
- Endpoints `…/contexto/<id>` (GET guardado, POST rearma), `…/resolver/anular` (sin `confirmar` = plan;
  con `confirmar` = notas crédito DIAN), `…/resolver/subir-meli`.
- Panel: vista inicial **«Bandeja de resolución»** con pestañas Doble factura · Sin facturar · Factura
  incompleta · Sin subir a MeLi · Cancelada sin NC; en cada venta «¿Por qué pasó?», el botón que la
  resuelve, «Pedir intervención» y «Revisado». «Facturar seleccionadas» factura **de una en una** y se
  puede detener. «Todas las ventas» es la lista de antes.

**Causa de fondo (encontrada después): el panel reenviaba el POST.** `desktop/src/api/client.ts::request()`
reintentaba con el otro prefijo (`/app/api` ↔ `/api`) toda respuesta que no fuera JSON, **también en
POST**. El corte de Cloudflare a ~100 s (524) o un 502 durante un reinicio devuelven HTML: el panel
reenviaba la misma solicitud mientras la primera seguía emitiendo (por eso el log mezcla las dos rutas).
Sumado a eso, el botón usaba UNA variable `facturando`: facturar otra venta rehabilitaba el botón de la
primera. Y la ruta de carritos multi-orden (commit a2c15d0, 9-sep) nunca tuvo la marca «en proceso» que sí
tiene la de una sola orden. Corregido: el cliente solo reintenta con otro prefijo en GET/HEAD (y en
POST solo ante 404/405, que significan que la ruta no se alcanzó); ante 502/504/524 en un POST avisa
«pudo haberse completado, actualiza antes de reintentar»; `facturando` es un conjunto por venta.
Ese reintento afectaba a TODAS las operaciones POST/PUT/DELETE del panel (~400 llamadas).
Candado también en el navegador (`useCandadoFacturar` en `VentasAstroKillerPanel.tsx`): tras un clic, el
botón de ESA venta queda deshabilitado hasta que la ventana traiga datos nuevos después de terminar la
petición; si la conexión se cortó, además hay que esperar 2 min antes de que «Actualizar» lo libere
(el servidor puede seguir emitiendo). Aplica al botón de la lista, al de la bandeja y a «Facturar
seleccionadas».

## 12. Cierre del empalme y de la doble emisión (22-sep-2026)

Autorizado por Armando en la conversación, tras verificar por tercero en Siigo y Alegra:
- **21 NC por doble emisión Alegra↔Alegra** (NC98–NC118): se conservó la primera emitida, que es
  además la que MeLi tiene como documento fiscal (verificado leyendo el PDF de cada pack).
- **26 NC por el empalme Siigo↔Alegra** (NC119–NC144): se conservó la FV de Siigo (astroselling).
  Antes de cada una se comprobó que la FV exista, referencie el pack y no tenga NC en Siigo.
  **FE16 NO se anuló**: su FV-2-71386 ya estaba anulada en Siigo con NC-2-840, así que la válida es FE16.
  FE10 (marcada «falso positivo» el 5-sep) sí era doble real: FV-2-71399 referencia el pack.
- En 12 de esas 26 ventas MeLi mostraba el PDF de la FE ya anulada: se reemplazó por el PDF de la FV
  de Siigo (`eliminar_documentos_fiscales_meli` + `subir_factura_meli`, mismo método del 9-sep).
- Log de todo en `app/data/regularizacion_packs_log.jsonl` (tipos `doble_*_22sep`, `meli_pdf_reemplazado_22sep`).
- Resultado verificado en Alegra: 0 ventas con más de una factura vigente.

**Hallazgo colateral — contacto «Consumidor Final» sobrescrito.** Las 26 NC del empalme fallaron al
principio con Alegra 9228 («el tipo de identificación del cliente es distinto al que tenía al hacer el
documento»): `_resolver_o_crear_contacto_alegra` actualizaba el contacto encontrado por identificación
con el nombre y tipo del comprador, y dos ventas con el NIT genérico 222222222222 lo renombraron
(FE308 «Diana Orozco» NIT, FE486 «Jaiver Quintero pinzon» NIT). Corregido: el contacto genérico nunca
se modifica (siempre «Consumidor Final», CC). Se restauró el contacto id 1 en Alegra. FE308 y FE486
quedaron con ese nombre en su foto (no se tocan). Test: `test_contacto_consumidor_final_no_se_sobrescribe`.

Con esto queda cerrado el empalme de la migración (§3-§6): no quedan facturas duplicadas vigentes.
Sigue abierto solo A71352 (Fork Catering, §6), que es decisión del contador.

**«Facturar ahora» en segundo plano (22-sep-2026).** Aun sin duplicar, la emisión tardaba 32-211 s y
Cloudflare corta a los 100 s: la persona veía «HTTP 504» aunque la factura sí salía (25 facturas
FE584–FE608 emitidas después del candado, 0 duplicadas). Ahora `POST …/facturar-ahora` responde 202 al
instante y lanza un hilo (`_correr_facturacion` en routes.py); el panel (`facturarYEsperar`) consulta
`GET …/facturar-ahora/estado/<order_id>` cada 4 s. Un segundo POST mientras corre devuelve el mismo
trabajo. Si el agente se reinicia a mitad, el estado responde `desconocido` y el panel pide revisar la
venta antes de reintentar (el candado del servidor y la verificación en Alegra siguen activos).

**Falso «Falta subir a MeLi» y 504 en 🔄 (22-sep-2026).** `meli_pack_tiene_documento_fiscal` devuelve
False ante cualquier error/timeout de MeLi: justo después de subir el PDF de FE608 (pack
2000014940327035) el panel mostró «Falta subir» con el PDF ya en MeLi. Ahora el estado usa
`meli.meli_documento_fiscal_estado` (True/False/None, con reintento) y solo marca
`facturada_pendiente_subir_meli` si MeLi CONFIRMA que no hay documento; la revalidación sube el PDF sola
en ese caso (factura única vigente, sin Siigo; MeLi rechaza con 409 si ya hay uno). La consulta
puntual ya no baja toda la base de Alegra dentro de la petición: usa una base de hasta 6 h + las 60
facturas y 30 NC más recientes, y la renueva en segundo plano; `calentar_base_alegra()` la prepara al
arrancar y cada 30 min (agente_pro.py), y `_facturas_alegra_cacheadas` es de una sola descarga a la vez.
🔄 sobre 2000018361505814: 90 s → 42 s. «Subir PDF» y «Anular» actualizan la fila en segundo plano.

## 14. Falsos «sin facturar», canceladas cubiertas por MeLi y cron de 48 h (5-oct-2026)

**Falso «sin facturar» (pack 2000015048323195, FE451 vigente).** `obtener_facturas_alegra_paginadas`
cortaba en silencio si una página fallaba (timeout/429) y `_facturas_alegra_cacheadas` guardaba esa lista
PARCIAL como base hasta 6 h; la consulta puntual solo le suma las 60 más recientes. Toda factura del hueco
(FE451, del 18-sep) desaparecía y la venta quedaba «sin facturar» en el histórico (117 filas así). Además,
`consultar_venta_individual` seguía con lista vacía si Alegra fallaba y guardaba la fila. Ahora: descarga
**estricta** (facturas y NC), si falla o trae menos facturas que la base anterior se conserva la anterior,
y sin base no se calcula ni se guarda nada. ⚠️ `_facturas_alegra_existentes` (barrera de «Facturar ahora»)
solo mira las últimas 60 facturas: con una fila falsa, el botón podía emitir un doble de una venta vieja
(la protegían el estado local y el documento fiscal de MeLi).

**Canceladas: solo se anula si nos quitaron la plata.** En `payments[]` de la orden:
`status_detail = bpp_covered` = la devolución la pagó el programa de protección de MeLi (refund con
`source.type = bpp`, comisiones NO devueltas, el neto se nos liberó) → la venta se cobró y la factura se
queda. `refunded` / `bpp_refunded` = nos descontaron → NC. `emitir_notas_credito_cron.py` lo aplica
(`_reembolso_descontado`): `cubierto_por_meli` / `sin_reembolso` no anulan; reembolso o cancelación
parcial del carrito → `reembolso_parcial`, decisión humana; toma la factura VIGENTE del pack (no la primera).
El motor RA (`anulaciones_motor.clasificar`) marca `financia=meli` con `bpp_covered` (→ manual).
Caso: FE797 (pack 2000015065607043) anulada con NC147 el 3-oct aunque estaba `bpp_covered`.

**Cron 48 h** (`scripts/facturar_entregadas_cron.py`, 9:05/13:05/17:05, job `facturar_entregadas_48h`):
ventas MeLi pagadas (ventanas de 3 días), sin factura vigente en la base completa de Alegra, con estado
`sin_facturar` (entregada hace >48 h) → `facturar_pack_meli_manual` (mismas barreras que el botón).
Tope 20/corrida, `--simular`, `FACTURACION_ENTREGADAS_CRON_ACTIVO=0` lo apaga. El webhook
(`MELI_AUTOFACTURA_ENTREGA_ACTIVO`) sigue apagado.

---

## Traído de CLAUDE.md (27-sep-2026)

> Texto movido tal cual al comprimir CLAUDE.md; allí queda un resumen con enlace aquí.

### F. Sincronización de Facturas MeLi ↔ Siigo

```
sincronizar_inteligente():
  ├─ Busca órdenes MeLi pagadas sin documento fiscal
  ├─ Busca facturas Siigo del mismo período
  ├─ Cruza por Pack ID (en observations/purchase_order de Siigo)
  └─ Por cada match:
       ├─ descargar_factura_pdf_siigo(factura_id) → base64
       └─ subir_factura_meli(pack_id, pdf_b64) → POST /packs/{id}/fiscal_documents

sincronizar_facturas_recientes(dias=1):
  ├─ obtener_facturas_siigo_paginadas(fecha_desde)
  └─ Para cada factura con Pack ID → upload a MeLi
```

Este flujo asume que la factura **ya existe en Siigo** (creada manualmente) y solo la cruza/sube a MeLi. Para creación automática desde cero ver Flujo G.

### G. Autofactura MeLi al entregarse el pedido

```
MeLi → POST /notifications (puerto 8080)
  └─ topic: "shipments"
  └─ hilo: procesar_entrega_meli_para_factura(shipping_id)   # app/tools/meli_autofactura_entrega.py
       ├─ GET /shipments/{id} → si status != "delivered", ignora
       ├─ order_id desde el shipment; dedup por order_id en app/data/meli_facturas_entrega.json
       ├─ GET /orders/{order_id} → arma líneas (SKU vía seller_custom_field + buscar_producto_alegra_por_referencia)
       ├─ Comprador: GET /orders/{order_id}/billing_info (consultar_billing_info_meli) → nombre/razón
       │    social, doc_type/doc_number REALES si el comprador los cargó en MeLi (confirmado en vivo
       │    2026-09-04 contra MCO — `orders/{id}.buyer` y `shipments/{id}.receiver_address` NO los
       │    traen, pero este endpoint sí; es lo que resolvía Astroselling). Solo cae a "Consumidor
       │    Final" con NIT genérico (SIIGO_MELI_NIT_CONSUMIDOR_FINAL, default 222222222222) si
       │    billing_info da 404/403 o viene sin doc_number/nombre usable.
       └─ crear_factura_venta_alegra(...) → reporta éxito/error a GRUPO_FACTURACION_VENTAS_WA
```

**Gateado por `MELI_AUTOFACTURA_ENTREGA_ACTIVO`** (default `0` = modo sombra): mientras esté en 0,
calcula y registra en `app/data/meli_facturas_entrega.json` qué se habría facturado (sin llamar a
Siigo/DIAN). Cambiar a `1` solo tras confirmar con tráfico real que el tópico `shipments` llega al
webhook — precedente: en abril/2026 se asumió que `questions`/`orders_v2`/`messages` ya estaban
suscritos en la app de MeLi y no era cierto, dejando preventa/posventa rotas en silencio semanas.
Requiere habilitar el tópico `shipments` en developers.mercadolibre.com para la app.

**Estado desde el 2026-09-09: apagado (`=0`) a propósito.** Estuvo en `1` del 4 al 9 de sep y produjo
(a) packs multi-producto facturados a medias — el webhook corría con código anterior al fix
multi-orden porque nunca se reinició — y (b) 41 packs facturados dos veces, porque astroselling
seguía facturando en Siigo al comprar mientras Alegra facturaba al entregar. Hoy se factura **a mano
con el botón "Facturar ahora"** de Facturación → Ventas, que emite **una sola factura por carrito**
(`facturar_pack_meli_manual`) y aborta si el pack ya tiene factura o documento fiscal en MeLi. Antes
de volver a encender el automático: cerrar la regularización y sanear el catálogo. Ficha completa,
cronología y decisiones abiertas: `docs/agentic/modules/facturacion-meli-alegra.md`.

### H. Facturación al momento de ENTREGA (política general, no solo MeLi) + nota crédito

Principio de negocio (reemplaza "facturar al vender"): facturar en el momento de la **entrega**
reduce cuántas facturas terminan necesitando nota crédito por arrepentimiento del cliente entre
la compra y la entrega. MeLi ya lo hace vía Flujo G (evento `shipments`/`delivered`). Pedidos web
lo hace por comando explícito porque **no existe señal automática de entrega para web** (el
tracking de Interrapidísimo solo llega hasta `shipping_status=shipped`):

```
Grupo GRUPO_PEDIDOS_WEB_WA → "entregado 250" (o "entregado MCKG-…")
  └─ app/routes.py → wp.registrar_entrega_y_facturar(ref)   # app/tools/web_pedidos.py
       ├─ UPDATE orders SET shipping_status='delivered', delivered_at=...
       └─ emitir_factura_siigo_pedido_web(ref, force=True)   # mismo dedup que "facturar"
```

`facturar <ref>` sigue existiendo como override manual (casos donde el cliente necesita la
factura antes de la entrega, p. ej. clientes corporativos) — pero el flujo estándar para venta
al detal es esperar a `entregado`.

**Nota crédito — ticket al operador para casos puntuales (web / reclamos), cron automático para
cancelaciones MeLi "normales":** cuando `anular_pedido_web()` detecta que el pedido ya tenía
factura Siigo emitida, en vez de solo advertir en el texto de WhatsApp, crea un ticket en el
Centro de Mando vía `app/tools/notas_credito.py::crear_ticket_nota_credito()` (categoría
`contabilidad`, prioridad alta, asignado al aliado configurado para
`TAREA_RECLAMO_MELI_ANULAR_FACTURA` en `tickets_db`). Es la generalización del patrón que ya
existía solo para reclamos de MeLi (`app/meli_reclamos.py::crear_accion_anular_factura_por_reclamo`).

Para el caso más frecuente — una orden MeLi se cancela (sin ser reclamo) después de que la
factura ya se emitió automáticamente vía la integración externa (astroselling.com) — el ticket
manual dejó de trabajarse silenciosamente 6 semanas (26-jun a 10-ago-2026, 44 casos, $2.1M COP)
sin que nadie lo notara. Por eso existe **`scripts/emitir_notas_credito_cron.py`** (diario,
frecuencia real vía Sistemas → Tareas Programadas): cruza órdenes MeLi canceladas
(`app/services/meli.py::listar_ordenes_canceladas_meli`) contra facturas Siigo por Pack ID
(mismo cruce por `observations`/`purchase_order` que Flujo F) y emite automáticamente la nota
crédito (`app/services/siigo.py::crear_nota_credito_siigo`, `reason=2` "anulación de factura
electrónica") si aún no existe una. Solo procesa cancelaciones con más de
`NOTAS_CREDITO_MARGEN_HORAS` (default 48h) de antigüedad, y vuelve a chequear
(`buscar_nota_credito_existente_siigo`) justo antes de cada emisión — la corrida manual del
10-ago-2026 generó **4 notas crédito duplicadas** exactamente por no tener ese segundo chequeo,
mientras contabilidad resolvía esos mismos casos a mano en paralelo. Reporta por WhatsApp a
`GRUPO_FACTURACION_VENTAS_WA` solo cuando emite algo o encuentra un error real (no cuando el
caso ya estaba resuelto por otra vía — eso es el camino normal, no una anomalía). Apagar con
`NOTAS_CREDITO_CRON_ACTIVO=0` sin tocar el crontab.

**Pendiente (paso separado, no implementado aún):** aplicar el mismo principio de "facturar al
entregar" a ventas por WhatsApp — hoy `crear_factura_completa_siigo` lo dispara Claude vía
tool-use en cuanto se confirma el pago (`ok <3dígitos>`), no al entregar. Cambiarlo requiere
tocar el prompt/herramientas de `app/core.py`, que afecta el comportamiento del agente en *toda*
conversación de WhatsApp — se trata aparte, con su propia revisión.
