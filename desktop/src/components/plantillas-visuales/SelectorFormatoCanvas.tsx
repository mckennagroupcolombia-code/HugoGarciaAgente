import { useMemo, useState } from "react";
import { etiquetaTamanoFormato, formatoMedidasEtiqueta, useTiposEtiqueta } from "../../lib/etiquetasTipos";
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
  /** `nombre`: título escrito a mano para la plantilla nueva (vacío = sin título). */
  onElegir: (formato: FormatoCanvas, categoriaId: string, nombre?: string) => void;
  onCancelar: () => void;
  titulo?: string;
  subtitulo?: string;
  /** Muestra el campo «Nombre de la plantilla» (al crear, no al cambiar formato). */
  pedirNombre?: boolean;
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

export default function SelectorFormatoCanvas({
  onElegir,
  onCancelar,
  titulo,
  subtitulo,
  pedirNombre = false,
}: Props) {
  const [nombrePlantilla, setNombrePlantilla] = useState("");
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
    onElegir(presetToFormato(p, categoria.id), categoria.id, nombrePlantilla.trim() || undefined);
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
    onElegir(formato, "personalizado", nombrePlantilla.trim() || undefined);
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-ink">{titulo ?? "Nuevo lienzo"}</h2>
          <p className="mt-0.5 text-sm text-muted">{subtitulo ?? "Formato predefinido o dimensiones a medida."}</p>
        </div>
        <button
          type="button"
          onClick={onCancelar}
          className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-surface-hover hover:text-ink"
        >
          Cancelar
        </button>
      </div>

      {pedirNombre && (
        <label className="mb-4 block">
          <span className="text-xs font-semibold text-ink">Nombre de la plantilla</span>
          <input
            type="text"
            value={nombrePlantilla}
            onChange={(e) => setNombrePlantilla(e.target.value)}
            placeholder="Ej. Sales minerales 500 g"
            className="mt-1 w-full max-w-md rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-ink"
            autoFocus
          />
          <span className="mt-1 block text-[11px] text-muted">
            El tamaño no le da nombre a la plantilla: escríbelo tú. Se puede cambiar después en el editor.
          </span>
        </label>
      )}

      <div className="mb-4 flex flex-wrap gap-1.5">
        {categorias.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setCategoriaActiva(cat.id)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              categoriaActiva === cat.id
                ? "bg-accent text-white"
                : "text-muted hover:bg-surface-hover hover:text-ink"
            }`}
          >
            <IllustrationIcon
              name={CAT_ICONS[cat.id] ?? "palette"}
              size={18}
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
                className="group rounded-lg border border-border bg-surface-panel p-3 text-left transition hover:border-accent/50"
              >
                <div className="mb-2 flex min-h-[96px] items-center justify-center rounded bg-[#525659] p-2">
                  <div
                    className="rounded-sm bg-white mck-paper-white shadow-md ring-1 ring-black/20 transition group-hover:ring-accent/40"
                    style={{ width: thumb.width, height: thumb.height }}
                  />
                </div>
                {esEtiqueta && fmt.ancho_mm != null && fmt.alto_mm != null ? (
                  // Etiquetas: el tamaño es el nombre del formato.
                  <p className="font-semibold tabular-nums text-ink">
                    {etiquetaTamanoFormato(fmt.tipo_etiqueta, fmt.ancho_mm, fmt.alto_mm)}
                  </p>
                ) : (
                  <>
                    <p className="font-semibold text-ink">{fmt.nombre}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {f.ancho_mm != null && f.alto_mm != null
                        ? formatoMedidasEtiqueta(f.ancho_mm, f.alto_mm)
                        : `${f.ancho_px} × ${f.alto_px} px`}
                    </p>
                  </>
                )}
                {fmt.descripcion && !esEtiqueta && (
                  <p className="mt-1 text-xs text-ink-secondary">{fmt.descripcion}</p>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-6 rounded-lg border border-dashed border-border bg-surface-panel/50 p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Personalizado</h3>
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
