/**
 * /api/empresa-viva/estado de EJEMPLO para el banco de pruebas (nombres inventados, como el
 * resto del banco). Cambia cada 10 s en un ciclo de 4 fotos para ver las transiciones del
 * juego: llega un cliente, alguien responde, se alista un paquete, sale el camión, el
 * proveedor descarga y se registra.
 */
const P = (id: number, nombre: string) => ({ id, nombre });
import CASAS from "../../app/data/empresa_viva_casas.json";

export function estadoEmpresaEjemplo(yo: number) {
  const paso = Math.floor(Date.now() / 10_000) % 4;
  const base = Math.floor(Date.now() / 40_000) * 100; // seq crece de ciclo en ciclo
  const ahora = Date.now() / 1000;
  const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString().slice(0, 19);

  // El equipo del barrio (app/data/empresa_viva_casas.json); el ciclo los mueve de lugar.
  const personas = [
    { id: yo, nombre: "Armando García", username: "armando", en_linea: true, panel: "empresa-viva", via: "panel",
      avatar: { avatar: "character-male-e", accesorio: "aid-sunglasses", color: "#FFE14D" },
      funciones: ["Aprueba pagos", "Lleva el Libro Mayor y los impuestos", "Cotiza y monta solicitudes de pago"] },
    { id: 6, nombre: "Cynthia Ruiz", username: "@cynthia", en_linea: paso !== 0, panel: "etiquetas", via: "panel" },
    { id: 7, nombre: "Victor García", username: "vitor", en_linea: false, panel: "", via: "", presente: true,
      tarea: { funcion: "almuerzo", hace: "Hace el almuerzo del equipo", titulo: "", ticket_id: 0, desde: "" } },
    { id: 9, nombre: "Stella", username: "stella", en_linea: false, panel: "", via: "", presente: true,
      tarea: { funcion: "empacar", hace: "Empaca, sella y etiqueta producto", titulo: "Empacar y etiquetar productos", ticket_id: 0, desde: "" } },
    { id: 10, nombre: "Jenniffer García", username: "jerry", en_linea: true, panel: "facturacion", via: "panel", presente: true,
      tarea: paso % 2 ? { funcion: "alistar", hace: "Alista los envíos de Colecta y Flex", titulo: "ALISTAR ENVIOS", ticket_id: 0, desde: "" } : null,
      avatar: { avatar: "character-female-c", accesorio: "aid-glasses", color: "" },
      funciones: ["Factura y resuelve facturas pendientes", "Atiende clientes por WhatsApp y chat web", "Alista los envíos de Colecta y Flex"] },
  ];
  const v = (id: string, tipo: "preventa" | "whatsapp", min: number, producto: string, texto: string) =>
    ({ id, tipo, desde: hace(min), producto, texto, panel: tipo === "preventa" ? "preventa" : "whatsapp", puede: true });
  const visitantes = [
    ...(paso < 1 ? [v("q101", "preventa", 25, "Ácido hialurónico 50 g", "¿Sirve para sérum facial?")] : []),
    v("q102", "preventa", 12, "Glicerina USP 1 L", "¿Hacen envíos a Medellín?"),
    ...(paso < 2 ? [v("w555", "whatsapp", 4, "", "Hola, ¿tienen manteca de karité?")] : []),
    ...(paso >= 1 ? [v("q103", "preventa", 1, "Aceite de argán 50 mL", "¿Es puro o mezclado?")] : []),
  ];
  const k = (id: string, canal: string, estado: string, min: number, producto: string, por?: ReturnType<typeof P>) =>
    ({ id, canal, flex: canal === "meli", estado, desde: hace(min), unidades: 1, producto, lugar: "Chapinero",
       alistado_por: por ?? null, panel: "empaque", puede: true });
  const paquetes = [
    k("m1", "meli", paso >= 1 ? (paso >= 3 ? "en_ruta" : "alistado") : "por_alistar", 90, "Urea 1 kg", paso >= 1 ? P(10, "Jenniffer García") : undefined),
    k("m2", "meli", "por_alistar", 70, "Bicarbonato 500 g"),
    k("m3", "meli", paso >= 3 ? "en_ruta" : "alistado", 120, "Vitamina C 100 g", P(10, "Jenniffer García")),
    k("w1", "web", "por_alistar", 50, "Aceite de ricino 500 mL"),
    k("w2", "web", "por_alistar", 30, "Ácido láctico 30 mL"),
    k("m4", "meli", "por_alistar", 20, "Creatina 500 g"),
    ...(paso >= 2 ? [k("m5", "meli", "por_alistar", 1, "Goji 500 g")] : []),
    k("m6", "meli", "en_ruta", 300, "Coco virgen 1 kg"),
  ];
  const proveedores = paso >= 3 ? [] : [{
    id: "r9", estado: "descargando", proveedor: "Proveedor de ejemplo", items: 4, recibe: P(7, "Victor García"),
    desde: hace(15), panel: "recepcion-mercancia", puede: true,
  }];
  const ev = (seq: number, tipo: string, objeto: string, por: ReturnType<typeof P> | { id: number; nombre: string; bot: boolean } | null) =>
    ({ seq: base + seq, ts: ahora - 30, tipo, objeto, por });
  const eventos = [
    ...(paso >= 1 ? [ev(1, "atendido", "q101", P(10, "Jenniffer García")), ev(2, "alistado", "m1", P(10, "Jenniffer García"))] : []),
    ...(paso >= 2 ? [ev(3, "atendido", "w555", { id: 0, nombre: "Hugo", bot: true })] : []),
    ...(paso >= 3 ? [ev(4, "salio", "m1", null), ev(5, "salio", "m3", null), ev(6, "registrado", "r9", P(7, "Victor García"))] : []),
  ];
  // Quién le habla a quién: una pregunta, su respuesta y una idea en un grupo, una por foto.
  const inter = [
    ...(paso >= 1 ? [{ id: `t${base + 1}`, tipo: "pregunta", de: yo, para: [10], ts: ahora - 5, texto: "¿Ya salió la factura de la Glicerina?", ticket_id: 1 }] : []),
    ...(paso >= 2 ? [{ id: `r${base + 2}`, tipo: "respuesta", de: 10, para: [yo], ts: ahora - 3, texto: "Sí, la FE-1234 ya está en Alegra", ticket_id: 1 }] : []),
    ...(paso >= 3 ? [{ id: `m${base + 3}`, tipo: "idea", de: 6, para: [yo, 10], ts: ahora - 2, texto: "Idea: kit de bálsamo labial con envase y etiqueta", canal: "HORMIGUITAS DE MCKENNA", canal_id: 8 }] : []),
  ];
  const it = (etapa: string, n: number, texto: string, panel: string, severidad = "alta") => ({ etapa, id: `${etapa}-${panel}`, n, texto, panel, severidad });
  const grupo = (...xs: ReturnType<typeof it>[]) => ({ alta: 0, media: 0, items: xs });
  return {
    yo, personas, casas: CASAS, visitantes, visitantes_mas: 0, paquetes, paquetes_mas: 0, proveedores,
    bodega: { publicaciones: 494, agotados: 133, criticos: 38, panel: "control-inventario", por_reponer: [
      { sku: "C-ACELIN250mL", nombre: "Aceite de linaza orgánico 250 mL", estado: "agotado", stock: 0 },
      { sku: "C-GLIC1L", nombre: "Glicerina USP 1 L", estado: "critico", stock: 2 },
      { sku: "C-UREA1kg", nombre: "Urea 1 kg", estado: "critico", stock: 3 },
    ] },
    oficina: {
      preparar: grupo(it("preparar", 12, "productos que se venden sin etiqueta", "etiquetas")),
      publicar: grupo(it("publicar", 10, "SKU que no se facturan", "canales-producto", "media")),
      abastecer: grupo(it("abastecer", 3, "solicitudes de pago esperando aprobación", "pagos")),
      facturar: grupo(it("facturar", 21, "ventas de MeLi pendientes de facturar", "facturacion")),
      contar: grupo(it("contar", 117, "movimientos del banco sin clasificar", "libro-mayor", "media")),
    },
    eventos, interacciones: inter, sin_senal: [],
    acciones: [
      ...(paso >= 1 ? [{ id: `a${base + 1}`, tipo: "comento", de: 6, ts: ahora - 4, ticket_id: 1, titulo: "Etiqueta jabón potásico" }] : []),
      ...(paso >= 2 ? [{ id: `a${base + 2}`, tipo: "resolvio", de: 10, ts: ahora - 2, ticket_id: 2, titulo: "Factura de la glicerina" }] : []),
    ], generado: new Date().toISOString().slice(0, 19),
  };
}
