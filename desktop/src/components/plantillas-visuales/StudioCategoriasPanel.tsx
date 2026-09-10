/**
 * Portada de Studio visual: una tarjeta por categoría de producto.
 *
 * Antes esta pantalla abría con la biblioteca de imágenes (los logos primero y
 * las etiquetas debajo), que no es la unidad de trabajo de nadie. La unidad es
 * la categoría: tiene su plantilla, sus diseños de partida y las etiquetas ya
 * hechas con ella.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import {
  useCategoriasEtiqueta,
  detectarCategoriaEn,
  CATEGORIAS_ETIQUETA,
  type CategoriaEtiqueta,
} from "../../lib/categoriasEtiqueta";
import { categoriaProductoDe, type PlantillaVisualDoc } from "../../lib/plantillasVisuales";
import PlantillaVisualMiniatura from "./PlantillaVisualMiniatura";
import { CARPETA_ETIQUETAS_STUDIO, useEtiquetasStudio } from "./studioEtiquetasData";

export interface ResumenCategoria {
  categoria: CategoriaEtiqueta;
  plantilla: PlantillaVisualDoc | null;
  disenos: PlantillaVisualDoc[];
  etiquetas: number;
}

/** Agrupa plantillas y etiquetas finales por categoría. Exportado porque las
 *  otras pestañas de Studio muestran los mismos grupos. */
export function useResumenCategorias() {
  const { data: cats } = useCategoriasEtiqueta();
  // Guardas de forma: un valor con la forma equivocada en la caché no puede
  // volver a tumbar el panel entero (fue el «n.map is not a function»).
  const categorias = Array.isArray(cats) ? cats : CATEGORIAS_ETIQUETA;

  const { data: plantillasData, isLoading: cargandoPlantillas } = useQuery({
    queryKey: ["plantillas-visuales", "__todas__"],
    queryFn: () =>
      api.get<{ plantillas: PlantillaVisualDoc[] }>("/api/plantillas-visuales?todas=1"),
    staleTime: 15_000,
    gcTime: 60 * 60 * 1000,
  });
  const { data: etiquetas, isLoading: cargandoEtiquetas } = useEtiquetasStudio();

  const resumen = useMemo<ResumenCategoria[]>(() => {
    const plantillas = plantillasData?.plantillas ?? [];
    const porCategoria = new Map<string, PlantillaVisualDoc[]>();
    for (const p of plantillas) {
      const cat = categoriaProductoDe(p, categorias);
      const lista = porCategoria.get(cat) ?? [];
      lista.push(p);
      porCategoria.set(cat, lista);
    }
    const etiquetasPorCategoria = new Map<string, number>();
    for (const e of Array.isArray(etiquetas) ? etiquetas : []) {
      const cat = detectarCategoriaEn(categorias, nombreVisibleEtiqueta(e.nombre));
      etiquetasPorCategoria.set(cat, (etiquetasPorCategoria.get(cat) ?? 0) + 1);
    }
    return categorias.map((categoria) => {
      const disenos = porCategoria.get(categoria.id) ?? [];
      return {
        categoria,
        plantilla: disenos.find((d) => d.es_plantilla_categoria) ?? null,
        disenos,
        etiquetas: etiquetasPorCategoria.get(categoria.id) ?? 0,
      };
    });
  }, [plantillasData, etiquetas, categorias]);

  return { resumen, categorias, cargando: cargandoPlantillas || cargandoEtiquetas };
}

/** "ETIQUETAS STUDIO/MANI_500g_6.25x.png" → "MANI 500g" (para detectar categoría y mostrar). */
export function nombreVisibleEtiqueta(nombre: string): string {
  const base = (nombre || "").split("/").pop() || nombre || "";
  return base
    .replace(/\.(png|jpe?g|webp)$/i, "")
    .replace(/_\d+(\.\d+)?x(_\d+)?$/i, "")
    .replace(/_/g, " ")
    .trim();
}

interface Props {
  onCrearPlantilla: (categoriaId: string) => void;
  onAbrirPlantilla: (doc: PlantillaVisualDoc) => void;
  onCrearEtiquetas: (doc: PlantillaVisualDoc) => void;
  onVerDisenos: (categoriaId: string) => void;
  onVerEtiquetas: (categoriaId: string) => void;
  onNuevaCategoria: () => void;
}

export default function StudioCategoriasPanel({
  onCrearPlantilla,
  onAbrirPlantilla,
  onCrearEtiquetas,
  onVerDisenos,
  onVerEtiquetas,
  onNuevaCategoria,
}: Props) {
  const { resumen, cargando } = useResumenCategorias();

  // Primero las que tienen trabajo hecho; las vacías al final, para que la
  // portada no abra con veinte tarjetas en blanco.
  const ordenadas = useMemo(
    () =>
      [...resumen].sort((a, b) => {
        const pesoA = (a.plantilla ? 2 : 0) + (a.disenos.length > 0 ? 1 : 0);
        const pesoB = (b.plantilla ? 2 : 0) + (b.disenos.length > 0 ? 1 : 0);
        if (pesoA !== pesoB) return pesoB - pesoA;
        if (b.disenos.length !== a.disenos.length) return b.disenos.length - a.disenos.length;
        return a.categoria.etiqueta.localeCompare(b.categoria.etiqueta, "es");
      }),
    [resumen],
  );

  if (cargando) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-muted">
          Cada categoría tiene una plantilla; desde ella se generan las etiquetas de todos
          los productos de esa familia. Las etiquetas finales se guardan en{" "}
          <span className="font-medium text-ink">{CARPETA_ETIQUETAS_STUDIO}</span>.
        </p>
        <button
          type="button"
          onClick={onNuevaCategoria}
          className="shrink-0 rounded-lg border border-accent/40 px-3 py-2 text-sm font-semibold text-accent hover:bg-accent/10"
        >
          + Categoría
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ordenadas.map(({ categoria, plantilla, disenos, etiquetas }) => (
          <article
            key={categoria.id}
            className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface-panel"
          >
            <div className="flex min-h-[132px] items-center justify-center bg-[#525659] p-3">
              {plantilla ? (
                <PlantillaVisualMiniatura doc={plantilla} maxAncho={150} maxAlto={104} />
              ) : (
                <p className="px-3 text-center text-[11px] text-white/70">
                  Sin plantilla de categoría
                </p>
              )}
            </div>

            <div className="flex flex-1 flex-col gap-2 px-3 py-2.5">
              <h3 className="truncate text-sm font-semibold text-ink" title={categoria.etiqueta}>
                {categoria.etiqueta}
              </h3>
              <p className="text-[11px] text-muted">
                <button
                  type="button"
                  onClick={() => onVerDisenos(categoria.id)}
                  className="underline decoration-dotted hover:text-accent"
                >
                  {disenos.length} diseño{disenos.length === 1 ? "" : "s"}
                </button>
                {" · "}
                <button
                  type="button"
                  onClick={() => onVerEtiquetas(categoria.id)}
                  className="underline decoration-dotted hover:text-accent"
                >
                  {etiquetas} etiqueta{etiquetas === 1 ? "" : "s"}
                </button>
              </p>

              <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                {plantilla ? (
                  <>
                    <button
                      type="button"
                      onClick={() => onCrearEtiquetas(plantilla)}
                      className="rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                    >
                      Crear etiquetas
                    </button>
                    <button
                      type="button"
                      onClick={() => onAbrirPlantilla(plantilla)}
                      className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-ink-secondary hover:bg-surface-hover"
                    >
                      Editar plantilla
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => onCrearPlantilla(categoria.id)}
                    className="rounded-lg border border-accent/40 px-2.5 py-1.5 text-xs font-semibold text-accent hover:bg-accent/10"
                  >
                    Crear plantilla
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
