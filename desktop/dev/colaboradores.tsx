/**
 * Banco de pruebas del tablero de Colaboradores — SOLO `npm run dev`.
 *
 * Monta el ColaboradoresPanel real con un diagrama de EJEMPLO (datos
 * inventados) y SIN backend: `fetch` queda interceptado, así que guardar,
 * votar o subir fotos nunca llega a producción (a diferencia de los otros
 * bancos de dev/, que sí llaman a la API). No entra al build.
 *
 *   /app/dev/colaboradores.html
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../src/index.css";
import ColaboradoresPanel from "../src/components/ColaboradoresPanel";
import { etapaObra } from "../src/components/colaboradores/obra";

const COP = (monto: number) => ({ monto, moneda: "COP" });

// La operación de ejemplo (el servidor la arma igual: colaboradores.operacion_de).
type Parte = { id: string; nombre: string; para: string; monto: number };
type OpEj = Record<string, unknown> & {
  items: Record<string, { fase: string; unidades: number }>;
  ventas: { id: string; nodo: string; cantidad: number; fecha: string; reparto: Record<string, unknown> }[];
  resultados: Record<string, string>; bitacora: { fecha: string; quien: string; texto: string }[];
  reparto: { reglas: { id: string; nombre: string; base: string; pct: number; para: string }[]; boveda: string };
};
const operacion: OpEj = {
  edificio: { pisos: [
    { id: "mercado", nombre: "Mercado externo", color: "#5F574F", habitaciones: [{ id: "proveedores", nombre: "Proveedores" }] },
    { id: "compras", nombre: "Compras y logística", color: "#FFA300", habitaciones: [{ id: "bodega", nombre: "Bodega de insumos" }, { id: "taller", nombre: "Taller de ensamblaje" }] },
    { id: "hub", nombre: "Hub · McKenna Group S.A.S.", color: "#1D2B53", habitaciones: [{ id: "boveda", nombre: "Bóveda e inventario" }, { id: "sala", nombre: "Sala común" }] },
    { id: "mesa", nombre: "Mesa de guerra", color: "#7E2553", habitaciones: [{ id: "decisiones", nombre: "Sala de decisiones" }] },
    { id: "orquestacion", nombre: "Orquestación y ventas", color: "#29ADFF", habitaciones: [{ id: "estudio", nombre: "Estudio de diseño" }, { id: "sistemas", nombre: "Sala de sistemas" }] },
    { id: "cliente", nombre: "Cliente final", color: "#FFEC27", habitaciones: [{ id: "tienda", nombre: "Tienda" }] },
  ] },
  ente: { nombre: "McKenna Group S.A.S.", campos: [{ nombre: "Colchón para imprevistos", valor: "10 %" }] },
  avatares: [
    { id: "sebastian", nombre: "Sebastián García", rol: "Compras y ensamblaje", skills: ["negociación", "compra", "ensamblaje"],
      piso: "compras", color: "#b45309", carril: "sebastian", usuario_id: 20 },
    { id: "armando", nombre: "Armando García", rol: "Orquestación y ventas", skills: ["orquestación", "e-commerce", "diseño", "sistemas"],
      piso: "orquestacion", color: "#1d4ed8", carril: "armando", usuario_id: 8 },
  ],
  reparto: { boveda: "Bóveda", reglas: [
    { id: "insumos", nombre: "Insumos", base: "costo", pct: 100, para: "sebastian" },
    { id: "ens", nombre: "Ensamblaje", base: "costo", pct: 10, para: "sebastian" },
    { id: "serv", nombre: "Servicios", base: "venta", pct: 15, para: "armando" }] },
  items: {}, ventas: [], resultados: {}, bitacora: [],
};

let diagrama = {
  id: 1, titulo: "Collares — proyecto de ejemplo", descripcion: "", version: 1, archivado: 0,
  actualizado_en: "2026-09-25 10:00:00", actualizado_por: 20, actualizado_por_nombre: "Sebastián García",
  turno_actual: null, colaborador_id: 20, participantes: { "8": "Armando García", "20": "Sebastián García" },
  nodos: 7, flechas: 5,
  doc: {
    nodes: [
      { id: "s1", label: "Comprar materiales", tipo: "accion", carril: "sebastian", x: -520, y: -140,
        tiempo_min: 120, costo: COP(85000), adjuntos: [{ id: "1-factura.pdf", nombre: "Factura aros", tipo: "pdf" }] },
      { id: "s2", label: "Fabricación de los collares", tipo: "accion", carril: "sebastian", x: -520, y: 60,
        tiempo_min: 300, datos: [{ campo: "lote", valor: "20 collares" }],
        consecuencias: [{ si: "se acaban los aros", entonces: "se para el lote", medida: "comprar 20 % de más" }] },
      { id: "c1", label: "¿Bolsa o caja?", tipo: "consenso", carril: "conjunto", x: -520, y: 280,
        asunto: "¿Qué empaque usamos para el collar M?", skill: "negociación",
        propuestas: [{ id: "p8", autor: 8, texto: "Bolsa kraft con visor" }, { id: "p20", autor: 20, texto: "Caja de cartón pequeña" }],
        votos: { "8": "p8" } },
      { id: "p1", label: "Collar de cadena M", tipo: "producto", carril: "conjunto", x: -80, y: -60,
        imagen: "1-foto.jpg", sku: "C-COLLAR-M", precio: COP(45000), url: "https://tienda.ejemplo.co/collar-m",
        empaque: { nombre: "Bolsa kraft", costo: COP(800) },
        componentes: [{ nombre: "Aros 6 mm", sku: "INS-ARO6", cantidad: "40 un", costo: COP(6000), proveedor: "v1" },
                      { nombre: "Hebilla", sku: "INS-HEB", cantidad: "1 un", costo: COP(2500), proveedor: "v2" },
                      { nombre: "Termoencogible", cantidad: "10 cm", costo: COP(300) }] },
      { id: "v1", label: "Bisutería El Centro", tipo: "proveedor", carril: "conjunto", x: -520, y: 520,
        entrega_dias: 2, fiabilidad: 4, componentes: [{ nombre: "Aros 6 mm", sku: "INS-ARO6", costo: COP(150) }] },
      { id: "v2", label: "Importadora Hebillas", tipo: "proveedor", carril: "conjunto", x: -80, y: 560,
        entrega_dias: 9, fiabilidad: 2, componentes: [{ nombre: "Hebilla", sku: "INS-HEB", costo: COP(2500) }] },
      { id: "cl", label: "Clientes de Instagram", tipo: "externo", carril: "conjunto", x: 380, y: 420 },
      { id: "r1", label: "Collar ajustable acero", tipo: "competencia", carril: "conjunto", x: 380, y: -160,
        imagen: "1-rival.jpg", plataforma: "Instagram", precio: COP(52000), url: "https://instagram.com/ejemplo",
        datos: [{ campo: "envío", valor: "gratis" }] },
      { id: "r2", label: "Cadena de ahogo", tipo: "competencia", carril: "conjunto", x: 380, y: 200,
        plataforma: "Marketplace", precio: COP(38000) },
      { id: "m1", label: "Registrar la venta", tipo: "dinero", carril: "mckenna", x: -80, y: 360, costo: COP(12000), tiempo_min: 20 },
    ],
    edges: [
      { id: "e1", from: "s1", to: "s2", label: "materiales", portador: "sebastian", fromLado: "b", toLado: "t", forma: "recta" },
      { id: "e2", from: "s2", to: "m1", label: "collares", portador: "sebastian", fromLado: "r", toLado: "l", forma: "recta" },
      { id: "e3", from: "c1", to: "p1", label: "define el empaque", fromLado: "r", toLado: "b", forma: "recta" },
      { id: "e4", from: "p1", to: "r1", label: "vs", fromLado: "r", toLado: "l", forma: "recta", color: "#b91c1c" },
      { id: "e5", from: "p1", to: "r2", label: "vs", fromLado: "r", toLado: "l", forma: "recta", color: "#b91c1c" },
    ],
  },
};

/** Una «foto» dibujada: eslabones de cadena alrededor del centro. */
function fotoEjemplo(tono: string): string {
  const eslabones = Array.from({ length: 14 }, (_, i) => {
    const a = (i / 14) * Math.PI * 2;
    const x = 200 + Math.cos(a) * 120, y = 200 + Math.sin(a) * 120;
    return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="26" ry="15" transform="rotate(${(a * 180 / Math.PI + 90).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="${tono}"/>`
    + `<g fill="none" stroke="#52606d" stroke-width="10">${eslabones}</g></svg>`;
}

// Tablero (colab_tablero.py): unas tarjetas de ejemplo y un ritmo inventado.
type TarjetaDev = Record<string, unknown> & { id: number };
const ahoraMenos = (h: number) => new Date(Date.now() - h * 3600e3).toISOString().slice(0, 19).replace("T", " ");
let tarjetas: TarjetaDev[] = [
  { tipo: "origen", titulo: "Armando ya había hecho collares de aros para su perro", texto: "Aros de acero comprados por millar; el broche fue el punto débil.", fecha_hecho: "2026-08-15" },
  { tipo: "meta", titulo: "Validar el collar persa con ventas reales", texto: "Primeras ventas con margen conocido para los dos.", acuerdos: { "8": ahoraMenos(30) } },
  { tipo: "rol", titulo: "Sebastián fabrica y envía", texto: "Teje, empaca en bolsa y despacha con la guía que le llega." },
  { tipo: "rol", titulo: "Armando publica y vende", texto: "Fotos, publicación y cobro; cobra comisión por venta." },
  { tipo: "obstaculo", titulo: "El broche se abre con un tirón fuerte", texto: "Por ahora se vende como decorativo.", turno_de: 20, turno_desde: ahoraMenos(50), adjuntos: [{ id: "1-foto.jpg", tipo: "imagen", nombre: "broche" }] },
  { tipo: "obstaculo", titulo: "¿Cuánto tarda un collar?", texto: "Falta medirlo con cronómetro.", turno_de: 20, turno_desde: ahoraMenos(6 * 24) },
  { tipo: "obstaculo", titulo: "Compró los aros grandes en vez de los de 16 mm", estado: "hecho" },
  { tipo: "decision", titulo: "Talla L a $75.000", turno_de: 8, turno_desde: ahoraMenos(3), acuerdos: { "20": ahoraMenos(2) } },
  { tipo: "tarea", titulo: "Enviar el collar de la primera venta", turno_de: 20, turno_desde: ahoraMenos(1), fecha_hecho: "2026-10-03" },
  { tipo: "resultado", titulo: "Persa aprobado: «esa era»", fecha_hecho: "2026-09-14", fuente: { canal: "whatsapp", autor: "Tú", fecha: "2026-09-14 13:27:35", texto: "ahi si ya es otra cosa, esa era" } },
  { tipo: "resultado", titulo: "Primera venta", fecha_hecho: "2026-10-03", adjuntos: [{ id: "1-foto2.jpg", tipo: "imagen", nombre: "venta" }] },
  { tipo: "acuerdo", titulo: "Medida: el collar 1 cm menos que el cuello", texto: "Cuello 48 cm → collar 47 cm.", acuerdos: { "8": ahoraMenos(9), "20": ahoraMenos(8) } },
  { tipo: "idea", titulo: "Chapa de aluminio con el nombre del perro", turno_de: 8, turno_desde: ahoraMenos(20) },
].map((t, i) => ({ texto: "", porque: "", estado: "abierto", turno_de: null, turno_desde: null, fecha_hecho: null, fuente: null,
                   adjuntos: [], enlaces: [], acuerdos: {}, creado_por: i % 2 ? 20 : 8, creado_en: ahoraMenos(48 - i),
                   actualizado_por: 8, actualizado_en: ahoraMenos(48 - i), ...t, id: i + 1 }));
// Linaje del cladograma (ids 1..13 en el orden de arriba) y una rama «Proceso» que viene del edificio.
const PADRES: Record<number, number | null> = { 1: null, 2: null, 3: 2, 4: 2, 10: 1, 7: 10, 6: 10, 5: 10, 8: 5, 12: 10, 11: 12, 9: 11, 13: 5 };
tarjetas = tarjetas.map((t) => ({ ...t, padre_id: PADRES[t.id] ?? null }));
tarjetas.push(
  { id: 20, padre_id: null, tipo: "paso", titulo: "Proceso (lo que estaba en el edificio)", texto: "", porque: "", estado: "abierto", turno_de: null, turno_desde: null, fecha_hecho: null, fuente: null, adjuntos: [], enlaces: [], acuerdos: {}, creado_por: 8, creado_en: ahoraMenos(1), actualizado_por: 8, actualizado_en: ahoraMenos(1) },
  ...["Comprar materiales", "Preparar alicates", "Tejer el collar", "Revisar y empacar"].map((titulo, i) => (
    { id: 21 + i, padre_id: 20, tipo: "paso", titulo, texto: "", porque: "", estado: "abierto", turno_de: null, turno_desde: null, fecha_hecho: null,
      fuente: { canal: "edificio", autor: "Sebastián García", fecha: "", texto: `caja ${i}` }, adjuntos: [], enlaces: [], acuerdos: {},
      creado_por: 8, creado_en: ahoraMenos(1), actualizado_por: 8, actualizado_en: ahoraMenos(1) })));
const ritmoDev = {
  app: {
    "8": { nombre: "Armando García", en_ver: { n: 6, mediana_min: 95 }, en_responder: { n: 6, mediana_min: 12 }, total: { n: 6 },
           esperando_desde: ahoraMenos(3), visto_pendiente: false, espera_min: 180 },
    "20": { nombre: "Sebastián García", en_ver: { n: 5, mediana_min: 8 }, en_responder: { n: 5, mediana_min: 4 }, total: { n: 5 },
            esperando_desde: null, visto_pendiente: false, espera_min: null },
  },
  chat: { desde: "2026-08-07", hasta: "2026-10-03", mensajes: 1464, personas: {
    "8": { n: 217, mediana_min: 0.9, p75_min: 53.5, p90_min: 551.5, mas_de_12_h: 17 },
    "20": { n: 217, mediana_min: 0.7, p75_min: 6, p90_min: 36.6, mas_de_12_h: 3 } } },
};

const miembrosDev = [{ id: 8, nombre: "Armando García", rol: "dueno" }, { id: 20, nombre: "Sebastián García", rol: "miembro" }];

const fetchReal = window.fetch.bind(window);
// Simulador de precios: collar L (con el costo de Sebastián) y M (sin costo todavía).
const basePrecio = { plataforma: "Vitrina", nota: "", comision_pct: 15, iva_pct: 19, iva_modo: "encima", otros_mckenna: 0,
                     merma_pct: 0, meta_mckenna: 5000, meta_colaborador: 0, proveedor_id: 20, acuerdos: {}, actualizado_por: 8 };
let preciosDev = [
  { ...basePrecio, id: 1, nombre: "Collar cadena persa L", sku: "C-COLPERGRAND", precio_publicacion: 58500, envio: 4300, precio_compra: 29310,
    merma_pct: 5, costos: [{ nombre: "Aros", monto: 12727 }, { nombre: "Mano de obra", monto: 10000 }, { nombre: "Empaque", monto: 3000 },
                           { nombre: "Hebilla", monto: 2500 }, { nombre: "Termoencogible", monto: 833 }], actualizado_en: "2026-10-04 18:00:00" },
  { ...basePrecio, id: 2, nombre: "Collar cadena persa M", sku: "C-COLPERSPEQUE", precio_publicacion: 55000, envio: 8200, precio_compra: 21893,
    costos: [], acuerdos: { "20": "2026-10-04 18:00:00" }, actualizado_en: "2026-10-04 18:00:00" },
];

window.fetch = async (entrada: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
  const ruta = new URL(url, location.origin).pathname.replace(/^\/app(?=\/api\/)/, "");
  const metodo = (init?.method ?? (entrada instanceof Request ? entrada.method : "GET")).toUpperCase();
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  if (!ruta.startsWith("/api/")) return fetchReal(entrada, init);            // assets de Vite y fuentes

  const media = ruta.match(/\/media\/([^/]+)$/);
  if (media) {
    if (media[1].endsWith(".pdf")) return new Response(new Blob(["%PDF-1.4 ejemplo"], { type: "application/pdf" }));
    const tono = media[1].includes("rival") ? "#f6d7dd" : "#dfe9f1";
    return new Response(new Blob([fotoEjemplo(tono)], { type: "image/svg+xml" }));
  }
  if (ruta === "/api/colaboradores/diagramas" && metodo === "GET") {
    const { doc, ...resumen } = diagrama;
    // La obra la calcula el servidor (colaboradores.resumen_obra); aquí, la misma regla del panel.
    const etapas = doc.nodes.map((n) => etapaObra(n));
    const obra = { pisos: etapas.length, terminados: etapas.filter((e) => e === 4).length,
                   avance: etapas.reduce((a, e) => a + e, 0) / (4 * etapas.length) };
    // Dos proyectos más, solo para ver la calle: uno terminado y uno recién empezado (no se abren).
    const otro = (id: number, titulo: string, pisos: number, terminados: number) => ({
      ...resumen, id, titulo, nodos: pisos, obra: { pisos, terminados, avance: pisos ? terminados / pisos : 0 } });
    return json({ diagramas: [{ ...resumen, obra }, otro(2, "Aretes — ya en venta", 5, 5), otro(3, "Pulseras de hilo", 12, 1)],
                  yo: { id: 8, nombre: "Armando García", anfitrion: true } });
  }
  if (ruta === "/api/colaboradores/diagramas/1") {
    if (metodo === "PUT") {
      const b = JSON.parse(String(init?.body ?? "{}"));
      diagrama = { ...diagrama, doc: b.doc, titulo: b.titulo ?? diagrama.titulo, version: diagrama.version + 1 };
    }
    return json({ ...diagrama, operacion, dharma: {} });
  }
  if (ruta.endsWith("/miembros")) {
    if (metodo === "POST") miembrosDev.push({ id: 7, nombre: "Victor Garcia", rol: "miembro" });
    return json({ miembros: miembrosDev, soy_dueno: true, acceso_dado: true });
  }
  if (ruta === "/api/colaboradores/usuarios") {
    return json({ usuarios: [{ id: 7, nombre: "Victor Garcia", externo: false }, { id: 10, nombre: "Jenniffer Garcia", externo: false },
                             { id: 20, nombre: "Sebastián García", externo: true }] });
  }
  // Simulador de precios (colab_precios.py): los dos collares del 4-oct-2026.
  if (ruta.endsWith("/precios") || /\/precios\/\d+(\/acuerdo)?$/.test(ruta)) {
    const pm = ruta.match(/\/precios\/(\d+)(\/acuerdo)?$/);
    if (pm && metodo === "PATCH") {
      const b = JSON.parse(String(init?.body ?? "{}"));
      preciosDev = preciosDev.map((x) => (x.id === Number(pm[1]) ? { ...x, ...b, acuerdos: {}, actualizado_en: ahoraMenos(0) } : x));
    }
    if (pm && pm[2]) {
      preciosDev = preciosDev.map((x) => (x.id === Number(pm[1]) ? { ...x, acuerdos: { ...x.acuerdos, "8": ahoraMenos(0) } } : x));
      return json(preciosDev.find((x) => x.id === Number(pm[1])));
    }
    return json({ productos: preciosDev, proveedor_defecto: 20, participantes: { "8": "Armando García", "20": "Sebastián García" },
                  cambios: [{ id: 1, precio_id: 1, usuario_id: 8, campo: "precio de compra", antes: "35.425", despues: "29.310", en: ahoraMenos(30) }] });
  }
  if (ruta.endsWith("/tablero")) {
    return json({ tarjetas, ritmo: ritmoDev, participantes: { "8": "Armando García", "20": "Sebastián García" } });
  }
  if (ruta.endsWith("/tablero/visto")) return json({ registrado: false });
  if (ruta.endsWith("/tarjetas") && metodo === "POST") {
    const b = JSON.parse(String(init?.body ?? "{}"));
    const t = { texto: "", porque: "", estado: "abierto", adjuntos: [], enlaces: [], acuerdos: {}, creado_por: 8,
                creado_en: ahoraMenos(0), actualizado_por: 8, actualizado_en: ahoraMenos(0), ...b, id: tarjetas.length + 100 };
    tarjetas = [...tarjetas, t];
    return json(t, 201);
  }
  const tj = ruta.match(/\/tarjetas\/(\d+)(\/acuerdo)?$/);
  if (tj) {
    const id = Number(tj[1]);
    if (metodo === "DELETE") { tarjetas = tarjetas.filter((t) => t.id !== id); return json({ ok: true }); }
    const b = JSON.parse(String(init?.body ?? "{}"));
    tarjetas = tarjetas.map((t) => t.id !== id ? t : tj[2]
      ? { ...t, acuerdos: { ...(t.acuerdos as object), "8": b.de_acuerdo ? ahoraMenos(0) : undefined } }
      : { ...t, ...b, actualizado_en: ahoraMenos(0) });
    return json(tarjetas.find((t) => t.id === id));
  }
  if (ruta.endsWith("/chat")) {
    const mensajes = [
      { i: 0, fecha: "2026-09-17 10:59:33", autor: "Tú", texto: "Respecto a lo del producto bajese de la nube, aterrice" },
      { i: 1, fecha: "2026-09-17 10:59:37", autor: "Tú", texto: "Un producto solo uno" },
      { i: 2, fecha: "2026-09-17 11:02:25", autor: "Sebastian 🤓", texto: "Pues terminados ya tengo 4" },
      { i: 3, fecha: "2026-09-17 11:07:06", autor: "Tú", texto: "Solo uno y miramos. Muéstreme el primero ya con el broche solucionado y de una lo publicamos" },
      { i: 4, fecha: "2026-09-17 11:15:59", autor: "Sebastian 🤓", texto: "<video omitido>" },
    ];
    return json({ mensajes, autores: { "Tú": 8, "Sebastian 🤓": 20 }, nombres: ["Sebastian 🤓", "Tú"], ritmo: ritmoDev.chat });
  }
  if (ruta.endsWith("/consenso")) return json(diagrama);                     // sin lógica: solo no romper
  // Operación: imitación mínima de colaboradores.accion_operacion (la lógica real tiene sus pruebas en Python).
  if (ruta.endsWith("/operacion")) {
    const b = JSON.parse(String(init?.body ?? "{}"));
    const dt = b.datos ?? {};
    const n = diagrama.doc.nodes.find((x) => x.id === dt.nodo) as (typeof diagrama.doc.nodes)[number] | undefined;
    const it = (operacion.items[dt.nodo] ??= { fase: "sourcing", unidades: 0 });
    const anotar = (t: string) => operacion.bitacora.push({ fecha: "2026-09-26 10:00", quien: "Armando García", texto: t });
    if (b.accion === "comprar") { if (it.fase === "sourcing") it.fase = "ensamblado"; anotar(`compró los insumos de «${n?.label}»`); }
    if (b.accion === "craftear") { it.unidades += Number(dt.cantidad || 1); if (it.fase === "ensamblado") it.fase = "en_mckenna"; anotar(`ensambló ${dt.cantidad} × «${n?.label}»`); }
    if (b.accion === "publicar") { it.fase = "publicado"; anotar(`publicó «${n?.label}»`); }
    if (b.accion === "vender") {
      const cant = Number(dt.cantidad || 1);
      if (cant > it.unidades) return json({ error: `En la bóveda hay ${it.unidades} unidades` }, 400);
      const precio = dt.precio?.monto ?? 45000;
      const costoU = 6000 + 2500 + 300 + 800;
      const total = precio * cant, costo = costoU * cant;
      const partes: Parte[] = operacion.reparto.reglas.map((rg) => ({ id: rg.id, nombre: rg.nombre, para: rg.para,
        monto: (rg.base === "costo" ? costo : total) * rg.pct / 100 }));
      it.unidades -= cant;
      operacion.ventas.push({ id: String(operacion.ventas.length), nodo: dt.nodo, cantidad: cant, fecha: "2026-09-26 10:00",
        reparto: { moneda: "COP", total, costo, partes, boveda_nombre: operacion.reparto.boveda,
                   boveda: total - partes.filter((p) => p.para !== "boveda").reduce((a, p) => a + p.monto, 0), sin_sumar: [] } });
      anotar(`¡vendió ${cant} × «${n?.label}»!`);
    }
    if (b.accion === "resultado") operacion.resultados[dt.nodo] = dt.valor;
    if (b.accion === "edificio") operacion.edificio = dt.edificio;
    if (b.accion === "reglas") Object.assign(operacion, { ente: dt.ente, avatares: dt.avatares, reparto: dt.reparto });
    diagrama = { ...diagrama, version: diagrama.version + 1 };
    return json({ ...diagrama, operacion, dharma: {} });
  }
  return json({ error: "Banco de pruebas: esta ruta no tiene backend" }, 404);
};

// Para capturas sin clics (Chrome headless): ?abrir abre el proyecto y ?sel=<id> toca esa caja.
const q = new URLSearchParams(location.search);
// Cada captura arranca con el mapa como viene (sin plegados ni zoom guardados de otra corrida).
try { Object.keys(localStorage).filter((k) => k.startsWith("colab-mapa-")).forEach((k) => localStorage.removeItem(k)); } catch { /* */ }
// La guía se abre sola solo con ?guia (si no, taparía las demás capturas).
try { if (q.has("guia")) localStorage.removeItem("colab-guia-mapa-vista"); else localStorage.setItem("colab-guia-mapa-vista", "1"); } catch { /* */ }
if (q.has("abrir")) {
  const tocar = (sel: string, luego?: () => void, intentos = 40) => {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) { el.click(); luego?.(); } else if (intentos > 0) setTimeout(() => tocar(sel, luego, intentos - 1), 100);
  };
  tocar("[data-proyecto]", () => {
    // Tablero: ?tarjeta=<id> abre esa tarjeta y ?chat abre «Traer del chat».
    const tid = q.get("tarjeta");
    if (tid) setTimeout(() => tocar(`[data-tarjeta="${tid}"] button`), 600);
    if (q.has("chat")) setTimeout(() => tocar("button[data-chat]", () => setTimeout(() => {
      const f = document.querySelector<HTMLTextAreaElement>("[aria-label='Traer del chat'] textarea");
      if (f) { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(f, "x"); f.dispatchEvent(new Event("input", { bubbles: true })); }
      setTimeout(() => tocar("[aria-label='Traer del chat'] button.bg-accent", () => setTimeout(() => {
        document.querySelectorAll<HTMLInputElement>("[aria-label='Traer del chat'] input[type=checkbox]")[2]?.click();
      }, 300)), 200);
    }, 300)), 600);
    // ?guia=<n>: la guía abierta en la escena n (0 = la primera).
    const n = Number(q.get("guia") || 0);
    for (let k = 0; k < n; k++) setTimeout(() => document.querySelector<HTMLElement>("[data-guia] [aria-label='Siguiente']")?.click(), 400 + k * 50);
    if (q.has("miembros")) setTimeout(() => tocar("button[data-compartir]"), 700);
    // ?precios: el simulador abierto; ?precios=ajustes además despliega «Costos y supuestos».
    if (q.has("precios")) setTimeout(() => tocar("button[data-precios]", () => {
      if (q.get("precios") === "ajustes") setTimeout(() => tocar("[data-producto] button[aria-expanded]"), 500);
    }), 600);
    const id = q.get("sel");
    if (id) setTimeout(() => tocar(`[data-caja="${id}"] .eb-cuerpo`, () => {
      // ?medir: el estilo calculado de un campo de la hoja, al título (para --dump-dom).
      if (q.has("medir")) setTimeout(() => {
        const el = document.querySelector<HTMLElement>(`.px-hoja ${q.get("medir") || "input"}`);
        if (el) { const s = getComputedStyle(el); document.title = `MEDIDA|${s.fontFamily}|${s.fontSize}|${el.className}`; }
      }, 800);
    }), 600);
  });
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 0, refetchOnWindowFocus: false } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <div className="flex h-dvh flex-col overflow-hidden bg-surface p-2">
        <ColaboradoresPanel />
      </div>
    </QueryClientProvider>
  </StrictMode>,
);
