/**
 * Colaboradores: el proyecto que Armando construye con un colaborador externo (primero Sebastián).
 * Desde el 3-oct-2026 abre en el TABLERO (colaboradores/TableroProyecto: de dónde partimos, meta,
 * quién hace qué, resultados, obstáculos, decisiones, turno y ritmo); el EDIFICIO en pixel art
 * (colaboradores/EdificioColab) queda como pestaña secundaria.
 * Pisos y habitaciones configurables, cajas libres colocadas en ellas que se construyen al llenarse,
 * entregas que un avatar lleva de una caja a otra, y el juego de la operación (comprar → craftear →
 * publicar → vender, reparto en monedas, dharma). Se retiraron el tablero de flechas, la vista
 * clásica y la exportación a Archify.
 *
 * Tiempo real «suficiente»: se consulta cada 3 s. Si los dos editaron a la vez, el servidor rechaza
 * la versión vieja (409) y aquí se COMBINAN los cambios —los del otro más los propios— en vez de
 * pisar a nadie. Backend: app/services/colaboradores.py.
 */
import "./colaboradores/pixel.css";
import "./colaboradores/obra.css";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { Sprite } from "./colaboradores/pixel";
import EdificioColab from "./colaboradores/EdificioColab";
import TableroProyecto from "./colaboradores/TableroProyecto";
import {
  AuthImg, Colocacion, CompetenciaEditor, ConsensoEditor, ContenidoCaja, Entregas, Historial, INP, MINI,
  ProductoEditor, ProveedorEditor,
} from "./colaboradores/campos";
import {
  PLANTILLAS, combinar, habitacionDe, nuevoId, plantillaDe,
  type Adjunto, type Carril, type Diagrama, type Doc, type EntregaDoc, type Lista, type NodoDoc, type Operacion, type Tipo,
} from "./colaboradores/modelo";

type Estado = { tipo: "ok" | "guardando" | "pendiente" | "aviso" | "error"; texto: string };
type Sel = { tipo: "caja" | "entrega"; id: string } | null;
type Vista = "tablero" | "edificio";

function vistaGuardada(): Vista {
  try { return localStorage.getItem("colab-vista-proyecto") === "edificio" ? "edificio" : "tablero"; }
  catch { return "tablero"; }
}

function Editor({ inicial, yo, onVolver }: { inicial: Diagrama; yo?: { id: number; nombre: string }; onVolver: () => void }) {
  const qc = useQueryClient();
  const [meta, setMeta] = useState<{ turno?: number | null; participantes: Record<string, string> }>(
    { turno: inicial.turno_actual, participantes: inicial.participantes ?? {} });
  const [operacion, setOperacion] = useState<{ op?: Operacion; dharma: Record<string, number> }>(
    { op: inicial.operacion, dharma: inicial.dharma ?? {} });
  const [nodos, setNodos] = useState<NodoDoc[]>(inicial.doc.nodes);
  const [entregas, setEntregas] = useState<EntregaDoc[]>(inicial.doc.edges);
  // El guardado lee lo último (no lo del render en que se programó).
  const nodosRef = useRef(nodos); nodosRef.current = nodos;
  const entregasRef = useRef(entregas); entregasRef.current = entregas;
  const [titulo, setTitulo] = useState(inicial.titulo);
  const tituloRef = useRef(titulo); tituloRef.current = titulo;
  const version = useRef(inicial.version);
  const base = useRef<Doc>({ nodes: inicial.doc.nodes, edges: inicial.doc.edges });   // lo último que coincide con el servidor
  const sucio = useRef(false);
  const timer = useRef<number | null>(null);
  const [estado, setEstado] = useState<Estado>({ tipo: "ok", texto: `Versión ${inicial.version}` });
  const [sel, setSel] = useState<Sel>(null);
  const [nuevaEn, setNuevaEn] = useState<string | null>(null);     // habitación donde se coloca una caja nueva
  const [verHistorial, setVerHistorial] = useState(false);
  const [pleno, setPleno] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  const [subiendo, setSubiendo] = useState(false);
  const [vista, setVistaState] = useState<Vista>(vistaGuardada);
  const setVista = (v: Vista) => { setVistaState(v); try { localStorage.setItem("colab-vista-proyecto", v); } catch { /* sin almacenamiento */ } };

  const aplicarRemoto = useCallback((d: Diagrama, aviso?: string) => {
    setNodos(d.doc.nodes);
    setEntregas(d.doc.edges);
    setTitulo(d.titulo);
    version.current = d.version;
    base.current = { nodes: d.doc.nodes, edges: d.doc.edges };
    sucio.current = false;
    setMeta({ turno: d.turno_actual, participantes: d.participantes ?? {} });
    setOperacion({ op: d.operacion, dharma: d.dharma ?? {} });
    setEstado({ tipo: aviso ? "aviso" : "ok", texto: aviso ?? `Versión ${d.version}` });
  }, []);

  const guardar = useCallback(async () => {
    if (!sucio.current) return;
    const local: Doc = { nodes: nodosRef.current, edges: entregasRef.current };
    setEstado({ tipo: "guardando", texto: "Guardando…" });
    try {
      const r = await api.put<Diagrama>(`/api/colaboradores/diagramas/${inicial.id}`,
        { doc: local, version: version.current, titulo: tituloRef.current });
      version.current = r.version;
      base.current = local;
      sucio.current = false;
      setEstado({ tipo: "ok", texto: `Guardado · versión ${r.version}` });
      void qc.invalidateQueries({ queryKey: ["colab-diagramas"] });
    } catch (e) {
      if ((e as Error).message === "conflicto") {
        // El otro guardó mientras editabas: se combinan los dos y se guarda encima de lo suyo.
        const remoto = await api.get<Diagrama>(`/api/colaboradores/diagramas/${inicial.id}`);
        const mezcla = combinar(base.current, local, { nodes: remoto.doc.nodes, edges: remoto.doc.edges });
        setNodos(mezcla.nodes);
        setEntregas(mezcla.edges);
        nodosRef.current = mezcla.nodes;
        entregasRef.current = mezcla.edges;
        version.current = remoto.version;
        base.current = { nodes: remoto.doc.nodes, edges: remoto.doc.edges };
        setOperacion({ op: remoto.operacion, dharma: remoto.dharma ?? {} });
        sucio.current = true;
        setEstado({ tipo: "aviso", texto: `${remoto.actualizado_por_nombre || "El otro"} también editó: se combinaron los cambios` });
        window.setTimeout(() => void guardar(), 300);
      } else {
        setEstado({ tipo: "error", texto: (e as Error).message || "No se pudo guardar" });
      }
    }
  }, [inicial.id, qc]);

  const marcarCambio = useCallback(() => {
    sucio.current = true;
    setEstado({ tipo: "pendiente", texto: "Cambios sin guardar…" });
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void guardar(), 1200);
  }, [guardar]);

  // Lo que el otro guarda llega cada 3 s (si aquí no hay cambios pendientes).
  useEffect(() => {
    const id = window.setInterval(async () => {
      if (sucio.current || document.hidden) return;
      try {
        const d = await api.get<Diagrama>(`/api/colaboradores/diagramas/${inicial.id}`);
        if (d.version > version.current && !sucio.current) {
          aplicarRemoto(d, `${d.actualizado_por_nombre || "El otro"} actualizó el proyecto · versión ${d.version}`);
        }
      } catch { /* sin red: se reintenta en el próximo ciclo */ }
    }, 3000);
    return () => window.clearInterval(id);
  }, [inicial.id, aplicarRemoto]);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const op = operacion.op;
  const avatares = op?.avatares ?? [];

  function crearCaja(tipo: Tipo, habitacion: string) {
    const id = nuevoId("c");
    const pl = plantillaDe(tipo);
    setNodos((ns) => [...ns, { id, label: tipo === "libre" ? "Caja nueva" : pl.label, sublabel: "", tipo, carril: "conjunto",
                               x: 0, y: 0, habitacion }]);
    setNuevaEn(null);
    setSel({ tipo: "caja", id });
    marcarCambio();
  }
  function editarNodo(id: string, cambios: Partial<NodoDoc>) {
    // El responsable también fija el carril (lo usan las versiones y los datos de antes).
    if ("avatar" in cambios) {
      const a = avatares.find((x) => x.id === cambios.avatar);
      cambios = { ...cambios, carril: ((a?.carril as Carril | null) ?? "conjunto") };
    }
    setNodos((ns) => ns.map((n) => (n.id === id ? { ...n, ...cambios } : n)));
    marcarCambio();
  }
  function borrarCaja(id: string) {
    if (!window.confirm("¿Quitar esta caja del edificio? Sus entregas también se quitan. Queda en el historial.")) return;
    setNodos((ns) => ns.filter((n) => n.id !== id));
    setEntregas((es) => es.filter((e) => e.from !== id && e.to !== id));
    setSel(null);
    marcarCambio();
  }
  function crearEntrega(from: string, e: { to: string; label: string; portador?: string }) {
    setEntregas((es) => [...es, { id: nuevoId("e"), from, to: e.to, label: e.label, portador: e.portador }]);
    marcarCambio();
  }
  function editarEntrega(id: string, cambios: Partial<EntregaDoc>) {
    setEntregas((es) => es.map((e) => (e.id === id ? { ...e, ...cambios } : e)));
    marcarCambio();
  }
  function borrarEntrega(id: string) {
    setEntregas((es) => es.filter((e) => e.id !== id));
    setSel(null);
    marcarCambio();
  }

  async function subirMedia(file: File): Promise<Adjunto | null> {
    setSubiendo(true);
    try {
      const form = new FormData();
      form.append("archivo", file);
      return await api.upload<Adjunto>(`/api/colaboradores/diagramas/${inicial.id}/media`, form);
    } catch (e) {
      setEstado({ tipo: "error", texto: (e as Error).message || "No se pudo subir el archivo" });
      return null;
    } finally {
      setSubiendo(false);
    }
  }

  const correrConsenso = useCallback(async (nodoId: string, accion: string, extra?: { texto?: string; propuesta?: string }) => {
    if (sucio.current) { try { await guardar(); } catch { /* el asunto tipeado se reintenta solo */ } }
    try {
      const d = await api.post<Diagrama>(`/api/colaboradores/diagramas/${inicial.id}/consenso`, { nodo: nodoId, accion, ...extra });
      aplicarRemoto(d);
    } catch (e) {
      setEstado({ tipo: "error", texto: (e as Error).message || "No se pudo registrar" });
    }
  }, [inicial.id, guardar, aplicarRemoto]);

  /** Una jugada de la operación (comprar, craftear, publicar, vender, reglas, edificio, calificar). */
  const jugar = useCallback(async (accion: string, datos?: Record<string, unknown>): Promise<Operacion | null> => {
    if (sucio.current) { try { await guardar(); } catch { /* se reintenta solo */ } }
    try {
      const d = await api.post<Diagrama>(`/api/colaboradores/diagramas/${inicial.id}/operacion`, { accion, datos: datos ?? {} });
      aplicarRemoto(d);
      return d.operacion ?? null;
    } catch (e) {
      setEstado({ tipo: "error", texto: (e as Error).message || "No se pudo registrar la jugada" });
      throw e;
    }
  }, [inicial.id, guardar, aplicarRemoto]);

  const caja = sel?.tipo === "caja" ? nodos.find((n) => n.id === sel.id) : undefined;
  const entrega = sel?.tipo === "entrega" ? entregas.find((e) => e.id === sel.id) : undefined;
  const pisos = op?.edificio.pisos ?? [];
  const colorEstado = { ok: "#00E436", guardando: "#C2C3C7", pendiente: "#FFA300", aviso: "#29ADFF", error: "#FF004D" }[estado.tipo];
  const nombreCaja = (id: string) => nodos.find((n) => n.id === id)?.label ?? "(borrada)";

  return (
    <div className={`colab-pixel ${pleno ? "fixed inset-0 z-40 flex h-[100dvh] flex-col gap-2 bg-surface p-2" : "flex min-h-0 flex-1 flex-col gap-2"}`}
         style={pleno ? { paddingTop: "max(0.5rem, env(safe-area-inset-top, 0px))" } : undefined}>
      <div className="px-hud flex min-w-0 flex-wrap items-center gap-2">
        <button type="button" onClick={() => { void guardar(); onVolver(); }} aria-label="Volver a la calle de proyectos"
                className="shrink-0 rounded-lg border border-border px-2 py-1 text-sm font-bold text-muted">←</button>
        <Sprite s="bloques" px={2} titulo="Proyecto" />
        <input value={titulo} onChange={(e) => { setTitulo(e.target.value); marcarCambio(); }} aria-label="Nombre del proyecto"
               className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 text-base font-bold text-ink focus:border-border" />
        {vista === "edificio" && (
          <span className="px-t min-w-0 max-w-[30%] shrink-0 truncate" style={{ color: colorEstado, fontSize: 11 }}>{estado.texto}</span>
        )}
        <div className="order-last flex w-full shrink-0 overflow-hidden rounded-lg border border-border sm:order-none sm:w-auto" role="tablist" aria-label="Vista del proyecto">
          {(["tablero", "edificio"] as Vista[]).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={vista === v} onClick={() => setVista(v)}
                    className={`flex-1 px-3 py-1 text-sm font-bold ${vista === v ? "bg-accent text-white" : "text-ink"}`}>
              {v === "tablero" ? "Tablero" : "Edificio"}
            </button>
          ))}
        </div>
        {vista === "edificio" && (
          <>
            <button type="button" onClick={() => setNuevaEn(pisos[0]?.habitaciones[0]?.id ?? "")}
                    className="px-btn shrink-0 rounded-lg bg-accent px-3 py-1 text-sm font-bold text-white">＋ Caja</button>
            <button type="button" onClick={() => setVerHistorial(true)} className="px-btn shrink-0 rounded-lg border border-border px-2 py-1 text-sm font-bold text-ink">
              Historial
            </button>
          </>
        )}
        <button type="button" onClick={() => setPleno((v) => !v)} aria-label={pleno ? "Salir de pantalla completa" : "Pantalla completa"}
                className="shrink-0 rounded-lg border border-border px-2 py-1 text-sm font-bold text-muted">{pleno ? "⤡" : "⛶"}</button>
      </div>

      {vista === "tablero" ? (
        <TableroProyecto did={inicial.id} yoId={yo?.id ?? 0} subir={subirMedia} />
      ) : op ? (
        <EdificioColab
          nodos={nodos} entregas={entregas} op={op} dharma={operacion.dharma} participantes={meta.participantes}
          selId={sel?.tipo === "caja" ? sel.id : null}
          onCaja={(id) => setSel({ tipo: "caja", id })}
          onEntrega={(id) => setSel({ tipo: "entrega", id })}
          onNueva={(h) => setNuevaEn(h)}
          jugar={jugar}
          foto={(mid) => <AuthImg did={inicial.id} mid={mid} className="h-full w-full object-cover" alt="" />}
        />
      ) : (
        <p className="text-sm text-muted">Cargando el edificio…</p>
      )}

      {/* Colocar una caja nueva: qué plantilla y en qué habitación. */}
      {nuevaEn !== null && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setNuevaEn(null)} aria-hidden="true" />
          <div className="px-hoja fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[72dvh] w-full max-w-lg space-y-2 overflow-y-auto rounded-t-2xl border border-border bg-surface-panel p-3 shadow-2xl sm:bottom-3 sm:rounded-2xl"
               role="dialog" aria-label="Colocar una caja">
            <div className="flex items-center justify-between">
              <p className="px-t text-xs font-bold uppercase text-muted">Colocar una caja</p>
              <button type="button" onClick={() => setNuevaEn(null)} className="px-1 text-lg leading-none text-muted" aria-label="Cerrar">×</button>
            </div>
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <span className="shrink-0">En</span>
              <select value={nuevaEn} onChange={(e) => setNuevaEn(e.target.value)} className={`${MINI} min-w-0 flex-1`}>
                {[...pisos].reverse().map((p) => (
                  <optgroup key={p.id} label={p.nombre}>
                    {p.habitaciones.map((h) => <option key={h.id} value={h.id}>{h.nombre}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {PLANTILLAS.map((p) => (
                <button key={p.tipo} type="button" onClick={() => crearCaja(p.tipo, nuevaEn)} data-plantilla={p.tipo}
                        className="px-btn flex items-start gap-2 rounded-lg border border-border p-2 text-left">
                  <Sprite s={p.icono} px={3} />
                  <span><b className="block text-sm text-ink">{p.label}</b><span className="text-[11px] text-muted">{p.ayuda}</span></span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Editar una caja */}
      {caja && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setSel(null)} aria-hidden="true" />
          <div className="px-hoja fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[78dvh] w-full max-w-lg space-y-2 overflow-y-auto rounded-t-2xl border border-border bg-surface-panel p-3 shadow-2xl sm:bottom-3 sm:rounded-2xl"
               style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }} role="dialog" aria-label="Editar caja">
            <div className="flex items-center justify-between">
              <p className="px-t flex items-center gap-1 text-xs font-bold uppercase text-muted">
                <Sprite s={caja.icono ?? plantillaDe(caja.tipo).icono} px={2} /> {plantillaDe(caja.tipo).label}
              </p>
              <button type="button" onClick={() => setSel(null)} className="px-1 text-lg leading-none text-muted" aria-label="Cerrar">×</button>
            </div>
            <input value={caja.label} placeholder="¿Qué es esta caja?" onChange={(e) => editarNodo(caja.id, { label: e.target.value })}
                   className="w-full rounded border border-border bg-surface-input px-2 py-1.5 text-sm font-bold text-ink" />
            <input value={caja.sublabel || ""} placeholder="Detalle (opcional)" onChange={(e) => editarNodo(caja.id, { sublabel: e.target.value })}
                   className={INP} />
            <Colocacion nd={caja} pisos={pisos} avatares={avatares} habitacion={habitacionDe(caja, pisos)}
                        editar={(c) => editarNodo(caja.id, c)} />
            {caja.tipo === "consenso" ? (
              <ConsensoEditor nd={caja} yoId={yo?.id ?? 0} participantes={meta.participantes} turnoActual={meta.turno}
                              editarAsunto={(v) => editarNodo(caja.id, { asunto: v })}
                              editarSkill={(v) => editarNodo(caja.id, { skill: v })}
                              correr={(accion, extra) => correrConsenso(caja.id, accion, extra)} />
            ) : caja.tipo === "producto" ? (
              <ProductoEditor did={inicial.id} nd={caja} editar={(c) => editarNodo(caja.id, c)} subir={subirMedia} subiendo={subiendo}
                              proveedores={nodos.filter((n) => n.tipo === "proveedor").map((n) => ({ id: n.id, label: n.label }))} />
            ) : caja.tipo === "proveedor" ? (
              <ProveedorEditor did={inicial.id} nd={caja} editar={(c) => editarNodo(caja.id, c)} subir={subirMedia} subiendo={subiendo} />
            ) : caja.tipo === "competencia" ? (
              <CompetenciaEditor did={inicial.id} nd={caja} editar={(c) => editarNodo(caja.id, c)} subir={subirMedia} subiendo={subiendo} />
            ) : (
              <ContenidoCaja did={inicial.id} nd={caja} editar={(c) => editarNodo(caja.id, c)} subir={subirMedia} subiendo={subiendo} />
            )}
            <Entregas nd={caja} nodos={nodos} entregas={entregas} avatares={avatares}
                      crear={(e) => crearEntrega(caja.id, e)} abrir={(id) => setSel({ tipo: "entrega", id })} />
            <button type="button" onClick={() => borrarCaja(caja.id)}
                    className="px-btn w-full rounded-lg border border-red-400 px-3 py-1.5 text-sm font-bold text-red-500">Quitar caja</button>
          </div>
        </>
      )}

      {/* Editar una entrega */}
      {entrega && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setSel(null)} aria-hidden="true" />
          <div className="px-hoja fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-lg space-y-2 rounded-t-2xl border border-border bg-surface-panel p-3 shadow-2xl sm:bottom-3 sm:rounded-2xl"
               role="dialog" aria-label="Editar entrega">
            <div className="flex items-center justify-between">
              <p className="px-t flex items-center gap-1 text-xs font-bold uppercase text-muted"><Sprite s="camion" px={2} /> Entrega</p>
              <button type="button" onClick={() => setSel(null)} className="px-1 text-lg leading-none text-muted" aria-label="Cerrar">×</button>
            </div>
            <p className="text-sm text-ink">De <b>{nombreCaja(entrega.from)}</b> a <b>{nombreCaja(entrega.to)}</b></p>
            <input value={entrega.label ?? ""} placeholder="Qué lleva" onChange={(e) => editarEntrega(entrega.id, { label: e.target.value })} className={INP} />
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <span className="shrink-0">La lleva</span>
              <select value={entrega.portador ?? ""} onChange={(e) => editarEntrega(entrega.id, { portador: e.target.value || undefined })}
                      className={`${MINI} min-w-0 flex-1`}>
                <option value="">alguien</option>
                {avatares.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
              </select>
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setSel({ tipo: "caja", id: entrega.from })}
                      className="px-btn flex-1 rounded-lg border border-border px-2 py-1.5 text-sm font-bold text-ink">Ver caja de origen</button>
              <button type="button" onClick={() => borrarEntrega(entrega.id)}
                      className="px-btn rounded-lg border border-red-400 px-3 py-1.5 text-sm font-bold text-red-500">Quitar</button>
            </div>
          </div>
        </>
      )}

      {verHistorial && (
        <Historial did={inicial.id} version={version.current} onCerrar={() => setVerHistorial(false)}
                   onRestaurado={(d) => { aplicarRemoto(d, `Restaurada · versión ${d.version}`); setVerHistorial(false); }} />
      )}
    </div>
  );
}

// ─── Panel: la calle de proyectos ────────────────────────────────────────────

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
    const titulo = window.prompt("Nombre del proyecto (ej. Collar persa):");
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
        <Editor key={abierto.id} inicial={abierto} yo={q.data?.yo}
                onVolver={() => { setAbierto(null); void qc.invalidateQueries({ queryKey: ["colab-diagramas"] }); }} />
    );
  }

  const lista = q.data?.diagramas ?? [];
  return (
    <div className="mx-auto min-h-0 w-full max-w-3xl flex-1 space-y-3 overflow-y-auto px-1 pb-4">
      <div>
        <h2 className="text-base font-bold text-ink">Colaboradores</h2>
        <p className="text-xs text-muted">
          Cada proyecto abre en su tablero: de dónde parten, la meta, quién hace qué, resultados, lo que los frena,
          decisiones y a quién le toca. El edificio sigue en su pestaña. Lo que guarda uno lo ve el otro en segundos.
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
          Todavía no hay proyectos. Creen uno y empiecen por la meta.
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
                  {d.tablero?.tarjetas ? (
                    <>
                      {d.tablero.meta ? <span className="block">Meta: {d.tablero.meta}</span> : <span className="block">Sin meta escrita</span>}
                      {(() => {
                        const yoId = String(q.data?.yo.id ?? "");
                        const mio = d.tablero.turno[yoId] ?? 0;
                        const otro = Object.entries(d.tablero.turno).filter(([k]) => k !== yoId).reduce((s, [, n]) => s + n, 0);
                        return <span className="block">Te tocan {mio} · al otro {otro}</span>;
                      })()}
                    </>
                  ) : (
                    <>{obra.terminados}/{obra.pisos} pisos · {Math.round(obra.avance * 100)} %</>
                  )}
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
