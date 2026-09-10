/**
 * Portada de Studio visual: una tarjeta por categoría de producto.
 *
 * Antes esta pantalla abría con la biblioteca de imágenes (los logos primero y
 * las etiquetas debajo), que no es la unidad de trabajo de nadie. La unidad es
 * la categoría: tiene su plantilla, sus diseños de partida y las etiquetas ya
 * hechas con ella.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import {
  useCategoriasEtiqueta,
  detectarCategoriaEn,
  esIdPlantillaFicha,
  idCategoriaDesdeNombre,
  CATEGORIAS_ETIQUETA,
  type CategoriaEtiqueta,
} from "../../lib/categoriasEtiqueta";
import { categoriaProductoDe, type PlantillaVisualDoc } from "../../lib/plantillasVisuales";
import { useFichasEtiquetaGuardadas } from "../../lib/etiquetasFichas";
import PlantillaVisualMiniatura from "./PlantillaVisualMiniatura";
import {
  CARPETA_ETIQUETAS_STUDIO,
  categoriaDeRutaEtiqueta,
  useEtiquetasStudio,
  type EtiquetaStudioPng,
} from "./studioEtiquetasData";

/** Una plantilla de categoría: el formato que se despliega sobre todos los
 *  productos de la familia.
 *
 *  Puede venir de los dos motores, y ambos generan etiquetas en lote:
 *  - `lienzo`: render en servidor (`aplicar_plantilla_lote`), disposición libre.
 *  - `ficha`: render en el navegador, una a una, desde el formulario.
 *
 *  No cuentan las "plantillas" viejas del formulario que solo guardaban campos
 *  fijos de marca (`__plantilla__:<categoría>`): esas no generaban nada y por eso
 *  se dejaron de mostrar. Cuenta una etiqueta marcada con
 *  `es_plantilla_categoria`, que sí es un formato terminado. */
export interface PlantillaDeCategoria {
  motor: "lienzo" | "ficha";
  id: string;
  nombre: string;
  /** Tamaño de etiqueta: una categoría puede tener una plantilla por formato. */
  formato: string;
  /** Solo en las de lienzo. */
  doc?: PlantillaVisualDoc;
}

/** Una etiqueta hecha con la plantilla de la categoría. */
export interface EtiquetaDeCategoria {
  clave: string;
  nombre: string;
  detalle: string;
  /** PNG terminado en la biblioteca; sin esto, es una etiqueta aún editable. */
  png?: EtiquetaStudioPng;
  /** Etiqueta guardada del formulario, todavía editable. */
  fichaId?: string;
}

export interface ResumenCategoria {
  categoria: CategoriaEtiqueta;
  plantillas: PlantillaDeCategoria[];
  disenos: PlantillaVisualDoc[];
  /** Solo las hechas con la plantilla: las 90 sueltas del catálogo viejo no cuentan. */
  etiquetas: EtiquetaDeCategoria[];
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
  const { data: fichas } = useFichasEtiquetaGuardadas();

  const resumen = useMemo<ResumenCategoria[]>(() => {
    const plantillas = plantillasData?.plantillas ?? [];
    const porCategoria = new Map<string, PlantillaVisualDoc[]>();
    for (const p of plantillas) {
      const cat = categoriaProductoDe(p, categorias);
      const lista = porCategoria.get(cat) ?? [];
      lista.push(p);
      porCategoria.set(cat, lista);
    }
    // Etiquetas de la categoría = las generadas con su plantilla. Se reconocen
    // por vivir en ETIQUETAS STUDIO/<Categoría>/ (las 90 sueltas en la raíz son
    // el catálogo viejo y quedan fuera de este apartado), más las etiquetas del
    // formulario que aún están en edición.
    const etiquetasPorCategoria = new Map<string, EtiquetaDeCategoria[]>();
    const push = (cat: string, item: EtiquetaDeCategoria) => {
      const lista = etiquetasPorCategoria.get(cat) ?? [];
      lista.push(item);
      etiquetasPorCategoria.set(cat, lista);
    };
    for (const e of Array.isArray(etiquetas) ? etiquetas : []) {
      const cat = categoriaDeRutaEtiqueta(e.nombre, categorias);
      if (!cat) continue;
      push(cat, {
        clave: `png:${e.nombre}`,
        nombre: nombreVisibleEtiqueta(e.nombre),
        detalle: e.tipo_etiqueta || "",
        png: e,
      });
    }
    for (const f of Array.isArray(fichas) ? fichas : []) {
      // Cualquier etiqueta del formulario con categoría, salvo las plantillas y
      // los restos del mecanismo viejo (`__plantilla__*`). No se exige
      // `plantilla_id` a propósito: exigirlo escondía lo recién creado antes de
      // que ese campo existiera.
      if (f.es_plantilla_categoria || !f.categoria || esIdPlantillaFicha(f.id)) continue;
      push(f.categoria, {
        clave: `ficha:${f.id}`,
        nombre: f.nombre,
        detalle: `${f.tipo_nombre || ""}${f.tipo_nombre ? " · " : ""}en edición`,
        fichaId: f.id,
      });
    }
    // Etiquetas del formulario marcadas como plantilla de su categoría.
    const fichasPlantilla = new Map<string, PlantillaDeCategoria[]>();
    for (const f of Array.isArray(fichas) ? fichas : []) {
      if (!f.es_plantilla_categoria) continue;
      const cat = f.categoria || detectarCategoriaEn(categorias, f.nombre);
      const lista = fichasPlantilla.get(cat) ?? [];
      lista.push({
        motor: "ficha",
        id: f.id,
        nombre: f.nombre,
        formato: f.tipo_nombre || "Sin tamaño",
      });
      fichasPlantilla.set(cat, lista);
    }
    return categorias.map((categoria) => {
      const disenos = porCategoria.get(categoria.id) ?? [];
      const deLienzo: PlantillaDeCategoria[] = disenos
        .filter((d) => d.es_plantilla_categoria)
        .map((d) => ({
          motor: "lienzo" as const,
          id: d.id,
          nombre: d.nombre,
          formato: d.formato?.nombre || "Sin tamaño",
          doc: d,
        }));
      return {
        categoria,
        plantillas: [...deLienzo, ...(fichasPlantilla.get(categoria.id) ?? [])],
        disenos,
        etiquetas: etiquetasPorCategoria.get(categoria.id) ?? [],
      };
    });
  }, [plantillasData, etiquetas, fichas, categorias]);

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
  /** Primera plantilla de una categoría (pide el tamaño). */
  onCrearPlantilla: (categoriaId: string) => void;
  /** Otra plantilla de la misma categoría, para otro tamaño. */
  onOtroTamano: (categoriaId: string) => void;
  /** Abrir la plantilla para ajustarla. */
  onAbrirPlantilla: (p: PlantillaDeCategoria) => void;
  /** Nueva etiqueta de un producto a partir de una plantilla de la categoría. */
  onNuevaEtiqueta: (p: PlantillaDeCategoria) => void;
  /** Abrir una etiqueta ya hecha de la categoría. */
  onAbrirEtiqueta: (e: EtiquetaDeCategoria) => void;
}

export default function StudioCategoriasPanel({
  onCrearPlantilla,
  onOtroTamano,
  onAbrirPlantilla,
  onNuevaEtiqueta,
  onAbrirEtiqueta,
}: Props) {
  const { resumen, categorias, cargando } = useResumenCategorias();
  const qc = useQueryClient();
  const [creandoCat, setCreandoCat] = useState(false);
  const [nombreCat, setNombreCat] = useState("");
  const [clavesCat, setClavesCat] = useState("");
  const [errorCat, setErrorCat] = useState<string | null>(null);

  const guardarCategoriasMut = useMutation({
    mutationFn: (lista: CategoriaEtiqueta[]) =>
      api.put<{ categorias: CategoriaEtiqueta[] }>("/api/etiquetas/categorias", { categorias: lista }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["etiquetas-categorias"] });
      setCreandoCat(false);
      setNombreCat("");
      setClavesCat("");
    },
    onError: (e: Error) => setErrorCat(e.message || "No se pudo crear la categoría"),
  });

  function crearCategoria() {
    const nombre = nombreCat.trim();
    if (!nombre) return;
    const id = idCategoriaDesdeNombre(nombre);
    if (categorias.some((c) => c.id === id)) {
      setErrorCat(`Ya existe una categoría «${nombre}»`);
      return;
    }
    setErrorCat(null);
    const nueva: CategoriaEtiqueta = {
      id,
      etiqueta: nombre,
      claves: clavesCat.split(",").map((c) => c.trim()).filter(Boolean),
    };
    // "Otros" es el respaldo y va siempre al final: no debe capturar nada antes.
    const sinOtros = categorias.filter((c) => c.id !== "otros");
    const otros = categorias.filter((c) => c.id === "otros");
    guardarCategoriasMut.mutate([...sinOtros, nueva, ...otros]);
  }

  // Primero las que tienen trabajo hecho; las vacías al final, para que la
  // portada no abra con veinte tarjetas en blanco.
  const ordenadas = useMemo(
    () =>
      [...resumen].sort((a, b) => {
        if (a.plantillas.length !== b.plantillas.length) {
          return b.plantillas.length - a.plantillas.length;
        }
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
          Una plantilla es un formulario que sirve para toda una categoría y un tamaño de
          etiqueta. Desde ella se hacen las etiquetas de cada producto, que quedan en{" "}
          <span className="font-medium text-ink">{CARPETA_ETIQUETAS_STUDIO}</span> y se
          imprimen desde Diseño → Imprimir.
        </p>
        <button
          type="button"
          onClick={() => setCreandoCat((v) => !v)}
          className="shrink-0 rounded-lg border border-accent/40 px-3 py-2 text-sm font-semibold text-accent hover:bg-accent/10"
        >
          {creandoCat ? "Cancelar" : "+ Categoría"}
        </button>
      </div>

      {creandoCat && (
        <div className="mb-4 rounded-xl border border-border bg-surface-panel p-3">
          <div className="flex flex-wrap gap-2">
            <input
              autoFocus
              value={nombreCat}
              onChange={(e) => setNombreCat(e.target.value)}
              placeholder="Nombre (ej. Sales de baño)"
              className="min-w-[12rem] flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs"
            />
            <input
              value={clavesCat}
              onChange={(e) => setClavesCat(e.target.value)}
              placeholder="Palabras clave, separadas por comas (opcional)"
              className="min-w-[14rem] flex-[2] rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs"
            />
            <button
              type="button"
              onClick={crearCategoria}
              disabled={!nombreCat.trim() || guardarCategoriasMut.isPending}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40"
            >
              {guardarCategoriasMut.isPending ? "Creando…" : "Crear"}
            </button>
          </div>
          <p className="mt-1 text-[10px] text-muted">
            Las palabras clave sirven para reconocer sola la categoría de un producto por su nombre.
          </p>
          {errorCat && <p className="mt-1 text-[11px] text-danger">{errorCat}</p>}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ordenadas.map(({ categoria, plantillas, etiquetas }) => {
          const principal = plantillas[0] ?? null;
          return (
            <article
              key={categoria.id}
              className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface-panel"
            >
              <div className="flex min-h-[110px] items-center justify-center bg-[#525659] p-3">
                {principal?.doc ? (
                  <PlantillaVisualMiniatura doc={principal.doc} maxAncho={150} maxAlto={104} />
                ) : principal ? (
                  <p className="px-3 text-center text-[11px] text-white/80">
                    {plantillas.length} plantilla{plantillas.length === 1 ? "" : "s"}
                    <br />
                    <span className="text-white/50">
                      {plantillas.map((p) => p.formato).join(" · ")}
                    </span>
                  </p>
                ) : (
                  <p className="px-3 text-center text-[11px] text-white/70">
                    Sin plantilla todavía
                  </p>
                )}
              </div>

              <div className="flex flex-1 flex-col gap-2 px-3 py-2.5">
                <h3 className="truncate text-sm font-semibold text-ink" title={categoria.etiqueta}>
                  {categoria.etiqueta}
                </h3>

                {/* Una plantilla por tamaño. El chip abre la plantilla para ajustarla;
                    hacer una etiqueta de un producto va por el botón de abajo. */}
                {plantillas.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {plantillas.map((p) => (
                      <button
                        key={`${p.motor}:${p.id}`}
                        type="button"
                        onClick={() => onAbrirPlantilla(p)}
                        title={`Ajustar ${p.nombre}`}
                        className="rounded-full border border-accent/40 bg-accent/5 px-2 py-0.5 text-[10px] font-semibold text-accent hover:bg-accent/15"
                      >
                        {p.formato}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-muted">
                    Aún no hay un formulario para esta familia de productos.
                  </p>
                )}

                {plantillas.length > 0 && (
                  <div className="rounded-lg border border-border bg-surface p-2">
                    <p className="mb-1 text-[10px] font-semibold text-ink-secondary">
                      Etiquetas de esta categoría ({etiquetas.length})
                    </p>
                    {etiquetas.length === 0 ? (
                      <p className="text-[10px] text-muted">
                        Todavía ninguna. Usa «Nueva etiqueta» para hacer la primera.
                      </p>
                    ) : (
                      <ul className="max-h-32 space-y-0.5 overflow-y-auto">
                        {etiquetas.map((e) => (
                          <li key={e.clave}>
                            <button
                              type="button"
                              onClick={() => onAbrirEtiqueta(e)}
                              title={e.nombre}
                              className="flex w-full items-baseline gap-1.5 rounded px-1 py-0.5 text-left hover:bg-surface-hover"
                            >
                              <span className="min-w-0 flex-1 truncate text-[11px] text-ink">
                                {e.nombre}
                              </span>
                              {e.detalle && (
                                <span className="shrink-0 text-[9px] text-muted">{e.detalle}</span>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                  {plantillas.length === 0 ? (
                    <button
                      type="button"
                      onClick={() => onCrearPlantilla(categoria.id)}
                      className="rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                    >
                      Crear plantilla
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => onNuevaEtiqueta(principal!)}
                        className="rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                      >
                        Nueva etiqueta
                      </button>
                      <button
                        type="button"
                        onClick={() => onOtroTamano(categoria.id)}
                        title="Otra plantilla de esta categoría, para otro tamaño de etiqueta"
                        className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-ink-secondary hover:bg-surface-hover"
                      >
                        + tamaño
                      </button>
                    </>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
