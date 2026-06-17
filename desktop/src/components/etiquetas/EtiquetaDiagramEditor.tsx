import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { EtiquetaTextoToolbar, patchCampoToolbar } from "./EtiquetaTextoToolbar";
import type { EtiquetaStudioDatos } from "../../lib/etiquetasNormativa";
import {
  CAMPOS_DIAGRAMACION,
  type CampoDiagramacion,
  type CampoDiagramacionId,
  type DiagramacionEtiqueta,
  type DiagramacionGraficos,
  b1AnchoPctEfectivo,
  editorTextoCampo,
  escalaEfectiva,
  labelCampoDiagramacion,
  labelElementoEditor,
  formatoCanvasPx,
  patchDiagramacion,
  patchDiagramacionGraficos,
  esIdGrafico,
} from "../../lib/etiquetasDiagramacion";

type CampoMedido = {
  id: string;
  kind: "texto" | "grafico";
  left: number;
  top: number;
  width: number;
  height: number;
  tx: number;
  ty: number;
  color: string;
  presente: boolean;
};

interface Props {
  containerRef: RefObject<HTMLDivElement | null>;
  svgKey: string;
  diagramacion?: DiagramacionEtiqueta;
  diagramacionGraficos?: DiagramacionGraficos;
  datos: EtiquetaStudioDatos;
  enabled: boolean;
  onPatchDiagramacion: (next: DiagramacionEtiqueta) => void;
  onPatchGraficos?: (next: DiagramacionGraficos) => void;
  onPatchDatos?: (patch: Partial<EtiquetaStudioDatos>) => void;
  children: ReactNode;
  /** inline = vista previa principal Studio; sidebar = modal ampliado */
  variant?: "inline" | "sidebar";
  zoomPct?: number;
  onZoomPctChange?: (pct: number) => void;
  /** Selección controlada desde panel externo de textos */
  seleccion?: string | null;
  onSeleccionChange?: (id: string | null) => void;
  /** Oculta capas/toolbar/contenido internos (panel de textos aparte) */
  panelExterno?: boolean;
  onCamposPresentesChange?: (ids: Set<CampoDiagramacionId>) => void;
  onGraficosPresentesChange?: (ids: string[]) => void;
}

function parseMatrix(el: Element): { tx: number; ty: number } | null {
  const tr = el.getAttribute("transform") || "";
  const m = tr.match(/matrix\([^,]+,[^,]+,[^,]+,[^,]+,([^,]+),([^)]+)\)/);
  if (m) return { tx: parseFloat(m[1]), ty: parseFloat(m[2]) };
  return null;
}

function parseFill(el: Element): string {
  const style = el.getAttribute("style") || "";
  const sm = style.match(/fill:([^;'"]+)/);
  if (sm) return sm[1].trim();
  const attr = el.getAttribute("fill");
  if (attr) return attr;
  return "#000000";
}

function screenRectFromSvgEl(
  root: HTMLElement,
  svg: SVGSVGElement,
  el: SVGGraphicsElement,
): Omit<CampoMedido, "id" | "presente" | "kind"> | null {
  const rootRect = root.getBoundingClientRect();
  const ctm = el.getScreenCTM();
  if (!ctm) return null;
  let bbox: DOMRect | SVGRect;
  try {
    bbox = el.getBBox();
  } catch {
    return null;
  }
  const pt = svg.createSVGPoint();
  pt.x = bbox.x;
  pt.y = bbox.y;
  const tl = pt.matrixTransform(ctm);
  pt.x = bbox.x + bbox.width;
  pt.y = bbox.y + bbox.height;
  const br = pt.matrixTransform(ctm);
  const mtx = parseMatrix(el) ?? { tx: 0, ty: 0 };
  return {
    left: tl.x - rootRect.left,
    top: tl.y - rootRect.top,
    width: Math.max(12, br.x - tl.x),
    height: Math.max(10, br.y - tl.y),
    tx: mtx.tx,
    ty: mtx.ty,
    color: parseFill(el),
  };
}

function deltaScreenToSvg(svg: SVGSVGElement, dx: number, dy: number): { dx: number; dy: number } {
  const ctm = svg.getScreenCTM();
  if (!ctm) return { dx: 0, dy: 0 };
  const inv = ctm.inverse();
  const pt = svg.createSVGPoint();
  pt.x = 0;
  pt.y = 0;
  const o = pt.matrixTransform(inv);
  pt.x = dx;
  pt.y = dy;
  const d = pt.matrixTransform(inv);
  return { dx: d.x - o.x, dy: d.y - o.y };
}

function clampPct(n: number) {
  return Math.max(50, Math.min(100, Math.round(n)));
}

function clampEscala(n: number) {
  return Math.max(0.6, Math.min(1.8, Math.round(n * 100) / 100));
}

type ResizeHandle = "nw" | "ne" | "sw" | "se";

const HANDLES: { id: ResizeHandle; cursor: string }[] = [
  { id: "nw", cursor: "nw-resize" },
  { id: "ne", cursor: "ne-resize" },
  { id: "sw", cursor: "sw-resize" },
  { id: "se", cursor: "se-resize" },
];

function handlePos(h: ResizeHandle, box: CampoMedido) {
  const s = 6;
  return {
    left: h.includes("w") ? box.left - s : box.left + box.width - s,
    top: h.includes("n") ? box.top - s : box.top + box.height - s,
  };
}

/** Workspace: panel de capas + canvas con bloques arrastrables. */
export function EtiquetaDiagramacionWorkspace({
  containerRef,
  svgKey,
  diagramacion,
  diagramacionGraficos,
  datos,
  enabled,
  onPatchDiagramacion,
  onPatchGraficos,
  onPatchDatos,
  children,
  variant = "sidebar",
  zoomPct = 100,
  onZoomPctChange,
  seleccion: seleccionProp,
  onSeleccionChange,
  panelExterno = false,
  onCamposPresentesChange,
  onGraficosPresentesChange,
}: Props) {
  const [seleccionLocal, setSeleccionLocal] = useState<string | null>("b1");
  const seleccion = seleccionProp !== undefined ? seleccionProp : seleccionLocal;
  const setSeleccion = useCallback(
    (id: string | null) => {
      if (seleccionProp === undefined) setSeleccionLocal(id);
      onSeleccionChange?.(id);
    },
    [seleccionProp, onSeleccionChange],
  );
  const [arrastrando, setArrastrando] = useState(false);
  const [capasVisibles, setCapasVisibles] = useState(variant !== "inline" && !panelExterno);
  const [campos, setCampos] = useState<CampoMedido[]>([]);
  const dragRef = useRef<{
    id: string;
    kind: "texto" | "grafico";
    startX: number;
    startY: number;
    baseTx: number;
    baseTy: number;
    pointerId: number;
  } | null>(null);
  const resizeRef = useRef<{
    handle: ResizeHandle;
    id: CampoDiagramacionId;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    baseEscala: number;
    fullW?: number;
    baseAnchoPct?: number;
  } | null>(null);

  const b1Pct = b1AnchoPctEfectivo(diagramacion, datos.b1_ancho_pct);
  const anchoMm = datos.ancho_mm ?? 76;
  const altoMm = datos.alto_mm ?? 66;
  const canvas = formatoCanvasPx(anchoMm, altoMm, zoomPct);

  const medir = useCallback(() => {
    const root = containerRef.current;
    if (!root || !enabled) {
      setCampos([]);
      return;
    }
    const svg = root.querySelector("svg");
    if (!svg) {
      setCampos([]);
      return;
    }

    const medidos: CampoMedido[] = [];
    const vistosTexto = new Set<string>();
    svg.querySelectorAll<SVGGraphicsElement>("[data-mckenna-campo]").forEach((el) => {
      const id = el.getAttribute("data-mckenna-campo");
      if (!id || vistosTexto.has(id)) return;
      vistosTexto.add(id);
      const rect = screenRectFromSvgEl(root, svg, el);
      if (!rect) return;
      const ov = diagramacion?.[id as CampoDiagramacionId];
      medidos.push({
        id,
        kind: "texto",
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        tx: ov?.x ?? rect.tx,
        ty: ov?.y ?? rect.ty,
        color: ov?.color ?? rect.color,
        presente: true,
      });
    });

    svg.querySelectorAll<SVGGraphicsElement>("[data-mckenna-grafico]").forEach((el) => {
      const id = el.getAttribute("data-mckenna-grafico");
      if (!id) return;
      const rect = screenRectFromSvgEl(root, svg, el);
      if (!rect) return;
      const ov = diagramacionGraficos?.[id];
      medidos.push({
        id,
        kind: "grafico",
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        tx: ov?.x ?? 0,
        ty: ov?.y ?? 0,
        color: "#64748b",
        presente: true,
      });
    });

    for (const def of CAMPOS_DIAGRAMACION) {
      if (!medidos.some((c) => c.id === def.id)) {
        medidos.push({
          id: def.id,
          kind: "texto",
          left: 0,
          top: 0,
          width: 0,
          height: 0,
          tx: 0,
          ty: 0,
          color: "#000000",
          presente: false,
        });
      }
    }
    setCampos(medidos);
    if (onCamposPresentesChange) {
      onCamposPresentesChange(
        new Set(
          medidos
            .filter((c) => c.presente && c.kind === "texto")
            .map((c) => c.id as CampoDiagramacionId),
        ),
      );
    }
    if (onGraficosPresentesChange) {
      onGraficosPresentesChange(
        medidos.filter((c) => c.presente && c.kind === "grafico").map((c) => c.id),
      );
    }
  }, [
    containerRef,
    enabled,
    diagramacion,
    diagramacionGraficos,
    svgKey,
    onCamposPresentesChange,
    onGraficosPresentesChange,
  ]);

  useEffect(() => {
    medir();
    const root = containerRef.current;
    if (!root) return;
    const obs = new ResizeObserver(() => medir());
    obs.observe(root);
    return () => obs.disconnect();
  }, [medir, containerRef]);

  useEffect(() => {
    if (!dragRef.current) return;
    const root = containerRef.current;
    const svg = root?.querySelector("svg");
    if (!svg) return;

    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d || ev.pointerId !== d.pointerId) return;
      const delta = deltaScreenToSvg(svg, ev.clientX - d.startX, ev.clientY - d.startY);
      const nx = Math.round((d.baseTx + delta.dx) * 100) / 100;
      const ny = Math.round((d.baseTy + delta.dy) * 100) / 100;
      if (d.kind === "grafico") {
        onPatchGraficos?.(patchDiagramacionGraficos(diagramacionGraficos, d.id, { x: nx, y: ny }));
      } else {
        onPatchDiagramacion(
          patchDiagramacion(diagramacion, d.id as CampoDiagramacionId, { x: nx, y: ny }),
        );
      }
    };
    const onUp = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d || ev.pointerId !== d.pointerId) return;
      dragRef.current = null;
      setArrastrando(false);
      requestAnimationFrame(() => medir());
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [containerRef, diagramacion, diagramacionGraficos, onPatchDiagramacion, onPatchGraficos, medir]);

  useEffect(() => {
    if (!resizeRef.current) return;
    const onMove = (ev: PointerEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      const dx = ev.clientX - r.startX;
      const dy = ev.clientY - r.startY;
      let scaleX = 1;
      let scaleY = 1;
      if (r.handle.includes("e")) scaleX = (r.startW + dx) / r.startW;
      if (r.handle.includes("w")) scaleX = (r.startW - dx) / r.startW;
      if (r.handle.includes("s")) scaleY = (r.startH + dy) / r.startH;
      if (r.handle.includes("n")) scaleY = (r.startH - dy) / r.startH;
      scaleX = Math.max(0.4, scaleX);
      scaleY = Math.max(0.4, scaleY);
      const factor = clampEscala(r.baseEscala * (scaleX + scaleY) / 2);

      const patches: CampoDiagramacion = { escala: factor };
      if (r.id === "b1" && r.fullW && r.baseAnchoPct != null) {
        let newW = r.startW;
        if (r.handle.includes("e")) newW = r.startW + dx;
        if (r.handle.includes("w")) newW = r.startW - dx;
        const pct = clampPct((Math.max(r.fullW * 0.5, newW) / r.fullW) * 100);
        patches.ancho_pct = pct;
        onPatchDatos?.({ b1_ancho_pct: pct });
      }
      onPatchDiagramacion(patchDiagramacion(diagramacion, r.id, patches));
    };
    const onUp = () => {
      resizeRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [diagramacion, onPatchDiagramacion, onPatchDatos]);

type CampoMedidoTexto = CampoMedido & { id: CampoDiagramacionId; kind: "texto" };

  const seleccionado = useMemo((): CampoMedidoTexto | null => {
    const c = campos.find((c) => c.id === seleccion && c.presente);
    return c && c.kind === "texto" ? (c as CampoMedidoTexto) : null;
  }, [campos, seleccion]);

  const graficoSel = useMemo(() => {
    const c = campos.find((c) => c.id === seleccion && c.presente && c.kind === "grafico");
    return c ?? null;
  }, [campos, seleccion]);

  const cfgSel =
    seleccion && !esIdGrafico(seleccion)
      ? diagramacion?.[seleccion as CampoDiagramacionId]
      : undefined;
  const editorTexto =
    seleccion && !esIdGrafico(seleccion) ? editorTextoCampo(seleccion as CampoDiagramacionId) : undefined;
  const escalaSel =
    seleccion && !esIdGrafico(seleccion)
      ? escalaEfectiva(diagramacion, seleccion as CampoDiagramacionId)
      : 1;

  if (!enabled) {
    return <div className="h-full overflow-auto">{children}</div>;
  }

  const capasList = (
    <ul className="space-y-0.5">
      {CAMPOS_DIAGRAMACION.map((def) => {
        const m = campos.find((c) => c.id === def.id);
        const activo = seleccion === def.id;
        const ausente = !m?.presente;
        return (
          <li key={def.id}>
            <button
              type="button"
              disabled={ausente}
              onClick={() => setSeleccion(def.id)}
              className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left transition ${
                activo
                  ? "bg-accent/15 font-semibold text-accent"
                  : ausente
                    ? "cursor-not-allowed text-muted/40"
                    : "hover:bg-surface-hover text-ink"
              }`}
            >
              <span className="truncate">{def.label}</span>
              {variant === "sidebar" ? (
                <span className="text-[9px] text-muted">{def.zona}</span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );

  const zoomBar = onZoomPctChange ? (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <span className="text-[10px] text-muted">
        {anchoMm}×{altoMm} mm
      </span>
      <div className="flex items-center gap-1 rounded-lg border border-border bg-surface px-2 py-1">
      <button
        type="button"
        onClick={() => onZoomPctChange(Math.max(50, zoomPct - 10))}
        className="rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-hover"
      >
        −
      </button>
      <span className="min-w-[44px] text-center text-[10px] font-semibold">{zoomPct}%</span>
      <button
        type="button"
        onClick={() => onZoomPctChange(Math.min(220, zoomPct + 10))}
        className="rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-hover"
      >
        +
      </button>
      <button
        type="button"
        onClick={() => onZoomPctChange(100)}
        className="rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold hover:bg-surface-hover"
      >
        100%
      </button>
      </div>
    </div>
  ) : null;

  const canvasBlock = (
    <div className="min-h-0 flex-1 overflow-auto rounded-lg bg-[#e8eaed] p-3">
      <div className="flex min-h-full items-center justify-center">
        <div
          ref={containerRef}
          className={`relative shrink-0 overflow-hidden rounded-sm border border-border/80 bg-white shadow-md ${
            variant === "inline" ? "" : "mx-auto max-w-[920px]"
          }`}
          style={{ width: `${canvas.width}px`, height: `${canvas.height}px`, minWidth: "160px" }}
        >
          {children}
          {campos
            .filter((c) => c.presente)
            .map((c) => {
              const activo = seleccion === c.id;
              const label = c.kind === "grafico" ? labelElementoEditor(c.id) : labelCampoDiagramacion(c.id as CampoDiagramacionId);
              return (
                <button
                  key={`${c.kind}-${c.id}`}
                  type="button"
                  aria-label={label}
                  className={`absolute z-20 touch-none select-none ${
                    activo
                      ? c.kind === "grafico"
                        ? "border-2 border-violet-500 bg-violet-500/10"
                        : "border-2 border-accent bg-accent/10"
                      : c.kind === "grafico"
                        ? "border border-dashed border-violet-400/60 bg-transparent hover:bg-violet-500/5"
                        : "border border-dashed border-accent/50 bg-transparent hover:bg-accent/5"
                  }`}
                  style={{
                    left: c.left,
                    top: c.top,
                    width: c.width,
                    height: c.height,
                    cursor: arrastrando && activo ? "grabbing" : "grab",
                  }}
                  onPointerDown={(ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
                    setSeleccion(c.id);
                    setArrastrando(true);
                    const baseTx =
                      c.kind === "grafico"
                        ? (diagramacionGraficos?.[c.id]?.x ?? 0)
                        : (diagramacion?.[c.id as CampoDiagramacionId]?.x ?? c.tx);
                    const baseTy =
                      c.kind === "grafico"
                        ? (diagramacionGraficos?.[c.id]?.y ?? 0)
                        : (diagramacion?.[c.id as CampoDiagramacionId]?.y ?? c.ty);
                    dragRef.current = {
                      id: c.id,
                      kind: c.kind,
                      startX: ev.clientX,
                      startY: ev.clientY,
                      baseTx,
                      baseTy,
                      pointerId: ev.pointerId,
                    };
                  }}
                />
              );
            })}
          {seleccionado &&
            HANDLES.map((h) => {
              const pos = handlePos(h.id, seleccionado);
              return (
                <button
                  key={h.id}
                  type="button"
                  aria-label={`Redimensionar ${h.id}`}
                  className="absolute z-30 h-3 w-3 rounded-full border-2 border-white bg-accent shadow"
                  style={{ ...pos, cursor: h.cursor }}
                  onPointerDown={(ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    const baseEscala = escalaEfectiva(diagramacion, seleccionado.id);
                    const next: NonNullable<typeof resizeRef.current> = {
                      handle: h.id,
                      id: seleccionado.id,
                      startX: ev.clientX,
                      startY: ev.clientY,
                      startW: seleccionado.width,
                      startH: seleccionado.height,
                      baseEscala,
                    };
                    if (seleccionado.id === "b1") {
                      const guia = containerRef.current?.querySelector(
                        "#mckenna-b1-guia",
                      ) as SVGGraphicsElement | null;
                      const root = containerRef.current;
                      const svg = root?.querySelector("svg");
                      if (guia && root && svg) {
                        const rect = screenRectFromSvgEl(root, svg, guia);
                        if (rect) {
                          const dataFull = parseFloat(
                            guia.getAttribute("data-ancho-full") || "",
                          );
                          next.fullW =
                            Number.isFinite(dataFull) && dataFull > 0
                              ? (rect.width / b1Pct) * 100
                              : rect.width / (b1Pct / 100);
                          next.baseAnchoPct = b1Pct;
                        }
                      }
                    }
                    resizeRef.current = next;
                  }}
                />
              );
            })}
        </div>
      </div>
    </div>
  );

  const contenidoBlock =
    seleccionado && editorTexto && onPatchDatos ? (
      <label className="block rounded-lg border border-border bg-surface-panel p-2">
        <span className="text-[10px] font-semibold text-muted">Contenido · {labelCampoDiagramacion(seleccionado.id)}</span>
        {editorTexto.hint && (
          <span className="mt-0.5 block text-[9px] leading-snug text-muted">{editorTexto.hint}</span>
        )}
        {editorTexto.multiline ? (
          <textarea
            value={editorTexto.getTexto(datos)}
            onChange={(e) => onPatchDatos(editorTexto.patchTexto(e.target.value, datos))}
            rows={editorTexto.filas ?? 3}
            className="mt-1 w-full resize-y rounded border border-border bg-white p-2 text-xs leading-snug"
          />
        ) : (
          <input
            type="text"
            value={editorTexto.getTexto(datos)}
            onChange={(e) => onPatchDatos(editorTexto.patchTexto(e.target.value, datos))}
            className="mt-1 w-full rounded border border-border bg-white px-2 py-1.5 text-xs"
          />
        )}
      </label>
    ) : null;

  if (variant === "inline") {
    if (panelExterno) {
      return (
        <div className="flex h-full min-h-[min(60vh,800px)] flex-col gap-2">
          {zoomBar && <div className="flex justify-end">{zoomBar}</div>}
          {canvasBlock}
        </div>
      );
    }
    return (
      <div className="flex h-full min-h-[min(72vh,900px)] flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <EtiquetaTextoToolbar
            campoId={seleccion && !esIdGrafico(seleccion) ? (seleccion as CampoDiagramacionId) : null}
            cfg={cfgSel}
            colorFallback={seleccionado?.color ?? "#000000"}
            escala={escalaSel}
            b1AnchoPct={seleccion === "b1" ? b1Pct : undefined}
            tx={cfgSel?.x ?? seleccionado?.tx ?? graficoSel?.tx ?? 0}
            ty={cfgSel?.y ?? seleccionado?.ty ?? graficoSel?.ty ?? 0}
            onPatch={(p) => {
              if (!seleccion) return;
              if (esIdGrafico(seleccion)) {
                onPatchGraficos?.(
                  patchDiagramacionGraficos(diagramacionGraficos, seleccion, {
                    x: p.x,
                    y: p.y,
                  }),
                );
                return;
              }
              onPatchDiagramacion(patchCampoToolbar(diagramacion, seleccion as CampoDiagramacionId, p));
              if (p.ancho_pct != null) onPatchDatos?.({ b1_ancho_pct: p.ancho_pct });
            }}
          />
          <button
            type="button"
            onClick={() => setCapasVisibles((v) => !v)}
            className="shrink-0 rounded-lg border border-border bg-surface px-2.5 py-1 text-[10px] font-semibold hover:bg-surface-hover"
          >
            {capasVisibles ? "Ocultar capas" : "Capas"}
          </button>
          {onZoomPctChange && (
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={() => onZoomPctChange(Math.max(80, zoomPct - 10))}
                className="rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-hover"
              >
                −
              </button>
              <span className="min-w-[40px] text-center text-[10px] font-semibold">{zoomPct}%</span>
              <button
                type="button"
                onClick={() => onZoomPctChange(Math.min(220, zoomPct + 10))}
                className="rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-hover"
              >
                +
              </button>
            </div>
          )}
        </div>
        <div className={`grid min-h-0 flex-1 gap-2 ${capasVisibles ? "grid-cols-[minmax(120px,150px)_1fr]" : "grid-cols-1"}`}>
          {capasVisibles && (
          <aside className="overflow-y-auto rounded-lg border border-border bg-surface p-2 text-xs">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted">Capas</p>
            {capasList}
            {seleccionado && (
              <button
                type="button"
                onClick={() => {
                  const next = { ...(diagramacion ?? {}) };
                  delete next[seleccionado.id];
                  onPatchDiagramacion(next);
                }}
                className="mt-2 w-full rounded border border-border px-2 py-1 text-[10px] hover:bg-surface-hover"
              >
                Restablecer bloque
              </button>
            )}
          </aside>
          )}
          {canvasBlock}
        </div>
        {contenidoBlock}
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[240px_1fr] gap-2">
      <aside className="flex flex-col gap-2 overflow-y-auto rounded-lg border border-border bg-surface p-2 text-xs">
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Diagramación</p>
        <p className="text-[10px] leading-snug text-muted">
          Selecciona un bloque, arrástralo en la etiqueta o ajusta color y posición.
        </p>
        {capasList}

        {seleccionado && (
          <div className="mt-1 space-y-2 rounded border border-border bg-surface-panel p-2">
            <p className="font-semibold text-ink">{labelCampoDiagramacion(seleccionado.id)}</p>

            <label className="flex items-center gap-2">
              <span className="w-10 shrink-0 text-muted">Color</span>
              <input
                type="color"
                value={
                  (cfgSel?.color ?? seleccionado.color).match(/^#[0-9A-Fa-f]{6}$/)
                    ? (cfgSel?.color ?? seleccionado.color)
                    : "#000000"
                }
                onChange={(e) =>
                  onPatchDiagramacion(
                    patchDiagramacion(diagramacion, seleccionado.id, { color: e.target.value }),
                  )
                }
                className="h-7 w-10 shrink-0 cursor-pointer rounded border border-border bg-white p-0"
              />
              <input
                type="text"
                value={cfgSel?.color ?? seleccionado.color}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  if (/^#[0-9A-Fa-f]{6}$/.test(v)) {
                    onPatchDiagramacion(
                      patchDiagramacion(diagramacion, seleccionado.id, { color: v }),
                    );
                  }
                }}
                className="min-w-0 flex-1 rounded border border-border bg-white px-1.5 py-1 font-mono text-[10px]"
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[10px] text-muted">Escala</span>
                <input
                  type="number"
                  step="0.05"
                  min={0.6}
                  max={1.8}
                  value={cfgSel?.escala ?? escalaSel}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (!Number.isFinite(v)) return;
                    onPatchDiagramacion(
                      patchDiagramacion(diagramacion, seleccionado.id, {
                        escala: clampEscala(v),
                      }),
                    );
                  }}
                  className="mt-0.5 w-full rounded border border-border bg-white px-1.5 py-1 font-mono text-[10px]"
                />
              </label>
              {seleccionado.id === "b1" && (
                <label className="block">
                  <span className="text-[10px] text-muted">Ancho %</span>
                  <input
                    type="number"
                    step={1}
                    min={50}
                    max={100}
                    value={b1Pct}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (!Number.isFinite(v)) return;
                      const pct = clampPct(v);
                      onPatchDiagramacion(
                        patchDiagramacion(diagramacion, "b1", { ancho_pct: pct }),
                      );
                      onPatchDatos?.({ b1_ancho_pct: pct });
                    }}
                    className="mt-0.5 w-full rounded border border-border bg-white px-1.5 py-1 font-mono text-[10px]"
                  />
                </label>
              )}
            </div>

            {editorTexto && onPatchDatos && (
              <label className="block">
                <span className="text-[10px] text-muted">Contenido</span>
                {editorTexto.hint && (
                  <span className="mt-0.5 block text-[9px] leading-snug text-muted">
                    {editorTexto.hint}
                  </span>
                )}
                {editorTexto.multiline ? (
                  <textarea
                    value={editorTexto.getTexto(datos)}
                    onChange={(e) =>
                      onPatchDatos(editorTexto.patchTexto(e.target.value, datos))
                    }
                    rows={editorTexto.filas ?? 3}
                    className="mt-0.5 w-full resize-y rounded border border-border bg-white p-1.5 text-[10px] leading-snug"
                  />
                ) : (
                  <input
                    type="text"
                    value={editorTexto.getTexto(datos)}
                    onChange={(e) =>
                      onPatchDatos(editorTexto.patchTexto(e.target.value, datos))
                    }
                    className="mt-0.5 w-full rounded border border-border bg-white px-1.5 py-1 text-[10px]"
                  />
                )}
              </label>
            )}

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[10px] text-muted">X</span>
                <input
                  type="number"
                  step="0.1"
                  value={cfgSel?.x ?? seleccionado.tx}
                  onChange={(e) => {
                    const x = parseFloat(e.target.value);
                    if (!Number.isFinite(x)) return;
                    onPatchDiagramacion(
                      patchDiagramacion(diagramacion, seleccionado.id, { x }),
                    );
                  }}
                  className="mt-0.5 w-full rounded border border-border bg-white px-1.5 py-1 font-mono text-[10px]"
                />
              </label>
              <label className="block">
                <span className="text-[10px] text-muted">Y</span>
                <input
                  type="number"
                  step="0.1"
                  value={cfgSel?.y ?? seleccionado.ty}
                  onChange={(e) => {
                    const y = parseFloat(e.target.value);
                    if (!Number.isFinite(y)) return;
                    onPatchDiagramacion(
                      patchDiagramacion(diagramacion, seleccionado.id, { y }),
                    );
                  }}
                  className="mt-0.5 w-full rounded border border-border bg-white px-1.5 py-1 font-mono text-[10px]"
                />
              </label>
            </div>

            <button
              type="button"
              onClick={() => {
                const next = { ...(diagramacion ?? {}) };
                delete next[seleccionado.id];
                onPatchDiagramacion(next);
              }}
              className="w-full rounded border border-border px-2 py-1 text-[10px] hover:bg-surface-hover"
            >
              Restablecer posición/color
            </button>
          </div>
        )}
      </aside>
      {canvasBlock}
    </div>
  );
}
