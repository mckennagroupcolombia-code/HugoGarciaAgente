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
source venv/bin/activate && python3 scripts/generar_catalogo.py

# Puente WhatsApp (Node, puerto 3000)
cd bot-mckenna && npm ci && npm start
# Ruta única soportada del bridge: /home/mckg/mi-agente/bot-mckenna
# systemd (WhatsApp Node): sudo bot-mckenna/instalar_systemd.sh && systemctl enable --now mckenna-whatsapp-bridge
```

### ⚠️ Pendientes de contabilidad (corte 2026-09-10)

Antes de tocar contabilidad, leer **`docs/agentic/PENDIENTES-CONTABILIDAD.md`**: hay
huecos abiertos con plazo fiscal y cifras que todavía no son utilizables (Bancos sin
saldo inicial, $87,9M de pasivo con proveedores por conciliar, $3,1M de retefuente no
practicada, 48 facturas de agosto sin registrar en Siigo ni Alegra).

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
| 8081 | `agente_pro.py` | `agente-pro.service` — **la unidad viva**; `mckenna-agente.service` hace lo mismo y está deshabilitada a propósito (12-sep-2026: tener ambas enabled la dejó en `failed` por `Address already in use` desde el 8-sep, sin que nadie lo notara). Nunca habilitar las dos. |
| 8083 | `PAGINA_WEB/site/website.py` | `mckenna-website.service`. Al detenerse (stop, restart o caída) programa un chequeo 8 s después (`scripts/systemd/mckenna_web_respaldo_check.sh`): si sigue apagada, `mckenna-website-mantenimiento.service` (no habilitada; `scripts/servidor_mantenimiento.py`) sirve `PAGINA_WEB/site/mantenimiento/index.html` con **503 + Retry-After** en el mismo puerto (Cloudflare la deja pasar). Arrancar la web la apaga (`Conflicts=` + `After=`, solo en la unidad de la web). Mantenimiento planeado sin apagar: `touch PAGINA_WEB/site/data/MANTENIMIENTO` / `rm`. |
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
│   (generar_catalogo.py vive en scripts/ y app/tools/, no en la raíz)
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
│   │   ├── mensajeria_pagos.py   Envíos diarios + lotes de pago a transportadoras (ex Excel «ENVIOS INTERRA»)
│   │   ├── declarador.py          Socios: expediente fiscal + Declarador de activos digitales (Flujo Q)
│   │   └── google_services.py     Google Sheets: catálogo, fichas técnicas
│   │
│   ├── tools/
│   │   ├── memoria.py             SQLite + ChromaDB vectorial
│   │   ├── system_tools.py        Archivos, backups, scripts, email (restricción opcional de rutas)
│   │   ├── script_audit.py        Auditoría py_compile + manifiesto; usado por herramienta auditar_scripts
│   │   ├── backup_drive.py        Backup nocturno Drive/local + git push opcional + WA a GRUPO_ALERTAS_SISTEMAS_WA
│   │   ├── sincronizar_productos_pagina_web.py  Stock/precios hacia API tienda web (WEB_API_*)
│   │   ├── web_pedidos.py         Comandos WhatsApp grupo pedidos web (facturar / envío / entregado)
│   │   ├── guias_envio.py         Rótulos de envío en PDF (10x15 cm) para impresora térmica Vretti
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
├── app/tools/pipeline_contenido_facebook.py  Copy→Imagen→Voz→Video→Facebook (consola)
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

**Catálogo completo, con qué hace cada una y su default: `.env.example`.** Al agregar una variable
nueva, documentarla ahí (comentario en línea aparte: systemd no quita un `# comentario` al final).

Las que más cuestan si se tocan sin saber:
- `ANTHROPIC_API_KEY` (obligatoria, modelo por defecto de los canales) · `GOOGLE_API_KEY` (red de seguridad Gemini).
- `CHAT_API_TOKEN` (Bearer de `/chat` y `/api/*`) · `ADMIN_TOKEN`.
- `LLM_BUDGET_DIARIO_USD` / `LLM_BUDGET_TOPE_USD` / `LLM_BUDGET_BATCH_*` — ver la regla obligatoria abajo.
- `ALEGRA_ESPEJO_ACTIVO` — **en 1 desde el 2026-09-14** (el contador arma el 350 con lo que ve en Alegra).
- `CONTABILIDAD_LEDGER_BUDGET_S` / `_MAX_PAGINAS` / `_MAX_PAGINAS_MELI` — defaults del panel; un
  **backfill** necesita subirlos (1800 / 500 / 300) o postea un período a medias que parece completo.
- Banderas de modo sombra (default 0): `PRESTAMOS_DOC_SOPORTE_ACTIVO`, `PAGOS_DOC_SOPORTE_ACTIVO`,
  `COMPRAS_SOCIOS_DOC_SOPORTE_ACTIVO`, `MELI_AUTOFACTURA_ENTREGA_ACTIVO`. Encenderlas emite documentos reales a la DIAN.
- Grupos de WhatsApp por área: `GRUPO_*_WA`; inventario oficial en `app/data/grupos_whatsapp_oficiales.json`.

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
| Cron pagos préstamos | `scripts/prestamos_recordatorio_cron.py` | Día 5 (configurable); un ticket mensual a despachos con las cuotas del mes. Idempotente por período. |
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

**Registro durable (24-sep-2026, «Del chat al registro»):** cada comprobante y cada ok/no queda en
`app/services/pagos_clientes.py` → `app/data/pagos_clientes.db` (gitignored): cliente, hora, imagen,
monto detectado y QUIÉN decidió (el puente ahora manda `author` en los comandos de grupo). Al arrancar,
`routes.py` reconstruye `pagos_pendientes_confirmacion` desde ahí (un reinicio ya no borra pendientes;
72 h sin decisión → `vencido`). Bandeja: `GET /api/tickets/pagos-clientes` → tarjeta «Pagos de clientes»
en la Agenda (`PagosClientes.tsx`, solo aparece si hay filas).

**Comandos y grupos cuentan y quedan (mismo cambio):**
- Un comando o mensaje del equipo en un grupo oficial se anota como actividad suya
  (`pagos_clientes.registrar_actividad_wa` → `panel_eventos_operativos`, panel `whatsapp`, tipos
  `comando_wa`/`wa_grupo`) y **suma al control de horas**. Solo en tiempo real (±10 min): un sync
  viejo no falsea horas. El mapeo es por `usuarios.telefono`.
- **Espejo de grupos**: `server.js` (`GRUPOS_ESPEJO`, ampliable con `GRUPOS_ESPEJO_WA`) manda cada
  mensaje de los grupos oficiales al ingest del panel → `wa_chats.db` con `enviado_por` = teléfono del
  autor; en Agenda → Mensajes los grupos salen con su nombre (`wa_chats.nombre_grupo`). El «ya» del
  grupo ya no se evapora. ⚠️ `mensajeAPayloadHistorial` sigue rechazando grupos a propósito (clientes);
  el espejo usa su propio payload SIN `sender_phone` (con él, el mensaje caería al 1:1 del autor).
- Al cerrar cualquier tarea el panel pregunta «¿Cuántas quedaron?» (opcional; empaque sigue obligatorio).
- El aviso «ya quedó» al que pidió algo ya existía: `tickets_notificaciones.notificar_ticket_resuelto`.

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

### N. Socios, familiares y terceros — quién es quién

Cuatro relaciones distintas alrededor de McKenna, con tratamiento contable distinto:

| Relación | Qué hace | Cuenta |
|---|---|---|
| **Socios** (Armando, Cynthia) | Compran en Amazon con **tarjeta personal**, traen a título personal y le venden a la empresa, que reintegra | **2380** |
| **Socios** | Cuota de manejo 5% por conseguir la mercancía | 2380 contra costo |
| **Familiares por servicios** | Prestación de servicios | 5135 (retención de **servicios**, no el 7% financiero) |
| **Familiares prestamistas** | Solo consignaron dinero a la cuenta de la empresa | **2295** (Flujo M) |

El mecanismo de los socios existe porque los productos son pequeños y el volumen
residual no justifica una importación formal. **Clave para la conciliación:** el
banco de McKenna NO se mueve cuando el socio compra (esa plata sale de su tarjeta);
se mueve **al reintegrarle**. Esa es la línea que aparece en el extracto.

**Asiento (corregido sep-2026, `contabilidad_autopost._lineas_compra_socio`):**
`Débito 1435 (mercancía + flete + cuota) / Crédito 2365 (retención si aplica) /
Crédito 2380 (neto al socio)`. **No toca Bancos** — el banco se mueve al reintegrar.

⚠️ **Límite aduanero:** esa mercancía no entró por importación ordinaria, así que **no
hay IVA descontable ni aranceles deducibles** (Art. 485 E.T.) y el documento soporte
**no sanea** el estatus aduanero. Ver la ficha antes de proponer nada al respecto.

**Reintegro al socio:** `compras_socios.registrar_reintegro()` — `Débito 2380 / Crédito 1110`.
Es **la única línea de esta operación que aparece en el extracto** y la que se concilia; devuelve
`cc:<id>` para `extracto_bancario.vincular()`. Panel: Préstamos → «Cómo funciona».

**Retención:** `app/services/retenciones.py` (tarifas, cuantías mínimas, UVT por año —
UVT 2026 = $52.374, Res. DIAN 000238/2025). Compras: mínimo **10 UVT desde 2026**
(27 UVT hasta 2025; `retenciones.MINIMO_UVT_DESDE`). Explicación viva en /app → Préstamos → «Cómo funciona».
Ficha completa: `docs/agentic/modules/relaciones-socios-terceros.md`.

### O. Solicitudes de pago con asiento automático

**Detalle completo, historia y casos: `docs/agentic/modules/pagos-solicitudes.md`** (leerla antes
de tocar `pagos_wizard.py`, `pagos_proveedor.py`, `doc_soporte_pagos.py`, `impuestos_por_cuenta.py`
o retenciones).

```
/app → Contabilidad → Solicitudes de pago   (PagosWizardPanel.tsx, app/services/pagos_wizard.py)
  borrador → pendiente → aprobada (nace el asiento + espejo Alegra) → en_banco → pagada (con comprobante)
```

Reglas que no se rompen:
- **Lo que se deja como paso manual posterior, no se hace**: el asiento nace al **aprobar**; el
  documento soporte se emite al aprobar; el pago en Alegra se registra al confirmar el giro.
- **La cuenta del PUC decide el impuesto** (`impuestos_por_cuenta.py`), no un botón; el perfil
  tributario vive en el **tercero** (`cc_terceros`: `retefuente_exento`, `regimen_simple`,
  `ica_por_mil`, `retencion_asume_mckenna`, `emite_doc_soporte`). El wizard **informa** los
  impuestos, no los pregunta; «Ajustar» solo para gross-up / ICA de otro municipio / GMF.
- **Renta e ICA son independientes**; solo Régimen SIMPLE (Art. 911/907 E.T.) apaga los dos.
- **Gross-up solo si está pactado** en la ficha (`retencion_asume_mckenna`), validado en backend.
- **Tres personas, dos tokens**: quien aprueba prepara en el banco; el otro admin confirma con la
  captura. `montar_en_banco()` / `confirmar_pago()` lo exigen en backend. `aprobar()` no
  contabiliza dos veces: la guarda es tener `movimiento_id`.
- **Compras**: se contabilizan con la cotización, renglón por renglón a 1435, **IVA a 240810**
  (nunca a inventario), IVA del documento (el del catálogo Alegra no sirve) y `total_documento`
  debe cuadrar para aprobar. Combos (`C-…`) fuera del picker.
- **Una compra se solicita como copia fiel de la cotización/proforma** (24-sep-2026,
  `pagos_proveedor.validar_compra`, en crear · enviar · aprobar): todos los renglones, cada uno un
  producto **activo en Alegra** (no combo, no renglón sin SKU) y `total_documento` obligatorio y
  cuadrado al peso. Se acabaron `productos_opcionales` y «Agregar … sin referencia»: lo que no está
  en el catálogo se crea antes en «Crear en Alegra». Un borrador puede guardarse a medias.
- **Documento soporte** (plantilla 10 DSMG, `PAGOS_DOC_SOPORTE_ACTIVO`): solo a personas naturales
  no obligadas a facturar; cuenta vía `alegra_espejo.cuenta_alegra()`; ReteICA dentro del documento.
  Con documento soporte el asiento **no se espeja** (duplicaba el gasto en Alegra). Nace BORRADOR al
  aprobar y se transmite con el botón **«Emitir a la DIAN»** (Administración); todo al peso; nunca PUT a /bills.
  ⚠️ **Un PUT a Alegra reemplaza, no es parcial** (reenviar el documento entero); el documento
  congela una foto del proveedor; personas naturales van como **NIT con DV**, no CC.
- ⛔ **Fecha de corte contable** `CONTABILIDAD_FECHA_CORTE` (default **2026-09-01**): lo anterior es
  del contador. `espejar_movimiento()` devuelve `bloqueado_por_corte` (`forzar` NO lo salta) y
  `auto_postear_periodo()` recorta el rango.
- ⛔ **Registro de facturas de compra APAGADO** (`FACTURAS_COMPRA_REGISTRO_ACTIVO=1` lo reactiva);
  la **descarga de XML sigue viva** porque alimenta `perfil_tributario_dian.py` (O-15/O-47), que
  **propone, nunca aplica**.
- Mensajería (Fidel Rocha): **523550 + retefuente 1 % + ReteICA 4,14 ‰**; desmarcado de SIMPLE,
  falta su RUT.
- Otros módulos del mismo ciclo: `terceros_historial.py` (append-only), `contabilidad_mayor.libro_diario()`,
  `pagos_impuestos.py` (recibos del contador → 2365/2367/2368…, no es gasto),
  `puc_colombia.DESCRIPCIONES` (guía de las 79 cuentas; test exige que ninguna quede sin guía).

### Mi mes en el panel (ficha de rendimiento, 23-sep-2026)
En la Agenda, cada persona ve sus horas del último mes, sus funciones (veces, promedio por vez, horas) y el tipo
de trabajo, y abre «Ver mi ficha» en letra grande (`MiRendimiento.tsx` → `GET /api/tickets/rendimiento`,
`app/services/rendimiento.py`, sin LLM). Administración ve la de cualquiera. **No muestra pagos ni valoraciones.**
Solo cuenta lo registrado en el panel; el desarrollo con IA y el trabajo físico sin tarea abierta no suman.

### Mapa de funciones (RRHH, 23-sep-2026)
/app → RRHH · Compensaciones → «Mapa de funciones»: persona × etapa en vivo (horas, veces, promedio por vez,
valor = horas × tarifa del nivel N1–N5), horas que cubre el pago, comisión de WhatsApp y **valor de mercado en
honorarios** (`mapa_funciones.honorario_equivalente`). Pagos, propuestas, tarifas y mercado en
`app/data/rrhh_valoracion.json` (**fuera de git: salarios**). Rutas `/api/rrhh/mapa-funciones*` (permiso rrhh).

### Control de horas por quincena (23-sep-2026)
Honorarios con **dedicación pactada** (camino A): horas por quincena = pago quincenal ÷ valor hora de mercado (÷ **159 h/mes**,
las efectivas de un tiempo completo con 42 h/semana; no 210, que incluye domingos pagados; festivos en `festivos_co.py`, sin meta) de su
labor. «Mi quincena» en la Agenda y «Control de horas» en RRHH (`app/services/control_horas.py`). Horas activas por
bloques de 15 min sin doble conteo (panel + cronómetro + sesiones de IA de `RENDIMIENTO_SESIONES_IA`) + tiempo
explicado y aprobado (máx. 6 h/semana). Horas de más × valor hora = cuenta de cobro. **Nunca** poner horario de
entrada/salida: es subordinación y convierte la prestación de servicios en contrato laboral.
**Regla visible para todos:** se pide completar las horas convenidas, no rapidez; lo que se haga después son horas
adicionales **al mismo valor hora** (son honorarios, no horas extra laborales: sin recargo). Quien atiende colectas de MeLi
(`colectas: true` en la persona; hoy Jenniffer, Stella y Victor) debe estar **disponible de lunes a viernes**: es la
disponibilidad que el servicio exige, no un horario; a esas personas no se les dice que repongan horas «cualquier día».
Cocinar el almuerzo del equipo (Víctor) sí cuenta como actividad del servicio. **Detalle por día** (`control_horas.detalle_dia`, `GET /api/tickets/control-horas/dia?fecha=`): tocar un día en «Mi
quincena», en la ficha o en RRHH abre `DiaDetalle` — tramos con hora, qué se hizo (tarea con cronómetro y su resultado,
panel y nº de acciones, desarrollo con IA), ratos sin registro que no cuentan y lo que quedó terminado. Sale de
`_fuentes()`, la misma función del total: el detalle y la suma no pueden divergir (hay test). Abrir **Juegos** no cuenta
(`PANELES_DESCANSO`). Resumen semanal por WhatsApp: `scripts/resumen_semanal_horas_cron.py` (viernes 17:30, solo envía con `RESUMEN_HORAS_WA_ACTIVO=1`). Los **tiempos estándar** (`tiempos_estandar.py`, mediana de lo
cronometrado, ≥5 muestras; **nunca tiempos estimados a mano**: un ticket sin cronómetro cuenta su huella real, minutos desde la
acción anterior, máx. 30) y las «horas a tiempo estándar» son solo referencia de administración, no se muestran a la persona.

### Colaboradores (diagramas compartidos, 21-sep-2026)
Armando + colaborador externo (Sebastián) editan diagramas de flujo desde el celular (React Flow),
versionados, con exportación Archify. Perfil `colaborador_externo` = lista blanca: solo Colaboradores y
Agenda con Armando. **Recibe otra aplicación** (`desktop/dist-colab/`, build `vite.colab.config.ts`, compilado por
`npm run build`) y tiene su propia APK (`android-colab/`); los `.map` del panel no se entregan a nadie. Perfil `contador` (William) = consulta del Libro Mayor + comentarios en historial de
terceros. **Detalle: `docs/agentic/modules/colaboradores.md`.**

### Q. Socios dentro de la contabilidad + Declarador (expediente fiscal personal)

```
/app → Contabilidad → Libro Mayor  (LibroMayorPanel.tsx, reorganizado sep-2026; orden cambiado 17-sep)
  ├─ Ámbito EMPRESA — abre en el libro, no en la conciliación:
  │    1 Libro Mayor  PUC con saldos (MayorCuentasPanel: resumen por clase, árbol con terceros
  │                   desplegables, vista «Por tercero», extracto) · balance · asientos · cuentas T · informes
  │    2 Registrar    acciones rápidas (ingreso, egreso, compra/pago socio, proveedor, aporte) + asiento manual
  │    3 Conciliar banco  wizard de 4 pasos (cargar extracto → emparejar → clasificar → verificar)
  │    4 Configurar   plan de cuentas · terceros · créditos adquiridos
  │    (claves localStorage `-v2` para que nadie siga aterrizando en Conciliar)
  └─ Ámbito SOCIOS (= sección Contabilidad → Socios; SociosPanel.tsx) — wizard de 7 pasos por socio:
       1 Empecemos: cuestionario interactivo de 5 preguntas (cripto, declaró antes, desde qué año,
         otras plataformas, préstamos con familia) + cédula. No pide nada más; lo ya cargado se deduce
       2 Plan de carga: qué documentos pide ESE caso, cómo conseguirlos, cuántos tiene vs. el socio de
         referencia («así lo hizo Armando», solo conteos), carga por renglón/año, «no aplica»,
         y botón para crear la carpeta del socio en el Declarador con la estructura de Armando
       3 Extractos personales (tercero_id en extractos_bancarios; cobertura por mes con huecos)
       4 Cuenta con McKenna (CuentaSocioPanel embebido)
       5 Cruces socio ↔ empresa (banco personal vs banco/libro de McKenna, ±1 COP, ±3 días)
       6 Activos digitales — Declarador: años gravables (F210 declarado vs efecto cripto FIFO),
         documentos por categoría, pendientes con clave estable, agente con herramientas
       7 Cierre: resumen copiable para el contador

       7 Cierre: **expediente para el contador** — línea de tiempo año por año (qué se
         declaró · qué pasó · qué cuesta corregir · soportes con su ruta) y **descarga en PDF**
         (`GET /api/socios/<id>/informe.pdf`, `app/tools/declarador_pdf.py`). La carpeta del
         socio se normaliza con `organizar_carpeta()`: subcarpetas numeradas
         (`01_Declaraciones_Renta_F210/`, `05_Certificados_Tributarios_Banco/2024/`…),
         nombres legibles (`F210_2021.pdf`, `Tarjeta_8017_2025-04.xlsx`) y `LEEME.md`;
         nunca toca `Calculos/` ni `Para_Contador/`.

app/services/declarador.py     tablas dl_* en contabilidad.db; importar_carpeta() lee SOLO
                               /home/mckg/Declarador/<Nombre>/ (DECLARADOR_DIR; Calculos/ y
                               Para_Contador/ de Armando están enlazados dentro de Armando/); agente
                               Claude tool-use con llm_budget (contexto «declarador»)
app/routes_declarador.py       /api/socios/* — cada socio ve SOLO su expediente; solo la cuenta
                               `admin` real (o CHAT_API_TOKEN crudo) ve todos
```

**Por qué existe:** la conciliación de criptoactivos de Armando (Binance 2020-2025, F210 2020-2024,
exógena, extractos) se hizo en agosto de 2026 con un agente de terminal en `/home/mckg/Declarador`
y quedó en markdown y CSV. La contabilidad del socio está pegada a la de la empresa (reintegros
de compras con tarjeta personal, préstamos, cuota de manejo), así que ahora vive **dentro** del
Libro Mayor: el socio carga sus extractos aquí (más datos para cruzar) y la declaración se sigue
construyendo en el panel. **El banco personal de un socio nunca entra a la conciliación de la
empresa** (`_filtro_titular` en `extracto_bancario.py`); solo se cruza con ella en el paso 4.
Ficha: `docs/agentic/modules/contabilidad.md` → «Socios dentro de la contabilidad».

### P. Agente de ventas v2 (WhatsApp + chat web) con supervisión

Reemplaza, detrás de banderas, la cadena de ~70 interceptores regex + LLM sin herramientas
que atendía WhatsApp y la burbuja web (auditoría 4–11 sep-2026: repreguntas, "lo confirma un
asesor" con precios existentes, respuestas dobles, bot hablando encima del asesor).

```
app/agent/ventas_wa/
  catalogo.py      precios de la PÁGINA WEB (cache.json + stock_web.json) — decisión del negocio
  pedido.py        pedido por cliente en SQLite (ventas_wa.db; sombra → ventas_wa_sombra.db),
                   código WEB-XXXXX para continuar por WhatsApp, historial propio del chat web
  historial.py     WhatsApp lee wa_chats.db (incluye lo que escribe el asesor desde el teléfono);
                   NO usa la memoria legacy conversaciones_whatsapp.sqlite3 (mezcla web + WA)
  herramientas.py  buscar_producto, ficha_producto, actualizar_pedido, guardar_datos_cliente,
                   ver_pedido, consultar_pedido_web, pasar_a_asesor (WA) /
                   llevar_al_carrito + continuar_por_whatsapp (web)
  agente.py        Claude con tool-use; cada llamada pasa por llm_budget
  supervisor.py    nivel 1 reglas (precios respaldados, sin datos de pago, sin repreguntar) +
                   nivel 2 revisor IA (claude-haiku-4-5) solo en respuestas de riesgo;
                   UNA corrección por turno, si falla → respuesta segura + aviso
  entrada.py       /whatsapp (agrupa ráfagas 6 s, se calla 12 h tras mensaje de un asesor,
                   adopta pedidos WEB-XXXXX) y /chat web (atender_web)
app/services/auditor_canales.py + scripts/auditor_canales_cron.py   nivel 3: cada 30 min sin IA
                   (clientes sin respuesta, pedidos listos sin cerrar → re-alerta, puente, presupuesto)
                   y 19:00 auditoría IA de una muestra que PROPONE mejoras
```

- **El bot NO cierra la venta:** arma el pedido y manda la tarjeta por mensaje directo a
  `WA_V2_ALERTA_DESTINO` (default +57 318 243 2463) **desde la cuenta supervisora**
  (bot-supervisor :3001, número 573196529076, `herramientas.enviar_alerta_asesor`) para que
  no se confunda con los chats de clientes; si el supervisor cae, respaldo por el puente
  principal :3000. El asesor confirma
  total, comparte datos de pago y cierra. Pedidos agrupados en /app → Agente WA → **Pedidos IA**.
- **Web:** si todo está disponible, el agente mete los productos en el carrito del visitante
  (lo aplica `website.py::_aplicar_acciones_chat` en la sesión) y la burbuja muestra
  "Ver carrito y pagar"; si no, botón "Continuar por WhatsApp" con el código del pedido.
- **Banderas:** `WA_AGENTE_V2` y `WEB_AGENTE_V2` = `off | sombra | activo`. En sombra el flujo
  legacy responde y v2 solo deja borradores (panel → Pedidos IA → Sombra). Desde 2026-09-11 ambas
  en `sombra`. Presupuesto autorizado por el usuario ese día: `LLM_BUDGET_TOPE_USD=5.0`,
  `LLM_BUDGET_DIARIO_USD=3.0` en `.env`.
- **Nunca** cambiar `os.environ` en caliente para elegir la base: `pedido.usando_modo()` (ContextVar)
  — el servidor es multihilo y otro hilo podría leer "activo" y responderle de verdad a un cliente.
- `wa_bot_detect.parece_respuesta_bot` ya no marca como bot los mensajes con "veci": el asesor
  también lo escribe, y ese falso positivo hacía creer que nadie humano atendía el chat.

### R. Ventas directas por WhatsApp (cotizar y facturar desde /app)

```
/app → Facturación → Cotizar/Facturar   (CotizarFacturarPanel.tsx, wizard de 5 pasos)
  1 Origen    ⚡ pedido del agente IA (ventas_wa, solo modo activo) → salta a Revisar
              🪄 chat de WhatsApp (extracción con IA, llm_budget) · ✍️ desde cero · ventas recientes
  2 Cliente   buscador de contactos Alegra; cédula/NIT obligatoria solo para facturar
  3 Productos precio sugerido = WEB (decisión 11-sep), MeLi de referencia; IVA por línea; envío sin IVA
  4 Revisar   base / IVA / total calculados en el backend
  5 Acción    Cotizar (PDF + cotización en Alegra + WhatsApp) · Facturar (DIAN, doble confirmación)

app/services/ventas_directas.py   SQLite app/data/ventas_directas.db (gitignored)
                                  borrador → cotizada → facturando → facturada (o anulada)
app/routes_ventas_directas.py     /api/ventas-directas/*, permiso `cotizar-facturar` o admin
```

**Por qué (16-sep-2026):** Jenniffer cotizaba en la interfaz de Alegra y el IVA salía dos veces.
**La lista de precios de Alegra guarda el precio FINAL con IVA** (`precios_canales` y `precios_trm`
le copian el de MeLi) y cada ítem trae además IVA 19%: la interfaz de Alegra toma ese precio como
base y le vuelve a sumar el impuesto (LECITINA SOYA 500g: lista $19.800 → sugiere $23.562). Las
facturas por API no sufren esto porque `crear_factura_venta_alegra` saca el IVA antes
(`_precio_base_con_impuesto`); `ventas_directas.crear_cotizacion_alegra` hace lo mismo con
`POST /estimates` y avisa si el total de Alegra difiere más de $5 del de la app. **No cotizar ni
facturar a mano en Alegra mientras la lista siga con IVA incluido.** Cambiar la lista a precios
base es la corrección de fondo, pero toca todo lo que lee `price` de Alegra como precio final
(precios_canales, precios_trm, rentabilidad, picker del panel) — decisión pendiente.

**Venta de MeLi con RUT (22-sep-2026):** empresas compran en MeLi y mandan el RUT para que la
factura salga a su nombre; MeLi no da correo ni teléfono. En el paso 1, «Venta de Mercado Libre»
(`GET /api/ventas-directas/meli/<pack u orden>`) trae comprador (billing_info) y productos y deja
`origen=meli`, `origen_ref=pack_id`. Al facturar se aplican las barreras de «Facturar ahora»
(registro local, documento fiscal en MeLi, factura en Alegra por `purchase_order`), la factura
sale con `purchase_order=pack_id`, el PDF se sube a MeLi y las órdenes quedan `facturada` en
`meli_facturas_entrega.json` — así ninguna de las dos vías emite otra. El **WhatsApp del cliente
es opcional** (antes era obligatorio: el operador ponía «.» y cotizar/facturar fallaba con
«Teléfono inválido»). **Tipo de documento:** `identificacion_fiscal()` manda NIT/CC a Alegra
(selector en el paso 2, o deducido por nombre de empresa / forma de NIT) y comprueba el DV; sin
esto Alegra adivinaba por longitud y EQUISURE S.A.S (FE465) quedó como CC.

**Comisión WhatsApp (23-sep-2026):** `comisiones_mes()` / `GET /api/ventas-directas/comisiones` — 3 %
(`VENTAS_DIRECTAS_COMISION_PCT`) sobre productos sin IVA ni envío de las ventas facturadas del mes, a quien
creó la venta; excluye origen `meli`. Chip en la barra del módulo y detalle en «Ventas recientes».

Facturar marca la venta `facturando` **antes** de llamar a Alegra (un segundo clic o una pestaña
duplicada no emite otra factura) y la devuelve a su estado si Alegra falla. Un pedido IA facturado
se cierra en `ventas_wa`. Los endpoints viejos `/api/facturacion/cotizar` y `/facturar-directo`
siguen vivos (el segundo ahora sí pasa `medio_pago`), pero el panel ya no los usa.

### K. Pagos de mensajería (ex Excel «ENVIOS INTERRA»)

Origen: TKT-2026-1219 — despachos (Jenniffer) llevaba en un Excel aparte un renglón por día con
la cantidad de envíos, el enlace a la factura de guías de Interrapidísimo y el valor, y pedía la
aprobación del pago abriendo un ticket a mano. Ahora vive en el panel:

```
/app → Contabilidad → Operativos → Mensajería   (desktop/src/components/MensajeriaPanel.tsx)
  ├─ Un renglón por día: fecha · cantidad de envíos · enlace de guías · valor · nota
  │    (días sin despacho — "domingo", "no salen" — se registran con valor 0)
  ├─ "Importar del Excel": pegar las filas tal cual; las que decían CANCELADO con su fecha de
  │    pago se agrupan como lotes ya pagados y conservan el histórico
  ├─ Seleccionar días pendientes → lote de pago + ticket de aprobación automático
  │    (categoría logistica, asignado al usuario de `MENSAJERIA_APROBADOR`, default `armando`)
  └─ Registrar pago: fecha, banco, referencia, monto y comprobante adjunto

app/services/mensajeria_pagos.py   tablas `mensajeria_envios` / `mensajeria_lotes` en
                                   contabilidad.db; comprobantes en comprobantes/mensajeria/
contabilidad_ledger._egresos_mensajeria   lote pagado SIN solicitud → fuente "mensajeria_pago" en
                                   Ingresos/Egresos → autopost al Libro Mayor (PUC 5135)
```

**Unificado con Solicitudes de pago (15-sep-2026):** en cada lote «solicitado» hay un selector de
tercero (la transportadora en el Libro Mayor, creable ahí mismo) y el botón **«Pasar a Solicitudes
de pago»** → `mensajeria_pagos.solicitar_pago_wizard()` crea la solicitud (`flete_transporte`,
513550, `origen_ref="mensajeria:<lote>"`) y guarda `solicitud_pago_id` en el lote. Desde ahí el pago
sigue el camino único: aprobar (nace el asiento) → montar en el banco → confirmar con el segundo
token y el comprobante. Al confirmarlo, `pagos_wizard._avisar_al_origen()` marca el lote como pagado
y le copia el comprobante (despachos no entra a Contabilidad). **Un lote con `solicitud_pago_id` ya
no se postea por `_egresos_mensajeria`** — el asiento lo hace la solicitud y contarlo dos veces
duplicaría el gasto. El ticket suelto de aprobación sigue disponible como «Solo pedir aprobación»,
sin asiento, para casos que no pasen por contabilidad.

Permiso: `mensajeria`, heredado también de `servicios`, `operativos` o `pedidos` — el registro lo
lleva despachos y la aprobación administración (ver `desktop/src/lib/contabilidadAccess.ts`).

### L. Guías (rótulos) de envío para impresora térmica

Reemplaza el formato en Excel/Word que despachos llenaba a mano para pegar en la caja. La
impresora es una **Vretti térmica, rollo de 10x15 cm** (también hay 10x10 y 5x7,5 en
`guias_envio.TAMANOS`).

```
/app → Atención → Guías de envío   (desktop/src/components/GuiasEnvioPanel.tsx)
  ├─ "Desde pedidos": pedidos de la tienda web (orders.db) y despachos de WhatsApp
  │    (despachos.db) de los últimos 15 días, con dirección ya cargada → marcar → PDF
  ├─ "Envío suelto": formulario en blanco para lo que no viene de un pedido
  ├─ "Remitente": datos de McKenna que salen abajo (app/data/remitente_envios.json)
  └─ Historial con reimpresión (tabla `rotulos_envio` en app/data/despachos.db)

POST /api/guias/rotulos → registra los rótulos y devuelve la URL del PDF
GET  /api/guias/rotulos.pdf?ids=1,2&tamano=10x15 → PDF, una página por paquete
POST /api/guias/previsualizar → PDF de prueba (no registra nada) para la vista previa
GET  /api/guias/conteo?fecha=YYYY-MM-DD → rótulos impresos ese día
```

El PDF lo arma ReportLab (`generar_pdf`) en **bandas de altura fija** (encabezado ·
destinatario · remitente · pie), no en flujo continuo: dos paquetes con datos de distinto largo
salen iguales y la dirección queda siempre a la misma altura. Encabezado con el **logotipo**
(`LOGOTIPO TURQUESA.png` pasado a negro con su canal alfa, cacheado en `_logo_negro()` — si se
convierte por rótulo, un lote de 20 pesa ~16 MB) y el lema **«Proveemos a tus ideas»**;
destinatario; remitente con la identidad fiscal de `app/services/empresa.py`; pie con piezas,
peso, transportadora y código de barras Code128 (guía o referencia del pedido).

**No lleva contenido ni valor declarado** (`normalizar_datos` los descarta a propósito): el
rótulo va pegado por fuera de la caja y detallar qué hay dentro y cuánto vale es justo lo que no
conviene en un paquete que viaja. `POST /api/guias/previsualizar` devuelve el mismo PDF **sin
registrar el rótulo** — es lo que muestra la vista previa del panel, así que no puede divergir de
lo que se imprime.

**MeLi queda fuera a propósito:** esas ventas viajan con la etiqueta que genera Mercado Libre
(Colecta/Flex); un rótulo propio no la reemplaza.

**Enlace con Flujo K:** `GET /api/guias/conteo` alimenta la sugerencia "N rótulos impresos ese
día — usar" de la casilla *envíos* en Operativos → Mensajería, para no contar paquetes a mano.

Permiso del panel: `guias-envio`, heredado de `pedidos` o `empaque` (`App.tsx::puedeVerPanel`).

### S. Grabar pantalla → fragmentos → WhatsApp (bridge supervisor)

```
/app → Contenido → 🔴 Grabar pantalla   (GrabacionPantalla.tsx; también en Sistemas → Supervisor WA)
  1 Elegir pantalla/ventana/pestaña (getDisplayMedia) + audio de la pestaña y/o micrófono
    (mezclados con AudioContext en una sola pista)
  2 Opcional: arrastrar sobre la vista previa la SECCIÓN a enviar (recorte en píxeles)
  3 MediaRecorder sube un trozo cada 2 s → POST /api/grabaciones/<id>/trozo (en orden, con reintento)
  4 Detener → /finalizar: remux `-c copy` (el WebM de MediaRecorder no trae duración ni índice)
  5 Editor: marcar inicio/fin (teclas I / O), «Ver fragmento», cambiar la sección → «Sacar fragmento»
     → ffmpeg en hilo: corte + crop + H.264/AAC, bitrate calculado para quedar < 15 MB
  6 Enviar → bridge supervisor :3001 POST /enviar-video {numero, filePath, caption}
```

`app/tools/grabacion_pantalla.py` + `app/routes_grabaciones.py`; archivos en `grabaciones_pantalla/<id>/`
(gitignored). Mismo bridge y selector de contactos que «Enviar Voz» (`SupervisorDestino.tsx`).
**Por qué por trozos:** una subida única al final choca con `MAX_CONTENT_LENGTH` (48 MB) y con el corte
de 100 s de Cloudflare, y si la pestaña se cierra se pierde todo; así lo grabado ya está en el servidor
(«Recuperar» cierra una grabación interrumpida). El recorte se aplica al cortar, no al grabar, para poder
cambiar la sección después. `/enviar-video` solo lee MP4 dentro de `grabaciones_pantalla/`. Sin LLM.
Requiere Chrome/Edge por https o localhost (por IP de la LAN el navegador bloquea getDisplayMedia); en
Linux el audio de la pantalla completa no siempre llega — compartir una **pestaña** con su audio.

### T. Entregas Flex de MeLi (horas de reparto, evolución semanal)

```
scripts/entregas_flex_cron.py  (23:15 diario, job "entregas_flex" en Tareas Programadas)
  └─ app/services/entregas_flex.py::sincronizar(dias=10)
       ├─ /orders/search paid (paginador propio con reintentos, ver abajo)
       ├─ GET /shipments/{id} → logistic.type == "self_service" (Flex), localidad, fecha prometida
       ├─ GET /shipments/{id}/history → impreso / salida (date_shipped) / entregado
       └─ app/data/entregas_flex.db (gitignored): solo consulta envíos nuevos o abiertos
/app → Atención → Entregas Flex  (EntregasFlexPanel.tsx) — lee /api/entregas-flex/resumen, sin llamar a MeLi
```

Todas las horas se guardan en hora de Bogotá (MeLi responde en -04:00). Las comparaciones son
últimas 4 semanas vs. las 4 anteriores; «patrones» solo avisa cambios de ≥15 min o ≥5 puntos.
Corte del mismo día: `ENTREGAS_FLEX_CORTE_HORA` (decimal, default 12.33 = 12:20, medido en el
estudio del 17-sep-2026). Backfill: `scripts/entregas_flex_cron.py --dias 90 --forzar`. Sin LLM.
⚠️ No usa `meli.listar_ordenes_meli_por_estado`: esa función corta la paginación en silencio ante
un error de red (18-sep-2026: la misma llamada devolvió 1.797 y luego 700 órdenes de 30 días).

### U. Mapa del sistema y anatomía de combos (dónde se rompe la cadena de un producto)

```
/app → Agenda → Mapa · Inventario → Mapa del sistema   (MapaSistemaPanel.tsx; también en Sistemas)
  ├─ **La aplicación como diagrama de flujo navegable** (MapaAppFlujo.tsx): los 61 paneles reordenados por la
  │    SECUENCIA del negocio —abastecer → preparar → publicar → vender → entregar → facturar → contar, más
  │    Dirigir y Sistema que las acompañan— con lo que cada etapa tiene detenido ahora. Etapa → tramos en
  │    orden → panel (abre de verdad) o diagrama de Archify. Estructura: `desktop/src/lib/flujoApp.ts`
  ├─ Cadena del producto, con conteos vivos (refresco 30 s): combo en Alegra → documento técnico
  │    → código EAN → diseño de etiqueta → publicación. Cada caja: cuántos pasan, cuántos se quedan y por qué
  ├─ «Documentos sin combo»: fichas escritas que ninguna receta usa (el caso propionato de calcio)
  ├─ «Unir por SKU»: revisión en lote para escribir `referencia` en los documentos que hoy se unen por nombre
  ├─ Ciclo de la solicitud de pago (5 estados, quién actúa en cada uno) y conexiones externas
  └─ «Los flujos del proyecto»: toda la lógica en diagramas de Archify con un mismo lenguaje (una franja por
       persona o sistema, tiempo de izquierda a derecha): mapa global + pago, producto, tres canales de
       venta, contabilidad y procesos. Incrustados e interactivos; fuentes en docs/arquitectura/*.json
/app → Inventario → Combos             (CombosPanel.tsx) — la «fotografía» de cada combo:
       inventario (su receta: materia prima, bolsa, envase, tapa, etiqueta, cuchara…) + equipamiento
       (documento, EAN, etiqueta, publicación). Una ranura vacía dice por qué y trae el botón que la destraba

app/services/mapa_producto.py   solo lectura salvo `fijar_sku_documento()`; sin LLM, sin llamar a Alegra ni MeLi
app/services/mapa_app.py        bloqueos por etapa: junta señales que cada módulo YA produce (checklist contable,
                                resumen de pagos, matriz de productos, caché de inventario, orders.db). No calcula nada nuevo
app/routes_mapa_sistema.py      /api/mapa-sistema/* — administrador, o permiso `mapa-sistema` / `combos`
```

**El modelo (no redescubrirlo):** en Alegra conviven el **producto de inventario** (`AMICREMONg`,
materia prima) y el **combo de venta** (`type=kit`, `C-CREMON500g` = gramos + empaque + etiqueta). El
documento técnico describe la **materia prima** y el combo lo **hereda por su receta**; el EAN nace del
**SKU de venta**; la etiqueta se une por **código de barras**. Por eso `documento.referencia` nunca
coincide con el catálogo web (que lista combos): es por diseño. Las reglas de qué es empaque y cómo se
empareja un documento viven en `scripts/auditar_catalogo_combos.py`; el servicio las importa, no las repite.

**Por qué el propionato de calcio no tenía etiqueta:** su documento está completo, pero ningún combo en
Alegra lo usa. Sin combo no hay SKU de venta → sin SKU no hay EAN → el generador en lote lo salta. Se
arregla creando el combo, no redactando otro documento. El 2026-09-20 había 101 documentos así.

**Reordenar la app es editar un archivo.** El menú agrupa por departamento («Contabilidad» tenía 22 paneles, entre
ellos Stock, Costos y Crear en Alegra); `flujoApp.ts` los ubica donde se USAN. Un test falla si un panel de
`panelInfo.ts` queda sin lugar o aparece en dos (`tests/test_mapa_producto.py`). Una fuente de bloqueos que falle se omite y se anuncia en
`sin_senal` — un mapa que se cae por un módulo escondería justo lo que debe mostrar. Para sumar una señal: una
función en `_FUENTES` que devuelva `_b(etapa, id, n, texto, panel)`.

**Mapa vivo — la pantalla de inicio de todos (25-sep-2026).** Panel `mapa-vivo` (`components/MapaVivo.tsx` +
`mapa-vivo.css`, lenguaje pixel de Colaboradores): toda la app en un lienzo React Flow, **armado desde `flujoApp.ts`**
(no hay otra estructura) y **filtrado con `puedeVerSeccionPanel`** (cada quien ve solo los paneles que puede abrir; una
etapa ajena sale apagada sin nombrar sus paneles). Escritorio: camino en **serpentina** de 4 cartas por fila (Inicio →
Abastecer → Preparar → Publicar, baja, Vender → Entregar → Facturar → Contar) y Dirigir/Sistema como bandas; en una sola
fila de 8 no se leía nada. Celular (<700 px): columna que arranca arriba a tamaño de lectura (no se encuadra todo). Vivo:
detenidos de `/api/mapa-sistema/bloqueos` (misma queryKey que FlujoNav) y solicitudes asignadas a la persona ubicadas por
`etapaDeTicket` → la etapa con algo suyo late en amarillo («tu camino»). Tocar un panel acerca la cámara y lo abre; se
vuelve con **«◇ Mapa»** del cabezote (antes «◇ Todo el flujo», que abría Mapa del sistema solo a administración).
`App.tsx` pone el mapa **una vez por carga de página** (`INICIO_EN_MAPA`); un `?panel=…` manda sobre él. **Lo urgente titila** (25-sep-2026): `GET /api/mapa-sistema/urgencias` lo ve TODO el equipo interno, filtrado **en el servidor** por los paneles que cada quien puede abrir (`mapa_app.urgencias_para` + `app/services/acceso_paneles.py`, réplica de `panelAccess.ts` para los paneles a los que apunta alguna fuente; `tests/test_acceso_paneles.py` exige una regla decidida para cada uno). La persona sale del token PERSONAL (`X-Tickets-Token`): `CHAT_API_TOKEN` solo lo recibe administración. Titila el APARTADO (lo detenido de severidad alta + las solicitudes propias `alta`/`urgente`), no la carta, que solo lleva marco rojo; un panel urgente se muestra aunque el nivel lo esconda; «¡Ir a lo urgente!» encuadra esas cartas. **Fusión con la Agenda — «Tu día»** (26-sep-2026, `components/TuDia.tsx`): columna plegable a la derecha del Mapa (en celular, hoja que sube desde abajo; entra plegada) con Me pidieron (lo urgente primero, con la etapa de cada tarea: tocarla encuadra y hace destellar esa carta; «Abrir» la abre en la Agenda por el mismo camino que `SolicitudesEnProcesoFab`, que en el Mapa se oculta), Puedo iniciar, Me espera hoy, y las MISMAS piezas de la Agenda (PagosClientes, MiQuincena, DolarHoraGadget), no copias. La Agenda completa sigue a un toque. ⚠️ El Mapa y Colaboradores son una **isla clara** (`.colab-pixel`): no cambian en modo oscuro. Dentro rige la traducción de colores CLARA (el generador excluye la oscura con `:not(.colab-pixel *)`) y la isla redeclara las variables DERIVADAS (`--mck-card-bg: var(--mck-surface-panel)`…) y los tokens de estado: una variable que referencia otra se resuelve donde se declara, y heredada traía el azul marino del modo oscuro. ⚠️ Una pestaña flotante debe ser un `<div>` posicionado con el botón adentro (`index.css` fuerza `position: relative` en todo `<button>`). ⚠️ React Flow
v12 toma las medidas de un nodo controlado de `node.measured`: el mapa las devuelve desde `onNodesChange` o las flechas no
se dibujan. ⚠️ Un panel de lienzo (altura completa) va en **DOS** listas: `Layout.tsx` (rama de hubs) **y**
`ui/PanelTransition.tsx` (`fillHeight`); con solo la primera, el lienzo colapsa a altura 0 dentro de la app (pasó con el
mapa el 25-sep, y el banco del panel suelto no lo mostraba). Bancos: `desktop/dev/mapa.html?perfil=admin|despachos&nivel=0-3`
(el mapa solo) y `desktop/dev/app.html?perfil=…&medir&tocar=Texto,Otro` (la **app completa** con sesión de ejemplo; errores
de consola y recorrido de clics al `<title>`, para `--dump-dom`). Ambos con fetch interceptado. ⚠️ Chrome headless no baja
de 500 px de ancho: una captura «de 390» es una página de 500 recortada.

**Sin menú de arriba (25-sep-2026): se navega SOLO desde el Mapa.** `nav/FlujoNav.tsx` (la fila de etapas → tramos →
paneles del cabezote) se **eliminó**: cada carta del Mapa despliega sus paneles, la carta de Inicio trae las vistas de la
Agenda (Mensajes, Chat del equipo, Colaboradores, Juegos; la regla es `puedeVerTabInicio`, exportada de
`InicioNavTabs`) y el cabezote solo lleva **«◇ Mapa»** (`.mck-volver-mapa`) + miga + título. Quedan como pestañas
DENTRO de su panel las vistas de la Agenda (`InicioNavTabs soloVistas`) y las de Diseño y Docs. ⚠️ **Clics en el
Mapa:** React Flow escribe `pointer-events: none` EN LÍNEA sobre un nodo que no se arrastra, no se selecciona y no tiene
manejador de clic; el Mapa pasa `onNodeClick` para que sus cartas reciban eventos, y sus botones llevan `nopan` (un
clic con temblor no arrastra el lienzo). Sin eso, 0 de 14 paneles abrían con clics reales mientras `element.click()`
sí funcionaba: **probar clics con eventos reales** (CDP `Input.dispatchMouseEvent`/`dispatchTouchEvent`), no con
`element.click()`. Lo que sigue describe la navegación por flujo tal como era antes de ese cambio.

**Toda la interfaz es el flujo (21-sep-2026), y va de lo general a lo avanzado.** El cabezote era `nav/FlujoNav.tsx`:
- **Origen — «Mi agenda»**: siempre el primer nodo del flujo (`ORIGEN_APP` en `flujoApp.ts`); la *pantalla* de inicio es el
  Mapa vivo, donde la Agenda es la primera carta. Es donde cada
  quien ve lo que le pidieron e inicia acciones; **no** es un panel más de una etapa (un test lo exige). Con la Agenda
  abierta, debajo solo van sus vistas (Mi día · Mensajes) y ninguna etapa se despliega sola.
- **Etapas** en secuencia con lo detenido → al tocar una se despliegan sus **tramos** con los paneles de uso normal
  (tocarla otra vez la recoge) → **«+N avanzado»** muestra los de uso ocasional (`tier: "advanced"` de `panelInfo.ts`).
- **«◇ Todo el flujo»** abre el Mapa: **un solo diagrama** (`MapaAppFlujo.tsx`) origen ⇢ 7 etapas en columnas ⇢ carriles
  Dirigir y Sistema, con zoom semántico de 4 niveles — Etapas · Cotidiano (`core`) · Operación (+`standard`) · Todo
  (+`advanced`, qué hace cada panel y las **variables** de cada tramo, `datos` en `flujoApp.ts`). El nivel se recuerda en
  `localStorage`; en «Etapas», tocar una etapa despliega solo esa columna. Un tramo sin `datos` hace fallar el test.
- **Dentro de la Agenda** (`AgendaFlujo.tsx`, montado en `CentroMandoHome` de `TicketsPanel.tsx`): «tu día, en orden» =
  tres carriles *Me pidieron ⇢ Puedo iniciar ⇢ Me espera*. Cada nodo abre su ticket como siempre y a la derecha dice a qué
  **etapa** pertenece (salta al panel donde se resuelve); debajo, «a dónde lleva tu día» reparte lo tuyo en la secuencia.
  La etapa sale de `lib/flujoTickets.ts`: reglas por palabras del **título**, en orden, sin IA — la `categoria` del ticket
  no sirve («logistica» es el valor por defecto del 80 %). Sin regla, el nodo no lleva etapa: no se inventa. Equipo,
  ecosistema, commits y cambios quedan recogidos en «+ Equipo y sistema». La TRM sigue arriba, como estaba decidido.
- Sobre el título va la **miga** (`ubicacionDe()`): «PREPARAR ⇢ 4·RESPALDARLO». Las pestañas que quedan (Diseño, Docs,
  Libro Mayor…) son **vistas dentro de un panel** y en la piel «flujo» se dibujan como nodos (CSS al final de `index.css`,
  fuera de `@layer` porque las reglas base de `.mck-hub-tab` también lo están).
- El menú por departamento sigue detrás de Menú de usuario → «Volver a la navegación clásica» (`uiMode.navClasica`);
  con el flujo activo se ocultan «← Agenda» y la franja «Ir a…». El móvil (`MobileHub`) no cambió: ya abría en la agenda.
  Los conteos de bloqueos son de administración: a quien la API le responde 403 simplemente no se le muestran.
El estilo predeterminado es la piel **«pixel»** desde el 25-sep-2026 (`ESTILO_BASE_V = 3`; antes «flujo»): toda la
app como un videojuego, el lenguaje del Mapa y de Colaboradores. `theme/skin-pixel.css` (importado en `main.tsx`
DESPUÉS de `index.css`, sin `@layer`) no toca los 61 paneles: redefine los tokens `--mck-*` (PICO-8, claro y oscuro) y
viste lo común — esquinas rectas (salvo `.rounded-full`), tarjetas `rounded-xl/2xl.border` con borde de 2 px y sombra
dura, sombras de Tailwind vía `--tw-shadow` (los anillos de foco siguen), botón `.bg-accent` que se hunde, foco
amarillo, cabezote, pestañas y encabezados de tabla. **Colores escritos a mano:** los paneles usan ~750 clases de color
propias (`bg-white`, `text-emerald-400`, `bg-red-500/15`…) que no pasan por los tokens; sin traducir, un panel mezclaba dos
estilos (Pedidos Web, pensado para fondo oscuro, se veía lavado). `desktop/scripts/pixel/paleta_pixel.py` las lleva a seis
familias pixel (papel: texto, pálido, suave, fuerte, hondo, borde; claro y oscuro) y GENERA `theme/skin-pixel-paleta.css`
(no editar a mano; `--escribir`). Las «pastillas» (`rounded-full` con `px-*`) pasan a bloque. `tests/test_piel_pixel.py`
falla si hay una clase nueva sin traducir, si un texto traducido o un token usado como texto baja de 4,5:1, o si un
dibujo de etiqueta imprimible usa clases que la piel cambia. Auditoría con el navegador real (contraste de cada texto
visible contra su fondo compuesto, 12 paneles): 0 de 448 ilegibles en claro y en oscuro; la piel «flujo» tenía 80.
En oscuro el acento es fondo de botón (`11 92 168`) y el TEXTO de acento se pinta aparte (`#29ADFF`): ningún tono sirve
para las dos cosas. **Las letras NO son pixel** (decisión del usuario, legibilidad):
la piel no toca fuentes ni tamaños de texto y todo se lee en Montserrat, también en el Mapa y en Colaboradores (sus
rótulos «de juego» son Montserrat en negrita y mayúsculas). Se probaron Pixelify Sans (la «C» se cerraba en «O» a
11–13 px) y DotGothic16 (legible; queda como opción en Temas → Fuente); la v2 de `ESTILO_BASE_V` traía DotGothic16 y
la v3 devolvió Montserrat a quien ya la había adoptado. ⚠️ El **acento** y la **fuente del cuerpo** viajan EN LÍNEA
sobre `<html>` (`theme/applyTheme.ts`): una hoja de piel no los pisa; van por el paquete y por `baseAccent`.
La piel «flujo» (`index.css`: papel frío, cuadrícula, monoespaciada — el lenguaje de Archify) sigue en Temas.
Como un default nuevo no alcanza a quien ya tenía tema guardado, `lib/userThemeSync.ts` lo aplica **una sola vez**
por persona (`ESTILO_BASE_V`, guardado como `preferencias_ui.estilo_v`) conservando modo claro/oscuro, tamaños, zoom
y «Mis temas»; después manda lo que cada quien elija en Temas. ⚠️ Una piel nueva va en **dos** listas: `SKINS` de
`theme/presets.ts` y la validación de `tickets_db.actualizar_preferencias_ui` — si falta en la segunda se ve bien
y el PUT responde 400 en silencio. ⚠️ Una **fuente** nueva, igual, en `FontChoice` y en las **dos** listas de fuentes
de `tickets_db.py` (tema activo y temas guardados). Ambas cosas las vigila `test_toda_piel_del_panel_se_puede_guardar_en_el_servidor`.

**Taller de combos (21-sep-2026) — la guía de la etapa «Preparar».** Una etapa puede declarar `guia` en `flujoApp.ts`
(`abre`, no `panel`: ese panel ya vive en un tramo); sale como nodo lleno «▶ Taller de combos» al desplegar Preparar y en
su columna del Mapa. Abre `combos` en vista `mision` (`combosVista` en `stores/app.ts`; «Ver todos los combos» pasa a la
galería). `components/combos/MisionCombos.tsx`: un combo a la vez, **su foto en el centro** y sus seis piezas alrededor
(receta · etiqueta en la receta · documento · EAN · diseño de etiqueta · publicación); conexión viva = completa, punteada
= ranura vacía; «siguiente paso» marca la primera que falta. La cola se arma una vez por visita, primero los que están a
una pieza de cerrarse, y recuerda el caso en `sessionStorage` (ir al Studio y volver no lo pierde). El inspector resuelve
ahí mismo: **crear el EAN** (propuesta de `…/ean-propuesto` → el `POST /api/etiquetas/codigos-ean` de siempre), **unir el
documento por SKU**, y en la etiqueta **tamaño, plantilla y textos** vía `GET/POST /api/mapa-sistema/etiqueta/<id>` →
`etiquetas_fichas.actualizar_campos_ficha()` (mismo candado y misma escritura que el Studio; permiso
`puede_ver_etiquetas_avanzado`; lista blanca `CAMPOS_EDITABLES`, sin logos ni estilos; una plantilla de categoría no se
edita desde un producto). ⚠️ `guardar_ficha` REEMPLAZA la ficha entera: toda edición parcial pasa por esa función. El PNG
no se regenera: exportar sigue siendo del Studio. Premio: la conexión se enciende, «+1 conexión», anillo de la foto, y con
6/6 celebración + marcador del día (`localStorage`) y del catálogo; respeta `prefers-reduced-motion`. Los 40 productos sin
combo van aparte (no hay producto de venta que dibujar) con salida a Crear en Alegra.
⚠️ `index.css` fuerza `position: relative; overflow: hidden` en **todos** los `button` de `#root`: un botón con `absolute`
se queda en el flujo. Posicionar un `div` y meter el botón dentro.

**Unir un documento a su materia prima (corregido 21-sep-2026).** El documento describe la materia prima y el combo lo
hereda; el enlace firme es `referencia: <SKU>` en el YAML. Tres fallos impedían hacerlo desde el taller:
(1) hay recetas cuyos componentes llegan **sin nombre** en la copia local de Alegra → nada parecía empaque, el kit quedaba
con diez «materias primas» y no se ofrecía unir; ahora el nombre se toma del catálogo por código, y COPA/DOSIFICADOR/BALA/
SCOOP son empaque (la copa dosificadora iba como segunda materia prima en 19 recetas). (2) `fijar_sku_documento()` se negaba
a tocar un documento que ya declarara SKU, aunque fuera uno caduco (`ALUg` cuando el producto es `ALUALLg`, o el código de
un combo): ahora **reemplaza** la referencia que NO es un producto de inventario activo, y solo con `compartir=True` agrega
el SKU a `referencias_equivalentes` cuando el documento ya pertenece a OTRA materia prima activa (misma sustancia, dos
códigos); `mejor_documento()` encuentra el documento por cualquiera de sus SKU. El lote «Unir por SKU» sigue proponiendo solo
el modo `fijar`: reemplazar o compartir se decide caso a caso. (3) si el parecido de nombre no encontraba el documento no
había cómo elegirlo: `GET /api/mapa-sistema/documentos?q=` + buscador en el inspector («Enlazar un documento que ya existe…»,
con selector de materia prima si la receta tiene varias).
**Asociar desde Docs técnicos.** La biblioteca de Docs técnicos lista PDF generados y no tenía cómo decir «este es el
documento de aquel producto»: quien llegaba desde un combo sin ficha quedaba en un callejón. Ahora, si se llega desde un
combo cuyo documento no está unido por SKU (`tallerRetorno.asociarDoc`, con sus `mps`), la biblioteca abre con el bloque
«Asociar un documento a «<combo>»»: buscador sobre los YAML (no sobre los PDF), botón «Asociar a este combo» por documento,
confirmación y «← Seguir con el combo». Es la misma pieza del taller (`components/combos/EnlazarDocumento.tsx`), así que
corrige referencias caducas y solo comparte un documento si se confirma. También entra por ahí la galería de Combos.
**Editar en su apartado y volver.** Cada pieza del taller salta a su sitio ya abierto en ESE producto —Studio en la etiqueta
(`abrirFormulario({fichaId})`), Códigos EAN, Docs técnicos con el buscador sembrado, Publicaciones en el SKU, Catálogo
Alegra en el kit— vía `saltarDesdeTaller()` / `tallerSalto` en `stores/app.ts`, y queda un botón flotante «← Seguir con
<combo>» (`tallerRetorno`, en `Layout.tsx`; flotante porque el Studio inmersivo oculta el cabezote) que devuelve al mismo caso.

**La lista de todos los combos vive en la misma ventana del taller (21-sep-2026).** Tres columnas: lista · tablero ·
inspector. La lista (`ListaCombos` en `MisionCombos.tsx`) es a la vez la galería y **la cola**: lo que se busca o se filtra
(Por completar · A una pieza · Sin documento · Sin código · Sin etiqueta · Receta rota · Completos · Todos) es lo que
recorren «Anterior / Siguiente»; el combo en curso nunca sale de la lista aunque deje de cumplir el filtro al completarse.
Cada fila trae sus seis segmentos y **cada segmento es un botón**: abre ese combo directamente en esa pieza. Teclado: ← →
cambian de combo, 1–6 abren una pieza, F las fotos (no actúan mientras se escribe en un campo). La galería anterior quedó
como enlace «vista clásica».

**El taller cabe en la ventana, sin desplazar la página.** `useAltoDisponible()` (en `MisionCombos.tsx`) mide lo que queda bajo
el cabezote —que cambia de alto al desplegar una etapa— y fija ese alto a la raíz; adentro todo es `flex`/`grid` con
`min-h-0`, y solo la lista y el inspector tienen desplazamiento propio. El tablero se ajusta al alto QUE QUEDA, no solo al
ancho: `.mck-mision-lienzo` es un contenedor con tamaño y el tablero mide `min(100cqw, 100cqh × 1000/640)`; con el tablero
bajo 640 px los nodos se ensanchan y usan nombre corto (`CORTO`, por `@container`). ≥1280 px: tres columnas · 1024–1279:
la lista pasa a franja horizontal sobre tablero + inspector · <1024: se apila y la página fluye normal. Los productos sin
combo dejaron de ser un bloque al pie: son el filtro «Sin combo» de la lista. Verificado sin desplazamiento de página en
1920×1080, 1600×1000, 1440×900, 1366×768, 1280×720 y 1100×800.

**El taller no tiene barra lateral: todo se resuelve en emergentes guiados (21-sep-2026).** La columna derecha del inspector
se quitó —casi siempre traía un solo botón— y el tablero ocupa ese espacio (lista · tablero). Tocar una pieza (o las teclas
1–6 / F, o un segmento de la lista) abre `PiezaEmergente` sobre el tablero: arriba la **pregunta que guía** (`preguntaGuia()`:
qué pasa y qué se propone — «No tiene código de barras. Este es el siguiente número libre: ¿lo creamos?»), en el cuerpo el
mismo `Inspector`, y abajo «Siguiente pendiente: <pieza> →». El banner «siguiente paso» trae **«Resolver ahora →»**. Al
resolver una pieza el emergente **pasa solo a la siguiente pendiente** con la tira «Listo: <pieza> — seguimos…»; si el combo
quedó completo se cierra para que se vea la celebración. La publicación y la etiqueta tienen su emergente propio
(`PublicacionEmergente`, `EtiquetaEmergente`). Si el combo ya tiene etiqueta, tocar la pieza abre **de una vez** el editor (formato y exportación) y al cerrarlo se cierra también la pieza. En ese editor (el mismo del Studio) hay **un solo botón, «Terminar y aprobar los PNG»** (se quitaron «Guardar PNG para imprimir» e «Imprimir»): genera el PNG de impresión y, con la casilla **«Desenfoque»** (marcada por defecto), a la vez el `_digital` —OCR de «MCKENNA GROUP» + desenfoque en el navegador con **radio 10** (`RADIO_DESENFOQUE_ETIQUETA`; Studio Visual/MeLi sigue en 28), sin marcar nada—; la persona revisa las dos vistas previas lado a lado y «Aprobar y guardar los dos» sube cada uno a su carpeta (`ETIQUETAS STUDIO/<Cat>` y `PUBLICACIONES DIGITALES/<Cat>`). Si el OCR no encuentra la marca, la aprobación queda bloqueada hasta marcar las zonas a mano. En Diseño → Studio el editor de una etiqueta se abre **dentro de la pestaña «Categorías»**, en el lugar del detalle y al lado de la lista (`StudioCategoriasPanel editor=…`); ya no es vista inmersiva: quedan el cabezote, las pestañas y el buscador. Tocar otra categoría o pestaña cierra el editor. Cada categoría de la lista se **despliega** (▶) y muestra sus etiquetas como árbol; tocar una la abre en el editor (la abierta queda resaltada). El buscador filtra por **etiqueta** primero: antes, «chia» caía en las palabras clave de Semillas y mostraba sus 33 etiquetas, como si no filtrara; escribir en él cierra el editor para ver los resultados. **El lienzo es lo protagonista (23-sep):** el editor (`ProductLabelForm`, también en el taller) son tres franjas — barra de herramientas de UNA línea (volver · nombre · punto de autoguardado · formato · Editar/Vista · «Más» · «Terminar y aprobar»), **mesa de trabajo** que llena el resto y agranda la etiqueta hasta ×2,2 (`useEscalaAjuste` con `llenar`, `ESCALA_MAXIMA_MESA`) y barra de estado (formato, código, ficha técnica, avisos como fichas). Categoría, retícula, desenfoque, plantilla, restablecer y SVG viven en «Más». El botón **«Ficha técnica»** de la barra abre en un emergente el documento técnico enlazado (`FichasTecnicasPanel archivoInicial=<fichaTecnicaId>`) para corregir el dato en su origen; **la etiqueta se actualiza sola** (`lib/fichaTecnicaSync.ts`): guarda en `data.fichaTecnicaBase` la foto de lo que trajo de la ficha la última vez y, al abrirse o al volver de la ficha, aplica SOLO los campos que cambiaron en la ficha desde esa foto — lo ajustado a mano en la etiqueta sin tocar la ficha se respeta. Fuera: contenido neto (manda el EAN) y conservación (manda la sugerida de la familia). Una etiqueta sin foto (las anteriores al 23-sep) la toma al abrirse la primera vez; si la ficha se editó antes desde el propio editor o el Espacio de producto, se compara con la foto tomada al entrar a editarla. **Documento vigente:** guardar un documento con otro título crea OTRO YAML con el mismo SKU y el viejo se queda (42 SKU tenían varios el 23-sep, p. ej. «CHÍA» y «SEMILLLA DE CHÍA»). Antes de sincronizar, la etiqueta pregunta `GET /api/fichas/datos/<id>/vigente` (`auditar_catalogo_combos.documento_vigente`: mismo SKU, más completo y, a igual estado, el más reciente) y se re-enlaza a él; `mejor_documento` desempata igual, así que Mapa, taller y Espacio de producto abren el mismo documento. Reemplaza el «Ajustar la ficha técnica» que solo tenía el emergente del taller. Con una etiqueta abierta la lista de categorías se pliega a un riel (`mck-studio-lista-plegada`). Capas: pieza `z-45` < kit (`EditarModal`, `z-50`) < documento y etiqueta
(`z-70`); Esc cierra la pieza solo si no hay otro emergente encima, y con un emergente abierto las flechas no cambian de combo.

**El premio suena, y la foto avisa.** Al completarse las seis piezas suena una moneda (`combos/sonidoMoneda.ts`: dos
notas de onda cuadrada, si5 → mi6, **sintetizadas** con Web Audio — no se carga ni se distribuye ningún audio ajeno); se
silencia con el interruptor «sonido» del marcador (queda en `localStorage`). Y si el combo quedó completo pero **su foto no
está al día**, la imagen del centro **parpadea** (`.mck-mision-foto-parpadea`: late un halo ámbar por FUERA y la foto se
atenúa, pero el círculo sigue blanco y opaco — con opacidad en el círculo se veían cruzadas las seis líneas que pasan por
detrás; con `prefers-reduced-motion` queda un aro fijo) y el aviso dice «Solo queda la foto». `mapa_producto._estado_foto()` decide: `sin_foto` · `prestada` (la vitrina la
tomó de otra publicación por parecido de nombre, `photo_match_type: identity`) · `anterior_a_etiqueta` (la fecha del
archivo de MeLi, `…_042023-O.jpg`, es anterior al último rediseño de la etiqueta → muestra la etiqueta vieja) · `ok`. El
21-sep-2026: 28 de 243 al día, 146 con la etiqueta anterior, 54 sin foto, 15 prestadas. Antes de completarse solo se ve un
aro ámbar y «foto por actualizar» bajo el contador: no parpadea para no distraer mientras se trabaja.

**El documento técnico se revisa en un emergente.** En la pieza «Documento técnico», «Revisar el documento aquí…» abre
`combos/DocumentoEmergente.tsx`: cabecera con estado y SKU declarado, primero **lo que impide publicarlo** (`_vacio_motivo`,
`_vacio_pendientes`, `_pedido_proveedor`, o por qué un borrador/antigua no cuenta como listo), y en pestañas sus tres partes
—Ficha técnica · COA · SDS— con cuántos campos van sin dato y si está firmada, más las fuentes. Abajo, las acciones que
cierran la pieza: **«Es este: unirlo a <SKU>»** (o corregir/compartir el enlace), «No es este: elegir otro…» y «Editarlo en
Docs técnicos →». Datos de `GET /api/mapa-sistema/documentos/<archivo>/revision` → `mapa_producto.revisar_documento()`:
solo lectura, **no genera PDF** ni toca el YAML, y no envía las imágenes embebidas (firma en base64). «Sin dato» no es un
error: muchos campos no aplican al producto (sabor de un aceite, INS de un cosmético).

**«No requiere documento técnico» (22-sep-2026).** Hay publicaciones que no llevan documento (envases vacíos, accesorios…): en la pieza «Documento técnico» una casilla lo marca **por combo** (`POST /api/mapa-sistema/combos/<ref>/documento-no-requerido`, admin o permiso `fichas`) con motivo opcional; queda en `app/data/documento_no_requerido.json` (quién, cuándo, por qué) y la pieza cuenta como completa. No toca ningún YAML; desmarcar la vuelve a pedir.

**…y se EDITA ahí mismo.** «Editar aquí» convierte cada valor del emergente en campo (textos, filas, ítems de lista y celdas
de las tablas del COA/SDS); lo cambiado se resalta y se guarda todo junto por `POST …/documentos/<archivo>/editar` →
`mapa_producto.editar_documento()` (administrador o permiso `fichas`). Reglas: solo valores que YA existen (no crea
claves), por RUTA dentro del YAML (`["_coa","parametros",1,2]`); **no** deja tocar `referencia` (eso es «Unir», que valida
el SKU contra Alegra), ni el nombre (de él salen el archivo y el emparejamiento), ni imágenes, ni claves privadas; la tabla
`propiedades` es DERIVADA y se rehace con `normalizar_datos_ficha` como al guardar desde Docs técnicos. Guarda con el mismo
`yaml.dump` de Docs técnicos, con **respaldo** en `fichas_word/datos/_respaldo_edicion/` y **rastro** en `_ediciones` (quién,
cuándo, qué campos). ⚠️ Un documento **publicado** (`_tipo: completo`, sin `_borrador`) lo muestra la web directamente desde
ese archivo: editarlo cambia lo que ve el cliente y NO regenera el PDF ya emitido → exige marcar una confirmación
(`confirmar_publicado`); firmar, generar el PDF o cambiar el nombre sigue siendo de Docs técnicos.

**La receta se corrige en un emergente, sin salir del taller.** En las piezas «Receta» y «Etiqueta en la receta» el botón
ya no navega: abre `combos/KitEmergente.tsx`, que es el **mismo** `EditarModal` de Catálogo Alegra (exportado de
`CatalogoAlegraPanel.tsx`) montado con `createPortal`, y guarda por el mismo `PATCH /api/alegra/catalogo/<sku>` con sus
mismas reglas (si el kit ya tiene movimientos en Alegra deja cambiar nombre y precio, no la receta). Al guardar, el
endpoint actualiza la copia local del catálogo y el taller refresca sus piezas. El enlace «abrir en Catálogo Alegra» queda
como salida secundaria. ⚠️ Esto SÍ escribe en Alegra: en pruebas de navegador se intercepta el PATCH.

**Fotos, presentaciones y componentes en el taller (21-sep-2026).** La **foto del centro se toca**: abre la principal y
las secundarias (`fotos`, del `cache.json` de la web) y salta a Publicaciones en ese SKU, que es donde se cambian, ordenan y
suben (web y MeLi por separado). **Presentaciones:** `familia` = la materia prima única de la receta; los combos que la
comparten son presentaciones del mismo producto (250 g · 500 g · kg) y salen como tira sobre el tablero. Comparten
documento (es de la materia prima) pero **cada una es su combo: su EAN, su etiqueta, su tamaño y su plantilla**; si una no
tiene etiqueta, el inspector ofrece abrir la de la hermana como punto de partida. Un kit con varias materias primas no es
presentación de ninguna (`familia` vacía). **Componentes:** cada pieza de la receta (bolsa, etiqueta, tapa…) muestra sus
existencias de referencia y abre Catálogo Alegra buscando su código. Las existencias salen de `siigo_stock_cache.json`, el
caché que ya deja el panel de Inventario — acá **solo se lee el archivo**, nunca se llama a Siigo; muchos empaques están en
negativo porque se descuentan y nunca se cargaron. `unit_cost` de la copia de Alegra viene en 0: no se muestra costo.

**La cadena se mide por producto ADQUIRIDO**, no por combo (`matriz_productos()`): de 191 materias primas, 33 llegan
completas a la vitrina y 82 se venden sin etiqueta o sin documento listo. Vista por combos, las 40 compradas sin
ninguna presentación de venta ni siquiera existen.

Reglas de las acciones:
- **No nace una segunda vía de escritura**: una ranura vacía **lleva al apartado que ya existe** para
  resolverla — el código EAN a Diseño → Códigos EAN con el combo ya cargado (`eanPrefill` en `stores/app.ts`,
  lo consume `CodigosEanPanel`), la etiqueta al Studio, el documento a Docs técnicos. Combos no crea nada por
  su cuenta (`GET …/ean-propuesto` sigue existiendo, solo informa).
- **No se ofrece código a un combo con la receta rota** (solo empaque, sin componentes): el equipo los
  dejó sin código a propósito el 2026-09-19.
- **`fijar_sku_documento()` edita UNA línea** del YAML (no re-serializa: `yaml.dump` reordenaría 248
  documentos), respalda en `fichas_word/datos/_respaldo_referencia/`, aborta si al releer cambió algo más
  que `referencia`, no pisa una referencia existente y exige que el SKU sea un producto de inventario
  activo (un `C-…` se rechaza: la referencia es la materia prima). Requiere administrador o permiso `fichas`.
- **Diagramas**: se versiona la fuente `docs/arquitectura/*.json` + `indice.json` (orden y textos del panel);
  el HTML es derivado (`.gitignore`) y se genera con `python3 scripts/diagramas_arquitectura.py entregar`.
  Antes de añadir o tocar un flujo, leer `docs/arquitectura/README.md`: el tipo `workflow` tiene solo 6
  columnas, y una etiqueta de arista larga deja la ruta «imposible» sin decir por qué.
- En «Unir por SKU» solo vienen marcados los de **nombre idéntico**; los *conflictos* (dos materias primas
  reclaman el mismo documento: karité amarilla/blanca, colágeno g/mL) no se pueden marcar.

### W. Espacio de producto (23-sep-2026)

```
/app → Diseño → «Por producto»  (también desde Docs técnicos; en el flujo: Preparar → Respaldarlo)
  EspacioProductoPanel.tsx — se elige la presentación (combo C-…) una vez y cada pestaña es el
  apartado de siempre ya abierto en ella:
    Ficha técnica   FichasTecnicasPanel archivoInicial=<documento.archivo>
    Etiqueta        ProductLabelForm (su «Ficha técnica» salta a la pestaña; al volver ofrece «Traer»)
    Código EAN      CodigosEanPanel filtrado (sin código: alta precargada con el SKU, como el taller)
    PNG aprobados   ETIQUETAS STUDIO + PUBLICACIONES DIGITALES por nombre de archivo
```

**Por qué:** el trabajo de un producto saltaba entre dos secciones del menú (Diseño y Docs técnicos)
buscando el mismo producto en cada una. La unión documento ↔ etiqueta ↔ EAN es la de
`/api/mapa-sistema/combos` (la del taller); no nace otra forma de escribir. Permiso: `producto`,
o `combos` / `mapa-sistema` (el backend lo acepta en `_PERMISOS` de `routes_mapa_sistema.py`).
Diseño y Docs siguen para el trabajo en lote. Los PNG se reconocen por el nombre del archivo
(nace del título del código de barras): si la etiqueta tiene otro título, no aparecen.

### X. Códigos EAN ↔ combos de Alegra (23-sep-2026)

Cada código EAN (Diseño → Códigos EAN) se registra con el SKU de venta del combo (`C-…`).
`app/services/ean_alegra.py` lo enlaza con el combo de Alegra y escribe el número en el **campo
adicional «Código de barras»** del ítem (custom field de la empresa, clave `barcode`; estaba
**inactivo** y vacío en los 243 combos — se activó ese día). Solo toca ese campo (PUT parcial).
- `GET /api/etiquetas/codigos-ean/alegra`: cada código con su estado — `enlazado`, `aproximado`
  (difiere en espacios/mayúsculas), `producto` (existe como producto simple, no kit), `sin_combo` —
  y la última carga. Columna «Alegra» en la lista del panel.
- `POST …/codigos-ean/sincronizar-alegra`: carga todos en segundo plano (pausa por el límite de Alegra).
- Registrar o corregir un código lo sube solo (`_ean_a_alegra_en_segundo_plano` en routes.py).
- ⚠️ El botón viejo «Subir EAN a Alegra» llamaba a `siigo.sincronizar_barcodes_ean_a_siigo`: leía
  combos de Alegra pero **escribía en Siigo**. La ruta `sincronizar-siigo` sigue, el panel ya no la usa.
- Corregidos el 23-sep 6 SKU de EAN que eran typo del combo (`C-ALMNAL500g`→`C-ALMNAT500g`,
  `C- PISTOS250g`, `C-BTMS125g`, `C-ACEESEMANZ5mL`, `C-CAF100`, `C-LANOLINA40g`, y `C-ACEITEATRE5mL`→`C-ACETEATRE5mL` porque Alegra renombró el combo y la copia local seguía con el viejo); la cera blanca 500 g
  tiene DOS EAN (115 y 116), cada uno en una etiqueta distinta — pendiente de decidir.

### Y. Cese de actividades global (23-sep-2026)

Un comando pausa todos los canales de venta (reestructuración, control de inventario):
`python3 scripts/cese_actividades.py --activar | --desactivar | --estado`. Sin reinicios: cada pieza lee su archivo.
- **MeLi**: `scripts/pausa_global_meli.py` guarda en `app/data/meli_pausa_global.json` la lista de lo que
  estaba activo ANTES de pausar y al reactivar solo toca esa lista. Mientras esté activa,
  `meli.pausa_global_meli_activa()` impide que la sincronización de stock reactive publicaciones (lo hacía
  sola al cargar stock). Reactivar a mano una por una desde el panel sigue funcionando.
- **Web**: `PAGINA_WEB/site/data/MANTENIMIENTO` con «cese» → `mantenimiento/cese.html` (503; el IPN de
  MercadoPago sigue pasando).
- **WhatsApp**: `app/data/cese_actividades.json`. En `/whatsapp` un cliente 1:1 recibe el aviso de
  suspensión (una vez cada 6 h por chat) y el mensaje no llega al bot ni a modo humano. El puente
  (`server.js`) rechaza con 423 `/enviar`, `/enviar-archivo` y `/enviar-ptt` a todo lo que no sea grupo ni
  `numeros_internos` → ningún envío del panel (asesor desde /app, confirmaciones de pago) llega al cliente.
  ⚠️ Lo que alguien escriba **desde el teléfono** no se puede frenar por software.

### Z. Canales del producto (24-sep-2026)

/app → Publicar → «Canales del producto» (`components/canales_producto/`, `app/services/canales_producto.py`): cada
SKU de venta en todos sus canales — Alegra → receta → documento/EAN/etiqueta → MeLi → web → **¿se puede facturar?** —
con la misma regla de la facturación (`resolver_producto_venta_alegra` + `alegra_sku_alias_venta.json`) pero contra la
**copia local** (cero llamadas vivas; «Verificar facturación en vivo» por SKU es la única). **Solo diagnóstico:** cada
problema salta al apartado que ya existe (`saltarDesdeTaller` con `origen: "canales-producto"`, así «← Seguir con…»
vuelve aquí). Clasificaciones por gravedad: `vendible_no_facturable` · `inactivo_publicado` · `inactivo_con_alias` ·
`pausado_no_facturable` · `discrepancia_canales` · `incompleto` · `suelto` · `completo`. Pestaña Categorías: etiquetas vs
web vs MeLi (MeLi sin dato local todavía). Alimenta el bloqueo de «Publicar» en el flujo (`mapa_app._canales`).
- ⚠️ **Cese de actividades:** MeLi reporta «paused» TODO lo que el cese pausó; `meli_pausa_global.json` dice qué estaba
  activo antes, y eso se cuenta como publicado (`pausada_por_cese`). Sin esto, 150 SKUs parecían «se venden y no
  facturan»; de verdad eran 10 (24-sep).
- **La copia local de Alegra ahora marca inactivos**: `sincronizar_catalogo_alegra()` upserta también los no activos y
  pasa a `inactive` lo que Alegra ya no devuelve — solo con paginación completa y si desaparece < 40 % (anomalía de la
  API = no toca nada). Corre sola a las 7:00 (`monitor.py`, `catalogo_alegra_dia`).
- Un producto SIMPLE vendido en MeLi (sin combo) es `incompleto`, no `completo`: no descuenta empaque y la web no lo muestra.

### AA. Chat del equipo, campana y recepción de mercancía (24-sep-2026)

Llevar la operación de los grupos de WhatsApp al panel — **redirigir, no bloquear** (lo del teléfono no se frena):
- **Chat del equipo** (Agenda → «Equipo», panel `chat-equipo`, `app/services/canales_internos.py`, tablas en
  `tickets.db`): canales sin cronómetro, fotos con la cámara, «→ tarea» / «Reportar incidente» abre una solicitud de la
  Agenda ya llenada (categoría `incidente` sembrada). Cada mensaje cuenta como actividad (`registrar_evento_panel`).
  Un canal puede enlazarse a un grupo oficial: entra lo del grupo (hook al final de `wa_chats.ingestar_desde_whatsapp`)
  y, con «ida y vuelta», sale lo del panel con el nombre del autor; anti-eco por texto (el puente no devuelve el id).
  Las rutas usan su propio `_auth`: el panel manda el token de API como Bearer y la sesión en `X-Tickets-Token`.
- **Fotos de grupos**: `espejarGrupoPanel()` en `server.js` ahora descarga imágenes (≤ 8 MB) a `comprobantes/grupo_*`.
  Activo desde el reinicio del puente del 24-sep 15:25.
- **Campana** (cabezote, también en celular): `notificaciones_panel.py`. `tickets_notificaciones.enviar_texto_operador`
  guarda SIEMPRE el aviso y solo manda WhatsApp si `usuarios.notif_pref` ≠ `inapp` (default `ambos`: nada cambia hasta
  que cada quien elija «Solo en el panel» en la campana).
- **Recepción de mercancía** (Abastecer → «3·Recibirla», `app/services/recepcion_mercancia.py`, `recepciones.db`):
  llegada con fotos y conteo contra lo esperado; lo esperado sale de la **solicitud de pago de la compra** (renglones con
  SKU/cantidad). Cerrar exige todo contado → `verificada` o `con_diferencias`, y avisa en el canal `inventario`. No
  escribe inventario ni contabilidad.
- **Redirección**: `app/data/redireccion_panel.json` (reglas regex → aviso con enlace `/app?panel=…`, un aviso por regla
  y grupo cada 2 h). **Encendido desde el 24-sep** (el bot escribe en los grupos reales; `"activo": false` lo apaga sin reiniciar). Canales creados ese día: «Inventario y llegadas» ↔ MCKG PEDIDOS / COMPRAS y «Sede Sur» ↔ MCKG SEDE SUR (ida y vuelta), «Compras USA y China» (solo llegada).
- Enlace directo: `/app?panel=<id>` abre esa sección (App.tsx, `PANEL_DEL_ENLACE`).

### AB. Insumos: foto de referencia, equivalencias y contador (25-sep-2026)

Abastecer → Recibirla → Recepción de mercancía → pestaña **«Insumos: fotos y contador»** (`components/insumos/`,
`app/services/insumos.py`, `app/routes_insumos.py`, `/api/insumos/*`). Sin LLM; no llama a Alegra ni a MeLi.
- **Foto de referencia por SKU de inventario** (`FotoInsumo.tsx`): se toma con la cámara donde falte y se ve en el buscador
  y los renglones del wizard de pagos, en cada renglón de una recepción y en la vista de insumos. Se guarda reducida a
  JPEG ≤1000 px en `fotos_insumos/` (gitignored); índice en `app/data/insumos.db` (gitignored).
- **Equivalencias** (`app/data/insumos_equivalentes.json`): un SKU que ya no se compra pero no se puede borrar porque
  combos con ventas lo tienen en la receta (Alegra no deja cambiarla). El buscador lo oculta, `validar_compra` lo rechaza
  («usa X») y el contador lo suma al canónico. Primer caso: `PASBLA180mL` → `PAS180BLAUn` (13 combos siguen con el viejo;
  C-LHIS100g ya se cambió; respaldo de recetas en `app/data/_respaldo_recetas_PASBLA180mL_2026-09-25.json`).
- **Contador por lotes** (decisión de Armando 25-sep): las existencias arrancan con los lotes que se registran. Sin control,
  existencia = compras − consumo **desde la primera compra registrada** (lo vendido antes salió del inventario viejo); con
  control (conteo físico, antes de comprar otro lote) se sigue desde lo contado. Comprado (asientos vivos de solicitudes de
  pago y compras con `plantilla_datos.items`) − consumido (ventas
  de `facturacion_ventas_cache.db` + `ventas_directas.db` facturadas no-MeLi, × receta del combo; un producto vendido
  suelto se consume a sí mismo) desde `CONTABILIDAD_FECHA_CORTE`. **Alegra no lleva existencias de insumos**: sin
  compra registrada ni control no hay existencia (no se inventa).
  Estados: `ok` · `revisar` (existencia negativa: vendido más de lo registrado → hacer el control) · `sin_lote` (se usa
  pero nunca se registró compra ni control) · `sin_uso` (sin combos, compras ni ventas: candidato a inactivar). Ventas cuyo SKU no tiene receta local se listan aparte, no se inventa su consumo.

### AC. Buscador de chats y cobros sin factura (25-sep-2026)

Agente WhatsApp → pestaña **Buscar** (`WhatsAppBuscar.tsx`, `app/services/wa_busqueda.py`, rutas `/api/bot/chats/buscar` y
`/api/bot/chats/cobros-sin-factura`). Buscador sobre `wa_chats.db` por palabras, teléfono o valor (320.000 = 320000 =
320,000), agrupado por conversación y con «Abrir chat». «Cobros sin factura»: los cobros Llave/QR/Nequi del extracto de la
empresa sin vincular, cada uno con el chat donde se confirmó ese valor (−12 a +3 días), cédula/NIT y correo que escribió el
cliente, lo cotizado y la conversación. Solo lectura, sin LLM, sin Alegra. Contexto: al conciliar septiembre, de 33 cobros
por QR/Llave solo 11 tenían factura en Alegra; tras la migración (2-sep) solo 19 ventas WhatsApp se facturaron y Siigo quedó
suspendido desde el 4-sep. Los pedidos web se cobran por Mercado Pago y el auto-posteo los lleva a 1110: pendiente
pasarlos a 130505 como las ventas MeLi.

### V. Iconografía minimalista de todo /app (21-sep-2026)

La interfaz ya no usa emojis como iconos: usa el **set lineal McKenna** (`desktop/src/icons/`, trazo uniforme, 24×24,
sin relleno) que ya existía para el menú. Tres piezas:
- **`<Ico e="📦" />`** (`icons/Ico.tsx`): icono EN LÍNEA con el texto, mide lo que la letra (`svg.mck-ico` = 1,1 em) y
  toma su color. El valor sigue siendo el emoji —el código dice qué se quiso decir— y **`icons/emojiMap.ts`** decide qué
  se dibuja (~200 emojis → 111 iconos; se agregaron 18: gear, globe, sparkle, trophy, bag, bottle, cap, spoon, shield,
  puzzle, bulb, coins, ruler, compass, tree, scale, hand, broom). Un emoji sin icono asignado se muestra tal cual, nunca
  como un círculo genérico. Un test exige que todo lo mapeado apunte a un icono que exista (si no, `Icon` devuelve
  `null` y el botón queda sin icono y sin aviso).
- **`ico("🎫 Generar ticket")`** (`icons/icoTexto.tsx`): para textos que llegan como CADENA (ternarios, el `label` de una
  tabla de estados): dibuja el emoji inicial como icono y deja el resto igual.
- **`<PanelIcon panel=… bubble={false} />`**: el icono PROPIO de cada panel; es lo que usan la navegación por flujo y el Mapa.

Para un emoji nuevo: mapearlo en `emojiMap.ts` y correr desde `desktop/src/` los dos scripts de
`desktop/scripts/iconos/` (`emoji_a_ico.py` y `cadenas_a_ico.py`, con `--aplicar`; sin él, ensayo en seco). Reglas que
NO se rompen: solo se reemplaza un emoji que es **texto JSX inequívoco** (justo tras el cierre de una etiqueta, o que
abre la línea bajo una); nunca dentro de cadenas, template literals (mensajes de WhatsApp, HTML de impresión),
atributos, `<option>` (no admite SVG), ni en lo que **dibuja etiquetas imprimibles** (`etiqueta-*`, `VisualCanvasEditor`,
pictogramas GHS). El primer intento, más laxo, metió un `<Ico>` dentro de una cadena por confundir un `>` de
comparación con el cierre de una etiqueta: por eso la regla es estricta. Lo que queda con emoji es contenido, no
interfaz: mensajes de clientes en WhatsApp y el texto de commits y recaps.

**Build con dos usuarios (mckg y cynthia):** `dist/` y `public/assets/ocr/` quedaron con grupo `mckg` (cynthia
pertenece a él), `g+w` y setgid, y `scripts/copy-ocr-assets.mjs` ya no hace `copyFileSync` encima de un archivo del otro
(daba EPERM y el build moría antes de tsc): si pesa lo mismo no lo toca; si no, lo borra y lo copia.

### J. Contabilidad unificada (Libro Mayor propio, auto-posteo, préstamos, conciliación)

**Detalle completo: `docs/agentic/modules/contabilidad.md`** (sección «Flujo J completo»).

```
contabilidad_core.py      partida doble propia: PUC, terceros, asientos, balance, plantillas
puc_colombia.py           PUC real (Dec. 2650) + ALIAS de códigos viejos; migrar() registra alias aplicados
contabilidad_ledger.py    armar_libro() (solo lectura) + factura_ya_contada() contra doble conteo
contabilidad_autopost.py  auto_postear_periodo() → asientos (cron 6h + backfill)
contabilidad_mayor.py     árbol del PUC, extracto por cuenta (PDF/CSV), libro diario
iva_ventas.py             IVA de ventas → 240805 desde facturas Alegra (resta notas crédito)
alegra_puc.py / alegra_espejo.py   puente por código con Alegra; espejo y anulación de comprobantes
meli_facturacion.py       factura mensual MeLi (5 req/min); ⚠️ no usar meli_ads para contabilizar
extracto_bancario.py / extracto_clasificador.py   conciliación y propuestas para líneas sin vínculo
conciliacion_contador.py  350/490 del contador vs 2365 → hallazgos + TKT (sin LLM)
```

Trampas conocidas: saldo en Mercado Pago = **`130505`** (cuenta por cobrar, `CUENTA_MERCADOPAGO`; la venta MeLi
se causa en 4135 y el retiro al banco es traslado Debe 1110 / Haber 130505, nunca ingreso); `2367`=IVA retenido, `2380`=acreedores varios, rendimientos = `236535` (no
236515); `529505` cambió de significado (orden de migración importa). Un backfill necesita subir
`CONTABILIDAD_LEDGER_BUDGET_S` (período a medias queda cuadrado y parece completo). Ante un **503
de Alegra, releer antes de reintentar** (POST que sí se ejecutó). IVA de ventas nunca como
total/1,19 (hay excluidos, Art. 424).

### M. Préstamos de terceros (captación con particulares)

**Detalle completo: `docs/agentic/modules/prestamos.md`.** Panel Contabilidad → Préstamos
(`PrestamosCronogramaPanel.tsx`, `app/services/prestamos.py`); cron
`scripts/prestamos_recordatorio_cron.py` (día 5 ticket de pagos a despachos, día 3 ticket de
retenciones del mes anterior). Condiciones vigentes: 25% E.A., 24 cuotas, capital 30/70, retención
7% a cargo del prestamista contra **236535**. Documento soporte solo por los **intereses** y solo a
persona natural no obligada a facturar (`PRESTAMOS_DOC_SOPORTE_ACTIVO=0`, sombra). Identidad
fiscal solo en `app/services/empresa.py`; dígito del calendario DIAN = **6** (no el DV 3).

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
| `/api/etiquetas/categorias` | GET/PUT | Bearer / permiso Studio | Categorías de producto de las etiquetas (aceites, frutos secos, conservantes…): primer nivel de Diseño → Studio visual. El PUT reemplaza la lista completa y lo eliminado **no** se resucita — ver `app/tools/etiquetas_categorias.py` |
| `/api/guias/*` | GET/POST | Bearer | Rótulos de envío para impresora térmica: pedidos despachables, remitente, generación del PDF (`/api/guias/rotulos.pdf`), historial y conteo diario — ver `app/tools/guias_envio.py` y Flujo L |
| `/api/entregas-flex/*` | GET/POST | Bearer / permiso `entregas-flex`, `pedidos`, `empaque` o `guias-envio` | Horas de entrega de los envíos Flex de MeLi: `resumen?semanas=N` (serie semanal, patrones, localidades, corte, abiertos), `estado`, `sincronizar` (segundo plano) — ver `app/services/entregas_flex.py` y Flujo T |
| `/api/mensajeria/*` | GET/POST/DELETE | Bearer | Pagos de mensajería: días de envíos, lotes de pago, ticket de aprobación y comprobante — ver `app/services/mensajeria_pagos.py` y Flujo K |
| `/api/precios-trm/*` | GET/PUT/POST | Bearer / nivel administrador | Precios indexados a la TRM: estado y propuesta, config, recalcular, aplicar, descartar — ver `app/services/precios_trm.py` |
| `/api/costos-ia` | GET | — | Costos LLM vía API (hoy/semana/histórico 30d); ver `app/services/llm_budget.py`. Consumido por `bot-mckenna` `/costos-ia` |
| `/api/contabilidad/cc/*` | GET/POST/PATCH/DELETE | Bearer | Libro Mayor propio (partida doble): plan de cuentas, terceros, medios de pago, movimientos, cuentas T, balance de comprobación, plantillas (socios, proveedores, préstamos, ingreso/egreso) — ver `app/services/contabilidad_core.py` y Flujo J |
| `/api/contabilidad/cc/movimientos/<id>/comprobante` | GET/POST/DELETE | Bearer | Ver/adjuntar/quitar el comprobante de sustento de un asiento (clave para compras sin factura fiscal) |
| `/api/contabilidad/cc/arbol` | GET | Bearer | El Libro Mayor como árbol del PUC con saldos por nivel (`solo_movimiento=0` para ver también las cuentas sin usar) — ver `app/services/contabilidad_mayor.py` |
| `/api/contabilidad/cc/extracto/<id>` | GET | Bearer | Extracto de una cuenta: saldo inicial, cada línea con su contrapartida y saldo corrido, resumen por tercero. `subcuentas=1`, `tercero_id`, `desde`/`hasta`. Añadir `.pdf` o `.csv` para el documento |
| `/api/contabilidad/cc/auxiliar-terceros` | GET | Bearer | Auxiliar por tercero: cada tercero con sus cuentas y saldos (`desde`/`hasta`). `cc/arbol?terceros=1` agrega el mismo desglose dentro de cada cuenta |
| `/api/contabilidad/cc/balance.pdf` | GET | Bearer | Balance de comprobación jerárquico en PDF, con la sangría por nivel del PUC |
| `/api/ventas-directas/*` | GET/POST/PUT | Bearer / permiso `cotizar-facturar` | Venta directa WhatsApp: calcular IVA por línea, precio sugerido, borrador, cotizar (PDF + Alegra `/estimates`), facturar (DIAN), anular, pedidos del agente IA — ver `app/services/ventas_directas.py` y Flujo R |
| `/api/pagos/*` | GET/POST | Bearer | Solicitudes de pago: categorías, opciones desde saldos reales, previsualización del asiento, crear/aprobar/rechazar; `proveedores` (libro + Alegra), `proveedores/adoptar`, `productos` (catálogo Alegra), `verificar-factura` (multipart, cotejo sin LLM), `solicitudes/<id>/factura` — ver `app/services/pagos_wizard.py`, `pagos_proveedor.py` y Flujo O |
| `/api/prestamos/*` | GET/POST | Bearer | Préstamos de terceros con cronograma: simular, crear, cuotas, pagar, documento PDF (contrato/certificado), envío al prestamista, contacto Alegra y ticket mensual — ver `app/services/prestamos.py` y Flujo M |
| `/api/conciliacion/*` | GET/POST | Bearer / permiso `libro-mayor` o `conciliacion-contador` | Cruce declaraciones del contador (350/490 bajados de Gmail) ↔ cuenta 2365: hallazgos con clave estable, decisiones del wizard y TKT — ver `app/services/conciliacion_contador.py` y Flujo J |
| `/api/contabilidad/autopost` | POST | Bearer | Postea manualmente al Libro Mayor lo que agrega `armar_libro()` en el rango dado — ver `app/services/contabilidad_autopost.py` |
| `/api/contabilidad/ingresos-egresos/manuales` | GET | Bearer | Asientos manuales del Libro Mayor en formato de fila de libro, para fusionar con `armar_libro()` en Ingresos/Egresos |
| `/api/contabilidad/extractos/pendientes` | GET | Bearer | Líneas de banco (extractos de la empresa) sin ningún vínculo en el rango — bandeja "Pendientes por clasificar". Con `tercero_id` (también en GET/POST `/extractos`) opera sobre los extractos PERSONALES de ese socio |
| `/api/socios/*` | GET/POST/PATCH/DELETE | Bearer / propio socio o admin real | Expediente fiscal de socios (Declarador): perfil, documentos, años gravables, hallazgos, cruces banco socio ↔ empresa, agente con herramientas — ver `app/routes_declarador.py` y Flujo Q |
| `/api/mapa-sistema/*` | GET/POST | Bearer / administrador o permiso `mapa-sistema`, `combos` (escritura: admin o `fichas`) | Mapa vivo de la cadena del producto y del ciclo de pago, anatomía de combos, propuesta de EAN, unión documento↔materia prima por SKU y diagramas de Archify — ver `app/services/mapa_producto.py` y Flujo U |
| `/api/grabaciones/*` | GET/POST/PATCH/DELETE | Bearer (archivos de video sin Bearer: el id es el token) | Grabaciones de pantalla por trozos, recorte de sección, clips MP4 y envío por el bridge supervisor — ver Flujo S |
| `/confirmar-pago` | POST | — | Confirma/rechaza pago |
| `/training/agregar-caso` | POST | — | Agrega caso de entrenamiento |

**CORS**: habilitado para `localhost:5173` (Vite dev), `tauri://localhost`. Middleware manual en `routes.py`.

**Pedidos tienda web:** lógica en `PAGINA_WEB/site/website.py` y alertas/comandos en grupo `GRUPO_PEDIDOS_WEB_WA` vía `app/tools/web_pedidos.py` (facturación al entregarse, envío y anulación desde WhatsApp — ver Flujo H).

---

## Panel de Operaciones React (`desktop/`)

**URL**: `http://localhost:8081/app`  
**Stack**: React 19 + TypeScript + Vite + Tailwind CSS + Zustand + React Query  
**Build**: `desktop/dist/` (servido por Flask como archivos estáticos, **solo con sesión**)

**Acceso al panel** (`app/spa_sesion.py`): `/app` y `/app/assets/*` exigen la cookie `mck_panel`
(HttpOnly, 8 h, la misma vida que la fila en `sesiones`). Sin ella se entrega `app/templates/
ingreso_panel.html`, HTML plano que no cuenta nada del proyecto; ese archivo es lo único público.
La cookie la dejan el login, la vuelta de Google, `/app?_token=` y `POST /api/tickets/auth/sesion-panel`
(la pantalla de ingreso la usa para revalidar una sesión que ya estaba en el navegador, sin volver a
pedir la contraseña). `PANEL_SIN_SESION=1` en el `.env` es el interruptor de emergencia. La API no
cambió: sigue con el token Bearer.
⚠️ **La app Android (WebView, UA `McKennaPanelAndroid`) también pasa por esa pantalla:** su «Entrar con
Google» debe ir a `/app/auth/google/start?app=android`, o la vuelta de Google se queda en Chrome y la app
nunca recibe la sesión (22-sep-2026: Victor y Stella, mismo Vivo V2066 con la APK 1.3.1, no pudieron
entrar desde el 21-sep). Cualquier pantalla de ingreso nueva debe detectar el UA igual que
`googleAuthStartUrl()`. **Celular (23-sep-2026):** «Agenda» es la misma agenda de escritorio (Layout +
FlujoNav) con la barra inferior `BarraMovil` (Agenda · Hugo · Mensajes · Rápido · Yo); el hub solo pinta
esas cuatro pestañas, con el mismo lenguaje de la piel «flujo».

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
# scripts/generar_catalogo.py - flujo:
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

- **Modelo por canal**: asignado en `app/services/canales_config.py` / editable en Panel → Sistemas → Chat de Agentes → Canales (persistido en `app/data/canales_modelos.json`). Claude `claude-sonnet-5` es el default en `whatsapp`, `web_chat` y `meli_preventa`, vía `ANTHROPIC_API_KEY`. El canal `postventa` (borrador de respuesta a mensajes postventa MeLi recibidos por WhatsApp con `es_postventa=true`, ver Flujo C) usa `claude-opus-5` desde 2026-09-04 — prueba acotada por ser el caso con más ambigüedad; siempre pasa por aprobación humana antes de enviarse, así que un error de más solo cuesta una revisión extra, no un envío incorrecto.
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
| `app/tools/pipeline_contenido_facebook.py` | `python3 -m app.tools.pipeline_contenido_facebook --tipo ficha --slug acido-ascorbico` | Pipeline completo Copy→Imagen→Voz→Video→Facebook. `--auto` elige el contenido automáticamente |
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
| `app/tools/generar_guias_masivas.py` | 62 ingredientes farmacéuticos/cosméticos. Cada guía tiene 7 secciones HTML: descripción, concentraciones (tabla), compatibilidad, incorporación, almacenamiento, normativa INVIMA, FAQ. Integra PubMed. | `/PAGINA_WEB/site/data/guias.json` |
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
python3 -m app.tools.generar_guias_masivas

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

8. **Identidad fiscal en un solo lugar**: razón social, NIT y ciudad de McKenna salen
   de `app/services/empresa.py` (`EMPRESA_NIT`, default **901.316.016-3**, verificado
   contra `GET /company` de Alegra). Cada módulo puede sobreescribir con su propia
   variable (`CUOTA_MANEJO_PAGADOR_NIT`, `PRESTAMOS_MUTUARIO_NIT`), pero **el default
   sale de un solo sitio**. Nació de un incidente real (sep-2026): el NIT estaba escrito
   a mano en cuatro archivos y en dos decía "901.952.087-1", que no es el de la empresa —
   las **41 cuentas de cobro de cuota de manejo emitidas hasta el 2026-09-10 salieron con
   el NIT equivocado** y hay que reexpedirlas. `tests/test_empresa_identidad.py` recorre
   `app/`, `desktop/src/` y `scripts/` con `ast` y falla si el NIT viejo reaparece como
   literal en uso (en docstrings y comentarios sí puede, ahí está la historia).
   `empresa.digito_verificacion()` / `nit_valido()` comprueban el DV con el algoritmo
   de la DIAN antes de guardar un NIT — no detectan que sea de otra empresa, pero sí
   el dígito cambiado o transpuesto. Devuelven `None` (no `False`) cuando no hay DV:
   una cédula no lleva.
   **Ojo con el dígito del calendario tributario:** es el **6** (901.316.016**-3** → el 3
   es el DV), no el 3 — ver `app/services/calendario_tributario.py`.

9. **Fuente de verdad contable**: `app/services/contabilidad_core.py` (Libro Mayor propio,
   partida doble, `balance_comprobacion()`) es la fuente de verdad operativa de la contabilidad
   de McKenna — ventas, compras, servicios, impuestos y créditos se postean ahí automáticamente
   (`contabilidad_autopost.py`), y socios/préstamos/proveedores se registran ahí directamente.
   Alegra sigue recibiendo lo que ya recibía (facturación) y queda como herramienta de
   consulta/exportación para el contador, no como el sistema donde se lleva el control interno.
   Ver Flujo J y `docs/agentic/modules/contabilidad.md`.
