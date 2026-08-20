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
| `/api/inicio/dolar-hora` | GET | query `force=1?` | Gadget Inicio: USD→COP horario (Yahoo) + TRM BanRep; `{valor, cambio_pct, serie_hora, serie_dia, trm_oficial}` |
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
| `/api/stock/ventas-30d` | GET | `dias?` (default 30), `refresh?` | `por_item[meli_id]{unidades,ordenes,monto,ritmo_diario,nivel}`, `ordenes`, caché ~30 min |
| `/api/stock/relacion-codigos` | GET | `buscar`, `filtro` (`todos`\|`vinculados`\|`sin_siigo`\|`divergentes`\|`sin_codigo`\|`sin_c`), `refresh` | `items` (meli_id, sku_meli, codigo_siigo, estado), `totales` (incluye `sin_c`: sin prefijo combo `C-`) |
| `/api/stock/relacion-codigos/vincular` | POST | `codigo_siigo`, `meli_id` | override Siigo→MeLi (`ok`, `en_siigo`) |
| `/api/stock/relacion-codigos/editar` | POST | `meli_id`, `sku_meli?`, `codigo_siigo?`, `vincular_si_sku?` | Actualiza SKU en MeLi (`SELLER_SKU`) y/o vínculo Siigo; al menos un campo de código |
| `/api/publicaciones` | GET | `buscar`, `categoria`, `canal` (`todos`\|`ambos`\|`falta_web`\|`sin_meli`\|`no_en_tienda`) | `items`, `resumen` (conteos estables), `categorias` |
| `/api/publicaciones/<sku>` | GET | `live_meli=1` opcional | Detalle + `vista_sitios` `{web, meli, presentaciones}` (cómo se ve en tienda vs listing) |
| `/api/publicaciones/<sku>/estado-meli` | POST | `estado`: `active`\|`paused` | Pausa/activa la publicación MeLi vinculada |

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
| `/api/siigo/productos` | POST | `codigo`, `nombre`, `unidad?`, `precio_costo?`, `precio_venta?`, `iva?` | Crea Product inventariable; `{ok, mensaje\|error, siigo_producto?}` |
| `/api/siigo/productos/buscar` | GET | query `q`, `limit?`, `excluir_combos?` | Búsqueda viva Siigo + caché; `{items[{codigo,nombre,type}], total}` |
| `/api/siigo/combos` | POST | `codigo`, `nombre`, `componentes[{code,quantity}]`, `precio_lista?`, `iva?` | Crea Combo; requiere ≥1 componente existente; Premium |

También existen prefijos `/app/api/siigo/productos` y `/app/api/siigo/combos` para mutaciones bajo el SPA.

## Rentabilidad / compras exterior

Prefijos: `/api/rentabilidad/*` y `/app/api/rentabilidad/*` (mutaciones multipart).

| Endpoint | Metodo | Body | Notas |
| --- | --- | --- | --- |
| `/api/rentabilidad/componentes` | GET/POST | POST: `nombre`, `costo_unitario`, `categoria?`, `iva_incluido?` | Upsert costo manual + sync Siigo |
| `/api/rentabilidad/componentes-buscar` | GET | query `q` (SKU o nombre), `limit?` | Busca en vivo Siigo + caché; hasta 80 `{codigo,nombre}` |
| `/api/rentabilidad/trm` | GET | query `fecha=YYYY-MM-DD` | TRM BanRep (datos.gov.co) USD→COP para esa fecha |
| `/api/rentabilidad/extraer-compra-imagen` | POST | multipart `imagenes` (1..N) o `imagen`, opcional `fecha_compra`, `trm`, `flete` | Gemini Vision multi-imagen → lineas consolidadas + landed; USD sin TRM → BanRep |
| `/api/tickets/extraer-lista-compras` | POST | multipart `imagen` o `archivo`, `modo=compra|etiqueta` (auth tickets) | OCR → `{items:[{nombre,cantidad,unidad}]}`; etiquetas: presentación en nombre + `unidad=u` |
| `/api/rentabilidad/confirmar-compra-exterior` | POST | multipart: `items`, `moneda`, `fecha_compra`, `trm`, `imagenes` (N), `borrador_id?`, `compra_id?`, `soportes_indices?` | Upsert costos + historial; genera PDF cuenta de cobro 5% cuota manejo; con `compra_id` actualiza pedido ya registrado; con `borrador_id` usa/elimina borrador |
| `/api/rentabilidad/compras-exterior` | GET | `limit?` | Historial `{compras[]}` (incluye `cuota_manejo_cop`, `cuenta_cobro_url`) |
| `/api/rentabilidad/compras-exterior/<id>` | GET/DELETE | - | Detalle o eliminar compra (+ soportes + PDF cobro) |
| `/api/rentabilidad/compras-exterior/<id>/soporte` | GET | - | Imagen/PDF del pantallazo |
| `/api/rentabilidad/compras-exterior/<id>/cuenta-cobro` | GET/POST | POST body `{ accent_rgb }` | GET: PDF aprobado; POST: aprueba y genera PDF con acento del tema del usuario |
| `/api/rentabilidad/compras-exterior/borradores` | GET | `limit?` | Lista borradores `{borradores[]}` |
| `/api/rentabilidad/compras-exterior/borrador` | POST | multipart/JSON: `estado`, `moneda`, `trm`, `imagenes?`, `borrador_id?` | Crear/actualizar borrador para retomar |
| `/api/rentabilidad/compras-exterior/borrador/<id>` | GET/DELETE | - | Detalle o eliminar borrador |
| `/api/rentabilidad/compras-exterior/borrador/<id>/soporte` | GET | `i?` | Soporte del borrador |

Landed cost: `costo_unitario_cop = (subtotal_neto_cop + flete_asignado) / (packs × contenido)`.
El flete total se reparte por **unidades compradas** (packs × ml/g/un), no por valor $.
Unidad base obligatoria por línea: `ml` | `g` | `un` (detectada del texto: 500ml→ml, 1kg→g/1000, 100pcs→un).
El costo guardado es por esa unidad mínima (COP/ml, COP/g o COP/un).
USD→COP: TRM = tasa representativa BanRep vigente en `fecha_compra` (fuente `banrep`); override manual opcional.
Descuentos: `descuento_detectado` / `descuento_pct` (pedido) y `descuento` / `descuento_pct` por línea; el costo usa el neto tras descuentos.

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

- `GET /api/meli/competencia-precios` — último ranking propio + observaciones anotadas a ojo.
- `POST /api/meli/competencia-precios/analizar` — body `{top_n, dias, consulta}`. Solo cuenta McKenna.
- `POST /api/meli/competencia-precios/observacion` — body `{item_id, precio, vendedor?, permalink?, titulo?, notas?}`. El servidor **no** visita el permalink.
- `DELETE /api/meli/competencia-precios/observacion?id=` — quita una anotación.

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

## Validacion De Contratos

- `tests/test_smoke.py` cubre contratos puros y rutas criticas sin credenciales.
- Frontend: `cd desktop && npm run qa:full`.
- Webhook real: probar con payload fixture y confirmar logs `meli_notification_received`.
