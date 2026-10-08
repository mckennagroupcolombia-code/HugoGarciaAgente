# CLAUDE.md — McKenna Group Agent

Instrucciones y mapa corto para cualquier IA que trabaje en este repositorio. **El detalle de cada módulo
(historia, decisiones, trampas, rutas) vive en `docs/agentic/modules/*.md`** — tabla «Dónde está el detalle» al
final. Antes de tocar un módulo, leer su ficha. Al documentar algo nuevo: 2-4 líneas aquí + el detalle en la ficha.

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
### Producción: un solo dueño por puerto (detalle: `docs/agentic/modules/ops-systemd.md`)

| Puerto | Proceso | Unidad systemd |
|--------|---------|----------------|
| 8080 | `webhook_meli.py` | `webhook-meli.service` (flock `.webhook_meli.lock`) |
| 8081 | `agente_pro.py` | `agente-pro.service` — **nunca** habilitar también `mckenna-agente.service` (12-sep-2026: ambas enabled → `Address already in use`) |
| 8083 | `PAGINA_WEB/site/website.py` | `mckenna-website.service`; si cae, respaldo de mantenimiento 503 en el mismo puerto. Mantenimiento planeado: `touch PAGINA_WEB/site/data/MANTENIMIENTO` |
| 3000 | `bot-mckenna/server.js` | `mckenna-whatsapp-bridge.service` |

No mezclar unidades **system** y **user** para el mismo puerto. Diagnóstico: `./scripts/diagnostico_servicios_mcKenna.sh`;
dos `webhook_meli.py` → `./scripts/normalizar_webhook_meli.sh`.

## Estructura (detalle completo: `docs/agentic/ESTRUCTURA.md`)

```
agente_pro.py · webhook_meli.py · preventa_meli.py · modulo_posventa.py   entradas Flask / MeLi
app/core.py            Claude: prompt, herramientas, obtener_respuesta_ia
app/routes*.py         endpoints Flask (/whatsapp, /api/*, /app)
app/services/          MeLi, Siigo, Alegra, contabilidad, pagos, llm_budget, empresa (identidad fiscal)…
app/tools/ · app/agent/  herramientas y agentes (ventas_wa v2)
app/data/              config/estado pequeño en JSON (bases .db y caches → gitignored)
desktop/               panel React (/app) · bot-mckenna/ puente WhatsApp · PAGINA_WEB/site/ tienda
scripts/               cron, systemd, utilitarios · docs/agentic/ fichas por módulo · tests/
```

**Nunca en git:** `.env`, `credenciales_*.json`, `mi-agente-ubuntu-*.json`, `client_secret_cloud.json`,
`token_gmail.json`, `venv/`, bases `.db` con datos, carpetas de binarios (ver convención abajo).

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
| Conexiones (panel) | `app/services/conexiones.py`, `/api/conexiones` | Sistemas → Conexiones: prueba EN VIVO las 12 integraciones (WhatsApp ×2, MeLi, Gmail, Google SA, Alegra, Siigo, MP, SMTP, Claude, Gemini, túnel) sin gastar tokens, y guía la reconexión (QR, OAuth incrustado o pasos). Integración nueva → agregarla a `CONEXIONES`. |
| Grupo WhatsApp | `jid_grupo_alertas_sistemas_wa()` | Mismo JID para mensaje de backup y alertas de auditoría cron. |

**Tests de humo:** `pytest tests/test_smoke.py` (`/status`, auditoría, guard de archivos).

---
## Flujos del negocio (resumen → ficha)

**A · Preventa MeLi** (`webhook-meli.md`). MeLi → `/notifications` en **:8080** (topic `questions`) → ficha técnica
(Sheets col. I) → LLM del canal `meli_preventa` (Claude; Gemini de respaldo) responde. Sin ficha o si fallan ambos →
grupo preventa (`resp <3dig>: …`, queda como caso de entrenamiento). **Nunca** un fallback genérico al cliente.
Posventa (topic `messages`): API de mensajes con `x-version: 2`; adjuntos sin texto también alertan.

**B · Orden pagada MeLi** (`sync-stock.md`). `orders_v2` paid → stock post-venta → `sincronizar_stock_todas_las_plataformas`.

**C/E · WhatsApp → IA y pagos** (`whatsapp-routes.md`). `/whatsapp` :8081: comandos de grupo (`ok|no <3dig>` pagos,
`resp …`, `posventa <cód>: …`, `facturar|envio|entregado <ref>`), modo humano, comprobantes. Los pagos de clientes son
durables (`pagos_clientes.db`: sobreviven reinicios, 72 h → `vencido`, guardan quién decidió). Comandos del equipo
suman al control de horas (±10 min). Espejo de grupos → `wa_chats.db`. ⚠️ `mensajeAPayloadHistorial` rechaza grupos a
propósito; el espejo usa su payload **sin** `sender_phone`.

**F/G/H · Facturación** (`facturacion-meli-alegra.md`). Política: **facturar al entregar**. MeLi:
`MELI_AUTOFACTURA_ENTREGA_ACTIVO=0` **apagado a propósito desde 9-sep** (packs a medias + 41 packs facturados dos veces
con astroselling); se factura con «Facturar ahora» = una factura por carrito, aborta si ya hay factura. Web: `entregado
<ref>` en el grupo factura. Notas crédito MeLi: `scripts/emitir_notas_credito_cron.py` vuelve a chequear antes de cada
emisión (10-ago: 4 duplicadas por no hacerlo). Pendiente: WhatsApp aún factura al confirmar pago.

**I · Proveedores + `/cotizar` + mapamundi** (`proveedores.md`). Sin LLM. La web pública **nunca** muestra el nombre del
proveedor. ⚠️ No poner `reveal` en contenedores de listas largas (quedan invisibles).

**J · Contabilidad** (`contabilidad.md`). El Libro Mayor propio (`contabilidad_core.py`) es la fuente de verdad; Alegra
queda para el contador. ⛔ Corte `CONTABILIDAD_FECHA_CORTE` = 2026-09-01 (lo anterior es del contador). Trampas:
Mercado Pago = **130505** (retiro al banco es traslado, no ingreso); 2367 = IVA retenido; 2380 = acreedores varios;
rendimientos = **236535**; un backfill necesita subir `CONTABILIDAD_LEDGER_BUDGET_S`; ante 503 de Alegra **releer antes
de reintentar**; IVA de ventas nunca como total/1,19.
Borradores del 350 (retefuente + reteIVA) y del RTICA para revisar con el contador: Libro Mayor → **Declaraciones**
(`declaraciones_impuestos.py`).

**K/L/T · Despachos** (`logistica-despachos.md`). Pagos de mensajería por lote → Solicitudes de pago (un lote con
`solicitud_pago_id` no se postea otra vez). Rótulos térmicos 10×15 **sin contenido ni valor declarado**; MeLi usa su
etiqueta. Entregas Flex: ⚠️ no usar `meli.listar_ordenes_meli_por_estado` (corta la paginación en silencio).

**M · Préstamos de terceros** (`prestamos.md`). 25 % E.A., 24 cuotas, retención 7 % contra 236535 + reteICA 11,04‰ contra 2368; documento soporte
solo por intereses. Dígito del calendario DIAN = **6**.

**N/Q · Socios y terceros** (`relaciones-socios-terceros.md`). Socios compran con tarjeta personal → **2380**; el asiento
no toca Bancos (Débito 1435 / Crédito 2365 / Crédito 2380); el reintegro (Débito 2380 / Crédito 1110) es lo que se
concilia. Sin IVA descontable (Art. 485 E.T.). Prestamistas familiares → 2295. El banco personal de un socio **nunca**
entra a la conciliación de la empresa. Declarador: `/api/socios/*`, cada socio ve solo lo suyo.

**O · Solicitudes de pago** (`pagos-solicitudes.md`, leerla antes de tocar pagos). Asiento nace al **aprobar**; la
**cuenta PUC decide el impuesto**, el perfil tributario vive en el tercero; gross-up solo si está pactado; dos tokens
(uno prepara en el banco, otro confirma con captura). Compras = copia fiel de la cotización (renglones activos en
Alegra, IVA a 240810, total cuadrado al peso). **Anticipo** (6-oct): compra con cotización a un proveedor obligado a facturar → giro a
133005 **sin retención**; inventario, IVA y retención nacen al **legalizar** con la factura (sobrante a favor en 133005, faltante a 2205). ⚠️ Un PUT a Alegra **reemplaza** (no es parcial). Registro de facturas
de compra apagado (`FACTURAS_COMPRA_REGISTRO_ACTIVO`).

**P · Agente de ventas v2** (`agente-ventas-v2.md`). `WA_AGENTE_V2` / `WEB_AGENTE_V2` = `off|sombra|activo`. **WhatsApp
activo desde 29-sep** (web en sombra): en horario cede al asesor y retoma a los 10 min solo si lo amerita
(`_amerita_retomar` + `omitir_turno`), fuera de horario tiene el control; lo que escribió el asesor manda. El bot **no
cierra la venta**: arma el pedido y avisa al asesor. Base de clientes en `clientes_wa.py`; copiloto del asesor en
`auditor_canales.revision_asesor`. ⚠️ Nunca cambiar `os.environ` en caliente para elegir la base: `pedido.usando_modo()`
(ContextVar). ⚠️ Un envío del bot fuera del webhook debe registrarse antes en `wa_chats.guardar(enviado_por="bot")`.
Desde la auditoría del 7-oct hay **un turno a la vez por chat** (lock por jid + `_reordenar_rezagados`: lo escrito
mientras el modelo piensa no se pierde ni se responde dos veces) y `REGLAS_COMUNES` en ambos prompts.

**IVA de venta = el del proveedor** (`facturacion-meli-alegra.md`, 7-oct): al registrar una compra con la factura cuadrada,
`iva_venta_compra` pasa su tarifa a la materia prima y a los combos que solo la reempacan en Alegra (no a fórmulas ni a
un 0 % de no responsables). `scripts/iva_venta_por_compra.py` revisa todo el catálogo; `IVA_VENTA_COMPRA_ACTIVO=0` lo frena.

**R · Ventas directas / Cotizar-Facturar** (`ventas-directas.md`). ⚠️ La lista de precios de Alegra guarda el precio
**con IVA**: no cotizar ni facturar a mano en Alegra (duplica el IVA). Facturar marca `facturando` antes de llamar a
Alegra. Venta MeLi con RUT liga la factura al pack. Comisión WhatsApp 3 %.

**Producto: combos, EAN, etiquetas, canales, árbol** (`producto-cadena.md`, flujos U/W/X/Z/AD). Producto de inventario
(materia prima) ≠ combo de venta (`C-…`, kit); el documento técnico describe la materia prima y el combo lo hereda por
receta; el EAN nace del SKU de venta y se escribe en el campo `barcode` de Alegra. El **Taller de combos ya no existe**:
es el **Árbol del producto** (Studio); `combos` es solo alias. `fijar_sku_documento()` edita una línea del YAML;
`guardar_ficha` reemplaza la ficha entera (toda edición parcial pasa por `actualizar_campos_ficha`).
La **tienda web se agrupa y nombra como el árbol** (`data/familias_arbol.json`, solo une y renombra, nunca separa);
rutas de origen del mapa: `scripts/sincronizar_origen_materias.py` (vista previa; `--aplicar`).
**Costo vs. precio** en cada presentación del árbol (`costo_receta.py`): receta costeada con la última compra
(Libro Mayor 1435 / facturas → `costos_referencia.json` → costo a mano) contra el precio web, MeLi y lista.

**Operación del equipo** (`operacion-equipo.md`: cese Y, chat del equipo AA, insumos AB, buscador de chats AC,
bultos AE, solicitudes como misión AF). Cese global: `python3 scripts/cese_actividades.py --activar|--desactivar|--estado`.
⚠️ Desde el 27-sep el cese se levantó con **despliegue gradual** (`despliegue_ventas.json`): MeLi, web y Cotizar/Facturar
solo venden SKUs que se facturan; ampliar con `scripts/desplegar_ventas_facturables.py --ampliar`.

**Menciones con @ en los grupos** (`operacion-equipo.md`, AI, 7-oct): `canal_menciones`. Una mención está pendiente
hasta que la persona lee el grupo, y ese grupo pasa a «Te toca» en la bandeja del celular (`lib/bandeja.ts`).

**Zumbidos en solicitudes** (`operacion-equipo.md`, AJ, 7-oct): «📳 Zumbido» sacude la app de los demás miembros
(uno cada 20 s, solo con el panel abierto; `ticket_zumbidos`, llega por `/api/mensajes/resumen`).

**Alertas sonoras + chat legible** (`operacion-equipo.md`, AH, 6-oct): cada quien elige sonido por persona (quién le
pide algo) y por grupo, con recortes de Duck Hunt y de Circus Charlie grabados de la ROM; `preferencias_ui.sonidos`.
El hilo del grupo tiene Aa (3 tamaños), separadores por día, autores con color y formato de WhatsApp.

**Revisión de pesos, medidas y empaques** (`operacion-equipo.md`, AG). Solicitud `subtipo=revision_empaque` con wizard
(pesar cada combo → medir cada tipo de empaque → entregar → el admin aprueba y aplica en MeLi). Es la fuente de verdad
de peso/medidas por SKU; nada se escribe en MeLi sin aprobar y antes se relee la publicación.

**RRHH y horas** (`rrhh-horas.md`). ⚠️ **Nunca** poner horario de entrada/salida (convierte honorarios en contrato
laboral). Tiempos solo cronometrados (≥5 muestras) o huella real, nunca estimados a mano. Salarios fuera de git.

**Colaboradores** (`colaboradores.md`): desde el 3-oct un proyecto es **un solo mapa-cladograma por linaje** (cada tarjeta cuelga de la que la originó; `padre_id`, sin ciclos), con turno y ritmo «visto → respuesta»; el edificio se absorbió como rama «Proceso». Proyectos personales o compartidos por **miembros** (`colab_miembros`): cualquiera con el permiso `colaboradores` (Armando, Cynthia) crea e invita; cada quien ve solo los suyos. «Traer del chat» lee el WhatsApp exportado sin guardarlo. «Precios» (4-oct) = simulador de márgenes por producto entre McKenna y el colaborador (`colab_precios.py`): propuestas con historial y «de acuerdo»; simulación, no toca publicaciones. · **Grabar pantalla** e **iconografía** (`desktop-panel.md`) ·
**Catálogo PDF, CLI, contenido multimedia y científico** (`contenido-catalogo.md`).

## Endpoints (tabla completa: `docs/agentic/ENDPOINTS.md`)

- `/notifications` de MeLi **solo** al proceso :8080. Callback público: `https://bot.mckennagroup.co/notifications`
  (sin barra final). `routes.py` en :8081 lo define por legado: no duplicar.
- `/api/*` y `/chat` exigen `Authorization: Bearer <CHAT_API_TOKEN>` (o token de sesión según módulo).
  `/status`, `/api/metricas`, `/api/costos-ia` sin auth.
- Un permiso oculto en el menú **no** restringe la API: cada ruta valida su permiso en backend.

## Panel React (`desktop/`, detalle: `docs/agentic/modules/desktop-panel.md`)

- `http://localhost:8081/app`. Build: `cd desktop && npm run build` (compila también `dist-colab/`), luego
  `sudo systemctl restart agente-pro`. Dev: `npm run dev` → `:5173/app`.
- `/app` y `/app/assets/*` exigen la cookie `mck_panel` (8 h, `app/spa_sesion.py`); sin ella, pantalla de ingreso.
  Cuando vence con la app abierta, cargar un panel lazy da 403 → `main.tsx` recarga una vez (`vite:preloadError`).
  `PANEL_SIN_SESION=1` = interruptor de emergencia. ⚠️ La APK Android debe entrar por
  `/app/auth/google/start?app=android`.
- ⚠️ Trampas de UI: `index.css` fuerza `position: relative; overflow: hidden` en todo `button` (posicionar un `div`);
  un panel de lienzo va en **dos** listas (`Layout.tsx` y `ui/PanelTransition.tsx`); una piel nueva en `SKINS` **y** en
  `tickets_db.actualizar_preferencias_ui`; React Flow necesita `onNodeClick` o las cartas no reciben clics — probar
  con eventos reales (CDP), no `element.click()`.

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
## Dónde está el detalle

| Tema | Ficha |
|------|-------|
| Estructura de directorios y almacenamiento | `docs/agentic/ESTRUCTURA.md` |
| Todos los endpoints | `docs/agentic/ENDPOINTS.md` |
| Preventa / posventa MeLi (A, B) | `docs/agentic/modules/webhook-meli.md` |
| WhatsApp y pagos de clientes (C, E) | `docs/agentic/modules/whatsapp-routes.md` |
| Facturación MeLi/web, notas crédito (F, G, H) | `docs/agentic/modules/facturacion-meli-alegra.md` |
| Proveedores y /cotizar (I) | `docs/agentic/modules/proveedores.md` |
| Contabilidad (J) | `docs/agentic/modules/contabilidad.md` |
| Mensajería, rótulos, Entregas Flex (K, L, T) | `docs/agentic/modules/logistica-despachos.md` |
| Préstamos (M) | `docs/agentic/modules/prestamos.md` |
| Socios, terceros, Declarador (N, Q) | `docs/agentic/modules/relaciones-socios-terceros.md` |
| Solicitudes de pago (O) | `docs/agentic/modules/pagos-solicitudes.md` |
| Agente de ventas v2 (P) | `docs/agentic/modules/agente-ventas-v2.md` |
| Ventas directas (R) | `docs/agentic/modules/ventas-directas.md` |
| Mapa, combos, EAN, canales, árbol del producto (U, W, X, Z, AD) | `docs/agentic/modules/producto-cadena.md` |
| Cese, chat del equipo, insumos, buscador, bultos, solicitudes-misión, revisión de empaques, alertas sonoras, zumbidos (Y, AA, AB, AC, AE, AF, AG, AH, AJ) | `docs/agentic/modules/operacion-equipo.md` |
| Rendimiento, mapa de funciones, control de horas | `docs/agentic/modules/rrhh-horas.md` |
| Colaboradores | `docs/agentic/modules/colaboradores.md` |
| Panel React, iconografía, grabar pantalla (V, S) | `docs/agentic/modules/desktop-panel.md` |
| Stock multicanal | `docs/agentic/modules/sync-stock.md` |
| Puertos y systemd | `docs/agentic/modules/ops-systemd.md` |
| Catálogo PDF, CLI, contenido | `docs/agentic/modules/contenido-catalogo.md` |
