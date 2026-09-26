/**
 * Colaboradores: diagramas de flujo que Armando construye con un colaborador
 * externo (primero Sebastián), a mano y desde el celular.
 *
 * Arrastran cajas, las unen con flechas y le ponen texto a cada paso hasta
 * llegar a una relación comercial acordada por los dos. Cada guardado es una
 * versión (se puede volver a cualquiera) y la versión acordada se exporta con
 * el acabado de Archify, como los diagramas del Mapa del sistema.
 *
 * Tiempo real «suficiente»: se consulta cada 3 s. Si los dos editaron a la vez,
 * el servidor rechaza la versión vieja (409) y aquí se COMBINAN los cambios —
 * los del otro más los propios— en vez de pisar a nadie. Backend:
 * app/services/colaboradores.py.
 */
import "@xyflow/react/dist/style.css";
import "./colaboradores/pixel.css";
import {
  Background, BackgroundVariant, BaseEdge, ConnectionMode, Controls, EdgeLabelRenderer, Handle, MarkerType, Position,
  ReactFlow, ReactFlowProvider, applyEdgeChanges, applyNodeChanges, getBezierPath, getSmoothStepPath, getStraightPath,
  reconnectEdge, useReactFlow,
  type Connection, type Edge, type EdgeChange, type EdgeProps, type Node, type NodeChange, type NodeProps,
} from "@xyflow/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode,
} from "react";
import { api, fetchAuthBlobUrl } from "../api/client";
import { Sprite, circuloPixel, type SpriteId } from "./colaboradores/pixel";
import EdificioProyecto from "./colaboradores/EdificioProyecto";

// ─── Modelo (igual al del backend) ──────────────────────────────────────────

type Tipo = "accion" | "decision" | "entregable" | "dinero" | "externo" | "consenso" | "producto" | "competencia";
type Carril = "mckenna" | "armando" | "sebastian" | "conjunto";
type Dinero = { monto: number; moneda: Moneda };
type Moneda = "COP" | "USD" | "EUR";
type Dato = { campo: string; valor: string };
type Consecuencia = { si: string; entonces: string; medida: string };
type Adjunto = { id: string; nombre: string; tipo: "imagen" | "pdf" };
type Variables = { como?: string; donde?: string; porque?: string };
type Propuesta = { id: string; autor?: number; texto: string };
type Resuelto = { propuesta: string; modo: "acuerdo" | "turno"; por?: number };
type Componente = { nombre: string; cantidad?: string; costo?: Dinero };
/** Una caja es un paso del proyecto: además del título carga contenido real
 *  (fotos, facturas, tiempo, dinero, datos, consecuencias, un consenso, un
 *  producto con su receta o un competidor con su precio). Todo opcional. */
type NodoDoc = {
  id: string; label: string; sublabel?: string; tipo: Tipo; carril: Carril; x: number; y: number;
  imagen?: string; variables?: Variables; tiempo_min?: number; costo?: Dinero; precio?: Dinero;
  datos?: Dato[]; consecuencias?: Consecuencia[]; adjuntos?: Adjunto[]; enlaceApp?: string;
  asunto?: string; propuestas?: Propuesta[]; votos?: Record<string, string>; resuelto?: Resuelto;
  sku?: string; empaque?: { nombre: string; costo?: Dinero }; componentes?: Componente[];
  url?: string; plataforma?: string;
};
/** Lo que se CALCULA para dibujar y nunca se guarda (claves con `_`; aDoc las quita). */
type NodoVista = NodoDoc & {
  uniendo?: boolean;
  _vs?: { nombre: string; pct: number };                                   // rival ↔ producto unido
  _rivales?: { n: number; min: number | null; max: number | null; moneda?: Moneda };
};
/** Por dónde sale/entra la flecha en la caja: izquierda, derecha, arriba, abajo. */
type Lado = "l" | "r" | "t" | "b";
type Trazo = "solida" | "guiones" | "puntos";
type Forma = "curva" | "recta" | "escalon";
type FlechaDoc = {
  id: string; from: string; to: string; label?: string;
  fromLado?: Lado; toLado?: Lado; color?: string; grosor?: number; trazo?: Trazo; forma?: Forma;
};
type Doc = { nodes: NodoDoc[]; edges: FlechaDoc[] };
type Diagrama = {
  id: number; titulo: string; descripcion: string; version: number; doc: Doc;
  nodos: number; flechas: number; actualizado_en: string; actualizado_por: number | null;
  actualizado_por_nombre: string; archivado: number;
  turno_actual?: number | null; colaborador_id?: number | null; participantes?: Record<string, string>;
  /** La obra (vista Edificio): pisos, cuántos terminados y avance 0–1. Lo calcula el servidor. */
  obra?: { pisos: number; terminados: number; avance: number };
};
type Lista = { diagramas: Omit<Diagrama, "doc">[]; yo: { id: number; nombre: string } };
type Version = { version: number; usuario: string; resumen: string; creado_en: string; nodos: number; flechas: number };

const TIPOS: Record<Tipo, { label: string; fondo: string; borde: string }> = {
  accion: { label: "Acción", fondo: "#e0f2fe", borde: "#0284c7" },
  decision: { label: "Decisión / acuerdo", fondo: "#fef3c7", borde: "#d97706" },
  entregable: { label: "Entregable", fondo: "#dcfce7", borde: "#16a34a" },
  dinero: { label: "Dinero / precio", fondo: "#f3e8ff", borde: "#9333ea" },
  externo: { label: "Tercero / cliente", fondo: "#f1f5f9", borde: "#475569" },
  consenso: { label: "Consenso / votación", fondo: "#fae8ff", borde: "#a21caf" },
  producto: { label: "Producto", fondo: "#FFCCAA", borde: "#AB5236" },
  competencia: { label: "Competencia", fondo: "#FFE4EC", borde: "#FF004D" },
};
// Cada carril es una figura jurídica aparte: la empresa no es Armando.
const CARRILES: Record<Carril, string> = {
  mckenna: "McKenna Group SAS", armando: "Armando García", sebastian: "Sebastián García", conjunto: "Conjunto",
};
const COLOR_CARRIL: Record<Carril, string> = { mckenna: "#0f766e", armando: "#1d4ed8", sebastian: "#b45309", conjunto: "#374151" };

// Los mismos valores que acepta el servidor (app/services/colaboradores.py):
// un color libre desde aquí sería texto entrando a un atributo SVG.
const COLORES_FLECHA = ["#111827", "#0f766e", "#1d4ed8", "#b45309", "#b91c1c", "#7c3aed", "#15803d", "#94a3b8"] as const;
const GROSORES = [1, 2, 3, 5, 8];
const LADOS: { id: Lado; icono: string; nombre: string }[] = [
  { id: "l", icono: "←", nombre: "izquierda" }, { id: "r", icono: "→", nombre: "derecha" },
  { id: "t", icono: "↑", nombre: "arriba" }, { id: "b", icono: "↓", nombre: "abajo" },
];
const TRAZOS: { id: Trazo; label: string }[] = [
  { id: "solida", label: "─── sólida" }, { id: "guiones", label: "– – guiones" }, { id: "puntos", label: "···· puntos" },
];
const FORMAS: { id: Forma; label: string }[] = [
  { id: "curva", label: "Curva" }, { id: "recta", label: "Recta" }, { id: "escalon", label: "Escalón" },
];

const MONEDAS: Moneda[] = ["COP", "USD", "EUR"];
const VARIABLES: { id: keyof Variables; label: string; ph: string }[] = [
  { id: "como", label: "Cómo", ph: "cómo se hace" },
  { id: "donde", label: "Dónde", ph: "dónde ocurre" },
  { id: "porque", label: "Por qué", ph: "por qué / para qué" },
];

const nuevoId = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** $12.500 → legible; el monto se guarda como número. */
function plata(d?: Dinero): string {
  if (!d) return "";
  return `${Math.round(d.monto).toLocaleString("es-CO")} ${d.moneda}`;
}
/** «$45.000» (pesos) o «USD 12»: lo que cabe en un apartado de la carta. */
function plataCorta(d: Dinero): string {
  const n = Math.round(d.monto).toLocaleString("es-CO");
  return d.moneda === "COP" ? `$${n}` : `${d.moneda} ${n}`;
}
function tiempoTexto(min?: number): string {
  if (!min) return "";
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

/**
 * Lo que cuesta UNA unidad del producto: su receta (piezas + empaque) en la
 * moneda del precio. Sin receta, el costo que se haya escrito a mano. Las
 * piezas en otra moneda no se suman: convertir sería inventar una tasa.
 */
function costoProducto(d: NodoDoc): Dinero | undefined {
  const moneda: Moneda = d.precio?.moneda ?? d.componentes?.find((c) => c.costo)?.costo?.moneda ?? "COP";
  const partes = [...(d.componentes ?? []).map((c) => c.costo), d.empaque?.costo].filter(
    (x): x is Dinero => Boolean(x && x.moneda === moneda));
  if (partes.length) return { monto: partes.reduce((s, x) => s + x.monto, 0), moneda };
  return d.costo;
}
function margenDe(d: NodoDoc): { monto: number; pct: number; moneda: Moneda } | null {
  const c = costoProducto(d);
  if (!d.precio || !c || c.moneda !== d.precio.moneda || !d.precio.monto) return null;
  const monto = d.precio.monto - c.monto;
  return { monto, pct: (monto / d.precio.monto) * 100, moneda: d.precio.moneda };
}
function urlValida(u?: string): boolean {
  return Boolean(u && /^https?:\/\/\S+$/i.test(u.trim()));
}
/** «tienda.co» de «https://www.tienda.co/collar»: lo que cabe en la carta. */
function hostDe(u?: string): string {
  if (!urlValida(u)) return "";
  try { return new URL(u!).hostname.replace(/^www\./, ""); } catch { return ""; }
}
function textoVs(vs: { nombre: string; pct: number }): string {
  if (Math.abs(vs.pct) < 0.5) return `Mismo precio que ${vs.nombre}`;
  return `${Math.abs(vs.pct).toFixed(0)} % más ${vs.pct > 0 ? "caro" : "barato"} que ${vs.nombre}`;
}

/** El id del diagrama abierto, para armar la URL autenticada de sus adjuntos. */
const DidCtx = createContext<number>(0);
/** El tablero se ve en pixel art (o clásico): lo leen las cajas. */
const PixelCtx = createContext<boolean>(true);
const CIRCULO_PIXEL = circuloPixel(16);

/** Caché de las URLs blob: el mismo adjunto se pide una vez, no en cada render. */
const _blobCache = new Map<string, Promise<string | null>>();
function AuthImg({ did, mid, className, alt }: { did: number; mid: string; className?: string; alt?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    const clave = `${did}/${mid}`;
    let p = _blobCache.get(clave);
    if (!p) { p = fetchAuthBlobUrl(`/api/colaboradores/diagramas/${did}/media/${mid}`); _blobCache.set(clave, p); }
    void p.then((u) => { if (vivo) setUrl(u); });
    return () => { vivo = false; };
  }, [did, mid]);
  if (!url) return <div className={`animate-pulse bg-gray-100 ${className || ""}`} />;
  return <img src={url} alt={alt || ""} className={className} />;
}

/** Del documento a lo que dibuja React Flow (trazo, punta y etiqueta legible). */
function pintar(e: FlechaDoc) {
  const color = (COLORES_FLECHA as readonly string[]).includes(e.color || "") ? e.color! : COLORES_FLECHA[0];
  const w = Math.max(1, Math.min(8, Number(e.grosor) || 2));
  const trazo: Trazo = e.trazo === "guiones" || e.trazo === "puntos" ? e.trazo : "solida";
  return {
    // Una sola flecha propia (la forma va en data.forma): su etiqueta es HTML.
    type: "flecha",
    style: {
      stroke: color,
      strokeWidth: w,
      strokeDasharray: trazo === "guiones" ? `${w * 4} ${w * 3}` : trazo === "puntos" ? `1 ${w * 2.6}` : undefined,
      strokeLinecap: trazo === "puntos" ? ("round" as const) : undefined,
    },
    markerEnd: { type: MarkerType.ArrowClosed, width: 12 + w * 2, height: 12 + w * 2, color },
  };
}

/** Tocar la etiqueta de una flecha la selecciona (en el celular la línea es muy fina). */
const TocarFlechaCtx = createContext<(id: string) => void>(() => {});

/**
 * La flecha con su etiqueta en HTML. La etiqueta SVG de React Flow se mide una
 * sola vez al montar: si la fuente pixel llegaba después, el texto se salía de
 * su recuadro. Un <div> se ajusta solo a lo que diga.
 */
function Flecha({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd, label, data }: EdgeProps) {
  const tocar = useContext(TocarFlechaCtx);
  const forma = (data as Partial<FlechaDoc> | undefined)?.forma;
  const p = { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition };
  const [ruta, lx, ly] = forma === "escalon" ? getSmoothStepPath(p) : forma === "curva" ? getBezierPath(p) : getStraightPath(p);
  return (
    <>
      <BaseEdge id={id} path={ruta} style={style} markerEnd={markerEnd} interactionWidth={22} />
      {label ? (
        <EdgeLabelRenderer>
          <div className="colab-etq nodrag nopan" onClick={() => tocar(id)}
               style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`, color: String(style?.stroke ?? "#111827"),
                        borderColor: String(style?.stroke ?? "#111827") }}>
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
const TIPOS_FLECHA = { flecha: Flecha };

function aFlow(doc: Doc): { nodes: Node[]; edges: Edge[] } {
  return {
    nodes: doc.nodes.map((n) => ({ id: n.id, type: "caja", position: { x: n.x, y: n.y }, data: { ...n } })),
    edges: doc.edges.map((e) => ({
      id: e.id, source: e.from, target: e.to,
      sourceHandle: e.fromLado || "r", targetHandle: e.toLado || "l",
      label: e.label || undefined,
      reconnectable: true,
      data: { label: e.label || "", color: e.color, grosor: e.grosor, trazo: e.trazo, forma: e.forma },
      ...pintar(e),
    })),
  };
}

function aDoc(nodes: Node[], edges: Edge[]): Doc {
  return {
    nodes: nodes.map((n) => {
      // Se conserva TODO lo de la caja (fotos, datos, dinero…); se quita lo que
      // solo sirve para dibujar (`uniendo`, `_vs`, `_rivales`…) y se fija la
      // posición real. Si lo calculado se colara, `combinar()` vería cada caja
      // como «cambiada aquí» y pisaría lo que el otro guardó.
      const { uniendo, ...resto } = n.data as NodoVista;
      const d = Object.fromEntries(Object.entries(resto).filter(([k]) => !k.startsWith("_"))) as unknown as NodoDoc;
      return { ...d, id: n.id, x: Math.round(n.position.x), y: Math.round(n.position.y) };
    }),
    edges: edges.map((e) => {
      const d = (e.data || {}) as Partial<FlechaDoc>;
      return {
        id: e.id, from: e.source, to: e.target, label: String(d.label || ""),
        fromLado: (e.sourceHandle as Lado) || "r", toLado: (e.targetHandle as Lado) || "l",
        color: d.color, grosor: d.grosor, trazo: d.trazo, forma: d.forma,
      };
    }),
  };
}

/** Combina lo editado aquí con lo que el otro guardó, sobre la versión de partida. */
function combinar(base: Doc, local: Doc, remoto: Doc): Doc {
  const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  function mezclar<T extends { id: string }>(b: T[], l: T[], r: T[]): T[] {
    const B = new Map(b.map((x) => [x.id, x])), L = new Map(l.map((x) => [x.id, x]));
    const out = new Map(r.map((x) => [x.id, x]));
    for (const [id, x] of L) {
      const enBase = B.get(id);
      if (!enBase || !igual(enBase, x)) out.set(id, x);          // nuevo o cambiado aquí: gana lo local
    }
    for (const [id, x] of B) {
      const remotoSinCambio = out.has(id) && igual(out.get(id), x);
      if (!L.has(id) && remotoSinCambio) out.delete(id);          // borrado aquí y el otro no lo tocó
    }
    return [...out.values()];
  }
  const nodes = mezclar(base.nodes, local.nodes, remoto.nodes);
  const ids = new Set(nodes.map((n) => n.id));
  const edges = mezclar(base.edges, local.edges, remoto.edges).filter((e) => ids.has(e.from) && ids.has(e.to));
  return { nodes, edges };
}

// ─── Caja ───────────────────────────────────────────────────────────────────

/** Un punto por lado. Con ConnectionMode.Loose cada uno sirve de salida y de
 *  llegada, así que la flecha puede tocar la caja por donde uno quiera. */
function Manijas({ color }: { color: string }) {
  const m = { width: 14, height: 14, background: color, border: "2px solid white" };
  return (
    <>
      <Handle type="source" id="l" position={Position.Left} style={m} />
      <Handle type="source" id="t" position={Position.Top} style={m} />
      <Handle type="source" id="r" position={Position.Right} style={m} />
      <Handle type="source" id="b" position={Position.Bottom} style={m} />
    </>
  );
}

function Chip({ s, children }: { s: SpriteId; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-bold text-gray-800">
      <Sprite s={s} px={2} />{children}
    </span>
  );
}

/** Un paso del proyecto (acción, decisión, entregable, dinero, tercero, consenso). */
function CajaPaso({ d, selected }: { d: NodoVista; selected?: boolean }) {
  const did = useContext(DidCtx);
  const pixel = useContext(PixelCtx);
  const t = TIPOS[d.tipo] ?? TIPOS.accion;
  const colorCarril = COLOR_CARRIL[d.carril] ?? "#374151";
  const chips: { s: SpriteId; t: string }[] = [];
  if (d.precio) chips.push({ s: "moneda", t: plata(d.precio) });
  if (d.costo) chips.push({ s: "bolsa", t: plata(d.costo) });
  if (d.tiempo_min) chips.push({ s: "reloj", t: tiempoTexto(d.tiempo_min) });
  const nDatos = (d.datos || []).filter((x) => x.campo || x.valor).length;
  if (nDatos) chips.push({ s: "datos", t: String(nDatos) });
  const nAdj = (d.adjuntos || []).length;
  if (nAdj) chips.push({ s: "doc", t: String(nAdj) });
  const nCons = (d.consecuencias || []).filter((c) => c.si || c.entonces || c.medida).length;
  if (nCons) chips.push({ s: "alerta", t: String(nCons) });
  if (d.tipo === "consenso") {
    const np = (d.propuestas || []).length;
    chips.push({ s: "urna", t: `${np} propuesta${np === 1 ? "" : "s"}` });
    if (d.resuelto) chips.push({ s: "trofeo", t: d.resuelto.modo === "turno" ? "por turno" : "acuerdo" });
  }
  const discontinua = d.carril !== "conjunto";
  // Sin overflow-hidden: recortaba a la mitad los puntos de conexión de los bordes.
  const marco = pixel
    ? { background: t.fondo, border: `3px ${discontinua ? "dashed" : "solid"} #000`, boxShadow: "4px 4px 0 #000" }
    : { background: t.fondo, border: `2px ${discontinua ? "dashed" : "solid"} ${selected ? "#111827" : t.borde}`,
        borderRadius: d.tipo === "decision" ? 22 : 10 };
  return (
    <div style={marco}
         className={`min-w-[140px] max-w-[220px] ${pixel ? "" : "shadow-sm"} ${pixel && selected ? "px-sel" : ""} ${d.uniendo ? "ring-4 ring-accent/50" : ""}`}>
      <Manijas color={pixel ? "#000" : t.borde} />
      {pixel && (
        <div className="px-t px-2 py-1 text-white" style={{ background: t.borde, fontSize: 10, borderBottom: "3px solid #000" }}>
          {t.label}
        </div>
      )}
      {d.imagen && did ? (
        <AuthImg did={did} mid={d.imagen} alt={d.label}
                 className={`h-24 w-full bg-white object-cover ${pixel ? "border-b-[3px] border-black" : "rounded-t-[8px]"}`} />
      ) : null}
      <div className="px-3 py-2 text-center">
        <p className="flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wide" style={{ color: colorCarril }}>
          {pixel && <Sprite s="jugador" px={2} colores={{ X: colorCarril }} />}
          {CARRILES[d.carril] ?? "Conjunto"}
        </p>
        {!pixel && <p className="text-[9px] font-semibold uppercase" style={{ color: t.borde }}>{t.label}</p>}
        <p className="text-sm font-bold leading-snug text-gray-900">{d.label}</p>
        {d.sublabel && <p className="mt-0.5 text-xs text-gray-600">{d.sublabel}</p>}
        {d.tipo === "consenso" && d.asunto && <p className="mt-0.5 text-xs italic text-gray-600">“{d.asunto}”</p>}
        {chips.length > 0 && (
          <div className="mt-1 flex flex-wrap justify-center gap-1">
            {chips.map((c, i) => <Chip key={i} s={c.s}>{c.t}</Chip>)}
          </div>
        )}
      </div>
    </div>
  );
}

/** La foto dentro de un círculo de escalones, con contorno y sombra dura. */
function FotoPixel({ did, mid, tam }: { did: number; mid?: string; tam: number }) {
  const capa = (extra: CSSProperties): CSSProperties => ({ position: "absolute", clipPath: CIRCULO_PIXEL, ...extra });
  return (
    <div style={{ position: "relative", width: tam, height: tam }}>
      <div style={capa({ inset: 0, transform: "translate(4px, 4px)", background: "#000" })} />
      <div style={capa({ inset: 0, background: "#000" })} />
      <div style={capa({ inset: 3, background: "#FFCCAA", overflow: "hidden" })}>
        {mid && did
          ? <AuthImg did={did} mid={mid} alt="" className="h-full w-full object-cover" />
          : <div className="flex h-full w-full items-center justify-center"><Sprite s="foto" px={4} /></div>}
      </div>
    </div>
  );
}

/** Dónde va cada apartado alrededor de la foto (tablero 314×250, centro 157,125). */
const SAT_PRODUCTO = {
  sku: [157, 26], vitrina: [58, 74], precio: [256, 74], empaque: [58, 178], margen: [256, 178], receta: [157, 226],
} as const;

/**
 * El producto como en el Taller de combos: la foto de su publicación al centro
 * y, saliendo de ella, lo que lo hace real — SKU, dónde se vende, precio,
 * empaque, receta (piezas con su costo) y el margen que queda. Una ranura sin
 * dato se ve punteada con «?»: se nota qué falta averiguar.
 */
function ProductoNodo({ d, selected }: { d: NodoVista; selected?: boolean }) {
  const did = useContext(DidCtx);
  const comps = d.componentes ?? [];
  const costo = costoProducto(d);
  const m = margenDe(d);
  const sats: { k: keyof typeof SAT_PRODUCTO; s: SpriteId; t: string; v: string; color?: string }[] = [
    { k: "sku", s: "codigo", t: "SKU", v: d.sku ?? "" },
    { k: "vitrina", s: "ventana", t: "Vitrina", v: hostDe(d.url) },
    { k: "precio", s: "moneda", t: "Precio", v: d.precio ? plataCorta(d.precio) : "" },
    { k: "empaque", s: "cofre", t: "Empaque", v: d.empaque?.nombre || (d.empaque?.costo ? plataCorta(d.empaque.costo) : "") },
    { k: "margen", s: "estrella", t: "Margen", v: m ? `${m.monto >= 0 ? "+" : ""}${Math.round(m.pct)} %` : "",
      color: m ? (m.monto >= 0 ? "#008751" : "#FF004D") : undefined },
    { k: "receta", s: "bloques", t: comps.length ? `Receta ${comps.length}` : "Receta",
      v: costo && comps.length ? plataCorta(costo) : comps.length ? `${comps.length} piezas` : "" },
  ];
  const r = d._rivales;
  return (
    <div className={`px-prod ${selected ? "px-sel" : ""} ${d.uniendo ? "ring-4 ring-accent/50" : ""}`}>
      <Manijas color="#000" />
      <div className="px-cab">
        <Sprite s="gema" px={2} />
        <span className="min-w-0 flex-1 truncate">{d.label}</span>
        {r && <span className="px-vs" title="Competidores unidos a este producto">VS {r.n}</span>}
      </div>
      <div className="relative" style={{ width: 314, height: 250 }}>
        <svg className="absolute inset-0" width={314} height={250} shapeRendering="crispEdges" aria-hidden="true">
          {sats.map((s) => {
            const [x, y] = SAT_PRODUCTO[s.k];
            return <line key={s.k} x1={157} y1={125} x2={x} y2={y} stroke="#000" strokeWidth={3}
                         strokeDasharray={s.v ? undefined : "6 4"} />;
          })}
        </svg>
        <div className="absolute" style={{ left: 157 - 46, top: 125 - 46 }}>
          <FotoPixel did={did} mid={d.imagen} tam={92} />
        </div>
        {sats.map((s) => {
          const [x, y] = SAT_PRODUCTO[s.k];
          return (
            <div key={s.k} className={`px-sat ${s.v ? "" : "px-sat-vacio"}`} style={{ left: x, top: y }}>
              <div className="px-sat-t uppercase"><Sprite s={s.s} px={2} />{s.t}</div>
              <div className="px-sat-v" style={s.color ? { color: s.color } : undefined}>{s.v || "?"}</div>
            </div>
          );
        })}
      </div>
      {r && r.min != null && r.max != null && (
        <div className="px-cab" style={{ background: "#C8003E", borderBottom: 0, borderTop: "3px solid #000" }}>
          <Sprite s="bandera" px={2} colores={{ r: "#FFEC27" }} />
          Rivales {r.min === r.max ? plataCorta({ monto: r.min, moneda: r.moneda ?? "COP" })
                   : `${plataCorta({ monto: r.min, moneda: r.moneda ?? "COP" })}–${plataCorta({ monto: r.max, moneda: r.moneda ?? "COP" })}`}
        </div>
      )}
    </div>
  );
}

/** Un competidor directo: su publicación, dónde vende y a cuánto. */
function RivalNodo({ d, selected }: { d: NodoVista; selected?: boolean }) {
  const did = useContext(DidCtx);
  const nDatos = (d.datos ?? []).filter((x) => x.campo || x.valor).length;
  const host = hostDe(d.url);
  const vs = d._vs;
  return (
    <div className={`px-rival ${selected ? "px-sel" : ""} ${d.uniendo ? "ring-4 ring-accent/50" : ""}`}>
      <Manijas color="#000" />
      <div className="px-cab">
        <span className="px-vs">VS</span>
        <span className="min-w-0 flex-1 truncate">{d.plataforma || "Rival"}</span>
      </div>
      {d.imagen && did
        ? <AuthImg did={did} mid={d.imagen} alt={d.label} className="px-rival-foto" />
        : <div className="px-rival-foto px-rival-vacio"><Sprite s="bandera" px={6} titulo="Sin captura de su publicación" /></div>}
      <div className="space-y-1 p-2">
        <p className="truncate text-[16px] leading-tight">{d.label}</p>
        <p className="px-rival-precio"><Sprite s="moneda" px={2} />{d.precio ? plataCorta(d.precio) : "¿precio?"}</p>
        {vs && (
          <p className="text-[13px] leading-tight"
             style={{ color: vs.pct > 0.5 ? "#008751" : vs.pct < -0.5 ? "#FF004D" : "#5F574F" }}>{textoVs(vs)}</p>
        )}
        {(host || nDatos > 0) && (
          <p className="flex items-center gap-2 text-[12px] leading-tight text-[#5F574F]">
            {host && <><Sprite s="ventana" px={2} /><span className="truncate">{host}</span></>}
            {nDatos > 0 && <><Sprite s="datos" px={2} />{nDatos}</>}
          </p>
        )}
      </div>
    </div>
  );
}

function Caja({ data, selected }: NodeProps) {
  const d = data as NodoVista;
  if (d.tipo === "producto") return <ProductoNodo d={d} selected={selected} />;
  if (d.tipo === "competencia") return <RivalNodo d={d} selected={selected} />;
  return <CajaPaso d={d} selected={selected} />;
}
const TIPOS_NODO = { caja: Caja };

// ─── Contenido real de una caja (fotos, datos, dinero, consecuencias) ─────────

const INP = "w-full rounded border border-border bg-surface-input px-2 py-1.5 text-sm text-ink";
const MINI = "rounded border border-border bg-surface-input px-2 py-1 text-sm text-ink";

function DineroCampo({ etq, valor, onCambio }: { etq: string; valor?: Dinero; onCambio: (d?: Dinero) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-16 shrink-0 text-xs text-muted">{etq}</span>
      <input inputMode="numeric" placeholder="0" value={valor?.monto ?? ""}
             onChange={(e) => {
               const n = Number(e.target.value.replace(/[^\d.]/g, ""));
               onCambio(e.target.value.trim() === "" || !isFinite(n) ? undefined : { monto: n, moneda: valor?.moneda ?? "COP" });
             }}
             className={`${MINI} flex-1 tabular-nums`} />
      <select value={valor?.moneda ?? "COP"} disabled={!valor}
              onChange={(e) => valor && onCambio({ monto: valor.monto, moneda: e.target.value as Moneda })}
              className={`${MINI} disabled:opacity-50`}>
        {MONEDAS.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
    </div>
  );
}

type Subir = (f: File) => Promise<Adjunto | null>;

/** La foto que sale en la caja. Sin `capture`: así el teléfono deja elegir entre
 *  cámara y galería (la captura de una publicación ya está guardada). */
function FotoCampo({ did, nd, editar, subir, subiendo, texto }: {
  did: number; nd: NodoDoc; editar: (c: Partial<NodoDoc>) => void; subir: Subir; subiendo: boolean; texto: string;
}) {
  return (
    <div className="flex items-center gap-2">
      {nd.imagen ? (
        <AuthImg did={did} mid={nd.imagen} alt="" className="h-14 w-14 shrink-0 rounded border border-border object-cover" />
      ) : (
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded border border-dashed border-border">
          <Sprite s="foto" px={3} />
        </div>
      )}
      <label className="px-btn flex-1 cursor-pointer rounded-lg border border-border px-2 py-1.5 text-center text-xs font-bold text-ink">
        {subiendo ? "Subiendo…" : nd.imagen ? "Cambiar foto" : texto}
        <input type="file" accept="image/*" className="hidden"
               onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = "";
                 if (f) { const a = await subir(f); if (a?.tipo === "imagen") editar({ imagen: a.id }); } }} />
      </label>
      {nd.imagen && (
        <button type="button" onClick={() => editar({ imagen: undefined })}
                className="shrink-0 text-xs font-bold text-red-500">Quitar</button>
      )}
    </div>
  );
}

/** Enlace a una publicación: solo http(s) (el servidor descarta lo demás). */
function UrlCampo({ valor, onCambio, ph }: { valor?: string; onCambio: (u?: string) => void; ph: string }) {
  const v = valor ?? "";
  const malo = v.trim() !== "" && !urlValida(v);
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1.5">
        <input value={v} placeholder={ph} inputMode="url" autoCapitalize="off" autoCorrect="off"
               onChange={(e) => onCambio(e.target.value || undefined)}
               // «tienda.co/collar» → «https://tienda.co/collar» al salir del campo.
               onBlur={() => { const t = v.trim(); if (t && !/^[a-z]+:/i.test(t) && /^[\w-]+(\.[\w-]+)+/.test(t)) onCambio(`https://${t}`); }}
               className={`${INP} flex-1`} />
        {urlValida(v) && (
          <a href={v.trim()} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs font-bold text-accent">Abrir</a>
        )}
      </div>
      {malo && <p className="text-[11px] text-red-500">Debe empezar por https:// — así no se guarda.</p>}
    </div>
  );
}

function ContenidoCaja({ did, nd, editar, subir, subiendo, extras = false }: {
  did: number; nd: NodoDoc; editar: (c: Partial<NodoDoc>) => void;
  subir: Subir; subiendo: boolean;
  /** Solo lo que no tiene su propio editor (producto y rival ya piden foto y precio). */
  extras?: boolean;
}) {
  const datos = nd.datos ?? [];
  const cons = nd.consecuencias ?? [];
  const adj = nd.adjuntos ?? [];
  return (
    <div className={`space-y-2 ${extras ? "" : "border-t border-border pt-2"}`}>
      {!extras && (
        <FotoCampo did={did} nd={nd} editar={editar} subir={subir} subiendo={subiendo} texto="Poner foto (sale en la caja)" />
      )}

      {/* Cómo, dónde, por qué */}
      <div className="grid grid-cols-1 gap-1.5">
        {VARIABLES.map((v) => (
          <input key={v.id} placeholder={`${v.label}: ${v.ph}`} value={nd.variables?.[v.id] ?? ""}
                 onChange={(e) => editar({ variables: { ...(nd.variables ?? {}), [v.id]: e.target.value } })}
                 className={INP} />
        ))}
      </div>

      {/* Tiempo y dinero */}
      <div className="flex items-center gap-1.5">
        <span className="w-16 shrink-0 text-xs text-muted">Tiempo</span>
        <input inputMode="numeric" placeholder="minutos" value={nd.tiempo_min ?? ""}
               onChange={(e) => { const n = Number(e.target.value.replace(/[^\d.]/g, ""));
                 editar({ tiempo_min: e.target.value.trim() === "" || !isFinite(n) ? undefined : n }); }}
               className={`${MINI} flex-1 tabular-nums`} />
        <span className="text-xs text-muted">min</span>
      </div>
      {!extras && (
        <>
          <DineroCampo etq="Costo" valor={nd.costo} onCambio={(d) => editar({ costo: d })} />
          <DineroCampo etq="Precio" valor={nd.precio} onCambio={(d) => editar({ precio: d })} />
        </>
      )}

      {/* Datos (campo: valor) */}
      <details>
        <summary className="cursor-pointer text-xs font-bold text-muted">Datos ({datos.length})</summary>
        <div className="mt-1 space-y-1">
          {datos.map((d, i) => (
            <div key={i} className="flex gap-1">
              <input placeholder="campo" value={d.campo} onChange={(e) => editar({ datos: datos.map((x, j) => j === i ? { ...x, campo: e.target.value } : x) })} className={`${MINI} w-1/3`} />
              <input placeholder="valor" value={d.valor} onChange={(e) => editar({ datos: datos.map((x, j) => j === i ? { ...x, valor: e.target.value } : x) })} className={`${MINI} flex-1`} />
              <button type="button" onClick={() => editar({ datos: datos.filter((_, j) => j !== i) })} className="px-1 text-red-500">×</button>
            </div>
          ))}
          {datos.length < 8 && (
            <button type="button" onClick={() => editar({ datos: [...datos, { campo: "", valor: "" }] })} className="text-xs font-bold text-accent">＋ dato</button>
          )}
        </div>
      </details>

      {/* Consecuencias: si pasa esto → consecuencia → medida */}
      <details>
        <summary className="cursor-pointer text-xs font-bold text-muted">Si pasa esto… ({cons.length})</summary>
        <div className="mt-1 space-y-1.5">
          {cons.map((c, i) => (
            <div key={i} className="space-y-1 rounded border border-border p-1.5">
              <input placeholder="Si pasa…" value={c.si} onChange={(e) => editar({ consecuencias: cons.map((x, j) => j === i ? { ...x, si: e.target.value } : x) })} className={`${MINI} w-full`} />
              <input placeholder="…ocurre esto" value={c.entonces} onChange={(e) => editar({ consecuencias: cons.map((x, j) => j === i ? { ...x, entonces: e.target.value } : x) })} className={`${MINI} w-full`} />
              <div className="flex gap-1">
                <input placeholder="posible medida" value={c.medida} onChange={(e) => editar({ consecuencias: cons.map((x, j) => j === i ? { ...x, medida: e.target.value } : x) })} className={`${MINI} flex-1`} />
                <button type="button" onClick={() => editar({ consecuencias: cons.filter((_, j) => j !== i) })} className="px-1 text-red-500">×</button>
              </div>
            </div>
          ))}
          {cons.length < 6 && (
            <button type="button" onClick={() => editar({ consecuencias: [...cons, { si: "", entonces: "", medida: "" }] })} className="text-xs font-bold text-accent">＋ escenario</button>
          )}
        </div>
      </details>

      {/* Adjuntos: fotos y facturas */}
      <details>
        <summary className="cursor-pointer text-xs font-bold text-muted">Fotos y facturas ({adj.length})</summary>
        <div className="mt-1 space-y-1">
          {adj.map((a, i) => (
            <div key={a.id} className="flex items-center gap-2 rounded border border-border p-1">
              {a.tipo === "imagen"
                ? <AuthImg did={did} mid={a.id} alt="" className="h-10 w-10 rounded object-cover" />
                : <span className="flex h-10 w-10 items-center justify-center rounded bg-red-50"><Sprite s="doc" px={3} /></span>}
              <span className="flex-1 truncate text-xs text-ink">{a.nombre || (a.tipo === "pdf" ? "Documento" : "Foto")}</span>
              <a href="#" onClick={async (e) => { e.preventDefault();
                    const u = await fetchAuthBlobUrl(`/api/colaboradores/diagramas/${did}/media/${a.id}`);
                    if (u) window.open(u, "_blank"); }}
                 className="text-xs font-bold text-accent">Ver</a>
              <button type="button" onClick={() => editar({ adjuntos: adj.filter((_, j) => j !== i) })} className="px-1 text-red-500">×</button>
            </div>
          ))}
          {adj.length < 12 && (
            <label className="inline-block cursor-pointer text-xs font-bold text-accent">
              {subiendo ? "Subiendo…" : "＋ foto o factura (PDF)"}
              <input type="file" accept="image/*,application/pdf" className="hidden"
                     onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = "";
                       if (f) { const a = await subir(f); if (a) editar({ adjuntos: [...adj, a] }); } }} />
            </label>
          )}
        </div>
      </details>
    </div>
  );
}

// ─── Producto y competencia: datos reales en vez de pasos genéricos ──────────

function ProductoEditor({ did, nd, editar, subir, subiendo }: {
  did: number; nd: NodoDoc; editar: (c: Partial<NodoDoc>) => void; subir: Subir; subiendo: boolean;
}) {
  const comps = nd.componentes ?? [];
  const moneda: Moneda = nd.precio?.moneda ?? "COP";
  const costo = costoProducto(nd);
  const m = margenDe(nd);
  const setComp = (i: number, cambio: Partial<Componente>) =>
    editar({ componentes: comps.map((c, j) => (j === i ? { ...c, ...cambio } : c)) });
  const aDinero = (txt: string): Dinero | undefined => {
    const n = Number(txt.replace(/[^\d.]/g, ""));
    return txt.trim() === "" || !isFinite(n) ? undefined : { monto: n, moneda };
  };
  return (
    <div className="space-y-2 border-t border-border pt-2">
      <FotoCampo did={did} nd={nd} editar={editar} subir={subir} subiendo={subiendo} texto="Foto de la publicación" />
      <input placeholder="SKU (ej. C-COLLAR-M)" value={nd.sku ?? ""} autoCapitalize="characters"
             onChange={(e) => editar({ sku: e.target.value })} className={INP} />
      <DineroCampo etq="Precio" valor={nd.precio} onCambio={(d) => editar({ precio: d })} />
      <UrlCampo valor={nd.url} onCambio={(u) => editar({ url: u })} ph="Enlace a la publicación (https://…)" />

      <div className="space-y-1 rounded border border-border p-2">
        <p className="px-t flex items-center gap-1 text-xs font-bold text-muted"><Sprite s="cofre" px={2} /> Empaque</p>
        <input placeholder="Qué empaque (ej. bolsa kraft con visor)" value={nd.empaque?.nombre ?? ""}
               onChange={(e) => editar({ empaque: { ...nd.empaque, nombre: e.target.value } })} className={INP} />
        <DineroCampo etq="Costo" valor={nd.empaque?.costo}
                     onCambio={(d) => editar({ empaque: { nombre: nd.empaque?.nombre ?? "", costo: d } })} />
      </div>

      <div className="space-y-1 rounded border border-border p-2">
        <p className="px-t flex items-center gap-1 text-xs font-bold text-muted">
          <Sprite s="bloques" px={2} /> Receta: de qué está hecho ({comps.length})
        </p>
        {comps.map((c, i) => (
          <div key={i} className="flex gap-1">
            <input placeholder="pieza" value={c.nombre} onChange={(e) => setComp(i, { nombre: e.target.value })}
                   className={`${MINI} min-w-0 flex-1`} />
            <input placeholder="cant." value={c.cantidad ?? ""} onChange={(e) => setComp(i, { cantidad: e.target.value })}
                   className={`${MINI} w-16`} />
            <input placeholder="costo" inputMode="numeric" value={c.costo?.monto ?? ""}
                   onChange={(e) => setComp(i, { costo: aDinero(e.target.value) })} className={`${MINI} w-20 tabular-nums`} />
            <button type="button" onClick={() => editar({ componentes: comps.filter((_, j) => j !== i) })}
                    className="px-1 text-red-500" aria-label="Quitar pieza">×</button>
          </div>
        ))}
        {comps.length < 12 && (
          <button type="button" onClick={() => editar({ componentes: [...comps, { nombre: "" }] })}
                  className="text-xs font-bold text-accent">＋ pieza</button>
        )}
        <p className="text-[11px] text-muted">El costo de cada pieza es lo que gasta UNA unidad del producto, en {moneda}.</p>
      </div>

      <div className="space-y-0.5 rounded border border-border bg-surface-input p-2 text-sm text-ink">
        <p className="flex items-center gap-1"><Sprite s="bolsa" px={2} /> Costo por unidad: <b>{costo ? plata(costo) : "—"}</b></p>
        <p className="flex items-center gap-1">
          <Sprite s="estrella" px={2} /> Margen:{" "}
          <b style={{ color: m ? (m.monto >= 0 ? "#008751" : "#FF004D") : undefined }}>
            {m ? `${plata({ monto: m.monto, moneda: m.moneda })} (${Math.round(m.pct)} %)` : "falta el precio o el costo"}
          </b>
        </p>
      </div>

      <details>
        <summary className="cursor-pointer text-xs font-bold text-muted">Más: tiempo, datos, facturas, escenarios</summary>
        <div className="mt-1">
          <ContenidoCaja extras did={did} nd={nd} editar={editar} subir={subir} subiendo={subiendo} />
        </div>
      </details>
    </div>
  );
}

function CompetenciaEditor({ did, nd, editar, subir, subiendo, vs }: {
  did: number; nd: NodoDoc; editar: (c: Partial<NodoDoc>) => void; subir: Subir; subiendo: boolean;
  vs?: { nombre: string; pct: number };
}) {
  return (
    <div className="space-y-2 border-t border-border pt-2">
      <FotoCampo did={did} nd={nd} editar={editar} subir={subir} subiendo={subiendo} texto="Captura de su publicación" />
      <input placeholder="Dónde vende (marketplace, Instagram, tienda propia…)" value={nd.plataforma ?? ""}
             onChange={(e) => editar({ plataforma: e.target.value })} className={INP} />
      <UrlCampo valor={nd.url} onCambio={(u) => editar({ url: u })} ph="Enlace a su publicación (https://…)" />
      <DineroCampo etq="Su precio" valor={nd.precio} onCambio={(d) => editar({ precio: d })} />
      {vs ? (
        <p className="flex items-center gap-1 rounded border border-border bg-surface-input p-2 text-sm"
           style={{ color: vs.pct > 0.5 ? "#008751" : vs.pct < -0.5 ? "#FF004D" : undefined }}>
          <Sprite s="bandera" px={2} /> {textoVs(vs)}
        </p>
      ) : (
        <p className="text-[11px] text-muted">Únelo con una flecha a tu producto para comparar precios (en la misma moneda).</p>
      )}
      <details>
        <summary className="cursor-pointer text-xs font-bold text-muted">Datos del rival: envío, calificación, ventas, capturas…</summary>
        <div className="mt-1">
          <ContenidoCaja extras did={did} nd={nd} editar={editar} subir={subir} subiendo={subiendo} />
        </div>
      </details>
    </div>
  );
}

// ─── Consenso: propuestas, votos 👍 y desempate por turno ─────────────────────

function ConsensoEditor({ nd, yoId, participantes, turnoActual, editarAsunto, correr }: {
  nd: NodoDoc; yoId: number; participantes: Record<string, string>; turnoActual?: number | null;
  editarAsunto: (v: string) => void; correr: (accion: string, extra?: { texto?: string; propuesta?: string }) => Promise<void>;
}) {
  const props = nd.propuestas ?? [];
  const votos = nd.votos ?? {};
  const resuelto = nd.resuelto;
  const nombre = (uid?: number) => (uid != null && participantes[String(uid)]) || `#${uid ?? "?"}`;
  const miPropuesta = props.find((p) => p.autor === yoId || p.id === `p${yoId}`);
  const [miTexto, setMiTexto] = useState(miPropuesta?.texto ?? "");
  useEffect(() => { setMiTexto(miPropuesta?.texto ?? ""); }, [miPropuesta?.texto]);
  const [ocupado, setOcupado] = useState(false);
  const acto = async (accion: string, extra?: { texto?: string; propuesta?: string }) => {
    setOcupado(true); try { await correr(accion, extra); } finally { setOcupado(false); }
  };
  const votosDe = (pid: string) => Object.entries(votos).filter(([, v]) => v === pid).map(([u]) => Number(u));
  const miVoto = votos[String(yoId)];
  const empatePosible = props.length > 1;

  return (
    <div className="space-y-2 border-t border-border pt-2">
      <textarea value={nd.asunto ?? ""} placeholder="¿Qué hay que decidir? (ej. ¿bolsa o caja para el empaque?)"
                onChange={(e) => editarAsunto(e.target.value)} rows={2}
                className={`${INP} resize-none`} />

      {resuelto ? (
        <div className="rounded-lg border border-emerald-400 bg-emerald-50 p-2 text-sm">
          <p className="flex items-center gap-1.5 font-bold text-emerald-800">
            <Sprite s="trofeo" px={2} /> Decidido: {props.find((p) => p.id === resuelto.propuesta)?.texto ?? "—"}
          </p>
          <p className="text-xs text-emerald-700">
            {resuelto.modo === "turno" ? `Por turno de ${nombre(resuelto.por)} (empate)` : "Por acuerdo de los votos"}
          </p>
          <button type="button" disabled={ocupado} onClick={() => void acto("reabrir")}
                  className="mt-1 text-xs font-bold text-accent disabled:opacity-40">Reabrir para volver a votar</button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted">
            {empatePosible ? `Si hay empate, desempata ${nombre(turnoActual ?? Number(Object.keys(participantes)[0]))} (turno)` : "Cada quien propone y ambos votan"}
          </span>
          <button type="button" disabled={ocupado || !props.length} onClick={() => void acto("cerrar")}
                  className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm font-bold text-white disabled:opacity-40">Cerrar y decidir</button>
        </div>
      )}

      {/* Mi propuesta */}
      <div className="rounded-lg border border-border p-2">
        <p className="text-xs font-bold text-muted">Mi propuesta</p>
        <textarea value={miTexto} placeholder="Escribe tu solución para este asunto…" rows={2}
                  onChange={(e) => setMiTexto(e.target.value)} className={`${INP} mt-1 resize-none`} />
        <div className="mt-1 flex gap-2">
          <button type="button" disabled={ocupado || miTexto.trim() === (miPropuesta?.texto ?? "")}
                  onClick={() => void acto("proponer", { texto: miTexto })}
                  className="rounded-lg bg-accent px-2.5 py-1 text-xs font-bold text-white disabled:opacity-40">
            {miPropuesta ? "Actualizar" : "Poner mi propuesta"}
          </button>
          {miPropuesta && (
            <button type="button" disabled={ocupado} onClick={() => { setMiTexto(""); void acto("proponer", { texto: "" }); }}
                    className="text-xs font-bold text-red-500 disabled:opacity-40">Retirar</button>
          )}
        </div>
      </div>

      {/* Las propuestas sobre la mesa, con votos */}
      <div className="space-y-1.5">
        {props.length === 0 && <p className="text-xs text-muted">Aún no hay propuestas. Pon la tuya y pídele la suya al otro.</p>}
        {props.map((p) => {
          const votantes = votosDe(p.id);
          const yoVote = miVoto === p.id;
          const ganadora = resuelto?.propuesta === p.id;
          return (
            <div key={p.id} className={`rounded-lg border p-2 ${ganadora ? "border-emerald-400 bg-emerald-50" : "border-border"}`}>
              <p className="text-[11px] font-bold uppercase text-muted">{nombre(p.autor)}</p>
              <p className="text-sm text-ink">{p.texto}</p>
              <div className="mt-1 flex items-center gap-2">
                <button type="button" disabled={ocupado} onClick={() => void acto(yoVote ? "quitar_voto" : "votar", { propuesta: p.id })}
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold ${yoVote ? "border-emerald-500 bg-emerald-100 text-emerald-700" : "border-border text-muted"} disabled:opacity-40`}>
                  <Sprite s="pulgar" px={2} /> {yoVote ? "mi voto" : "votar"}
                </button>
                <span className="text-xs text-muted">
                  {votantes.length ? `${votantes.length} voto${votantes.length === 1 ? "" : "s"}: ${votantes.map(nombre).join(", ")}` : "sin votos"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Editor ─────────────────────────────────────────────────────────────────

type Estado = { tipo: "ok" | "guardando" | "pendiente" | "aviso" | "error"; texto: string };

function Editor({ inicial, yo, onVolver }: { inicial: Diagrama; yo?: { id: number; nombre: string }; onVolver: () => void }) {
  const qc = useQueryClient();
  const rf = useReactFlow();
  const [meta, setMeta] = useState<{ turno?: number | null; participantes: Record<string, string> }>(
    { turno: inicial.turno_actual, participantes: inicial.participantes ?? {} });
  const [nodes, setNodes] = useState<Node[]>(() => aFlow(inicial.doc).nodes);
  const [edges, setEdges] = useState<Edge[]>(() => aFlow(inicial.doc).edges);
  const [titulo, setTitulo] = useState(inicial.titulo);
  const version = useRef(inicial.version);
  const base = useRef<Doc>(inicial.doc);               // lo último que coincide con el servidor
  const sucio = useRef(false);
  const arrastrando = useRef(false);
  const timer = useRef<number | null>(null);
  const [estado, setEstado] = useState<Estado>({ tipo: "ok", texto: `Versión ${inicial.version}` });
  const [sel, setSel] = useState<{ tipo: "nodo" | "flecha"; id: string } | null>(null);
  const [uniendoDesde, setUniendoDesde] = useState<string | null>(null);
  const [verHistorial, setVerHistorial] = useState(false);
  const [archifyUrl, setArchifyUrl] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);
  // En el celular el cabezote (flujo + pestañas) se come media pantalla y el lienzo
  // quedaba recortado: «pantalla completa» lo saca del layout sin salir del panel.
  const [pleno, setPleno] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches,
  );
  useEffect(() => {
    if (!pleno) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setPleno(false); };  // la hoja se cierra con su ✕
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [pleno]);
  // Pixel art por defecto; «Clásico» lo apaga. Es una preferencia de cada quien.
  // Tablero (el diagrama) o Edificio (la obra: cada paso es un piso que se construye al llenarlo).
  const [vista, setVista] = useState<"tablero" | "edificio">(() => {
    try { return localStorage.getItem("colab-vista") === "edificio" ? "edificio" : "tablero"; } catch { return "tablero"; }
  });
  const cambiarVista = (v: "tablero" | "edificio") => {
    setVista(v);
    try { localStorage.setItem("colab-vista", v); } catch { /* sin almacenamiento: vale por la visita */ }
  };
  const [pixel, setPixel] = useState(() => {
    try { return localStorage.getItem("colab-pixel") !== "0"; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem("colab-pixel", pixel ? "1" : "0"); } catch { /* sin almacenamiento: vale por la visita */ }
  }, [pixel]);

  const aplicarRemoto = useCallback((d: Diagrama, aviso?: string) => {
    const f = aFlow(d.doc);
    setNodes(f.nodes);
    setEdges(f.edges);
    setTitulo(d.titulo);
    version.current = d.version;
    base.current = d.doc;
    sucio.current = false;
    setMeta({ turno: d.turno_actual, participantes: d.participantes ?? {} });
    setEstado({ tipo: aviso ? "aviso" : "ok", texto: aviso ?? `Versión ${d.version}` });
  }, []);

  const guardar = useCallback(async () => {
    if (!sucio.current || arrastrando.current) return;
    const local = aDoc(rf.getNodes(), rf.getEdges());
    setEstado({ tipo: "guardando", texto: "Guardando…" });
    try {
      const r = await api.put<Diagrama>(`/api/colaboradores/diagramas/${inicial.id}`,
        { doc: local, version: version.current, titulo });
      version.current = r.version;
      base.current = local;
      sucio.current = false;
      setEstado({ tipo: "ok", texto: `Guardado · versión ${r.version}` });
      void qc.invalidateQueries({ queryKey: ["colab-diagramas"] });
    } catch (e) {
      if ((e as Error).message === "conflicto") {
        // El otro guardó mientras editabas: se combinan los dos y se guarda encima de lo suyo.
        const remoto = await api.get<Diagrama>(`/api/colaboradores/diagramas/${inicial.id}`);
        const mezcla = combinar(base.current, local, remoto.doc);
        const f = aFlow(mezcla);
        setNodes(f.nodes);
        setEdges(f.edges);
        version.current = remoto.version;
        base.current = remoto.doc;
        sucio.current = true;
        setEstado({ tipo: "aviso", texto: `${remoto.actualizado_por_nombre || "El otro"} también editó: se combinaron los cambios` });
        window.setTimeout(() => void guardar(), 300);
      } else {
        setEstado({ tipo: "error", texto: (e as Error).message || "No se pudo guardar" });
      }
    }
  }, [inicial.id, qc, rf, titulo]);

  const marcarCambio = useCallback(() => {
    sucio.current = true;
    setEstado({ tipo: "pendiente", texto: "Cambios sin guardar…" });
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void guardar(), 1200);
  }, [guardar]);

  // Lo que el otro guarda llega cada 3 s (si aquí no hay cambios pendientes).
  useEffect(() => {
    const id = window.setInterval(async () => {
      if (sucio.current || arrastrando.current || document.hidden) return;
      try {
        const d = await api.get<Diagrama>(`/api/colaboradores/diagramas/${inicial.id}`);
        if (d.version > version.current && !sucio.current) {
          aplicarRemoto(d, `${d.actualizado_por_nombre || "El otro"} actualizó el diagrama · versión ${d.version}`);
        }
      } catch { /* sin red: se reintenta en el próximo ciclo */ }
    }, 3000);
    return () => window.clearInterval(id);
  }, [inicial.id, aplicarRemoto]);

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const onNodesChange = useCallback((cambios: NodeChange[]) => {
    setNodes((ns) => applyNodeChanges(cambios, ns));
    const mueve = cambios.find((c) => c.type === "position");
    if (mueve && mueve.type === "position") {
      arrastrando.current = Boolean(mueve.dragging);
      if (!mueve.dragging) marcarCambio();
    }
    if (cambios.some((c) => c.type === "remove")) marcarCambio();
  }, [marcarCambio]);

  const onEdgesChange = useCallback((cambios: EdgeChange[]) => {
    setEdges((es) => applyEdgeChanges(cambios, es));
    if (cambios.some((c) => c.type === "remove")) marcarCambio();
  }, [marcarCambio]);

  const unir = useCallback((desde: string, hasta: string, desdeLado: Lado = "r", hastaLado: Lado = "l") => {
    if (desde === hasta) return;
    // La flecha nace RECTA (los tableros se leen mejor así).
    const nueva: FlechaDoc = { id: nuevoId("f"), from: desde, to: hasta, label: "",
                               fromLado: desdeLado, toLado: hastaLado, forma: "recta" };
    let creada = false;
    setEdges((es) => {
      if (es.some((e) => e.source === desde && e.target === hasta)) return es;
      creada = true;
      return [...es, {
        id: nueva.id, source: desde, target: hasta, sourceHandle: desdeLado, targetHandle: hastaLado,
        reconnectable: true,
        data: { label: "", color: undefined, grosor: undefined, trazo: undefined, forma: "recta" as Forma },
        ...pintar(nueva),
      }];
    });
    marcarCambio();
    // Se abre la flecha nueva para ponerle nombre de una vez ("paga", "entrega"…).
    if (creada) setSel({ tipo: "flecha", id: nueva.id });
  }, [marcarCambio]);

  const onConnect = useCallback((c: Connection) => {
    if (c.source && c.target) unir(c.source, c.target, (c.sourceHandle as Lado) || "r", (c.targetHandle as Lado) || "l");
  }, [unir]);

  // Arrastrar la punta de una flecha a otra caja (o a otro lado de la misma).
  const onReconnect = useCallback((vieja: Edge, nueva: Connection) => {
    setEdges((es) => reconnectEdge(vieja, nueva, es));
    marcarCambio();
  }, [marcarCambio]);

  function agregarCaja(tipo: Tipo = "accion") {
    const centro = rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const id = nuevoId("c");
    const label = { producto: "Nuevo producto", competencia: "Competidor", consenso: "¿Qué decidimos?" }[tipo as string] ?? "Nuevo paso";
    const ancho = tipo === "producto" ? 160 : tipo === "competencia" ? 110 : 80;
    setNodes((ns) => [...ns, { id, type: "caja", position: { x: centro.x - ancho, y: centro.y - 30 },
      data: { id, label, sublabel: "", tipo, carril: "conjunto", x: 0, y: 0 } }]);
    setSel({ tipo: "nodo", id });
    marcarCambio();
  }

  function editarNodo(id: string, cambios: Partial<NodoDoc>) {
    setNodes((ns) => ns.map((n) => n.id === id ? { ...n, data: { ...n.data, ...cambios } } : n));
    marcarCambio();
  }

  const [subiendo, setSubiendo] = useState(false);
  /** Sube una foto o factura al diagrama y devuelve su ficha (id, tipo, nombre). */
  async function subirMedia(file: File): Promise<Adjunto | null> {
    setSubiendo(true);
    try {
      const form = new FormData();
      form.append("archivo", file);
      const r = await api.upload<Adjunto>(`/api/colaboradores/diagramas/${inicial.id}/media`, form);
      return r;
    } catch (e) {
      setEstado({ tipo: "error", texto: (e as Error).message || "No se pudo subir el archivo" });
      return null;
    } finally {
      setSubiendo(false);
    }
  }

  function todasRectas() {
    setEdges((es) => es.map((e) => ({ ...e, data: { ...(e.data as object), forma: "recta" as Forma } })));
    marcarCambio();
  }

  /** Vota/propone/cierra un consenso. El servidor manda (el voto es del usuario
   *  autenticado y el desempate alterna el turno); aquí solo se aplica lo que vuelve. */
  const correrConsenso = useCallback(async (nodoId: string, accion: string, extra?: { texto?: string; propuesta?: string }) => {
    if (sucio.current) { try { await guardar(); } catch { /* el asunto tipeado se reintenta solo */ } }
    try {
      const d = await api.post<Diagrama>(`/api/colaboradores/diagramas/${inicial.id}/consenso`,
        { nodo: nodoId, accion, ...extra });
      aplicarRemoto(d);
    } catch (e) {
      setEstado({ tipo: "error", texto: (e as Error).message || "No se pudo registrar" });
    }
  }, [inicial.id, guardar, aplicarRemoto]);

  function editarFlecha(id: string, cambios: Partial<FlechaDoc>) {
    setEdges((es) => es.map((e) => {
      if (e.id !== id) return e;
      const d = { ...(e.data as Partial<FlechaDoc>), ...cambios };
      const doc: FlechaDoc = {
        id: e.id, from: e.source, to: e.target, ...d,
        fromLado: (cambios.fromLado ?? (e.sourceHandle as Lado)) || "r",
        toLado: (cambios.toLado ?? (e.targetHandle as Lado)) || "l",
      };
      return { ...e, sourceHandle: doc.fromLado, targetHandle: doc.toLado,
               label: doc.label || undefined, data: d, ...pintar(doc) };
    }));
    marcarCambio();
  }

  function borrarSeleccion() {
    if (!sel) return;
    if (sel.tipo === "nodo") {
      setNodes((ns) => ns.filter((n) => n.id !== sel.id));
      setEdges((es) => es.filter((e) => e.source !== sel.id && e.target !== sel.id));
    } else {
      setEdges((es) => es.filter((e) => e.id !== sel.id));
    }
    setSel(null);
    marcarCambio();
  }

  async function exportarArchify() {
    setExportando(true);
    try {
      if (sucio.current) await guardar();
      const r = await api.post<{ version: number }>(`/api/colaboradores/diagramas/${inicial.id}/archify`, {});
      const url = await fetchAuthBlobUrl(`/api/colaboradores/diagramas/${inicial.id}/archify/${r.version}`);
      if (url) setArchifyUrl(url);
    } catch (e) {
      setEstado({ tipo: "error", texto: (e as Error).message });
    } finally {
      setExportando(false);
    }
  }

  const nodoSel = sel?.tipo === "nodo" ? nodes.find((n) => n.id === sel.id) : undefined;
  const flechaSel = sel?.tipo === "flecha" ? edges.find((e) => e.id === sel.id) : undefined;
  // Lo que se calcula para dibujar (nunca se guarda): un rival y un producto
  // unidos por una flecha, en cualquier sentido, se comparan por precio si están
  // en la misma moneda.
  const nodosVista = useMemo(() => {
    const porId = new Map(nodes.map((n) => [n.id, n.data as NodoDoc]));
    const vecinos = new Map<string, string[]>();
    const enlazar = (a: string, b: string) => { const l = vecinos.get(a); if (l) l.push(b); else vecinos.set(a, [b]); };
    for (const e of edges) { enlazar(e.source, e.target); enlazar(e.target, e.source); }
    const vecinosDe = (id: string, tipo: Tipo) =>
      (vecinos.get(id) ?? []).map((v) => porId.get(v)).filter((x): x is NodoDoc => x?.tipo === tipo);
    return nodes.map((n) => {
      const d = n.data as NodoDoc;
      const extra: Partial<NodoVista> = { uniendo: n.id === uniendoDesde };
      if (d.tipo === "competencia" && d.precio) {
        const precio = d.precio;
        const p = vecinosDe(n.id, "producto").find((x) => x.precio && x.precio.moneda === precio.moneda && x.precio.monto > 0);
        if (p?.precio) extra._vs = { nombre: p.label, pct: ((precio.monto - p.precio.monto) / p.precio.monto) * 100 };
      }
      if (d.tipo === "producto") {
        const rivales = vecinosDe(n.id, "competencia");
        if (rivales.length) {
          const moneda = d.precio?.moneda ?? rivales.find((r) => r.precio)?.precio?.moneda;
          const precios = rivales.filter((r) => r.precio && r.precio.moneda === moneda).map((r) => r.precio!.monto);
          extra._rivales = { n: rivales.length, moneda,
                             min: precios.length ? Math.min(...precios) : null, max: precios.length ? Math.max(...precios) : null };
        }
      }
      return { ...n, data: { ...d, ...extra } };
    });
  }, [nodes, edges, uniendoDesde]);

  // El marcador: cuánto tiempo y dinero lleva invertido el proyecto, y quién puso cuánto.
  const totales = useMemo(() => {
    let tiempo = 0, pendientes = 0, productos = 0, rivales = 0;
    const plataT: Record<string, number> = {};
    const porCarril: Partial<Record<Carril, { tiempo: number; plata: Record<string, number> }>> = {};
    for (const n of nodes) {
      const d = n.data as NodoDoc;
      if (d.tipo === "consenso" && !d.resuelto) pendientes++;
      // El precio y el costo de un producto o de un rival son por unidad: no es lo invertido.
      if (d.tipo === "producto") { productos++; continue; }
      if (d.tipo === "competencia") { rivales++; continue; }
      if (!d.tiempo_min && !d.costo) continue;
      const pc = porCarril[d.carril] ?? (porCarril[d.carril] = { tiempo: 0, plata: {} });
      if (d.tiempo_min) { tiempo += d.tiempo_min; pc.tiempo += d.tiempo_min; }
      if (d.costo) {
        plataT[d.costo.moneda] = (plataT[d.costo.moneda] ?? 0) + d.costo.monto;
        pc.plata[d.costo.moneda] = (pc.plata[d.costo.moneda] ?? 0) + d.costo.monto;
      }
    }
    return { tiempo, plata: plataT, porCarril, pendientes, productos, rivales };
  }, [nodes]);
  const hayMarcador = totales.tiempo > 0 || Object.keys(totales.plata).length > 0
    || totales.pendientes > 0 || totales.productos > 0 || totales.rivales > 0;

  const colorEstado = { ok: "text-emerald-600", guardando: "text-muted", pendiente: "text-amber-600",
                        aviso: "text-sky-600", error: "text-red-500" }[estado.tipo];
  const colorEstadoPixel = { ok: "#00E436", guardando: "#C2C3C7", pendiente: "#FFA300",
                             aviso: "#29ADFF", error: "#FF004D" }[estado.tipo];
  const BTN = "px-btn shrink-0 rounded-lg border border-border px-3 py-1.5 text-sm font-bold text-ink";

  return (
    <DidCtx.Provider value={inicial.id}>
    <PixelCtx.Provider value={pixel}>
    <TocarFlechaCtx.Provider value={(id) => setSel({ tipo: "flecha", id })}>
    <div
      className={`${pleno
        ? "fixed inset-0 z-40 flex h-[100dvh] flex-col gap-2 bg-surface p-2"
        : "flex min-h-0 flex-1 flex-col gap-2"} ${pixel ? "colab-pixel" : ""}`}
      style={pleno ? { paddingTop: "max(0.5rem, env(safe-area-inset-top, 0px))" } : undefined}
    >
      <div className={`flex min-w-0 items-center gap-2 ${pixel ? "px-hud" : ""}`}>
        <button type="button" onClick={() => { void guardar(); onVolver(); }}
                className="shrink-0 rounded-lg border border-border px-2 py-1 text-sm font-bold text-muted">←</button>
        {pixel && <Sprite s="control" px={2} titulo="Tablero del proyecto" />}
        <input value={titulo} onChange={(e) => { setTitulo(e.target.value); marcarCambio(); }}
               className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 text-base font-bold text-ink focus:border-border" />
        <span className={`min-w-0 max-w-[38%] shrink-0 truncate text-xs ${pixel ? "px-t" : colorEstado}`}
              style={pixel ? { color: colorEstadoPixel, fontSize: 11 } : undefined}>{estado.texto}</span>
        <button type="button" onClick={() => setPleno((v) => !v)}
                title={pleno ? "Salir de pantalla completa" : "Pantalla completa"}
                aria-label={pleno ? "Salir de pantalla completa" : "Pantalla completa"}
                className="shrink-0 rounded-lg border border-border px-2 py-1 text-sm font-bold text-muted">
          {pleno ? "⤡" : "⛶"}
        </button>
      </div>

      {hayMarcador && (
        <div className={`flex shrink-0 items-center gap-3 overflow-x-auto whitespace-nowrap px-2 py-1 text-xs ${
          pixel ? "px-marcador" : "rounded-lg border border-border bg-surface-panel text-ink"}`}>
          {Object.entries(totales.plata).map(([mon, v]) => (
            <span key={mon} className="inline-flex items-center gap-1" title="Dinero invertido en los pasos">
              <Sprite s="bolsa" px={2} />{plata({ monto: v, moneda: mon as Moneda })}
            </span>
          ))}
          {totales.tiempo > 0 && (
            <span className="inline-flex items-center gap-1" title="Tiempo invertido en los pasos">
              <Sprite s="reloj" px={2} />{tiempoTexto(totales.tiempo)}
            </span>
          )}
          {totales.pendientes > 0 && (
            <span className="inline-flex items-center gap-1" title="Decisiones por votar">
              <Sprite s="urna" px={2} />{totales.pendientes} por decidir
            </span>
          )}
          {totales.productos > 0 && (
            <span className="inline-flex items-center gap-1" title="Productos en el tablero"><Sprite s="gema" px={2} />{totales.productos}</span>
          )}
          {totales.rivales > 0 && (
            <span className="inline-flex items-center gap-1" title="Competidores en el tablero"><Sprite s="bandera" px={2} />{totales.rivales}</span>
          )}
          {(Object.keys(totales.porCarril) as Carril[]).map((c) => {
            const pc = totales.porCarril[c]!;
            const partes = [pc.tiempo ? tiempoTexto(pc.tiempo) : "",
              ...Object.entries(pc.plata).map(([mon, v]) => plataCorta({ monto: v, moneda: mon as Moneda }))].filter(Boolean);
            return (
              <span key={c} className="inline-flex items-center gap-1" title={`Lo que puso ${CARRILES[c]}`}>
                <Sprite s="jugador" px={2} colores={{ X: COLOR_CARRIL[c] }} />
                {CARRILES[c].split(" ")[0]}: {partes.join(" · ")}
              </span>
            );
          })}
        </div>
      )}

      {/* Una sola fila que se desliza: al envolverse, cada renglón le quitaba alto al lienzo.
          pb/pr: el overflow recortaría la sombra dura de los botones pixel. */}
      <div className="flex shrink-0 gap-1.5 overflow-x-auto pb-1 pr-1">
        <button type="button" onClick={() => agregarCaja()}
                className="px-btn shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm font-bold text-white">＋ Caja</button>
        <button type="button" onClick={() => agregarCaja("producto")} className={`${BTN} inline-flex items-center gap-1`}>
          <Sprite s="gema" px={2} /> Producto
        </button>
        <button type="button" onClick={() => agregarCaja("competencia")} className={`${BTN} inline-flex items-center gap-1`}>
          <Sprite s="bandera" px={2} /> Rival
        </button>
        <button type="button" onClick={() => agregarCaja("consenso")} className={`${BTN} inline-flex items-center gap-1`}>
          <Sprite s="urna" px={2} /> Consenso
        </button>
        <span className="inline-flex shrink-0 gap-1" role="group" aria-label="Cómo ver el proyecto">
          <button type="button" onClick={() => cambiarVista("tablero")} aria-pressed={vista === "tablero"}
                  className={`${BTN} ${vista === "tablero" ? "!bg-accent !text-white" : ""}`}>Tablero</button>
          <button type="button" onClick={() => cambiarVista("edificio")} aria-pressed={vista === "edificio"}
                  title="Cada paso es un piso: se construye a medida que lo llenan"
                  className={`${BTN} inline-flex items-center gap-1 ${vista === "edificio" ? "!bg-accent !text-white" : ""}`}>
            <Sprite s="bloques" px={2} /> Edificio
          </button>
        </span>
        <button type="button" onClick={() => setVerHistorial(true)} className={BTN}>Historial</button>
        <button type="button" onClick={todasRectas} title="Volver rectas todas las flechas" className={BTN}>Rectas</button>
        <button type="button" onClick={() => void exportarArchify()} disabled={exportando} className={`${BTN} disabled:opacity-40`}>
          {exportando ? "Generando…" : "Ver en Archify"}
        </button>
        <button type="button" onClick={() => setPixel((v) => !v)} className={`${BTN} inline-flex items-center gap-1`}
                title={pixel ? "Volver al aspecto clásico" : "Aspecto de videojuego"}>
          <Sprite s="control" px={2} /> {pixel ? "Clásico" : "Pixel"}
        </button>
        {sel && (
          <button type="button" onClick={borrarSeleccion}
                  className="px-btn shrink-0 rounded-lg border border-red-400 px-3 py-1.5 text-sm font-bold text-red-500">
            Borrar {sel.tipo === "nodo" ? "caja" : "flecha"}
          </button>
        )}
        {uniendoDesde && (
          <span className="shrink-0 rounded-lg bg-accent/10 px-2 py-1.5 text-xs font-bold text-accent">
            Toca la caja de destino… <button type="button" className="ml-1 underline" onClick={() => setUniendoDesde(null)}>cancelar</button>
          </span>
        )}
      </div>

      <div className={`relative min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-white ${pixel ? "px-lienzo" : ""}`}>
        {vista === "edificio" ? (
          <EdificioProyecto
            nodos={nodes.map((n) => n.data as NodoDoc)}
            flechas={edges.map((e) => ({ from: e.source, to: e.target }))}
            selId={sel?.tipo === "nodo" ? sel.id : null}
            onTocar={(id) => setSel({ tipo: "nodo", id })}
            nombreCarril={(c) => CARRILES[c as Carril] ?? c}
            colorCarril={(c) => COLOR_CARRIL[c as Carril] ?? "#374151"}
            nombreTipo={(t) => TIPOS[t as Tipo]?.label ?? t}
            foto={(mid) => <AuthImg did={inicial.id} mid={mid} className="h-full w-full object-cover" alt="" />}
          />
        ) : (
        <ReactFlow
          nodes={nodosVista} edges={edges} nodeTypes={TIPOS_NODO} edgeTypes={TIPOS_FLECHA}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
          onNodeClick={(_, n) => {
            if (uniendoDesde) { unir(uniendoDesde, n.id); setUniendoDesde(null); return; }
            setSel({ tipo: "nodo", id: n.id });
          }}
          onEdgeClick={(_, e) => setSel({ tipo: "flecha", id: e.id })}
          onPaneClick={() => { setSel(null); setUniendoDesde(null); }}
          onReconnect={onReconnect} reconnectRadius={26} connectionMode={ConnectionMode.Loose}
          connectOnClick fitView minZoom={0.2} maxZoom={2.5} deleteKeyCode={["Delete", "Backspace"]}
          proOptions={{ hideAttribution: true }}
        >
          {pixel
            ? <Background gap={24} variant={BackgroundVariant.Lines} color="#F3DDCB" />
            : <Background gap={20} />}
          <Controls showInteractive={false} position="top-left" />
        </ReactFlow>
        )}
      {/* Hoja FIJA sobre la pantalla (no dentro del lienzo): pegada al lienzo se
          recortaba cuando el lienzo era bajo, y sin scroll de página no se alcanzaba. */}
        {nodoSel && (
        <>
        <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setSel(null)} aria-hidden="true" />
        <div className="px-hoja fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[72dvh] w-full max-w-lg space-y-2 overflow-y-auto rounded-t-2xl border border-border bg-surface-panel p-3 shadow-2xl sm:bottom-3 sm:rounded-2xl"
             style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}>
          <div className="flex items-center justify-between">
            <p className="px-t text-xs font-bold uppercase text-muted">
              {{ producto: "Editar producto", competencia: "Editar rival", consenso: "Editar consenso" }[
                (nodoSel.data as NodoDoc).tipo as string] ?? "Editar caja"}
            </p>
            <button type="button" onClick={() => setSel(null)} className="px-1 text-lg leading-none text-muted" aria-label="Cerrar">×</button>
          </div>
          <input value={(nodoSel.data as NodoDoc).label}
                 placeholder={{ producto: "Nombre del producto", competencia: "Nombre del competidor o de su producto",
                                consenso: "Título de la decisión" }[(nodoSel.data as NodoDoc).tipo as string] ?? "¿Qué pasa en este paso?"}
                 onChange={(e) => editarNodo(nodoSel.id, { label: e.target.value })}
                 className="w-full rounded border border-border bg-surface-input px-2 py-1.5 text-sm font-bold text-ink" />
          <input value={(nodoSel.data as NodoDoc).sublabel || ""} placeholder="Detalle (opcional)"
                 onChange={(e) => editarNodo(nodoSel.id, { sublabel: e.target.value })}
                 className="w-full rounded border border-border bg-surface-input px-2 py-1.5 text-sm text-ink" />
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(TIPOS) as Tipo[]).map((t) => (
              <button key={t} type="button" onClick={() => editarNodo(nodoSel.id, { tipo: t })}
                      style={{ borderColor: TIPOS[t].borde, background: (nodoSel.data as NodoDoc).tipo === t ? TIPOS[t].fondo : undefined }}
                      className="rounded-full border-2 px-2 py-0.5 text-xs font-bold text-ink">{TIPOS[t].label}</button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-full text-xs text-muted">Lo hace (figura jurídica):</span>
            {(Object.keys(CARRILES) as Carril[]).map((c) => (
              <button key={c} type="button" onClick={() => editarNodo(nodoSel.id, { carril: c })}
                      className={`rounded-full border px-2 py-0.5 text-xs font-bold ${(nodoSel.data as NodoDoc).carril === c ? "border-accent bg-accent/10 text-accent" : "border-border text-muted"}`}>
                {CARRILES[c]}
              </button>
            ))}
          </div>
          {(nodoSel.data as NodoDoc).tipo === "consenso" ? (
            <ConsensoEditor nd={nodoSel.data as NodoDoc} yoId={yo?.id ?? 0}
                            participantes={meta.participantes} turnoActual={meta.turno}
                            editarAsunto={(v) => editarNodo(nodoSel.id, { asunto: v })}
                            correr={(accion, extra) => correrConsenso(nodoSel.id, accion, extra)} />
          ) : (nodoSel.data as NodoDoc).tipo === "producto" ? (
            <ProductoEditor did={inicial.id} nd={nodoSel.data as NodoDoc}
                            editar={(c) => editarNodo(nodoSel.id, c)} subir={subirMedia} subiendo={subiendo} />
          ) : (nodoSel.data as NodoDoc).tipo === "competencia" ? (
            <CompetenciaEditor did={inicial.id} nd={nodoSel.data as NodoDoc}
                               editar={(c) => editarNodo(nodoSel.id, c)} subir={subirMedia} subiendo={subiendo}
                               vs={(nodosVista.find((n) => n.id === nodoSel.id)?.data as NodoVista | undefined)?._vs} />
          ) : (
            <ContenidoCaja did={inicial.id} nd={nodoSel.data as NodoDoc}
                           editar={(c) => editarNodo(nodoSel.id, c)} subir={subirMedia} subiendo={subiendo} />
          )}
          <div className="flex gap-2 pb-1 pr-1">
            <button type="button" onClick={() => { setUniendoDesde(nodoSel.id); setSel(null); }}
                    className="px-btn flex-1 rounded-lg bg-accent px-3 py-1.5 text-sm font-bold text-white">➜ Unir con otra caja</button>
            <button type="button" onClick={borrarSeleccion}
                    className="px-btn rounded-lg border border-red-400 px-3 py-1.5 text-sm font-bold text-red-500">Borrar</button>
          </div>
        </div>
        </>
      )}
        {flechaSel && (
        <>
        <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setSel(null)} aria-hidden="true" />
        <div className="px-hoja fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[72dvh] w-full max-w-lg flex-wrap items-center gap-2 overflow-y-auto rounded-t-2xl border border-border bg-surface-panel p-3 shadow-2xl sm:bottom-3 sm:rounded-2xl"
             style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}>
          <div className="flex w-full items-center justify-between">
            <p className="px-t text-xs font-bold uppercase text-muted">Editar flecha</p>
            <button type="button" onClick={() => setSel(null)} className="px-1 text-lg leading-none text-muted" aria-label="Cerrar">×</button>
          </div>
          <input value={String((flechaSel.data as { label?: string })?.label || "")}
                 placeholder="Qué pasa en el medio (ej. paga, entrega, firma)"
                 onChange={(e) => editarFlecha(flechaSel.id, { label: e.target.value })}
                 className="w-full min-w-0 rounded border border-border bg-surface-input px-2 py-1.5 text-sm text-ink" />
          {/* Dónde toca cada caja: en el celular arrastrar la punta es imposible. */}
          <div className="flex w-full flex-wrap items-center gap-1.5">
            <span className="w-full text-xs text-muted">Sale de la caja por:</span>
            {LADOS.map((l) => (
              <button key={l.id} type="button" title={l.nombre}
                      onClick={() => editarFlecha(flechaSel.id, { fromLado: l.id })}
                      className={`h-8 w-9 rounded-lg border text-base font-bold ${(flechaSel.sourceHandle || "r") === l.id ? "border-accent bg-accent/10 text-accent" : "border-border text-muted"}`}>
                {l.icono}
              </button>
            ))}
          </div>
          <div className="flex w-full flex-wrap items-center gap-1.5">
            <span className="w-full text-xs text-muted">Entra a la otra por:</span>
            {LADOS.map((l) => (
              <button key={l.id} type="button" title={l.nombre}
                      onClick={() => editarFlecha(flechaSel.id, { toLado: l.id })}
                      className={`h-8 w-9 rounded-lg border text-base font-bold ${(flechaSel.targetHandle || "l") === l.id ? "border-accent bg-accent/10 text-accent" : "border-border text-muted"}`}>
                {l.icono}
              </button>
            ))}
          </div>
          <div className="flex w-full flex-wrap items-center gap-1.5">
            <span className="w-full text-xs text-muted">Color y grosor:</span>
            {COLORES_FLECHA.map((c) => (
              <button key={c} type="button" aria-label={`Color ${c}`}
                      onClick={() => editarFlecha(flechaSel.id, { color: c })}
                      style={{ background: c }}
                      className={`h-7 w-7 rounded-full border-2 ${((flechaSel.data as Partial<FlechaDoc>)?.color || COLORES_FLECHA[0]) === c ? "border-ink ring-2 ring-accent/50" : "border-white"}`} />
            ))}
            {GROSORES.map((g) => (
              <button key={g} type="button" aria-label={`Grosor ${g}`}
                      onClick={() => editarFlecha(flechaSel.id, { grosor: g })}
                      className={`flex h-7 w-9 items-center justify-center rounded-lg border ${(Number((flechaSel.data as Partial<FlechaDoc>)?.grosor) || 2) === g ? "border-accent bg-accent/10" : "border-border"}`}>
                <span className="w-5 rounded-full bg-ink" style={{ height: g }} />
              </button>
            ))}
          </div>
          <div className="flex w-full flex-wrap items-center gap-1.5">
            {TRAZOS.map((t) => (
              <button key={t.id} type="button" onClick={() => editarFlecha(flechaSel.id, { trazo: t.id })}
                      className={`rounded-full border px-2 py-0.5 text-xs font-bold ${((flechaSel.data as Partial<FlechaDoc>)?.trazo || "solida") === t.id ? "border-accent bg-accent/10 text-accent" : "border-border text-muted"}`}>
                {t.label}
              </button>
            ))}
            {FORMAS.map((f) => (
              <button key={f.id} type="button" onClick={() => editarFlecha(flechaSel.id, { forma: f.id })}
                      className={`rounded-full border px-2 py-0.5 text-xs font-bold ${((flechaSel.data as Partial<FlechaDoc>)?.forma || "curva") === f.id ? "border-accent bg-accent/10 text-accent" : "border-border text-muted"}`}>
                {f.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={borrarSeleccion}
                  className="w-full rounded-lg border border-red-400 px-3 py-1.5 text-sm font-bold text-red-500">Borrar flecha</button>
        </div>
        </>
      )}
        {!nodes.length && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted">
            Toca «＋ Caja» para el primer paso, «Producto» para lo que van a vender (foto, SKU, receta y precio),
            «Rival» para un competidor y «Consenso» para decidir votando. Únelas desde sus puntos o con «Unir con otra
            caja»; una flecha entre un rival y tu producto compara los precios.
          </p>
        )}
      </div>

      {verHistorial && (
        <Historial did={inicial.id} version={version.current}
                   onCerrar={() => setVerHistorial(false)}
                   onRestaurado={(d) => { aplicarRemoto(d, `Restaurada · versión ${d.version}`); setVerHistorial(false); }} />
      )}
      {archifyUrl && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/60 p-2 sm:p-6" onClick={() => setArchifyUrl(null)}>
          <div className="flex flex-1 flex-col overflow-hidden rounded-xl bg-white" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-3 py-2">
              <p className="text-sm font-bold text-gray-800">Versión Archify (solo lectura)</p>
              <div className="flex gap-2">
                <a href={archifyUrl} target="_blank" rel="noreferrer" className="text-sm font-bold text-accent">Abrir aparte</a>
                <button type="button" onClick={() => setArchifyUrl(null)} className="text-sm font-bold text-gray-600">Cerrar</button>
              </div>
            </div>
            <iframe title="Archify" src={archifyUrl} className="flex-1" />
          </div>
        </div>
      )}
    </div>
    </TocarFlechaCtx.Provider>
    </PixelCtx.Provider>
    </DidCtx.Provider>
  );
}

function Historial({ did, version, onCerrar, onRestaurado }: {
  did: number; version: number; onCerrar: () => void; onRestaurado: (d: Diagrama) => void;
}) {
  const q = useQuery<{ versiones: Version[] }>({
    queryKey: ["colab-versiones", did, version],
    queryFn: () => api.get(`/api/colaboradores/diagramas/${did}/versiones`),
  });
  const [error, setError] = useState<string | null>(null);
  async function restaurar(v: number) {
    if (!window.confirm(`¿Volver a la versión ${v}? Se guarda como una versión nueva; no se pierde nada.`)) return;
    try {
      onRestaurado(await api.post<Diagrama>(`/api/colaboradores/diagramas/${did}/restaurar`, { a_version: v, version }));
    } catch (e) {
      setError((e as Error).message === "conflicto" ? "El otro acaba de guardar: cierra y vuelve a intentarlo." : (e as Error).message);
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onCerrar}>
      <div className="px-hoja max-h-[80dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-surface-panel p-4 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <p className="font-bold text-ink">Historial de versiones</p>
          <button type="button" onClick={onCerrar} className="text-sm font-bold text-muted">Cerrar</button>
        </div>
        {error && <p className="mb-2 text-sm text-red-500">{error}</p>}
        {(q.data?.versiones ?? []).map((v) => (
          <div key={v.version} className="flex items-center justify-between gap-2 border-b border-border py-2 text-sm">
            <div>
              <p className="font-bold text-ink">Versión {v.version} · {v.usuario || "—"}</p>
              <p className="text-xs text-muted">{v.creado_en} · {v.nodos} cajas, {v.flechas} flechas{v.resumen ? ` · ${v.resumen}` : ""}</p>
            </div>
            {v.version !== version && (
              <button type="button" onClick={() => void restaurar(v.version)}
                      className="rounded-lg border border-border px-2 py-1 text-xs font-bold text-ink">Restaurar</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Panel ──────────────────────────────────────────────────────────────────

export default function ColaboradoresPanel() {
  const qc = useQueryClient();
  const [abierto, setAbierto] = useState<Diagrama | null>(null);
  const [archivados, setArchivados] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery<Lista>({
    queryKey: ["colab-diagramas", archivados],
    queryFn: () => api.get(`/api/colaboradores/diagramas${archivados ? "?archivados=1" : ""}`),
    refetchInterval: abierto ? false : 10_000,
  });

  async function abrir(id: number) {
    setError(null);
    try { setAbierto(await api.get<Diagrama>(`/api/colaboradores/diagramas/${id}`)); }
    catch (e) { setError((e as Error).message); }
  }
  async function crear() {
    const titulo = window.prompt("Nombre del diagrama (ej. Relación comercial — proyecto X):");
    if (!titulo?.trim()) return;
    try {
      const d = await api.post<Diagrama>("/api/colaboradores/diagramas", { titulo: titulo.trim() });
      void qc.invalidateQueries({ queryKey: ["colab-diagramas"] });
      setAbierto(d);
    } catch (e) { setError((e as Error).message); }
  }
  async function archivar(id: number, a: boolean) {
    await api.post(`/api/colaboradores/diagramas/${id}/archivar`, { archivado: a });
    void qc.invalidateQueries({ queryKey: ["colab-diagramas"] });
  }

  if (abierto) {
    return (
      <ReactFlowProvider>
        <Editor key={abierto.id} inicial={abierto} yo={q.data?.yo}
                onVolver={() => { setAbierto(null); void qc.invalidateQueries({ queryKey: ["colab-diagramas"] }); }} />
      </ReactFlowProvider>
    );
  }

  const lista = q.data?.diagramas ?? [];
  return (
    <div className="mx-auto min-h-0 w-full max-w-3xl flex-1 space-y-3 overflow-y-auto px-1 pb-4">
      <div>
        <h2 className="text-base font-bold text-ink">Colaboradores</h2>
        <p className="text-xs text-muted">
          Cada proyecto es un edificio que construyen juntos: cada caja es un piso, y se termina a medida que lo llenan
          (cómo, dónde, por qué, tiempo, dinero, fotos…). Lo que guarda uno lo ve el otro en segundos.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void crear()} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-bold text-white">＋ Nuevo proyecto</button>
        <label className="flex items-center gap-1 text-xs text-muted">
          <input type="checkbox" checked={archivados} onChange={(e) => setArchivados(e.target.checked)} /> ver archivados
        </label>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      {q.isLoading && <p className="text-sm text-muted">Cargando…</p>}
      {q.error && <p className="text-sm text-red-500">{(q.error as Error).message}</p>}
      {!q.isLoading && !lista.length && !q.error && (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
          Todavía no hay diagramas. Empiecen con «Relación comercial».
        </p>
      )}
      {/* La calle de proyectos: cada proyecto es un edificio en obra (pisos terminados con la luz
          encendida, los demás en andamio, grúa mientras falte). Se entra tocando el edificio. */}
      <div className="ob-calle">
        <div className="ob-lote-calle">
        <button type="button" className="ob-nuevo" onClick={() => void crear()} title="Nuevo proyecto">
          <Sprite s={["kkkkkkkkkk", "knnnnnnnnk", "knyyyyyynk", "knnnnnnnnk", "kkkkkkkkkk", "....kk....", "....kk...."]} px={4} />
          ＋ Terreno para un proyecto nuevo
        </button>
        <span className="ob-acera" aria-hidden="true" />
        </div>
        {lista.map((d) => {
          const obra = d.obra ?? { pisos: d.nodos, terminados: 0, avance: 0 };
          const MAX = 10;
          const visibles = Math.min(obra.pisos, MAX);
          const hechos = Math.min(obra.terminados, visibles);
          return (
            <div key={d.id} className="ob-lote-calle">
              <button type="button" onClick={() => void abrir(d.id)} className="ob-mini"
                      title={`${d.titulo} — ${obra.terminados} de ${obra.pisos} pisos terminados`}>
                {obra.pisos > MAX && <span className="ob-mini-mas">+{obra.pisos - MAX} pisos</span>}
                {obra.pisos > 0 && obra.terminados < obra.pisos && <span className="ob-mini-grua" aria-hidden="true" />}
                {obra.pisos > 0 && obra.terminados === obra.pisos && <Sprite s="bandera" px={3} className="mx-auto" />}
                {Array.from({ length: visibles }, (_, k) => (
                  <span key={k} aria-hidden="true"
                        className={`ob-mini-piso ${visibles - k <= hechos ? "ob-mini-hecho" : "ob-mini-obra"}`} />
                ))}
                <span className="ob-rotulo">
                  <b>{d.titulo}</b>
                  <span className="ob-mini-barra"><span style={{ width: `${Math.round(obra.avance * 100)}%` }} /></span>
                  {obra.terminados}/{obra.pisos} pisos · {Math.round(obra.avance * 100)} %
                  <span className="block opacity-80">
                    {d.actualizado_por_nombre ? `${d.actualizado_por_nombre} · ` : ""}{d.actualizado_en}
                  </span>
                </span>
              </button>
              <button type="button" onClick={() => void archivar(d.id, !d.archivado)}
                      className="ob-acera ob-archivar">
                {d.archivado ? "Desarchivar" : "Archivar"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
