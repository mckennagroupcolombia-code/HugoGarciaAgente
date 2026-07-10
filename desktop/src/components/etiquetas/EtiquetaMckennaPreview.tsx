import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { EtiquetaStudioDatos } from "../../lib/etiquetasNormativa";
import type { CampoDiagramacionId } from "../../lib/etiquetasDiagramacion";
import { formatoCanvasPx } from "../../lib/etiquetasDiagramacion";
import { EtiquetaDiagramacionWorkspace } from "./EtiquetaDiagramEditor";
import { Modal, Banner, Button, IconButton } from "./ui";

interface Props {
  datos: EtiquetaStudioDatos;
  className?: string;
  /** Marco con proporción del formato de papel (mm). */
  marcoFormato?: boolean;
  /** Renderiza el .ai tal cual (sin procesar) — para la vista original de referencia. */
  raw?: boolean;
  /** Habilita edición de diagramación en la vista previa. */
  editable?: boolean;
  onPatch?: (patch: Partial<EtiquetaStudioDatos>) => void;
  /** Vista previa protagonista con editor integrado (Studio). */
  modoStudio?: boolean;
  seleccionCampo?: string | null;
  onSeleccionCampo?: (id: string | null) => void;
  panelTextoExterno?: boolean;
  onCamposPresentesChange?: (ids: Set<CampoDiagramacionId>) => void;
  onGraficosPresentesChange?: (ids: string[]) => void;
}

type PreviewResponse = {
  svg?: string;
  imagen?: string;
  mime?: string;
  error?: string;
  meta?: {
    fuente?: string;
    archivo?: string;
    modo?: string;
    codigo_barras?: string;
    bloque_legal?: boolean;
    lote_vencimiento?: string[];
    descripcion_recibida_chars?: number;
    descripcion_reemplazos?: number;
    preflight?: { ok?: boolean; errors?: string[]; warnings?: string[] };
  };
};

function buildPreviewPayload(datos: EtiquetaStudioDatos, anchoPx: number, raw: boolean) {
  return {
    ...datos,
    descripcion_etiqueta: datos.descripcion_etiqueta ?? "",
    modo_etiqueta: datos.modo_etiqueta ?? "original",
    b1_ancho_pct: datos.b1_ancho_pct ?? 100,
    diagramacion: datos.diagramacion ?? {},
    diagramacion_graficos: datos.diagramacion_graficos ?? {},
    ancho_px: anchoPx,
    formato: raw ? "png" : "svg",
    ...(raw ? { modo_render: "raw" as const } : {}),
  };
}

function SvgEnFormato({ svg, className = "" }: { svg: string; className?: string }) {
  return (
    <div
      className={`h-full w-full [&_svg]:block [&_svg]:h-full [&_svg]:w-full ${className}`}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/** Vista previa desde plantilla Illustrator (.ai) o SVG McKenna. */
export function EtiquetaMckennaPreview({
  datos,
  className = "",
  marcoFormato = false,
  raw = false,
  editable = false,
  onPatch,
  modoStudio = false,
  seleccionCampo,
  onSeleccionCampo,
  panelTextoExterno = false,
  onCamposPresentesChange,
  onGraficosPresentesChange,
}: Props) {
  const [debounced, setDebounced] = useState(datos);
  const [ampliada, setAmpliada] = useState(false);
  const [zoomPct, setZoomPct] = useState(100);
  const canvasRef = useRef<HTMLDivElement>(null);
  const ampliadaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const delay = datos.descripcion_etiqueta?.length ? 280 : 450;
    const t = window.setTimeout(() => setDebounced(datos), delay);
    return () => window.clearTimeout(t);
  }, [datos]);

  const anchoPx = modoStudio ? 1800 : 1400;

  const previewPayload = useMemo(
    () => buildPreviewPayload(debounced, anchoPx, raw),
    [debounced, raw],
  );

  const descFingerprint = useMemo(() => {
    const d = debounced.descripcion_etiqueta ?? "";
    return `${d.length}:${d.slice(0, 96)}:${d.slice(-48)}`;
  }, [debounced.descripcion_etiqueta]);

  const diagFingerprint = useMemo(
    () =>
      JSON.stringify({
        t: debounced.diagramacion ?? {},
        g: debounced.diagramacion_graficos ?? {},
      }),
    [debounced.diagramacion, debounced.diagramacion_graficos],
  );

  const anchoMm = debounced.ancho_mm ?? 76;
  const altoMm = debounced.alto_mm ?? 66;
  const canvas = formatoCanvasPx(anchoMm, altoMm, zoomPct);

  const queryKey = useMemo(
    () => [
      "etiquetas-studio-preview",
      debounced.sku,
      debounced.modo_etiqueta ?? "original",
      debounced.archivo_ai ?? "",
      debounced.subtitulo ?? "",
      debounced.b1_ancho_pct ?? 100,
      debounced.ancho_mm ?? 76,
      debounced.alto_mm ?? 66,
      diagFingerprint,
      descFingerprint,
      raw,
      anchoPx,
    ],
    [
      debounced.sku,
      debounced.modo_etiqueta,
      debounced.archivo_ai,
      debounced.subtitulo,
      debounced.b1_ancho_pct,
      debounced.ancho_mm,
      debounced.alto_mm,
      diagFingerprint,
      descFingerprint,
      raw,
      anchoPx,
    ],
  );

  const { data, isFetching, isPending, error } = useQuery({
    queryKey,
    queryFn: () =>
      api.post<PreviewResponse>("/api/etiquetas/studio/preview", previewPayload, {
        timeoutMs: 120_000,
      }),
    enabled: !!debounced.nombre_producto.trim(),
    staleTime: 0,
    gcTime: 60_000,
  });

  const src = data?.imagen ? `data:${data.mime || "image/png"};base64,${data.imagen}` : null;
  const svgMarkup = data?.svg || null;
  const errMsg = error instanceof Error ? error.message : data?.error;

  useEffect(() => {
    if (ampliada) setZoomPct(120);
  }, [ampliada]);

  useEffect(() => {
    if (!ampliada) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [ampliada]);

  const descSinAplicar =
    !raw &&
    (debounced.descripcion_etiqueta?.trim().length ?? 0) > 40 &&
    data?.meta?.descripcion_reemplazos === 0;

  const previewInner =
    svgMarkup ? (
      <SvgEnFormato
        key={descFingerprint}
        svg={svgMarkup}
        className={
          modoStudio
            ? ""
            : "mx-auto max-w-[560px] [&_svg]:h-auto [&_svg]:w-full"
        }
      />
    ) : src ? (
      <img
        key={descFingerprint}
        src={src}
        alt={`Etiqueta ${debounced.nombre_producto}`}
        className={`mx-auto h-auto drop-shadow-md transition-opacity ${
          marcoFormato ? "h-full w-full object-contain" : "w-full max-w-[560px]"
        } ${isFetching ? "opacity-60" : "opacity-100"}`}
      />
    ) : null;

  const marcoFormatoNode = (content: ReactNode) => (
    <div
      className="mx-auto shrink-0 overflow-hidden rounded-sm border border-border/80 bg-white shadow-md"
      style={{ width: canvas.width, height: canvas.height }}
    >
      {content}
    </div>
  );

  const previewNode =
    previewInner &&
    (marcoFormato && anchoMm && altoMm ? marcoFormatoNode(previewInner) : previewInner);

  return (
    <div className={className}>
      {!debounced.nombre_producto.trim() && (
        <p className="py-8 text-center text-xs text-muted">Ingresa nombre de producto para ver la etiqueta</p>
      )}
      {(isFetching || isPending) && debounced.nombre_producto.trim() && (
        <p className="py-2 text-center text-[10px] text-muted">Renderizando etiqueta…</p>
      )}
      {descSinAplicar && (
        <Banner tone="warning" className="text-[10px]">
          La descripción del cuadro no se aplicó a la plantilla (
          {data?.meta?.descripcion_recibida_chars ?? 0} caracteres recibidos). Comprueba que estás en
          versión «Alternativa» y vuelve a cargar el SKU.
        </Banner>
      )}
      {errMsg && (
        <Banner tone="warning" className="text-[10px]">
          {errMsg}
        </Banner>
      )}
      {!errMsg && data?.meta?.preflight && data.meta.preflight.ok === false && (
        <Banner tone="danger" className="text-[10px]">
          Preflight: {(data.meta.preflight.errors || []).join(" · ")}
        </Banner>
      )}
      {!errMsg && data?.meta?.preflight?.ok && (data.meta.preflight.warnings || []).length > 0 && (
        <Banner tone="warning" className="text-[10px]">
          Aviso: {(data.meta.preflight.warnings || []).join(" · ")}
        </Banner>
      )}
      {modoStudio && editable && !raw && svgMarkup && onPatch ? (
        <EtiquetaDiagramacionWorkspace
          containerRef={canvasRef}
          svgKey={`${descFingerprint}:${diagFingerprint}:${anchoMm}x${altoMm}`}
          diagramacion={datos.diagramacion}
          diagramacionGraficos={datos.diagramacion_graficos}
          datos={datos}
          enabled
          variant="inline"
          zoomPct={zoomPct}
          onZoomPctChange={setZoomPct}
          seleccion={seleccionCampo}
          onSeleccionChange={onSeleccionCampo}
          panelExterno={panelTextoExterno}
          onCamposPresentesChange={onCamposPresentesChange}
          onGraficosPresentesChange={onGraficosPresentesChange}
          onPatchDiagramacion={(diagramacion) => onPatch({ diagramacion })}
          onPatchGraficos={(diagramacion_graficos) => onPatch({ diagramacion_graficos })}
          onPatchDatos={onPatch}
        >
          <SvgEnFormato svg={svgMarkup} />
        </EtiquetaDiagramacionWorkspace>
      ) : (
        previewNode && (
          <div
            className={
              modoStudio
                ? "flex min-h-[min(60vh,800px)] items-center justify-center overflow-auto p-2"
                : undefined
            }
          >
            {previewNode}
          </div>
        )
      )}
      {(svgMarkup || src) && !modoStudio && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => {
              setZoomPct(100);
              setAmpliada(true);
            }}
            className="rounded-lg border border-border bg-surface px-3 py-1 text-xs font-semibold hover:bg-surface-hover"
          >
            Ampliar vista previa
          </button>
        </div>
      )}
      {modoStudio && (svgMarkup || src) && (
        <div className="mt-1 flex flex-col items-center gap-0.5">
          <p className="text-[10px] text-muted">
            {anchoMm}×{altoMm} mm · {zoomPct}% ≈ tamaño impresión
            {debounced.tipo_etiqueta ? ` · ${debounced.tipo_etiqueta}` : ""}
          </p>
          <button
            type="button"
            onClick={() => {
              setZoomPct(100);
              setAmpliada(true);
            }}
            className="text-[10px] font-semibold text-accent hover:underline"
          >
            Pantalla completa
          </button>
        </div>
      )}
      {marcoFormato && !modoStudio && anchoMm && altoMm && (
        <p className="mt-2 text-center text-[10px] text-muted">
          {anchoMm}×{altoMm} mm · {debounced.tipo_etiqueta}
          {debounced.archivo_ai ? ` · ${debounced.archivo_ai}` : ""}
        </p>
      )}
      {ampliada && (svgMarkup || src) && typeof document !== "undefined" && (
        <Modal
          onClose={() => setAmpliada(false)}
          title={
            <>
              Vista previa ampliada
              {editable && !raw ? " · editor de diagramación" : ""}
            </>
          }
          maxWidthClassName={editable && !raw ? "max-w-[1400px]" : "max-w-[1200px]"}
          fixedHeight
          headerExtra={
            <div className="flex items-center gap-1.5">
              <IconButton icon="minus" label="Reducir zoom" size="sm" variant="outline" onClick={() => setZoomPct((z) => Math.max(50, z - 10))} />
              <span className="min-w-[52px] text-center text-xs font-semibold text-ink">{zoomPct}%</span>
              <IconButton icon="plus" label="Aumentar zoom" size="sm" variant="outline" onClick={() => setZoomPct((z) => Math.min(250, z + 10))} />
              <Button variant="secondary" size="sm" onClick={() => setZoomPct(100)}>
                100%
              </Button>
            </div>
          }
        >
          <div className="min-h-full">
            {svgMarkup ? (
              editable && !raw && onPatch ? (
                <EtiquetaDiagramacionWorkspace
                  containerRef={ampliadaRef}
                  svgKey={`${descFingerprint}:${diagFingerprint}:${zoomPct}`}
                  diagramacion={datos.diagramacion}
                  diagramacionGraficos={datos.diagramacion_graficos}
                  datos={datos}
                  enabled
                  variant="sidebar"
                  zoomPct={zoomPct}
                  onZoomPctChange={setZoomPct}
                  onPatchDiagramacion={(diagramacion) => onPatch({ diagramacion })}
                  onPatchGraficos={(diagramacion_graficos) => onPatch({ diagramacion_graficos })}
                  onPatchDatos={onPatch}
                >
                  <SvgEnFormato svg={svgMarkup} />
                </EtiquetaDiagramacionWorkspace>
              ) : (
                <div className="h-full overflow-auto rounded bg-surface-hover p-2">
                  <div className="flex min-h-full items-center justify-center">
                    {marcoFormatoNode(<SvgEnFormato svg={svgMarkup} />)}
                  </div>
                </div>
              )
            ) : (
              <div className="flex h-full items-center justify-center overflow-auto rounded bg-surface-hover p-2">
                {marcoFormatoNode(
                  <img
                    src={src!}
                    alt={`Etiqueta ampliada ${debounced.nombre_producto}`}
                    className="h-full w-full object-contain"
                  />,
                )}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
