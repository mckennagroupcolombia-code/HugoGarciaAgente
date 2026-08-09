# Recaps del Equipo

Registro corto y visual de cada tarea/sesión de trabajo con la IA sobre este repositorio: qué se implementó, quién lo hizo y qué archivos tocó. Se muestra en el panel `/app` → Sistemas → **Control de Versiones** (pestaña "Recaps del equipo"), leído por `app/tools/team_recaps.py` vía `GET /api/team-recaps`.

No reemplaza otros registros existentes, que tienen propósito distinto:

- `HISTORIAL_MODIFICACIONES.md` — bitácora larga de sesiones técnicas (motivación/lección).
- `docs/agentic/DECISIONS.md` — decisiones de metodología/arquitectura agentic.

Este archivo es para el equipo humano: recaps cortos y parseables, uno por tarea significativa.

## Cómo agregar una entrada

Protocolo completo en `docs/agentic/TEAM_WORKFLOW.md`. En resumen: **anteponer** (más reciente arriba, justo debajo de este encabezado) un bloque con esta plantilla exacta, en el mismo commit que el código:

```markdown
#### [Fecha y Hora] - [Título Corto del Cambio]
- **Autor:** [Nombre del Desarrollador Activo]
- **Tipo de Cambio:** [Nueva funcionalidad / Corrección / Mejora técnica]
- **Qué se implementó:**
  - Explicación clara y directa orientada a producto o código.
  - Impacto principal en la arquitectura o en la interfaz de la app.
- **Archivos Modificados:** (Lista breve de módulos o componentes afectados)
```

(La entrada real usa tres `#` — `### Fecha - Título`, sin corchetes. El bloque de arriba usa cuatro `#` a propósito, solo para que este ejemplo no aparezca como un recap real en el panel.)

---

### 2026-08-08 22:40 - Studio web: desplegables en el lienzo
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Mejora técnica
- **Qué se implementó:**
  - Barra sobre el lienzo con menús Capas, Zoom, Selección y Acciones (deja de ser un muro de botones en el encabezado).
  - Inspector del objeto en acordeones: posición, tipografía, caja, animación, efectos e icono. Variante Montserrat, animación y sombra pasan a `<select>`.
  - Desde Capas se salta a cualquier sección del home (Clásico o Pureza).
- **Archivos Modificados:**
  - `desktop/src/components/studio-web/StudioDesplegables.tsx` (nuevo)
  - `desktop/src/components/studio-web/WebLayoutCanvas.tsx`
  - `desktop/src/components/SitioWebPanel.tsx`

### 2026-08-08 22:15 - Web: 6 líneas comerciales con color oficial
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - Paleta oficial: Cosmética #990099, Aceites/ceras/grasas #FFA500, Alimentario #1F91DC, Industria gris #5C6570, Laboratorio #10173C, Agro #359441.
  - Home y nav del catálogo muestran esas 6 líneas; las subcategorías (Ácidos, Aceites, etc.) heredan el color de su línea en textos cortos y filetes.
- **Archivos Modificados:**
  - `PAGINA_WEB/site/website.py`, templates index/tienda, CSS
  - `desktop/src/lib/lineasCatalogo.ts` + lienzos Studio
  - `tests/test_colores_categoria_web.py`

### 2026-08-08 22:10 - Web: acentos de categoría equilibrados con la base
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Mejora técnica
- **Qué se implementó:**
  - Cada categoría del catálogo tiene un acento (textos cortos y líneas) dentro de la familia teal McKenna, mezclado con `--green` / tinta para que el home y la tienda no se vean como un circo.
  - Títulos, precios y fondos siguen en colores base. El acento solo marca punto, filete, nav activo, conteo y etiqueta de tarjeta.
- **Archivos Modificados:**
  - `PAGINA_WEB/site/website.py` (`CAT_COLORS`, `color_categoria`)
  - `PAGINA_WEB/site/static/css/main.css`, `tema-pureza.css`
  - templates tienda, home, producto, `_shop_card.html`
  - `tests/test_colores_categoria_web.py`

### 2026-08-08 22:02 - Studio web: Ctrl+Z deshacer / rehacer
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - En Studio web, Ctrl+Z deshace (Ctrl+Shift+Z / Ctrl+Y rehace). Un arrastre o un barrido de color cuenta como un solo paso.
  - Botones Deshacer / Rehacer junto a Guardar.
- **Archivos Modificados:**
  - `desktop/src/lib/studioUndo.ts`
  - `desktop/src/components/SitioWebPanel.tsx`

### 2026-08-08 21:58 - Studio web: cajas de texto ajustadas al contenido
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - Las cajas de selección de títulos y párrafos ya no se estiran a todo el ancho de la columna flex/grid; quedan ajustadas al texto (`fit-content` + `align-self: start`).
- **Archivos Modificados:**
  - `desktop/src/lib/webLayoutStudio.ts` (`estiloFitTexto`)
  - `desktop/src/components/studio-web/ClasicoLayoutCanvas.tsx`, `WebLayoutCanvas.tsx`

### 2026-08-08 21:55 - Studio web: vista previa inmediata de apariencia
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - En Studio web, colores, radio de botones, densidad y tagline se ven al instante en el iframe (postMessage), sin pulsar Guardar ni publicar el sitio.
  - Textos y lienzo se reflejan en ~0,3 s vía un borrador local (`tema_web_preview.json`) que solo aplica en localhost con `?studio_preview=1`.
- **Archivos Modificados:**
  - `app/tools/tema_web.py`, `app/routes.py` (`/api/web/tema/preview`)
  - `PAGINA_WEB/site/website.py`, `templates/base.html`, `static/js/main.js`
  - `desktop/src/components/SitioWebPanel.tsx`, `desktop/src/lib/webLayoutStudio.ts`
  - `tests/test_tema_web_preview.py`

### 2026-08-08 21:50 - Studio web: seleccionar objetos similares (tamaño y forma)
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - En el lienzo del Studio web se pueden seleccionar varios objetos a la vez (Ctrl/⌘+clic o Shift+clic).
  - Comando **Seleccionar similares** (botón en barra/inspector y atajo Ctrl+Shift+L): marca todos los nodos con la misma silueta y tamaño parecido al ancla (p. ej. todas las métricas, todos los botones CTA, todas las tarjetas feature).
  - Estilos del inspector y arrastre/escala se aplican al grupo; Escape limpia la selección.
- **Archivos Modificados:**
  - `desktop/src/lib/studioSelectSimilar.ts`, `desktop/src/lib/webLayoutStudio.ts`
  - `desktop/src/components/studio-web/WebLayoutCanvas.tsx`, `ClasicoLayoutCanvas.tsx`
  - `desktop/src/components/SitioWebPanel.tsx`

### 2026-08-08 18:40 - Fix: inventario de papel de etiquetas parecía vacío
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - El JSON de rollos seguía al día (10 referencias, última carga 5 ago). El tab «Papel y tinta» llamaba la API con CHAT_API_TOKEN (Cynthia elevada a admin) y el backend devolvía 403 porque no la reconocía; la UI mostraba «Sin rollos registrados» sin el error.
  - Ahora la sesión de tickets viaja en `X-Tickets-Token` y, si solo hay token de sistema, no se bloquea la lectura/escritura. El panel muestra el error real si falla la carga.
- **Archivos Modificados:**
  - `app/routes.py` (`_panel_tickets_usuario`, `_require_studio_visual`)
  - `desktop/src/api/client.ts`, `EtiquetasPanel.tsx`, `studioVisualAccess.ts`, `plantillasVisualesImagen.ts`
  - `tests/test_etiquetas_inventario_papel.py`

### 2026-08-03 08:32 - Fix: "hugo dale ok <código>" no disparaba desde el grupo POSTVENTA
- **Autor:** Armando García
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - El comando de aprobación de respuestas postventa (`hugo dale ok <código>`) no hacía nada al escribirse dentro del propio grupo POSTVENTA de WhatsApp — solo funcionaba desde fuera de los grupos admin (ej. un DM directo al número del negocio), porque el catch-all del bloque `es_any_grupo_admin` en `routes.py` lo interceptaba y respondía "ok" sin procesarlo antes de llegar a su manejador real.
  - Se extrajo la lógica de envío a `_manejar_hugo_dale_ok()` y se resuelve primero dentro de ese bloque, antes de cualquier otro comando de grupo admin. El caso de DM directo se mantiene como fallback más abajo, reutilizando la misma función.
  - Servicio `agente-pro` reiniciado en producción para que el fix quede activo; se avisó al grupo POSTVENTA por WhatsApp.
- **Archivos Modificados:**
  - `app/routes.py` (`_manejar_hugo_dale_ok`)
  - `tests/test_postventa_hugo_dale_ok.py` (nuevo — 2 casos de regresión)

### 2026-08-04 15:45 - Selector "¿Quién hizo esto?" en commits y recaps
- **Autor:** Armando García
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - Botón "¿Quién hizo esto?" en cada fila de commit y en cada tarjeta de recap, con menú rápido para elegir entre Cynthia / Armando García (o quitar la asignación).
  - Para commits: la asignación es un override manual aparte (`app/data/control_versiones_autores_commits.json`, `{hash: autor}`) — no reescribe git, solo etiqueta el commit en el panel (`GET /api/git/log` ahora incluye `autor_manual` por commit y `desarrolladores_conocidos`; `POST /api/git/log/autor` guarda/borra la asignación).
  - Para recaps: la asignación reescribe directamente la línea `**Autor:**` de la entrada correspondiente en `docs/team-recaps.md` (`POST /api/team-recaps/autor` con `{indice, autor}`), así el archivo sigue siendo la única fuente de verdad.
- **Archivos Modificados:**
  - `app/tools/git_history.py` (`asignar_autor_commit`, `DESARROLLADORES_CONOCIDOS`), `app/tools/team_recaps.py` (`asignar_autor_recap`, campo `indice`), `app/routes.py`, `app/data/control_versiones_autores_commits.json`
  - `desktop/src/components/ControlVersionesPanel.tsx` (`SelectorAutorBoton`), `desktop/src/hooks/useGitLog.ts`, `desktop/src/hooks/useTeamRecaps.ts`, `desktop/src/lib/gitGraphLayout.ts`

### 2026-08-04 15:30 - Rediseño del árbol de commits + filtro por autor + indicadores de auto-commit
- **Autor:** Armando García
- **Tipo de Cambio:** Mejora técnica
- **Qué se implementó:**
  - Árbol de commits rediseñado: filas HTML grandes y legibles alineadas al grafo SVG (ya no texto diminuto en foreignObject), chip de autor con color determinístico, badges de rama HEAD/origin, fechas relativas, merges marcados y auto-commits atenuados (con toggle).
  - Filtro por desarrollador en "Recaps del equipo": chips por autor (útil porque las 2 personas comparten la cuenta git; el autor real viene del `--author` de cada commit/recap).
  - Indicadores visuales de auto-commit: tarjetas con cuenta regresiva y barra de progreso hasta el cron diario de las 23:00 (`auto_commit.sh`) y el backup nocturno de las 02:00 (`backup_drive.py`), más el conteo de archivos sin commitear que entrarían en el próximo auto-commit (`estado_auto_commit()` en el backend, expuesto dentro de `GET /api/git/log`).
- **Archivos Modificados:**
  - `app/tools/git_history.py` (nuevo `estado_auto_commit()`)
  - `desktop/src/components/ControlVersionesPanel.tsx`, `desktop/src/hooks/useGitLog.ts`, `docs/team-recaps.md`

### 2026-08-04 16:00 - Metodología de recaps + panel visual de Control de Versiones
- **Autor:** Armando García
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - Protocolo obligatorio de autoría de commits (`--author`), sincronización `git pull`/`git fetch` y recap estructurado al final de cada tarea (`docs/agentic/TEAM_WORKFLOW.md`).
  - Este archivo `docs/team-recaps.md` como registro versionado, parseado por el backend para exponerlo en la UI.
  - Endpoints de solo lectura `GET /api/git/log` (historial de commits, todas las ramas, formato apto para grafo) y `GET /api/team-recaps` (recaps parseados).
  - Panel nuevo **Control de Versiones** dentro del hub Sistemas (`/app`, modo avanzado): pestaña "Árbol de commits" con un grafo de nodos tipo cladograma dibujado a mano en SVG (sin librerías externas), y pestaña "Recaps del equipo" con tarjetas de cada entrada de este archivo.
- **Archivos Modificados:**
  - `docs/agentic/TEAM_WORKFLOW.md`, `docs/agentic/CHECKLIST.md`, `docs/agentic/INDEX.md`, `docs/agentic/CONTRACTS.md`, `docs/agentic/DECISIONS.md`, `CLAUDE.md`, `docs/team-recaps.md`
  - `app/tools/git_history.py`, `app/tools/team_recaps.py`, `app/routes.py`
  - `desktop/src/components/ControlVersionesPanel.tsx`, `desktop/src/lib/gitGraphLayout.ts`, `desktop/src/hooks/useGitLog.ts`, `desktop/src/hooks/useTeamRecaps.ts`, `desktop/src/stores/app.ts`, `desktop/src/lib/panelInfo.ts`, `desktop/src/lib/navStructure.ts`, `desktop/src/icons/mck/paths/panels.tsx`, `desktop/src/App.tsx`
