import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { resolverUrlImagenCanvas, liberarCacheImagenCanvas } from "../../lib/plantillasVisualesImagen";

interface RecursoPng {
  id: string;
  nombre: string;
  ruta?: string;
  ruta_completa?: string;
  subido_at?: string;
  thumb_b64?: string | null;
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
  eliminando,
  onElegir,
  onEliminar,
}: {
  item: ImagenGaleriaItem;
  seleccionada: boolean;
  eliminando: boolean;
  onElegir: () => void;
  onEliminar: () => void;
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

  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-lg border-2 bg-surface text-left transition ${
        seleccionada ? "border-accent ring-2 ring-accent/30" : "border-border"
      }`}
    >
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
    queryKey: ["etiquetas-recursos-png"],
    queryFn: () =>
      api.get<{ recursos: RecursoPng[] }>("/api/etiquetas/recursos-png"),
    enabled: abierta,
    staleTime: 30_000,
  });

  const { data: editorData, isLoading: loadingEditor } = useQuery({
    queryKey: ["plantillas-visuales-assets"],
    queryFn: () =>
      api.get<{ recursos: RecursoEditor[] }>("/api/plantillas-visuales/assets"),
    enabled: abierta,
    staleTime: 30_000,
  });

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
    const q = buscar.trim().toLowerCase();
    const items = Array.from(map.values());
    if (!q) return items;
    return items.filter((i) => i.nombre.toLowerCase().includes(q));
  }, [recursosData, editorData, buscar]);

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

  const subirMut = useMutation({
    mutationFn: async (files: File[]) => {
      const validos = files.filter(esImagenPngJpg);
      if (validos.length === 0) throw new Error("Solo JPG o PNG.");
      if (validos.length === 1) {
        const fd = new FormData();
        fd.append("archivo", validos[0]);
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

        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
          <input
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
            placeholder="Buscar imagen…"
            className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm"
          />

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
          ) : imagenes.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted">
              {buscar.trim()
                ? "No hay imágenes con ese nombre."
                : "Aún no hay imágenes. Sube la primera con el botón de arriba."}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
              {imagenes.map((item) => (
                <MiniaturaGaleria
                  key={`${item.origen}-${item.nombre}`}
                  item={item}
                  seleccionada={false}
                  eliminando={eliminandoId === `${item.origen}-${item.nombre}`}
                  onElegir={() => {
                    onElegir(item.src);
                    onCerrar();
                  }}
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
