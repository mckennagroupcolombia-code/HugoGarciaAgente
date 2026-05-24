import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  boardLayoutKey,
  defaultBoardLayout,
  useQuestBoardLayout,
  BOARD_FRAME_SIZES,
  type BoardFrameVariant,
  type BoardStickyLayout,
} from "../stores/questBoardLayout";
import { Icon } from "../icons";

type DragKind = "move" | "resize";

const COL_GAP = 16;
const BoardWidthContext = createContext(900);

export function useBoardCanvasWidth(): number {
  return useContext(BoardWidthContext);
}

interface QuestBoardStickyFrameProps {
  sectionKey: string;
  cardKey: string;
  index: number;
  containerWidth: number;
  children: ReactNode;
  minAutoH?: number;
  variant?: BoardFrameVariant;
}

export function QuestBoardStickyCanvas({
  sectionKey,
  itemCount,
  children,
  variant = "card",
}: {
  sectionKey: string;
  itemCount: number;
  children: ReactNode;
  variant?: BoardFrameVariant;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const layouts = useQuestBoardLayout((s) => s.layouts);
  const rowH = BOARD_FRAME_SIZES[variant].rowH;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [itemCount]);

  let canvasHeight = variant === "section" ? 360 : variant === "task" ? 120 : 280;
  const prefix = `${sectionKey}|`;
  for (const [key, layout] of Object.entries(layouts)) {
    if (!key.startsWith(prefix)) continue;
    const bottom = layout.y + (layout.h ?? rowH);
    if (bottom > canvasHeight) canvasHeight = bottom;
  }
  if (itemCount > 0 && canvasHeight <= (variant === "task" ? 120 : 280)) {
    const cols = variant === "section"
      ? 1
      : Math.max(1, Math.floor(width / (BOARD_FRAME_SIZES[variant].defaultW + COL_GAP)));
    const rows = Math.ceil(itemCount / cols);
    canvasHeight = Math.max(canvasHeight, rows * rowH + 48);
  }
  canvasHeight += 32;

  return (
    <div
      ref={containerRef}
      className={`quest-sticky-canvas quest-sticky-canvas--${variant}`}
      style={{ minHeight: canvasHeight }}
    >
      <BoardWidthContext.Provider value={width}>{children}</BoardWidthContext.Provider>
    </div>
  );
}

export function QuestBoardStickyFrame({
  sectionKey,
  cardKey,
  index,
  containerWidth,
  children,
  minAutoH,
  variant = "card",
}: QuestBoardStickyFrameProps) {
  const sizes = BOARD_FRAME_SIZES[variant];
  const minH = minAutoH ?? sizes.minH;

  const storageKey = boardLayoutKey(sectionKey, cardKey);
  const stored = useQuestBoardLayout((s) => s.layouts[storageKey]);
  const setLayout = useQuestBoardLayout((s) => s.setLayout);

  const base = stored ?? defaultBoardLayout(index, containerWidth, variant);
  const [live, setLive] = useState<BoardStickyLayout | null>(null);
  const layout = live ?? base;

  const dragRef = useRef<{
    kind: DragKind;
    startX: number;
    startY: number;
    orig: BoardStickyLayout;
    pointerId: number;
  } | null>(null);
  const liveRef = useRef<BoardStickyLayout | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    liveRef.current = live;
  }, [live]);

  const commit = useCallback(
    (next: BoardStickyLayout) => {
      setLayout(storageKey, next);
      setLive(null);
    },
    [setLayout, storageKey],
  );

  useEffect(() => {
    function onMove(ev: PointerEvent) {
      const d = dragRef.current;
      if (!d || ev.pointerId !== d.pointerId) return;
      const dx = ev.clientX - d.startX;
      const dy = ev.clientY - d.startY;
      if (d.kind === "move") {
        setLive({
          ...d.orig,
          x: Math.max(0, d.orig.x + dx),
          y: Math.max(0, d.orig.y + dy),
        });
        return;
      }
      setLive({
        ...d.orig,
        w: Math.min(sizes.maxW, Math.max(sizes.minW, d.orig.w + dx)),
        h: Math.max(minH, (d.orig.h ?? minH) + dy),
      });
    }
    function onUp(ev: PointerEvent) {
      const d = dragRef.current;
      if (!d || ev.pointerId !== d.pointerId) return;
      dragRef.current = null;
      setDragging(false);
      const next = liveRef.current ?? d.orig;
      commit(next);
      setLive(null);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [commit, minH, sizes.maxW, sizes.minW]);

  const startDrag = (kind: DragKind) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = frameRef.current?.getBoundingClientRect();
    const origH = layout.h ?? (rect ? rect.height : minH);
    dragRef.current = {
      kind,
      startX: e.clientX,
      startY: e.clientY,
      orig: { ...layout, h: origH },
      pointerId: e.pointerId,
    };
    setDragging(true);
    setLive({ ...layout, h: origH });
  };

  const frameStyle: CSSProperties = {
    left: layout.x,
    top: layout.y,
    width: layout.w,
    ...(layout.h != null
      ? { height: layout.h, overflow: "auto" }
      : { minHeight: minH }),
  };

  return (
    <div
      ref={frameRef}
      className={`quest-sticky-frame quest-sticky-frame--${variant} ${layout.h != null ? "quest-sticky-frame--sized" : ""} ${dragging ? "quest-sticky-frame--active" : ""}`}
      style={frameStyle}
    >
      <button
        type="button"
        className="quest-sticky-drag-handle"
        title="Arrastrar caja"
        aria-label="Arrastrar caja"
        onPointerDown={startDrag("move")}
      >
        <Icon name="drag" size={14} weight="bold" />
      </button>
      <div className={`quest-sticky-frame-body ${dragging ? "quest-sticky-frame-body--dragging" : ""}`}>
        {children}
      </div>
      <button
        type="button"
        className="quest-sticky-resize-handle"
        title="Cambiar tamaño"
        aria-label="Cambiar tamaño de la caja"
        onPointerDown={startDrag("resize")}
      >
        <Icon name="resize" size={12} weight="bold" className="quest-sticky-resize-icon" />
      </button>
    </div>
  );
}
