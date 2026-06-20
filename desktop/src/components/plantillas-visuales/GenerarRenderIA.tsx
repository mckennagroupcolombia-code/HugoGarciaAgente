import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../api/client";
import { type FormatoCanvas, type PlantillaVisualDoc } from "../../lib/plantillasVisuales";

interface Props {
  formato: FormatoCanvas;
  categoriaId: string;
  onGenerar: (doc: PlantillaVisualDoc) => void;
  onCerrar: () => void;
}

const EJEMPLOS = [
  "Ácido Ascórbico Grado Cosmético 100 g — vitamina C para formulaciones antioxidantes",
  "Urea Cosmética 250 g — humectante para cremas corporales y peelings",
  "Niacinamida 30 g — vitamina B3 para sueros iluminadores",
  "Aceite de Argán Refinado 500 ml — aceite vegetal para tratamientos capilares",
];

export default function GenerarRenderIA({ formato, categoriaId, onGenerar, onCerrar }: Props) {
  const [descripcion, setDescripcion] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progreso, setProgreso] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function generar() {
    const desc = descripcion.trim();
    if (!desc) { textareaRef.current?.focus(); return; }

    setCargando(true);
    setError(null);
    setProgreso("Enviando descripción a Claude…");

    const pasos = [
      "Analizando descripción del producto…",
      "Diseñando composición de elementos…",
      "Aplicando paleta McKenna…",
      "Ajustando tipografía y proporciones…",
      "Finalizando estructura de capas…",
    ];
    let paso = 0;
    const timer = setInterval(() => {
      paso = (paso + 1) % pasos.length;
      setProgreso(pasos[paso]);
    }, 1800);

    try {
      const res = await api.post<{ ok: boolean; plantilla?: PlantillaVisualDoc; error?: string }>(
        "/api/plantillas-visuales/generar-ia",
        {
          descripcion: desc,
          canvas_w: formato.ancho_px,
          canvas_h: formato.alto_px,
          categoria: categoriaId,
        },
      );

      if (!res.ok || !res.plantilla) {
        throw new Error(res.error || "La IA no devolvió una plantilla válida");
      }

      // Ensure formato matches what the user selected
      res.plantilla.formato = formato;
      res.plantilla.categoria = categoriaId;

      onGenerar(res.plantilla);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado");
    } finally {
      clearInterval(timer);
      setCargando(false);
      setProgreso("");
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[700] flex items-center justify-center bg-ink/50 p-4 backdrop-blur-sm"
      onClick={onCerrar}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-border bg-surface-panel shadow-paper-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="font-bold text-ink">Generar plantilla con IA</h2>
            <p className="mt-0.5 text-xs text-muted">
              Claude diseña la estructura de capas a partir de la descripción del producto.
            </p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            disabled={cargando}
            className="rounded-lg border border-border px-2 py-1 text-sm text-muted hover:bg-surface-hover disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 p-5">
          {/* Textarea descripción */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">
              Descripción del producto
            </label>
            <textarea
              ref={textareaRef}
              rows={4}
              placeholder={`Ej: ${EJEMPLOS[0]}`}
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              disabled={cargando}
              className="w-full resize-none rounded-xl border border-border bg-surface px-3 py-2.5 text-sm leading-relaxed text-ink placeholder:text-muted/60 focus:border-accent focus:outline-none disabled:opacity-50"
            />
            <p className="mt-1 text-[10px] text-muted">
              Incluye nombre, tipo de materia prima, presentación (g/ml), uso principal y cualquier dato de etiqueta relevante.
            </p>
          </div>

          {/* Ejemplos rápidos */}
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">Ejemplos rápidos</p>
            <div className="flex flex-wrap gap-1.5">
              {EJEMPLOS.map((ej) => (
                <button
                  key={ej}
                  type="button"
                  disabled={cargando}
                  onClick={() => setDescripcion(ej)}
                  className="rounded-full border border-border px-2.5 py-1 text-[10px] text-ink-secondary hover:border-accent/50 hover:bg-surface-hover hover:text-ink disabled:opacity-40"
                >
                  {ej.split(" — ")[0].slice(0, 28)}…
                </button>
              ))}
            </div>
          </div>

          {/* Info formato */}
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-muted">
            <span className="font-mono text-[10px]">📐</span>
            <span>
              Formato: <strong className="text-ink">{formato.ancho_px} × {formato.alto_px} px</strong>
            </span>
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-400">
              {error}
            </div>
          )}

          {/* Botón generar */}
          <button
            type="button"
            disabled={cargando || !descripcion.trim()}
            onClick={generar}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {cargando ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                <span className="text-xs">{progreso || "Generando…"}</span>
              </>
            ) : (
              <>
                <span>✨</span>
                Generar con IA
              </>
            )}
          </button>

          {cargando && (
            <p className="text-center text-[10px] text-muted">
              Claude está diseñando la plantilla. Tarda entre 10 y 30 segundos.
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
