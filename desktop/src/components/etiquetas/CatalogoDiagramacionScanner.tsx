import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { ETIQUETA_STUDIO_DEFAULT, type EtiquetaStudioDatos } from "../../lib/etiquetasNormativa";
import {
  CAMPOS_DIAGRAMACION,
  type CampoDiagramacionId,
  type DiagramacionEtiqueta,
  type DiagramacionGraficos,
  formatoCanvasPx,
} from "../../lib/etiquetasDiagramacion";
import type {
  EscaneoDiagramacionTarget,
  FormatoImpresionEscaneo,
} from "../../lib/etiquetasStudioHelpers";
import { EtiquetaDiagramacionWorkspace } from "./EtiquetaDiagramEditor";
import { EtiquetaTextoEditorPanel } from "./EtiquetaTextoEditorPanel";

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
  updated_at?: string;
  svg?: string;
  svg_error?: string;
}

function SvgEnFormato({ svg }: { svg: string }) {
  return (
    <div
      className="flex h-full w-full items-center justify-center [&_svg]:block [&_svg]:h-full [&_svg]:w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

interface Props {
  formato: FormatoImpresionEscaneo | null;
  target: EscaneoDiagramacionTarget | null;
}

export function CatalogoDiagramacionScanner({ formato, target }: Props) {
  const qc = useQueryClient();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [zoomPct, setZoomPct] = useState(100);
  const [seleccion, setSeleccion] = useState<string | null>("titulo");
  const [svgMarkup, setSvgMarkup] = useState<string | null>(null);
  const [meta, setMeta] = useState<{
    archivo_ai: string;
    tipo_etiqueta: string;
    ancho_mm: number;
    alto_mm: number;
    campos_detectados: string[];
    graficos_detectados: string[];
    muestras: Record<string, string>;
    sku?: string;
    nombre?: string;
  } | null>(null);
  const [diagramacion, setDiagramacion] = useState<DiagramacionEtiqueta>({});
  const [diagramacionGraficos, setDiagramacionGraficos] = useState<DiagramacionGraficos>({});
  const [datosExtra, setDatosExtra] = useState<Partial<EtiquetaStudioDatos>>({});
  const [dirty, setDirty] = useState(false);
  const [camposPresentes, setCamposPresentes] = useState<Set<CampoDiagramacionId>>(new Set());
  const [graficosPresentes, setGraficosPresentes] = useState<string[]>([]);

  const tipoFormato = formato?.nombre ?? "";

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
    setMeta(null);
    setSvgMarkup(null);
    setDiagramacion({});
    setDiagramacionGraficos({});
    setDatosExtra({});
    setDirty(false);
    setSeleccion("titulo");
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
      sku: tgt.sku,
      nombre: tgt.nombre,
    });
    setDiagramacion(g.diagramacion ?? {});
    setDiagramacionGraficos(g.diagramacion_graficos ?? {});
    setSvgMarkup(g.svg?.trim() ? g.svg : null);
    setDirty(false);
  }, []);

  useEffect(() => {
    if (!target) {
      resetCanvas();
      return;
    }
    resetCanvas();
  }, [target?.archivo_ai, target?.tipo_etiqueta, target?.sku, target?.ancho_mm, resetCanvas]);

  useEffect(() => {
    if (!target || cargandoGuardada || !guardada?.diagramacion) return;
    const mismoAi = !guardada.archivo_ai || guardada.archivo_ai === target.archivo_ai;
    if (mismoAi) {
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
        guardar: false,
      }, { timeoutMs: 120_000 }),
    onSuccess: (res, tgt) => {
      setMeta({
        archivo_ai: res.archivo_ai,
        tipo_etiqueta: res.tipo_etiqueta,
        ancho_mm: res.ancho_mm,
        alto_mm: res.alto_mm,
        campos_detectados: res.campos_detectados,
        graficos_detectados: res.graficos_detectados,
        muestras: res.muestras ?? {},
        sku: tgt.sku,
        nombre: tgt.nombre,
      });
      setDiagramacion(res.diagramacion ?? {});
      setDiagramacionGraficos(res.diagramacion_graficos ?? {});
      setSvgMarkup(res.svg);
      setDirty(true);
    },
  });

  const guardarMut = useMutation({
    mutationFn: () => {
      if (!target || !meta) throw new Error("Sin etiqueta seleccionada");
      return api.put<DiagramacionFormatoGuardada>(
        `/api/etiquetas/studio/diagramacion-formato/${encodeURIComponent(meta.tipo_etiqueta)}`,
        {
          archivo_ai: meta.archivo_ai,
          ancho_mm: meta.ancho_mm,
          alto_mm: meta.alto_mm,
          diagramacion,
          diagramacion_graficos: diagramacionGraficos,
          muestras: meta.muestras,
          campos_detectados: meta.campos_detectados,
          graficos_detectados: meta.graficos_detectados,
        },
      );
    },
    onSuccess: (res) => {
      if (target) hidratarDesdeGuardada(res, target);
      qc.setQueryData(["diagramacion-formato", tipoFormato, target?.archivo_ai], res);
      setDirty(false);
    },
  });

  const activo = meta !== null;

  const datosCanvas = useMemo<EtiquetaStudioDatos>(() => ({
    ...ETIQUETA_STUDIO_DEFAULT,
    ...datosExtra,
    sku: meta?.sku ?? datosExtra.sku ?? "",
    nombre_producto: meta?.nombre ?? meta?.muestras?.titulo ?? datosExtra.nombre_producto ?? "Plantilla",
    subtitulo: meta?.muestras?.subtitulo ?? datosExtra.subtitulo ?? ETIQUETA_STUDIO_DEFAULT.subtitulo,
    tipo_etiqueta: meta?.tipo_etiqueta ?? formato?.nombre ?? ETIQUETA_STUDIO_DEFAULT.tipo_etiqueta,
    ancho_mm: meta?.ancho_mm ?? formato?.ancho_mm ?? 76,
    alto_mm: meta?.alto_mm ?? formato?.alto_mm ?? 66,
    archivo_ai: meta?.archivo_ai ?? target?.archivo_ai ?? "",
    diagramacion,
    diagramacion_graficos: diagramacionGraficos,
  }), [meta, target, formato, diagramacion, diagramacionGraficos, datosExtra]);

  const canvas = formatoCanvasPx(
    datosCanvas.ancho_mm ?? 76,
    datosCanvas.alto_mm ?? 66,
    zoomPct,
  );

  const patchDiagramacion = useCallback((next: DiagramacionEtiqueta) => {
    setDiagramacion(next);
    setDirty(true);
  }, []);

  const patchGraficos = useCallback((next: DiagramacionGraficos) => {
    setDiagramacionGraficos(next);
    setDirty(true);
  }, []);

  const patchDatos = useCallback((patch: Partial<EtiquetaStudioDatos>) => {
    setDatosExtra((p) => ({ ...p, ...patch }));
    setDirty(true);
  }, []);

  if (!formato) {
    return (
      <section className="rounded-xl border border-dashed border-violet-300 bg-violet-50/30 px-4 py-6 text-center">
        <p className="text-sm font-semibold text-ink">Paso 1 · Formato de impresión</p>
        <p className="mt-1 text-xs text-muted">
          Elige arriba el formato (tamaño en mm). Luego selecciona un archivo del catálogo para escanear.
        </p>
      </section>
    );
  }

  if (!target) {
    return (
      <section className="rounded-xl border border-dashed border-violet-300 bg-violet-50/30 px-4 py-6 text-center">
        <p className="text-sm font-semibold text-ink">
          Paso 2 · Archivo del catálogo · {formato.nombre} ({formato.ancho_mm}×{formato.alto_mm} mm)
        </p>
        <p className="mt-1 text-xs text-muted">
          Pulsa «Escanear» en la fila del producto o plantilla .ai que quieras diagramar.
        </p>
      </section>
    );
  }

  const tituloProducto = target.nombre || target.archivo_ai;
  const subtitulo = [
    formato.nombre,
    `${formato.ancho_mm}×${formato.alto_mm} mm`,
    target.sku ? `SKU ${target.sku}` : null,
    target.archivo_ai,
  ].filter(Boolean).join(" · ");

  return (
    <section className="rounded-xl border-2 border-violet-200 bg-violet-50/40 shadow-paper-sm">
      <div className="flex flex-wrap items-center gap-3 border-b border-violet-200/80 bg-violet-100/50 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-ink">{tituloProducto}</p>
          <p className="truncate text-[10px] text-muted">Canvas editable · {subtitulo}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {activo && (
            <button
              type="button"
              disabled={guardarMut.isPending || !dirty}
              onClick={() => guardarMut.mutate()}
              className="rounded-lg border border-emerald-600 bg-emerald-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
            >
              {guardarMut.isPending ? "Guardando…" : dirty ? "Guardar plantilla" : "Plantilla guardada"}
            </button>
          )}
          <button
            type="button"
            disabled={escanearMut.isPending}
            onClick={() => escanearMut.mutate(target)}
            className="rounded-lg border-2 border-violet-500 bg-violet-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-violet-700 disabled:opacity-50"
            title={`Lee posiciones desde ${target.archivo_ai}`}
          >
            {escanearMut.isPending ? "Escaneando…" : "Escanear diagramación"}
          </button>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {guardada?.updated_at && !dirty && guardada.archivo_ai === target.archivo_ai && (
            <span className="text-[10px] text-muted">
              Guardada {new Date(guardada.updated_at).toLocaleString("es-CO")}
            </span>
          )}
          {guardada?.archivo_ai && guardada.archivo_ai !== target.archivo_ai && (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] text-amber-900">
              Hay plantilla guardada para otro .ai ({guardada.archivo_ai}) — escanea de nuevo
            </span>
          )}
          {dirty && (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
              Cambios sin guardar
            </span>
          )}
          {escanearMut.isError && (
            <span className="text-xs text-danger">{(escanearMut.error as Error).message}</span>
          )}
          {guardarMut.isError && (
            <span className="text-xs text-danger">{(guardarMut.error as Error).message}</span>
          )}
          {guardada?.svg_error && !svgMarkup && (
            <span className="text-xs text-danger">SVG: {guardada.svg_error}</span>
          )}
        </div>

        {!activo && !cargandoGuardada && !escanearMut.isPending && (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted">
            Pulsa «Escanear diagramación» para centrar{" "}
            <span className="font-mono">{target.archivo_ai}</span> en el marco {formato.ancho_mm}×{formato.alto_mm} mm.
          </p>
        )}

        {activo && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr),minmax(260px,320px)]">
            <div className="space-y-2">
              <div className="flex items-center justify-center gap-2">
                <button type="button" onClick={() => setZoomPct((z) => Math.max(50, z - 10))} className="rounded border border-border px-2 py-1 text-xs">−</button>
                <span className="text-xs font-semibold">{zoomPct}%</span>
                <button type="button" onClick={() => setZoomPct((z) => Math.min(200, z + 10))} className="rounded border border-border px-2 py-1 text-xs">+</button>
                <button type="button" onClick={() => setZoomPct(100)} className="rounded border border-border px-2 py-1 text-[10px]">100%</button>
              </div>

              <div className="flex min-h-[280px] justify-center overflow-auto rounded-lg border border-border bg-[#e8e8e8] p-6">
                {svgMarkup ? (
                  <div
                    ref={canvasRef}
                    className="relative shrink-0 overflow-hidden rounded-sm border border-border/80 bg-white shadow-md"
                    style={{ width: canvas.width, height: canvas.height }}
                  >
                    <EtiquetaDiagramacionWorkspace
                      containerRef={canvasRef}
                      svgKey={`scan:${meta?.archivo_ai}:${Object.keys(diagramacion).join(",")}:${svgMarkup.length}`}
                      diagramacion={diagramacion}
                      diagramacionGraficos={diagramacionGraficos}
                      datos={datosCanvas}
                      enabled
                      variant="inline"
                      zoomPct={zoomPct}
                      onZoomPctChange={setZoomPct}
                      seleccion={seleccion}
                      onSeleccionChange={setSeleccion}
                      panelExterno
                      onPatchDiagramacion={patchDiagramacion}
                      onPatchGraficos={patchGraficos}
                      onPatchDatos={patchDatos}
                      onCamposPresentesChange={setCamposPresentes}
                      onGraficosPresentesChange={setGraficosPresentes}
                    >
                      <SvgEnFormato svg={svgMarkup} />
                    </EtiquetaDiagramacionWorkspace>
                  </div>
                ) : (
                  <p className="py-8 text-xs text-muted">Cargando lienzo…</p>
                )}
              </div>
              <p className="text-center text-[10px] text-muted">
                Marco {meta?.ancho_mm}×{meta?.alto_mm} mm · contenido centrado · arrastra bloques ·{" "}
                {meta?.campos_detectados.length ?? 0} textos · {meta?.graficos_detectados.length ?? 0} gráficos
              </p>
            </div>

            <EtiquetaTextoEditorPanel
              datos={datosCanvas}
              diagramacion={diagramacion}
              diagramacionGraficos={diagramacionGraficos}
              seleccion={seleccion}
              onSeleccion={(id) => setSeleccion(id)}
              onPatchDatos={patchDatos}
              onPatchDiagramacion={patchDiagramacion}
              onPatchGraficos={patchGraficos}
              camposPresentes={camposPresentes.size > 0 ? camposPresentes : new Set(
                CAMPOS_DIAGRAMACION
                  .filter((c) => meta?.campos_detectados.includes(c.id))
                  .map((c) => c.id),
              )}
              graficosPresentes={graficosPresentes.length > 0 ? graficosPresentes : (meta?.graficos_detectados ?? [])}
            />
          </div>
        )}
      </div>
    </section>
  );
}
