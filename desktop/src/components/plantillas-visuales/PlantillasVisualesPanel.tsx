import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import {
  labelFormato,
  miniaturaLienzoPx,
  plantillaVacia,
  type FormatoCanvas,
  type PlantillaVisualDoc,
} from "../../lib/plantillasVisuales";
import {
  descargarBase64,
  descargarBlob,
  exportarPlantillaBlob,
  guardarPlantillaEnGaleria,
} from "../../lib/plantillasVisualesExport";
import { type EtiquetaStudioDatos } from "../../lib/etiquetasNormativa";
import { EtiquetaMckennaPreview } from "../etiquetas/EtiquetaMckennaPreview";
import SelectorFormatoCanvas from "./SelectorFormatoCanvas";
import VisualCanvasEditor from "./VisualCanvasEditor";
import GenerarRenderIA from "./GenerarRenderIA";

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

export default function PlantillasVisualesPanel() {
  const qc = useQueryClient();
  const [vista, setVista] = useState<Vista>("lista");
  const [doc, setDoc] = useState<PlantillaVisualDoc | null>(null);
  const [buscar, setBuscar] = useState("");
  const [mostrarComparar, setMostrarComparar] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [modoIA, setModoIA] = useState(false);
  const [iaCtx, setIaCtx] = useState<{ formato: FormatoCanvas; categoriaId: string } | null>(null);

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
      setDoc(res.plantilla);
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

  const abrirNuevo = () => {
    setModoIA(false);
    setDoc(null);
    setVista("formato");
  };

  const abrirGenerarIA = () => {
    setModoIA(true);
    setDoc(null);
    setVista("formato");
  };

  const elegirFormato = (formato: FormatoCanvas, categoriaId: string) => {
    if (modoIA) {
      setIaCtx({ formato, categoriaId });
      // Stay in "formato" view but modal will appear
      return;
    }
    setDoc(plantillaVacia(formato, categoriaId));
    setVista("editor");
  };

  const abrirPlantilla = useCallback(async (id: string) => {
    try {
      const res = await api.get<{ plantilla: PlantillaVisualDoc }>(
        `/api/plantillas-visuales/${id}`,
      );
      setDoc(res.plantilla);
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
    try {
      if (formato === "pdf") {
        const res = await api.post<{
          ok: boolean;
          nombre: string;
          base64: string;
          formato: string;
        }>("/api/plantillas-visuales/exportar", { plantilla: doc, formato: "pdf", escala });
        descargarBase64(res.base64, res.nombre, "application/pdf");
      } else {
        const blob = await exportarPlantillaBlob(doc, formato, { escala });
        const ext = formato === "jpeg" ? "jpg" : "png";
        const safe = (doc.nombre || "plantilla").replace(/[^\w\-]+/g, "_").slice(0, 60);
        const suf = escala !== 1 ? `@${escala}x` : "";
        descargarBlob(blob, `${safe}${suf}.${ext}`);
      }
      const dim = `${Math.round(doc.formato.ancho_px * escala)}×${Math.round(doc.formato.alto_px * escala)}`;
      setMsg(`Exportado ${formato.toUpperCase()} (${dim} px) ✓`);
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
          onCancelar={() => { setVista("lista"); setModoIA(false); setIaCtx(null); }}
        />
        {iaCtx && (
          <GenerarRenderIA
            formato={iaCtx.formato}
            categoriaId={iaCtx.categoriaId}
            onGenerar={(doc) => {
              setDoc(doc);
              setIaCtx(null);
              setModoIA(false);
              setVista("editor");
            }}
            onCerrar={() => { setIaCtx(null); setModoIA(false); }}
          />
        )}
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
          onVolver={() => {
            setVista("lista");
            setDoc(null);
          }}
          onExportar={exportar}
          onGuardarEnGaleria={guardarEnGaleria}
          guardando={guardarMut.isPending}
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
          onClick={abrirGenerarIA}
          className="rounded-lg border border-accent/50 bg-accent/10 px-4 py-2 text-sm font-semibold text-accent hover:bg-accent/20 dark:border-accent/30"
        >
          ✨ Generar con IA
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
            const thumb = miniaturaLienzoPx(p.formato.ancho_px, p.formato.alto_px, 140, 100);
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
                    <div
                      className="rounded-sm shadow-lg ring-1 ring-black/20 transition group-hover:ring-accent/40"
                      style={{
                        width: thumb.width,
                        height: thumb.height,
                        background: p.fondo || "#fff",
                      }}
                    />
                  </div>
                  <div className="px-3 py-2.5">
                    <h3 className="truncate text-sm font-semibold text-ink">{p.nombre}</h3>
                    <p className="mt-0.5 text-[11px] text-muted">{labelFormato(p.formato)}</p>
                  </div>
                </button>
                <button
                  type="button"
                  title="Eliminar"
                  onClick={() => {
                    if (confirm(`¿Eliminar "${p.nombre}"?`)) eliminarMut.mutate(p.id);
                  }}
                  className="absolute right-2 top-2 rounded-md bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-white opacity-0 transition hover:bg-red-600 group-hover:opacity-100"
                >
                  Eliminar
                </button>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
