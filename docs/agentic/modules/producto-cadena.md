# Producto cadena

> Movido tal cual desde CLAUDE.md el 27-sep-2026 al comprimirlo; allí queda un resumen con enlace aquí.

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
`App.tsx` pone el mapa **una vez por carga de página** (`INICIO_EN_MAPA`); un `?panel=…` manda sobre él. **Lo urgente titila** (25-sep-2026): `GET /api/mapa-sistema/urgencias` lo ve TODO el equipo interno, filtrado **en el servidor** por los paneles que cada quien puede abrir (`mapa_app.urgencias_para` + `app/services/acceso_paneles.py`, réplica de `panelAccess.ts` para los paneles a los que apunta alguna fuente; `tests/test_acceso_paneles.py` exige una regla decidida para cada uno). La persona sale del token PERSONAL (`X-Tickets-Token`): `CHAT_API_TOKEN` solo lo recibe administración. Titila el APARTADO (lo detenido de severidad alta + las solicitudes propias `alta`/`urgente`), no la carta, que solo lleva marco rojo; «¡Ir a lo urgente!» encuadra esas cartas. **Sin niveles de detalle** (26-sep-2026): se quitaron Etapas · Cotidiano · Operación · Todo; la barra solo lleva **Mapa · Edificio** y cada quien ve SIEMPRE todos los paneles que puede abrir, con «Detenido ahora» en cada etapa (lo que hace cada panel va en el título al pasar el cursor). **Sonidos de juego** (26-sep-2026, `lib/sonidosJuego.ts`, instalado en `App.tsx`): un solo escuchador `pointerdown` elige el sonido por lo que se tocó — la etapa del `data-etapa` más cercano en el Mapa y el Edificio (timbre en Inicio, pitazos de camión en Abastecer, martillo en Preparar, obturador en Publicar, moneda en Vender, camión que arranca en Entregar, impresora en Facturar, calculadora en Contar, fanfarria en Dirigir, computadora en Sistema), alarma en lo urgente, «◇ Mapa» = volver, Mapa · Edificio = pausa, y con la piel pixel un blip en las pestañas de los módulos. **Sintetizados** con Web Audio al estilo NES (cuadrada/triangular/ruido): los juegos de la sección Juegos son ROMs emuladas y su audio NO se copia. Botón «♪ Sonido / Silencio» en la barra del Mapa (`mck-sonidos` en localStorage); el último sonido queda en `data-ultimo-sonido` de `<html>` para pruebas. Un botón con `data-sin-sonido` no suena. **«Tu día» se retiró** (26-sep-2026: como franja no era responsive en el celular y en escritorio no decía nada que la carta de Inicio no dijera): la carta de Inicio lleva **«Mi ficha»** (`BotonMiFicha` de `MiRendimiento.tsx`, abre la ficha del mes en un portal). **La portada de la Agenda ya no existe como pantalla** (26-sep-2026, decisión del usuario: «solo deja el mapa»): `panelDeInicio(user)` (`lib/panelAccess.ts`) es la pantalla de inicio y todo lo que antes «volvía a la Agenda» va al Mapa — `TicketsPanel` desvía su vista `home` al Mapa (salvo con el chat de Hugo abierto, con una vista pedida en camino o si la Agenda no es el panel visible), la primera pestaña de `InicioNavTabs` se llama «Mapa», la barra del celular dice «Mapa», el botón atrás de Android y «volver» de Perfil llevan al Mapa, y se quitó «▶ Mi agenda» del Mapa y del Edificio. Mensajes, las solicitudes, crear y el chat de Hugo siguen igual. Quien no puede abrir el Mapa sigue en la Agenda. **Vista «Edificio»** (`MapaEdificio.tsx` + `mapa-edificio.css`, selector Mapa · Edificio en la barra, recordado en `mck-mapa-vivo-modo`): la misma aplicación como diorama pixel en corte — cada etapa es un **piso** (Abastecer P1 con el muelle de carga … Contar P7, Dirigir P8, Inicio = planta baja/recepción, Sistema = sótano S1), cada panel una estación en la pared, y lo que se mueve dice algo: sirena donde hay urgencias, notas pegadas = lo detenido, tu muñeco «TÚ» donde tienes solicitudes, luces apagadas donde no participas; tocar una estación hace destellar el piso y abre el panel. **La operación real (26-sep-2026):** cada piso dibuja sus **estaciones** (`components/mapa/operacionMcKenna.ts`: muelle, recepción, bodega · dosificar, empacar, lote, etiquetar, almacén · foto, publicar · pedidos, preguntas · alistar, embalar, guía, transporte · factura, solicitud y aprobación del pago · Libro Mayor · análisis), cada una atada a una **función del catálogo real** de `rendimiento.CATALOGO`; **quién la hace** sale de `GET /api/mapa-sistema/quien-hace` (`rendimiento.quien_hace`: tareas cronometradas/asignadas + uso del módulo, con las reglas de la ficha; solo nombres y veces, ni horas ni pagos; no lo ven el colaborador externo ni el contador). Cada persona está quieta, con su nombre, en su puesto principal y camina cuando le toca. El `RECORRIDO` es el día en orden, con relevos (`CapaRelevos`): la mercancía se transforma (materia prima → bolsa → producto etiquetado → paquete → paquete con guía; el camión arranca en Transporte) y los papeles llegan a contabilidad (factura de compra → solicitud → aprobación → Libro Mayor; entrega → factura de venta → Libro Mayor → análisis). Cada paso muestra lo que hace quien recibe («Pesa y envasa»). Reordenar el proceso = editar `operacionMcKenna.ts`. Los datos NO se recalculan: salen de `MapaVivo` (tipos, colores, `useInicio`, numeración de pisos en `mapaComun.tsx`), así el tablero y el edificio no pueden contar distinto. Todo en CSS con `steps()` y `cqw`; `prefers-reduced-motion` lo detiene. **Cada módulo es su piso** (piel pixel): `Layout.tsx` pone `data-piso` y `--mck-piso` en `<main>` → placa «P5» en la miga (`placaDePiso`), losa del color de la etapa bajo el cabezote, pared con rayas, encabezado de tablas teñido, botones de bloque y puertas de ascensor al entrar (`.mck-animate-enter`, sin `forwards` para no recortar menús). `ESTILO_BASE_V = 4`: re-adopta la piel pixel una vez (Armando tenía sakura y Cynthia barbie guardadas: por eso los módulos no se veían pixel). ⚠️ El Mapa y Colaboradores son una **isla clara** (`.colab-pixel`): no cambian en modo oscuro. Dentro rige la traducción de colores CLARA (el generador excluye la oscura con `:not(.colab-pixel *)`) y la isla redeclara las variables DERIVADAS (`--mck-card-bg: var(--mck-surface-panel)`…) y los tokens de estado: una variable que referencia otra se resuelve donde se declara, y heredada traía el azul marino del modo oscuro. ⚠️ Una pestaña flotante debe ser un `<div>` posicionado con el botón adentro (`index.css` fuerza `position: relative` en todo `<button>`). ⚠️ React Flow
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

**Fotos y mockups (27-sep-2026):** quinta pestaña. Lo que el equipo arma por fuera (foto de estudio,
mockup) se copia con Ctrl+C y se pega con **Ctrl+V** en la columna del canal (Mercado Libre · Página
web); también se puede arrastrar el archivo o usar «Pegar desde el portapapeles» en el celular.
Se guarda como los PNG aprobados: misma biblioteca, carpeta `Recursos PNG/FOTOS PRODUCTO/<canal>/`,
con registro por SKU en `app/data/fotos_producto.json` (no depende del nombre del archivo).
`app/services/fotos_producto.py` + `/api/mapa-sistema/fotos-producto[/<ref>[/archivo]]` (permiso del
Espacio de producto); «Quitar» mueve a `.papelera_fotos_producto/`, fuera de Recursos PNG. Guardar
**no publica** en MeLi ni en la web. **Lo que falta titila en rojo** (`.mck-titila-rojo` /
`.mck-titila-rojo-borde` en `index.css`, steps() como la piel pixel, quieto con reduced-motion): en
la lista, las pestañas y las columnas vacías. Puntos: documento · etiqueta · EAN · PNG · fotos.
Banco: `desktop/dev/espacio.html[?ref=C-FALTA500g]` (fetch interceptado, fotos en memoria).

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

### AD. Diseño de producto → Studio → Árbol del producto (27-sep-2026) — reemplaza al Taller de combos

El grupo del menú «Diseño» se llama **«Diseño de producto»**. Studio visual abre en **«Árbol del producto»**
(`plantillas-visuales/arbol/`, `app/services/arbol_producto.py`, `GET /api/mapa-sistema/arbol-producto`): categoría (la
`linea` de la web) → familia (materia prima, con su documento técnico como raíz) → presentación (combo C-…, con la foto
de la vitrina) → **siete** hojas: etiquetas · fotos · EAN · receta · factura · MeLi · web. **Una sola vista**, sin
pantallas aparte. **No calcula nada propio**: junta `mapa_producto.anatomia_combos`, `canales_producto.tabla_maestra` y
`fotos_producto.por_sku()`.
- **El «Taller de combos» ya no existe como panel** (se borraron `CombosPanel.tsx` y `MisionCombos.tsx`: tablero, lista,
  marcador). Lo que servía quedó en `components/combos/PiezasCombo.tsx`: `ResolverPieza` = el emergente de cada pieza
  (pregunta que guía, «siguiente pendiente», ventanas de Códigos EAN / Docs técnicos / kit de Alegra, moneda y
  celebración al completar) que el árbol abre **encima de sí mismo** al tocar una hoja, la raíz (documento) o
  «Resolver lo que falta»; y `CrearComboVentana` para «Comprados sin combo» (entrada al pie de la lista de categorías).
  El id `combos` queda solo como **alias**: `setPanel("combos")` (Canales, bloqueos viejos, tickets, `?panel=combos`) →
  `abrirArbolProducto(sku)`; `volverAlTaller` («← Seguir con…») también vuelve al árbol en ese combo (`arbolRef`).
  Los bloqueos del mapa (`mapa_app._producto`) apuntan a `etiquetas`; la guía de la etapa Preparar abre el árbol.
- **Columna derecha = una columna por canal**: la etiqueta (web nítida de ETIQUETAS STUDIO · MeLi desenfocada de
  PUBLICACIONES DIGITALES; copiar, descargar, tocar la miniatura la amplía) y **debajo sus fotos de producto**, que se
  pegan con **Ctrl+V** en la columna marcada (o se arrastran; «Pegar desde el portapapeles» en el celular). Misma API y
  biblioteca que Espacio de producto → «Fotos y mockups» (`FOTOS PRODUCTO/<canal>`, `app/data/fotos_producto.json`).
  El pegado se ignora si hay un emergente modal abierto o el foco está en un campo de texto. Debajo, «¿Se puede vender y
  facturar?» con cada fila que abre su pieza.
- **La pieza «Fotos»** (`arbol_producto._fotos`): lista con una foto por canal **posterior a la aprobación de la
  etiqueta** (o si la vitrina ya muestra la etiqueta vigente, `foto_estado=ok`); si falta un canal o la foto es anterior
  a la etiqueta → revisar. Sin foto al día un combo no está al 100 % (27-sep: 261 de 292 sin foto vigente).
- «Etiquetas para publicaciones» se retiró y «Categorías» pasó a «Plantillas por categoría». Permiso: `_auth_studio` =
  el de mapa-sistema/combos **o** `puede_ver_etiquetas_avanzado` (en `/arbol-producto`, `/combos`, `/productos`,
  `/invalidar` —que invalida también Canales— y `/fotos-producto*`). Diseño ya no expulsa a «Imprimir» antes de que
  cargue el usuario (`EtiquetasPanel`: sin usuario no se decide el acceso al Studio). Sin LLM, sin llamadas vivas.
- **Estilo = el del Mapa** (27-sep): el árbol va dentro de la isla clara `.colab-pixel` + `.arbol-pixel` y pinta solo
  con las variables `--ed-*` del Mapa (`arbol/arbol.css`, clases `ap-*`: cartas con borde y sombra dura, barra tipo
  marcador, botones que se hunden, rama elegida con hormigas en marcha, sprites de `colaboradores/pixel.tsx` por pieza).
  Por eso **cambia de gama con el tema** elegido en Temas igual que el Mapa y el Edificio (`theme/mapa-temas.css`). Los
  fondos de estado se mezclan con `--ed-crema` (en un tema oscuro como Matrix `--ed-durazno` es oscuro). Los emergentes
  son portales: fuera de la isla, siguen la piel normal. Estado: `PUNTO`/`CAJA` de `arbol/tipos.ts` son clases `ap-*`.
- ⚠️ Lo que en este archivo (Flujo U y otros) dice «taller de combos» es historia: hoy es el Árbol del producto.

### La tienda web se lee como el árbol (28-sep-2026)

- **Familias y nombres**: `arbol_producto.arbol()` deja `PAGINA_WEB/site/data/familias_arbol.json` ({ref: familia,
  nombre}) cada vez que se calcula (a mano: `python3 -m app.services.arbol_producto --familias-web`). La web
  (`website._unir_por_familia_arbol`) agrupa primero por nombre como siempre y luego el árbol **solo une y renombra**:
  nunca separa (un alias sin «C-» fuera del árbol sigue con su grupo) y **no une si choca un tamaño** — así se descubrió
  que la receta de C-AMILCAR100g (L-Carnitina) apunta a la materia prima de L-Teanina; unirlas borraba la carnitina en
  el dedupe. El combo original conserva su nombre (cache.json y el cruce MeLi dependen de él); la tarjeta muestra el del
  árbol + concentración única («85%») + color («Amarilla»). Categorías y fichas en orden alfabético sin tildes
  («Ácidos» con las A), «Otros» al final. Sin el JSON la web agrupa como antes. `CATALOG_CACHE_VERSION` 17.
- **URLs**: una familia nueva por fusión toma URL legible del nombre del árbol si es más larga que la del código
  (`acisal` → `acido-salicilico`, pero `tensoactivo-sci` se queda); las viejas por nombre dan 301
  (`_slug_familia_antigua`: `aceite-ricino` → `aceite-de-ricino`).
- ⚠️ Un error de datos del árbol (receta cruzada, nombre con errata como «Semillla de Chía») ahora se ve en la web:
  corregirlo en el árbol, no con parches en `website.py`.
- **SEO de la ficha** (`website._producto_seo`): schema.org `Product` (Offer o AggregateOffer, sin `gtin`: los EAN de
  etiquetas son internos 770+consecutivo, no GS1) + `BreadcrumbList`, canónico sin `?pres=`, título «… — Comprar en
  Colombia». Ajuste por producto en `PAGINA_WEB/site/data/seo_productos.json` ({slug: {title, description}},
  `{precio}` = precio vigente).
- **Rutas de origen** (mapa «Del origen a tu fórmula»): `scripts/sincronizar_origen_materias.py` llena
  `overrides_sku` de `origen_materias.json` desde documento técnico → proveedor por SKU → proveedor por nombre
  (Colombia solo si no hay otro país) y agrega coordenadas de países nuevos. Nunca pisa un override existente (lista
  los que discrepan). Vista previa por defecto, `--aplicar` para escribir. 28-sep: 138 productos que caían al default
  de su línea (alimentario = Estados Unidos) + Sri Lanka, Túnez, Vietnam.
- **Clic a producto «no abría»** (28-sep): `documentos_web._cargar_indice` releía las ~315 fichas YAML cada 60 s
  (`DOCS_WEB_TTL_SEC`) con el lector en Python: el siguiente clic esperaba ~14 s. Ahora libyaml (`CSafeLoader`, mismo
  resultado) y caché por archivo (mtime+tamaño, copia profunda por uso): ~1 s en frío, ~0,7 s al vencer el TTL.
