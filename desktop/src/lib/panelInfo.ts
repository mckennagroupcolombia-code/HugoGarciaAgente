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
      "El indicador verde junto a MeLi, Sheets o Siigo significa que el servicio está funcionando.",
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
  pedidos: {
    emoji: "📦",
    label: "Pedidos Web",
    description: "Órdenes de compra llegadas por la tienda en línea mckennagroup.co. Puedes facturar, actualizar estado de envío y notificar al cliente.",
    tips: [
      "Cuando llega un pedido, también recibes una alerta en el grupo de WhatsApp.",
      "El botón 'Facturar' crea la factura en Siigo automáticamente.",
      "Actualiza el número de guía para que el cliente pueda rastrear su envío.",
    ],
    tier: "core",
    category: "atencion",
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
      "Tabla unificada: Publicación (Activa / Pausada), ventas 30 d y códigos MeLi ↔ Siigo. Editar SKU carga a MeLi.",
      "Siigo solo lectura — no recibe stock desde el panel.",
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
      "Sync MeLi↔Siigo y facturas de compra desde Gmail. Consultar factura está en el icono del cabezote.",
    tips: [
      "Sync: fuerza o revisa la sincronización de facturas de venta MeLi con Siigo.",
      "Facturas de compra: escanea Gmail y registra en Siigo con aprobación.",
      "Para buscar por producto usa el icono de factura del encabezado.",
    ],
    tier: "standard",
    category: "contabilidad",
  },
  sync: {
    emoji: "🔄",
    label: "Sync Facturas",
    description: "Sincroniza automáticamente las facturas de MercadoLibre con el ERP Siigo. En modo automático funciona solo — aquí puedes forzar una sincronización manual.",
    tips: [
      "Ahora vive dentro de la pestaña Facturación.",
      "'Sync hoy' revisa las ventas de las últimas 24 horas.",
      "Usa 'Por Pack ID' cuando una factura específica no se subió correctamente.",
    ],
    tier: "standard",
    category: "contabilidad",
  },
  facturas: {
    emoji: "🧾",
    label: "Facturas de compra",
    description: "Facturas de proveedores que llegan por Gmail. El sistema las detecta automáticamente y las organiza para su registro en Siigo.",
    tips: [
      "Ahora vive dentro de la pestaña Facturación.",
      "Verifica que el proveedor y monto sean correctos antes de aprobar.",
    ],
    tier: "standard",
    category: "contabilidad",
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
      "'Actualizar' fuerza una consulta en vivo a MeLi y Siigo (el resto del tiempo usa cachés de hasta 1 hora / 24 horas).",
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
      "Al confirmar/actualizar costos se archiva el pantallazo y se actualizan costos en Siigo.",
    ],
    tier: "standard",
    category: "contabilidad",
  },
  "productos-siigo": {
    emoji: "📦",
    label: "Crear en Siigo",
    description: "Alta de productos (insumos) y combos/kits de venta directamente en Siigo. Botón flotante en Contabilidad, junto a la calculadora.",
    tips: [
      "El botón redondo está arriba a la derecha, debajo de la calculadora.",
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
    description: "Recursos humanos, pagos de impuestos y servicios públicos / recurrentes — operación administrativa del día a día.",
    tips: [
      "Dentro de Operativos elige la subpestaña: RR.HH., Impuestos o Servicios.",
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
      "Tabla contable por fecha: ventas Siigo, MeLi y página web; cobros MeLi; facturas de compra y cuentas de cobro del correo; impuestos, servicios operativos y cuotas de créditos adquiridos. Permite subir el extracto bancario (CSV/Excel) y vincular cada movimiento con la línea del banco.",
    tips: [
      "Filtra por rango de fechas y por fuente (MeLi, Siigo, web, compras, cuentas de cobro, operativos).",
      "Mismo concepto el mismo día → una casilla con sumatoria; clic para desplegar el detalle.",
      "Sube el extracto (CSV/Excel con Fecha + Débito/Crédito) y usa «Vincular» en cada fila; sugiere por monto y fecha.",
      "Las ventas web son pedidos con estado approved en la tienda.",
      "Las cuentas de cobro del correo (p. ej. William) aparecen como egreso aparte.",
    ],
    tier: "standard",
    category: "contabilidad",
  },
  "libro-mayor": {
    emoji: "🧮",
    label: "Libro Mayor",
    description:
      "Contabilidad de partida doble propia: plan de cuentas, terceros (proveedores, clientes, socios), asientos con débito/crédito y cuentas T. Incluye plantillas para compras de socios (p.ej. Amazon con comisión, registradas como cuenta por pagar) y compras a proveedores/socios-proveedores (p.ej. materia prima transformada).",
    tips: [
      "Vista Simple: acciones rápidas (ingreso, egreso, compra de socio, pago a socio, compra a proveedor) y saldos pendientes con cada socio.",
      "Vista Avanzada: plan de cuentas, terceros, cuentas T por cuenta y balance de comprobación.",
      "Toda compra de un socio a nombre propio (p.ej. Amazon) se registra como cuenta por pagar al socio, no como gasto directo — el giro posterior salda esa cuenta.",
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
    description: "Herramientas para preparar video antes de publicarlo. Por ahora: quitar una marca de agua estática (franja o región fija) de un video.",
    tips: [
      "Sube el video y ajusta la franja inferior (o una región exacta) donde está la marca.",
      "El proceso corre en segundo plano — puedes seguir usando el panel mientras termina.",
      "Se conserva el audio original del video automáticamente.",
      "Videos largos o en alta resolución tardan más: el inpainting se calcula fotograma a fotograma.",
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
