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
