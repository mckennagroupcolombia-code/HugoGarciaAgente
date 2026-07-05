import { useCallback, useEffect, useState } from "react";
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
  descargarBase64,
  descargarBlob,
  exportarPlantillaBlob,
  guardarPlantillaEnGaleria,
  subirImagenBlobAEtiquetas,
  subirPdfBase64AEtiquetas,
} from "../../lib/plantillasVisualesExport";
import { type EtiquetaStudioDatos } from "../../lib/etiquetasNormativa";
import { resolverUrlImagenCanvas } from "../../lib/plantillasVisualesImagen";
import { useAppStore } from "../../stores/app";
import { EtiquetaMckennaPreview } from "../etiquetas/EtiquetaMckennaPreview";
import PlantillaVisualMiniatura from "./PlantillaVisualMiniatura";
import SelectorFormatoCanvas from "./SelectorFormatoCanvas";
import VisualCanvasEditor from "./VisualCanvasEditor";

interface RecursoPngBiblioteca {
  id: string;
  nombre: string;
  subido_at?: string;
  bytes?: number;
  thumb_b64?: string | null;
  thumb_mime?: string | null;
}

function MiniaturaRecursoPng({ nombre, thumbB64, thumbMime }: {
  nombre: string;
  thumbB64?: string | null;
  thumbMime?: string | null;
}) {
  const [src, setSrc] = useState<string | null>(
    thumbB64 ? `data:${thumbMime || "image/png"};base64,${thumbB64}` : null,
  );
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    if (thumbB64) {
      setSrc(`data:${thumbMime || "image/png"};base64,${thumbB64}`);
      setFallo(false);
      return;
    }
    // Sin miniatura embebida (falló al subir): recurre al archivo real.
    let cancelado = false;
    setFallo(false);
    resolverUrlImagenCanvas(`/api/etiquetas/recursos-png/archivo/${encodeURIComponent(nombre)}`)
      .then((url) => {
        if (!cancelado) setSrc(url);
      })
      .catch(() => {
        if (!cancelado) setFallo(true);
      });
    return () => {
      cancelado = true;
    };
  }, [nombre, thumbB64, thumbMime]);

  if (fallo || !src) {
    return (
      <div className="flex h-10 w-10 items-center justify-center rounded bg-surface-hover text-[9px] text-muted" title="Sin previsualización">
        ?
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={nombre}
      className="max-h-full max-w-full object-contain"
      draggable={false}
      onError={() => setFallo(true)}
    />
  );
}

function formatoBytes(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function BibliotecaEtiquetasSection() {
  const qc = useQueryClient();
  const [buscar, setBuscar] = useState("");
  const [descargandoId, setDescargandoId] = useState<string | null>(null);
  const [eliminandoId, setEliminandoId] = useState<string | null>(null);
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [eliminandoLote, setEliminandoLote] = useState(false);
  const [errorLote, setErrorLote] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["etiquetas-recursos-png"],
    queryFn: () => api.get<{ recursos: RecursoPngBiblioteca[] }>("/api/etiquetas/recursos-png"),
    staleTime: 15_000,
  });

  const recursos = data?.recursos ?? [];
  const q = buscar.trim().toLowerCase();
  const filtrados = q ? recursos.filter((r) => r.nombre.toLowerCase().includes(q)) : recursos;

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
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="text-sm font-bold text-ink">Biblioteca de etiquetas</span>
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
      ) : filtrados.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted">
          {q ? "No hay imágenes con ese nombre." : "Aún no hay imágenes guardadas en la biblioteca."}
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
          {filtrados.map((r) => {
            const activo = seleccionados.has(r.nombre);
            return (
            <div
              key={r.id}
              className={`group relative flex flex-col overflow-hidden rounded-lg border bg-surface ${
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
              <div className="flex aspect-square items-center justify-center bg-zinc-100 p-1 dark:bg-zinc-800/40">
                <MiniaturaRecursoPng nombre={r.nombre} thumbB64={r.thumb_b64} thumbMime={r.thumb_mime} />
              </div>
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
    </div>
  );
}

interface ComboSku {
  code: string;
  name: string;
}

function CompararEtiquetasSection() {
  const [buscarSku, setBuscarSku] = useState("");
  const [skuActivo, setSkuActivo] = useState("");
  const [nombreActivo, setNombreActivo] = useState("");

  const { data: combosData } = useQuery({
    queryKey: ["studio-comparar-combos", buscarSku],
    queryFn: () =>
      api.get<{ combos: ComboSku[] }>(
        `/api/etiquetas/combos-siigo?q=${encodeURIComponent(buscarSku)}`,
      ),
    enabled: buscarSku.trim().length > 1,
    staleTime: 30_000,
  });

  const { data: dataOriginal, isLoading: loadOrig } = useQuery({
    queryKey: ["studio-comparar", skuActivo, "original"],
    queryFn: () =>
      api.get<{ datos: EtiquetaStudioDatos | null }>(
        `/api/etiquetas/studio/${encodeURIComponent(skuActivo)}?version=original`,
      ),
    enabled: !!skuActivo.trim(),
  });

  const { data: dataAlternativa, isLoading: loadAlt } = useQuery({
    queryKey: ["studio-comparar", skuActivo, "alternativa"],
    queryFn: () =>
      api.get<{ datos: EtiquetaStudioDatos | null }>(
        `/api/etiquetas/studio/${encodeURIComponent(skuActivo)}?version=alternativa`,
      ),
    enabled: !!skuActivo.trim(),
  });

  const combos = (combosData?.combos ?? []).slice(0, 8);

  function buildPreviewDatos(
    base: EtiquetaStudioDatos,
    version: "original" | "alternativa",
  ): EtiquetaStudioDatos {
    return {
      ...base,
      modo_etiqueta: version,
      descripcion_etiqueta: base.descripcion_etiqueta ?? "",
      diagramacion: base.diagramacion ?? {},
      diagramacion_graficos: base.diagramacion_graficos ?? {},
    };
  }

  const previewOriginal = dataOriginal?.datos
    ? buildPreviewDatos(dataOriginal.datos, "original")
    : null;

  const previewAlternativa = dataAlternativa?.datos
    ? buildPreviewDatos(dataAlternativa.datos, "alternativa")
    : null;

  const isLoading = loadOrig || loadAlt;

  return (
    <div className="rounded-xl border border-border bg-surface-panel p-4">
      <div className="mb-4 flex items-center gap-3">
        <span className="text-sm font-bold text-ink">Comparar etiqueta</span>
        <div className="relative min-w-0 flex-1">
          <input
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
            placeholder="Buscar SKU o producto…"
            value={buscarSku}
            onChange={(e) => setBuscarSku(e.target.value)}
          />
          {buscarSku.trim().length > 1 && combos.length > 0 && (
            <ul className="absolute left-0 right-0 top-full z-30 mt-1 max-h-48 overflow-y-auto rounded-lg border border-border bg-surface-panel shadow-lg">
              {combos.map((c) => (
                <li key={c.code}>
                  <button
                    type="button"
                    onClick={() => {
                      setSkuActivo(c.code);
                      setNombreActivo(c.name);
                      setBuscarSku(c.code);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-surface-hover"
                  >
                    <span className="font-mono text-accent">{c.code}</span>
                    <span className="truncate text-ink">{c.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {skuActivo && (
          <button
            type="button"
            onClick={() => {
              setSkuActivo("");
              setNombreActivo("");
              setBuscarSku("");
            }}
            className="shrink-0 text-xs text-muted hover:text-ink"
          >
            ✕ Limpiar
          </button>
        )}
      </div>

      {!skuActivo && (
        <p className="py-4 text-center text-sm text-muted">
          Busca un SKU para comparar la etiqueta original con la alternativa.
        </p>
      )}

      {skuActivo && (
        <>
          {nombreActivo && (
            <p className="mb-3 text-xs text-muted">
              <span className="font-mono font-semibold text-accent">{skuActivo}</span>{" "}
              {nombreActivo}
            </p>
          )}
          {isLoading ? (
            <div className="flex justify-center py-8">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            </div>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-2">
                <p className="text-center text-xs font-semibold uppercase tracking-wide text-muted">
                  Original
                </p>
                <div className="flex min-h-[200px] items-center justify-center rounded-lg bg-[#e8eaed] p-3">
                  {previewOriginal ? (
                    <EtiquetaMckennaPreview
                      datos={previewOriginal}
                      className="h-full w-full"
                      raw
                      marcoFormato
                    />
                  ) : (
                    <p className="text-xs text-muted">Sin etiqueta original guardada</p>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-center text-xs font-semibold uppercase tracking-wide text-muted">
                  Alternativa
                </p>
                <div className="flex min-h-[200px] items-center justify-center rounded-lg bg-[#e8eaed] p-3">
                  {previewAlternativa ? (
                    <EtiquetaMckennaPreview
                      datos={previewAlternativa}
                      className="h-full w-full"
                      raw
                      marcoFormato
                    />
                  ) : (
                    <p className="text-xs text-muted">Sin alternativa guardada para este SKU</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
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
  const setPanel = useAppStore((s) => s.setPanel);
  const setEtiquetasTab = useAppStore((s) => s.setEtiquetasTab);
  const setEtiquetasHandoff = useAppStore((s) => s.setEtiquetasHandoff);
  const [vista, setVista] = useState<Vista>("lista");
  const [doc, setDoc] = useState<PlantillaVisualDoc | null>(null);
  const [buscar, setBuscar] = useState("");
  const [mostrarComparar, setMostrarComparar] = useState(false);
  const [mostrarBiblioteca, setMostrarBiblioteca] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pdfListoParaImprimir, setPdfListoParaImprimir] = useState<{
    ruta_completa: string;
    nombre: string;
  } | null>(null);

  useEffect(() => {
    onInmersivoChange?.(vista === "editor");
    return () => onInmersivoChange?.(false);
  }, [vista, onInmersivoChange]);

  const irAImprimirEnEtiquetas = useCallback(() => {
    if (!pdfListoParaImprimir || !doc) return;
    setEtiquetasHandoff({
      pdf_ruta: pdfListoParaImprimir.ruta_completa,
      pdf_nombre: pdfListoParaImprimir.nombre,
      tipo_etiqueta: doc.formato.tipo_etiqueta,
      ancho_mm: doc.formato.ancho_mm,
      alto_mm: doc.formato.alto_mm,
    });
    setEtiquetasTab("imprimir");
    setPanel("etiquetas");
  }, [pdfListoParaImprimir, doc, setEtiquetasHandoff, setEtiquetasTab, setPanel]);

  const { data, isLoading } = useQuery({
    queryKey: ["plantillas-visuales", buscar],
    queryFn: () =>
      api.get<{ plantillas: PlantillaVisualDoc[] }>(
        `/api/plantillas-visuales${buscar ? `?q=${encodeURIComponent(buscar)}` : ""}`,
      ),
    staleTime: 15_000,
  });

  const plantillas = data?.plantillas ?? [];

  const guardarMut = useMutation({
    mutationFn: (payload: PlantillaVisualDoc) =>
      api.post<{ plantilla: PlantillaVisualDoc }>("/api/plantillas-visuales", payload),
    onSuccess: (res) => {
      setDoc((prev) =>
        prev && res.plantilla
          ? fusionarMetadatosPlantillaTrasGuardar(prev, res.plantilla)
          : res.plantilla,
      );
      void qc.invalidateQueries({ queryKey: ["plantillas-visuales"] });
      setMsg("Plantilla guardada ✓");
      setTimeout(() => setMsg(null), 2500);
    },
    onError: (e: Error) => setMsg(e.message || "Error al guardar"),
  });

  const eliminarMut = useMutation({
    mutationFn: (id: string) => api.delete(`/api/plantillas-visuales/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["plantillas-visuales"] }),
  });

  const [exportando, setExportando] = useState(false);
  const [guardandoGaleria, setGuardandoGaleria] = useState<"jpeg" | "pdf" | null>(null);
  const [duplicandoId, setDuplicandoId] = useState<string | null>(null);

  const abrirCopiaGuardada = useCallback(
    (local: PlantillaVisualDoc, servidor: PlantillaVisualDoc) => {
      setDoc(fusionarMetadatosPlantillaTrasGuardar(local, servidor));
      setVista("editor");
      setPdfListoParaImprimir(null);
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
    setPdfListoParaImprimir(null);
    setVista("formato");
  };

  const elegirFormato = (formato: FormatoCanvas, categoriaId: string) => {
    setDoc(plantillaVacia(formato, categoriaId));
    setPdfListoParaImprimir(null);
    setVista("editor");
  };

  const abrirPlantilla = useCallback(async (id: string) => {
    try {
      const res = await api.get<{ plantilla: PlantillaVisualDoc }>(
        `/api/plantillas-visuales/${id}`,
      );
      setDoc(res.plantilla);
      setPdfListoParaImprimir(null);
      setVista("editor");
    } catch {
      setMsg("No se pudo abrir la plantilla");
    }
  }, []);

  const guardarEnGaleria = async (formato: "jpeg" | "pdf", escala = 1) => {
    if (!doc) return;
    setGuardandoGaleria(formato);
    setMsg(null);
    try {
      const { nombre } = await guardarPlantillaEnGaleria(doc, formato, { escala });
      if (formato === "jpeg") {
        void qc.invalidateQueries({ queryKey: ["etiquetas-recursos-png"] });
        void qc.invalidateQueries({ queryKey: ["plantillas-visuales-assets"] });
        setMsg(`JPG guardado en galería (${nombre}) ✓`);
      } else {
        void qc.invalidateQueries({ queryKey: ["etiquetas-pdfs"] });
        setMsg(`PDF guardado en biblioteca Etiquetas (${nombre}) ✓`);
      }
      setTimeout(() => setMsg(null), 3500);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error al guardar en galería");
    } finally {
      setGuardandoGaleria(null);
    }
  };

  const exportar = async (formato: "png" | "jpeg" | "pdf", escala = 1) => {
    if (!doc) return;
    setExportando(true);
    setMsg(null);
    setPdfListoParaImprimir(null);
    try {
      let mensajeExtra = "";
      if (formato === "pdf") {
        const res = await api.post<{
          ok: boolean;
          nombre: string;
          base64: string;
          formato: string;
        }>("/api/plantillas-visuales/exportar", { plantilla: doc, formato: "pdf", escala });
        descargarBase64(res.base64, res.nombre, "application/pdf");
        const subido = await subirPdfBase64AEtiquetas(res.base64, res.nombre);
        void qc.invalidateQueries({ queryKey: ["etiquetas-pdfs"] });
        setPdfListoParaImprimir({ ruta_completa: subido.ruta_completa, nombre: subido.nombre });
        mensajeExtra = " · enviado a Etiquetas para imprimir";
      } else {
        const blob = await exportarPlantillaBlob(doc, formato, { escala });
        const ext = formato === "jpeg" ? "jpg" : "png";
        const safe = (doc.nombre || "plantilla").replace(/[^\w\-]+/g, "_").slice(0, 60);
        const suf = escala !== 1 ? `@${escala}x` : "";
        const nombreArchivo = `${safe}${suf}.${ext}`;
        descargarBlob(blob, nombreArchivo);
        if (formato === "png") {
          await subirImagenBlobAEtiquetas(blob, nombreArchivo);
          void qc.invalidateQueries({ queryKey: ["etiquetas-recursos-png"] });
          void qc.invalidateQueries({ queryKey: ["plantillas-visuales-assets"] });
          mensajeExtra = " · guardado en biblioteca de etiquetas";
        }
      }
      const dim = `${Math.round(doc.formato.ancho_px * escala)}×${Math.round(doc.formato.alto_px * escala)}`;
      setMsg(`Exportado ${formato.toUpperCase()} (${dim} px)${mensajeExtra} ✓`);
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
        {pdfListoParaImprimir && (
          <div className="absolute left-1/2 top-12 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-accent/40 bg-surface-panel px-3 py-1.5 text-xs shadow-lg">
            <span className="text-muted">📄 {pdfListoParaImprimir.nombre}</span>
            <button
              type="button"
              onClick={irAImprimirEnEtiquetas}
              className="rounded-md bg-accent px-2.5 py-1 font-bold text-white hover:bg-accent/90"
            >
              🖨️ Ir a imprimir en Etiquetas →
            </button>
          </div>
        )}
        <VisualCanvasEditor
          doc={doc}
          onChange={setDoc}
          onGuardar={() => guardarMut.mutate(doc)}
          onDuplicar={duplicarPlantillaActual}
          onVolver={() => {
            setVista("lista");
            setDoc(null);
          }}
          onExportar={exportar}
          onGuardarEnGaleria={guardarEnGaleria}
          guardando={guardarMut.isPending}
          duplicando={guardarMut.isPending}
          guardandoGaleria={guardandoGaleria}
          exportando={exportando}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-bold tracking-tight text-ink">Studio</h1>
        <div className="min-w-0 flex-1">
          <input
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
            placeholder="Buscar plantillas…"
            className="w-full max-w-sm rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={() => setMostrarComparar((v) => !v)}
          className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
            mostrarComparar
              ? "bg-surface-hover text-ink ring-1 ring-border"
              : "text-muted hover:bg-surface-hover hover:text-ink"
          }`}
        >
          Comparar
        </button>
        <button
          type="button"
          onClick={() => setMostrarBiblioteca((v) => !v)}
          className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
            mostrarBiblioteca
              ? "bg-surface-hover text-ink ring-1 ring-border"
              : "text-muted hover:bg-surface-hover hover:text-ink"
          }`}
        >
          Biblioteca
        </button>
        <button
          type="button"
          onClick={abrirNuevo}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          Nueva plantilla
        </button>
      </div>

      {mostrarComparar && (
        <div className="mb-5">
          <CompararEtiquetasSection />
        </div>
      )}

      {mostrarBiblioteca && (
        <div className="mb-5">
          <BibliotecaEtiquetasSection />
        </div>
      )}

      {msg && (
        <div className="mb-4 rounded-lg border border-accent/30 bg-accent/10 px-4 py-2 text-sm">
          {msg}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-20">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      ) : plantillas.length === 0 ? (
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
          {plantillas.map((p) => {
            return (
              <article
                key={p.id}
                className="group relative overflow-hidden rounded-xl border border-border bg-surface-panel transition hover:border-accent/40 hover:shadow-md"
              >
                <button
                  type="button"
                  onClick={() => void abrirPlantilla(p.id)}
                  className="flex w-full flex-col text-left"
                >
                  <div className="flex min-h-[120px] items-center justify-center bg-[#525659] p-4">
                    <PlantillaVisualMiniatura doc={p} maxAncho={140} maxAlto={100} />
                  </div>
                  <div className="px-3 py-2.5">
                    <h3 className="truncate text-sm font-semibold text-ink">{p.nombre}</h3>
                    <p className="mt-0.5 text-[11px] text-muted">{labelFormato(p.formato)}</p>
                  </div>
                </button>
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
