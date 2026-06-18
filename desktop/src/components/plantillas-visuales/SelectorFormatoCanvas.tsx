import { useMemo, useState } from "react";
import { useTiposEtiqueta } from "../../lib/etiquetasTipos";
import { IllustrationIcon } from "../../icons/IllustrationIcon";
import type { UiIconName } from "../../icons";
import {
  CANVAS_DPI,
  categoriasFormatoConEtiquetas,
  miniaturaLienzoPx,
  mmToPx,
  presetToFormato,
  type FormatoCanvas,
  type FormatoPreset,
} from "../../lib/plantillasVisuales";

interface Props {
  onElegir: (formato: FormatoCanvas, categoriaId: string) => void;
  onCancelar: () => void;
}

const CAT_ICONS: Record<string, UiIconName> = {
  meli: "cart",
  fichas: "file",
  banners: "image",
  redes: "phone",
  documentos: "listChecks",
  etiquetas: "tag",
  personalizado: "palette",
};

export default function SelectorFormatoCanvas({ onElegir, onCancelar }: Props) {
  const { data: tiposData, isLoading: tiposLoading } = useTiposEtiqueta();
  const tipos = tiposData?.tipos ?? [];

  const categorias = useMemo(
    () => categoriasFormatoConEtiquetas(tipos),
    [tipos],
  );

  const [categoriaActiva, setCategoriaActiva] = useState("etiquetas");
  const [customAncho, setCustomAncho] = useState("800");
  const [customAlto, setCustomAlto] = useState("600");
  const [customUnidad, setCustomUnidad] = useState<"px" | "mm">("px");
  const [customNombre, setCustomNombre] = useState("Personalizado");

  const categoria = useMemo(
    () => categorias.find((c) => c.id === categoriaActiva) ?? categorias[0],
    [categorias, categoriaActiva],
  );

  function elegirPreset(p: FormatoPreset) {
    if (!categoria) return;
    onElegir(presetToFormato(p, categoria.id), categoria.id);
  }

  function elegirPersonalizado() {
    const ancho = parseFloat(customAncho) || 800;
    const alto = parseFloat(customAlto) || 600;
    const dpi = CANVAS_DPI;
    const formato: FormatoCanvas = {
      id: "personalizado",
      nombre: customNombre.trim() || "Personalizado",
      ancho_px: customUnidad === "mm" ? mmToPx(ancho, dpi) : Math.round(ancho),
      alto_px: customUnidad === "mm" ? mmToPx(alto, dpi) : Math.round(alto),
      ancho_mm: customUnidad === "mm" ? ancho : undefined,
      alto_mm: customUnidad === "mm" ? alto : undefined,
      dpi,
    };
    onElegir(formato, "personalizado");
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-ink">Elegir formato de lienzo</h2>
          <p className="mt-1 text-sm text-muted">
            Selecciona un tamaño predefinido o define dimensiones personalizadas.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancelar}
          className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:bg-surface-hover"
        >
          Volver
        </button>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {categorias.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setCategoriaActiva(cat.id)}
            className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
              categoriaActiva === cat.id
                ? "bg-accent text-white shadow-sm"
                : "border border-border bg-surface-panel text-ink-secondary hover:bg-surface-hover"
            }`}
          >
            <IllustrationIcon
              name={CAT_ICONS[cat.id] ?? "palette"}
              size={22}
              bubble={false}
              tone={categoriaActiva === cat.id ? "neutral" : "accent"}
              className={categoriaActiva === cat.id ? "text-white" : undefined}
            />
            {cat.nombre}
          </button>
        ))}
      </div>

      {categoria?.id === "etiquetas" && (
        <p className="mb-4 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-xs text-ink-secondary">
          Los formatos de etiquetas se sincronizan con los de impresión en{" "}
          <strong>Etiquetas → Imprimir</strong>. Si agregas o editas un formato allí,
          aparecerá aquí automáticamente.
        </p>
      )}

      {categoria?.id === "etiquetas" && tiposLoading ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      ) : categoria && categoria.formatos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface-panel px-6 py-10 text-center text-sm text-muted">
          No hay formatos de impresión configurados. Agrégalos en{" "}
          <strong>Etiquetas → Imprimir</strong> (selector de formato).
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {categoria?.formatos.map((fmt) => {
            const f = presetToFormato(fmt, categoria.id);
            const thumb = miniaturaLienzoPx(f.ancho_px, f.alto_px, 132, 96);
            const esEtiqueta = Boolean(fmt.tipo_etiqueta);
            return (
              <button
                key={fmt.id}
                type="button"
                onClick={() => elegirPreset(fmt)}
                className="group rounded-xl border-2 border-border bg-surface-panel p-4 text-left transition hover:border-accent hover:shadow-paper"
              >
                <div className="mb-3 flex min-h-[108px] items-center justify-center rounded-lg bg-zinc-100 p-2 dark:bg-zinc-800/50">
                  <div
                    className="rounded-sm bg-white shadow-md ring-1 ring-black/15 transition group-hover:ring-accent/50"
                    style={{ width: thumb.width, height: thumb.height }}
                  />
                </div>
                <p className="font-semibold text-ink">{fmt.nombre}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {esEtiqueta && fmt.ancho_mm != null && fmt.alto_mm != null
                    ? `${fmt.nombre} · ${fmt.ancho_mm}×${fmt.alto_mm} mm`
                    : f.ancho_mm
                      ? `${f.ancho_mm} × ${f.alto_mm} mm`
                      : `${f.ancho_px} × ${f.alto_px} px`}
                </p>
                {fmt.descripcion && (
                  <p className="mt-1 text-xs text-ink-secondary">{fmt.descripcion}</p>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-8 rounded-xl border-2 border-dashed border-border bg-surface-panel p-5">
        <h3 className="mb-3 font-semibold text-ink">✏️ Tamaño personalizado</h3>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">Nombre</span>
            <input
              value={customNombre}
              onChange={(e) => setCustomNombre(e.target.value)}
              className="w-40 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">Ancho</span>
            <input
              type="number"
              min={1}
              value={customAncho}
              onChange={(e) => setCustomAncho(e.target.value)}
              className="w-24 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">Alto</span>
            <input
              type="number"
              min={1}
              value={customAlto}
              onChange={(e) => setCustomAlto(e.target.value)}
              className="w-24 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">Unidad</span>
            <select
              value={customUnidad}
              onChange={(e) => setCustomUnidad(e.target.value as "px" | "mm")}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"
            >
              <option value="px">px</option>
              <option value="mm">mm</option>
            </select>
          </label>
          <button
            type="button"
            onClick={elegirPersonalizado}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90"
          >
            Crear lienzo
          </button>
        </div>
      </div>
    </div>
  );
}
