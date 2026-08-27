import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  CATEGORIAS_ICONOS_QUIMICA,
  ICONOS_QUIMICA_CIRCULARES,
  iconoQuimicoASvgDataUrl,
  type IconoQuimicoCircular,
} from "../../lib/iconosQuimicaCirculares";

interface Props {
  abierta: boolean;
  colorTinta?: string;
  onCerrar: () => void;
  onElegir: (svgDataUrl: string, icono: IconoQuimicoCircular) => void;
}

export default function GaleriaIconosQuimicosModal({
  abierta,
  colorTinta = "#1a1a1a",
  onCerrar,
  onElegir,
}: Props) {
  const [buscar, setBuscar] = useState("");
  const [categoria, setCategoria] = useState<string>("todos");
  const [colorPersonalizado, setColorPersonalizado] = useState(colorTinta);
  const [conCirculo, setConCirculo] = useState(true);

  const iconosFiltrados = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return ICONOS_QUIMICA_CIRCULARES.filter((ico) => {
      if (categoria !== "todos" && ico.categoria !== categoria) return false;
      if (!q) return true;
      return (
        ico.nombre.toLowerCase().includes(q) ||
        ico.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [buscar, categoria]);

  if (!abierta) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[650] flex items-center justify-center bg-ink/50 p-2 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onCerrar}
    >
      <div
        className="flex max-h-[min(90vh,720px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-surface-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera estilo selector de emojis */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-base text-accent">
              ⚗️
            </span>
            <div>
              <h3 className="text-sm font-bold text-ink">Galería de Iconos Circulares</h3>
              <p className="text-[11px] text-muted">
                Química, Alquimia & Cosmética · Estética limpia y minimalista
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted hover:bg-surface-hover hover:text-ink"
          >
            ✕
          </button>
        </div>

        {/* Barra de búsqueda y selector de categorías */}
        <div className="border-b border-border bg-surface px-4 py-2.5 space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted text-xs">
                🔍
              </span>
              <input
                type="text"
                value={buscar}
                onChange={(e) => setBuscar(e.target.value)}
                placeholder="Buscar rostro, colágeno, solar, almendra, nuez, coco, espuma, molécula, gota, pH..."
                className="w-full rounded-xl border border-border bg-surface-input py-1.5 pl-8 pr-3 text-xs text-ink placeholder:text-muted focus:border-accent focus:outline-none"
                autoFocus
              />
              {buscar && (
                <button
                  type="button"
                  onClick={() => setBuscar("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted hover:text-ink"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Selector de estilo circular o silueta libre */}
            <button
              type="button"
              onClick={() => setConCirculo(!conCirculo)}
              className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs font-semibold transition ${
                conCirculo
                  ? "border-accent bg-accent/15 text-accent"
                  : "border-border bg-surface-panel text-muted hover:text-ink"
              }`}
              title="Alternar entre icono encerrado en círculo o silueta abierta"
            >
              <span>{conCirculo ? "⭕ Con círculo" : "✨ Libre"}</span>
            </button>

            {/* Ajuste de color de tinta para la previsualización */}
            <div className="flex items-center gap-1.5 rounded-xl border border-border bg-surface-panel px-2 py-1">
              <span className="text-[10px] font-semibold text-muted">Tinta:</span>
              <input
                type="color"
                value={colorPersonalizado}
                onChange={(e) => setColorPersonalizado(e.target.value)}
                className="h-5 w-5 cursor-pointer rounded border border-border p-0"
                title="Color de tinta del icono"
              />
            </div>
          </div>

          {/* Filtros de categoría horizontales (estilo emoji picker) */}
          <div className="flex gap-1 overflow-x-auto pb-0.5 text-xs no-scrollbar">
            {CATEGORIAS_ICONOS_QUIMICA.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategoria(cat.id)}
                className={`whitespace-nowrap rounded-lg px-2.5 py-1 font-medium transition ${
                  categoria === cat.id
                    ? "bg-accent text-white shadow-sm"
                    : "border border-border bg-surface-panel text-muted hover:bg-surface-hover hover:text-ink"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* Rejilla de iconos estilo panel de emojis */}
        <div className="flex-1 overflow-y-auto p-4">
          {iconosFiltrados.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <span className="text-3xl opacity-40">🧪</span>
              <p className="mt-2 text-xs font-semibold text-ink">No se encontraron iconos</p>
              <p className="text-[11px] text-muted">Prueba con otra palabra clave o categoría</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
              {iconosFiltrados.map((ico) => {
                const dataUrl = iconoQuimicoASvgDataUrl(ico.svg, colorPersonalizado, conCirculo);
                const svgPreview = conCirculo
                  ? ico.svg
                  : ico.svg.replace(/<circle[^>]*r="44"[^>]*\/>/g, "");

                return (
                  <button
                    key={ico.id}
                    type="button"
                    onClick={() => {
                      onElegir(dataUrl, ico);
                      onCerrar();
                    }}
                    title={ico.nombre}
                    className="group flex flex-col items-center rounded-xl border border-border bg-surface p-2.5 text-center transition hover:border-accent hover:bg-accent/5 hover:shadow-md"
                  >
                    <div
                      className="flex h-16 w-16 items-center justify-center transition group-hover:scale-110"
                      style={{ color: colorPersonalizado }}
                      dangerouslySetInnerHTML={{ __html: svgPreview }}
                    />
                    <span className="mt-1.5 line-clamp-2 w-full text-[10px] font-medium leading-tight text-muted group-hover:text-ink">
                      {ico.nombre}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Pie de modal */}
        <div className="flex items-center justify-between border-t border-border bg-surface px-4 py-2.5 text-[11px] text-muted">
          <span>
            {iconosFiltrados.length} icono{iconosFiltrados.length !== 1 ? "s" : ""} disponible{iconosFiltrados.length !== 1 ? "s" : ""}
          </span>
          <span className="font-medium text-ink">Haz clic sobre un icono para insertarlo en la etiqueta</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
