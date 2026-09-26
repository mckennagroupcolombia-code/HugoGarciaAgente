/**
 * La operación real de McKenna, como la cuenta el Edificio del Mapa (26-sep-2026).
 *
 * ESTACIONES: dónde pasa cada cosa (piso = etapa de lib/flujoApp) y qué FUNCIÓN del catálogo real
 * la atiende (app/services/rendimiento.py → CATALOGO; quién la hace sale de /api/mapa-sistema/quien-hace).
 * RECORRIDO: lo que viaja de una estación a otra, en orden cronológico — la mercancía (materia prima →
 * bolsa dosificada → producto etiquetado → paquete → paquete con guía) y los papeles (factura de compra
 * → pago → Libro Mayor; entrega → factura de venta → Libro Mayor → rentabilidad).
 *
 * Reordenar o agregar un paso es editar este archivo: el Edificio lo dibuja y los relevos lo recorren.
 */
import type { Carga } from "../relevos/CapaRelevos";

export type Estacion = {
  id: string;
  piso: string;            // etapa de flujoApp (abastecer, preparar, publicar, vender, entregar, facturar, contar, dirigir)
  x: number;               // posición en el piso, de 0 a 1
  nombre: string;          // letrero corto (cabe en el celular)
  hace: string;            // qué pasa ahí (título al pasar)
  funcion?: string;        // id de la función en rendimiento.CATALOGO; sin función = alguien de fuera
  externo?: string;        // quién es, si es de fuera (la transportadora)
  prop: "camion" | "mesa" | "estante" | "bascula" | "selladora" | "sello" | "impresora" | "almacen" | "camara"
    | "pantalla" | "telefono" | "canasta" | "cajas" | "termica" | "escritorio" | "libro" | "grafica" | "buzon";
};

export const ESTACIONES: Estacion[] = [
  // Abastecer: llega, se recibe, se guarda. Con la mercancía llega la factura de compra.
  { id: "muelle", piso: "abastecer", x: 0.06, nombre: "Muelle", hace: "Llega la materia prima del proveedor", externo: "Proveedor", prop: "camion" },
  { id: "recepcion", piso: "abastecer", x: 0.34, nombre: "Recepción", hace: "Se cuenta y se revisa lo que llegó contra la compra", funcion: "compras", prop: "mesa" },
  { id: "bodega", piso: "abastecer", x: 0.62, nombre: "Bodega", hace: "Se guardan los insumos", funcion: "compras", prop: "estante" },
  // Preparar: dosificar, empacar y sellar, fecha y lote, etiqueta, almacén de producto terminado.
  { id: "dosificacion", piso: "preparar", x: 0.1, nombre: "Dosificar", hace: "Se pesa y se envasa por presentación", funcion: "envasar", prop: "bascula" },
  { id: "empaque", piso: "preparar", x: 0.32, nombre: "Empacar", hace: "Se empaca y se sella", funcion: "empacar", prop: "selladora" },
  { id: "lote", piso: "preparar", x: 0.52, nombre: "Lote", hace: "Se marca fecha y lote", funcion: "lote", prop: "sello" },
  { id: "etiquetado", piso: "preparar", x: 0.71, nombre: "Etiquetar", hace: "Se imprime y se pega la etiqueta del producto", funcion: "imprimir_et", prop: "impresora" },
  { id: "almacen", piso: "preparar", x: 0.9, nombre: "Almacén", hace: "Producto terminado, listo para vender", funcion: "compras", prop: "almacen" },
  // Publicar: foto y publicación.
  { id: "estudio", piso: "publicar", x: 0.3, nombre: "Foto", hace: "Se fotografía el producto", funcion: "publica", prop: "camara" },
  { id: "publicacion", piso: "publicar", x: 0.7, nombre: "Publicar", hace: "Se publica en Mercado Libre y en la web", funcion: "publica", prop: "pantalla" },
  // Vender: llegan los pedidos y las preguntas.
  { id: "pedidos", piso: "vender", x: 0.35, nombre: "Pedidos", hace: "Llegan los pedidos (MeLi, web, WhatsApp)", funcion: "clientes", prop: "telefono" },
  { id: "preguntas", piso: "vender", x: 0.72, nombre: "Preguntas", hace: "Preventa y postventa de MeLi", funcion: "meli_qa", prop: "pantalla" },
  // Entregar: alistar, embalar, guía, transportadora.
  { id: "alistamiento", piso: "entregar", x: 0.1, nombre: "Alistar", hace: "Se saca el producto del pedido y se verifica", funcion: "alistar", prop: "canasta" },
  { id: "embalaje", piso: "entregar", x: 0.33, nombre: "Embalar", hace: "Se arma la caja del envío", funcion: "embalar", prop: "cajas" },
  { id: "guia", piso: "entregar", x: 0.56, nombre: "Guía", hace: "Se imprime y se pega la guía de envío", funcion: "guias", prop: "termica" },
  { id: "transportadora", piso: "entregar", x: 0.85, nombre: "Transporte", hace: "Se entrega el paquete a la transportadora", funcion: "envio", prop: "camion" },
  // Facturar y pagar.
  { id: "factura", piso: "facturar", x: 0.18, nombre: "Factura", hace: "Se emite la factura de venta al entregar", funcion: "facturar", prop: "impresora" },
  { id: "solicitud", piso: "facturar", x: 0.5, nombre: "Solicitud", hace: "Con la factura de compra se monta la solicitud de pago", funcion: "sol_pago", prop: "escritorio" },
  { id: "aprobacion", piso: "facturar", x: 0.8, nombre: "Aprobar", hace: "Se aprueba el pago al proveedor", funcion: "aprobar", prop: "sello" },
  // Contar y dirigir.
  { id: "libro", piso: "contar", x: 0.45, nombre: "Libro Mayor", hace: "Se registran compras, pagos y ventas; impuestos", funcion: "contab", prop: "libro" },
  { id: "analisis", piso: "dirigir", x: 0.55, nombre: "Análisis", hace: "Rentabilidad y salud del negocio", funcion: "analisis", prop: "grafica" },
];

export type Paso = { de: string; a: string; carga: Carga; etiqueta?: string; accion: string };

/** El recorrido, en orden: lo que hace el negocio un día, de la llegada del proveedor al informe. */
export const RECORRIDO: Paso[] = [
  { de: "muelle", a: "recepcion", carga: "materia", etiqueta: "materia prima", accion: "Cuenta y revisa" },
  { de: "recepcion", a: "bodega", carga: "materia", accion: "Guarda en bodega" },
  { de: "recepcion", a: "solicitud", carga: "doc", etiqueta: "factura de compra", accion: "Monta la solicitud de pago" },
  { de: "solicitud", a: "aprobacion", carga: "doc", etiqueta: "solicitud", accion: "Aprueba el pago" },
  { de: "aprobacion", a: "libro", carga: "doc", etiqueta: "pago", accion: "Registra el pago" },
  { de: "bodega", a: "dosificacion", carga: "materia", accion: "Pesa y envasa" },
  { de: "dosificacion", a: "empaque", carga: "bolsa", accion: "Empaca y sella" },
  { de: "empaque", a: "lote", carga: "bolsa", accion: "Marca fecha y lote" },
  { de: "lote", a: "etiquetado", carga: "bolsa", accion: "Pega la etiqueta" },
  { de: "etiquetado", a: "almacen", carga: "producto", accion: "Al almacén" },
  { de: "almacen", a: "estudio", carga: "producto", etiqueta: "muestra", accion: "Toma las fotos" },
  { de: "estudio", a: "publicacion", carga: "doc", etiqueta: "fotos", accion: "Publica en MeLi y web" },
  { de: "pedidos", a: "alistamiento", carga: "doc", etiqueta: "pedido", accion: "Recibe el pedido" },
  { de: "almacen", a: "alistamiento", carga: "producto", accion: "Alista y verifica" },
  { de: "alistamiento", a: "embalaje", carga: "producto", accion: "Embala" },
  { de: "embalaje", a: "guia", carga: "paquete", accion: "Imprime y pega la guía" },
  { de: "guia", a: "transportadora", carga: "guia", etiqueta: "con guía", accion: "Entrega al transportador" },
  { de: "transportadora", a: "factura", carga: "doc", etiqueta: "entregado", accion: "Emite la factura de venta" },
  { de: "factura", a: "libro", carga: "doc", etiqueta: "factura de venta", accion: "Registra la venta y el IVA" },
  { de: "libro", a: "analisis", carga: "doc", etiqueta: "informe", accion: "Revisa la rentabilidad" },
];
