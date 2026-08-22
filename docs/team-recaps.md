# Recaps del Equipo

Registro corto y visual de cada tarea/sesión de trabajo con la IA sobre este repositorio: qué se implementó, quién lo hizo y qué archivos tocó. Se muestra en el panel `/app` → Sistemas → **Control de Versiones**, sección "Cambios recientes" (arriba, antes del árbol de commits), leído por `app/tools/team_recaps.py` vía `GET /api/team-recaps`.

No reemplaza otros registros existentes, que tienen propósito distinto:

- `HISTORIAL_MODIFICACIONES.md` — bitácora larga de sesiones técnicas (motivación/lección).
- `docs/agentic/DECISIONS.md` — decisiones de metodología/arquitectura agentic.

Este archivo es para el equipo humano: recaps cortos y parseables, uno por tarea significativa.

### 2026-08-21 15:40 - Cuenta de cobro en pesos con TRM del día
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - La cuenta de cobro de compras en el exterior se liquida en pesos (COP) con la TRM BanRep del día de la compra.
  - Si una factura en dólares quedaba marcada como COP (montos tipo $532), el sistema la convierte con la tasa de ese día antes de mostrar y de generar el PDF.
- **Archivos Modificados:** `cuenta_cobro_cuota_manejo.py`, `contabilidad_db.py`, `compra_exterior_ocr.py`, `routes.py`, `CuentaCobroAprobacion.tsx`, `ComprasExteriorPanel.tsx`, tests

### 2026-08-21 13:40 - Escáner FT/COA: varias imágenes a la vez
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Mejora
- **Qué se implementó:**
  - Adjuntar hasta 8 imágenes/PDF en un solo escaneo (ficha técnica y COA).
  - El backend envía todas a Gemini en una llamada y fusiona campos/parámetros.
  - UI: `multiple` en el file picker, drop y pegado de varias fotos; miniaturas en FT.
- **Archivos Modificados:** `app/routes.py`, `FichasTecnicasPanel.tsx`, `CoaDocumentosScanner.tsx`

### 2026-08-21 13:25 - Escáner ficha/COA: error JSON.parse (HTML del proxy)
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - Al adjuntar imagen/PDF en ficha técnica o escáner COA, si el proxy devolvía HTML (502/timeout) el panel mostraba `JSON.parse: unexpected character…`.
  - Ahora usa `api.upload` con reintento `/api` ↔ `/app/api` y un mensaje claro si la respuesta no es JSON.
- **Archivos Modificados:** `desktop/src/api/client.ts`, `FichasTecnicasPanel.tsx`, `CoaDocumentosScanner.tsx`

### 2026-08-21 13:10 - Fichas técnicas: logo completo del color del formato
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - El encabezado de FT/COA/SDS ya no recorta el logo: se pinta con el tamaño real de la imagen.
  - Si no hay cabezote elegido, usa el logo que corresponde al color del formato (azul, morado, gris, amarillo, café).
  - Al elegir el color en el formulario se selecciona ese logo. Los PDF de la tienda también lo incluyen.
- **Archivos Modificados:** `app/services/ficha_tecnica.py`, `app/services/documentos_web.py`, plantillas PDF, `FichasTecnicasPanel.tsx`, `tests/test_ficha_cabezote_logo.py`

### 2026-08-21 13:00 - Docs web: solo documentos completos
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - «Cargar en página web» y el índice de la tienda ya no publican fichas a medias: hace falta FT + COA + SDS diligenciados y el PDF en biblioteca.
  - El botón informa cuántos se omitieron por incompletos.
- **Archivos Modificados:** `app/services/documentos_web.py`, `CargarDocumentosWebButton.tsx`, `FichasTecnicasPanel.tsx`, `tests/test_documentos_web.py`

### 2026-08-21 12:50 - Docs COA: cargar documentos en la página web
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - En Documentos técnicos → Biblioteca (escáner COA) hay un botón **Cargar en página web** que publica fichas nuevas o cambios (FT, COA, SDS) en las páginas de producto de mckennagroup.co, sin esperar el caché de 60 s.
  - El mismo botón aparece al generar un PDF completo. Generar o borrar un documento ya marca el índice como desactualizado.
- **Archivos Modificados:**
  - `app/services/documentos_web.py`, `app/routes.py`, `PAGINA_WEB/site/website.py`
  - `desktop/src/components/documentos/CargarDocumentosWebButton.tsx`, `FichasTecnicasPanel.tsx`
  - `tests/test_documentos_web.py`

### 2026-08-21 12:30 - Publicaciones: eliminar fotos de web y MeLi
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - En Publicaciones → Catálogo → Sitios, la papelera y "Eliminar N" ya quitan la foto: antes la orden no aplicaba (MeLi caía por un error interno, y en web la petición se quedaba esperando el refresco de la tienda).
  - La foto desaparece al confirmar; si Mercado Libre o la web rechazan el borrado, vuelve a aparecer con el error.
- **Archivos Modificados:** `app/services/publicaciones.py`, `app/routes.py`, `desktop/src/hooks/usePublicaciones.ts`, `desktop/src/components/PublicacionesPanel.tsx`, `tests/test_publicaciones_sitios.py`

### 2026-08-20 22:43 - Control de Versiones: Cambios recientes arriba, sin pestañas
- **Autor:** Claude Code
- **Tipo de Cambio:** Mejora técnica
- **Qué se implementó:**
  - El panel dejó de separar "Árbol de commits" y "Recaps del equipo" en pestañas: ahora es una sola página, con **Cambios recientes** arriba (lo primero que se ve al abrir el panel) y el árbol de commits debajo, para quien quiera el detalle técnico.
  - Se reforzó `docs/agentic/TEAM_WORKFLOW.md`: el recap en `docs/team-recaps.md` deja de ser opcional para "tareas pequeñas" — toda sesión de IA (Claude Code, Cursor u otra) que cambie código en este repo agrega su entrada antes de terminar.
- **Archivos Modificados:** `desktop/src/components/ControlVersionesPanel.tsx`, `docs/agentic/TEAM_WORKFLOW.md`, `docs/team-recaps.md`

### 2026-08-20 22:35 - Inicio: ruta de origen en vivo, actividad real y banners promo
- **Autor:** Claude Code
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - Nueva sección "Ruta de tu materia prima": mapa animado (SVG propio, sin librerías) que conecta el país de origen de cada línea comercial/SKU con Colombia y la bodega McKenna; al hacer clic en un país se ven las materias primas reales que llegan de ahí.
  - Tira "En este momento": pedidos despachados hoy, despachos y ciudades de la semana, consultas atendidas — datos reales de `orders.db` y `metricas_diarias.json` (nunca simulados), se refresca sola cada 60s sin recargar la página. En el tema Clásico reemplaza la caja "Por qué elegirnos" del hero por esta misma información en vivo.
  - Carrusel de banners de promociones de la semana, con vigencia por fecha: uno vencido se oculta solo, sin que el operador tenga que recordarlo.
  - Todo se administra desde el panel: nueva pestaña **Vitrina Web** (dentro de Publicaciones) para crear/editar banners y asignar país de origen por línea comercial o por SKU puntual.
  - Aplica a ambos temas del sitio público (Clásico y Pureza). `tema_activo` sigue en `"clasico"` — no se cambió sin confirmarlo antes.
- **Archivos Modificados:**
  - `app/tools/origen_materias.py`, `app/tools/banners_web.py`, `app/tools/_json_store.py`, `app/tools/tema_web.py`, `app/routes.py`, `PAGINA_WEB/site/website.py`
  - `PAGINA_WEB/site/templates/_actividad_vivo.html`, `_ruta_origen.html`, `_banners_promo.html`, `index.html`, `index_pureza.html`, `base.html`, `static/css/main.css`, `static/js/main.js`
  - `desktop/src/components/VitrinaWebPanel.tsx`, `hooks/useVitrinaWeb.ts`, registro del panel en `stores/app.ts`, `icons/mck/paths/panels.tsx`, `lib/panelInfo.ts`, `lib/navStructure.ts`, `App.tsx`, `lib/panelAccess.ts`
  - `tests/test_origen_materias.py`, `tests/test_banners_web.py`

### 2026-08-20 22:45 - Gadget dólar: TRM BanRep + TradingView (fix HTTP 500)
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - El gadget de Inicio dejaba de cargar (HTTP 500) porque se quitó Yahoo a medias (`YAHOO_CHART_URLS` / `timezone`) y el backend seguía llamando código muerto.
  - La cifra grande es la TRM BanRep de hoy (America/Bogota). El gráfico pasa a widgets oficiales TradingView (`FX_IDC:USDCOP`).
- **Archivos Modificados:**
  - `app/services/trm.py`, `app/routes.py`, `tests/test_trm.py`
  - `desktop/src/components/DolarHoraGadget.tsx`, `useDolarHora.ts`
  - `docs/agentic/CONTRACTS.md`, `modules/desktop-panel.md`

### 2026-08-19 17:40 - Catálogo: gestionar MeLi y web y cómo se muestran
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - En Publicaciones → Catálogo, al abrir un producto la pestaña Sitios muestra lado a lado la ficha de mckennagroup.co (familia, línea, presentaciones) y la publicación de Mercado Libre (título, estado, precio).
  - Tabla de relación: cada presentación (60 mL, 250 mL, etc.) vs su listing MeLi. Se puede pausar/activar MeLi y ocultar en la tienda.
  - Filtros del listado: Web+MeLi, sin MeLi, no visible en web, incompletos, ocultos. Enlaces ↗ Web y ↗ MeLi en cada tarjeta.
- **Archivos Modificados:**
  - `app/services/publicaciones.py`, `app/routes.py`, `desktop/src/components/PublicacionesPanel.tsx`, `desktop/src/hooks/usePublicaciones.ts`, `tests/test_publicaciones_sitios.py`

### 2026-08-19 17:40 - Se quitó el Studio web
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Mejora técnica
- **Qué se implementó:**
  - El panel de operaciones ya no tiene la pestaña Studio web (lienzo de mckennagroup.co).
  - El sitio público sigue con el tema publicado en `tema_web.json`; no hay editor ni APIs de preview/publicar desde `/app`.
  - Quien tenía Studio web abierto pasa a Diseño → Etiquetas. Studio visual de etiquetas no se tocó.
- **Archivos Modificados:**
  - `desktop/src/components/SitioWebPanel.tsx` (eliminado), `desktop/src/components/studio-web/` (eliminado), `desktop/src/App.tsx`, `Layout.tsx`, `DisenoNavTabs.tsx`, `app/routes.py`, `app/tools/tema_web.py`, `PAGINA_WEB/site/website.py`

### 2026-08-19 17:20 - Sitio: solo productos publicados en MeLi
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - La tienda deja de mostrar combos SIIGO que no tengan publicación en MercadoLibre (activa o pausada).
  - En una familia, solo quedan las presentaciones que sí están en MeLi; el resto no aparece ni por URL.
- **Archivos Modificados:**
  - `PAGINA_WEB/site/website.py`, `tests/test_presentaciones_web.py`, `tests/test_colores_categoria_web.py`

### 2026-08-19 16:40 - Sitio: galería completa de fotos MeLi
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - La ficha de producto en la tienda muestra **todas** las fotos de la publicación MeLi (no solo la primera), con flechas, puntos y miniaturas.
  - Al cambiar de presentación en una familia, la galería pasa a las fotos de ese SKU.
  - El cache del catálogo se enriquece desde MeLi sin reconstruir SIIGO; override del panel (`imagenes_web`) sigue ganando si existe.
- **Archivos Modificados:**
  - `PAGINA_WEB/site/website.py`, `PAGINA_WEB/site/templates/_prod_gallery.html`, `PAGINA_WEB/site/templates/producto.html`, `PAGINA_WEB/site/templates/base.html`, `PAGINA_WEB/site/static/css/main.css`, `tests/test_presentaciones_web.py`

### 2026-08-18 23:21 - Sitio: barra de anuncio solo bienvenida y horario
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - La franja superior quedó en «Bienvenidos · Horario de atención Lun–Vie 8:00–17:30», sin el texto de materias primas ni Bogotá.
- **Archivos Modificados:**
  - `app/tools/tema_web.py`, `PAGINA_WEB/site/data/tema_web.json`, `PAGINA_WEB/site/templates/base.html`, `desktop/src/components/SitioWebPanel.tsx`, `desktop/src/components/studio-web/ClasicoLayoutCanvas.tsx`

### 2026-08-18 23:17 - Catálogo: acento de título y líneas por categoría
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - El título de cada sección, el divisor y el borde de las tarjetas usan el color de esa línea (p. ej. naranja en Aceites esenciales), no el verde genérico.
- **Archivos Modificados:**
  - `PAGINA_WEB/site/static/css/main.css`, `PAGINA_WEB/site/templates/tienda.html`, `PAGINA_WEB/site/templates/base.html`

### 2026-08-18 22:56 - Catálogo: árbol de té agrupado
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - 5 mL y 30 mL de árbol de té quedan en una sola ficha (SIIGO los nombraba distinto: «ARBOL DE TE» vs «ARBOL TE»).
- **Archivos Modificados:**
  - `PAGINA_WEB/site/website.py`, `tests/test_presentaciones_web.py`

### 2026-08-18 22:26 - Sitio: título y Agregar con acento de categoría
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - En cada tarjeta, el nombre del producto y el botón Agregar usan el color de acento de su categoría, en semi bold.
- **Archivos Modificados:**
  - `PAGINA_WEB/site/templates/_shop_card.html`, `PAGINA_WEB/site/static/css/main.css`

### 2026-08-18 22:12 - Inicio: sin banner de cotización
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - Se quitó del inicio la sección «¿Necesitas una cotización?» (WhatsApp + formulario).
- **Archivos Modificados:**
  - `app/tools/tema_web.py`, `PAGINA_WEB/site/data/tema_web.json`

### 2026-08-18 22:07 - Sitio: etiqueta de categoría solo trazo
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - La caja de categoría queda sin fondo: borde y texto en el acento de la línea.
- **Archivos Modificados:**
  - `PAGINA_WEB/site/static/css/main.css`

### 2026-08-18 22:02 - Sitio: etiqueta de categoría con acento
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - La caja de categoría en la tarjeta (p. ej. «Aceites esenciales») usa el color de acento de esa línea, no el verde genérico.
- **Archivos Modificados:**
  - `PAGINA_WEB/site/static/css/main.css`

### 2026-08-18 21:58 - Sitio: títulos de Aceites con acento de categoría
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - Los nombres de productos de Aceites y Aceites esenciales usan el color de acento de esa línea (naranja).
- **Archivos Modificados:**
  - `PAGINA_WEB/site/templates/_shop_card.html`, `PAGINA_WEB/site/static/css/main.css`

### 2026-08-18 21:38 - Inicio: estética del carrusel destacados
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - Cabecera en una sola banda: título + texto a la izquierda, «Ver catálogo» y flechas redondas a la derecha.
  - Tarjetas más compactas (sin hueco interno) y se asoma el siguiente producto, para que se lea como carrusel.
- **Archivos Modificados:**
  - `PAGINA_WEB/site/templates/index.html`, `PAGINA_WEB/site/static/css/main.css`

### 2026-08-18 21:30 - Inicio: destacados en carrusel
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - «Selección Destacada» pasa a carrusel (4 productos a la vista, flechas para ver más).
  - Título a la izquierda; texto, «Ver todos» y flechas a la derecha, para ocupar el hueco en blanco.
- **Archivos Modificados:**
  - `PAGINA_WEB/site/templates/index.html`, `PAGINA_WEB/site/static/css/main.css`, `PAGINA_WEB/site/static/js/main.js`, `PAGINA_WEB/site/website.py`, Studio `ClasicoLayoutCanvas.tsx`

### 2026-08-18 21:08 - Inicio: portafolio sin hueco en blanco
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - En «Explora por Categoría» el título queda a la izquierda y el texto + botón de catálogo a la derecha.
  - Las 6 tarjetas son filas (icono, nombre, cantidad) y ocupan el ancho, sin el vacío de antes.
- **Archivos Modificados:**
  - `PAGINA_WEB/site/templates/index.html`, `PAGINA_WEB/site/static/css/main.css`, Studio `ClasicoLayoutCanvas.tsx`

### 2026-08-18 17:06 - Sitio: retícula de márgenes
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - Header, inicio, catálogo y pie comparten el mismo margen (`--page-gutter` / `--page-inline`).
  - El logo queda alineado con «Materias primas…»; los iconos de la derecha con la caja «Por qué elegirnos».
- **Archivos Modificados:**
  - `PAGINA_WEB/site/static/css/main.css`, `PAGINA_WEB/site/templates/base.html`, Studio `ClasicoLayoutCanvas.tsx`

### 2026-08-18 16:54 - Inicio: silueta un poco más grande
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - La ilustración del centro pasa de 115% a 130% para ocupar más del espacio vacío.
- **Archivos Modificados:**
  - `PAGINA_WEB/site/static/css/main.css`, `PAGINA_WEB/site/templates/base.html`

### 2026-08-18 16:51 - Inicio: «para tu industria» en un renglón
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - La tercera línea del título («para tu industria») ya no se parte en dos.
- **Archivos Modificados:**
  - `PAGINA_WEB/site/templates/index.html`, `PAGINA_WEB/site/static/css/main.css`, Studio `ClasicoLayoutCanvas.tsx`

### 2026-08-18 16:45 - Inicio: silueta 15% más grande
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - La ilustración del centro del inicio queda un 15% más grande y centrada, para ocupar el espacio en blanco.
- **Archivos Modificados:**
  - `PAGINA_WEB/site/static/css/main.css`, `PAGINA_WEB/site/templates/base.html`

### 2026-08-18 16:44 - Inicio: CTAs del mismo ancho
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - «Comprar ahora» y «Pedir cotización» quedan con el mismo ancho (el del texto más largo).
- **Archivos Modificados:**
  - `PAGINA_WEB/site/static/css/main.css`, `PAGINA_WEB/site/templates/base.html`, Studio `ClasicoLayoutCanvas.tsx`

### 2026-08-18 16:40 - Inicio: botones CTA iguales
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - «Comprar ahora» y «Pedir cotización» quedan con el mismo estilo sólido (fondo verde, texto blanco).
- **Archivos Modificados:**
  - `PAGINA_WEB/site/templates/index.html`, Studio `ClasicoLayoutCanvas.tsx`

### 2026-08-18 16:33 - Sitio: silueta alineada con el título
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - La ilustración de la científica sube al mismo alto que el texto de la izquierda (ya no queda pegada abajo).
- **Archivos Modificados:**
  - `PAGINA_WEB/site/static/css/main.css`

### 2026-08-18 16:30 - Sitio: silueta al centro del hero
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - La ilustración de la científica quedó en el espacio en blanco del medio; la caja «Por qué elegirnos» sigue a la derecha.
- **Archivos Modificados:**
  - `PAGINA_WEB/site/templates/index.html`, `PAGINA_WEB/site/static/css/main.css`

### 2026-08-18 16:22 - Etiquetas circulares: ya no saltan 2 en blanco
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - La Epson recibía 53 mm (troquel 50 + gap) y avanzaba dos etiquetas vacías por cada una impresa. Ahora el PDF y CUPS usan 50×50 mm (`Custom.50x50mm`).
  - El título en arco queda 3,5 mm dentro del círculo, sin empujarlo hacia el gap.
- **Archivos Modificados:**
  - `app/tools/etiquetas_studio.py`, `app/routes.py`, `app/tools/etiquetas_ai_engine.py`, `desktop/src/components/EtiquetasPanel.tsx`

### 2026-08-18 16:20 - Sitio: caja «Por qué elegirnos» a la derecha, solo trazo
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - «Por qué elegirnos» volvió al panel derecho, como recuadro de esquinas redondeadas, línea de trazo y sin fondo.
- **Archivos Modificados:**
  - `PAGINA_WEB/site/templates/index.html`, `PAGINA_WEB/site/static/css/main.css`

### 2026-08-18 16:16 - Sitio: vuelve la caja «Por qué elegirnos»
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - La caja «Por qué elegirnos» volvió al inicio: debajo de los botones, a la izquierda; la ilustración sigue llenando el panel derecho.
- **Archivos Modificados:**
  - `PAGINA_WEB/site/templates/index.html`, `PAGINA_WEB/site/static/css/main.css`

### 2026-08-18 16:05 - Sitio: hero usa toda la altura
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - El bloque de inicio reparte título arriba y botones abajo; la ilustración llena el panel derecho a toda altura (ya no queda un hueco blanco).
  - Si hay foto, no se muestra la lista «Por qué elegirnos» encima del dibujo.
- **Archivos Modificados:**
  - `PAGINA_WEB/site/templates/index.html`, `PAGINA_WEB/site/static/css/main.css`, Studio `ClasicoLayoutCanvas.tsx`

### 2026-08-18 15:55 - Sitio: header solo iconos WA / cuenta / carrito
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - WhatsApp, iniciar sesión y carrito quedan como iconos simples, sin texto ni botón relleno.
  - El menú móvil y el pie conservan el texto de cuenta / WhatsApp.
- **Archivos Modificados:**
  - `PAGINA_WEB/site/templates/base.html`, `PAGINA_WEB/site/static/css/main.css`, Studio `ClasicoLayoutCanvas.tsx`

### 2026-08-18 15:50 - Contabilidad: créditos adquiridos
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - Nueva pestaña en Contabilidad para préstamos, leasing y créditos de proveedores.
  - Calcula cuota con tasa anual (EA o N.A.M.V.), plazo, sistema francés/alemán/solo interés y seguro por cuota.
  - Permite registrar pagos (reparte capital e intereses) y ver la tabla de amortización. Las cuotas entran al libro de Ingresos / Egresos.
- **Archivos Modificados:**
  - `app/services/creditos_adquiridos.py`, `app/routes.py`, `app/services/contabilidad_ledger.py`
  - `CreditosAdquiridosPanel.tsx`, `contabilidadAccess.ts`, permisos en Ajustes / usuarios

### 2026-08-18 15:42 - Sitio: tipografía Regular, sin bold ni cursiva
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - Todo el sitio público usa Montserrat Regular (400). Se desactivaron bold, semibold y cursiva (títulos, botones, `<em>`).
  - Los iconos Phosphor no se tocan.
- **Archivos Modificados:**
  - `PAGINA_WEB/site/templates/base.html`, `PAGINA_WEB/site/static/css/main.css`

### 2026-08-18 15:35 - Sitio: sin números decorativos 01 / 02 / 03
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - Se quitaron los números gigantes de sección (01, 02, 03, 00, ★) en inicio, tienda, guías, nosotros, contacto y fichas de guía.
  - Los títulos de cada bloque quedan alineados a la izquierda, sin la columna vacía.
- **Archivos Modificados:**
  - `PAGINA_WEB/site/static/css/main.css`, templates index/tienda/guias/nosotros/contacto/guia_detalle/catalogo_pdf

### 2026-08-18 15:15 - Inicio: sin recuadro «certificadas · Colombia»
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - Se quitó del hero de inicio el recuadro «Materias primas certificadas · Colombia».
  - El nodo queda oculto por defecto; el título y los botones del hero siguen igual.
- **Archivos Modificados:**
  - `app/tools/tema_web.py`, `PAGINA_WEB/site/templates/index.html`

### 2026-08-18 14:45 - Competencia MeLi a ojo en el navegador
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - En Publicaciones → Competencia cada más vendido tiene un botón que abre el listado de MeLi en el navegador del operador (no scraping).
  - Se puede anotar el precio visto (vendedor y link opcionales). El veredicto “a revisar / más baratos” sale de esas anotaciones, no de la API ajena.
- **Archivos Modificados:**
  - `app/tools/analisis_competencia_precios.py`, `app/routes.py`
  - `CompetenciaPreciosPanel.tsx`, `useCompetenciaPrecios.ts`

### 2026-08-18 14:20 - Sitio web: lienzo blanco tipo catálogo B2B
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Mejora técnica
- **Qué se implementó:**
  - La página pública deja el fondo cian/teal y usa lienzo blanco (referencia Sigma-Aldrich): color solo en botones, enlaces y acento de línea comercial.
  - Hero, categorías, cabeceras de tienda/blog y CTAs pasan a fondo blanco con texto oscuro. El footer sigue oscuro.
  - `--white` ya no copia el token de fondo; el cian legado `#e3fcff` se migra a blanco.
- **Archivos Modificados:**
  - `app/tools/tema_web.py`, `PAGINA_WEB/site/static/css/main.css`, `templates/base.html` + home/tienda/guías
  - `desktop/src/lib/webLayoutStudio.ts`, `ClasicoLayoutCanvas.tsx`, `SitioWebPanel.tsx`
  - `tests/test_tema_web_colores.py`, `tests/test_hero_clasico_css.py`

### 2026-08-18 13:20 - Gadget dólar hora USD/COP en Inicio
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - En Inicio (Agenda y Métricas) aparece un gadget con el precio del dólar en COP, actualización horaria y mini gráfico.
  - Al hacer clic se abre el gráfico grande (hora o TRM diaria). Si el mercado no responde, usa la TRM BanRep.
- **Archivos Modificados:**
  - `app/services/trm.py`, `app/routes.py`, `tests/test_trm.py`
  - `desktop/src/components/DolarHoraGadget.tsx`, `useDolarHora.ts`, `Dashboard.tsx`, `TicketsPanel.tsx`


### 2026-08-18 13:15 - Competencia MeLi: sin scraping ni search ajena
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - Se dejó de llamar a la búsqueda de marketplace y a ítems de otros vendedores (MeLi responde 403 y penaliza recolección).
  - La pestaña Competencia solo lista nuestros más vendidos y el precio McKenna. El cron ya no manda WhatsApp de “competencia”.
- **Archivos Modificados:**
  - `app/tools/analisis_competencia_precios.py`, `scripts/analisis_competencia_precios_cron.py`
  - `CompetenciaPreciosPanel.tsx`, `docs/agentic/modules/competencia-precios.md`

### 2026-08-18 12:45 - Fichas técnicas completas en la página de producto
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - La sección Documentación técnica / Ficha Técnica de cada producto carga el documento completo de la biblioteca (FT + COA + SDS) cuando ya existe el PDF `FT COA SDS …`.
  - Se muestra con la estética de protocolo de calidad del PDF (bordes, encabezado, tablas) y enlace para descargar el original.
- **Archivos Modificados:**
  - `app/services/documentos_web.py`, `app/services/ficha_tecnica.py`, `PAGINA_WEB/site/website.py`
  - `PAGINA_WEB/site/templates/producto.html`, `_documento_tecnico.html`, `main.css`
  - `tests/test_documentos_web.py`


### 2026-08-18 12:20 - Agente de competencia de precios MeLi
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - Agente que toma los más vendidos de McKenna en Mercado Libre y busca publicaciones de otros vendedores cuyo título se relaciona con el nuestro.
  - Compara precio (y precio por 100 g/ml si hay presentación). Visible en Publicaciones → Competencia, en el chat de Hugo (`analizar_competencia_precios`) y en cron semanal con alerta WhatsApp solo si estamos más caros.
- **Archivos Modificados:**
  - `app/tools/analisis_competencia_precios.py`, `app/core.py`, `app/routes.py`, `app/services/cron_scheduler.py`
  - `CompetenciaPreciosPanel.tsx`, `PublicacionesPanel.tsx`, `useCompetenciaPrecios.ts`
  - `scripts/analisis_competencia_precios_cron.py`, `tests/test_analisis_competencia_precios.py`

### 2026-08-18 11:50 - Salud del negocio: JSON en /app/api y etiqueta Diario
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - El panel ya no muestra "el servidor devolvió HTML" al calcular Salud del negocio: `/app/api/salud-negocio/resumen` existe y el catch-all del SPA no sirve `index.html` en `/app/api/*`.
  - En vista diaria el selector dice "Últimas 90 días" (antes decía "meses").
- **Archivos Modificados:**
  - `app/routes.py`, `SaludNegocioPanel.tsx`, `tests/test_smoke.py`
  - `docs/agentic/modules/desktop-panel.md`, `docs/agentic/CONTRACTS.md`

### 2026-08-16 19:20 - Postventa: estadísticas de reclamos, tiempos y solicitudes
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - El panel de Postventa MeLi muestra motivos de reclamo, tiempos de respuesta (mediana y tramos SLA) y las solicitudes más frecuentes (factura, envío, ficha, daño, etc.).
  - Cada mensaje de la cola queda etiquetado (tipo + minutos de espera). Los datos se guardan al llegar, responder u omitir, y al abrir un reclamo MeLi.
- **Archivos Modificados:**
  - `app/services/postventa_stats.py`, `app/routes.py`, `app/meli_postventa_notif.py`, `app/meli_reclamos.py`
  - `PostventaPanel.tsx`, `PostventaEstadisticas.tsx`, `usePostventa.ts`
  - `tests/test_postventa_stats.py`, `docs/agentic/CONTRACTS.md`

### 2026-08-16 19:15 - Preventa MeLi: porcentaje de compra
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - El panel de Preventa ahora muestra qué porcentaje de quienes preguntaron en Mercado Libre terminaron comprando ese producto (y cuántos compraron cualquier cosa en la tienda).
  - Separa conversión con respuesta vs. sin respuesta, y un ranking por producto. Las preguntas de las últimas 48 h no entran al % (aún no han tenido tiempo de comprar).
- **Archivos Modificados:**
  - `app/services/preventa_metricas.py`, `app/routes.py`, `tests/test_preventa_metricas.py`
  - `PreventaPanel.tsx`, `usePreventa.ts`, `docs/agentic/CONTRACTS.md`

### 2026-08-10 13:15 - Studio web: lienzo Clásico igual a la home real
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - La ilustración de la científica del hero (`hero.foto_izq`) se pinta en el lienzo como en el sitio: `<img>` con translate/scale, sin recorte ni fondo CSS duplicado.
  - Antes el canvas la aplastaba y la repetía como background; por eso Hoja 1 se veía distinta a la home publicada.
- **Archivos Modificados:**
  - `ClasicoLayoutCanvas.tsx`, `WebLayoutCanvas.tsx`

### 2026-08-10 12:45 - Studio web: PNG sin doble pegue
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - Al adjuntar un PNG al hero ya no se ve duplicado: el fondo del panel y la foto flotante dejaron de pintar la misma imagen.
  - Soltar/pegar en el panel actualiza solo el fondo; el `<img>` del sitio no reutiliza `FONDOS.hero_*`.
- **Archivos Modificados:**
  - `ClasicoLayoutCanvas.tsx`, `index.html`, `tests/test_tema_web_fondos.py`

### 2026-08-10 12:20 - Sitio: header centrado sin cortar login
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - El menú del header ya no empuja «Iniciar sesión» ni el buscador fuera de la pantalla (el body tenía overflow-x hidden).
  - Barra centrada a 1280px; a ≤1200 se ocultan buscar/WhatsApp; a ≤1100 pasa a menú hamburguesa.
- **Archivos Modificados:**
  - `PAGINA_WEB/site/static/css/main.css`, `base.html`
  - `ClasicoLayoutCanvas.tsx`, `tests/test_tema_web_header.py`

### 2026-08-10 12:40 - Studio web: lienzo = sitio publicado (hero)
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Bugfix
- **Qué se implementó:**
  - El chip «Adjuntar imagen» y el asa del split ya no tapan el hero: solo se ven al pasar el mouse (no existen en el sitio público).
  - Se quitó un `translate(-271px, 65px)` accidental en «Pedir cotización» que desplazaba el botón en la publicación.
  - El lienzo recorta el hero como la web (`overflow:hidden`) y la itálica del título usa el acento claro del tema.
- **Archivos Modificados:**
  - `ClasicoLayoutCanvas.tsx`, `tema_web.json`, `tema_web_preview.json`

### 2026-08-10 12:15 - Studio web: herramientas como Studio Visual
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Mejora técnica
- **Qué se implementó:**
  - Se quitó el botón Temas del cabezote en Studio web y la pestaña Tema.
  - Rail izquierdo (Lienzo / Tokens / Textos) + lienzo siempre al centro + panel derecho estrecho y redimensionable (188–340 px), al estilo Studio Visual.
- **Archivos Modificados:**
  - `SitioWebPanel.tsx`, `Layout.tsx`, `WebLayoutCanvas.tsx`, `panelInfo.ts`
  - `tests/test_studio_web_toolbar_actions.py`

### 2026-08-10 11:40 - Studio web: lienzo centrado por defecto
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Mejora técnica
- **Qué se implementó:**
  - El capítulo del lienzo se centra en el área de trabajo (pasteboard). Al abrir o cambiar zoom, la primera hoja queda en el centro del viewport.
- **Archivos Modificados:**
  - `HojasCapitulo.tsx`, `ClasicoLayoutCanvas.tsx`, `WebLayoutCanvas.tsx`

### 2026-08-10 11:30 - Studio web: sin botón Pureza
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Mejora técnica
- **Qué se implementó:**
  - Se quitó el switch Clásico/Pureza del encabezado, de la vista previa y de Publicar. El Studio edita solo Clásico.
- **Archivos Modificados:**
  - `SitioWebPanel.tsx`

### 2026-08-10 11:20 - Studio web: pestañas al lado del título
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Mejora técnica
- **Qué se implementó:**
  - Lienzo/Tokens/Clásico/Pureza y Guardar/Publicar van en la fila del título (espacio que estaba vacío).
  - Hojas, zoom y Selección quedan en la segunda fila, como las pestañas de Contabilidad.
- **Archivos Modificados:**
  - `Layout.tsx`, `SitioWebPanel.tsx`

### 2026-08-10 11:15 - Studio web: encabezado como Contabilidad
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Mejora técnica
- **Qué se implementó:**
  - Primera fila: solo título «Studio web» + temas/modo (igual que Contabilidad).
  - Segunda fila (`mck-submenu`): Lienzo/Tokens/Contenido/Tema, Clásico/Pureza, zoom y Guardar/Publicar.
- **Archivos Modificados:**
  - `Layout.tsx`, `SitioWebPanel.tsx`, `tests/test_studio_web_toolbar_actions.py`

### 2026-08-10 10:30 - Studio web: barra más compacta (10 pt)
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Mejora técnica
- **Qué se implementó:**
  - Botones de Lienzo/Tokens, Clásico/Pureza, Hojas, Zoom, Guardar y Publicar a texto 10 pt con menos padding.
- **Archivos Modificados:**
  - `SitioWebPanel.tsx`, `StudioDesplegables.tsx`, `Layout.tsx`

### 2026-08-09 18:35 - Studio web: una sola barra de título y acciones
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Mejora técnica
- **Qué se implementó:**
  - El título Studio web quedó en la misma fila que Lienzo/Tokens, el switch Clásico/Pureza, zoom y Guardar/Publicar.
  - Se quitaron el subtítulo, la franja «editando tema publicado», «Capítulo Clásico» y el segundo par Guardar/Publicado.
  - El punto verde marca el tema que está en el sitio; «Borrador» solo aparece si se edita el otro.
- **Archivos Modificados:**
  - `desktop/src/components/SitioWebPanel.tsx`, `Layout.tsx`, `studio-web/StudioDesplegables.tsx`
  - `tests/test_studio_web_toolbar_actions.py`

### 2026-08-09 18:25 - Studio web: lienzo Clásico = página publicada
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - El menú del header ya no se parte ni se recorta: logo a la izquierda, todos los enlaces a la derecha junto al buscador (mismo flex que el sitio).
  - El hero del lienzo deja de meter cajas grises «Adjuntar imagen» que empujaban el copy; el adjunto queda como chip y el título en itálica coincide con la web.
- **Archivos Modificados:**
  - `PAGINA_WEB/site/static/css/main.css`, `base.html`
  - `ClasicoLayoutCanvas.tsx`, `tests/test_tema_web_header.py`

### 2026-08-09 18:25 - Studio web: permiso para adjuntar fotos
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - El adjuntar imagen fallaba con `Permission denied`: la carpeta `static/uploads/fondos` era de otro usuario y el servicio corre como `mckg`.
  - Quedó `mckg:mckg` + setgid para que Hugo pueda guardar JPG/PNG. Si vuelve a faltar permiso, el aviso ya no es el traceback crudo.
- **Archivos Modificados:**
  - `PAGINA_WEB/site/static/uploads/fondos` (permisos)
  - `app/tools/tema_web_fondos.py`

### 2026-08-09 16:35 - Studio web: logo y header alineados al sitio
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - El lienzo Clásico replica el header publicado (ancho 1280, padding, menú + buscador + carrito + WhatsApp) y muestra el isotipo aunque :8083 no esté arriba.
  - En la página, translate/width del Studio ya no corren la barra ni recortan el logo: el header queda a ancho completo como el CSS.
- **Archivos Modificados:**
  - `ClasicoLayoutCanvas.tsx`, `webLayoutStudio.ts`, `app/tools/tema_web.py`
  - `tests/test_tema_web_header.py`, `desktop/public/img/isotipo.png`

### 2026-08-09 16:45 - Studio web: la foto se ve y se dimensiona
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - La imagen ya no se esconde detrás del color: queda un recuadro visible (📷 Adjuntar imagen).
  - Ese recuadro se arrastra y se redimensiona con las asas (o X/Y/ancho/alto en el inspector).
  - En el sitio publicado sale el mismo `<img>` con tamaño y posición.
- **Archivos Modificados:**
  - lienzos Studio, `tema_web.py`, `index.html`, `main.css`

### 2026-08-09 16:30 - Studio web: poner fotos en los fondos
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - En el lienzo, cada panel del hero (y categorías / CTA) tiene **📷 Poner imagen**: clic o arrastrar la foto encima.
  - El inspector de «Página principal» ahora adjunta la foto al panel izquierdo o derecho (antes se guardaba en un campo que no se veía).
  - El panel :8081 sirve esas fotos para que se vean al instante, sin depender del sitio :8083.
- **Archivos Modificados:**
  - `FondoImagenField.tsx`, lienzos Clásico/Pureza, `tema_web_fondos.py`, `routes.py`

### 2026-08-09 16:20 - Home Clásico = lienzo (2 columnas)
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - La web ya no esconde «Por qué elegirnos» al bajar de 1200px (el lienzo siempre lo muestra). En tablet las dos mitades se apilan; no se ocultan.
  - Un `display:inline-block` del Studio dejaba de romper la grilla del hero y los botones.
- **Archivos Modificados:**
  - `PAGINA_WEB/site/static/css/main.css`, `base.html`
  - `app/tools/tema_web.py`
  - `tests/test_hero_clasico_css.py`, `tests/test_tema_web_hero_split.py`

### 2026-08-09 16:15 - Studio web: asas del recuadro en su sitio
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - Las flechas de redimensionar, Mover y la X ya no se amontonan encima del texto: el marco se mide sobre el papel y las asas quedan en los bordes (derecha, abajo, esquina).
  - Así no las recorta el overflow del hero ni el `inline-flex` de los títulos.
- **Archivos Modificados:**
  - `StudioSelectionChrome.tsx`, `studioSelectionBox.ts`, lienzos Clásico/Pureza
  - `HojasCapitulo.tsx`, `StudioDeleteContext.tsx`
  - `tests/test_studio_selection_box.py`

### 2026-08-09 16:10 - Studio web: guías inteligentes en todos los objetos
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Mejora técnica
- **Qué se implementó:**
  - Al arrastrar o redimensionar cualquier objeto del lienzo aparecen guías magenta: bordes, centros, centro del papel y espacios iguales (como Figma).
  - Cada objeto imanta contra los demás de la hoja (botones del menú entre sí, kit, features, tarjetas de categoría). Alt desactiva el imán.
- **Archivos Modificados:**
  - `desktop/src/lib/studioAlignmentGuides.ts`, `AlignmentGuidesOverlay.tsx`
  - `ClasicoLayoutCanvas.tsx`, `WebLayoutCanvas.tsx`
  - `tests/test_studio_alignment_guides.py`

### 2026-08-09 15:50 - Studio web: adjuntar imágenes de fondo
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - En Tokens se pueden adjuntar fotos (JPG/PNG/WEBP/GIF ≤ 4 MB) para el fondo de la página, el hero, categorías y el CTA. También en el inspector de cada bloque del lienzo.
  - Las imágenes viven en `/static/uploads/fondos/` y se publican con **Publicar**; el sitio las pinta con una capa oscura para que el texto siga leyéndose.
- **Archivos Modificados:**
  - `tema_web.py`, `tema_web_fondos.py`, `routes.py`, `website.py`
  - `main.css`, `tema-pureza.css`, `base.html`, `index_pureza.html`
  - `SitioWebPanel.tsx`, `FondoImagenField.tsx`, lienzos Studio, `webLayoutStudio.ts`
  - `tests/test_tema_web_fondos.py`

### 2026-08-09 15:10 - Studio web: botones del header uno a uno
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - Cada enlace del menú Clásico (Inicio, Catálogo, Guías, Recetario, Blog, Nosotros, Contacto, Iniciar sesión) es un objeto del lienzo con su propio tamaño, fuente, color, hover y animación.
  - Ocultar un botón no afecta a los demás. El grupo «Menú» sigue sirviendo para mover o estilar todos a la vez (los hijos heredan).
- **Archivos Modificados:**
  - `webLayoutStudio.ts`, `ClasicoLayoutCanvas.tsx`, `WebLayoutCanvas.tsx`
  - `base.html`, `main.css`, `tema_web.py`
  - `tests/test_tema_web_header.py`

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

### 2026-08-09 16:05 - Studio web: separar fondos con el cursor
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - Entre el verde y el celeste hay una barra gruesa «⟷ arrastrar»: se mueve con el cursor (no solo el slider del inspector).
  - El arrastre usa captura de puntero sobre la manija para que no se pierda al salir del recuadro.
- **Archivos Modificados:**
  - `ClasicoLayoutCanvas.tsx`, `WebLayoutCanvas.tsx`

### 2026-08-09 16:00 - Studio web: la línea del hero no baja el otro panel
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - La manija ⟷ ya no es una celda de la grilla (eso empujaba «Por qué elegirnos» abajo). Queda superpuesta: los dos fondos siguen en la misma fila al arrastrar.
- **Archivos Modificados:**
  - `ClasicoLayoutCanvas.tsx`, `main.css`

### 2026-08-09 15:55 - Studio web: redimensionar fondos del hero
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - Entre el fondo oscuro y el claro del home Clásico hay una línea ⟷: al arrastrarla un lado se reduce y el otro crece (28–72%).
  - El inspector (sección Página principal) tiene el mismo control. Guardar publica la división en el sitio.
- **Archivos Modificados:**
  - `ClasicoLayoutCanvas.tsx`, `WebLayoutCanvas.tsx`, `webLayoutStudio.ts`, `tema_web.py`
  - `main.css`, `tema-pureza.css`, `tests/test_tema_web_hero_split.py`

### 2026-08-09 15:45 - Studio web: recuadro = tamaño real del botón
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - El marco azul de Comprar / Cotización ya no queda más ancho que el fondo: la caja es `inline-flex` + `max-content` (o el ancho al arrastrar el asa).
  - Debajo del botón aparece la medida real en px (la del sitio, sin el zoom del lienzo) y se actualiza al redimensionar.
- **Archivos Modificados:**
  - `webLayoutStudio.ts` (`estiloCajaHug`), lienzos Clásico/Pureza, `StudioDeleteContext.tsx`

### 2026-08-09 15:20 - Studio web: caja e icono de los CTAs
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - Los botones Comprar ahora / Pedir cotización ya no seleccionan solo el texto: la caja, el icono y el copy son objetos distintos.
  - Mismo criterio en el banner final y en Pureza. En el sitio público el estilo de cada parte llega al `<a>`, al `<i>` y al `<span>`.
- **Archivos Modificados:**
  - `ClasicoLayoutCanvas.tsx`, `WebLayoutCanvas.tsx`, `webLayoutStudio.ts`, `studioEliminar.ts`
  - `index.html`, `index_pureza.html`, `main.css`

### 2026-08-09 15:15 - Studio web: mover con flechas
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - Con un objeto (o varios) seleccionado en el lienzo, las flechas lo desplazan 1 px; Shift+flecha, 10 px.
  - No aplica si se está escribiendo en un campo. Ctrl+Z deshace el lote de pulsaciones.
- **Archivos Modificados:**
  - `desktop/src/lib/webLayoutStudio.ts`, `SitioWebPanel.tsx`, `WebLayoutCanvas.tsx`
  - `tests/test_studio_flechas.py`

### 2026-08-09 15:10 - Studio web: botones del header uno a uno
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - Cada enlace del menú Clásico (Inicio, Catálogo, Guías, Recetario, Blog, Nosotros, Contacto, Iniciar sesión) es un objeto del lienzo con su propio tamaño, fuente, color, hover y animación.
  - Ocultar un botón no afecta a los demás. El grupo «Menú» sigue sirviendo para mover o estilar todos a la vez (los hijos heredan).
- **Archivos Modificados:**
  - `webLayoutStudio.ts`, `ClasicoLayoutCanvas.tsx`, `WebLayoutCanvas.tsx`
  - `base.html`, `main.css`, `tema_web.py`
  - `tests/test_tema_web_header.py`

### 2026-08-09 15:05 - Studio web: Guardar y Publicar siempre a la vista
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - El lienzo ya no empuja fuera de pantalla la barra de Studio: el hub queda a altura fija.
  - **Guardar** y **Publicar** están en la barra del lienzo (junto a Zoom). Publicar deja los cambios en el sitio real.
- **Archivos Modificados:**
  - `Layout.tsx`, `PanelTransition.tsx`, `SitioWebPanel.tsx`, `StudioDesplegables.tsx`
  - `tests/test_studio_web_toolbar_actions.py`

### 2026-08-09 14:50 - Studio web: editar el header
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - El header del home Clásico se parte en logo, menú, buscador y botón WhatsApp; cada uno se selecciona en el lienzo.
  - Inspector: tipo de fuente (Montserrat / sistema / serif / mono), tamaño de botón (compacto/normal/grande), transición de color al hover y animaciones. Los estilos llegan al sitio público (`base.html` + CSS).
- **Archivos Modificados:**
  - `app/tools/tema_web.py`, `base.html`, `main.css`
  - `ClasicoLayoutCanvas.tsx`, `WebLayoutCanvas.tsx`, `webLayoutStudio.ts`
  - `tests/test_tema_web_header.py`

### 2026-08-09 14:45 - Studio web: guías de alineación
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - Al arrastrar objetos en el lienzo (Clásico y Pureza) aparecen líneas rosa que imantan bordes y centros con otros objetos de la misma hoja y con el papel.
  - Alt desactiva el imán. El umbral sigue ~6 px de pantalla aunque el zoom esté bajo.
- **Archivos Modificados:**
  - `desktop/src/lib/studioAlignmentGuides.ts`, `AlignmentGuidesOverlay.tsx`
  - Lienzos Clásico/Pureza, `HojasCapitulo.tsx`, `StudioDesplegables.tsx`
  - `tests/test_studio_alignment_guides.py`

### 2026-08-09 14:40 - Studio web: cajas de texto = tamaño del glifo
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - El recuadro azul y los controladores de un texto ya no quedan más altos que las letras (p. ej. «Explora por»).
  - Causa: un ancho guardado dejaba la caja en `inline` + `position:relative` y el marco de los handles se disparaba. Ahora el alto sigue al texto; en títulos no hay manija de alto.
- **Archivos Modificados:**
  - `desktop/src/lib/webLayoutStudio.ts` (`estiloFitTexto`)
  - `ClasicoLayoutCanvas.tsx`, `WebLayoutCanvas.tsx`

### 2026-08-09 14:35 - Home Clásico: el sitio recortaba el título
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - El lienzo del Studio y la web pública no usaban el mismo CSS: en vivo el H1 iba a 80px, pegado abajo (`flex-end`) y con `overflow:hidden`, así que «Materias» se cortaba.
  - El hero público ahora centra el copy, usa ~42px como el lienzo y llena la primera pantalla bajo anuncio+header.
- **Archivos Modificados:**
  - `PAGINA_WEB/site/static/css/main.css`, `base.html`
  - `ClasicoLayoutCanvas.tsx`, `tests/test_hero_clasico_css.py`

### 2026-08-09 14:25 - Studio web: eliminar de verdad (lienzo + sitio)
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - La X del objeto seleccionado ahora borra al primer clic (antes `preventDefault` anulaba el click). Queda dentro de la hoja para que no la recorte el overflow.
  - Logo/nav/búsqueda son un bloque `header` borrable. Anuncio y header ocultos también desaparecen en el sitio real (`base.html`), no solo en el lienzo.
  - Supr/Backspace ignoran el buscador de mentira del canvas.
- **Archivos Modificados:**
  - `StudioDeleteContext.tsx`, lienzos Clásico/Pureza, `SitioWebPanel.tsx`
  - `PAGINA_WEB/site/templates/base.html`, `index.html`
  - `tests/test_tema_web_layout_hidden.py`

### 2026-08-09 14:10 - Studio web: X para eliminar en el lienzo
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - Sobre el objeto seleccionado hay una **X roja**; también Supr y el botón Eliminar.
  - Se oculta el bloque entero (CTA, fila del kit, feature), no solo la letra de adentro.
- **Archivos Modificados:**
  - `desktop/src/lib/studioEliminar.ts`, `StudioDeleteContext.tsx`, lienzos, `SitioWebPanel.tsx`, `index.html`

### 2026-08-09 14:05 - Studio web: colores y fondos del tema Clásico
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - En Studio → Tokens se pueden cambiar fondos y acentos del tema **Clásico** (el publicado): fondo de página, hero/footer oscuro, botones y texto.
  - Los valores viven en `clasico.colores` y se inyectan como variables CSS (`--green*`) en todo el sitio. La vista previa local los muestra al instante; Guardar los publica.
- **Archivos Modificados:**
  - `app/tools/tema_web.py`, `PAGINA_WEB/site/website.py`, `templates/base.html`
  - `SitioWebPanel.tsx`, `webLayoutStudio.ts`, `ClasicoLayoutCanvas.tsx`
  - `tests/test_tema_web_colores.py`

### 2026-08-09 13:56 - Studio web: reescribir texto del lienzo
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - El inspector muestra un recuadro **Texto** para reescribir el copy del objeto seleccionado (Clásico y Pureza).
  - En el lienzo: doble clic, Enter o F2 abren la edición inline. El arrastre espera ~5 px para no bloquear el doble clic.
- **Archivos Modificados:**
  - `desktop/src/lib/webLayoutStudio.ts` (`leerContentPath`, `pathEsTextoEditable`)
  - `WebLayoutCanvas.tsx`, `ClasicoLayoutCanvas.tsx`, `SitioWebPanel.tsx`

### 2026-08-09 13:55 - Studio web: eliminar objetos del lienzo
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - En el lienzo se puede borrar lo seleccionado: botón **Eliminar**, menú Acciones, inspector, o teclas Supr / Backspace.
  - Ítems de lista (kit, features, métricas, pilares…) se quitan del contenido; textos/botones se ocultan; una hoja entera se apaga y se puede restaurar desde Hojas.
  - Ctrl+Z deshace. Al guardar, el sitio público deja de mostrar lo eliminado.
- **Archivos Modificados:**
  - `desktop/src/lib/studioEliminar.ts`
  - `SitioWebPanel.tsx`, inspector/toolbar y lienzos Clásico/Pureza
  - templates `index.html`, `index_pureza.html` (hero opcional)

### 2026-08-09 13:50 - Studio web: hoja 1 = home Clásico real
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Mejora técnica
- **Qué se implementó:**
  - La primera hoja del capítulo Clásico replica la página principal publicada: barra de anuncio, header (logo, nav, búsqueda) y hero partido (copy + “Por qué elegirnos”).
  - Se edita en el lienzo lo mismo que se ve en mckennagroup.co, no un mock recortado.
- **Archivos Modificados:**
  - `desktop/src/components/studio-web/ClasicoLayoutCanvas.tsx`
  - `desktop/src/components/studio-web/HojasCapitulo.tsx`, `SitioWebPanel.tsx`
  - `desktop/src/lib/webLayoutStudio.ts` (nodo `anuncio`)

### 2026-08-09 00:05 - Studio web: lienzo por hojas del capítulo
- **Autor:** Cynthia Ruiz
- **Tipo de Cambio:** Mejora técnica
- **Qué se implementó:**
  - El lienzo ya no es una sola tira continua: cada sección del home es una hoja de papel del capítulo (Clásico o Pureza), con folio 1/N y título.
  - El menú **Hojas** y el inspector saltan a esa página; al seleccionar un objeto el scroll lleva a su hoja.
- **Archivos Modificados:**
  - `desktop/src/components/studio-web/HojasCapitulo.tsx`
  - `desktop/src/components/studio-web/WebLayoutCanvas.tsx`, `ClasicoLayoutCanvas.tsx`
  - `desktop/src/components/studio-web/StudioDesplegables.tsx`, `SitioWebPanel.tsx`

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
