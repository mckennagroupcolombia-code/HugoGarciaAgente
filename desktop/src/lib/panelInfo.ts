/**
 * Metadata descriptiva de cada panel: descripción, tips y clasificación.
 * Usado por el Sidebar remasterizado y el componente PanelHelp.
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
    ],
    tier: "core",
    category: "atencion",
  },
  postventa: {
    emoji: "📬",
    label: "Postventa MeLi",
    description: "Mensajes de compradores después de que pagaron: dudas de envío, solicitudes de factura, reclamos. Requieren atención rápida.",
    tips: [
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

  // ── Inventario ────────────────────────────────────────────────────────────────
  stock: {
    emoji: "📦",
    label: "Stock",
    description: "Punto único de entrada de inventario: registra entradas y salidas de unidades aquí y se propagan a MeLi y a la página web, sin editar nada manualmente en la app de MeLi.",
    tips: [
      "'+ Entrada' y '− Salida' suman o restan unidades y empujan el resultado a MeLi y a la web.",
      "La pestaña 'Códigos MeLi ↔ Siigo' cruza SKU de publicación con código Siigo; con Editar puedes cambiar el SKU en MeLi y el vínculo Siigo (filtro Sin C- para candidatos a combo).",
      "Un producto 'pausado en MeLi' igual acepta entradas — se actualiza la web de inmediato; MeLi puede seguir pausado hasta reactivarlo allá ('Abrir en MeLi' para ir directo).",
      "Siigo solo aparece como referencia de lectura — su API no permite escribirle stock; se sigue ajustando aparte.",
    ],
    tier: "core",
    category: "inventario",
  },
  etiquetas: {
    emoji: "🏷️",
    label: "Etiquetas",
    description: "Imprime etiquetas de producto para empaque, trazabilidad y cumplimiento normativo. Incluye Studio, el editor visual de plantillas.",
    tips: [
      "Selecciona el producto, el lote y la fecha de vencimiento antes de imprimir.",
      "El formato más usado es la etiqueta de 50×30mm para frascos pequeños.",
      "Usa la pestaña Studio para diseñar una plantilla y enviarla directo a imprimir.",
    ],
    tier: "core",
    category: "inventario",
  },
  fichas: {
    emoji: "📄",
    label: "Docs técnicos",
    description: "Fichas técnicas e información científica de ingredientes. Útil para responder preguntas técnicas de clientes y formuladores.",
    tips: [
      "Las fichas están vinculadas a las publicaciones de MercadoLibre — Hugo las usa para responder preguntas.",
      "Puedes descargar el PDF de cada ficha para enviarlo a clientes.",
    ],
    tier: "standard",
    category: "inventario",
  },

  // ── Tienda y taller ───────────────────────────────────────────────────────────
  publicaciones: {
    emoji: "📢",
    label: "Publicaciones",
    description: "Contenido publicado en la tienda web y redes sociales. Recetas de formulación, guías de uso y artículos científicos generados por IA.",
    tips: [
      "Las publicaciones se generan automáticamente con IA a partir de ingredientes del catálogo.",
      "Puedes editar el contenido antes de publicar.",
    ],
    tier: "standard",
    category: "tienda",
  },

  sitioweb: {
    emoji: "🌐",
    label: "Sitio Web",
    description: "Controla la apariencia de la tienda mckennagroup.co: elige entre el tema Clásico y el tema Pureza & Trazabilidad, y edita los textos del home (hero, ruta de trazabilidad, métricas y llamados a la acción).",
    tips: [
      "Usa 'Vista previa' para ver el tema en tu navegador sin cambiarlo para los clientes.",
      "Los cambios guardados se publican de inmediato — no hace falta reiniciar el sitio.",
      "'Restaurar textos' vuelve al contenido recomendado del tema Pureza.",
    ],
    tier: "standard",
    category: "tienda",
  },

  // ── Finanzas ─────────────────────────────────────────────────────────────────
  sync: {
    emoji: "🔄",
    label: "Sync Facturas",
    description: "Sincroniza automáticamente las facturas de MercadoLibre con el ERP Siigo. En modo automático funciona solo — aquí puedes forzar una sincronización manual.",
    tips: [
      "Normalmente no necesitas entrar aquí — el sistema sincroniza solo cada día.",
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
      "Las facturas se descargan del correo de compras automáticamente.",
      "Verifica que el proveedor y monto sean correctos antes de aprobar.",
      "Usa la pestaña Consultar factura para buscar por nombre de producto.",
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
  webchat: {
    emoji: "🌐",
    label: "Chat web",
    description: "Conversaciones iniciadas desde el chat de la página web mckennagroup.co.",
    tips: ["Las conversaciones sin respuesta en más de 10 minutos se marcan en rojo."],
    tier: "advanced",
    category: "canales",
  },

  // ── Tienda y taller ───────────────────────────────────────────────────────────
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
    category: "tienda",
  },

  // ── Config ────────────────────────────────────────────────────────────────────
  "etiquetas-config": {
    emoji: "⚙️",
    label: "Config etiquetas",
    description: "Configuración avanzada de productos para el sistema de etiquetado: formatos, campos personalizados y reglas normativas.",
    tips: ["Solo modifica esto si sabes exactamente qué cambiar — afecta todas las etiquetas."],
    tier: "advanced",
    category: "inventario",
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
      "Puedes cambiar el tema de color desde la opción 'Apariencia'.",
      "Los administradores pueden agregar o quitar usuarios desde aquí.",
    ],
    tier: "core",
    category: "inicio",
  },
};
