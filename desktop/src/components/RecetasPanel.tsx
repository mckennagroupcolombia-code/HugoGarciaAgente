import { useState, useEffect, useCallback, useRef } from "react";
import type { TicketsUser } from "../stores/ticketsAuth";
import { ALERT_ERROR_SM } from "../lib/questStyles";

function tapi(path: string, token: string, options: RequestInit = {}) {
  return fetch(`/api/tickets${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  }).then(async (r) => {
    let data: any;
    try {
      data = await r.json();
    } catch {
      if (!r.ok) {
        throw new Error(
          r.status === 405
            ? "Recetas no disponible en el servidor: reinicia agente-pro (sudo systemctl restart agente-pro)."
            : `Error ${r.status}`,
        );
      }
      return {};
    }
    if (!r.ok) {
      throw new Error(
        data?.error
        || (r.status === 405
          ? "Recetas no disponible: reinicia agente-pro (sudo systemctl restart agente-pro)."
          : `Error ${r.status}`),
      );
    }
    return data;
  });
}

async function archivarRecetaApi(recetaId: number, token: string) {
  try {
    return await tapi(`/recetas/${recetaId}/archivar`, token, { method: "POST" });
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.includes("404") || msg.includes("405")) {
      return tapi(`/recetas/${recetaId}`, token, { method: "DELETE" });
    }
    throw e;
  }
}

interface Material {
  id: number;
  nombre: string;
  unidad: string;
  stock_actual: number;
}

interface RecetaLinea {
  id?: number;
  material_id: number | null;
  etiqueta?: string;
  cantidad: number;
  unidad: string;
  orden?: number;
  nombre?: string;
  stock_actual?: number;
  material_unidad?: string;
}

interface RecetaProceso {
  id: number;
  orden: number;
  descripcion: string;
  duracion_min?: number | null;
}

interface RecetaCorrida {
  id: number;
  receta_id: number;
  estado: "activa" | "pausada" | "finalizada";
  segundos_transcurridos: number;
  segundos_acumulados: number;
  proceso_orden_actual: number;
  procesos_hechos: number[];
}

interface ZonaTrabajo {
  id: number;
  nombre: string;
  parent_id?: number | null;
  color?: string;
  icono?: string;
  orden?: number;
}

type ClasificacionReceta = "catalogo" | "reino";

interface RecetaLista {
  id: number;
  titulo: string;
  reino_id?: number | null;
  reino_nombre?: string | null;
  reino_icono?: string | null;
  reino_color?: string | null;
  categoria?: string;
  origen_id?: number | null;
  es_propia?: boolean;
  clasificacion?: ClasificacionReceta;
  es_catalogo?: boolean;
  es_receta_reino?: boolean;
  num_lineas: number;
  num_procesos: number;
  corrida_activa_id?: number | null;
  corrida_estado?: string | null;
}

interface RecetaDetalle {
  id: number;
  titulo: string;
  descripcion?: string;
  reino_id?: number | null;
  reino_nombre?: string | null;
  reino_icono?: string | null;
  reino_color?: string | null;
  categoria?: string;
  base?: number;
  unidad_base?: string;
  tip?: string;
  origen_id?: number | null;
  es_propia?: boolean;
  clasificacion?: ClasificacionReceta;
  es_catalogo?: boolean;
  es_receta_reino?: boolean;
  lineas: RecetaLinea[];
  procesos: RecetaProceso[];
  corrida?: RecetaCorrida | null;
}

const CAT_LEGACY: Record<string, string> = {
  cosmetica: "Cosmética",
  nutricion: "Nutrición",
  perfumeria: "Perfumería",
  hogar: "Hogar",
};

function esRecetaCatalogo(r: { origen_id?: number | null; clasificacion?: string; es_catalogo?: boolean }): boolean {
  if (r.clasificacion === "catalogo" || r.es_catalogo) return true;
  return r.origen_id != null;
}

function esRecetaDeReino(r: { origen_id?: number | null; clasificacion?: string; es_receta_reino?: boolean; es_propia?: boolean }): boolean {
  if (r.clasificacion === "reino" || r.es_receta_reino) return true;
  return r.origen_id == null || r.es_propia === true;
}

function etiquetaCategoriaCatalogo(categoria?: string): string {
  if (!categoria) return "";
  return CAT_LEGACY[categoria] ?? categoria;
}

function fmtTiempo(seg: number): string {
  const s = Math.max(0, Math.floor(seg));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function useCronometro() {
  const [segundos, setSegundos] = useState(0);
  const [activo, setActivo] = useState(false);
  const acumRef = useRef(0);
  const inicioRef = useRef<number | null>(null);

  useEffect(() => {
    if (!activo) return;
    const iv = setInterval(() => {
      if (inicioRef.current != null) {
        const total = acumRef.current + Math.floor((Date.now() - inicioRef.current) / 1000);
        setSegundos(total);
      }
    }, 250);
    return () => clearInterval(iv);
  }, [activo]);

  function tomarSegundos() {
    if (activo && inicioRef.current != null) {
      return acumRef.current + Math.floor((Date.now() - inicioRef.current) / 1000);
    }
    return acumRef.current;
  }

  function iniciar() {
    if (activo) return;
    inicioRef.current = Date.now();
    setActivo(true);
  }

  function pausar() {
    if (!activo || inicioRef.current == null) return;
    acumRef.current = tomarSegundos();
    inicioRef.current = null;
    setSegundos(acumRef.current);
    setActivo(false);
  }

  function reiniciar() {
    acumRef.current = 0;
    inicioRef.current = null;
    setSegundos(0);
    setActivo(false);
  }

  return { segundos, activo, iniciar, pausar, reiniciar, tomarSegundos };
}

function CronometroPanel({
  segundos,
  activo,
  onIniciar,
  onPausar,
  onReiniciar,
  subtitulo,
}: {
  segundos: number;
  activo: boolean;
  onIniciar: () => void;
  onPausar: () => void;
  onReiniciar: () => void;
  subtitulo?: string;
}) {
  return (
    <div className="rounded-paper border-2 border-accent/50 bg-accent/10 p-4 shadow-paper-sm">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase text-muted">Cronómetro de misión</p>
          <p className="font-mono text-4xl font-black tabular-nums text-accent">{fmtTiempo(segundos)}</p>
          <p className="mt-1 text-xs text-muted">
            {subtitulo || (activo ? "En curso — marca el tiempo real de la misión" : "Pulsa iniciar al comenzar la misión")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {activo ? (
            <button type="button" onClick={onPausar}
              className="rounded-paper border-2 border-border bg-surface-panel px-4 py-2 text-sm font-bold">
              ⏸ Pausar
            </button>
          ) : (
            <button type="button" onClick={onIniciar}
              className="rounded-paper border-2 border-accent bg-accent px-4 py-2 text-sm font-bold text-white">
              ▶ Iniciar
            </button>
          )}
          <button type="button" onClick={onReiniciar}
            className="rounded-paper border-2 border-border px-3 py-2 text-sm font-bold text-muted">
            ↺ Reiniciar
          </button>
        </div>
      </div>
    </div>
  );
}

const UNIDADES = ["g", "kg", "ml", "L", "unidad", "gotas", "%"];

export default function RecetasPanel({
  token,
  user,
  onBack,
}: {
  token: string;
  user: TicketsUser;
  onBack: () => void;
}) {
  const nivel = user.rol?.nivel ?? 1;
  const canEditCatalogo = nivel >= 2;
  const [lista, setLista] = useState<RecetaLista[]>([]);
  const [zonas, setZonas] = useState<ZonaTrabajo[]>([]);
  const [receta, setReceta] = useState<RecetaDetalle | null>(null);
  const [materiales, setMateriales] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<"" | "catalogo" | "reinos">("");
  const [filtroReino, setFiltroReino] = useState<number | "">("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [confirmArchivar, setConfirmArchivar] = useState<number[] | null>(null);
  const [okMsg, setOkMsg] = useState("");
  const [modo, setModo] = useState<"lista" | "nueva" | "detalle" | "elaborar">("lista");
  const [editLineas, setEditLineas] = useState(false);
  const [editProcesos, setEditProcesos] = useState(false);
  const [editMeta, setEditMeta] = useState(false);
  const [metaDraft, setMetaDraft] = useState({
    titulo: "",
    descripcion: "",
    reino_id: "" as number | "",
    base: "",
    unidad_base: "g",
    tip: "",
  });
  const [lineasDraft, setLineasDraft] = useState<RecetaLinea[]>([]);
  const [procesosDraft, setProcesosDraft] = useState<RecetaProceso[]>([]);
  const [saving, setSaving] = useState(false);
  const [tick, setTick] = useState(0);
  const cronometroNueva = useCronometro();

  const reloadLista = useCallback(() => {
    return tapi("/recetas", token).then(setLista).catch((e) => setError(e.message));
  }, [token]);

  const loadReceta = useCallback(
    (id: number) => {
      setLoading(true);
      setError("");
      return tapi(`/recetas/${id}`, token)
        .then((r: RecetaDetalle) => {
          setReceta(r);
          setMetaDraft({
            titulo: r.titulo,
            descripcion: r.descripcion || "",
            reino_id: r.reino_id ?? "",
            base: r.base != null ? String(r.base) : "",
            unidad_base: r.unidad_base || "g",
            tip: r.tip || "",
          });
          setLineasDraft(r.lineas.map((l) => ({ ...l })));
          setProcesosDraft(r.procesos.map((p) => ({ ...p })));
          setModo(r.corrida ? "elaborar" : "detalle");
          setEditMeta(false);
        })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    },
    [token],
  );

  useEffect(() => {
    setLoading(true);
    Promise.all([
      reloadLista(),
      tapi("/materiales", token).then(setMateriales).catch(() => []),
      tapi("/zonas-trabajo", token).then(setZonas).catch(() => []),
    ]).finally(() => setLoading(false));
  }, [reloadLista, token]);

  const reinos = zonas
    .filter((z) => !z.parent_id)
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || a.nombre.localeCompare(b.nombre));

  const syncCorrida = useCallback(
    async (cid: number) => {
      const c = await tapi(`/recetas/corridas/${cid}`, token);
      setReceta((r) => (r ? { ...r, corrida: c } : r));
      return c;
    },
    [token],
  );

  const corrida = receta?.corrida;
  const corridaId = corrida?.id;
  const corridaActiva = corrida?.estado === "activa";

  useEffect(() => {
    if (!corridaId || !corridaActiva) return;
    const iv = setInterval(() => {
      syncCorrida(corridaId).catch(() => {});
      setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(iv);
  }, [corridaId, corridaActiva, syncCorrida]);

  async function iniciarElaboracion() {
    if (!receta) return;
    setSaving(true);
    try {
      const c = await tapi(`/recetas/${receta.id}/iniciar`, token, { method: "POST" });
      setReceta((r) => (r ? { ...r, corrida: c } : r));
      setModo("elaborar");
      await reloadLista();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function pausar() {
    const c = receta?.corrida;
    if (!c) return;
    const updated = await tapi(`/recetas/corridas/${c.id}/pausar`, token, { method: "POST" });
    setReceta((r) => (r ? { ...r, corrida: updated } : r));
  }

  async function reanudar() {
    const c = receta?.corrida;
    if (!c) return;
    const updated = await tapi(`/recetas/corridas/${c.id}/reanudar`, token, { method: "POST" });
    setReceta((r) => (r ? { ...r, corrida: updated } : r));
  }

  async function finalizar() {
    const c = receta?.corrida;
    if (!c || !confirm("¿Finalizar esta elaboración?")) return;
    const updated = await tapi(`/recetas/corridas/${c.id}/finalizar`, token, { method: "POST" });
    setReceta((r) => (r ? { ...r, corrida: updated } : r));
    setModo("detalle");
    await reloadLista();
  }

  async function marcarProceso(procesoId: number) {
    const c = receta?.corrida;
    if (!c) return;
    const updated = await tapi(
      `/recetas/corridas/${c.id}/procesos/${procesoId}/completar`,
      token,
      { method: "POST" },
    );
    setReceta((r) => (r ? { ...r, corrida: updated } : r));
  }

  async function guardarLineas() {
    if (!receta) return;
    setSaving(true);
    try {
      const r = await tapi(`/recetas/${receta.id}/lineas`, token, {
        method: "PUT",
        body: JSON.stringify({
          lineas: lineasDraft.map((l, i) => ({
            material_id: l.material_id || null,
            etiqueta: l.etiqueta || l.nombre || "",
            cantidad: Number(l.cantidad) || 0,
            unidad: l.unidad || "g",
          })),
        }),
      });
      setReceta(r);
      setLineasDraft(r.lineas);
      setEditLineas(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function guardarProcesos() {
    if (!receta) return;
    setSaving(true);
    try {
      const r = await tapi(`/recetas/${receta.id}/procesos`, token, {
        method: "PUT",
        body: JSON.stringify({
          procesos: procesosDraft.map((p) => ({
            descripcion: p.descripcion,
            duracion_min: p.duracion_min ?? null,
          })),
        }),
      });
      setReceta(r);
      setProcesosDraft(r.procesos);
      setEditProcesos(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function volverLista() {
    cronometroNueva.reiniciar();
    setReceta(null);
    setModo("lista");
    setEditLineas(false);
    setEditProcesos(false);
    setEditMeta(false);
    setSelectedIds(new Set());
    reloadLista();
  }

  function abrirNueva() {
    cronometroNueva.reiniciar();
    setError("");
    setMetaDraft({
      titulo: "",
      descripcion: "",
      reino_id: reinos[0]?.id ?? "",
      base: "",
      unidad_base: "g",
      tip: "",
    });
    setLineasDraft([{ material_id: null, cantidad: 0, unidad: "g", etiqueta: "" }]);
    setProcesosDraft([{ id: 0, orden: 1, descripcion: "" }]);
    setModo("nueva");
  }

  async function crearReceta(ev: React.FormEvent, opts?: { iniciarMision?: boolean }) {
    ev.preventDefault();
    if (!metaDraft.titulo.trim()) {
      setError("El título es obligatorio.");
      return;
    }
    if (metaDraft.reino_id === "") {
      setError("Elige un reino.");
      return;
    }
    const procesosValidos = procesosDraft.filter((p) => p.descripcion.trim());
    if (opts?.iniciarMision && procesosValidos.length === 0) {
      setError("Agrega al menos un paso en Procesos para iniciar la misión.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const body = {
        titulo: metaDraft.titulo.trim(),
        descripcion: metaDraft.descripcion.trim(),
        reino_id: metaDraft.reino_id,
        tip: metaDraft.tip.trim(),
        unidad_base: metaDraft.unidad_base,
        base: metaDraft.base === "" ? null : Number(metaDraft.base),
        lineas: lineasDraft
          .filter((l) => l.material_id || l.etiqueta?.trim())
          .map((l) => ({
            material_id: l.material_id || null,
            etiqueta: l.etiqueta || "",
            cantidad: Number(l.cantidad) || 0,
            unidad: l.unidad || "g",
          })),
        procesos: procesosValidos.map((p) => ({
          descripcion: p.descripcion.trim(),
          duracion_min: p.duracion_min ?? null,
        })),
      };
      const creada = await tapi("/recetas", token, { method: "POST", body: JSON.stringify(body) });
      await reloadLista();
      if (opts?.iniciarMision) {
        if (cronometroNueva.activo) cronometroNueva.pausar();
        const c = await tapi(`/recetas/${creada.id}/iniciar`, token, {
          method: "POST",
          body: JSON.stringify({ segundos_previos: cronometroNueva.tomarSegundos() }),
        });
        creada.corrida = c;
        setReceta(creada);
        setLineasDraft(creada.lineas.map((l: RecetaLinea) => ({ ...l })));
        setProcesosDraft(creada.procesos.map((p: RecetaProceso) => ({ ...p })));
        setModo("elaborar");
        cronometroNueva.reiniciar();
      } else {
        setReceta(creada);
        setLineasDraft(creada.lineas.map((l: RecetaLinea) => ({ ...l })));
        setProcesosDraft(creada.procesos.map((p: RecetaProceso) => ({ ...p })));
        setModo("detalle");
        setEditLineas(creada.lineas.length === 0);
        setEditProcesos(creada.procesos.length === 0);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function guardarMeta() {
    if (!receta) return;
    setSaving(true);
    try {
      const r = await tapi(`/recetas/${receta.id}`, token, {
        method: "PUT",
        body: JSON.stringify({
          titulo: metaDraft.titulo.trim(),
          descripcion: metaDraft.descripcion.trim(),
          reino_id: metaDraft.reino_id === "" ? null : metaDraft.reino_id,
          tip: metaDraft.tip.trim(),
          unidad_base: metaDraft.unidad_base,
          base: metaDraft.base === "" ? null : Number(metaDraft.base),
        }),
      });
      setReceta(r);
      setEditMeta(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function archivarReceta() {
    if (!receta) return;
    setConfirmArchivar([receta.id]);
  }

  async function ejecutarArchivar(ids: number[]) {
    if (!ids.length) return;
    setConfirmArchivar(null);
    setSaving(true);
    setError("");
    setOkMsg("");
    const errores: string[] = [];
    let okCount = 0;
    try {
      for (const id of ids) {
        try {
          await archivarRecetaApi(id, token);
          okCount += 1;
        } catch (e: any) {
          errores.push(e.message);
        }
      }
      setSelectedIds(new Set());
      if (receta && ids.includes(receta.id)) {
        setReceta(null);
        setModo("lista");
      }
      await reloadLista();
      if (errores.length) {
        setError(
          okCount > 0
            ? `${okCount} archivada(s). Error: ${errores[0]}`
            : errores[0],
        );
      } else {
        setOkMsg(
          okCount === 1
            ? "Receta archivada."
            : `${okCount} recetas archivadas.`,
        );
      }
    } finally {
      setSaving(false);
    }
  }

  function puedeEditarEnLista(r: RecetaLista): boolean {
    return Boolean(r.es_propia || canEditCatalogo);
  }

  function esRecetaPropia(r: RecetaLista): boolean {
    return r.es_propia === true || r.origen_id == null;
  }

  function toggleSeleccion(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSeleccionarVisibles() {
    const ids = filtradas.map((r) => r.id);
    const todos = ids.length > 0 && ids.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (todos) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  }

  async function editarSeleccionada() {
    const ids = Array.from(selectedIds);
    if (ids.length !== 1) {
      setError("Selecciona una sola receta para editar.");
      return;
    }
    const r = lista.find((x) => x.id === ids[0]);
    if (!r || !puedeEditarEnLista(r)) {
      setError("No tienes permiso para editar esa receta.");
      return;
    }
    setError("");
    await loadReceta(ids[0]);
    setEditMeta(true);
    setSelectedIds(new Set());
  }

  function pedirArchivarSeleccionadas() {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    setConfirmArchivar(ids);
  }

  const filtradas = lista.filter((r) => {
    if (filtroTipo === "catalogo" && !esRecetaCatalogo(r)) return false;
    if (filtroTipo === "reinos" && !esRecetaDeReino(r)) return false;
    if (filtroReino !== "" && (!esRecetaDeReino(r) || r.reino_id !== filtroReino)) return false;
    if (!q.trim()) return true;
    const t = q.trim().toLowerCase();
    return (
      r.titulo.toLowerCase().includes(t)
      || (r.reino_nombre || "").toLowerCase().includes(t)
      || (r.categoria || "").toLowerCase().includes(t)
      || (esRecetaCatalogo(r) ? "catalogo" : "reino").includes(t)
    );
  });

  const recetasCatalogo = filtradas.filter(esRecetaCatalogo);
  const recetasReinos = filtradas.filter(esRecetaDeReino);
  const reinosAgrupados = reinos
    .map((reino) => ({
      reino,
      items: recetasReinos.filter((r) => r.reino_id === reino.id),
    }))
    .filter((g) => g.items.length > 0);
  const reinosSinAsignar = recetasReinos.filter((r) => !r.reino_id);
  const totalCatalogo = lista.filter(esRecetaCatalogo).length;
  const totalReinos = lista.filter(esRecetaDeReino).length;

  const todasVisiblesSeleccionadas =
    filtradas.length > 0 && filtradas.every((r) => selectedIds.has(r.id));
  const seleccionEditables = Array.from(selectedIds).filter((id) => {
    const r = lista.find((x) => x.id === id);
    return r && puedeEditarEnLista(r);
  });
  const canEditReceta = receta
    ? Boolean(receta.es_propia || receta.origen_id == null || canEditCatalogo)
    : true;

  const tiempoMostrar = corrida ? fmtTiempo(corrida.segundos_transcurridos ?? 0) : "00:00";
  void tick; // fuerza re-render cada segundo con el poll del cronómetro

  const selCls =
    "w-full rounded-paper border-2 border-border bg-surface-input px-2 py-1.5 text-sm outline-none focus:border-accent";

  const selectReino = (value: number | "", onChange: (id: number | "") => void, required?: boolean) => (
    <select
      className={selCls}
      value={value === "" ? "" : String(value)}
      required={required}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : "")}
    >
      <option value="">— Elegir reino —</option>
      {reinos.map((r) => (
        <option key={r.id} value={r.id}>
          {r.icono || "🏰"} {r.nombre}
        </option>
      ))}
    </select>
  );

  function badgeClasificacion(r: RecetaLista | RecetaDetalle, size: "sm" | "md" = "sm") {
    const cls = size === "md"
      ? "rounded-full px-2.5 py-0.5 text-[11px] font-bold"
      : "rounded-full px-2 py-0.5 text-[10px] font-bold";
    if (esRecetaCatalogo(r)) {
      return (
        <span className={`${cls} bg-amber-500/15 text-amber-800 dark:text-amber-200`}>
          📚 Catálogo McKenna
          {r.categoria ? ` · ${etiquetaCategoriaCatalogo(r.categoria)}` : ""}
        </span>
      );
    }
    return (
      <span
        className={`${cls} bg-emerald-500/15 text-emerald-800 dark:text-emerald-300`}
        style={r.reino_color ? { boxShadow: `inset 0 0 0 1px ${r.reino_color}44` } : undefined}
      >
        🏰 {r.reino_nombre ? `Reino: ${r.reino_nombre}` : "Receta de reino"}
      </span>
    );
  }

  function renderTarjeta(r: RecetaLista) {
    const marcada = selectedIds.has(r.id);
    return (
      <div
        key={r.id}
        className={`relative rounded-paper border-2 bg-surface-panel shadow-paper-sm transition ${
          marcada ? "border-accent ring-1 ring-accent/30" : "border-border hover:border-accent/60"
        }`}
      >
        <label
          className="absolute left-3 top-3 z-10 flex cursor-pointer items-center"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-2 border-border accent-accent"
            checked={marcada}
            onChange={() => toggleSeleccion(r.id)}
          />
        </label>
        <button
          type="button"
          onClick={() => loadReceta(r.id)}
          className="w-full p-4 pt-3 pl-10 text-left"
        >
          {r.corrida_activa_id && (
            <span className="mb-2 inline-block rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-bold text-accent">
              ⏱ En elaboración
            </span>
          )}
          <div className="mb-1">{badgeClasificacion(r)}</div>
          <h3 className="mt-1 font-extrabold text-ink">{r.titulo}</h3>
          <p className="mt-2 text-[10px] text-muted">
            {r.num_lineas} materiales · {r.num_procesos} procesos
          </p>
        </button>
      </div>
    );
  }

  function renderSeccion(
    titulo: string,
    subtitulo: string,
    items: RecetaLista[],
    accentClass = "border-border",
  ) {
    if (!items.length) return null;
    return (
      <section className="space-y-3">
        <div className={`rounded-paper border-l-4 ${accentClass} bg-surface-panel/50 px-4 py-2`}>
          <h3 className="text-sm font-extrabold text-ink">{titulo}</h3>
          <p className="text-[10px] text-muted">{subtitulo} · {items.length} receta{items.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map(renderTarjeta)}
        </div>
      </section>
    );
  }

  const modalConfirmarArchivar = confirmArchivar ? (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-paper border-2 border-border bg-surface-panel p-5 shadow-paper-lg space-y-4">
        <h3 className="text-lg font-extrabold text-ink">¿Archivar receta(s)?</h3>
        <p className="text-sm text-muted">
          Se ocultarán {confirmArchivar.length} receta
          {confirmArchivar.length !== 1 ? "s" : ""} del recetario.
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => setConfirmArchivar(null)}
            className="rounded-paper border-2 border-border px-4 py-2 text-sm font-bold text-muted"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => ejecutarArchivar(confirmArchivar)}
            className="rounded-paper border-2 border-red-500 bg-red-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {saving ? "Archivando…" : "Sí, archivar"}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  const bloqueLineasEditor = (draft: RecetaLinea[], setDraft: typeof setLineasDraft) => (
    <div className="space-y-2">
      {draft.map((l, i) => (
        <div key={i} className="grid grid-cols-12 gap-2 items-end">
          <div className="col-span-6">
            <select
              className={selCls}
              value={l.material_id ?? ""}
              onChange={(e) => {
                const mid = e.target.value ? Number(e.target.value) : null;
                const m = materiales.find((x) => x.id === mid);
                setDraft((d) => d.map((x, j) => j === i ? {
                  ...x,
                  material_id: mid,
                  unidad: m?.unidad || x.unidad,
                  etiqueta: m?.nombre || x.etiqueta,
                } : x));
              }}
            >
              <option value="">— Material inventario —</option>
              {materiales.map((m) => (
                <option key={m.id} value={m.id}>{m.nombre}</option>
              ))}
            </select>
          </div>
          <div className="col-span-3">
            <input type="number" step="any" className={selCls} value={l.cantidad}
              onChange={(e) => setDraft((d) => d.map((x, j) =>
                j === i ? { ...x, cantidad: parseFloat(e.target.value) || 0 } : x))} />
          </div>
          <div className="col-span-2">
            <select className={selCls} value={l.unidad}
              onChange={(e) => setDraft((d) => d.map((x, j) =>
                j === i ? { ...x, unidad: e.target.value } : x))}>
              {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <button type="button" className="col-span-1 text-red-500 text-xs font-bold"
            onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button type="button" className="text-xs font-bold text-accent"
        onClick={() => setDraft((d) => [...d, { material_id: null, cantidad: 0, unidad: "g", etiqueta: "" }])}>
        + Material
      </button>
    </div>
  );

  const bloqueProcesosEditor = (draft: RecetaProceso[], setDraft: typeof setProcesosDraft) => (
    <div className="space-y-2">
      {draft.map((p, i) => (
        <div key={i} className="flex gap-2">
          <span className="mt-2 text-xs font-bold text-muted w-5">{i + 1}.</span>
          <textarea className={`${selCls} flex-1 resize-none`} rows={2} value={p.descripcion}
            onChange={(e) => setDraft((d) => d.map((x, j) =>
              j === i ? { ...x, descripcion: e.target.value } : x))} placeholder="Describe el paso…" />
          <button type="button" className="text-red-500 text-xs"
            onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button type="button" className="text-xs font-bold text-accent"
        onClick={() => setDraft((d) => [...d, { id: 0, orden: d.length + 1, descripcion: "" }])}>
        + Paso
      </button>
    </div>
  );

  if (modo === "nueva") {
    return (
      <>
      {modalConfirmarArchivar}
      <div className="space-y-5 max-w-3xl">
        <div className="flex items-center gap-3">
          <button type="button" onClick={volverLista}
            className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-muted hover:border-accent">
            ← Cancelar
          </button>
          <h2 className="text-xl font-extrabold text-ink">✨ Nueva receta</h2>
        </div>
        {error && <p className={ALERT_ERROR_SM}>{error}</p>}
        <CronometroPanel
          segundos={cronometroNueva.segundos}
          activo={cronometroNueva.activo}
          onIniciar={cronometroNueva.iniciar}
          onPausar={cronometroNueva.pausar}
          onReiniciar={cronometroNueva.reiniciar}
          subtitulo="Inicia al comenzar la misión; el tiempo se guardará al crear e iniciar."
        />
        <form onSubmit={(e) => crearReceta(e)} className="space-y-5">
          <section className="rounded-paper border-2 border-border bg-surface-panel p-4 space-y-3">
            <h3 className="text-sm font-extrabold uppercase text-muted">Datos generales</h3>
            <div>
              <label className="mb-1 block text-xs font-bold text-muted">Título *</label>
              <input className={selCls} value={metaDraft.titulo} autoFocus required
                onChange={(e) => setMetaDraft((m) => ({ ...m, titulo: e.target.value }))}
                placeholder="Ej: Limpiador multiusos hogar" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-muted">Reino *</label>
              {selectReino(metaDraft.reino_id, (reino_id) => setMetaDraft((m) => ({ ...m, reino_id })), true)}
            </div>
            <div className="flex gap-2">
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-bold text-muted">Cantidad base</label>
                  <input type="number" step="any" className={selCls} value={metaDraft.base}
                    onChange={(e) => setMetaDraft((m) => ({ ...m, base: e.target.value }))} />
                </div>
                <div className="w-24">
                  <label className="mb-1 block text-xs font-bold text-muted">Unidad</label>
                  <select className={selCls} value={metaDraft.unidad_base}
                    onChange={(e) => setMetaDraft((m) => ({ ...m, unidad_base: e.target.value }))}>
                    {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-muted">Descripción</label>
              <textarea className={`${selCls} resize-none`} rows={2} value={metaDraft.descripcion}
                onChange={(e) => setMetaDraft((m) => ({ ...m, descripcion: e.target.value }))} />
            </div>
          </section>
          <section className="rounded-paper border-2 border-border bg-surface-panel p-4 space-y-3">
            <h3 className="text-sm font-extrabold uppercase text-muted">🧪 Materiales (inventario)</h3>
            {bloqueLineasEditor(lineasDraft, setLineasDraft)}
          </section>
          <section className="rounded-paper border-2 border-border bg-surface-panel p-4 space-y-3">
            <h3 className="text-sm font-extrabold uppercase text-muted">⚙️ Procesos</h3>
            {bloqueProcesosEditor(procesosDraft, setProcesosDraft)}
          </section>
          <button type="submit" disabled={saving || !metaDraft.titulo.trim() || metaDraft.reino_id === ""}
            className="w-full rounded-paper border-2 border-border bg-surface-panel py-3 text-sm font-bold text-ink disabled:opacity-50">
            {saving ? "Creando…" : "Crear receta"}
          </button>
          <button
            type="button"
            disabled={saving || !metaDraft.titulo.trim() || metaDraft.reino_id === ""}
            onClick={(e) => crearReceta(e as unknown as React.FormEvent, { iniciarMision: true })}
            className="w-full rounded-paper border-2 border-accent bg-accent py-3 text-sm font-bold text-white disabled:opacity-50"
          >
            {saving ? "Creando…" : "▶ Crear e iniciar misión"}
          </button>
        </form>
      </div>
      </>
    );
  }

  if (modo !== "lista" && receta) {
    const hechos = new Set(corrida?.procesos_hechos ?? []);

    return (
      <>
      {modalConfirmarArchivar}
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={volverLista}
            className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-muted hover:border-accent hover:text-accent">
            ← Recetas
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-extrabold text-ink truncate">{receta.titulo}</h2>
            <div className="mt-1 flex flex-wrap gap-2">
              {badgeClasificacion(receta, "md")}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canEditReceta && !corrida && (
              <>
                <button type="button" onClick={() => setEditMeta((v) => !v)}
                  className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-muted hover:border-accent">
                  ✏️ Datos
                </button>
                {!corrida && (
                  <button type="button" onClick={archivarReceta}
                    className="rounded-paper border-2 border-red-400/70 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50">
                    🗑
                  </button>
                )}
              </>
            )}
            {!corrida && (
              <button
                type="button"
                disabled={saving || receta.procesos.length === 0}
                onClick={iniciarElaboracion}
                className="rounded-paper border-2 border-accent bg-accent px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                ▶ Iniciar elaboración
              </button>
            )}
          </div>
        </div>

        {error && <p className={ALERT_ERROR_SM}>{error}</p>}

        {editMeta && canEditReceta && !corrida && (
          <form onSubmit={(e) => { e.preventDefault(); guardarMeta(); }}
            className="rounded-paper border-2 border-accent/40 bg-surface-panel p-4 space-y-3">
            <h3 className="text-sm font-extrabold text-accent">Editar receta</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-bold text-muted">Título *</label>
                <input className={selCls} value={metaDraft.titulo}
                  onChange={(e) => setMetaDraft((m) => ({ ...m, titulo: e.target.value }))} required />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-bold text-muted">Reino *</label>
                {selectReino(metaDraft.reino_id, (reino_id) => setMetaDraft((m) => ({ ...m, reino_id })), true)}
              </div>
              <div className="flex gap-2 sm:col-span-2">
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-bold text-muted">Base</label>
                  <input type="number" step="any" className={selCls} value={metaDraft.base}
                    onChange={(e) => setMetaDraft((m) => ({ ...m, base: e.target.value }))} />
                </div>
                <div className="w-24">
                  <label className="mb-1 block text-xs font-bold text-muted">Unidad</label>
                  <select className={selCls} value={metaDraft.unidad_base}
                    onChange={(e) => setMetaDraft((m) => ({ ...m, unidad_base: e.target.value }))}>
                    {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-bold text-muted">Descripción</label>
                <textarea className={`${selCls} resize-none`} rows={2} value={metaDraft.descripcion}
                  onChange={(e) => setMetaDraft((m) => ({ ...m, descripcion: e.target.value }))} />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-bold text-muted">Tip / nota</label>
                <input className={selCls} value={metaDraft.tip}
                  onChange={(e) => setMetaDraft((m) => ({ ...m, tip: e.target.value }))} />
              </div>
            </div>
            <button type="submit" disabled={saving}
              className="rounded-paper border-2 border-accent bg-accent px-4 py-2 text-xs font-bold text-white disabled:opacity-50">
              Guardar datos
            </button>
          </form>
        )}

        {corrida && corrida.estado !== "finalizada" && (
          <div className="rounded-paper border-2 border-accent/50 bg-accent/10 p-5 shadow-paper-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase text-muted">Cronómetro</p>
                <p className="font-mono text-4xl font-black tabular-nums text-accent">{tiempoMostrar}</p>
                <p className="mt-1 text-xs text-muted">
                  Estado:{" "}
                  <span className="font-bold text-ink">
                    {corrida.estado === "activa" ? "En curso" : "En pausa"}
                  </span>
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {corrida.estado === "activa" ? (
                  <button type="button" onClick={pausar}
                    className="rounded-paper border-2 border-border bg-surface-panel px-4 py-2 text-sm font-bold">
                    ⏸ Pausar
                  </button>
                ) : (
                  <button type="button" onClick={reanudar}
                    className="rounded-paper border-2 border-accent bg-accent px-4 py-2 text-sm font-bold text-white">
                    ▶ Reanudar
                  </button>
                )}
                <button type="button" onClick={finalizar}
                  className="rounded-paper border-2 border-green-600 bg-green-600 px-4 py-2 text-sm font-bold text-white">
                  ✓ Finalizar
                </button>
              </div>
            </div>
          </div>
        )}

        {corrida?.estado === "finalizada" && (
          <p className="rounded-lg bg-green-100 px-4 py-3 text-sm font-semibold text-green-800 dark:bg-green-950/40 dark:text-green-300">
            Elaboración finalizada · Tiempo total: {fmtTiempo(corrida.segundos_transcurridos)}
          </p>
        )}

        <div className="grid gap-5 lg:grid-cols-2">
          {/* Materiales */}
          <section className="rounded-paper border-2 border-border bg-surface-panel p-4 shadow-paper-sm space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-extrabold uppercase text-muted">🧪 Materiales (inventario)</h3>
              {canEditReceta && !corrida && (
                <button type="button" onClick={() => setEditLineas((v) => !v)}
                  className="text-xs font-bold text-accent hover:underline">
                  {editLineas ? "Cancelar" : "Editar"}
                </button>
              )}
            </div>
            {receta.base != null && (
              <p className="text-xs text-muted">
                Base de fórmula: <strong>{receta.base} {receta.unidad_base}</strong>
              </p>
            )}
            {editLineas ? (
              <div className="space-y-2">
                {lineasDraft.map((l, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-6">
                      <select
                        className={selCls}
                        value={l.material_id ?? ""}
                        onChange={(e) => {
                          const mid = e.target.value ? Number(e.target.value) : null;
                          const m = materiales.find((x) => x.id === mid);
                          setLineasDraft((d) => d.map((x, j) => j === i ? {
                            ...x,
                            material_id: mid,
                            unidad: m?.unidad || x.unidad,
                            etiqueta: m?.nombre || x.etiqueta,
                          } : x));
                        }}
                      >
                        <option value="">— Material —</option>
                        {materiales.map((m) => (
                          <option key={m.id} value={m.id}>{m.nombre}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-3">
                      <input
                        type="number"
                        step="any"
                        className={selCls}
                        value={l.cantidad}
                        onChange={(e) => setLineasDraft((d) => d.map((x, j) =>
                          j === i ? { ...x, cantidad: parseFloat(e.target.value) || 0 } : x))}
                      />
                    </div>
                    <div className="col-span-2">
                      <select
                        className={selCls}
                        value={l.unidad}
                        onChange={(e) => setLineasDraft((d) => d.map((x, j) =>
                          j === i ? { ...x, unidad: e.target.value } : x))}
                      >
                        {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>
                    <button type="button" className="col-span-1 text-red-500 text-xs font-bold"
                      onClick={() => setLineasDraft((d) => d.filter((_, j) => j !== i))}>×</button>
                  </div>
                ))}
                <button type="button"
                  className="text-xs font-bold text-accent"
                  onClick={() => setLineasDraft((d) => [...d, { material_id: null, cantidad: 0, unidad: "g", etiqueta: "" }])}>
                  + Línea
                </button>
                <button type="button" disabled={saving} onClick={guardarLineas}
                  className="block w-full rounded-paper border-2 border-accent bg-accent py-2 text-xs font-bold text-white disabled:opacity-50">
                  Guardar materiales
                </button>
              </div>
            ) : (
              <ul className="space-y-2">
                {(receta.lineas.length ? receta.lineas : []).map((l) => (
                  <li key={l.id} className="flex justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm">
                    <span className="font-semibold text-ink">{l.nombre}</span>
                    <span className="shrink-0 font-mono text-muted">
                      {l.cantidad} {l.unidad}
                      {l.stock_actual != null && (
                        <span className={`ml-2 text-[10px] ${l.stock_actual < l.cantidad ? "text-red-600" : "text-green-700"}`}>
                          (stock {l.stock_actual})
                        </span>
                      )}
                    </span>
                  </li>
                ))}
                {receta.lineas.length === 0 && (
                  <p className="text-xs text-muted italic">Sin materiales vinculados. Edita para enlazar inventario.</p>
                )}
              </ul>
            )}
          </section>

          {/* Procesos */}
          <section className="rounded-paper border-2 border-border bg-surface-panel p-4 shadow-paper-sm space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-extrabold uppercase text-muted">⚙️ Procesos</h3>
              {canEditReceta && !corrida && (
                <button type="button" onClick={() => setEditProcesos((v) => !v)}
                  className="text-xs font-bold text-accent hover:underline">
                  {editProcesos ? "Cancelar" : "Editar"}
                </button>
              )}
            </div>
            {editProcesos ? (
              <div className="space-y-2">
                {procesosDraft.map((p, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="mt-2 text-xs font-bold text-muted w-5">{i + 1}.</span>
                    <textarea
                      className={`${selCls} flex-1 resize-none`}
                      rows={2}
                      value={p.descripcion}
                      onChange={(e) => setProcesosDraft((d) => d.map((x, j) =>
                        j === i ? { ...x, descripcion: e.target.value } : x))}
                    />
                    <input
                      type="number"
                      placeholder="min"
                      className={`${selCls} w-16`}
                      value={p.duracion_min ?? ""}
                      onChange={(e) => setProcesosDraft((d) => d.map((x, j) =>
                        j === i ? { ...x, duracion_min: e.target.value ? parseInt(e.target.value, 10) : null } : x))}
                    />
                    <button type="button" className="text-red-500 text-xs"
                      onClick={() => setProcesosDraft((d) => d.filter((_, j) => j !== i))}>×</button>
                  </div>
                ))}
                <button type="button" className="text-xs font-bold text-accent"
                  onClick={() => setProcesosDraft((d) => [...d, { id: 0, orden: d.length + 1, descripcion: "" }])}>
                  + Paso
                </button>
                <button type="button" disabled={saving} onClick={guardarProcesos}
                  className="block w-full rounded-paper border-2 border-accent bg-accent py-2 text-xs font-bold text-white">
                  Guardar procesos
                </button>
              </div>
            ) : (
              <ol className="space-y-2">
                {receta.procesos.map((p) => {
                  const done = hechos.has(p.id);
                  const activo = corrida && !done && p.orden === corrida.proceso_orden_actual;
                  return (
                    <li
                      key={p.id}
                      className={`rounded-lg border-2 px-3 py-2 text-sm ${
                        done ? "border-green-400/60 bg-green-50 dark:bg-green-950/30"
                        : activo ? "border-accent bg-accent/10"
                        : "border-border/60"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className={done ? "line-through text-muted" : "text-ink"}>
                          <strong>{p.orden}.</strong> {p.descripcion}
                          {p.duracion_min ? (
                            <span className="ml-1 text-[10px] text-muted">(~{p.duracion_min} min)</span>
                          ) : null}
                        </span>
                        {corrida && corrida.estado !== "finalizada" && !done && (
                          <button
                            type="button"
                            onClick={() => marcarProceso(p.id)}
                            className="shrink-0 rounded border border-accent px-2 py-0.5 text-[10px] font-bold text-accent hover:bg-accent hover:text-white"
                          >
                            ✓ Hecho
                          </button>
                        )}
                        {done && <span className="text-green-600 text-xs font-bold">✓</span>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>

        {receta.tip && (
          <p className="rounded-lg bg-accent/10 px-4 py-3 text-sm text-accent">💡 {receta.tip}</p>
        )}
        {receta.descripcion && (
          <p className="text-sm text-muted">{receta.descripcion}</p>
        )}
      </div>
      </>
    );
  }

  return (
    <>
    {modalConfirmarArchivar}
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack}
            className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-muted hover:border-accent hover:text-accent">
            ← Volver
          </button>
          <div>
            <h2 className="text-xl font-extrabold text-ink">📖 Recetario</h2>
            <p className="text-xs text-muted">
              📚 Catálogo importado · 🏰 recetas por reino · cronómetro
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={abrirNueva}
          className="rounded-paper border-2 border-accent bg-accent px-4 py-2 text-sm font-bold text-white shadow-[0_2px_0_#045159] hover:bg-accent-hover"
        >
          + Nueva receta
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          className="min-w-[12rem] flex-1 rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm outline-none focus:border-accent"
          placeholder="Buscar receta…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm outline-none focus:border-accent"
          value={filtroTipo}
          onChange={(e) => setFiltroTipo(e.target.value as "" | "catalogo" | "reinos")}
        >
          <option value="">Todas (clasificadas)</option>
          <option value="catalogo">📚 Catálogo McKenna</option>
          <option value="reinos">🏰 Recetas de reinos</option>
        </select>
        <select
          className="rounded-paper border-2 border-border bg-surface-input px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-40"
          value={filtroReino === "" ? "" : String(filtroReino)}
          disabled={filtroTipo === "catalogo"}
          onChange={(e) => setFiltroReino(e.target.value ? Number(e.target.value) : "")}
        >
          <option value="">{filtroTipo === "catalogo" ? "— Solo catálogo —" : "Todos los reinos"}</option>
          {reinos.map((r) => (
            <option key={r.id} value={r.id}>
              {r.icono || "🏰"} {r.nombre}
            </option>
          ))}
        </select>
      </div>

      {!loading && lista.length > 0 && (
        <div className="flex flex-wrap gap-2 text-[10px] font-bold">
          <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-amber-800 dark:text-amber-200">
            📚 Catálogo: {totalCatalogo}
          </span>
          <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-emerald-700 dark:text-emerald-300">
            🏰 Reinos: {totalReinos}
          </span>
        </div>
      )}

      {error && <p className={ALERT_ERROR_SM}>{error}</p>}
      {okMsg && (
        <p className="rounded-lg bg-emerald-500/15 px-3 py-2 text-sm font-bold text-emerald-700 dark:text-emerald-300">
          {okMsg}
        </p>
      )}

      {loading && <p className="text-sm text-muted py-8 text-center">Cargando…</p>}

      {!loading && filtradas.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-paper border-2 border-border/80 bg-surface-panel/60 px-3 py-2">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-muted">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-2 border-border accent-accent"
              checked={todasVisiblesSeleccionadas}
              onChange={toggleSeleccionarVisibles}
            />
            Seleccionar visibles ({filtradas.length})
          </label>
          {selectedIds.size > 0 && (
            <>
              <span className="text-xs font-bold text-accent">
                {selectedIds.size} seleccionada{selectedIds.size !== 1 ? "s" : ""}
              </span>
              <button
                type="button"
                disabled={saving || seleccionEditables.length !== 1}
                onClick={editarSeleccionada}
                title={selectedIds.size !== 1 ? "Elige una sola receta" : "Editar datos"}
                className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-bold text-muted hover:border-accent disabled:opacity-40"
              >
                ✏️ Editar
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  pedirArchivarSeleccionadas();
                }}
                className="rounded-paper border-2 border-red-400/70 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50 disabled:opacity-40"
              >
                {saving ? "Archivando…" : `🗑 Eliminar (${selectedIds.size})`}
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="text-xs font-bold text-muted hover:text-accent"
              >
                Limpiar
              </button>
            </>
          )}
        </div>
      )}

      {!loading && !error && filtradas.length === 0 && (
        <div className="py-12 text-center space-y-3">
          <p className="text-sm text-muted">
            {filtroTipo === "reinos"
              ? "Aún no hay recetas creadas en los reinos. Usa + Nueva receta y elige un reino."
              : filtroTipo === "catalogo"
                ? "No hay recetas del catálogo con ese filtro."
                : "No hay recetas con ese filtro."}
          </p>
          <button
            type="button"
            onClick={abrirNueva}
            className="rounded-paper border-2 border-accent bg-accent px-4 py-2 text-sm font-bold text-white"
          >
            + Crear tu primera receta
          </button>
        </div>
      )}

      <div className="space-y-8">
        {(filtroTipo === "" || filtroTipo === "catalogo") &&
          renderSeccion(
            "📚 Recetas del catálogo McKenna",
            "Importadas del sitio web · referencia y elaboración",
            recetasCatalogo,
            "border-l-amber-500",
          )}

        {(filtroTipo === "" || filtroTipo === "reinos") && recetasReinos.length > 0 && (
          <>
            <div className="rounded-paper border-l-4 border-l-emerald-500 bg-surface-panel/50 px-4 py-2">
              <h3 className="text-sm font-extrabold text-ink">🏰 Recetas de los reinos</h3>
              <p className="text-[10px] text-muted">
                Creadas en el Centro de Mando · vinculadas a un reino · {recetasReinos.length} receta
                {recetasReinos.length !== 1 ? "s" : ""}
              </p>
            </div>
            {reinosAgrupados.map(({ reino, items }) => (
              <div key={reino.id} className="space-y-3 pl-0 sm:pl-2">
                <p
                  className="text-xs font-extrabold uppercase tracking-wide"
                  style={{ color: reino.color || undefined }}
                >
                  {reino.icono || "🏰"} {reino.nombre}
                </p>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {items.map(renderTarjeta)}
                </div>
              </div>
            ))}
            {reinosSinAsignar.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-bold text-muted">Sin reino asignado</p>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {reinosSinAsignar.map(renderTarjeta)}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
    </>
  );
}
