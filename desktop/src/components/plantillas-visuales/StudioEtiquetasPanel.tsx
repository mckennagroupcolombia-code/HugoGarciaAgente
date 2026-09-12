/**
 * Pestaña "Etiquetas" de Studio: las etiquetas finales ya generadas, agrupadas
 * por categoría de producto en vez de una lista plana de 90 archivos.
 */
import { useMemo, useState } from "react";
import {
  useCategoriasEtiqueta,
  detectarCategoriaEn,
  CATEGORIAS_ETIQUETA,
} from "../../lib/categoriasEtiqueta";
import {
  LightboxImagen,
  MiniaturaRecursoPng,
  codificarRutaRecursoPng,
  labelFormatoPng,
} from "../etiquetas/RecursoPngViewer";
import { resolverUrlImagenCanvas } from "../../lib/plantillasVisualesImagen";
import { descargarBlob } from "../../lib/etiquetaAssets";
import { useEtiquetasStudio, type EtiquetaStudioPng } from "./studioEtiquetasData";
import { useFichasEtiquetaGuardadas } from "../../lib/etiquetasFichas";
import { esIdPlantillaFicha } from "../../lib/categoriasEtiqueta";
import { nombreVisibleEtiqueta } from "./StudioCategoriasPanel";

interface Props {
  /** Categoría a la que se llegó desde una tarjeta; "" = todas. */
  categoriaFiltro?: string;
  onCategoriaFiltroChange?: (id: string) => void;
  /** Abre una etiqueta guardada del formulario, por su id. */
  onAbrirEtiquetaGuardada?: (fichaId: string) => void;
}

export default function StudioEtiquetasPanel({
  categoriaFiltro = "",
  onCategoriaFiltroChange,
  onAbrirEtiquetaGuardada,
}: Props) {
  const { data: cats } = useCategoriasEtiqueta();
  const categorias = Array.isArray(cats) ? cats : CATEGORIAS_ETIQUETA;
  const { data: etiquetas, isLoading } = useEtiquetasStudio();
  const [buscar, setBuscar] = useState("");
  const [vistaPrevia, setVistaPrevia] = useState<string | null>(null);
  const [descargando, setDescargando] = useState(false);

  async function descargar(nombre: string) {
    setDescargando(true);
    try {
      const url = await resolverUrlImagenCanvas(
        `/api/etiquetas/recursos-png/archivo/${codificarRutaRecursoPng(nombre)}`,
      );
      const res = await fetch(url);
      descargarBlob(await res.blob(), nombre.split("/").pop() || nombre);
    } finally {
      setDescargando(false);
    }
  }

  const grupos = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    const porCategoria = new Map<string, EtiquetaStudioPng[]>();
    for (const e of Array.isArray(etiquetas) ? etiquetas : []) {
      const visible = nombreVisibleEtiqueta(e.nombre);
      if (q && !visible.toLowerCase().includes(q)) continue;
      const cat = detectarCategoriaEn(categorias, visible);
      if (categoriaFiltro && cat !== categoriaFiltro) continue;
      const lista = porCategoria.get(cat) ?? [];
      lista.push(e);
      porCategoria.set(cat, lista);
    }
    return categorias.map((c) => ({ categoria: c, items: porCategoria.get(c.id) ?? [] }));
  }, [etiquetas, categorias, buscar, categoriaFiltro]);

  // Las etiquetas guardadas del formulario son etiquetas de un SKU igual que los
  // PNG: se muestran aquí, agrupadas por la misma categoría, en vez de vivir solo
  // dentro de su propia pantalla.
  const { data: fichas } = useFichasEtiquetaGuardadas();
  const guardadasPorCategoria = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    const m = new Map<
      string,
      { id: string; nombre: string; formato: string; actualizado: string }[]
    >();
    for (const f of Array.isArray(fichas) ? fichas : []) {
      if (esIdPlantillaFicha(f.id)) continue;
      if (q && !f.nombre.toLowerCase().includes(q)) continue;
      const cat = f.categoria || detectarCategoriaEn(categorias, f.nombre);
      if (categoriaFiltro && cat !== categoriaFiltro) continue;
      const lista = m.get(cat) ?? [];
      lista.push({
        id: f.id,
        nombre: f.nombre,
        formato: f.tipo_nombre || "",
        actualizado: f.actualizado
          ? new Date(f.actualizado).toLocaleDateString("es-CO", { day: "2-digit", month: "short" })
          : "",
      });
      m.set(cat, lista);
    }
    return m;
  }, [fichas, categorias, buscar, categoriaFiltro]);

  const total = grupos.reduce((n, g) => n + g.items.length, 0);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
          placeholder="Buscar etiqueta…"
          className="w-full max-w-xs rounded-lg border border-border bg-surface px-3 py-2 text-sm"
        />
        {categoriaFiltro && (
          <button
            type="button"
            onClick={() => onCategoriaFiltroChange?.("")}
            className="rounded-lg border border-accent/40 bg-accent/5 px-3 py-2 text-xs font-semibold text-accent hover:bg-accent/10"
          >
            {categorias.find((c) => c.id === categoriaFiltro)?.etiqueta ?? categoriaFiltro} ✕
          </button>
        )}
        <span className="text-xs text-muted">{total} etiqueta{total === 1 ? "" : "s"}</span>
      </div>

      {isLoading && <p className="py-10 text-center text-sm text-muted">Cargando etiquetas…</p>}

      {!isLoading && grupos.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-surface-panel px-8 py-14 text-center">
          <p className="text-sm font-medium text-ink">Todavía no hay etiquetas aquí</p>
          <p className="mt-1 text-sm text-muted">
            Se generan desde la plantilla de una categoría, con «Crear etiquetas».
          </p>
        </div>
      )}

      <div className="space-y-6">
        {grupos.map(({ categoria, items }) => {
          const guardadas = guardadasPorCategoria.get(categoria.id) ?? [];
          if (items.length === 0 && guardadas.length === 0) return null;
          return (
          <section key={categoria.id}>
            <h3 className="mb-2 flex items-baseline gap-2 text-sm font-bold text-ink">
              {categoria.etiqueta}
              <span className="text-[11px] font-normal text-muted">{items.length}</span>
            </h3>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8">
              {items.map((r) => (
                <button
                  key={r.nombre}
                  type="button"
                  onClick={() => setVistaPrevia(r.nombre)}
                  title={r.nombre}
                  className="group flex flex-col overflow-hidden rounded-lg border border-border bg-surface text-left hover:border-accent/50"
                >
                  <span className="flex aspect-square items-center justify-center bg-zinc-100 p-1 dark:bg-zinc-800/40">
                    <MiniaturaRecursoPng nombre={r.nombre} thumbB64={r.thumb_b64} thumbMime={r.thumb_mime} />
                  </span>
                  <span className="block px-1.5 py-1">
                    <span className="block truncate text-[10px] text-ink">
                      {nombreVisibleEtiqueta(r.nombre)}
                    </span>
                    {labelFormatoPng(r) ? (
                      <span className="block truncate text-[9px] text-muted">{labelFormatoPng(r)}</span>
                    ) : null}
                  </span>
                </button>
              ))}
            </div>

            {guardadas.length > 0 && (
              <div className="mt-2 rounded-lg border border-accent/30 bg-accent/5 p-2">
                <p className="mb-1.5 text-[10px] font-semibold text-accent">
                  Editables en el formulario ({guardadas.length})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {guardadas.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => onAbrirEtiquetaGuardada?.(g.id)}
                      title="Abrir esta etiqueta en el formulario"
                      className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-left text-[11px] text-ink hover:border-accent hover:text-accent"
                    >
                      <span className="block max-w-[16rem] truncate font-medium">{g.nombre}</span>
                      <span className="block text-[10px] text-muted">
                        {g.formato || "Sin tamaño"}
                        {g.actualizado ? ` · ${g.actualizado}` : ""}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
          );
        })}
      </div>

      {vistaPrevia && (
        <LightboxImagen
          nombre={vistaPrevia}
          formato={(Array.isArray(etiquetas) ? etiquetas : []).find((e) => e.nombre === vistaPrevia) ?? null}
          onCerrar={() => setVistaPrevia(null)}
          onDescargar={() => void descargar(vistaPrevia)}
          descargando={descargando}
          eliminando={false}
        />
      )}
    </div>
  );
}
