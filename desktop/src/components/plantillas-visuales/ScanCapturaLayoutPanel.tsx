/**
 * Tras elegir el formato del lienzo: subir/pegar foto → Visión IA diagramá
 * el layout escalado a ese tamaño (no plantilla SCI fija).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { imagenDesdePortapapeles } from "../../lib/clipboardImage";
import { formatoMedidasEtiqueta } from "../../lib/etiquetasTipos";
import {
  labelFormato,
  nuevoId,
  plantillaVacia,
  type FormatoCanvas,
  type PlantillaVisualDoc,
} from "../../lib/plantillasVisuales";

interface Props {
  formato: FormatoCanvas;
  categoriaId: string;
  carpeta?: string;
  onListo: (doc: PlantillaVisualDoc) => void;
  onVolver: () => void;
}

export default function ScanCapturaLayoutPanel({
  formato,
  categoriaId,
  carpeta = "",
  onListo,
  onVolver,
}: Props) {
  const [escaneando, setEscaneando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const abrirVacio = useCallback(() => {
    onListo(plantillaVacia(formato, categoriaId, carpeta));
  }, [carpeta, categoriaId, formato, onListo]);

  const procesarArchivo = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        setMsg("El archivo no es una imagen válida.");
        return;
      }
      const url = URL.createObjectURL(file);
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
      setEscaneando(true);
      setMsg("Diagramando la foto al tamaño del lienzo elegido…");
      try {
        const b64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
          reader.readAsDataURL(file);
        });
        const res = await api.post<{
          ok: boolean;
          plantilla?: PlantillaVisualDoc;
          error?: string;
        }>(
          "/api/plantillas-visuales/abstraer-etiqueta",
          {
            modo: "layout",
            imagen_b64: b64,
            canvas_w: formato.ancho_px,
            canvas_h: formato.alto_px,
            dpi: formato.dpi || 96,
            formato_id: formato.id,
            formato_nombre: formato.nombre,
            ancho_mm: formato.ancho_mm,
            alto_mm: formato.alto_mm,
            tipo_etiqueta: formato.tipo_etiqueta,
            categoria: categoriaId,
            carpeta,
          },
          { timeoutMs: 90_000 },
        );
        if (!res?.ok || !res.plantilla) {
          setMsg(res?.error || "No se pudo diagramar la captura al lienzo.");
          return;
        }
        const plantilla: PlantillaVisualDoc = {
          ...res.plantilla,
          id: res.plantilla.id && res.plantilla.id !== "nuevo" ? res.plantilla.id : nuevoId(),
          categoria: res.plantilla.categoria || categoriaId,
          carpeta: res.plantilla.carpeta ?? carpeta,
          formato: {
            ...formato,
            ...(res.plantilla.formato || {}),
            ancho_px: formato.ancho_px,
            alto_px: formato.alto_px,
            ancho_mm: formato.ancho_mm,
            alto_mm: formato.alto_mm,
            dpi: formato.dpi || 96,
            tipo_etiqueta: formato.tipo_etiqueta || res.plantilla.formato?.tipo_etiqueta,
          },
        };
        onListo(plantilla);
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "Error al diagramar la imagen");
      } finally {
        setEscaneando(false);
      }
    },
    [carpeta, categoriaId, formato, onListo],
  );

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const file = imagenDesdePortapapeles(e.clipboardData);
      if (!file || escaneando) return;
      e.preventDefault();
      void procesarArchivo(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [escaneando, procesarArchivo]);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const mmLabel =
    formato.ancho_mm && formato.alto_mm
      ? `${formatoMedidasEtiqueta(formato.ancho_mm, formato.alto_mm)} · ${formato.ancho_mm}×${formato.alto_mm} mm`
      : null;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-ink">Captura → lienzo</h2>
          <p className="mt-0.5 text-sm text-muted">
            Formato elegido: <strong className="text-ink">{labelFormato(formato)}</strong>
            {mmLabel ? ` (${mmLabel})` : ""} · {formato.ancho_px}×{formato.alto_px} px.
            La diagramación se escala a este tamaño.
          </p>
        </div>
        <button
          type="button"
          onClick={onVolver}
          disabled={escaneando}
          className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-surface-hover hover:text-ink disabled:opacity-50"
        >
          ← Cambiar tamaño
        </button>
      </div>

      {msg && (
        <div className="mb-4 rounded-lg border border-accent/30 bg-accent/10 px-4 py-2 text-sm text-ink">
          {msg}
        </div>
      )}

      <div className="rounded-2xl border border-border bg-surface-panel p-5">
        <p className="text-sm text-muted">
          Pega con <kbd className="rounded border border-border bg-surface px-1 py-0.5 font-mono text-[10px]">Ctrl+V</kbd>{" "}
          o sube una foto de la etiqueta. No se fuerza la plantilla SCI: se copian textos y posiciones
          de tu imagen al lienzo que elegiste.
        </p>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void procesarArchivo(f);
            e.target.value = "";
          }}
        />

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={escaneando}
            onClick={() => fileRef.current?.click()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {escaneando ? "Diagramando…" : "📷 Subir captura"}
          </button>
          <button
            type="button"
            disabled={escaneando}
            onClick={abrirVacio}
            className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold text-ink hover:bg-surface-hover disabled:opacity-50"
          >
            Lienzo vacío
          </button>
        </div>

        {previewUrl && (
          <div className="mt-5 overflow-hidden rounded-xl border border-border bg-white">
            <img src={previewUrl} alt="Captura de referencia" className="mx-auto max-h-72 object-contain" />
          </div>
        )}
      </div>
    </div>
  );
}
