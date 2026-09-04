# Critical API Contracts

Contratos de alto nivel para no romper panel, WhatsApp ni MercadoLibre. Si cambia request/response, actualizar este archivo y la ficha de modulo.

## Auth

| Superficie | Auth | Regla |
| --- | --- | --- |
| `/chat` | Bearer `CHAT_API_TOKEN` | Rechazar 401 si token no coincide |
| `/api/preventa/*` | Bearer `CHAT_API_TOKEN` | Usado por login/panel |
| `/api/sync/*` | Bearer `CHAT_API_TOKEN` | Responde rapido; trabajo en hilo |
| `/api/panel/logs` | Bearer `CHAT_API_TOKEN` | GET/DELETE |
| `/api/5s/*` | Bearer `CHAT_API_TOKEN` | Tambien puede existir prefijo `/app/api/5s/*` |
| `/api/git/log` | Bearer `CHAT_API_TOKEN` o JWT tickets | GET, solo lectura |
| `/api/team-recaps` | Bearer `CHAT_API_TOKEN` o JWT tickets | GET, solo lectura |
| `/whatsapp` | Sin Bearer | Confia en bridge/red interna |
| `/notifications` | Sin Bearer | Webhook MeLi; responder 200 rapido |

## Control de Versiones (panel Sistemas)

`GET /api/git/log?limit=200` — historial de commits (todas las ramas locales, `git log --all --topo-order`) para el grafo tipo cladograma. Sin diffs ni lista de archivos por commit (evita `git show` por request).

Response:

```json
{
  "rama_actual": "cursor/wa-metricas-panel",
  "commits": [
    {
      "hash": "59c9607...",
      "hash_corto": "59c9607",
      "parents": ["1055057..."],
      "autor": "McKenna Group Colombia",
      "email": "mckennagroupcolombia-code@github.com",
      "fecha": "2026-08-04T00:00:00-05:00",
      "asunto": "Reorganiza sidebar del panel...",
      "refs": ["HEAD -> cursor/wa-metricas-panel", "origin/cursor/wa-metricas-panel"]
    }
  ]
}
```

`GET /api/team-recaps` — lee y parsea `docs/team-recaps.md` via `app/tools/team_recaps.py::obtener_team_recaps()` (plantilla en `docs/agentic/TEAM_WORKFLOW.md`), mas reciente primero (orden del archivo). Parseo best-effort: un bloque mal formado no rompe el resto.

Response:

```json
{
  "recaps": [
    {
      "fecha": "2026-08-04 16:00",
      "titulo": "Metodologia de recaps + panel visual de Control de Versiones",
      "autor": "Armando García",
      "tipo_cambio": "Nueva funcionalidad",
      "que_se_implemento": ["...", "..."],
      "archivos_modificados": "..."
    }
  ]
}
```

Sin endpoint de escritura: el recap lo agrega el agente de IA directamente al archivo como parte del protocolo de commit (no hay mutacion desde la UI).

## MercadoLibre Webhook

Endpoint productivo: `POST /notifications` en `webhook_meli.py` puerto 8080.

Request minimo:

```json
{
  "topic": "questions|orders_v2|messages|marketplace_questions|marketplace_messages",
  "resource": "/questions/123"
}
```

Despacho esperado:

| Topic | Resource | Tipo interno |
| --- | --- | --- |
| `questions`, `marketplace_questions` | `/questions/{question_id}` | `preventa` |
| `orders_v2` | `/orders/{order_id}` | `orden` |
| `messages`, `marketplace_messages`, `messages_*` | `/messages/...` | `postventa` |
| `messages` con `actions` sin `created` | cualquiera | `postventa_omitir_lectura` |

Response siempre rapido:

```json
{"status": "ok"}
```

## WhatsApp Bridge

Endpoint: `POST /whatsapp` en Flask 8081.

Payload esperado del bridge puede incluir:

```json
{
  "from": "573001112233@c.us",
  "body": "texto",
  "remoteJid": "120363...@g.us",
  "isGroup": true
}
```

Comandos criticos:

| Comando | Destino | Efecto |
| --- | --- | --- |
| `resp <sufijo>: <respuesta>` | Grupo preventa | Responde pregunta MeLi pendiente |
| `posventa <codigo>: <respuesta>` | Grupo postventa | Responde mensaje postventa MeLi |
| `ok <3dig>` / `no <3dig>` | Grupo pagos | Confirma/rechaza comprobante |
| `facturar <token>` | Grupo pedidos web | Facturacion pedido web |

## Chat

Endpoint: `POST /chat`.

Request:

```json
{
  "mensaje": "texto",
  "session_id": "opcional",
  "usuario_id": "opcional",
  "adjuntos": [
    {"media_type": "image/png", "data_base64": "..."}
  ]
}
```

Adjuntos soportados: `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `application/pdf`.

Response:

```json
{
  "respuesta": "texto",
  "timestamp": "ISO-8601",
  "status": "ok"
}
```

## Panel Operaciones

Endpoints usados por React:

| Ruta | Metodo | Request | Response estable |
| --- | --- | --- | --- |
| `/api/status` | GET | - | `estado`, `servicios`, `version` |
| `/api/metricas` | GET | - | metricas del dia + token MeLi |
| `/api/inicio/dolar-hora` | GET | query `force=1?` | Gadget Inicio: TRM BanRep (tasa de hoy); gráfico TradingView en panel; `{valor, cambio_pct, serie_hora:[], serie_dia, trm_oficial}` |
| `/api/preventa/pendientes` | GET | - | `preguntas`, `total` |
| `/api/preventa/casos` | GET | - | casos recientes |
| `/api/preventa/metricas` | GET | `dias` (7–90, default 30), `refresh=1` opcional | conversión pregunta→compra: `resumen.tasa_compra_pct`, `por_respuesta`, `por_producto`, `conversion_explicacion`. Cache ~15 min. |
| `/api/responder-preventa` | POST | `question_id`, `respuesta` | `ok` o error |
| `/api/postventa/pendientes` | GET | - | `mensajes`, `total` — cada mensaje puede incluir `tipo_solicitud`, `tipo_solicitud_label`, `espera_min` |
| `/api/postventa/historial/<pack_id>` | GET | - | `historial` |
| `/api/responder-postventa` | POST | `codigo`, `respuesta` | `ok` o error |
| `/api/postventa/omitir` | POST | `codigo` (o `pack_id`) | `ok`, `omitido` — saca de cola sin responder MeLi; corta recordatorios WA |
| `/api/postventa/estadisticas` | GET | `dias` (7/30/90, default 30; 0 = todo) | `cola`, `tiempos` (mediana/SLA/vía), `solicitudes` (motivos frecuentes), `reclamos.motivos` — SQLite `app/data/postventa_stats.db`; MeLi claims best-effort cache 30 min |
| `/api/sync/hoy` | POST | - | `status: iniciado` |
| `/api/sync/10dias` | POST | - | `status: iniciado` |
| `/api/sync/completo` | POST | - | `status: iniciado` |
| `/api/sync/inteligente` | POST | - | `status: iniciado` |
| `/api/sync/pack` | POST | `pack_id` | `status: iniciado` |
| `/api/sync/fecha` | POST | `fecha` `YYYY-MM-DD` | `status: iniciado` |
| `/api/sync/stock` | POST | - | `status: iniciado` |
| `/api/sync/aprendizaje` | POST | - | `status: iniciado` |
| `/api/sync/gmail` | POST | opcional `nit` | `status: iniciado` |
| `/api/consultar/producto?nombre=` | GET | query `nombre` | `status`, `resultado` |
| `/api/stock/resumen` | GET | - | `items`, `total` (stock MeLi en vivo; omite closed/inactive) |
| `/api/inventario-control/resumen` | GET | `refresh=1` opcional | Snapshot SWR: `items`, `total`, `cargando`, `stale`, `desde_cache`, `error?`. Sin `refresh` no espera el barrido vivo de MeLi. Prefijo `/app/api/...` también. |
| `/api/inventario-control/revisar` | POST | `meli_id` | Marca revisión manual |
| `/api/inventario-control/proveedor` | POST | `sku`, `proveedor?`, `notas?` | Anota proveedor por SKU |
| `/api/inventario-control/config` | GET/POST | `umbral_bajo_stock`, `umbral_divergencia_siigo` | POST exige admin si hay sesión de tickets |
| `/api/inventario-control/solicitar-compra` | POST | `sku` o `meli_id` | Ticket de compra (no muta MeLi/Siigo) |
| `/api/inventario-control/flag-eliminar` | POST | `sku` o `meli_id` | Ticket de baja de publicación |
| `/api/stock/ventas-30d` | GET | `dias?` (default 30), `refresh?` | `por_item[meli_id]{unidades,ordenes,monto,ritmo_diario,nivel}`, `ordenes`, caché ~30 min |
| `/api/stock/relacion-codigos` | GET | `buscar`, `filtro` (`todos`\|`vinculados`\|`sin_siigo`\|`divergentes`\|`sin_codigo`\|`sin_c`), `refresh` | `items` (meli_id, sku_meli, codigo_siigo, estado), `totales` (incluye `sin_c`: sin prefijo combo `C-`) |
| `/api/stock/relacion-codigos/vincular` | POST | `codigo_siigo`, `meli_id` | override Siigo→MeLi (`ok`, `en_siigo`) |
| `/api/stock/relacion-codigos/editar` | POST | `meli_id`, `sku_meli?`, `codigo_siigo?`, `vincular_si_sku?` | Actualiza SKU en MeLi (`SELLER_SKU`) y/o vínculo Siigo; al menos un campo de código |
| `/api/publicaciones` | GET | `buscar`, `categoria`, `canal` (`todos`\|`ambos`\|`falta_web`\|`sin_meli`\|`no_en_tienda`) | `items`, `resumen` (conteos estables), `categorias` |
| `/api/publicaciones/<sku>` | GET | `live_meli=1` opcional | Detalle + `vista_sitios` `{web, meli, presentaciones}` (cómo se ve en tienda vs listing) |
| `/api/publicaciones/<sku>/estado-meli` | POST | `estado`: `active`\|`paused` | Pausa/activa la publicación MeLi vinculada |
| `/api/publicaciones/<sku>/imagenes/desde-galeria` | POST | `filenames[]` (catálogo), `recursos[]` (Studio), `targets` (`web` y/o `meli`), `meli_item_id?` | Copia fotos ya existentes de la galería al sitio; no borra el origen |
| `/api/publicaciones/imagenes/desenfoque/preview` | POST | `modo` (`pie`\|`regiones`), `pie_pct?` (default 0.15), `regiones?` `[{x,y,w,h}]` 0–1, `radio?` (default 28), fuente: `url` o `meli_item_id`+`picture_id` o multipart `file` | Preview sin escribir: `{ok, preview_base64, meta}` |
| `/api/publicaciones/imagenes/desenfoque/aplicar` | POST | `items[{sku?, meli_item_id, picture_ids?: "principal"\|"todas"\|ids}]` o individual `meli_item_id`+`picture_id`; mismos params de modo | Blur → CDN → reemplaza picture en listing; lote en serie. `{ok, resultados[]}` |
| `/api/fichas/biblioteca/cargar-web` | POST | - | Publica **solo** documentos completos (FT+COA+SDS diligenciados + PDF) en la tienda. `{ok, total, con_coa, con_sds, titulos, omitidos_incompletos, omitidos_titulos, sitio}`. También `/app/api/...`. |
| `/api/fichas/coa/escanear-parametros` | POST | multipart `imagen` (1..8) + `catalogo?` | Arranca análisis Gemini en hilo. `202` `{ok, status: pending, job_id, imagenes}`. También `/app/api/...`. |
| `/api/fichas/coa/escanear-parametros/<job_id>` | GET | — | `{status: pending, progreso}` / `{status: done, parametros, campos, imagenes_procesadas, …}` / `{status: error, error}` (JSON 200). Job en memoria ~10 min. |
| `/api/fichas/ft/escanear-imagen` | POST | multipart `imagen` (1..8) | Arranca análisis Gemini en hilo. `202` `{ok, status: pending, job_id, imagenes}`. También `/app/api/...`. |
| `/api/fichas/ft/escanear-imagen/<job_id>` | GET | — | `{status: pending, progreso}` / `{status: done, campos}` / `{status: error, error}` (JSON 200). |

También existen bajo `/app/api/publicaciones*`. La tienda web **solo muestra SKUs con `meli_id` MCO**; `oculto_web` los deja en vitrina sin compra.

## Centro de Mando — cierre de solicitudes

`PUT /api/tickets/<id>/estado` con `{"estado": "resuelto"}` **puede devolver el ticket en
`esperando_aprobacion`**: una solicitud delegada la cierra quien la pidió, no quien la ejecutó
(`tickets_db._requiere_aprobacion_del_solicitante`). Todo cliente debe leer el estado de la
respuesta en vez de asumir `resuelto`.

Cierran directo (sin revisión): acciones, solicitudes auto-asignadas, las creadas por
`hugo_ia_bot` o por un usuario inactivo (nadie podría aprobarlas), las intervenciones y compras
con `ticket_padre_id` (su cierre desbloquea al padre) y los subtipos `compra` / `etiqueta`, cuyo
checklist ya debe quedar completo.

### Trabajo en paralelo

Un usuario puede tener **varias acciones `en_proceso` y varias solicitudes en resolución al
mismo tiempo**. Hasta ago-2026 `crear_ticket` y `cambiar_estado` devolvían
*"Ya tienes en curso … termínala o pausa antes de iniciar otra"* al intentar una segunda
acción; ese gate se retiró. Cada labor lleva su propia corrida en `ticket_corridas`, así que
los cronómetros corren en paralelo sin mezclar tiempos. `acciones_en_proceso_de(usuario_id)`
devuelve la lista completa (informativa); `usuario_tiene_accion_en_proceso` sigue existiendo
solo para silenciar recordatorios push mientras el operador trabaja.

### Pausar una solicitud para pedir una aclaración

`POST /api/tickets/<id>/pedir-intervencion` — body `titulo` (la pregunta), `asignado_a`,
`descripcion?`, `paso_id?`, **`subtipo?`**. Con `subtipo="pregunta"` y `asignado_a` = quien creó
la solicitud, es el caso "necesito que me aclaren algo para poder resolver":

- crea el sub-ticket (tipo `solicitud`, `ticket_padre_id` = el padre) y deja el padre en
  `pendiente` con `bloqueado_por` = sub-ticket (pausa: no se puede terminar mientras tanto);
- deja la pregunta como comentario en el hilo del padre (queda en el reporte);
- **envía WhatsApp al destinatario** vía `tickets_notificaciones.notificar_intervencion_solicitada`
  ("necesita tu respuesta… la solicitud quedó en pausa"). Antes de ago-2026 esta ruta no
  notificaba a nadie: el sub-ticket aparecía en el panel del otro usuario sin aviso.

Al resolver el sub-ticket, `cambiar_estado` copia la respuesta al hilo del padre, lo desbloquea
(`en_proceso`) y avisa por WhatsApp a quien preguntó. Rechaza pedir intervención a uno mismo o
sobre una solicitud ya pausada. `GET /api/tickets/<id>` y el listado exponen
`bloqueado_por_subtipo` / `bloqueado_por_asignado_nombre` para pintar "esperando respuesta de X".

## Empaque / evidencia fotográfica (panel Atención)

Auth: Bearer `CHAT_API_TOKEN` **o** JWT de tickets (operarios con permiso `empaque`).

| Ruta | Método | Entrada | Salida |
| --- | --- | --- | --- |
| `/api/empaque/ventas` | GET | `dias?`, `canal?` (`meli`\|`web`\|`whatsapp`), `q?`, `solo_sin_evidencia?` | `ventas[]` unificadas + `resumen` + `errores` |
| `/api/empaque/ventas/<canal>/<id>/evidencias` | GET | — | `{ evidencias: [...] }` |
| `/api/empaque/ventas/<canal>/<id>/evidencias` | POST | multipart `foto` (+ `nota?`) | `{ ok, evidencia }` |
| `/api/empaque/evidencias/<id>` | DELETE | — | `{ ok, message }` |
| `/api/empaque/whatsapp` | POST | JSON `cliente`, `telefono?`, `productos?`, `total?` | `{ ok, venta }` |
| `/api/empaque/uploads/<archivo>` | GET | Bearer o `?token=` | imagen |

Persistencia: `app/data/empaque_evidencia.db` + fotos en `app/data/empaque_uploads/`.
Panel React: id `empaque` (hub Atención). Permiso `permisos_secciones.empaque`.
| `/api/panel/logs` | GET/DELETE | query `limit` | `lines` / `ok` |
| `/api/siigo/productos` | POST | `codigo`, `nombre`, `unidad?`, `precio_costo?`, `precio_venta?`, `iva?` | Crea producto en **Alegra** (ruta `/api/siigo/*` se mantiene por compatibilidad); `{ok, mensaje\|error, siigo_producto?}` |
| `/api/siigo/productos/buscar` | GET | query `q`, `limit?`, `excluir_combos?` | Búsqueda viva Alegra; `{items[{codigo,nombre,type}], total}` |
| `/api/siigo/combos` | POST | `codigo`, `nombre`, `componentes[{code,quantity}]`, `precio_lista?`, `iva?` | Crea kit en Alegra; requiere ≥1 componente existente |
| `/api/siigo/centros-costo` | GET | — | Centros de costo Alegra `{centros[{id,code,name,active}]}` |

También existen prefijos `/app/api/siigo/productos` y `/app/api/siigo/combos` para mutaciones bajo el SPA.

## Rentabilidad / compras exterior

Prefijos: `/api/rentabilidad/*` y `/app/api/rentabilidad/*` (mutaciones multipart).

| Endpoint | Metodo | Body | Notas |
| --- | --- | --- | --- |
| `/api/rentabilidad/componentes` | GET/POST | POST: `nombre`, `costo_unitario`, `categoria?`, `iva_incluido?` | Upsert costo manual + sync Alegra |
| `/api/rentabilidad/componentes-buscar` | GET | query `q` (SKU o nombre), `limit?` | Busca en vivo Alegra + caché; hasta 80 `{codigo,nombre}` |
| `/api/rentabilidad/trm` | GET | query `fecha=YYYY-MM-DD` | TRM BanRep (datos.gov.co) USD→COP para esa fecha |
| `/api/rentabilidad/extraer-compra-imagen` | POST | multipart `imagenes` (1..N) o `imagen`, opcional `fecha_compra`, `trm`, `flete` | Gemini Vision multi-imagen → lineas + landed + `numero_pedido`/`referencia` (Order ID / Invoice No del documento); USD sin TRM → BanRep |
| `/api/tickets/extraer-lista-compras` | POST | multipart `imagen` o `archivo`, `modo=compra|etiqueta` (auth tickets) | OCR → `{items:[{nombre,cantidad,unidad}]}`; etiquetas: presentación en nombre + `unidad=u` |
| `/api/rentabilidad/confirmar-compra-exterior` | POST | multipart: `items`, `moneda`, `fecha_compra`, `numero_pedido?`, `trm`, `imagenes` (N), `borrador_id?`, `compra_id?`, `soportes_indices?`, `emisor_usuario_id?` | Upsert costos + historial (persiste Order ID del documento); deja cuenta de cobro pendiente; `emisor_usuario_id` asigna a nombre de quién se emitirá el PDF |
| `/api/rentabilidad/compras-exterior` | GET | `limit?` | Historial `{compras[]}` (incluye `numero_pedido` del invoice, `cuota_manejo_cop`, `cuenta_cobro_url`) |
| `/api/rentabilidad/compras-exterior/<id>` | GET/DELETE | - | Detalle o eliminar compra (+ soportes + PDF cobro) |
| `/api/rentabilidad/compras-exterior/<id>/soporte` | GET | - | Imagen/PDF del pantallazo |
| `/api/rentabilidad/compras-exterior/<id>/cuenta-cobro` | GET/POST | POST body `{ accent_rgb, tipo?, cuota_pct?, emisor_usuario_id? }` | GET: PDF aprobado; POST: aprueba y genera PDF. Encabezado/concepto usan `numero_pedido` del documento (Order ID / Invoice No); si falta, caen al id interno. `emisor_usuario_id` elige a nombre de quién sale |
| `/api/rentabilidad/compras-exterior/emisores` | GET | - | Lista usuarios activos `{emisores:[{id,nombre,documento_identidad,email}]}` para el selector de emisor |
| `/api/rentabilidad/compras-exterior/envios` | GET/POST | POST: `{compra_ids, fecha_envio, flete, moneda_flete?, emisor_usuario_id?, trm?}` | Agrupa compras en un paquete. El flete se liquida con TRM BanRep de `fecha_envio` y se reparte por **% de paquetes** (`cantidad`). GET lista envíos del historial |
| `/api/rentabilidad/compras-exterior/envios/<id>` | GET/PATCH/DELETE | PATCH: `fecha_envio`, `flete`, `moneda_flete`, `compra_ids?` | Detalle / actualizar liquidación / desenlazar paquete |
| `/api/rentabilidad/compras-exterior/envios/<id>/recalcular-costos` | POST | - | Reparte el flete por % de paquetes y actualiza costos unitarios (historial + componentes + Siigo). No borra PDF de flete ya aprobado |
| `/api/rentabilidad/compras-exterior/borradores` | GET | `limit?` | Lista borradores `{borradores[]}` |
| `/api/rentabilidad/compras-exterior/borrador` | POST | multipart/JSON: `estado`, `moneda`, `trm`, `imagenes?`, `borrador_id?` | Crear/actualizar borrador para retomar |
| `/api/rentabilidad/compras-exterior/borrador/<id>` | GET/DELETE | - | Detalle o eliminar borrador |
| `/api/rentabilidad/compras-exterior/borrador/<id>/soporte` | GET | `i?` | Soporte del borrador |

Landed cost: `costo_unitario_cop = (subtotal_neto_cop + flete_asignado) / (packs × contenido)`.
El flete total de una compra suelta se reparte por **unidades compradas** (packs × ml/g/un), no por valor $.
Si varias compras viajan en un solo paquete (`compras_exterior_envios`), el flete se liquida con la TRM BanRep de `fecha_envio` y se reparte por **porcentaje de paquetes** (`cantidad` de cada referencia / total de packs del envío); cada costo unitario sube con su parte del flete. La mercancía de cada factura sigue con la TRM de su `fecha_compra`. Una sola cuenta de cobro de flete por envío.
Unidad base obligatoria por línea: `ml` | `g` | `un` (detectada del texto: 500ml→ml, 1kg→g/1000, 100pcs→un).
El costo guardado es por esa unidad mínima (COP/ml, COP/g o COP/un).
USD→COP: TRM = tasa representativa BanRep vigente en `fecha_compra` (fuente `banrep`); override manual opcional.
En extracción OCR, la `fecha_compra` del documento **tiene prioridad** sobre la del formulario (que suele ser “hoy”); el form solo aplica si el OCR no encuentra fecha.
La **cuenta de cobro** siempre se genera en pesos (COP) con esa TRM del día de la compra. Si el OCR/formulario etiqueta como COP un total típico de factura en dólares (p. ej. $532), se reinterpreta como USD y se aplica la TRM BanRep.
Descuentos: `descuento_detectado` / `descuento_pct` (pedido sobre mercancía) y `descuento` /
`descuento_pct` por línea; el costo usa el neto tras descuentos.
Flete: si el recibo cobra envío y lo descuenta (`descuento_flete_detectado` o el descuento
de pedido ≈ monto del shipping), se **netea** → `flete_usado` puede quedar en 0 y ese
descuento no se resta de la mercancía.

## Contabilidad — Ingresos/Egresos + extracto bancario

Prefijos: `/api/contabilidad/*` y `/app/api/contabilidad/*`.

| Endpoint | Método | Auth | Notas |
| --- | --- | --- | --- |
| `/api/contabilidad/ingresos-egresos` | GET | Bearer | Query `desde`, `hasta?`, `meli`, `siigo`. Cada movimiento incluye `id` estable y `extracto` (vínculo o null). Totales: `vinculados_extracto`. |
| `/api/contabilidad/extractos` | GET | Bearer | Lista extractos subidos `{extractos[]}`. |
| `/api/contabilidad/extractos` | POST | Bearer | Multipart `archivo` (csv/xlsx), opcional `banco`, `cuenta`, `notas`. |
| `/api/contabilidad/extractos/<id>` | GET/DELETE | Bearer | Detalle con líneas; query `solo_sin_vincular=1`. DELETE elimina archivo + vínculos. |
| `/api/contabilidad/extractos/vincular` | POST | Bearer | JSON `{extracto_mov_id, movimiento_id, notas?}`. 1:1. |
| `/api/contabilidad/extractos/desvincular` | POST | Bearer | JSON `{vinculo_id?}` o `{movimiento_id?}`. |
| `/api/contabilidad/extractos/candidatos` | GET | Bearer | Query `fecha`, `tipo` (ingreso\|egreso), `monto` → líneas sin vincular cercanas. |

Persistencia: tablas `extractos_bancarios`, `extracto_movimientos`, `extracto_vinculos` en `app/data/contabilidad.db`. Archivos en `app/data/extractos_bancarios/`.

## Contabilidad — Créditos adquiridos

Prefijos: `/api/contabilidad/creditos*` y `/app/api/contabilidad/creditos*`. Auth Bearer.

| Endpoint | Método | Notas |
| --- | --- | --- |
| `/api/contabilidad/creditos` | GET | Lista + `resumen` (deuda vigente, cuota mensual consolidada, próximo vencimiento). |
| `/api/contabilidad/creditos` | POST | Alta. Body: `nombre`, `monto_original`, `plazo_meses`, `tasa_anual_pct`, `tipo_tasa` (`EA`\|`NA_MV`), `sistema` (`frances`\|`aleman`\|`interes_solo`), `periodicidad`, `cuota_pactada?`, `seguro_cuota?`, fechas, acreedor. |
| `/api/contabilidad/creditos/simular` | POST | Mismos campos financieros → `cuota`, `n_cuotas`, `total_pagar`, `total_intereses`, `tabla`. No persiste. |
| `/api/contabilidad/creditos/<id>` | GET/PATCH/DELETE | Detalle incluye `tabla` de amortización y `pagos`. |
| `/api/contabilidad/creditos/<id>/pagos` | POST | Registra cuota. Si no vienen `capital`/`intereses`, se reparte con la tasa del periodo sobre el saldo. |
| `/api/contabilidad/creditos/pagos/<pago_id>` | DELETE | Quita un pago y reabre el crédito si estaba `pagado`. |

Persistencia: tablas `creditos_adquiridos` y `creditos_pagos` en `app/data/contabilidad.db`. Los pagos entran al libro de ingresos/egresos con fuente `creditos_adquiridos`.

## Salud del negocio

`GET /api/salud-negocio/resumen` y el mismo path bajo `/app/api/salud-negocio/resumen` (el SPA catch-all no debe servir HTML aquí).

Query: `periodicidad=dia|semana|mes`, `n` (tope 120/26/24), `refresh=1` opcional. Auth Bearer.

## Competencia de precios MeLi

Auth Bearer. Prefijos `/api` y `/app/api`. No muta precios; solo lee MeLi y persiste `app/data/analisis_competencia_precios.json`.

- `GET /api/meli/competencia-precios` — último ranking propio + observaciones (ojo o pantallazo).
- `POST /api/meli/competencia-precios/analizar` — body `{top_n, dias, consulta}`. Solo cuenta McKenna.
- `POST /api/meli/competencia-precios/observacion` — body `{item_id, precio, vendedor?, permalink?, titulo?, notas?}`. El servidor **no** visita el permalink.
- `DELETE /api/meli/competencia-precios/observacion?id=` — quita una anotación.
- `POST /api/meli/competencia-precios/reporte-captura` — multipart `imagen` + `item_id` (o JSON base64). Gemini lee el pantallazo; el servidor **no** visita MeLi.

Tool Claude: `analizar_competencia_precios` (texto compacto). Cron: `scripts/analisis_competencia_precios_cron.py` (job `competencia_precios`).

## 5S Panel

Prefijos soportados: `/api/5s/*` y, para mutaciones bajo SPA/proxy, `/app/api/5s/*`.

Rutas principales:

- `GET/PUT /api/5s/workspace`
- `POST /api/5s/project`
- `POST /api/5s/project/routine`
- `POST /api/5s/routine`
- `POST /api/5s/suggest-routine`
- `POST /api/5s/assistant`
- `POST /api/5s/audio`
- `POST /api/5s/project/<project_id>/delete`
- `DELETE /api/5s/project/<project_id>`
- `POST /api/5s/template`
- `PUT/DELETE /api/5s/template/<template_id>`

## Proveedores (Logística Internacional → Proveedores) + web /cotizar

- Backend: `app/routes_proveedores.py` → `app/services/proveedores_db.py` (SQLite `app/data/proveedores.db`).
- Auth: `CHAT_API_TOKEN` o usuario de tickets con `permisos_secciones["logistica-internacional"]` (o `logistica-proveedores`).
- Todas las rutas existen en `/api/proveedores/...` y `/app/api/proveedores/...`.
- `GET /api/proveedores/resumen` → `{proveedores, productos, lineas_producto, precios, publicables, catalogos, catalogos_pendientes, cotizaciones_nuevas, paises[], oferta_web_publicada}`.
- `GET /api/proveedores?q=` → `{proveedores: [{id, nombre, nit, pais, tipo, n_productos, n_precios, ultima_compra, n_catalogos, ...}]}`; `POST` crea (`nombre` obligatorio); `GET/PUT /api/proveedores/<id>` ficha con `productos[]`, `precios[]`, `catalogos[]`.
- `GET /api/proveedores/productos?q=&linea=&publicables=1` → `{productos: [{clave, nombre, cas, linea, origen_paises[], publicar_web, presentaciones[], skus_siigo[], proveedores: [{proveedor_id, proveedor, ultimo_precio, moneda, precio_min, n_compras, producto_id}], mejor_precio, mejor_proveedor}]}` (una fila por producto, agrupado por `clave` = nombre sin presentación).
- `PUT /api/proveedores/productos/<id>` (`linea`, `origen_pais`, `publicar_web`, `cas`, `aplicar_a_clave`); `GET /api/proveedores/precios?clave=`.
- `POST /api/proveedores/importar` `{fuente: todo|historial|compras_exterior|siigo, incluir_siigo, fecha_desde}` — idempotente (UNIQUE en precios).
- Catálogos: `POST /catalogos/escanear {dias}` (Gmail, solo metadatos) · `GET /catalogos?estado=` · `POST /catalogos/<id>/extraer` → `{lineas: [{nombre, precio, cas, fila, archivo}], detalle[]}` (heurístico, sin LLM) · `POST /catalogos/<id>/importar {proveedor_id|proveedor_nombre, lineas[], moneda, publicar_web, linea, origen_pais}` · `POST /extraer-url {url}` · `POST /importar-lineas`.
- `POST /api/proveedores/autoclasificar {todos?, proveedor_id?}` → `{ok, actualizados}` (reglas por nombre, sin LLM); `POST /api/proveedores/publicar-masivo {proveedor_ids[], despublicar?}` → `{ok, productos}`.
- `GET /api/proveedores/comparador?ids=1,2&q=&minimo=2` → `{proveedores[], filas: [{clave, nombre, linea, cas, celdas: {"<pid>": {producto_id, nombre, ultimo_precio, moneda, fecha, n_compras}}, n_proveedores, mejor_pid}], total_filas}`; `GET /api/proveedores/coincidencias` → `{proveedores[], pares: [{a, b, a_nombre, b_nombre, n}], matriz}`; `POST /api/proveedores/catalogo-web {url, proveedor_id?, solo_extraer?, publicar_web?}` (extractores por dominio en `app/tools/catalogos_proveedores_web.py`).
- `POST /api/proveedores/publicar-web` → escribe `PAGINA_WEB/site/data/oferta_proveedores.json` `{actualizado, n_productos, productos: [{clave, nombre, cas, linea, origen_paises[], presentaciones[], n_fuentes, skus[]}], paises: [{pais, lat, lon, puerto_entrada, n_productos, muestra[]}]}` y avisa a `:8083/api/oferta/refresh`. **Sin nombres de proveedor.**
- Cotizaciones: `GET /api/proveedores/cotizaciones?estado=` → `{solicitudes: [{..., estado: nueva|en_proceso|enviada|cerrada, proveedores_posibles[]}]}`; `PUT /cotizaciones/<id> {estado, respuesta, enviar_respuesta}` (correo vía `enviar_email_reporte`, EMAIL_SENDER/EMAIL_PASSWORD). `POST /cotizaciones/notificar {id}` es interno (Bearer CHAT_API_TOKEN) y lo llama website.py.
- Web (`:8083`): el inicio y `/cotizar` incluyen `_ruta_origen.html` + `_cobertura.html` con JSON embebido (`[data-tz-data]`, `[data-co-data]`) que consume `static/js/trazabilidad.js`. `GET /cotizar?q=&linea=` · `POST /cotizar/solicitar` (JSON o form: `producto`, `nombre`, `email`|`telefono` obligatorios; honeypot `website`; 8/h por IP) → `{ok, id}` · `POST /api/oferta/refresh`.
- Panel: `desktop/src/hooks/useProveedores.ts`, `desktop/src/components/ProveedoresPanel.tsx` (id de panel existente `logistica-proveedores`).

## Validacion De Contratos

- `tests/test_smoke.py` cubre contratos puros y rutas criticas sin credenciales.
- Frontend: `cd desktop && npm run qa:full`.
- Webhook real: probar con payload fixture y confirmar logs `meli_notification_received`.
