/**
 * Asistente "Nueva plantilla de categoría".
 *
 * Dos pasos, sin preguntar por el motor: se elige la categoría y un diseño de
 * partida, y se marca de una pasada qué cajas de texto cambian por producto.
 * El resultado es la plantilla de esa categoría, lista para "Crear etiquetas".
 *
 * La plantilla es SIEMPRE de lienzo, y no por capricho: es el único motor que
 * genera las etiquetas de muchos SKU de golpe (`aplicar_plantilla_lote`, en el
 * servidor) y el único con ajuste automático caja por caja. El formulario de
 * ficha dibuja en el navegador, una etiqueta a la vez, y por eso dejó de ser una
 * forma de crear plantillas.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import {
  useCategoriasEtiqueta,
  etiquetaCategoriaEn,
  idCategoriaDesdeNombre,
  CATEGORIAS_ETIQUETA,
  type CategoriaEtiqueta,
} from "../../lib/categoriasEtiqueta";
import {
  categoriaProductoDe,
  labelFormato,
  type ElementoTexto,
  type ElementoVisual,
  type PlantillaVisualDoc,
} from "../../lib/plantillasVisuales";
import { CAMPOS_TEXTO_FICHA_MP } from "../../lib/plantillaFichaTecnicaMp";
import PlantillaVisualMiniatura from "./PlantillaVisualMiniatura";

type Paso = "categoria" | "partida" | "campos";

interface Props {
  /** Categoría preseleccionada al entrar desde una tarjeta de la portada. */
  categoriaInicial?: string;
  onVolver: () => void;
  /** Plantilla creada: el panel la abre en el editor para los ajustes finos. */
  onCreada: (doc: PlantillaVisualDoc) => void;
  /** "Lienzo en blanco" delega en el selector de formato que ya existe. */
  onLienzoEnBlanco: (categoriaId: string) => void;
}

function esTexto(el: ElementoVisual): el is ElementoTexto {
  return el.type === "text";
}

export default function NuevaPlantillaCategoriaPanel({
  categoriaInicial = "",
  onVolver,
  onCreada,
  onLienzoEnBlanco,
}: Props) {
  const qc = useQueryClient();
  const { data: catsData } = useCategoriasEtiqueta();
  const categorias = Array.isArray(catsData) ? catsData : CATEGORIAS_ETIQUETA;

  const [paso, setPaso] = useState<Paso>(categoriaInicial ? "partida" : "categoria");
  const [categoriaId, setCategoriaId] = useState(categoriaInicial);
  const [nombreNueva, setNombreNueva] = useState("");
  const [clavesNueva, setClavesNueva] = useState("");
  const [base, setBase] = useState<PlantillaVisualDoc | null>(null);
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [ocultarSiVacio, setOcultarSiVacio] = useState<Record<string, boolean>>({});
  const [buscar, setBuscar] = useState("");
  const [error, setError] = useState<string | null>(null);

  const categoria = categorias.find((c) => c.id === categoriaId) ?? null;

  const { data: plantillasData } = useQuery({
    queryKey: ["plantillas-visuales", "__todas__"],
    queryFn: () => api.get<{ plantillas: PlantillaVisualDoc[] }>("/api/plantillas-visuales?todas=1"),
    staleTime: 15_000,
    gcTime: 60 * 60 * 1000,
  });

  // Se listan TODOS los diseños, con los de la categoría primero y los más
  // recientes arriba. Antes solo salían los de la categoría, y como un diseño
  // recién creado suele clasificar en otra (o en "Otros") hasta que se le fija
  // la categoría, parecía que los nuevos no existían.
  const candidatos = useMemo(() => {
    const todas = plantillasData?.plantillas ?? [];
    const q = buscar.trim().toLowerCase();
    const lista = q
      ? todas.filter((p) => (p.nombre || "").toLowerCase().includes(q))
      : [...todas];
    const puntaje = (p: PlantillaVisualDoc) => {
      if (categoriaProductoDe(p, categorias) !== categoriaId) return 2;
      return p.es_plantilla_categoria ? 0 : 1;
    };
    lista.sort((a, b) => {
      const d = puntaje(a) - puntaje(b);
      if (d !== 0) return d;
      return (b.updated_at || "").localeCompare(a.updated_at || "");
    });
    return lista.slice(0, 80);
  }, [plantillasData, categorias, categoriaId, buscar]);

  const nDeLaCategoria = useMemo(
    () =>
      (plantillasData?.plantillas ?? []).filter(
        (p) => categoriaProductoDe(p, categorias) === categoriaId,
      ).length,
    [plantillasData, categorias, categoriaId],
  );

  const guardarCategoriasMut = useMutation({
    mutationFn: (lista: CategoriaEtiqueta[]) =>
      api.put<{ categorias: CategoriaEtiqueta[] }>("/api/etiquetas/categorias", { categorias: lista }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["etiquetas-categorias"] }),
  });

  const guardarPlantillaMut = useMutation({
    mutationFn: (doc: PlantillaVisualDoc) =>
      api.post<{ plantilla: PlantillaVisualDoc }>("/api/plantillas-visuales", doc),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["plantillas-visuales"] });
      onCreada(res.plantilla);
    },
    onError: (e: Error) => setError(e.message || "No se pudo guardar la plantilla"),
  });

  function crearCategoria() {
    const nombre = nombreNueva.trim();
    if (!nombre) return;
    const id = idCategoriaDesdeNombre(nombre);
    if (categorias.some((c) => c.id === id)) {
      setError(`Ya existe una categoría «${nombre}»`);
      return;
    }
    const claves = clavesNueva
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    const nueva: CategoriaEtiqueta = { id, etiqueta: nombre, claves };
    // Las nuevas van antes de "Otros", que es el respaldo y no debe capturar nada.
    const sinOtros = categorias.filter((c) => c.id !== "otros");
    const otros = categorias.filter((c) => c.id === "otros");
    setError(null);
    guardarCategoriasMut.mutate([...sinOtros, nueva, ...otros], {
      onSuccess: () => {
        setCategoriaId(id);
        setNombreNueva("");
        setClavesNueva("");
        setPaso("partida");
      },
    });
  }

  function elegirBase(doc: PlantillaVisualDoc) {
    setBase(doc);
    const iniciales: Record<string, string> = {};
    for (const el of doc.elementos || []) {
      if (esTexto(el) && el.campoProducto) iniciales[el.id] = el.campoProducto;
    }
    setCampos(iniciales);
    setOcultarSiVacio({});
    setPaso("campos");
  }

  function guardar() {
    if (!base || !categoria) return;
    const elementos = (base.elementos || []).map((el) => {
      if (!esTexto(el)) return el;
      const campo = campos[el.id];
      if (!campo) {
        const { campoProducto: _quitar, ...resto } = el;
        return resto as ElementoVisual;
      }
      return {
        ...el,
        campoProducto: campo,
        // Igual que el editor: un campo variable siempre lleva autofit, o el
        // texto de un producto largo se sale de la caja.
        autofit: true,
        ...(ocultarSiVacio[el.id] ? { ocultarSiVacio: true } : {}),
      } as ElementoVisual;
    });
    const doc: PlantillaVisualDoc = {
      ...base,
      id: "",
      nombre: `Plantilla · ${categoria.etiqueta}`,
      categoria_producto: categoria.id,
      es_plantilla_categoria: true,
      formulario: true,
      elementos,
      created_at: undefined,
      updated_at: undefined,
    };
    setError(null);
    guardarPlantillaMut.mutate(doc);
  }

  const textos = (base?.elementos || []).filter(esTexto);
  const marcados = Object.values(campos).filter(Boolean).length;

  return (
    <div className="mx-auto flex h-full max-w-5xl min-h-0 flex-col overflow-auto p-1">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onVolver}
          className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-surface-hover hover:text-ink"
        >
          ← Volver
        </button>
        <h2 className="text-base font-bold text-ink">Nueva plantilla de categoría</h2>
        <span className="text-[11px] text-muted">
          {["1. Categoría", "2. Punto de partida", "3. Campos variables"][
            paso === "categoria" ? 0 : paso === "partida" ? 1 : 2
          ]}
          {categoria ? ` · ${categoria.etiqueta}` : ""}
        </span>
      </header>

      {error && (
        <p className="mb-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      {paso === "categoria" && (
        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-xl border border-border bg-surface-panel p-4">
            <h3 className="mb-1 text-sm font-bold text-ink">Elegir una categoría</h3>
            <p className="mb-3 text-[11px] text-muted">
              Cada categoría tiene una sola plantilla: la que después genera las etiquetas de
              todos sus productos.
            </p>
            <ul className="max-h-80 space-y-1 overflow-y-auto">
              {categorias.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setCategoriaId(c.id);
                      setPaso("partida");
                    }}
                    className="w-full rounded px-2 py-1.5 text-left text-xs text-ink hover:bg-accent/10"
                  >
                    {c.etiqueta}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-border bg-surface-panel p-4">
            <h3 className="mb-1 text-sm font-bold text-ink">…o crear una nueva</h3>
            <p className="mb-3 text-[11px] text-muted">
              Las palabras clave sirven para reconocer sola la categoría de un producto por su
              nombre. Sepáralas con comas; puedes dejarlas vacías.
            </p>
            <input
              value={nombreNueva}
              onChange={(e) => setNombreNueva(e.target.value)}
              placeholder="Nombre de la categoría (ej. Sales de baño)"
              className="mb-2 w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs"
            />
            <input
              value={clavesNueva}
              onChange={(e) => setClavesNueva(e.target.value)}
              placeholder="Palabras clave: sal de baño, epsom, efervescente"
              className="mb-3 w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs"
            />
            <button
              type="button"
              onClick={crearCategoria}
              disabled={!nombreNueva.trim() || guardarCategoriasMut.isPending}
              className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40"
            >
              {guardarCategoriasMut.isPending ? "Creando…" : "Crear categoría y continuar"}
            </button>
          </section>
        </div>
      )}

      {paso === "partida" && (
        <div>
          <div className="mb-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setPaso("categoria")}
              className="rounded-lg px-3 py-2 text-xs text-muted hover:bg-surface-hover"
            >
              Cambiar categoría
            </button>
          </div>

          <p className="mb-2 text-xs text-muted">
            Elige el diseño del que parte la plantilla
            {categoria ? ` de «${categoria.etiqueta}»` : ""}: en el paso siguiente le marcas
            qué cambia por producto. El diseño original no se toca, se duplica.
            {categoria
              ? ` Primero los ${nDeLaCategoria} de esta categoría; debajo, el resto del catálogo.`
              : ""}
          </p>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              value={buscar}
              onChange={(e) => setBuscar(e.target.value)}
              placeholder="Buscar en todos los diseños…"
              className="w-full max-w-sm rounded-lg border border-border bg-surface px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={() => onLienzoEnBlanco(categoriaId)}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-ink-secondary hover:bg-surface-hover"
            >
              Empezar desde cero
            </button>
          </div>

          {candidatos.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
              <p className="text-sm text-muted">
                Esta categoría todavía no tiene diseños. Busca uno de otra categoría para
                partir de él, o empieza el lienzo desde cero.
              </p>
              <button
                type="button"
                onClick={() => onLienzoEnBlanco(categoriaId)}
                className="mt-3 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
              >
                Empezar desde cero
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
              {candidatos.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => elegirBase(p)}
                  className="overflow-hidden rounded-xl border border-border bg-surface-panel text-left hover:border-accent"
                >
                  <span className="flex min-h-[110px] items-center justify-center bg-[#525659] p-3">
                    <PlantillaVisualMiniatura doc={p} maxAncho={130} maxAlto={90} />
                  </span>
                  <span className="block truncate px-2 py-1.5 text-[11px] font-medium text-ink">
                    {p.nombre}
                  </span>
                  <span className="block truncate px-2 pb-1.5 text-[10px] text-muted">
                    {p.formato ? labelFormato(p.formato) : "Sin tamaño"}
                    {categoriaProductoDe(p, categorias) !== categoriaId
                      ? ` · ${etiquetaCategoriaEn(categorias, categoriaProductoDe(p, categorias))}`
                      : ""}
                    {p.es_plantilla_categoria ? " ★" : ""}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {paso === "campos" && base && (
        <div className="grid gap-4 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          <section className="rounded-xl border border-border bg-surface-panel p-3">
            <div className="flex min-h-[200px] items-center justify-center rounded-lg bg-[#525659] p-3">
              <PlantillaVisualMiniatura doc={base} maxAncho={280} maxAlto={200} />
            </div>
            <p className="mt-2 text-[11px] text-muted">
              Base: <span className="font-medium text-ink">{base.nombre}</span>
            </p>
            <button
              type="button"
              onClick={() => setPaso("partida")}
              className="mt-2 rounded-lg px-2 py-1 text-[11px] text-muted hover:bg-surface-hover"
            >
              Elegir otro diseño
            </button>
          </section>

          <section className="rounded-xl border border-border bg-surface-panel p-4">
            <h3 className="text-sm font-bold text-ink">¿Qué cambia en cada producto?</h3>
            <p className="mb-3 text-[11px] text-muted">
              Marca qué dato alimenta cada caja de texto. Lo que dejes sin marcar es fijo de la
              categoría (marca, contacto, advertencias) y no se toca al generar etiquetas.
            </p>

            {textos.length === 0 && (
              <p className="text-xs text-muted">Este diseño no tiene cajas de texto.</p>
            )}

            <ul className="max-h-[46vh] space-y-2 overflow-y-auto pr-1">
              {textos.map((el) => (
                <li key={el.id} className="rounded-lg border border-border p-2">
                  <p className="mb-1 truncate text-[11px] text-ink" title={el.content}>
                    {el.content?.trim() || <span className="text-muted">(vacío)</span>}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={campos[el.id] ?? ""}
                      onChange={(e) =>
                        setCampos((prev) => ({ ...prev, [el.id]: e.target.value }))
                      }
                      className="min-w-[10rem] flex-1 rounded border border-border bg-surface px-2 py-1 text-[11px] text-ink"
                    >
                      <option value="">Fijo (no cambia)</option>
                      {CAMPOS_TEXTO_FICHA_MP.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    {campos[el.id] && (
                      <label className="flex items-center gap-1 text-[10px] text-muted">
                        <input
                          type="checkbox"
                          checked={Boolean(ocultarSiVacio[el.id])}
                          onChange={(e) =>
                            setOcultarSiVacio((prev) => ({ ...prev, [el.id]: e.target.checked }))
                          }
                        />
                        Ocultar si el producto no lo tiene
                      </label>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={guardar}
                disabled={marcados === 0 || guardarPlantillaMut.isPending}
                title={marcados === 0 ? "Marca al menos un campo variable" : undefined}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
              >
                {guardarPlantillaMut.isPending ? "Guardando…" : "Guardar plantilla"}
              </button>
              <span className="text-[11px] text-muted">
                {marcados} campo{marcados === 1 ? "" : "s"} variable{marcados === 1 ? "" : "s"}
                {marcados === 0 ? " — marca al menos uno para poder generar etiquetas" : ""}
              </span>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
