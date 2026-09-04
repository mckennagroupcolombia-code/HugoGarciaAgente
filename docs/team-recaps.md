### 2026-09-03 21:30 - Contabilidad: altas y compras ahora van a Alegra
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

