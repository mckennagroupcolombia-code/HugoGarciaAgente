import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import {
  targetEscaneoDesdeFila,
  targetEscaneoDesdePlantilla,
  type EscaneoDiagramacionTarget,
  type FormatoImpresionEscaneo,
} from "../../lib/etiquetasStudioHelpers";
import { mmParaTipoEtiqueta, TIPOS_ETIQUETA_DEFAULT } from "../../lib/etiquetasTipos";
import { puedeEliminarPngEtiquetas } from "../../lib/studioVisualAccess";
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
  /** Muestra el catálogo completo Siigo (como Impresión), no solo filas con .ai. */
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

  const qc = useQueryClient();
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
    onMutate: (nombre) => setPngEliminandoUno(nombre),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["etiquetas-studio-catalogo"] });
      void qc.invalidateQueries({ queryKey: ["etiquetas-recursos-png"] });
    },
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
                    <p className="mt-0.5 text-[9px] text-muted">Archivo .ai · sin producto Siigo</p>
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
        <div className={`grid grid-cols-3 gap-1.5 overflow-y-auto sm:grid-cols-4 lg:grid-cols-6 ${
          soloArchivosPng ? "max-h-[min(70vh,640px)]" : "max-h-80"
        }`}>
          {plantillasPngFiltradas.map((item) => {
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const lightboxPng = pngVistaPrevia ? (
    <LightboxImagen
      nombre={pngVistaPrevia.nombre}
      formato={pngVistaPrevia}
      onCerrar={() => setPngVistaPrevia(null)}
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
    return (
      <div className="space-y-4 mck-stagger">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <input
              className="w-full rounded-paper border-2 border-border bg-surface py-2 pl-3 pr-3 text-sm outline-none transition focus:border-accent"
              placeholder="Buscar archivo PNG…"
              value={buscar}
              onChange={(e) => setBuscar(e.target.value)}
            />
          </div>
          {isFetching && <span className="text-xs text-muted">Actualizando…</span>}
          {!isFetching && data && (
            <span className="text-xs text-muted tabular-nums">
              {plantillasPngFiltradas.length}
              {buscar.trim() ? ` / ${data.plantillas_png_sin_producto?.length ?? 0}` : ""} PNG
            </span>
          )}
        </div>
        {error instanceof Error && (
          <Banner tone="danger" className="text-xs">{error.message}</Banner>
        )}
        {seccionPng}
        {!onAbrirPng && lightboxPng}
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
