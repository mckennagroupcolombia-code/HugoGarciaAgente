# Operacion equipo

> Movido tal cual desde CLAUDE.md el 27-sep-2026 al comprimirlo; allí queda un resumen con enlace aquí.

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

**Levantado el 27-sep-2026 con despliegue gradual** (`scripts/desplegar_ventas_facturables.py --simular |
--aplicar | --ampliar | --notificar`, `app/services/despliegue_ventas.py`, estado en `app/data/despliegue_ventas.json`):
solo vuelve lo que **hoy se factura** (SKU activo en Alegra o con alias, regla de `canales_producto._facturable` contra
la copia local). 271 de 280 publicaciones reactivadas; 7 quedan pausadas (SKU inexistente en Alegra, lista en
`meli_pausa_global.json` → `no_reactivadas`) y 2 no volvieron por stock 0. Mientras el despliegue esté activo:
`meli.meli_item_reactivable()` impide que la sincronización de stock reactive algo fuera de la lista; la web filtra el
catálogo como vista (`_catalogo_desplegado` / `_vista_despliegue` en website.py, cache.json no cambia); Cotizar/Facturar
rechaza SKUs fuera de la lista **y las líneas genéricas VENTA-VARIO-*** (los envíos `WEB-ENVIO-*` siempre pasan: son servicio, no combo) (`ventas_directas.fuera_de_despliegue`; la venta
MeLi con RUT no se frena); el Árbol del producto marca «A la venta · MeLi + web». Al enlazar más SKUs: `--ampliar`.
`tests/conftest.py` aísla el archivo real (autouse).
**Publicaciones nuevas tras el cese (5-oct-2026):** la lista se arma con lo que pausó el cese, así que una publicación
creada después quedaba fuera (oculta en la web, sin reactivación de stock). `despliegue_ventas.registrar_publicacion_nueva(
meli_id, sku)` evalúa SOLO ese SKU con las mismas reglas (factura + etiqueta aprobada), lo suma a `skus` y lo anota en
`publicadas_despues`, que `calcular()` vuelve a considerar. ⚠️ **Nunca** recalcular la lista fuera de `sincronizar()`:
con la relación de códigos a medias (timeout de MeLi, 263 de ~480) un `calcular()+guardar()` sacó 34 SKUs buenos
(193 → 159) el 5-oct; se restauró desde git. Primer uso: aceite de coco virgen (MCO4508059070/-134/MCO4508145372).

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

### AH. Alertas sonoras y chat del equipo legible (6-oct-2026)

- **Sonido por persona y por grupo** (`desktop/src/lib/alertasSonido.ts`, ajustes en `chat_equipo/AjustesSonidos.tsx`,
  se abre desde la campana → «Sonidos de los avisos» o desde el botón 🔔 Sonido de cada grupo). Prioridad: grupo con
  sonido propio > persona > general. Solicitud nueva que **otra persona** te hizo → tarjeta + sonido de quien la pidió
  (`/api/mensajes/resumen` trae `solicitudes_para_mi`, `canales_internos.solicitudes_para_mi`; el panel compara ids con
  los ya vistos, lo que existía al abrir no suena). Mensajes de grupo: `useAvisosMensajes` (ahora `novedades` trae
  `usuario_id`). Dos avisos en < 1,5 s suenan una vez.
- Preferencias en `usuarios.preferencias_ui.sonidos` (validadas en `tickets_db._limpiar_alertas_sonido`; ids de sonido
  `xx_nombre` o `silencio`) + copia en `localStorage` (`mck-alertas-sonido`).
- **Los 12 sonidos** (`desktop/src/assets/sonidos/`, ~240 KB): 9 recortes de los mp3 de Duck Hunt
  (`public/juegos/duckhunt/statics/sounds/`) y 3 de **Circus Charlie grabados de la ROM** corriendo en jsnes desde Node
  (sin pantalla, `onAudioSample` → WAV → ffmpeg): `cc_salida` (1,95–3,65 s tras Start), `cc_circo` (música de la etapa
  1), `cc_tropiezo` (choque con el fuego + jingle). Uso interno, detrás de la sesión, como los juegos. Recortes con
  `loudnorm`; los < 0,5 s quedaron fuertes y se bajaron a mano (−3 a −8 dB).
- **Chat legible** (`HiloCanal.tsx`, `chatEquipo.css`): botón **Aa** con 3 tamaños de letra (15,5/17,5/20 px, default
  «grande», `mck-chat-letra`), separadores por día, línea «Mensajes nuevos», mensajes seguidos del mismo autor (≤ 5 min)
  agrupados con avatar y nombre en color estable (`lib/personaColor.ts`), formato de WhatsApp (`*negrita*`, `_cursiva_`,
  `~tachado~`, enlaces; con límite de palabra para no romper `foto_1_2.jpg`), y si la persona subió a leer, lo nuevo no
  la arrastra: sale «↓ N mensajes nuevos».
- ⚠️ Con un grupo abierto la calculadora flotante se oculta (`html[data-chat-abierto]`) y la burbuja de chat no sale en
  `chat-equipo`: tapaban el botón de enviar. Desde el 7-oct el alto del chat es flex (`chat-equipo` en
  `PanelTransition.fillHeight`), ya no `calc(100dvh-…)`.

- **Tono propio por grupo (7-oct-2026)**:
  - `lib/alertasSonido.ts::sonidoDeCanal`: el sonido elegido para el grupo; si no hay, `tonoPropioDeGrupo(id)` (10
    tonos cortos, fijos por id, así cada grupo se reconoce de oído).
  - `tono_por_grupo: false` (casilla en los ajustes) vuelve a un solo sonido «general».
  - Sin el perro: ladridos y risa no están entre los tonos de grupo (son 7 tonos; desde el grupo 8 se repiten).
- **El perro que se ríe es solo para cerrar un flujo** (`lib/celebracionAprobado.ts::escucharMonedasDelServidor`):
  - Sale al cerrar una tarea (estado `resuelto`, `completar-accion`) y en `RUTAS_DE_CIERRE` (`…/finalizar`, facturar).
  - La moneda de cualquier otra misión (comentar, evidencia, paso) suena con `sonarMoneda()`, un tono corto.
  - Los sonidos por persona quedan para las solicitudes, no para los mensajes de grupo.
  - La fila de grupos de la bandeja muestra el ícono del tono y el globo de no leídos late.
  - ⚠️ El aviso con sonido vive en `SolicitudesEnProcesoFab`, que solo monta el Layout: `MobileHub` lo monta con
    `soloAvisos` (sin la bolita). Sin eso, la pestaña Mensajes de la barra de abajo no sonaba.

### AJ. Zumbidos en las solicitudes (7-oct-2026)

- Botón **📳 Zumbido** en el cabezote del hilo (`HiloConversacion.tsx`) y en la burbuja de chat
  (`SolicitudesEnProcesoFab.tsx`): a los demás miembros (quien la pidió, a quien le toca, los que se sumaron) se les
  sacude la app, suena un zumbido y vibra el celular. Queda en el hilo como evento «📳 … envió un zumbido».
- Backend: `tickets_db.enviar_zumbido` (`POST /api/tickets/<id>/zumbido`): solo miembros, solicitud abierta, uno cada
  20 s por persona y solicitud (429). Tabla `ticket_zumbidos` (una fila por destinatario).
- Llega con `/api/mensajes/resumen` → `zumbidos` (sin ver y de los últimos 10 min: uno viejo no sacude a nadie al abrir
  el panel). `useAvisosMensajes` lo hace sonar una vez y lo marca con `POST /api/tickets/zumbidos/vistos`.
- `lib/zumbido.tsx`: sonido sintetizado con Web Audio (respeta el interruptor y el volumen de las alertas sonoras);
  la sacudida es `html.mck-zumbido #root` en `index.css`. Sin WhatsApp ni push: solo con el panel abierto (≤ 10 s).

### AI. Menciones con @ en los grupos (7-oct-2026)

- **Qué cuenta como mención** (`canales_internos.detectar_menciones`, sin LLM):
  - Formas válidas: «@Nombre Apellido», «@Nombre» (solo si nadie más del grupo se llama igual), «@usuario» y
    «@todos/@todas/@equipo».
  - No distingue tildes ni mayúsculas. Un correo (`a@b.co`) no cuenta y el autor nunca se nombra a sí mismo.
  - De WhatsApp las menciones llegan como «@573001234567»: se buscan por `usuarios.telefono` (`usuario_por_telefono`).
  - Solo se puede nombrar a los miembros del grupo; si el grupo no tiene miembros, a todo el equipo activo.
- **Tabla `canal_menciones`**: una fila por (mensaje, persona). La mención queda **pendiente** mientras esa persona no
  haya leído el grupo hasta ese mensaje (`canal_lecturas`): no se marca a mano.
  - `_fila_canal` trae `menciones` (las pendientes de quien mira) y los mensajes traen `menciones` [{id, nombre, username}].
  - `/api/mensajes/resumen` suma `menciones_pendientes`.
  - `GET /api/canales/<id>/mencionables` da la lista del autocompletar.
- **Avisos** (`canales_avisos`):
  - A quien nombran le llega un push aparte («Ana te mencionó · Bodega», tag `mencion-<canal>`), sin la ventana
    anti-spam de 120 s (sí respeta el silencio de 22:00 a 07:00).
  - En `novedades` cada mensaje trae `mencion`; la tarjeta en pantalla dice «@ Te mencionó».
- **Panel**:
  - `BarraEscritura` (prop `personas`): al escribir «@» abre la lista; Enter o Tab elige, Esc la cierra. Inserta el
    nombre completo.
  - `HiloCanal` resalta cada @ (el tuyo más fuerte) y marca con una franja la burbuja que te nombra («@ Te nombró»).
  - En la bandeja del celular (`lib/bandeja.ts`) un grupo con menciones pendientes pasa a **Te toca** («@ Te nombraron»).
  - En la lista de Grupos lleva una «@» y sale primero.
  - Helpers del cliente: `lib/menciones.ts`.

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

### AE. Ubicación de bultos — «¿Dónde está?» (27-sep-2026)

Problema: al operario le piden «empacar quinua roja 500 g» y no encuentra el bulto; la foto de la llegada
quedó suelta en un grupo de WhatsApp, sin producto ni lugar. Abastecer → Recepción de mercancía → pestaña
**«Dónde está cada bulto»** (`components/bultos/`, `app/services/ubicacion_bultos.py`, `app/routes_bultos.py`,
`/api/bultos/*`; enlace directo `/app?panel=recepcion-mercancia&vista=bultos`). Sin LLM, sin Alegra en vivo.
- **Bulto** = foto (obligatoria) + producto de inventario (SKU canónico, copia local de Alegra; combos no) +
  sede y ubicación (texto libre con autocompletado de lo ya usado) + cantidad/lote/nota opcionales. Mover y
  «Se acabó» dejan rastro en `bulto_movimientos`; al ubicar avisa en el canal interno «Inventario».
- **«Por identificar»**: fotos de `canal_mensajes` (lo del chat del equipo y de los grupos WA enlazados) y de
  `recepcion_fotos` de los últimos 45 días que nadie ha asociado; «Es un bulto: ubicarlo» o «No es un bulto».
  Sugiere productos por el texto que acompañó la foto. En cada renglón de una recepción: «Ubicar el bulto».
- **En la solicitud** (`DondeEsta.tsx` en `TicketDetailView`, `SolicitudCard` y `AccionCardOperativa`):
  `POST /api/bultos/en-texto` empareja título+descripción con los bultos en bodega (`puntaje_nombre`: el SKU
  escrito gana; si no, una palabra propia del producto —no genérica como aceite/polvo/roja— de ≥6 letras, o
  dos palabras; tolera tipeo, «PSYLLUM» → PSYLLIUM). Sin coincidencia no dibuja nada.
- Consultar lo ve todo el equipo interno (no contador ni colaborador externo); registrar/mover/bandeja piden
  los permisos de Recepción. Base `app/data/bultos.db`, fotos reducidas en `fotos_bultos/` (ambas gitignored).
- ⚠️ Al crearlo (27-sep) el puente **no registraba ningún mensaje humano** de MCKG SEDE SUR ni de MCKG PEDIDOS /
  COMPRAS en 10 días (Postventa sí): la bandeja solo se llena si esas fotos llegan. La vía principal es la cámara.

### AF. Solicitudes y acciones como misión (27-sep-2026, pedido de Stella)

- **Hilo** (`desktop/src/components/tickets/HiloConversacion.tsx`): la tarjeta **«Lo que te piden»** (título
  completo, descripción, fotos de quien la pidió) y las **cuatro casillas** Leer → Empezar → Evidencia → Entregar van
  **fijas arriba**, fuera del scroll del chat. Antes el título salía truncado («Empacar …») y la descripción se
  ocultaba cuando era igual al título: no había dónde leer lo pedido. Un solo botón grande abajo da la siguiente
  jugada («▶ Lo leí · Empezar», «📷 Foto de cómo quedó» con la cámara, «★ Entregar»). Sonido de moneda al empezar
  (`sonarRevisado`); la evidencia y la entrega ya las paga/celebra el servidor (`logros_hook.py` → `X-Mck-Monedas`,
  `celebrarTareaCumplida`), no se duplica aquí.
- **Miembros** (7-oct): fila «Equipo» bajo el cabezote del hilo (quien pidió, a quien le toca y los que se sumaron)
  con «＋ Sumar» para agregar o quitar a alguien del equipo (`ticket_participantes`, rol colaborador; deja comentario
  en el hilo). El sumado la ve en su bandeja y puede escribir. La API (`POST/DELETE /api/tickets/<id>/participantes`)
  ahora exige estar en la solicitud o nivel ≥ 2 (`puede_gestionar_participantes`); salirse uno mismo siempre se puede.
- **Fotos**: visor propio (`VisorFotos.tsx`). `target="_blank"` no abre nada en la APK / modo instalado.
- **Bandeja** (`InboxConversaciones.tsx`): «Seguir con la que estabas» (clave `mck_hilo_actual`, la escribe el hilo),
  contadores Por hacer · En curso · Hechas que filtran (como el Mapa), «✚ Pedir algo» / «✚ Nueva tarea» en un toque,
  filtros Me toca · Pedí yo · Todo · Por persona, solicitudes y acciones juntas, y el **historial de hechas plegado**.
- Estilo en `tickets/hiloPixel.css` (forma pixel, letra Montserrat grande: 16–19 px). Banco sin backend:
  `/app/dev/solicitudes.html?abrir=1650[&estado=pendiente]`.

### AG. Revisión global de pesos, medidas y empaques (2-oct-2026)

Problema: nada guardaba el peso ni las medidas reales de lo que se despacha; solo lo declarado en MeLi, y la
auditoría del 2-oct encontró 54 publicaciones con errores claros (2.900 g de relleno, 500 g en goteros de 30 mL,
pesos menores al contenido). MeLi cobra el flete por ese peso. La revisión crea la fuente de verdad.
- **Solicitud con wizard** (`subtipo = "revision_empaque"`, primera: TKT-2026-1639 de Armando a Jenniffer, que absorbió
  el TKT-2026-1638 de cajas). `RevisionEmpaqueEnSolicitud` (`desktop/src/components/revisionEmpaque/`) se dibuja en
  `TicketDetailView`, `SolicitudCard` y el hilo (`HiloConversacion.tsx`, bajo «Lo que te piden»): avance + botón que
  abre la ventana emergente con 4 pasos. Lógica en `app/services/revision_empaque.py`, rutas `/api/revision-empaque/*`.
- **1 Pesar** cada combo activo de Alegra (304) listo para despachar; confirma el empaque de la receta (solo envase,
  bolsa, caja y kits se preguntan) y la caja (`BOX11X4X4`, `BOX12X8X4`, `BOX17X11X4`, `CAJCAR5mL` u «otra»).
  «No lo puedo pesar» exige motivo. **2 Medir** una vez por **tipo de empaque**: envase rígido (casilla `envase` de
  `mapa_producto._casilla`) mide igual con cualquier contenido; una bolsa sin envase ni caja se separa por
  presentación; sin envase en la receta → `solo:<sku>`. 94 mediciones en vez de 304. Un producto puede corregir sus
  medidas. La presentación sale de la cantidad de materia prima de la receta, no del SKU («C-BTMS50125g» = 125 g).
- **3 Entregar**: comentario con el resumen; la solicitud queda `esperando_aprobacion` (la finaliza quien la pidió).
- **4 Aprobar** (`puede_aprobar`: quien la creó o admin): verificado contra MeLi («difiere» = peso > 5 % o 10 g, o
  medidas distintas tras subir al cm); aplica en lotes de 10 desde el panel (máx. 15 por llamada). **Antes de escribir
  relee cada publicación**: no toca cerradas ni las que ya tienen otro SKU. Medidas hacia arriba al cm; peso al gramo.
- Publicaciones por SKU: activas y pausadas de la cuenta, por `SELLER_SKU` (o `seller_custom_field`), en mayúsculas;
  se fotografían al crear y con «Releer MeLi». Base `app/data/revision_empaque.db` (gitignored). Sin LLM.
- Banco sin backend: `/app/dev/revision.html` (Jenniffer) y `?admin=1` (Armando). Tests: `tests/test_revision_empaque.py`.
- Crear otra revisión: `revision_empaque.crear_con_solicitud(creador_id, asignado_id)` (lee MeLi, ~20 llamadas).
