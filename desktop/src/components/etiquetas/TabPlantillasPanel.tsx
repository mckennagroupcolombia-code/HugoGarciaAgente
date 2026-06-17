import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

interface PlantillaAi {
  archivo: string;
  ruta?: string;
  bytes?: number;
}

interface PlantillasStudioResp {
  plantillas: { tipo_etiqueta: string; archivo: string; ancho_mm?: number; alto_mm?: number; disponible?: boolean }[];
  plantillas_ai: PlantillaAi[];
  total_ai: number;
}

interface TabPlantillasPanelProps {
  onIrStudio?: () => void;
}

/** Plantillas reiniciadas: sin overlays PDF ni mapeo SVG hardcodeado. */
export function TabPlantillasPanel({ onIrStudio }: TabPlantillasPanelProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["etiquetas-studio-plantillas-base"],
    queryFn: () => api.get<PlantillasStudioResp>("/api/etiquetas/studio/plantillas"),
    staleTime: 60_000,
  });

  const archivosAi = data?.plantillas_ai ?? [];
  const formatosSvg = data?.plantillas ?? [];

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface-panel shadow-paper-sm">
      <div className="border-b border-accent/30 bg-accent px-4 py-3 text-white">
        <p className="text-sm font-bold">Plantillas de etiqueta</p>
        <p className="text-[11px] opacity-80">
          Configuración anterior eliminada · empezamos de cero con archivos .ai del disco
        </p>
      </div>

      <div className="grid gap-6 p-5 lg:grid-cols-[1fr,minmax(220px,280px)]">
        <section className="space-y-4">
          <div className="rounded-lg border border-dashed border-border bg-surface px-4 py-8 text-center">
            <p className="text-sm font-semibold text-ink">Lienzo en blanco</p>
            <p className="mx-auto mt-2 max-w-md text-xs text-muted">
              Ya no hay plantillas PDF dibujadas ni posiciones fijas en JSON. Cada producto usa su
              archivo Illustrator (.ai) y en Studio ajustas textos, colores y diagramación.
            </p>
            {onIrStudio && (
              <button
                type="button"
                onClick={onIrStudio}
                className="mt-4 rounded-lg bg-accent px-4 py-2 text-xs font-bold text-white hover:bg-accent/90"
              >
                Ir a Studio
              </button>
            )}
          </div>

          <p className="text-[11px] text-muted">
            Los formatos SVG genéricos (250 g, 500 g, etc.) quedan sin mapeo hasta definirlos de nuevo.
            El motor resuelve primero la plantilla .ai por SKU o nombre de producto.
          </p>
        </section>

        <aside className="space-y-4">
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-muted">
              Plantillas .ai ({data?.total_ai ?? archivosAi.length})
            </p>
            <div className="max-h-72 overflow-y-auto rounded-lg border border-border bg-surface">
              {isLoading && <p className="p-3 text-xs text-muted">Cargando…</p>}
              {isError && (
                <p className="p-3 text-xs text-danger">No se pudo listar las plantillas .ai</p>
              )}
              {!isLoading && !isError && archivosAi.length === 0 && (
                <p className="p-3 text-xs text-muted">Sin archivos .ai en Etiquetas Modelo SVG</p>
              )}
              {archivosAi.slice(0, 120).map((p) => (
                <div
                  key={p.archivo}
                  className="border-b border-border/40 px-3 py-2 font-mono text-[10px] text-ink last:border-0"
                  title={p.ruta}
                >
                  {p.archivo}
                </div>
              ))}
              {archivosAi.length > 120 && (
                <p className="p-2 text-[10px] text-muted">… y {archivosAi.length - 120} más</p>
              )}
            </div>
          </div>

          {formatosSvg.length > 0 && (
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-muted">
                Formatos SVG (sin config)
              </p>
              <ul className="space-y-1 text-[10px] text-muted">
                {formatosSvg.map((f) => (
                  <li key={f.tipo_etiqueta}>
                    {f.tipo_etiqueta}
                    {f.ancho_mm && f.alto_mm ? ` · ${f.ancho_mm}×${f.alto_mm} mm` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
