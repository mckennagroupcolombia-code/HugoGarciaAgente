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
- **Chat directo de dos** (8-oct-2026): `canales_internos.canal_directo(usuario, otro_id)` / `POST /api/canales/directo`
  `{con}`. Cualquiera lo abre (no hace falta ser supervisor); `tipo='directo'`, clave `directo:<menor>-<mayor>`; si ya
  existía un grupo que era solo de esos dos (sin WhatsApp) se usa ese. `_puede_ver`: un directo es **solo de sus dos
  miembros** (administración no lo lista, no lo lee ni borra mensajes ajenos). Lo usa Empresa viva («Hablar»).

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
  - `lib/alertasSonido.ts::sonidoDeCanal`: el sonido elegido para el grupo; si no hay, `tonoPropioDeGrupo(id)` (tonos
    fijos por id, así cada grupo se reconoce de oído; desde el 8-oct son las 7 campanitas del lenguaje sonoro).
  - `tono_por_grupo: false` (casilla en los ajustes) vuelve a un solo sonido «general».
  - Son 7 tonos; desde el grupo 8 se repiten.
- **El perro que se ríe es solo para cerrar un flujo** (`lib/celebracionAprobado.ts::escucharMonedasDelServidor`):
  - Sale al cerrar una tarea (estado `resuelto`, `completar-accion`) y en `RUTAS_DE_CIERRE` (`…/finalizar`, facturar).
  - La moneda de cualquier otra misión (comentar, evidencia, paso) suena con `sonarMoneda()`, un tono corto.
  - Los sonidos por persona quedan para las solicitudes, no para los mensajes de grupo.
  - La fila de grupos de la bandeja muestra el ícono del tono y el globo de no leídos late.
  - ⚠️ El aviso con sonido vive en `SolicitudesEnProcesoFab`, que solo monta el Layout: `MobileHub` lo monta con
    `soloAvisos` (sin la bolita). Sin eso, la pestaña Mensajes de la barra de abajo no sonaba.
- **Lenguaje sonoro (8-oct-2026)** (`desktop/src/lib/lenguajeSonoro.ts`). Los recortes de 8 bits eran feos e iguales
  entre sí. Ahora todo se sintetiza con Web Audio (sin archivos ni red), en do mayor, con timbres suaves (campanita FM,
  marimba, seno/triangular) y una sala corta; un solo `AudioContext` con limitador para toda la app. **La forma dice qué
  pasó**: mensaje = dos notas de campanita (las 7 campanitas `mk_mensaje…mk_brisa` son los tonos de grupo), @ = la
  campanita + destello agudo, solicitud = tres notas de marimba que suben, urgente = sirena suave de dos tonos, detenido
  (`.mv-bloqueo` del Mapa) = dos notas graves que bajan, paso revisado = arpegio, tarea/flujo cerrado = arpegio + acorde
  (el perro se sigue viendo, ya **no** suena su risa), monedas = si→mi metálico, tarea en curso (`Cronometro`,
  `avisoTareaEnCurso`) = dos toques y una campana, zumbido = vibración grave. Al moverse por la app
  (`sonidosJuego.ts`, mismas claves): cada etapa es una marimba de dos notas que sube una quinta, más aguda cuanto más
  adelante en el flujo; Vender = moneda, Entregar baja, Inicio = din-don. La leyenda con ▶ está en «Sonidos de los
  avisos» → «Qué significa cada sonido».
  - Compatibilidad: los ids viejos (`dh_*`, `cc_*`) siguen sonando como «clásicos». `preferencias_ui.sonidos.lenguaje`
    (`tickets_db._limpiar_alertas_sonido`, sin el campo = 1): con 1, el panel cambia una sola vez los sonidos **de
    fábrica** viejos (`general` dh_pato/dh_ladrido, `solicitud` dh_ronda) por los nuevos y guarda 2; lo elegido a mano
    por persona o grupo no se toca.

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
- **Lo que MeLi pide** (verificado el 9-oct-2026 en `/categories/{id}/attributes` de las 138 categorías de la cuenta,
  497 publicaciones): `SELLER_PACKAGE_WEIGHT` (solo g) y `SELLER_PACKAGE_LENGTH` / `_WIDTH` / `_HEIGHT` (solo cm),
  «paquete del seller» = el paquete de envío tal como se despacha. Los `PACKAGE_*` sin SELLER son los de fábrica y son
  read-only. `atributos_meli` manda enteros con `value_struct` (formato del publicador de compliance). 18 publicaciones
  no tenían los 4 atributos; 16 están en Full (3 de combos de la revisión), donde MeLi mide en su bodega y puede
  reemplazar el dato.
- **Pieza «Envío» del Árbol del producto** (9-oct-2026): el mismo trabajo para UN combo desde Diseño de producto
  (`EnvioEmergente.tsx`, 3 pasos: Pesar · Medir · MeLi). Rutas `/api/revision-empaque/sku/<sku>/*` con el permiso del
  árbol (`_usuario_puede` o `puede_ver_etiquetas_avanzado`): quien diseña el producto pesa y mide; aplicar en MeLi
  sigue siendo de `puede_aprobar`. De cada SKU manda la fila de la revisión más nueva donde ya se verificó (si en
  ninguna, la más nueva que lo tiene). Un combo creado después de la revisión se agrega con «Agregar y empezar»
  (`incluir_sku`, lee MeLi por `seller_sku`: 2-4 llamadas). «Medidas propias» se guardan aparte
  (`guardar_medidas_propias_arbol`) para no pisar peso ni empaque; medir el tipo de empaque quita las propias.
  Banco sin backend: `/app/dev/envio.html` (`?admin=1`, `?full=1`, `?nuevo=1`).

### AK. COA por foto → documento técnico al día (7-oct-2026)

Grupo «COA y fichas técnicas» (canal 1, `modulo=documentos_tecnicos`, ↔ WhatsApp `120363045181721155@g.us`). Antes
Jenniffer subía las fotos de los COA y alguien los pasaba a mano a Docs técnicos. Ahora `app/services/coa_canal_auto.py`:
- **Entrada**: `canales_internos.enviar_mensaje` (foto desde el panel) y `espejar_desde_wa` (foto del grupo) llaman a
  `_encolar_coa` si el canal es de `documentos_tecnicos`. Cola durable en `app/data/coa_canal_auto.db` (gitignored);
  `agente_pro.py` retoma lo pendiente al arrancar.
- **Espera** `COA_CANAL_AUTO_ESPERA_S` (90 s) de quietud: las fotos llegan de a una y un COA puede tener 2 páginas.
- **Lectura**: el mismo extractor del panel (`documento_scan_tablas.extraer_coa_desde_imagenes`, Gemini Flash, ~2
  llamadas por foto, con `llm_budget`). La lectura queda guardada por foto: reintentar no vuelve a pagar.
- **Páginas**: una foto sin lote (sin nombre o con el mismo producto) se une al COA anterior.
- **Documento**: por nombre (`_toks` de `auditar_catalogo_combos`), sin vacías ni borradores. Empate entre dos con SKU
  distinto o sustancias en conflicto → **no adivina**, avisa con candidatos. Uno sin SKU junto a otro con SKU = ficha vieja.
- **Escritura**: mismo lote → «ya al día», no toca nada. Otro lote → reemplaza `_coa.lote` y `_coa.parametros` (los
  resultados solo salen del COA del proveedor) + `lote`/fechas/país sueltos; exige ≥4 filas. Respaldo en
  `_respaldo_edicion/`, rastro en `_ediciones` (`desde: chat COA y fichas técnicas`), `registrar_lote_desde_documento`,
  PDF completo regenerado (firmado por el perfil único) e índices de web/mapa invalidados.
- **Casillas** (8-oct, pedido del usuario: «no solo el lote»): `cambios_desde_coa` LLENA las vacías con el COA (pH y
  punto de fusión = la especificación, solubilidad, apariencia, olor, presentación = cantidad del lote, INS del «E-406»,
  CAS/EINECS/INCI según el tipo de insumo, composición proximal en naturales) y CORRIGE las que lo contradicen
  (concentración «99 %» copiada → pureza/proteína del lote, nunca «contenido de grasa»; pH con otros números; olor si
  el COA dice inodoro; apariencia incompleta). Corre aunque el lote sea el mismo. Lo que el COA no trae lo deduce
  `deducir_vacios` (`sugerir_campo_ficha`, máx. `COA_CANAL_AUTO_MAX_IA`=6 por documento, `COA_CANAL_AUTO_DEDUCIR=0`
  lo apaga) con `_fuentes` «(deducido; confirmar)». **Nunca deduce** modo de uso, descripción, aplicaciones ni propiedades
  (la IA mete dosis de suplemento: compliance), ni «No aplica» en CAS/EINECS (agar sí tiene 232-658-1), ni punto de fusión
  a un líquido (al D-pantenol le llegó el del DL-pantenol). El aviso dice qué llenó, qué corrigió (antes → después),
  qué dedujo y qué sigue vacío para una persona.
- **Aviso**: mensaje «Sistema» en el grupo (respondiendo a la última foto) → sale también al WhatsApp por el espejo.
- A mano / lo que llegó antes: `scripts/coa_canal_procesar.py --canal 1 --desde-id N [--aplicar] [--sin-aviso]`
  (sin `--aplicar` solo muestra qué haría). `COA_CANAL_AUTO_ACTIVO=0` lo apaga.
- Primer uso 7-oct: agar agar, colágeno hidrolizado, sorbitol polvo, proteína aislada de soya y creatina (el lote era
  **D**20260406C, el documento decía G…) actualizados; D-pantenol y L-arginina ya estaban.

### AL. Empresa viva — la operación como RPG de Super Nintendo (8-oct-2026)
Agenda → **Empresa viva** (panel `empresa-viva`) y el selector **Mapa · Juego** del cabezote del Mapa
(`localStorage` `mck-mapa-vivo-modo`). Código: `desktop/src/components/empresa/`; arte: `desktop/public/empresa/pixel/`.
- **Rehecho el 8-oct (tarde)** a pedido del usuario: el barrio 3D (Three.js + KayKit, «vista global sin centrarse en el
  personaje») se cambió por un **RPG en pixel art estilo Chrono Trigger**: cada quien **maneja su personaje** y camina hasta
  los demás para hablarles; la cámara lo sigue (zoom entero o de medio paso, ~17×9 baldosas). Se evaluó
  `androoAGI/starnet` (estación pixel art de agentes IA): es un arnés de agentes en Tauri + Node, y su arte NO es MIT
  (los sprites son del autor) → no sirve; se tomó solo la idea «el mundo es la proyección del estado vivo». Motor:
  **Phaser 4.2.1** (MIT; `juego.ts` lo carga lazy). El 3D quedó en el historial (commit c13a36ab); `three` se desinstaló.
- **Archivos**: `juego.ts` (arranca Phaser, interfaz para React) · `escena.ts` (dibujo, jugador, cámara, techos que se
  levantan, teclado, toque, globos, avioncitos, noche) · `motor.ts` (estado del servidor → personajes, fila de la tienda,
  paquetes, moto del mensajero, camión del proveedor, estantes de bodega, papeles) · `camino.ts` (A* sobre la rejilla de
  16 px + «cuerda tirante») · `personajes.ts` (compone avatares LPC por capas y paletas en un canvas) · `barrio.ts`
  (panel → lugar, `TAREA` → punto/ronda) · `dialogo.tsx` (ventana azul, texto que se escribe solo, menú con manito) ·
  `acciones.tsx` (Mi personaje, preguntar, decir, compartir) · `EmpresaViva.tsx` (HUD, diálogos de cada cosa, red).
- **Estilo HD-2D** (9-oct, pedido: «más 3D, mejores gráficos, menos pixelado, animaciones de mejor calidad»; se eligió
  HD-2D sobre personajes 3D pre-renderizados o rehacerlo en Three.js, para no perder avatares ni funciones):
  - **Más píxeles**: todo el arte se dibuja como siempre y se lleva al doble con **2xBR** (el escalador de los emuladores:
    suaviza bordes y diagonales sin emborronar). El barrio en `scripts/empresa_viva/xbr.py` al generarlo (suelo en trozos
    `suelo_<f>_<c>.png` de 2048 px por los celulares, atlas, techos, Hugo); los personajes en el navegador
    (`empresa/xbr.ts`, ~130 ms por apariencia, una vez) porque se recolorean por piezas. El juego muestra todo a 1/`HD`
    (`empresa/hd.ts` = `HD` de armar_mapa.py: si cambia uno, el otro) y las coordenadas de `mapa.json` no cambian.
  - **Pantalla real**: el lienzo va a la densidad del dispositivo (hasta 2×; `Scale.NONE` + zoom 1/dpr + `ResizeObserver`
    en `juego.ts`), filtrado suave y sin redondear posiciones (se mueve sin saltos de píxel).
  - **Efectos** (`escena.aplicarCalidad`): profundidad de campo (arriba y abajo desenfocados con un desenfoque + máscara
    degradada «dof»; ⚠️ el `TiltShift` de Phaser 4.2.1 tiñe todo de amarillo verdoso, no usarlo), brillo en lo claro
    (bloom), color un poco más vivo, viñeta; sombras suaves bajo cada personaje, respiración al estar quietos, polvo al
    caminar y correr, árboles que se mecen, sombras de nubes de día, cámara que se adelanta hacia donde caminas, ventanas
    que entran suaves. Botón **HD** de la barra = calidad alta o simple (1×, sin efectos), guardada en el navegador.
- **El barrio sale de un solo plano**: `scripts/empresa_viva/armar_mapa.py` dibuja `suelo.png`, `muebles.png`,
  `objetos.png`, `techos/*.png`, `hugo.png` **y** escribe `mapa.json` (lugares, puestos, puntos con nombre, estantes,
  rejilla de choques). Cambiar el barrio = editar el plano y volver a correr el script (`--vista x.jpg` = imagen de
  control); nunca editar `mapa.json` a mano. Lugares: los de siempre (gerencia, contabilidad, estudio, cuartos, oficina
  con cocina, bodega, recepción, portón, hongos, tienda). Arte: pasto/árboles LPC, oficina «LPC Revised: The Office», lo
  moderno dibujado en el script con la paleta LPC (`pixel/CREDITOS.md`).
- **Personajes**: `scripts/empresa_viva/armar_personajes.py` baja del Universal LPC Character Generator solo el catálogo
  (cuerpo, cabeza, 18 peinados, barbas, 8 camisas, overol, 6 pantalones, zapatos, gafas) y empaca tiras de 25 columnas
  (caminar, quieto, sentado en silla, celebrar, correr). El navegador apila y recolorea (paletas piel/pelo/tela/ojos).
  Avatar = `preferencias_ui.empresa {pixel:{…}, color}` validado contra `personajes.json` en
  `tickets_db._limpiar_avatar_empresa` (el formato 3D viejo ya no se acepta). Defaults por persona, clientes, proveedor y
  mensajero en `app/data/empresa_viva_casas.json` (`pixel`). Blusa/chaqueta/delantal del generador solo traen «caminar»:
  se excluyeron (desaparecerían al sentarse).
- **Jugar**: flechas/WASD, Shift corre, Espacio/Enter/E/Z = A (hablar o examinar lo de enfrente). Tocar el piso = ir
  allá; tocar a alguien = ir y hablarle; tocar una cara de la barra del equipo = caminar solo hasta esa persona. En
  celular: cruceta + A/B en pantalla. El teclado no se roba cuando se escribe en un campo. Con un diálogo abierto el
  personaje se queda quieto (y si iba caminando solo, sigue al cerrarlo).
- **Hablar = conversar, no hacer una tarea** (8-oct, pedido del usuario: «preguntar algo no es hacer una solicitud»). A una
  persona → qué hace ahora (tarea con cronómetro, panel abierto, WhatsApp, o «Zzz»), «Te escribí/Te respondí: …» si hay
  algo sin leer (un «!» sobre su cabeza), y el menú: **Hablar** = el **chat directo de los dos** (`ChatPersona.tsx`,
  `POST /api/canales/directo` → `canales_internos.canal_directo`: se crea al primer «Hablar» o se reusa un grupo que ya era
  solo de ellos, p. ej. «Armando · Cynthia»; `tipo='directo'`, **solo lo leen los dos, ni administración**, y tampoco ven
  el avioncito ni «X le escribió a Y» los demás). Queda guardado, llega con su push de siempre y se ve en «Equipo»
  («Ver en Equipo» abre ese chat vía `sessionStorage mck-chat-equipo-canal`). Si alguien te escribe mientras juegas, sale el
  diálogo «Responder / Ir hasta donde está / Luego». **Pedirle una tarea** = solicitud de la Agenda (aparte). **¿Qué
  haces?** = rol, funciones e «Ir a <panel>». El «Decirle algo» en memoria (`/decir`) se retiró: lo reemplaza el chat.
- **Cada módulo de la app es un objeto del barrio** (8-oct, pedido: «que se sepa qué espacio es qué y cada módulo cumpla
  su función»). `armar_mapa.py::estacion()` pone el ícono (58 íconos pixel en `objetos.png`, `ico_*`) sobre el mueble y el
  sitio de uso; `mapa.json → estaciones` (67, cubren todos los paneles de `flujoApp` salvo `chat`/`supervisor`, que van
  hablando con Hugo, y el propio juego). Reparto: Gerencia = Dirigir · Contabilidad = Contar + facturas/pagos/créditos ·
  Estudio = Preparar + Publicar · **Sala de sistemas** (nueva, mitad sur del antiguo estudio) = Sistema · Oficina de la
  sede = Entregar + **Facturar** (antes contabilidad; `barrio.POR_ETAPA`) · Bodega = stock e inventario · **Contenedor de
  comercio exterior** en el patio = Abastecer · Tienda = Vender (un portátil por canal) · pasillos = Agenda, chat del
  equipo (dispensador/cafetera) y Juegos (arcade) · **directorio** en la entrada de cada casa (lista los cuartos con sus
  módulos; tocar uno = caminar hasta él). Examinar un objeto = qué hace, etapa → tramo (de `flujoApp`, `barrio.infoModulo`),
  quién lo usa ahora, lo detenido del Mapa (también como **globito rojo** con el número sobre el ícono) y «Usar <módulo>»
  si hay permiso. Quien no juega va al objeto del módulo que tiene abierto (`motor.estacionPara`; si hay dos, el de su casa).
  **«¿Dónde está…?»** (`buscador.tsx`): todos los módulos por etapa, con filtro; elegir = caminar hasta el objeto. Al entrar
  a un cuarto sale su **letrero** («CONTABILIDAD · Contar»); con «Sin techos» se ven los nombres de todos los cuartos.
- **Los módulos se usan DENTRO del juego** (8-oct, pedido: «cuando se abre un módulo se rompe el juego porque se sale…
  una vista que sea 100 % el juego con todas las funcionalidades»). «Usar X» abre el módulo de verdad en una ventana del
  juego (`VentanaModulo.tsx`) y el personaje camina y se sienta en su objeto (los demás leen «Usando Libro Mayor»: campo
  `modulo` de `/api/empresa-viva/jugador`). Cerrar = «Volver al barrio», en el mismo punto. Cómo no se sale:
  - El módulo se monta con el mismo enrutador de la app, extraído de `App.tsx` a `components/PanelRouter.tsx`.
  - **Panel local** (`lib/panelLocal.tsx`): los módulos con secciones (Contabilidad, Facturación, Negocio, Inventario,
    Logística, Operativos) leen `usePanelActual()` / navegan con `useIrAPanel()` en vez del store; adentro del juego eso es
    la ventana (con migas y «← Atrás»), afuera es el store como siempre. ⚠️ Un hub nuevo con pestañas debe usar esos dos
    hooks, o al cambiar de pestaña saca a la persona del juego.
  - Lo que navegue por el store directo lo atrapa `interceptarPanel` (`stores/app.ts`), **solo** si el clic o la tecla salió
    de la ventana del módulo (bandera de captura en `VentanaModulo`): la barra de la app sigue funcionando normal.
  - El Mapa adentro del juego se fuerza a modo mapa (`MapaVivo`: sin el selector Mapa · Juego, o sería un juego dentro de otro).
  - Con algo abierto encima, flechas y espacio son de lo abierto (desplazar el módulo), no del personaje (`escena.instalarTeclado`).
- **Ajedrez entre dos** (8-oct, pedido: «que dos jugadores jueguen ajedrez, como minijuego»). Mesa de piedra en el
  parque, al sur de la calle (`armar_mapa.py`: `m_mesa_ajedrez`, dos `m_banquito`, estación `tipo="ajedrez"` + punto
  `ajedrez_der`). Se reta con «Jugar ajedrez» al hablarle a alguien o desde la mesa («Retar a alguien», «Mirar: A vs B»).
  Al que retan le sale el diálogo «Aceptar y jugar / Ahora no / Lo pienso» (y un botón ♞ que late en la barra mientras
  haya un reto o sea tu turno). Al empezar, cada quien camina a su banco (blancas a la izquierda) y se sienta; el tablero
  (`Ajedrez.tsx`) se juega con dos toques (pieza → casilla), con jaque, coronación, tablas ofrecidas y rendición.
  - **Servidor**: `app/services/empresa_viva_ajedrez.py`, tabla `ev_ajedrez` en `tickets.db` (sobrevive reinicios: se
    puede dejar a medias). Rutas `GET|POST /api/empresa-viva/ajedrez`, `GET …/<id>`, `POST …/<id>/aceptar|rechazar|
    cancelar|jugada|rendirse|tablas`, con la persona del juego (el contador no juega). Valida turno por paridad, forma
    UCI, `n` (no mover dos veces) y pone el resultado según el motivo (jaque mate = gana quien movió).
  - **No** valida la legalidad de cada jugada: lo hace **chess.js 1.4.0** (BSD-2) en el navegador de todos, que
    reconstruye la partida y la marca rota si una jugada no vale. Minijuego interno: no amerita un motor en Python.
  - Límites: 6 partidas abiertas por persona, una abierta por pareja, el reto vence a las 2 h. Mirar lo puede todo el
    equipo; mover solo los dos. Las piezas son pixel art propio (máscaras 16 × 16 en `Ajedrez.tsx`).
- **Trofeos al lado de la cama** (8-oct noche, pedido cuando Armando le ganó a Cynthia la primera partida, 37 jugadas con
  jaque mate). Cada partida ganada deja un trofeo a quien ganó (`ev_trofeos` en tickets.db, uno por partida y ganador):
  **oro** = jaque mate, **plata** = el rival se rindió, **verde** = partido de tenis ganado (uno para cada quien del
  equipo); las tablas no dan. Se acumulan en una **repisa al lado de la cama** de cada cuarto (`m_repisa_trofeos`, punto
  `trofeos_<cuarto>` con 2 baldas de 4; desde el noveno sale «+N»); quién duerme dónde lo dice `empresa_viva_casas.json`.
  Examinar la repisa = la lista («le ganaste a Cynthia con jaque mate en 37 jugadas · 8 oct»). Al arrancar, las partidas
  ganadas antes de existir los trofeos dejan el suyo (por eso el de Armando quedó guardado). ⚠️ Jenniffer y Sebastián no
  tienen cuarto en el barrio: sus trofeos se guardan pero no se ven en ninguna repisa. No es un ranking: nada compara
  a nadie, cada quien tiene los suyos en su cuarto.
- **Tenis en equipo** (8-oct noche, pedido: «un juego de tenis para jugar en equipo todos, como el ajedrez»). Cancha en
  el parque, al lado de la mesa de ajedrez (`textura_cancha_tenis`, estación `tipo="tenis"`, puntos `tenis_A`/`tenis_B`).
  Alguien **arma un partido** (sala), los demás se unen al equipo A (izquierda de la red) o B (hasta 3 por lado), quien lo
  armó lo empieza; a todos los que andan por el barrio les sale el aviso y queda en «Atender». Tiempo real, gana quien se
  lleve **2 juegos** (15-30-40, iguales, ventaja).
  - **Se invita hablándole a alguien** (8-oct, el usuario solo veía «Jugar ajedrez»): «Jugar tenis» arma el partido con
    esa persona en `invitados` (o la invita al que ya tienes armado: `POST …/<id>/invitar`); a ella le sale el diálogo
    «Unirme al equipo X / Ver la cancha primero / Ahora no» (el equipo con menos gente). Si la persona ya está en un partido
    que no ha empezado: «Unirme a su partido de tenis». También desde la mesa de ajedrez y la repisa de trofeos.
  - **Red sin sockets**: cada jugador manda su raqueta cada 100 ms (`POST /api/empresa-viva/tenis/<id>/estado`); el
    **anfitrión** (quien lo armó, o el siguiente vivo si se va 6 s) simula la pelota en su navegador y la manda, y anota los
    puntos con `punto_seq` (un reenvío no cuenta dos veces). Los demás dibujan la pelota adelantada con su velocidad. El
    servidor (`app/services/empresa_viva_tenis.py`) solo reparte y lleva el marcador; vive **en memoria** (un reinicio corta
    los partidos; los trofeos ya ganados quedan). ⚠️ Si el anfitrión cierra la ventana, la pelota se detiene hasta que otro
    tome el relevo.
  - Rutas: `GET|POST /api/empresa-viva/tenis` (POST `{invitar: [ids]}`), `GET …/<id>`, `POST …/<id>/unirse|invitar|salir|empezar|estado`. Cuadro y física en
    `Tenis.tsx` (canvas, coordenadas 0-1, cancha 2 × 1); con el dedo se arrastra la raqueta.
- **Vecindario: cada quien su casa** (9-oct, pedido: «cada personaje vive en su casa independiente y la decora con flores,
  ampliaciones, muebles, accesorios, con un monto cerrado de dinero al mes; primero compra un terreno»). La empresa y
  los lugares de trabajo no cambian: el mapa creció hacia el sur (`ALTO_T` 46 → 70) con un andén, tres pasajes, la calle
  de las casas y **16 terrenos** de 8 × 8 baldosas (`armar_mapa.py::vecindario`, `mapa.json → lotes`: id, frente,
  precio 320-450).
  - **Monedas**: del juego, **iguales para todos** y sin relación con sueldos, horas ni rendimiento (nada de rankings).
    1.000 al mes, lo que no se gasta se acumula, quitar algo devuelve la mitad; todo en
    `app/data/empresa_viva_vecindario.json` (monto, `acumula`, precios, catálogo de 33 cosas, 3 estilos y 3 niveles de
    casa). Libro `ev_billetera` (asignación del mes —y la de los meses sin entrar—, compras, devoluciones).
  - **Flujo**: letrero del terreno → comprar (uno por persona) → construir (Ladrillo, Colonial o Moderna, 400) → decorar
    (`Casa.tsx`: catálogo por Jardín/Muebles/Accesorios/Casa; el juego pinta en verde o rojo dónde cabe y se pone tocando
    el terreno; tocar algo = moverlo o quitarlo) → ampliar (6 × 4 y 6 × 6; antes hay que mover lo del jardín que estorbe)
    o pintar (100). Botón «◉ saldo» en la barra = mis monedas; «Atender» recuerda comprar terreno o construir.
  - **Geometría** igual en `empresa_viva_vecindario.py` y `vecindario.ts` (si cambia una, la otra): casa centrada a lo
    ancho y pegada al fondo opuesto a la calle, la fila de arriba es la cara del muro norte, la puerta y su camino ocupan
    las columnas 3-4 (no se pueden tapar), alfombras en capa de suelo (sí pueden ir debajo de un mueble).
  - **En el juego** (`casas.ts`): las casas se dibujan en vivo (piso, muro con ventanas, puerta, **techo que se levanta**
    al entrar), los muros y muebles bloquean el paso en una capa en vivo de la rejilla (`Rejilla.bloqueosDinamicos`) y
    cada casa es un lugar (`casa_<lote>`): quien no está conectado duerme en su casa (`motor`), y si pone la **repisa de
    trofeos** sus trofeos se mudan del cuarto de la empresa a su casa.
  - Servidor: `app/services/empresa_viva_vecindario.py` (tickets.db: `ev_terrenos`, `ev_casas`, `ev_casa_items`,
    `ev_billetera`); rutas `GET /api/empresa-viva/vecindario`, `POST …/vecindario/terreno|construir|ampliar|pintar|poner|
    mover|quitar`.
- **Objetos que se distinguen del mapa** (8-oct noche, pedido: «los nombres e íconos de los módulos no se distinguen»).
  Cada objeto-módulo flota en una **placa del color de su etapa del Mapa** (`barrio.colorModulo` lee `mapaComun.COLOR`,
  paleta PICO-8: Contar azul noche, Facturar vino, Vender verde…), con borde claro, una puntita hacia el mueble y un vaivén;
  al entrar a un cuarto salen **los nombres de todos sus módulos** con ese color, sin montarse (el que choca no sale).
  `barrio.objetoDe` lleva «Publicaciones» y «Canales del producto» (salieron del menú) al objeto de Vitrina web.
- **«Atender» (tecla Q, primer botón de la barra)**: lo que necesita tu atención en un menú (`MenuAtencion.tsx`): *Para ti*
  (solicitudes que te hicieron — de `/api/mensajes/resumen` —, chats sin responder, grupos sin leer, retos y turno del
  ajedrez, partidos de tenis), *Detenido en tus módulos* (el «Detenido ahora» del Mapa, ya recortado a tus permisos) y *En
  el barrio* (clientes en la tienda, paquetes por alistar, proveedor llegando). Cada renglón: **Atender** (abre el módulo
  ahí mismo, dentro del juego; una solicitud se abre directo en Mensajes → Solicitudes) o **Ir** (caminar hasta el objeto).
- **Techos**: la casa donde está el jugador pierde techo y fachada; sobre los techos se lee «Adentro: …». «Sin techos»
  en la barra los quita todos. Noche con la hora de Bogotá (velo + halos en los postes).
- ⚠️ Botones del juego con `mck-btn-no-fx` (el `index.css` les fuerza posición, `overflow` y efectos). ⚠️ En desarrollo
  React monta dos veces: `JuegoEmpresa` lleva la bandera `destruido` o quedan dos lienzos de Phaser superpuestos (el de
  arriba congelado). ⚠️ Lo que no se mueve con la cámara se escala con el zoom (el velo de la noche se recalcula).
- **Banco de pruebas**: `/app/dev/app.html` → «JUEGO» en el cabezote del Mapa; `dev/empresaVivaEjemplo.ts` trae el ciclo
  de 4 fotos, un jugador de ejemplo (Jenniffer camina por la sede) y un chat directo de ejemplo (a los 90 s te escribe).
  `dev/ajedrezEjemplo.ts`: partidas en memoria; el rival acepta y responde con jugadas al azar, Cynthia y Victor juegan
  una (para mirar) y Jenniffer te reta a los 25 s; trae el oro de Armando y una plata de Victor en sus repisas.
  `dev/tenisEjemplo.ts`: Victor se une al equipo B y su raqueta sigue la pelota; Cynthia arma un partido a los 40 s.
  `dev/vecindarioEjemplo.ts`: Cynthia con casa colonial decorada, Stella moderna, Victor solo terreno; tú con 1.000.
  `?sin_retos=1` apaga los retos de ejemplo (ajedrez a los 25 s, tenis a los 40 s) para probar sin interrupciones.
  En `npm run dev` el juego
  queda en `window.__empresaViva`. Capturas: Chrome headless + CDP con tiempo real (ver memoria de capturas).
- ⚠️ Nada de puntajes, rankings ni tiempos por persona (RRHH).
