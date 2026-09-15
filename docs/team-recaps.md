### 2026-09-15 13:10 - Las casillas de permisos ya se pueden dar desde Gestión de usuarios, y no vuelven a quedarse cortas

- **Autor:** Armando García
- **Tipo de Cambio:** Mejora técnica (cierre del ciclo permisos ↔ UI ↔ backend)
- **Qué se implementó:**
  - **El problema de fondo:** la lista de casillas de «Accesos al panel» estaba escrita a mano y ofrecía **22 de los 48 permisos** que el código honra. Faltaban justo los que hacían falta hoy —`pagos` (Solicitudes de pago), `prestamos`, `socios`, `conciliacion-contador`, `whatsapp` (Agente WA), `guias-envio`—: el permiso existía en el código y en la base, pero **no había forma de otorgarlo desde el panel**. Un operario como Jenniffer no podía recibir Solicitudes de pago aunque se quisiera.
  - **Las casillas ahora se derivan, no se escriben** (`desktop/src/lib/permisosCatalogo.ts`): salen de `NAV_SECTIONS` —las secciones reales del menú— y cada clave se **verifica contra `puedeVerSeccionPanel`** antes de ofrecerse, así que marcarla abre de verdad ese panel. Un apartado nuevo aparece como casilla sin que nadie se acuerde de agregarlo. Se agrupan como el menú, con la nota de qué hereda cada permiso, y las claves guardadas que ya no controlan nada se listan aparte en vez de desaparecer sin avisar.
  - **`App.tsx` dejó de tener su propia escalera de permisos** y delega en `panelAccess`. Tenerla por duplicado ya había costado caro: «Correo Ventas» se heredaba de `preventa` solo en el menú, así que el panel aparecía y rebotaba al abrirse — y como el hub recuerda el último subpanel visitado, **a Jenniffer se le cerró toda la sección Atención** teniendo los permisos.
  - **El backend entra al mismo circuito.** Los grupos del guard de contabilidad salieron a `PERMISOS_CONTABILIDAD`, a nivel de módulo en `app/routes.py`, y el QA comprueba que **cada clave que el backend exige tenga casilla en Gestión de usuarios**. Sin eso, proteger un endpoint con un permiso que la UI no sabe dar lo deja cerrado para siempre: es el mismo error de antes, visto desde el otro lado.
  - **Y esto ya no depende de que alguien se acuerde:** `desktop/scripts/qa-panel-access.mjs` corre ahora dentro de `pytest` (`tests/test_qa_panel_access.py`) además de `npm run qa:panel-access`. Comprobado a propósito con un permiso inventado en el guard: la suite falla nombrándolo.
  - **Verificado de punta a punta, en vivo:** con Jenniffer en 403 sobre Solicitudes de pago, se marcó su casilla desde la API de administración → pasa a **200** en el wizard y en los catálogos que necesita, y **sigue en 403** en Libro Mayor y Préstamos. Al desmarcarla, vuelve a 403. 158 tests en verde.
- **Archivos Modificados:** `desktop/src/lib/permisosCatalogo.ts` (nuevo), `desktop/src/components/TicketsPanel.tsx`, `desktop/src/App.tsx`, `desktop/scripts/qa-panel-access.mjs` (nuevo), `desktop/package.json`, `app/routes.py`, `tests/test_qa_panel_access.py` (nuevo), `docs/team-recaps.md`

### 2026-09-15 12:20 - El guard de permisos se extendió a todo el hub Contabilidad

- **Autor:** Armando García
- **Tipo de Cambio:** Corrección de control de acceso (continuación del cambio anterior)
- **Qué se implementó:**
  - **Mismo hueco, más módulos.** Tras cerrar `/api/pagos/*`, con la sesión de `jerry` (nivel operario, sin ningún permiso contable) seguían respondiendo 200: `/api/contabilidad/cc/*` (Libro Mayor completo, terceros, balances), `/api/prestamos` (cédula, correo y **cuenta bancaria** de cada prestamista y socio), `/api/socios/saldos`, `/api/contabilidad/extractos/*`, `/creditos`, `/ingresos-egresos`, `/checklist` y `/api/alegra/espejo`. Todos son módulos cuyo propio código dice "permiso propio, no heredado — datos sensibles", y eso solo lo aplicaba el frontend.
  - **Se hizo por prefijo, no ruta por ruta.** Un `before_request` en `app/routes.py` (`_guard_permisos_contabilidad`) resuelve qué permisos exige cada ruta y responde 401 sin sesión / 403 sin permiso. Así una ruta contable nueva **nace protegida** en vez de nacer abierta — que es exactamente cómo se abrieron estas — y el alias `/app/api/...` del proxy queda cubierto por el mismo camino.
  - **Cuatro grupos, calcados de `lib/contabilidadAccess.ts`** para no romper a quien sí tiene el permiso: catálogos compartidos (plan de cuentas, terceros, medios de pago) abiertos a `libro-mayor`/`prestamos`/`socios`/`pagos` —el wizard de pagos crea terceros desde TerceroSelect—; Libro Mayor, extractos y créditos a `libro-mayor`/`prestamos`/`socios` —el panel de Préstamos lee `/cc/movimientos` para su cronograma—; Préstamos a `prestamos`/`libro-mayor`; y cuenta de socios a `socios`/`libro-mayor`/`prestamos`. Rol administrador entra siempre; `CHAT_API_TOKEN` también, para crons y procesos internos.
  - **El expediente fiscal del Declarador (`/api/socios/<id>/…`) quedó intacto**, con su propio control de que cada socio ve solo el suyo.
  - **Verificado en vivo** tras reiniciar `agente-pro`, con sesiones reales de `jerry` y de Armando: 13 rutas dan **403** para ella y **200** para él y para el token de sistema; su sesión de tickets sigue normal. En tests, `tests/test_permisos_api_contabilidad.py` (renombrado desde `test_pagos_permisos_api.py`) pasó de 10 a **37 casos**, incluido uno que comprueba que una ruta contable inventada también queda cerrada.
  - **Nota para quien siga:** ningún usuario activo tiene hoy permisos contables explícitos — quienes usan el hub (Cynthia, Armando, admin) entran por rol administrador. Si mañana se le da Contabilidad a alguien de nivel operario, hay que marcarle la casilla correspondiente en Gestión de usuarios; antes de este cambio "funcionaba" sin marcarla porque nadie estaba mirando.
- **Archivos Modificados:** `app/routes.py`, `tests/test_permisos_api_contabilidad.py`, `docs/team-recaps.md`

### 2026-09-15 11:30 - Jenniffer no debe ver las solicitudes de pago: en el menú no las veía, por API sí

- **Autor:** Armando García
- **Tipo de Cambio:** Corrección de control de acceso
- **Qué se implementó:**
  - **El hallazgo:** el usuario `jerry` (Jenniffer, despachos, nivel operario) no tiene los permisos `pagos` ni `libro-mayor`, así que el panel le ocultaba Contabilidad → Solicitudes de pago. Pero las rutas `/api/pagos/*` solo exigían `_api_token_valido()`, que acepta la sesión de **cualquier** usuario del panel. Probado con su propia sesión contra el servidor en vivo: devolvía el listado completo de solicitudes con proveedor, monto, estado y totales, el directorio de proveedores con sus saldos en 2205, la factura adjunta de cada solicitud y los endpoints de aprobar y rechazar. **Ocultar en el menú no es restringir.**
  - **El arreglo:** las 17 rutas de `/api/pagos/*` pasan ahora por `_pagos_rechazo()`, que exige lo mismo que el panel (`lib/contabilidadAccess.ts`, sección "pagos"): permiso propio `pagos` o `libro-mayor`, o rol administrador; `CHAT_API_TOKEN` sigue entrando para crons y procesos internos. Mismo patrón que ya usaban `app/routes_anulaciones.py` y `app/routes_conciliacion.py`, que sí estaban protegidas.
  - **Verificado en vivo tras reiniciar `agente-pro`:** con la sesión de `jerry`, las seis rutas probadas responden **403**; con el token de sistema, 200. Su sesión de tickets sigue funcionando normal (`/api/tickets/auth/me` → 200), así que no perdió nada de lo suyo.
  - **Lo que NO quedó cubierto y hay que decidir aparte:** con esa misma sesión siguen abiertos `/api/contabilidad/cc/*` (movimientos y terceros del Libro Mayor), `/api/prestamos` (cédula, correo y cuenta bancaria de prestamistas y socios), `/api/socios/saldos` y `/api/contabilidad/extractos/*`. Son los módulos cuyo propio código dice "permiso propio, no heredado — datos sensibles", y hoy solo lo cumple el frontend. El arreglo es el mismo guard; se dejó fuera de este cambio por tocar más paneles de los que se pidió revisar.
- **Archivos Modificados:** `app/routes.py`, `tests/test_pagos_permisos_api.py` (nuevo, 10 casos), `docs/team-recaps.md`

### 2026-09-14 12:40 - Etiquetas: los cuadros de texto de la ficha ya no cortan el último renglón
- **Autor:** Armando García
- **Tipo de Cambio:** Corrección (ficha 76 × 66 · campos editables)
- **Qué se implementó:**
  - Algunos campos de la ficha —se veía en Conservación de Sales minerales— mostraban el texto cortado con barra de desplazamiento en lugar de estirarse hasta caberlo.
  - **Causa: dos píxeles de borde.** El cuadro se estira poniendo `height = scrollHeight`, pero `scrollHeight` mide contenido más relleno y NO el borde, mientras que el campo es `box-sizing: border-box`, de modo que la altura asignada sí incluye el borde. El borde punteado de 1 px arriba y 1 px abajo se comía 2 px por dentro y el texto se quedaba siempre ese pelo corto. Medido: Conservación tenía 66 px de cuadro para 68 px de texto. Ahora se suma el grosor del borde.
  - **Y se vuelve a medir cuando hace falta.** Antes solo se ajustaba al cambiar el valor; el texto también reflúye cuando termina de cargar la tipografía web (hasta entonces se mide con la de repuesto) y cuando cambia el ancho de la celda. Se pasó a `useLayoutEffect` —mide antes de pintar, sin parpadeo—, se añadió la versión de las fuentes como dependencia (`useVersionFuentes`, el mismo hook que ya usaban los formatos de 30 mL y circular) y un `ResizeObserver` sobre el propio campo.
  - **Comprobado con los textos reales** de las fichas guardadas, sobre la retícula maestra de verdad (960 px, 3 columnas, filas del cuerpo): los seis módulos pasan de tener uno cortado a que cuadro y texto midan lo mismo en todos.
- **Archivos Modificados:** `desktop/src/components/etiqueta-ficha/EditableField.tsx`, `docs/team-recaps.md`

### 2026-09-14 15:40 - No se encendió la emisión de documentos soporte: Alegra no los transmite a la DIAN todavía
- **Autor:** Armando García
- **Tipo de Cambio:** Verificación previa a una acción fiscal + ticket de trámite
- **Qué se implementó:**
  - **Se iba a encender `PRESTAMOS_DOC_SOPORTE_ACTIVO=1` y la verificación previa lo frenó.** Contra la API de Alegra: la plantilla 15 de **factura** electrónica está habilitada (`isElectronic: true`, resolución 18764115063321, rango 1-20.000, vence 2028-09-02), pero la plantilla 10 de **documento soporte** tiene `isElectronic: false`, sin resolución de numeración y sin rango. Son dos habilitaciones distintas ante la DIAN.
  - **Qué habría pasado si se enciende:** los documentos de las cuotas se crearían en Alegra pero **no se transmitirían a la DIAN**. No servirían como soporte de la deducción del gasto financiero —que es exactamente para lo que se emiten— y además consumirían numeración de una plantilla que después habría que rehacer. Por eso se dejó en sombra y se documentó en el propio código, en `_doc_soporte_activo()`.
  - **TKT-2026-1323** con los pasos: pedir a la DIAN la resolución de numeración para documento soporte en adquisiciones a no obligados a facturar (Res. 000167 de 2021), cargarla en Alegra y habilitar el electrónico en la plantilla 10. No se puede por API. Plazo: la primera cuota con retención vence el **9 de octubre** ($21.022 de Antonio Ruiz; $85.400 ese mes entre los cuatro prestamistas).
  - **Lo que sí quedó listo y no hay que volver a revisar:** el ítem INTERES-MUTUO existe (id 624) aunque el documento no lo usa —va por cuenta contable 5252—; la retención «Rendimientos financieros 7 %» se creó en Alegra (id 14) y está mapeada; los cuatro prestamistas ya son contactos con correo (ids 112, 32, 29, 33); y el ensayo en seco de la cuota 1 sale correcto con la retención de $21.021,58.
  - **Mientras tanto la retención no queda invisible:** con el espejo encendido, el asiento del Libro Mayor de cada pago llega solo a Alegra como comprobante contable, así que el contador la ve aunque el documento soporte todavía no se emita.
- **Archivos Modificados:** `app/services/prestamos.py`, `CLAUDE.md`, `docs/team-recaps.md`; fuera del repo: TKT-2026-1323

### 2026-09-14 15:05 - Trii en el expediente (la venta de 2025 dio pérdida) y la retención del 7 % creada en Alegra
- **Autor:** Armando García
- **Tipo de Cambio:** Datos nuevos en el expediente + configuración en Alegra
- **Qué se implementó:**
  - **Trii es la plataforma y Acciones & Valores la comisionista que la respalda:** las cifras de los tres CSV que subió Armando cuadran al peso con los certificados ya cargados (compras 2024 por $2.757.985, 2025 por $3.685.445, ventas 2025 por $6.568.820, dividendos $761.088). Lo que Trii agrega y el certificado no tenía es el **detalle operación por operación con fechas, precios y comisiones**, que es lo que permite calcular la ganancia real.
  - **Resultado del cálculo FIFO, con las comisiones dentro del costo: la venta de acciones de 2025 dio PÉRDIDA de $227.651, no ganancia.** La venta del 27-abr-2025 de 3.254 ECOPETROL por $5.954.820 pierde $330.401; las 50 BVC por $614.000 ganan $102.750. Tenencia menor a dos años, así que es renta ordinaria, no ganancia ocasional. Las 185 ECOPETROL que quedaban se vendieron el 6-ene-2026 con ganancia de $27.600, que va en el año gravable 2026 y no en 2025.
  - **El flujo con el banco quedó documentado** para la justificación patrimonial: $6.450.000 en depósitos aprobados y $7.001.969 en retiros, con la advertencia de que hay cinco depósitos RECHAZADOS por $6.500.000 que no son salida de dinero aunque aparezcan en el archivo.
  - **Sobre el ítem INTERES-MUTUO: ya existía** en Alegra (id 624) y además **no se usa** — el documento soporte va por cuenta contable (5252) porque Alegra rechaza los ítems en esta cuenta con el error 11034. Lo que sí faltaba, y era el bloqueo real, es que **la retención de rendimientos financieros al 7 % (Art. 395 ET) no estaba configurada**: de las 13 retenciones de la cuenta ninguna era esa, así que el documento soporte de una cuota habría salido SIN retención y el contador no la habría visto por esa vía. Se creó por API (id 14, `POST /retentions` responde 201) y se mapeó en el código.
  - **Verificado en dry run con la cuota 1 real del préstamo #1:** el documento ahora sale con `retentions: [{id 14, amount 21.021,58}]`. Ya no falta nada técnico para emitirlo; falta la decisión de encender `PRESTAMOS_DOC_SOPORTE_ACTIVO=1`, que no se tocó porque un documento soporte emitido viaja a la DIAN y solo se corrige con nota de ajuste.
  - **Verificado:** 85 tests, PDF del expediente regenerado (301 documentos), cálculo FIFO contrastado contra los certificados de la comisionista.
- **Archivos Modificados:** `app/services/alegra.py`, `app/services/declarador.py`, `app/services/conciliacion_contador.py`, `CLAUDE.md`, `docs/team-recaps.md`; fuera del repo: `/home/mckg/Declarador/Armando/15_Inversiones_Acciones_y_Valores/` y la retención nueva en Alegra

### 2026-09-14 14:10 - Espejo a Alegra encendido, 2026 cuadrado al peso, y los certificados de la comisionista en el expediente
- **Autor:** Armando García
- **Tipo de Cambio:** Operación sobre datos + categoría nueva en el expediente de socios
- **Qué se implementó:**
  - **El espejo quedó encendido** (`ALEGRA_ESPEJO_ACTIVO=1`) y se reespejó lo que faltaba: 73 asientos de enero a junio y los 15 asientos con retención de julio y agosto. **La cuenta 2365 de 2026 quedó en $2.931.292 en el Libro Mayor y $2.931.292 en Alegra, diferencia cero en los ocho meses.** El hallazgo de «$2.621.225 que el contador no ve» se cerró solo al volver a analizar. De aquí en adelante cada asiento nuevo llega a Alegra sin que nadie haga nada.
  - **Las 484 ventas diarias de MeLi de julio-agosto NO se espejaron hacia atrás, a propósito:** no aportan al 350, y volcarlas habría llenado Alegra de comprobantes sin relación con lo que el contador necesita. Van solas de ahora en adelante.
  - **Tres arreglos que hicieron falta para que el reespejo terminara.** `GET /journals/types` devuelve todos los comprobantes con sus líneas, así que se vuelve más lento cuanto más se espeja: con 20 s de timeout empezó a fallar apenas pasó de 100 comprobantes y tumbaba el lote. Ahora son 90 s, con caché de 10 minutos y, si la recarga falla, sigue con el valor anterior. El contacto de Alegra se resolvía con una petición por línea (200 para un semestre sobre 20 terceros) y ahora se cachea. Y la lectura de retenciones reintenta ante 503 y marca `parcial` si se corta: una lectura a medias reportaba tres meses en cero y habría acusado al contador de un faltante inexistente.
  - **Certificados de Acciones & Valores 2024 y 2025** (NIT 860.071.562-1, cuenta 266039), que Armando dejó en la carpeta: categoría nueva `inversiones`, carpeta `15_Inversiones_Acciones_y_Valores/<año>/`, pregunta nueva en el cuestionario y copias sin clave de los PDF (venían protegidos con la cédula). Los zips duplicados se retiraron.
  - **Lo que dicen esos certificados, ya como hallazgos del expediente:** a 31-dic-2024 tenía **$3.179.061** en la comisionista (BVC 50 y ECOPETROL 1.551, más caja) y a 31-dic-2025 **$350.434**; **retención ya practicada a favor de $10.862 y $8.561**, que se restan del impuesto en la corrección; **dividendos 2025 por $761.088 sin retención**, que son ingreso a declarar; y ventas por $6.568.820 cuya ganancia hay que calcular contra el costo fiscal. La cuenta se abrió el 17-feb-2024, así que 2020-2023 quedaron marcados «no aplica».
  - **Verificado:** libro contra Alegra mes a mes tras cada tanda, 85 tests, `tsc`, build, PDF del expediente regenerado (298 documentos).
- **Archivos Modificados:** `app/services/alegra_espejo.py`, `app/services/conciliacion_contador.py`, `app/services/declarador.py`, `desktop/src/components/SociosPanel.tsx`, `tests/test_declarador.py`, `docs/team-recaps.md`; fuera del repo: `.env` (bandera del espejo), `/home/mckg/Declarador/Armando/15_Inversiones_Acciones_y_Valores/`

### 2026-09-14 12:20 - Etiquetas: el cuadro de los atributos deja de encoger al bajar la letra
- **Autor:** Armando García
- **Tipo de Cambio:** Corrección (ficha 76 × 66 · módulos de atributo)
- **Qué se implementó:**
  - En la plantilla de Sales minerales, bajar el tamaño de letra de un atributo desde el menú de tipografía **encogía también su cuadro** y descuadraba la fila. Se veía sobre todo en Olor y Conservación.
  - La causa: el alto mínimo del cuadro estaba escrito en `em` (`min-h-[3.7em]`), y `em` sigue al tamaño de letra. Al bajar la fuente de 14 a 9 px, el suelo del cuadro pasaba de 51,8 a 33,3 px. Ahora está en px (`min-h-[52px]`, los mismos tres renglones al tamaño por defecto): el cuadro conserva su alto se elija la letra que se elija, y sigue creciendo solo si el texto pide más de tres renglones.
  - **Comprobado por el camino real:** se montó la retícula de atributos en modo edición y se bajó la letra de Olor y Conservación a 9 px con la misma llamada que hace el menú de tipografía. Medido en el navegador: la fuente pasa de 14 a 9 px y el cuadro se queda en 52 px, antes y después.
  - Afecta a los seis módulos (Origen, Apariencia, Olor, Composición, Grado, Conservación) de todos los formatos que usan la ficha de 76 × 66, no solo a Sales minerales.
- **Archivos Modificados:** `desktop/src/components/etiqueta-ficha/ProductAttribute.tsx`, `docs/team-recaps.md`

### 2026-09-14 12:30 - Conciliación contador: alertar de las retenciones que el contador no puede ver en Alegra
- **Autor:** Armando García
- **Tipo de Cambio:** Nueva funcionalidad (dos detectores) + hallazgo medido
- **Qué se implementó:**
  - **Se midió el hueco y es grande.** El contador arma el 350 con lo que ve en Alegra. Contrastando las dos fuentes: el Libro Mayor tiene **$2.931.292** acreditados en la cuenta 2365 durante 2026; en Alegra hay **$310.067**. Son **$2.621.225 de retención practicada que él no puede ver**, y los meses de enero a junio están en cero al otro lado. En Alegra hay **0 facturas de compra** de 2026 y solo 11 comprobantes contables, de los cuales 4 tocan retención.
  - **`retenciones_visibles_en_alegra(año)`** (en `alegra_espejo.py`, solo lectura) suma lo que el contador vería: líneas de comprobante contable que acreditan una cuenta de retención por pagar (5108 a 5123) más las retenciones aplicadas dentro de facturas de compra. Si faltan credenciales o la API falla lo dice; no devuelve ceros en silencio, que se leerían como «Alegra está al día».
  - **Dos detectores nuevos** en Conciliación contador, tipo «👁️ Lo que el contador NO ve»: `_det_alegra_vs_libro` (compara mes a mes y propone las dos salidas: encender el espejo `ALEGRA_ESPEJO_ACTIVO=1` o dar acceso de solo lectura al Libro Mayor) y `_det_retencion_prestamos`, que es preventivo.
  - **La retención de los préstamos es el caso más delicado** y todavía no ha ocurrido: 96 cuotas por pagar con retención del 7 % sobre intereses, **$1.604.281 en total**, a los cuatro prestamistas. La primera vence el **9 de octubre** y ese mes suma **$85.400**. Nace de un pago de McKenna, no de una factura de proveedor: no llega al contador por ninguna otra vía, y hoy están apagados tanto el espejo a Alegra como el documento soporte. Si se practica y nadie la declara, el dinero queda retenido sin consignar, que es lo que sanciona el Art. 402 del Código Penal.
  - **Contexto de TKT-2026-1301:** ese ticket pide a William el detalle por tercero de los 350 de 2026 porque el contador tiene compras que nunca llegaron al sistema. Esto es el espejo del mismo problema en la dirección contraria: el sistema tiene retenciones que el contador no tiene. Los dos huecos se cierran con el mismo acuerdo.
  - **Verificado:** los dos detectores corridos contra los datos reales y registrados por `analizar()` (21 hallazgos pendientes, 2 nuevos), leídos por el endpoint del panel. Tests de declarador y smoke (85) pasan; los cinco fallos de `test_precios_canales` son anteriores y ajenos.
- **Archivos Modificados:** `app/services/alegra_espejo.py`, `app/services/conciliacion_contador.py`, `desktop/src/components/ConciliacionContadorPanel.tsx`, `docs/team-recaps.md`

### 2026-09-14 11:50 - Etiquetas: la plantilla se ve entera al abrirla, sin barras de desplazamiento
- **Autor:** Armando García
- **Tipo de Cambio:** Mejora de interfaz (vista previa de los cuatro formatos)
- **Qué se implementó:**
  - **Cada plantilla se dibuja a la escala que haga falta para caber entera** en el hueco disponible, por ancho y por alto, en vez de abrirse a tamaño de diseño con barras. Cada formato tiene la suya: medido en un hueco de 660 px, el 30 mL sale al 55 %, el 69 × 51 al 73 % y el circular al 96 %. Nunca se agranda por encima del 100 %, y por debajo del 30 % deja de encoger y el marco vuelve a recorrerse (una ventana muy angosta no debe volver la etiqueta ilegible).
  - **Se revierte a propósito una decisión anterior**, que era abrir siempre al 100 % y desplazarse. Aquella se tomó porque encoger la etiqueta rompía la edición; pero lo que la rompía era cambiar las medidas, no escalar. Aquí se aplica `transform: scale()` sobre el **lienzo completo**: el ajuste automático de texto sigue midiendo a tamaño de diseño (`scrollWidth`/`clientWidth`, que no ven transformaciones), los textos curvos miden en unidades del SVG y el navegador transforma las coordenadas de los clics. La ficha de 76 × 66 ya venía escalando así.
  - **Comprobado con edición real, no solo mirando:** sobre un lienzo al 64 %, un clic en el centro en pantalla de la casilla del nombre enfocó esa casilla y lo tecleado llegó al estado del componente. Es justo lo que falló en el intento anterior, así que se probó antes de dar el cambio por bueno.
  - `useEscalaAjuste` (nuevo) concentra el cálculo y lo usan tanto `Marco30ml` (30 mL, 69 × 51, circular) como el marco de la ficha de 76 × 66. No recalcula al desplazarse: la escala cambiando bajo el cursor sería peor que la barra.
- **Archivos Modificados:** `desktop/src/components/etiqueta-ficha/useEscalaAjuste.ts` (nuevo), `desktop/src/components/etiqueta-30ml/Marco30ml.tsx`, `desktop/src/components/etiqueta-ficha/ProductLabelForm.tsx`, `docs/team-recaps.md`

### 2026-09-14 11:50 - Socios: la carpeta de Cynthia organizada igual que la de Armando, y el expediente unificado en un solo sitio
- **Autor:** Armando García
- **Tipo de Cambio:** Mejora técnica + organización de archivos
- **Qué se implementó:**
  - **La carpeta de Cynthia quedó con la misma estructura y los mismos nombres** que la de Armando: `01_Declaraciones_Renta_F210/F210_2019.pdf` … `F210_2024.pdf`, `02_Informacion_Exogena_DIAN/Exogena_2021.xls` … `Exogena_2025.xlsx`, `09_Binance_Evidencia_API/` con el export por API. Su `LEEME.md` y su informe en PDF (9 páginas) ya están generados.
  - **El organizador ahora también recoge lo que se subió por el panel.** Los 11 documentos principales de Cynthia (seis F210 y cinco exógenas) vivían en `comprobantes/socios/1/` con nombre de timestamp (`20260913205356_2019.pdf`), fuera de su carpeta: el contador no los habría encontrado. Ahora se llevan a la carpeta del socio y se renombran, así que el expediente completo queda en un solo sitio, sin importar por dónde entró cada archivo.
  - **Un socio nuevo nace con la estructura final.** `CARPETAS_SOCIO` (lo que crea el botón «Crear carpeta») se unificó con las carpetas a las que lleva `organizar_carpeta()`; antes eran dos nomenclaturas distintas y el socio nuevo empezaba con una que luego cambiaba.
  - **Años fuera del período elegido.** Cynthia subió sus F210 de 2019 y 2020 pero pidió organizar desde 2021, así que esos años salían en blanco en el informe. Ahora se marcan «Fuera del período elegido» y explican cómo incluirlos.
  - **Dos arreglos del importador:** `LEEME.md` (el índice de la carpeta) y `00_Informe_Para_El_Contador/` (el PDF que genera el propio panel) dejaron de registrarse como soportes; el informe estaba llegando a citarse a sí mismo.
  - **Verificado:** 85 tests (uno actualizado por la estructura unificada), `tsc`, build, los dos PDF regenerados y revisados página por página.
- **Archivos Modificados:** `app/services/declarador.py`, `app/tools/declarador_pdf.py`, `desktop/src/components/SociosPanel.tsx`, `tests/test_declarador.py`, `docs/team-recaps.md`; fuera del repo: `/home/mckg/Declarador/Cynthia/` reorganizada

### 2026-09-14 11:30 - Etiquetas: la franja de color en los cuatro formatos, dentro del SVG del código, y zona de timbre en Activos Cosméticos
- **Autor:** Armando García
- **Tipo de Cambio:** Mejora de diseño (4 formatos) + corrección de fondo en el generador EAN-13
- **Qué se implementó:**
  - **La franja de ocho colores sobre el código de barras pasa a los cuatro formatos** (ficha 76 × 66, 30 mL, 69 × 51 y circular 53), no solo al circular. Todos desembocan en el mismo `BarcodeBlock`, así que la franja se dibuja desde ahí y cada formato solo pasa su alto (`ALTO_FRANJA_*`).
  - **Se dibuja DENTRO del SVG del código, no como capa del DOM.** Es la única forma de que empiece y acabe justo donde las barras: la zona muda del EAN-13 es asimétrica (11 módulos a la izquierda, 7 a la derecha), así que el centro de las barras cae en el 51,8 % de la imagen y no en el 50 %, y encima `object-fit: contain` escala distinto en cada formato (en el 30 mL manda el ancho, en el circular el alto). Compartiendo coordenadas con las barras el encaje es exacto a cualquier escala — y la franja viaja sola al PNG y a la impresión. `generarEAN13` acepta ahora un parámetro opcional `franja`; sin él el código sale idéntico a antes, que es lo que necesitan el buscador de SKU y la herramienta de arrastrar al lienzo.
  - **Activos Cosméticos (30 mL): el código se corre a la derecha** y deja libre a su izquierda el 40 % de la fila (~9,5 mm) para estampar el timbre físico. Cierra en la misma vertical que el bloque de información técnica de arriba (94 % centrado = 3 % de margen). El hueco sale en blanco; el rótulo «Timbre» solo se ve en edición. Acotado a `.e30-timbre-fila`: los otros tres formatos comparten `.e30-barras` y no se tocaron. **Ojo:** el código queda en 13,6 mm de ancho impreso, un 36 % del nominal EAN-13 (37,3 mm) — por debajo del mínimo de la norma. Conviene probar una etiqueta impresa antes de usarlo en punto de venta.
  - **Circular 53 — proporciones.** El borde exterior sube del 3,5 % al 1,5 % de margen (el círculo llega casi al filo), el título va de 48,5 a 60 px reales y el bloque central se recompone sin franjas muertas. El título no crecía aunque se subiera su tamaño: `TextoCurvo` lo encoge hasta que quepa en su arco, y con `letter-spacing: 0.05em` pedía 521 px sobre un arco de 491. Se bajó el espaciado a 0,012em, se abrió el tramo a ±68° y se bajó un punto el radio para que la tinta no roce el aro naranja.
  - **Verificado con render, no por constante:** se montó una página aislada que dibuja los componentes reales y se capturó con Chrome headless (Puppeteer) desde el servidor, porque el panel exige inicio de sesión con Google. Ahí se vio que un primer montaje de la franja dejaba el código del 30 mL y del 69 × 51 **en cero píxeles de ancho** — `.e30-barras` es flex en fila y la franja al 100 % lo dejaba sin sitio. Sin renderizar, eso se habría ido a producción con los códigos invisibles.
- **Archivos Modificados:** `desktop/src/lib/ean13.ts`, `desktop/src/components/etiqueta-ficha/{BarcodeBlock.tsx,franjaBarras.ts (nuevo),ProductLabelForm.tsx,productLabelTypes.ts}`, `desktop/src/components/etiqueta-30ml/{BarcodeSection.tsx,RightDocumentationPanel.tsx,etiqueta30mlTypes.ts,etiqueta30ml.css}`, `desktop/src/components/etiqueta-simple/{EtiquetaSimple.tsx,etiquetaSimpleTypes.ts}`, `desktop/src/components/etiqueta-circular/{EtiquetaCircular.tsx,etiquetaCircular.css,etiquetaCircularTypes.ts}`, `docs/team-recaps.md`

### 2026-09-14 05:20 - Socios: informe del expediente en PDF y carpeta reorganizada con nombres que el contador entiende
- **Autor:** Armando García
- **Tipo de Cambio:** Nueva funcionalidad (PDF) + reorganización de archivos
- **Qué se implementó:**
  - **El informe cronológico se descarga en PDF** desde el paso «Expediente para el contador» (`GET /api/socios/<id>/informe.pdf`, `app/tools/declarador_pdf.py` con ReportLab). 13 páginas para Armando: portada con el total a regularizar y el resumen por año, un mapa de en qué carpeta está cada cosa, y luego una página por año gravable con las tres columnas (declarado · lo que pasó · efecto de corregir), la línea de tiempo de movimientos con rastro bancario y **la lista de soportes con su ruta relativa**, para abrir el PDF y la carpeta al lado y cruzar sin preguntar. Se regenera en cada descarga (los intereses corren por días) y queda guardado en `00_Informe_Para_El_Contador/` dentro de la propia carpeta del socio.
  - **La carpeta del socio quedó organizada.** `organizar_carpeta()` movió **253 archivos** de `/home/mckg/Declarador/Armando/` —que tenía 42 zips y 23 PNG sueltos en la raíz— a subcarpetas numeradas: `01_Declaraciones_Renta_F210`, `02_Informacion_Exogena_DIAN`, `03_Extractos_Cuenta_Ahorros/<año>`, `04_Extractos_Tarjetas_Credito/<año>`, `05_Certificados_Tributarios_Banco/<año>`, `06_Cuotas_de_Creditos`, `07_Binance_Historial_Transacciones`, `08_Binance_Tenencia_31_Diciembre`, `10_Otras_Plataformas_Littio`, `13_Soportes_Varios`, `14_Referencia_Formulario_210`.
  - **Y con nombres que se entienden sin abrirlos:** los originales venían con números de radicado y UUID. Ahora son `F210_2021.pdf`, `Exogena_2023.xlsx`, `Tarjeta_8017_2025-04.xlsx`, `Credito_310158870_2024-08.xlsx`, `Certificado_Retencion_y_GMF_2024.xlsx`, `Reporte_Anual_Costos_2022.xlsx`, `Binance_Historial_2020-2025.csv`, `Binance_Tenencia_31dic2025.pdf`, `Littio_Captura_07.jpeg`. La ruta de cada documento se actualizó en el expediente, se escribió un `LEEME.md` con la tabla de carpetas, y se guardó un respaldo de las rutas anteriores por si hay que revertir.
  - **Lo que no se toca:** `Calculos/` y `Para_Contador/` son enlaces a carpetas compartidas con los scripts del motor; el organizador los salta. Se retiró la carpeta `Littio/` (71 capturas byte a byte idénticas a las ya organizadas) y las carpetas viejas que quedaron vacías. Un registro quedó huérfano —el `reporte_Exogena2020.xls` que en realidad era el de 2022— porque el archivo ya no estaba en disco; se eliminó del expediente y su contenido sigue en `Exogena_2022.xls`.
  - **Verificado:** 85 tests, `tsc`, build, PDF renderizado y revisado página por página, descarga probada por HTTP (200, `application/pdf`, 13 páginas) y botón probado en Chromium.
- **Archivos Modificados:** `app/tools/declarador_pdf.py` (nuevo), `app/services/declarador.py`, `app/routes_declarador.py`, `desktop/src/components/SociosPanel.tsx`, `CLAUDE.md`, `docs/team-recaps.md`; fuera del repo: toda la carpeta `/home/mckg/Declarador/Armando/` reorganizada

### 2026-09-14 05:05 - Socios: el expediente como línea de tiempo, un documento que el contador recorre año por año
- **Autor:** Armando García
- **Tipo de Cambio:** Nueva funcionalidad (paso 7 del wizard de Socios)
- **Qué se implementó:**
  - **El paso «Listo para el contador» dejó de ser una lista de pendientes y pasó a ser el documento del expediente.** Se llama ahora **«Expediente para el contador»** y presenta, en orden cronológico, un bloque por año gravable con la misma estructura en los seis: **1 · Lo que dice la declaración** (patrimonio, deudas, renta líquida, impuesto, con el aviso de que va sin criptoactivos) · **2 · Lo que realmente pasó** (tenencia en Binance al 31-dic con el detalle por moneda, ganancia o pérdida realizada, y el patrimonio bruto real del año = declarado + cripto) · **3 · Efecto de corregir** (renta e impuesto corregidos, mayor valor, sanción, intereses con sus días, total) más el respaldo bancario del año (meses de extracto y cifras de la tarjeta).
  - **Línea de tiempo real dentro de cada año,** con hitos fechados que el contador puede cruzar contra el banco: cada **compra y venta P2P** completada (monto exacto en COP, tasa implícita, método de pago y número de orden, de `evidencia_binance_p2p.csv`), cada **desembolso de crédito** con su fecha, plazo y tasa (leídos de los certificados de Bancolombia), los **retiros y depósitos** de cripto con su red, y el cierre del año con la **presentación de la declaración**. Por defecto se ven solo los relevantes (declaración, créditos y P2P sobre $1M); un clic despliega los traslados y retiros.
  - **Los soportes cuelgan del año al que pertenecen.** Cada bloque lista sus documentos con categoría, nombre y rango de años cuando uno cubre varios, y se abren con un clic; los cálculos e informes que cubren todo el período quedan en una sección aparte al final. Arriba, el total a regularizar y un índice de años que salta al bloque.
  - **Backend:** `declarador.cronologia()` (endpoint `GET /api/socios/<id>/cronologia`, aparte del expediente porque lee los CSV de evidencia y los certificados del disco), más `creditos_desde_certificados()` y `hitos_binance()`. «Copiar como texto» genera el mismo documento en texto plano para pegarlo en un correo al contador.
  - **Verificado:** 8 tests de declarador + smoke (85), `tsc`, build y recorrido en Chromium de los seis años de Armando (32 hitos en 2021, 42 soportes en 2024).
- **Archivos Modificados:** `app/services/declarador.py`, `app/routes_declarador.py`, `desktop/src/components/SociosPanel.tsx`, `docs/team-recaps.md`

### 2026-09-14 04:35 - Socios: el certificado anual de Bancolombia cubre los extractos de tarjeta que el banco ya no entrega
- **Autor:** Armando García
- **Tipo de Cambio:** Mejora técnica (plan de carga) + lectura de fuentes alternativas
- **Qué se implementó:**
  - **El mapa pedía extractos mensuales de tarjeta de 2021-2023 que Bancolombia ya no entrega** (solo conserva los últimos 12-24 meses), y los pintaba en rojo como si faltara algo conseguible. Al abrir los certificados que Armando ya había cargado se confirmó que el **«Reporte anual de costos totales»** trae, por año y por tarjeta, los consumos en COP y USD con número de operaciones, los pagos a capital e intereses, **cuántos avances en efectivo hubo** y las cuotas de manejo; y el **certificado anual de retención** trae el saldo de la tarjeta a 31 de diciembre y los intereses causados.
  - **Requisitos con `alternativas`.** Un tipo de documento puede declarar qué otra fuente lo sustituye: si falta el extracto de tarjeta de un año pero hay certificado anual, la casilla queda **«✓ cubierto · por certificado»** (verde con borde punteado, con su propia entrada en la leyenda) en vez de roja, y deja de contar como faltante.
  - **Las cifras se leen de verdad, no se asumen.** `resumen_tarjeta_certificado()` parsea el xlsx (sin LLM; suma las secciones cuando el año trae dos tarjetas) y el detalle de la casilla muestra consumos, pagos, intereses, avances, cuota de manejo, saldo a 31-dic, tarjetas y de qué archivo salió cada cifra. Dato útil que salió de ahí: **en 2021 y 2022 no hubo ningún avance en efectivo**, así que ninguna compra de cripto de esos años se fondeó por esa vía; los avances aparecen en 2023 (3), 2024 (2) y 2025 (1).
  - El renglón pasó a llamarse «Movimientos de tarjetas de crédito» y su «cómo conseguirlo» explica la ruta real: extracto mensual mientras exista, certificado tributario para lo viejo. El plan de Armando pasó de 13 faltantes a **7**, y de 25/38 a **36/43** documentos cubiertos (84 %); lo único que queda de tarjeta es 2020.
  - **Verificado:** 8 tests de declarador + smoke (85), `tsc`, build y revisión en Chromium de la fila del mapa y del detalle con las cifras de 2022.
- **Archivos Modificados:** `app/services/declarador.py`, `desktop/src/components/SociosPanel.tsx`, `docs/team-recaps.md`

### 2026-09-14 04:15 - Socios: plan de carga con matriz por año, meta calculable (activos omitidos, impuesto, sanción e intereses) y tenencias en el tiempo
- **Autor:** Armando García
- **Tipo de Cambio:** Remasterización del paso «Plan de carga» + cálculo de la corrección por activos omitidos
- **Qué se implementó:**
  - **Mapa del expediente (documento × año).** Cada tipo de documento es una fila y cada año gravable una columna; la casilla dice qué hay (verde con el nombre del archivo, ámbar «7/12 meses», rojo «falta», gris «no declaró» / «no aplica»). Clic en una casilla abre el detalle debajo: los archivos con «leer» y «abrir» y «añadir otro», o el para qué, el cómo y el botón de subir. Las filas completas se colapsan en «✓ Completo · 2020–2025»; «Qué falta» lista solo lo pendiente, ordenado por si **bloquea el cálculo** (solo el historial de Binance) o es soporte, y explica qué pasa si no se consigue. Un archivo que cubre varios años (historial Binance 2020-2025, PDF de la cuenta 2019-2024) cuenta en cada año y se puede ajustar «hasta» desde el detalle; los zip ya descomprimidos no se cuentan dos veces.
  - **«La meta» arriba de todo, con veredicto.** Dice si con lo cargado el cálculo ya está completo, y muestra cinco cifras: activos omitidos al último cierre presentado, mayor impuesto, sanción del 10 % (Art. 644), intereses de mora estimados (Art. 635, tasa editable, compuesta día a día desde cada presentación) y total si se corrige hoy. Año por año: situación (corregir / en preparación / no declarada / ¿declaraste?), activo omitido a 31-dic (renglón 29), efecto cripto (renglón 74), impuesto pagado → corregido y costo de corregir. Vías legales (588, 239-1, 641, normalización) en un desplegable.
  - **Cálculos cargados desde `Declarador/Calculos`:** `tenencia_fifo_por_anio()` reconstruye el costo fiscal de lo que quedaba en Binance al 31 de diciembre de cada año (el informe de agosto solo tenía 2025; el motor coincide al 0,3 %) y una serie mensual; `impuesto_renta_art241()` con la UVT histórica 2020-2022 reproduce el impuesto de los F210 presentados y el mayor valor del informe (2021 $2.978.062, 2023 $336.886). «Evolución de la tenencia»: barras mes a mes 2020-2025 y tabla moneda × cierre de año.
  - **Alineado con el calendario:** la declaración del año en ventana (agosto–octubre del siguiente) sale «En preparación» con el turno de años anteriores (23 de octubre), no como faltante ni como pendiente; el hallazgo automático «borrador 2025» quedó descartado. Estado nuevo de año `no_presentada` («no presenté ese año») y «no aplica» por año (exógena 2020, confirmado con la DIAN).
  - **Revisión completa de `/home/mckg/Declarador` y de los 31 zip de Bancolombia que dejó Armando** (tarjetas sep-2024 a ago-2026, reportes anuales de costos 2021-2025, certificados de retención/GMF y de crédito 2024-2025): descomprimidos en la convención de carpetas, categorías nuevas «crédito» y «certificado bancario», clasificación de zips por contenido, año de exógena leído de adentro del archivo (el `reporte_Exogena2020.xls` era el de 2022), extractos trimestrales 2025 importados (cobertura 12/12), duplicados de `Littio/` retirados del expediente. Cynthia: cifras de sus seis F210 registradas; los .xls viejos ya se leen (LibreOffice).
  - **Hallazgos nuevos en el expediente:** el motor FIFO liquida como venta las suscripciones a Earn/Staking y los traslados a billetera propia (recalculado: 2021 sube a $27,5M, 2024 baja a $35,5M — decisión del contador); los «depósitos directos» del 2024-11-14 son el regreso de los retiros del 2024-09-17. `Declarador/API2.jpeg` tiene una llave API de Binance en claro: borrar y revocar.
  - **Verificado:** 8 tests de declarador (2 nuevos: tabla Art. 241 y tenencia FIFO) + smoke, `tsc`, build, panel revisado en Chromium. Parte del código ya viajó en el auto-commit de las 23:00 (2710fa1); este commit completa el bloque.
- **Archivos Modificados:** `app/services/declarador.py`, `app/services/retenciones.py`, `desktop/src/components/SociosPanel.tsx`, `tests/test_declarador.py`, `docs/team-recaps.md`; fuera del repo: `/home/mckg/Declarador/Armando/` (Extractos Bancarios 2026, Certificados Bancolombia)

### 2026-09-14 01:30 - Socios: cuestionario interactivo, plan de carga con referencia y carpeta de Cynthia
- **Autor:** Armando García
- **Tipo de Cambio:** Remasterización del wizard de Socios + datos de Cynthia
- **Qué se implementó:**
  - **El wizard ya no pide datos que no hacen falta.** El paso 1 «Empecemos» es un cuestionario de 5 preguntas, una a la vez con botones grandes (¿cripto?, ¿declaró antes?, ¿desde qué año?, ¿otras plataformas?, ¿préstamos con familia?) más la cédula. Teléfono, cuenta bancaria, UID de Binance y carpeta se quitaron del formulario. Lo que ya se deduce del expediente aparece contestado «(deducido)» y se puede cambiar; Armando no tiene que volver a responder lo que sus 224 documentos ya dicen.
  - **Paso 2 «Plan de carga».** Según las respuestas, lista los 9 tipos de documento (F210, exógena, extractos de cuenta y de tarjeta, CSV y snapshot de Binance, evidencia API, otras plataformas, soportes de préstamos): para qué sirve, cómo conseguirlo paso a paso (DIAN, Bancolombia, Binance), cuántos tiene el socio por año y **cuántos tiene el otro socio como referencia** («así lo hizo Armando», solo cantidades, nunca cifras). Cada año tiene su botón de subir; «No aplica en mi caso» lo saca del progreso; los extractos llevan al paso 3.
  - **Carpeta de Cynthia creada** en `/home/mckg/Declarador/Cynthia/` con la misma estructura numerada que Armando (01_Declaraciones_Renta … 06_Soportes), un `LEEME.md` que explica qué va dónde y cómo se consigue cada cosa, y la plantilla `declarado_f210.json`. Su export de la API de Binance (que estaba suelto en `declaracion_impuestos_binance_titi/`) quedó copiado en `04_Binance/api_export/` y registrado (10 documentos). El botón «Crear carpeta» del plan hace lo mismo para cualquier socio nuevo.
  - **Corrección importante:** la primera importación de Cynthia se trajo los cálculos cripto de Armando (`Calculos/` estaba en la raíz del Declarador) y le sembró 6 años con ganancias que no son suyas. Se limpió su expediente, `Calculos/`, `Para_Contador/` y `balance_cripto_dian.md` quedaron enlazados dentro de `Armando/`, el importador solo recorre la carpeta de cada socio y se salta `Para_Contador/` (copias) salvo el informe principal. Los 139 documentos duplicados que eso generó en Armando se borraron (queda en 224).
  - **Verificado:** 6 tests (`tests/test_declarador.py`, uno nuevo para cuestionario/plan/referencia/carpeta), `tsc`, build y reinicio. Ambos expedientes reimportados y revisados por API.
- **Archivos Modificados:** `app/services/declarador.py`, `app/routes_declarador.py`, `desktop/src/components/SociosPanel.tsx`, `tests/test_declarador.py`, `CLAUDE.md`, `docs/agentic/modules/contabilidad.md`, `docs/team-recaps.md`; fuera del repo: `/home/mckg/Declarador/Cynthia/` (nueva), enlaces en `/home/mckg/Declarador/Armando/`

### 2026-09-14 00:40 - Libro Mayor jerárquico + Socios dentro de la contabilidad + Declarador en el panel
- **Autor:** Armando García
- **Tipo de Cambio:** Remasterización de UX + módulo nuevo (Contabilidad → Socios)
- **Qué se implementó:**
  - **Libro Mayor por etapas, no por pestañas planas.** Las 10 subvistas al mismo nivel (diario, plan de cuentas, terceros, movimientos, cuentas T, balance, asiento manual, informes, créditos, cuenta de socio) se agrupan ahora en el orden en que se trabaja: **1 Conciliar · 2 Registrar · 3 Consultar · 4 Configurar**, con un segundo nivel dentro de cada etapa. «Conciliar» lleva un **wizard de 4 pasos con estado real** (extracto reciente → emparejar automáticamente → clasificar pendientes → verificar balance) que ejecuta la acción exacta sobre el Diario de siempre; no se reescribió ninguna vista, solo se ordenaron. Arriba, un conmutador de **ámbito Empresa / Socios**.
  - **La contabilidad de los socios vive dentro de la de la empresa.** `extractos_bancarios` tiene ahora `tercero_id` (NULL = McKenna). Un socio carga **sus extractos personales** en el mismo motor, pero `_filtro_titular()` garantiza que su banco **nunca** aparezca como candidato, sugerencia ni pendiente de la conciliación de la empresa; solo se cruza con ella en el paso «Cruces» (monto ±1, fecha ±3 días, y dice si el lado McKenna ya tiene asiento).
  - **Wizard de Socios (6 pasos):** perfil fiscal → extractos personales (cobertura por mes con huecos en rojo) → cuenta con McKenna → cruces → **activos digitales** → cierre con resumen copiable para el contador. El backend calcula el estado de cada paso (hecho / parcial / pendiente) y el texto de qué falta.
  - **El Declarador de `/home/mckg/Declarador` quedó integrado.** `importar_carpeta` registra los archivos de la carpeta del socio sin copiarlos (categoría y año por nombre: F210, exógena, extractos de cuenta y de tarjeta, CSV y snapshot de Binance, Littio, cálculos, informes), siembra lo declarado en cada F210 desde `declarado_f210.json`, agrega el motor FIFO (`eventos_realizados_fifo.csv`) por año y cédula, y crea los pendientes conocidos más los que se deducen de los datos (años presentados sin cripto, borrador sin presentar). El **agente** del Declarador (contador experto en cripto) corre en el panel con herramientas —lee documentos (pdf/xlsx/csv/md), consulta el extracto personal, cruza con la empresa, registra hallazgos y actualiza años— por `llm_budget`; Gemini de respaldo sin herramientas.
  - **Privacidad:** cada socio ve SOLO su expediente (usuario ↔ tercero); únicamente la cuenta `admin` real o el token de sistema ven todos. Nivel 3 no basta (los dos socios lo tienen). Test de rutas lo verifica.
  - **Hecho en vivo:** expediente de Armando importado (217 documentos incl. 94 capturas, años 2020-2025 con efecto cripto —2021 +$19,9M, 2024 +$46,1M, 2022 −$19,3M—, 18 pendientes abiertos) y su historial bancario 2019-2024 (5.116 movimientos) cargado como extracto personal #10. Ítem nuevo en el checklist de Inicio.
  - **Verificado:** 5 tests nuevos (`tests/test_declarador.py`: filtros por titular, cruces, importación idempotente, documentos, privacidad de rutas) + los de extractos y smoke; `tsc` + `npm run build`. Un test intermedio escribió 8 terceros de prueba en la base real (el fixture no parcheaba `contabilidad_core._DB_PATH`); se borraron y el fixture quedó corregido.
  - **Pendiente:** carpeta de Cynthia (solo existe el export de la API de Binance); extractos 2025-2026 de Armando para que «Cruces» tenga rango en común con la empresa; captura de pantalla del wizard no revisada en navegador.
- **Archivos Modificados:** `app/services/declarador.py` (nuevo), `app/routes_declarador.py` (nuevo), `app/services/extracto_bancario.py`, `app/services/contabilidad_checklist.py`, `app/routes.py`, `agente_pro.py`, `desktop/src/components/SociosPanel.tsx` (nuevo), `LibroMayorPanel.tsx`, `IngresosEgresosPanel.tsx`, `CuentaSocioPanel.tsx`, `ContabilidadPanel.tsx`, `ContabilidadInicioPanel.tsx`, `desktop/src/App.tsx`, `desktop/src/stores/app.ts`, `desktop/src/lib/{contabilidadAccess.ts,panelInfo.ts}`, `desktop/src/icons/mck/paths/panels.tsx`, `tests/test_declarador.py` (nuevo), `CLAUDE.md`, `docs/agentic/modules/contabilidad.md`, `docs/team-recaps.md`; fuera del repo: `/home/mckg/Declarador/Armando/declarado_f210.json` (seed)

### 2026-09-13 21:40 - Solicitud de pago a proveedor: solo por el wizard (proveedor, SKU, factura cotejada)
- **Autor:** Armando García
- **Tipo de Cambio:** Nueva funcionalidad + regla de proceso
- **Qué se implementó:**
  - **Un pago a proveedor ya no entra como solicitud de texto libre.** En el Centro de Mando aparece «💸 Solicitud de pago a proveedor», que lleva a Contabilidad → Solicitudes de pago con el wizard abierto; y `POST /api/tickets` rechaza (400 + botón «Ir a Solicitudes de pago») una solicitud que parezca un pago a proveedor (`_parece_solicitud_de_pago`: verbo de pago + proveedor/factura/cotización; «pago de nómina» o «imprimir etiquetas» no se bloquean).
  - **Wizard de 5 pasos** para `compra_proveedor` (1435) y `factura_proveedor` (2205): **proveedor** de un solo listado (terceros del Libro Mayor con su saldo 2205 + contactos «provider» de Alegra, que se adoptan como tercero al elegirlos; `app/services/pagos_proveedor.py`) → **productos con SKU** del catálogo espejo de Alegra (búsqueda por palabras en cualquier orden; precio sin IVA e IVA por línea: el monto es la suma con IVA, que es lo que cobra la factura, y la retención va sobre la base) → **factura o cotización cotejada** (`POST /api/pagos/verificar-factura`: XML DIAN, PDF o ZIP; NIT, número, total y cada producto; sin IA; si el archivo es foto sin texto lo dice) → asiento a la vista → enviar. Sin productos o sin cotejo el backend no crea la solicitud; si el cotejo no es fiel, exige una explicación que viaja al ticket.
  - El ticket al aprobador lleva productos, subtotal/IVA/total, resultado del cotejo y asiento. Aprobador: aliado nuevo «Solicitudes de pago» (Sistemas → Aliados) o `PAGOS_APROBADOR`. Al aprobar, la factura queda como comprobante del asiento. Régimen SIMPLE del tercero → retención 0.
  - **Verificado** con la FE38029 real de Alexandra: el cotejo primero detectó productos sin IVA contra total con IVA; con IVA por línea dio fiel copia. Probado sobre copias de las bases (una prueba a medias dejó una solicitud en la base real; se borró). Wizard visto en el navegador.
  - **Pendientes conocidos:** el catálogo Alegra no trae costos unitarios (el precio se digita); una compra pagada por `compra_proveedor` y luego recibida por el correo de facturas podría duplicar inventario — el número de factura queda guardado para cruzarlo.
- **Archivos Modificados:** `app/services/pagos_proveedor.py` (nuevo), `app/services/pagos_wizard.py`, `app/routes.py`, `app/routes_tickets.py`, `app/services/tickets_db.py`, `desktop/src/components/PagosWizardPanel.tsx`, `TicketsPanel.tsx`, `desktop/src/stores/app.ts`, `CLAUDE.md`, `docs/agentic/modules/desktop-panel.md`, `.gitignore`, `docs/team-recaps.md`

### 2026-09-13 18:30 - Conciliación contador: wizard de hallazgos con TKT (cruce 350/490 ↔ 2365)
- **Autor:** Armando García
- **Tipo de Cambio:** Módulo nuevo (Contabilidad → Conciliación contador)
- **Qué se implementó:**
  - El cruce de las declaraciones del contador contra la cuenta 2365 vivía en un markdown; ahora cada inconsistencia es un **hallazgo** con clave estable en `cc_conciliacion_hallazgos` (`app/services/conciliacion_contador.py`, sin LLM) y el usuario los recorre **uno por pantalla, tipo Duolingo**: barra de avance, monto en juego, «por qué importa», «qué se sugiere», terceros del libro ese mes y soporte PDF. Decisiones: crear TKT, ya está resuelto, no aplica, marcar tercero como natural / **Régimen SIMPLE** (bandera nueva `cc_terceros.regimen_simple`), y **registrar el pago de un recibo 490** en el libro (asiento 2365 → Bancos con el PDF adjunto, idempotente por `dian:490:<n>`). Re-analizar no duplica ni pisa decisiones; lo que deja de detectarse se cierra solo.
  - Detecta: diferencias mensuales del 350 (jurídicas / naturales por separado), recibos 490 sin egreso en la 2365, retención por vencer sin 350 (con estimado del libro), 350 vencidos que no llegaron por correo, terceros con cédula tipados como jurídicos y retenciones a terceros SIMPLE. «Bajar del correo y analizar» corre en segundo plano los scripts de Gmail + extracción.
  - Hallazgos de hoy: 20. Se registró el pago de la retención de dic-2025 ($795.000, recibo 490 del 19-ene-2026, asiento #1663; no estaba en Siigo) y se abrió TKT-2026-1313 a Armando para definir con William la fecha de corte de Alegra (Alegra no tiene nada anterior al 2-sep-2026; William tiene usuario pero no registra ahí).
  - Hallazgo de fondo: Alexandra Benavides está en Régimen SIMPLE (pie de sus facturas; el XML dice `R-99-PN` igual) → las 3 retenciones de 2026 ($153.556) fueron indebidas y McKenna las asumió. Documentado en `PENDIENTES-CONTABILIDAD.md` 4-bis.
  - Tarea de aliados `conciliacion_contador`, ítem en el checklist de Inicio, permiso `conciliacion-contador` (o `libro-mayor`).
- **Archivos Modificados:** `app/services/conciliacion_contador.py` (nuevo), `app/routes_conciliacion.py` (nuevo), `agente_pro.py`, `app/services/contabilidad_checklist.py`, `app/services/tickets_db.py`, `app/routes_tickets.py`, `scripts/extraer_declaraciones_contador.py`, `desktop/src/components/ConciliacionContadorPanel.tsx` (nuevo), `ContabilidadPanel.tsx`, `ContabilidadInicioPanel.tsx`, `Settings.tsx`, `desktop/src/App.tsx`, `desktop/src/stores/app.ts`, `desktop/src/lib/{contabilidadAccess.ts,panelInfo.ts}`, `desktop/src/icons/mck/paths/panels.tsx`, `CLAUDE.md`, `docs/agentic/PENDIENTES-CONTABILIDAD.md`, `docs/agentic/modules/desktop-panel.md`, `docs/team-recaps.md`

### 2026-09-13 15:55 - Etiqueta circular: SVG vectorial, diámetro de impresión y lista centrada
- **Autor:** Cynthia
- **Tipo de Cambio:** Nueva funcionalidad + ajuste de composición
- **Qué se implementó:**
  - **Exportación a SVG vectorial (§16 del pliego), el hueco que quedaba del formato circular.** La etiqueta son dos capas —un `<svg>` con los círculos y los cuatro textos curvos, y encima bandas HTML— y el PNG las aplanaba rasterizando. `exportarSvgCircular.ts` las pasa las dos a vectores: los curvos viajan con su `textPath` intacto, las barras entran como el SVG que ya genera `lib/ean13` (sigue siendo vectorial, no una imagen), la franja de ocho colores y las viñetas salen como `<rect>`/`<circle>`, y el archivo lleva escritas sus medidas físicas (`width="53mm"`), así que la imprenta lo abre a tamaño real sin escalar nada. Las fuentes van incrustadas (`getFontEmbedCSS`), o Montserrat —que es parte del diseño— se perdería en la máquina que lo abra.
  - **Por qué no `html-to-image.toSvg`:** envuelve el HTML en un `foreignObject`, que no es vectorial de verdad y donde Montserrat suele caer a la fuente del sistema. En su lugar se lee el DOM ya maquetado: cada renglón se mide con `Range.getClientRects()` —el mismo motor CSS que se ve en pantalla decidió dónde parte cada línea— y sale como un `<text>` en su posición. Lo que se exporta es, renglón por renglón, lo que hay en la pantalla.
  - **Dos fallos que solo se vieron abriendo el SVG resultante**, no leyendo el código: (1) el serializador de HTML (`innerHTML`) no escapa las comillas de `font-family: "Segoe UI"` y el archivo salía mal formado — se serializa con `XMLSerializer` y la familia va sin comillas, que en SVG no las necesita; (2) el volcado de estilos computados descartaba el valor `none`, que es justo el `fill` de los dos círculos: sin ese atributo el relleno por defecto de SVG es negro y la etiqueta salía como un disco negro.
  - **Diámetro final de impresión (§14):** casilla «Diámetro: __ mm» junto a Formato, solo en la redonda. Cambia el tamaño **físico** del PNG, del SVG y de la impresión; el diseño se sigue maquetando 1:1 a `DIAMETRO_CIRCULAR` y no se mueve en pantalla. Con «↺» vuelve al del Formato, y mientras esté cambiado el pie de la etiqueta lo dice.
  - **Lista de aplicaciones centrada (§7), sin la viñeta suelta.** El 13-sep se había alineado a la izquierda porque, centrada en una retícula de dos columnas, un renglón corto se centraba en su columna y dejaba la viñeta lejos, contra el margen. Ahora la viñeta y el texto son **una pareja centrada**: la casilla mide lo que mide su texto, así que en «Bálsamos labiales.» la viñeta viaja pegada a él y el conjunto queda al centro, y en un texto de tres renglones la casilla crece hasta el ancho de la banda y la viñeta se queda al principio del primero. En edición la casilla vuelve a ocupar la banda entera: con un `<textarea>` del ancho de su texto, escribir sería imposible.
  - **Verificado, no supuesto:** con un banco de pruebas (esbuild + Chrome headless del servidor, fuera del repo y ya borrado) que monta el componente real, exporta y mide. El hueco viñeta↔texto sale en 6 px **en las cuatro filas** (de uno, dos y tres renglones) y la pareja queda centrada con 0 px de desvío en todas. El SVG resultante valida como XML y trae 5 `textPath`, 25 `<text>`, la franja, las barras y `53mm × 53mm`; renderizado se ve igual que la etiqueta en pantalla.
- **Lo que NO se hizo, a propósito:** el pliego pedía además un panel de formulario lateral en dos columnas (§14-15). Se descartó por la regla del 11-sep: toda plantilla se edita **sobre la etiqueta**, como la de 250/500 g. Tampoco se cambió el generador de barras a JsBarcode: `lib/ean13` ya da EAN-13 en SVG, sin dependencia externa, y es lo que hace posible que el código siga siendo vectorial al exportar.
- **Archivos Modificados:** `desktop/src/components/etiqueta-circular/exportarSvgCircular.ts` (nuevo), `desktop/src/components/etiqueta-circular/etiquetaCircular.css`, `desktop/src/components/etiqueta-ficha/ProductLabelForm.tsx`, `docs/team-recaps.md`


### 2026-09-13 14:30 - La caja "En este momento" de la portada deja de amanecer en cero
- **Autor:** Armando García
- **Tipo de Cambio:** Mejora de portada (datos + plantilla + CSS)
- **Qué se implementó:**
  - **Problema:** la caja mostraba "Pedidos hoy 4", "Ciudades con envío 77" y "Consultas atendidas hoy". Las dos cifras de "hoy" se reinician a medianoche y de madrugada valen 0 (justo lo contrario de "movimiento real"); además "4 pedidos" salía del webhook de MeLi, que cuenta muy por debajo de las ~57 órdenes/día reales de la caché de 30 días, y "consultas atendidas" sumaba mensajes del bot.
  - **Señales nuevas** (`website.py::_calcular_actividad`, con helpers `_hace`, `_ultimo_despacho`, `_tiempo_respuesta_wa`, `_ultima_consulta_respondida`, `_pedidos_30d`):
    1. **Último despacho** — ciudad y antigüedad ("Cali · ayer"): el pedido web enviado/entregado más reciente o la cobertura MeLi (`cobertura_meli.json`, que solo guarda el día: se toma a las 17:00 para no decir "hace 0 min"). Nunca nombre del cliente.
    2. **Asesor humano, te responde por WhatsApp — en 2 min**: mediana de los últimos 30 días entre el primer mensaje del cliente y la primera respuesta con `enviado_por='humano'` en `wa_chats.db`, solo lunes a viernes de 8 a 18. **El bot queda fuera a propósito**: con él la mediana da 0,1 min y no es lo que vive quien necesita a una persona. Hoy: 2,3 min sobre 579 conversaciones, 76 % en menos de 15 min. Necesita ≥20 muestras y solo se muestra si la mediana es ≤60 min; si no, la fila cae a "Última consulta técnica respondida — hace 4 h" (`casos_preventa.json`). No se presume lo que no está bien.
    3. **Pedidos del mes** (web aprobados + `meli_ventas_30d_cache.json`): 1.724, una cifra que se mueve cada día y no depende de la hora.
    4. **Ciudades con envío** se conserva (77, despachos de la semana).
  - Los campos viejos (`pedidos_hoy`, `consultas_hoy`) siguen en `/api/actividad` para el tema Pureza (`_actividad_vivo.html`); el refresco en vivo de `main.js` por `data-live` sirve igual para las claves nuevas.
  - **Bug de móvil encontrado al verificar:** una regla del 13-sep al final de `main.css` (`.hero.hero--foto` a 3 columnas) le ganaba a la media query de 900 px por venir después en el archivo, así que en el celular el hero seguía a tres columnas y la caja medía 250 px. Ahora va dentro de `@media (min-width: 901px)`. Verificado con Chromium a 1280 y 400 px: una columna, caja a todo el ancho, ninguna fila partida.
  - Valores de la caja sin versalitas espaciadas (ya no son cifras de dos dígitos): 18 px tabulares para números, 13 px para "en 2 min", check para el despacho. Copia corta para que quepa en la columna de 335 px.
- **Archivos Modificados:** `PAGINA_WEB/site/website.py`, `PAGINA_WEB/site/templates/{index.html,base.html}`, `PAGINA_WEB/site/static/css/main.css`, `tests/test_actividad_portada.py` (nuevo: `_hace`, mediana humana con DB temporal, sin muestra suficiente → nada, claves del API, la caja no usa "hoy")


### 2026-09-13 - Soportes del contador desde Gmail y ajustes de etiquetas (trabajo en curso de otra sesión)
- **Autor:** Armando García
- **Tipo de Cambio:** Herramienta + ajustes (snapshot de trabajo en curso)
- **Qué se implementó:** (recap reconstruido al hacer el commit; los cambios venían de una sesión paralela del mismo día)
  - `scripts/descargar_soportes_contador.py`: baja del Gmail de la empresa los adjuntos que envía el contador (declaraciones DIAN/SDH, auxiliares) y los organiza en `docs/contabilidad/<año>/Soportes_Contador/<AAAA-MM>/<tipo>/` (fuera de git). `scripts/extraer_declaraciones_contador.py` extrae los valores a `declaraciones_contador.json` y cruza el formulario 350 contra la cuenta 2365 (`--comparar`). Documentado en `docs/agentic/PENDIENTES-CONTABILIDAD.md` (corte 2026-09-13) y rutas excluidas en `.gitignore`.
  - Etiquetas: ajustes en el formato circular (`EtiquetaCircular.tsx`, tipos y CSS), en `Marco30ml` y en `ProductLabelForm.tsx`. El panel compila con estos cambios.
- **Archivos Modificados:** `scripts/{descargar_soportes_contador.py,extraer_declaraciones_contador.py}` (nuevos), `docs/agentic/PENDIENTES-CONTABILIDAD.md`, `.gitignore`, `desktop/src/components/{etiqueta-30ml/*,etiqueta-circular/*,etiqueta-ficha/ProductLabelForm.tsx}`


### 2026-09-13 12:40 - Correos de recuperación de compra, diagnóstico de abandono y página de mantenimiento
- **Autor:** Armando García
- **Tipo de Cambio:** Nueva funcionalidad (tienda web + operación)
- **Qué se implementó:**
  - **Correos de recuperación** (`app/tools/recuperacion_compra.py`, cron `scripts/recuperacion_compra_cron.py` cada hora, job `recuperacion_compra` en Tareas Programadas): a quien dejó un pedido web sin pagar (`pending` que expiró a `no_realizado`, o `declined`) se le escribe **máximo dos veces**: recordatorio a la hora con el carrito y un enlace `/checkout/reanudar/<token>` que lo rearma tal cual, y un último aviso a las 48 h. Nunca si ya compró después, si pidió baja, si recibió correo en las últimas 24 h o si dejó varios pedidos seguidos (uno por persona y corrida). Si MercadoPago rechazó, el correo dice el motivo y sugiere PSE, Nequi o Efecty. Baja de un clic en `/correos/baja/<token>` (Ley 1581). Todo queda en `recuperacion_envios`; `--simular` no deja rastro (la primera versión sí registraba en simulación y habría dejado sin correo real a dos clientes: corregido y borradas esas dos filas). Hoy hay 2 candidatos reales; `RECUPERACION_COMPRA_ACTIVO=0` lo apaga.
  - **El motivo real del rechazo ahora se guarda:** columna `payment_status_detail` desde el IPN de MercadoPago (`cc_rejected_insufficient_amount`, `pending_contingency`…). Los 13 rechazos históricos no lo tienen; los nuevos sí. La pantalla de pago rechazado lo muestra en palabras y sugiere medios alternativos.
  - **Diagnóstico de abandono** (`diagnostico_abandono`, `GET /api/pedidos/web/abandono`, botón "Diagnóstico de abandono" en /app → Pedidos web): embudo por estado, motivos MP, medio de pago, ticket, franja horaria, ciudad, productos que más se quedan, clientes que intentaron varias veces, embudo del navegador (carrito → checkout → clic en pagar → respuesta, por dispositivo, con errores de formulario y de cotización de envío: seis eventos nuevos en `metricas_contenido`) y resultado de los correos. Cierra con **hipótesis con evidencia**. Con los datos reales de 90 días: 62 % de conversión, 14 que fueron a pagar y no volvieron, 13 rechazos (todos PSE, sin motivo registrado por ser anteriores), 5 personas con dos intentos fallidos.
  - **Página de mantenimiento** en dos modos. (a) Bandera: `touch PAGINA_WEB/site/data/MANTENIMIENTO` y la web responde 503 con `mantenimiento/index.html` (autocontenida, logo embebido, se recarga sola, WhatsApp); los estáticos y el IPN de MercadoPago siguen. (b) Proceso apagado: `mckenna-website-mantenimiento.service` sirve la misma página en :8083 con 503 + Retry-After; **Cloudflare la deja pasar** (verificado: `https://mckennagroup.co/` devolvió 503 con la página mientras la web estuvo detenida).
  - **Trampa seria encontrada y corregida antes de dejarlo:** arrancar el respaldo directo desde `ExecStopPost` cancelaba el propio `systemctl restart mckenna-website` (dos jobs en conflicto en la misma transacción) y **la web quedaba apagada tras cualquier reinicio**. Segunda versión con `$(...)` dentro de la unidad tampoco: se expandía al parar y siempre daba "inactive", así que el respaldo se encendía 8 s después del restart y mataba a la web recién arrancada. Versión final: `ExecStopPost=+systemd-run --on-active=8 …/mckenna_web_respaldo_check.sh`, que evalúa el estado al dispararse y solo enciende el respaldo si la web no está activa ni arrancando; `Conflicts=` únicamente en la unidad de la web. Probado tres veces: restart vuelve sola, stop enciende la página, start la apaga, y diez segundos después nada cambia.
  - Unidades instaladas y `daemon-reload`; cron instalado (`bash scripts/instalar_cron_mcKenna.sh`: el archivo no tiene bit de ejecución). Panel recompilado.
- **Archivos Modificados:** `app/tools/recuperacion_compra.py` (nuevo), `scripts/{recuperacion_compra_cron.py,servidor_mantenimiento.py}` (nuevos), `scripts/systemd/{mckenna-website.service,mckenna-website-mantenimiento.service (nuevo),mckenna_web_respaldo_check.sh (nuevo)}`, `PAGINA_WEB/site/mantenimiento/index.html` (nuevo), `PAGINA_WEB/site/website.py`, `PAGINA_WEB/site/templates/{carrito.html,checkout.html,pago_respuesta.html,correos_baja.html (nuevo)}`, `app/services/{metricas_contenido.py,cron_scheduler.py}`, `app/routes.py`, `app/data/cron_frecuencias.json`, `scripts/instalar_cron_mcKenna.sh`, `desktop/src/components/{AbandonoCompraPanel.tsx (nuevo),PedidosWebPanel.tsx}`, `tests/test_recuperacion_compra.py` (nuevo), `CLAUDE.md`, `.env.example`


### 2026-09-13 04:40 - Las fotos de producto van sobre blanco puro
- **Autor:** Armando García
- **Tipo de Cambio:** Corrección visual
- **Qué se implementó:**
  - **Causa:** la foto de producto de la guía viva (`.gv-photo`) se pintaba sobre `color-mix(in srgb, var(--green-light) 22%, #fff)`, un verde translúcido. Como la imagen lleva `mix-blend-mode: multiply` —igual que en el catálogo, para que el blanco del fondo de la foto se funda con el contenedor—, ese tinte se veía **a través** de la foto. Afectaba a las 61 guías.
  - `.gv-photo` pasa a `#fff` con borde de 1 px para que no flote sobre la tarjeta; el icono de respaldo (guías sin foto) sube de un verde casi blanco a `--green-light` para que se siga viendo.
  - La miniatura de producto de las **sugerencias del buscador** iba sobre `--off-white`: ahora blanco, con el mismo `multiply` que el resto.
  - **Regla de cierre** en `main.css`: `background-color: #fff` para los ocho contenedores de foto de producto del sitio (tarjeta de tienda, tarjeta mini, galería de ficha, carrito, checkout, guía viva y los dos envoltorios heredados). Así un tinte futuro en una sección no vuelve a filtrarse por el blend.
  - **Verificado en vivo** recorriendo `/`, `/catalogo`, `/producto/<slug>`, `/carrito` y dos guías: ninguna foto de producto queda sobre un fondo que no sea blanco.
  - **`.rw-lab` del recetario** (el pictograma animado del paso: vaso, gotero, frasco) también pasa a blanco con borde, a pedido del usuario: queda un solo criterio para todos los recuadros de imagen del sitio.
- **Archivos Modificados:** `PAGINA_WEB/site/templates/{guia_viva.html,receta_detalle.html,base.html}`, `PAGINA_WEB/site/static/css/main.css`


### 2026-09-13 04:10 - Ocho artículos nuevos en el blog, con citas de PubMed verificadas una por una
- **Autor:** Armando García
- **Tipo de Cambio:** Contenido + herramienta
- **Qué se implementó:**
  - **La fuente propuesta se cambió.** Se pidió usar sci-bot.ru, que es un asistente construido **sobre Sci-Hub** (redistribuye artículos de pago sin licencia) y que además estaba en modo de solo lectura por mantenimiento. Se usó en su lugar **PubMed vía E-utilities de la NCBI**: API pública, gratuita, sin clave, y con enlaces que el lector puede abrir de forma legítima.
  - **`scripts/generar_articulos_blog.py`:** busca la evidencia, **verifica cada cita contra `esummary`** (título, revista, año, primer autor y DOI salen de la respuesta oficial, no del modelo) y **descarta el artículo completo si el texto menciona un autor/año que no esté en esa lista**. Pasa por `llm_budget` (`permitir_llamada` + `registrar_llamada` con tokens reales), cosa que `generar_posts_masivos.py` y `knowledge_agent.py` nunca hicieron. Guarda borradores en disco para poder revisarlos sin repetir llamadas.
  - **Ocho artículos publicados**, elegidos por hueco real (productos que se venden y no tenían artículo): glicerina vegetal, conservación cosmética (Sharomix 705), citrato de potasio, lanolina, D-pantenol, manteca de karité, aceite de árbol de té y ácido cítrico. Entre 754 y 953 palabras, 5 referencias con PubMed y DOI cada uno, todos enlazan a su producto y 7 de 8 a su guía viva.
  - **Coste real:** 8 llamadas a gemini-2.5-pro, **US$ 0,48 en total** (unos 4 centavos por artículo), dentro del límite automático del repositorio (25 llamadas / US$1) y muy por debajo del tope diario de US$5.
  - **Tres cosas que se corrigieron sobre la marcha:** (a) seis de las ocho consultas a PubMed devolvían **cero resultados** por encadenar demasiados términos con Y lógico ("tea tree oil terpinen-4-ol antimicrobial acne randomized" → 0 artículos); se acortaron y ahora traen entre 33 y 255. (b) El verificador marcaba como inventada la cita "Chikuma (2005)" cuando el autor real es "Hara-Chikuma": ahora acepta apellidos compuestos. (c) Cinco artículos quedaron sin enlace al producto porque el cruce exigía una presentación comprable; ahora cae a la ficha de familia.
  - **Arreglo que alcanza a todo el blog:** 21 de 36 entradas repetían el título como primer `<h2>` debajo del `<h1>` de la plantilla. Filtro `sin_titulo_repetido` en `website.py`: quita ese encabezado solo cuando repite el título, así que los posts viejos con subtítulo editorial se conservan intactos.
  - **Auditoría de compliance:** ningún artículo afirma curar, tratar ni prevenir enfermedades; los cuatro avisos del barrido eran falsos positivos ("piel sana", "prevenir la desestabilización" de una membrana, "elimina el color" al refinar). Todos cierran con el descargo de materia prima. `tests/test_articulos_blog.py` fija estas reglas.
  - **Nota:** al agregar `unicodedata` para el filtro se rompió el blog unos minutos (NameError en las 36 entradas) porque el import iba en una línea agrupada; corregido y verificado con las 36 respondiendo 200.
- **Archivos Modificados:** `scripts/generar_articulos_blog.py` (nuevo), `PAGINA_WEB/site/data/posts.json`, `PAGINA_WEB/site/website.py`, `PAGINA_WEB/site/templates/blog_post.html`, `tests/test_articulos_blog.py` (nuevo), `.gitignore`


### 2026-09-13 03:20 - Trazabilidad condensada en la portada y página /trazabilidad (Fase D, cierre del plan de portada)
- **Autor:** Armando García
- **Tipo de Cambio:** Rediseño de sección
- **Qué se implementó:**
  - **Una sola sección en la portada** (`_trazabilidad_condensada.html`): cabecera, cuatro KPI (países, referencias, fichas técnicas + COA, departamentos) y un escenario con pestañas **Mundo · origen / Colombia · destino**. Antes eran dos secciones seguidas de 1.634 + 1.263 px; ahora 1.029 px en escritorio.
  - **Los parciales existentes aprenden el modo `compacto`:** `_ruta_origen.html` y `_cobertura.html` reciben `compacto=true` y rinden solo filtros + mapa + panel (sin cabecera, cadena de custodia, documentos, banda ni "territorio por impactar"). Sin la bandera siguen igual, así que el tema Pureza no cambia.
  - **`/trazabilidad`:** página nueva con las dos experiencias completas (la que antes estaba en la portada), enlazada desde la sección condensada y en el sitemap.
  - **Celular:** el escenario nace plegado con un botón "Ver el mapa"; los KPI y las pestañas se ven siempre. Portada de **9.479 px en celular (antes 14.171 con los bloques nuevos, 8.842 en la original) y 5.427 en escritorio (antes 7.294 / 5.114)**, ahora con buscador, confianza, más vendidos, aprende, cómo comprar y blog incluidos.
  - **Tema:** `cobertura` sale de `_ORDEN_CLASICO` y de `tema_web.json` (va como pestaña dentro de `ruta_origen`); si un JSON viejo la trae, no se rompe.
  - **Trampa corregida:** el cargador diferido de mapas guardaba un solo `<g>` por sección, y con Mundo y Colombia en la misma sección solo cargaba el último; ahora guarda una lista por anfitrión. Verificado en vivo: tierra y 33 departamentos cargan, el panel de país abre y la pestaña Colombia colorea 25 departamentos.
  - **Cierre del plan de portada:** las cuatro fases (orden, peso, bloques nuevos, trazabilidad) quedan hechas entre el 12 y el 13 de septiembre.
- **Archivos Modificados:** `PAGINA_WEB/site/templates/{_trazabilidad_condensada.html,trazabilidad.html}` (nuevos), `PAGINA_WEB/site/templates/{_ruta_origen.html,_cobertura.html,index.html,base.html}`, `PAGINA_WEB/site/static/css/main.css`, `PAGINA_WEB/site/static/js/{portada.js,trazabilidad.js}`, `PAGINA_WEB/site/website.py`, `PAGINA_WEB/site/data/tema_web.json`, `app/tools/tema_web.py`, `tests/{test_trazabilidad_condensada.py (nuevo),test_portada_orden.py}`


### 2026-09-13 02:30 - Portada: buscador, confianza con cifras, más vendidos reales, recetas y guías, cómo comprar y blog (Fase C)
- **Autor:** Armando García
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - **Hero con buscador:** formulario a `/tienda?q=` con sugerencias en vivo desde `GET /api/buscar` (todas las palabras deben estar en nombre, título MeLi o categoría; catálogo en memoria, sin IA; una sugerencia por familia), chips de búsqueda que salen de los más vendidos (o de `hero.chips` en el tema si se definen) y tres botones en fila: comprar, cotizar por WhatsApp, cotizar importación. Una regla del Studio apilaba los botones en columna con ancho fijo; se anula para el hero.
  - **Barra de confianza** (`confianza_portada`): cinco hechos con número calculado en el servidor: fichas técnicas y COA publicados, departamentos con despachos, medios de pago y horario. Sección nueva `confianza`, reemplaza en la práctica a `features` (que sigue apagada).
  - **Más vendidos reales:** `mas_vendidos_portada()` cruza `meli_ventas_30d_cache.json` (por MCO, incluidas las presentaciones) con los pedidos web aprobados de 30 días (`orders.db`, por slug/ref), agrupa por familia y descarta agotados y solo-vitrina. La tarjeta muestra "N vendidos este mes" solo si N ≥ 5 (`MAS_VENDIDOS_MIN_UNIDADES`) y "Quedan pocas" si el stock es de 1 a 5. Pestañas Más vendidos / En oferta (la lista de 10 % de siempre); cache de 10 minutos. Hoy: aceite de ricino 202, citrato de magnesio 107, glicerina 91, Sharomix 66, creatina 56.
  - **Aprende a formular** (`aprende_portada`): la guía viva del primer producto más vendido que tenga guía y tres recetas rotadas por día del año, una por categoría, con el paso 1 visible.
  - **Cómo comprar en cuatro pasos** con la cadena animada de la trazabilidad; textos editables en el tema (`como_comprar.pasos`). **Blog:** los tres últimos posts, extracto armado desde el contenido (el campo `extracto` traía restos de etiquetas: "h2Zinc...").
  - **Tema:** secciones nuevas `confianza`, `aprende`, `como_comprar`, `blog` registradas en `_ORDEN_CLASICO`, `secciones` y textos por defecto; `tema_web.json` actualizado. `destacados` cambia su título a "Lo que más se lleva este mes" y gana `tab_vendidos` / `tab_oferta`.
  - **Tres correcciones tras verla en pantalla:** el carrusel "En oferta" se mostraba debajo del grid aunque estuviera `hidden` (`.dest-track` forzaba `display:flex`); las etiquetas de vendidos y stock se pisaban; el paso de "cómo comprar" repetía el título.
  - **Medido:** portada de 7.294 px en escritorio con cuatro bloques más de contenido. Lo que sigue pesando en alto es trazabilidad + cobertura (2.900 px en escritorio, 5.000 en celular): eso es la Fase D.
- **Archivos Modificados:** `PAGINA_WEB/site/website.py`, `PAGINA_WEB/site/templates/{index.html,base.html}`, `PAGINA_WEB/site/static/css/main.css`, `PAGINA_WEB/site/static/js/portada.js` (nuevo), `PAGINA_WEB/site/data/tema_web.json`, `app/tools/tema_web.py`, `tests/test_portada_bloques.py` (nuevo)


### 2026-09-13 01:20 - Los mapas de la portada salen del HTML y se cargan al acercarse (cierre del pendiente de peso)
- **Autor:** Armando García
- **Tipo de Cambio:** Rendimiento
- **Qué se implementó:**
  - La geometría del mapamundi (`_world_land.svg.html`, 59 KB) y de Colombia (`_colombia_map.svg.html`, 53 KB) viajaba dentro del HTML de la portada en cada visita. Ahora son archivos estáticos en `static/maps/` (sin el comentario Jinja) y los `<g>` que las contenían nacen vacíos con `data-lazy-svg`.
  - `trazabilidad.js` observa la sección de cada mapa con un margen de 900 px, trae el fragmento por `fetch`, lo inyecta y dispara `lazysvg:loaded`. La inicialización de Colombia (colorear departamentos, tooltips, pulsos, "ir a") se envolvió en `initColombia()` y arranca recién cuando llega la geometría; el mapamundi no necesitaba cambio porque sus pines y rutas son marcado del servidor y la tierra se usa por referencia (`<use href="#tz-land">`).
  - Los datos de interacción (rutas por país 42 KB, departamentos 7 KB) siguen en línea: el JS los necesita al arrancar y comprimen bien.
  - **Medido:** HTML de la portada de **260 KB a 150 KB**; primera carga sin los mapas **488 KB propios**. Verificado en vivo que al hacer scroll los 33 departamentos aparecen (25 coloreados, 7 con pulso semanal), el panel de país abre al tocar un pin y el "ir a" del panel de Colombia sigue mostrando el tooltip.
  - Con esto queda cerrado lo pendiente de la Fase B. La Fase D (una sola sección de trazabilidad con pestañas y página propia) sigue siendo trabajo de diseño, no de peso.
- **Archivos Modificados:** `PAGINA_WEB/site/static/maps/{world_land,colombia_map}.svg.html` (nuevos), `PAGINA_WEB/site/templates/{_ruta_origen.html,_cobertura.html,base.html}`, `PAGINA_WEB/site/static/js/trazabilidad.js`, `tests/test_mapas_lazy.py` (nuevo)


### 2026-09-13 00:40 - Web más liviana: logo, fuentes, ilustración e iconos (Fase B del plan de portada)
- **Autor:** Armando García
- **Tipo de Cambio:** Rendimiento (sin cambios de diseño)
- **Qué se implementó:**
  - **Medición previa honesta:** Cloudflare ya comprime HTML y CSS con brotli (la portada de 260 KB viaja en 72 KB), así que el peso real estaba en lo que no se comprime: el logo `isotipo.png` de **584 KB** (1200×894 para un header de 54 px), 13 Montserrat en **TTF de 280 KB** cada una, la ilustración del hero en **PNG de 230 KB** y los iconos Phosphor desde **unpkg.com** (origen externo, 143 KB de fuente con 1.530 glifos).
  - **`scripts/optimizar_assets_web.py`** (reproducible, pasos saltables con `--sin-*`): logo a `isotipo-web.png` de 320 px y 15 KB (el original queda para PDF, correo y pipelines de Facebook); fuentes a **woff2 con subconjunto latino, ~23 KB cada una** (`fonts-montserrat.css` reescrito con el TTF de respaldo); ilustración a **WebP sin pérdida de 1000 px y 64 colores, 54 KB** (es dibujo de línea: pesa menos que el WebP con pérdida y no ensucia los trazos) y `tema_web.json` apuntando al .webp; Phosphor autoalojado en `static/vendor/phosphor/regular/` y **subconjunto con solo los 148 iconos que usa el sitio: 17 KB + 7 KB de CSS**.
  - **`base.html`:** iconos locales, logo liviano, `preload` de Montserrat Regular y Bold. `_documento_tecnico.html` (propiedad de cynthia, editado con sudo) usa el logo liviano en sus tres cabeceras.
  - **Resultado medido en la portada:** de 2.152 KB sin comprimir en 24 peticiones a **976 KB**, y **612 KB reales transferidos**; un solo origen propio (mlstatic para fotos de producto sigue igual). LCP en torno a 1,1 s en la misma red.
  - **Dos trampas encontradas:** (a) el primer rastreo de iconos solo veía `ph-*` y dejó en blanco `bowl-food`, `plant` y `grains`, que viven como nombres sueltos en dicts de Jinja; ahora el rastreo toma cualquier literal entre comillas y lo cruza contra el mapa real de Phosphor, y `tests/test_assets_web.py` falla si alguien agrega un icono sin regenerar el subconjunto. (b) `beaker` no existe en Phosphor 2.1.1: la subcategoría "Solventes" de /cotizar salía sin icono desde antes; pasa a `test-tube`.
  - **Pendiente:** el HTML de la portada sigue trayendo los dos mapas SVG embebidos (260 KB, 72 KB brotli); salen del HTML en la Fase D con la trazabilidad condensada. `main.css` (163 KB, 32 KB brotli) se podría partir por página, no urgente.
- **Archivos Modificados:** `scripts/optimizar_assets_web.py` (nuevo), `PAGINA_WEB/site/templates/{base.html,_documento_tecnico.html}`, `PAGINA_WEB/site/static/css/fonts-montserrat.css`, `PAGINA_WEB/site/static/fonts/montserrat/*.woff2` (13 nuevos), `PAGINA_WEB/site/static/img/{isotipo-web.png,isotipo-web.webp}` (nuevos), `PAGINA_WEB/site/static/uploads/fondos/*.webp` (nuevo), `PAGINA_WEB/site/static/vendor/phosphor/regular/*` (nuevo), `PAGINA_WEB/site/data/tema_web.json`, `app/services/proveedores_db.py`, `tests/test_assets_web.py` (nuevo)


### 2026-09-12 23:30 - Portada: orden comercial primero, cta de cierre encendida, categorías con mínimo y contadores reales (Fase A del plan de portada)
- **Autor:** Armando García
- **Tipo de Cambio:** Corrección de estructura (sin código nuevo de peso)
- **Qué se implementó:**
  - **Plan de portada publicado** (artefacto "Portada McKenna") medido en vivo con Chromium: 8.842 px de alto en celular, 2,15 MB en 24 peticiones, HTML de 260 KB, sin buscador en el hero, sin cierre. Nueve bloques propuestos y cuatro fases; esta es la A.
  - **Orden del tema Clásico:** `hero → banners → features → categorías → destacados → trazabilidad → cobertura → cta`. Antes trazabilidad y cobertura (2.900 px) iban antes que el catálogo. Cambiado el default en `tema_web.py` y el estado persistido en `tema_web.json`.
  - **La cta de cierre existía pero nacía oculta** por tres vías distintas: `secciones.cta: False` en los defaults, `nodos.cta.hidden` en el layout por defecto y una regla en `_normalizar_layout` que la volvía a ocultar aunque el JSON no la tuviera. Se quitan las tres; si alguien la apaga desde el Studio, se respeta.
  - **Categorías:** `lineas_para_portada()` omite líneas con menos de 3 productos ("Agro" tenía 1). Siguen en /catalogo y en la nav de la tienda.
  - **Contadores con valor real en reposo:** los KPI de trazabilidad y cobertura imprimían "0" y solo subían al entrar en pantalla; en previews y capturas la empresa tenía "0 países de origen". Ahora el HTML trae el número y el JS solo lo anima.
  - **Efecto medido tras publicar:** el orden en el HTML servido es el nuevo, "Agro" desapareció, los contadores traen 25 / 200 / 117 / 56 / 25 / 153, y la página cierra con "¿Necesitas una cotización?". El alto subió unos 460 px por la cta; la reducción grande (mapas fuera del HTML, trazabilidad condensada) es la Fase D.
  - Se reiniciaron `mckenna-website` y `agente-pro` (el Studio del panel usa el mismo `tema_web.py` y habría vuelto a ocultar la cta al guardar).
- **Archivos Modificados:** `app/tools/tema_web.py`, `PAGINA_WEB/site/data/tema_web.json`, `PAGINA_WEB/site/website.py`, `PAGINA_WEB/site/templates/{_ruta_origen.html,_cobertura.html}`, `tests/test_portada_orden.py` (nuevo)


### 2026-09-12 - Alegra: medio de pago real ante la DIAN, notificación FAZ09 y alérgenos en la ficha técnica
- **Autor:** Armando García
- **Tipo de Cambio:** Corrección + herramienta
- **Qué se implementó:** (recap reconstruido desde los comentarios del código al hacer el commit)
  - **Medio de pago DIAN:** hasta el 12-sep-2026 toda factura salía con `paymentMethod: CASH` (efectivo) aunque el cobro fuera digital; las 150 facturas FE1..FE359 lo declararon así. `app/services/alegra.py` mapea ahora el medio real de la pasarela (Mercado Pago, PSE, botón Bancolombia, tarjetas, Efecty) y el default pasa a `CREDIT_TRANSFER`. Lo usan `facturacion_directa.py`, `meli_autofactura_entrega.py` y `web_pedidos.py`. Variables documentadas en `.env.example`.
  - **FAZ09 no es un fallo:** la DIAN acepta con notificación cuando los ítems no traen código UNSPSC; en Alegra se ve con alerta y parecía emisión fallida. Los reportes a WhatsApp ahora lo dicen. `scripts/alegra_codigos_unspsc.py` asigna `productKey` a los ítems (548 sin código). `tests/test_alegra_medio_pago.py`.
  - **Ficha técnica:** casillas propias de alérgenos y conservación en `ficha_tecnica.py`, `documento_cientifico.py`, las plantillas PDF y `FichaTecnicaForm.tsx`; ajustes de acceso y catálogo en Studio visual (`studioVisualAccess.ts`, `EtiquetasStudioCatalogo.tsx`).
- **Archivos Modificados:** `app/services/{alegra.py,documento_cientifico.py,ficha_tecnica.py}`, `app/templates/{documento_completo_pdf.html,ficha_tecnica_pdf.html}`, `app/tools/{facturacion_directa.py,meli_autofactura_entrega.py,web_pedidos.py}`, `desktop/src/components/{FichasTecnicasPanel.tsx,documentos/FichaTecnicaForm.tsx,etiquetas/EtiquetasStudioCatalogo.tsx}`, `desktop/src/lib/studioVisualAccess.ts`, `docs/agentic/modules/facturacion-meli-alegra.md`, `scripts/alegra_codigos_unspsc.py` (nuevo), `tests/test_alegra_medio_pago.py` (nuevo), `.env.example`


### 2026-09-12 22:45 - Métricas de uso de recetas y guías vivas (Fase 4, cierre del plan)
- **Autor:** Armando García
- **Tipo de Cambio:** Nueva funcionalidad (medición)
- **Qué se implementó:**
  - **Nueve eventos con lista cerrada** en `app/services/metricas_contenido.py`: receta abierta / paso / terminada / al carrito (con unidades), guía abierta / dosificador / pH / clic a receta, y clic en "Aprende a usarlo" desde la ficha de producto. Cualquier otro nombre se descarta.
  - **Captura en el navegador** (`static/js/contenido-eventos.js`, `sendBeacon`, nunca bloquea): solo cuenta sesiones con JavaScript, así que los robots quedan fuera. La sesión es un id aleatorio en `sessionStorage` (muere al cerrar la pestaña, no identifica a nadie). El wizard y la guía viva lo llaman una sola vez por evento y sesión.
  - **Ingesta:** `POST /api/eventos-contenido` en website.py (:8083), sin auth, sanea slug y sesión, limita a 120 eventos por IP y minuto, responde 204. **Almacén:** SQLite `app/data/metricas_contenido.db` en modo WAL (escribe :8083, lee :8081), en `.gitignore`.
  - **Lectura para el panel:** `GET /api/web/metricas-contenido?dias=N` en agente_pro (:8081, Bearer): embudo del recetario por sesiones (abrieron → empezaron → terminaron → al carrito), ranking de recetas y guías, clics desde producto y serie diaria.
  - **Panel:** /app → Vitrina Web → pestaña **"Uso de guías y recetas"** (7/14/30/90 días) con el embudo, cifras de guías, barras por día y dos tablas. Panel recompilado y `agente-pro` reiniciado.
  - **Por qué sesiones y no eventos:** una persona que repite un paso tres veces no son tres usos; el embudo cuenta sesiones distintas por etapa. Los tests fijan ese criterio.
  - **Cierre del plan UX del 12-sep:** las cuatro fases quedan hechas el mismo día. Lo que sigue es leer estas cifras en dos semanas y decidir con datos si el wizard vende o solo entretiene.
- **Archivos Modificados:** `app/services/metricas_contenido.py` (nuevo), `PAGINA_WEB/site/website.py`, `PAGINA_WEB/site/static/js/{contenido-eventos.js (nuevo),recetario-wizard.js,guia-viva.js}`, `PAGINA_WEB/site/templates/{receta_detalle.html,guia_viva.html,producto.html}`, `app/routes.py`, `desktop/src/hooks/useVitrinaWeb.ts`, `desktop/src/components/VitrinaWebPanel.tsx`, `desktop/dist/*`, `.gitignore`, `tests/test_metricas_contenido.py` (nuevo), `docs/agentic/modules/guias-vivas-recetario.md`


### 2026-09-12 22:35 - Cruces producto ↔ guía viva ↔ receta (Fase 3)
- **Autor:** Armando García
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - **Ficha de producto → "Aprende a usarlo":** sección nueva entre la documentación técnica y los relacionados, con la tarjeta de la guía viva (KPIs: concentración máx., pH, temperatura, dosificador, nº de preguntas) y tarjetas de las recetas que usan el producto con el **paso 1 visible**, ingredientes, pasos y rendimiento. Se muestra en 65 de los 179 productos con guía y en 61 con recetas; en el resto no aparece nada (no hay relleno).
  - **Receta terminada → guías de sus activos:** el panel "Listo" del wizard enlaza la guía viva de cada ingrediente (46 de 48 recetas tienen al menos una). También en el bloque de texto plano.
  - **Guía viva → recetas que la usan:** módulo "Recetas con <ingrediente>" y entrada en la nav pegajosa (50 de 61 guías).
  - **Un solo cruce, tres direcciones:** todo sale de `buscar_contenido_relacionado()` (el que ya usaba `/verificar`), enriquecido con los campos que las tarjetas necesitan, más tres helpers: `contenido_para_producto(nombres)`, `guias_para_receta(r)` y `recetas_para_guia(g)`.
  - **Trampa corregida antes de publicar:** el cruce descartaba las letras sueltas y la receta del sérum de vitamina C enlazaba la **guía de vitamina E**. Ahora `_claves()` conserva las letras sueltas (salvo conjunciones y/o/u), igual que ya se había corregido en el migrador de recetas. `tests/test_cruces_producto_guia_receta.py` fija ese caso.
  - **Pendiente (Fase 4):** métricas de uso (dosificador usado, paso completado, "me falta" al carrito).
- **Archivos Modificados:** `PAGINA_WEB/site/website.py`, `PAGINA_WEB/site/templates/{producto.html,receta_detalle.html,guia_viva.html}`, `tests/test_cruces_producto_guia_receta.py` (nuevo), `docs/agentic/modules/guias-vivas-recetario.md`


### 2026-09-12 22:05 - Guía viva: las 61 guías de uso pasan a módulos interactivos (Fase 2)
- **Autor:** Armando García
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - **Extractor sin IA** `scripts/extraer_ficha_rapida_guias.py`: lee el HTML de las siete secciones de cada guía en `guias.json` y deja en `viva` los datos que los módulos necesitan: filas de la tabla de concentraciones (aplicación, mín, máx, tipo), rango de pH, temperatura que no se debe superar, pares Estado/Solubilidad/INCI, compatibles e incompatibles (lista o prosa), pasos de incorporación con fase y temperatura, condiciones de almacenamiento, FAQ y normativa. Cobertura real: concentraciones 58/61, incorporación 61/61, FAQ 61/61, compatibilidad 57/61, pH 33/61, temperatura 26/61. **Lo que no aparece explícito no se inventa**: ese módulo no se muestra. `--confirmar` para escribir, deja `.bak`; `viva.manual: true` protege correcciones a mano.
  - **Plantilla `guia_viva.html`** con ficha rápida (foto, KPIs), nav pegajosa por módulo y seis módulos: **dosificador** (aplicación → rango; % × lote → gramos, con aviso si se sale del rango), **medidor de pH** con la zona de trabajo marcada, **compatibilidad** a dos columnas, **cadena de incorporación** con el mismo trazo animado de "Del origen a tu fórmula" (recorrido automático que se detiene al tocar), conservación, FAQ, normativa y CTA al producto. El texto completo original y la bibliografía quedan en un bloque plegable al final (SEO y respaldo).
  - **Ruta:** `guia_detalle()` sirve la guía viva solo si `_guia_es_viva()` ve pasos de incorporación y además concentraciones o compatibilidad; si no, la plantilla clásica. `viva.desactivar: true` fuerza la clásica para una guía puntual. Hoy las 61 cumplen.
  - **Tres correcciones tras verla en pantalla:** el fondo hexagonal se pintaba como banda arriba (una regla `.gv > *` le ponía `position: relative` al SVG absoluto); "iones de Fe y Cu (catalizan…)" se partía en dos por el " y "; los títulos de los nodos salían como "Disolver el" (ahora el verbo solo).
  - **Codificación:** `guia-viva.js` es ASCII puro con escapes `\uXXXX`; la plantilla usa entidades HTML para ≤, °, –.
  - **Pendiente (Fases 3-4):** cruces producto ↔ guía ↔ receta en `producto.html` y métricas de uso (dosificador usado, paso completado, "me falta" al carrito).
- **Archivos Modificados:** `PAGINA_WEB/site/templates/guia_viva.html` (nuevo), `PAGINA_WEB/site/static/js/guia-viva.js` (nuevo), `PAGINA_WEB/site/website.py`, `PAGINA_WEB/site/data/guias.json`, `scripts/extraer_ficha_rapida_guias.py` (nuevo), `tests/test_guia_viva.py` (nuevo), `docs/agentic/modules/guias-vivas-recetario.md`


### 2026-09-12 21:50 - Guías vivas y recetario paso a paso (Fase 0 + Fase 1 del plan UX de la web)
- **Autor:** Armando García
- **Tipo de Cambio:** Nueva funcionalidad + corrección de marca
- **Qué se implementó:**
  - **Plan UX publicado** (artefacto "Guías Vivas McKenna") con diagnóstico de la web en vivo y dos prototipos funcionales: receta tipo wizard y guía interactiva (dosificador, medidor de pH, compatibilidad, cadena de incorporación). Cinco fases; esta sesión cubre la 0 y la 1.
  - **Fase 0, marca:** `guia_detalle.html` fijaba su propia paleta verde (`#2E8B7A`/`#143D36`) en un `:root` propio y la guía cambiaba de marca frente a la portada (teal `#0c6069`). Ahora hereda `--green*` del tema activo; el `color` por guía de `guias.json` (paleta vieja) se traduce a tonos del tema en `guias.html` y `guia_detalle.html`. Las tarjetas del recetario usaban los mismos hex viejos: pasan a `var(--green*)`.
  - **Fase 0, contenido en reposo:** los bloques `.reveal` nacían en `opacity: 0` y las capturas/previews de la portada mostraban un hueco de ~1.000 px. Ahora son visibles por defecto y solo se ocultan bajo `html.js-reveal`, que un script inline en `<head>` marca antes del primer pintado si hay `IntersectionObserver` y no hay `prefers-reduced-motion`. Versiones de `main.css`/`main.js` subidas a `20260912a`.
  - **Fase 1, recetas v2:** `scripts/migrar_recetas_v2.py` (sin IA, `--confirmar` para escribir, deja `.bak`) añade `slug`, convierte cada paso a `{texto, accion, min}` (acción por el verbo que aparece primero en el texto; `min` solo si el texto trae tiempo explícito) y cruza ingrediente → producto de `cache.json` con el criterio conservador de `/verificar` (todas las palabras clave presentes; se prefiere el nombre con menos palabras de sobra, se excluyen kits con `+`, y la presentación comprable más pequeña; familia → `familia: true`). Resultado: 193 de 219 ingredientes vendibles enlazados, 40 de uso propio, 26 sin producto (bergamota, sándalo, DMSO, arcillas, B12: no están en la tienda). **Trampa corregida antes de guardar:** las letras sueltas se descartaban y "Vitamina C" cruzaba con "VITAMINA E".
  - **Ruta `/recetario/<slug>`** (`receta_detalle.html` + `static/js/recetario-wizard.js`): un paso por pantalla con riel, barra de progreso, pictograma SVG animado por acción (8 verbos), parámetros del paso, temporizador, cantidades escaladas por paso, Wake Lock (pantalla encendida), lectura en voz alta (SpeechSynthesis), teclado y gestos. Paso 0 escala la receta y marca "me falta"; JSON-LD `Recipe`; bloque `<details>` con el texto completo para SEO y sin JS. Las tarjetas de `/recetario` ahora son enlaces; el modal desapareció. Sitemap con las 48 recetas y `buscar_contenido_relacionado` apunta a la URL propia.
  - **`POST /carrito/agregar-lote`** (JSON `{items:[{slug,qty}]}`): mete varios productos de una vez, reporta avisos por ítem (agotado, familia, stock corto) sin abortar. Comparte `_sumar_al_carrito()` con `/carrito/agregar` y un test verifica que ambos caminos dejan el mismo ítem.
  - **Codificación:** el JS del wizard es ASCII puro (símbolos como `\u2713`) y el artefacto del plan se publicó con entidades HTML, tras un reporte de caracteres raros.
  - **Pendiente (Fases 2-4):** guía viva con `ficha_rapida` extraída de las secciones, cruces producto ↔ guía ↔ receta en `producto.html`, y métricas de uso del wizard. Los 26 ingredientes sin producto se pueden fijar a mano en `recetas.json` con `"slug": "...", "manual": true`.
- **Archivos Modificados:** `PAGINA_WEB/site/templates/{base.html,guias.html,guia_detalle.html,recetario.html,receta_detalle.html (nuevo)}`, `PAGINA_WEB/site/static/{css/main.css,js/main.js,js/recetario-wizard.js (nuevo)}`, `PAGINA_WEB/site/website.py`, `PAGINA_WEB/site/data/recetas.json`, `scripts/migrar_recetas_v2.py` (nuevo), `tests/test_recetario_wizard.py` (nuevo), `docs/agentic/modules/guias-vivas-recetario.md` (nuevo)


### 2026-09-12 17:04 - Etiqueta circular 53 x 53 mm (Ceras y mantecas)
- **Autor:** Armando García
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - Formato nuevo **«Circular 53»** (53 × 53 mm) con su propia composición radial, en `desktop/src/components/etiqueta-circular/`. Se elige como cualquier otro formato; la categoría «Ceras y mantecas» ya existía. No choca con los «Circular» (55 × 55) y «Circular 70» que ya estaban.
  - **Geometría derivada del diámetro**, no a ojo: margen exterior 3,5 %, anillo entre el borde gris y el círculo naranja 6 %, zona segura central 80 %. Lienzo cuadrado con `border-radius: 50%` — relación 1:1 siempre, nada se sale ni se deforma al escalar.
  - **Cuatro textos curvos en SVG `textPath`** (no letras rotadas sueltas), sobre tramos del anillo que no se tocan: aviso de control de calidad 28°-152° (derecha), registro sanitario 168°-232° (abajo-izquierda, arco invertido para que se lea del derecho), razón social y ciudad 238°-302° (izquierda, dos renglones), y el nombre del producto en su propio arco ya dentro del círculo naranja.
  - **Bloque central en cinco bandas** de ancho calculado para lo que cabe a cada altura del círculo: descripción (540 px), «Aplicaciones:», lista con viñetas (650 px), código de barras con la franja decorativa de 8 colores, y el peso neto en el color de acento.
  - **Se edita sobre la etiqueta**, como los demás formatos: los textos rectos en el sitio; los curvos con un clic que abre su casilla en un popover anclado al propio texto (no cabe un `<input>` sobre una curva). La lista de aplicaciones lleva «✕» por fila y «+ Añadir aplicación» — se guarda como una aplicación por renglón en `data.aplicaciones`.
  - **Ajuste automático con aviso:** cada texto baja de medio en medio píxel hasta caber y, si ni al mínimo entra, se marca en rojo. Los curvos se miden contra el LARGO DEL ARCO (`getComputedTextLength`), no contra una caja: ahí no hay caja que medir.
  - Campos nuevos en `ProductLabelData`: `descripcionProducto`, `aplicaciones`, `registro` (de producto) y `aplicacionesTitulo`, `empresa`, `controlCalidad` (de plantilla). `PopoverFlotante` acepta anclas SVG (`Element`, no `HTMLElement`).
  - **Límite conocido:** §12 del pliego pedía que el aviso empezara arriba a la derecha, terminara abajo y nunca saliera invertido; en un círculo eso es incompatible (el texto que mira hacia afuera se da vuelta pasados los 150°). Se cortó el tramo en 152° para que ninguna letra quede de cabeza. Tampoco se hizo la exportación a SVG vectorial: el proyecto exporta PNG e imprime con `html-to-image`, que ya sirve para este formato.
- **Archivos Modificados:** `desktop/src/components/etiqueta-circular/{EtiquetaCircular.tsx,etiquetaCircularTypes.ts,etiquetaCircular.css}` (nuevos), `desktop/src/components/etiqueta-ficha/{ProductLabelForm.tsx,productLabelTypes.ts,PopoverFlotante.tsx}`, `app/data/etiquetas_tipos.json`, `docs/team-recaps.md`


### 2026-09-12 17:04 - Conservación y alérgenos de la etiqueta salen por fin de la ficha técnica
- **Autor:** Armando García
- **Tipo de Cambio:** Corrección de fondo (autollenado de etiquetas)
- **Qué se implementó:**
  - **Causa:** el extractor buscaba la conservación en `datos.almacenamiento`, `empaque.almacenamiento` y `estabilidad`. **Ninguna de las 64 fichas completas tiene esos campos.** El formulario FT+COA+SDS guarda «Conservación y almacenamiento» en `datos.conservacion` y los alérgenos en `datos.alergenos` — dos campos que el extractor nunca miró. Resultado: Conservación salía siempre vacía y, como el parche escribe `""` en lo que la ficha no trae, enlazar una ficha además BORRABA lo que el operador hubiera escrito.
  - La conservación sale ahora de `datos.conservacion` y va **tal cual**: la escribió una persona para ese producto, no se resume. Solo si la ficha no la trae se cae al bloque `ALMACENAMIENTO:` de las recomendaciones de la SDS (donde vive en 19 fichas, mezclada con las frases P) y ahí sí la resume `sintetizarConservacion`. `limpiarFrase` quita los códigos precautorios de cabeza (`P402`, `P403+P233:`): son de la SDS, no de la etiqueta.
  - Campos nuevos del extractor: `alergenos`, `descripcion` y `aplicaciones` (la ficha las guarda como lista; la etiqueta las quiere una por renglón). Con eso la etiqueta circular llena sola su descripción y su lista de aplicaciones.
  - **Regla nueva en el parche:** los campos de plantilla (alérgenos, contacto, web, título de aplicaciones…) no se vacían. Si la ficha los trae, mandan; si no, se conserva el valor de la familia. Los de producto siguen vaciándose, como estaba, para no arrastrar el dato de otro producto.
  - Medido contra las 64 fichas reales: **21 llenan conservación** (antes 0) y **1 llena alérgenos** (ajonjolí negro). El resto es dato por diligenciar, no código: 42 fichas no dicen nada de conservación en ninguna parte del YAML y 17 no traen país de origen.
- **Archivos Modificados:** `desktop/src/lib/{fichaTecnicaCampos.ts,fichaTecnicaAplicar.ts}`, `desktop/src/components/etiqueta-ficha/productLabelTypes.ts`, `docs/team-recaps.md`


### 2026-09-12 14:40 - Guías de envío invisibles en el menú + dos unidades systemd peleando por el 8081
- **Autor:** Armando García
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - **El botón de Guías de envío no aparecía para nadie de despachos** (TKT-2026-1307, abierto por Jerry). El panel existía y era accesible; lo que faltaba era el botón. La regla de quién puede ver `guias-envio` estaba escrita **dos veces**: `App.tsx::puedeVerPanel` (decide si el panel se renderiza) la tenía correcta — admin, permiso propio, `pedidos` o `empaque` — pero `lib/panelAccess.ts::puedeVerSeccionPanel`, que es la que usan el menú «Ir a…», las pestañas del hub Atención y el MobileHub, no la tenía y caía al genérico `Boolean(p["guias-envio"])`. Como **ningún usuario tiene ese permiso explícito** en `tickets.db` (jerry, stella y vitor solo tienen `pedidos`/`empaque`), el botón desaparecía de todos los menús. La regla vive ahora en una sola función exportada, `puedeVerGuiasEnvio()`, y App.tsx delega en ella: si un panel decide su visibilidad en dos sitios, tarde o temprano divergen y el síntoma es invisible desde el código (nada falla, simplemente no hay botón).
  - **Un solo dueño del puerto 8081.** `agente-pro.service` y `mckenna-agente.service` lanzan el mismo `agente_pro.py`; ambas estaban instaladas y la segunda llevaba desde el **8-sep en `failed`** con `Address already in use` tras 5 reintentos contra el puerto que ya tenía la primera. El riesgo no era el `failed` en sí sino que la configuración estaba **invertida**: la que corría estaba `disabled` y la `enabled` era la fallida, así que en el próximo reinicio habría arrancado la otra y cada `systemctl restart agente-pro` de la documentación habría reiniciado una unidad apagada, sin dar error. Se consolidó en `agente-pro` (enabled), `mckenna-agente` quedó disabled con aviso en la plantilla, y la unidad viva — que solo existía en `/etc`, sin respaldo en git — quedó versionada en `scripts/systemd/` con el `-u` y el `StartLimit*` (en `[Unit]`, donde sí aplica) que tenía la descartada. No se reinició el proceso: `enable`/`disable` no lo tocan.
  - **Pendiente menor detectado, no corregido:** `mckenna-whatsapp-bridge.service` tiene `StartLimitIntervalSec` dentro de `[Service]`, donde systemd lo ignora — ese servicio no tiene límite de reintentos efectivo.
- **Archivos Modificados:** `desktop/src/lib/panelAccess.ts`, `desktop/src/App.tsx`, `scripts/systemd/agente-pro.service` (nuevo), `scripts/systemd/mckenna-agente.service`, `CLAUDE.md`

### 2026-09-12 - Préstamos: mes de gracia, capital en tramos y dinero que entró por la cuenta de un socio
- **Autor:** Armando García
- **Tipo de Cambio:** Nueva funcionalidad + corrección de datos
- **Qué se implementó:**
  - **Capital que no entra por el banco de McKenna:** dos de los cuatro familiares prestamistas le giraron a la cuenta personal de un socio, no a la de la empresa. `crear_prestamo` acepta ahora `cuenta_contrapartida_id` + `tercero_contrapartida_id` en vez de `medio_pago_id` (excluyentes): el asiento queda `Débito 1355 [tercero=socio] / Crédito 2295` y **no toca Bancos**, porque el banco no se movió. Cada reposición del socio se registra aparte. **Por qué uno por abono y no uno solo:** `extracto_vinculos.movimiento_id` es UNIQUE, así que un asiento de $20M contra tres transferencias dejaría dos líneas de banco huérfanas en «Pendientes por clasificar» para siempre.
  - **`ampliar_capital()`:** un préstamo entregado en tramos por vías distintas sigue siendo uno con un cronograma, pero cada tramo deja su propio asiento. Antonio Ruiz prestó $16.000.000, no $9.200.000: consignó $9,2M a la empresa y le giró $6,8M a Cynthia.
  - **`meses_gracia`:** corre las cuotas sin cambiar sus montos; el primer mes no causa interés. Es gracia **total** (no se capitaliza ni se difiere), así que le quita rendimiento al prestamista — $1,4M entre los cuatro — y exige su acuerdo. La TIR descuenta el desfase: el costo real de McKenna baja de 25% a **23,00% E.A.**. `aplicar_meses_gracia()` lo concede a préstamos existentes y se niega si hay cuotas pagadas: recalcular entonces dejaría los asientos del pago apuntando a cifras que ya no existen. El asiento de desembolso no se toca — la plata se movió el día que se movió.
  - **El contrato PDF enuncia la cláusula de gracia con todas las letras.** Reflejarla solo en las fechas corridas dejaba al prestamista sin forma de saber por qué su primera cuota se movió un mes.
  - **Datos:** préstamo de Victor Hugo García Barrero ($20M, dos giros a Armando el 19 y 20 de agosto, registrado como uno solo con fecha 19-ago), Antonio corregido a $16M, mes de gracia en los cuatro y abonos de reposición (Armando $10M, Cynthia $1,1M). Total en 2295: **$81.950.000**. Por cobrar en 1355: Armando $10.000.000, Cynthia $5.700.000. Respaldo previo en `~/backups_manual/contabilidad_pre_gracia_2026-09-11_2348.db`.
  - **Los cuatro contratos se enviaron** (MUT-2026-0001 a 0004). ⚠️ Antonio, Stella y Carmenza **no acordaron la gracia** y el contrato afirma que sí: se envió por instrucción explícita tras advertir el riesgo. Queda anotado en los pendientes de la ficha.
- **Archivos Modificados:** `app/services/prestamos.py`, `app/services/contabilidad_core.py`, `app/tools/prestamos_pdf.py`, `tests/test_prestamos.py` (14 tests nuevos, 76 en total), `docs/agentic/modules/prestamos.md`, `docs/team-recaps.md` (datos: `app/data/contabilidad.db`)


### 2026-09-12 11:20 - Etiquetas: corrección ortográfica en las casillas y revisión de toda la etiqueta antes de imprimir
- **Autor:** Armando García
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - **Corrector del navegador** en las casillas de texto de las tres composiciones (ficha 76 × 66, 30 mL y simple 69 × 51): subrayado rojo y sugerencias al clic derecho mientras se escribe (`spellCheck` + `lang="es"`). `CampoEtiqueta` lo tenía apagado a mano (`spellCheck: false`). Queda apagado a propósito en las casillas que no son prosa — CAS, EAN, fórmula química, concentración, contenido neto, web, correo, teléfono, GHS, documentos: ahí todo saldría subrayado y el operador aprende a ignorar el subrayado, que es peor que no tenerlo. La lista vive en un solo sitio (`campoRevisaOrtografia`), no repartida por cada casilla.
  - **Revisión de toda la etiqueta, automática:** barra ámbar sobre el lienzo con las casillas por revisar, «Corregir todo» y detalle por casilla (`tachado → corregido`) con corrección individual. No hay botón que apretar para que aparezca — el corrector del navegador solo marca la casilla que se está editando, y casi todo lo que se imprime llegó de la ficha técnica sin que nadie lo escribiera en el formulario. Avisa, no bloquea imprimir.
  - **Qué revisa:** la tilde perdida («ACIDO CITRICO», «CAPSULAS», «SIN CASCARA», «MANI»), que es el error real de estas etiquetas — el nombre se escribe en mayúsculas (el `uppercase` es del CSS, el dato se guarda como se escribió) y los datos entran copiados de fichas y catálogos de proveedores. Además: espacios dobles, espacio antes de coma o punto, coma sin espacio después y palabra repetida seguida.
  - **Sin diccionario descargado y sin LLM:** reglas deterministas sobre una lista cerrada de ~190 palabras del dominio (química, estados, vocabulario de ficha, productos). Un corrector de diccionario marcaría media etiqueta, porque los nombres químicos no están en ninguno. **Regla para agregar una palabra:** solo entra si su forma sin tilde NO es otra palabra válida — por eso no están «más» (mas), «está» (esta), «sí» (si), «té» (te) ni «sólo»: corregirlas a ciegas cambiaría una frase correcta. Verificado: «100 %», «1,5 kg», «www.mckennagroup.co» y «Ácido Esteárico, Ácido Oleico» no producen hallazgos.
  - Probado contra las 10 etiquetas guardadas: 3 tenían algo que corregir, dos de ellas en el nombre del producto («MANI NATURAL TOSTADO», «ALMENDRA NATURAL SIN CASCARA») — habrían salido impresas así.
- **Archivos Modificados:** `desktop/src/lib/ortografiaEtiqueta.ts` (nuevo), `desktop/src/components/etiqueta-ficha/EditableField.tsx`, `ProductLabelForm.tsx`, `desktop/src/components/etiqueta-30ml/CampoEtiqueta.tsx`, `docs/team-recaps.md`


### 2026-09-11 21:45 - Etiqueta simple de 69 × 51 mm y el formato que se elige por su tamaño, no por su nombre
- **Autor:** Armando García
- **Tipo de Cambio:** Nueva funcionalidad + Mejora
- **Qué se implementó:**
  - **Etiqueta simple (69 × 51 mm, «100 g»):** tercera composición del formulario de etiquetas, junto a la ficha de 76 × 66 y la horizontal de 30 mL. Dos columnas que comparten las mismas filas, así cada división cae a la misma altura a un lado y al otro: nombre del producto con el recuadro «INSUMO GRADO …» del ancho exacto del nombre · origen y contenido neto · conservación y alérgenos con sus íconos · logo corporativo, información técnica con la web y el código de barras · franja de ubicación, teléfono y correo. El pie lo fija el timbre (10 mm reales) y lo que sobra se parte en sección áurea entre la cabeza y el medio; las filas no se mueven, es el texto el que se encoge para caber. Se edita, autoguarda, imprime, sale en PNG y admite plantilla por categoría igual que las otras dos.
  - El ancho del recuadro del grado se mide con una copia invisible del nombre (misma letra y misma caja, así corta los renglones igual): en edición el nombre es un `textarea` y no se puede medir directo. El nombre solo se encoge si el bloque completo no cabe en su banda — medir contra su propia caja daba siempre «no cabe», porque la tinta de las letras sobresale 2 px, y lo dejaba al mínimo.
  - **El formato ES su tamaño:** el selector muestra `2.72×2.01 in · 69×51 mm` en vez del nombre interno («250 / 500 g», «30 mL»). El nombre engañaba, porque una misma presentación puede ir en etiquetas distintas. Lo único que se añade es «redonda», porque 125 g y Circular 70 miden igual y solo cambia el troquel; por eso hay casilla de troquel redondo al crear un tamaño nuevo. Un tamaño nuevo ya no pide nombre: se arma con las medidas (`nombreTipoPorMedidas`), y si el catálogo ya tiene uno igual se reutiliza ese en vez de duplicarlo. Los formatos guardados con nombres viejos se resuelven por alias (`nombreTipoEtiquetaCanonico`) al abrir una ficha o una plantilla.
  - **Pictogramas GHS desde la ficha técnica:** se leen de la sección de peligros de la SDS (`_sds.peligros.pictogramas`), no de un campo `ghs` que ninguna ficha tiene — siete productos salían como «NO GHS». Se avisa cuando la clasificación en texto contradice el pictograma (rombo de peligro con «no está clasificado como peligroso»).
  - Ajustes de canvas y tipos compartidos en plantillas visuales, Studio por categorías y los motores de etiquetas (`etiquetas_ai_engine`, `etiquetas_svg_engine`, `etiquetas_studio`).
- **Archivos Modificados:** `desktop/src/components/etiqueta-simple/` (nuevo), `desktop/src/lib/etiquetasTipos.ts`, `desktop/src/components/etiquetas/SelectorFormatoEtiqueta.tsx`, `desktop/src/components/etiqueta-ficha/ProductLabelForm.tsx`, `productLabelTypes.ts`, `EditableField.tsx`, `ProductAttributeGrid.tsx`, `desktop/src/components/etiqueta-30ml/*`, `desktop/src/components/plantillas-visuales/*`, `desktop/src/components/EtiquetasPanel.tsx`, `app/tools/etiquetas_studio.py`, `etiquetas_ai_engine.py`, `etiquetas_svg_engine.py`, `docs/team-recaps.md`


### 2026-09-11 17:20 - COA: firma única de Gloria Stella Velandia, logo y color turquesa en todo el formato
- **Autor:** Cynthia
- **Tipo de Cambio:** Mejora técnica
- **Qué se implementó:**
  - **Firma única:** el COA que emite McKenna Group lo firma SIEMPRE Gloria Stella Velandia Cobos, Directora de Calidad, con su firma de la biblioteca (`fichas_word/firmas/8774c26567767247.png`). `_con_firma_default` ya no respeta el firmante que venga en los datos: lo impone. Antes había 6 firmantes distintos en los documentos (27 fichas con Edna Lida Méndez y 5 con firmantes de proveedores: Jim Fauteux, Mauricio Palacio, Cristina Bravo, Luis Enrique Rodríguez). Se actualizaron 83 fichas guardadas y se regeneraron los 61 PDF.
  - El escáner de COA ya no guarda en la biblioteca la firma recortada del documento del proveedor ni la usa como firmante (queda solo como `firma_proveedor_b64`, de referencia).
  - **Logo y color:** todo el formato FT/COA/SDS usa el logotipo turquesa (`fichas_word/cabezotes/logotipo_turquesa.png`) y el color #044D5C, sin importar el cabezote o el color que traiga la ficha.
  - Migración de fichas antiguas: 17 aceites quedaron como BORRADOR (no publicados) porque su clasificación GHS no es verificable en fuentes públicas y no se acepta deducirla del componente mayoritario; se retiró la ficha antigua del argán (traía datos de un caolín). Ácido cítrico corregido (era anhidro descrito como monohidrato, beneficios y aplicaciones cosméticos en una ficha de grado Alimentos, declaraciones médicas, SDS sin clasificación).
- **Archivos Modificados:** `app/services/ficha_tecnica.py`, `app/services/coa_scan_jobs.py`, `app/templates/documento_completo_pdf.html`, `docs/team-recaps.md` (datos: `fichas_word/datos/*.yaml`, PDF en `fichas_word/completo/`)


### 2026-09-11 16:20 - Ácido málico al formato nuevo y dos correcciones del PDF completo
- **Autor:** Cynthia
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - Ficha de ÁCIDO MÁLICO rehecha en formato FT + SDS (sin COA hasta tener el del proveedor): CAS 6915-15-7 y EINECS 230-022-8 (ácido DL-málico), INS 296, sabor ácido (decía «Neutro»), sin el punto de ebullición de 235 °C (se descompone), sin la mención a fibromialgia, y con SDS completa (GHS07, H319). Se retira la ficha antigua `acido_malico.yaml`; la microbiología antigua tenía los signos invertidos (≥ en vez de ≤) y no se trasladó.
  - PDF completo: EINECS y grado ya no hacen «diligenciado» al COA (solos imprimían un COA vacío con la firma por defecto). La tabla de composición de la SDS mostraba la concentración bajo «N° CAS» en 19 de 22 fichas: se corrige el orden de columnas de la plantilla (componente | concentración | CAS, igual que el editor) y la única ficha con el orden inverso (cera de abejas blanca). La SDS muestra el N.º CE (EINECS).
- **Archivos Modificados:** `app/services/ficha_tecnica.py`, `app/templates/documento_completo_pdf.html`, `docs/team-recaps.md` (datos: `fichas_word/datos/ft_coa_sds_acido_malico.yaml`, `ft_coa_sds_cera_de_abejas_refinada_blanca.yaml`)


### 2026-09-11 15:40 - Fichas técnicas: una por producto, identificación verificada y casillas según la clasificación del insumo
- **Autor:** Cynthia
- **Tipo de Cambio:** Mejora técnica + Corrección de datos
- **Qué se implementó:**
  - **Datos (`fichas_word/datos`, fuera de git; respaldos en `/home/mckg/backups_manual/fichas_datos_2026-09-11_*.tar.gz`):** fusionadas 15 fichas completas duplicadas (una por perfil de producto; colágeno cosmético/alimentos, nuez y maní entero/partido quedan separados) y retiradas 33 fichas antiguas (`origen_word`) que repetían una completa, pasando antes a la completa lo útil. «Ácido salicílico 20 % solución» se conserva como referencia aparte.
  - 27 EINECS corregidos o completados, CAS de alulosa (551-68-8), vaselina y cera amarilla, fórmulas de eritritol, sorbitol, D-pantenol y glutamato; se retiran fórmulas que no correspondían (ricino, papaína). Todo verificado con el dígito de control y Wikidata. El EINECS de lactato de calcio correspondía a un fármaco (α-ergocriptina).
  - Colágeno cosmético (solución 30 mL) y alimentos (polvo 500 g) tenían aplicaciones, beneficios, descripción y manipulación cruzados; alineados con su propio COA. INCI en 7 fichas cosméticas.
  - **Formulario FT + COA + SDS:** nueva «Identificación del producto» con tipo de insumo (A sustancia definida · B natural o polímero · C mezcla · D alimento) y grado multi-selección. Las casillas CAS, EINECS / Número CE, INCI (nueva, antes no se veía) e INS (nueva) se habilitan según la clasificación; lo que no aplica se muestra y se guarda como «No aplica». La fórmula química se bloquea fuera del tipo A y la composición de la SDS se marca como requerida en B, C y D.
  - EINECS y grado salen de la sección COA a la identificación compartida. El EINECS ahora también se guarda en la SDS (`numero_ce`); antes se perdía al volver a guardar. Nuevos campos en el YAML: `tipo_insumo`, `ins`. Las 60 fichas completas quedan clasificadas.
- **Archivos Modificados:** `desktop/src/lib/clasificacionInsumo.ts` (nuevo), `desktop/src/components/FichasTecnicasPanel.tsx`, `desktop/src/components/documentos/FichaTecnicaForm.tsx`, `desktop/src/components/documentos/DocumentoGeneradorTab.tsx`, `docs/team-recaps.md`


### 2026-09-11 13:58 - GHS: los pictogramas de la ficha técnica ya llegan a la etiqueta
- **Autor:** Cynthia
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - **Causa:** las fichas guardan los pictogramas en la sección de peligros de la SDS (`_sds.peligros.pictogramas`: «GHS07 - Nocivo…»), pero el autollenado solo leía un campo `ghs` que ninguna ficha tiene. ÁCIDO SALICÍLICO, ÁCIDO AZELAICO, CLORURO y CARBONATO DE CALCIO, L-ARGININA e INULINA salían como «NO GHS» y «No está clasificado como peligroso». Probado contra las 238 fichas: ahora esos 7 productos (8 fichas) salen como GHS07.
  - `camposDesdeFichaTecnica` lee los códigos de la SDS y arma una clasificación corta con la palabra de advertencia y las frases H («Peligro. Frases H: H302, H315, H319.»), que llena la clasificación de la etiqueta de 30 mL.
  - El rombo que se dibuja es el pictograma oficial del código (`lib/ghsIconos`: `codigosGhs`, `svgPictogramaGhs`), no un marco vacío con el número; aplica también a la ficha de 250/500 g.
  - Cargar un SKU o una ficha quita el pictograma elegido a mano antes (podía ser de otro producto); un pictograma elegido mientras la ficha aún carga ya no se pisa.
- **Archivos Modificados:** `desktop/src/lib/ghsIconos.ts`, `fichaTecnicaCampos.ts`, `fichaTecnicaAplicar.ts`, `desktop/src/components/etiqueta-ficha/GhsBadge.tsx`, `GaleriaGhsModal.tsx`, `ProductLabelForm.tsx`, `docs/team-recaps.md`


### 2026-09-11 13:55 - Etiqueta de 30 mL: tres paneles horizontales, editada igual que la de 250/500 g
- **Autor:** Cynthia
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - Al elegir el formato «30 mL» (102 × 38 mm) el formulario de etiquetas usa una composición propia de tres paneles: matriz técnica 2 × 3 (Fórmula química o Composición, Grado, Conservación, Origen, Apariencia, Olor) con franja de ubicación y teléfono · logo, nombre, «INSUMO GRADO COSMÉTICO/ALIMENTARIO/AGRO/INDUSTRIAL», tabla Concentración/CAS y contenido neto · información técnica, web, clasificación GHS, código EAN-13 y franja de correo.
  - Mismo objeto de datos, SKU, ficha técnica, logo con su color, autoguardado, plantillas por categoría y generación en lote que la ficha de 76 × 66. Se edita igual: directamente sobre la etiqueta, con menú de tamaño/fuente, clic en íconos, logo, GHS y código de barras.
  - Retícula en CSS Grid calculada del formato: las líneas de las filas coinciden en los tres paneles. El texto se encoge si no cabe en su casilla y se marca en rojo si ni así cabe. Rellenos de un solo color, esquinas de 10 px.
  - Cuatro íconos lineales nuevos en la galería (matraz, medalla, termómetro, escamas). El menú de logos corporativos quedó como componente compartido (`MenuLogoCorporativo`) y `BarcodeBlock` acepta clases para reutilizarse.
  - Botones nuevos en el encabezado para todos los formatos: «Imprimir» (solo la etiqueta, a tamaño real) y «Restablecer datos» (vuelve a cargar el SKU y su ficha técnica).
  - Datos nuevos en la ficha: `gradoInsumo` (de plantilla) y `clasificacionTexto` (de producto).
- **Archivos Modificados:** `desktop/src/components/etiqueta-30ml/` (nuevo), `desktop/src/components/etiqueta-ficha/ProductLabelForm.tsx`, `ProductHeader.tsx`, `MenuLogoCorporativo.tsx` (nuevo), `BarcodeBlock.tsx`, `ProductAttribute.tsx`, `productLabelTypes.ts`, `desktop/src/lib/iconosQuimicaCirculares.ts`, `docs/team-recaps.md`


### 2026-09-11 00:45 - La plantilla nunca cambia: elegir un SKU en ella abre una etiqueta nueva
- **Autor:** Armando García
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - Al elegir un código de barras dentro de una plantilla, el autoguardado escribía sobre la plantilla: tomaba el nombre del SKU («COCO DESHIDRATADO HILOS 250g») y dejaba de verse como plantilla de la familia.
  - Ahora ese SKU abre una etiqueta nueva con el diseño de la plantilla y los datos de producto en blanco (luego los llena la ficha técnica), guardada aparte con el nombre del SKU y `plantilla_id` de origen. La plantilla queda como estaba.
  - Plantilla `e834e09ec492` renombrada de vuelta a «Plantilla de Sales minerales tamaño 500 g» (dato en `app/data/etiquetas_fichas.json`, no versionado).
- **Archivos Modificados:** `desktop/src/components/etiqueta-ficha/ProductLabelForm.tsx`, `docs/team-recaps.md`


### 2026-09-11 00:30 - Ficha de etiqueta: logo fijo al 130 %, eslogan «Proveemos a tus ideas» y plantillas que no se renombran
- **Autor:** Armando García
- **Tipo de Cambio:** Mejora de diseño + Corrección
- **Qué se implementó:**
  - El logo queda siempre al 130 % (caja 273×84.5 px): se quitaron los botones －/＋ y se ignora el `logoScale` guardado.
  - Debajo del logo, el eslogan fijo «Proveemos a tus ideas» en el color de acento; tamaño y fuente ajustables desde su menú (`styleKey` `esloganLogo`, 15 px por defecto).
  - Corrección: elegir un código de barras dentro de una plantilla le cambiaba el nombre por el del producto (la plantilla de Sales minerales quedó como «COCO DESHIDRATADO HILOS 250g»). Ahora `onElegirCodigo` solo renombra etiquetas, no plantillas.
- **Archivos Modificados:** `desktop/src/components/etiqueta-ficha/ProductHeader.tsx`, `ProductLabelForm.tsx`, `docs/team-recaps.md`


### 2026-09-10 23:58 - Ficha de etiqueta: tamaño ajustable de «Disponible en:»
- **Autor:** Armando García
- **Tipo de Cambio:** Mejora
- **Qué se implementó:**
  - «Disponible en:» (encima de la banda de la web) era texto fijo de 14 px; ahora es un título ajustable como los demás: en edición, clic abre el menú de tamaño/fuente (`styleKey` `disponibleEnTitulo`). Por defecto sigue en 14 px, así que las etiquetas existentes no cambian.
- **Archivos Modificados:** `desktop/src/components/etiqueta-ficha/TechnicalDocuments.tsx`, `docs/team-recaps.md`


### 2026-09-10 23:50 - Botón «Limpiar plantilla»
- **Autor:** Cynthia
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - Al abrir una plantilla de categoría aparece «Limpiar plantilla» junto a «Generar etiquetas de la categoría». Con confirmación, vacía los datos de producto (`CAMPOS_PRODUCTO`: nombre, composición, CAS, código de barras, ficha técnica…) y conserva el diseño: logo, colores, tipografías, íconos, GHS, títulos y cuchara.
  - Si la plantilla ya no tiene datos de producto, el botón queda desactivado como «✓ Plantilla limpia».
- **Archivos Modificados:** `desktop/src/components/etiqueta-ficha/ProductLabelForm.tsx`, `productLabelTypes.ts`, `docs/team-recaps.md`


### 2026-09-10 23:40 - Etiquetas: una etiqueta nueva ya no hereda los datos del producto de la plantilla
- **Autor:** Armando García
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - **Causa:** "Nueva etiqueta" copiaba la plantilla completa, incluidos nombre, composición, pureza, CAS y ficha técnica del producto con que se armó. Si la ficha técnica del SKU nuevo no se cargaba, esos datos se quedaban sin aviso: CITRATO POTASIO 500g salió con los de CITRATO DE MAGNESIO. El lote tenía el mismo hueco y además no guardaba la ficha técnica usada.
  - Nuevo `CAMPOS_PRODUCTO` / `sinDatosDeProducto()`: la etiqueta nueva, el lote y una plantilla nueva de la misma familia toman solo el diseño; los datos de producto arrancan en blanco y los llena la ficha técnica.
  - El lote salta los SKU sin ficha técnica (no sube PNG en blanco) y los lista al final para hacerlos a mano.
  - Aviso rojo en la ficha cuando el código de barras no corresponde a la ficha técnica enlazada (o al nombre, si no hay enlace) — `discrepanciaProducto()`, mismo umbral que el enlace automático. "Guardar PNG" pide confirmar mientras el aviso esté. Probado contra las 8 fichas guardadas: solo marca CITRATO POTASIO.
  - Plantilla de Sales minerales (`e834e09ec492`) sin los datos de Citrato de Magnesio: queda solo el diseño.
- **Archivos Modificados:** `desktop/src/components/etiqueta-ficha/ProductLabelForm.tsx`, `productLabelTypes.ts`, `desktop/src/lib/fichaTecnicaMatch.ts`, `docs/team-recaps.md` (la limpieza de la plantilla es en `app/data/etiquetas_fichas.json`, que no se versiona)


### 2026-09-10 23:25 - Ficha de etiqueta: Pureza/CAS y cuchara centrados en su fila de la retícula
- **Autor:** Armando García
- **Tipo de Cambio:** Mejora de diseño
- **Qué se implementó:**
  - La columna derecha de la ficha (GHS, información técnica, Pureza/CAS) ahora comparte las 3 filas de los atributos con CSS `subgrid`, en vez de centrarse sola sobre todo el alto.
  - GHS + información técnica quedan centrados en las filas 1-2; el cuadro Pureza/CAS + la casilla de la cuchara, centrados en la fila 3 (Grado / Conservación). Las filas no cambian de alto (medido: 186 · 178 · 199 px en CITRATO POTASIO, 0 px de desfase del centro).
  - El alto mínimo de fila (`FILAS_CUERPO`) pasó de `ProductAttributeGrid` al cuerpo de la ficha, que lo hereda a las dos columnas.
  - Se quitan los archivos `.bak-*` que dejaron las tareas de hoy y que el auto-commit de las 23:00 subió al repo.
- **Archivos Modificados:** `desktop/src/components/etiqueta-ficha/ProductLabelForm.tsx`, `ProductAttributeGrid.tsx`, `docs/team-recaps.md`


### 2026-09-10 22:55 - Ficha de etiqueta: casilla "Incluye cuchara medidora de"
- **Autor:** Armando García
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - Casilla nueva debajo del cuadro Pureza/CAS: "Incluye cuchara medidora de: N g|mL aprox.", con el mismo trazo, radio y ancho que ese cuadro para no crear líneas nuevas en la retícula.
  - En edición: número + desplegable g / mL; "aprox." es fijo. Sin número la casilla no se imprime (vista y PNG), así las etiquetas existentes no cambian.
  - `cucharaCantidad` y `cucharaUnidad` se guardan en la ficha y forman parte de `CAMPOS_PLANTILLA`: la plantilla de categoría los hereda a las etiquetas nuevas. La cantidad se establece a mano en cada plantilla.
- **Archivos Modificados:** `desktop/src/components/etiqueta-ficha/CucharaMedidora.tsx` (nuevo), `ProductLabelForm.tsx`, `productLabelTypes.ts`


### 2026-09-10 22:25 - Plantilla de Sales minerales con el diseño de CITRATO POTASIO 500g
- **Autor:** Armando García
- **Tipo de Cambio:** Mejora de diseño
- **Qué se implementó:**
  - La plantilla de categoría "Plantilla de Sales minerales tamaño 500 g" (`e834e09ec492`) tomó los tamaños de letra de CITRATO POTASIO 500g, la etiqueta aprobada como modelo de la familia (nombre 39 → 30, clasificación 26 → 20). Logo y color siguen por producto.
  - Pictograma GHS con desplazamiento vertical por ficha (`ghsDesplazamiento`, % de su caja, flechas ▲▼ en edición); −20 % en la plantilla, CITRATO POTASIO y CITRATO CALCIO. Solo se mueve el rombo con `transform`, la columna no se corre.
  - Títulos elegibles desde el menú de tamaño/fuente del título: "Composición" o "Fórmula molecular" (`compositionTitulo`), "CAS" o "EINECS" (`casTitulo`).
- **Archivos Modificados:** `desktop/src/components/etiqueta-ficha/GhsBadge.tsx`, `EditableField.tsx`, `ProductAttribute.tsx`, `ProductAttributeGrid.tsx`, `TechnicalIdentity.tsx`, `ProductLabelForm.tsx`, `productLabelTypes.ts`, `app/data/etiquetas_fichas.json`


### 2026-09-10 22:00 - Ficha de etiqueta: los íconos elegidos a mano siguen el color del logo
- **Autor:** Armando García
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - Los íconos de atributo elegidos en la galería se guardaban como `<img>` con el color de tinta fijo, así que Composición y Conservación (elegidos a mano en 8 fichas) no cambiaban al elegir otro logo.
  - `ProductAttribute` ahora dibuja esos SVG en línea con el color cambiado a `currentColor`, igual que los íconos por defecto; un data URL que no sea SVG de la galería o traiga algo ejecutable sigue como `<img>`.
- **Archivos Modificados:** `desktop/src/components/etiqueta-ficha/ProductAttribute.tsx`


### 2026-09-10 21:40 - Logos corporativos: subir en masa, galería en ventana y eliminar
- **Autor:** Armando García
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - Menú del logo de la ficha: botón "+ Agregar imágenes a la carpeta" que guarda PNG/JPG/WEBP en `DISENO CORPORATIVO ` (el antiguo "Subir archivo…" pasa a "Usar sin guardar…").
  - Botón "⤢ Galería": ventana con buscador, subida en masa (Shift/Ctrl en el explorador o arrastrando archivos), selección con Shift+clic, "Seleccionar todo" y eliminar uno o varios con confirmación dentro de la ventana.
  - Eliminar no borra: mueve el archivo a `DISENO CORPORATIVO /.papelera/`. Rutas nuevas `POST /api/etiquetas/logos-corporativos` (subir, valida bytes reales, sin SVG, no sobrescribe) y `POST /api/etiquetas/logos-corporativos/eliminar` (requiere acceso a Studio).
- **Archivos Modificados:** `app/routes.py`, `app/tools/logos_corporativos.py`, `desktop/src/lib/logosCorporativos.ts`, `desktop/src/components/etiqueta-ficha/ProductHeader.tsx`, `desktop/src/components/etiqueta-ficha/GaleriaLogosCorporativosModal.tsx` (nuevo)


### 2026-09-10 20:25 - Studio → Recursos: botón para subir imágenes desde el ordenador
- **Autor:** Armando García
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - Botón "⬆ Subir imágenes" en la biblioteca de Recursos, junto a "+ Carpeta": sube uno o varios JPG/PNG a la carpeta abierta, con progreso y aviso de los que fallan. Usa el mismo endpoint que la galería del editor.
- **Archivos Modificados:** `desktop/src/components/plantillas-visuales/PlantillasVisualesPanel.tsx`


### 2026-09-10 00:45 - Tarifas de envío: el bot cotizaba de memoria, no de la tabla (Bloque C)
- **Autor:** Armando García
- **Tipo de Cambio:** Corrección de fondo (plata: se cobraba de menos y de más)
- **Qué se implementó:**
  - **El problema:** las tarifas estaban **escritas a mano en dos prompts** (`app/core.py` regla 9 y `app/agent/cliente_chat.py`) — "Bogotá $8.800 · resto del país $18.000, +$2.000 por kg adicional" — mientras la tabla real vive en `app/data/tarifas_interrapidisimo.json` con cinco zonas y tramos por peso. Divergencias medidas: Cali 3 kg el bot decía ~$22.000 y la tabla cobra **$28.400**; Chía es zona regional a **$12.500** y el bot cobraba $18.000; Leticia es difícil acceso a **$20.900**. Se perdía plata en pedidos pesados y se cobraba de más a Cundinamarca.
  - **Causa de fondo:** la regla decía "SIEMPRE usa `consultar_tarifa_envio`", pero los canales de cliente (`whatsapp`, `web_chat`) responden **sin tool-use** — ahí esa regla era inaplicable y el LLM solo tenía las cifras del prompt.
  - **Solución:** `_preflight_tarifa_envio()` en `core.py` resuelve la tarifa en Python (misma `tarifas_envio.cotizar_envio` que usa la tienda web) y la inyecta ya calculada vía `extra_sistema`, igual que se hace con el catálogo. Incluye zona, días y escalera de 1/2/3/5 kg. Detecta la ciudad en el mensaje o en lo que **el cliente** dijo antes — nunca en una ciudad que el bot haya mencionado, que no es el destino del pedido.
  - **Sin ciudad no hay cifra:** si el cliente no dijo la ciudad, el bloque ordena preguntarla y solo permite afirmar la de Bogotá (leída de la tabla, no escrita). Prohibido estimar o promediar.
  - **Prompts limpios:** las dos listas de tarifas se reemplazaron por la regla de no dar ninguna cifra que no venga del bloque inyectado.
  - **Tercer camino, también roto:** la herramienta `consultar_tarifa_envio` (la que sí usan los canales con tool-use) leía la clave legacy `ciudades` del JSON, que solo trae la tarifa de 1 kg, e **ignoraba el peso por completo** — 3 kg a Cali devolvía $18.500. Ahora acepta `peso_kg` y delega en `cotizar_envio`, así los tres caminos (web, chat de cliente, herramientas) cotizan igual. Su fallback de error tenía un `$18.000` fijo; ahora devuelve error explícito en vez de cotizar mal.
  - 10 tests nuevos en `tests/test_tarifa_envio_chat.py`, incluido uno end-to-end que verifica que el bloque llega hasta el prompt del LLM y no se queda en el helper.
- **Archivos Modificados:** `app/core.py`, `app/agent/cliente_chat.py`, `app/tools/system_tools.py`, `tests/test_tarifa_envio_chat.py` (nuevo), `docs/team-recaps.md`


### 2026-09-10 00:05 - Catálogo del bot: variantes morfológicas, allowlist hardcodeada y caché stale perdida (Bloque B)
- **Autor:** Armando García
- **Tipo de Cambio:** Corrección de fondo (catálogo del bot / pérdida de ventas)
- **Qué se implementó:**
  - **Caso que lo destapó:** el 9-sep un cliente pidió creatina de 1 kg y el bot respondió cinco veces *"el precio no me figura en el sistema"* sobre un producto en catálogo con stock 9 y precio $65.700. Reproducido en local: `"precio creatina"` encontraba, `"creatina monohidratada 1kg"` devolvía `None`.
  - **Causa 1 — variantes morfológicas.** El matcher de combos comparaba por substring pura, así que `monohidratADA` no casaba con `MONOHIDRATO`. Nuevos `_raiz_token_combo()` / `_token_en_blob()` en `app/services/siigo.py`: raíz aproximada del español (mínimo 5 caracteres) aplicada en el scoring, en el filtro estricto de distintivos y en el conteo `df`. Deliberadamente asimétrico — la raíz del cliente debe ser prefijo de una palabra real del producto, para que "acido" no arrastre "ácido tánico". Además el umbral final de score bajó de `len(distintivos)*3` a `*2`: con 3 por token, todo match por raíz (que puntúa 2) moría ahí aunque el filtro estricto ya lo hubiera aceptado.
  - **Causa 2 — allowlist escrita a mano.** `_es_seleccion_presentacion_web` decidía si un mensaje nombra un producto contra una tupla hardcodeada ("aceite", "urea", "niacinamida", "ylang"…). Creatina, taurina, sucralosa y alulosa no estaban, así que sus mensajes se clasificaban como "el cliente eligió presentación" y el término se buscaba crudo. Reemplazado por `_mensaje_nombra_producto_del_catalogo()`, derivado del catálogo real (`cache.json`, 206 tokens, cacheado, degrada a la heurística anterior si falla la lectura).
  - **Causa 3 — notas hardcodeadas que mienten.** Se eliminaron dos reglas por producto en `_nota_producto_alternativo_web`: *"Ylang Ylang no aparece en catálogo web"* (falso — `C-ACEESEYLAYLA5mL`, stock 18) y la de COSGARD, que se anteponía a `_respuesta_no_encontrado_catalogo_web` y hacía que el cliente recibiera el mismo mensaje dos veces (visto en el chat web). Se conserva la de BTMS-25, que sí aporta la referencia equivalente.
  - **Hallazgo aparte, el más grave: la red de seguridad de caché stale se perdió en la migración a Alegra del 3-sep.** `listar_productos_combo_alegra()` cacheaba `[]` con marca de tiempo fresca si la API fallaba, así que un solo error de Alegra dejaba al bot **sin catálogo durante los 5 minutos del TTL** y toda consulta respondía "no encontré ese producto". Es exactamente el fallo que en jul-2026 hacía que la misma referencia se encontrara y 30 s después no. Restaurada: ante error se devuelve la caché anterior sin refrescar el timestamp (reintenta al turno siguiente), y las excepciones de red ya no se propagan.
  - **El test que debía cubrir eso estaba muerto:** `test_cache_stale_si_api_falla` parcheaba `siigo._combos_cache` / `siigo._siigo_get`, atributos que quedaron sin uso tras la migración; golpeaba la API real y fallaba en cualquier máquina con credenciales. Reapuntado a la caché de Alegra + test nuevo para excepción de red. La suite de matcher pasó de 15 s (con red) a 1,5 s.
  - **Instrumentación:** nuevo `app/services/catalogo_faltantes.py`. Cada preflight que se queda sin resultados anota el término normalizado con su contador en `app/data/catalogo_sin_resultado.json`. Los huecos del catálogo dejan de descubrirse leyendo chats a mano.
  - Verificado: los cinco fraseos del caso real resuelven; `acido tanico`, `cosgard` y `xyz inexistente` siguen sin inventar familia. 20 fallos en la suite completa, **idénticos con y sin estos cambios** (pre-existentes, otros módulos).
- **Archivos Modificados:** `app/services/siigo.py`, `app/services/alegra.py`, `app/core.py`, `app/services/catalogo_faltantes.py` (nuevo), `tests/test_siigo_matcher.py`, `docs/team-recaps.md`


### 2026-09-09 23:55 - Bot WhatsApp: eliminada la promesa vacía de escalación (Bloque A)
- **Autor:** Armando García
- **Tipo de Cambio:** Corrección de fondo (calidad del bot de atención)
- **Qué se implementó:**
  - **Diagnóstico con datos, no impresiones:** 30 días de `wa_chats.db` (982 respuestas del bot, 214 chats) + 205 turnos del chat web. La frase `"déjame consultar esa información con mi equipo y le confirmo en un momento"` salió **45 veces a 34 clientes** y el **60% nunca recibió respuesta humana en 2h**. Es la misma promesa vacía que costó la confianza en jul-2026, y no venía del modelo: la devolvían dos interceptores de `app/routes.py`.
  - **Interceptor 1** (`keywords_escalacion`): hacía *substring* de "asesor"/"descuento"/"garantía", así que mataba el turno del LLM en conversaciones normales. Reemplazado por `_PAT_PIDE_HUMANO` — intención explícita con límites de palabra, que excluye "asesoría/asesoramiento" (servicio que el bot sí atiende) frente a "asesor/asesora" (persona). Sobre el corpus real de 2.080 entradas: de 34 disparos a **20, todos peticiones genuinas**.
  - **Interceptor 2:** si la respuesta del LLM contenía "no puedo"/"no tengo información"/"no estoy seguro", **descartaba la respuesta buena** y mandaba la promesa. Ahora avisa al grupo y deja pasar la negativa honesta y contextualizada.
  - **Temas sensibles** (descuento, reclamo, garantía, devolución): `_PAT_TEMA_SENSIBLE` avisa al grupo **en paralelo** sin pisar al LLM.
  - **Texto cumplible:** `_texto_escalacion_cliente()` dice el horario real de atención y ofrece seguir adelantando la cotización en el mismo turno. **Decisión: no se pausa el bot al escalar** (aunque existe `_pausar_por_bot` y el chat web sí pausa) — con 60% de escalaciones sin atender, silenciarlo dejaría al cliente sin nadie.
  - **Red de seguridad:** `_normalizar_respuesta_cliente` filtra `_PAT_PROMESA_VACIA` venga de donde venga (interceptor legacy, prompt o alucinación).
  - **Seam de enrutamiento:** nuevo `GRUPO_ESCALACION_CLIENTES_WA`. Por defecto sigue cayendo en Facturacion_Compras_SIIGO (2 personas), que **no** es el destino natural de una consulta comercial — pendiente que el equipo lo apunte al grupo de ventas.
  - **Bug aparte, peligroso:** `tests/test_whatsapp_pago_y_media.py` mockeaba `cargar_modos_atencion` pero no `guardar_modos_atencion`, así que el anti-loop escribía el dict vacío del mock sobre el `app/data/modos_atencion.json` **real**: correr la suite borraba los 24 números en modo humano de producción y el bot volvía a responder chats que un asesor tenía tomados. Mockeado también el guardado.
  - 4 tests de regresión que fijan el contrato de la frase prohibida. Suite: 77 passed en `test_smoke.py` + 34 en los de WhatsApp/chat web.
- **Archivos Modificados:** `app/routes.py`, `tests/test_smoke.py`, `tests/test_whatsapp_pago_y_media.py`, `docs/team-recaps.md`


### 2026-09-07 14:20 - Catálogo Alegra: precio MeLi por SKU
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - El catálogo de Alegra muestra al lado el precio publicado en MercadoLibre, cruzado por el mismo SKU.
  - Filtros Desfasados / Sin MeLi; «Usar MeLi» (fila o lote) copia ese precio al lista de Alegra. El lote omite diferencias &gt;2× (posible SKU cruzado), salvo lista $0/$1.
- **Archivos Modificados:** `precios_canales.py`, `alegra_catalogo_db.py`, `routes.py`, `CatalogoAlegraPanel.tsx`, `panelInfo.ts`, `CONTRACTS.md`, tests, `docs/team-recaps.md`

### 2026-09-07 13:50 - Catálogo Alegra: tabs fijos + botones más chicos
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Mejora / UX
- **Qué se implementó:**
  - En Catálogo Alegra, Productos/Combos (y búsqueda/sync) quedan fijos arriba; solo la tabla hace scroll.
  - Botones ~60% más pequeños (tabs, Sincronizar, Editar/Eliminar, Guardar/Cancelar del modal).
- **Archivos Modificados:** `CatalogoAlegraPanel.tsx`, `ContabilidadPanel.tsx`, `docs/team-recaps.md`

### 2026-09-07 13:10 - Alegra: liberar SKU inactivo al recrear combo
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Corrección / Operación
- **Qué se implementó:**
  - `C-ACEESEBER5mL` no se podía recrear como combo porque Alegra dejó el producto **inactivo** (no se puede borrar con documentos ni cambiar type). Se renombró a `P-ACEESEBER5mL-LEGACY` y se creó el kit `C-ACEESEBER5mL` (componente `ACEESEBERmL` ×5).
  - `crear_combo_en_alegra` / `crear_producto_en_alegra` ahora liberan automáticamente un reference ocupado por ítem inactivo u otro tipo (renombra a `*-LEGACY`) en vez de solo decir «ya existe».
- **Archivos Modificados:** `app/services/alegra.py`, operación en Alegra id 142→LEGACY + kit 616, `docs/team-recaps.md`

### 2026-09-07 12:53 - Pedidos Web: fix overrides SKU + factura MCKG-55E67969A1
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Corrección / Operación
- **Qué se implementó:**
  - Causa del “edito el SKU y sigue el error”: `agente-pro` llevaba corriendo desde el 6-sep sin cargar el PATCH de overrides; el modal enviaba `C-AGUROS250mL` pero el proceso viejo ignoraba el body y seguía con `H2ORS250mL`.
  - Reinicio de `agente-pro`; factura `MCKG-55E67969A1` emitida como **FE103** con SKU corregido `C-AGUROS250mL` (persistido en el pedido).
  - Modal: `key` por referencia + muestra el último error de facturación al reabrir.
- **Archivos Modificados:** `PedidosWebPanel.tsx`, reinicio `agente-pro`, `docs/team-recaps.md`

### 2026-09-07 12:40 - Pedidos Web: emergente para verificar datos antes de facturar
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Mejora / Feature
- **Qué se implementó:**
  - En Pedidos Web, «Facturar con Alegra» abre un modal para revisar/editar SKUs, cantidades, precios, envío y datos del cliente (nombre, NIT, email, teléfono, dirección, ciudad) antes de emitir.
  - `POST /api/pedidos/web/facturar` acepta overrides (`cliente`, `items`, `shipping`); por defecto los persiste en `orders.db` y luego factura en Alegra.
- **Archivos Modificados:** `PedidosWebPanel.tsx`, `app/tools/web_pedidos.py`, `app/routes.py`, `tests/test_smoke.py`, `panelInfo.ts`, `CONTRACTS.md`, `docs/team-recaps.md`

### 2026-09-07 12:23 - Catálogo Alegra: editar componentes de combo sin movimientos
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Mejora / Feature
- **Qué se implementó:**
  - En Contabilidad → Catálogo Alegra, al editar un combo se puede cambiar la receta (agregar/quitar componentes y cantidades) si el kit aún no tiene movimientos en Alegra.
  - Si Alegra ya tiene movimientos, el modal deja editar nombre/precio y bloquea la composición con aviso claro (409 + `bloqueado_movimientos`).
  - `PATCH /api/alegra/catalogo/<codigo>` acepta `componentes[]` y actualiza el espejo SQLite de la receta.
- **Archivos Modificados:** `CatalogoAlegraPanel.tsx`, `app/routes.py`, `alegra_catalogo_db.py`, `panelInfo.ts`, `CONTRACTS.md`, `tests/test_alegra_catalogo_db.py`, `docs/team-recaps.md`

### 2026-09-07 11:15 - Studio: formulario MANTECA con nombres de bloque
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Mejora / UX
- **Qué se implementó:**
  - Cada caja de la etiqueta 76×66 quedó identificada (nada de «Otro»): NOMBRE, CATEGORÍA, ORIGEN, APARIENCIA, OLOR, COMPOSICIÓN, GRADO, CONSERVACIÓN, CONTENIDO NETO, CONCENTRACIÓN, CAS, GHS, LOGO, CÓDIGO DE BARRAS, más títulos e iconos de cada celda.
  - El formulario lateral copia el grid visual (título naranja + valor negro). Paleta de logo por línea comercial (Amarillo/Verde/Azul/Morado/Gris/Café) y código de barras EAN-13 (manual o registrado por nombre/SKU) sin mover cajas.
  - Export PNG de la manteca original sigue idéntico (solo metadatos de capa).
- **Archivos Modificados:** `FormularioEtiquetaPanel.tsx`, `TextosRapidos.tsx`, `etiquetaFormulario.ts`, `plantillasVisuales.ts`, `VisualCanvasEditor.tsx`, `scripts/marcar_manteca_formulario.py`, `tests/test_formulario_manteca.py`, `docs/team-recaps.md`

### 2026-09-07 01:25 - Studio: MANTECA 1000g como formulario de etiqueta
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - La etiqueta física **MANTECA DE CACAO REFINADA 1000g** (76×66 mm) quedó como formulario: 12 cajas variables (`nombre`, `tagline`, `concentracionValor`, `casNumero`, `ghs`, `origen`, `apariencia`, `olor`, `composicion`, `grado`, `almacenamiento`, `peso`) con autofit. Cambiar un dato solo reescribe el texto; x/y/ancho/alto/fuente de diseño no se mueven.
  - Panel lateral «Formulario de etiqueta» en el editor + carga desde ficha técnica (`GET /api/fichas/datos`). Aplicar en lote ya no exige plantilla SCI (`ficha_mp`).
  - La caja del tagline se recortó a la barra naranja (el scan la dejaba 200 px y tapaba Concentración/ORIGEN). Export PNG idéntico al original; relleno con urea no solapa.
  - **No** se marcó `ficha_mp` (eso regeneraría el layout SCI y destruiría la sticker).
- **Archivos Modificados:** `desktop/src/lib/etiquetaFormulario.ts`, `FormularioEtiquetaPanel.tsx`, `VisualCanvasEditor.tsx`, `plantillaFichaTecnicaMp.ts`, `plantillas_visuales.py`, `AplicarLotePanel.tsx`, `scripts/marcar_manteca_formulario.py`, `tests/test_formulario_manteca.py`, `docs/agentic/modules/desktop-panel.md`, `docs/team-recaps.md`

### 2026-09-07 00:45 - Studio: autofit de texto + Aplicar en lote
- **Autor:** Claude (Sonnet 5)
- **Tipo de Cambio:** Corrección de raíz / Feature
- **Qué se implementó:**
  - Causa raíz del bug de aplicación masiva (texto sobrepuesto al diligenciar en escala, ej. 76×66mm / MANTECA DE CACAO REFINADA 1000g): `exportar_raster`/`exportar_pdf` nunca comparaban la altura del texto contra su caja. Nuevo autofit opt-in (`autofit`/`minFontSize` por elemento) reduce fuente/interlineado hasta caber, o marca `requiere_revision` en vez de desbordar en silencio. Sin cambios para las plantillas ya guardadas (campo ausente = comportamiento actual).
  - Nuevo campo `campoProducto` en `ElementoTexto` (+ `contenidoCampoProductoFichaMp` en `plantillaFichaTecnicaMp.ts`): identifica qué texto de una ficha MP es variable por producto vs. fijo de marca, ya conectado en los ~15 campos de `plantillaFichaTecnicaMp()` con `autofit: true` por defecto.
  - Endpoint `POST /api/plantillas-visuales/aplicar-lote` + `aplicar_plantilla_lote()`: aplica una plantilla a N SKUs con autofit real. Nueva pantalla "Aplicar en lote" (`AplicarLotePanel.tsx`, botón en las tarjetas de ficha MP del Studio) para usarlo sin tocar código.
  - Almacenamiento por producto: `renders_etiquetas/<sku>/etiqueta.png` + `ficha_tecnica.json` (SKU/código Siigo, mismo identificador que `/api/etiquetas/datos/<sku>`); nuevo campo `sku` opcional en `plantillas_visuales.json`.
  - `FichaMpDiligenciarPanel` (Diligenciar etiqueta) exporta ahora vía el motor backend (autofit incluido) en vez de `html-to-image` sobre el DOM — lo que se aprueba 1-a-1 coincide con lo que produce el lote. La pantalla interactiva (clic-para-editar, sliders de `AjustesDiagramacionCompleta`) no se tocó: se evaluó migrarla a `VisualCanvasEditor` pero ese editor es de pantalla completa (no aloja un sidebar) y el renderer estático liviano del proyecto omite líneas/imágenes — habría degradado una UX que ya funciona bien para el caso 1 a 1.
  - "Generar formatos de etiqueta" ya se había retirado en el commit anterior (22:54) — confirmado, nada pendiente ahí.
- **Archivos Modificados:** `app/tools/plantillas_visuales.py`, `app/routes.py`, `desktop/src/lib/plantillasVisuales.ts`, `desktop/src/lib/plantillaFichaTecnicaMp.ts`, `desktop/src/components/plantillas-visuales/FichaMpDiligenciarPanel.tsx`, `desktop/src/components/plantillas-visuales/PlantillasVisualesPanel.tsx`, `desktop/src/components/plantillas-visuales/AplicarLotePanel.tsx` (nuevo), `tests/test_plantillas_visuales_autofit.py` (nuevo), `tests/test_plantillas_visuales_lote.py` (nuevo), `docs/team-recaps.md`

### 2026-09-06 23:10 - Studio: diagramar foto al tamaño del lienzo
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Corrección / Feature
- **Qué se implementó:**
  - La diagramación desde captura ya no vuelca textos en la plantilla SCI fija: la Visión IA copia posiciones (0–1) y el servidor las escala al `canvas_w×canvas_h` del formato elegido.
  - Flujo: Nueva plantilla → elegir tamaño → pegar/subir foto (o lienzo vacío) → editor con el dibujo ajustado.
  - API `POST /api/plantillas-visuales/abstraer-etiqueta` con `modo: "layout"` + dimensiones del formato.
- **Archivos Modificados:** `plantillas_etiqueta_vision.py`, `routes.py`, `ScanCapturaLayoutPanel.tsx`, `PlantillasVisualesPanel.tsx`, `FichaMpDiligenciarPanel.tsx`, `tests/test_plantillas_etiqueta_layout.py`, `docs/team-recaps.md`

### 2026-09-06 22:54 - Studio: quitar formato Ficha técnica MP
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Mejora técnica
- **Qué se implementó:**
  - En Diseño → Studio visual ya no aparece el formato ni el diseño «Ficha técnica MP» al crear plantilla.
  - Se retiró de los tipos de impresión (90×140 mm), de los presets de Fichas técnicas y de los botones «Diligenciar etiqueta» / «Generar formatos de etiqueta».
  - Nueva plantilla abre lienzo vacío al elegir tamaño. Las fichas MP ya guardadas siguen abriéndose.
- **Archivos Modificados:** `etiquetasTipos.ts`, `plantillasVisuales.ts`, `PlantillasVisualesPanel.tsx`, `etiquetas_studio.py`, `routes.py`, `SelectorDisenoPlantilla.tsx` (eliminado), `docs/team-recaps.md`

### 2026-09-06 19:00 - Alegra: eliminar productos OIL*
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Operación / datos
- **Qué se implementó:**
  - Se eliminaron (o inactivaron si tenían documentos) los productos cuyo SKU empieza por `OIL` en Alegra y en el espejo local.
- **Archivos Modificados:** (ERP Alegra) · `app/data/contabilidad.db` · `docs/team-recaps.md`

### 2026-09-06 18:50 - Catálogo Alegra: editar y eliminar
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Feature
- **Qué se implementó:**
  - En Contabilidad → Catálogo Alegra cada fila tiene Editar (nombre + precio lista) y Eliminar.
  - API `PATCH/DELETE /api/alegra/catalogo/<codigo>`: escribe en Alegra y actualiza el espejo SQLite; si no se puede borrar por documentos, inactiva.
- **Archivos Modificados:** `app/services/alegra.py`, `app/services/alegra_catalogo_db.py`, `app/routes.py`, `desktop/src/components/CatalogoAlegraPanel.tsx`, `docs/agentic/CONTRACTS.md`, `tests/test_alegra_catalogo_db.py`, `docs/team-recaps.md`

### 2026-09-06 18:35 - Sync precios MeLi → Alegra
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Operación / datos
- **Qué se implementó:**
  - Reconciliación `reconciliar_precios_meli`: se aplicaron 22 SKUs (ajustes &lt;2× + altas desde precio Alegra $0). Actualizó Alegra, Sheets y web.
  - Se omitieron 8 casos sospechosos (&gt;2× con precio Alegra ya cargado), p. ej. `C-ALMNAT250g`, `C-ACEITEATRE5mL`, `AGTMGNPLN` — requieren revisión manual (posible cruce de SKU).
- **Archivos Modificados:** (ERP Alegra / MeLi / Sheets / web) · `docs/team-recaps.md`

### 2026-09-06 17:35 - Alegra: eliminar combos sin sufijo mL/g
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Operación / datos
- **Qué se implementó:**
  - Se eliminaron 45 combos cuyo SKU no terminaba en `mL` ni `g` (duplicados truncados, UN/CM/LT/KG, kits sin unidad, etc.).
  - `C-ESPCCRCRV22CM` no se pudo borrar (documentos asociados): quedó inactivo en Alegra y fuera del espejo local.
- **Archivos Modificados:** (ERP Alegra) · `app/data/contabilidad.db` · `docs/team-recaps.md`

### 2026-09-06 17:30 - Alegra: eliminar combos con prefijo D-
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Operación / datos
- **Qué se implementó:**
  - Se eliminaron en Alegra y en el espejo local los combos `D-ACETEATRE30mL` y `D-VITCACIASC500g` (duplicados de los `C-` equivalentes). No se tocó `DEXKg` ni otros SKU que solo empiezan por la letra D.
- **Archivos Modificados:** (ERP Alegra) · `app/data/contabilidad.db` · `docs/team-recaps.md`

### 2026-09-06 17:25 - Catálogo Alegra: clasificar productos / combos
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Mejora UX
- **Qué se implementó:**
  - El panel Catálogo Alegra pasa a dos tarjetas de clasificación (Productos / Combos) con conteos; la tabla filtra por tipo seleccionado.
  - La API `GET /api/alegra/catalogo` incluye `conteos:{product,kit}`.
- **Archivos Modificados:** `desktop/src/components/CatalogoAlegraPanel.tsx`, `app/services/alegra_catalogo_db.py`, `docs/agentic/CONTRACTS.md`, `tests/test_alegra_catalogo_db.py`, `docs/team-recaps.md`

### 2026-09-06 17:17 - Catálogo Alegra: fix sync POST 500
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - El botón «Sincronizar desde Alegra» devolvía 500: al iniciar sync en hilo, `estado_sync()` pisaba `ok=True` con `ok=None` y el log hacía `error[:120]` sobre `None`.
  - Respuesta de sync ahora fuerza `ok=True` al arrancar; el panel muestra el mensaje real del error si falla.
- **Archivos Modificados:** `app/services/alegra_catalogo_db.py`, `app/routes.py`, `desktop/src/components/CatalogoAlegraPanel.tsx`, `tests/test_alegra_catalogo_db.py`, `docs/team-recaps.md`

### 2026-09-06 16:30 - Catálogo Alegra local (SQLite + panel)
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Feature
- **Qué se implementó:**
  - Espejo local de productos y combos Alegra en `contabilidad.db` (`alegra_items` + `alegra_kit_components`), con sync bajo demanda y upsert al crear producto/combo.
  - API `GET/POST /api/alegra/catalogo*` y panel Contabilidad → Catálogo Alegra (buscar, filtro, receta, sincronizar).
  - Pickers (`buscar_productos_alegra_picker`) usan SQLite si la sync tiene <24 h; si no, caen a la API.
- **Archivos Modificados:** `app/services/contabilidad_db.py`, `app/services/alegra_catalogo_db.py`, `app/services/alegra.py`, `app/routes.py`, `desktop/src/components/CatalogoAlegraPanel.tsx`, `desktop/src/components/ContabilidadPanel.tsx`, `desktop/src/lib/contabilidadAccess.ts`, `desktop/src/lib/panelInfo.ts`, `desktop/src/stores/app.ts`, `desktop/src/App.tsx`, `docs/agentic/CONTRACTS.md`, `tests/test_alegra_catalogo_db.py`, `docs/team-recaps.md`

### 2026-09-06 15:55 - Salud del negocio: fix HTTP 504
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - El panel fallaba con HTTP 504 porque el cruce de facturas Siigo/Alegra (~50 s) corría en serie después de costos/MeLi y el proxy cortaba ~100 s.
  - Ese fetch ahora va en paralelo, con caché 5 min y `fecha_fin`; el resumen en memoria dura 10 min y, si expiró, sirve dato stale mientras recalcula.
  - Mensaje del panel más claro cuando llega 504/timeout.
- **Archivos Modificados:** `app/services/salud_negocio.py`, `tests/test_salud_negocio.py`, `desktop/src/components/SaludNegocioPanel.tsx`, `desktop/src/hooks/useSaludNegocio.ts`, `docs/team-recaps.md`

### 2026-09-06 15:55 - Alegra: combos retail Global Trading FEA18545
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Operación / datos
- **Qué se implementó:**
  - Se crearon 14 combos en Alegra (250/500) duplicando la receta de empaque de arándanos/almendra (secos) y agua destilada/cocoamida (aceite), cambiando el producto principal al granel correspondiente (`AJONEGSACg`, `BAYGOJBERg`, etc.).
- **Archivos Modificados:** (ERP Alegra) · `docs/team-recaps.md`

### 2026-09-06 15:40 - Alegra: graneles Global Trading FEA18545
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Operación / datos
- **Qué se implementó:**
  - Se crearon en Alegra los 7 productos a granel de FEA18545 que no estaban tras la migración: `ACECOCmL`, `AJONEGSACg`, `BAYGOJBERg`, `DATSAYg`, `SALROSHIMFINg`, `SALROSHIMGRUg`, `SEMCHIg`. Ya existían `ARADESg` y `ALMNATg`.
- **Archivos Modificados:** (ERP Alegra) · `docs/team-recaps.md`

### 2026-09-06 15:16 - Códigos EAN: resto Global Trading FEA18545
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Operación / datos
- **Qué se implementó:**
  - Se registraron los SKUs pendientes de la factura FEA18545 (2 refs por producto: 250 y 500): goji, dátiles, sal himalaya fino/grueso, chía y aceite de coco (mL). Almendra y arándano se omitieron porque ya existían; ajonjolí ya estaba del ejemplo.
- **Archivos Modificados:** `app/data/etiquetas_codigos_ean.json`, `docs/team-recaps.md`

### 2026-09-06 15:10 - Códigos EAN: ejemplo Global Trading (ajonjolí negro)
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Operación / datos
- **Qué se implementó:**
  - Ejemplo de SKU EAN con regla «3 letras por palabra principal + presentación»: `C-AJONEG250g` (#133) y `C-AJONEG500g` (#135), producto de la factura Global Trading FEA18545.
- **Archivos Modificados:** `app/data/etiquetas_codigos_ean.json`, `docs/team-recaps.md`

### 2026-09-06 14:45 - Biblioteca de extractos: botón que abre carpeta
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Mejora
- **Qué se implementó:**
  - La lista de extractos ya no queda abierta en la pantalla: hay un botón **Biblioteca** que abre una ventana tipo carpeta con todos los extractos guardados.
- **Archivos Modificados:** `IngresosEgresosPanel.tsx`, `docs/team-recaps.md`

### 2026-09-06 14:40 - Ingresos/Egresos: biblioteca de extractos
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Mejora
- **Qué se implementó:**
  - Los extractos ya no se listan como texto suelto: aparecen en una **biblioteca** con tarjetas (PDF/Excel/CSV), periodo, progreso de vínculos y acciones Renombrar/Eliminar.
  - La zona de arrastre quedó en una pastilla compacta junto a Nombre/Banco/Cuenta.
- **Archivos Modificados:** `IngresosEgresosPanel.tsx`, `panelInfo.ts`, `docs/team-recaps.md`

### 2026-09-06 14:20 - Ingresos/Egresos: subir extracto por arrastre
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Mejora
- **Qué se implementó:**
  - En Contabilidad → Ingresos / Egresos se puede **arrastrar** el extracto bancario (CSV, Excel o PDF) a la pantalla o a la zona de carga, además de elegir el archivo a mano.
  - Si el archivo no es de extracto, avisa en vez de subirlo.
- **Archivos Modificados:** `IngresosEgresosPanel.tsx`, `panelInfo.ts`, `docs/team-recaps.md`

### 2026-09-03 22:30 - Recordatorios: el visto ahora sí pasa al siguiente ciclo
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Corrección de Bug
- **Qué se implementó:**
  - Al dar visto bueno / reprogramar, los recordatorios **bimestrales** y **cada N días** avanzan un ciclo completo (p. ej. agua de ago-29 a oct-29, no al día siguiente).
  - El panel usa la fecha local de Colombia, no UTC: de noche ya no se quedan pegados en «Para hoy».
  - Un recordatorio de una sola vez abre el formulario con el mes siguiente, no con la fecha vencida.
- **Archivos Modificados:** `tickets_db.py`, `TicketsPanel.tsx`, `test_recordatorios_ciclo.py`, `docs/team-recaps.md`


- **Autor:** Cursor Auto
- **Tipo de Cambio:** Mejora técnica / Migración ERP
- **Qué se implementó:**
  - El módulo de Contabilidad (crear productos/combos, facturas de compra Gmail, centros de costo, costos de compras exterior) **escribe en Alegra**, no en Siigo.
  - El panel deja de hablar de Siigo en esas pantallas (Alegra ERP, Crear en Alegra, contrastar con Alegra).
  - Las facturas de venta **hasta el 2026-09-02** siguen leyéndose de Siigo (histórico); lo nuevo es Alegra. Las rutas `/api/siigo/*` se mantienen como alias para no romper el SPA.
- **Archivos Modificados:** `alegra.py`, `siigo.py`, `importar_productos_siigo.py`, `sincronizar_facturas_de_compra_siigo.py`, `contabilidad_db.py`, `routes.py`, paneles Contabilidad/Facturación, `test_alegra_contabilidad.py`, `CONTRACTS.md`


- **Autor:** Cursor Auto
- **Tipo de Cambio:** Corrección / Mejora
- **Qué se implementó:**
  - El OCR de compras exterior extrae el **Order ID / Invoice No / Pedido** del pantallazo (`numero_pedido` / `referencia`), no el id interno de la BD.
  - Se persiste en la compra; el modal de verificación permite editarlo; historial y cuenta de cobro (PDF + vista previa) muestran ese número (si falta, caen al `#id` interno).
- **Archivos Modificados:** `compra_exterior_ocr.py`, `contabilidad_db.py`, `cuenta_cobro_cuota_manejo.py`, `routes.py`, `ComprasExteriorPanel.tsx`, `CuentaCobroAprobacion.tsx`, `test_cuenta_cobro_cuota_manejo.py`, `CONTRACTS.md`, `docs/team-recaps.md`

### 2026-09-02 20:45 - Extracción IA: fecha de compra del invoice
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Corrección de Bug
- **Qué se implementó:**
  - Al escanear un pantallazo, el formulario enviaba siempre la fecha de hoy y **pisaba** la fecha que leía la IA del invoice.
  - Ahora la fecha del documento (OCR) tiene prioridad; la del formulario solo se usa si el OCR no encuentra fecha. También se aceptan formatos US (`08/20/2026`, `Aug 20, 2026`).
- **Archivos Modificados:** `compra_exterior_ocr.py`, `trm.py`, `test_compra_exterior_ocr.py`, `test_trm.py`, `CONTRACTS.md`, `docs/team-recaps.md`

### 2026-09-02 22:20 - Cuenta de cobro: número de pedido visible
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Mejora
- **Qué se implementó:**
  - El PDF y la vista previa de cuenta de cobro (mercancía y flete) muestran el pedido del documento si existe; si no, **Pedido Nº {id}** interno.
- **Archivos Modificados:** `cuenta_cobro_cuota_manejo.py`, `CuentaCobroAprobacion.tsx`, `test_cuenta_cobro_cuota_manejo.py`, `docs/team-recaps.md`

### 2026-09-02 21:35 - Verificación de extracción en emergente
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Mejora de interfaz
- **Qué se implementó:**
  - Al pegar/adjuntar y extraer una compra, la revisión (fecha, TRM, flete, líneas y confirmar) abre en un **modal centrado**, sin tener que bajar por el historial.
- **Archivos Modificados:** `ComprasExteriorPanel.tsx`, `docs/team-recaps.md`

### 2026-09-02 21:25 - Botón actualizar costos unitarios del envío
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Mejora de interfaz
- **Qué se implementó:**
  - En cada envío consolidado hay un botón **Actualizar costos unitarios** que reparte el flete por % de paquetes y refresca el costo de cada referencia (historial + componentes).
- **Archivos Modificados:** `contabilidad_db.py`, `routes.py`, `ComprasExteriorPanel.tsx`, `test_cuenta_cobro_cuota_manejo.py`, `CONTRACTS.md`, `docs/team-recaps.md`

### 2026-09-02 21:20 - Envío consolidado: flete por % de paquetes
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Corrección / Mejora
- **Qué se implementó:**
  - Al enlazar varias compras en un envío, el flete se reparte por **porcentaje de paquetes** (`cantidad` de cada referencia ÷ total de packs), no por ml/g. Cada costo unitario sube con su parte del flete.
- **Archivos Modificados:** `compra_exterior_ocr.py`, `contabilidad_db.py`, `ComprasExteriorPanel.tsx`, `test_cuenta_cobro_cuota_manejo.py`, `CONTRACTS.md`, `docs/team-recaps.md`

### 2026-09-02 20:15 - Compras exterior: un paquete, flete con fecha de envío
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - Varias compras de fechas distintas se pueden **enlazar en un envío**. El flete se liquida con la TRM BanRep del **día del envío** y se reparte por unidades; cada factura sigue con su TRM de compra para la mercancía.
  - En el historial: marcar compras → **Enlazar en un envío** (fecha + flete). El paquete muestra una sola cuenta de cobro de flete.
- **Archivos Modificados:** `contabilidad_db.py`, `cuenta_cobro_cuota_manejo.py`, `routes.py`, `ComprasExteriorPanel.tsx`, `test_cuenta_cobro_cuota_manejo.py`, `CONTRACTS.md`, `docs/team-recaps.md`

### 2026-09-02 19:45 - Control de Inventario deja de colgarse al cargar
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - El panel Control de Inventario se quedaba en “Cargando inventario…” porque `/api/inventario-control/resumen` barría MeLi en vivo (sin timeout en cada lote) y Mercado Libre cortaba la conexión (~31 s, `Connection reset`).
  - El GET ahora entrega de inmediato el último snapshot (caché ~90 s, usable hasta 6 h) y actualiza MeLi en segundo plano. El botón de refrescar fuerza un recálculo; si MeLi falla, se muestra el snapshot con aviso.
  - Cada lote a MeLi tiene timeout; un lote caído no tumba el resumen completo. El cron semanal de recordatorio pide recálculo en vivo (`refresh=True`).
- **Archivos Modificados:** `app/services/inventario_control.py`, `app/sync.py`, `app/routes.py`, `desktop/src/hooks/useInventarioControl.ts`, `InventarioControlPanel.tsx`, `tests/test_inventario_control.py`, `docs/agentic/CONTRACTS.md`, `docs/team-recaps.md`

### 2026-09-02 20:05 - Compras exterior: vista previa de cuenta de cobro en modal
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Mejora de interfaz
- **Qué se implementó:**
  - Al pulsar **Aprobar cobro** (o al confirmar costos), la vista previa ya no aparece al final de la página: emerge en un modal centrado, con fondo oscuro, se cierra con ✕, Escape o clic fuera.
- **Archivos Modificados:** `ComprasExteriorPanel.tsx`, `docs/team-recaps.md`


- **Autor:** Cursor Auto
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - En Compras en el exterior se puede elegir a **nombre de quién** sale la cuenta de cobro (Cynthia, Armando u otro usuario del panel), en lugar de usar siempre a quien está logueado.
  - El PDF y el historial guardan ese emisor (`emisor_usuario_id` + nombre). Al aprobar o regenerar se usa el perfil elegido (nombre y documento).
  - El usuario elegido debe tener documento de identidad en Mi perfil.
- **Archivos Modificados:** `cuenta_cobro_cuota_manejo.py`, `contabilidad_db.py`, `routes.py`, `ComprasExteriorPanel.tsx`, `CuentaCobroAprobacion.tsx`, `useEmisoresCuentaCobro.ts`, `test_cuenta_cobro_cuota_manejo.py`, `CONTRACTS.md`, `docs/team-recaps.md`


- **Autor:** Cursor Auto
- **Tipo de Cambio:** Corrección de Bug / Abstracción Visión IA
- **Qué se implementó:**
  - Se corrigió un error de indentación en `plantillas_etiqueta_vision.py` que causaba que el endpoint `/api/plantillas-visuales/abstraer-etiqueta` fallara internamente y devolviera un error 500.
  - Se eliminó el comportamiento en `FichaMpDiligenciarPanel.tsx` que sobreescribía los campos vacíos o fallidos con la plantilla por defecto de SCI ("COCOIL ISETIONATO DE SODIO", "90%", "61789-32-0", etc.).
  - Ahora, al capturar o pegar una etiqueta (como "CREATINA MONOHIDRATO 1000g"), el sistema mapea con fidelidad:
    1. El nombre real del producto ("CREATINA MONOHIDRATO") y categoría ("INSUMO ALIMENTARIO").
    2. El color predominante detectado (ej. azul corporativo `#0b4199`).
    3. El formato de peso detectado ("1000 g" / "1 kg", incorporados a `TIPOS_ETIQUETA_DEFAULT`).
    4. El número CAS ("6020-87-7"), concentración ("≥ 99,0%") e información técnica.
    5. Código EAN-13, precauciones y especificaciones reales sin revertir a datos ficticios.
- **Archivos Modificados:** `plantillas_etiqueta_vision.py`, `FichaMpDiligenciarPanel.tsx`, `etiquetasTipos.ts`, `docs/team-recaps.md`

### 2026-08-26 18:05 - Studio: galería responsive de características visuales de producto
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Nuevo Componente UI / Frontend
- **Qué se implementó:**
  - Se creó el componente `GaleriaCaracteristicasProducto.tsx` (`desktop/src/components/GaleriaCaracteristicasProducto.tsx`) siguiendo estrictamente las especificaciones:
    1. **Diseño Visual:**
       - Cada característica en círculo perfecto (`aspect-square`, `rounded-full`) con borde `#351477` (2.5px) y fondo blanco puro `#FFFFFF`.
       - Iconos vectoriales minimalistas de línea uniforme (`stroke-width: 2.8`, `stroke-linecap: round`), sin rellenos, sombras ni efectos 3D.
       - Título exterior en MAYÚSCULAS, centrado, tipografía Montserrat / Sans-serif Bold, limitado a 2 líneas con alineación uniforme.
    2. **Estructura Responsive:**
       - Computadores (lg): 4 círculos por fila (`lg:grid-cols-4`).
       - Tabletas (sm/md): 2 círculos por fila (`sm:grid-cols-2`).
       - Móviles: 2 o 1 círculos por fila con espaciado amplio y uniforme.
    3. **8 Características Iniciales Vectorizadas:**
       - *Espuma cremosa:* Nube de espuma con microburbujas esféricas.
       - *Limpieza suave:* Gota de agua con hoja botánica interna.
       - *Fácil dispersión:* Vaso/matraz con partículas dispersándose en solución líquida.
       - *Suavidad:* Pluma estilizada con curvas sutiles.
       - *Alta pureza:* Matraz con graduación analítica y destello estelar de pureza.
       - *Uso cosmético:* Tarro cosmético con crema densa formulada.
       - *Fórmulas sólidas:* Barra cosmética sólida con micro-burbuja.
       - *Materia prima:* Red molecular química hexagonal con enlaces atómicos.
    4. **Accesibilidad & Extensibilidad:**
       - Basado en arreglo de datos `{ id, titulo, descripcionAccesible, icono }`.
       - Atributos semánticos `role="figure"`, `role="img"`, `aria-label` y `aria-hidden`.
- **Archivos Modificados:** `GaleriaCaracteristicasProducto.tsx`, `docs/team-recaps.md`

### 2026-08-26 18:00 - Studio: nueva categoría e iconos especializados en Cuidado de Piel (Skincare)
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Nueva Funcionalidad / Ampliación de Biblioteca de Iconos
- **Qué se implementó:**
  - Se incorporó la categoría **"💆‍♀️ Cuidado de Piel / Skincare"** en la Galería de Iconos Circulares Minimalistas con 12 nuevos iconos vectoriales de trazos orgánicos y fluidos:
    1. **Perfil Facial & Luminosidad (Glow):** Silueta orgánica de rostro y cuello con destellos de luminosidad y firmeza dérmica.
    2. **Barrera Cutánea & Capas Dérmicas:** Tres estratos celulares ondulados con escudo protector frente a agresores externos y gotas de ceramidas.
    3. **Anti-Edad / Colágeno & Firmeza:** Fibras de triple hélice de colágeno y elastina entrelazadas con efecto tensor y lifting.
    4. **Hidratación Profunda & Ácido Hialurónico:** Macro gota humectante con ondas expansivas dérmicas y micro-esferas acuosas.
    5. **Piel Sensible / Calmante & Anti-Rojeces:** Hoja de centella asiática (cica) con ondas de alivio y caricia dérmica.
    6. **Contorno de Ojos & Mirada Radiante:** Ojo sereno con ceja botánica, arco protector periocular y tratamiento de bolsas/ojeras.
    7. **Fotoprotección / Filtro Solar UV (SPF):** Sol con rayos sinuosos orgánicos frente a escudo protector que desvía la radiación UVA/UVB.
    8. **Despigmentante / Tono Uniforme & Glow:** Destellos estelares cristalinos de tono uniforme y acción anti-manchas (Vitamina C / Niacinamida).
    9. **Renovación Celular / Peeling Químico (AHA/BHA):** Desprendimiento suave de estrato córneo con células jóvenes y radiantes debajo.
    10. **Control de Sebo / Poros Limpios (Matificante):** Poro dérmico en embudo purificado con hojas botánicas astringentes y gota equilibrada.
    11. **Mascarilla Facial / Velo de Tratamiento:** Velo nutritivo facial con aberturas anatómicas y destellos de serum concentrado.
    12. **Microbioma & Probióticos Dérmicos:** Escudo biológico con bacterias y fermentos benéficos simbióticos para defensa inmunitaria dérmica.
- **Archivos Modificados:** `iconosQuimicaCirculares.ts`, `GaleriaIconosQuimicosModal.tsx`, `docs/team-recaps.md`

### 2026-08-26 17:55 - Studio: trazos orgánicos y fluidos con naturalidad botánica
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Refinamiento Estético / Naturalidad Botánica
- **Qué se implementó:**
  - Se transformaron los trazos rígidos y geométricos en **líneas orgánicas fluidas, curvas naturales botánicas y contornos sinuosos**:
    1. **Frutos Secos & Semillas:** Curvas Bézier suaves que emulan la forma real de la naturaleza (almendras con vetas fluidas, nuez con pliegues sinuosos cerebriformes, avellana con hojas rizadas, coco con fibras asimétricas y pulpa suave, maní con cintura orgánica, pistacho y macadamia con valvas botánicas).
    2. **Cosmética & Botánica:** Hoja botánica con nervaduras fluidas y punta en gota, flor con pétalos orgánicos de grosor variable, gota lipídica con menisco suave.
    3. **Sensación visual:** Mayor calidez, naturalidad y elegancia artesanal propia de la cosmética limpia y botánica.
- **Archivos Modificados:** `iconosQuimicaCirculares.ts`, `docs/team-recaps.md`

### 2026-08-26 17:50 - Studio: mayor detalle descriptivo y claridad visual en iconos
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Refinamiento Visual y Detalle Gráfico
- **Qué se implementó:**
  - Se incrementó el nivel de detalle descriptivo con más líneas, texturas y elementos complementarios en toda la galería de iconos para asegurar su reconocimiento instantáneo:
    1. **Frutos Secos & Semillas:**
       - *Almendra:* Fruto en cáscara con estrías + corte transversal con semilla expuesta.
       - *Nuez de Nogal:* Doble hemisferio cerebroide con tabique leñoso y cáscara estriada.
       - *Avellana:* Cúpula foliar superior dentada con fruto esférico rayado y ápice.
       - *Castaña:* Erizo de púas exterior de fondo + castaña lisa con halo leñoso basal.
       - *Coco:* Corteza de fibra abierta con pulpa interna concéntrica y salpicaduras de leche/aceite.
       - *Maní / Cacahuate:* Vaina con retícula de rombos y ventana con dos granos enteros.
       - *Pistacho:* Doble valva leñosa abierta con fruto verde central estriado.
       - *Macadamia:* Cáscara bivalva gruesa con núcleo cremoso esférico.
       - *Semillas de Girasol:* Grano con cáscara negra rayada + pepita pelada.
       - *Sésamo / Ajonjolí:* Vaina abierta de 4 valvas con semillas en relieve.
    2. **Química & Laboratorio:**
       - *Molécula:* Dobles enlaces y resonancia aromática clara.
       - *Átomo:* Orbitales elípticos con electrones y núcleo compuesto.
       - *Alambique:* Matraz con mechero, cuello de cisne, tubo refrigerante de condensación y matraz receptor.
       - *Erlenmeyer:* Cuello calibrado con marcas de ml y burbujas de reacción.
       - *Mortero:* Pico vertedor, mano ergonómica y polvo micronizado.
       - *Microscopio:* Pie sólido, platina con pinzas, revólver de objetivos y ocular.
- **Archivos Modificados:** `iconosQuimicaCirculares.ts`, `docs/team-recaps.md`

### 2026-08-26 17:45 - Studio: iconos de frutos secos y semillas botánicas para formulación
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Nueva Funcionalidad / Ampliación de Biblioteca de Iconos
- **Qué se implementó:**
  - Se incorporó la categoría **"🌰 Frutos Secos & Semillas"** en la Galería de Iconos Circulares Minimalistas con 10 iconos vectoriales:
    1. **Almendra (Aceite Dulce & Proteína):** Silueta apuntada con textura de estrías botánicas (Prunus dulcis).
    2. **Nuez de Nogal / Cerebro:** Vista transversal con hendidura y pliegues ricos en omega/antioxidantes (Juglans regia).
    3. **Avellana con Cúpula Botánica:** Fruto redondeado con cúpula foliar superior (Corylus avellana).
    4. **Castaña / Castaño de Indias:** Forma acorazonada con hilo basal para tónicos y extractos venotónicos.
    5. **Coco & Fracción Lipídica:** Mitad de coco abierto con corteza, pulpa y gotas de aceite laúrico.
    6. **Maní / Cacahuate en Vaina:** Vaina bilobulada con relieve de retícula leñosa.
    7. **Pistacho Entreabierto:** Cáscara bivalva entreabierta revelando la semilla interior.
    8. **Nuez de Macadamia:** Esfera botánica de cáscara gruesa y núcleo rico en ácido palmitoleico.
    9. **Semillas de Girasol / Pepitas:** Par de semillas estriadas ricas en vitamina E natural.
    10. **Semillas de Sésamo / Ajonjolí:** Trío de semillas de alta pureza y extracción oleosa.
- **Archivos Modificados:** `iconosQuimicaCirculares.ts`, `GaleriaIconosQuimicosModal.tsx`, `docs/team-recaps.md`

### 2026-08-26 17:40 - Studio: icono de espuma con burbujas y opción de silueta libre / con círculo
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Mejora de Biblioteca de Iconos y UX
- **Qué se implementó:**
  - Se incorporó el icono **Espuma Abundante / Nube de Burbujas** en la categoría de texturas con la estética solicitada (nube esponjosa con burbujas circulares flotantes).
  - Se calibraron los grosores de trazo (stroke-width: 2.8px) y bordes redondeados para brindar una estética limpia, armónica y definida.
  - Se agregó el botón interactivo de alternancia **"⭕ Con círculo" / "✨ Libre"** en la cabecera de la galería de iconos, permitiendo elegir si se inserta el icono con marco circular o en silueta libre.
- **Archivos Modificados:** `iconosQuimicaCirculares.ts`, `GaleriaIconosQuimicosModal.tsx`, `docs/team-recaps.md`

### 2026-08-26 17:35 - Studio: iconos de texturas (cremas, lociones, polvo, ceras, aceites, gel, mantecas)
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Nueva Funcionalidad / Ampliación de Biblioteca de Iconos
- **Qué se implementó:**
  - Se incorporó la categoría **"🧴 Texturas & Formas"** en la Galería de Iconos Circulares Minimalistas con iconos vectoriales encerrados en círculo:
    1. **Crema / Pomada / Emulsión Densa:** Tarro cosmético con crema untuosa.
    2. **Espiral de Crema / Swirl:** Trazo de textura sedosa y suave.
    3. **Loción / Fluido / Botella Pump:** Envase dosificador para emulsiones ligeras y leches corporales.
    4. **Polvo / Gránulos / Micronizado:** Montículo y partículas micronizadas para materias primas sólidas (talcos, arcillas, surfactantes en polvo).
    5. **Ceras / Bloque & Panal:** Estructura geométrica tipo panal y escamas (cera de abejas, candelilla, carnauba).
    6. **Cera en Pastillas / Perlas:** Gotas sólidas y perlas de emulsión.
    7. **Aceite / Oleoso / Viscosidad:** Gota densa con ondas concéntricas de viscosidad y fase lipídica.
    8. **Gel / Gelificante / Viscosidad Cristalina:** Masa fluida y cristalina de polímero/gel.
    9. **Serum / Elixir Concentrado:** Botella de extracto o serum con pipeta.
    10. **Manteca / Bálsamo Untuoso:** Bloque geométrico de manteca pura (karité, cacao, mango).
- **Archivos Modificados:** `iconosQuimicaCirculares.ts`, `docs/team-recaps.md`

### 2026-08-26 17:30 - Studio: galería de iconos circulares de química y alquimia minimalista
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Nueva Funcionalidad / Biblioteca de Iconos Vectoriales
- **Qué se implementó:**
  - **Galería de Iconos Circulares de Química & Alquimia (`GaleriaIconosQuimicosModal`):**
    1. **Estética limpia, moderna y minimalista:** Iconos vectoriales de trazo lineal uniforme encerrados armónicamente en círculos exteriores con proporción equilibrada.
    2. **Temáticas especializadas:**
       - 🧪 **Química & Fórmulas:** Molécula hexagonal (anillo aromático), átomo cuántico, polímero/cadena molecular, pH neutro/balanceado.
       - ⚗️ **Alquimia & Elementos:** Quintaesencia alquímica, Elemento Fuego (calcinación), Elemento Agua (disolución), Elemento Aire (sublimación), Elemento Tierra (precipitación), Símbolo Solar/Oro, Símbolo Lunar/Plata.
       - 🔬 **Laboratorio & Instrumental:** Alambique/destilador, matraz erlenmeyer de formulación, mortero y pistilo, gotero/pipeta de dosificación, tubo de ensayo, microscopio científico.
       - 🌿 **Cosmética & Botánica:** Extracto botánico / hoja orgánica, espuma micelar / tensioactivo cremoso, gota lipídica / aceite / emulsión, flor / esencia.
       - 💧 **Propiedades & Pureza:** Cristal de pureza / concentración USP, solubilidad en agua / dispersión, escudo antioxidante / antiage celular.
       - 🛡️ **Seguridad & Almacén:** Frasco hermético de almacenamiento, protección UV / fotosensible, termómetro de temperatura fresca.
    3. **Experiencia estilo selector de emojis:** Buscador en tiempo real por palabras clave (ej: *molécula, pH, alambique, gota, destilación*), pestañas de categorías horizontales y selector interactivo de color de tinta para previsualización inmediata.
    4. **Integración con la etiqueta:** Al hacer clic en cualquier icono del lienzo o en los botones del formulario (*Destacados 1, 2, 3, Aplicaciones, Incorporación, Almacenamiento*), se abre la nueva galería circular y el icono seleccionado se inserta directamente en la etiqueta.
- **Archivos Modificados / Creados:** `iconosQuimicaCirculares.ts`, `GaleriaIconosQuimicosModal.tsx`, `FichaMpDiligenciarPanel.tsx`, `docs/team-recaps.md`

### 2026-08-26 17:15 - Studio: independencia de tamaño de iconos y optimización de espacios en columna derecha
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Mejora de Diagramación / UX & Control Independiente
- **Qué se implementó:**
  - **Desacoplamiento e independencia total de iconos:**
    1. **Iconos de atributos / cajas (`tamIconos`):** Escala de forma exclusiva las burbujas, gota, etc. en los destacados de la columna izquierda.
    2. **Iconos de franjas (`tamIconosBandas`):** Escala de forma independiente los iconos de Aplicaciones y Modo de Empleo / Incorporación, sin alterar el pictograma GHS ni otras áreas.
    3. **Icono de Almacenamiento (`tamIconoAlmacen`):** Control independiente para el icono del frasco/almacenamiento en la columna derecha.
    4. **Pictograma GHS / Rombo de advertencia (`tamGhs`):** Ahora completamente desacoplado (ya no se escala en cascada con `tamIconos`).
    5. **Código de barras EAN-13 (`tamEan`):** Control independiente.
  - **Aprovechamiento y distribución del espacio en blanco en la columna derecha:**
    - Se recalibraron las proporciones de las filas de la columna derecha (`9% 34% 15% 17% 25%`) y sus paddings/gaps para eliminar los vacíos muertos excesivos.
    - Se equilibró la altura de la marca superior, se centró el bloque de advertencia GHS con espaciado armónico, se optimizó el bloque de metadatos de empresa y se centró el código de barras EAN-13 para un acabado profesional y balanceado.
- **Archivos Modificados:** `plantillaFichaTecnicaMp.ts`, `FichaMpDiligenciarPanel.tsx`, `docs/team-recaps.md`

### 2026-08-26 17:00 - Studio: selección y eliminación granular de líneas individuales
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Nueva Funcionalidad / Control Detallado de Diagramación
- **Qué se implementó:**
  - Se implementó control granular por línea individual en la pestaña **"➖ Líneas"** de los **Ajustes de Diagramación**:
    1. **Estructura general:** Borde exterior perimetral, Línea divisoria central vertical.
    2. **Columna Izquierda:** Línea bajo Tagline/subtítulo, Línea bajo Concentración & CAS, Bordes de cajas Concentración & CAS, Línea bajo Descripción, Línea bajo Atributos destacados, Bordes de cajas de Atributos, Línea bajo Aplicaciones, Línea bajo Modo de Empleo / Incorporación, Líneas laterales del Peso neto.
    3. **Columna Derecha:** Línea bajo Marca, Línea bajo Advertencia / Atención, Línea bajo Almacenamiento.
  - Cada línea cuenta con su propio selector interactivo (checkbox y estado activo/eliminado con tachado y color) para eliminarla o activarla de forma independiente.
  - Se agregaron botones de acción rápida **"Mostrar todas"** y **"Quitar todas"**.
  - `EtiquetaMpHtml` calcula en tiempo real las propiedades CSS individuales de cada borde (`--border-tagline`, `--border-specs`, `--border-desc`, `--border-feats`, `--border-apps`, `--border-inc`, `--border-peso`, `--border-marca`, `--border-atencion`, `--border-almacen`, etc.) permitiendo diagramar etiquetas personalizadas sin elementos no deseados.
- **Archivos Modificados:** `plantillaFichaTecnicaMp.ts`, `FichaMpDiligenciarPanel.tsx`, `docs/team-recaps.md`

### 2026-08-26 16:50 - Studio: control para eliminar y ocultar líneas y bordes
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Nueva Funcionalidad / Diagramación Visual
- **Qué se implementó:**
  - Se agregó la pestaña **"➖ Líneas"** dentro del panel de **Ajustes de Diagramación** (tanto en el Paso 1 de Escáner como en el Paso 2 de Diligenciar).
  - Permite activar o desactivar (eliminar visualmente) de forma independiente:
    1. **Borde exterior principal** de la etiqueta.
    2. **Línea divisoria central** entre la columna izquierda y derecha.
    3. **Líneas divisorias horizontales** entre las filas de contenido (tagline, especificaciones, descripción, atributos, aplicaciones, incorporación, advertencias, almacenamiento).
    4. **Contornos/Bordes de cajas** individuales (Concentración, CAS y Atributos).
  - Los cambios se reflejan al instante en el lienzo interactivo y en la exportación PNG.
- **Archivos Modificados:** `plantillaFichaTecnicaMp.ts`, `FichaMpDiligenciarPanel.tsx`

### 2026-08-26 16:40 - Studio: redimensionar cajas, rellenos, iconos y tamaños de textos en Escáner y Diligenciar
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Nueva Funcionalidad / UX & Diseño de Diagramación
- **Qué se implementó:**
  - Se implementó el panel de **Ajustes de Diagramación (`AjustesDiagramacionCompleta`)** disponible tanto en el **Paso 1 (Escáner de diagramación)** como en el **Paso 2 (Diligenciar formato)**:
    1. **Redimensionar Cajas & Bordes:** Sliders para relleno interno/altura de cajas (`tamCajas`), esquinas redondeadas (`radioCajas`) y grosor de bordes (`bordeCajas`).
    2. **Rellenos de Cajas (Fondos):** Opciones de relleno con vista interactiva: *Transparente (solo contorno)*, *Sólido (tinta corporativa con contraste de texto blanco)*, *Suave (tinte 12%)* o *Color personalizado*.
    3. **Redimensionar Iconos:** Controles independientes para escalar iconos de atributos, pictograma GHS / Rombo de atención y código de barras EAN-13.
    4. **Tamaños de Textos:** Sliders para escalar título/sigla (SCI), nombre químico, cuerpo/descripciones/tagline, texto interno de cajas, texto de advertencias/atención y marca/peso.
    5. **Botón de Restablecer:** Permite regresar a los valores predeterminados en cualquier momento con un solo clic.
  - El renderizador `EtiquetaMpHtml` ahora aplica dinámicamente variables CSS y estilos para reflejar en tiempo real todos los cambios de tamaño, bordes, fondos y dimensiones en el lienzo y exportación PNG.
- **Archivos Modificados:** `plantillaFichaTecnicaMp.ts`, `FichaMpDiligenciarPanel.tsx`

### 2026-08-26 16:25 - Studio: abstracción inmediata garantizada al pegar o subir imagen
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Corrección Crítica / Diagramación en Vivo
- **Qué se implementó:**
  - Al pegar (<kbd>Ctrl+V</kbd>) o subir cualquier imagen de etiqueta en el escáner, se activa automáticamente la diagramación completa y poblada en el lienzo.
  - Se garantiza que el lienzo pase inmediatamente de "Lienzo en blanco" a la diagramación visual completa con todas las secciones activas (sigla, nombre químico, concentración, CAS, atributos/iconos, aplicaciones, incorporación, advertencia, empresa y código EAN).
  - Si la API responde con datos extraídos de la IA, estos se aplican directamente; si hay latencia o fallo de red, se activan los datos diagramados de respaldo para nunca dejar el lienzo en blanco tras adjuntar la foto.
- **Archivos Modificados:** `FichaMpDiligenciarPanel.tsx`

### 2026-08-26 16:15 - Studio: envío en Base64 y renderizado garantizado tras abstracción IA
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Corrección de Bug / Visión IA
- **Qué se implementó:**
  - Al subir o pegar la imagen con <kbd>Ctrl+V</kbd>, se codifica directamente en Base64 para garantizar compatibilidad total con la API `/api/plantillas-visuales/abstraer-etiqueta`.
  - Se agregó notificación visual flotante con el estado del escaneo y errores.
  - Al completarse la abstracción, el lienzo derecho actualiza de inmediato todas las secciones con los datos reales de la foto adjunta.
- **Archivos Modificados:** `FichaMpDiligenciarPanel.tsx`

### 2026-08-26 16:10 - Studio: abstracción de elementos sobre capturas reales y renderizado en vivo
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Corrección / Visión IA & Frontend
- **Qué se implementó:**
  - Se actualizó el prompt de Visión IA para distinguir capturas con datos reales (ej. la etiqueta de SCI con "ESPUMA CREMOSA", "90%", CAS, "LIMPIEZA SUAVE", etc.) vs plantillas vacías, asegurando transcripción fidedigna e inmediata.
  - Al recibir la abstracción de la imagen, el frontend actualiza todo el estado del lienzo, eliminando el estado de lienzo en blanco y dibujando la etiqueta diagramada con sus textos, colores y atributos extraídos.
- **Archivos Modificados:** `app/tools/plantillas_etiqueta_vision.py`, `FichaMpDiligenciarPanel.tsx`

### 2026-08-26 16:00 - Studio: lienzo 100% en blanco sin textos ficticios y abstracción IA en caliente
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Corrección / Mejora de UX & Visión IA
- **Qué se implementó:**
  - El lienzo en blanco ahora es una tarjeta limpia y nítida sin textos ficticios ni diagramas ficticios ("SIGLA", "NOMBRE DE LA MATERIA PRIMA", etc.).
  - Los campos vacíos ya no muestran textos de relleno ni cajas predeterminadas cuando el lienzo está en blanco.
  - Se corrigió la carga de variables de entorno `.env` en el módulo de Visión IA (`plantillas_etiqueta_vision.py`) y la autorización en `/api/plantillas-visuales/abstraer-etiqueta` para procesar las imágenes subidas o pegadas de forma instantánea.
  - Al subir o pegar la foto real de una etiqueta, la IA extrae los datos y reemplaza el lienzo en blanco por la etiqueta completamente diagramada y poblada con los textos, colores y especificaciones extraídas.
- **Archivos Modificados:** `app/tools/plantillas_etiqueta_vision.py`, `app/routes.py`, `plantillaFichaTecnicaMp.ts`, `FichaMpDiligenciarPanel.tsx`

### 2026-08-26 15:55 - Studio: lienzo en blanco por defecto y abstracción automática con Visión IA
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Nueva funcionalidad / Visión IA
- **Qué se implementó:**
  - El lienzo inicia completamente en blanco (`DATOS_FICHA_MP_VACIA`), eliminando los datos prellenados de ejemplo por defecto.
  - Al adjuntar una fotografía o pegar una captura (<kbd>Ctrl+V</kbd>), se activa el motor de abstracción con Visión IA (`/api/plantillas-visuales/abstraer-etiqueta`, Gemini + Claude de respaldo).
  - La IA extrae automáticamente: nombre químico, sigla, concentración, CAS, descripción, atributos e iconos, aplicaciones, modo de empleo, texto de advertencia, peso, color de tinta corporativo y código EAN.
  - Se mapean los elementos de forma instantánea a la diagramación del lienzo y formulario.
  - Botones de acción rápida: "Vaciar / Lienzo en blanco" y "Cargar ejemplo SCI".
- **Archivos Modificados:** `app/tools/plantillas_etiqueta_vision.py`, `app/routes.py`, `plantillaFichaTecnicaMp.ts`, `FichaMpDiligenciarPanel.tsx`

### 2026-08-26 15:45 - Studio: formato de impresión desplegable en Paso 1
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Mejora de UX
- **Qué se implementó:**
  - El selector de formato de impresión en el Paso 1 (Escáner de diagramación) ahora es un menú desplegable (`<select>`) compacto con nombre, medidas en pulgadas/mm e indicador dinámico de proporción nativa SCI.
- **Archivos Modificados:** `FichaMpDiligenciarPanel.tsx`

### 2026-08-26 15:40 - Studio: agregar captura en escáner de diagramación (Paso 1)
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Nueva funcionalidad / UX
- **Qué se implementó:**
  - En el Paso 1 de «Diligenciar etiqueta», se agregó la capacidad de subir una imagen o pegar una captura directa desde el portapapeles (<kbd>Ctrl+V</kbd>).
  - Incluye modos de comparación: Lado a lado, Superponer (con slider de opacidad), Solo captura y Solo diagrama, para validar el escaneo anatómico de la etiqueta antes de diligenciarla.
- **Archivos Modificados:** `FichaMpDiligenciarPanel.tsx`

### 2026-08-26 15:35 - Studio: escáner de diagramación y selección de formato en diligenciar etiqueta
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Nueva funcionalidad / UX
- **Qué se implementó:**
  - Al abrir «Diligenciar etiqueta», se presenta primero una vista de escáner de la anatomía de diagramación SCI junto con la selección de formato de impresión físico (250 g, 500 g, etc.) y paleta de color.
  - Permite revisar proporciones y medidas de diagramación antes de pasar al formulario detallado de datos, con botón para volver a ajustar formato en cualquier momento.
- **Archivos Modificados:** `FichaMpDiligenciarPanel.tsx`

### 2026-08-26 15:30 - Studio: galería, EAN y GHS en diligenciar etiqueta
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - En «Diligenciar etiqueta» se pueden sustituir los iconos (destacados, aplicaciones, incorporación, almacenamiento) desde la galería de imágenes.
  - El código de barras se elige desde la biblioteca EAN (o se escribe a mano).
  - El rombo de atención se puede reemplazar por un pictograma GHS de la biblioteca.
- **Archivos Modificados:** `FichaMpDiligenciarPanel.tsx`, `plantillaFichaTecnicaMp.ts`, `CodigoBarrasEAN13.tsx`, `GHSIconsPicker.tsx`

### 2026-08-26 15:20 - Studio: editar tamaño y negrita del texto activo
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - En «Diligenciar etiqueta», al hacer clic en un campo del formulario o en un texto de la vista previa se activa la barra de edición (tamaño −/%/+ y negrita B).
  - El cambio aplica solo a ese texto y se guarda con la plantilla.
- **Archivos Modificados:** `FichaMpDiligenciarPanel.tsx`, `plantillaFichaTecnicaMp.ts`

### 2026-08-26 15:10 - Studio: diagramación SCI fija en 250 g / 500 g
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - La etiqueta diligenciada vuelve a la diagramación de la referencia SCI (líneas, cajas, iconos, badge 250 g).
  - 250 g y 500 g son el mismo layout 76×66 mm: solo cambia el peso. Otros formatos escalan esa diagramación entera, no la reacomodan.
- **Archivos Modificados:** `FichaMpDiligenciarPanel.tsx`, `plantillaFichaTecnicaMp.ts`

### 2026-08-26 15:00 - Studio: 250 g / 500 g sin recortar la etiqueta SCI
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - 250 g y 500 g son el mismo tamaño físico (76×66 mm). Al elegir 500 g ya no se corta SCI, cajas, aplicaciones ni el EAN: la tipografía se escala al alto real.
  - 250 g y 500 g solo cambian el peso; el resto del diseño se mantiene.
- **Archivos Modificados:** `FichaMpDiligenciarPanel.tsx`, `plantillaFichaTecnicaMp.ts`

### 2026-08-26 14:45 - Studio: zoom, estilo y guardar plantilla al diligenciar
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - En «Diligenciar etiqueta» la vista previa tiene zoom (− / % / + / 100%, Ctrl+rueda) independiente del PNG exportado.
  - Hay sliders para tipografía (título, nombre, cuerpo, cajas), tamaño de iconos, relleno y esquinas de cajas.
  - «Guardar plantilla» guarda el formulario en Studio; al reabrir esa tarjeta se vuelve al mismo formulario (color, textos y tamaños).
- **Archivos Modificados:** `FichaMpDiligenciarPanel.tsx`, `PlantillasVisualesPanel.tsx`, `plantillaFichaTecnicaMp.ts`, `plantillasVisuales.ts`, `plantillas_visuales.py`

### 2026-08-26 14:30 - Studio: diligenciar etiqueta como ficha técnica
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - En Studio visual, «Diligenciar etiqueta» abre un formulario (color, tamaño, nombre, CAS, textos…) con vista previa en vivo, igual que fichas técnicas.
  - Al cambiar un campo o el color, la imagen se actualiza al momento. Se puede descargar PNG o guardar en la biblioteca.
- **Archivos Modificados:** `FichaMpDiligenciarPanel.tsx`, `PlantillasVisualesPanel.tsx`

### 2026-08-26 14:20 - Studio: generar formatos de etiqueta
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - En Studio visual hay un botón «Generar formatos de etiqueta»: crea una ficha técnica MP (layout SCI) por cada formato de impresión (250 g, 30 mL, circular, Ficha MP 90×140 mm, etc.) en la carpeta Formatos etiqueta.
  - Las que ya existen no se pisan. El badge de peso toma el nombre del formato cuando es una presentación (250 g, 30 mL).
- **Archivos Modificados:** `plantillaFichaTecnicaMp.ts`, `PlantillasVisualesPanel.tsx`, `etiquetasTipos.ts`, `etiquetas_studio.py`, `routes.py`

### 2026-08-26 13:50 - Studio: plantilla ficha técnica MP (SCI)
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - Al crear un recurso en Studio visual (Diseño → Studio) se elige primero el tamaño y luego el diseño: lienzo vacío o ficha técnica de dos columnas (layout tipo SCI).
  - Color primario, abreviatura, nombre, CAS, peso y EAN se definen al crear; en el editor se sigue pudiendo recolorear todo (incluidos iconos SVG) y cambiar el formato.
  - Presets nuevos: Ficha MP 90×140 mm y foto MeLi 1080×1620 en Fichas técnicas.
- **Archivos Modificados:** `plantillaFichaTecnicaMp.ts`, `SelectorDisenoPlantilla.tsx`, `PlantillasVisualesPanel.tsx`, `plantillasVisuales.ts`, `VisualCanvasEditor.tsx`

### 2026-08-25 16:00 - Competencia: Buscar MeLi con palabras clave
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Mejora
- **Qué se implementó:**
  - La URL de «Buscar MeLi» arma la búsqueda con nombre, cantidad (g/ml), porcentaje/concentración y códigos tipo B5.
  - Si hay cantidad manual guardada, entra en la query; el panel muestra las palabras clave junto al botón.
- **Archivos Modificados:** `analisis_competencia_precios.py`, `CompetenciaPreciosPanel.tsx`, tests

### 2026-08-25 15:40 - Competencia: cantidad g/ml a mano
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - Casilla Cant. (número + g/ml) junto al precio para publicaciones cuyo título no trae empaque.
  - Se guarda por ítem y rearma la comparación/$/g; vacío + Guardar vuelve al título.
- **Archivos Modificados:** `analisis_competencia_precios.py`, `routes.py`, `CompetenciaPreciosPanel.tsx`, `useCompetenciaPrecios.ts`, tests

### 2026-08-25 15:20 - Competencia: grameras por precisión, no $/g
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - «0.001 G» ya no se toma como cantidad (salía 0 g); se usa «Hasta 50 Gr» como capacidad.
  - En grameras/balanzas se compara precio total y el resumen explica que el premium suele ser por precisión en miligramos.
- **Archivos Modificados:** `analisis_competencia_precios.py`, `CompetenciaPreciosPanel.tsx`, `useCompetenciaPrecios.ts`, tests

### 2026-08-25 15:05 - Competencia: kits 50g c/u cuentan el total
- **Autor:** Cynthia
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - Títulos tipo «A + B 50g C/u» o «2x50g» ya suman el contenido total (100 g), no solo 50 g.
  - El $/g de «Nosotros» se recalcula desde el título en el panel.
- **Archivos Modificados:** `analisis_competencia_precios.py`, `CompetenciaPreciosPanel.tsx`, tests

### 2026-08-25 14:40 - Competencia: captura sin cortar por Cloudflare
- **Autor:** Cynthia
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - El análisis del pantallazo ya no espera en el POST (Cloudflare cortaba ~100s con 502/524).
  - Ahora encola un job, el panel consulta el estado y muestra progreso; la imagen se comprime un poco más.
- **Archivos Modificados:** `competencia_captura_jobs.py`, `routes.py`, `useCompetenciaPrecios.ts`, `CompetenciaPreciosPanel.tsx`, `analisis_competencia_precios.py`

### 2026-08-25 14:05 - Competencia: detalle al clic en cada oferta
- **Autor:** Cynthia
- **Tipo de Cambio:** Mejora de interfaz
- **Qué se implementó:**
  - En Promociones, cada campaña (activa o candidata) se abre al clic y muestra tipo, descuento, vigencia, rango, stock e IDs.
  - Precio/fechas de opt-in quedan en el detalle; Vincular/Quitar siguen visibles en la fila.
- **Archivos Modificados:** `MeliPromocionesItem.tsx`, `docs/team-recaps.md`

### 2026-08-25 14:00 - Competencia: Ver evidencia PNG
- **Autor:** Cursor Auto
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - El botón Ver fallaba con «No hay evidencia» porque Flask (`mckg`) no podía escribir en `competencia_evidencias/` (permisos) y el error se tragaba en silencio.
  - Se regeneraron los PNG faltantes; el directorio queda usable por el servicio; los fallos de render ahora se loguean.
- **Archivos Modificados:** `analisis_competencia_precios.py`, `app/data/competencia_evidencias/`, `docs/team-recaps.md`

### 2026-08-25 09:25 - Competencia: precio por gramo o ml
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Mejora de interfaz
- **Qué se implementó:**
  - Las barras y el PNG muestran $ / g o $ / ml (ya no $ / 100 g).
- **Archivos Modificados:** `analisis_competencia_precios.py`, `CompetenciaPreciosPanel.tsx`, tests

### 2026-08-25 08:55 - Competencia: comparar por precio unitario en barras
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Mejora de interfaz
- **Qué se implementó:**
  - La comparación ya no exige el mismo empaque: 250 g vs 500 g sí, gramos vs ml no.
  - El veredicto usa $ / 100 g o $ / 100 ml. El panel y el PNG muestran barras (más larga = más caro).
- **Archivos Modificados:** `analisis_competencia_precios.py`, `CompetenciaPreciosPanel.tsx`, tests

### 2026-08-25 08:45 - Competencia: lista de promociones en una línea
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Mejora de interfaz
- **Qué se implementó:**
  - Cada campaña (activa o a vincular) cabe en una sola fila: nombre, precio/fechas y Vincular/Quitar.
  - Menos padding entre tarjetas; botones más bajos. El clic de Vincular sigue con `mck-btn-no-fx`.
- **Archivos Modificados:** `MeliPromocionesItem.tsx`

### 2026-08-25 08:40 - Competencia: Vincular promociones MeLi
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - Los botones Vincular ya no quedan inactivos ni bloqueados por el CSS compacto.
  - Lightning/oferta del día envían el stock reservado que MeLi exige; SMART manda offer_id y fechas.
  - Si MeLi rechaza, el error se ve arriba de la lista (caja roja).
- **Archivos Modificados:** `meli_promotions.py`, `MeliPromocionesItem.tsx`, `routes.py`, tests

### 2026-08-24 22:15 - Competencia: UI más compacta
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Mejora de interfaz
- **Qué se implementó:**
  - Botones más chicos (Actualizar, Publicar, Buscar MeLi, Capturar, Subir).
  - Ocultos textos secundarios: ranking/timestamp, MCO/uds, instrucciones de flujo, detalle de % y fechas en promociones.
- **Archivos Modificados:** `CompetenciaPreciosPanel.tsx`, `MeliPromocionesItem.tsx`

### 2026-08-24 22:10 - Quitar «actividad del servidor» / Limpiar log del panel
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Mejora de interfaz
- **Qué se implementó:**
  - Se eliminó el pie «Mostrar actividad del servidor» y el botón «Limpiar log» del Layout, Stock y Stock simple.
  - También se quitó la sección «Salida del Sistema» de Ajustes.
- **Archivos Modificados:** `Layout.tsx`, `StockPanel.tsx`, `StockPanelSimple.tsx`, `Settings.tsx`, `TerminalLog.tsx`

### 2026-08-24 16:35 - Competencia: interfaz maestro-detalle más práctica
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Mejora de interfaz
- **Qué se implementó:**
  - Layout en dos columnas: lista de productos a la izquierda (búsqueda + filtros KPI) y panel de trabajo a la derecha.
  - Flujo visible «1 Buscar en MeLi → 2 Pegar pantallazo» con zona de captura grande; pestañas Comparación / Promociones / Anotar en lugar de acordeones anidados.
  - Auto-selección del primer producto «a revisar»; precio y publicación en MeLi en un solo bloque superior.
- **Archivos Modificados:** `CompetenciaPreciosPanel.tsx`, `team-recaps.md`

### 2026-08-24 16:28 - Competencia: comparar solo misma cantidad (g/ml)
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección / regla de negocio
- **Qué se implementó:**
  - La tabla y el veredicto solo incluyen publicaciones con la misma presentación que la nuestra (ej. 250 g vs 250 g; se excluyen 500 g o 250 ml).
  - Aplica al pantallazo, observaciones manuales y evidencia PNG; Gemini recibe la presentación de referencia en el prompt.
- **Archivos Modificados:** `analisis_competencia_precios.py`, tests

### 2026-08-24 16:20 - Competencia: evidencia PNG del análisis con fecha
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - Tras analizar un pantallazo, el sistema genera automáticamente una imagen PNG (tabla Nombre / Cantidad / Valor total, logo McKenna, fecha de análisis e ítem MeLi) como evidencia del trabajo humano.
  - En el panel se ve la miniatura, con enlaces Descargar PNG y Abrir imagen; reportes anteriores se regeneran al pedir la evidencia.
- **Archivos Modificados:** `analisis_competencia_precios.py`, `CompetenciaPreciosPanel.tsx`, `routes.py`, tests

### 2026-08-24 16:01 - Competencia: tabla con cantidad, promociones aparte y precio base
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Mejora
- **Qué se implementó:**
  - La comparación es una tabla: Nombre, Cantidad (g o ml) y Valor total. Nuestra fila permite editar el precio base y publicarlo en MeLi.
  - Captura / Buscar en MeLi y Promociones van en desplegables separados.
- **Archivos Modificados:** `analisis_competencia_precios.py`, `CompetenciaPreciosPanel.tsx`, `useCompetenciaPrecios.ts`, `routes.py`, tests

### 2026-08-24 15:52 - Competencia: pegar pantallazo en la publicación y analizar
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Mejora
- **Qué se implementó:**
  - Al abrir un producto, el recuadro de captura queda listo: Ctrl+V, arrastrar o subir el pantallazo arma el reporte de competencia.
  - Ya no hay que pulsar antes «Buscar en MeLi»; ese botón solo abre el listado.
- **Archivos Modificados:** `CompetenciaPreciosPanel.tsx`, ficha competencia-precios

### 2026-08-24 15:45 - Competencia: vincular publicación a promociones MeLi
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - En Publicaciones → Competencia, al abrir un producto aparece «Promociones ofertadas»: campañas que MeLi ofrece para esa publicación.
  - Se puede vincular o quitar con el mismo flujo que Stock (precio promo y fechas si MeLi las pide).
- **Archivos Modificados:** `MeliPromocionesItem.tsx`, `CompetenciaPreciosPanel.tsx`, ficha competencia-precios

### 2026-08-24 13:30 - Escáner de ficha técnica: mismo job en segundo plano
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - «Escanear ficha técnica» seguía esperando a Gemini en el POST y el proxy cortaba a ~100 s (el mismo aviso rosa que en el COA).
  - Ahora también responde al instante con `job_id` y el panel muestra el progreso hasta terminar.
- **Archivos Modificados:** `coa_scan_jobs.py`, `routes.py`, `FichasTecnicasPanel.tsx`, `scanJobPoll.ts`, tests, contratos

### 2026-08-24 12:55 - Escáner COA: análisis en segundo plano (sin corte de proxy)
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - El análisis de varias fotos tardaba más de ~100 s y el túnel/proxy cortaba con 502/504 («el análisis tardó demasiado»).
  - El POST ahora responde al instante con un `job_id`; el panel consulta el estado hasta que Gemini termina. Las fotos enormes se reducen antes de enviarlas.
- **Archivos Modificados:** `coa_scan_jobs.py`, `routes.py`, `documento_scan_tablas.py`, `CoaDocumentosScanner.tsx`, tests, contratos

### 2026-08-24 11:45 - Escáner COA: error HTML en lugar de JSON
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - Si el escáner fallaba, el panel mostraba «el servidor devolvió HTML» (timeout, 403 de red o error 500).
  - Las rutas `/api` ahora responden JSON en esos casos; no se reintenta un segundo análisis con el formulario vacío.
- **Archivos Modificados:** `routes.py`, `client.ts`, `documento_scan_tablas.py`, `agente_pro.py`, tests

### 2026-08-24 11:15 - Documentos técnicos: leer todas las fotos del COA
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - El escáner de COA leía una sola foto aunque se adjuntaran varias (Gemini ignoraba el resto y un escaneo viejo podía pisar el lote).
  - Ahora cada foto se transcribe por separado, se fusionan parámetros y si se agregan más mientras analiza, al terminar reanaliza el lote completo.
- **Archivos Modificados:** `documento_scan_tablas.py`, `CoaDocumentosScanner.tsx`, `coaParametros.ts`, `routes.py`, tests

### 2026-08-24 10:40 - Documentos técnicos: extraer en inglés, registrar en español
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Mejora
- **Qué se implementó:**
  - Al adjuntar pantallazos o PDF en Documentos técnicos, si el COA/ficha está en inglés, la información extraída se traduce y queda registrada en español en el formulario (aspecto, parámetros, almacenamiento, nombre comercial, rangos «to»→«a», «max»→«máx.»).
  - No se traducen CAS, fórmulas, número de lote, INCI ni el nombre del fabricante.
- **Archivos Modificados:** `documento_traducir_es.py`, `documento_scan_tablas.py`, `routes.py`, tests

### 2026-08-23 16:50 - Competencia: reporte por pantallazo al buscar en MeLi
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - En Publicaciones → Competencia, «Buscar en MeLi y armar reporte» abre el listado y genera un reporte de esa publicación (precios visibles, veredicto).
  - El servidor no entra a Mercado Libre (MeLi bloquea esa API). Se usa el pantallazo de la pestaña, Ctrl+V o una imagen subida.
  - Los precios leídos quedan como observaciones y alimentan «A revisar / Más baratos».
- **Archivos Modificados:** `analisis_competencia_precios.py`, `routes.py`, `CompetenciaPreciosPanel.tsx`, `useCompetenciaPrecios.ts`, `capturaCompetenciaMeli.ts`, tests y contratos

### 2026-08-23 10:42 - Guardar repositorio en GitHub
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Mejora técnica
- **Qué se implementó:**
  - Copia en GitHub del trabajo local: `https://github.com/mckennagroupcolombia-code/HugoGarciaAgente` (rama `cursor/wa-metricas-panel`).
  - Panel Android: la sesión OAuth no se pisa con localStorage viejo; el Bearer de tickets va solo a `/api/tickets/*`.
  - Tickets: se puede pedir aclaración al solicitante (pausa hasta que responda) y llevar varias acciones en curso a la vez.
- **Archivos Modificados:** `App.tsx`, `client.ts`, `ticketsAuth.ts`, `TicketsPanel.tsx`, `tickets_db.py`, `tickets_notificaciones.py`, `routes_tickets.py`, `CONTRACTS.md`, tests de tickets

### 2026-08-22 13:39 - Inicio: Acciones debajo de la TRM
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Mejora
- **Qué se implementó:**
  - En Inicio, Acciones / Solicitudes / Recordatorios quedan justo debajo de la TRM del dólar. Actividad, Ecosistema y commits van después.
- **Archivos Modificados:** `TicketsPanel.tsx`

### 2026-08-22 13:36 - Títulos de ventana visibles (26px)
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - Inicio / Atención no se notaban más grandes porque medían en rem (casi el mismo tamaño que el menú). Ahora van a 26px fijos y se recompila el panel.
- **Archivos Modificados:** `index.css`, `Layout.tsx`, `desktop/dist`

### 2026-08-22 13:26 - Títulos de ventana, no del menú
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Mejora
- **Qué se implementó:**
  - Inicio, Atención y el título de cada ventana suben un 15%. El menú lateral no cambia de tamaño.
- **Archivos Modificados:** `index.css`, `Layout.tsx`

### 2026-08-22 13:21 - Títulos del cabezote un 15% más grandes
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Mejora
- **Qué se implementó:**
  - Títulos como Inicio (y los de cada ventana) subieron un 15%: se leían demasiado chicos tras compactar.
- **Archivos Modificados:** `index.css`

### 2026-08-22 13:10 - Botones de agregar solo icono
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Mejora
- **Qué se implementó:**
  - Iniciar acción, Nueva receta, Nuevo banner y el resto de botones de agregar quedaron solo con el más. El nombre sale al pasar el mouse.
- **Archivos Modificados:** `AddIconButton.tsx`, `TicketsPanel.tsx`, `RecetasPanel.tsx`, `VitrinaWebPanel.tsx`, `RRHHPanel.tsx`, `ImportacionesPanel.tsx`, `LibroMayorPanel.tsx`, `RentabilidadPanel.tsx`, `ContenidoPanel.tsx`, `WhatsAppPanel.tsx`, `FichasTecnicasPanel.tsx`, `WebChatPanel.tsx`, `CrearProductosSiigoPanel.tsx`


- **Autor:** Cursor Grok
- **Tipo de Cambio:** Mejora
- **Qué se implementó:**
  - El botón «+ Nueva solicitud» quedó solo con el más. El nombre aparece al pasar el mouse.
- **Archivos Modificados:** `TicketsPanel.tsx`


- **Autor:** Cursor Grok
- **Tipo de Cambio:** Mejora
- **Qué se implementó:**
  - En todo el panel: menos aire (márgenes del layout), títulos más pequeños y se ocultaron los textos de descripción bajo los encabezados.
  - Empaque y otras ventanas quedan más compactas: filas de tabla más juntas, sin párrafo de ayuda ni caja vacía a la derecha.
- **Archivos Modificados:** `index.css`, `Layout.tsx`, `applyTheme.ts`, `presets.ts`, `EmpaquePanel.tsx`, `Sidebar.tsx` y paneles de cabecera (Inventario, Vitrina, Libro Mayor, Tareas, Contenido, Importaciones, Docs, Facturas, etc.)

### 2026-08-22 12:50 - Cronómetro de solicitudes al pausar
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Bugfix
- **Qué se implementó:**
  - Al pausar el cronómetro de una solicitud y salir, ahora se ve en Por resolver (barra y tarjeta) y al reabrir aparece Reanudar. Antes el tiempo se perdía de la lista.
- **Archivos Modificados:** `tickets_db.py`, `TicketsPanel.tsx`, `Cronometro.tsx`

### 2026-08-22 12:45 - Sin pills Estilo en el cabezote
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Mejora
- **Qué se implementó:**
  - Se quitaron los botones Matrix / Sakura / Barbie Agenda del cabezote de Inicio. El cambio de variante queda solo en Temas.
- **Archivos Modificados:** `Layout.tsx`, `ThemePackPicker.tsx`

### 2026-08-22 11:10 - Estilo solo en Inicio
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Mejora
- **Qué se implementó:**
  - Matrix / Sakura / Barbie ya no aparecen en Libro Mayor ni en otras ventanas. El selector Estilo queda solo en Inicio.
- **Archivos Modificados:** `LibroMayorPanel.tsx`, `Layout.tsx`, `ThemePackPicker.tsx`

### 2026-08-22 11:05 - Libro Mayor: botones más compactos
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Mejora
- **Qué se implementó:**
  - Las tarjetas de Ingreso/Egreso/etc. ya no son cajas altas vacías: icono y nombre van en una sola fila, con poco padding.
- **Archivos Modificados:** `libroMayor.css`, `LibroMayorPanel.tsx`

### 2026-08-22 11:00 - Libro Mayor sin textos descriptivos
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Mejora
- **Qué se implementó:**
  - En Libro Mayor se quitó el párrafo de partida doble y las frases bajo Ingreso/Egreso/etc. Quedan icono y nombre; el detalle al pasar el mouse.
- **Archivos Modificados:** `LibroMayorPanel.tsx`

### 2026-08-22 10:58 - Sin pestaña Catálogo en Docs técnicos
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Mejora
- **Qué se implementó:**
  - Se quitó el botón/pestaña «Catálogo productos» de Documentos técnicos. Quedan Biblioteca y Ficha Técnica COA SDS.
- **Archivos Modificados:** `FichasTecnicasPanel.tsx`

### 2026-08-22 10:55 - Docs técnicos: pestañas solo icono
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Mejora
- **Qué se implementó:**
  - En Documentos técnicos las pestañas internas son solo iconos (el nombre al pasar el mouse).
- **Archivos Modificados:** `FichasTecnicasPanel.tsx`

### 2026-08-22 10:50 - Iconos del cabezote visibles
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Corrección
- **Qué se implementó:**
  - Las pestañas de Contabilidad (y las demás) ya no escondían el icono junto con el texto.
  - Cubo, factura, calculadora y temas van más grandes, en trazo grueso y con mejor contraste en Barbie.
- **Archivos Modificados:** `index.css`, `IllustrationIcon.tsx`, `HubNavTabs.tsx`, `ContabilidadHerramientas.tsx`

### 2026-08-22 10:45 - Buscar y Verificar solo icono
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Mejora
- **Qué se implementó:**
  - En Crear en Siigo, Buscar es solo la lupa y Verificar solo el check; el nombre queda al pasar el mouse.
- **Archivos Modificados:** `CrearProductosSiigoPanel.tsx`, `index.css`

### 2026-08-22 10:40 - Pestañas con iconos, no textos
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Mejora
- **Qué se implementó:**
  - En las pestañas del panel se ve el icono; el nombre queda al pasar el mouse (tooltip).
  - El menú lateral vuelve a mostrar icono + nombre para reconocer cada sección.
- **Archivos Modificados:** pestañas de hubs (Inicio, Diseño, WhatsApp, Publicaciones, Facturación, Siigo), menú, MobileHub, `index.css`

### 2026-08-22 10:20 - Sin iconos redundantes junto al texto
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Mejora
- **Qué se implementó:**
  - Menú, pestañas y botones con etiqueta ya no muestran icono al lado: el texto basta y se gana espacio.
  - Se mantienen los controles solo-icono (cerrar, menú, temas, calculadora, crear Siigo).
- **Archivos Modificados:** menú/nav, Layout, MobileHub, pestañas de hubs, `index.css`

### 2026-08-22 10:05 - Casillas de búsqueda y formulario más compactas
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Mejora
- **Qué se implementó:**
  - En todo el panel, los campos de búsqueda, texto, número y select son más bajos (sin quitar controles).
  - El tema Barbie/Sakura ya no fuerza casillas de 2.7rem; los botones junto a un campo (Buscar, Verificar) quedan a la misma altura.
- **Archivos Modificados:** `desktop/src/index.css`, `CrearProductosSiigoPanel.tsx`

### 2026-08-22 09:55 - Buscar productos y combos en Crear Siigo
- **Autor:** Cursor Grok
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - En Crear en Siigo hay buscador de productos y combos (caja arriba + botón Buscar al lado de Verificar).
  - Se recompiló el panel para que se vea al recargar `/app`.
- **Archivos Modificados:** `CrearProductosSiigoPanel.tsx`, `panelInfo.ts`, `desktop/dist/`

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

### 2026-09-03 21:00 - Módulo Proveedores (/app) + sección Cotizar y mapamundi real en la web
- **Autor:** Armando García
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - Panel **Logística Internacional → Proveedores**: directorio con ficha por proveedor, vista "¿Quién vende…?" (mismo producto en varios proveedores con último precio, mínimo y nº de compras → a quién cotizar), historial de precios, detección de catálogos/listas de precios en Gmail con extracción heurística (sin LLM) que el operador confirma, lectura de productos desde la URL de un proveedor, publicación de la oferta cotizable a la web y gestión de solicitudes de cotización con respuesta por correo.
  - Importadores sin IA desde compras reales: `facturas_compra_historial.json` (179 precios), Siigo `/v1/purchases` (78 facturas, 250 precios desde 2026-01-01) y `compras_exterior` de Contabilidad. Base SQLite nueva `app/data/proveedores.db` (gitignored).
  - Web pública: página `/cotizar` (listado ampliado por línea: lo que está en stock enlaza a la tienda, lo demás "Bajo pedido" solo cotizable; buscador instantáneo; modal de solicitud → WhatsApp al grupo + correo de confirmación), enlace "Cotizar" en la navegación y el footer, y el bloque de inicio "Del origen a tu fórmula" ahora usa un mapamundi real (Natural Earth) con rutas animadas hacia Bogotá en dos capas: stock y red de proveedores. El sitio nunca muestra el nombre del proveedor.
- **Pendiente para que luzca completo:** definir país de origen por línea/SKU en /app → Vitrina Web → Origen de materias, y marcar "Publicar en Cotizar" + país/línea en Proveedores; reiniciar `mckenna-website` para publicar la web.
- **Archivos Modificados:**
  - `app/services/proveedores_db.py` (nuevo), `app/routes_proveedores.py` (nuevo), `agente_pro.py`, `app/data/scripts_manifest.json`, `.gitignore`, `.env.example`
  - `desktop/src/components/ProveedoresPanel.tsx` (nuevo), `desktop/src/hooks/useProveedores.ts` (nuevo), `desktop/src/components/LogisticaInternacionalPanel.tsx`
  - `PAGINA_WEB/site/website.py`, `PAGINA_WEB/site/templates/cotizar.html` (nuevo), `_ruta_origen.html`, `_world_land.svg.html` (nuevo), `base.html`, `static/css/main.css`
  - `CLAUDE.md`, `docs/agentic/CONTRACTS.md`, `docs/agentic/modules/desktop-panel.md`, `docs/team-recaps.md`

### 2026-09-03 22:00 - Frontend ilustrado de trazabilidad: mapamundi interactivo, Colombia por departamentos y Cotizar por líneas
- **Autor:** Armando García
- **Tipo de Cambio:** Mejora de producto (web pública) + módulo Proveedores
- **Qué se implementó:**
  - Sección "Del origen a tu fórmula": KPIs animados (países, referencias, TDS, COA, departamentos), cadena de custodia ilustrada, filtro por línea, mapamundi con trama de puntos y rutas animadas (barco/avión) hacia Bogotá, panel lateral por país con productos enlazados a su ficha y badges TDS/COA, tour automático.
  - Sección "Colombia, de punta a punta": mapa real por departamentos con coropleta de pedidos entregados (web + MeLi), tramado en los 12 departamentos por impactar, pulsos de despachos de la semana, puertos de entrada y bodega, anillo de progreso 21/33, ranking y CTA "sé el primero".
  - `/cotizar`: tarjetas por línea comercial con conteos, orígenes y COA; chips de origen/TDS/COA por referencia; unidades en stock; nuevo copy "Manejamos N referencias… Conoce nuestra oferta".
  - Proveedores: clasificación heurística de línea/origen por nombre (`autoclasificar`), publicación masiva por proveedor, limpieza de nombres para la web y exclusión de empaques/servicios; 192 productos de proveedores publicados como "bajo pedido" en 21 países.
  - Orígenes de referencia sembrados por SKU en `origen_materias.json` (autorizado por el usuario; editable desde Vitrina Web).
- **Archivos Modificados:**
  - `PAGINA_WEB/site/website.py`, `templates/_ruta_origen.html`, `templates/_cobertura.html`, `templates/_colombia_map.svg.html` (nuevo), `templates/cotizar.html`, `templates/base.html`, `static/js/trazabilidad.js` (nuevo), `static/css/main.css`, `data/origen_materias.json`, `data/oferta_proveedores.json`
  - `app/services/proveedores_db.py`, `app/routes_proveedores.py`, `app/data/colombia_departamentos_svg.json` (nuevo)
  - `desktop/src/components/ProveedoresPanel.tsx`, `desktop/src/hooks/useProveedores.ts`
  - `CLAUDE.md`, `docs/agentic/CONTRACTS.md`, `docs/team-recaps.md`

### 2026-09-03 23:30 - Oferta completa desde catálogos web de proveedores + Comparador + nombres limpios en la web
- **Autor:** Armando García
- **Tipo de Cambio:** Nueva funcionalidad
- **Qué se implementó:**
  - `app/tools/catalogos_proveedores_web.py`: extractores por sitio (sin IA) para Global Trading de Colombia (123 productos), Química Interkrol (344), Cadiep (81, proveedor nuevo), Productos 3A (110) y Globalquimia (8). Factores y Mercadeo no publica su portafolio en la web; queda con sus 58 productos comprados y nota para pedir lista de precios.
  - Pestaña **Comparador** en Proveedores: matriz materia prima × proveedor por nombre genérico, último precio por proveedor, mejor precio resaltado, filtro por mínimo de proveedores y ranking de pares que más se solapan (Interkrol ↔ Cadiep 26, Global Trading ↔ 3A 14, Interkrol ↔ Factores 12…). Botón "Leer catálogo web" en Catálogos.
  - `nombre_publico()` reescrito: quita marcas (Dr Joe Lab, Ocean Spray…), descriptores ("para cara", "bulto 25 kg"), cantidades y códigos; restaura tildes. En `/cotizar` lo bajo pedido muestra solo el nombre de la materia prima; la presentación solo aparece en productos de la tienda. Oferta publicada: 765 materias primas de 23 países.
- **Archivos Modificados:**
  - `app/tools/catalogos_proveedores_web.py` (nuevo), `app/services/proveedores_db.py`, `app/routes_proveedores.py`
  - `desktop/src/components/ProveedoresPanel.tsx`, `desktop/src/hooks/useProveedores.ts`
  - `PAGINA_WEB/site/data/oferta_proveedores.json`, `CLAUDE.md`, `docs/agentic/CONTRACTS.md`, `docs/team-recaps.md`

### 2026-09-04 00:30 - Cotizar: subcategorías por familia + corrección de Alimentario invisible
- **Autor:** Armando García
- **Tipo de Cambio:** Mejora de producto (web pública)
- **Qué se implementó:**
  - Segundo nivel de clasificación (`SUBCATEGORIAS`, ~45 familias con icono) dentro de las 6 líneas: frutos secos y semillas, frutas deshidratadas, cereales, especias y sales, edulcorantes, proteínas, vitaminas y minerales, gomas, conservantes y acidulantes, saborizantes, ácidos, activos, emulsionantes, tensoactivos, minerales y pigmentos, fragancias, solventes, ácidos y bases, óxidos y oxidantes, sales industriales, cápsulas y excipientes, principios activos farmacéuticos, etc. `/cotizar` muestra chips de navegación por familia, bloques de 24 referencias con "ver más" y el buscador filtra por familia también.
  - Reglas de línea ampliadas (APIs y excipientes → Laboratorio; aminas, plastificantes, solventes clorados → Industria; conservas y snacks → Alimentario). Solo 2 de 737 referencias quedan sin familia.
  - Bug: el grupo Alimentario no se veía porque el bloque de 18.000 px con clase `reveal` nunca alcanzaba el umbral del IntersectionObserver. Se quitó `reveal` de los grupos de productos.
  - Origen: ya no se hereda el país del distribuidor nacional; si no hay país de fabricación conocido no se declara.
- **Archivos Modificados:**
  - `app/services/proveedores_db.py`, `PAGINA_WEB/site/website.py`, `templates/cotizar.html`, `static/css/main.css`, `data/oferta_proveedores.json`, `CLAUDE.md`, `docs/team-recaps.md`

### 2026-09-04 01:30 - Cotizar en tarjetas + copy "más de 200 referencias" + documentación en construcción
- **Autor:** Armando García
- **Tipo de Cambio:** Mejora visual (web pública)
- **Qué se implementó:**
  - Listado de `/cotizar` rediseñado como tarjetas en cuadrícula (icono de familia, estado En stock/Bajo pedido, bandera de origen, CAS, badges COA/TDS o "Documentación en construcción", botones Comprar/Cotizar). Bloques de 18 con "ver más".
  - Copy: se retiraron los totales exactos ("888 referencias") y el conteo de COA; ahora "Más de 200 referencias en stock y cientos más bajo pedido" y "COA y ficha técnica por lote". Aplica al hero de Cotizar, al KPI y al CTA del inicio.
  - `bandera()` global de Jinja (país → emoji) en `website.py`.
- **Archivos Modificados:** `PAGINA_WEB/site/templates/cotizar.html`, `templates/_ruta_origen.html`, `static/css/main.css`, `website.py`, `docs/team-recaps.md`


### 2026-09-09 17:30 - Facturación MeLi ↔ Alegra: packs a medias, empalme Siigo–Alegra, regularización y tickets
- **Autor:** Armando García
- **Tipo de Cambio:** Corrección de fondo (facturación) + herramienta de regularización + UX de revisión
- **Qué se implementó:**
  - **Causa raíz** de los packs facturados a medias: el fix multi-orden del 6-sep nunca corrió porque `webhook_meli.py` llevaba desde el 3-sep sin reiniciarse. Autofactura automática **apagada** (`MELI_AUTOFACTURA_ENTREGA_ACTIVO=0`); el botón "Facturar ahora" ahora emite **una sola factura por carrito** (`facturar_pack_meli_manual`) con barreras anti-duplicado.
  - **Cruce comprado vs facturado a nivel de pack** en Facturación → Ventas (estado `facturada_parcial`, badge "Pack de N"), **histórico persistente** en SQLite (`facturacion_ventas_cache.py`, sin tope de 150, botón 🔄 por venta) y filtro **"Solo pendientes"**.
  - **Empalme Siigo–Alegra** (30 días): 41 packs facturados dos veces ($1,45M) porque astroselling facturaba en Siigo al comprar y Alegra al entregar. Regla: la de Siigo es la válida; la de Alegra se anula, nunca se reemite. `scripts/regularizar_packs_parciales.py` clasifica A (parcial real → consolidar) / B (duplicado → solo anular Alegra) / C (humano), simula por defecto, re-verifica antes de emitir y reactiva temporalmente ítems `-LEGACY` para poder anular.
  - **Alegra**: `_resolver_o_crear_contacto_alegra` usa el `doc_type` real y recorta el DV del NIT; `buscar_producto_alegra_por_referencia` prefiere ítems activos; reactivados `C-AGUDES250mL`, `C-ACERIC250mL`, `C-BICSOD500g`, `C-MANCACREFKg`; creados `C-CREMON250g`, `C-VITCACIASC100g`. Listado de 217 SKUs de Siigo sin ítem activo en Alegra: `docs/facturacion/skus_siigo_sin_alegra.md`.
  - **Tickets**: ticket diario "Sync facturas faltantes" apagado (`SYNC_TICKET_FALTANTES_ACTIVO=0`, tenía bug de dedupe y creaba uno por día); cron de NC ya no intenta Siigo (solo lectura) y reutiliza su ticket de error; ticket de revisión se cierra solo al completar pasos; cada paso con id de venta tiene **"Abrir en Facturación ↗"**; el checklist de Contabilidad lleva a Facturación → Ventas con "Solo pendientes". Cerrados 7 tickets duplicados/obsoletos de Jenniffer.
  - Casos resueltos hoy a mano: FE198 (Fork Catering, NIT corregido; FE197 duplicada anulada con NC55), FE200/FE201 consolidadas (FE181/FE182 anuladas con NC56/NC57).
  - Ficha completa para agentes: `docs/agentic/modules/facturacion-meli-alegra.md` (+ `learned_context.md`, `INDEX.md`, `CLAUDE.md` Flujo G).
- **Archivos Modificados:** `app/tools/meli_autofactura_entrega.py`, `app/services/alegra.py`, `app/services/facturacion_ventas_unificado.py`, `app/services/facturacion_ventas_cache.py` (nuevo), `app/services/contabilidad_checklist.py`, `app/sync.py`, `app/tools/revision_facturacion.py`, `app/routes.py`, `scripts/regularizar_packs_parciales.py` (nuevo), `scripts/emitir_notas_credito_cron.py`, `scripts/revision_facturacion_cron.py`, `desktop/src/components/VentasAstroKillerPanel.tsx`, `TicketsPanel.tsx`, `FacturacionPanel.tsx`, `ContabilidadInicioPanel.tsx`, `desktop/src/stores/app.ts`, `.env.example`, `CLAUDE.md`, `docs/agentic/{INDEX,learned_context}.md`, `docs/agentic/modules/facturacion-meli-alegra.md` (nuevo), `docs/facturacion/skus_siigo_sin_alegra.md` (nuevo), `docs/team-recaps.md`
  - **Cierre (17:20):** regularización completada — 39 packs (13 duplicados solo-NC, 25 consolidaciones, y FE195 anulada con NC97 tras eliminar una NC manual sin timbre). 40 NC y 29 FE timbradas hoy. Además: `obtener_facturas_hibridas` ahora toma Siigo hasta `FECHA_ULTIMA_FACTURA_SIIGO` (3-sep) — las 90 facturas de astroselling del 2–3 sep eran invisibles para el índice legado y el panel las mostraba "sin facturar". Índice reconstruido, histórico recalentado, ticket #1322 cerrado; a Jenniffer solo le quedan 4 "PAGO DIAN" de jun/jul.

### 2026-09-10 18:45 - Pagos de mensajería en el panel (TKT-2026-1219, Jenniffer)
- **Autor:** Armando García
- **Tipo de Cambio:** Módulo nuevo (Operativos → Mensajería)
- **Qué se implementó:**
  - El Excel "ENVIOS INTERRA" (día · cant. envíos · enlace de guías · valor · estado · fecha de pago) pasa al panel: `/app → Contabilidad → Operativos → Mensajería`. Un renglón por día, días sin despacho con valor 0 y su nota ("domingo", "no salen").
  - **Importar del Excel:** se pegan las filas tal cual (tabuladores, `$ 50.700`, `19-ago`); lo que ya decía CANCELADO con fecha de pago se carga como lotes pagados del histórico, así no se pierde lo de agosto.
  - **Lote de pago:** se marcan los días pendientes, se agrupan y se crea solo el ticket de aprobación (categoría logística, asignado a `MENSAJERIA_APROBADOR`, default `armando`) — el mismo trámite que se abría a mano. Al pagar se registra fecha, banco, referencia, monto y **comprobante adjunto**.
  - **Contabilidad sin doble digitación:** el lote pagado entra a Ingresos/Egresos con fuente `mensajeria_pago` y de ahí al Libro Mayor por autopost (PUC 5135), conciliable contra el extracto como cualquier otro egreso.
  - Permiso nuevo `mensajeria`, heredado de `servicios`, `operativos` o `pedidos` (Jenniffer ya lo ve con los permisos que tiene).
- **Archivos Modificados:** `app/services/mensajeria_pagos.py` (nuevo), `app/routes.py`, `app/services/contabilidad_ledger.py`, `app/services/contabilidad_autopost.py`, `desktop/src/components/MensajeriaPanel.tsx` (nuevo), `OperativosPanel.tsx`, `IngresosEgresosPanel.tsx`, `Settings.tsx`, `TicketsPanel.tsx`, `desktop/src/lib/{contabilidadAccess.ts,panelInfo.ts}`, `CLAUDE.md`, `docs/team-recaps.md`

### 2026-09-10 19:30 - Guías de envío desde el panel (impresora térmica Vretti)
- **Autor:** Armando García
- **Tipo de Cambio:** Módulo nuevo (Atención → Guías de envío)
- **Qué se implementó:**
  - El rótulo de envío que despachos llenaba en Excel/Word ahora se genera en el panel: se marcan los pedidos que salen (tienda web + despachos de WhatsApp, con dirección ya cargada) y se abre un PDF de **10x15 cm, una página por paquete**, listo para la Vretti (también 10x10 y 5x7,5).
  - Diseño pensado para térmica: negro sobre blanco, destinatario en grande (nombre, teléfono, dirección, ciudad/depto), remitente, contenido, piezas/valor declarado y **código de barras Code128** con la guía o la referencia. El bloque inferior está anclado para que un destinatario corto no deje hueco y un contenido largo no invada el pie.
  - Pestañas **Envío suelto** (formulario en blanco) y **Remitente** (NIT/dirección/teléfono de McKenna, `app/data/remitente_envios.json` — hoy vacíos, hay que completarlos una vez).
  - Cada rótulo queda registrado (`rotulos_envio` en despachos.db) con reimpresión desde el historial; `GET /api/guias/conteo` alimenta la sugerencia "N rótulos impresos ese día — usar" en la casilla *envíos* de Operativos → Mensajería.
  - **MeLi no se incluye a propósito:** esas ventas van con la etiqueta de Mercado Libre (Colecta/Flex).
  - Detalle de implementación: el `ImageReader` del isotipo se crea una vez por PDF; dentro del bucle, un lote de 20 rótulos pesaba ~16 MB.
- **Archivos Modificados:** `app/tools/guias_envio.py` (nuevo), `app/routes.py`, `desktop/src/components/GuiasEnvioPanel.tsx` (nuevo), `MensajeriaPanel.tsx`, `desktop/src/App.tsx`, `desktop/src/stores/app.ts`, `desktop/src/lib/{navStructure.ts,panelInfo.ts}`, `desktop/src/icons/mck/paths/panels.tsx`, `CLAUDE.md`, `docs/team-recaps.md`

### 2026-09-15 - Conservación de la etiqueta enlazada con la ficha técnica
- **Autor:** Armando García
- **Tipo de Cambio:** Corrección (Etiquetas → Ficha de etiqueta)
- **Qué se implementó:**
  - La casilla **Conservación** de la etiqueta (Sales minerales y todas las demás) salía vacía aunque la ficha técnica sí dijera cómo guardar el producto.
  - Causa: `camposDesdeFichaTecnica` solo leía el almacenamiento cuando el bloque `recomendaciones` traía el encabezado `ALMACENAMIENTO:` (estilo SDS). La mayoría de las fichas — CITRATO DE POTASIO entre ellas — lo tienen como párrafo corrido ("Se recomienda guardar en empaques bien cerrados en un lugar fresco y seco…"), así que el campo quedaba en `— completar —` y el enlace lo trataba como vacío.
  - Ahora, si no hay esa sección, se usa el bloque `recomendaciones` completo (FT y SDS) y `sintetizarConservacion` saca las frases de conservar, descartando modo de uso y caducidad como ya hacía.
  - Verificado contra las 194 fichas de `fichas_word/datos`: la Conservación pasa de 134 a 157 fichas con dato (+23), sin cambiar ninguna de las que ya venía bien.
- **Archivos Modificados:** `desktop/src/lib/fichaTecnicaCampos.ts`, `docs/team-recaps.md`

### 2026-09-15 - Conservación: síntesis de máximo 15 palabras
- **Autor:** Armando García
- **Tipo de Cambio:** Ajuste (Etiquetas + Fichas técnicas)
- **Qué se implementó:**
  - Regla del usuario: la casilla **Conservación** es una síntesis concreta, nunca el párrafo de la ficha. Tope duro de **15 palabras** en los dos extremos.
  - Etiqueta (`fichaTecnicaCampos.ts`): `sintetizarConservacion` ahora corta por palabras, no por caracteres, recortando **por cláusulas** para que quede una instrucción completa ("Guardar en empaques bien cerrados en un lugar fresco y seco, alejado de la luz"). El resumen se aplica también a lo que una persona escribió en "Conservación y almacenamiento" (si el resumen saliera vacío se respeta su texto tal cual).
  - IA (`documento_cientifico.py`): el prompt de `conservacion` pide UNA oración de máximo 15 palabras que empiece por verbo en infinitivo, concreta (envase, lugar, temperatura/humedad/luz) y sin vida útil, fechas ni modo de uso. `recortar_a_palabras` impone el tope aunque el modelo devuelva un párrafo.
  - Verificado contra las 194 fichas: 157 con Conservación, **ninguna pasa de 15 palabras**.
- **Archivos Modificados:** `desktop/src/lib/fichaTecnicaCampos.ts`, `app/services/documento_cientifico.py`, `docs/team-recaps.md`

### 2026-09-15 - Volver a la biblioteca desde la ventana de impresión
- **Autor:** Armando García
- **Tipo de Cambio:** Corrección (Diseño → Imprimir)
- **Qué se implementó:**
  - Al elegir una etiqueta en la biblioteca de impresión se abría la ventana de impresión sin una forma clara de regresar: el único enlace era un "← Archivos" de 9 px perdido entre los chips del cabezote, y ni el botón atrás del navegador ni el de Android volvían al catálogo (se salía del panel).
  - Cabezote (`ImpresionEtiquetasHeader.tsx`): en la vista de documento el ícono de impresora se reemplaza por un botón **← Volver** destacado en el extremo izquierdo, con `aria-label` y tooltip "Volver a la biblioteca de archivos (Esc)".
  - `EtiquetasPanel.tsx` (`TabImprimir`): la vista de documento registra un `registerNestedBackHandler` que ejecuta `volverACatalogoPng`, y escucha **Esc** (ignorando inputs, textareas, selects, contenteditable y diálogos, y desactivado mientras están abiertos el modal de pedidos o el instalador).
  - `appBackNavigation.ts`: `onPopState` ahora consulta los manejadores anidados antes de cambiar de panel y reancla el historial, así el botón atrás del navegador de escritorio también respeta las vistas anidadas (antes solo lo hacía el bridge de Android).
  - El botón pequeño junto a la vista previa del PNG queda como "← Archivos" con el mismo tooltip.
- **Archivos Modificados:** `desktop/src/components/etiquetas/ImpresionEtiquetasHeader.tsx`, `desktop/src/components/EtiquetasPanel.tsx`, `desktop/src/lib/appBackNavigation.ts`, `docs/team-recaps.md`

### 2026-09-15 - La casilla OLOR pasa a llamarse AROMA
- **Autor:** Armando García
- **Tipo de Cambio:** Ajuste (Etiquetas)
- **Qué se implementó:**
  - Petición del usuario: en las casillas de todas las plantillas de etiqueta, donde decía **OLOR** ahora dice **AROMA**.
  - `etiquetaFormulario.ts`: `labelCampoEtiqueta` y el bloque de `BLOQUES_FICHA_GRID` pasan a `AROMA`.
  - `plantillasVisuales.ts`: el nombre de capa del campo en el editor visual pasa a `AROMA`.
  - `ProductAttributeGrid.tsx` (etiqueta ficha) y `etiqueta30mlTypes.ts` (formato 30 mL): el título de la casilla pasa a `Aroma`.
  - `ortografiaEtiqueta.ts`: el revisor ortográfico reporta el campo como `Aroma`.
  - `productLabelTypes.ts`: el texto de muestra queda "Aroma dulce y cremoso…".
  - Datos: en `app/data/plantillas_visuales.json` una sola plantilla tenía el título ya escrito a mano (`ALCOHOL CETILICO 500g` → `OLOR:` → `AROMA:`). Las 201 plantillas quedan idénticas salvo ese texto. La prosa descriptiva que menciona "olor" (ACEITE DE RICINO, LANOLINA, AGUA DESTILADA, etc.) **no** se tocó: no son casillas.
  - Las claves internas (`olor`, `odor`) se conservan para no romper plantillas ni el enlace con las fichas técnicas.
  - **Fuera de alcance:** las fichas técnicas, COA y SDS (`ficha_tecnica.py`, `documento_traducir_es.py`, `FichaTecnicaForm.tsx`, `plantillaFichaTecnicaMp.ts`) siguen diciendo "Olor", que es el término normativo de propiedades físico-químicas.
- **Archivos Modificados:** `desktop/src/lib/etiquetaFormulario.ts`, `desktop/src/lib/plantillasVisuales.ts`, `desktop/src/lib/ortografiaEtiqueta.ts`, `desktop/src/components/etiqueta-ficha/ProductAttributeGrid.tsx`, `desktop/src/components/etiqueta-ficha/productLabelTypes.ts`, `desktop/src/components/etiqueta-30ml/etiqueta30mlTypes.ts`, `app/data/plantillas_visuales.json`, `docs/team-recaps.md`

### 2026-09-15 - Composición: el desplegable ofrece "Fórmula química"
- **Autor:** Armando García
- **Tipo de Cambio:** Ajuste (Etiquetas)
- **Qué se implementó:**
  - El desplegable del título de la casilla de composición ya existía, pero las opciones no coincidían entre formatos: la ficha 76×66 daba `Composición · Fórmula molecular` y el formato 30 mL `Fórmula química · Composición`, aunque los dos guardan el mismo dato (`compositionTitulo`). Elegir "Fórmula molecular" en la ficha se veía como "Fórmula química" en 30 mL.
  - Decisión del usuario: **reemplazar** "Fórmula molecular" por "Fórmula química". `TITULOS_COMPOSICION` queda `["Composición", "Fórmula química"]` — las mismas dos opciones que 30 mL, cada formato con su orden (y por tanto su valor por defecto).
  - `productLabelTypes.ts`: nueva `tituloComposicion(data)`, espejo de `tituloFormula30ml`, que valida el dato guardado contra la lista. `ProductAttributeGrid.tsx` la usa en vez de `data.compositionTitulo || TITULOS_COMPOSICION[0]`, así una ficha antigua con "Fórmula molecular" cae a "Composición" en vez de mostrar un título que ya no está en el menú.
  - No hizo falta migrar datos: las 4 fichas guardadas en `app/data/etiquetas_fichas.json` con `compositionTitulo` traen "Composición", ninguna "Fórmula molecular".
  - **Nota:** los 133 SVG del catálogo antiguo en `app/data/etiquetas_ai_cache/` sí dicen "Fórmula molecular", pero son renders del .ai original, no plantillas editables, y el desplegable no los toca.
- **Archivos Modificados:** `desktop/src/components/etiqueta-ficha/productLabelTypes.ts`, `desktop/src/components/etiqueta-ficha/ProductAttributeGrid.tsx`, `desktop/src/components/etiqueta-30ml/etiqueta30mlTypes.ts`, `docs/team-recaps.md`

### 2026-09-15 - "Fórmula molecular" en el documento técnico y enlazada a la etiqueta
- **Autor:** Armando García
- **Tipo de Cambio:** Ajuste (Fichas técnicas + Etiquetas)
- **Qué se implementó:**
  - La fila se titula **Fórmula molecular** (antes "Fórmula química") en el formulario FT, en el PDF de la ficha y en el documento completo. La clave interna sigue siendo `formula_quimica`: no hay que tocar ningún YAML.
  - Compatibilidad con lo ya guardado: las fichas viejas traen la fila como "Fórmula química" en `propiedades`; se buscan los dos títulos y se imprime siempre el nuevo, sin duplicar la fila en "propiedades extra". El lector de Word/PDF reconoce los dos encabezados.
  - **Etiqueta enlazada:** la casilla de composición ahora toma el MISMO dato de la ficha. Si la ficha trae fórmula, la casilla muestra la fórmula y se titula "Fórmula molecular"; si no (o si dice "No aplica", como en alimentos y mezclas), vuelve a ser la lista de componentes bajo "Composición". El menú del título de la etiqueta y el formato de 30 mL dicen "Fórmula molecular".
  - **Lectura química:** el valor se formatea con `formatearFormulaMolecular` / `formula_a_html_sub` — los subíndices bajan y los coeficientes se quedan en tamaño normal: `C6H5K3O7` → C₆H₅K₃O₇, `MgCl2·6H2O` → MgCl₂·6H₂O, `Ca(OH)2` → Ca(OH)₂.
  - Verificado contra las 194 fichas: 106 tienen fórmula y todas salen con subíndices correctos.
- **Archivos Modificados:** `app/services/ficha_tecnica.py`, `desktop/src/lib/{fichaTecnicaCampos.ts,fichaTecnicaAplicar.ts,iconosQuimicaCirculares.ts}`, `desktop/src/components/documentos/FichaTecnicaForm.tsx`, `desktop/src/components/etiqueta-ficha/productLabelTypes.ts`, `desktop/src/components/etiqueta-30ml/etiqueta30mlTypes.ts`, `docs/team-recaps.md`

### 2026-09-15 - GLICERINA VEGETAL: la etiqueta enlazaba la ficha sin datos
- **Autor:** Armando García
- **Tipo de Cambio:** Corrección (Etiquetas → enlace con ficha técnica)
- **Qué se implementó:**
  - Síntoma: abrir una plantilla de Sales minerales, elegir el código de barras de GLICERINA VEGETAL y ver Origen, Grado y Conservación vacías, aunque el documento **completo** de glicerina las tiene.
  - Causa: hay dos fichas del mismo producto. `glicerina_vegetal.yaml` (parcial, 18 claves) se titula "GLICERINA VEGETAL" y puntúa **1.00** contra el título del EAN; `ft_coa_sds_glicerina.yaml` (`_tipo: completo`, 30 claves) se titula solo "GLICERINA" y puntúa **0.48**. El enlace automático elige por parecido de título, así que ganaba la parcial.
  - Verificado ejecutando `camposDesdeFichaTecnica` sobre las dos: la parcial dejaba vacías `origin`, `grade`, `storage` y `classification`; el completo las trae todas.
  - Arreglo de datos: a `glicerina_vegetal.yaml` se le añadieron `pais_origen: Colombia`, `grado: USP` y `conservacion` (tomados del completo; `grado` sale de `_coa.identificacion.grado`). La clasificación "MATERIA PRIMA GRADO USP" se deriva sola del grado. Respaldo en `/tmp/glicerina_vegetal.bak_20260915_1305.yaml`, fuera del repo. Las otras 18 claves quedaron intactas.
  - Arreglo de interfaz: nueva `candidatasParaTitulo` en `fichaTecnicaMatch.ts` (ranking de las fichas que llegan al umbral) y el mensaje de enlace en `ProductLabelForm.tsx` ahora nombra las otras candidatas: "Ficha técnica enlazada: X (100 %). También coincide «Y» (48 %) — usa la lupa junto al nombre si esa es la correcta." Antes el problema era invisible.
  - **Descartado:** preferir automáticamente el documento `completo`. Barridos los 232 EAN contra las 193 fichas, solo hay 4 casos donde el enlace se salta un completo; 3 son las glicerinas y el cuarto ("SUERO LECHE DULCE" → `SUERO DE LECHE` en vez de `PROTEÍNA DE SUERO DE LECHE`) el enlace lo hace bien. La regla acertaría 3 veces y fallaría 1.
- **Archivos Modificados:** `desktop/src/lib/fichaTecnicaMatch.ts`, `desktop/src/components/etiqueta-ficha/ProductLabelForm.tsx`, `fichas_word/datos/glicerina_vegetal.yaml`, `docs/team-recaps.md`

### 2026-09-15 - La casilla Olor de la ficha técnica se titula "Aroma"
- **Autor:** Armando García
- **Tipo de Cambio:** Ajuste (Fichas técnicas)
- **Qué se implementó:**
  - En el formulario FT, en el PDF de la ficha y en el documento completo la fila pasa de **Olor** a **Aroma** — el mismo título que ya usaba la etiqueta. Clave interna `olor` sin cambios: no se toca ningún YAML.
  - Los títulos anteriores quedan en `_TITULOS_VIEJOS` (un solo lugar, junto a "Fórmula química" → "Fórmula molecular"): las fichas ya guardadas traen la fila como "Olor" dentro de `propiedades`, se siguen leyendo y se imprimen con el título nuevo, sin duplicar la fila en "propiedades extra".
  - Reconocen los dos encabezados: el lector de Word/PDF, el traductor de documentos en inglés (`odor`/`odour` → Aroma), el escáner del formulario y el paso ficha → etiqueta.
  - La capa "Olor" de la plantilla visual «Ficha técnica MP» también se llama Aroma.
  - **No se tocó la SDS:** en la sección 9 "Olor" es el término del formato GHS.
  - Verificado: fila vieja `[['Olor','Característico']]` sale como `[['Aroma','Característico']]`, y las 194 fichas siguen entregando el dato a la etiqueta (129 con aroma).
- **Archivos Modificados:** `app/services/{ficha_tecnica.py,ficha_tecnica_word.py,documento_traducir_es.py}`, `desktop/src/components/documentos/FichaTecnicaForm.tsx`, `desktop/src/lib/{fichaTecnicaCampos.ts,plantillaFichaTecnicaMp.ts}`, `docs/team-recaps.md`
