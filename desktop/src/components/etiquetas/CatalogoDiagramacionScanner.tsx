import { useCallback, useEffect, useMemo, useRef, useState, type RefObject, type Dispatch, type SetStateAction } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { ETIQUETA_STUDIO_DEFAULT, type EtiquetaStudioDatos } from "../../lib/etiquetasNormativa";
import {
  type CampoDiagramacionId,
  type DiagramacionEtiqueta,
  type DiagramacionGraficos,
  FUENTE_ETIQUETA,
  FUENTE_ETIQUETA_FAMILY,
} from "../../lib/etiquetasDiagramacion";
import type {
  EscaneoDiagramacionTarget,
  FormatoImpresionEscaneo,
} from "../../lib/etiquetasStudioHelpers";
import { EtiquetaDiagramacionWorkspace } from "./EtiquetaDiagramEditor";

interface EscanearDiagramacionResp {
  ok: boolean;
  archivo_ai: string;
  tipo_etiqueta: string;
  ancho_mm: number;
  alto_mm: number;
  diagramacion: DiagramacionEtiqueta;
  diagramacion_graficos: DiagramacionGraficos;
  campos_detectados: string[];
  graficos_detectados: string[];
  muestras?: Record<string, string>;
  svg: string;
  export_area?: number[] | null;
  solo_lineas?: boolean;
  vista_completa?: boolean;
  error?: string;
}

interface DiagramacionFormatoGuardada {
  archivo_ai?: string;
  tipo_etiqueta?: string;
  ancho_mm?: number;
  alto_mm?: number;
  diagramacion?: DiagramacionEtiqueta;
  diagramacion_graficos?: DiagramacionGraficos;
  campos_detectados?: string[];
  graficos_detectados?: string[];
  muestras?: Record<string, string>;
  solo_lineas?: boolean;
  vista_completa?: boolean;
  updated_at?: string;
  svg?: string;
  svg_error?: string;
}

function datosDesdeMuestras(m: Record<string, string>): Partial<EtiquetaStudioDatos> {
  const out: Partial<EtiquetaStudioDatos> = {};
  if (m.titulo) out.nombre_producto = m.titulo;
  if (m.subtitulo) out.subtitulo = m.subtitulo;
  if (m.descripcion) out.descripcion_etiqueta = m.descripcion;
  if (m.cas_linea) out.cas = m.cas_linea.replace(/^#\s*/, "").trim();
  if (m.concentracion) out.concentracion = m.concentracion.replace(/^Concentración:\s*/i, "").trim();
  if (m.formula) out.formula_molecular = m.formula.replace(/^Fórmula molecular:\s*/i, "").trim();
  if (m.cuchara) {
    out.texto_cuchara = m.cuchara;
    out.incluye_cuchara = true;
  }
  if (m.peso) {
    const pm = m.peso.trim().match(/^([\d.,]+)\s*(.*)$/);
    if (pm) {
      out.contenido_neto = pm[1].replace(",", ".");
      if (pm[2]) out.unidad = pm[2].trim();
    }
  }
  return out;
}

const ZOOM_LIENZO_DEFAULT = 140;
/** Plantillas: diagramación solo de líneas divisorias (no textos editables). */
const SOLO_LINEAS_PLANTILLAS = true;

function esPlantillaSvg(archivo?: string): boolean {
  const a = (archivo || "").trim().toLowerCase();
  return a.endsWith(".svg");
}

function esPlantillaPdf(archivo?: string): boolean {
  const a = (archivo || "").trim().toLowerCase();
  return a.endsWith(".pdf") || a.startsWith("pdf/");
}

function SvgEnFormato({ svg }: { svg: string }) {
  return (
    <div
      className={`absolute inset-0 flex items-center justify-center [&_svg]:block [&_svg]:h-full [&_svg]:w-full ${FUENTE_ETIQUETA}`}
      style={{ fontFamily: FUENTE_ETIQUETA_FAMILY }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

interface Props {
  formato: FormatoImpresionEscaneo | null;
  target: EscaneoDiagramacionTarget | null;
  /** Escanea automáticamente al elegir plantilla (si no hay guardada). */
  autoEscanear?: boolean;
  /** Ocupa altura del panel padre (layout workbench). */
  embedded?: boolean;
  /** PDF: muestra todo el arte del modelo en el lienzo (textos, logos, líneas). */
  vistaCompleta?: boolean;
}

export function CatalogoDiagramacionScanner({
  formato,
  target,
  autoEscanear = false,
  embedded = false,
  vistaCompleta,
}: Props) {
  const qc = useQueryClient();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [zoomPct, setZoomPct] = useState(ZOOM_LIENZO_DEFAULT);
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [svgMarkup, setSvgMarkup] = useState<string | null>(null);
  const [meta, setMeta] = useState<{
    archivo_ai: string;
    tipo_etiqueta: string;
    ancho_mm: number;
    alto_mm: number;
    campos_detectados: string[];
    graficos_detectados: string[];
    muestras: Record<string, string>;
    export_area?: number[] | null;
    solo_lineas?: boolean;
    vista_completa?: boolean;
    sku?: string;
    nombre?: string;
  } | null>(null);
  const [diagramacion, setDiagramacion] = useState<DiagramacionEtiqueta>({});
  const [diagramacionGraficos, setDiagramacionGraficos] = useState<DiagramacionGraficos>({});
  const [datosExtra, setDatosExtra] = useState<Partial<EtiquetaStudioDatos>>({});
  const [dirty, setDirty] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const sesionEscaneoRef = useRef(false);
  const autoScanHechoRef = useRef<string | null>(null);

  const tipoFormato = formato?.nombre ?? "";
  const vistaCompletaEfectiva = vistaCompleta ?? (esPlantillaPdf(target?.archivo_ai) || esPlantillaSvg(target?.archivo_ai));

  const { data: guardada, isFetching: cargandoGuardada } = useQuery({
    queryKey: ["diagramacion-formato", tipoFormato, target?.archivo_ai],
    queryFn: () =>
      api.get<DiagramacionFormatoGuardada>(
        `/api/etiquetas/studio/diagramacion-formato/${encodeURIComponent(tipoFormato)}?incluir_svg=1`,
      ),
    enabled: Boolean(formato && target?.archivo_ai && tipoFormato),
    retry: false,
    staleTime: 30_000,
  });

  const resetCanvas = useCallback(() => {
    sesionEscaneoRef.current = false;
    setMeta(null);
    setSvgMarkup(null);
    setDiagramacion({});
    setDiagramacionGraficos({});
    setDatosExtra({});
    setDirty(false);
    setSaveMsg(null);
    setSeleccion(null);
  }, []);

  const hidratarDesdeGuardada = useCallback((
    g: DiagramacionFormatoGuardada,
    tgt: EscaneoDiagramacionTarget,
  ) => {
    setMeta({
      archivo_ai: g.archivo_ai ?? tgt.archivo_ai,
      tipo_etiqueta: g.tipo_etiqueta ?? tgt.tipo_etiqueta,
      ancho_mm: g.ancho_mm ?? tgt.ancho_mm,
      alto_mm: g.alto_mm ?? tgt.alto_mm,
      campos_detectados: g.campos_detectados ?? Object.keys(g.diagramacion ?? {}),
      graficos_detectados: g.graficos_detectados ?? Object.keys(g.diagramacion_graficos ?? {}),
      muestras: g.muestras ?? {},
      solo_lineas: g.solo_lineas ?? SOLO_LINEAS_PLANTILLAS,
      vista_completa: g.vista_completa ?? esPlantillaPdf(g.archivo_ai ?? tgt.archivo_ai),
      sku: tgt.sku,
      nombre: tgt.nombre,
    });
    setDiagramacion(g.diagramacion ?? {});
    setDiagramacionGraficos(g.diagramacion_graficos ?? {});
    setDatosExtra(datosDesdeMuestras(g.muestras ?? {}));
    setSvgMarkup(g.svg?.trim() ? g.svg : null);
    setDirty(false);
  }, []);

  useEffect(() => {
    if (!target) {
      resetCanvas();
      return;
    }
    sesionEscaneoRef.current = false;
    autoScanHechoRef.current = null;
    setZoomPct(ZOOM_LIENZO_DEFAULT);
    resetCanvas();
  }, [target?.archivo_ai, target?.tipo_etiqueta, target?.sku, target?.ancho_mm, resetCanvas, target]);

  useEffect(() => {
    if (!target || cargandoGuardada || !guardada?.diagramacion) return;
    if (sesionEscaneoRef.current) return;
    const mismoAi = !guardada.archivo_ai || guardada.archivo_ai === target.archivo_ai;
    const mismoFormato = (guardada.tipo_etiqueta || target.tipo_etiqueta) === target.tipo_etiqueta;
    if (mismoAi && mismoFormato) {
      hidratarDesdeGuardada(guardada, target);
    }
  }, [target, guardada, cargandoGuardada, hidratarDesdeGuardada]);

  const escanearMut = useMutation({
    mutationFn: (tgt: EscaneoDiagramacionTarget) =>
      api.post<EscanearDiagramacionResp>("/api/etiquetas/studio/escanear-diagramacion", {
        archivo_ai: tgt.archivo_ai,
        tipo_etiqueta: tgt.tipo_etiqueta,
        ancho_mm: tgt.ancho_mm,
        alto_mm: tgt.alto_mm,
        solo_lineas: SOLO_LINEAS_PLANTILLAS,
        vista_completa: vistaCompleta ?? (esPlantillaPdf(tgt.archivo_ai) || esPlantillaSvg(tgt.archivo_ai)),
        guardar: false,
      }, { timeoutMs: 120_000 }),
    onSuccess: (res, tgt) => {
      sesionEscaneoRef.current = true;
      setSaveMsg(null);
      setMeta({
        archivo_ai: res.archivo_ai,
        tipo_etiqueta: res.tipo_etiqueta,
        ancho_mm: res.ancho_mm,
        alto_mm: res.alto_mm,
        campos_detectados: res.campos_detectados,
        graficos_detectados: res.graficos_detectados,
        muestras: res.muestras ?? {},
        export_area: res.export_area ?? null,
        solo_lineas: res.solo_lineas ?? SOLO_LINEAS_PLANTILLAS,
        vista_completa: res.vista_completa ?? vistaCompletaEfectiva,
        sku: tgt.sku,
        nombre: tgt.nombre,
      });
      setDiagramacion({});
      setDiagramacionGraficos((prev) => {
        const next = { ...(res.diagramacion_graficos ?? {}) };
        for (const [id, cfg] of Object.entries(prev)) {
          if (id in next && (cfg.x != null || cfg.y != null)) {
            next[id] = { ...next[id], ...cfg };
          }
        }
        return next;
      });
      setDatosExtra({});
      setSvgMarkup(res.svg);
      setDirty(false);
    },
  });

  useEffect(() => {
    if (!autoEscanear || !target || !formato) return;
    if (escanearMut.isPending || cargandoGuardada || meta) return;

    const scanKey = `${target.archivo_ai}|${target.tipo_etiqueta}`;
    const guardadaCoincide =
      Boolean(guardada?.diagramacion_graficos && Object.keys(guardada.diagramacion_graficos).length > 0) &&
      (!guardada?.archivo_ai || guardada.archivo_ai === target.archivo_ai);
    if (guardadaCoincide || autoScanHechoRef.current === scanKey) return;

    autoScanHechoRef.current = scanKey;
    escanearMut.mutate(target);
  }, [
    autoEscanear,
    target,
    formato,
    cargandoGuardada,
    guardada,
    meta,
    escanearMut.isPending,
    escanearMut,
  ]);

  const puedeGuardar = Boolean(target && meta && Object.keys(diagramacionGraficos).length > 0);

  const guardarMut = useMutation({
    mutationFn: () => {
      if (!target || !meta) throw new Error("Escanea la plantilla antes de guardar");
      return api.post<DiagramacionFormatoGuardada>(
        "/api/etiquetas/studio/guardar-diagramacion-formato",
        {
          tipo_etiqueta: target.tipo_etiqueta,
          archivo_ai: meta.archivo_ai,
          ancho_mm: meta.ancho_mm,
          alto_mm: meta.alto_mm,
          diagramacion,
          diagramacion_graficos: diagramacionGraficos,
          solo_lineas: SOLO_LINEAS_PLANTILLAS,
          vista_completa: meta.vista_completa ?? vistaCompletaEfectiva,
          muestras: meta.muestras,
          campos_detectados: meta.campos_detectados,
          graficos_detectados: meta.graficos_detectados,
          export_area: meta.export_area ?? undefined,
        },
        { timeoutMs: 120_000 },
      );
    },
    onSuccess: (res) => {
      sesionEscaneoRef.current = false;
      if (target) hidratarDesdeGuardada(res, target);
      qc.setQueryData(["diagramacion-formato", tipoFormato, target?.archivo_ai], res);
      qc.invalidateQueries({ queryKey: ["diagramacion-formato", tipoFormato] });
      setDirty(false);
      setSaveMsg(`Guardada ${new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}`);
    },
  });

  const activo = meta !== null;
  const cargando = escanearMut.isPending || (cargandoGuardada && !meta);

  const datosCanvas = useMemo<EtiquetaStudioDatos>(() => ({
    ...ETIQUETA_STUDIO_DEFAULT,
    tipo_etiqueta: meta?.tipo_etiqueta ?? formato?.nombre ?? ETIQUETA_STUDIO_DEFAULT.tipo_etiqueta,
    ancho_mm: meta?.ancho_mm ?? formato?.ancho_mm ?? 76,
    alto_mm: meta?.alto_mm ?? formato?.alto_mm ?? 66,
    archivo_ai: meta?.archivo_ai ?? target?.archivo_ai ?? "",
    diagramacion,
    diagramacion_graficos: diagramacionGraficos,
    export_area: meta?.export_area ?? undefined,
    ...datosExtra,
    sku: meta?.sku ?? datosExtra.sku ?? "",
    nombre_producto:
      datosExtra.nombre_producto
      ?? meta?.muestras?.titulo
      ?? meta?.nombre
      ?? ETIQUETA_STUDIO_DEFAULT.nombre_producto,
    subtitulo:
      datosExtra.subtitulo
      ?? meta?.muestras?.subtitulo
      ?? ETIQUETA_STUDIO_DEFAULT.subtitulo,
    descripcion_etiqueta:
      datosExtra.descripcion_etiqueta
      ?? meta?.muestras?.descripcion
      ?? ETIQUETA_STUDIO_DEFAULT.descripcion_etiqueta,
  }), [meta, target, formato, diagramacion, diagramacionGraficos, datosExtra]);

  const svgEscaneo = svgMarkup?.trim() || "";
  const necesitaPreviewLive = dirty || !svgEscaneo;

  const previewLiveQuery = useQuery({
    queryKey: [
      "diagramacion-live-preview",
      meta?.archivo_ai,
      meta?.tipo_etiqueta,
      JSON.stringify(diagramacion),
      JSON.stringify(diagramacionGraficos),
      JSON.stringify(meta?.export_area),
    ],
    queryFn: () =>
      api.post<{ svg?: string; error?: string }>("/api/etiquetas/studio/preview-diagramacion", {
        archivo_ai: meta!.archivo_ai,
        tipo_etiqueta: meta!.tipo_etiqueta,
        ancho_mm: meta!.ancho_mm,
        alto_mm: meta!.alto_mm,
        diagramacion,
        diagramacion_graficos: diagramacionGraficos,
        solo_lineas: meta?.solo_lineas ?? SOLO_LINEAS_PLANTILLAS,
        vista_completa: meta?.vista_completa ?? vistaCompletaEfectiva,
        muestras: meta!.muestras,
        export_area: meta!.export_area ?? undefined,
      }, { timeoutMs: 120_000 }),
    enabled: activo && Boolean(meta?.archivo_ai) && necesitaPreviewLive,
    staleTime: 0,
    placeholderData: (prev) => prev,
  });

  const previewSvg = previewLiveQuery.data?.svg?.trim() || "";
  const svgMostrar =
    necesitaPreviewLive && previewSvg
      ? previewSvg
      : svgEscaneo || previewSvg || null;

  const patchDiagramacion = useCallback((next: DiagramacionEtiqueta) => {
    sesionEscaneoRef.current = true;
    setDiagramacion(next);
    setDirty(true);
    setSaveMsg(null);
  }, []);

  const patchGraficos = useCallback((next: DiagramacionGraficos) => {
    sesionEscaneoRef.current = true;
    setDiagramacionGraficos(next);
    setDirty(true);
    setSaveMsg(null);
  }, []);

  const patchDatos = useCallback((patch: Partial<EtiquetaStudioDatos>) => {
    setDatosExtra((p) => ({ ...p, ...patch }));
    setDirty(true);
    setSaveMsg(null);
  }, []);

  const shellCls = embedded
    ? "flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface-panel"
    : "rounded-xl border border-border bg-surface-panel shadow-paper-sm";

  if (!formato) {
    return (
      <section className={`${shellCls} items-center justify-center p-8 text-center`}>
        <p className="text-sm font-semibold text-ink">Elige un formato de impresión</p>
        <p className="mt-1 max-w-xs text-xs text-muted">
          Usa el selector de la izquierda para definir el tamaño del marco (mm).
        </p>
      </section>
    );
  }

  if (!target) {
    return (
      <section className={`${shellCls} items-center justify-center p-8 text-center`}>
        <p className="text-sm font-semibold text-ink">
          Selecciona una plantilla · {formato.nombre}
        </p>
        <p className="mt-1 max-w-sm text-xs text-muted">
          Haz clic en un producto con archivo .ai en la lista. El escaneo arranca solo.
        </p>
        <p className="mt-3 rounded-lg bg-surface px-3 py-1.5 font-mono text-[11px] text-muted">
          {formato.ancho_mm}×{formato.alto_mm} mm
        </p>
      </section>
    );
  }

  const titulo = target.nombre || target.archivo_ai;

  const barraZoom = (
    <div className="flex items-center gap-0.5 rounded border border-border bg-surface px-1 py-0.5">
      <button type="button" onClick={() => setZoomPct((z) => Math.max(50, z - 10))} className="px-1.5 text-xs">−</button>
      <span className="min-w-[2.5rem] text-center text-[10px] font-semibold">{zoomPct}%</span>
      <button type="button" onClick={() => setZoomPct((z) => Math.min(200, z + 10))} className="px-1.5 text-xs">+</button>
    </div>
  );

  return (
    <section className={shellCls}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface-panel px-3 py-1.5">
        {embedded ? (
          <>
            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-ink" title={target.archivo_ai}>
              {target.archivo_ai}
            </span>
            {barraZoom}
            {activo && (
              <span className="hidden text-[9px] text-muted sm:inline">
                Arrastra las líneas decorativas
              </span>
            )}
          </>
        ) : (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-ink">{titulo}</p>
            <p className="truncate font-mono text-[10px] text-muted">
              {target.archivo_ai} · {formato.nombre} · {formato.ancho_mm}×{formato.alto_mm} mm
            </p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {saveMsg && (
            <span className="hidden rounded bg-emerald-100 px-2 py-1 text-[10px] font-semibold text-emerald-800 sm:inline">
              ✓ {saveMsg}
            </span>
          )}
          {dirty && (
            <span className="rounded bg-amber-100 px-2 py-1 text-[10px] font-medium text-amber-900">
              Sin guardar
            </span>
          )}
          <button
            type="button"
            disabled={escanearMut.isPending}
            onClick={() => escanearMut.mutate(target)}
            className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[11px] font-semibold hover:bg-surface-hover disabled:opacity-50"
            title="Volver a leer la plantilla .ai"
          >
            {escanearMut.isPending ? "…" : "↺ Re-escanear"}
          </button>
          {puedeGuardar && (
            <button
              type="button"
              disabled={guardarMut.isPending}
              onClick={() => guardarMut.mutate()}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {guardarMut.isPending ? "Guardando…" : "Guardar"}
            </button>
          )}
        </div>
      </div>

      {(escanearMut.isError || guardarMut.isError) && (
        <p className="shrink-0 border-b border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-800">
          {(escanearMut.error ?? guardarMut.error) instanceof Error
            ? (escanearMut.error ?? guardarMut.error)?.message
            : "Error"}
        </p>
      )}

      <div className={`min-h-0 flex-1 ${embedded ? "" : "p-3"}`}>
        <CanvasArea
          canvasRef={canvasRef}
          zoomPct={zoomPct}
          setZoomPct={setZoomPct}
          cargando={cargando}
          activo={activo}
          svgMostrar={svgMostrar}
          meta={meta}
          diagramacion={diagramacion}
          diagramacionGraficos={diagramacionGraficos}
          datosCanvas={datosCanvas}
          seleccion={seleccion}
          setSeleccion={setSeleccion}
          patchDiagramacion={patchDiagramacion}
          patchGraficos={patchGraficos}
          patchDatos={patchDatos}
          ocultarZoom={embedded}
        />
      </div>
    </section>
  );
}

function CanvasArea({
  canvasRef,
  zoomPct,
  setZoomPct,
  cargando,
  activo,
  svgMostrar,
  meta,
  diagramacion,
  diagramacionGraficos,
  datosCanvas,
  seleccion,
  setSeleccion,
  patchDiagramacion,
  patchGraficos,
  patchDatos,
  ocultarZoom = false,
}: {
  canvasRef: RefObject<HTMLDivElement | null>;
  zoomPct: number;
  setZoomPct: Dispatch<SetStateAction<number>>;
  cargando: boolean;
  activo: boolean;
  svgMostrar: string | null;
  meta: {
    archivo_ai: string;
    campos_detectados: string[];
    graficos_detectados: string[];
    solo_lineas?: boolean;
    ancho_mm: number;
    alto_mm: number;
  } | null;
  diagramacion: DiagramacionEtiqueta;
  diagramacionGraficos: DiagramacionGraficos;
  datosCanvas: EtiquetaStudioDatos;
  seleccion: string | null;
  setSeleccion: (id: string | null) => void;
  patchDiagramacion: (next: DiagramacionEtiqueta) => void;
  patchGraficos: (next: DiagramacionGraficos) => void;
  patchDatos: (patch: Partial<EtiquetaStudioDatos>) => void;
  ocultarZoom?: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col p-2">
      {!ocultarZoom && (
      <div className="mb-2 flex items-center justify-center gap-1">
        <button type="button" onClick={() => setZoomPct((z) => Math.max(50, z - 10))} className="rounded border border-border px-2 py-0.5 text-xs">−</button>
        <span className="min-w-[3rem] text-center text-[11px] font-semibold">{zoomPct}%</span>
        <button type="button" onClick={() => setZoomPct((z) => Math.min(200, z + 10))} className="rounded border border-border px-2 py-0.5 text-xs">+</button>
        <button type="button" onClick={() => setZoomPct(ZOOM_LIENZO_DEFAULT)} className="rounded border border-border px-1.5 py-0.5 text-[10px]">140%</button>
      </div>
      )}

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-lg bg-[#e5e7eb] p-3">
        {cargando && (
          <p className="text-xs text-muted animate-pulse">Leyendo plantilla…</p>
        )}
        {!cargando && !activo && (
          <p className="max-w-xs text-center text-xs text-muted">
            Pulsa «Re-escanear» o elige otra plantilla.
          </p>
        )}
        {!cargando && activo && !svgMostrar && (
          <p className="text-xs text-muted animate-pulse">Generando vista…</p>
        )}
        {!cargando && activo && svgMostrar && (
          <EtiquetaDiagramacionWorkspace
            containerRef={canvasRef}
            svgKey={`scan:${meta?.archivo_ai}:${Object.keys(diagramacion).join(",")}:${svgMostrar.length}:${zoomPct}`}
            diagramacion={diagramacion}
            diagramacionGraficos={diagramacionGraficos}
            datos={datosCanvas}
            enabled
            variant="inline"
            zoomPct={zoomPct}
            onZoomPctChange={ocultarZoom ? undefined : setZoomPct}
            seleccion={seleccion}
            onSeleccionChange={setSeleccion}
            panelExterno
            onPatchDiagramacion={patchDiagramacion}
            onPatchGraficos={patchGraficos}
            soloLineas={meta?.solo_lineas ?? SOLO_LINEAS_PLANTILLAS}
          >
            <SvgEnFormato svg={svgMostrar} />
          </EtiquetaDiagramacionWorkspace>
        )}
      </div>
      {activo && meta && !ocultarZoom && (
        <p className="mt-1.5 text-center text-[10px] text-muted">
          {meta.ancho_mm}×{meta.alto_mm} mm · {meta.graficos_detectados.length} líneas
        </p>
      )}
    </div>
  );
}
