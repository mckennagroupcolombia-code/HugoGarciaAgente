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
| `/whatsapp` | Sin Bearer | Confia en bridge/red interna |
| `/notifications` | Sin Bearer | Webhook MeLi; responder 200 rapido |

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
| `/api/preventa/pendientes` | GET | - | `preguntas`, `total` |
| `/api/preventa/casos` | GET | - | casos recientes |
| `/api/responder-preventa` | POST | `question_id`, `respuesta` | `ok` o error |
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
| `/api/panel/logs` | GET/DELETE | query `limit` | `lines` / `ok` |

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
