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
import {
  Background, ConnectionMode, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider,
  applyEdgeChanges, applyNodeChanges, reconnectEdge, useReactFlow,
  type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type NodeProps,
} from "@xyflow/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, fetchAuthBlobUrl } from "../api/client";

// ─── Modelo (igual al del backend) ──────────────────────────────────────────

type Tipo = "accion" | "decision" | "entregable" | "dinero" | "externo";
type Carril = "mckenna" | "armando" | "sebastian" | "conjunto";
type NodoDoc = { id: string; label: string; sublabel?: string; tipo: Tipo; carril: Carril; x: number; y: number };
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
};
type Lista = { diagramas: Omit<Diagrama, "doc">[]; yo: { id: number; nombre: string } };
type Version = { version: number; usuario: string; resumen: string; creado_en: string; nodos: number; flechas: number };

const TIPOS: Record<Tipo, { label: string; fondo: string; borde: string }> = {
  accion: { label: "Acción", fondo: "#e0f2fe", borde: "#0284c7" },
  decision: { label: "Decisión / acuerdo", fondo: "#fef3c7", borde: "#d97706" },
  entregable: { label: "Entregable", fondo: "#dcfce7", borde: "#16a34a" },
  dinero: { label: "Dinero / precio", fondo: "#f3e8ff", borde: "#9333ea" },
  externo: { label: "Tercero / cliente", fondo: "#f1f5f9", borde: "#475569" },
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

const nuevoId = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** Del documento a lo que dibuja React Flow (trazo, punta y etiqueta legible). */
function pintar(e: FlechaDoc) {
  const color = (COLORES_FLECHA as readonly string[]).includes(e.color || "") ? e.color! : COLORES_FLECHA[0];
  const w = Math.max(1, Math.min(8, Number(e.grosor) || 2));
  const trazo: Trazo = e.trazo === "guiones" || e.trazo === "puntos" ? e.trazo : "solida";
  return {
    type: e.forma === "recta" ? "straight" : e.forma === "escalon" ? "smoothstep" : "default",
    style: {
      stroke: color,
      strokeWidth: w,
      strokeDasharray: trazo === "guiones" ? `${w * 4} ${w * 3}` : trazo === "puntos" ? `1 ${w * 2.6}` : undefined,
      strokeLinecap: trazo === "puntos" ? ("round" as const) : undefined,
    },
    markerEnd: { type: MarkerType.ArrowClosed, width: 12 + w * 2, height: 12 + w * 2, color },
    // La etiqueta va en el medio, sobre un fondo: encima de la línea no se leía.
    labelStyle: { fill: color, fontWeight: 700, fontSize: 11 },
    labelShowBg: true,
    labelBgStyle: { fill: "#ffffff", fillOpacity: 0.88, stroke: color, strokeWidth: 0.5 },
    labelBgPadding: [5, 3] as [number, number],
    labelBgBorderRadius: 5,
  };
}

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
      const d = n.data as NodoDoc;
      return { id: n.id, label: d.label, sublabel: d.sublabel || "", tipo: d.tipo, carril: d.carril,
               x: Math.round(n.position.x), y: Math.round(n.position.y) };
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

function Caja({ data, selected }: NodeProps) {
  const d = data as NodoDoc & { uniendo?: boolean };
  const t = TIPOS[d.tipo] ?? TIPOS.accion;
  // Un punto por lado. Con ConnectionMode.Loose cada uno sirve de salida y de
  // llegada, así que la flecha puede tocar la caja por donde uno quiera.
  const manija = { width: 14, height: 14, background: t.borde, border: "2px solid white" };
  return (
    <div style={{ background: t.fondo, borderColor: selected ? "#111827" : t.borde,
                  borderRadius: d.tipo === "decision" ? 22 : 10, borderStyle: d.carril === "conjunto" ? "solid" : "dashed" }}
         className={`min-w-[140px] max-w-[220px] border-2 px-3 py-2 text-center shadow-sm ${d.uniendo ? "ring-4 ring-accent/50" : ""}`}>
      <Handle type="source" id="l" position={Position.Left} style={manija} />
      <Handle type="source" id="t" position={Position.Top} style={manija} />
      <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: COLOR_CARRIL[d.carril] ?? "#374151" }}>
        {CARRILES[d.carril] ?? "Conjunto"}
      </p>
      <p className="text-[9px] font-semibold uppercase" style={{ color: t.borde }}>{t.label}</p>
      <p className="text-sm font-bold leading-snug text-gray-900">{d.label}</p>
      {d.sublabel && <p className="mt-0.5 text-xs text-gray-600">{d.sublabel}</p>}
      <Handle type="source" id="r" position={Position.Right} style={manija} />
      <Handle type="source" id="b" position={Position.Bottom} style={manija} />
    </div>
  );
}
const TIPOS_NODO = { caja: Caja };

// ─── Editor ─────────────────────────────────────────────────────────────────

type Estado = { tipo: "ok" | "guardando" | "pendiente" | "aviso" | "error"; texto: string };

function Editor({ inicial, onVolver }: { inicial: Diagrama; onVolver: () => void }) {
  const qc = useQueryClient();
  const rf = useReactFlow();
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

  const aplicarRemoto = useCallback((d: Diagrama, aviso?: string) => {
    const f = aFlow(d.doc);
    setNodes(f.nodes);
    setEdges(f.edges);
    setTitulo(d.titulo);
    version.current = d.version;
    base.current = d.doc;
    sucio.current = false;
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
    const nueva: FlechaDoc = { id: nuevoId("f"), from: desde, to: hasta, label: "",
                               fromLado: desdeLado, toLado: hastaLado };
    setEdges((es) => es.some((e) => e.source === desde && e.target === hasta) ? es : [...es, {
      id: nueva.id, source: desde, target: hasta, sourceHandle: desdeLado, targetHandle: hastaLado,
      reconnectable: true,
      data: { label: "", color: undefined, grosor: undefined, trazo: undefined, forma: undefined },
      ...pintar(nueva),
    }]);
    marcarCambio();
  }, [marcarCambio]);

  const onConnect = useCallback((c: Connection) => {
    if (c.source && c.target) unir(c.source, c.target, (c.sourceHandle as Lado) || "r", (c.targetHandle as Lado) || "l");
  }, [unir]);

  // Arrastrar la punta de una flecha a otra caja (o a otro lado de la misma).
  const onReconnect = useCallback((vieja: Edge, nueva: Connection) => {
    setEdges((es) => reconnectEdge(vieja, nueva, es));
    marcarCambio();
  }, [marcarCambio]);

  function agregarCaja() {
    const centro = rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const id = nuevoId("c");
    setNodes((ns) => [...ns, { id, type: "caja", position: { x: centro.x - 80, y: centro.y - 30 },
      data: { id, label: "Nuevo paso", sublabel: "", tipo: "accion", carril: "conjunto", x: 0, y: 0 } }]);
    setSel({ tipo: "nodo", id });
    marcarCambio();
  }

  function editarNodo(id: string, cambios: Partial<NodoDoc>) {
    setNodes((ns) => ns.map((n) => n.id === id ? { ...n, data: { ...n.data, ...cambios } } : n));
    marcarCambio();
  }

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
  const nodosVista = useMemo(
    () => nodes.map((n) => ({ ...n, data: { ...n.data, uniendo: n.id === uniendoDesde } })),
    [nodes, uniendoDesde],
  );
  const colorEstado = { ok: "text-emerald-600", guardando: "text-muted", pendiente: "text-amber-600",
                        aviso: "text-sky-600", error: "text-red-500" }[estado.tipo];

  return (
    <div
      className={pleno
        ? "fixed inset-0 z-40 flex h-[100dvh] flex-col gap-2 bg-surface p-2"
        : "flex min-h-0 flex-1 flex-col gap-2"}
      style={pleno ? { paddingTop: "max(0.5rem, env(safe-area-inset-top, 0px))" } : undefined}
    >
      <div className="flex min-w-0 items-center gap-2">
        <button type="button" onClick={() => { void guardar(); onVolver(); }}
                className="shrink-0 rounded-lg border border-border px-2 py-1 text-sm font-bold text-muted">←</button>
        <input value={titulo} onChange={(e) => { setTitulo(e.target.value); marcarCambio(); }}
               className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 text-base font-bold text-ink focus:border-border" />
        <span className={`shrink-0 text-xs ${colorEstado}`}>{estado.texto}</span>
        <button type="button" onClick={() => setPleno((v) => !v)}
                title={pleno ? "Salir de pantalla completa" : "Pantalla completa"}
                aria-label={pleno ? "Salir de pantalla completa" : "Pantalla completa"}
                className="shrink-0 rounded-lg border border-border px-2 py-1 text-sm font-bold text-muted">
          {pleno ? "⤡" : "⛶"}
        </button>
      </div>
      {/* Una sola fila que se desliza: al envolverse, cada renglón le quitaba alto al lienzo. */}
      <div className="flex shrink-0 gap-1.5 overflow-x-auto pb-0.5">
        <button type="button" onClick={agregarCaja}
                className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm font-bold text-white">＋ Caja</button>
        <button type="button" onClick={() => setVerHistorial(true)}
                className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-sm font-bold text-ink">Historial</button>
        <button type="button" onClick={() => void exportarArchify()} disabled={exportando}
                className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-sm font-bold text-ink disabled:opacity-40">
          {exportando ? "Generando…" : "Ver en Archify"}
        </button>
        {sel && (
          <button type="button" onClick={borrarSeleccion}
                  className="shrink-0 rounded-lg border border-red-400 px-3 py-1.5 text-sm font-bold text-red-500">
            🗑 Borrar {sel.tipo === "nodo" ? "caja" : "flecha"}
          </button>
        )}
        {uniendoDesde && (
          <span className="shrink-0 rounded-lg bg-accent/10 px-2 py-1.5 text-xs font-bold text-accent">
            Toca la caja de destino… <button type="button" className="ml-1 underline" onClick={() => setUniendoDesde(null)}>cancelar</button>
          </span>
        )}
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-white">
        <ReactFlow
          nodes={nodosVista} edges={edges} nodeTypes={TIPOS_NODO}
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
          <Background gap={20} />
          <Controls showInteractive={false} position="top-left" />
        </ReactFlow>
      {/* Hoja FIJA sobre la pantalla (no dentro del lienzo): pegada al lienzo se
          recortaba cuando el lienzo era bajo, y sin scroll de página no se alcanzaba. */}
        {nodoSel && (
        <>
        <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setSel(null)} aria-hidden="true" />
        <div className="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[72dvh] w-full max-w-lg space-y-2 overflow-y-auto rounded-t-2xl border border-border bg-surface-panel p-3 shadow-2xl sm:bottom-3 sm:rounded-2xl"
             style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase text-muted">Editar caja</p>
            <button type="button" onClick={() => setSel(null)} className="px-1 text-lg leading-none text-muted" aria-label="Cerrar">×</button>
          </div>
          <input value={(nodoSel.data as NodoDoc).label} placeholder="¿Qué pasa en este paso?"
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
          <div className="flex gap-2">
            <button type="button" onClick={() => { setUniendoDesde(nodoSel.id); setSel(null); }}
                    className="flex-1 rounded-lg bg-accent px-3 py-1.5 text-sm font-bold text-white">➜ Unir con otra caja</button>
            <button type="button" onClick={borrarSeleccion}
                    className="rounded-lg border border-red-400 px-3 py-1.5 text-sm font-bold text-red-500">Borrar</button>
          </div>
        </div>
        </>
      )}
        {flechaSel && (
        <>
        <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setSel(null)} aria-hidden="true" />
        <div className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[72dvh] w-full max-w-lg flex-wrap items-center gap-2 overflow-y-auto rounded-t-2xl border border-border bg-surface-panel p-3 shadow-2xl sm:bottom-3 sm:rounded-2xl"
             style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}>
          <div className="flex w-full items-center justify-between">
            <p className="text-xs font-bold uppercase text-muted">Editar flecha</p>
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
            Toca «＋ Caja» para el primer paso. Arrastra las cajas con el dedo y únelas desde sus puntos de color
            o con «Unir con otra caja». Toca una flecha para su texto, color, grosor y por dónde toca cada caja.
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
      <div className="max-h-[80dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-surface-panel p-4 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
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
        <Editor key={abierto.id} inicial={abierto} onVolver={() => { setAbierto(null); void qc.invalidateQueries({ queryKey: ["colab-diagramas"] }); }} />
      </ReactFlowProvider>
    );
  }

  const lista = q.data?.diagramas ?? [];
  return (
    <div className="mx-auto min-h-0 w-full max-w-3xl flex-1 space-y-3 overflow-y-auto px-1 pb-4">
      <div>
        <h2 className="text-base font-bold text-ink">Colaboradores</h2>
        <p className="text-xs text-muted">
          Diagramas de flujo que construyen juntos, a mano, desde el celular o el computador: cada caja es un paso y
          cada flecha une un paso con el siguiente. Lo que guarda uno lo ve el otro en segundos.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void crear()} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-bold text-white">＋ Nuevo diagrama</button>
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
      <div className="grid gap-2 sm:grid-cols-2">
        {lista.map((d) => (
          <div key={d.id} className="rounded-xl border border-border bg-surface-panel p-3">
            <button type="button" onClick={() => void abrir(d.id)} className="w-full text-left">
              <p className="font-bold text-ink">{d.titulo}</p>
              <p className="mt-0.5 text-xs text-muted">
                {d.nodos} cajas · {d.flechas} flechas · versión {d.version}
              </p>
              <p className="text-xs text-muted">
                {d.actualizado_por_nombre ? `Último cambio: ${d.actualizado_por_nombre} · ` : ""}{d.actualizado_en}
              </p>
            </button>
            <div className="mt-2 flex justify-end">
              <button type="button" onClick={() => void archivar(d.id, !d.archivado)} className="text-xs font-bold text-muted hover:text-ink">
                {d.archivado ? "Desarchivar" : "Archivar"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
