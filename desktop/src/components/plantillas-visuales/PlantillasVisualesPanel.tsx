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
} from "../../lib/plantillasVisualesExport";
import SelectorFormatoCanvas from "./SelectorFormatoCanvas";
import VisualCanvasEditor from "./VisualCanvasEditor";

type Vista = "lista" | "formato" | "editor";

export default function PlantillasVisualesPanel() {
  const qc = useQueryClient();
  const [vista, setVista] = useState<Vista>("lista");
  const [doc, setDoc] = useState<PlantillaVisualDoc | null>(null);
  const [buscar, setBuscar] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

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

  const abrirNuevo = () => {
    setDoc(null);
    setVista("formato");
  };

  const elegirFormato = (formato: FormatoCanvas, categoriaId: string) => {
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

  const exportar = async (formato: "png" | "jpeg" | "pdf") => {
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
        }>("/api/plantillas-visuales/exportar", { plantilla: doc, formato: "pdf" });
        descargarBase64(res.base64, res.nombre, "application/pdf");
      } else {
        const blob = await exportarPlantillaBlob(doc, formato);
        const ext = formato === "jpeg" ? "jpg" : "png";
        const safe = (doc.nombre || "plantilla").replace(/[^\w\-]+/g, "_").slice(0, 60);
        descargarBlob(blob, `${safe}.${ext}`);
      }
      setMsg(`Exportado como ${formato.toUpperCase()} ✓`);
      setTimeout(() => setMsg(null), 2500);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error al exportar");
    } finally {
      setExportando(false);
    }
  };

  if (vista === "formato") {
    return (
      <SelectorFormatoCanvas
        onElegir={elegirFormato}
        onCancelar={() => setVista("lista")}
      />
    );
  }

  if (vista === "editor" && doc) {
    return (
      <>
        {msg && (
          <div className="mb-3 rounded-lg border border-accent/30 bg-accent/10 px-4 py-2 text-sm text-ink">
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
          guardando={guardarMut.isPending}
          exportando={exportando}
        />
      </>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-extrabold text-ink">Editor de Plantillas Visuales</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Crea etiquetas, fichas, imágenes para Mercado Libre, banners y piezas gráficas
            reutilizables para McKenna Group.
          </p>
        </div>
        <button
          type="button"
          onClick={abrirNuevo}
          className="rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-white shadow-[0_3px_0_#045159] transition hover:opacity-90 active:translate-y-0.5"
        >
          + Crear nuevo recurso
        </button>
      </div>

      {msg && (
        <div className="mb-4 rounded-lg border border-accent/30 bg-accent/10 px-4 py-2 text-sm">
          {msg}
        </div>
      )}

      <div className="mb-4">
        <input
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
          placeholder="Buscar plantillas…"
          className="w-full max-w-md rounded-xl border border-border bg-surface-panel px-4 py-2.5 text-sm"
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      ) : plantillas.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-border bg-surface-panel px-8 py-16 text-center">
          <p className="text-4xl">🎨</p>
          <p className="mt-3 font-semibold text-ink">Aún no hay plantillas guardadas</p>
          <p className="mt-1 text-sm text-muted">
            Comienza eligiendo un formato de lienzo y agrega textos, formas e imágenes.
          </p>
          <button
            type="button"
            onClick={abrirNuevo}
            className="mt-5 rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-white"
          >
            Crear primer recurso
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plantillas.map((p) => {
            const thumb = miniaturaLienzoPx(p.formato.ancho_px, p.formato.alto_px, 160, 120);
            return (
            <article
              key={p.id}
              className="group rounded-xl border-2 border-border bg-surface-panel p-4 transition hover:border-accent hover:shadow-paper"
            >
              <div className="mb-3 flex min-h-[128px] items-center justify-center rounded-lg bg-zinc-100 p-2 dark:bg-zinc-800/50">
                <div
                  className="rounded-sm shadow-md ring-1 ring-black/15"
                  style={{
                    width: thumb.width,
                    height: thumb.height,
                    background: p.fondo || "#fff",
                  }}
                />
              </div>
              <h3 className="truncate font-bold text-ink">{p.nombre}</h3>
              <p className="mt-0.5 text-xs text-muted">{labelFormato(p.formato)}</p>
              <p className="mt-0.5 text-xs text-muted capitalize">{p.categoria}</p>
              {p.updated_at && (
                <p className="mt-1 text-[10px] text-muted">
                  {new Date(p.updated_at).toLocaleString("es-CO")}
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => void abrirPlantilla(p.id)}
                  className="flex-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Abrir
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`¿Eliminar "${p.nombre}"?`)) eliminarMut.mutate(p.id);
                  }}
                  className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
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
