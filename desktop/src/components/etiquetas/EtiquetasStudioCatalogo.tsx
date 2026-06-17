import { useEffect, useMemo, useRef, useState } from "react";
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

interface Props {
  onSeleccionar: (fila: CatalogoStudioFila) => void;
  skuActivo?: string;
  /** Si se omite, la fila completa es clickeable (sin columna de botón). */
  accionLabel?: string | null;
  modoSeleccion?: "boton" | "fila";
  mostrarPlantillasSinProducto?: boolean;
  /** Abre el flujo de escaneo y preselecciona SKU si existe en catálogo. */
  modoEscaneo?: boolean;
  skuEscaneoInicial?: string;
  onModoEscaneoChange?: (activo: boolean) => void;
}

function badgeFuente(fuente: CatalogoStudioFila["fuente"]): string {
  if (fuente === "ai") return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (fuente === "svg") return "bg-amber-100 text-amber-900 border-amber-200";
  return "bg-red-100 text-red-800 border-red-200";
}

function etiquetaFuente(fuente: CatalogoStudioFila["fuente"]): string {
  if (fuente === "ai") return "Illustrator";
  if (fuente === "svg") return "SVG genérico";
  return "Sin plantilla";
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
}: Props) {
  const seleccionPorFila = modoSeleccion === "fila" || accionLabel === null;
  const scannerRef = useRef<HTMLDivElement>(null);
  const [buscar, setBuscar] = useState("");
  const [soloSinAi, setSoloSinAi] = useState(false);
  const [soloConMeli, setSoloConMeli] = useState(false);
  const [escaneoTarget, setEscaneoTarget] = useState<EscaneoDiagramacionTarget | null>(null);
  const [formatoValor, setFormatoValor] = useState<FormatoEtiquetaValor>({
    nombre: "",
    anchoMm: 76,
    altoMm: 66,
  });

  const formatoImpresion = useMemo<FormatoImpresionEscaneo | null>(() => {
    const nombre = formatoValor.nombre.trim();
    if (!nombre) return null;
    return {
      nombre,
      ancho_mm: formatoValor.anchoMm,
      alto_mm: formatoValor.altoMm,
    };
  }, [formatoValor]);

  const queryKey = useMemo(
    () => ["etiquetas-studio-catalogo", buscar, soloSinAi, soloConMeli],
    [buscar, soloSinAi, soloConMeli],
  );

  const { data, isFetching, error } = useQuery({
    queryKey,
    queryFn: () => {
      const p = new URLSearchParams();
      if (buscar.trim()) p.set("q", buscar.trim());
      if (soloSinAi) p.set("solo_sin_ai", "1");
      if (soloConMeli) p.set("solo_con_meli", "1");
      return api.get<CatalogoStudioResponse>(`/api/etiquetas/studio/catalogo?${p.toString()}`);
    },
    staleTime: 20_000,
  });

  const stats = data?.stats;
  const filas = data?.filas ?? [];

  const escaneoSkuActivo = escaneoTarget?.sku ?? null;
  const escaneoArchivoActivo = escaneoTarget?.archivo_ai ?? null;

  useEffect(() => {
    if (!modoEscaneo || !skuEscaneoInicial?.trim() || filas.length === 0) return;
    const fila = filas.find((f) => f.sku === skuEscaneoInicial.trim());
    if (!fila) return;

    const tipo = fila.tipo_etiqueta?.trim();
    if (tipo && !formatoValor.nombre.trim()) {
      const [ancho, alto] = mmParaTipoEtiqueta(tipo, TIPOS_ETIQUETA_DEFAULT);
      setFormatoValor({ nombre: tipo, anchoMm: ancho, altoMm: alto });
      return;
    }

    if (!formatoImpresion) return;
    const tgt = targetEscaneoDesdeFila(fila, formatoImpresion);
    if (!tgt) return;
    setEscaneoTarget(tgt);
    onModoEscaneoChange?.(false);
    requestAnimationFrame(() => {
      scannerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [modoEscaneo, skuEscaneoInicial, filas, formatoValor.nombre, formatoImpresion, onModoEscaneoChange]);

  function onFormatoChange(next: FormatoEtiquetaValor) {
    setFormatoValor(next);
    setEscaneoTarget(null);
  }

  function elegirParaEscaneo(fila: CatalogoStudioFila) {
    if (!formatoImpresion) return;
    const tgt = targetEscaneoDesdeFila(fila, formatoImpresion);
    if (!tgt) return;
    setEscaneoTarget(tgt);
    requestAnimationFrame(() => {
      scannerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function elegirPlantillaParaEscaneo(archivo: string) {
    if (!formatoImpresion) return;
    setEscaneoTarget(targetEscaneoDesdePlantilla(archivo, formatoImpresion));
    requestAnimationFrame(() => {
      scannerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  return (
    <div className="space-y-4">
      {modoEscaneo && !formatoImpresion && (
        <div className="rounded-lg border border-violet-300 bg-violet-100/80 px-4 py-3 text-xs text-violet-950">
          <p className="font-semibold">Modo escaneo de diagramación</p>
          <p className="mt-0.5 text-[11px] opacity-90">
            Primero elige el formato de impresión. Luego pulsa «Escanear» en un producto del catálogo.
          </p>
        </div>
      )}

      <section className="rounded-xl border-2 border-accent/30 bg-surface-panel p-4 shadow-paper-sm">
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-accent">Paso 1</p>
            <p className="text-sm font-bold text-ink">Formato de impresión</p>
            <p className="text-[10px] text-muted">Tamaño del marco antes de escanear la plantilla</p>
          </div>
          <SelectorFormatoEtiqueta
            value={formatoValor}
            onChange={onFormatoChange}
            previewBar
          />
          {formatoImpresion && (
            <span className="rounded-lg border border-border bg-surface px-3 py-2 text-xs font-mono text-muted">
              {formatoImpresion.ancho_mm}×{formatoImpresion.alto_mm} mm
            </span>
          )}
        </div>
        {!formatoImpresion && (
          <p className="text-xs text-amber-800">
            Selecciona un formato para habilitar el escaneo en el catálogo.
          </p>
        )}
      </section>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-surface px-3 py-2">
          <p className="text-[10px] uppercase text-muted">Productos Siigo</p>
          <p className="text-lg font-bold text-ink">{stats?.total_productos ?? "—"}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface px-3 py-2">
          <p className="text-[10px] uppercase text-muted">Con MeLi vinculado</p>
          <p className="text-lg font-bold text-blue-700">{stats?.con_meli ?? "—"}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface px-3 py-2">
          <p className="text-[10px] uppercase text-muted">Con plantilla .ai</p>
          <p className="text-lg font-bold text-emerald-700">{stats?.con_ai ?? "—"}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface px-3 py-2">
          <p className="text-[10px] uppercase text-muted">Sin coincidencia</p>
          <p className="text-lg font-bold text-red-700">{stats?.sin_match ?? "—"}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold text-ink">
          Paso 2 · Catálogo
          {formatoImpresion ? ` · ${formatoImpresion.nombre}` : ""}
        </p>
        <input
          className="min-w-[200px] flex-1 rounded-lg border border-border px-3 py-2 text-sm"
          placeholder="Buscar SKU, nombre o plantilla…"
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
        />
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={soloConMeli} onChange={(e) => setSoloConMeli(e.target.checked)} />
          Solo con MeLi
        </label>
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={soloSinAi} onChange={(e) => setSoloSinAi(e.target.checked)} />
          Sin plantilla .ai
        </label>
        {isFetching && <span className="text-xs text-muted">Actualizando…</span>}
      </div>

      {error instanceof Error && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">{error.message}</p>
      )}

      <div className="overflow-hidden rounded-xl border border-border">
        <div className="max-h-[min(70vh,640px)] overflow-auto">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="sticky top-0 z-10 bg-surface-panel text-[10px] uppercase text-muted">
              <tr>
                <th className="px-3 py-2 font-semibold">SKU</th>
                <th className="px-3 py-2 font-semibold">Producto</th>
                <th className="px-3 py-2 font-semibold">MeLi</th>
                <th className="px-3 py-2 font-semibold">Plantilla .ai</th>
                <th className="px-3 py-2 font-semibold">Formato</th>
                <th className="px-3 py-2 font-semibold">Fuente</th>
                <th className="px-3 py-2 font-semibold">Diagramación</th>
                {!seleccionPorFila && <th className="px-3 py-2 font-semibold" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filas.map((f) => {
                const puedeEscanear = formatoImpresion && f.fuente === "ai" && Boolean(f.archivo_ai);
                const filaEscaneoActiva =
                  escaneoArchivoActivo === f.archivo_ai &&
                  (!escaneoSkuActivo || escaneoSkuActivo === f.sku);
                return (
                <tr
                  key={f.sku}
                  onClick={seleccionPorFila ? () => onSeleccionar(f) : undefined}
                  className={`hover:bg-surface-hover ${skuActivo === f.sku ? "bg-accent/5" : ""} ${
                    filaEscaneoActiva ? "ring-1 ring-inset ring-violet-400 bg-violet-50/50" : ""
                  } ${seleccionPorFila ? "cursor-pointer" : ""}`}
                >
                  <td className="px-3 py-2 font-mono text-accent">{f.sku}</td>
                  <td className="max-w-[220px] truncate px-3 py-2" title={f.nombre}>
                    {f.nombre}
                    {f.studio_guardado && (
                      <span className="ml-1 rounded bg-blue-100 px-1 text-[9px] text-blue-800">guardado</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {f.meli_id ? (
                      <a
                        href={f.meli_url || `https://articulo.mercadolibre.com.co/${f.meli_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-blue-700 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {f.meli_id.replace(/^MCO/i, "")}
                      </a>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="max-w-[200px] truncate px-3 py-2 font-mono text-[10px]" title={f.archivo_ai || ""}>
                    {f.archivo_ai || "—"}
                    {f.archivo_ai_manual && (
                      <span className="ml-1 text-[9px] text-muted">manual</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted">{f.tipo_etiqueta || "—"}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] ${badgeFuente(f.fuente)}`}>
                      {etiquetaFuente(f.fuente)}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {puedeEscanear ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          elegirParaEscaneo(f);
                        }}
                        className={`rounded border px-2 py-1 text-[10px] font-semibold ${
                          filaEscaneoActiva
                            ? "border-violet-500 bg-violet-600 text-white"
                            : "border-violet-300 text-violet-800 hover:bg-violet-50"
                        }`}
                      >
                        Escanear
                      </button>
                    ) : (
                      <span className="text-[10px] text-muted" title={!formatoImpresion ? "Elige formato primero" : undefined}>
                        {!formatoImpresion ? "Formato…" : "—"}
                      </span>
                    )}
                  </td>
                  {!seleccionPorFila && (
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => onSeleccionar(f)}
                        className="rounded border border-border px-2 py-1 text-[10px] font-semibold hover:bg-surface"
                      >
                        {accionLabel}
                      </button>
                    </td>
                  )}
                </tr>
              );})}
              {!isFetching && filas.length === 0 && (
                <tr>
                  <td colSpan={seleccionPorFila ? 7 : 8} className="px-3 py-8 text-center text-muted">
                    No hay productos que coincidan con el filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="border-t border-border px-3 py-2 text-[10px] text-muted">
          {data?.total ?? 0} productos · {stats?.plantillas_ai_total ?? 0} plantillas .ai ·{" "}
          {stats?.plantillas_ai_sin_producto ?? 0} .ai sin SKU asociado
        </p>
      </div>

      <div ref={scannerRef}>
        <CatalogoDiagramacionScanner formato={formatoImpresion} target={escaneoTarget} />
      </div>

      {mostrarPlantillasSinProducto && (data?.plantillas_sin_producto?.length ?? 0) > 0 && (
        <details className="rounded-xl border border-border bg-surface-panel p-3">
          <summary className="cursor-pointer text-sm font-semibold text-ink">
            Plantillas .ai sin producto Siigo asociado ({data?.plantillas_sin_producto.length})
          </summary>
          <ul className="mt-2 grid max-h-40 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
            {data?.plantillas_sin_producto.map((a) => (
              <li key={a}>
                <button
                  type="button"
                  disabled={!formatoImpresion}
                  onClick={() => elegirPlantillaParaEscaneo(a)}
                  className={`w-full truncate rounded px-1 py-0.5 text-left font-mono text-[10px] disabled:cursor-not-allowed disabled:opacity-40 ${
                    escaneoArchivoActivo === a
                      ? "bg-violet-100 font-semibold text-violet-900"
                      : "text-violet-800 hover:bg-violet-50"
                  }`}
                  title="Escanear diagramación de esta plantilla"
                >
                  {a}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
