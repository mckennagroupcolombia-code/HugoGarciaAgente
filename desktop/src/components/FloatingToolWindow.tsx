import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type FloatRect = { x: number; y: number; w: number; h: number };

const STORAGE_PREFIX = "mckenna.contabilidad.float.";

function clampRect(r: FloatRect, minW: number, minH: number): FloatRect {
  const maxW = typeof window !== "undefined" ? window.innerWidth : 1200;
  const maxH = typeof window !== "undefined" ? window.innerHeight : 800;
  const w = Math.min(Math.max(r.w, minW), maxW - 16);
  const h = Math.min(Math.max(r.h, minH), maxH - 16);
  const x = Math.min(Math.max(r.x, 0), Math.max(0, maxW - w));
  const y = Math.min(Math.max(r.y, 0), Math.max(0, maxH - h));
  return { x, y, w, h };
}

function loadRect(id: string, fallback: FloatRect, minW: number, minH: number): FloatRect {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + id);
    if (!raw) return clampRect(fallback, minW, minH);
    const p = JSON.parse(raw) as Partial<FloatRect>;
    if (
      typeof p.x !== "number" ||
      typeof p.y !== "number" ||
      typeof p.w !== "number" ||
      typeof p.h !== "number"
    ) {
      return clampRect(fallback, minW, minH);
    }
    return clampRect({ x: p.x, y: p.y, w: p.w, h: p.h }, minW, minH);
  } catch {
    return clampRect(fallback, minW, minH);
  }
}

function saveRect(id: string, rect: FloatRect) {
  try {
    localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(rect));
  } catch {
    /* ignore quota / private mode */
  }
}

type DragMode = "move" | "resize";

/**
 * Ventana flotante arrastrable y redimensionable.
 * Persiste posición/tamaño en localStorage por `id` al soltar.
 */
export default function FloatingToolWindow({
  id,
  title,
  titleExtra,
  headerClassName = "border-border bg-surface-hover text-ink",
  borderClassName = "border-border",
  defaultRect,
  minWidth = 280,
  minHeight = 220,
  zIndex = 880,
  onClose,
  children,
}: {
  id: string;
  title: string;
  titleExtra?: ReactNode;
  headerClassName?: string;
  borderClassName?: string;
  defaultRect: FloatRect;
  minWidth?: number;
  minHeight?: number;
  zIndex?: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const [rect, setRect] = useState<FloatRect>(() =>
    loadRect(id, defaultRect, minWidth, minHeight),
  );
  const rectRef = useRef(rect);
  rectRef.current = rect;

  const dragRef = useRef<{
    mode: DragMode;
    startX: number;
    startY: number;
    orig: FloatRect;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (d.mode === "move") {
        setRect(
          clampRect(
            { ...d.orig, x: d.orig.x + dx, y: d.orig.y + dy },
            minWidth,
            minHeight,
          ),
        );
      } else {
        setRect(
          clampRect(
            { ...d.orig, w: d.orig.w + dx, h: d.orig.h + dy },
            minWidth,
            minHeight,
          ),
        );
      }
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      setDragging(false);
      saveRect(id, clampRect(rectRef.current, minWidth, minHeight));
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
  }, [id, minWidth, minHeight]);

  useEffect(() => {
    const onResize = () => {
      setRect((r) => clampRect(r, minWidth, minHeight));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [minWidth, minHeight]);

  const startMove = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest("button, a, input, textarea, select, [data-no-drag]")) return;
    e.preventDefault();
    dragRef.current = {
      mode: "move",
      startX: e.clientX,
      startY: e.clientY,
      orig: { ...rectRef.current },
    };
    setDragging(true);
  };

  const startResize = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      mode: "resize",
      startX: e.clientX,
      startY: e.clientY,
      orig: { ...rectRef.current },
    };
    setDragging(true);
  };

  if (typeof document === "undefined") return null;

  const style: CSSProperties = {
    left: rect.x,
    top: rect.y,
    width: rect.w,
    height: rect.h,
    zIndex,
  };

  return createPortal(
    <div
      className={`pointer-events-auto fixed flex flex-col overflow-hidden rounded-paper-lg border-2 bg-surface-panel shadow-paper-lg ${borderClassName} ${
        dragging ? "select-none" : ""
      }`}
      style={style}
      role="dialog"
      aria-modal="false"
      aria-label={title}
    >
      <div
        className={`flex shrink-0 cursor-grab items-center justify-between gap-2 border-b px-3 py-2 active:cursor-grabbing ${headerClassName}`}
        onPointerDown={startMove}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {titleExtra}
          <span className="truncate text-[11px] font-extrabold uppercase tracking-wide">
            {title}
          </span>
        </div>
        <button
          type="button"
          data-no-drag
          onClick={onClose}
          className="rounded-lg px-2 py-0.5 text-sm text-muted hover:bg-surface-hover hover:text-ink"
          aria-label={`Cerrar ${title}`}
        >
          ✕
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">{children}</div>

      <div
        className="absolute bottom-0 right-0 z-10 h-4 w-4 cursor-se-resize"
        onPointerDown={startResize}
        title="Redimensionar"
        aria-label="Redimensionar ventana"
      >
        <span
          className="absolute bottom-1 right-1 h-2.5 w-2.5 border-b-2 border-r-2 border-muted/70"
          aria-hidden
        />
      </div>
    </div>,
    document.body,
  );
}

/** Defaults útiles si no hay preferencia guardada. */
export function defaultFloatRect(
  corner: "tl" | "tr" | "ml",
  w: number,
  h: number,
): FloatRect {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const pad = 20;
  const top = 80;
  if (corner === "tr") return { x: Math.max(pad, vw - w - pad), y: top, w, h };
  if (corner === "ml") return { x: pad + 300, y: top, w, h };
  return { x: pad, y: top, w, h };
}
