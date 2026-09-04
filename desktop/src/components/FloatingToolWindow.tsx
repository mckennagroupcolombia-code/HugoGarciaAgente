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
  // En celular: casi pantalla completa (las ventanas flotantes no caben como en desktop).
  if (maxW < 768) {
    const pad = 8;
    return {
      x: pad,
      y: pad,
      w: Math.max(minW, maxW - pad * 2),
      h: Math.max(minH, maxH - pad * 2),
    };
  }
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
 * Minimizar colapsa a una barra flotante sin desmontar `children` (conserva el formulario).
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
  const [minimized, setMinimized] = useState(false);
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

  const dockStyle: CSSProperties = {
    left: Math.min(rect.x, typeof window !== "undefined" ? Math.max(8, window.innerWidth - 280) : rect.x),
    bottom: 16,
    zIndex,
  };

  return createPortal(
    <>
      <div
        className={`pointer-events-auto fixed flex flex-col overflow-hidden rounded-paper-lg border-2 bg-surface-panel shadow-paper-lg ${borderClassName} ${
          dragging ? "select-none" : ""
        } ${minimized ? "hidden" : ""}`}
        style={style}
        role="dialog"
        aria-modal="false"
        aria-label={title}
        aria-hidden={minimized}
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
          <div className="flex shrink-0 items-center gap-0.5" data-no-drag>
            <button
              type="button"
              data-no-drag
              onClick={() => setMinimized(true)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-surface-hover hover:text-ink"
              aria-label={`Minimizar ${title}`}
              title="Minimizar"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                <path d="M5 12h14" strokeLinecap="round" />
              </svg>
            </button>
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
        </div>

        <div className="min-h-0 flex-1 overflow-auto">{children}</div>

        <div
          className="absolute bottom-0 right-0 z-10 hidden h-4 w-4 cursor-se-resize sm:block"
          onPointerDown={startResize}
          title="Redimensionar"
          aria-label="Redimensionar ventana"
        >
          <span
            className="absolute bottom-1 right-1 h-2.5 w-2.5 border-b-2 border-r-2 border-muted/70"
            aria-hidden
          />
        </div>
      </div>

      {minimized && (
        <button
          type="button"
          onClick={() => setMinimized(false)}
          style={dockStyle}
          className={`pointer-events-auto fixed flex max-w-[min(calc(100vw-2rem),18rem)] items-center gap-2 rounded-paper-lg border-2 bg-surface-panel px-3 py-2 shadow-paper-lg transition hover:brightness-[1.03] active:scale-[0.98] ${borderClassName} ${headerClassName}`}
          aria-label={`Restaurar ${title}`}
          title="Clic para restaurar"
        >
          {titleExtra}
          <span className="min-w-0 truncate text-[11px] font-extrabold uppercase tracking-wide">
            {title}
          </span>
          <svg className="ml-auto h-3.5 w-3.5 shrink-0 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
            <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </>,
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
