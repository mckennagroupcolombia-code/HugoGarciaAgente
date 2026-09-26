/**
 * Metadata descriptiva de cada panel: descripción, tips y clasificación.
 * Usado por el Sidebar remasterizado (etiquetas y badges de paneles).
 */

export type PanelTier = "core" | "standard" | "advanced";

export interface PanelInfo {
  emoji: string;
  label: string;
  description: string;
  tips: string[];
  tier: PanelTier;
  category: string;
}

export const PANEL_INFO: Record<string, PanelInfo> = {
  // ── Core ─────────────────────────────────────────────────────────────────────
  hugo: {
    emoji: "🏠",
    label: "Agenda",
    description: "Tu base de operaciones. Aquí gestionas solicitudes, tareas pendientes y coordinas al equipo en tiempo real.",
    tips: [
      "Crea una solicitud con el botón azul '+' para pedir algo al equipo.",
      "Las tareas con ⚡ son urgentes — atiéndelas primero.",
      "Puedes ver quién está en línea en este momento.",
    ],
    tier: "core",
    category: "inicio",
  },
  dashboard: {
    emoji: "📊",
    label: "Métricas",
    description: "Resumen del día: ventas por WhatsApp, preguntas de MercadoLibre respondidas, órdenes recibidas y estado de los servicios.",
    tips: [
      "Los números se actualizan automáticamente cada 30 segundos.",
      "El indicador verde junto a MeLi, Sheets o Alegra significa que el servicio está funcionando.",
      "Si algo aparece en rojo, avisa al administrador.",
    ],
    tier: "core",
    category: "inicio",
  },
  chat: {
    emoji: "💬",
    label: "Chat IA",
    description: "Habla directamente con Hugo, el asistente inteligente de McKenna. Puedes preguntarle sobre stock, clientes, facturas o pedirle que ejecute tareas.",
    tips: [
      "Escribe en lenguaje natural — no necesitas comandos especiales.",
      "Ejemplos: '¿Cuánto stock hay de Urea Cosmética?' o 'Genera el reporte de hoy'.",
      "Hugo recuerda el contexto de la conversación mientras estés en esta sesión.",
    ],
    tier: "core",
    category: "canales",
  },
  whatsapp: {
    emoji: "💚",
    label: "Agente WA",
    description: "Conversaciones de WhatsApp donde Hugo está atendiendo clientes automáticamente. Puedes intervenir manualmente si el cliente lo necesita.",
    tips: [
      "El modo 'humano' desactiva a Hugo para ese número — tú tomas el control.",
      "Las conversaciones marcadas en naranja esperan tu aprobación.",
    ],
    tier: "standard",
    category: "canales",
  },

  // ── Atención (bandejas con pendientes) ───────────────────────────────────────
  preventa: {
    emoji: "🛒",
    label: "Preventa MeLi",
    description: "Preguntas de clientes en MercadoLibre que aún no tienen respuesta. Hugo intenta responderlas automáticamente; las que no pudo quedan aquí.",
    tips: [
      "Responde con el botón 'Responder' — se envía directo a MercadoLibre.",
      "Cuanto más rápido respondas, mejor posicionamiento tiene la publicación.",
      "El número rojo en el menú indica cuántas hay sin responder.",
      "Arriba ves el % de compra: de quienes preguntaron, cuántos compraron ese producto después.",
    ],
    tier: "core",
    category: "atencion",
  },
  postventa: {
    emoji: "📬",
    label: "Postventa MeLi",
    description: "Mensajes de compradores después de que pagaron: dudas de envío, solicitudes de factura, reclamos. Requieren atención rápida.",
    tips: [
      "Arriba están motivos de reclamo, tiempos de respuesta y las solicitudes más frecuentes.",
      "Los mensajes de compradores llegan aquí y también al grupo de WhatsApp.",
      "Para responder usa el formulario — se envía por la plataforma de MeLi.",
      "Los RUT para facturación electrónica llegan como archivo adjunto en estos mensajes.",
    ],
    tier: "core",
    category: "atencion",
  },
  "ventas-email": {
    emoji: "✉️",
    label: "Correo Ventas",
    description: "Bandeja de ventas@mckennagroup.co: correos de clientes que llegan por correo en vez de WhatsApp o MeLi.",
    tips: [
      "Solo muestra correos sin leer del buzón ventas@.",
      "Responder envía el correo real y lo marca como leído.",
      "Requiere que ventas@mckennagroup.co esté autorizado para delegación de dominio en Google Workspace.",
    ],
    tier: "core",
    category: "atencion",
  },
  pedidos: {
    emoji: "📦",
    label: "Pedidos Web",
    description: "Órdenes de compra llegadas por la tienda en línea mckennagroup.co. Puedes facturar, actualizar estado de envío y notificar al cliente.",
    tips: [
      "Cuando llega un pedido, también recibes una alerta en el grupo de WhatsApp.",
      "«Facturar con Alegra» abre una emergente para verificar/editar SKUs y datos del cliente antes de emitir.",
      "Actualiza el número de guía para que el cliente pueda rastrear su envío.",
    ],
    tier: "core",
    category: "atencion",
  },
  "guias-envio": {
    emoji: "🏷️",
    label: "Guías de envío",
    description:
      "Rótulos de envío para la impresora térmica (Vretti, rollo 10x15 cm): se eligen los pedidos que salen hoy y se imprime una página por paquete, con destinatario, contenido y código de barras. Reemplaza el formato en Excel/Word.",
    tips: [
      "Marca los pedidos del día y dale «Imprimir rótulos»: se abre el PDF listo para la térmica.",
      "Al imprimir deja la escala en «Tamaño real / 100 %», si no el rótulo sale corrido.",
      "Para un envío que no viene de un pedido, usa la pestaña «Envío suelto».",
      "Los datos de McKenna que salen abajo (NIT, dirección, teléfono) se llenan una vez en «Remitente».",
    ],
    tier: "core",
    category: "atencion",
  },
  "entregas-flex": {
    emoji: "🛵",
    label: "Entregas Flex",
    description:
      "A qué hora llegan los envíos Flex de MercadoLibre (reparto propio en Bogotá) y cómo cambia eso semana a semana: salida de la ruta, hora de entrega, corte del mismo día, localidades y envíos que se quedaron en el camino.",
    tips: [
      "Los datos se actualizan solos cada noche a las 23:15, cuando ya cerró la ruta. «Actualizar ahora» trae lo del día.",
      "«Patrones» compara las últimas 4 semanas contra las 4 anteriores y solo avisa cambios de 15 min o 5 puntos.",
      "Una entrega marcada de madrugada casi siempre es el mensajero cerrando el envío días después, no una entrega real.",
    ],
    tier: "standard",
    category: "atencion",
  },
  arquitectura: {
    emoji: "\u{1F9ED}",
    label: "Arquitectura del c\u00f3digo",
    description:
      "Qu\u00e9 archivo llama a cu\u00e1l y qu\u00e9 funciones no usa nadie, derivado del c\u00f3digo real con codebase-memory-mcp. El Mapa del sistema cuenta el flujo del negocio; esto cuenta el de las llamadas.",
    tips: [
      "Toca un archivo en el mapa para ver qui\u00e9n lo llama y a qui\u00e9n llama.",
      "El n\u00famero de c\u00f3digo muerto trae su embudo a la vista: el dato crudo del grafo tiene ~93% de falsos positivos (referencias JSX y rutas Flask no generan arista de llamada).",
      "Es un snapshot, no una consulta viva: se regenera con `python3 scripts/arquitectura_cbm.py`.",
    ],
    tier: "advanced",
    category: "sistemas",
  },
  "chat-equipo": {
    emoji: "💬",
    label: "Chat del equipo",
    description:
      "La conversación operativa del equipo dentro del panel: lo que llega, fotos, cantidades y avisos. Queda registrada, se puede buscar y cuenta como actividad. Un canal puede enlazarse a un grupo de WhatsApp mientras dura la transición.",
    tips: [
      "Escribir aquí no pide cronómetro: es para coordinar. Lo que alguien debe resolver va como tarea en la Agenda.",
      "📷 toma la foto directo con la cámara del celular.",
      "Los canales enlazados muestran lo que se escribe en el grupo de WhatsApp; con «ida y vuelta», lo del panel también llega al grupo.",
    ],
    tier: "core",
    category: "inicio",
  },
  "recepcion-mercancia": {
    emoji: "📦",
    label: "Recepción de mercancía",
    description:
      "Lo que llega a bodega: quién lo recibió, fotos, cantidades contadas contra lo esperado y diferencias. Reemplaza el aviso suelto en el grupo de WhatsApp.",
    tips: [
      "Si la mercancía viene con factura de compra, elígela: los productos esperados se cargan solos.",
      "Toma fotos de las cajas y de la factura física al recibir.",
      "Al cerrar, las diferencias quedan anotadas y se avisa en el canal de inventario.",
    ],
    tier: "core",
    category: "inventario",
  },
  juegos: {
    emoji: "🎮",
    label: "Juegos",
    description:
      "Un rato de descanso dentro de la Agenda. Los juegos corren aislados del panel: no ven tu sesión ni tus datos y no se conectan a internet.",
    tips: [
      "Duck Hunt: apunta con el mouse y dispara con clic. Tienes 3 tiros por pato.",
      "Circus Charlie: el original de NES emulado, 5 etapas. Enter arranca, ← → corre, Espacio salta; M silencia.",
      "El sonido arranca después del primer clic (el navegador no deja reproducir audio antes).",
    ],
    tier: "core",
    category: "inicio",
  },
  colaboradores: {
    emoji: "🤝",
    label: "Colaboradores",
    description:
      "Diagramas de flujo que Armando construye con un colaborador externo, a mano y desde el celular: cajas que se arrastran, flechas que las unen y un texto por paso, hasta acordar entre los dos cómo se relacionan en un proyecto conjunto.",
    tips: [
      "Toca «＋ Caja» y arrástrala con el dedo. Para unir dos cajas: toca una → «Unir con otra caja» → toca la otra.",
      "Lo que guarda uno lo ve el otro en segundos; si los dos editan a la vez, los cambios se combinan.",
      "Cada guardado es una versión: en «Historial» se puede volver a cualquiera.",
      "«Ver en Archify» genera la versión presentable (solo lectura), con el acabado de los diagramas del Mapa del sistema.",
    ],
    tier: "core",
    category: "inicio",
  },
  "mapa-vivo": {
    emoji: "🧭",
    label: "Mapa",
    description:
      "Toda la aplicación en una sola pantalla: la secuencia del negocio de la compra a la contabilidad, con lo que a ti te toca en cada etapa, lo que está detenido y tus pendientes. Es la pantalla de inicio.",
    tips: [
      "Arrastra para moverte y pellizca (o usa la rueda) para acercarte. «Encuadrar» vuelve a mostrar todo.",
      "Toca un panel dentro de una etapa para abrirlo. Para volver, «◇ Mapa» en el cabezote.",
      "La etapa que late en amarillo tiene solicitudes tuyas: es tu camino de hoy. Las apagadas son de otras personas.",
      "«Etapas · Cotidiano · Todo» cambia cuánto detalle se ve; «Todo» dice qué se hace en cada panel.",
    ],
    tier: "core",
    category: "inicio",
  },
  "mapa-sistema": {
    emoji: "🗺️",
    label: "Mapa del sistema",
    description:
      "Cómo se conectan las piezas de un producto (combo en Alegra → documento técnico → código EAN → etiqueta → publicación) y de un pago, con los números de este momento: cuántos pasan cada eslabón, cuáles se quedan y por qué.",
    tips: [
      "Toca una caja para ver qué productos se quedan en ese eslabón y el motivo de cada uno.",
      "«Documentos sin combo» son fichas ya escritas que nada vende: no les falta documento, les falta el combo en Alegra.",
      "Se actualiza solo cada 30 segundos y no llama a Alegra ni a MeLi: lee la copia local del catálogo.",
    ],
    tier: "standard",
    category: "inventario",
  },
  producto: {
    emoji: "🏷️",
    label: "Espacio de producto",
    description:
      "Una presentación de venta con todo lo que la respalda en un solo lugar: su ficha técnica (TDS · COA · SDS), su etiqueta, su código EAN y los PNG aprobados. Se elige el producto una vez; cada pestaña es el apartado de siempre ya abierto en él.",
    tips: [
      "Los puntos de cada pestaña dicen si esa pieza está completa (verde), a medias (ámbar) o falta (rojo).",
      "Si corriges la ficha técnica y pasas a la etiqueta, la barra de estado ofrece traer lo corregido.",
      "Diseño y Docs técnicos siguen existiendo para el trabajo en lote (varias etiquetas, la biblioteca de PDF).",
    ],
    tier: "core",
    category: "diseno",
  },
  combos: {
    emoji: "🧩",
    label: "Combos",
    description:
      "La fotografía de cada producto de venta con todo lo que lo compone: la receta que descuenta de inventario (materia prima, bolsa, envase, etiqueta, cuchara…) y lo que lo respalda (documento técnico, código EAN, diseño de etiqueta y publicación).",
    tips: [
      "Una ranura vacía es algo que falta: el texto dice por qué y qué la destraba.",
      "Si la receta descuenta una cantidad distinta a la presentación (500 g que descuentan 5001), aparece como aviso.",
      "La etiqueta se muestra cuando ya se exportó a PNG desde Diseño → Imprimir con el mismo nombre del combo.",
    ],
    tier: "standard",
    category: "inventario",
  },
  empaque: {
    emoji: "📷",
    label: "Empaque",
    description:
      "Ventas de Mercado Libre, página web y WhatsApp con subida de fotos del paquete listo, para respaldar el despacho ante reclamos por faltantes.",
    tips: [
      "Abre la venta, revisa los productos y sube foto del contenido antes de cerrar la caja.",
      "Filtro 'Solo sin foto' muestra lo que aún falta evidenciar.",
      "Pedidos WhatsApp que no aparezcan se pueden registrar con '+ Pedido WhatsApp'.",
    ],
    tier: "core",
    category: "atencion",
  },

  // ── Inventario ────────────────────────────────────────────────────────────────
  stock: {
    emoji: "📦",
    label: "Stock",
    description: "Punto único de entrada de inventario: registra entradas y salidas de unidades aquí y se propagan a MeLi y a la página web, sin editar nada manualmente en la app de MeLi.",
    tips: [
      "Columna Stock: escribe el número final y pulsa Guardar (o Enter). Si estaba en 0/pausada, se reactiva en MeLi.",
      "La columna ± sigue siendo ajuste rápido (+1 / −1 o N).",
      "Tabla unificada: Publicación (Activa / Pausada), ventas 30 d y códigos MeLi ↔ Alegra. Editar SKU carga a MeLi.",
      "Alegra solo lectura — no recibe stock desde el panel.",
    ],
    tier: "core",
    category: "contabilidad",
  },
  "control-inventario": {
    emoji: "📋",
    label: "Inventario",
    description: "Checklist de productos que necesitan atención: agotados, críticos, con stock bajo o con diferencia frente a bodega. Agrega unidades, pide compra o marca como revisado, todo desde acá.",
    tips: [
      "🚫 Agotado / ⚠️ Última unidad / 🟡 Bajo stock — así se ordenan las tarjetas, lo más urgente primero.",
      "«+ Unidades» actualiza el stock real en MeLi al instante — no hace falta entrar a Mercado Libre.",
      "«Solicitar compra» crea un ticket en el Centro de Mando para que alguien lo compre y lo reciba.",
      "Si no hay nada que hacer con un producto, usa «Marcar revisado» — así sabes que ya lo viste esta semana.",
    ],
    tier: "core",
    category: "inventario",
  },
  etiquetas: {
    emoji: "🏷️",
    label: "Diseño",
    description: "Diseño e impresión de etiquetas de producto para empaque, trazabilidad y cumplimiento normativo. Incluye Studio visual.",
    tips: [
      "Selecciona el producto, el lote y la fecha de vencimiento antes de imprimir.",
      "El formato más usado es la etiqueta de 50×30mm para frascos pequeños.",
      "Usa Studio visual para plantillas de etiquetas.",
    ],
    tier: "core",
    category: "diseno",
  },
  fichas: {
    emoji: "📄",
    label: "Docs técnicos",
    description: "Fichas técnicas e información científica de ingredientes. Útil para responder preguntas técnicas de clientes y formuladores.",
    tips: [
      "Las fichas están vinculadas a las publicaciones de MercadoLibre — Hugo las usa para responder preguntas.",
      "Puedes descargar el PDF de cada ficha para enviarlo a clientes.",
      "En Biblioteca, «Cargar en página web» publica solo documentos completos (FT + COA + SDS) en las fichas de producto de la tienda.",
    ],
    tier: "standard",
    category: "docs",
  },

  // ── Publicaciones (botón individual en el menú) ───────────────────────────────
  publicaciones: {
    emoji: "📢",
    label: "Publicaciones",
    description: "Gestiona cada ficha en Mercado Libre y en la tienda web, y cómo se muestra en ambos sitios.",
    tips: [
      "En Catálogo → Sitios verás dos ventanas: Página web | Mercado Libre.",
      "Web: botón «No mostrar en la web», ordenar/eliminar fotos. MeLi: editar precio, pausar/activar y fotos.",
      "Marca las fotos que no sirven (☑) y elimínalas; la ★ es la que se ve primero en cada sitio.",
    ],
    tier: "standard",
    category: "publicaciones",
  },

  "canales-producto": {
    emoji: "📡",
    label: "Canales del producto",
    description:
      "Cada SKU de venta en todos sus canales a la vez: si existe en Alegra, si tiene combo, EAN, documento y etiqueta, si está en MercadoLibre y en la web, y si una venta suya se puede facturar. Solo muestra: cada problema lleva al apartado donde se corrige.",
    tips: [
      "Empieza por «No se puede facturar»: son publicaciones que venden con un código que Alegra no conoce.",
      "«Verificar en vivo» pregunta a Alegra lo mismo que preguntaría la facturación, para ese SKU.",
      "La pestaña Categorías pone lado a lado la categoría de etiquetas, la de la web y la de MeLi.",
    ],
    tier: "standard",
    category: "publicaciones",
  },

  "vitrina-web": {
    emoji: "🖥️",
    label: "Vitrina Web",
    description:
      "Banners de promociones y el país de origen de las materias primas que se muestran en el inicio de mckennagroup.co (mapa de ruta + carrusel de descuentos).",
    tips: [
      "Un banner solo aparece en el sitio si está Activo y hoy cae dentro de su rango de fechas — no hay que recordar apagarlo cuando vence.",
      "En 'Origen de materias' basta con asignar país a las 6 líneas comerciales para que todo el catálogo tenga ruta en el mapa del inicio.",
      "Puedes afinar el país de un SKU puntual sin tocar el de su línea completa.",
    ],
    tier: "standard",
    category: "publicaciones",
  },

  // ── Finanzas ─────────────────────────────────────────────────────────────────
  facturacion: {
    emoji: "🧾",
    label: "Facturación",
    description:
      "Sync MeLi↔Alegra, facturas de compra desde Gmail, Ventas y NC, y Astro Killer (trazabilidad venta→factura) — todo lo de facturación en un solo lugar. Consultar factura está en el icono del cabezote.",
    tips: [
      "Sync: fuerza o revisa la sincronización de facturas de venta con Alegra.",
      "Facturas de compra: escanea Gmail y registra en Alegra con aprobación.",
      "Astro Killer: compara lado a lado cada venta contra lo facturado en Alegra.",
      "Para buscar por producto usa el icono de factura del encabezado.",
    ],
    tier: "standard",
    category: "facturacion",
  },
  "astro-killer": {
    emoji: "🎯",
    label: "Astro Killer",
    description:
      "Trazabilidad de ventas MeLi: ID de venta → factura Alegra → notas crédito asociadas. Útil cuando un cliente pide corregir/re-facturar (ej. cambio de datos de empresa). Vive dentro de la sección Facturación.",
    tips: [
      "Cada venta muestra el historial completo de facturas — incluidas las anuladas y su nota crédito.",
      "Reemplaza a Astroselling: ahora la facturación automática de MeLi corre por acá, contra Alegra.",
    ],
    tier: "standard",
    category: "facturacion",
  },
  sync: {
    emoji: "🔄",
    label: "Sync Facturas",
    description: "Sincroniza automáticamente las facturas de MercadoLibre con el ERP Alegra. En modo automático funciona solo — aquí puedes forzar una sincronización manual.",
    tips: [
      "Ahora vive dentro de la sección Facturación.",
      "'Sync hoy' revisa las ventas de las últimas 24 horas.",
      "Usa 'Por Pack ID' cuando una factura específica no se subió correctamente.",
    ],
    tier: "standard",
    category: "facturacion",
  },
  facturas: {
    emoji: "🧾",
    label: "Facturas de compra",
    description: "Facturas de proveedores que llegan por Gmail. El sistema las detecta automáticamente y las organiza para su registro en Alegra.",
    tips: [
      "Ahora vive dentro de la sección Facturación.",
      "Verifica que el proveedor y monto sean correctos antes de aprobar.",
    ],
    tier: "standard",
    category: "facturacion",
  },
  "costos-productos": {
    emoji: "📊",
    label: "Costos de productos",
    description: "Costos unitarios y márgenes por SKU. Cruza datos de compra, inventario y venta para decisiones de precio.",
    tips: [
      "Útil para validar rentabilidad antes de cambiar precios en MeLi o la web.",
    ],
    tier: "advanced",
    category: "contabilidad",
  },
  "catalogo-alegra": {
    emoji: "📦",
    label: "Catálogo Alegra",
    description: "Espejo local de productos y combos de Alegra, con el precio publicado en MeLi al lado (mismo SKU).",
    tips: [
      "Pulsa «Sincronizar desde Alegra» la primera vez o cuando el listado esté desactualizado (>24 h).",
      "La columna MeLi sale de la caché de cobros (~1 h). Desfasado = Alegra ≠ precio publicado.",
      "«Usar MeLi» copia ese precio al lista de Alegra. El lote omite diferencias >2× (posible SKU cruzado).",
      "Usá Productos / Combos arriba para clasificar; en cada fila podés Editar (nombre/precio) o Eliminar.",
      "En Combos, Editar también permite cambiar la receta (componentes/cantidades) si el kit aún no tiene movimientos en Alegra; si ya los tiene, solo nombre/precio.",
      "Si Alegra no deja borrar por facturas asociadas, el ítem se inactiva y desaparece del listado activo.",
    ],
    tier: "standard",
    category: "contabilidad",
  },
  "centros-costo": {
    emoji: "💰",
    label: "Centros de costo",
    description: "Clasificación contable de gastos e ingresos por área o proyecto. Permite saber qué departamento genera más costo.",
    tips: [
      "Asigna cada gasto al centro de costo correspondiente para informes precisos.",
    ],
    tier: "standard",
    category: "contabilidad",
  },
  rentabilidad: {
    emoji: "📈",
    label: "Rentabilidad",
    description: "Análisis de márgenes y rentabilidad por producto, categoría o período. Ideal para decisiones de precios y portafolio.",
    tips: [
      "Compara el costo de fabricación con el precio de venta para ver el margen real.",
      "Todo el módulo Contabilidad (facturas, sync, costos…) está unificado en un solo botón del menú.",
    ],
    tier: "standard",
    category: "contabilidad",
  },
  publicidad: {
    emoji: "📢",
    label: "Publicidad",
    description: "Gasto y retorno de la campaña de Product Ads en MercadoLibre: qué productos queman presupuesto sin vender y cuáles tienen ACOS peligrosamente alto.",
    tips: [
      "El indicador 'En zona de riesgo' suma lo gastado en productos con cero ventas o ACOS > 60%.",
      "Los productos con ACOS > 100% gastaron más en el anuncio de lo que vendieron — pérdida directa, sin necesitar dato de margen.",
      "'Actualizar' fuerza una consulta en vivo a MeLi (el resto del tiempo usa una caché de 1 hora).",
    ],
    tier: "standard",
    category: "contabilidad",
  },
  "salud-negocio": {
    emoji: "🩺",
    label: "Salud del negocio",
    description: "Rentabilidad neta semanal y mensual: ingresos MeLi + web menos costo de producto, comisiones/envío MeLi, gasto en publicidad y costos administrativos/fijos, con una calificación de 0 a 100.",
    tips: [
      "El score pondera margen neto (60%), eficiencia de ads por ACOS (20%) y tendencia vs. el período anterior (20%).",
      "La comisión de MeLi usa la tarifa actual aplicada retroactivamente — no hay forma de recuperar el cobro histórico real por orden.",
      "'Actualizar' fuerza una consulta en vivo a MeLi y Alegra (el resto del tiempo usa cachés de hasta 1 hora / 24 horas).",
    ],
    tier: "standard",
    category: "contabilidad",
  },
  "compras-exterior": {
    emoji: "🌐",
    label: "Compras exterior",
    description: "Extrae costos de producto desde pantallazos de compra en el exterior. Puedes guardar un borrador y retomar después. Si está en USD, convierte a COP con la TRM BanRep de la fecha de compra.",
    tips: [
      "Pega varios pantallazos con Ctrl+V o adjúntalos.",
      "Usa «Guardar para después» si no terminas: retomas desde Borradores pendientes.",
      "En el historial, «Editar» vuelve a cargar el pedido para corregir líneas, SKU o fotos.",
      "Al confirmar/actualizar costos se archiva el pantallazo y se actualizan costos en Alegra.",
    ],
    tier: "standard",
    category: "contabilidad",
  },
  "productos-siigo": {
    emoji: "📦",
    label: "Crear en Alegra",
    description: "Alta de productos (insumos) y combos/kits de venta directamente en Alegra. Disponible en Contabilidad (icono del encabezado) y en Diseño → Códigos EAN.",
    tips: [
      "En Códigos EAN selecciona un producto y pulsa Crear en Alegra, o Duplicar combo para copiar la receta de un combo existente al SKU elegido.",
      "En Contabilidad el icono está en el encabezado, junto a la calculadora.",
      "Usa Buscar para localizar productos y combos en Alegra. Si el resultado es un combo, pulsa Duplicar para copiar la receta a un SKU nuevo (sufijo -COPIA / «(copia)»).",
      "Verifica el código antes de crear para evitar duplicados.",
      "Los combos usan prefijo C- y necesitan al menos un componente existente.",
    ],
    tier: "standard",
    category: "contabilidad",
  },
  rrhh: {
    emoji: "🧑‍💼",
    label: "RRHH · Compensaciones",
    description: "Gestión de hallazgos de equidad salarial, carga laboral medida (panel y WhatsApp), matriz de valoración por puntos y agente asesor especializado en compensaciones y riesgos UGPP.",
    tips: [
      "Los hallazgos tienen estado (pendiente, en curso, resuelto) — actualízalos a medida que avanza el plan.",
      "Las horas de panel miden carga digital, no trabajo físico: úsalas como indicador, no como veredicto.",
      "El agente RRHH conoce los hallazgos y las métricas en vivo — pregúntale por escenarios de nómina.",
    ],
    tier: "advanced",
    category: "contabilidad",
  },
  operativos: {
    emoji: "🛠️",
    label: "Operativos",
    description: "Recursos humanos, pagos de impuestos, servicios públicos / recurrentes y pagos de mensajería — operación administrativa del día a día.",
    tips: [
      "Dentro de Operativos elige la subpestaña: RR.HH., Impuestos, Servicios o Mensajería.",
      "Servicios usa los mismos contratos que en Rentabilidad.",
      "Impuestos es una bitácora interna de pagos (DIAN, ICA, etc.).",
    ],
    tier: "advanced",
    category: "contabilidad",
  },
  "creditos-adquiridos": {
    emoji: "🏦",
    label: "Créditos adquiridos",
    description:
      "Préstamos, leasing y créditos de proveedores: tasa de interés anual, cuota, plazo, saldo y tabla de amortización.",
    tips: [
      "La cuota se calcula con el sistema francés (cuota fija), alemán (capital fijo) o solo interés.",
      "EA es efectiva anual; N.A.M.V. es nominal anual mes vencido, la más común en bancos colombianos.",
      "Cada pago de cuota entra al libro de Ingresos / Egresos como egreso.",
    ],
    tier: "standard",
    category: "contabilidad",
  },
  "ingresos-egresos": {
    emoji: "📒",
    label: "Ingresos / Egresos",
    description:
      "Tabla contable por fecha: ventas Alegra (y Siigo histórico hasta 2026-09-02), MeLi y página web; cobros MeLi; facturas de compra y cuentas de cobro del correo; impuestos, servicios operativos y cuotas de créditos adquiridos. Permite subir el extracto bancario (CSV/Excel/PDF) arrastrándolo o eligiendo el archivo, y vincular cada movimiento con la línea del banco.",
    tips: [
      "Filtra por rango de fechas y por fuente (MeLi, Alegra, web, compras, cuentas de cobro, operativos).",
      "Mismo concepto el mismo día → una casilla con sumatoria; clic para desplegar el detalle.",
      "Arrastra el extracto (CSV/Excel/PDF) o elige el archivo; queda en la biblioteca y puedes vincular cada fila por monto y fecha.",
      "Las ventas web son pedidos con estado approved en la tienda.",
      "Las cuentas de cobro del correo (p. ej. William) aparecen como egreso aparte.",
    ],
    tier: "standard",
    category: "contabilidad",
  },
  "contabilidad-inicio": {
    emoji: "✅",
    label: "Inicio · Contabilidad",
    description:
      "Checklist guiado del hub Contabilidad: qué falta por hacer hoy (extractos bancarios por cargar o clasificar, préstamos con saldo pendiente, revisión de facturación MeLi), en un solo lugar en vez de recorrer cada pestaña por separado.",
    tips: [
      "Cada pendiente lleva directo a donde se resuelve — no duplica ningún panel, solo apunta a él.",
      "Cuando no hay pendientes, el checklist queda en verde.",
    ],
    tier: "standard",
    category: "contabilidad",
  },
  anulaciones: {
    emoji: "🧾",
    label: "Anulaciones",
    description:
      "Ventas anuladas —cancelación, devolución, reclamo o reembolso— y el estado de su nota crédito. Cada caso es un expediente con su línea de tiempo: por qué se anuló, qué factura se afectó, qué nota crédito se emitió y qué pasó con el inventario.",
    tips: [
      "Lo primero que muestra es la deuda: cuántas anulaciones siguen sin nota crédito y desde hace cuántos días la más antigua.",
      "Un caso 'Requiere decisión' no se emite solo por política (rezago de Siigo, reembolso a cargo de MeLi, monto alto o devolución parcial) — aprobarlo deja tu nombre en el expediente.",
      "Las notas que dejes en un expediente las lee después cualquier agente IA que consulte el caso.",
    ],
    tier: "standard",
    category: "contabilidad",
  },
  "libro-mayor": {
    emoji: "🧮",
    label: "Libro Mayor",
    description:
      "Contabilidad de partida doble propia, organizada en cuatro etapas: Conciliar (cargar extracto → emparejar → clasificar → verificar), Registrar (ingresos, egresos, compras y pagos de socios, asiento manual), Consultar (movimientos, cuentas T, balance, informes) y Configurar (plan de cuentas, terceros, créditos). El ámbito «Socios» abre el expediente personal de cada socio.",
    tips: [
      "Conciliar es un wizard: cada paso dice si está hecho, parcial o pendiente y lleva a la acción exacta.",
      "Registrar reúne las acciones rápidas (ingreso, egreso, compra de socio, pago a socio, compra a proveedor, aporte) y el asiento manual.",
      "Toda compra de un socio a nombre propio (p.ej. Amazon) se registra como cuenta por pagar al socio, no como gasto directo — el giro posterior salda esa cuenta.",
      "Cambia a «Socios» arriba para ver la contabilidad personal de un socio dentro de la de la empresa.",
    ],
    tier: "standard",
    category: "contabilidad",
  },
  socios: {
    emoji: "🧑‍💼",
    label: "Socios",
    description:
      "Expediente fiscal de cada socio dentro de la contabilidad de McKenna: sus extractos bancarios personales, su cuenta con la empresa, los cruces banco-socio ↔ banco-empresa, y el Declarador de activos digitales (declaraciones F210 presentadas, historial de Binance, efecto por año, pendientes y un agente asesor). Es un wizard: cada paso muestra qué falta y dónde se completa.",
    tips: [
      "Cada socio ve SOLO su expediente; únicamente la cuenta admin ve los de todos.",
      "«Importar carpeta del Declarador» trae los documentos, años y pendientes que ya se trabajaron en /home/mckg/Declarador sin copiarlos.",
      "Los extractos personales nunca entran a la conciliación de la empresa: solo se cruzan con ella en el paso «Cruces».",
      "El agente lee el expediente con herramientas y registra hallazgos; cada llamada pasa por el presupuesto LLM.",
    ],
    tier: "standard",
    category: "contabilidad",
  },
  pagos: {
    emoji: "💸",
    label: "Solicitudes de pago",
    description:
      "Cada pago que se solicita genera su asiento en el Libro Mayor y su comprobante en Alegra al aprobarse. Antes los pagos se aprobaban como tickets de texto libre y el registro contable quedaba pendiente de que alguien se acordara.",
    tips: [
      "El wizard elige la cuenta contable según lo que se paga: un flete va a Transporte, no al saco de Servicios.",
      "Las opciones salen de los saldos reales: proveedores con deuda, cuotas del mes, servicios activos.",
      "El asiento se MUESTRA antes de aprobar — quien firma ve contra qué cuenta va.",
      "Una solicitud rechazada no deja ningún rastro contable.",
    ],
    tier: "standard",
    category: "contabilidad",
  },
  "conciliacion-contador": {
    emoji: "🧭",
    label: "Conciliación contador",
    description:
      "Cruce de lo que el contador declaró (formularios 350 y recibos 490 bajados del correo) contra la cuenta 2365 del Libro Mayor. Cada diferencia es un paso del wizard: se decide, y si hay que resolverla con el contador se vuelve TKT del Centro de Mando.",
    tips: [
      "«Bajar del correo y analizar» trae los PDF del contador desde el Gmail de la empresa y los cruza; no usa IA.",
      "Un hallazgo que deja de detectarse se cierra solo — no hay que marcarlo.",
      "Marcar a un tercero como Régimen SIMPLE cambia sus datos en el Libro Mayor; crear el TKT no cambia nada hasta que alguien lo resuelva.",
      "Historial muestra quién decidió qué, con el número de ticket y su estado.",
    ],
    tier: "standard",
    category: "contabilidad",
  },
  prestamos: {
    emoji: "🤝",
    label: "Préstamos",
    description:
      "Préstamos que socios y familiares le hacen a la empresa, con su ciclo completo: contrato firmable, cronograma de cuotas, retención en la fuente y reportes al prestamista. Cada préstamo queda enlazado a su tercero y a los asientos del Libro Mayor (2295/2380 por pagar, 5305 intereses, 2365 retención).",
    tips: [
      "«+ Prestamista» da de alta al tercero con cédula, correo y cuenta bancaria, y lo inscribe como contacto en Alegra.",
      "El simulador muestra, ANTES de comprometerte, cuánto recibe el prestamista y cuánto cuesta en efectivo anual.",
      "Los PDF se generan siempre; el correo al tercero lo dispara un humano, nunca sale solo.",
      "«Cómo funciona» explica el esquema de socios y familiares, y el límite aduanero de las compras con tarjeta personal.",
    ],
    tier: "standard",
    category: "contabilidad",
  },
  impuestos: {
    emoji: "🧾",
    label: "Pagos de impuestos",
    description: "Bitácora de IVA, retenciones, ICA y otras obligaciones tributarias.",
    tips: ["Registra fecha, periodo gravable, entidad y referencia del formulario."],
    tier: "advanced",
    category: "contabilidad",
  },
  servicios: {
    emoji: "💡",
    label: "Servicios",
    description: "Contratos de servicios públicos y pagos recurrentes.",
    tips: ["También accesible desde Rentabilidad → Servicios."],
    tier: "advanced",
    category: "contabilidad",
  },

  // ── Canales avanzados ─────────────────────────────────────────────────────────
  supervisor: {
    emoji: "🔍",
    label: "Supervisor WA",
    description: "Monitoreo avanzado de todas las conversaciones de WhatsApp. Ver métricas de rendimiento del agente IA y conversaciones en tiempo real.",
    tips: [
      "Útil para auditar la calidad de las respuestas automáticas de Hugo.",
    ],
    tier: "advanced",
    category: "sistemas",
  },
  voz: {
    emoji: "🎙️",
    label: "Voz IA",
    description: "Canal de atención telefónica con IA. Clientes pueden llamar y Hugo responde por voz.",
    tips: ["Canal experimental — consulta al administrador antes de activarlo."],
    tier: "advanced",
    category: "sistemas",
  },
  "control-versiones": {
    emoji: "🌳",
    label: "Control de Versiones",
    description: "Historial de cambios del repositorio: árbol de commits en forma de grafo (tipo cladograma) y los recaps de cada sesión de trabajo con la IA.",
    tips: [
      "Pestaña 'Árbol de commits': cada nodo es un commit; los colores separan ramas.",
      "Pestaña 'Recaps del equipo': resumen de qué se implementó, quién y en qué archivos, por tarea.",
      "Los recaps se agregan automáticamente en docs/team-recaps.md al terminar una tarea con la IA.",
    ],
    tier: "advanced",
    category: "sistemas",
  },
  "telemetria": {
    emoji: "📡",
    label: "Telemetría",
    description: "Logs, errores y métricas técnicas de toda la aplicación: puente de WhatsApp (Node), webhook MeLi y agente (Flask).",
    tips: [
      "Estado de servicios: si un punto aparece rojo, ese proceso no respondió en el último chequeo.",
      "Errores recientes: cada fila se puede expandir para ver el traceback completo y el contexto.",
      "Eventos de hoy: contadores técnicos (no reemplazan las métricas de negocio del Dashboard).",
    ],
    tier: "advanced",
    category: "sistemas",
  },
  "meli-oauth": {
    emoji: "🔌",
    label: "Conexión MercadoLibre",
    description: "Reactivar la conexión OAuth con MercadoLibre cuando la app queda inactiva o se crea una nueva (Client ID/Secret + código de autorización).",
    tips: [
      "Si la app de MeLi queda 'INACTIVA', preguntas/órdenes/posventa/envíos dejan de llegar en silencio — reconecta aquí.",
      "El Client Secret nunca se muestra de vuelta por seguridad; solo indica si ya hay uno guardado.",
      "Después de activar, recuerda revisar en developers.mercadolibre.com que el Callback URL y los tópicos (questions, orders_v2, messages, shipments) sigan habilitados — eso no se puede hacer desde aquí.",
    ],
    tier: "advanced",
    category: "sistemas",
  },
  "gmail-oauth": {
    emoji: "📧",
    label: "Conexión Gmail",
    description: "Estado en tiempo real y reautorización con un clic del acceso OAuth a mckenna.group.colombia@gmail.com — usado por facturas de compra (Gmail) y búsquedas de correo.",
    tips: [
      "Si el token de Gmail se desautoriza, la sincronización de facturas de compra desde Gmail deja de funcionar en silencio — revisa el badge 'Token Gmail' en el Dashboard.",
      "Antes de usar 'Generar link de autorización' por primera vez, agrega el Redirect URI que muestra el panel en Google Cloud Console (paso único, no automatizable).",
      "A diferencia de MeLi, no hay que copiar/pegar ningún código: al aceptar en Google, el servidor completa la conexión solo y el estado se actualiza en unos segundos.",
    ],
    tier: "advanced",
    category: "sistemas",
  },
  "tareas-programadas": {
    emoji: "⏱️",
    label: "Tareas Programadas",
    description: "Frecuencia de los crons de la app (auditoría, compliance MeLi, certificados de retención, costos LLM, monitor de importaciones) — sin tocar el crontab del servidor.",
    tips: [
      "Cada job sigue disparándose por cron como siempre, pero se salta si no ha pasado el intervalo configurado aquí.",
      "Por defecto todos corren cada 7 días — cámbialo si alguno necesita más o menos frecuencia.",
    ],
    tier: "advanced",
    category: "sistemas",
  },
  webchat: {
    emoji: "🌐",
    label: "Chat web",
    description: "Conversaciones iniciadas desde el chat de la página web mckennagroup.co.",
    tips: ["Las conversaciones sin respuesta en más de 10 minutos se marcan en rojo."],
    tier: "advanced",
    category: "canales",
  },

  // ── Placas (botón individual en el menú) ──────────────────────────────────────
  "placas-concreto": {
    emoji: "🧱",
    label: "Placas de Concreto",
    description: "Calculadora de taller para placas de concreto pulido de alto rendimiento. Ingresa las dimensiones del molde y el tipo de mezcla y obtén los pesos exactos de cada insumo para esa pieza.",
    tips: [
      "El % de merma por defecto es 5% — súbelo si el molde tiene pérdida por derrame o vibrado.",
      "'Agregado reciclado' usa trozos de concreto viejo (SSS); 'Alta densidad negro intenso' es la mezcla sin agregado reciclado.",
      "Los resultados en gramos y mililitros quedan listos para pesar directo en la báscula del taller.",
    ],
    tier: "standard",
    category: "placas",
  },

  // ── Contenido (botón individual en el menú) ───────────────────────────────────
  contenido: {
    emoji: "🎬",
    label: "Contenido",
    description: "Herramientas de video: quitar una marca de agua estática, generar audio con la voz clonada y grabar una sección de la pantalla con su audio para sacar fragmentos y enviarlos por WhatsApp.",
    tips: [
      "Sube el video y ajusta la franja inferior (o una región exacta) donde está la marca.",
      "El proceso corre en segundo plano — puedes seguir usando el panel mientras termina.",
      "Se conserva el audio original del video automáticamente.",
      "Videos largos o en alta resolución tardan más: el inpainting se calcula fotograma a fotograma.",
      "Grabar pantalla: comparte una pestaña con su audio, marca inicio/fin con I y O y envía el fragmento por WhatsApp.",
    ],
    tier: "standard",
    category: "contenido",
  },

  // ── Config ────────────────────────────────────────────────────────────────────
  "etiquetas-config": {
    emoji: "⚙️",
    label: "Config etiquetas",
    description: "Configuración avanzada de productos para el sistema de etiquetado: formatos, campos personalizados y reglas normativas.",
    tips: ["Solo modifica esto si sabes exactamente qué cambiar — afecta todas las etiquetas."],
    tier: "advanced",
    category: "diseno",
  },
  "logistica-importaciones": {
    emoji: "🚢",
    label: "Importaciones",
    description: "Gestión de importaciones internacionales: pedidos a proveedores en el exterior, plazos y costos.",
    tips: [],
    tier: "advanced",
    category: "logistica",
  },
  "logistica-embarques": {
    emoji: "✈️",
    label: "Embarques",
    description: "Seguimiento de embarques en tránsito desde el país de origen hasta Colombia.",
    tips: [],
    tier: "advanced",
    category: "logistica",
  },
  "logistica-aduanas": {
    emoji: "🛃",
    label: "Aduana",
    description: "Documentos y trámites de nacionalización de mercancías importadas.",
    tips: [],
    tier: "advanced",
    category: "logistica",
  },
  "logistica-proveedores": {
    emoji: "🤝",
    label: "Proveedores",
    description: "Directorio de proveedores internacionales: contactos, condiciones y historial de compras.",
    tips: [],
    tier: "advanced",
    category: "logistica",
  },
  "logistica-seguimiento": {
    emoji: "📍",
    label: "Seguimiento",
    description: "Rastreo en tiempo real de envíos y pedidos internacionales.",
    tips: [],
    tier: "advanced",
    category: "logistica",
  },
  settings: {
    emoji: "⚙️",
    label: "Ajustes",
    description: "Configuración del panel: apariencia, tema, notificaciones y gestión de usuarios.",
    tips: [
      "Paleta en el cabezote o Temas en el menú: McKenna (clásico) o Atelier. También en Ajustes.",
      "Los administradores pueden agregar o quitar usuarios desde aquí.",
    ],
    tier: "core",
    category: "inicio",
  },
};
