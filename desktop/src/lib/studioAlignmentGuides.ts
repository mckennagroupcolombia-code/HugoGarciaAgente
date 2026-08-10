/**
 * Guías inteligentes del Studio web (bordes, centros, espacios iguales).
 * Coordenadas en px del papel de la hoja (sin zoom de pantalla).
 */

export type AlignBox = {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type AlignGuide = {
  axis: "x" | "y";
  pos: number;
  start: number;
  end: number;
  kind?: "edge" | "gap";
};

export type AlignFrame = {
  width: number;
  height: number;
};

export type AlignContext = {
  hojaId: string;
  frame: AlignFrame;
  startBoxes: Record<string, AlignBox>;
  others: AlignBox[];
};

export type ResizeGuideMode = "resize-e" | "resize-s" | "resize-se";

/** Umbral en px de pantalla; se convierte a px de papel con / zoom. */
export const SNAP_SCREEN_PX = 8;

export function snapThresholdCanvas(zoom: number): number {
  const z = zoom > 0.05 ? zoom : 1;
  return SNAP_SCREEN_PX / z;
}

export function boxCenterX(b: AlignBox): number {
  return (b.left + b.right) / 2;
}

export function boxCenterY(b: AlignBox): number {
  return (b.top + b.bottom) / 2;
}

export function translateBox(b: AlignBox, dx: number, dy: number): AlignBox {
  return {
    ...b,
    left: b.left + dx,
    right: b.right + dx,
    top: b.top + dy,
    bottom: b.bottom + dy,
  };
}

export function unionBoxes(boxes: AlignBox[]): AlignBox | null {
  if (!boxes.length) return null;
  return {
    id: "__sel",
    left: Math.min(...boxes.map((b) => b.left)),
    top: Math.min(...boxes.map((b) => b.top)),
    right: Math.max(...boxes.map((b) => b.right)),
    bottom: Math.max(...boxes.map((b) => b.bottom)),
  };
}

export function idEsAncestroDe(anc: string, child: string): boolean {
  return !!anc && !!child && child.startsWith(`${anc}.`);
}

function xEdges(b: AlignBox): number[] {
  return [b.left, boxCenterX(b), b.right];
}

function yEdges(b: AlignBox): number[] {
  return [b.top, boxCenterY(b), b.bottom];
}

function frameAsBox(frame: AlignFrame): AlignBox {
  return { id: "__frame", left: 0, top: 0, right: frame.width, bottom: frame.height };
}

function overlapsPerp(a: AlignBox, b: AlignBox, axis: "x" | "y"): boolean {
  if (axis === "x") return a.top < b.bottom && b.top < a.bottom;
  return a.left < b.right && b.left < a.right;
}

type AxisHit = { delta: number; pos: number };

function bestAxisSnap(movingVals: number[], targetVals: number[], threshold: number): AxisHit | null {
  let best: AxisHit | null = null;
  for (const m of movingVals) {
    for (const t of targetVals) {
      const delta = t - m;
      const ad = Math.abs(delta);
      if (ad > threshold) continue;
      if (!best || ad < Math.abs(best.delta) - 1e-9) {
        best = { delta, pos: t };
      }
    }
  }
  return best;
}

function pickDelta(a: number, b: number): number {
  if (a === 0) return b;
  if (b === 0) return a;
  return Math.abs(a) <= Math.abs(b) ? a : b;
}

function spanPerp(a: AlignBox, b: AlignBox, axis: "x" | "y"): { start: number; end: number } {
  if (axis === "x") {
    return { start: Math.min(a.top, b.top), end: Math.max(a.bottom, b.bottom) };
  }
  return { start: Math.min(a.left, b.left), end: Math.max(a.right, b.right) };
}

function collectEdgeGuides(moved: AlignBox, targets: AlignBox[], eps: number): AlignGuide[] {
  const out: AlignGuide[] = [];
  const seen = new Set<string>();
  const push = (g: AlignGuide) => {
    const key = `${g.axis}:${Math.round(g.pos * 10)}:${Math.round(g.start)}:${Math.round(g.end)}:${g.kind || "edge"}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(g);
  };

  const mx = xEdges(moved);
  const my = yEdges(moved);
  for (const t of targets) {
    for (const tv of xEdges(t)) {
      if (mx.some((v) => Math.abs(v - tv) <= eps)) {
        const { start, end } = spanPerp(moved, t, "x");
        push({ axis: "x", pos: tv, start, end, kind: "edge" });
      }
    }
    for (const tv of yEdges(t)) {
      if (my.some((v) => Math.abs(v - tv) <= eps)) {
        const { start, end } = spanPerp(moved, t, "y");
        push({ axis: "y", pos: tv, start, end, kind: "edge" });
      }
    }
  }
  return out;
}

type SpacingHit = { delta: number; guides: AlignGuide[] };

function consecutiveGaps(boxes: AlignBox[], axis: "x" | "y"): { a: AlignBox; b: AlignBox; gap: number }[] {
  const start = (b: AlignBox) => (axis === "x" ? b.left : b.top);
  const end = (b: AlignBox) => (axis === "x" ? b.right : b.bottom);
  const sorted = [...boxes].sort((p, q) => start(p) - start(q));
  const out: { a: AlignBox; b: AlignBox; gap: number }[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (!overlapsPerp(a, b, axis)) continue;
    const gap = start(b) - end(a);
    if (gap > 1) out.push({ a, b, gap });
  }
  return out;
}

function gapGuide(a: AlignBox, b: AlignBox, axis: "x" | "y"): AlignGuide {
  if (axis === "x") {
    const mid = (a.right + b.left) / 2;
    return {
      axis: "x",
      pos: mid,
      start: Math.min(a.top, b.top),
      end: Math.max(a.bottom, b.bottom),
      kind: "gap",
    };
  }
  const mid = (a.bottom + b.top) / 2;
  return {
    axis: "y",
    pos: mid,
    start: Math.min(a.left, b.left),
    end: Math.max(a.right, b.right),
    kind: "gap",
  };
}

/** Centro entre vecinos y huecos iguales (misma fila/columna). */
export function snapEqualSpacing(
  moving: AlignBox,
  others: AlignBox[],
  threshold: number,
  axis: "x" | "y",
): SpacingHit | null {
  const start = (b: AlignBox) => (axis === "x" ? b.left : b.top);
  const end = (b: AlignBox) => (axis === "x" ? b.right : b.bottom);
  const mid = (b: AlignBox) => (start(b) + end(b)) / 2;
  const related = others.filter((o) => overlapsPerp(moving, o, axis));
  if (!related.length) return null;

  const prevs = related
    .filter((o) => end(o) <= start(moving) + threshold)
    .sort((a, b) => end(b) - end(a));
  const nexts = related
    .filter((o) => start(o) >= end(moving) - threshold)
    .sort((a, b) => start(a) - start(b));
  const prev = prevs[0];
  const next = nexts[0];

  let best: SpacingHit | null = null;
  const consider = (delta: number, guides: AlignGuide[]) => {
    if (!Number.isFinite(delta) || Math.abs(delta) > threshold) return;
    if (!best || Math.abs(delta) < Math.abs(best.delta) - 1e-9) {
      best = { delta, guides };
    }
  };

  if (prev && next) {
    const center = (end(prev) + start(next)) / 2;
    consider(center - mid(moving), [gapGuide(prev, next, axis)]);
  }

  const pairs = consecutiveGaps(related, axis);
  if (prev) {
    const gapNow = start(moving) - end(prev);
    for (const p of pairs) {
      consider(p.gap - gapNow, [gapGuide(prev, translateBox(moving, axis === "x" ? p.gap - gapNow : 0, axis === "y" ? p.gap - gapNow : 0), axis), gapGuide(p.a, p.b, axis)]);
    }
  }
  if (next) {
    const gapNow = start(next) - end(moving);
    for (const p of pairs) {
      consider(gapNow - p.gap, [
        gapGuide(
          translateBox(moving, axis === "x" ? gapNow - p.gap : 0, axis === "y" ? gapNow - p.gap : 0),
          next,
          axis,
        ),
        gapGuide(p.a, p.b, axis),
      ]);
    }
  }

  return best;
}

export function snapToGuides(
  moving: AlignBox,
  others: AlignBox[],
  frame: AlignFrame,
  threshold: number,
): { dx: number; dy: number; guides: AlignGuide[] } {
  const targets = [...others, frameAsBox(frame)];
  const hx = bestAxisSnap(xEdges(moving), targets.flatMap(xEdges), threshold);
  const hy = bestAxisSnap(yEdges(moving), targets.flatMap(yEdges), threshold);
  const sx = snapEqualSpacing(moving, others, threshold, "x");
  const sy = snapEqualSpacing(moving, others, threshold, "y");
  const dx = pickDelta(hx ? hx.delta : 0, sx ? sx.delta : 0);
  const dy = pickDelta(hy ? hy.delta : 0, sy ? sy.delta : 0);
  const moved = translateBox(moving, dx, dy);
  const eps = Math.max(0.51, threshold * 0.08);
  const guides = collectEdgeGuides(moved, targets, eps);
  if (sx && Math.abs(dx - sx.delta) < 0.51) guides.push(...sx.guides);
  if (sy && Math.abs(dy - sy.delta) < 0.51) guides.push(...sy.guides);
  return { dx, dy, guides };
}

export function guidesForMove(
  ctx: AlignContext,
  pointerDx: number,
  pointerDy: number,
  opts?: { disabled?: boolean; zoom?: number },
): { adjX: number; adjY: number; guides: AlignGuide[] } {
  if (opts?.disabled) return { adjX: 0, adjY: 0, guides: [] };
  const starts = Object.values(ctx.startBoxes);
  const union = unionBoxes(starts);
  if (!union) return { adjX: 0, adjY: 0, guides: [] };
  const proposed = translateBox(union, pointerDx, pointerDy);
  const th = snapThresholdCanvas(opts?.zoom ?? 1);
  const snapped = snapToGuides(proposed, ctx.others, ctx.frame, th);
  return { adjX: snapped.dx, adjY: snapped.dy, guides: snapped.guides };
}

export function guidesForResize(
  ctx: AlignContext,
  mode: ResizeGuideMode,
  pointerDx: number,
  pointerDy: number,
  orig: { w: number; h: number },
  opts?: { disabled?: boolean; zoom?: number },
): { adjX: number; adjY: number; width: number; height: number; guides: AlignGuide[] } {
  const empty = {
    adjX: 0,
    adjY: 0,
    width: Math.round(Math.max(24, orig.w + (mode === "resize-s" ? 0 : pointerDx))),
    height: Math.round(Math.max(16, orig.h + (mode === "resize-e" ? 0 : pointerDy))),
    guides: [] as AlignGuide[],
  };
  if (opts?.disabled) return empty;
  const start = unionBoxes(Object.values(ctx.startBoxes));
  if (!start) return empty;
  const th = snapThresholdCanvas(opts?.zoom ?? 1);
  const targets = [...ctx.others, frameAsBox(ctx.frame)];
  let adjX = 0;
  let adjY = 0;
  const proposed: AlignBox = { ...start };

  if (mode === "resize-e" || mode === "resize-se") {
    proposed.right = start.right + pointerDx;
    const hit = bestAxisSnap([proposed.right], targets.flatMap(xEdges), th);
    if (hit) {
      adjX = hit.delta;
      proposed.right += hit.delta;
    }
  }
  if (mode === "resize-s" || mode === "resize-se") {
    proposed.bottom = start.bottom + pointerDy;
    const hit = bestAxisSnap([proposed.bottom], targets.flatMap(yEdges), th);
    if (hit) {
      adjY = hit.delta;
      proposed.bottom += hit.delta;
    }
  }

  const eps = Math.max(0.51, th * 0.08);
  return {
    adjX,
    adjY,
    width: Math.round(Math.max(24, orig.w + (mode === "resize-s" ? 0 : pointerDx + adjX))),
    height: Math.round(Math.max(16, orig.h + (mode === "resize-e" ? 0 : pointerDy + adjY))),
    guides: collectEdgeGuides(proposed, targets, eps),
  };
}

export function measureBoxRelative(
  el: HTMLElement,
  origin: DOMRect,
  zoom: number,
  id: string,
): AlignBox {
  const r = el.getBoundingClientRect();
  const inv = zoom > 0.05 ? 1 / zoom : 1;
  return {
    id,
    left: (r.left - origin.left) * inv,
    top: (r.top - origin.top) * inv,
    right: (r.right - origin.left) * inv,
    bottom: (r.bottom - origin.top) * inv,
  };
}

function relatedByIdOrDom(
  movingEls: HTMLElement[],
  movingIds: Set<string>,
  node: HTMLElement,
  id: string,
): boolean {
  if (movingIds.has(id)) return true;
  for (const mid of movingIds) {
    if (idEsAncestroDe(mid, id) || idEsAncestroDe(id, mid)) return true;
  }
  for (const m of movingEls) {
    if (m === node || m.contains(node) || node.contains(m)) return true;
  }
  return false;
}

/** Foto de cajas al iniciar el arrastre: todos los objetos independientes de la hoja. */
export function captureAlignContext(
  stage: HTMLElement | null,
  movingIds: string[],
  zoom: number,
): AlignContext | null {
  if (!stage || !movingIds.length) return null;
  const primary = movingIds[0];
  const primaryEl = stage.querySelector(
    `[data-node="${CSS.escape(primary)}"]`,
  ) as HTMLElement | null;
  if (!primaryEl) return null;
  const hoja = primaryEl.closest("[data-studio-hoja]") as HTMLElement | null;
  const paper = (hoja?.querySelector("[data-studio-paper]") as HTMLElement | null) || hoja;
  if (!hoja || !paper) return null;
  const hojaId = hoja.getAttribute("data-studio-hoja") || "";
  const origin = paper.getBoundingClientRect();
  const inv = zoom > 0.05 ? 1 / zoom : 1;
  const frame: AlignFrame = {
    width: Math.max(1, origin.width * inv),
    height: Math.max(1, origin.height * inv),
  };

  const movingSet = new Set(movingIds);
  const movingEls = movingIds
    .map((id) => stage.querySelector(`[data-node="${CSS.escape(id)}"]`) as HTMLElement | null)
    .filter((el): el is HTMLElement => !!el);

  const startBoxes: Record<string, AlignBox> = {};
  const others: AlignBox[] = [];
  const seen = new Set<string>();

  const ingest = (node: HTMLElement, id: string) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    const box = measureBoxRelative(node, origin, zoom, id);
    if (box.right - box.left < 2 && box.bottom - box.top < 2) return;
    if (relatedByIdOrDom(movingEls, movingSet, node, id)) {
      if (movingSet.has(id)) startBoxes[id] = box;
      return;
    }
    others.push(box);
  };

  for (const node of hoja.querySelectorAll<HTMLElement>("[data-node]")) {
    const id = node.getAttribute("data-node");
    if (!id || id === hojaId) continue;
    ingest(node, id);
  }
  for (const node of hoja.querySelectorAll<HTMLElement>("[data-studio-guide]")) {
    const gid = node.getAttribute("data-studio-guide");
    if (!gid) continue;
    ingest(node, `__g:${gid}`);
  }

  if (!Object.keys(startBoxes).length) return null;
  return { hojaId, frame, startBoxes, others };
}
