# CLAUDE.md — McKenna Group Agent

Instrucciones y arquitectura completa para cualquier IA que trabaje en este repositorio.

---

## Visión General

**Hugo García** es el agente de IA de McKenna Group S.A.S. (materias primas farmacéuticas y cosméticas, Bogotá, Colombia). Automatiza ventas por WhatsApp, preguntas de MercadoLibre, sincronización de stock, facturación Siigo, generación de catálogos y producción de contenido multimedia para redes sociales.

**Stack**: Python 3.12 · Flask · **Anthropic Claude** (agente WhatsApp + `/chat`, tool-calling) · **Google GenAI Gemini 2.5-Pro** (solo preventa MeLi con ficha y scripts de contenido) · **bot-mckenna** (Node, `whatsapp-web.js`, puerto **3000** → proxy a `8081/whatsapp`; monitor `/monitor`) · Evolution API (opcional, p. ej. transcripción en `routes.py`) · MercadoLibre API · Siigo ERP · Google Sheets · ReportLab · ChromaDB · SQLite · Ideogram · ElevenLabs · fal.ai (Kling) · PIL · ffmpeg · Facebook Graph API

---

## Cómo correr el proyecto

```bash
# Producción (con túnel Cloudflare para webhooks)
./start.sh

# Desarrollo (sin túnel, Flask dev en puerto 8081)
source venv/bin/activate && python3 agente_pro.py

# Solo webhook MeLi (puerto 8080)
source venv/bin/activate && python3 webhook_meli.py

# Health check
curl http://localhost:8081/status

# Catálogo PDF
source venv/bin/activate && python3 generar_catalogo.py

# Puente WhatsApp (Node, puerto 3000)
cd bot-mckenna && npm ci && npm start
# Primera vez si venías de ~/bot-mckenna: ./bot-mckenna/migrar_desde_legacy.sh
# systemd (WhatsApp Node): sudo bot-mckenna/instalar_systemd.sh && systemctl enable --now mckenna-whatsapp-bridge
```

---

## Estructura de Directorios

```
/home/mckg/mi-agente/
├── agente_pro.py                  Flask app principal (puerto 8081) + CLI thread
├── webhook_meli.py                Flask app notificaciones MeLi (puerto 8080)
├── preventa_meli.py               Orquestador preguntas de preventa MeLi
├── modulo_posventa.py             Gestión post-venta (RUT, devoluciones)
├── generar_catalogo.py            Genera PDF catálogo con fotos de MeLi
│
├── PAGINA_WEB/site/               Tienda y contenido (Flask `website.py`): pedidos, catálogo, datos JSON
│
├── bot-mckenna/                   Puente WhatsApp (Node): server.js :3000, monitor /monitor
│   ├── server.js                 whatsapp-web.js → POST /whatsapp :8081; /enviar para reportes
│   ├── instalar_systemd.sh       Crea mckenna-whatsapp-bridge.service (no usar nombre bot-mckenna si choca con Python)
│   ├── package.json
│   └── README.md                 Migración desde carpeta legacy fuera del repo
│
├── app/
│   ├── core.py                    Claude (Anthropic): prompt sistema, registro herramientas, `obtener_respuesta_ia`
│   ├── routes.py                  Endpoints Flask: /whatsapp, /sync/*, etc.
│   ├── sync.py                    Lógica central sincronización stock + facturas
│   ├── cli.py                     Menú CLI interactivo (8 opciones con submenús)
│   ├── monitor.py                 Alertas automáticas y métricas diarias
│   ├── observability.py           request_id, spawn_thread, log_json
│   ├── utils.py                   refrescar_token_meli(), enviar_whatsapp_*(), JIDs preventa/postventa/alertas sistemas, helpers posventa MeLi
│   │
│   ├── services/
│   │   ├── meli.py                MeLi API: órdenes, stock, facturas, aprendizaje
│   │   ├── meli_preventa.py       Persistencia preguntas pendientes + casos aprendidos
│   │   ├── siigo.py               Siigo ERP: facturas paginadas, descarga PDF
│   │   └── google_services.py     Google Sheets: catálogo, fichas técnicas
│   │
│   ├── tools/
│   │   ├── memoria.py             SQLite + ChromaDB vectorial
│   │   ├── system_tools.py        Archivos, backups, scripts, email (restricción opcional de rutas)
│   │   ├── script_audit.py        Auditoría py_compile + manifiesto; usado por herramienta auditar_scripts
│   │   ├── backup_drive.py        Backup nocturno Drive/local + git push opcional + WA a GRUPO_ALERTAS_SISTEMAS_WA
│   │   ├── sincronizar_productos_pagina_web.py  Stock/precios hacia API tienda web (WEB_API_*)
│   │   ├── web_pedidos.py         Comandos WhatsApp grupo pedidos web (facturar / envío)
│   │   ├── verificacion_sync_skus.py  Auditoría SKUs MeLi / SIIGO / web
│   │   └── sincronizar_facturas_de_compra_siigo.py  Facturas de compra desde Gmail
│   │
│   ├── data/
│   │   ├── preguntas_pendientes_preventa.json  Queue de preguntas sin responder
│   │   ├── modos_atencion.json                 Números en modo humano vs IA
│   │   ├── metricas_diarias.json               Estadísticas del día
│   │   ├── grupos_whatsapp_oficiales.json      Nombres y JIDs de grupos operativos
│   │   ├── tarifas_interrapidisimo.json        Tarifas de envío
│   │   └── scripts_manifest.json               Lista de .py para auditoría / cron
│   │
│   └── training/
│       ├── casos_preventa.json    Historial Q&A para few-shot learning
│       └── casos_especiales.json  Reglas custom por trigger
│
├── memoria_vectorial/             ChromaDB persistente (embeddings)
├── comprobantes/                  Imágenes de comprobantes de pago recibidos
├── facturas_descargadas/          PDFs de facturas Siigo
├── cotizaciones_preliminares/     JSON de cotizaciones en progreso
├── DISENO CORPORATIVO/            Logo e isotipo McKenna
│
├── pipeline_contenido_facebook.py Copy→Imagen→Voz→Video→Facebook (consola)
├── generar_infografias_facebook.py Infografías PIL publicadas en Facebook (consola)
├── sincronizar_facebook.py        Limpia y republica la página de Facebook (consola)
│
├── .env                           Credenciales (NO commitear)
├── credenciales_meli.json         OAuth tokens MeLi (NO commitear)
├── credenciales_google.json       OAuth tokens Google (NO commitear)
├── credenciales_SIIGO.json        API key Siigo (NO commitear)
└── mi-agente-ubuntu-*.json        Google Service Account (NO commitear)
```

---

## Variables de Entorno (.env)

```env
# IA
GOOGLE_API_KEY              # Google GenAI (Gemini) — preventa MeLi, pipelines de contenido
ANTHROPIC_API_KEY           # Claude API — obligatorio para WhatsApp, `/chat` y herramientas del agente
WEB_API_URL                 # Base URL API stock/precios sitio web (opcional; ver sincronizar_productos_pagina_web)
WEB_API_KEY                 # Bearer para API web (opcional)

# MercadoLibre
MELI_CREDS_PATH             # Ruta a credenciales_meli.json

# WhatsApp (Evolution API)
EVOLUTION_API_URL           # Endpoint Evolution API
EVOLUTION_API_KEY           # Clave autenticación
INSTANCE_NAME               # Nombre instancia WA

# Google
SPREADSHEET_ID              # ID Google Sheet (catálogo/inventario)
TDS_FOLDER_ID               # Google Drive folder fichas técnicas

# Grupos WhatsApp
GRUPO_CONTABILIDAD_WA       # ID grupo contabilidad (default: 120363407538342427@g.us)
GRUPO_INVENTARIO_WA         # ID grupo inventario
TELEFONO_GRUPO_REPORTE      # Número/grupo para reportes
GRUPO_PREVENTA_WA           # Alertas y comandos `resp …` de preguntas MeLi (preventa)
GRUPO_POSTVENTA_WA         # Alertas mensajes post-compra MeLi + comando `posventa <código>: …`
GRUPO_PEDIDOS_WEB_WA        # Único JID para pedidos web: 120363391665421264@g.us (Guias_Envios pagina web) — alertas + facturar + envio
# Inventario completo de grupos oficiales (nombres y JIDs): app/data/grupos_whatsapp_oficiales.json

# API
CHAT_API_TOKEN              # Token para endpoints /chat y /sync/*
ADMIN_TOKEN                 # Token admin

# Infraestructura
CLOUDFLARE_TUNNEL_TOKEN     # Token túnel Cloudflare

# Multimedia / Redes Sociales (scripts de consola)
IDEOGRAM_API_KEY            # Generación de imágenes con IA (Ideogram)
ELEVENLABS_API_KEY          # Síntesis de voz TTS en español (ElevenLabs)
FAL_KEY                     # Generación de video (fal.ai / Kling v1.6)
FB_PAGE_TOKEN               # Facebook Graph API — publicación en página
FB_PAGE_ID                  # ID de la página de Facebook de McKenna Group

# Operaciones, observabilidad y cron
GRUPO_ALERTAS_SISTEMAS_WA   # WhatsApp: backup nocturno + fallos auditoría scripts (default en app/utils.py)
AGENTE_LOG_JSON             # 1 = eventos JSON una línea en stderr (http, tools, IA)
AGENTE_RESTRICT_FILE_TOOLS  # 1 o FLASK_ENV=production → limita parchear_funcion / crear_nuevo_script / ejecutar_script_python
AGENTE_FILE_TOOL_PREFIXES   # Prefijos relativos al repo permitidos (coma); ej. scripts/,app/tools/,tests/
AGENTE_NIGHTLY_GIT_PUSH     # 0 = no ejecutar git commit/push tras el backup de las 2:00
AGENTE_AUDITORIA_SKIP_WA    # 1 = scripts/auditar_scripts_cron.py no envía WhatsApp aunque falle
AGENTE_AUDITORIA_CRON_QUIET # 1 = cron auditoría no imprime línea si todo OK
```

---

## Observabilidad, backup nocturno y cron

| Pieza | Archivo / script | Qué hace |
|-------|------------------|----------|
| `request_id` por petición | `app/observability.py` | UUID o cabecera `X-Request-ID`; se propaga a hilos con `spawn_thread()`. |
| Logs JSON | `AGENTE_LOG_JSON=1` | Eventos `meli_notification_received`, `whatsapp_webhook`, `tool_ok` / `tool_error`, etc. |
| Rutas Flask | `app/routes.py`, `webhook_meli.py` | `before_request` + `bind_flask_request`. `/status` incluye `request_id`. |
| Límite tools de código | `app/tools/system_tools.py` | Con restricción activa, solo rutas bajo `AGENTE_FILE_TOOL_PREFIXES`. |
| Auditoría estática | `app/tools/script_audit.py`, `app/data/scripts_manifest.json` | `py_compile` sin ejecutar `main`; herramienta `auditar_scripts` en Claude. |
| Cron auditoría | `scripts/auditar_scripts_cron.py`, `scripts/instalar_cron_mcKenna.sh` | Diario (ej. 7:15); log en `log_cron.txt`; WhatsApp si hay fallos. |
| Backup 2:00 + Git | `app/tools/backup_drive.py` | Tar en `backups_drive/` (no git), Drive opcional; luego `git add/commit/push` si hay cambios. |
| Grupo WhatsApp | `jid_grupo_alertas_sistemas_wa()` | Mismo JID para mensaje de backup y alertas de auditoría cron. |

**Tests de humo:** `pytest tests/test_smoke.py` (`/status`, auditoría, guard de archivos).

---

## Arquitectura y Flujos de Datos

### A. Pregunta de cliente en MeLi (Preventa)

```
MeLi → POST /notifications (puerto 8080)
  └─ topic: "questions"
  └─ hilo: procesar_nueva_pregunta(question_id)   # preventa_meli + Gemini si hay ficha
       ├─ GET /questions/{id} → texto pregunta + item_id
       ├─ GET /items/{item_id} → nombre del producto
       ├─ manejar_pregunta_preventa()
       │    ├─ buscar_ficha_tecnica_producto(nombre) → Google Sheets col I
       │    ├─ CON ficha → generar_respuesta_con_ficha() con Gemini
       │    │    ├─ Gemini OK → POST /answers → responde en MeLi ✅
       │    │    └─ Gemini falla → delega al grupo ❓
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

### C. Mensaje WhatsApp → IA

```
WhatsApp → POST /whatsapp (puerto 8081)
  ├─ Grupo contabilidad / compras / inventario (según JID y flags): pagos `ok`/`no`, `resp …`, facturas compra `inv …`, etc.
  ├─ Grupo preventa (`GRUPO_PREVENTA_WA`): `resp …` / `resp preventa …` para preguntas MeLi pendientes
  ├─ Grupo postventa (`GRUPO_POSTVENTA_WA`): `posventa <código>: <txt>` → envía respuesta al pack MeLi (cola `app/data/mensajes_posventa_pendientes.json`)
  ├─ Grupos pedidos web: comandos `facturar` / envío (ver `web_pedidos.py`)
  ├─ "hugo dale ok <order_id>" → si hay borrador de respuesta IA posventa, envía a MeLi vía `modulo_posventa` (la alerta de aprobación se envía al grupo postventa)
  ├─ Si número en modo humano → reenvía al grupo
  ├─ Si imagen recibida → guarda comprobante → alerta pago al grupo
  └─ Si mensaje normal → obtener_respuesta_ia() → **Claude** (tool loop) → responde (si `es_postventa`, borrador + aprobación en lugar de envío directo)
```

### E. Confirmación de Pago

```
Cuando cliente envía imagen:
  1. Guarda en comprobantes/ con nombre {sender}_{timestamp}.jpeg
  2. Crea entrada en pagos_pendientes_confirmacion[sender_id]
  3. Envía al grupo:
     🔔 ALERTA DE PAGO
     Cliente ...{últimos7dig} envió comprobante.
     ✅ Para CONFIRMAR: ok {últimos3dig}
     ❌ Para RECHAZAR:  no {últimos3dig}

Operador confirma con: "ok 463"
  → Sistema busca pago con esos 3 dígitos
  → Envía al cliente: "Veci, confirmamos su pago ✅..."
  → Elimina de pendientes

Operador rechaza con: "no 463"
  → Sistema avisa al cliente que el pago no fue válido
```

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

---

## Endpoints Flask

**Webhooks MeLi:** configurar la aplicación de Mercado Libre para que **`/notifications` apunte solo al proceso del puerto 8080** (`webhook_meli.py`). `routes.py` en 8081 también define `/notifications` por legado; no duplicar el mismo URL en producción (evita doble procesamiento).

### webhook_meli.py (Puerto 8080)

| Endpoint | Método | Propósito |
|----------|--------|-----------|
| `/notifications` | POST | Webhook MeLi: preguntas + órdenes |
| `/status` | GET | Estado de servicios |
| `/chat` | POST | Chat IA con Bearer token; body JSON: `mensaje`, `session_id` (o `usuario_id`) |

### agente_pro.py / routes.py (Puerto 8081)

| Endpoint | Método | Auth | Propósito |
|----------|--------|------|-----------|
| `/whatsapp` | POST | — | Webhook principal WhatsApp |
| `/status` | GET | — | Health check |
| `/chat` | POST | Bearer | Chat IA (`mensaje` + `session_id` o `usuario_id` para historial) |
| `/panel` | GET | — | Panel HTML |
| `/sync/hoy` | POST | Bearer | Sync facturas último día |
| `/sync/10dias` | POST | Bearer | Sync facturas 10 días |
| `/sync/completo` | POST | Bearer | Full sync + reporte stock |
| `/sync/inteligente` | POST | Bearer | Cruce MeLi ↔ Siigo |
| `/sync/pack` | POST | Bearer | Sync por Pack ID |
| `/sync/fecha` | POST | Bearer | Sync por fecha YYYY-MM-DD |
| `/sync/stock` | POST | Bearer | Reporte stock WhatsApp |
| `/sync/aprendizaje` | POST | Bearer | Fuerza aprendizaje IA MeLi |
| `/sync/gmail` | POST | Bearer | Facturas de compra desde Gmail |
| `/consultar/producto` | GET | Bearer | Busca producto en Sheets |
| `/confirmar-pago` | POST | — | Confirma/rechaza pago |
| `/training/agregar-caso` | POST | — | Agrega caso de entrenamiento |

**Pedidos tienda web:** lógica en `PAGINA_WEB/site/website.py` y alertas/comandos en grupo `GRUPO_PEDIDOS_WEB_WA` vía `app/tools/web_pedidos.py` (facturación y envío desde WhatsApp).

---

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

# app/services/meli.py
actualizar_stock_meli(sku: str, nuevo_stock: int) → str
  # Busca publicaciones activas por seller_sku
  # Actualiza available_quantity en cada publicación encontrada
```

**IMPORTANTE:** No existe sincronización con SIIGO por ahora. SIIGO solo se usa para facturación.

---

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
  │    └─ Gemini genera respuesta
  │         ├─ Gemini OK → responde automáticamente en MeLi
  │         └─ Gemini falla (503, timeout) → ❓ delega al grupo
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

## Generación de Catálogo PDF

```python
# generar_catalogo.py - flujo:
1. leer_productos_sheets() → lee Sheets, extrae meli_id_to_sku de col A
2. fetch_meli_photos(token, meli_id_to_sku) → descarga 1ª foto por item_id
3. Inyecta photo_path en cada producto
4. draw_cover() → portada con logo + caja info
5. draw_interior_pages() → 2 columnas, tarjetas por categoría
6. draw_closing() → página final
7. enviar_whatsapp_archivo(OUT_PDF) → envía al grupo

# Diseño tarjeta (CARD_H = 82pt):
┌────────────────────────────────────────┐
│ [FOTO 58x58] NOMBRE DEL PRODUCTO       │
│              Ref: SKU                   │
│              MeLi: $XX.XXX ~~tachado~~ │
│              $XX.XXX COP  Ahorras 10%  │
└────────────────────────────────────────┘

# Clave: fotos se obtienen por meli_id (col A de Sheets), NO por seller_custom_field.
# El seller_custom_field de MeLi usa formato "AS-XX" diferente a los SKUs del catálogo.
```

---

## CLI Menu (app/cli.py)

El servidor lanza un hilo con menú interactivo de **8 opciones** con submenús:

```
1  → Chat directo con Hugo García
2  → Facturas MeLi ↔ Siigo  [submenú: inteligente / 24h / N días / fecha / pack ID]
3  → Stock e inventario      [submenú: reporte completo / verificar SKUs / Sincronizar Web]
4  → Consultar producto en Google Sheets
5  → Forzar aprendizaje IA desde Q&A MeLi
6  → Registrar facturas de compra en SIIGO (desde Gmail)
7  → Generar contenido científico y publicar en WordPress
8  → Salir
```

---

## IA Principal (app/core.py)

- **Modelo (WhatsApp, `/chat`, CLI chat)**: Claude `claude-sonnet-4-6` vía `ANTHROPIC_API_KEY`, con bucle de tool-use (`obtener_respuesta_ia`).
- **Modelo (preventa MeLi con ficha)**: Gemini `gemini-2.5-pro` en `app/services/meli_preventa.py` — sin herramientas; solo texto con ficha.
- **Persona**: Hugo García, asesor ejecutivo McKenna Group
- **Tono**: Directo, colombiano ("veci"), sin rodeos
- **Herramientas registradas**: ~32 funciones en `todas_las_herramientas` (Sheets, MeLi, Siigo, sync facturas, precios, catálogo PDF, pipeline FB, guías web, memoria, sistema). Stock hacia la web: `sincronizar_productos_pagina_web` (CLI/`sync.py`; no siempre expuesta como tool de Claude — ver `app/core.py`)

**Reglas anti-loop del prompt:**
- No ejecutar sync sin la palabra explícita "Sincronizar"/"Sync"
- No ofrecer opciones no solicitadas
- No imprimir listas largas en chat
- Para "¿cómo va conexión?": usar `refrescar_token_meli()`

---

## Almacenamiento

| Store | Tecnología | Propósito |
|-------|-----------|-----------|
| Conversaciones | SQLite (`app/tools/memoria.py`) | Historial chats |
| Embeddings | ChromaDB (`memoria_vectorial/`) | Q&A MeLi aprendidas |
| Catálogo/Inventario | Google Sheets | Fuente de verdad productos |
| Pendientes/Config | JSON files (`app/data/`) | Estado del sistema |
| Facturas/PDFs | Archivos locales | `facturas_descargadas/` |
| Comprobantes | Archivos locales | `comprobantes/` |

---

## Archivos que NO deben estar en git

```gitignore
.env
credenciales_meli.json
credenciales_google.json
credenciales_SIIGO.json
mi-agente-ubuntu-*.json
client_secret_cloud.json
token_gmail.json
venv/
memoria_vectorial/    # puede ser grande
backups_drive/        # .tar.gz del backup nocturno (local)
*.log
```

---

## Pipeline de Contenido Multimedia (scripts de consola)

Capacidades de generación de contenido ya integradas. **No forman parte del CLI del agente** — se ejecutan directamente desde la terminal con `source venv/bin/activate` y el script correspondiente.

### Flujo del pipeline completo

```
Gemini (copy + prompts)
  └─ Ideogram (imagen de fondo con IA)
       └─ PIL (composición: texto, logo, paleta de marca)
            └─ ElevenLabs (narración TTS en español colombiano)
                 └─ fal.ai / Kling v1.6 (video desde imagen o texto)
                      └─ Facebook Graph API (publicación en página)
```

### Scripts

| Script | Uso | Descripción |
|--------|-----|-------------|
| `pipeline_contenido_facebook.py` | `python3 pipeline_contenido_facebook.py --tipo ficha --slug acido-ascorbico` | Pipeline completo Copy→Imagen→Voz→Video→Facebook. `--auto` elige el contenido automáticamente |
| `generar_infografias_facebook.py` | `python3 generar_infografias_facebook.py --tipo receta --n 3` | Infografías estáticas con PIL sin video ni audio |
| `sincronizar_facebook.py` | `python3 sincronizar_facebook.py` | Borra y republica la página con productos, guías y blog posts actuales |

### Tipos de contenido

- `ficha` — Ingrediente: beneficios, concentración, compatibilidad
- `receta` — Fórmula paso a paso con ingredientes
- `comparativa` — Dos ingredientes frente a frente
- `tip` — Consejo profesional de formulación

### Fallback de video

Si fal.ai no tiene saldo, `generar_video_ken_burns()` genera el video localmente con **ffmpeg** (efecto zoom cinematográfico sobre la imagen).

---

## Generación de Contenido Científico y Web

Scripts de investigación científica automatizada y publicación en WordPress. **No forman parte del CLI del agente** — se ejecutan directamente desde la terminal o desde la opción 7 del CLI.

### Módulo principal: knowledge_agent.py

```python
# app/tools/knowledge_agent.py — flujo:
1. buscar_pubmed(termino, max_results=5)
     → NCBI E-utilities API (gratuita, sin key)
     → Endpoints: esearch.fcgi + efetch.fcgi
     → Extrae: PMID, título, abstract, autores, año, URL
     → Query con filtros MeSH: cosmetic[MeSH] OR pharmaceutical[MeSH]
     → Fallback sin filtros si no retorna resultados

2. buscar_arxiv(termino, max_results=3)
     → ArXiv API Atom (gratuita, sin key)
     → URL: https://export.arxiv.org/api/query
     → Parsea XML: <entry>, <title>, <summary>, <published>
     → Útil para nanomateriales y tendencias emergentes

3. scrape_url(url)
     → scrapling (librería especializada de web scraping)
     → Fallback: requests + regex sobre <p> y <div>
     → Límite: 4000 caracteres por URL

4. generar_y_publicar_contenido(tema, tipo, publicar=True)
     → Tipos: "post_blog", "receta", "manual_uso", "ficha"
     → Enriquece con referencias PubMed + ArXiv via Gemini
     → Almacena embeddings en ChromaDB (para respuestas preventa)
     → Publica en WordPress vía REST API si publicar=True

5. publicar_en_wordpress(titulo, contenido, categoria_id)
     → Endpoint: https://mckennagroup.co/wp-json/wp/v2/posts
     → Auth: Base64(WP_USER:WP_APP_PASSWORD)
     → Variables: WP_USER, WP_APP_PASSWORD
```

### Scripts de generación masiva

| Script | Descripción | Output |
|--------|-------------|--------|
| `generar_guias_masivas.py` | 62 ingredientes farmacéuticos/cosméticos. Cada guía tiene 7 secciones HTML: descripción, concentraciones (tabla), compatibilidad, incorporación, almacenamiento, normativa INVIMA, FAQ. Integra PubMed. | `/PAGINA_WEB/site/data/guias.json` |
| `generar_posts_masivos.py` | 20+ posts comparativos (ej: Niacinamida vs Clindamicina). Cada post incluye hallazgos contrastados, gráficas SVG/CSS inline, bibliografía. Usa PubMed con filtros MeSH. | `/PAGINA_WEB/site/data/posts.json` |
| `generar_recetas_masivas.py` | 40+ recetas de formulación en 4 categorías: cosmética, nutrición, perfumería, hogar. Genera ingredientes, cantidades, modo de preparación, precauciones con Gemini. | `/PAGINA_WEB/site/data/recetas.json` |

### Uso desde consola

```bash
# Knowledge agent (artículo específico)
source venv/bin/activate
python3 -c "
from app.tools.knowledge_agent import generar_y_publicar_contenido
generar_y_publicar_contenido('Niacinamida cosmética', 'post_blog', publicar=True)
"

# Guías masivas (62 ingredientes)
python3 generar_guias_masivas.py

# Posts comparativos
python3 generar_posts_masivos.py

# Recetas de formulación
python3 generar_recetas_masivas.py
```

### Variables de entorno requeridas

```env
WP_USER            # Usuario WordPress con permisos de editor
WP_APP_PASSWORD    # Application Password (WP → Usuarios → Contraseñas de aplicación)
WC_URL             # https://mckennagroup.co (también usado como WP_URL base)
```

---

## Decisiones de Diseño Importantes

1. **Fuente de verdad de stock**: cada plataforma es fuente de verdad de su propio stock cuando vende. No hay un "master" externo.

2. **Fotos en catálogo**: se obtienen por `meli_id` (columna A del Sheet, formato MCOxxxxxxxx), NO por `seller_custom_field`. El `seller_custom_field` usa formato "AS-XX" que no coincide con los SKUs del catálogo.

3. **Preventa sin respuesta genérica**: si Gemini falla, se delega al grupo. Nunca se envía el fallback `"En breve nuestros asesores..."` al cliente.

4. **Confirmación de pagos corta**: comando `ok <3dígitos>` en lugar de `ok confirmado {número_completo}@c.us`.

5. **Sin sincronización SIIGO-stock**: SIIGO solo para facturación. El stock se alinea entre MeLi y la página web (API REST configurada), no desde SIIGO.

6. **Webhooks asíncronos**: todos los webhooks responden 200 inmediatamente y procesan en hilos daemon.

7. **Deduplicación de preguntas MeLi**: ventana de 5 minutos para evitar procesar la misma pregunta dos veces.
