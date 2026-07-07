import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import {
  duplicarPlantillaVisual,
  fusionarMetadatosPlantillaTrasGuardar,
  labelFormato,
  plantillaVacia,
  type FormatoCanvas,
  type PlantillaVisualDoc,
} from "../../lib/plantillasVisuales";
import {
  descargarBlob,
  exportarPlantillaBlob,
  subirImagenBlobAEtiquetas,
} from "../../lib/plantillasVisualesExport";
import { resolverUrlImagenCanvas } from "../../lib/plantillasVisualesImagen";
import { LightboxImagen, MiniaturaRecursoPng, formatoBytesRecurso } from "../etiquetas/RecursoPngViewer";
import PlantillaVisualMiniatura from "./PlantillaVisualMiniatura";
import SelectorFormatoCanvas from "./SelectorFormatoCanvas";
import VisualCanvasEditor from "./VisualCanvasEditor";

interface RecursoPngBiblioteca {
  id: string | null;
  nombre: string;
  subido_at?: string;
  bytes?: number;
  thumb_b64?: string | null;
  thumb_mime?: string | null;
}

const formatoBytes = formatoBytesRecurso;

function BibliotecaEtiquetasSection() {
  const qc = useQueryClient();
  const [buscar, setBuscar] = useState("");
  const [descargandoId, setDescargandoId] = useState<string | null>(null);
  const [eliminandoId, setEliminandoId] = useState<string | null>(null);
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [eliminandoLote, setEliminandoLote] = useState(false);
  const [errorLote, setErrorLote] = useState<string | null>(null);
  const [vistaPreviaNombre, setVistaPreviaNombre] = useState<string | null>(null);
  const [carpetaActual, setCarpetaActual] = useState("");
  const [creandoCarpeta, setCreandoCarpeta] = useState(false);
  const [moviendoLote, setMoviendoLote] = useState(false);
  const [menuMoverAbierto, setMenuMoverAbierto] = useState(false);
  const [arrastrando, setArrastrando] = useState<string[] | null>(null);
  const [carpetaHoverDrop, setCarpetaHoverDrop] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["etiquetas-recursos-png", carpetaActual],
    queryFn: () =>
      api.get<{ recursos: RecursoPngBiblioteca[]; carpetas: string[]; carpeta_actual: string }>(
        `/api/etiquetas/recursos-png?carpeta=${encodeURIComponent(carpetaActual)}`,
      ),
    staleTime: 15_000,
  });

  const { data: carpetasTodasData } = useQuery({
    queryKey: ["etiquetas-recursos-png-carpetas"],
    queryFn: () => api.get<{ carpetas: string[] }>("/api/etiquetas/recursos-png/carpetas"),
    staleTime: 15_000,
  });

  const recursos = data?.recursos ?? [];
  const q = buscar.trim().toLowerCase();
  const filtrados = q ? recursos.filter((r) => r.nombre.toLowerCase().includes(q)) : recursos;
  const subcarpetas = useMemo(() => {
    const nombres = data?.carpetas ?? [];
    if (!q) return nombres;
    return nombres.filter((n) => n.toLowerCase().includes(q));
  }, [data?.carpetas, q]);
  const segmentosRuta = carpetaActual ? carpetaActual.split("/").filter(Boolean) : [];

  function irACarpeta(rel: string) {
    setCarpetaActual(rel);
    setSeleccionados(new Set());
    setMenuMoverAbierto(false);
  }

  function alternarSeleccion(nombre: string) {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(nombre)) next.delete(nombre);
      else next.add(nombre);
      return next;
    });
  }

  const todosFiltradosSeleccionados =
    filtrados.length > 0 && filtrados.every((r) => seleccionados.has(r.nombre));

  function alternarSeleccionarTodo() {
    setSeleccionados((prev) => {
      if (todosFiltradosSeleccionados) {
        const next = new Set(prev);
        filtrados.forEach((r) => next.delete(r.nombre));
        return next;
      }
      const next = new Set(prev);
      filtrados.forEach((r) => next.add(r.nombre));
      return next;
    });
  }

  const eliminarMut = useMutation({
    mutationFn: (nombre: string) =>
      api.delete<{ ok: boolean }>(`/api/etiquetas/recursos-png/${encodeURIComponent(nombre)}`),
    onMutate: (nombre) => setEliminandoId(nombre),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["etiquetas-recursos-png"] }),
    onSettled: () => setEliminandoId(null),
  });

  const eliminarLoteMut = useMutation({
    mutationFn: (nombres: string[]) =>
      api.post<{ ok: boolean; eliminados: string[]; errores: Record<string, string> }>(
        "/api/etiquetas/recursos-png/eliminar-lote",
        { nombres },
      ),
    onMutate: () => {
      setEliminandoLote(true);
      setErrorLote(null);
    },
    onSuccess: (res) => {
      setSeleccionados((prev) => {
        const next = new Set(prev);
        res.eliminados.forEach((n) => next.delete(n));
        return next;
      });
      const fallidos = Object.keys(res.errores || {});
      if (fallidos.length > 0) {
        setErrorLote(`No se pudieron eliminar ${fallidos.length}: ${fallidos.slice(0, 3).join(", ")}${fallidos.length > 3 ? "…" : ""}`);
      }
      void qc.invalidateQueries({ queryKey: ["etiquetas-recursos-png"] });
    },
    onError: (e: Error) => setErrorLote(e.message || "Error al eliminar las imágenes seleccionadas"),
    onSettled: () => setEliminandoLote(false),
  });

  function eliminarSeleccionados() {
    const nombres = Array.from(seleccionados);
    if (nombres.length === 0) return;
    if (!window.confirm(`¿Eliminar ${nombres.length} imagen(es) seleccionada(s) de la biblioteca?`)) return;
    eliminarLoteMut.mutate(nombres);
  }

  const crearCarpetaMut = useMutation({
    mutationFn: (nombre: string) =>
      api.post<{ ok: boolean; carpeta: string }>("/api/etiquetas/recursos-png/carpetas", {
        nombre,
        carpeta_padre: carpetaActual,
      }),
    onMutate: () => setCreandoCarpeta(true),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["etiquetas-recursos-png"] });
      void qc.invalidateQueries({ queryKey: ["etiquetas-recursos-png-carpetas"] });
    },
    onError: (e: Error) => setErrorLote(e.message || "No se pudo crear la carpeta"),
    onSettled: () => setCreandoCarpeta(false),
  });

  function crearCarpeta() {
    const nombre = window.prompt("Nombre de la nueva carpeta:");
    if (!nombre || !nombre.trim()) return;
    crearCarpetaMut.mutate(nombre.trim());
  }

  const renombrarCarpetaMut = useMutation({
    mutationFn: ({ carpeta, nombreNuevo }: { carpeta: string; nombreNuevo: string }) =>
      api.post<{ ok: boolean; carpeta: string }>(
        "/api/etiquetas/recursos-png/carpetas/renombrar",
        { carpeta, nombre_nuevo: nombreNuevo },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["etiquetas-recursos-png"] });
      void qc.invalidateQueries({ queryKey: ["etiquetas-recursos-png-carpetas"] });
    },
    onError: (e: Error) => setErrorLote(e.message || "No se pudo renombrar la carpeta"),
  });

  function renombrarCarpeta(rel: string, nombreActual: string) {
    const nombreNuevo = window.prompt("Nuevo nombre de la carpeta:", nombreActual);
    if (!nombreNuevo || !nombreNuevo.trim() || nombreNuevo.trim() === nombreActual) return;
    renombrarCarpetaMut.mutate({ carpeta: rel, nombreNuevo: nombreNuevo.trim() });
  }

  const moverLoteMut = useMutation({
    mutationFn: ({ nombres, destino }: { nombres: string[]; destino: string }) =>
      api.post<{ ok: boolean; movidos: string[]; errores: Record<string, string> }>(
        "/api/etiquetas/recursos-png/mover",
        { nombres, carpeta_destino: destino },
      ),
    onMutate: () => {
      setMoviendoLote(true);
      setErrorLote(null);
    },
    onSuccess: (res) => {
      setMenuMoverAbierto(false);
      setSeleccionados(new Set());
      const fallidos = Object.keys(res.errores || {});
      if (fallidos.length > 0) {
        setErrorLote(`No se pudieron mover ${fallidos.length}: ${fallidos.slice(0, 3).join(", ")}${fallidos.length > 3 ? "…" : ""}`);
      }
      void qc.invalidateQueries({ queryKey: ["etiquetas-recursos-png"] });
      void qc.invalidateQueries({ queryKey: ["etiquetas-recursos-png-carpetas"] });
    },
    onError: (e: Error) => setErrorLote(e.message || "Error al mover las imágenes seleccionadas"),
    onSettled: () => setMoviendoLote(false),
  });

  function moverSeleccionados(destino: string) {
    const nombres = Array.from(seleccionados);
    if (nombres.length === 0) return;
    moverLoteMut.mutate({ nombres, destino });
  }

  function iniciarArrastre(nombre: string) {
    const enSeleccion = seleccionados.has(nombre) && seleccionados.size > 1;
    setArrastrando(enSeleccion ? Array.from(seleccionados) : [nombre]);
  }

  function finalizarArrastre() {
    setArrastrando(null);
    setCarpetaHoverDrop(null);
  }

  function soltarEnCarpeta(destino: string) {
    if (arrastrando && arrastrando.length > 0) {
      moverLoteMut.mutate({ nombres: arrastrando, destino });
    }
    finalizarArrastre();
  }

  async function descargar(nombre: string) {
    setDescargandoId(nombre);
    try {
      const url = await resolverUrlImagenCanvas(
        `/api/etiquetas/recursos-png/archivo/${encodeURIComponent(nombre)}`,
      );
      const res = await fetch(url);
      const blob = await res.blob();
      descargarBlob(blob, nombre);
    } finally {
      setDescargandoId(null);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface-panel p-4">
      <div className="mb-3 flex flex-wrap items-center gap-1 text-xs">
        <span className="mr-2 text-sm font-bold text-ink">Biblioteca de etiquetas</span>
        <button
          type="button"
          onClick={() => irACarpeta("")}
          disabled={carpetaActual === ""}
          onDragOver={(e) => {
            if (!arrastrando || carpetaActual === "") return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }}
          onDragEnter={(e) => {
            if (!arrastrando || carpetaActual === "") return;
            e.preventDefault();
            setCarpetaHoverDrop("");
          }}
          onDragLeave={() => setCarpetaHoverDrop((v) => (v === "" ? null : v))}
          onDrop={(e) => {
            if (carpetaActual === "") return;
            e.preventDefault();
            soltarEnCarpeta("");
          }}
          className={`rounded px-1.5 py-0.5 font-semibold text-ink-secondary hover:bg-surface-hover disabled:cursor-default disabled:font-bold disabled:text-ink disabled:hover:bg-transparent ${
            carpetaHoverDrop === "" ? "bg-accent/15 text-accent" : ""
          }`}
        >
          📁 Raíz
        </button>
        {segmentosRuta.map((seg, i) => {
          const rel = segmentosRuta.slice(0, i + 1).join("/");
          const esUltimo = i === segmentosRuta.length - 1;
          return (
            <span key={rel} className="flex items-center gap-1">
              <span className="text-muted">/</span>
              <button
                type="button"
                onClick={() => irACarpeta(rel)}
                disabled={esUltimo}
                onDragOver={(e) => {
                  if (!arrastrando || esUltimo) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDragEnter={(e) => {
                  if (!arrastrando || esUltimo) return;
                  e.preventDefault();
                  setCarpetaHoverDrop(rel);
                }}
                onDragLeave={() => setCarpetaHoverDrop((v) => (v === rel ? null : v))}
                onDrop={(e) => {
                  if (esUltimo) return;
                  e.preventDefault();
                  soltarEnCarpeta(rel);
                }}
                className={`rounded px-1.5 py-0.5 font-semibold text-ink-secondary hover:bg-surface-hover disabled:cursor-default disabled:font-bold disabled:text-ink disabled:hover:bg-transparent ${
                  carpetaHoverDrop === rel ? "bg-accent/15 text-accent" : ""
                }`}
              >
                {seg}
              </button>
            </span>
          );
        })}
        <button
          type="button"
          onClick={crearCarpeta}
          disabled={creandoCarpeta}
          className="ml-2 shrink-0 rounded-lg border border-border px-2 py-1 font-semibold text-ink-secondary hover:bg-surface-hover disabled:opacity-50"
        >
          {creandoCarpeta ? "…" : "+ Carpeta"}
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
          placeholder="Buscar imagen…"
          className="min-w-0 flex-1 max-w-sm rounded-lg border border-border bg-surface px-3 py-1.5 text-sm"
        />
        <span className="shrink-0 text-xs text-muted">{filtrados.length} imagen(es)</span>
        {filtrados.length > 0 && (
          <label className="flex shrink-0 items-center gap-1.5 text-xs text-ink-secondary">
            <input
              type="checkbox"
              checked={todosFiltradosSeleccionados}
              onChange={alternarSeleccionarTodo}
            />
            Seleccionar todo
          </label>
        )}
        {seleccionados.size > 0 && (
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setMenuMoverAbierto((v) => !v)}
              disabled={moviendoLote}
              className="rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-ink-secondary hover:bg-surface-hover disabled:opacity-50"
            >
              {moviendoLote ? "Moviendo…" : `Mover a… (${seleccionados.size})`}
            </button>
            {menuMoverAbierto && (
              <div className="absolute left-0 top-full z-30 mt-1 max-h-52 min-w-[180px] overflow-y-auto rounded-lg border border-border bg-surface-panel py-1 text-xs shadow-xl">
                <button
                  type="button"
                  onClick={() => moverSeleccionados("")}
                  disabled={carpetaActual === ""}
                  className="block w-full px-3 py-1.5 text-left font-semibold text-ink hover:bg-surface-hover disabled:opacity-40"
                >
                  📁 Raíz
                </button>
                {(carpetasTodasData?.carpetas ?? [])
                  .filter((c) => c !== carpetaActual)
                  .map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => moverSeleccionados(c)}
                      className="block w-full truncate px-3 py-1.5 text-left text-ink hover:bg-surface-hover"
                      title={c}
                    >
                      📁 {c}
                    </button>
                  ))}
              </div>
            )}
          </div>
        )}
        {seleccionados.size > 0 && (
          <button
            type="button"
            onClick={eliminarSeleccionados}
            disabled={eliminandoLote}
            className="shrink-0 rounded-md border border-red-300 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
          >
            {eliminandoLote ? "Eliminando…" : `Eliminar seleccionadas (${seleccionados.size})`}
          </button>
        )}
      </div>

      {errorLote && (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
          {errorLote}
        </p>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      ) : filtrados.length === 0 && subcarpetas.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted">
          {q ? "No hay imágenes ni carpetas con ese nombre." : "Carpeta vacía. Sube una imagen o crea una subcarpeta."}
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
          {subcarpetas.map((nombreCarpeta) => {
            const rel = carpetaActual ? `${carpetaActual}/${nombreCarpeta}` : nombreCarpeta;
            const enHoverDrop = carpetaHoverDrop === rel;
            return (
              <div
                key={rel}
                role="button"
                tabIndex={0}
                onDoubleClick={() => irACarpeta(rel)}
                onClick={() => irACarpeta(rel)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") irACarpeta(rel);
                }}
                title={rel}
                onDragOver={(e) => {
                  if (!arrastrando) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDragEnter={(e) => {
                  if (!arrastrando) return;
                  e.preventDefault();
                  setCarpetaHoverDrop(rel);
                }}
                onDragLeave={() => setCarpetaHoverDrop((v) => (v === rel ? null : v))}
                onDrop={(e) => {
                  e.preventDefault();
                  soltarEnCarpeta(rel);
                }}
                className={`group/carpeta relative flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-2 text-center transition ${
                  enHoverDrop
                    ? "border-accent bg-accent/10"
                    : "border-border bg-surface hover:border-accent hover:bg-surface-hover"
                }`}
              >
                <button
                  type="button"
                  title="Renombrar carpeta"
                  onClick={(e) => {
                    e.stopPropagation();
                    renombrarCarpeta(rel, nombreCarpeta);
                  }}
                  className="absolute right-1 top-1 rounded-md border border-border bg-white/95 px-1 py-0.5 text-[10px] opacity-0 shadow-sm transition hover:bg-surface-hover group-hover/carpeta:opacity-100 dark:bg-zinc-900/95"
                >
                  ✎
                </button>
                <span className="text-3xl">📁</span>
                <span className="w-full truncate text-[10px] text-ink">{nombreCarpeta}</span>
              </div>
            );
          })}
          {filtrados.map((r) => {
            const activo = seleccionados.has(r.nombre);
            return (
            <div
              key={r.nombre}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                iniciarArrastre(r.nombre);
              }}
              onDragEnd={finalizarArrastre}
              title="Arrastra a una carpeta para mover"
              className={`group relative flex cursor-grab flex-col overflow-hidden rounded-lg border bg-surface active:cursor-grabbing ${
                activo ? "border-accent ring-2 ring-accent/40" : "border-border"
              }`}
            >
              <label className="absolute left-1 top-1 z-10 flex h-5 w-5 cursor-pointer items-center justify-center rounded border border-border bg-white/95 shadow-sm dark:bg-zinc-900/95">
                <input
                  type="checkbox"
                  checked={activo}
                  onChange={() => alternarSeleccion(r.nombre)}
                  className="h-3.5 w-3.5"
                />
              </label>
              <button
                type="button"
                title="Ver imagen"
                onClick={() => setVistaPreviaNombre(r.nombre)}
                className="flex aspect-square items-center justify-center bg-zinc-100 p-1 hover:opacity-90 dark:bg-zinc-800/40"
              >
                <MiniaturaRecursoPng nombre={r.nombre} thumbB64={r.thumb_b64} thumbMime={r.thumb_mime} />
              </button>
              <div className="px-1.5 py-1">
                <p className="truncate text-[10px] text-ink" title={r.nombre}>
                  {r.nombre}
                </p>
                <p className="truncate text-[9px] text-muted">{formatoBytes(r.bytes)}</p>
              </div>
              <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition group-hover:opacity-100">
                <button
                  type="button"
                  title="Descargar"
                  disabled={descargandoId === r.nombre}
                  onClick={() => void descargar(r.nombre)}
                  className="rounded-md border border-border bg-white/95 px-1.5 py-0.5 text-[10px] font-semibold text-ink-secondary shadow-sm hover:bg-surface-hover disabled:opacity-50 dark:bg-zinc-900/95"
                >
                  {descargandoId === r.nombre ? "…" : "⬇"}
                </button>
                <button
                  type="button"
                  title="Eliminar"
                  disabled={eliminandoId === r.nombre}
                  onClick={() => {
                    if (!window.confirm(`¿Eliminar "${r.nombre}" de la biblioteca?`)) return;
                    eliminarMut.mutate(r.nombre);
                  }}
                  className="rounded-md border border-red-200 bg-white/95 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 shadow-sm hover:bg-red-50 disabled:opacity-50 dark:border-red-900/50 dark:bg-zinc-900/95 dark:hover:bg-red-950/80"
                >
                  {eliminandoId === r.nombre ? "…" : "✕"}
                </button>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {vistaPreviaNombre && (
        <LightboxImagen
          nombre={vistaPreviaNombre}
          onCerrar={() => setVistaPreviaNombre(null)}
          onDescargar={() => void descargar(vistaPreviaNombre)}
          onEliminar={() => {
            if (!window.confirm(`¿Eliminar "${vistaPreviaNombre}" de la biblioteca?`)) return;
            eliminarMut.mutate(vistaPreviaNombre, {
              onSuccess: () => setVistaPreviaNombre(null),
            });
          }}
          descargando={descargandoId === vistaPreviaNombre}
          eliminando={eliminandoId === vistaPreviaNombre}
        />
      )}
    </div>
  );
}

type Vista = "lista" | "formato" | "editor";

export default function PlantillasVisualesPanel({
  onInmersivoChange,
}: {
  /** Notifica cuando el editor entra/sale de la vista de lienzo a pantalla completa. */
  onInmersivoChange?: (inmersivo: boolean) => void;
} = {}) {
  const qc = useQueryClient();
  const [vista, setVista] = useState<Vista>("lista");
  const [doc, setDoc] = useState<PlantillaVisualDoc | null>(null);
  const [buscar, setBuscar] = useState("");
  const [buscarDebounced, setBuscarDebounced] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  // Snapshot del último doc guardado (o recién abierto): compararlo con `doc`
  // dice si hay cambios sin guardar, para poder avisar antes de perderlos.
  const docGuardadoRef = useRef<PlantillaVisualDoc | null>(null);
  const [carpetaActual, setCarpetaActual] = useState("");
  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(new Set());
  const [creandoCarpeta, setCreandoCarpeta] = useState(false);
  const [moviendoLote, setMoviendoLote] = useState(false);
  const [menuMoverAbierto, setMenuMoverAbierto] = useState(false);
  const [arrastrandoIds, setArrastrandoIds] = useState<string[] | null>(null);
  const [carpetaHoverDrop, setCarpetaHoverDrop] = useState<string | null>(null);

  useEffect(() => {
    onInmersivoChange?.(vista === "editor");
    return () => onInmersivoChange?.(false);
  }, [vista, onInmersivoChange]);

  useEffect(() => {
    const t = window.setTimeout(() => setBuscarDebounced(buscar), 250);
    return () => window.clearTimeout(t);
  }, [buscar]);

  const { data, isLoading } = useQuery({
    queryKey: ["plantillas-visuales", buscarDebounced, carpetaActual],
    queryFn: () =>
      api.get<{ plantillas: PlantillaVisualDoc[]; carpetas: string[]; carpeta_actual: string }>(
        `/api/plantillas-visuales?carpeta=${encodeURIComponent(carpetaActual)}${buscarDebounced ? `&q=${encodeURIComponent(buscarDebounced)}` : ""}`,
      ),
    staleTime: 15_000,
  });

  const { data: carpetasTodasData } = useQuery({
    queryKey: ["plantillas-visuales-carpetas"],
    queryFn: () => api.get<{ carpetas: string[] }>("/api/plantillas-visuales/carpetas"),
    staleTime: 15_000,
  });

  const plantillas = data?.plantillas ?? [];
  const subcarpetas = data?.carpetas ?? [];
  const segmentosRuta = carpetaActual ? carpetaActual.split("/").filter(Boolean) : [];

  function irACarpeta(rel: string) {
    setCarpetaActual(rel);
    setSeleccionadas(new Set());
    setMenuMoverAbierto(false);
  }

  function alternarSeleccionPlantilla(id: string) {
    setSeleccionadas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const crearCarpetaPlantillaMut = useMutation({
    mutationFn: (nombre: string) =>
      api.post<{ ok: boolean; carpeta: string }>("/api/plantillas-visuales/carpetas", {
        nombre,
        carpeta_padre: carpetaActual,
      }),
    onMutate: () => setCreandoCarpeta(true),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["plantillas-visuales"] });
      void qc.invalidateQueries({ queryKey: ["plantillas-visuales-carpetas"] });
    },
    onError: (e: Error) => setMsg(e.message || "No se pudo crear la carpeta"),
    onSettled: () => setCreandoCarpeta(false),
  });

  function crearCarpetaPlantilla() {
    const nombre = window.prompt("Nombre de la nueva carpeta:");
    if (!nombre || !nombre.trim()) return;
    crearCarpetaPlantillaMut.mutate(nombre.trim());
  }

  const renombrarCarpetaPlantillaMut = useMutation({
    mutationFn: ({ carpeta, nombreNuevo }: { carpeta: string; nombreNuevo: string }) =>
      api.post<{ ok: boolean; carpeta: string }>(
        "/api/plantillas-visuales/carpetas/renombrar",
        { carpeta, nombre_nuevo: nombreNuevo },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["plantillas-visuales"] });
      void qc.invalidateQueries({ queryKey: ["plantillas-visuales-carpetas"] });
    },
    onError: (e: Error) => setMsg(e.message || "No se pudo renombrar la carpeta"),
  });

  function renombrarCarpetaPlantilla(rel: string, nombreActual: string) {
    const nombreNuevo = window.prompt("Nuevo nombre de la carpeta:", nombreActual);
    if (!nombreNuevo || !nombreNuevo.trim() || nombreNuevo.trim() === nombreActual) return;
    renombrarCarpetaPlantillaMut.mutate({ carpeta: rel, nombreNuevo: nombreNuevo.trim() });
  }

  const moverPlantillasMut = useMutation({
    mutationFn: ({ ids, destino }: { ids: string[]; destino: string }) =>
      api.post<{ ok: boolean; movidos: string[]; errores: Record<string, string> }>(
        "/api/plantillas-visuales/mover",
        { ids, carpeta_destino: destino },
      ),
    onMutate: () => {
      setMoviendoLote(true);
      setMsg(null);
    },
    onSuccess: (res) => {
      setMenuMoverAbierto(false);
      setSeleccionadas(new Set());
      const fallidos = Object.keys(res.errores || {});
      setMsg(
        fallidos.length > 0
          ? `No se pudieron mover ${fallidos.length} plantilla(s)`
          : "Movida(s) ✓",
      );
      setTimeout(() => setMsg(null), 2500);
      void qc.invalidateQueries({ queryKey: ["plantillas-visuales"] });
      void qc.invalidateQueries({ queryKey: ["plantillas-visuales-carpetas"] });
    },
    onError: (e: Error) => setMsg(e.message || "Error al mover las plantillas seleccionadas"),
    onSettled: () => setMoviendoLote(false),
  });

  function moverSeleccionadas(destino: string) {
    const ids = Array.from(seleccionadas);
    if (ids.length === 0) return;
    moverPlantillasMut.mutate({ ids, destino });
  }

  function iniciarArrastrePlantilla(id: string) {
    const enSeleccion = seleccionadas.has(id) && seleccionadas.size > 1;
    setArrastrandoIds(enSeleccion ? Array.from(seleccionadas) : [id]);
  }

  function finalizarArrastrePlantilla() {
    setArrastrandoIds(null);
    setCarpetaHoverDrop(null);
  }

  function soltarPlantillaEnCarpeta(destino: string) {
    if (arrastrandoIds && arrastrandoIds.length > 0) {
      moverPlantillasMut.mutate({ ids: arrastrandoIds, destino });
    }
    finalizarArrastrePlantilla();
  }

  const guardarMut = useMutation({
    mutationFn: (payload: PlantillaVisualDoc) =>
      api.post<{ plantilla: PlantillaVisualDoc }>("/api/plantillas-visuales", payload),
    onSuccess: (res) => {
      setDoc((prev) => {
        const next =
          prev && res.plantilla
            ? fusionarMetadatosPlantillaTrasGuardar(prev, res.plantilla)
            : res.plantilla;
        docGuardadoRef.current = next;
        return next;
      });
      void qc.invalidateQueries({ queryKey: ["plantillas-visuales"] });
      setMsg("Plantilla guardada ✓");
      setTimeout(() => setMsg(null), 2500);
    },
    onError: (e: Error) => setMsg(e.message || "Error al guardar"),
  });

  // Refs "valor más reciente" para el autoguardado: el intervalo se crea una
  // sola vez por sesión de editor (deps: [vista]) y lee estas refs en cada
  // tick, así no se reinicia con cada tecla mientras se edita el texto.
  const docRef = useRef<PlantillaVisualDoc | null>(null);
  useEffect(() => {
    docRef.current = doc;
  }, [doc]);
  const guardarEnCursoRef = useRef(false);
  useEffect(() => {
    guardarEnCursoRef.current = guardarMut.isPending;
  }, [guardarMut.isPending]);
  const mutateGuardarRef = useRef(guardarMut.mutate);
  useEffect(() => {
    mutateGuardarRef.current = guardarMut.mutate;
  }, [guardarMut.mutate]);

  useEffect(() => {
    if (vista !== "editor") return;
    const AUTOSAVE_MS = 60_000;
    const id = window.setInterval(() => {
      const actual = docRef.current;
      if (actual && docGuardadoRef.current !== actual && !guardarEnCursoRef.current) {
        mutateGuardarRef.current(actual);
      }
    }, AUTOSAVE_MS);
    return () => window.clearInterval(id);
  }, [vista]);

  useEffect(() => {
    if (vista !== "editor") return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!doc || docGuardadoRef.current === doc) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [vista, doc]);

  const eliminarMut = useMutation({
    mutationFn: (id: string) => api.delete(`/api/plantillas-visuales/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["plantillas-visuales"] }),
  });

  const [exportando, setExportando] = useState(false);
  const [duplicandoId, setDuplicandoId] = useState<string | null>(null);

  const abrirCopiaGuardada = useCallback(
    (local: PlantillaVisualDoc, servidor: PlantillaVisualDoc) => {
      const fusionado = fusionarMetadatosPlantillaTrasGuardar(local, servidor);
      setDoc(fusionado);
      docGuardadoRef.current = fusionado;
      setVista("editor");
      setMsg("Plantilla duplicada ✓");
      setTimeout(() => setMsg(null), 2500);
    },
    [],
  );

  const duplicarPlantillaPorId = useCallback(
    async (id: string) => {
      setDuplicandoId(id);
      setMsg(null);
      try {
        const res = await api.get<{ plantilla: PlantillaVisualDoc }>(
          `/api/plantillas-visuales/${id}`,
        );
        const copia = duplicarPlantillaVisual(res.plantilla);
        const saved = await guardarMut.mutateAsync(copia);
        abrirCopiaGuardada(copia, saved.plantilla);
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "No se pudo duplicar la plantilla");
      } finally {
        setDuplicandoId(null);
      }
    },
    [abrirCopiaGuardada, guardarMut],
  );

  const duplicarPlantillaActual = useCallback(() => {
    if (!doc) return;
    const copia = duplicarPlantillaVisual(doc);
    guardarMut.mutate(copia, {
      onSuccess: (res) => abrirCopiaGuardada(copia, res.plantilla),
      onError: (e: Error) => setMsg(e.message || "No se pudo duplicar la plantilla"),
    });
  }, [abrirCopiaGuardada, doc, guardarMut]);

  const abrirNuevo = () => {
    setDoc(null);
    setVista("formato");
  };

  const elegirFormato = (formato: FormatoCanvas, categoriaId: string) => {
    const nuevo = plantillaVacia(formato, categoriaId, carpetaActual);
    setDoc(nuevo);
    docGuardadoRef.current = nuevo;
    setVista("editor");
  };

  const abrirPlantilla = useCallback(async (id: string) => {
    try {
      const res = await api.get<{ plantilla: PlantillaVisualDoc }>(
        `/api/plantillas-visuales/${id}`,
      );
      setDoc(res.plantilla);
      docGuardadoRef.current = res.plantilla;
      setVista("editor");
    } catch {
      setMsg("No se pudo abrir la plantilla");
    }
  }, []);

  const exportar = async (escala = 1) => {
    if (!doc) return;
    setExportando(true);
    setMsg(null);
    try {
      const blob = await exportarPlantillaBlob(doc, "png", { escala });
      const safe = (doc.nombre || "plantilla").replace(/[^\w\-]+/g, "_").slice(0, 60);
      const suf = escala !== 1 ? `@${escala}x` : "";
      const nombreArchivo = `${safe}${suf}.png`;
      descargarBlob(blob, nombreArchivo);
      await subirImagenBlobAEtiquetas(blob, nombreArchivo);
      void qc.invalidateQueries({ queryKey: ["etiquetas-recursos-png"] });
      void qc.invalidateQueries({ queryKey: ["plantillas-visuales-assets"] });

      const dim = `${Math.round(doc.formato.ancho_px * escala)}×${Math.round(doc.formato.alto_px * escala)}`;
      setMsg(`Exportado PNG (${dim} px) · guardado en biblioteca de etiquetas ✓`);
      setTimeout(() => setMsg(null), 2500);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error al exportar");
    } finally {
      setExportando(false);
    }
  };

  if (vista === "formato") {
    return (
      <div className="mx-auto max-w-4xl">
        <SelectorFormatoCanvas
          onElegir={elegirFormato}
          onCancelar={() => setVista("lista")}
        />
      </div>
    );
  }

  if (vista === "editor" && doc) {
    return (
      <div className="fixed inset-x-0 bottom-0 top-[52px] z-20 flex flex-col lg:static lg:-mx-10 lg:-my-8 lg:h-[calc(100vh-3.25rem)] lg:max-h-[calc(100vh-3.25rem)]">
        {msg && (
          <div className="absolute left-1/2 top-3 z-50 -translate-x-1/2 rounded-lg border border-accent/40 bg-surface-panel px-4 py-2 text-sm text-ink shadow-lg">
            {msg}
          </div>
        )}
        <VisualCanvasEditor
          doc={doc}
          onChange={setDoc}
          onGuardar={() => guardarMut.mutate(doc)}
          onDuplicar={duplicarPlantillaActual}
          onVolver={() => {
            if (
              docGuardadoRef.current !== doc &&
              !window.confirm("Hay cambios sin guardar. ¿Salir de todas formas? Se perderán.")
            ) {
              return;
            }
            setVista("lista");
            setDoc(null);
            docGuardadoRef.current = null;
          }}
          onExportar={exportar}
          dirty={docGuardadoRef.current !== doc}
          guardando={guardarMut.isPending}
          duplicando={guardarMut.isPending}
          exportando={exportando}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-bold tracking-tight text-ink">Studio</h1>
        <div className="min-w-0 flex-1">
          <input
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
            placeholder="Buscar plantillas…"
            className="w-full max-w-sm rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          />
        </div>
        {seleccionadas.size > 0 && (
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setMenuMoverAbierto((v) => !v)}
              disabled={moviendoLote}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-ink-secondary hover:bg-surface-hover disabled:opacity-50"
            >
              {moviendoLote ? "Moviendo…" : `Mover a… (${seleccionadas.size})`}
            </button>
            {menuMoverAbierto && (
              <div className="absolute right-0 top-full z-30 mt-1 max-h-52 min-w-[180px] overflow-y-auto rounded-lg border border-border bg-surface-panel py-1 text-xs shadow-xl">
                <button
                  type="button"
                  onClick={() => moverSeleccionadas("")}
                  disabled={carpetaActual === ""}
                  className="block w-full px-3 py-1.5 text-left font-semibold text-ink hover:bg-surface-hover disabled:opacity-40"
                >
                  📁 Raíz
                </button>
                {(carpetasTodasData?.carpetas ?? [])
                  .filter((c) => c !== carpetaActual)
                  .map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => moverSeleccionadas(c)}
                      className="block w-full truncate px-3 py-1.5 text-left text-ink hover:bg-surface-hover"
                      title={c}
                    >
                      📁 {c}
                    </button>
                  ))}
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={abrirNuevo}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          Nueva plantilla
        </button>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-1 text-xs">
        <button
          type="button"
          onClick={() => irACarpeta("")}
          disabled={carpetaActual === ""}
          onDragOver={(e) => {
            if (!arrastrandoIds || carpetaActual === "") return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }}
          onDragEnter={(e) => {
            if (!arrastrandoIds || carpetaActual === "") return;
            e.preventDefault();
            setCarpetaHoverDrop("");
          }}
          onDragLeave={() => setCarpetaHoverDrop((v) => (v === "" ? null : v))}
          onDrop={(e) => {
            if (carpetaActual === "") return;
            e.preventDefault();
            soltarPlantillaEnCarpeta("");
          }}
          className={`rounded px-1.5 py-0.5 font-semibold text-ink-secondary hover:bg-surface-hover disabled:cursor-default disabled:font-bold disabled:text-ink disabled:hover:bg-transparent ${
            carpetaHoverDrop === "" ? "bg-accent/15 text-accent" : ""
          }`}
        >
          📁 Raíz
        </button>
        {segmentosRuta.map((seg, i) => {
          const rel = segmentosRuta.slice(0, i + 1).join("/");
          const esUltimo = i === segmentosRuta.length - 1;
          return (
            <span key={rel} className="flex items-center gap-1">
              <span className="text-muted">/</span>
              <button
                type="button"
                onClick={() => irACarpeta(rel)}
                disabled={esUltimo}
                onDragOver={(e) => {
                  if (!arrastrandoIds || esUltimo) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDragEnter={(e) => {
                  if (!arrastrandoIds || esUltimo) return;
                  e.preventDefault();
                  setCarpetaHoverDrop(rel);
                }}
                onDragLeave={() => setCarpetaHoverDrop((v) => (v === rel ? null : v))}
                onDrop={(e) => {
                  if (esUltimo) return;
                  e.preventDefault();
                  soltarPlantillaEnCarpeta(rel);
                }}
                className={`rounded px-1.5 py-0.5 font-semibold text-ink-secondary hover:bg-surface-hover disabled:cursor-default disabled:font-bold disabled:text-ink disabled:hover:bg-transparent ${
                  carpetaHoverDrop === rel ? "bg-accent/15 text-accent" : ""
                }`}
              >
                {seg}
              </button>
            </span>
          );
        })}
        <button
          type="button"
          onClick={crearCarpetaPlantilla}
          disabled={creandoCarpeta}
          className="ml-2 shrink-0 rounded-lg border border-border px-2 py-1 font-semibold text-ink-secondary hover:bg-surface-hover disabled:opacity-50"
        >
          {creandoCarpeta ? "…" : "+ Carpeta"}
        </button>
      </div>

      <div className="mb-5">
        <BibliotecaEtiquetasSection />
      </div>

      {msg && (
        <div className="mb-4 rounded-lg border border-accent/30 bg-accent/10 px-4 py-2 text-sm">
          {msg}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-20">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      ) : plantillas.length === 0 && subcarpetas.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface-panel px-8 py-20 text-center">
          <p className="text-sm font-medium text-ink">Sin plantillas todavía</p>
          <p className="mt-1 max-w-sm text-sm text-muted">
            Elige un formato de lienzo y diseña tu primera etiqueta o recurso visual.
          </p>
          <button
            type="button"
            onClick={abrirNuevo}
            className="mt-5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white"
          >
            Crear plantilla
          </button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {subcarpetas.map((nombreCarpeta) => {
            const rel = carpetaActual ? `${carpetaActual}/${nombreCarpeta}` : nombreCarpeta;
            const enHoverDrop = carpetaHoverDrop === rel;
            return (
              <div
                key={rel}
                role="button"
                tabIndex={0}
                onDoubleClick={() => irACarpeta(rel)}
                onClick={() => irACarpeta(rel)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") irACarpeta(rel);
                }}
                title={rel}
                onDragOver={(e) => {
                  if (!arrastrandoIds) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDragEnter={(e) => {
                  if (!arrastrandoIds) return;
                  e.preventDefault();
                  setCarpetaHoverDrop(rel);
                }}
                onDragLeave={() => setCarpetaHoverDrop((v) => (v === rel ? null : v))}
                onDrop={(e) => {
                  e.preventDefault();
                  soltarPlantillaEnCarpeta(rel);
                }}
                className={`group/carpeta relative flex min-h-[164px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-4 text-center transition ${
                  enHoverDrop
                    ? "border-accent bg-accent/10"
                    : "border-border bg-surface-panel hover:border-accent hover:bg-surface-hover"
                }`}
              >
                <button
                  type="button"
                  title="Renombrar carpeta"
                  onClick={(e) => {
                    e.stopPropagation();
                    renombrarCarpetaPlantilla(rel, nombreCarpeta);
                  }}
                  className="absolute right-2 top-2 rounded-md border border-border bg-white/95 px-1.5 py-0.5 text-xs opacity-0 shadow-sm transition hover:bg-surface-hover group-hover/carpeta:opacity-100 dark:bg-zinc-900/95"
                >
                  ✎
                </button>
                <span className="text-3xl">📁</span>
                <span className="w-full truncate text-xs font-medium text-ink">{nombreCarpeta}</span>
              </div>
            );
          })}
          {plantillas.map((p) => {
            const seleccionada = seleccionadas.has(p.id);
            return (
              <article
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  iniciarArrastrePlantilla(p.id);
                }}
                onDragEnd={finalizarArrastrePlantilla}
                title="Arrastra a una carpeta para mover"
                key={p.id}
                className={`group relative cursor-grab overflow-hidden rounded-xl border bg-surface-panel transition hover:border-accent/40 hover:shadow-md active:cursor-grabbing ${
                  seleccionada ? "border-accent ring-2 ring-accent/40" : "border-border"
                }`}
              >
                <label className="absolute left-2 top-2 z-10 flex h-5 w-5 cursor-pointer items-center justify-center rounded border border-border bg-white/95 opacity-0 shadow-sm transition group-hover:opacity-100 dark:bg-zinc-900/95" style={seleccionada ? { opacity: 1 } : undefined}>
                  <input
                    type="checkbox"
                    checked={seleccionada}
                    onChange={(e) => {
                      e.stopPropagation();
                      alternarSeleccionPlantilla(p.id);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="h-3.5 w-3.5"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void abrirPlantilla(p.id)}
                  className="flex w-full items-center justify-center bg-[#525659] p-4"
                >
                  <div className="flex min-h-[120px] items-center justify-center">
                    <PlantillaVisualMiniatura doc={p} maxAncho={140} maxAlto={100} />
                  </div>
                </button>
                <div className="px-3 py-2.5">
                  <h3 className="truncate text-sm font-semibold text-ink">{p.nombre}</h3>
                  <p className="mt-0.5 text-[11px] text-muted">{labelFormato(p.formato)}</p>
                </div>
                <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
                  <button
                    type="button"
                    title="Duplicar"
                    disabled={duplicandoId === p.id || guardarMut.isPending}
                    onClick={(e) => {
                      e.stopPropagation();
                      void duplicarPlantillaPorId(p.id);
                    }}
                    className="rounded-md bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-accent disabled:opacity-50"
                  >
                    {duplicandoId === p.id ? "…" : "Duplicar"}
                  </button>
                  <button
                    type="button"
                    title="Eliminar"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`¿Eliminar "${p.nombre}"?`)) eliminarMut.mutate(p.id);
                    }}
                    className="rounded-md bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-red-600"
                  >
                    Eliminar
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
