# Module: Colaboradores (diagramas compartidos con colaboradores externos)

Creado el 2026-09-21. Armando construye con un colaborador externo (primero **Sebastián García**,
`sebastian.garcia`, sebastianrgarcia2005@gmail.com, usuario 13) un **diagrama de flujo** de la relación
comercial para un proyecto conjunto, a mano y desde el celular.

- **Panel** `colaboradores` (Agenda → Colaboradores): `desktop/src/components/ColaboradoresPanel.tsx`,
  editor táctil con **React Flow** (`@xyflow/react`). Cajas (tipo: acción, decisión, entregable, dinero,
  tercero; carril: McKenna, colaborador, ambos), flechas con texto, «Unir con otra caja» para el celular.
- **Cómo se llega**: pestaña *Colaboradores* en el cabezote de la Agenda (`nav/InicioNavTabs.tsx`, también
  en `soloVistas`, que es lo que muestra `FlujoNav` con la Agenda abierta) y tarjeta en la portada del
  celular (`MobileHub.tsx`). Sin eso solo se llegaba por Ctrl+K: el panel vive en la sección `inicio`, que
  no dibuja sus items en la navegación por flujo.
- **Celular**: el editor abre en pantalla completa (`pleno`, ⛶ para salir) y las hojas de editar caja y
  flecha son `fixed` al borde inferior. Pegadas al lienzo se recortaban: el cabezote deja una franja baja
  y el panel no tiene scroll de página (Layout le da altura fija, como a Contabilidad).
- **Flechas**: cada una guarda por qué lado toca cada caja (`fromLado`/`toLado`: l, r, t, b — cuatro
  handles por caja con `ConnectionMode.Loose`), `color` (paleta cerrada), `grosor` (1-8), `trazo`
  (sólida/guiones/puntos), `forma` (curva/recta/escalón) y el `label` que va en el medio. Se editan en la
  hoja de la flecha o arrastrando la punta (`onReconnect`). El servidor valida contra sus listas: un color
  libre sería texto entrando a un atributo SVG. **Desde 25-sep-2026 la flecha nace RECTA**
  (`FORMA_DEFECTO`), al crearla se abre su hoja para nombrarla, y el botón «Rectas» de la barra vuelve
  rectas todas de un toque.
- **Cada caja carga contenido real** (Fundación del «tablero de proyecto», 25-sep-2026): campos
  OPCIONALES en el nodo — `imagen` (foto que sale en la caja), `variables{como,donde,porque}` (el «quién»
  es el carril, el «qué» el título), `tiempo_min`, `costo`/`precio` (`{monto,moneda}`, moneda de
  `MONEDAS`), `datos[]` (campo:valor, máx 8), `consecuencias[]` (si→entonces→medida, máx 6), `adjuntos[]`
  (fotos y facturas PDF, máx 12), `enlaceApp`. Se sanean en `_extras_nodo()`; una caja sin ellos sigue
  siendo mínima (solo se guarda lo que trae valor). La caja pinta la foto arriba y chips (💲/💸/⏱/▦/📎/⚠).
  Editor React en `ContenidoCaja`; el export a Archify resume precio/costo en el subtítulo.
- **Adjuntos**: `POST …/media` (multipart `archivo`, 15 MB) → `guardar_media()` reduce imágenes a JPEG
  ≤1400 px, guarda PDFs tal cual, en `colaboradores_media/` (repo, gitignored). El id lleva el diagrama
  adentro (`<did>-<uuid>.<ext>`); `GET …/diagramas/<did>/media/<mid>` lo sirve con `@_suyo` y
  `media_de_diagrama()` (rechaza `../` y el media de otro diagrama). En el panel, `AuthImg` los muestra
  con blob autenticado y caché.
- **Nodo de consenso** (25-sep-2026): el tipo `consenso` lleva `asunto`, `propuestas[]` (una por autor,
  `p<uid>`), `votos{uid:pid}` y `resuelto{propuesta,modo,por}`. Voto, autoría y cierre son
  **autoritativos del servidor** (`accion_consenso`, ruta `POST …/consenso`): el voto es del usuario
  autenticado, no de lo que diga el cliente. Empate → decide el `turno_actual` **global** del diagrama y
  el turno **se alterna** al otro de la pareja (`_participantes_ids`); acuerdo (mayoría de votos) no toca
  el turno. Retirar una propuesta borra sus votos y reabre. Todo en una transacción RMW; el panel
  (`ConsensoEditor`) refresca con lo que vuelve. `obtener()` añade `participantes` (uid→nombre) para
  pintar autores/votantes/turno. Tests en `tests/test_colaboradores.py`.
- **Producto y competencia** (25-sep-2026): tipo `producto` = carta con la foto en un círculo escalonado
  al centro y seis apartados alrededor (SKU, vitrina = host del `url`, precio, empaque, margen, receta),
  como el Taller de combos; ranura sin dato = punteada con «?». Campos: `sku`, `empaque{nombre,costo}`,
  `componentes[]{nombre,cantidad,costo}` (costo de UNA unidad; máx 12 válidos), `url` (**solo http(s)**:
  se pinta como `<a href>`, `_url()` descarta `javascript:`), `plataforma`. Costo por unidad = piezas +
  empaque en la moneda del precio (no convierte monedas); margen = precio − costo. Tipo `competencia` =
  carta de rival (captura, dónde vende, precio). Unidos por una flecha (cualquier sentido) se comparan:
  el rival muestra «16 % más caro que…» y el producto «VS n» + rango de precios. Eso se calcula en
  `nodosVista` como claves `_vs`/`_rivales` que `aDoc()` QUITA (si se colaran, `combinar()` vería cada
  caja como cambiada y pisaría al otro). El marcador de arriba suma tiempo y dinero invertido por carril
  (sin productos ni rivales: su precio es por unidad, no inversión).
- **Pixel art** (25-sep-2026): `components/colaboradores/pixel.tsx` (sprites 8×8 en paleta PICO-8 como
  SVG `crispEdges`, reemplazan los emojis; `circuloPixel()`; fuentes Press Start 2P + VT323 por Google
  Fonts, inyectadas una vez) y `pixel.css`. Todo bajo `.colab-pixel`, que **redefine los tokens `--mck-*`**
  (y `--mck-field-fs`/`--mck-field-h`: la regla global de campos compactos `#root input…` los ponía a
  0,78 rem, ilegible en VT323). Botón «Clásico/Pixel», recordado en `localStorage`. Las cartas de
  producto y rival son pixel siempre. ⚠️ Una carpeta nueva con clases debe ir en `tailwind.colab.config.ts`
  (el build del colaborador solo escanea lo que lista) y el bundle NO puede contener «MeLi»/«Mercado
  Libre» (lo rechaza `verificar-build-colab.mjs`: ojo con placeholders). Las flechas usan un tipo propio
  (`Flecha`) con etiqueta HTML: la SVG de React Flow se mide una vez al montar y el texto se salía del
  recuadro si la fuente llegaba después.
- **Banco de pruebas**: `desktop/dev/colaboradores.html` monta el panel real con datos inventados y
  `fetch` interceptado (nada llega a producción). `?abrir`, `?sel=<id>`, `?clasico`, `?medir=<selector>`
  (estilo calculado al `<title>`, para `--dump-dom`) permiten capturas con `google-chrome --headless`.
- **Pendiente**: auto-relleno del producto desde el catálogo real (solo el anfitrión; el colaborador
  siempre manual, está amurallado fuera de esos módulos) y abrir apartados de la app desde una caja.
- **Backend** `app/services/colaboradores.py` + `app/routes_colaboradores.py` (`/api/colaboradores/*`),
  base propia `app/data/colaboradores.db` (diagramas + todas sus versiones).
- **Concurrencia**: cada guardado lleva la `version` editada; si otro guardó antes → 409 `conflicto` y
  el panel **combina** (3 vías: base, local, remoto) y vuelve a guardar. Sondeo cada 3 s (no hay SSE/WS).
- **Archify**: el documento guarda x/y libres; `a_archify()` lo traduce a `workflow` (carril = lane,
  posición horizontal = col) y `exportar_archify()` corre el CLI (`~/.claude/skills/archify`, el del
  usuario del servicio) → `app/data/colaboradores_archify/colab-<id>-v<n>.html`, solo lectura.
- **Quién entra**: el anfitrión (`COLABORADORES_ANFITRION_ID`, 8 = Armando) y usuarios con
  `colaborador_externo`. Nadie más, ni otros administradores (el panel exige el permiso `colaboradores`).
- **Un diagrama es de una pareja**: `colab_diagramas.colaborador_id`. El colaborador solo ve y abre los
  suyos (`puede_ver()` + `@_suyo` en las rutas por id); el anfitrión los ve todos. Sin eso, el permiso
  `colaborador_externo` era la llave de TODO el espacio y un segundo colaborador abriría los diagramas
  del primero cambiando el id. Si Armando crea un diagrama y hay más de un colaborador, debe mandar
  `colaborador_id` (con uno solo se resuelve solo).
- **Perfil `colaborador_externo`** (lista blanca en `app/routes.py::_guard_colaborador_externo`):
  Colaboradores, su sesión y su Agenda **solo con Armando** — crea solicitudes/acciones asignadas a él,
  abre solo tickets entre los dos, las listas de usuarios/presencia le muestran solo a ambos
  (`routes_tickets._visibles_para`, filtrado en el ORIGEN: un after_request genérico dejó pasar la lista
  completa), sin vista de equipo, sin misiones, asignar ni participantes. Todo lo demás: 403.
- **Qué ve de las personas que sí ve** (`routes_tickets._publico_para`): solo id, nombre y foto. El
  registro completo traía correo, teléfono, **cédula** y `permisos_secciones` —o sea, la lista de módulos
  internos—. Su propio registro va completo porque la SPA lo necesita.
- **Lo que se le cerró además** (21-sep-2026): `/api/tickets/actividad-equipo` devuelve `[]` (los eventos
  del anfitrión son trabajo interno: títulos de tickets con terceros), `/api/tickets/departamentos`
  devuelve `[]` (organigrama) y `/api/status` responde solo «activo» (decía qué integraciones tiene la
  casa: MeLi, Google, Alegra…).
- **El bundle ya no es público** (21-sep-2026): `/app` y `/app/assets/*` piden la cookie de sesión —
  ver `app/spa_sesion.py` y `tests/test_acceso_panel.py`. Antes los servía a cualquiera que llegara al
  dominio, con la estructura de módulos y la superficie de la API adentro.
- **Una aplicación aparte, no el panel recortado** (23-sep-2026). Antes, con sesión, el colaborador
  recibía el mismo bundle que todos (1,2 MB con los 61 paneles nombrados), podía bajar cualquier chunk
  por su nombre y también los `.map`, que traían **134 archivos TypeScript completos con comentarios**.
  Ahora:
  - `/app/assets/*.map` → 404 para todo el mundo (se siguen generando, `hidden`, para depurar en el servidor).
  - Build propio `desktop/vite.colab.config.ts` → `desktop/dist-colab/` (entrada `colaboradores.html` →
    `src/colab/main.tsx`: `ColaboradoresPanel` + `AgendaColab`). Los stores de sesión del panel se
    reemplazan por alias (`src/colab/stubs/`), sin sourcemaps, Tailwind solo con sus archivos.
    `npm run build` lo compila al final; `scripts/verificar-build-colab.mjs` hace fallar el build si se
    cuela una ruta `/api/` ajena o un nombre de módulo (Contabilidad, Alegra, Cynthia…).
  - `serve_spa` entrega `dist-colab/colaboradores.html` a quien tiene el perfil (falla cerrado con 503 si
    no está compilado) y `serve_spa_assets` solo le sirve `dist-colab/assets/`. El `?_token=` de la URL
    manda sobre la cookie (cambio de cuenta en el mismo navegador).
  - La Agenda del colaborador: lista (Te pidió / Le pediste), crear solicitud (categoría fija
    `colaboradores`, el backend la asigna a Armando), comentar, «Marcar como hecha». Se le quitó
    `/api/tickets/categorias/` (nombres de las áreas internas) y `GET …/comentarios` ya no le devuelve
    los comentarios `es_interno`.
  - **APK propia** `android-colab/` (ver su `LEEME.md`): paquete `co.mckennagroup.colaboradores`, un
    WebView de 44 KB, solo permiso de red, llave de firma propia (no versionada). El login de Google va por
    `/app/auth/google/start?app=colab` (la pantalla de ingreso lo elige por el UA `McKennaColabAndroid`) y
    vuelve por `mckennacolab://auth`. Pruebas: `tests/test_acceso_panel.py`.
  - **Descargar la APK desde el panel:** /app → Ajustes muestra dos tarjetas, «App Android del panel»
    (`/api/build-apk*`, android-twa) y «App de colaboradores externos» (`/api/build-apk-colab*`, corre
    `android-colab/compilar.sh`). Otra versión en el campo = versión nueva (sube `versionCode` en
    `android-colab/version.properties`); la misma = solo recompilar.
- **Juegos en la app de colaboradores** (23-sep-2026): pestaña «Juegos» en `ColabApp.tsx`, el mismo
  `JuegosPanel.tsx` (no importa nada del panel; el verificador del build solo admite
  `/api/juegos/partidas/` además de sus rutas). El guardia deja pasar `/api/juegos/partidas/*`.
  **Partidas por persona:** `juegos_partidas/usuario_<id>/`; la persona sale de
  `_panel_tickets_usuario()` (X-Tickets-Token), no del Bearer — con CHAT_API_TOKEN todos los admins
  caían en `comun/` y se pisaban la partida (lo que había ahí se copió a Armando, `comun/` quedó de
  archivo). Sin persona identificada → 403. Cada guardado deja la anterior en
  `respaldos/<juego>/` (últimas 20), una SRAM en blanco no pisa una con datos y «Versiones
  anteriores → Volver a esta» restaura sin borrar la actual. Tests: `tests/test_juegos.py`.
