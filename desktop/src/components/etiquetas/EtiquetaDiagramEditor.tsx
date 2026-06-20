import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { EtiquetaTextoToolbar, patchCampoToolbar } from "./EtiquetaTextoToolbar";
import { solicitarTextoMagico } from "../../lib/textoMagicoApi";
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
  FUENTE_ETIQUETA,
  FUENTE_ETIQUETA_FAMILY,
  leerTextoCampoSvg,
  pesoFuenteCampoSvg,
  alineacionCssEditor,
  ocultarCampoDiagramacion,
  campoDiagramacionOculto,
  patchDiagramacion,
  patchDiagramacionGraficos,
  esIdGrafico,
  boundsPx,
  deltaAlinearBounds,
  ALINEACIONES_LIENZO,
  type AlineacionLienzo,
} from "../../lib/etiquetasDiagramacion";

type CampoMedido = {
  id: string;
  kind: "texto" | "grafico";
  left: number;
  top: number;
  width: number;
  height: number;
  /** Posición SVG original (sin overrides de diagramación). */
  baseTx: number;
  baseTy: number;
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
  /** Solo líneas decorativas: sin overlays ni edición de texto */
  soloLineas?: boolean;
  /** En edición desde cero, solo detecta/edita campos txt_* */
  soloTextosLibres?: boolean;
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
): Omit<CampoMedido, "id" | "kind" | "presente"> | null {
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
  // Soporta matrices invertidas/rotadas (AI/PDF): usamos las 4 esquinas y
  // calculamos caja por min/max para que overlays y nodos no se descuadren.
  const corners: Array<{ x: number; y: number }> = [];
  for (const [x, y] of [
    [bbox.x, bbox.y],
    [bbox.x + bbox.width, bbox.y],
    [bbox.x, bbox.y + bbox.height],
    [bbox.x + bbox.width, bbox.y + bbox.height],
  ]) {
    pt.x = x;
    pt.y = y;
    const p = pt.matrixTransform(ctm);
    corners.push({ x: p.x, y: p.y });
  }
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const mtx = parseMatrix(el) ?? { tx: 0, ty: 0 };
  return {
    left: left - rootRect.left,
    top: top - rootRect.top,
    width: Math.max(12, right - left),
    height: Math.max(10, bottom - top),
    baseTx: mtx.tx,
    baseTy: mtx.ty,
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

function svgDeltaToScreen(svg: SVGSVGElement, dx: number, dy: number): { dx: number; dy: number } {
  const ctm = svg.getScreenCTM();
  if (!ctm) return { dx: 0, dy: 0 };
  const pt = svg.createSVGPoint();
  pt.x = 0;
  pt.y = 0;
  const o = pt.matrixTransform(ctm);
  pt.x = dx;
  pt.y = dy;
  const d = pt.matrixTransform(ctm);
  return { dx: d.x - o.x, dy: d.y - o.y };
}

function svgPointToScreen(
  root: HTMLElement,
  svg: SVGSVGElement,
  x: number,
  y: number,
): { left: number; top: number } | null {
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const pt = svg.createSVGPoint();
  pt.x = x;
  pt.y = y;
  const p = pt.matrixTransform(ctm);
  const rootRect = root.getBoundingClientRect();
  return { left: p.x - rootRect.left, top: p.y - rootRect.top };
}

function screenPointToSvg(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const inv = ctm.inverse();
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const p = pt.matrixTransform(inv);
  return { x: p.x, y: p.y };
}

function overlayPosicionCampo(
  c: CampoMedido,
  svg: SVGSVGElement | null,
  diagramacion?: DiagramacionEtiqueta,
  diagramacionGraficos?: DiagramacionGraficos,
): { left: number; top: number } {
  if (!svg) return { left: c.left, top: c.top };
  if (c.kind === "grafico") {
    const ov = diagramacionGraficos?.[c.id];
    const d = svgDeltaToScreen(svg, ov?.x ?? 0, ov?.y ?? 0);
    return { left: c.left + d.dx, top: c.top + d.dy };
  }
  const ov = diagramacion?.[c.id as CampoDiagramacionId];
  const d = svgDeltaToScreen(
    svg,
    (ov?.x ?? c.baseTx) - c.baseTx,
    (ov?.y ?? c.baseTy) - c.baseTy,
  );
  return { left: c.left + d.dx, top: c.top + d.dy };
}

const UMBRAL_ARRASTRE_PX = 4;

function clampPct(n: number) {
  return Math.max(50, Math.min(100, Math.round(n)));
}

function clampEscala(n: number) {
  return Math.max(0.6, Math.min(1.8, Math.round(n * 100) / 100));
}

type ResizeHandle = "nw" | "ne" | "sw" | "se";

/** Nodos estilo Illustrator: cuadrado pequeño, área de agarre amplia. */
const NODO_VIS_PX = 6;
const NODO_HIT_PX = 14;
const MARCO_SELECCION_CSS = "1px solid rgba(1, 109, 130, 0.82)";

const HANDLES: { id: ResizeHandle; cursor: string }[] = [
  { id: "nw", cursor: "nw-resize" },
  { id: "ne", cursor: "ne-resize" },
  { id: "sw", cursor: "sw-resize" },
  { id: "se", cursor: "se-resize" },
];

function posicionAsaRedimension(h: ResizeHandle, box: CampoMedido) {
  const half = NODO_HIT_PX / 2;
  return {
    left: h.includes("w") ? box.left - half : box.left + box.width - half,
    top: h.includes("n") ? box.top - half : box.top + box.height - half,
  };
}

function AsaRedimension({
  id,
  cursor,
  pos,
  onPointerDown,
}: {
  id: string;
  cursor: string;
  pos: { left: number; top: number };
  onPointerDown: (ev: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Redimensionar ${id}`}
      className="absolute z-30 flex items-center justify-center border-0 bg-transparent p-0 touch-none"
      style={{
        left: pos.left,
        top: pos.top,
        width: NODO_HIT_PX,
        height: NODO_HIT_PX,
        cursor,
      }}
      onPointerDown={onPointerDown}
    >
      <span
        className="block shrink-0 rounded-[1px] border border-[#016d82]/85 bg-white shadow-[0_0_0_0.5px_rgba(255,255,255,0.95)] transition-[transform,border-color] hover:scale-110 hover:border-[#016d82]"
        style={{ width: NODO_VIS_PX, height: NODO_VIS_PX }}
      />
    </button>
  );
}

type CampoMedidoTexto = CampoMedido & { id: string; kind: "texto" };

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
  soloLineas = false,
  soloTextosLibres = false,
  onCamposPresentesChange,
  onGraficosPresentesChange,
}: Props) {
  const [seleccionLocal, setSeleccionLocal] = useState<string | null>(null);
  const seleccion = seleccionProp !== undefined ? seleccionProp : seleccionLocal;
  const setSeleccion = useCallback(
    (id: string | null) => {
      if (seleccionProp === undefined) setSeleccionLocal(id);
      onSeleccionChange?.(id);
    },
    [seleccionProp, onSeleccionChange],
  );
  const [arrastrando, setArrastrando] = useState(false);
  const [modoDibujoCaja, setModoDibujoCaja] = useState(false);
  const [cajaPreview, setCajaPreview] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const [textoEditando, setTextoEditando] = useState<string | null>(null);
  const [hoverCampo, setHoverCampo] = useState<string | null>(null);
  const [escrituraMagicaCargando, setEscrituraMagicaCargando] = useState(false);
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
    moved: boolean;
  } | null>(null);
  const resizeRef = useRef<{
    handle: ResizeHandle;
    id: string;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    baseEscala: number;
    baseAnchoCaja?: number;
    baseAltoCaja?: number;
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
    if (!soloLineas) {
    const vistosTexto = new Set<string>();
    svg.querySelectorAll<SVGGraphicsElement>("[data-mckenna-campo]").forEach((el) => {
      const id = el.getAttribute("data-mckenna-campo");
      if (!id || vistosTexto.has(id)) return;
      if (soloTextosLibres && !id.startsWith("txt_")) return;
      if (campoDiagramacionOculto(diagramacion, id)) return;
      vistosTexto.add(id);
      const rect = screenRectFromSvgEl(root, svg, el);
      if (!rect) return;
      const ov = diagramacion?.[id as CampoDiagramacionId];
      if (id.startsWith("txt_") && ov?.ancho_caja && ov?.alto_caja) {
        const escala = Math.max(0.6, Math.min(1.8, Number(ov.escala ?? 1)));
        const fs = 9 * escala;
        const p0 = svgPointToScreen(root, svg, ov.x ?? rect.tx, ov.y ?? rect.ty);
        const d = svgDeltaToScreen(svg, Number(ov.ancho_caja) || 0, Number(ov.alto_caja) || 0);
        const width = Math.max(24, Math.abs(d.dx));
        const height = Math.max(14, Math.abs(d.dy));
        const anchor = ov.alineacion ?? "left";
        const baseLeft = p0?.left ?? rect.left;
        const left =
          anchor === "center"
            ? baseLeft - width * 0.5
            : anchor === "right"
              ? baseLeft - width
              : baseLeft;
        const top = (p0?.top ?? rect.top) - fs - 0.8;
        medidos.push({
          id,
          kind: "texto",
          left,
          top,
          width,
          height,
          baseTx: rect.tx,
          baseTy: rect.ty,
          tx: ov.x ?? rect.tx,
          ty: ov.y ?? rect.ty,
          color: ov.color ?? rect.color,
          presente: true,
        });
        return;
      }
      medidos.push({
        id,
        kind: "texto",
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        baseTx: rect.tx,
        baseTy: rect.ty,
        tx: ov?.x ?? rect.tx,
        ty: ov?.y ?? rect.ty,
        color: ov?.color ?? rect.color,
        presente: true,
      });
    });
    }

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
        baseTx: 0,
        baseTy: 0,
        tx: ov?.x ?? 0,
        ty: ov?.y ?? 0,
        color: "#64748b",
        presente: true,
      });
    });

    if (!soloLineas && !soloTextosLibres) {
    for (const def of CAMPOS_DIAGRAMACION) {
      if (!medidos.some((c) => c.id === def.id)) {
        medidos.push({
          id: def.id,
          kind: "texto",
          left: 0,
          top: 0,
          width: 0,
          height: 0,
          baseTx: 0,
          baseTy: 0,
          tx: 0,
          ty: 0,
          color: "#000000",
          presente: false,
        });
      }
    }
    }
    // Permite crear/arrastrar txt_* inmediatamente, incluso antes de que el
    // preview backend reinyecte el nodo <text data-mckenna-campo="txt_n">.
    for (const [id, cfgRaw] of Object.entries(diagramacion ?? {})) {
      if (!id.startsWith("txt_")) continue;
      if (medidos.some((c) => c.id === id)) continue;
      if (campoDiagramacionOculto(diagramacion, id)) continue;
      const cfg = (cfgRaw ?? {}) as CampoDiagramacion;
      const tx = Number(cfg.x);
      const ty = Number(cfg.y);
      if (!Number.isFinite(tx) || !Number.isFinite(ty)) continue;
      const pos = svgPointToScreen(root, svg, tx, ty);
      if (!pos) continue;
      const escala = Math.max(0.6, Math.min(1.8, Number(cfg.escala ?? 1)));
      const ancho = Math.max(60, Number(cfg.ancho_caja) || 120 * escala);
      const alto = Math.max(18, Number(cfg.alto_caja) || 28 * escala);
      const alineacion = cfg.alineacion ?? "left";
      const left =
        alineacion === "center"
          ? pos.left - ancho * 0.5
          : alineacion === "right"
            ? pos.left - ancho
            : pos.left;
      const top = pos.top - alto * 0.8;
      medidos.push({
        id,
        kind: "texto",
        left,
        top,
        width: ancho,
        height: alto,
        baseTx: tx,
        baseTy: ty,
        tx,
        ty,
        color: cfg.color ?? "#111111",
        presente: true,
      });
    }
    setCampos(medidos);
    if (!soloLineas && onCamposPresentesChange) {
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
    soloLineas,
    soloTextosLibres,
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
      const dist = Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY);
      if (!d.moved && dist < UMBRAL_ARRASTRE_PX) return;
      if (!d.moved) {
        d.moved = true;
        setArrastrando(true);
      }
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
      const esTextoLibre = r.id.startsWith("txt_");
      const patches: CampoDiagramacion = esTextoLibre
        ? {
            ancho_caja: Math.max(18, (r.baseAnchoCaja ?? r.startW) * scaleX),
            alto_caja: Math.max(10, (r.baseAltoCaja ?? r.startH) * scaleY),
          }
        : { escala: factor };
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

  const padAsa = NODO_HIT_PX / 2;

  const iniciarRedimension = useCallback(
    (campo: CampoMedidoTexto, h: ResizeHandle, ev: ReactPointerEvent<HTMLButtonElement>) => {
      ev.preventDefault();
      ev.stopPropagation();
      setSeleccion(campo.id);
      const baseEscala = escalaEfectiva(diagramacion, campo.id);
      const next: NonNullable<typeof resizeRef.current> = {
        handle: h,
        id: campo.id,
        startX: ev.clientX,
        startY: ev.clientY,
        startW: campo.width,
        startH: campo.height,
        baseEscala,
        baseAnchoCaja: Number(diagramacion?.[campo.id]?.ancho_caja) || campo.width,
        baseAltoCaja: Number(diagramacion?.[campo.id]?.alto_caja) || campo.height,
      };
      if (campo.id === "b1") {
        const guia = containerRef.current?.querySelector("#mckenna-b1-guia") as SVGGraphicsElement | null;
        const root = containerRef.current;
        const svg = root?.querySelector("svg");
        if (guia && root && svg) {
          const rect = screenRectFromSvgEl(root, svg, guia);
          if (rect) {
            const dataFull = parseFloat(guia.getAttribute("data-ancho-full") || "");
            next.fullW =
              Number.isFinite(dataFull) && dataFull > 0
                ? (rect.width / b1Pct) * 100
                : rect.width / (b1Pct / 100);
            next.baseAnchoPct = b1Pct;
          }
        }
      }
      resizeRef.current = next;
    },
    [b1Pct, containerRef, diagramacion, setSeleccion],
  );

  const seleccionado = useMemo((): CampoMedidoTexto | null => {
    const c = campos.find((c) => c.id === seleccion && c.presente);
    return c && c.kind === "texto" ? (c as CampoMedidoTexto) : null;
  }, [campos, seleccion]);

  const graficoSel = useMemo(() => {
    const c = campos.find((c) => c.id === seleccion && c.presente && c.kind === "grafico");
    return c ?? null;
  }, [campos, seleccion]);

  const cfgSel = seleccion && !esIdGrafico(seleccion) ? diagramacion?.[seleccion] : undefined;
  const editorTexto =
    seleccion && !esIdGrafico(seleccion) ? editorTextoCampo(seleccion) : undefined;
  const escalaSel =
    seleccion && !esIdGrafico(seleccion)
      ? escalaEfectiva(diagramacion, seleccion as CampoDiagramacionId)
      : 1;

  const edicionInlineActiva = Boolean(panelExterno && onPatchDatos);

  const abrirEdicionTexto = useCallback(
    (campoId: string) => {
      if (!edicionInlineActiva) return;
      const editor = editorTextoCampo(campoId);
      if (!editor || editor.readonly) return;
      const actual = editor.getTexto(datos).trim();
      if (!actual) {
        const desdeSvg = leerTextoCampoSvg(containerRef.current, campoId);
        if (desdeSvg) onPatchDatos!(editor.patchTexto(desdeSvg, datos));
      }
      setSeleccion(campoId);
      setTextoEditando(campoId);
    },
    [edicionInlineActiva, datos, containerRef, onPatchDatos, setSeleccion],
  );

  const eliminarCampoTexto = useCallback(
    (campoId: string) => {
      if (!panelExterno || esIdGrafico(campoId)) return;
      onPatchDiagramacion(ocultarCampoDiagramacion(diagramacion, campoId));
      if (seleccion === campoId) setSeleccion(null);
      if (textoEditando === campoId) setTextoEditando(null);
    },
    [panelExterno, diagramacion, onPatchDiagramacion, seleccion, textoEditando, setSeleccion],
  );

  const eliminarSeleccionado = useCallback(() => {
    if (!seleccion || esIdGrafico(seleccion)) return;
    eliminarCampoTexto(seleccion);
  }, [seleccion, eliminarCampoTexto]);

  const alinearSeleccionAlLienzo = useCallback(
    (modo: AlineacionLienzo) => {
      if (!seleccion) return;
      const root = containerRef.current;
      const svg = root?.querySelector("svg");
      if (!root || !svg) return;
      const campo = campos.find((c) => c.id === seleccion && c.presente);
      if (!campo) return;

      const pos = overlayPosicionCampo(campo, svg, diagramacion, diagramacionGraficos);
      const objeto = boundsPx(pos.left, pos.top, campo.width, campo.height);
      const lienzo = boundsPx(0, 0, root.clientWidth, root.clientHeight);
      const { dx: dxScreen, dy: dyScreen } = deltaAlinearBounds(objeto, lienzo, modo);
      const { dx, dy } = deltaScreenToSvg(svg, dxScreen, dyScreen);

      const currentX =
        campo.kind === "grafico"
          ? (diagramacionGraficos?.[campo.id]?.x ?? 0)
          : (diagramacion?.[campo.id]?.x ?? campo.tx);
      const currentY =
        campo.kind === "grafico"
          ? (diagramacionGraficos?.[campo.id]?.y ?? 0)
          : (diagramacion?.[campo.id]?.y ?? campo.ty);

      const x = Math.round((currentX + dx) * 100) / 100;
      const y = Math.round((currentY + dy) * 100) / 100;

      if (campo.kind === "grafico") {
        onPatchGraficos?.(patchDiagramacionGraficos(diagramacionGraficos, campo.id, { x, y }));
      } else {
        onPatchDiagramacion(patchDiagramacion(diagramacion, campo.id, { x, y }));
      }
      requestAnimationFrame(() => medir());
    },
    [
      seleccion,
      campos,
      containerRef,
      diagramacion,
      diagramacionGraficos,
      onPatchDiagramacion,
      onPatchGraficos,
      medir,
    ],
  );

  const crearCajaTexto = useCallback((opts?: {
    x?: number;
    y?: number;
    escala?: number;
    alineacion?: "left" | "center" | "right";
    anchoCaja?: number;
    altoCaja?: number;
  }) => {
    if (!onPatchDatos) return;
    const existentes = new Set(Object.keys(diagramacion ?? {}));
    let n = 1;
    while (existentes.has(`txt_${n}`)) n += 1;
    const id = `txt_${n}`;
    let xInicial = 20;
    let yInicial = 40;
    const svg = containerRef.current?.querySelector("svg");
    if (svg) {
      // Inserta nuevas cajas en el centro del área visible para evitar que
      // aparezcan "pegadas" al fondo/esquinas en plantillas con transforms AI.
      const vb = svg.viewBox?.baseVal;
      if (vb && vb.width > 0 && vb.height > 0) {
        xInicial = vb.x + vb.width * 0.5;
        yInicial = vb.y + vb.height * 0.5;
      } else {
        const w = Number(svg.getAttribute("width")?.replace(/mm$/i, "") || "");
        const h = Number(svg.getAttribute("height")?.replace(/mm$/i, "") || "");
        if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
          xInicial = w * 0.5;
          yInicial = h * 0.5;
        }
      }
    }
    onPatchDiagramacion(
      patchDiagramacion(diagramacion, id, {
        x: Math.round((opts?.x ?? xInicial) * 1000) / 1000,
        y: Math.round((opts?.y ?? yInicial) * 1000) / 1000,
        color: "#111111",
        escala: clampEscala(opts?.escala ?? 1),
        alineacion: opts?.alineacion ?? "center",
        ancho_caja: opts?.anchoCaja,
        alto_caja: opts?.altoCaja,
      }),
    );
    onPatchDatos({
      textos_campo: {
        ...(datos.textos_campo ?? {}),
        [id]: "Nuevo texto",
      },
    });
    setSeleccion(id);
    // Tipo Canva: crear caja y permitir mover/redimensionar primero.
    // La edición del contenido entra con doble clic.
    setTextoEditando(null);
    return id;
  }, [diagramacion, datos.textos_campo, onPatchDatos, onPatchDiagramacion]);

  const anadirCajaTexto = useCallback(() => {
    if (!onPatchDatos) return;
    setModoDibujoCaja((v) => !v);
    setCajaPreview(null);
  }, [onPatchDatos]);

  const onCanvasPointerDownCrearCaja = useCallback((ev: ReactPointerEvent<HTMLDivElement>) => {
    if (!modoDibujoCaja || !onPatchDatos) return;
    const target = ev.target as HTMLElement | null;
    if (target?.closest("button,input,textarea,select")) return;
    const root = containerRef.current;
    const svg = root?.querySelector("svg");
    if (!root || !svg) return;

    ev.preventDefault();
    ev.stopPropagation();
    const rootRect = root.getBoundingClientRect();
    const sx = ev.clientX - rootRect.left;
    const sy = ev.clientY - rootRect.top;
    setCajaPreview({ left: sx, top: sy, width: 0, height: 0 });

    const onMove = (mv: PointerEvent) => {
      const cx = mv.clientX - rootRect.left;
      const cy = mv.clientY - rootRect.top;
      const left = Math.min(sx, cx);
      const top = Math.min(sy, cy);
      const width = Math.abs(cx - sx);
      const height = Math.abs(cy - sy);
      setCajaPreview({ left, top, width, height });
    };

    const onUp = (up: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);

      setModoDibujoCaja(false);
      setCajaPreview(null);

      const a = screenPointToSvg(svg, ev.clientX, ev.clientY);
      const b = screenPointToSvg(svg, up.clientX, up.clientY);
      if (!a || !b) {
        crearCajaTexto();
        return;
      }
      const minX = Math.min(a.x, b.x);
      const minY = Math.min(a.y, b.y);
      const w = Math.abs(b.x - a.x);
      const h = Math.abs(b.y - a.y);
      // Evita el salto a tamaño 1.8; la altura de la ventana solo ajusta suave.
      const escala = clampEscala(Math.max(0.9, Math.min(1.25, h / 14)));
      const fs = 9 * escala;
      // En matrix(1,0,0,-1,x,y) y es línea base; para quedar dentro de la
      // ventana dibujada ubicamos baseline cerca del borde superior.
      const xTexto = minX + 0.8;
      const yTexto = minY + fs + 0.8;
      crearCajaTexto({
        x: xTexto,
        y: yTexto,
        escala,
        alineacion: "left",
        anchoCaja: Math.max(18, w - 1.6),
        altoCaja: Math.max(10, h - 1.6),
      });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, [modoDibujoCaja, onPatchDatos, containerRef, crearCajaTexto]);

  const escrituraMagica = useCallback(async () => {
    if (!seleccion || esIdGrafico(seleccion) || !onPatchDatos) return;
    const editor = editorTextoCampo(seleccion);
    if (!editor) return;
    const raw = editor.getTexto(datos);
    const esDescripcion =
      seleccion === "b1" || seleccion.startsWith("b1_") || seleccion.startsWith("b1");

    if (esDescripcion) {
      const fragmento =
        [datos.ingrediente, datos.nombre_producto].filter(Boolean).join(" ").trim() ||
        raw.split(/\s+/).slice(0, 8).join(" ");
      const palabras = fragmento
        .toLowerCase()
        .match(/[a-záéíóúüñ0-9]{3,}/gi);
      if (!palabras || palabras.length < 2) return;

      setEscrituraMagicaCargando(true);
      try {
        const res = await solicitarTextoMagico(fragmento, {
          max_chars: 2600,
          contexto_capas: {
            titulo: datos.nombre_producto,
            subtitulo: datos.subtitulo,
          },
          modo_descripcion_mp: true,
        });
        const texto = res.sugerencias?.[0]?.texto?.trim();
        if (texto) {
          onPatchDatos(editor.patchTexto(texto, datos));
          onPatchDiagramacion(
            patchDiagramacion(diagramacion, seleccion, {
              mayusculas: false,
              listado: false,
              interlineado: cfgSel?.interlineado ?? 1.12,
              interletrado: cfgSel?.interletrado ?? 0.1,
            }),
          );
        }
      } catch {
        /* conservar texto actual si falla la IA */
      } finally {
        setEscrituraMagicaCargando(false);
      }
      return;
    }

    const lineas = raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const normalizadas = lineas.map((l) => l.replace(/^[-•*]\s*/, "• "));
    const next = normalizadas.join("\n");
    onPatchDatos(editor.patchTexto(next, datos));
    onPatchDiagramacion(
      patchDiagramacion(diagramacion, seleccion, {
        mayusculas: false,
        listado: true,
        interlineado: cfgSel?.interlineado ?? 1.15,
        interletrado: cfgSel?.interletrado ?? 0.1,
      }),
    );
  }, [
    seleccion,
    onPatchDatos,
    datos,
    onPatchDiagramacion,
    diagramacion,
    cfgSel?.interlineado,
    cfgSel?.interletrado,
  ]);

  useEffect(() => {
    setTextoEditando(null);
    setModoDibujoCaja(false);
    setCajaPreview(null);
  }, [svgKey]);

  useEffect(() => {
    if (!panelExterno || !seleccion || esIdGrafico(seleccion)) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Delete" && ev.key !== "Backspace") return;
      if (textoEditando) return;
      const tag = (ev.target as HTMLElement | null)?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      ev.preventDefault();
      eliminarSeleccionado();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelExterno, seleccion, textoEditando, eliminarSeleccionado]);

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
      {campos
        .filter((c) => c.kind === "texto" && c.id.startsWith("txt_") && c.presente)
        .map((c) => {
          const activo = seleccion === c.id;
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setSeleccion(c.id)}
                className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left transition ${
                  activo
                    ? "bg-accent/15 font-semibold text-accent"
                    : "hover:bg-surface-hover text-ink"
                }`}
              >
                <span className="truncate">{labelCampoDiagramacion(c.id)}</span>
                {variant === "sidebar" ? (
                  <span className="text-[9px] text-muted">Texto libre</span>
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
    <div
      className={
        panelExterno
          ? "flex min-h-0 flex-1 items-center justify-center overflow-auto"
          : "min-h-0 flex-1 overflow-auto rounded-lg bg-[#e8eaed] p-3"
      }
    >
      <div className={panelExterno ? "flex min-h-full w-full items-center justify-center" : "flex min-h-full items-center justify-center"}>
        <div
          ref={containerRef}
          className={`relative shrink-0 overflow-hidden rounded-sm border border-border/80 bg-white shadow-md ${FUENTE_ETIQUETA} ${
            variant === "inline" ? "" : "mx-auto max-w-[920px]"
          }`}
          style={{
            width: `${canvas.width}px`,
            height: `${canvas.height}px`,
            minWidth: "160px",
            fontFamily: FUENTE_ETIQUETA_FAMILY,
            cursor: modoDibujoCaja ? "crosshair" : undefined,
          }}
          onPointerDown={onCanvasPointerDownCrearCaja}
          onPointerLeave={() => setHoverCampo(null)}
        >
          {children}
          {cajaPreview && (
            <div
              className="pointer-events-none absolute z-50 bg-accent/[0.06]"
              style={{
                left: cajaPreview.left,
                top: cajaPreview.top,
                width: Math.max(1, cajaPreview.width),
                height: Math.max(1, cajaPreview.height),
                border: MARCO_SELECCION_CSS,
              }}
            />
          )}
          {campos
            .filter((c) => c.presente && !campoDiagramacionOculto(diagramacion, c.id))
            .map((c) => {
              const activo = seleccion === c.id;
              const label = c.kind === "grafico" ? labelElementoEditor(c.id) : labelCampoDiagramacion(c.id as CampoDiagramacionId);
              const editandoEste = textoEditando === c.id;
              const svgEl = containerRef.current?.querySelector("svg") ?? null;
              const pos = overlayPosicionCampo(c, svgEl, diagramacion, diagramacionGraficos);
              const esTexto = c.kind === "texto";
              const resaltado = esTexto && (activo || hoverCampo === c.id);
              const mostrarAsas = esTexto && resaltado && !editandoEste;

              const onPointerDownCampo = (ev: ReactPointerEvent<HTMLButtonElement>) => {
                if (editandoEste) return;
                ev.preventDefault();
                ev.stopPropagation();
                (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
                setSeleccion(c.id);
                const baseTx =
                  c.kind === "grafico"
                    ? (diagramacionGraficos?.[c.id]?.x ?? 0)
                    : (diagramacion?.[c.id as CampoDiagramacionId]?.x ?? c.baseTx);
                const baseTy =
                  c.kind === "grafico"
                    ? (diagramacionGraficos?.[c.id]?.y ?? 0)
                    : (diagramacion?.[c.id as CampoDiagramacionId]?.y ?? c.baseTy);
                dragRef.current = {
                  id: c.id,
                  kind: c.kind,
                  startX: ev.clientX,
                  startY: ev.clientY,
                  baseTx,
                  baseTy,
                  pointerId: ev.pointerId,
                  moved: false,
                };
              };

              if (esTexto) {
                const campoTexto = c as CampoMedidoTexto;
                return (
                  <div
                    key={`${c.kind}-${c.id}`}
                    className="absolute z-20 touch-none"
                    style={{
                      left: pos.left - padAsa,
                      top: pos.top - padAsa,
                      width: c.width + NODO_HIT_PX,
                      height: c.height + NODO_HIT_PX,
                      overflow: "visible",
                    }}
                    onPointerEnter={() => setHoverCampo(c.id)}
                    onPointerLeave={(ev) => {
                      if (hoverCampo !== c.id) return;
                      const next = ev.relatedTarget as Node | null;
                      if (next && ev.currentTarget.contains(next)) return;
                      setHoverCampo(null);
                    }}
                  >
                    <button
                      type="button"
                      aria-label={label}
                      title={`${label} · arrastra para mover${edicionInlineActiva ? " · doble clic para editar" : ""}`}
                      className="absolute touch-none select-none border-0 bg-transparent p-0"
                      style={{
                        left: padAsa,
                        top: padAsa,
                        width: c.width,
                        height: c.height,
                        cursor: arrastrando && activo ? "grabbing" : "grab",
                        border: resaltado ? MARCO_SELECCION_CSS : "1px solid transparent",
                        boxSizing: "border-box",
                      }}
                      onDoubleClick={(ev) => {
                        if (!edicionInlineActiva) return;
                        ev.preventDefault();
                        ev.stopPropagation();
                        abrirEdicionTexto(c.id as CampoDiagramacionId);
                      }}
                      onPointerDown={onPointerDownCampo}
                    />
                    {mostrarAsas &&
                      HANDLES.map((h) => {
                        const posAsa = posicionAsaRedimension(h.id, {
                          ...campoTexto,
                          left: padAsa,
                          top: padAsa,
                        });
                        return (
                          <AsaRedimension
                            key={h.id}
                            id={h.id}
                            cursor={h.cursor}
                            pos={posAsa}
                            onPointerDown={(ev) => iniciarRedimension(campoTexto, h.id, ev)}
                          />
                        );
                      })}
                  </div>
                );
              }

              return (
                <button
                  key={`${c.kind}-${c.id}`}
                  type="button"
                  aria-label={label}
                  title={`${label} · arrastra para mover`}
                  className={`absolute z-20 touch-none select-none border-0 bg-transparent ${
                    editandoEste ? "pointer-events-none opacity-0" : activo ? "" : "opacity-0 hover:opacity-100"
                  }`}
                  style={{
                    left: pos.left,
                    top: pos.top,
                    width: c.width,
                    height: c.height,
                    cursor: arrastrando && activo ? "grabbing" : "grab",
                    ...(activo && !editandoEste
                      ? {
                          border: MARCO_SELECCION_CSS,
                          background: soloLineas ? "transparent" : "rgba(139, 92, 246, 0.04)",
                        }
                      : !editandoEste
                        ? { outline: "1px dashed rgba(1, 109, 130, 0.28)", outlineOffset: 0 }
                        : {}),
                  }}
                  onPointerDown={onPointerDownCampo}
                />
              );
            })}
          {seleccionado && panelExterno && (() => {
            const svgEl = containerRef.current?.querySelector("svg") ?? null;
            const pos = overlayPosicionCampo(seleccionado, svgEl, diagramacion, diagramacionGraficos);
            return (
            <button
              type="button"
              title="Eliminar caja de texto (Supr)"
              aria-label="Eliminar caja de texto"
              className="absolute z-40 flex h-4 w-4 items-center justify-center rounded-full border border-white/90 bg-red-500/90 text-[9px] font-bold leading-none text-white opacity-85 shadow-sm hover:opacity-100"
              style={{
                left: pos.left + seleccionado.width - 6,
                top: pos.top - 8,
              }}
              onClick={(ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                eliminarCampoTexto(seleccionado.id);
              }}
            >
              ×
            </button>
            );
          })()}
          {textoEditando && edicionInlineActiva && (() => {
            const c = campos.find(
              (x) => x.id === textoEditando && x.presente && x.kind === "texto",
            );
            if (!c) return null;
            const campoId = textoEditando;
            const editor = editorTextoCampo(campoId);
            if (!editor) return null;
            const cfg = diagramacion?.[campoId];
            const escalaCampo = escalaEfectiva(diagramacion, campoId);
            const valor = editor.getTexto(datos);
            const lineas = Math.max(1, valor.split("\n").length);
            const fontSize = Math.max(7, Math.min(34, (c.height / lineas) * 0.9 * escalaCampo));
            const colorRaw = cfg?.color ?? c.color;
            const color = colorRaw.match(/^#[0-9A-Fa-f]{6}$/i) ? colorRaw : "#000000";
            const svgEl = containerRef.current?.querySelector("svg") ?? null;
            const pos = overlayPosicionCampo(c, svgEl, diagramacion, diagramacionGraficos);
            const estilo: CSSProperties = {
              position: "absolute",
              left: pos.left,
              top: pos.top,
              width: Math.max(c.width, 40),
              height: Math.max(c.height, fontSize + 8),
              zIndex: 50,
              fontFamily: FUENTE_ETIQUETA_FAMILY,
              fontSize: `${fontSize}px`,
              fontWeight: pesoFuenteCampoSvg(containerRef.current, campoId),
              lineHeight: editor.multiline ? `${Math.round(fontSize * 1.12)}px` : `${fontSize}px`,
              color,
              textAlign: alineacionCssEditor(cfg?.alineacion, campoId),
              background: "rgba(255,255,255,0.94)",
              border: "1px solid rgba(1, 109, 130, 0.85)",
              borderRadius: 2,
              padding: "1px 3px",
              margin: 0,
              resize: "none",
              outline: "none",
              boxSizing: "border-box",
              overflow: "auto",
            };
            const commit = (texto: string) => onPatchDatos!(editor.patchTexto(texto, datos));
            const cerrar = () => setTextoEditando(null);
            if (editor.multiline) {
              return (
                <textarea
                  key={`edit-${campoId}`}
                  autoFocus
                  value={valor}
                  onChange={(e) => commit(e.target.value)}
                  onBlur={cerrar}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      cerrar();
                    }
                  }}
                  style={estilo}
                  spellCheck={false}
                />
              );
            }
            return (
              <input
                key={`edit-${campoId}`}
                type="text"
                autoFocus
                value={valor}
                onChange={(e) => commit(e.target.value)}
                onBlur={cerrar}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    cerrar();
                  }
                  if (e.key === "Enter") {
                    e.preventDefault();
                    cerrar();
                  }
                }}
                style={estilo}
                spellCheck={false}
              />
            );
          })()}
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
        <div className="flex h-full min-h-0 w-full flex-col">
          {(onPatchDatos || seleccion) && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 px-1 pb-1">
              <EtiquetaTextoToolbar
                campoId={seleccion && !esIdGrafico(seleccion) ? seleccion : null}
                cfg={cfgSel}
                colorFallback={seleccionado?.color ?? "#000000"}
                escala={escalaSel}
                b1AnchoPct={seleccion === "b1" ? b1Pct : undefined}
                tx={cfgSel?.x ?? seleccionado?.tx ?? graficoSel?.tx ?? 0}
                ty={cfgSel?.y ?? seleccionado?.ty ?? graficoSel?.ty ?? 0}
                soloPosicion={soloLineas || (!!seleccion && esIdGrafico(seleccion))}
                elementoSeleccionado={!!seleccion}
                onAlinearLienzo={alinearSeleccionAlLienzo}
                onAnadirCajaTexto={onPatchDatos ? anadirCajaTexto : undefined}
                onEscrituraMagica={onPatchDatos ? escrituraMagica : undefined}
                escrituraMagicaCargando={escrituraMagicaCargando}
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
                  onPatchDiagramacion(patchCampoToolbar(diagramacion, seleccion, p));
                  if (p.ancho_pct != null) onPatchDatos?.({ b1_ancho_pct: p.ancho_pct });
                }}
              />
              {modoDibujoCaja && (
                <span className="text-[10px] font-semibold text-accent">
                  Arrastra en el lienzo para crear la caja
                </span>
              )}
            </div>
          )}
          {zoomBar && <div className="flex shrink-0 justify-end px-1 pb-1">{zoomBar}</div>}
          {canvasBlock}
        </div>
      );
    }
    return (
      <div className="flex h-full min-h-[min(72vh,900px)] flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <EtiquetaTextoToolbar
            campoId={seleccion && !esIdGrafico(seleccion) ? seleccion : null}
            cfg={cfgSel}
            colorFallback={seleccionado?.color ?? "#000000"}
            escala={escalaSel}
            b1AnchoPct={seleccion === "b1" ? b1Pct : undefined}
            tx={cfgSel?.x ?? seleccionado?.tx ?? graficoSel?.tx ?? 0}
            ty={cfgSel?.y ?? seleccionado?.ty ?? graficoSel?.ty ?? 0}
            soloPosicion={soloLineas || (!!seleccion && esIdGrafico(seleccion))}
            elementoSeleccionado={!!seleccion}
            onAlinearLienzo={alinearSeleccionAlLienzo}
            onAnadirCajaTexto={panelExterno ? anadirCajaTexto : undefined}
            onEscrituraMagica={panelExterno ? escrituraMagica : undefined}
            escrituraMagicaCargando={escrituraMagicaCargando}
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
              onPatchDiagramacion(patchCampoToolbar(diagramacion, seleccion, p));
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

            <div className="grid grid-cols-3 gap-1" title="Alinear al lienzo">
              {ALINEACIONES_LIENZO.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  title={a.title}
                  aria-label={a.title}
                  onClick={() => alinearSeleccionAlLienzo(a.id)}
                  className="flex h-8 items-center justify-center rounded border border-border text-sm hover:bg-surface-hover"
                >
                  {a.label}
                </button>
              ))}
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

        {graficoSel && !seleccionado && (
          <div className="mt-1 space-y-2 rounded border border-border bg-surface-panel p-2">
            <p className="font-semibold text-ink">{labelElementoEditor(graficoSel.id)}</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[10px] text-muted">X</span>
                <input
                  type="number"
                  step="0.1"
                  value={diagramacionGraficos?.[graficoSel.id]?.x ?? graficoSel.tx}
                  onChange={(e) => {
                    const x = parseFloat(e.target.value);
                    if (!Number.isFinite(x)) return;
                    onPatchGraficos?.(
                      patchDiagramacionGraficos(diagramacionGraficos, graficoSel.id, { x }),
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
                  value={diagramacionGraficos?.[graficoSel.id]?.y ?? graficoSel.ty}
                  onChange={(e) => {
                    const y = parseFloat(e.target.value);
                    if (!Number.isFinite(y)) return;
                    onPatchGraficos?.(
                      patchDiagramacionGraficos(diagramacionGraficos, graficoSel.id, { y }),
                    );
                  }}
                  className="mt-0.5 w-full rounded border border-border bg-white px-1.5 py-1 font-mono text-[10px]"
                />
              </label>
            </div>
            <div className="grid grid-cols-3 gap-1" title="Alinear al lienzo">
              {ALINEACIONES_LIENZO.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  title={a.title}
                  aria-label={a.title}
                  onClick={() => alinearSeleccionAlLienzo(a.id)}
                  className="flex h-8 items-center justify-center rounded border border-border text-sm hover:bg-surface-hover"
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </aside>
      {canvasBlock}
    </div>
  );
}
