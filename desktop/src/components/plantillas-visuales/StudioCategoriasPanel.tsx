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
import { categoriaProductoDe, labelFormato, type PlantillaVisualDoc } from "../../lib/plantillasVisuales";
import { etiquetaTamanoFormato, etiquetaTamanoTipoNombre, useTiposEtiqueta } from "../../lib/etiquetasTipos";
import { useFichasEtiquetaGuardadas } from "../../lib/etiquetasFichas";
import PlantillaVisualMiniatura from "./PlantillaVisualMiniatura";
import {
  CARPETA_ETIQUETAS_STUDIO,
  categoriaDeRutaEtiqueta,
  coincideBusqueda,
  normalizarBusqueda,
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
  const { data: tiposData } = useTiposEtiqueta();

  const resumen = useMemo<ResumenCategoria[]>(() => {
    const tiposEt = tiposData?.tipos ?? [];
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
        detalle:
          e.ancho_mm && e.alto_mm
            ? etiquetaTamanoFormato(e.tipo_etiqueta, e.ancho_mm, e.alto_mm)
            : etiquetaTamanoTipoNombre(e.tipo_etiqueta, tiposEt),
        png: e,
      });
    }
    for (const f of Array.isArray(fichas) ? fichas : []) {
      // Cualquier etiqueta del formulario con categoría, salvo las plantillas y
      // los restos del mecanismo viejo (`__plantilla__*`). No se exige
      // `plantilla_id` a propósito: exigirlo escondía lo recién creado antes de
      // que ese campo existiera.
      if (f.es_plantilla_categoria || !f.categoria || esIdPlantillaFicha(f.id)) continue;
      const tam = etiquetaTamanoTipoNombre(f.tipo_nombre, tiposEt);
      push(f.categoria, {
        clave: `ficha:${f.id}`,
        nombre: f.nombre,
        detalle: `${tam}${tam ? " · " : ""}en edición`,
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
        formato: etiquetaTamanoTipoNombre(f.tipo_nombre, tiposEt) || "Sin tamaño",
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
          formato: d.formato ? labelFormato(d.formato) : "Sin tamaño",
          doc: d,
        }));
      return {
        categoria,
        plantillas: [...deLienzo, ...(fichasPlantilla.get(categoria.id) ?? [])],
        disenos,
        etiquetas: etiquetasPorCategoria.get(categoria.id) ?? [],
      };
    });
  }, [plantillasData, etiquetas, fichas, categorias, tiposData]);

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

/** "2.99×2.6 in · 76×66 mm · en edición" → "76×66 mm ✎" (✎ = aún editable). En las listas
 *  el tamaño en pulgadas se comía el espacio y cortaba el dato; el texto completo
 *  sigue en el `title`. */
function tamanoCorto(texto: string): string {
  return (texto || "")
    .replace(/^[\d.,]+\s*[×x]\s*[\d.,]+\s*in\s*·\s*/i, "")
    .replace(/\s*·\s*en edición$/i, " ✎");
}

const CLAVE_CATEGORIA_ABIERTA = "mck-studio-categoria-abierta";

interface Props {
  /** Texto del buscador de Studio: filtra categorías, plantillas y etiquetas. */
  buscar?: string;
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
  buscar = "",
  onCrearPlantilla,
  onOtroTamano,
  onAbrirPlantilla,
  onNuevaEtiqueta,
  onAbrirEtiqueta,
}: Props) {
  const { resumen, categorias, cargando } = useResumenCategorias();
  const qc = useQueryClient();
  // Categoría abierta en el detalle. Se recuerda: al volver de un formulario este
  // panel se monta de nuevo y sin esto siempre reabriría la primera.
  const [selId, setSelId] = useState<string>(() => {
    try {
      return localStorage.getItem(CLAVE_CATEGORIA_ABIERTA) || "";
    } catch {
      return "";
    }
  });
  function elegirCategoria(id: string) {
    setSelId(id);
    setConfirmando(null);
    setEditandoCat(null);
    try {
      localStorage.setItem(CLAVE_CATEGORIA_ABIERTA, id);
    } catch {
      /* sin almacenamiento: solo no se recuerda */
    }
  }
  const [creandoCat, setCreandoCat] = useState(false);
  const [nombreCat, setNombreCat] = useState("");
  const [clavesCat, setClavesCat] = useState("");
  const [errorCat, setErrorCat] = useState<string | null>(null);

  const guardarCategoriasMut = useMutation({
    mutationFn: (lista: CategoriaEtiqueta[]) =>
      api.put<{ categorias: CategoriaEtiqueta[] }>("/api/etiquetas/categorias", { categorias: lista }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["etiquetas-categorias"] });
    },
    onError: (e: Error) => setErrorCat(e.message || "No se pudo crear la categoría"),
  });

  // ── Editar / eliminar categoría y borrar etiquetas ────────────────────────
  const [editandoCat, setEditandoCat] = useState<string | null>(null);
  const [editNombre, setEditNombre] = useState("");
  const [editClaves, setEditClaves] = useState("");
  /** Confirmación en dos pasos, dentro del panel: el navegador puede tener los
   *  diálogos bloqueados y `confirm()` devolvería false sin avisar. */
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [borrando, setBorrando] = useState<string | null>(null);

  const eliminarFichaMut = useMutation({
    mutationFn: (id: string) => api.delete<{ ok: boolean }>(`/api/etiquetas/fichas/${id}`),
    onSettled: () => {
      setBorrando(null);
      setConfirmando(null);
      void qc.invalidateQueries({ queryKey: ["etiquetas-fichas"] });
    },
  });

  const eliminarPngMut = useMutation({
    mutationFn: (nombre: string) =>
      api.delete<{ ok: boolean }>(
        `/api/etiquetas/recursos-png/${nombre.split("/").map(encodeURIComponent).join("%2F")}`,
      ),
    onSettled: () => {
      setBorrando(null);
      setConfirmando(null);
      void qc.invalidateQueries({ queryKey: ["etiquetas-recursos-png"] });
      void qc.invalidateQueries({ queryKey: ["etiquetas-studio-catalogo"] });
    },
  });

  function eliminarEtiqueta(e: EtiquetaDeCategoria) {
    setBorrando(e.clave);
    if (e.fichaId) eliminarFichaMut.mutate(e.fichaId);
    else if (e.png) eliminarPngMut.mutate(e.png.nombre);
  }

  function empezarEdicion(cat: CategoriaEtiqueta) {
    setEditandoCat(cat.id);
    setEditNombre(cat.etiqueta);
    setEditClaves((cat.claves || []).join(", "));
    setConfirmando(null);
  }

  function guardarEdicion(catId: string) {
    const nombre = editNombre.trim();
    if (!nombre) return;
    setErrorCat(null);
    guardarCategoriasMut.mutate(
      categorias.map((c) =>
        c.id === catId
          ? {
              ...c,
              etiqueta: nombre,
              claves: editClaves.split(",").map((k) => k.trim()).filter(Boolean),
            }
          : c,
      ),
      { onSuccess: () => setEditandoCat(null) },
    );
  }

  function eliminarCategoria(catId: string) {
    setErrorCat(null);
    setBorrando(`cat:${catId}`);
    guardarCategoriasMut.mutate(
      categorias.filter((c) => c.id !== catId),
      {
        onSettled: () => {
          setBorrando(null);
          setConfirmando(null);
        },
      },
    );
  }

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
    guardarCategoriasMut.mutate([...sinOtros, nueva, ...otros], {
      onSuccess: () => {
        elegirCategoria(id);
        setCreandoCat(false);
        setNombreCat("");
        setClavesCat("");
      },
    });
  }

  // Orden alfabético, que es como se busca en una lista; las que aún no tienen
  // plantilla van al final.
  const ordenadas = useMemo(
    () =>
      [...resumen].sort((a, b) => {
        const vaciaA = a.plantillas.length === 0 ? 1 : 0;
        const vaciaB = b.plantillas.length === 0 ? 1 : 0;
        if (vaciaA !== vaciaB) return vaciaA - vaciaB;
        return a.categoria.etiqueta.localeCompare(b.categoria.etiqueta, "es");
      }),
    [resumen],
  );

  // Buscador: si coincide la categoría (nombre o palabras clave) o una de sus
  // plantillas, la tarjeta sale entera; si solo coinciden etiquetas, la tarjeta
  // muestra únicamente esas.
  const q = normalizarBusqueda(buscar);
  const visibles = useMemo(() => {
    if (!q) return ordenadas;
    const out: ResumenCategoria[] = [];
    for (const r of ordenadas) {
      const porCategoria =
        coincideBusqueda(`${r.categoria.etiqueta} ${(r.categoria.claves || []).join(" ")}`, q) ||
        r.plantillas.some((p) => coincideBusqueda(`${p.nombre} ${p.formato}`, q));
      if (porCategoria) {
        out.push(r);
        continue;
      }
      const etiquetas = r.etiquetas.filter((e) => coincideBusqueda(`${e.nombre} ${e.detalle}`, q));
      if (etiquetas.length > 0) out.push({ ...r, etiquetas });
    }
    return out;
  }, [ordenadas, q]);

  if (cargando) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  const sel = visibles.find((r) => r.categoria.id === selId) ?? visibles[0] ?? null;
  // Con el buscador activo `sel.etiquetas` viene filtrada; los avisos cuentan todas.
  const totalEtiquetasSel = sel
    ? (resumen.find((r) => r.categoria.id === sel.categoria.id)?.etiquetas.length ?? sel.etiquetas.length)
    : 0;

  return (
    // Lista + detalle: las categorías caben todas a la izquierda y a la derecha
    // se ve solo la elegida. La portada anterior (una tarjeta alta por categoría)
    // pedía 3,4 pantallas de scroll y una lista con scroll propio en cada tarjeta.
    <div className="lg:grid lg:grid-cols-[15.5rem_minmax(0,1fr)] lg:items-start lg:gap-4">
      <nav className="mb-3 lg:sticky lg:top-0 lg:mb-0" aria-label="Categorías de producto">
        <div className="mb-1.5 flex items-center gap-2">
          <p className="min-w-0 flex-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
            Categorías ({q ? `${visibles.length} de ${ordenadas.length}` : ordenadas.length})
          </p>
          <button
            type="button"
            onClick={() => setCreandoCat((v) => !v)}
            className="shrink-0 rounded-lg border border-accent/40 px-2 py-1 text-[11px] font-semibold text-accent hover:bg-accent/10"
          >
            {creandoCat ? "Cancelar" : "+ Categoría"}
          </button>
        </div>
        {/* En pantallas angostas la lista es una tira horizontal: no empuja el detalle hacia abajo. */}
        <ul className="flex gap-1 overflow-x-auto pb-1 lg:max-h-[calc(100dvh-13.5rem)] lg:flex-col lg:gap-0.5 lg:overflow-y-auto lg:overflow-x-hidden lg:pb-0 lg:pr-1">
          {visibles.map((r) => {
            const activa = sel?.categoria.id === r.categoria.id;
            return (
              <li key={r.categoria.id} className="shrink-0 lg:shrink">
                <button
                  type="button"
                  onClick={() => elegirCategoria(r.categoria.id)}
                  aria-current={activa ? "true" : undefined}
                  title={r.categoria.etiqueta}
                  className={`flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-left text-xs transition lg:whitespace-normal ${
                    activa
                      ? "bg-accent font-semibold text-white"
                      : "border border-border text-ink hover:bg-surface-hover lg:border-transparent"
                  }`}
                >
                  <span className="min-w-0 flex-1 lg:truncate">{r.categoria.etiqueta}</span>
                  {r.plantillas.length === 0 ? (
                    <span className={`shrink-0 text-[10px] ${activa ? "text-white/70" : "text-muted"}`}>
                      sin plantilla
                    </span>
                  ) : (
                    <span
                      className={`shrink-0 rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${
                        activa ? "bg-white/20 text-white" : "bg-surface-hover text-ink-secondary"
                      }`}
                      title={`${r.etiquetas.length} etiqueta(s) · ${r.plantillas.length} plantilla(s)`}
                    >
                      {r.etiquetas.length}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="min-w-0">
        {creandoCat && (
          <div className="mb-3 rounded-xl border border-border bg-surface-panel p-3">
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

        {!sel && (
          <p className="py-10 text-center text-sm text-muted">
            {q
              ? `Ninguna categoría, plantilla ni etiqueta coincide con «${buscar.trim()}».`
              : "Todavía no hay categorías. Crea la primera con «+ Categoría»."}
          </p>
        )}

        {sel && (
          <section className="rounded-xl border border-border bg-surface-panel p-3 sm:p-4">
            {editandoCat === sel.categoria.id ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <input
                  autoFocus
                  value={editNombre}
                  onChange={(e) => setEditNombre(e.target.value)}
                  placeholder="Nombre de la categoría"
                  className="min-w-[10rem] flex-1 rounded border border-border bg-surface px-2 py-1 text-sm"
                />
                <input
                  value={editClaves}
                  onChange={(e) => setEditClaves(e.target.value)}
                  placeholder="Palabras clave, separadas por comas"
                  className="min-w-[14rem] flex-[2] rounded border border-border bg-surface px-2 py-1 text-xs"
                />
                <button
                  type="button"
                  onClick={() => guardarEdicion(sel.categoria.id)}
                  disabled={!editNombre.trim() || guardarCategoriasMut.isPending}
                  className="rounded bg-accent px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-40"
                >
                  Guardar
                </button>
                <button
                  type="button"
                  onClick={() => setEditandoCat(null)}
                  className="rounded border border-border px-2.5 py-1 text-xs text-ink-secondary hover:bg-surface-hover"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h2 className="min-w-0 flex-1 truncate text-base font-bold text-ink" title={sel.categoria.etiqueta}>
                  {sel.categoria.etiqueta}
                </h2>
                {confirmando === `cat:${sel.categoria.id}` ? (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="text-[11px] text-danger">
                      {sel.plantillas.length + totalEtiquetasSel > 0
                        ? `Se queda con ${sel.plantillas.length} plantilla(s) y ${totalEtiquetasSel} etiqueta(s) sin categoría.`
                        : "¿Eliminar la categoría?"}
                    </span>
                    <button
                      type="button"
                      onClick={() => eliminarCategoria(sel.categoria.id)}
                      disabled={borrando === `cat:${sel.categoria.id}`}
                      className="rounded bg-danger px-2 py-1 text-[11px] font-bold text-white disabled:opacity-50"
                    >
                      {borrando === `cat:${sel.categoria.id}` ? "…" : "Sí, eliminar"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmando(null)}
                      className="rounded border border-border px-2 py-1 text-[11px] text-ink-secondary hover:bg-surface-hover"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => empezarEdicion(sel.categoria)}
                      className="rounded-lg border border-border px-2 py-1 text-[11px] text-ink-secondary hover:bg-surface-hover"
                    >
                      ✎ Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmando(`cat:${sel.categoria.id}`)}
                      className="rounded-lg border border-border px-2 py-1 text-[11px] text-ink-secondary hover:bg-red-50 hover:text-red-600"
                    >
                      Eliminar
                    </button>
                  </div>
                )}
              </div>
            )}
            {errorCat && !creandoCat && <p className="mt-1 text-[11px] text-danger">{errorCat}</p>}

            {/* Una plantilla por tamaño: desde cada una se hace la etiqueta de un producto. */}
            <h3 className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted">
              Plantillas por tamaño ({sel.plantillas.length})
            </h3>
            {sel.plantillas.length === 0 ? (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border px-3 py-3">
                <p className="min-w-0 flex-1 text-xs text-muted">
                  Aún no hay un formulario para esta familia de productos. La plantilla sirve para toda
                  la categoría y un tamaño de etiqueta; desde ella se hacen las de cada producto.
                </p>
                <button
                  type="button"
                  onClick={() => onCrearPlantilla(sel.categoria.id)}
                  className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                >
                  Crear plantilla
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {sel.plantillas.map((p) => (
                  <div
                    key={`${p.motor}:${p.id}`}
                    className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-2"
                  >
                    {p.doc && (
                      <span className="flex shrink-0 items-center justify-center rounded bg-[#525659] p-1">
                        <PlantillaVisualMiniatura doc={p.doc} maxAncho={56} maxAlto={40} />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-ink" title={p.formato}>
                        {tamanoCorto(p.formato)}
                      </p>
                      <p className="line-clamp-2 text-[10px] leading-tight text-muted" title={p.nombre}>
                        {p.nombre}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onAbrirPlantilla(p)}
                      title={`Ajustar la plantilla ${p.nombre}`}
                      className="shrink-0 rounded-lg border border-border px-2 py-1 text-[11px] text-ink-secondary hover:bg-surface-hover"
                    >
                      Ajustar
                    </button>
                    <button
                      type="button"
                      onClick={() => onNuevaEtiqueta(p)}
                      title={`Nueva etiqueta de un producto en ${p.formato}`}
                      className="shrink-0 rounded-lg bg-accent px-2 py-1 text-[11px] font-semibold text-white hover:opacity-90"
                    >
                      + Etiqueta
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => onOtroTamano(sel.categoria.id)}
                  title="Otra plantilla de esta categoría, para otro tamaño de etiqueta"
                  className="rounded-lg border border-dashed border-border px-2.5 py-2 text-xs font-semibold text-ink-secondary hover:border-accent/50 hover:text-accent"
                >
                  + Otro tamaño
                </button>
              </div>
            )}

            {sel.plantillas.length > 0 && (
              <>
                <h3 className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Etiquetas (
                  {sel.etiquetas.length < totalEtiquetasSel
                    ? `${sel.etiquetas.length} de ${totalEtiquetasSel}`
                    : sel.etiquetas.length}
                  )
                </h3>
                {totalEtiquetasSel === 0 ? (
                  <p className="text-xs text-muted">
                    Todavía ninguna. Usa «+ Etiqueta» en el tamaño que necesites para hacer la primera.
                  </p>
                ) : (
                  <ul className="grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2 2xl:grid-cols-3">
                    {sel.etiquetas.map((e) => (
                      <li key={e.clave} className="flex min-w-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onAbrirEtiqueta(e)}
                          title={e.detalle ? `${e.nombre} — ${e.detalle}` : e.nombre}
                          className="flex min-w-0 flex-1 items-baseline gap-1.5 rounded px-1.5 py-1 text-left hover:bg-surface-hover"
                        >
                          <span className="min-w-0 flex-1 truncate text-xs text-ink">{e.nombre}</span>
                          {e.detalle && (
                            <span className="max-w-[40%] shrink-0 truncate text-[10px] text-muted">
                              {tamanoCorto(e.detalle)}
                            </span>
                          )}
                        </button>
                        {confirmando === e.clave ? (
                          <span className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={() => eliminarEtiqueta(e)}
                              disabled={borrando === e.clave}
                              className="rounded bg-danger px-1.5 py-0.5 text-[10px] font-bold text-white disabled:opacity-50"
                            >
                              {borrando === e.clave ? "…" : "Eliminar"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmando(null)}
                              className="rounded border border-border px-1 py-0.5 text-[10px] text-ink-secondary hover:bg-surface-hover"
                            >
                              No
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmando(e.clave)}
                            title="Eliminar etiqueta"
                            className="shrink-0 rounded px-1 py-0.5 text-xs text-muted hover:bg-red-50 hover:text-red-600"
                          >
                            ×
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}

            <p className="mt-4 border-t border-border pt-2 text-[10px] text-muted">
              Las etiquetas terminadas quedan en{" "}
              <span className="font-medium text-ink">{CARPETA_ETIQUETAS_STUDIO}</span> y se imprimen
              desde Diseño → Imprimir.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
