import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { resolverUrlImagenCanvas, liberarCacheImagenCanvas } from "../../lib/plantillasVisualesImagen";

interface RecursoPng {
  id: string | null;
  nombre: string;
  ruta?: string;
  ruta_completa?: string;
  subido_at?: string;
  thumb_b64?: string | null;
  thumb_mime?: string | null;
}

interface RecursoEditor {
  nombre: string;
  url: string;
  subido_at?: string;
}

export interface ImagenGaleriaItem {
  id: string;
  nombre: string;
  src: string;
  thumbB64?: string | null;
  origen: "recursos" | "editor";
}

function esImagenPngJpg(file: File): boolean {
  const lower = file.name.toLowerCase();
  if (/\.(png|jpe?g)$/.test(lower)) return true;
  return file.type === "image/png" || file.type === "image/jpeg";
}

function MiniaturaGaleria({
  item,
  seleccionada,
  modoSeleccion,
  eliminando,
  onElegir,
  onEliminar,
  onAlternarSeleccion,
  onArrastrarInicio,
  onArrastrarFin,
}: {
  item: ImagenGaleriaItem;
  seleccionada: boolean;
  modoSeleccion: boolean;
  eliminando: boolean;
  onElegir: () => void;
  onEliminar: () => void;
  onAlternarSeleccion: () => void;
  onArrastrarInicio?: () => void;
  onArrastrarFin?: () => void;
}) {
  const [src, setSrc] = useState<string | null>(
    item.thumbB64 ? `data:image/png;base64,${item.thumbB64}` : null,
  );

  useEffect(() => {
    if (item.thumbB64) {
      setSrc(`data:image/png;base64,${item.thumbB64}`);
      return;
    }
    let alive = true;
    void resolverUrlImagenCanvas(item.src)
      .then((resolved) => {
        if (alive) setSrc(resolved);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [item.src, item.thumbB64]);

  const puedeArrastrar = item.origen === "recursos" && !!onArrastrarInicio;

  return (
    <div
      draggable={puedeArrastrar}
      onDragStart={(e) => {
        if (!puedeArrastrar) return;
        e.dataTransfer.effectAllowed = "move";
        onArrastrarInicio?.();
      }}
      onDragEnd={onArrastrarFin}
      title={puedeArrastrar ? "Arrastra a una carpeta para mover" : undefined}
      className={`group relative flex flex-col overflow-hidden rounded-lg border-2 bg-surface text-left transition ${
        seleccionada ? "border-accent ring-2 ring-accent/30" : "border-border"
      } ${puedeArrastrar ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <label
        className="absolute left-1 top-1 z-10 flex h-5 w-5 cursor-pointer items-center justify-center rounded border border-border bg-white/95 opacity-0 shadow-sm transition group-hover:opacity-100 dark:bg-zinc-900/95"
        style={seleccionada || modoSeleccion ? { opacity: 1 } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={seleccionada}
          onChange={onAlternarSeleccion}
          className="h-3.5 w-3.5"
        />
      </label>
      <button
        type="button"
        onClick={onElegir}
        title={item.nombre}
        className="flex flex-1 flex-col text-left hover:border-accent"
      >
        <div className="flex aspect-square items-center justify-center bg-zinc-100 p-1 dark:bg-zinc-800/40">
          {src ? (
            <img
              src={src}
              alt={item.nombre}
              className="max-h-full max-w-full object-contain"
              draggable={false}
            />
          ) : (
            <div className="h-10 w-10 animate-pulse rounded bg-surface-hover" />
          )}
        </div>
        <span className="truncate px-1.5 py-1 text-[10px] text-muted group-hover:text-ink">
          {item.nombre}
        </span>
      </button>
      <button
        type="button"
        disabled={eliminando}
        title="Eliminar imagen"
        onClick={(e) => {
          e.stopPropagation();
          onEliminar();
        }}
        className="absolute right-1 top-1 rounded-md border border-red-200 bg-white/95 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 opacity-0 shadow-sm transition hover:bg-red-50 group-hover:opacity-100 disabled:opacity-40 dark:border-red-900/50 dark:bg-zinc-900/95 dark:hover:bg-red-950/80"
      >
        {eliminando ? "…" : "✕"}
      </button>
    </div>
  );
}

interface Props {
  abierta: boolean;
  onCerrar: () => void;
  onElegir: (src: string) => void;
}

interface ProgresoCarpeta {
  total: number;
  done: number;
  errores: string[];
  terminado: boolean;
}

export default function GaleriaImagenesModal({ abierta, onCerrar, onElegir }: Props) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const inputCarpetaRef = useRef<HTMLInputElement>(null);
  const [buscar, setBuscar] = useState("");
  const [errorSubida, setErrorSubida] = useState<string | null>(null);
  const [eliminandoId, setEliminandoId] = useState<string | null>(null);
  const [progresoCarpeta, setProgresoCarpeta] = useState<ProgresoCarpeta | null>(null);
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [eliminandoLote, setEliminandoLote] = useState(false);
  const [carpetaActual, setCarpetaActual] = useState("");
  const [creandoCarpeta, setCreandoCarpeta] = useState(false);
  const [moviendoLote, setMoviendoLote] = useState(false);
  const [menuMoverAbierto, setMenuMoverAbierto] = useState(false);
  const [arrastrando, setArrastrando] = useState<ImagenGaleriaItem[] | null>(null);
  const [carpetaHoverDrop, setCarpetaHoverDrop] = useState<string | null>(null);

  useEffect(() => {
    if (!abierta) {
      setCarpetaActual("");
      setSeleccionados(new Set());
    }
  }, [abierta]);

  // webkitdirectory no está en los tipos estándar — el input solo existe cuando abierta=true
  useEffect(() => {
    if (!abierta) return;
    const id = requestAnimationFrame(() => {
      const el = inputCarpetaRef.current;
      if (!el) return;
      el.setAttribute("webkitdirectory", "");
      el.setAttribute("directory", "");
      el.setAttribute("multiple", "");
    });
    return () => cancelAnimationFrame(id);
  }, [abierta]);

  async function subirArchivos(validos: File[], opts?: { elegirUltima?: boolean }) {
    if (validos.length === 0) {
      setErrorSubida("No hay imágenes JPG o PNG para subir.");
      return;
    }
    setErrorSubida(null);
    setProgresoCarpeta({ total: validos.length, done: 0, errores: [], terminado: false });

    const errores: string[] = [];
    let ultimoSubido: (RecursoPng & { ok: boolean }) | null = null;
    for (let i = 0; i < validos.length; i++) {
      const file = validos[i];
      try {
        const fd = new FormData();
        fd.append("archivo", file);
        fd.append("carpeta", carpetaActual);
        ultimoSubido = await api.upload<RecursoPng & { ok: boolean }>(
          "/api/etiquetas/recursos-png",
          fd,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error de subida";
        errores.push(`${file.name}: ${msg}`);
      }
      setProgresoCarpeta({
        total: validos.length,
        done: i + 1,
        errores: [...errores],
        terminado: false,
      });
    }

    await qc.invalidateQueries({ queryKey: ["etiquetas-recursos-png"] });
    setProgresoCarpeta({
      total: validos.length,
      done: validos.length,
      errores,
      terminado: true,
    });

    if (opts?.elegirUltima && ultimoSubido && errores.length === 0) {
      const src = `/api/etiquetas/recursos-png/archivo/${encodeURIComponent(ultimoSubido.nombre)}`;
      onElegir(src);
      onCerrar();
    }
  }

  const { data: recursosData, isLoading: loadingRecursos } = useQuery({
    queryKey: ["etiquetas-recursos-png", carpetaActual],
    queryFn: () =>
      api.get<{ recursos: RecursoPng[]; carpetas: string[]; carpeta_actual: string }>(
        `/api/etiquetas/recursos-png?carpeta=${encodeURIComponent(carpetaActual)}`,
      ),
    enabled: abierta,
    staleTime: 15_000,
  });

  // Las imágenes propias del editor (plantillas-visuales/assets) no tienen
  // carpetas todavía: solo se muestran parado en la raíz.
  const { data: editorData, isLoading: loadingEditor } = useQuery({
    queryKey: ["plantillas-visuales-assets"],
    queryFn: () =>
      api.get<{ recursos: RecursoEditor[] }>("/api/plantillas-visuales/assets"),
    enabled: abierta && carpetaActual === "",
    staleTime: 30_000,
  });

  const { data: carpetasTodasData } = useQuery({
    queryKey: ["etiquetas-recursos-png-carpetas"],
    queryFn: () => api.get<{ carpetas: string[] }>("/api/etiquetas/recursos-png/carpetas"),
    enabled: abierta,
    staleTime: 15_000,
  });

  const subcarpetas = useMemo(() => {
    const nombres = recursosData?.carpetas ?? [];
    const q = buscar.trim().toLowerCase();
    if (!q) return nombres;
    return nombres.filter((n) => n.toLowerCase().includes(q));
  }, [recursosData, buscar]);

  const imagenes = useMemo(() => {
    const map = new Map<string, ImagenGaleriaItem>();
    for (const r of recursosData?.recursos ?? []) {
      const src = `/api/etiquetas/recursos-png/archivo/${encodeURIComponent(r.nombre)}`;
      map.set(`recursos:${r.nombre}`, {
        id: r.id || r.nombre,
        nombre: r.nombre,
        src,
        thumbB64: r.thumb_b64,
        origen: "recursos",
      });
    }
    if (carpetaActual === "") {
      for (const r of editorData?.recursos ?? []) {
        const key = `editor:${r.nombre}`;
        if (map.has(key)) continue;
        map.set(key, {
          id: r.nombre,
          nombre: r.nombre,
          src: r.url,
          origen: "editor",
        });
      }
    }
    const q = buscar.trim().toLowerCase();
    const items = Array.from(map.values());
    if (!q) return items;
    return items.filter((i) => i.nombre.toLowerCase().includes(q));
  }, [recursosData, editorData, carpetaActual, buscar]);

  const segmentosRuta = carpetaActual ? carpetaActual.split("/").filter(Boolean) : [];

  function irACarpeta(rel: string) {
    setCarpetaActual(rel);
    setSeleccionados(new Set());
    setMenuMoverAbierto(false);
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
    onError: (err: Error) => setErrorSubida(err.message),
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
    onError: (err: Error) => setErrorSubida(err.message),
  });

  function renombrarCarpeta(rel: string, nombreActual: string) {
    const nombreNuevo = window.prompt("Nuevo nombre de la carpeta:", nombreActual);
    if (!nombreNuevo || !nombreNuevo.trim() || nombreNuevo.trim() === nombreActual) return;
    renombrarCarpetaMut.mutate({ carpeta: rel, nombreNuevo: nombreNuevo.trim() });
  }

  const moverLoteMut = useMutation({
    mutationFn: async ({ items, destino }: { items: ImagenGaleriaItem[]; destino: string }) => {
      const nombres = items.filter((i) => i.origen === "recursos").map((i) => i.nombre);
      if (nombres.length === 0) return { movidos: [], errores: {} as Record<string, string> };
      return api.post<{ ok: boolean; movidos: string[]; errores: Record<string, string> }>(
        "/api/etiquetas/recursos-png/mover",
        { nombres, carpeta_destino: destino },
      );
    },
    onMutate: () => {
      setMoviendoLote(true);
      setErrorSubida(null);
    },
    onSuccess: (res) => {
      setMenuMoverAbierto(false);
      setSeleccionados(new Set());
      const fallidos = Object.keys(res.errores || {});
      if (fallidos.length > 0) {
        setErrorSubida(`No se pudieron mover ${fallidos.length}: ${fallidos.slice(0, 3).join(", ")}${fallidos.length > 3 ? "…" : ""}`);
      }
      void qc.invalidateQueries({ queryKey: ["etiquetas-recursos-png"] });
      void qc.invalidateQueries({ queryKey: ["etiquetas-recursos-png-carpetas"] });
    },
    onError: (err: Error) => setErrorSubida(err.message),
    onSettled: () => setMoviendoLote(false),
  });

  function moverSeleccionados(destino: string) {
    const items = imagenes.filter((i) => seleccionados.has(claveItem(i)));
    if (items.length === 0) return;
    moverLoteMut.mutate({ items, destino });
  }

  function iniciarArrastre(item: ImagenGaleriaItem) {
    const clave = claveItem(item);
    const enSeleccion = seleccionados.has(clave) && seleccionados.size > 1;
    setArrastrando(enSeleccion ? imagenes.filter((i) => seleccionados.has(claveItem(i))) : [item]);
  }

  function finalizarArrastre() {
    setArrastrando(null);
    setCarpetaHoverDrop(null);
  }

  function soltarEnCarpeta(destino: string) {
    if (arrastrando && arrastrando.length > 0) {
      moverLoteMut.mutate({ items: arrastrando, destino });
    }
    finalizarArrastre();
  }

  function claveItem(item: Pick<ImagenGaleriaItem, "origen" | "nombre">): string {
    return `${item.origen}-${item.nombre}`;
  }

  function alternarSeleccion(item: ImagenGaleriaItem) {
    const clave = claveItem(item);
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(clave)) next.delete(clave);
      else next.add(clave);
      return next;
    });
  }

  const todosSeleccionados =
    imagenes.length > 0 && imagenes.every((i) => seleccionados.has(claveItem(i)));

  function alternarSeleccionarTodo() {
    setSeleccionados((prev) => {
      if (todosSeleccionados) {
        const next = new Set(prev);
        imagenes.forEach((i) => next.delete(claveItem(i)));
        return next;
      }
      const next = new Set(prev);
      imagenes.forEach((i) => next.add(claveItem(i)));
      return next;
    });
  }

  const eliminarMut = useMutation({
    mutationFn: async (item: ImagenGaleriaItem) => {
      const nombre = encodeURIComponent(item.nombre);
      if (item.origen === "recursos") {
        return api.delete<{ ok: boolean }>(`/api/etiquetas/recursos-png/${nombre}`);
      }
      return api.delete<{ ok: boolean }>(`/api/plantillas-visuales/assets/${nombre}`);
    },
    onMutate: (item) => {
      setEliminandoId(`${item.origen}-${item.nombre}`);
      setErrorSubida(null);
    },
    onSuccess: (_data, item) => {
      liberarCacheImagenCanvas(item.src);
      void qc.invalidateQueries({ queryKey: ["etiquetas-recursos-png"] });
      void qc.invalidateQueries({ queryKey: ["plantillas-visuales-assets"] });
    },
    onError: (err: Error) => setErrorSubida(err.message),
    onSettled: () => setEliminandoId(null),
  });

  const eliminarLoteMut = useMutation({
    mutationFn: async (items: ImagenGaleriaItem[]) => {
      const deRecursos = items.filter((i) => i.origen === "recursos");
      const deEditor = items.filter((i) => i.origen === "editor");
      const errores: string[] = [];

      if (deRecursos.length > 0) {
        const res = await api.post<{ ok: boolean; eliminados: string[]; errores: Record<string, string> }>(
          "/api/etiquetas/recursos-png/eliminar-lote",
          { nombres: deRecursos.map((i) => i.nombre) },
        );
        Object.entries(res.errores || {}).forEach(([nombre, msg]) => errores.push(`${nombre}: ${msg}`));
        deRecursos.forEach((i) => liberarCacheImagenCanvas(i.src));
      }

      if (deEditor.length > 0) {
        const resultados = await Promise.allSettled(
          deEditor.map((i) =>
            api.delete<{ ok: boolean }>(`/api/plantillas-visuales/assets/${encodeURIComponent(i.nombre)}`),
          ),
        );
        resultados.forEach((r, idx) => {
          if (r.status === "rejected") {
            errores.push(`${deEditor[idx].nombre}: ${r.reason instanceof Error ? r.reason.message : "error"}`);
          } else {
            liberarCacheImagenCanvas(deEditor[idx].src);
          }
        });
      }

      return { errores };
    },
    onMutate: () => {
      setEliminandoLote(true);
      setErrorSubida(null);
    },
    onSuccess: (res) => {
      setSeleccionados(new Set());
      if (res.errores.length > 0) {
        setErrorSubida(`No se pudieron eliminar ${res.errores.length}: ${res.errores.slice(0, 3).join(", ")}${res.errores.length > 3 ? "…" : ""}`);
      }
      void qc.invalidateQueries({ queryKey: ["etiquetas-recursos-png"] });
      void qc.invalidateQueries({ queryKey: ["plantillas-visuales-assets"] });
    },
    onError: (err: Error) => setErrorSubida(err.message),
    onSettled: () => setEliminandoLote(false),
  });

  function eliminarSeleccionados() {
    const items = imagenes.filter((i) => seleccionados.has(claveItem(i)));
    if (items.length === 0) return;
    if (!window.confirm(`¿Eliminar ${items.length} imagen(es) seleccionada(s) de la galería?`)) return;
    eliminarLoteMut.mutate(items);
  }

  const subirMut = useMutation({
    mutationFn: async (files: File[]) => {
      const validos = files.filter(esImagenPngJpg);
      if (validos.length === 0) throw new Error("Solo JPG o PNG.");
      if (validos.length === 1) {
        const fd = new FormData();
        fd.append("archivo", validos[0]);
        fd.append("carpeta", carpetaActual);
        return api.upload<RecursoPng & { ok: boolean }>("/api/etiquetas/recursos-png", fd);
      }
      await subirArchivos(validos);
      return null;
    },
    onSuccess: (data) => {
      setErrorSubida(null);
      if (!data) return;
      void qc.invalidateQueries({ queryKey: ["etiquetas-recursos-png"] });
      const src = `/api/etiquetas/recursos-png/archivo/${encodeURIComponent(data.nombre)}`;
      onElegir(src);
      onCerrar();
    },
    onError: (err: Error) => setErrorSubida(err.message),
  });

  async function subirCarpeta(files: FileList) {
    const validos = Array.from(files).filter(esImagenPngJpg);
    if (validos.length === 0) {
      setErrorSubida("La carpeta no contiene imágenes JPG o PNG.");
      return;
    }
    await subirArchivos(validos);
  }

  if (!abierta) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[600] flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm"
      onClick={onCerrar}
    >
      <div
        className="flex max-h-[min(90vh,720px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface-panel shadow-paper-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h3 className="font-bold text-ink">Galería de imágenes</h3>
            <p className="mt-0.5 text-xs text-muted">
              Recursos compartidos de McKenna y subidas del editor. Pasa el cursor y ✕ para eliminar.
            </p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-lg border border-border px-2 py-1 text-sm text-muted hover:bg-surface-hover"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1 border-b border-border px-4 py-2 text-xs">
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

        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
          <input
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
            placeholder="Buscar imagen…"
            className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm"
          />

          {imagenes.length > 0 && (
            <label className="flex shrink-0 items-center gap-1.5 text-xs text-ink-secondary">
              <input
                type="checkbox"
                checked={todosSeleccionados}
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
                className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink-secondary hover:bg-surface-hover disabled:opacity-50"
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
              className="shrink-0 rounded-lg border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
            >
              {eliminandoLote ? "Eliminando…" : `Eliminar seleccionadas (${seleccionados.size})`}
            </button>
          )}

          {/* Subir una o varias imágenes */}
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png,.jpg,.jpeg,.png"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = e.target.files ? Array.from(e.target.files) : [];
              if (files.length > 0) subirMut.mutate(files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={
              subirMut.isPending || (!!progresoCarpeta && !progresoCarpeta.terminado)
            }
            onClick={() => inputRef.current?.click()}
            className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            title="Selecciona una o varias imágenes JPG/PNG (Ctrl+clic o Shift+clic)"
          >
            {subirMut.isPending || (!!progresoCarpeta && !progresoCarpeta.terminado)
              ? "Subiendo…"
              : "+ Imágenes"}
          </button>

          {/* Subir carpeta completa */}
          <input
            ref={inputCarpetaRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const files = e.target.files;
              if (files && files.length > 0) void subirCarpeta(files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={
              subirMut.isPending || (!!progresoCarpeta && !progresoCarpeta.terminado)
            }
            onClick={() => {
              setProgresoCarpeta(null);
              inputCarpetaRef.current?.click();
            }}
            className="shrink-0 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-semibold text-ink-secondary hover:bg-surface-hover disabled:opacity-50"
            title="Selecciona una carpeta para subir todas sus imágenes JPG/PNG"
          >
            📁 Carpeta
          </button>
        </div>

        {/* Progreso carga de carpeta */}
        {progresoCarpeta && (
          <div className="border-b border-border px-4 py-2">
            {!progresoCarpeta.terminado ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-ink">
                    Subiendo {progresoCarpeta.done} / {progresoCarpeta.total}…
                  </span>
                  <span className="text-muted">
                    {Math.round((progresoCarpeta.done / progresoCarpeta.total) * 100)}%
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-hover">
                  <div
                    className="h-full rounded-full bg-accent transition-all duration-300"
                    style={{ width: `${(progresoCarpeta.done / progresoCarpeta.total) * 100}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs">
                  <span className="font-semibold text-green-700 dark:text-green-400">
                    ✓ {progresoCarpeta.total - progresoCarpeta.errores.length} imágenes subidas
                  </span>
                  {progresoCarpeta.errores.length > 0 && (
                    <span className="ml-2 text-red-600 dark:text-red-400">
                      · {progresoCarpeta.errores.length} error{progresoCarpeta.errores.length > 1 ? "es" : ""}
                      {" "}({progresoCarpeta.errores.slice(0, 3).join(", ")}
                      {progresoCarpeta.errores.length > 3 ? "…" : ""})
                    </span>
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => setProgresoCarpeta(null)}
                  className="shrink-0 text-xs text-muted hover:text-ink"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        )}

        {errorSubida && (
          <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
            {errorSubida}
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loadingRecursos || loadingEditor ? (
            <div className="flex justify-center py-16">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            </div>
          ) : imagenes.length === 0 && subcarpetas.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted">
              {buscar.trim()
                ? "No hay imágenes ni carpetas con ese nombre."
                : "Carpeta vacía. Sube una imagen o crea una subcarpeta."}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
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
              {imagenes.map((item) => (
                <MiniaturaGaleria
                  key={claveItem(item)}
                  item={item}
                  seleccionada={seleccionados.has(claveItem(item))}
                  modoSeleccion={seleccionados.size > 0}
                  eliminando={eliminandoId === claveItem(item)}
                  onElegir={() => {
                    if (seleccionados.size > 0) {
                      alternarSeleccion(item);
                      return;
                    }
                    onElegir(item.src);
                    onCerrar();
                  }}
                  onAlternarSeleccion={() => alternarSeleccion(item)}
                  onArrastrarInicio={() => iniciarArrastre(item)}
                  onArrastrarFin={finalizarArrastre}
                  onEliminar={() => {
                    if (
                      !window.confirm(
                        `¿Eliminar "${item.nombre}" de la galería? No se quitará de plantillas ya guardadas.`,
                      )
                    ) {
                      return;
                    }
                    eliminarMut.mutate(item);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
