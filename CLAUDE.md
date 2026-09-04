# CLAUDE.md — McKenna Group Agent

Instrucciones y arquitectura completa para cualquier IA que trabaje en este repositorio.

---

## Visión General

**Hugo García** es el agente de IA de McKenna Group S.A.S. (materias primas farmacéuticas y cosméticas, Bogotá, Colombia). Automatiza ventas por WhatsApp, preguntas de MercadoLibre, sincronización de stock, facturación Siigo, generación de catálogos y producción de contenido multimedia para redes sociales.

**Stack**: Python 3.12 · Flask · **React 19 + TypeScript + Tailwind CSS** (panel operaciones `desktop/`) · **Anthropic Claude** (modelo por defecto en WhatsApp, `/chat`, Web Chat y preventa MeLi; tool-calling en canales de operaciones) · **Google GenAI Gemini 2.5-Pro** (red de seguridad de los canales cliente/preventa y modelo de scripts de contenido) · **bot-mckenna** (Node, `whatsapp-web.js`, puerto **3000** → proxy a `8081/whatsapp`; monitor `/monitor`) · Vite · Zustand · React Query · Evolution API (opcional, p. ej. transcripción en `routes.py`) · MercadoLibre API · Siigo ERP · Google Sheets · ReportLab · ChromaDB · SQLite · Ideogram · ElevenLabs · fal.ai (Kling) · PIL · ffmpeg · Facebook Graph API

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

# Panel de Operaciones React (producción — ya compilado, servido por Flask)
# Abrir en browser: http://localhost:8081/app

# Panel de Operaciones React (desarrollo — hot reload)
cd desktop && npm run dev
# Abre http://localhost:5173/app (proxy automático a Flask :8081)

# Recompilar panel tras cambios en desktop/src/
cd desktop && npm run build
# Luego reiniciar Flask: sudo systemctl restart agente-pro

# Catálogo PDF
source venv/bin/activate && python3 generar_catalogo.py

# Puente WhatsApp (Node, puerto 3000)
cd bot-mckenna && npm ci && npm start
# Ruta única soportada del bridge: /home/mckg/mi-agente/bot-mckenna
# systemd (WhatsApp Node): sudo bot-mckenna/instalar_systemd.sh && systemctl enable --now mckenna-whatsapp-bridge
```

### Metodología agentica

Antes de cambios medianos/grandes, usar **`docs/agentic/INDEX.md`** como mapa corto: orquestador → memoria → skill/ficha de módulo → subagentes readonly → plan → implementación → verificación → aprendizaje reusable. Evita cargar todo `CLAUDE.md` cuando el cambio solo toca un módulo.

Archivos clave:

- `docs/agentic/ORCHESTRATION.md` — roles orquestador/subagentes y flujo.
- `docs/agentic/MEMORY.md` — memoria local estilo Engram usando SQLite/Chroma/debug-memory existente.
- `docs/agentic/SKILLS.md` — matriz de skills lazy por intención.
- `docs/agentic/CHECKLIST.md` — checklist pre/post cambio.
- `docs/agentic/CONTRACTS.md` — contratos API críticos de panel, WhatsApp y MeLi.
- `docs/agentic/ECOSYSTEM.md` — mapa del ecosistema Gentleman: gentle-ai, Engram, ATL, Gentleman-Skills, GGA y Gentleman.Dots.
- `docs/agentic/learned_context.md` — resumen portable/sincronizable de aprendizajes reutilizables.
- `docs/agentic/modules/*.md` — fichas cortas por módulo crítico.
- `docs/agentic/TEAM_WORKFLOW.md` — autoría de commits (`--author`), sincronización git y recap obligatorio en `docs/team-recaps.md`, visible en `/app` → Sistemas → Control de Versiones.

### Git: `git pull` sin rama de seguimiento

Si aparece *No hay información de rastreo para la rama actual*, usa explícitamente el remoto y la rama (suele ser `main` o `master`):

```bash
git remote -v
git branch -vv
git pull origin main    # o: git pull origin master
# Opcional, una sola vez:
# git branch --set-upstream-to=origin/main master
```

### Producción: un solo dueño por puerto (systemd vs nohup)

| Puerto | Proceso | Unidad systemd (plantilla en `scripts/systemd/`) |
|--------|---------|---------------------------------------------------|
| 8080 | `webhook_meli.py` | `webhook-meli.service` |
| 8081 | `agente_pro.py` | `mckenna-agente.service` (o alias `agente-pro.service`) |
| 8083 | `PAGINA_WEB/site/website.py` | `mckenna-website.service` |
| túnel | `cloudflared` | `cloudflared.service` u otra unidad que gestione el túnel |

- **`mantener_servicios.sh`** y **`start_services.sh`** cargan `scripts/lib/mckenna_nohup_guard.sh`: si la unidad está **active** o brevemente **activating** (`_mckenna_unit_controls_service`), **no** lanzan ese servicio con `nohup`. **No** basta con `is-enabled`: una unidad **failed** pero enabled dejaba bloqueado el nohup y un `webhook_meli.py` huérfano. Evita un segundo `webhook_meli.py` mientras reinicias con `normalizar_webhook_meli.sh`. **No** mezclar **system** `agente-pro` / `webhook-meli` con **user** `mckenna-agente` / `mckenna-webhook-meli` (doble proceso y reinicios en bucle en el mismo puerto).
- Instalar plantillas: **`./scripts/instalar_servicios_systemd.sh`**, luego `systemctl enable --now` solo lo necesario.
- Diagnóstico: **`./scripts/diagnostico_servicios_mcKenna.sh`** (antes `diagnostico_webhook_8080.sh`).
- Si el diagnóstico muestra **2 procesos** `webhook_meli.py` o el PID del **8080 ≠ MainPID** de systemd: **`./scripts/normalizar_webhook_meli.sh`**.
- `webhook_meli.py` usa **flock** (`.webhook_meli.lock`) para una sola instancia; **no** hace bind de prueba al 8080 antes de cargar Flask (evita `EADDRINUSE` por **TIME_WAIT** tras `restart` y bucle de fallos en systemd).
- Tras muchos fallos en webhook: `sudo systemctl reset-failed webhook-meli` y copiar `StartLimitBurst` actualizado del repo en la unidad instalada.

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
├── desktop/                       Panel de Operaciones React (SPA servida por Flask en /app)
│   ├── src/
│   │   ├── components/           Chat, Dashboard, PreventaPanel, SyncPanel, StockPanel, Layout, Sidebar
│   │   ├── stores/               Zustand: auth.ts (Bearer token), app.ts (panel activo)
│   │   ├── hooks/                React Query: useMetricas, useStatus, usePreventa, useChat
│   │   ├── api/client.ts         fetch wrapper con Bearer auth
│   │   ├── App.tsx               Router de paneles
│   │   └── main.tsx              Entry point
│   ├── dist/                     Build de producción (generado por `npm run build`)
│   ├── package.json              React 19, Vite, Tailwind, Zustand, React Query
│   ├── vite.config.ts            base: "/app/", proxy /api → :8081
│   └── tailwind.config.ts        Dark theme McKenna (surface, accent, muted)
│
├── bot-mckenna/                   Puente WhatsApp (Node): server.js :3000, monitor /monitor
│   ├── server.js                 whatsapp-web.js → POST /whatsapp :8081; /enviar para reportes
│   ├── instalar_systemd.sh       Crea mckenna-whatsapp-bridge.service (no usar nombre bot-mckenna si choca con Python)
│   ├── package.json
│   └── README.md                 Operación y troubleshooting del bridge unificado
│
├── app/
│   ├── core.py                    Claude (Anthropic): prompt sistema, registro herramientas, `obtener_respuesta_ia`
│   ├── routes.py                  Endpoints Flask: /whatsapp, /api/*, /app (SPA), CORS
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
│   │   ├── web_pedidos.py         Comandos WhatsApp grupo pedidos web (facturar / envío / entregado)
│   │   ├── notas_credito.py       Ticket "anular factura / nota crédito" en Centro de Mando (Web/MeLi)
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
GOOGLE_API_KEY              # Google GenAI (Gemini) — red de seguridad WhatsApp/web/preventa, pipelines de contenido
ANTHROPIC_API_KEY           # Claude API — obligatorio: modelo por defecto en WhatsApp, `/chat`, Web Chat, preventa MeLi y herramientas del agente
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
GRUPO_COTIZACIONES_WA       # Solicitudes de cotización desde mckennagroup.co/cotizar (default: GRUPO_PEDIDOS_WEB_WA)
GRUPO_PEDIDOS_WEB_WA        # Único JID para pedidos web: 120363391665421264@g.us (Guias_Envios pagina web) — alertas + facturar + envio + entregado
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

# Presupuesto LLM (app/services/llm_budget.py — ver regla obligatoria abajo)
LLM_BUDGET_DIARIO_USD       # Umbral de alerta diaria (default 5.0): WhatsApp a GRUPO_ALERTAS_SISTEMAS_WA
LLM_BUDGET_TOPE_USD         # Tope duro diario (default 15.0): se bloquean nuevas llamadas LLM
LLM_BUDGET_BATCH_LLAMADAS   # Máx llamadas por proceso batch sin autorizar (default 25)
LLM_BUDGET_BATCH_USD        # Máx USD estimados por proceso batch sin autorizar (default 1.0)
```

### ⚠️ REGLA OBLIGATORIA — Presupuesto de gasto LLM

Ninguna tarea, script o cambio puede disparar consumo masivo de tokens por API
(Gemini, Claude o cualquier proveedor) **sin autorización explícita del usuario**.
Contexto: la simulación WA del 31-jul-2026 (723 turnos contra gemini-2.5-pro)
generó un gasto de decenas de dólares sin aviso previo.

- **Todo call-site nuevo de LLM** debe pasar por `app/services/llm_budget.py`:
  `permitir_llamada(modelo, contexto=...)` antes y `registrar_llamada(...)` después
  (con `usage_gemini(resp)` / `usage_anthropic(resp)` para tokens reales).
- **Scripts batch** (simulaciones, generación masiva de contenido, backfills):
  quedan limitados a ~25 llamadas / US$1 estimado por proceso. Para más, el
  operador debe pasar un flag explícito (ej. `--autorizar-gasto-usd N`, que llama
  `autorizar_lote(N)`). **Nunca** hardcodear la autorización ni marcar un script
  como "servicio" para saltarse el límite.
- **Antes de proponer o correr cualquier corrida masiva**, estimar el costo
  (nº llamadas × tokens × tarifa) y pedir confirmación al usuario con esa cifra.
- Los servicios de producción (`agente_pro.py`, `webhook_meli.py`) están exentos
  del límite por-proceso pero sujetos al tope diario global (`LLM_BUDGET_TOPE_USD`).
- Estado del día + historial de 30 días: `app/data/llm_budget.json` (gasto USD,
  llamadas, por modelo, por canal/contexto).
- **Defaults calibrados con datos reales** (ago-2026): un día normal de
  operación (WhatsApp + web + preventa MeLi, ~15-40 llamadas) cuesta
  US$0,10-0,25. Por eso `LLM_BUDGET_DIARIO_USD=1.0` (alerta) y
  `LLM_BUDGET_TOPE_USD=3.0` (bloqueo) — ya dan margen de 4-10x sobre lo normal
  sin permitir que un descontrol tipo la simulación del 31-jul (723 llamadas,
  ~US$17 en un día) pase inadvertido.
- **Panel de costos**: `GET /api/costos-ia` (Flask :8081, sin auth, igual que
  `/api/metricas`) expone hoy/semana/historial 30d. El monitor de
  `bot-mckenna` (`http://localhost:3000/monitor`) lo muestra en una sección
  "💸 Costos IA vía API" (proxy `GET /costos-ia` en `server.js`).
- **Resumen semanal a WhatsApp**: `scripts/resumen_costos_llm_cron.py`
  (cron lunes 7:45, instalado por `scripts/instalar_cron_mcKenna.sh`) envía al
  grupo de sistemas el total de la semana, por canal y por modelo.
  `AGENTE_COSTOS_LLM_SKIP_WA=1` para probarlo sin enviar WhatsApp.

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

### C. Mensaje WhatsApp → IA

```
WhatsApp → POST /whatsapp (puerto 8081)
  ├─ Grupo contabilidad / compras / inventario (según JID y flags): pagos `ok`/`no`, `resp …`, facturas compra `inv …`, etc.
  ├─ Grupo preventa (`GRUPO_PREVENTA_WA`): `resp …` / `resp preventa …` para preguntas MeLi pendientes
  ├─ Grupo postventa (`GRUPO_POSTVENTA_WA`): `posventa <código>: <txt>` → envía respuesta al pack MeLi (cola `app/data/mensajes_posventa_pendientes.json`)
  ├─ Grupos pedidos web: comandos `facturar` / `envio` / `entregado` (ver `web_pedidos.py`)
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

### I. Red de proveedores → sección "Cotizar" de la web + mapamundi

```
/app → Logística Internacional → Proveedores   (desktop/src/components/ProveedoresPanel.tsx)
  ├─ Directorio: proveedores + ficha (productos que maneja, último precio, historial de compras)
  ├─ ¿Quién vende…?: un producto (clave normalizada) → todos los proveedores que lo manejan,
  │    último precio, mínimo, nº de compras → a quién pedir cotización para el mejor precio
  ├─ Catálogos: escanea Gmail (adjuntos PDF/XLSX/CSV con "catálogo", "lista de precios",
  │    "portafolio", "cotización") → extracción heurística SIN LLM → el operador marca líneas
  │    → se guardan como productos del proveedor (también desde la URL de un proveedor)
  ├─ Oferta web: productos con publicar_web=1 → POST /api/proveedores/publicar-web
  │    → PAGINA_WEB/site/data/oferta_proveedores.json  (SIN nombres de proveedor)
  └─ Cotizaciones: solicitudes que llegan desde mckennagroup.co/cotizar + respuesta por correo

Fuentes automáticas (POST /api/proveedores/importar, repetible sin duplicar):
  app/data/facturas_compra_historial.json · Siigo /v1/purchases · contabilidad.db → compras_exterior

Web (website.py :8083):
  /cotizar            listado ampliado (oferta publicada + catálogo en stock) agrupado por línea;
                      lo que no está en stock solo se cotiza ("Bajo pedido"); lo que sí, enlaza a la tienda
  /cotizar/solicitar  POST → solicitudes_cotizacion (proveedores.db) → aviso al agente :8081
                      (/api/proveedores/cotizaciones/notificar, Bearer CHAT_API_TOKEN) → WhatsApp a
                      GRUPO_COTIZACIONES_WA (default GRUPO_PEDIDOS_WEB_WA) + correo de confirmación al cliente
  Inicio → "Del origen a tu fórmula": mapamundi real (_world_land.svg.html, Natural Earth) con dos
  capas: `stock` (origen_materias.json, editable en /app → Vitrina Web → Origen de materias) y
  `red` (países de origen de la oferta publicada). Paquetes animados (<animateMotion>) sobre cada ruta.
```

**Experiencia ilustrada en la web (sep-2026):** `_ruta_origen.html` ("Del origen a tu fórmula": KPIs
animados, cadena de custodia Origen → Tránsito → Calidad → Distribución, filtro por línea, mapamundi con
trama de puntos, rutas animadas con barco/avión, panel por país con productos + badges TDS/COA, tour
automático) y `_cobertura.html` ("Colombia, de punta a punta": mapa por departamentos
`_colombia_map.svg.html` (@svg-maps/colombia, MIT; centros en `app/data/colombia_departamentos_svg.json`),
coropleta con cobertura REAL de pedidos, tramado en los departamentos por impactar, pulsos de despachos
de la semana, puertos y bodega). JS: `static/js/trazabilidad.js`. Datos: `website.py::_construir_ruta_origen`
(cache 5 min; cruza `origen_materias.json` + oferta publicada + `documentos_web` para TDS/COA) y
`_construir_colombia_mapa`. Los **países de origen del catálogo son de referencia** (sembrados por
palabra clave el 2026-09-03 en `origen_materias.json`; el usuario autorizó datos de origen aproximados) —
se corrigen por SKU en /app → Vitrina Web → Origen de materias. `proveedores_db.clasificar_nombre()` /
`autoclasificar_productos()` sugieren línea y origen de productos de proveedores por reglas de nombre;
`es_materia_prima()` excluye empaques/servicios de la publicación; `nombre_publico()` limpia el nombre.

**Catálogos web de proveedores** (`app/tools/catalogos_proveedores_web.py`): extractores por dominio, sin LLM
(glotracol.com WooCommerce, interkrol.com Duda `ul.defaultList`, cadiep.com Webflow h4/h5, productos3a.com Webflow
`.text-block-3`, globalquimia.com.co page-sitemap; fallback heurístico). `CATALOGOS_CONOCIDOS` mapea proveedor →
URL. Cargados el 2026-09-03: Global Trading 123, Interkrol 344, Cadiep 81, Productos 3A 110, Globalquimia 8.
Factores y Mercadeo NO publica su portafolio en la web (solo categorías): pedir lista de precios y cargarla por
Catálogos. **Comparador** (`comparar_proveedores`, `matriz_coincidencias`, `clave_canon` = `nombre_publico`
normalizado): `GET /api/proveedores/comparador?ids=&q=&minimo=` y `GET /api/proveedores/coincidencias`; pestaña
Comparador en el panel. En la web pública (`/cotizar`) los productos bajo pedido se muestran SOLO con el nombre
genérico de la materia prima (`nombre_publico`: sin marca, presentación ni cantidad); la presentación solo se
muestra en productos de la tienda.

**Subcategorías en la web:** `proveedores_db.SUBCATEGORIAS` + `subcategoria_de(nombre, linea)` (segundo nivel
por familia: frutos secos y semillas, vitaminas y minerales, óxidos y oxidantes, sales, tensoactivos, solventes,
cápsulas y excipientes…). `/cotizar` agrupa línea → familia con navegación por chips, bloques de 24 con "ver más"
y buscador instantáneo. Se calcula al publicar (`oferta_proveedores.json`) y para el stock en `website.py`.
**Ojo:** no poner `reveal` en contenedores de listas largas (bloques >10.000 px nunca alcanzan el 10% de
intersección y quedan invisibles; pasó con Alimentario el 2026-09-03).

Datos: `app/services/proveedores_db.py` (SQLite `app/data/proveedores.db`, no versionado). Rutas:
`app/routes_proveedores.py` (`/api/proveedores/*` y alias `/app/api/...`, permiso
`logistica-internacional`). **Regla:** el sitio público nunca muestra el nombre del proveedor; McKenna
es el puente. Ningún endpoint del módulo llama a un LLM (una extracción de catálogos con Claude sería
un paso aparte, gateado por `llm_budget`).

---

## Endpoints Flask

**Webhooks MeLi:** configurar la aplicación de Mercado Libre para que **`/notifications` apunte solo al proceso del puerto 8080** (`webhook_meli.py`). `routes.py` en 8081 también define `/notifications` por legado; no duplicar el mismo URL en producción (evita doble procesamiento).

**URL pública de callbacks (producción):** `https://bot.mckennagroup.co/notifications` — en el administrador de aplicaciones MeLi, *Notificaciones / Callback URL* debe ser exactamente esa (HTTPS, sin barra final). El hostname **`bot.mckennagroup.co`** (túnel Cloudflare o proxy) debe enrutar el tráfico al servicio que ejecuta **`webhook_meli.py` en el puerto 8080**, no al agente en 8081.

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
| `/panel` | GET | — | Panel HTML (legacy) |
| `/app` | GET | — | **Panel React SPA** (interfaz principal de operaciones) |
| `/app/assets/*` | GET | — | Assets JS/CSS del build React |
| `/api/status` | GET | — | Health check JSON (usado por SPA) |
| `/api/metricas` | GET | — | Métricas diarias + estado token MeLi |
| `/api/preventa/pendientes` | GET | Bearer | Preguntas MeLi sin responder |
| `/api/preventa/casos` | GET | Bearer | Casos aprendidos (últimos 50) |
| `/api/responder-preventa` | POST | Bearer | Responder pregunta MeLi pendiente |
| `/api/sync/hoy` | POST | Bearer | Sync facturas último día |
| `/api/sync/10dias` | POST | Bearer | Sync facturas 10 días |
| `/api/sync/completo` | POST | Bearer | Full sync + reporte stock |
| `/api/sync/inteligente` | POST | Bearer | Cruce MeLi ↔ Siigo |
| `/api/sync/pack` | POST | Bearer | Sync por Pack ID |
| `/api/sync/fecha` | POST | Bearer | Sync por fecha YYYY-MM-DD |
| `/api/sync/stock` | POST | Bearer | Reporte stock WhatsApp |
| `/api/sync/aprendizaje` | POST | Bearer | Fuerza aprendizaje IA MeLi |
| `/api/sync/gmail` | POST | Bearer | Facturas de compra desde Gmail |
| `/api/stock/resumen` | GET | Bearer | Stock en vivo de MeLi por SKU (panel Stock) |
| `/api/stock/sincronizar` | POST | Bearer | Sincroniza un SKU a los canales; devuelve desglose {meli, web, siigo} |
| `/api/stock/sincronizar-todo` | POST | Bearer | Sincroniza todos los SKUs en segundo plano |
| `/api/consultar/producto` | GET | Bearer | Busca producto en Sheets |
| `/api/panel/logs` | GET | Bearer | Líneas recientes de actividad (sync/stock/consultas) para el visor del panel |
| `/api/panel/logs` | DELETE | Bearer | Vacía el buffer de actividad en memoria |
| `/api/proveedores/*` | GET/POST/PUT | Bearer / permiso `logistica-internacional` | Red de proveedores: directorio, ¿quién vende…?, precios históricos, catálogos Gmail, oferta web, cotizaciones (ver Flujo I) |
| `/api/costos-ia` | GET | — | Costos LLM vía API (hoy/semana/histórico 30d); ver `app/services/llm_budget.py`. Consumido por `bot-mckenna` `/costos-ia` |
| `/confirmar-pago` | POST | — | Confirma/rechaza pago |
| `/training/agregar-caso` | POST | — | Agrega caso de entrenamiento |

**CORS**: habilitado para `localhost:5173` (Vite dev), `tauri://localhost`. Middleware manual en `routes.py`.

**Pedidos tienda web:** lógica en `PAGINA_WEB/site/website.py` y alertas/comandos en grupo `GRUPO_PEDIDOS_WEB_WA` vía `app/tools/web_pedidos.py` (facturación al entregarse, envío y anulación desde WhatsApp — ver Flujo H).

---

## Panel de Operaciones React (`desktop/`)

**URL**: `http://localhost:8081/app`  
**Stack**: React 19 + TypeScript + Vite + Tailwind CSS + Zustand + React Query  
**Build**: `desktop/dist/` (servido por Flask como archivos estáticos)

### Paneles disponibles

| Panel | Qué hace |
|-------|----------|
| **Dashboard** | KPIs en tiempo real: mensajes WA, preguntas MeLi, órdenes, pendientes. Estado de servicios (MeLi, Sheets, Siigo, token). Polling cada 30s |
| **Chat IA** | Conversación con Hugo García vía `/chat`. Historial en memoria de sesión. Indicador de escritura |
| **Preventa MeLi** | Lista de preguntas pendientes con respuesta inline. Polling cada 20s. Botón responder → `/api/responder-preventa` |
| **Sincronización** | 10 acciones: sync hoy/10 días/inteligente/completo, aprendizaje IA, Gmail, stock, por Pack ID, por fecha, consultar producto. Feedback visual por acción |
| **Stock** | Búsqueda de producto en Sheets, generar reporte stock, verificar SKUs |
| **Ajustes** | Token actual, versión, estado, cerrar sesión |

### Autenticación

El SPA pide `CHAT_API_TOKEN` al ingresar. Se persiste en `localStorage` (Zustand persist). Todos los endpoints `/api/*` validan Bearer token.

### Desarrollo del panel

```bash
# Instalar dependencias (una sola vez)
cd desktop && npm install

# Desarrollo con hot reload (Vite dev server)
cd desktop && npm run dev
# → http://localhost:5173/app   (proxy /api y /chat → Flask :8081)

# Build de producción
cd desktop && npm run build
# → desktop/dist/   (Flask sirve en /app)

# Reiniciar Flask tras rebuild
sudo systemctl restart agente-pro
```

### Arquitectura

```
Browser → http://localhost:8081/app → Flask sirve desktop/dist/index.html
  ↓ JS/CSS assets: /app/assets/* → Flask sirve desktop/dist/assets/
  ↓ API calls: /api/* → Flask endpoints JSON (mismo puerto, con CORS)
  ↓ Chat: /chat → Flask → Claude tool-use loop
```

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

- **Modelo por canal**: asignado en `app/services/canales_config.py` / editable en Panel → Sistemas → Chat de Agentes → Canales (persistido en `app/data/canales_modelos.json`). Claude `claude-sonnet-4-6` es el default en `whatsapp`, `web_chat` y `meli_preventa`, vía `ANTHROPIC_API_KEY`.
- **WhatsApp y Web Chat (clientes)**: `obtener_respuesta_ia()` en `app/core.py` despacha a `app/agent/cliente_chat.py` — LLM (Claude por defecto) solo redacta texto sobre catálogo/ficha ya resueltos en Python, **sin** tool-use API. Gemini/Ollama son red de seguridad si Claude falla o el presupuesto LLM lo bloquea.
- **CLI chat y canales de operaciones** (ej. `sede_sur`): pasan por el bucle de tool-use de `AgentRun`/`LLMRouter`, Claude por defecto.
- **Preventa MeLi con ficha**: `generar_respuesta_con_ficha()` en `app/services/meli_preventa.py` — intenta primero el modelo del canal `meli_preventa` (Claude por defecto); si falla o no hay presupuesto, cae a la cascada de modelos Gemini (`gemini-2.5-pro` → flash). Sin herramientas; solo texto con ficha.
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

### Convención — dónde debe vivir un archivo nuevo

Tres ubicaciones posibles, en este orden de preferencia. **Antes de crear una carpeta nueva
para archivos generados, ubicarla aquí** (evita el desorden identificado en la auditoría de
sep-2026, ver `docs/agentic/learned_context.md` si existe una entrada relacionada):

1. **`app/data/*.json` — trackeado en git.** Solo config/estado pequeño (KB, no MB). Si un
   archivo va a pesar más que unos pocos KB o va a cambiar todos los días (cache, logs,
   colas), no va aquí sin evaluar antes si necesita estar en git.
2. **Dentro del repo, pero en `.gitignore`** (patrón correcto para binarios runtime que el
   propio código regenera o que no aportan valor en el historial de git): `comprobantes/`,
   `contenido_video/`, `renders_etiquetas/`, `fichas_word/`, `backups_drive/`,
   `memoria_vectorial/`, `facturas_descargadas/`, `uploads/`, `Etiquetas Modelo SVG/`
   (495 masters .ai/.svg de etiquetas — leídos por `app/tools/etiquetas_ai_engine.py` /
   `etiquetas_svg_engine.py`), `IMAGENES_PRODUCTOS_CATALOGO/`. **Regla:** cualquier carpeta
   nueva en la raíz del repo que vaya a acumular binarios (imágenes, PDFs, .ai, video) debe
   agregarse a `.gitignore` en el mismo cambio que la crea — no después.
3. **Fuera del repo, en `~/Documentos/`** — solo para lo que un humano gestiona manualmente
   desde el explorador de archivos y que el código consume vía `Path.home()`. Hoy solo un
   caso: `~/Documentos/Etiquetas McKenna/Recursos PNG/ETIQUETAS STUDIO/` (biblioteca de PNG
   listos para imprimir del panel Diseño → Imprimir, ver
   `app/tools/etiquetas_studio.py::_carpeta_recursos_png()`). **Riesgo conocido:** el
   backend recrea esa carpeta vacía con `mkdir(exist_ok=True)` si no la encuentra, sin dar
   error — un borrado accidental desde el explorador de archivos (pasó el 2026-09-02) se ve
   igual que "no hay nada que mostrar", no como un fallo. Al añadir una carpeta nueva en
   este nivel, considerar que el código avise si aparece vacía inesperadamente en vez de
   fallar en silencio.

No mezclar los niveles 2 y 3 para el mismo tipo de dato: los masters de etiquetas (.ai/.svg)
viven en el repo (nivel 2) mientras que los PNG derivados para imprimir viven fuera (nivel 3)
— es una inconsistencia heredada, no un patrón a repetir para datos nuevos.

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
uploads/
Etiquetas Modelo SVG/ # 495 masters .ai/.svg — pesado, cambia seguido
IMAGENES_PRODUCTOS_CATALOGO/
facturas_descargadas/
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
     → Síntesis por defecto **Gemini 2.5-Pro** (API); Ollama local solo con `AGENTE_SYNTHESIS_PRIMARY=ollama` o fallback explícito (ver `.env.example`)
     → Enriquece con referencias PubMed + ArXiv
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

3. **Preventa sin respuesta genérica**: si Claude y Gemini fallan, se delega al grupo. Nunca se envía el fallback `"En breve nuestros asesores..."` al cliente.

4. **Confirmación de pagos corta**: comando `ok <3dígitos>` en lugar de `ok confirmado {número_completo}@c.us`.

5. **Sin sincronización SIIGO-stock**: SIIGO solo para facturación. El stock se alinea entre MeLi y la página web (API REST configurada), no desde SIIGO.

6. **Webhooks asíncronos**: todos los webhooks responden 200 inmediatamente y procesan en hilos daemon.

7. **Deduplicación de preguntas MeLi**: ventana de 5 minutos para evitar procesar la misma pregunta dos veces.
