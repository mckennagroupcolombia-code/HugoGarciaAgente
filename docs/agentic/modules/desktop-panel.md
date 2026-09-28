# Module: Desktop Panel

## Proposito

Panel React de operaciones servido en `/app`, con API Flask en `/api/*` y chat en `/chat`.

## Archivos Ancla

- `desktop/src/api/client.ts`
- `desktop/src/App.tsx`
- `desktop/src/hooks/*`
- `desktop/src/components/*`
- `app/routes.py`

## Invariantes

- Vite usa base `/app/`.
- Produccion sirve `desktop/dist` desde Flask.
- Mutaciones pueden usar `/app/api/...` para evitar proxies que devuelven HTML.
- GET del panel empieza en `/api` y reintenta `/app/api` si llega HTML: el endpoint Flask debe existir en **ambos** prefijos. El catch-all SPA `/app/<path>` no puede servir `index.html` para `/app/api/*`.
- Studio visual (Cynthia): «Diligenciar etiqueta» es formulario HTML (no lienzo) **solo** si la plantilla tiene `ficha_mp`. Etiquetas físicas (p. ej. MANTECA 76×66) se marcan con `formulario: true` + `campoProducto`/`autofit` en el lienzo: el formulario lateral edita `content` sin regenerar layout. **Nunca** poner `ficha_mp` en esas stickers (eso reconstruye la plantilla SCI). Cada capa tiene `nombreCapa` (ORIGEN, APARIENCIA, LOGO…); las pills del editor no deben decir «Otro». Logo (`rolCapa: logo`) y barcode (`rolCapa: barcode`) se cambian desde el formulario (paleta de línea / EAN-13) sin mover la caja.
- Auth usa Bearer `CHAT_API_TOKEN`.
- Preferencias UI (`preferencias_ui.panel`): `mode`, `fontSans`, `accentRgb`, `radius`, `skin` (variantes visibles `pixel` | `matrix` | `peach` (Princesa Peach) | `barbie` | `flujo` | `bodega` | `botica`; `sakura` se retiró y pasa a `peach`; `clasica`/`atelier` pasan a `pixel`), `fontScale`, `menuScale`, `colors` (menú/títulos/cajas), `customThemes` (hasta 12 temas del usuario).
- Cambios en endpoint deben reflejarse en hook/tipo UI.
- Panel `empaque` (Atención): ventas MeLi/web/WA + fotos en `/api/empaque/*`; permiso `permisos_secciones.empaque`.
- Docs técnicos → Biblioteca: `POST /api/fichas/biblioteca/cargar-web` publica **solo** FT/COA/SDS completos en las fichas de producto (`documentos_web` exige COA y SDS diligenciados + PDF; `POST :8083/api/documentos/refresh`).
- Docs técnicos → escáner (pantallazo/PDF/URL): si la fuente está en inglés, los valores de texto se traducen y se **registran en español** (`documento_traducir_es.py`). No se traducen CAS, fórmulas, lote, INCI ni fabricante. Varias fotos COA: una transcripción por imagen y fusión de parámetros. `POST /api/fichas/coa/escanear-parametros` y `POST /api/fichas/ft/escanear-imagen` arrancan un job (`202` + `job_id`); el panel hace poll a `GET .../<job_id>` hasta `done` (el proxy corta POSTs ~100s). Fotos grandes se reducen a lado máx. 1800 px antes de Gemini.
- Publicaciones → pestaña **Competencia**: `GET/POST /api/meli/competencia-precios*`; `POST .../reporte-captura` arma el reporte desde un pantallazo (el servidor no visita MeLi).
- Publicaciones → Catálogo pestaña **Sitios**: `GET /api/publicaciones/<sku>?live_meli=1` (`vista_sitios`); `POST /api/publicaciones/<sku>/estado-meli` (`active`\|`paused`). **Agregar fotos** abre la galería (`POST /api/publicaciones/<sku>/imagenes/desde-galeria`). Lista: query `canal`.
- Inicio (Agenda y Métricas): gadget USD/COP — cifra TRM BanRep (`GET /api/inicio/dolar-hora`) + mini TradingView; clic amplía gráfico horario TV.
- Logística Internacional → **Proveedores** (`ProveedoresPanel.tsx`, `useProveedores.ts`): `/api/proveedores/*`; pestañas Directorio / ¿Quién vende…? / Catálogos (Gmail, sin LLM) / Oferta web (publica `oferta_proveedores.json` para `/cotizar`) / Cotizaciones. Permiso `logistica-internacional`.
- Contabilidad → **Catálogo Alegra**: `GET /api/alegra/catalogo` incluye precio MeLi por SKU (`precio_meli`, `meli_sincronizado`); `POST /api/alegra/catalogo/igualar-meli` copia ese precio al lista Alegra.
- Contabilidad → **Solicitudes de pago** (`PagosWizardPanel.tsx`): categorías con `con_productos` recorren 5 pasos (proveedor → productos SKU → factura cotejada → asiento); `useAppStore.pagosBoot` abre el wizard en una categoría desde el Centro de Mando (variante «pago» de `NuevaSolicitudWizard`). `api.upload` a `/api/pagos/verificar-factura`.
- Contabilidad → **Conciliación contador** (`ConciliacionContadorPanel.tsx`): `GET /api/conciliacion/resumen|hallazgos|job`, `POST /api/conciliacion/analizar` (202 + job en hilo; el panel hace poll al resumen), `POST /api/conciliacion/hallazgos/<id>/decidir` (`crear_ticket|resolver|descartar|marcar_natural|marcar_simple|reabrir`). Permiso `libro-mayor` o `conciliacion-contador` (misma regla en `app/routes_conciliacion.py`). Ítem `conciliacion_contador` en el checklist de Inicio.
- Contabilidad → **Créditos adquiridos**: `GET/POST /api/contabilidad/creditos*`; tasa EA o N.A.M.V., cuota y amortización.

## Riesgos

- Contrato Flask/TypeScript implicito y sin OpenAPI.
- Polling excesivo en panel puede cargar servidor.
- Token en `localStorage` implica riesgo XSS.
- Build no actualizado deja produccion con UI vieja.

## Validacion

```bash
cd desktop && npm run qa:full
```

Si cambia backend del panel:

```bash
pytest tests/test_smoke.py
python scripts/auditar_scripts_cron.py
```

## Memoria Antes de Cambiar

```bash
python3 scripts/consultar_memoria_debug.py --q "desktop panel api app api vite"
```

---

## Traído de CLAUDE.md (27-sep-2026)

> Texto movido tal cual al comprimir CLAUDE.md; allí queda un resumen con enlace aquí.

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
