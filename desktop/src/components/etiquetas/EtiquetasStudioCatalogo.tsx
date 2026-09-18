import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { ETIQUETAS_GC_TIME } from "../../lib/etiquetasPrefetch";
import {
  targetEscaneoDesdeFila,
  targetEscaneoDesdePlantilla,
  type EscaneoDiagramacionTarget,
  type FormatoImpresionEscaneo,
} from "../../lib/etiquetasStudioHelpers";
import { mmParaTipoEtiqueta, TIPOS_ETIQUETA_DEFAULT } from "../../lib/etiquetasTipos";
import { puedeEliminarPngEtiquetas } from "../../lib/studioVisualAccess";
import {
  useCategoriasEtiqueta,
  etiquetaCategoriaEn,
  CATEGORIAS_ETIQUETA,
  CATEGORIA_ETIQUETA_OTROS,
} from "../../lib/categoriasEtiqueta";
import { useTicketsAuth } from "../../stores/ticketsAuth";
import { resolverUrlImagenCanvas } from "../../lib/plantillasVisualesImagen";
import { descargarBlob } from "../../lib/plantillasVisualesExport";
import { CatalogoDiagramacionScanner } from "./CatalogoDiagramacionScanner";
import { LightboxImagen, MiniaturaRecursoPng, codificarRutaRecursoPng, labelFormatoPng } from "./RecursoPngViewer";
import type { FormatoPngAsociado } from "./RecursoPngViewer";
import {
  SelectorFormatoEtiqueta,
  type FormatoEtiquetaValor,
} from "./SelectorFormatoEtiqueta";
import { Banner, Button, StatTile, FilterChip, Badge } from "./ui";
import { Icon } from "../../icons";

export interface CatalogoStudioFila {
  sku: string;
  nombre: string;
  meli_id?: string | null;
  meli_url?: string | null;
  archivo_ai?: string | null;
  score?: number;
  fuente: "ai" | "svg" | "sin_match";
  studio_guardado?: boolean;
  tipo_etiqueta?: string;
  archivo_ai_manual?: boolean;
  estado_meli_config?: string | null;
}

interface CatalogoStudioResponse {
  filas: CatalogoStudioFila[];
  total: number;
  stats: {
    total_productos: number;
    con_meli: number;
    con_ai: number;
    solo_svg: number;
    sin_match: number;
    studio_guardado: number;
    plantillas_ai_total: number;
    plantillas_ai_sin_producto: number;
    plantillas_png_total?: number;
  };
  plantillas_sin_producto: string[];
  plantillas_png_sin_producto?: Array<string | RecursoPngCatalogo>;
}

export interface RecursoPngCatalogo extends FormatoPngAsociado {
  nombre: string;
  /** Categoría de producto (id de CATEGORIAS_ETIQUETA), resuelta en el servidor
   *  por corrección manual → subcarpeta → nombre del archivo. */
  categoria_producto?: string;
}

function normalizarPngCatalogo(item: string | RecursoPngCatalogo): RecursoPngCatalogo {
  if (typeof item === "string") return { nombre: item };
  return { ...item, nombre: item.nombre || "" };
}

interface PlantillasModeloResponse {
  carpeta: string;
  carpeta_ai?: string;
  carpeta_pdf?: string;
  plantillas_ai: PlantillaModeloFila[];
  plantillas_pdf?: PlantillaModeloFila[];
  plantillas_relacionadas?: PlantillaModeloFila[];
  plantillas_modelo?: PlantillaModeloFila[];
  total_ai: number;
  total_pdf?: number;
  total_relacionadas?: number;
}

export interface PlantillaModeloFila {
  archivo: string;
  archivo_ai?: string;
  archivo_pdf?: string;
  nombre: string;
  formato?: string;
  ruta?: string;
  bytes?: number;
  disponible?: boolean;
  tiene_ai?: boolean;
  tiene_pdf?: boolean;
  tiene_svg?: boolean;
  es_plantilla_base?: boolean;
  ancho_mm?: number;
  alto_mm?: number;
  sku_vinculado?: string;
  producto_vinculado?: string;
}

interface Props {
  onSeleccionar: (fila: CatalogoStudioFila) => void;
  skuActivo?: string;
  accionLabel?: string | null;
  modoSeleccion?: "boton" | "fila";
  mostrarPlantillasSinProducto?: boolean;
  modoEscaneo?: boolean;
  skuEscaneoInicial?: string;
  onModoEscaneoChange?: (activo: boolean) => void;
  /** workbench = catálogo compacto + lienzo lado a lado */
  layout?: "stack" | "workbench";
  mostrarDiagramacion?: boolean;
  /** Preselecciona formato al abrir (p. ej. «500 g»). */
  formatoInicial?: string;
  /** Muestra el catálogo completo Alegra (como Impresión), no solo filas con .ai. */
  catalogoCompleto?: boolean;
  /** Lista archivos .ai de Etiquetas Modelo SVG/ (Studio escaneo). */
  modoModeloSvg?: boolean;
  /** Lista PDF de Etiquetas Modelo SVG/PDF/ (pestaña Plantillas). */
  modoModeloPdf?: boolean;
  /** Lista .ai + PDF relacionados de Etiquetas Modelo SVG/ (pestaña Plantillas). */
  modoModeloRelacionado?: boolean;
  /** Solo biblioteca PNG (sin catálogo SKU / .ai). */
  soloArchivosPng?: boolean;
  /** En modo solo PNG: abre la configuración de impresión inline (sin lightbox). */
  onAbrirPng?: (item: RecursoPngCatalogo) => void;
}

/** Tamaño de las miniaturas de Imprimir (ancho mínimo de tarjeta, en px). */
const TAMANOS_MINIATURA = [
  { id: "s", etiqueta: "Pequeñas", minPx: 110 },
  { id: "m", etiqueta: "Medianas", minPx: 160 },
  { id: "l", etiqueta: "Grandes", minPx: 240 },
] as const;
type TamanoMiniatura = (typeof TAMANOS_MINIATURA)[number]["id"];
const LS_TAMANO_MINIATURA = "mck.imprimir.tamanoMiniatura";

function leerTamanoMiniatura(): TamanoMiniatura {
  try {
    const v = window.localStorage.getItem(LS_TAMANO_MINIATURA);
    if (v === "s" || v === "m" || v === "l") return v;
  } catch {
    /* sin localStorage */
  }
  return "m";
}

/** "ETIQUETAS STUDIO/Semillas/MANI_NATURAL_TOSTADO_500g_4.png" → "MANI NATURAL TOSTADO 500g 4" */
function nombreLegiblePng(nombre: string): string {
  const base = nombre.includes("/") ? nombre.split("/").pop() || nombre : nombre;
  return base.replace(/\.(png|jpe?g)$/i, "").replace(/[_]+/g, " ").trim();
}

/** Miniatura que solo pide el archivo cuando la tarjeta se acerca a la pantalla:
 *  la biblioteca pasa de 100 PNG y cada uno se baja completo. */
function MiniaturaPerezosa({ nombre }: { nombre: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((e) => e.isIntersecting)) setVisible(true);
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);
  return (
    <div ref={ref} className="flex h-full w-full items-center justify-center [&>img]:max-h-full [&>img]:max-w-full">
      {visible ? (
        <MiniaturaRecursoPng nombre={nombre} />
      ) : (
        <div className="h-2/3 w-2/3 animate-pulse rounded bg-surface-hover" />
      )}
    </div>
  );
}

function filaTieneAi(f: CatalogoStudioFila): boolean {
  return f.fuente === "ai" && Boolean(f.archivo_ai?.trim());
}

export function EtiquetasStudioCatalogo({
  onSeleccionar,
  skuActivo,
  accionLabel = "Seleccionar",
  modoSeleccion = "boton",
  mostrarPlantillasSinProducto = true,
  modoEscaneo = false,
  skuEscaneoInicial,
  onModoEscaneoChange,
  layout = "stack",
  mostrarDiagramacion = true,
  formatoInicial,
  catalogoCompleto = false,
  modoModeloSvg = false,
  modoModeloPdf = false,
  modoModeloRelacionado = false,
  soloArchivosPng = false,
  onAbrirPng,
}: Props) {
  const workbench = layout === "workbench" && mostrarDiagramacion && !soloArchivosPng;
  const seleccionPorFila = modoSeleccion === "fila" || accionLabel === null;
  const modoListaModelo = modoModeloSvg || modoModeloPdf || modoModeloRelacionado;

  const [buscar, setBuscar] = useState("");
  const [soloConAi, setSoloConAi] = useState(workbench && !catalogoCompleto && !modoListaModelo);
  const [soloConSku, setSoloConSku] = useState(false);
  const [soloConMeli, setSoloConMeli] = useState(false);
  const [escaneoTarget, setEscaneoTarget] = useState<EscaneoDiagramacionTarget | null>(null);
  const [formatoValor, setFormatoValor] = useState<FormatoEtiquetaValor>(() => {
    const nombre = (formatoInicial || "").trim();
    if (!nombre) return { nombre: "", anchoMm: 76, altoMm: 66 };
    const [anchoMm, altoMm] = mmParaTipoEtiqueta(nombre, TIPOS_ETIQUETA_DEFAULT);
    return { nombre, anchoMm, altoMm };
  });
  const [plantillaSueltasAbierto, setPlantillaSueltasAbierto] = useState(false);
  const [plantillaPngAbierto, setPlantillaPngAbierto] = useState(soloArchivosPng);
  const [pngSeleccionados, setPngSeleccionados] = useState<Set<string>>(new Set());
  const [pngEliminandoLote, setPngEliminandoLote] = useState(false);
  const [pngErrorLote, setPngErrorLote] = useState<string | null>(null);
  const [pngVistaPrevia, setPngVistaPrevia] = useState<RecursoPngCatalogo | null>(null);
  const [pngDescargando, setPngDescargando] = useState<string | null>(null);
  const [pngEliminandoUno, setPngEliminandoUno] = useState<string | null>(null);
  // Vista de Imprimir: tamaño de miniatura, filtro de categoría y modo organizar.
  const [tamanoMini, setTamanoMini] = useState<TamanoMiniatura>(leerTamanoMiniatura);
  const [catFiltro, setCatFiltro] = useState("");
  const [organizar, setOrganizar] = useState(false);
  const buscarRef = useRef<HTMLInputElement>(null);

  const qc = useQueryClient();
  const { data: catsData } = useCategoriasEtiqueta();
  const categoriasEtiqueta = Array.isArray(catsData) ? catsData : CATEGORIAS_ETIQUETA;
  const [recategorizando, setRecategorizando] = useState<string | null>(null);

  /** Corrige a mano la categoría de una etiqueta; el servidor la deja fija. */
  const recategorizarPngMut = useMutation({
    mutationFn: (v: { nombre: string; categoria: string }) =>
      api.post<{ ok: boolean }>("/api/etiquetas/recursos-png/categoria", v),
    onSettled: () => {
      setRecategorizando(null);
      void qc.invalidateQueries({ queryKey: ["etiquetas-studio-catalogo"] });
      void qc.invalidateQueries({ queryKey: ["etiquetas-recursos-png"] });
    },
  });
  const ticketsUser = useTicketsAuth((s) => s.user);
  const puedeEliminarPng = puedeEliminarPngEtiquetas(ticketsUser);

  function alternarSeleccionPng(nombre: string) {
    setPngSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(nombre)) next.delete(nombre);
      else next.add(nombre);
      return next;
    });
  }

  const eliminarPngMut = useMutation({
    mutationFn: (nombre: string) =>
      api.delete<{ ok: boolean }>(`/api/etiquetas/recursos-png/${codificarRutaRecursoPng(nombre)}`),
    onMutate: (nombre) => {
      setPngEliminandoUno(nombre);
      setPngErrorLote(null);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["etiquetas-studio-catalogo"] });
      void qc.invalidateQueries({ queryKey: ["etiquetas-recursos-png"] });
    },
    // Sin esto un 403/404 se veía como "no pasó nada" al pulsar eliminar.
    onError: (e: Error) => setPngErrorLote(e.message || "No se pudo eliminar la imagen"),
    onSettled: () => setPngEliminandoUno(null),
  });

  const eliminarPngLoteMut = useMutation({
    mutationFn: (nombres: string[]) =>
      api.post<{ ok: boolean; eliminados: string[]; errores: Record<string, string> }>(
        "/api/etiquetas/recursos-png/eliminar-lote",
        { nombres },
      ),
    onMutate: () => {
      setPngEliminandoLote(true);
      setPngErrorLote(null);
    },
    onSuccess: (res) => {
      setPngSeleccionados((prev) => {
        const next = new Set(prev);
        res.eliminados.forEach((n) => next.delete(n));
        return next;
      });
      const fallidos = Object.keys(res.errores || {});
      if (fallidos.length > 0) {
        setPngErrorLote(`No se pudieron eliminar ${fallidos.length}: ${fallidos.slice(0, 3).join(", ")}${fallidos.length > 3 ? "…" : ""}`);
      }
      void qc.invalidateQueries({ queryKey: ["etiquetas-studio-catalogo"] });
      void qc.invalidateQueries({ queryKey: ["etiquetas-recursos-png"] });
    },
    onError: (e: Error) => setPngErrorLote(e.message || "Error al eliminar las imágenes seleccionadas"),
    onSettled: () => setPngEliminandoLote(false),
  });

  function eliminarPngSeleccionados() {
    const nombres = Array.from(pngSeleccionados);
    if (nombres.length === 0) return;
    if (!window.confirm(`¿Eliminar ${nombres.length} imagen(es) seleccionada(s)?`)) return;
    eliminarPngLoteMut.mutate(nombres);
  }

  async function descargarPng(nombre: string) {
    setPngDescargando(nombre);
    try {
      const url = await resolverUrlImagenCanvas(
        `/api/etiquetas/recursos-png/archivo/${codificarRutaRecursoPng(nombre)}`,
      );
      const res = await fetch(url);
      const blob = await res.blob();
      descargarBlob(blob, nombre.split("/").pop() || nombre);
    } finally {
      setPngDescargando(null);
    }
  }

  const formatoImpresion = useMemo<FormatoImpresionEscaneo | null>(() => {
    const nombre = formatoValor.nombre.trim();
    if (!nombre) return null;
    return { nombre, ancho_mm: formatoValor.anchoMm, alto_mm: formatoValor.altoMm };
  }, [formatoValor]);

  const queryKey = useMemo(
    () => ["etiquetas-studio-catalogo", buscar, soloConAi, soloConMeli],
    [buscar, soloConAi, soloConMeli],
  );

  const queryKeyModelo = useMemo(
    () => [
      "etiquetas-plantillas-modelo",
      modoModeloRelacionado ? "rel" : modoModeloPdf ? "pdf" : "ai",
      buscar,
      soloConSku,
    ],
    [modoModeloRelacionado, modoModeloPdf, buscar, soloConSku],
  );

  const { data: dataModelo, isFetching: fetchingModelo, error: errorModelo } = useQuery({
    queryKey: queryKeyModelo,
    queryFn: () => {
      const p = new URLSearchParams();
      if (buscar.trim()) p.set("q", buscar.trim());
      p.set("incluir_catalogo", "1");
      p.set("limite", "10000");
      if (modoModeloRelacionado) {
        p.set("relacionar", "1");
        p.set("solo_titulo_plantilla", "1");
      } else if (modoModeloPdf) {
        p.set("fuente", "pdf");
      }
      return api.get<PlantillasModeloResponse>(`/api/etiquetas/studio/plantillas?${p.toString()}`);
    },
    enabled: modoListaModelo,
    staleTime: 30_000,
  });

  const { data, isFetching, error } = useQuery({
    queryKey,
    queryFn: () => {
      const p = new URLSearchParams();
      if (buscar.trim()) p.set("q", buscar.trim());
      if (soloConMeli) p.set("solo_con_meli", "1");
      return api.get<CatalogoStudioResponse>(`/api/etiquetas/studio/catalogo?${p.toString()}`);
    },
    staleTime: 20_000,
    gcTime: ETIQUETAS_GC_TIME,
    enabled: !modoListaModelo,
  });

  const plantillasModelo = useMemo(() => {
    const base = modoModeloRelacionado
      ? (dataModelo?.plantillas_relacionadas ?? dataModelo?.plantillas_modelo ?? [])
      : modoModeloPdf
        ? (dataModelo?.plantillas_pdf ?? [])
        : (dataModelo?.plantillas_ai ?? []);
    let list = base;
    if (soloConSku) list = list.filter((p) => Boolean(p.sku_vinculado?.trim()));
    return list;
  }, [
    dataModelo?.plantillas_ai,
    dataModelo?.plantillas_pdf,
    dataModelo?.plantillas_relacionadas,
    modoModeloRelacionado,
    modoModeloPdf,
    soloConSku,
  ]);

  const fetching = modoListaModelo ? fetchingModelo : isFetching;
  const errorActivo = modoListaModelo ? errorModelo : error;

  const filasRaw = data?.filas ?? [];
  const filas = useMemo(
    () => (soloConAi ? filasRaw.filter(filaTieneAi) : filasRaw),
    [filasRaw, soloConAi],
  );
  const stats = data?.stats;
  const escaneoArchivoActivo = escaneoTarget?.archivo_ai ?? null;

  const plantillasSueltasFiltradas = useMemo(() => {
    const list = data?.plantillas_sin_producto ?? [];
    const q = buscar.trim().toLowerCase();
    if (!q) return list;
    return list.filter((a) => a.toLowerCase().includes(q));
  }, [data?.plantillas_sin_producto, buscar]);

  // PNG de la carpeta ETIQUETAS STUDIO (impresión).
  const plantillasPngFiltradas = useMemo(() => {
    let list = (data?.plantillas_png_sin_producto ?? []).map(normalizarPngCatalogo);
    if (soloArchivosPng) {
      const pref = "etiquetas studio/";
      list = list.filter((n) => n.nombre.toLowerCase().replace(/\\/g, "/").startsWith(pref));
    }
    const q = buscar.trim().toLowerCase();
    if (!q) return list;
    return list.filter((a) => {
      const hay = a.nombre.toLowerCase().includes(q);
      const tipo = (a.tipo_etiqueta || "").toLowerCase();
      const mm =
        a.ancho_mm != null && a.alto_mm != null ? `${a.ancho_mm}x${a.alto_mm}` : "";
      return hay || tipo.includes(q) || mm.includes(q);
    });
  }, [data?.plantillas_png_sin_producto, buscar, soloArchivosPng]);

  // Imprimir agrupa por categoría de producto y no solo por tamaño: un mismo
  // producto suele llevar varias etiquetas de tamaños distintos, y buscarlas en
  // una lista plana de 90 archivos no era viable.
  const gruposPng = useMemo(() => {
    const porCategoria = new Map<string, RecursoPngCatalogo[]>();
    for (const item of plantillasPngFiltradas) {
      const cat = item.categoria_producto || CATEGORIA_ETIQUETA_OTROS;
      const lista = porCategoria.get(cat) ?? [];
      lista.push(item);
      porCategoria.set(cat, lista);
    }
    const orden = categoriasEtiqueta.map((c) => c.id);
    return [...porCategoria.entries()]
      .sort((a, b) => {
        const ia = orden.indexOf(a[0]);
        const ib = orden.indexOf(b[0]);
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
      })
      .map(([id, items]) => ({
        id,
        etiqueta: etiquetaCategoriaEn(categoriasEtiqueta, id),
        items,
      }));
  }, [plantillasPngFiltradas, categoriasEtiqueta]);

  useEffect(() => {
    if (buscar.trim() && plantillasSueltasFiltradas.length > 0) {
      setPlantillaSueltasAbierto(true);
    }
  }, [buscar, plantillasSueltasFiltradas.length]);

  useEffect(() => {
    if (buscar.trim() && plantillasPngFiltradas.length > 0) {
      setPlantillaPngAbierto(true);
    }
  }, [buscar, plantillasPngFiltradas.length]);

  useEffect(() => {
    if (!modoEscaneo || !skuEscaneoInicial?.trim() || filasRaw.length === 0) return;
    const fila = filasRaw.find((f) => f.sku === skuEscaneoInicial.trim());
    if (!fila) return;
    const tipo = fila.tipo_etiqueta?.trim();
    if (tipo && !formatoValor.nombre.trim()) {
      const [ancho, alto] = mmParaTipoEtiqueta(tipo, TIPOS_ETIQUETA_DEFAULT);
      setFormatoValor({ nombre: tipo, anchoMm: ancho, altoMm: alto });
      return;
    }
    if (!formatoImpresion || !filaTieneAi(fila)) return;
    setEscaneoTarget(targetEscaneoDesdeFila(fila, formatoImpresion));
    onModoEscaneoChange?.(false);
  }, [modoEscaneo, skuEscaneoInicial, filasRaw, formatoValor.nombre, formatoImpresion, onModoEscaneoChange]);

  function elegirParaEscaneo(fila: CatalogoStudioFila) {
    if (!formatoImpresion || !filaTieneAi(fila)) return;
    setEscaneoTarget(targetEscaneoDesdeFila(fila, formatoImpresion));
  }

  function elegirPlantillaParaEscaneo(archivo: string, extra?: Pick<PlantillaModeloFila, "sku_vinculado" | "producto_vinculado" | "nombre">) {
    if (!formatoImpresion) return;
    const base = targetEscaneoDesdePlantilla(archivo, formatoImpresion);
    setEscaneoTarget({
      ...base,
      sku: extra?.sku_vinculado,
      nombre: extra?.producto_vinculado || extra?.nombre || base.nombre,
    });
    setPlantillaSueltasAbierto(false);
  }

  function elegirModeloParaEscaneo(p: PlantillaModeloFila) {
    elegirPlantillaParaEscaneo(p.archivo, p);
  }

  const conSkuModelo = useMemo(
    () => plantillasModelo.filter((p) => Boolean(p.sku_vinculado?.trim())).length,
    [plantillasModelo],
  );

  const totalModelo = modoModeloRelacionado
    ? (dataModelo?.total_relacionadas ?? plantillasModelo.length)
    : modoModeloPdf
      ? (dataModelo?.total_pdf ?? "—")
      : (dataModelo?.total_ai ?? "—");
  const tituloModelo = modoModeloRelacionado
    ? "Plantillas base"
    : modoModeloPdf
      ? "Modelos PDF"
      : "Modelo SVG";
  const resumenModelo = modoModeloRelacionado
    ? `${totalModelo} tituladas plantilla`
    : `${totalModelo} ${modoModeloPdf ? ".pdf" : ".ai"}`;

  const pasoActual = !formatoImpresion ? 1 : !escaneoTarget ? 2 : 3;

  const listaModeloSvg = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-1.5 border-b border-border p-2">
        <div className="flex items-center justify-between gap-2 text-[10px] text-muted">
          <span className="font-semibold text-ink">{tituloModelo}</span>
          <span>{resumenModelo} · {conSkuModelo} c/SKU</span>
        </div>
        <input
          className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-xs"
          placeholder={modoModeloRelacionado ? "Buscar plantilla…" : `Buscar ${modoModeloPdf ? ".pdf" : ".ai"}…`}
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
        />
        <label className="flex items-center gap-1 text-[10px] text-muted">
          <input type="checkbox" checked={soloConSku} onChange={(e) => setSoloConSku(e.target.checked)} />
          Solo con SKU
          {fetching && <span className="ml-1">…</span>}
        </label>
        {!formatoImpresion && (
          <p className="text-[10px] text-warning">Elige formato arriba</p>
        )}
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto p-1">
        {plantillasModelo.map((p) => {
          const activa = escaneoArchivoActivo === p.archivo;
          return (
            <li key={`${p.archivo}:${p.archivo_ai || ""}`} className="mb-0.5">
              <button
                type="button"
                disabled={!formatoImpresion}
                title={p.sku_vinculado ? `${p.sku_vinculado} · ${p.producto_vinculado || ""}` : p.archivo}
                onClick={() => elegirModeloParaEscaneo(p)}
                className={`w-full truncate rounded px-2 py-1.5 text-left font-mono text-[10px] transition-colors disabled:opacity-40 ${
                  activa
                    ? "bg-accent/15 font-semibold text-accent"
                    : "text-ink hover:bg-surface-hover"
                }`}
              >
                {p.nombre || p.archivo.replace(/^PDF\//i, "")}
                {modoModeloRelacionado && (
                  <span className="ml-1 text-[8px] font-sans text-muted">
                    {p.tiene_svg ? ".svg" : ""}{p.tiene_ai ? ".ai" : ""}{p.tiene_pdf ? " PDF" : ""}
                  </span>
                )}
                {modoModeloRelacionado && (
                  <span className="ml-1 text-[8px] font-sans text-muted">
                    · {p.archivo_ai || p.archivo_pdf || p.archivo}
                  </span>
                )}
                {!modoModeloRelacionado && (
                  <span className="ml-0">{p.archivo.replace(/^PDF\//i, "") !== (p.nombre || "") ? ` · ${p.archivo.replace(/^PDF\//i, "")}` : ""}</span>
                )}
                {p.sku_vinculado && (
                  <span className="ml-1 text-[9px] font-sans text-muted">· {p.sku_vinculado}</span>
                )}
              </button>
            </li>
          );
        })}
        {!fetching && plantillasModelo.length === 0 && (
          <li className="px-2 py-4 text-center text-xs text-muted">Sin coincidencias</li>
        )}
      </ul>
    </div>
  );

  const listaPlantillas = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-2 border-b border-border p-2">
        {catalogoCompleto && stats && (
          <div className="grid grid-cols-3 gap-1 text-center text-[9px]">
            <div className="rounded border border-border bg-surface px-1 py-1">
              <p className="font-bold text-ink">{stats.total_productos}</p>
              <p className="text-muted">SKU</p>
            </div>
            <div className="rounded border border-border bg-surface px-1 py-1">
              <p className="font-bold text-success">{stats.con_ai}</p>
              <p className="text-muted">Con .ai</p>
            </div>
            <div className="rounded border border-border bg-surface px-1 py-1">
              <p className="font-bold text-accent-plum">{stats.plantillas_ai_sin_producto}</p>
              <p className="text-muted">.ai sueltos</p>
            </div>
          </div>
        )}
        <input
          className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs"
          placeholder="Buscar en catálogo: SKU, producto o plantilla .ai…"
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
        />
        <div className="flex flex-wrap gap-2 text-[10px]">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={soloConAi} onChange={(e) => setSoloConAi(e.target.checked)} />
            Solo con .ai
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={soloConMeli} onChange={(e) => setSoloConMeli(e.target.checked)} />
            Con MeLi
          </label>
          {isFetching && <span className="text-muted">…</span>}
          {!isFetching && data && (
            <span className="text-muted">
              {filas.length}{buscar.trim() ? ` / ${data.total}` : ""} en catálogo
            </span>
          )}
        </div>
        {!formatoImpresion && (
          <p className="text-[10px] text-warning">↑ Elige formato arriba primero</p>
        )}
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {buscar.trim() && plantillasSueltasFiltradas.length > 0 && (
          <li className="mb-2">
            <p className="mb-1 px-1 text-[9px] font-bold uppercase tracking-wide text-accent-plum">
              Plantillas .ai sin SKU en catálogo
            </p>
            <ul className="space-y-1">
              {plantillasSueltasFiltradas.map((a) => (
                <li key={`suelta:${a}`}>
                  <button
                    type="button"
                    disabled={!formatoImpresion}
                    onClick={() => elegirPlantillaParaEscaneo(a)}
                    className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      escaneoArchivoActivo === a
                        ? "border-accent-plum bg-accent-plum/10 ring-1 ring-accent-plum/40"
                        : "border-dashed border-accent-plum/40 bg-surface hover:border-accent-plum hover:bg-accent-plum/10"
                    }`}
                  >
                    <p className="truncate font-mono text-[10px] font-semibold text-accent-plum">{a}</p>
                    <p className="mt-0.5 text-[9px] text-muted">Archivo .ai · sin producto Alegra</p>
                  </button>
                </li>
              ))}
            </ul>
          </li>
        )}
        {filas.map((f) => {
          const activa =
            escaneoTarget?.sku === f.sku && escaneoArchivoActivo === f.archivo_ai;
          const tieneAi = filaTieneAi(f);
          const deshab = !formatoImpresion || !tieneAi;
          return (
            <li key={f.sku} className="mb-1">
              <button
                type="button"
                disabled={deshab}
                onClick={() => elegirParaEscaneo(f)}
                className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  activa
                    ? "border-accent bg-accent/10 ring-1 ring-accent/40"
                    : "border-border bg-surface hover:border-accent/40 hover:bg-surface-hover"
                }`}
              >
                <p className="truncate text-xs font-semibold text-ink">{f.nombre}</p>
                <p className="mt-0.5 truncate font-mono text-[10px] text-accent">{f.sku}</p>
                <p className="mt-0.5 truncate font-mono text-[9px] text-muted">
                  {f.archivo_ai || (f.fuente === "svg" ? "SVG genérico" : "Sin plantilla .ai")}
                </p>
              </button>
            </li>
          );
        })}
        {!isFetching && filas.length === 0 && plantillasSueltasFiltradas.length === 0 && (
          <li className="px-2 py-6 text-center text-xs text-muted">Sin coincidencias en el catálogo</li>
        )}
      </ul>

      {mostrarPlantillasSinProducto && !buscar.trim() && (data?.plantillas_sin_producto?.length ?? 0) > 0 && (
        <div className="shrink-0 border-t border-border p-2">
          <button
            type="button"
            onClick={() => setPlantillaSueltasAbierto((v) => !v)}
            className="w-full rounded border border-dashed border-border px-2 py-1.5 text-left text-[10px] font-semibold text-muted hover:bg-surface-hover"
          >
            .ai sin SKU ({data?.plantillas_sin_producto.length}) {plantillaSueltasAbierto ? "▾" : "▸"}
          </button>
          {plantillaSueltasAbierto && (
            <ul className="mt-1 max-h-28 overflow-y-auto">
              {data?.plantillas_sin_producto.map((a) => (
                <li key={a}>
                  <button
                    type="button"
                    disabled={!formatoImpresion}
                    onClick={() => elegirPlantillaParaEscaneo(a)}
                    className={`w-full truncate rounded px-1 py-0.5 text-left font-mono text-[9px] disabled:opacity-40 ${
                      escaneoArchivoActivo === a ? "bg-accent/15 font-semibold text-accent" : "text-muted hover:bg-surface-hover"
                    }`}
                  >
                    {a}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );

  const listaLateral = modoListaModelo ? listaModeloSvg : listaPlantillas;

  if (workbench) {
    return (
      <div className="flex h-[min(85vh,920px)] min-h-[520px] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-paper-sm">
        {/* Cabecera única */}
        <header className="shrink-0 border-b border-border bg-surface-panel px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide">
              <span className={pasoActual >= 1 ? "text-accent" : "text-muted"}>1 Formato</span>
              <span className="text-muted">→</span>
              <span className={pasoActual >= 2 ? "text-accent" : "text-muted"}>2 Plantilla</span>
              <span className="text-muted">→</span>
              <span className={pasoActual >= 3 ? "text-accent" : "text-muted"}>3 Editar</span>
            </div>
            <div className="h-4 w-px bg-border" />
            <SelectorFormatoEtiqueta value={formatoValor} readOnly previewBar compact />
          </div>
        </header>

        {errorActivo instanceof Error && (
          <Banner tone="danger" className="shrink-0 rounded-none border-x-0 border-t-0 text-xs">{errorActivo.message}</Banner>
        )}

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(240px,300px)_minmax(0,1fr)]">
          <aside className="flex min-h-[200px] flex-col border-b border-border lg:min-h-0 lg:border-b-0 lg:border-r">
            {listaLateral}
          </aside>
          <main className="flex min-h-[360px] min-w-0 flex-col lg:min-h-0">
            <CatalogoDiagramacionScanner
              embedded
              autoEscanear
              vistaCompleta={modoModeloPdf || modoModeloRelacionado}
              formato={formatoImpresion}
              target={escaneoTarget}
            />
          </main>
        </div>
      </div>
    );
  }

  /* Vista clásica (impresión / catálogo completo) */
  const fuenteBadge = (fuente: CatalogoStudioFila["fuente"]) => {
    if (fuente === "ai") return <Badge tone="success">.ai</Badge>;
    if (fuente === "svg") return <Badge tone="accent">SVG</Badge>;
    return <Badge tone="warning">Sin match</Badge>;
  };

  const seccionPng = (
    <div className={`rounded-paper-lg border border-accent-plum/30 bg-accent-plum/10 p-3 ${soloArchivosPng ? "" : ""}`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wide text-accent-plum">
          {soloArchivosPng ? "ETIQUETAS STUDIO" : "Archivos PNG"} ({plantillasPngFiltradas.length}
          {buscar.trim() ? ` / ${data?.plantillas_png_sin_producto?.length ?? 0}` : ""})
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {!soloArchivosPng && (
            <p className="text-[10px] text-accent-plum">
              En transición · aún no vinculados a un SKU del catálogo
            </p>
          )}
          {puedeEliminarPng && plantillasPngFiltradas.length > 0 && (
            <label className="flex items-center gap-1.5 text-[10px] text-accent-plum">
              <input
                type="checkbox"
                checked={plantillasPngFiltradas.every((n) => pngSeleccionados.has(n.nombre))}
                onChange={() => {
                  setPngSeleccionados((prev) => {
                    const todosMarcados = plantillasPngFiltradas.every((n) => prev.has(n.nombre));
                    const next = new Set(prev);
                    plantillasPngFiltradas.forEach((n) =>
                      todosMarcados ? next.delete(n.nombre) : next.add(n.nombre),
                    );
                    return next;
                  });
                }}
              />
              Seleccionar todo
            </label>
          )}
          {puedeEliminarPng && pngSeleccionados.size > 0 && (
            <Button
              variant="destructive"
              size="sm"
              loading={pngEliminandoLote}
              onClick={eliminarPngSeleccionados}
            >
              {pngEliminandoLote ? "Eliminando…" : `Eliminar (${pngSeleccionados.size})`}
            </Button>
          )}
        </div>
      </div>

      {pngErrorLote && (
        <Banner tone="danger" className="mb-2 text-[10px]">
          {pngErrorLote}
        </Banner>
      )}

      {plantillasPngFiltradas.length === 0 ? (
        <p className="px-1 py-6 text-center text-xs text-muted">
          {isFetching ? "Cargando PNG…" : "Sin archivos PNG"}
        </p>
      ) : (
        <div className={`space-y-3 overflow-y-auto ${
          soloArchivosPng ? "max-h-[min(70vh,640px)]" : "max-h-80"
        }`}>
          {gruposPng.map((grupo) => (
            <section key={grupo.id}>
              <h4 className="mb-1 flex items-baseline gap-2 px-0.5 text-[11px] font-bold text-accent-plum">
                {grupo.etiqueta}
                <span className="font-normal text-accent-plum/70">{grupo.items.length}</span>
              </h4>
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
                {grupo.items.map((item) => {
            const nombre = item.nombre;
            const activo = pngSeleccionados.has(nombre);
            const fmt = labelFormatoPng(item);
            return (
              <div
                key={nombre}
                className={`group relative flex flex-col overflow-hidden rounded-lg border bg-surface-panel ${
                  activo ? "border-accent ring-2 ring-accent/40" : "border-accent-plum/30"
                }`}
              >
                <label className={`absolute left-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded border border-border bg-white/95 shadow-sm ${puedeEliminarPng ? "cursor-pointer" : "hidden"}`}>
                  <input
                    type="checkbox"
                    checked={activo}
                    onChange={() => alternarSeleccionPng(nombre)}
                    className="h-3.5 w-3.5"
                  />
                </label>
                {/* Eliminar directo: en Imprimir el clic en la miniatura abre el
                    archivo para imprimir, así que el botón del lightbox nunca se
                    alcanza y el checkbox de lote es demasiado discreto. */}
                {puedeEliminarPng && (
                  <button
                    type="button"
                    title={`Eliminar ${nombre} de la biblioteca`}
                    aria-label={`Eliminar ${nombre}`}
                    disabled={pngEliminandoUno === nombre}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!window.confirm(`¿Eliminar "${nombre}" de la biblioteca?`)) return;
                      eliminarPngMut.mutate(nombre);
                    }}
                    className="absolute right-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded border border-danger/40 bg-white/95 text-[11px] leading-none text-danger shadow-sm transition hover:bg-danger hover:text-white disabled:opacity-50"
                  >
                    {pngEliminandoUno === nombre ? "…" : "🗑"}
                  </button>
                )}
                <button
                  type="button"
                  title={fmt ? `${nombre} · ${fmt}` : nombre}
                  onClick={() => {
                    if (soloArchivosPng && onAbrirPng) {
                      onAbrirPng(item);
                    } else {
                      setPngVistaPrevia(item);
                    }
                  }}
                  className="flex aspect-square items-center justify-center bg-surface-hover p-1 hover:opacity-90"
                >
                  <MiniaturaRecursoPng nombre={nombre} />
                </button>
                <p className="truncate px-1.5 pt-1 font-mono text-[9px] text-accent-plum" title={nombre}>
                  {nombre.includes("/") ? nombre.split("/").pop() : nombre}
                </p>
                {fmt ? (
                  <p className="truncate px-1.5 pb-1 text-[9px] font-medium text-ink/70" title={fmt}>
                    {fmt}
                  </p>
                ) : (
                  <p className="px-1.5 pb-1 text-[9px] text-muted">Sin formato</p>
                )}
                {/* Reasignar categoría: lo deducido del nombre acierta casi siempre,
                    pero el operador manda y la corrección queda guardada. */}
                <select
                  value={item.categoria_producto || CATEGORIA_ETIQUETA_OTROS}
                  disabled={recategorizando === nombre}
                  title="Categoría de producto"
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    setRecategorizando(nombre);
                    recategorizarPngMut.mutate({ nombre, categoria: e.target.value });
                  }}
                  className="mx-1 mb-1 rounded border border-border bg-surface px-1 py-0.5 text-[9px] text-muted disabled:opacity-50"
                >
                  {categoriasEtiqueta.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.etiqueta}
                    </option>
                  ))}
                </select>
              </div>
            );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );

  const lightboxPng = pngVistaPrevia ? (
    <LightboxImagen
      nombre={pngVistaPrevia.nombre}
      formato={pngVistaPrevia}
      onCerrar={() => setPngVistaPrevia(null)}
      onImprimir={
        soloArchivosPng && onAbrirPng
          ? () => {
              const item = pngVistaPrevia;
              setPngVistaPrevia(null);
              onAbrirPng(item);
            }
          : undefined
      }
      onDescargar={() => void descargarPng(pngVistaPrevia.nombre)}
      onEliminar={
        puedeEliminarPng
          ? () => {
              if (!window.confirm(`¿Eliminar "${pngVistaPrevia.nombre}" de la biblioteca?`)) return;
              eliminarPngMut.mutate(pngVistaPrevia.nombre, {
                onSuccess: () => setPngVistaPrevia(null),
              });
            }
          : undefined
      }
      descargando={pngDescargando === pngVistaPrevia.nombre}
      eliminando={pngEliminandoUno === pngVistaPrevia.nombre}
    />
  ) : null;

  if (soloArchivosPng) {
    const totalPng = plantillasPngFiltradas.length;
    // Una sola rejilla corrida: la categoría ya se elige con los chips, así que
    // repetirla como secciones solo gastaba alto y obligaba a desplazarse más.
    const itemsVisibles = catFiltro
      ? (gruposPng.find((g) => g.id === catFiltro)?.items ?? [])
      : [...plantillasPngFiltradas].sort((a, b) =>
          nombreLegiblePng(a.nombre).localeCompare(nombreLegiblePng(b.nombre), "es", { numeric: true }),
        );
    const primerPng = itemsVisibles[0];
    const minPx = TAMANOS_MINIATURA.find((t) => t.id === tamanoMini)?.minPx ?? 160;
    const abrir = (item: RecursoPngCatalogo) => {
      if (onAbrirPng) onAbrirPng(item);
      else setPngVistaPrevia(item);
    };
    const chip = (activo: boolean) =>
      `mck-press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition ${
        activo
          ? "border-accent bg-accent text-white"
          : "border-border bg-surface text-ink-secondary hover:border-accent/50 hover:text-ink"
      }`;

    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Barra fija: buscar, tamaño de miniatura y organizar. Solo se desplaza la rejilla. */}
        <div className="flex-shrink-0 space-y-1.5 border-b border-border bg-surface-panel/60 px-3 py-2 sm:px-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Icon
                name="search"
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
              />
              <input
                ref={buscarRef}
                autoFocus
                type="text"
                inputMode="search"
                aria-label="Buscar etiqueta"
                // mck-field-lg: sale de la regla global de campos compactos (1.65rem).
                className="mck-field-lg h-10 w-full rounded-paper border-2 border-border bg-surface pl-9 pr-9 text-sm outline-none transition focus:border-accent"
                placeholder="Buscar producto o tamaño…"
                title="Enter abre la primera etiqueta de la lista"
                value={buscar}
                onChange={(e) => setBuscar(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && primerPng) {
                    e.preventDefault();
                    abrir(primerPng);
                  } else if (e.key === "Escape" && buscar) {
                    e.preventDefault();
                    e.stopPropagation();
                    setBuscar("");
                  }
                }}
              />
              {/* El <span> lleva la posición: index.css fuerza position:relative en
                  todo <button> de #root y anula la clase `absolute`. */}
              {buscar && (
                <span className="absolute right-1.5 top-1/2 flex -translate-y-1/2">
                  <button
                    type="button"
                    aria-label="Limpiar búsqueda"
                    onClick={() => {
                      setBuscar("");
                      buscarRef.current?.focus();
                    }}
                    className="mck-icon-btn flex items-center justify-center rounded-full text-muted hover:bg-surface-hover hover:text-ink"
                  >
                    <Icon name="close" size={14} />
                  </button>
                </span>
              )}
            </div>
            <span className="text-xs tabular-nums text-muted">
              {isFetching ? "Actualizando…" : `${totalPng} ${totalPng === 1 ? "etiqueta" : "etiquetas"}`}
            </span>
            <div
              role="group"
              aria-label="Tamaño de las miniaturas"
              className="flex h-10 items-center rounded-paper border border-border bg-surface p-0.5"
            >
              {TAMANOS_MINIATURA.map((t, i) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={tamanoMini === t.id}
                  title={`Miniaturas ${t.etiqueta.toLowerCase()}`}
                  onClick={() => {
                    setTamanoMini(t.id);
                    try {
                      window.localStorage.setItem(LS_TAMANO_MINIATURA, t.id);
                    } catch {
                      /* sin localStorage */
                    }
                  }}
                  className={`flex h-full w-10 items-center justify-center rounded transition ${
                    tamanoMini === t.id ? "bg-accent text-white" : "text-muted hover:bg-surface-hover hover:text-ink"
                  }`}
                >
                  {/* Un cuadrado que crece: se entiende sin leer. */}
                  <span
                    aria-hidden
                    className="rounded-[3px] border-2 border-current"
                    style={{ width: 9 + i * 5, height: 9 + i * 5 }}
                  />
                  <span className="sr-only">{t.etiqueta}</span>
                </button>
              ))}
            </div>
            {puedeEliminarPng && (
              <button
                type="button"
                aria-pressed={organizar}
                onClick={() => {
                  setOrganizar((v) => !v);
                  setPngSeleccionados(new Set());
                }}
                title="Cambiar categoría o eliminar etiquetas"
                className={`mck-press inline-flex h-10 items-center gap-1.5 rounded-paper border px-3 text-xs font-semibold transition ${
                  organizar
                    ? "border-accent-plum bg-accent-plum text-white"
                    : "border-border bg-surface text-ink-secondary hover:border-accent-plum/60 hover:text-ink"
                }`}
              >
                <Icon name="folder" size={15} />
                {organizar ? "Listo" : "Organizar"}
              </button>
            )}
          </div>

          {gruposPng.length > 1 && (
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5" role="group" aria-label="Filtrar por categoría">
              <button type="button" className={chip(!catFiltro)} onClick={() => setCatFiltro("")}>
                Todas
                <span className="tabular-nums opacity-70">{totalPng}</span>
              </button>
              {gruposPng.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className={chip(catFiltro === g.id)}
                  onClick={() => setCatFiltro((v) => (v === g.id ? "" : g.id))}
                >
                  {g.etiqueta}
                  <span className="tabular-nums opacity-70">{g.items.length}</span>
                </button>
              ))}
            </div>
          )}

          {organizar && (
            <div className="flex flex-wrap items-center gap-3 rounded-paper border border-accent-plum/30 bg-accent-plum/10 px-3 py-1.5 text-xs text-accent-plum">
              <span className="font-semibold">Organizar:</span>
              <span className="text-ink-secondary">cambia la categoría en cada tarjeta o marca varias para eliminarlas.</span>
              <label className="ml-auto flex cursor-pointer items-center gap-1.5 font-medium">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={totalPng > 0 && plantillasPngFiltradas.every((n) => pngSeleccionados.has(n.nombre))}
                  onChange={() => {
                    setPngSeleccionados((prev) => {
                      const todosMarcados = plantillasPngFiltradas.every((n) => prev.has(n.nombre));
                      const next = new Set(prev);
                      plantillasPngFiltradas.forEach((n) =>
                        todosMarcados ? next.delete(n.nombre) : next.add(n.nombre),
                      );
                      return next;
                    });
                  }}
                />
                Seleccionar todo
              </label>
              {pngSeleccionados.size > 0 && (
                <Button variant="destructive" size="sm" loading={pngEliminandoLote} onClick={eliminarPngSeleccionados}>
                  {pngEliminandoLote ? "Eliminando…" : `Eliminar (${pngSeleccionados.size})`}
                </Button>
              )}
            </div>
          )}
        </div>

        {error instanceof Error && (
          <Banner tone="danger" className="flex-shrink-0 rounded-none border-x-0 border-t-0 text-xs">{error.message}</Banner>
        )}
        {pngErrorLote && (
          <Banner tone="danger" className="flex-shrink-0 rounded-none border-x-0 border-t-0 text-xs">{pngErrorLote}</Banner>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 sm:px-4">
          {itemsVisibles.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <Icon name="search" size={28} className="text-muted/60" />
              <p className="text-sm font-medium text-muted">
                {isFetching ? "Cargando etiquetas…" : buscar.trim() ? `Nada coincide con "${buscar.trim()}"` : "Sin etiquetas PNG"}
              </p>
              {(buscar.trim() || catFiltro) && !isFetching && (
                <button
                  type="button"
                  onClick={() => {
                    setBuscar("");
                    setCatFiltro("");
                  }}
                  className="rounded-lg border border-accent px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent hover:text-white"
                >
                  Ver todas
                </button>
              )}
            </div>
          ) : (
                <div
                  className="grid gap-2 pt-3"
                  style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(${minPx}px, 45%), 1fr))` }}
                >
                  {itemsVisibles.map((item) => {
                    const nombre = item.nombre;
                    const marcado = pngSeleccionados.has(nombre);
                    const fmt = labelFormatoPng(item);
                    const legible = nombreLegiblePng(nombre);
                    return (
                      <div
                        key={nombre}
                        className={`group relative flex flex-col overflow-hidden rounded-xl border bg-surface-panel shadow-paper-sm transition focus-within:ring-2 focus-within:ring-accent/50 hover:-translate-y-0.5 hover:border-accent hover:shadow-md ${
                          marcado ? "border-accent ring-2 ring-accent/40" : "border-border"
                        }`}
                      >
                        <button
                          type="button"
                          title={organizar ? `Marcar ${legible}` : `Imprimir ${legible}`}
                          onClick={() => (organizar ? alternarSeleccionPng(nombre) : abrir(item))}
                          className="relative block aspect-[7/6] w-full bg-white outline-none"
                        >
                          <span className="absolute inset-1 block">
                            <MiniaturaPerezosa nombre={nombre} />
                          </span>
                          {!organizar && (
                            <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-accent/90 py-1.5 text-xs font-bold text-white opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
                              <Icon name="printer" size={14} />
                              Imprimir
                            </span>
                          )}
                        </button>
                        {organizar ? (
                          <input
                            type="checkbox"
                            aria-label={`Seleccionar ${legible}`}
                            checked={marcado}
                            onChange={() => alternarSeleccionPng(nombre)}
                            className="absolute left-2 top-2 h-5 w-5 cursor-pointer rounded shadow"
                          />
                        ) : (
                          <span className="absolute right-2 top-2 flex transition sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                            <button
                              type="button"
                              aria-label={`Ver ${legible} en grande`}
                              title="Ver en grande"
                              onClick={() => setPngVistaPrevia(item)}
                              className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-white/95 text-ink-secondary shadow-sm transition hover:border-accent hover:text-accent"
                            >
                              <Icon name="eye" size={16} />
                            </button>
                          </span>
                        )}
                        <div className="flex flex-1 flex-col gap-0.5 border-t border-border/60 px-2 py-1.5">
                          <p
                            className={`${tamanoMini === "s" ? "truncate" : "line-clamp-2"} text-xs font-semibold leading-snug text-ink`}
                            title={nombre}
                          >
                            {legible}
                          </p>
                          <p className="truncate text-[11px] text-muted">
                            {fmt || "Sin formato"}
                            {!catFiltro && ` · ${etiquetaCategoriaEn(categoriasEtiqueta, item.categoria_producto || CATEGORIA_ETIQUETA_OTROS)}`}
                          </p>
                          {organizar && (
                            <div className="mt-1 flex items-center gap-1.5">
                              {/* Reasignar categoría: lo deducido del nombre acierta casi siempre,
                                  pero el operador manda y la corrección queda guardada. */}
                              <select
                                value={item.categoria_producto || CATEGORIA_ETIQUETA_OTROS}
                                disabled={recategorizando === nombre}
                                aria-label={`Categoría de ${legible}`}
                                title="Categoría de producto"
                                onChange={(e) => {
                                  setRecategorizando(nombre);
                                  recategorizarPngMut.mutate({ nombre, categoria: e.target.value });
                                }}
                                className="h-8 min-w-0 flex-1 rounded border border-border bg-surface px-1.5 text-[11px] text-ink-secondary disabled:opacity-50"
                              >
                                {categoriasEtiqueta.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.etiqueta}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                title={`Eliminar ${legible} de la biblioteca`}
                                aria-label={`Eliminar ${legible}`}
                                disabled={pngEliminandoUno === nombre}
                                onClick={() => {
                                  if (!window.confirm(`¿Eliminar "${nombre}" de la biblioteca?`)) return;
                                  eliminarPngMut.mutate(nombre);
                                }}
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-danger/40 text-danger transition hover:bg-danger hover:text-white disabled:opacity-50"
                              >
                                {pngEliminandoUno === nombre ? "…" : <Icon name="trash" size={15} />}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
          )}
        </div>
        {lightboxPng}
      </div>
    );
  }

  return (
    <div className="space-y-4 mck-stagger">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile label="Productos" value={stats?.total_productos ?? "—"} icon="package" />
        <StatTile
          label="Con MeLi"
          value={stats?.con_meli ?? "—"}
          tone="accent"
          icon="tag"
          interactive
          active={soloConMeli}
          onClick={() => setSoloConMeli((v) => !v)}
        />
        <StatTile
          label="Con .ai"
          value={stats?.con_ai ?? "—"}
          tone="success"
          icon="check"
          interactive
          active={soloConAi}
          onClick={() => setSoloConAi((v) => !v)}
        />
        <StatTile label="Sin match" value={stats?.sin_match ?? "—"} tone="danger" icon="warning" />
        <StatTile
          label="PNG Studio"
          value={stats?.plantillas_png_total ?? "—"}
          tone="plum"
          icon="image"
          interactive
          active={plantillaPngAbierto}
          onClick={() => setPlantillaPngAbierto((v) => !v)}
        />
      </div>

      {mostrarDiagramacion && (
        <section className="rounded-xl border border-border bg-surface-panel p-3">
          <SelectorFormatoEtiqueta value={formatoValor} readOnly previewBar />
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <input
            className="w-full rounded-paper border-2 border-border bg-surface py-2 pl-3 pr-3 text-sm outline-none transition focus:border-accent"
            placeholder="Buscar SKU, nombre o plantilla…"
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
          />
        </div>
        <FilterChip
          label="Solo MeLi"
          active={soloConMeli}
          onClick={() => setSoloConMeli((v) => !v)}
        />
        <FilterChip
          label="Solo .ai"
          active={soloConAi}
          onClick={() => setSoloConAi((v) => !v)}
        />
        <FilterChip
          label="PNG Studio"
          active={plantillaPngAbierto}
          onClick={() => setPlantillaPngAbierto((v) => !v)}
          count={data?.plantillas_png_sin_producto?.length}
        />
        {isFetching && <span className="text-xs text-muted">Actualizando…</span>}
        {!isFetching && data && (
          <span className="text-xs text-muted tabular-nums">
            {filas.length}{buscar.trim() ? ` / ${data.total}` : ""} resultados
          </span>
        )}
      </div>

      {error instanceof Error && (
        <Banner tone="danger" className="text-xs">{error.message}</Banner>
      )}

      {plantillaPngAbierto && seccionPng}

      {lightboxPng}

      <div className="mck-card overflow-hidden">
        <div className="max-h-[min(60vh,520px)] overflow-auto">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="sticky top-0 z-10 border-b border-border bg-surface-panel text-[10px] font-bold uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2.5">SKU</th>
                <th className="px-3 py-2.5">Producto</th>
                <th className="px-3 py-2.5">Plantilla .ai</th>
                <th className="px-3 py-2.5">Fuente</th>
                {mostrarDiagramacion && <th className="px-3 py-2.5">Diagramación</th>}
                {!seleccionPorFila && accionLabel && <th className="px-3 py-2.5" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filas.map((f) => (
                <tr
                  key={f.sku}
                  onClick={seleccionPorFila ? () => onSeleccionar(f) : undefined}
                  className={`transition-colors hover:bg-surface-hover ${
                    skuActivo === f.sku ? "bg-accent/8 ring-1 ring-inset ring-accent/25" : ""
                  } ${seleccionPorFila ? "cursor-pointer" : ""}`}
                >
                  <td className="px-3 py-2.5 font-mono text-accent">{f.sku}</td>
                  <td className="max-w-[200px] truncate px-3 py-2.5 font-medium text-ink">{f.nombre}</td>
                  <td className="max-w-[180px] truncate px-3 py-2.5 font-mono text-[10px] text-muted">
                    {f.archivo_ai || "—"}
                  </td>
                  <td className="px-3 py-2.5">{fuenteBadge(f.fuente)}</td>
                  {mostrarDiagramacion && (
                    <td className="px-3 py-2">
                      {formatoImpresion && filaTieneAi(f) ? (
                        <button
                          type="button"
                          onClick={() => elegirParaEscaneo(f)}
                          className="rounded border border-accent-plum/40 px-2 py-0.5 text-[10px] font-semibold text-accent-plum hover:bg-accent-plum/10"
                        >
                          Escanear
                        </button>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  )}
                  {!seleccionPorFila && accionLabel && (
                    <td className="px-3 py-2">
                      <button type="button" onClick={() => onSeleccionar(f)} className="rounded border border-border px-2 py-0.5 text-[10px]">
                        {accionLabel}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {mostrarDiagramacion && (
        <CatalogoDiagramacionScanner formato={formatoImpresion} target={escaneoTarget} />
      )}
    </div>
  );
}
