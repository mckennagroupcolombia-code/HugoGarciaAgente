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
MENSAJERIA_APROBADOR        # Username del panel que aprueba los pagos de mensajería (default: armando)
GRUPO_ALERTAS_SISTEMAS_WA   # WhatsApp: backup nocturno + fallos auditoría scripts (default en app/utils.py)
CONTABILIDAD_LEDGER_BUDGET_S # Segundos para APIs remotas en armar_libro (default 28, panel).
CONTABILIDAD_LEDGER_MAX_PAGINAS      # Tope de páginas al listar facturas (default 60)
CONTABILIDAD_LEDGER_MAX_PAGINAS_MELI # Tope de páginas de órdenes MeLi (default 25 ≈ 1.250 órdenes)
                             # Los tres defaults son del PANEL, donde vale más una cifra parcial
                             # rápida. Un BACKFILL necesita subirlos (1800 / 500 / 300): un período
                             # posteado a medias queda CUADRADO y parece completo, que es como nadie
                             # lo vuelve a mirar. El script ahora imprime los avisos de lectura
                             # truncada y el monto por fuente, para contrastar contra la facturación.
AGENTE_LOG_JSON             # 1 = eventos JSON una línea en stderr (http, tools, IA)
AGENTE_RESTRICT_FILE_TOOLS  # 1 o FLASK_ENV=production → limita parchear_funcion / crear_nuevo_script / ejecutar_script_python
AGENTE_FILE_TOOL_PREFIXES   # Prefijos relativos al repo permitidos (coma); ej. scripts/,app/tools/,tests/
AGENTE_NIGHTLY_GIT_PUSH     # 0 = no ejecutar git commit/push tras el backup de las 2:00
AGENTE_AUDITORIA_SKIP_WA    # 1 = scripts/auditar_scripts_cron.py no envía WhatsApp aunque falle
AGENTE_AUDITORIA_CRON_QUIET # 1 = cron auditoría no imprime línea si todo OK

# Préstamos de terceros (app/services/prestamos.py — ver Flujo M)
DECLARADOR_DIR               # Carpeta raíz del Declarador (default /home/mckg/Declarador; una subcarpeta por socio)
DECLARADOR_MODELO            # Modelo del agente del expediente de socios (default claude-sonnet-5)

PRESTAMOS_DIA_RECORDATORIO   # Día del mes del ticket de pagos a despachos (default 5)
PRESTAMOS_USUARIO_PAGOS      # Username que monta los pagos en Sucursal Negocios (default jerry)
PRESTAMOS_RECORDATORIO_ACTIVO # 0 = desactiva el cron sin tocar el crontab
PRESTAMOS_MUTUARIO_RAZON     # Razón social en el contrato (default McKenna Group S.A.S.)
PRESTAMOS_MUTUARIO_NIT       # NIT en el contrato (default 901.316.016-3, verificado en Alegra)
PRESTAMOS_MUTUARIO_REPRESENTANTE # Representante legal que firma (opcional)
PRESTAMOS_DOC_SOPORTE_ACTIVO # 1 = emite documento soporte real a la DIAN (default 0 = modo sombra)
PRESTAMOS_ALEGRA_ITEM_REF    # Referencia del ítem de intereses en Alegra (default INTERES-MUTUO)
PRESTAMOS_DIA_AVISO_RETENCIONES # Día del mes del ticket de retenciones (default 3, sobre el mes anterior)
UVT_<año>                    # Valor de la UVT si no está cargado en retenciones.py (ej. UVT_2027)
EMAIL_CONTADOR               # Correo del contador para el detalle mensual de retenciones
COMPRAS_SOCIOS_DOC_SOPORTE_ACTIVO # 1 = emite documento soporte real de compras a socios (default 0 = sombra)
COMPRAS_SOCIOS_ALEGRA_ITEM_REF    # Referencia del ítem de mercancía en Alegra (default MERCANCIA-SOCIO)
ALEGRA_ESPEJO_ACTIVO         # 1 = postea los asientos del Libro Mayor a Alegra como comprobantes
                             # contables (default 0 = sombra). **En 1 desde el 2026-09-14**: el
                             # contador arma el 350 con lo que ve en Alegra, y había $2.621.225 de
                             # retención practicada en 2026 que solo estaba en el libro. Enero–junio
                             # quedó reespejado; MercadoPago (111010) y publicidad en plataformas
                             # (529505) siguen sin cuenta en MAPA_PUC, así que las 3 facturas
                             # mensuales de MercadoLibre no se espejan todavía.
PRESTAMOS_USUARIO_CONTABILIDAD # Username que coordina con el contador (si no, Sistemas → Aliados)
ALEGRA_TEMPLATE_DOC_SOPORTE  # Plantilla de numeración supportDocument (default 10)

# Precios indexados a la TRM BanRep (app/services/precios_trm.py + scripts/precios_trm_cron.py, diario 8:40)
# Cada SKU guarda (precio, TRM del día en que se fijó); el cron PROPONE ajuste = variación TRM × traslado
# y un admin aprueba en /app → Rentabilidad → Precios TRM (escribe MeLi + Alegra, web al final del lote).
# Un cambio manual de precio reinicia la base de ese SKU. Traslado/umbral/redondeo en app/data/precios_trm_config.json.
PRECIOS_TRM_ACTIVO           # 0 = apaga el cron sin tocar el crontab
PRECIOS_TRM_QUIET            # 1 = no avisa por WhatsApp (pruebas)

# Recuperación de compra (app/tools/recuperacion_compra.py + scripts/recuperacion_compra_cron.py)
RECUPERACION_COMPRA_ACTIVO      # 0 = no envía correos a pedidos web sin pagar (el cron sigue instalado)
RECUPERACION_COMPRA_VENTANA_DIAS # Solo pedidos de los últimos N días (default 14)
RECUPERACION_COMPRA_MAX_POR_CORRIDA # Tope de correos por corrida del cron (default 20)

# Copia de abonos Bancolombia a la asesora (app/tools/reenvio_alertas_banco.py + scripts/reenvio_alertas_banco_cron.py, cada 5 min)
# Solo reenvía "Recibiste …"; OTP, claves y alertas de seguridad NUNCA (llegan al mismo buzón).
# Clasifica por el snippet, no por el cuerpo: el pie legal de todas las alertas dice "seguridad"/"clave".
# Dedupe con la etiqueta Gmail «Bancolombia/Reenviado asesora»; corte en app/data/reenvio_alertas_banco.json.
REENVIO_BANCO_ACTIVO         # 0 = apaga el reenvío sin tocar el crontab
REENVIO_BANCO_DESTINO        # Destinataria (default 23jenniffergarcia@gmail.com)
REENVIO_BANCO_INCLUIR_SALIDAS # 1 = también pagos salientes (quincenas, proveedores). Default 0

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
UVT 2026 = $52.374, Res. DIAN 000238/2025). La mayoría de estas compras queda **bajo
las 27 UVT** y no lleva retención. Explicación viva en /app → Préstamos → «Cómo funciona».
Ficha completa: `docs/agentic/modules/relaciones-socios-terceros.md`.

### O. Solicitudes de pago con asiento automático

```
/app → Contabilidad → Solicitudes de pago   (PagosWizardPanel.tsx)
  1. Elegir QUÉ se paga (13 categorías: proveedor, flete, servicio público,
     honorarios, prestación de servicios, arriendo, nómina, cuota de préstamo,
     reintegro a socio, impuestos, seguros, mantenimiento, otro)
  2. Las opciones salen de los SALDOS REALES: proveedores con deuda en 2205,
     cuotas del mes, servicios activos, retención pendiente en 2365
  3. Se MUESTRA el asiento antes de aprobar
  4. Al aprobar → asiento en el Libro Mayor + comprobante en Alegra
```

**Por qué existe:** hasta sep-2026 los pagos se aprobaban como tickets de texto
libre ("APROBAR PAGO DE FACTORES") y el asiento dependía de que alguien se
acordara después. No se hacía — el Libro Mayor tenía las compras pero no los
pagos, y Bancos quedaba descuadrado. Es el mismo patrón que ya falló con las
notas crédito (6 semanas) y las compras Gmail (96 sin postear): **lo que se deja
como paso manual posterior, no se hace**.

**Wizard simple (15-sep-2026).** La puerta de entrada es una sola pantalla: proveedor · fecha ·
cuenta de salida (viene puesta en **Bancolombia ahorros 42800000974**) · concepto (**Productos**
1435 / **Servicios** · **Saldo pendiente** · **Impuestos**) · cuenta del PUC · valor solicitado ·
botón **Solicitar**, uno solo: quien solicita no decide si se salta
la aprobación (el registro directo sigue existiendo en el recorrido largo). El asiento se sigue viendo antes de solicitar — eso no se quitó,
es lo que evita firmar a ciegas. El recorrido largo (productos con SKU + factura cotejada) sigue
existiendo y se abre con el enlace «Compra con productos y factura cotejada» o desde el Centro de
Mando; las categorías `productos` y `servicios` llevan retención (compras / servicios) pero **no**
exigen SKU ni cotejo, así que una compra de mercancía con factura debe ir por el recorrido largo.
La bandeja ya no lista los borradores de cuotas de préstamo que monta el cron (son de Préstamos y
solo eran ruido); si una sale a aprobación, ahí sí aparece.

**La cuenta del PUC decide el impuesto, no el botón (17-sep-2026).** Había un botón por concepto
(Productos, Servicios, **Transporte**, **Servicios públicos**) *y* un selector de cuenta: la misma
pregunta hecha dos veces con distinto vocabulario, y podían contradecirse — «Servicios» traía el 4%
aunque el gasto fuera a 513550 Transporte, donde la tarifa es el 1%. El botón fijaba el impuesto y
la cuenta fijaba el balance. Ahora **`app/services/impuestos_por_cuenta.py`** traduce cada cuenta a
su concepto de retención y su tarifa de ICA de Bogotá, `previsualizar()` lo usa cuando la categoría
es `cuenta_libre`, y el panel muestra debajo del selector qué dedujo y qué advertir. Los botones de
Transporte y Servicios públicos se **ocultaron** (`"oculta": True`, igual que `salario_socio`: las
categorías no se borran porque hay solicitudes históricas con ese valor); un servicio público se
paga por **Servicios** eligiendo 513530/513525/513535/513555, y ahí el número de contrato aparece
solo. `cuentas_gasto()` devuelve el perfil de cada cuenta para que el panel deje las casillas
puestas, y `cc_terceros.medio_pago_default` completa la ficha de pago recurrente (cuenta del gasto
+ impuestos + de qué cuenta sale) para no volver a elegir lo mismo cada mes.

**Cada cuenta lleva su guía, y el wizard ya no pregunta impuestos (18-sep-2026).**
`puc_colombia.DESCRIPCIONES` documenta **las 79 cuentas** del plan: qué operación vive en cada una,
en el lenguaje del negocio y señalando donde McKenna la usa distinto de lo que su nombre del PUC
sugiere (511095 son las **quincenas de prestación de servicios** pese a llamarse «Honorarios —
otros»; 5195 es el **cajón de sastre** que ya acumuló $3,17M mal clasificados; 513550 remite a
523550 para el flete de ventas). `contabilidad_core._con_guia()` la pega a **toda** cuenta que sale
de `listar_plan_cuentas` / `obtener_cuenta`, junto con el efecto tributario de
`impuestos_por_cuenta`, así que viaja sola al **árbol del PUC** (tooltip), al **extracto**
(cabecera), al **PDF** y al **CSV** que se le manda al contador. Van en dos fuentes a propósito: la
descripción dice QUÉ operación es y la nota tributaria QUÉ impuestos acarrea — se corrigen por
razones distintas. `descripcion()` hereda de la cuenta mayor, así que una subcuenta nueva dice algo
útil antes que nada; un test exige que ninguna cuenta de `PUC_MCKENNA` quede sin guía.

**El wizard informa los impuestos en vez de preguntarlos.** Se quitaron «¿quién asume la
retención?», «¿lleva retención de ICA?» y la casilla del 4x1000 del recorrido principal: la
respuesta ya está en los datos —la **cuenta** dice el concepto y la tarifa, la **ficha del tercero**
dice si está exento, si es del SIMPLE y con qué ICA— y contestarlas bien doce veces al año y
olvidarlo una es lo que produjo los $164.542 retenidos de más en septiembre. Ahora el bloque muestra
la cuenta con su descripción y **las cifras reales calculadas por el backend** (retefuente, ReteICA,
GMF) con el motivo de cada una; los ceros también se muestran, porque «$0 porque es autorretenedor»
dice más que una casilla sin marcar. Queda **«Ajustar»**, plegado, para lo único que el PUC no puede
saber: el gross-up («te pago libre de retención» es un acuerdo comercial), la tarifa de ICA de otro
municipio y el GMF. El default de `retencion_modo` pasó de `mckenna` a **`beneficiario`** — lo normal
es descontársela a quien cobra; el gross-up es la excepción y vive en la ficha del tercero.

**Mensajería: 523550 + 1 % + ReteICA 4,14 ‰ (18-sep-2026).** El contador fijó cómo se contabiliza el
servicio de mensajería: gasto **523550 Transporte, fletes y acarreos (ventas)** —el flete de la
mercancía que sale al cliente es gasto de VENTAS; 513550 se queda para el transporte
administrativo—, **retefuente 1 %** y **ReteICA 4,14 por mil** (transporte, Bogotá). Las dos tarifas
reproducen al peso el certificado que él mismo expidió a NEXT ENVIOS por 2024 ($173.775 y $71.943
sobre base $17.377.500), así que no son una lectura nuestra de la norma. El operador solo escribe el
valor: la cuenta y el ICA salen de la ficha del tercero y la retención del perfil de la cuenta.

⚠️ **Fidel Rocha quedó DESMARCADO de Régimen SIMPLE** por esto. Retener es incompatible con el
Art. 911 E.T., así que sostener las dos cosas a la vez era imposible y la bandera habría anulado
justo las retenciones que el contador pidió practicar. **Pendiente: pedirle el RUT** para confirmar
el régimen; si resultara estar en el SIMPLE hay que devolverle lo retenido y volver a marcarlo. Lo
anterior a esta fecha se pagó completo y **se deja como está** (decisión del usuario): los asientos
5396-5399 de jul-ago 2026 van contra 513550 y sin retención.

**Transporte de carga al 1 %** (`retenciones.CONCEPTOS["transporte_carga"]`, 4 UVT). Estuvo fuera
de la tabla a propósito hasta sep-2026 —«inventar la tarifa le sale del bolsillo a alguien»— pero
ya no se está inventando: el propio contador la certificó al **1 %** («SERVICIOS 1.0», base
$17.377.500, retención $173.775) en el certificado año gravable 2024 a NEXT ENVIOS S.A.S. También
se cargaron `transporte_pasajeros` (3,5 %), `comisiones` (10/11 %, sin mínimo),
`arrendamiento_inmueble` (3,5 %, 27 UVT), `arrendamiento_mueble` (4 %, sin mínimo) y
`otros_ingresos` (2,5/3,5 %). ⚠️ **Las transportadoras grandes son autorretenedoras** y no se les
retiene: eso es una propiedad del tercero (`retefuente_exento`), no del concepto, y el wizard lo
advierte. El default retiene a propósito — retenerle a un autorretenedor produce un reclamo
visible, no retenerle a quien sí debía produce una deuda silenciosa del Art. 370 E.T., que es
exactamente lo que pasó con la mensajería de Fidel.

**La retención va a su subcuenta también al aprobar (17-sep-2026).** `previsualizar()` mostraba
236525/236540/236515 y `aprobar()` posteaba contra **2365 plana**: se le enseñaba una cuenta a
quien firma y se contabilizaba otra, y el contador tenía que desglosar el 350 a mano teniendo el
sistema el concepto guardado. `aprobar()` ahora resuelve la subcuenta con
`puc_colombia.cuenta_retencion(s["retencion_concepto"])`.

**Régimen SIMPLE: ni renta ni ICA (17-sep-2026).** `regimen_simple` apagaba solo la retención de
renta y el ICA se seguía calculando, así que a un tercero del SIMPLE con tarifa en su ficha se le
retenía un impuesto que ya paga dentro del SIMPLE. La exención del Art. 911 E.T. es por **quién
recibe**, no por el concepto: da igual si el pago es de honorarios, de servicios o de transporte, y
el ICA va consolidado en el SIMPLE (Art. 907 E.T.). Es la **única** excepción a la regla de que
«apagar la renta no apaga el ICA» — ahí se trata de un tercero exento de retefuente que sigue
siendo sujeto de ICA (Víctor, Stella, Jenniffer); acá el tercero no es sujeto de ninguno de los dos.
Caso que lo destapó: Fidel Rocha Morón (CC 9.385.573), que facturó como NEXT ENVIOS S.A.S hasta la
FV1637 del 2024-05-01 y desde jun-2024 cobra como persona natural del SIMPLE con cuenta de cobro
(Art. 616-2 E.T.) — el contador nunca le practicó retención y **hace bien**.

**Perfil tributario desde las facturas electrónicas (18-sep-2026).**
`app/services/perfil_tributario_dian.py` lee los XML `AttachedDocument` UBL 2.1 que
`sincronizar_facturas_de_compra_siigo.py` ya guarda en `facturas_descargadas/` (2.235 archivos, 113
emisores) y saca de `AccountingSupplierParty/cbc:TaxLevelCode` las **responsabilidades fiscales del
RUT** de cada proveedor: `O-15` autorretenedor y `O-47` Régimen SIMPLE son las que cambian cuánto se
gira. Así se obtiene la información de la DIAN sin acceso privilegiado: (1) el **correo**, que es la
entrega con validez legal (Res. 042/2020) y es lo que ya cosechamos; (2) el portal
`catalogo-vpfe.dian.gov.co` → «Documentos recibidos», descarga en lote, sin API de listado; (3) el
SOAP `vpfe.dian.gov.co/WcfDianCustomerServices.svc`, que emite y consulta UN documento por CUFE pero
**no lista lo recibido**.

⚠️ **Propone, nunca aplica.** `TaxLevelCode` lo escribe el emisor sobre sí mismo y puede estar mal:
**DUQUE SALDARRIAGA (860508007) se declara `O-47` SIMPLE en 10 de sus 64 facturas y es régimen común
autorretenedor.** Por eso cada propuesta muestra «en N de M facturas» — la proporción es la señal (los
falsos salen en minoría: Duque 10/64, Envasar 14/42; los ciertos en bloque: Sodimac 114/114) — y
`aplicar()` exige que alguien decida y deja traza con fecha, quién y por qué. `descartar()` registra
el «no» junto con la evidencia del momento y la propuesta **vuelve si el respaldo se duplica**: una
lista que no converge deja de leerse, y un «no» con 10 facturas no debe silenciar el aviso cuando ya
son 60. El XML **no** trae la retención que McKenna debe practicar (`WithholdingTaxTotal` son las del
emisor) ni a quien no factura electrónicamente — una cuenta de cobro del Art. 616-2 jamás aparece ahí,
que es el caso de la mensajería de Fidel Rocha: cero facturas en 2.235 XML.

⛔ **El registro de facturas de compra quedó APAGADO (18-sep-2026).** Era el paso doble: la compra
se pagaba por Solicitudes de pago y después se volvía a registrar cuando llegaba la factura, con
riesgo de contarla dos veces y en el orden al revés —el documento llega después de que la plata ya
se comprometió—. Se apagaron los **dos** caminos: `sincronizar_facturas_de_compra_siigo()` (por NIT)
y `procesar_facturas_para_importar_productos()` con sus comandos de WhatsApp `inv ok / inventario /
gasto`. **`inv skip` sigue vivo** a propósito: quedaron facturas encoladas de antes y sin él la cola
no se podría vaciar nunca. Bandera: `FACTURAS_COMPRA_REGISTRO_ACTIVO=1` lo reactiva.

⚠️ **Lo que NO se apagó es la descarga de los XML** (`descargar_xml_facturas_compra()`, que corre en
los dos caminos deshabilitados). No es un detalle: esos XML en `facturas_descargadas/` son la fuente
de `perfil_tributario_dian.py`, que saca de `cbc:TaxLevelCode` quién es autorretenedor (O-15) y
quién está en Régimen SIMPLE (O-47) — el dato que decide cuánto se le retiene a cada proveedor.
Apagar el módulo entero habría dejado ese perfil congelado sin que nadie lo notara. El botón del
panel se renombró a «Bajar XML de facturas».

**La compra se contabiliza con la cotización, no con la factura (18-sep-2026).** «Productos» del
wizard simple ya no pide un valor global: se eligen las **materias primas por su referencia** del
catálogo de Alegra con la cantidad y el precio de la cotización del proveedor, y el asiento la
reproduce **renglón por renglón** contra 1435. El objetivo es no registrar la compra dos veces —una
para pagarla y otra para contabilizarla cuando llegue la factura—, que es lo que hoy hace el módulo
de facturas de compra. `productos_opcionales` deja pasar el insumo que no está en el catálogo con
un valor global: bloquearlo empujaría al operador a «Otro», donde se pierden la retención y la
cuenta.

Tres cosas que el picker hacía mal y se corrigieron en `pagos_proveedor.productos()`:
- **Mezclaba combos con materias primas.** En Alegra conviven `type="product"` (la materia prima
  suelta, `CITCALg` = citrato de calcio por gramo, que es lo que el proveedor despacha) y
  `type="kit"` (el combo `C-CITCAL500g` que McKenna arma y vende). Una compra entra por el primero;
  ahora los combos quedan fuera salvo `incluir_combos=True`.
- **El precio salía siempre en 0**: leía `price` y el catálogo lo guarda en `precio_lista`.
- **Suponía IVA 19% a todo.** **254 de los 316 productos están EXCLUIDOS** (Art. 424 E.T.), así que
  el IVA sale de cada ítem del catálogo, no de un default.

⚠️ **El IVA del catálogo de Alegra NO es confiable para comprar.** Probado el 18-sep-2026 con la
cotización real PRE0031580 de Factores y Mercadeo (14 materias primas): la misma sustancia está
marcada **19% como `kit`** (el combo que McKenna vende) y **0% como `product`** (la materia prima)
—alulosa, gelatina e inulina, las tres—, y el reparto es un espejo exacto entre los dos tipos
(80% de los kits en 19, 80% de los productos en 0): ese flag nunca se curó para los insumos.
Armando el asiento con él, esa cotización daba **$0 de IVA contra los $619.115 reales**.

Por eso el IVA del catálogo es **solo un punto de partida** y el control real es
**`total_documento`**: el operador teclea el total de la cotización o factura y el sistema exige
que las líneas lo sumen. Como total = base + IVA, una tarifa mal puesta hace que no dé.
`previsualizar()` devuelve `aviso_documento` y `enviar_a_aprobacion()` **rechaza** el descuadre —
se puede guardar un borrador a medias, pero no se aprueba un asiento que dice algo distinto de la
factura que lo sustenta. El campo es opcional: hay compras sin documento a la mano y bloquearlas
empujaría al operador fuera del wizard.

Con el IVA tomado del documento, esa cotización reproduce **todas** sus cifras al centavo:
mercancía $4.531.500 · IVA $619.115 · retención 2,5% $113.287,50 · **girado $5.037.327,50**, que es
el «Total General» del documento — el proveedor ya descuenta la retención en su cotización.

⚠️ **El IVA ya no se carga a inventario.** Antes el asiento debitaba a 1435 el total **con IVA**:
inflaba el inventario con un impuesto que no es costo de la mercancía —es un crédito contra la
DIAN— y dejaba el formulario 300 imposible de armar leyendo el libro. Ahora va a **240810 IVA
descontable**, que es la mitad que faltaba del 300 (`iva_ventas.py` ya cubría la otra).

Dos defectos de `aprobar()` que esto destapó: reconstruía el asiento con **`lineas[0]`** (con cinco
productos habría contabilizado uno y descuadrado el asiento) y **no le devolvía los `items`** a
`previsualizar`, con lo que el detalle por referencia se perdía justo al contabilizar. La
proyección de líneas conserva ahora `cuenta_codigo` para poder distinguir las líneas del gasto de
las que la reconstrucción rearma con los impuestos aprobados.

**El gross-up se pacta, no se elige (18-sep-2026).** `retencion_modo="mckenna"` significa que
McKenna **asume** la retención del tercero como mayor gasto y le gira el valor completo. Mientras
fue un radio del wizard, cualquiera podía activarlo con un clic: sobre la quincena de mensajería
($1.998.000) son **$28.657 que salen del banco de más**, cada quincena, sin que nadie lo pactara.
Ahora solo se acepta si la ficha del tercero dice que así se acordó
(**`cc_terceros.retencion_asume_mckenna`**, apagado para todos por defecto y editable solo en
Libro Mayor → Configurar → Terceros). `previsualizar()` lo valida en el **backend** —por
`retencion_modo` y por `valor_es_neto`, que era la puerta de atrás— y devuelve `aviso_gross_up`
explicando por qué lo ignoró: esconder un radio no es un control, es una sugerencia.

⚠️ **`retefuente_exento` ya NO se deduce de `retencion_modo`.** Mientras el modo era una respuesta
del operador, «ninguna» quería decir «sé que a este no se le retiene» y aprenderlo servía. Al dejar
de preguntarlo pasó a ser **consecuencia de la cuenta** (513530 manda «ninguna» porque la energía no
retiene; 513550 manda «beneficiario» porque sí), y seguir aprendiendo de ahí habría marcado exento a
cualquiera al que se le pagara un recibo de luz y, peor, **desmarcado a los autorretenedores reales**
—Interrapidísimo, Sodimac— en cuanto se les hiciera un pago con cuenta que retiene, reteniéndoles
indebidamente al siguiente. La exención se cambia en la ficha o desde `perfil_tributario_dian`.

**«Libre de retención» (15-sep-2026).** A un prestador de servicios se le pacta «te pago
$1.100.000 libres de retención»: ese valor es **lo que recibe**, no la base gravable. Con
`valor_es_neto` el wizard hace el camino inverso —base $1.145.833, retención $45.833 a la 2365,
girado $1.100.000 exacto— y la retención la asume McKenna como mayor gasto. Retener sigue siendo
obligatorio; lo que cambia es quién la soporta. Sin la bandera, el valor es el total facturado y la
retención se descuenta (es lo correcto cuando hay factura). Transporte **no** lleva retención en el
wizard a propósito: la tarifa de transporte (carga 1%, pasajeros 3,5%) no está en
`retenciones.CONCEPTOS` y la mayoría de transportadoras son autorretenedoras — inventarla le sale
del bolsillo a alguien.

**Impuestos y retenciones, preguntados antes de solicitar (16-sep-2026).** El wizard simple tiene
un bloque propio con tres cosas que antes se asumían:

- **¿Quién asume la retención?** `retencion_modo` = `mckenna` (libre de retención, gross-up; es el
  default de Productos y Servicios) · `beneficiario` (se le descuenta; lo normal con factura) ·
  `ninguna` (autorretenedor, Régimen SIMPLE o bajo la cuantía). Nació de un error con plata real:
  el 15-sep se le giró a dos personas la quincena **menos** la retención cuando estaba pactada
  libre — Gloria $1.200.000 de $1.250.000 y Jenniffer $1.535.040 de $1.599.000. Corregido el
  16-sep en dos movidas: (a) los asientos 1793 y 1795 se **anularon** y se rehicieron (1872 y 1873)
  con la retención practicada sobre la **base completa** —Gloria base $1.302.083,33 / ret
  $52.083,33; Jenniffer base $1.665.625 / ret $66.625— dejando en cada asiento el crédito a Bancos
  por lo que de verdad salió ese día; (b) las solicitudes complementarias **#14 ($50.000) y #15
  ($63.960)** giran la diferencia, **sin retención** porque ya está practicada completa. Así el
  gasto y la base del 350 suman el total y cada asiento cuadra contra su propio movimiento de
  banco. El espejo viejo en Alegra (comprobante 124) se anuló; los nuevos son el 128 y el 129.
- **Retención de ICA** (`ica_por_mil` → cuenta **2368**): la tarifa la escribe quien solicita; no se
  adivina en código porque depende del municipio y la actividad (Bogotá: 9,66 servicios · 11,04
  comercial · 4,14 industrial). En modo `mckenna` el gross-up considera renta + ICA juntos.
- **GMF 4x1000** (`gmf` → cuenta **530595**, `GMF_TARIFA = 0.004`): no se le descuenta a nadie —
  lo cobra el banco sobre lo que sale y es gasto de McKenna, así que el crédito a 1110 es
  `girado + gmf`.

Las tres quedan guardadas en la solicitud (`retencion_modo`, `retencion_ica`, `ica_por_mil`, `gmf`)
y `aprobar()` rearma el asiento con **lo que se firmó**, no con las tarifas de hoy. `girado` =
monto − retención − ICA (el GMF no, ese no es del beneficiario).

**Aprobar no es girar — el ciclo de los dos tokens (15-sep-2026).** En Bancolombia el giro necesita
dos personas: una monta la transacción en la Sucursal Virtual con su token y otra la aprueba con el
suyo. Antes eso vivía fuera del sistema y una solicitud «aprobada» podía llevar semanas sin girarse
sin que nadie lo viera, con el comprobante en un chat. Ahora el estado lo refleja:

    borrador → pendiente → aprobada → en_banco → pagada

`aprobada` es contable (ya hay asiento), `pagada` es bancario (ya salió la plata **y** está el
soporte). **Cada paso es de una persona distinta y el panel solo muestra el botón que le toca a
quien está mirando** (15-sep-2026): el solicitante pide; el primer administrador que llegue
(Cynthia o Armando) aprueba y contabiliza, y a **ese mismo** le aparece «Ya lo preparé en Sucursal
Negocios»; al **otro** le aparece «La solicitud ha sido aprobada» con la captura del banco, y ahí
cierra el ciclo (el ticket se marca resuelto y el comentario avisa a quien lo pidió). El backend lo
exige, no solo la interfaz: `montar_en_banco()` rechaza a quien no aprobó y `confirmar_pago()`
rechaza a quien ya aprobó o preparó — si una sola persona hiciera los tres pasos, los dos tokens del
banco dejarían de ser dos pares de ojos. La identidad sale de `X-Tickets-Token`
(`_panel_tickets_usuario`); con el token de sistema, sin persona identificada, se deja pasar como
antes. Aprobar es de nivel administrador (`puede_registrar_directo`), validado también en la ruta. `montar_en_banco()` y `confirmar_pago()` en `pagos_wizard.py`; rutas
`POST /api/pagos/solicitudes/<id>/montar`, `POST …/confirmar-pago` (multipart con el comprobante) y
`GET …/comprobante`. El segundo visto bueno **pega la captura con Ctrl+V** (`CapturaComprobante`, también arrastrar o
elegir archivo): quien acaba de hacer la transacción tiene la imagen en el portapapeles, no un
archivo guardado — obligarlo a guardarla y buscarla es el paso donde el comprobante se deja «para
después». **Confirmar exige el comprobante** — un pago marcado como hecho sin soporte es
justo lo que después nadie concilia contra el extracto; el archivo queda en la solicitud y también
pegado al asiento. Los KPIs de la cabecera separan «Aprobadas, falta girar» de «Giradas con
comprobante».

**Pagos de impuestos desde el recibo del contador (17-sep-2026).** Concepto «🏛️ Impuestos» en el
wizard simple (`PagoImpuestos` en `PagosWizardPanel.tsx`, `app/services/pagos_impuestos.py`,
`GET /api/pagos/impuestos/recibos`, `POST /api/pagos/impuestos/solicitar`, `GET …/recibos/<n>/pdf`).
Lista los recibos que `descargar_soportes_contador.py` + `extraer_declaraciones_contador.py` dejaron en
`docs/contabilidad/<año>/declaraciones_contador.json` y pone la cuenta sola: 490 concepto 61 de un 350 →
**2365**, concepto 62 de un 350 → **2367** (reteIVA), 490 de un 300 → 2408, de un 110 → 2404, RTICA de
Hacienda → 2368, ICA anual → 2412. Pagar un impuesto **no es gasto**: baja el pasivo causado. La
solicitud lleva `referencia = dian:490:<n>` (o `sdh:<n>`, la misma de Conciliación contador) y el PDF del
recibo como soporte; un recibo ya asentado —por referencia, solicitud o un débito del mismo valor ±7 días
en esa cuenta (línea PSE del extracto)— no se ofrece otra vez. Avisa cuando el libro tiene causado menos de
lo que se paga (hoy: la 2367 y la 2368 están en cero aunque se declaran cada período) y cuando el 350
descuenta retenciones en exceso (renglón 129). ⚠️ La bitácora vieja `app/services/impuestos.py`
(`impuestos_pagos.json`) postea como gasto **5195** (`FUENTE_MAPEO["operativos_impuestos"]`): no registrar
ahí un pago que ya va por el wizard.

**Pago a proveedor con productos y factura (13-sep-2026).** Las categorías `compra_proveedor` (1435) y
`factura_proveedor` (2205) llevan `con_productos` + `requiere_factura`: el wizard pasa por
**proveedor** (terceros del libro + contactos «provider» de Alegra, `app/services/pagos_proveedor.py`;
un contacto se adopta como tercero al elegirlo), **productos con SKU** del catálogo espejo de Alegra
(precio sin IVA, IVA por línea; el monto es la suma con IVA y la retención va sobre la base), y
**factura o cotización cotejada** (`POST /api/pagos/verificar-factura`: XML DIAN, PDF o ZIP; NIT,
número, total y cada producto; sin LLM) antes de «Enviar a aprobación». Sin productos o sin cotejo
el backend rechaza la solicitud; si el cotejo no es fiel, exige una explicación que viaja al ticket.
El Centro de Mando ofrece «💸 Solicitud de pago a proveedor», que redirige a este wizard, y
`POST /api/tickets` rechaza (400 + `redirigir: "pagos"`) una solicitud de texto libre que parezca
un pago a proveedor (`routes_tickets._parece_solicitud_de_pago`). El aprobador sale del aliado
`pagos_aprobador` (Sistemas → Aliados) o de `PAGOS_APROBADOR`; al aprobar, la factura queda como
soporte del asiento.

**Dos caminos, un solo motor:**
- **Solicitar** (cualquiera con permiso `pagos`): crea la solicitud → ticket al
  aprobador → al aprobar nace el asiento.
- **Registrar directo** (solo nivel administrador — Cynthia y Armando): un paso,
  sin ticket. Ellos montan y aprueban sus propios pagos; auto-aprobarse en dos
  pasos es burocracia sin control real. Queda anotado «Registrado directamente
  por X» y el panel lo marca con un chip: saltarse el control es válido,
  **ocultarlo no**. Un test verifica que el asiento sea idéntico por ambos
  caminos — si divergieran, un mismo pago quedaría contabilizado distinto según
  quién lo registre.

**Tres decisiones:** (a) el asiento se muestra antes de confirmar por los dos
caminos — firmar un monto sin ver la cuenta es firmar a ciegas; (b) el asiento
nace al **aprobar**, no al solicitar, así una solicitud rechazada no deja rastro;
(c) si Alegra falla, el asiento interno igual queda y el espejo se reintenta. `aprobar()` no
contabiliza dos veces: la guarda es **tener `movimiento_id`**, no el estado — una solicitud ya
girada («en_banco», «pagada») pasaba de largo por el control de estado y un segundo clic habría
duplicado gasto y retención (16-sep-2026).

**La cuenta contable la elige el operador (sep-2026).** La categoría propone una cuenta
(`cuenta_debito`) pero ya no la impone: las categorías con `cuenta_libre` muestran el selector
del PUC (`GET /api/pagos/cuentas-gasto`, `pagos_wizard.cuentas_gasto()`), y
`_validar_cuenta_elegida()` solo acepta gasto, costo o inventario — un pago no se carga contra
Bancos ni contra Ventas. Nació de un caso real: la quincena de quien presta servicios va a
**511095** y no al saco de 5135, y antes llevarla ahí obligaba a usar la categoría «Otro», con
lo que se perdía la retención propia de la categoría.

**El perfil tributario vive en el tercero, no en el pago** (`cc_terceros.retefuente_exento`,
`ica_por_mil`, `gmf_por_defecto`, `cuenta_gasto_default` — `_migrar_columnas_v5`). A Armando,
Cynthia, Víctor, Stella y Jenniffer **no se les practica retención de renta pero sí ICA (9,66 por
mil → 2368) y 4x1000**, y su gasto va a **511095**. Guardarlo en la persona y no en cada pago es
lo que evita que se olvide: lo que se olvida una vez se olvida siempre. Al crear una solicitud,
`_recordar_perfil_tributario()` **guarda en la ficha lo que el operador definió** (solo lo que el
pago trae explícito, y nunca sobre un tercero en Régimen SIMPLE), así que a partir del primer
pago las casillas vienen puestas.

⚠️ **ICA y retención de renta son impuestos distintos y se calculan por separado.** Elegir
«Nadie — no se practica retención» —que es lo que el perfil de estas personas selecciona— apagaba
también el ICA, así que justo a quienes el contador mandó practicárselo no se les practicaba
nunca. `aplica_renta` y `aplica_ica` son ahora condiciones independientes; lo único que apaga las
dos es `saldo_por_pagar`, donde los impuestos ya se causaron al reconocer el servicio.

**«Salario de socio» se ocultó** (`"oculta": True`, sep-2026): lo que Armando y Cynthia cobran es
prestación de servicios igual que la de Víctor o Stella, va a la misma cuenta y admite pago
parcial desde **Servicios**. Un botón aparte solo para socios sugería un trato distinto que no
existe. La categoría **no se borra** — hay solicitudes históricas con ese valor y eliminarla las
dejaría sin poder abrirse; `/api/pagos/categorias` filtra las ocultas.

**«Honorarios» y «Prestación de servicios» no son lo mismo** (sep-2026): quien
presta servicios operativos a McKenna sin ser nómina —calidad, empaque, apoyo—
va a **5135 con retención de servicios (4% declarante / 6% no)**, no a 5110 con
la de honorarios (10-11%). Sin esa categoría propia el pago solo podía entrar
como honorario o como «Otro», y una tarifa equivocada sale del bolsillo de una
persona real.

**Plan de cuentas ampliado** para que esto sirva: antes TODO gasto caía en 5135
«Servicios» (luz, contador y fletes juntos). Ahora hay 19 cuentas de gasto con
códigos PUC reales — 513550 Transporte/fletes, 513530 Energía, 5110 Honorarios,
5120 Arrendamientos… — y **las 35 cuentas están mapeadas a Alegra** una a una.
Ver `app/services/pagos_wizard.py` y `alegra_espejo.MAPA_PUC`.

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
/app → Supervisor → Grabar pantalla   (GrabacionPantalla.tsx)
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

### J. Contabilidad unificada (Libro Mayor propio, auto-posteo, préstamos, conciliación)

Ver ficha completa en `docs/agentic/modules/contabilidad.md`. Resumen:

```
app/services/contabilidad_core.py   Libro de partida doble propio: PUC, terceros, medios de
                                     pago, asientos (débito=crédito validado), cuenta en T,
                                     balance de comprobación. Plantillas: compra_socio_amazon,
                                     pago_socio, compra_proveedor, ingreso, egreso,
                                     prestamo_recibido/otorgado + sus abonos.
app/services/puc_colombia.py        **PUC real (Decreto 2650)**, desde sep-2026. El libro nació con
                                     códigos escritos a ojo y varios significaban otra cosa: `2367` NO es
                                     «costos y gastos por pagar» (es **IVA retenido**; eso es `2335`),
                                     `2380` NO es la cuenta de socios (es «Acreedores varios»; socios es
                                     `2355`), y `236515` NO es rendimientos financieros (es **honorarios**;
                                     rendimientos es `236535`). `ALIAS` mapea cada código viejo al real y
                                     `migrar(dry_run)` mueve los asientos. **`_cuenta_id_por_codigo()` resuelve
                                     por ese alias**, así que los ~60 call-sites que aún dicen `"2380"` siguen
                                     funcionando — la cuenta vieja no se borra, se desactiva. Ojo con el
                                     **código reutilizado**: `529505` dejó de ser publicidad (se fue a `523560`)
                                     y pasó a ser Comisiones (llegó desde `5299`, que en el PUC es
                                     «Provisiones»); `_orden_migracion()` vacía un código antes de rellenarlo,
                                     y si se invierte ese orden $105M de publicidad y $52M de comisiones
                                     terminan revueltos. `cuenta_retencion(concepto)` da la subcuenta de 2365
                                     por concepto (236525 servicios, 236540 compras…), que es como el
                                     contador arma el 350.
                                     ⚠️ **`migrar()` lleva registro** (`cc_puc_alias_aplicados`) de qué alias
                                     ya corrió, y los salta. No es opcional: después de la primera corrida
                                     `529505` ya no es publicidad sino Comisiones, y repetir el alias se
                                     llevaría esos $52M a publicidad. El estado del plan NO permite
                                     deducirlo (la cuenta queda activa, con otro nombre, idéntica a una sin
                                     migrar), por eso el hecho se registra en vez de inferirse.
scripts/reclasificar_gastos_diversos.py  Saca de `5195 Diversos` lo que nunca fue diverso. El
                                     auto-posteo manda ahí toda compra que no sabe clasificar, y el cajón
                                     llegó a $3,17M donde el 47% eran fletes y el 40% el registro mercantil.
                                     Reclasifica **en el sitio** (UPDATE de `cuenta_id`) porque ninguno de
                                     esos asientos estaba espejado; cuando YA lo está, la corrección va por
                                     asiento de ajuste (`corregir_prestacion_servicios_sep2026.py`). Solo
                                     mueve lo que tiene respuesta inequívoca **por tercero** (`REGLAS`) y
                                     deja lo demás listado: adivinar qué fue una compra suelta en D1 es
                                     como se llenó el cajón. Verifica que el total del balance no cambie.
⚠️ **`CONTABILIDAD_LEDGER_BUDGET_S`** (default 28): presupuesto de las APIs remotas en
                                     `armar_libro()`. Los 28 s son para el PANEL, donde vale más una cifra
                                     parcial rápida. **Un backfill necesita subirlo** (p. ej. 900): postear
                                     un período a medias es peor que no postearlo, porque queda cuadrado, se
                                     ve completo y nadie vuelve a mirarlo. `auto_postear_periodo` ahora
                                     propaga `avisos` (lectura truncada) y `montos_por_fuente`, y el script
                                     de backfill los imprime — antes decía «1.300 creados» sin mencionar que
                                     faltaban facturas.
app/services/contabilidad_ledger.py → `factura_ya_contada()` (sep-2026): el libro toma ingresos de TRES
                                     fuentes que se solapan —órdenes de MeLi (`meli_venta`), pedidos de la
                                     tienda (`web_venta`) y **facturas** (`siigo_venta`), que son las
                                     facturas de esas mismas órdenes—. Una venta MeLi facturada se contaba
                                     dos veces, inflando ingreso y Bancos a la vez.
                                     ⚠️ El daño estaba contenido **por accidente**: el listado de facturas
                                     se corta a los 28 s (`_REMOTE_BUDGET_S`) y apenas traía un día. Subir
                                     ese presupuesto habría inflado el ingreso solo, sin tocar nada, y por
                                     un monto distinto cada vez. La marca la pone el facturador en
                                     `observations`, con DOS grafías: Alegra escribe «Venta MercadoLibre —
                                     Pack …» y astroselling, en Siigo, «Venta Mercado Libre #… - Facturado
                                     desde astroselling». Cubrir una sola deja pasar el histórico del otro.
                                     Limpieza de lo ya asentado: `scripts/anular_ventas_duplicadas.py`
                                     (128 asientos, $7.065.505, anulados el 16-sep-2026).
app/services/iva_ventas.py          **Reconocimiento del IVA de las ventas** (sep-2026). Las ventas se
                                     asentaban por su total contra 4135, pero McKenna es responsable de IVA:
                                     parte de ese total no es ingreso suyo. `reconocer(desde, hasta)` lo
                                     reclasifica a **240805 IVA generado** con un asiento de ajuste por
                                     período (las 1.269 ventas ya asentadas no se reescriben), idempotente
                                     por `referencia="iva-ventas:<rango>"`.
                                     ⚠️ La cifra sale de las **facturas emitidas en Alegra**, NO de dividir
                                     el total por 1,19: hay materias primas excluidas (Art. 424 E.T.) — en
                                     300 facturas, 484 ítems al 19% y 12 sin IVA. Aplicar la tarifa a todo
                                     inventa IVA sobre lo excluido y lo declara de más ante la DIAN.
                                     `resumen()` contrasta lo facturado contra el ingreso del libro: si no
                                     cuadran hay ventas sin facturar o facturas sin contabilizar, y el IVA
                                     se estaría calculando sobre una base que no corresponde.
                                     Falta la otra mitad del formulario 300: el **IVA descontable** de las
                                     compras (240810). Sin ella el saldo de 2408 queda por encima de lo que
                                     realmente se paga. Script: `scripts/reconocer_iva_ventas.py`.
app/services/alegra_puc.py          Puente por CÓDIGO con Alegra, que desde sep-2026 está en el catálogo
                                     **PUC** (antes NIIF). Al cambiar de catálogo Alegra reasignó TODAS sus
                                     ids internas, así que el `MAPA_PUC` a mano de `alegra_espejo` quedó
                                     apuntando a cuentas que ya no existen: `cuenta_alegra()` consulta primero
                                     `construir_mapa()` y solo cae al diccionario viejo como respaldo.
                                     El catálogo de Alegra es **parcial** y sus cuentas de 4 dígitos son
                                     **agrupadoras**: hay que asentar contra la subcuenta, que Alegra a veces
                                     anida hasta 8 dígitos (1435 → 143505 → **14350501**). El emparejador baja
                                     al descendiente movible más alto y, si hay más de uno de verdad distinto
                                     (bajo 4135 cuelgan 413505 y 41350101), **no adivina**: esa elección es
                                     contable y se escribe a mano en `OVERRIDES`. Lo demás queda en
                                     `sin_equivalente`, nunca resuelto a una cuenta «parecida».
                                     ⚠️ **Alegra devuelve 503 en POST que SÍ se ejecutaron** (así se creó 5235
                                     la primera vez) y también usa 503 cuando falta `code` en modo PUC.
                                     Ante un 503, releer el catálogo y comprobar — nunca reintentar a ciegas,
                                     que es como se duplican cuentas del plan. Ver
                                     `scripts/crear_cuentas_ventas_alegra.py`.
                                     ⚠️ `cuenta_alegra()` solo cae al `MAPA_PUC` viejo si esa id **todavía
                                     existe** en Alegra: al cambiar de catálogo las ids se reasignaron, y sin
                                     ese chequeo el espejo creía tener cuenta para 1435 y 4135 y posteaba
                                     contra una id muerta en vez de negarse.
app/services/contabilidad_mayor.py  El libro **discriminado por cuenta contable** (solo lectura).
                                     `arbol_cuentas()`: la jerarquía del PUC reconstruida desde el
                                     código (clase → grupo → cuenta → subcuenta) con saldo inicial,
                                     débitos, créditos y saldo final en CADA nivel; sintetiza los
                                     niveles que no existen como cuenta (hay 529505 pero no 5295) y
                                     separa lo `propio` de un nodo de lo acumulado con sus hijos —
                                     1110 Bancos y 111010 MercadoPago mueven las dos.
                                     `extracto_cuenta()`: el estado de cuenta — saldo corrido, la
                                     **contrapartida** de cada línea (contra qué otras cuentas se
                                     movió ese asiento) y el resumen por tercero, acotable a un
                                     tercero o extensible a las subcuentas. `extracto_csv()` y
                                     `app/tools/extracto_contable_pdf.py` lo sacan en CSV y en PDF
                                     (extracto y balance jerárquico) para el contador.
                                     Panel: Libro Mayor → 3 Consultar → **Libro Mayor**
                                     (`MayorCuentasPanel.tsx`): árbol a la izquierda, extracto a la
                                     derecha, drill-down al asiento completo sin salir de la vista.
                                     Nació porque el libro tenía los datos pero solo se veían por un
                                     desplegable plano de 39 cuentas y un balance de una sola lista
                                     del que no se podía entrar a nada.
app/services/contabilidad_ledger.py armar_libro() (solo lectura: ventas MeLi/web/Siigo, compras,
                                     compras exterior, servicios, impuestos, créditos) +
                                     movimientos_manuales_como_libro() (los asientos manuales de
                                     arriba, en el mismo formato de fila, para fusionar sin tocar
                                     armar_libro()).
app/services/contabilidad_autopost.py  auto_postear_periodo(): traduce cada fila de armar_libro()
                                     a un asiento real (FUENTE_MAPEO fuente→cuenta PUC), dedupe
                                     por referencia="auto:<hash>". Cron cada 6h
                                     (scripts/contabilidad_autopost_cron.py, job
                                     "contabilidad_autopost" en Sistemas → Tareas Programadas) +
                                     backfill manual (scripts/backfill_contabilidad_autopost.py).
app/services/alegra_espejo.py       Espeja un asiento del Libro Mayor como comprobante contable
                                     en Alegra (`espejar_movimiento`) y **lo anula allá**
                                     (`anular_espejo`, `DELETE /api/alegra/espejo/<mov>`, botón en
                                     Libro Mayor → Movimientos al desplegar el asiento). Anular
                                     existe porque el contador declara con lo que ve en Alegra: un
                                     asiento anulado y rehecho dejaba el comprobante viejo allá con
                                     las cifras malas (16-sep-2026). Solo borra comprobantes que
                                     este sistema creó (`cc_alegra_espejo`) y se niega mientras el
                                     asiento siga confirmado, salvo `?forzar=1`.
app/services/meli_facturacion.py    La factura mensual de MeLi, desglosada por concepto y
                                     traducida al PUC. GET /billing/integration/... — **5 peticiones
                                     por minuto**, el módulo pacea solo y cachea los períodos
                                     cerrados. Existe porque ese gasto no se ve por ningún lado:
                                     MeLi cobra $44-47M/mes (de los cuales ~$24M son PUBLICIDAD) y
                                     **nada de eso pasa por el extracto bancario** — la factura se
                                     cobra contra el saldo de MercadoPago (111010), y el banco solo
                                     ve el traslado que fondea esa cuenta.
                                     ⚠️ NO usar `meli_ads.gasto_ads_por_rango()` para contabilizar:
                                     para ago-2026 reportó $654.448 cuando la factura cobró
                                     $23.853.390 (35x). Las métricas sirven para decidir campañas;
                                     la factura es la fuente de verdad.
                                     ⚠️ Los `detail_sub_type` que empiezan por «B» son anulaciones y
                                     RESTAN, aunque la API los manda en positivo y sin marcarlos
                                     CREDIT. Van a la misma cuenta que anulan (BV→CV, BXD→CXD,
                                     BFF→CFF: se cambia la B por C). Sumándolos en positivo, agosto
                                     daba $46.013.088 contra los $44.175.672 reales.
app/services/extracto_clasificador.py  Propone cuenta PUC + tercero para las líneas de banco
                                     que NO tienen contrapartida en el libro (las que
                                     `sugerencias_auto` no puede emparejar porque la operación
                                     nunca se contabilizó: 200 de 358 en jul-ago 2026). Reglas por
                                     descripción del banco; `proponer()` / `resumen()` NO escriben
                                     nada. Endpoint `/api/contabilidad/extractos/clasificacion`.
                                     Tres trampas que las reglas evitan a propósito: (a) los
                                     traslados a MercadoPago son plata propia, no ingreso ni gasto
                                     ($40,7M en ago-2026); (b) el banco rotula «PAGO A PROVE» la
                                     quincena de quien presta servicios — persona natural va a 5135
                                     con retención, no a 2205; (c) una entrada sin identificar no se
                                     marca como venta, que ya entra por el auto-posteo.
app/services/extracto_bancario.py   Conciliación bancaria (ya existente): importar extracto,
                                     vincular/desvincular, sugerencias automáticas,
                                     pendientes_por_clasificar() (líneas de banco sin vínculo).
                                     `vincular()` es agnóstica al formato de movimiento_id — un
                                     hash de armar_libro() o "cc:<id>" de un asiento manual
                                     funcionan igual.
```

**Conciliación con el contador (13-sep-2026):** `scripts/descargar_soportes_contador.py` baja del
Gmail los adjuntos del contador (350, 490, 300, 110, ICA, RTICA, certificados) a
`docs/contabilidad/<año>/Soportes_Contador/` (gitignored) y `scripts/extraer_declaraciones_contador.py`
los lee con pdftotext. `app/services/conciliacion_contador.py` cruza eso contra la 2365 y guarda cada
inconsistencia como **hallazgo** (`cc_conciliacion_hallazgos`, clave determinista, idempotente) que el
usuario recorre en /app → Contabilidad → **Conciliación contador** (wizard: un hallazgo por pantalla,
decidir → TKT del Centro de Mando asignado al aliado `conciliacion_contador`). Lo que deja de detectarse
se cierra solo. Única mutación directa: marcar un tercero como natural / **Régimen SIMPLE**
(`cc_terceros.regimen_simple`, Art. 911 ET: no se le retiene; el XML DIAN dice `R-99-PN` igual, se sabe
por el pie de la factura o el RUT). Nunca crea ni anula asientos — eso va por ticket. Sin LLM.

Panel: Contabilidad → **Libro Mayor** (PUC/terceros/asientos/balance) y **Préstamos**
(`PrestamosPanel.tsx`, permiso propio no heredado — datos sensibles de socios). Contabilidad →
**Ingresos y Egresos** fusiona `armar_libro()` con los asientos manuales y agrega la bandeja
**"Pendientes por clasificar"**: clasificar una línea de banco sin vínculo crea el asiento
correcto (incl. préstamo) y la vincula en un solo paso. Adjuntar comprobante (`ComprobanteWidget.tsx`,
compartido entre paneles) sustenta operaciones sin factura fiscal, p.ej. compras courier de un socio.

### M. Préstamos de terceros (captación con particulares)

```
/app → Contabilidad → Préstamos   (sección propia; PrestamosCronogramaPanel.tsx)
  ├─ «+ Prestamista»: alta del tercero con cédula, correo, teléfono y cuenta bancaria
  │    → valida lo que el préstamo necesitará (no al desembolsar, cuando ya es tarde),
  │      lo inscribe como contacto en Alegra y avisa si llevará documento soporte.
  │      No duplica si ya existe esa cédula: completa lo que falte
  ├─ Crear: tercero + capital + tasa E.A. + plazo + reparto de capital por tramos
  │    → cronograma de N cuotas + asiento de desembolso (banco / 2295-2380)
  ├─ Simulador en vivo: muestra ANTES de comprometerse qué gana el prestamista
  │    (bruto y neto) y cuánto cuesta realmente a McKenna (TIR → efectiva anual)
  ├─ Documentos PDF: contrato de mutuo (al desembolsar) y certificado de estado.
  │    Se generan siempre; el ENVÍO por correo al tercero pide confirmación
  ├─ Alegra: consulta de solo lectura si ya es contacto, con botón para inscribirlo
  ├─ Reporte mensual al prestamista: lo girado en el mes (capital / interés / retención)
  │    + certificado de estado adjunto. Envío manual, nunca automático tras un pago
  └─ Pagar cuota → asiento capital(2195/2355) + interés(530520) + retención(236535) + banco

scripts/prestamos_recordatorio_cron.py   (corre a diario, dos trabajos)
  ├─ día 5  → UN ticket a despachos (PRESTAMOS_USUARIO_PAGOS, default `jerry`) con
  │           todas las cuotas del mes: prestamista, cédula, cuenta, valor a girar
  └─ día 3  → UN ticket de contabilidad con la retención practicada el mes ANTERIOR,
              detalle por tercero para el formulario 350 + control contra la cuenta
              2365 + fecha exacta de vencimiento (app/services/calendario_tributario.py,
              año gravable 2026 cargado). Sube a prioridad crítica si vence en ≤5 días
```

**Condiciones vigentes (sep-2026):** 25% E.A. (= 1,8769% mensual vencido), 24 cuotas,
capital 30% el primer año / 70% el segundo, retención del 7% **a cargo del prestamista**.
Sobre $10.000.000 el prestamista gana **$2.796.620 brutos (27,97%)** y recibe
$2.600.857 netos (26,01%).

**Tres cifras distintas que no se deben confundir** (van las tres en el panel y en el PDF):
la **tasa pactada** (25% E.A., lo único que se acuerda), el **rendimiento bruto** (27,97%,
consecuencia del cronograma) y el **rendimiento neto** (26,01%, tras retención). 25% E.A.
no da 50% a dos años porque el interés va sobre saldo insoluto: el capital promedio
realmente prestado es $6,2M, no $10M.

**Palanca de diseño:** devolver capital más tarde sube lo que gana el prestamista **sin
cambiar la tasa** (0/100 → 34,72%; 30/70 → 27,97%; 50/50 → 23,46%), y el costo para
McKenna es 25% E.A. en los tres casos. Descartado a propósito el "interés fijo sobre
capital inicial", que cuesta ~30% E.A. real por el mismo capital promedio.

**Retención:** McKenna es agente retenedor; descuenta el 7% (Art. 395 ET) y lo consigna
a la DIAN, contra **236535 «Rendimientos financieros»** (no 236515, que es honorarios). **La asume el prestamista** — no es costo extra para McKenna. Con `gross_up`
la asume McKenna y el costo real sube a 26,95% E.A.

**Documento soporte (DIAN Concepto 000112 int 7 de 2024):** por el **capital** NO se emite
(el mutuo no es venta de bienes ni servicios; se respalda con contrato + transferencia); por
los **intereses** SÍ, pero solo si el prestamista es persona natural **no** obligada a
facturar — si es jurídica u obligado, la factura la expide él. Se emite por el interés bruto
de cada cuota vía `POST /bills` con plantilla `supportDocument` (id=10 en la cuenta; ⚠️ la
id=16 se llama "Documento Soporte" pero es `saleTicket`, no usarla). **Arranca en modo sombra**
(`PRESTAMOS_DOC_SOPORTE_ACTIVO=0`). Al 2026-09-14 ya no falta nada técnico: el ítem
`INTERES-MUTUO` existe (id 624) pero **no se usa** — el documento va por cuenta contable
(5252), porque Alegra rechaza `purchases.items` con error 11034 en esta cuenta; y la
retención de rendimientos financieros al 7 % se creó en Alegra (id 14) y está mapeada en
`RETENCIONES_ALEGRA`, así que el documento ya sale con la retención incluida (verificado en
dry run con la cuota 1 del préstamo #1: $21.022). **Lo que falta es un trámite, no código
(TKT-2026-1323):** la plantilla 10 (`supportDocument`) tiene `isElectronic: false` y sin
resolución de numeración, así que hoy los documentos quedarían en Alegra sin transmitirse a la
DIAN. Hay que pedir la resolución de documento soporte (Res. 000167/2021) y habilitarlo en
Alegra antes de encender la bandera.

**Calendario DIAN:** `app/services/calendario_tributario.py` tiene el año gravable 2026
(DUR 1625, Arts. 1.6.1.13.2.33. y 1.2.6.6.). El NIT de McKenna es 901.316.016-3 → el dígito
del calendario es el **6**, no el 3 (el 3 es el DV; verificado contra GET /company de Alegra).
La identidad fiscal (razón social, NIT, ciudad) vive **solo** en `app/services/empresa.py` —
ningún módulo debe volver a escribir el literal. **No extrapola**: para un año sin tabla
cargada dice "fecha no confirmada" en vez de adivinar — cargar 2027 cuando salga el decreto.

⚠️ **Sin validar aún:** tarifa de retención según tipo de prestamista (confirmar con el
contador), certificado anual de retenciones en formato DIAN (el plazo sí está: último día
hábil de marzo), tope de usura (el contrato lo afirma pero nadie lo valida en código) y riesgo
de captación masiva si esto escala a muchos terceros. Ficha completa, cronología y
decisiones abiertas: `docs/agentic/modules/prestamos.md`.

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
| `/api/grabaciones/*` | GET/POST/PATCH/DELETE | Bearer (archivos de video sin Bearer: el id es el token) | Grabaciones de pantalla por trozos, recorte de sección, clips MP4 y envío por el bridge supervisor — ver Flujo S |
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
