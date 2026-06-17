import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import {
  targetEscaneoDesdeFila,
  targetEscaneoDesdePlantilla,
  type EscaneoDiagramacionTarget,
  type FormatoImpresionEscaneo,
} from "../../lib/etiquetasStudioHelpers";
import { mmParaTipoEtiqueta, TIPOS_ETIQUETA_DEFAULT } from "../../lib/etiquetasTipos";
import { CatalogoDiagramacionScanner } from "./CatalogoDiagramacionScanner";
import {
  SelectorFormatoEtiqueta,
  type FormatoEtiquetaValor,
} from "./SelectorFormatoEtiqueta";

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
  };
  plantillas_sin_producto: string[];
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
}: Props) {
  const workbench = layout === "workbench" && mostrarDiagramacion;
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

  useEffect(() => {
    if (buscar.trim() && plantillasSueltasFiltradas.length > 0) {
      setPlantillaSueltasAbierto(true);
    }
  }, [buscar, plantillasSueltasFiltradas.length]);

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

  function onFormatoChange(next: FormatoEtiquetaValor) {
    setFormatoValor(next);
    setEscaneoTarget(null);
  }

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
    ? "Modelos SVG"
    : modoModeloPdf
      ? "Modelos PDF"
      : "Modelo SVG";
  const resumenModelo = modoModeloRelacionado
    ? `${dataModelo?.total_ai ?? "—"} .ai · ${dataModelo?.total_pdf ?? "—"} PDF · ${totalModelo} rel.`
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
          <p className="text-[10px] text-amber-800">Elige formato arriba</p>
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
                    {p.tiene_ai ? ".ai" : ""}{p.tiene_ai && p.tiene_pdf ? "+" : ""}{p.tiene_pdf ? "PDF" : ""}
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
              <p className="font-bold text-emerald-700">{stats.con_ai}</p>
              <p className="text-muted">Con .ai</p>
            </div>
            <div className="rounded border border-border bg-surface px-1 py-1">
              <p className="font-bold text-violet-700">{stats.plantillas_ai_sin_producto}</p>
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
          <p className="text-[10px] text-amber-800">↑ Elige formato arriba primero</p>
        )}
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {buscar.trim() && plantillasSueltasFiltradas.length > 0 && (
          <li className="mb-2">
            <p className="mb-1 px-1 text-[9px] font-bold uppercase tracking-wide text-violet-700">
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
                        ? "border-violet-500 bg-violet-500/10 ring-1 ring-violet-400/40"
                        : "border-dashed border-violet-300/60 bg-surface hover:border-violet-400 hover:bg-violet-50/50"
                    }`}
                  >
                    <p className="truncate font-mono text-[10px] font-semibold text-violet-800">{a}</p>
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
            <SelectorFormatoEtiqueta value={formatoValor} onChange={onFormatoChange} previewBar compact />
          </div>
        </header>

        {errorActivo instanceof Error && (
          <p className="shrink-0 border-b border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-800">{errorActivo.message}</p>
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
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-surface px-3 py-2">
          <p className="text-[10px] uppercase text-muted">Productos</p>
          <p className="text-lg font-bold text-ink">{stats?.total_productos ?? "—"}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface px-3 py-2">
          <p className="text-[10px] uppercase text-muted">Con MeLi</p>
          <p className="text-lg font-bold text-blue-700">{stats?.con_meli ?? "—"}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface px-3 py-2">
          <p className="text-[10px] uppercase text-muted">Con .ai</p>
          <p className="text-lg font-bold text-emerald-700">{stats?.con_ai ?? "—"}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface px-3 py-2">
          <p className="text-[10px] uppercase text-muted">Sin match</p>
          <p className="text-lg font-bold text-red-700">{stats?.sin_match ?? "—"}</p>
        </div>
      </div>

      {mostrarDiagramacion && (
        <section className="rounded-xl border border-border bg-surface-panel p-3">
          <SelectorFormatoEtiqueta value={formatoValor} onChange={onFormatoChange} previewBar />
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="min-w-[200px] flex-1 rounded-lg border border-border px-3 py-2 text-sm"
          placeholder="Buscar SKU, nombre o plantilla…"
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
        />
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={soloConMeli} onChange={(e) => setSoloConMeli(e.target.checked)} />
          Solo MeLi
        </label>
        {isFetching && <span className="text-xs text-muted">Actualizando…</span>}
      </div>

      {error instanceof Error && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">{error.message}</p>
      )}

      <div className="overflow-hidden rounded-xl border border-border">
        <div className="max-h-[min(60vh,520px)] overflow-auto">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="sticky top-0 z-10 bg-surface-panel text-[10px] uppercase text-muted">
              <tr>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">Producto</th>
                <th className="px-3 py-2">Plantilla .ai</th>
                <th className="px-3 py-2">Fuente</th>
                {mostrarDiagramacion && <th className="px-3 py-2">Diagramación</th>}
                {!seleccionPorFila && accionLabel && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filas.map((f) => (
                <tr
                  key={f.sku}
                  onClick={seleccionPorFila ? () => onSeleccionar(f) : undefined}
                  className={`hover:bg-surface-hover ${skuActivo === f.sku ? "bg-accent/5" : ""} ${seleccionPorFila ? "cursor-pointer" : ""}`}
                >
                  <td className="px-3 py-2 font-mono text-accent">{f.sku}</td>
                  <td className="max-w-[200px] truncate px-3 py-2">{f.nombre}</td>
                  <td className="max-w-[180px] truncate px-3 py-2 font-mono text-[10px]">{f.archivo_ai || "—"}</td>
                  <td className="px-3 py-2 text-muted">{f.fuente}</td>
                  {mostrarDiagramacion && (
                    <td className="px-3 py-2">
                      {formatoImpresion && filaTieneAi(f) ? (
                        <button
                          type="button"
                          onClick={() => elegirParaEscaneo(f)}
                          className="rounded border border-violet-300 px-2 py-0.5 text-[10px] font-semibold text-violet-800 hover:bg-violet-50"
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
