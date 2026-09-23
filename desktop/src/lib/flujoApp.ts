import type { Panel } from "../stores/app";

/**
 * La aplicación ordenada por la SECUENCIA del negocio, no por departamento.
 *
 * El menú agrupa los 61 paneles por área («Contabilidad» tiene 22, entre ellos Stock,
 * Costos y Crear en Alegra), así que cada uno vive aislado y nada dice qué sigue
 * después. Acá cada panel ocupa el lugar donde se usa: la mercancía se compra, se
 * prepara, se publica, se vende, se entrega, se factura y se cuenta.
 *
 * Es la ÚNICA fuente del Mapa de la aplicación (MapaAppFlujo.tsx). Mover un panel de
 * etapa o de tramo es editar este archivo. `tests/test_mapa_producto.py` falla si un
 * panel de `panelInfo.ts` queda sin lugar, o si aparece en dos.
 *
 * Dentro de una etapa, los TRAMOS van en orden (uno alimenta al siguiente); los
 * paneles de un mismo tramo son herramientas paralelas para ese momento.
 */

export interface PasoApp {
  panel: Panel;
  /** Qué se hace ahí, en una línea, dicho desde la tarea y no desde el módulo. */
  hace: string;
}

export interface TramoApp {
  titulo: string;
  /** Las variables que viven en este tramo: lo que se captura, se decide o se entrega aquí. */
  datos: string[];
  pasos: PasoApp[];
}

export interface EtapaApp {
  id: string;
  titulo: string;
  /** La pregunta que esta etapa responde. */
  pregunta: string;
  /** Lo que le entrega a la etapa siguiente (texto de la flecha). */
  entrega?: string;
  /** "linea" = parte de la secuencia principal · "transversal" = acompaña a todas. */
  tipo: "linea" | "transversal";
  tramos: TramoApp[];
  /** Diagramas de Archify (docs/arquitectura) que detallan esta etapa. */
  diagramas?: string[];
  /**
   * La guía de la etapa: cuando lo detenido se resuelve caso a caso, la etapa ofrece un taller
   * guiado en vez de dejar a la persona escoger panel. `abre` (y no `panel`) porque ese panel ya
   * tiene su lugar en un tramo: la guía es otra puerta al mismo sitio.
   */
  guia?: { titulo: string; hace: string; abre: Panel };
}

/**
 * El ORIGEN del diagrama: la Agenda. Es lo primero que ve cada persona —lo que le pidieron,
 * lo que puede iniciar, los mensajes del equipo— y de ahí sale hacia cualquier etapa. No es
 * un panel más de una etapa: por eso va aparte y primero en el menú y en el mapa.
 */
export const ORIGEN_APP = {
  panel: "hugo" as Panel,
  titulo: "Mi agenda",
  hace: "Lo que te pidieron, lo que puedes iniciar y los mensajes del equipo",
  datos: ["solicitudes (TKT)", "acciones", "recordatorios", "mensajes"],
};

export const ETAPAS_APP: EtapaApp[] = [
  {
    id: "abastecer",
    titulo: "Abastecer",
    pregunta: "¿Qué se compra, a quién, y cómo se paga?",
    entrega: "mercancía",
    tipo: "linea",
    diagramas: ["01-flujo-pago"],
    tramos: [
      { titulo: "Encontrar al proveedor", datos: ["proveedor", "producto (clave normalizada)", "último precio", "mínimo de compra"], pasos: [{ panel: "logistica-proveedores", hace: "Quién vende qué y a qué precio" }] },
      {
        titulo: "Traer la mercancía", datos: ["pedido al exterior", "embarque", "documentos de aduana", "costo USD → COP (TRM)"],
        pasos: [
          { panel: "logistica-importaciones", hace: "Pedidos a proveedores del exterior" },
          { panel: "logistica-embarques", hace: "Embarques en tránsito" },
          { panel: "logistica-aduanas", hace: "Nacionalización y documentos" },
          { panel: "logistica-seguimiento", hace: "Rastreo de los envíos" },
          { panel: "compras-exterior", hace: "Costos desde pantallazos de compra" },
        ],
      },
      {
        titulo: "Registrar y pagar", datos: ["cotización o factura", "SKU base", "asiento 1435 + IVA 240810", "borrador → pendiente → aprobada → en banco → pagada", "dos tokens"],
        pasos: [
          { panel: "facturas", hace: "Facturas de proveedores que llegan por Gmail" },
          { panel: "pagos", hace: "Solicitar, aprobar y girar cada pago" },
          { panel: "creditos-adquiridos", hace: "Créditos con los que se financia la compra" },
        ],
      },
    ],
  },
  {
    id: "preparar",
    titulo: "Preparar",
    pregunta: "¿Lo comprado ya es un producto que se puede vender?",
    entrega: "producto listo",
    tipo: "linea",
    diagramas: ["02-flujo-producto", "cadena-producto"],
    guia: { titulo: "Taller de combos", hace: "Completar, combo por combo, las piezas que faltan", abre: "combos" },
    tramos: [
      {
        titulo: "Dar de alta", datos: ["SKU base (g · mL · un)", "combo C-… (kit)", "precio de lista"],
        pasos: [
          { panel: "productos-siigo", hace: "Crear el producto base y el combo en Alegra" },
          { panel: "catalogo-alegra", hace: "Espejo del catálogo con su precio en MeLi" },
        ],
      },
      {
        titulo: "Tener existencias", datos: ["stock por SKU", "agotado · crítico", "MeLi ↔ web"],
        pasos: [
          { panel: "stock", hace: "Entradas y salidas de unidades" },
          { panel: "control-inventario", hace: "Agotados, críticos y diferencias" },
        ],
      },
      {
        titulo: "Armar el combo", datos: ["receta: materia prima + empaque + etiqueta", "cantidad de la presentación", "costo y margen"],
        pasos: [
          { panel: "combos", hace: "La receta de cada combo y lo que le falta" },
          { panel: "costos-productos", hace: "Costo unitario y margen por SKU" },
        ],
      },
      {
        titulo: "Respaldarlo", datos: ["documento TDS · COA · SDS (referencia = SKU base)", "EAN-13 (nace del SKU de venta)", "tamaño de etiqueta: cantidad · categoría · polvo o líquido"],
        pasos: [
          { panel: "producto", hace: "Ficha técnica, etiqueta, EAN y PNG de una presentación, en un solo lugar" },
          { panel: "fichas", hace: "Ficha técnica, COA y SDS" },
          { panel: "etiquetas", hace: "Código EAN, diseño e impresión de etiquetas" },
          { panel: "etiquetas-config", hace: "Formatos y campos de las etiquetas" },
        ],
      },
    ],
  },
  {
    id: "publicar",
    titulo: "Publicar",
    pregunta: "¿El producto está a la vista, donde compra el cliente?",
    entrega: "publicación",
    tipo: "linea",
    tramos: [
      {
        titulo: "Ponerlo en vitrina", datos: ["publicación MCO…", "precio web y MeLi", "fotos", "origen de la materia"],
        pasos: [
          { panel: "publicaciones", hace: "La ficha en MercadoLibre y en la tienda web" },
          { panel: "vitrina-web", hace: "Banners y origen de las materias primas" },
        ],
      },
      {
        titulo: "Darlo a conocer", datos: ["pieza: ficha · receta · tip", "gasto y retorno de Ads"],
        pasos: [
          { panel: "contenido", hace: "Video, voz y piezas para redes" },
          { panel: "publicidad", hace: "Gasto y retorno de Product Ads" },
        ],
      },
    ],
  },
  {
    id: "vender",
    titulo: "Vender",
    pregunta: "¿Cada cliente que pregunta recibe respuesta y puede comprar?",
    entrega: "pedido",
    tipo: "linea",
    diagramas: ["03-venta-meli", "04-venta-web", "05-venta-whatsapp"],
    tramos: [
      {
        titulo: "Responder al cliente", datos: ["pregunta + ficha técnica", "conversación WA / web", "pedido WEB-XXXXX", "modo humano o IA"],
        pasos: [
          { panel: "preventa", hace: "Preguntas de MercadoLibre sin respuesta" },
          { panel: "whatsapp", hace: "Conversaciones que atiende el agente" },
          { panel: "webchat", hace: "Chat de la página web" },
          { panel: "ventas-email", hace: "Correos de ventas@" },
          { panel: "voz", hace: "Atención por voz" },
        ],
      },
      {
        titulo: "Apoyar al asesor", datos: ["borradores en sombra", "alerta al asesor", "presupuesto IA del día"],
        pasos: [
          { panel: "chat", hace: "Preguntarle a Hugo por stock, precios o fichas" },
          { panel: "supervisor", hace: "Vigilar y corregir al agente de WhatsApp" },
        ],
      },
    ],
  },
  {
    id: "entregar",
    titulo: "Entregar",
    pregunta: "¿Lo vendido salió, llegó, y el cliente quedó bien?",
    entrega: "entrega",
    tipo: "linea",
    tramos: [
      { titulo: "Recibir el pedido", datos: ["pedido MCKG-…", "estado del pago", "dirección"], pasos: [{ panel: "pedidos", hace: "Órdenes de la tienda web" }] },
      {
        titulo: "Empacar y despachar", datos: ["foto del paquete", "rótulo 10×15", "guía y transportadora"],
        pasos: [
          { panel: "empaque", hace: "Foto del paquete listo como evidencia" },
          { panel: "guias-envio", hace: "Rótulos para la impresora térmica" },
        ],
      },
      {
        titulo: "Que llegue bien", datos: ["hora de entrega Flex", "corte 12:20", "mensaje posventa (pack)"],
        pasos: [
          { panel: "entregas-flex", hace: "A qué hora llegan los envíos Flex" },
          { panel: "postventa", hace: "Mensajes del comprador después de pagar" },
        ],
      },
    ],
  },
  {
    id: "facturar",
    titulo: "Facturar",
    pregunta: "¿Cada venta entregada tiene su factura, y cada anulación su nota crédito?",
    entrega: "factura",
    tipo: "linea",
    tramos: [
      {
        titulo: "Emitir", datos: ["pack o pedido", "cédula o NIT", "IVA por línea", "factura DIAN"],
        pasos: [
          { panel: "facturacion", hace: "Ventas, cotizar y facturar, notas crédito" },
          { panel: "sync", hace: "Cruce de facturas entre MeLi y el ERP" },
        ],
      },
      {
        titulo: "Rastrear y corregir", datos: ["venta ↔ factura ↔ nota crédito", "margen de 48 h"],
        pasos: [
          { panel: "astro-killer", hace: "De la venta a su factura y sus notas crédito" },
          { panel: "anulaciones", hace: "Ventas anuladas y el estado de su nota crédito" },
        ],
      },
    ],
  },
  {
    id: "contar",
    titulo: "Contar",
    pregunta: "¿El libro dice lo mismo que el banco, y el contador puede declarar?",
    tipo: "linea",
    diagramas: ["06-contabilidad"],
    tramos: [
      {
        titulo: "Saber qué falta hoy", datos: ["checklist contable del día"],
        pasos: [{ panel: "contabilidad-inicio", hace: "Lista guiada de pendientes contables" }],
      },
      {
        titulo: "Registrar", datos: ["asiento (débito = crédito)", "cuenta PUC", "tercero", "centro de costo"],
        pasos: [
          { panel: "ingresos-egresos", hace: "Todo lo que entró y salió, por fecha" },
          { panel: "operativos", hace: "Nómina, impuestos, servicios y mensajería" },
          { panel: "servicios", hace: "Servicios públicos y pagos recurrentes" },
          { panel: "centros-costo", hace: "A qué área pertenece cada gasto" },
        ],
      },
      {
        titulo: "Cuadrar con el banco", datos: ["extracto", "línea ↔ asiento (±1 COP, ±3 días)", "corte 2026-09-01"],
        pasos: [{ panel: "libro-mayor", hace: "Partida doble, extracto y conciliación" }],
      },
      {
        titulo: "Responder por terceros", datos: ["préstamo: 25 % E.A., 24 cuotas", "cuenta del socio 2380", "expediente fiscal"],
        pasos: [
          { panel: "prestamos", hace: "Préstamos de socios y familiares" },
          { panel: "socios", hace: "Expediente fiscal de cada socio" },
        ],
      },
      {
        titulo: "Declarar", datos: ["350 / 490 del contador", "2365 · 2367 · 2368", "hallazgos → TKT"],
        pasos: [
          { panel: "impuestos", hace: "IVA, retenciones e ICA pagados" },
          { panel: "conciliacion-contador", hace: "Lo que declaró el contador contra el libro" },
        ],
      },
    ],
  },
  {
    id: "dirigir",
    titulo: "Dirigir",
    pregunta: "¿Cómo va el negocio y qué hay que decidir?",
    tipo: "transversal",
    diagramas: ["00-mapa-global"],
    tramos: [
      {
        titulo: "Cuidar al equipo", datos: ["carga de trabajo", "equidad salarial"],
        pasos: [
          { panel: "rrhh", hace: "Equidad salarial y carga de trabajo" },
        ],
      },
      {
        titulo: "Leer los números", datos: ["KPIs del día", "margen por SKU", "rentabilidad neta"],
        pasos: [
          { panel: "dashboard", hace: "El resumen del día" },
          { panel: "rentabilidad", hace: "Margen por producto y por período" },
          { panel: "salud-negocio", hace: "Rentabilidad neta semanal y mensual" },
        ],
      },
    ],
  },
  {
    id: "sistema",
    titulo: "Sistema",
    pregunta: "¿La plataforma está conectada y haciendo su trabajo?",
    tipo: "transversal",
    diagramas: ["mi-agente"],
    tramos: [
      {
        titulo: "Ver el conjunto", datos: ["bloqueos por etapa", "diagramas de Archify", "errores y métricas"],
        pasos: [
          { panel: "mapa-sistema", hace: "Este mapa, los flujos y la cadena del producto" },
          { panel: "arquitectura", hace: "Qué archivo llama a cuál y qué código no usa nadie" },
          { panel: "telemetria", hace: "Errores y métricas técnicas" },
        ],
      },
      {
        titulo: "Mantener las conexiones", datos: ["token MeLi", "token Gmail", "frecuencia de cada tarea"],
        pasos: [
          { panel: "meli-oauth", hace: "Reconectar MercadoLibre" },
          { panel: "gmail-oauth", hace: "Reconectar Gmail" },
          { panel: "tareas-programadas", hace: "Cada cuánto corre cada tarea automática" },
        ],
      },
      {
        titulo: "Administrar", datos: ["commits y recaps", "usuarios, permisos y tema"],
        pasos: [
          { panel: "control-versiones", hace: "Qué cambió en la app y quién lo hizo" },
          { panel: "settings", hace: "Apariencia, usuarios y accesos" },
        ],
      },
    ],
  },
];

/** Paneles que existen pero no pertenecen a la secuencia de este negocio. */
export const FUERA_DEL_FLUJO: PasoApp[] = [
  { panel: "placas-concreto", hace: "Calculadora de placas de concreto (otro taller)" },
  { panel: "juegos", hace: "Juegos para un descanso (dentro de la Agenda)" },
];

/** Dónde vive un panel dentro de la secuencia (para la miga del cabezote). */
export function ubicacionDe(panel: Panel): { etapa: EtapaApp; tramo: TramoApp; n: number } | null {
  for (const etapa of ETAPAS_APP)
    for (let i = 0; i < etapa.tramos.length; i++)
      if (etapa.tramos[i].pasos.some((p) => p.panel === panel)) return { etapa, tramo: etapa.tramos[i], n: i + 1 };
  return null;
}
