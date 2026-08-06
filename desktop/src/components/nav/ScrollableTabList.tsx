import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Icon } from "../../icons";

/**
 * Fila de pestañas con overflow: sin scrollbar visible, flechas y
 * auto-scroll a la pestaña activa.
 */
export default function ScrollableTabList({
  children,
  "aria-label": ariaLabel,
  justify = "start",
  className = "",
}: {
  children: ReactNode;
  "aria-label"?: string;
  justify?: "start" | "end";
  className?: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateOverflow = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const left = el.scrollLeft;
    setCanLeft(left > 2);
    setCanRight(max > 2 && left < max - 2);
  }, []);

  const scrollByDir = useCallback((dir: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const step = Math.max(140, Math.floor(el.clientWidth * 0.55));
    el.scrollBy({ left: dir * step, behavior: "smooth" });
  }, []);

  const ensureSelectedVisible = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const selected = el.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!selected) return;
    selected.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    updateOverflow();
    ensureSelectedVisible();

    const onScroll = () => updateOverflow();
    el.addEventListener("scroll", onScroll, { passive: true });

    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      // Trackpad/rueda vertical → desplaza horizontal.
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });

    const ro = new ResizeObserver(() => {
      updateOverflow();
      ensureSelectedVisible();
    });
    ro.observe(el);

    const mo = new MutationObserver(() => {
      updateOverflow();
      ensureSelectedVisible();
    });
    mo.observe(el, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-selected"],
    });

    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      ro.disconnect();
      mo.disconnect();
    };
  }, [updateOverflow, ensureSelectedVisible]);

  const showControls = canLeft || canRight;

  return (
    <div className={`relative flex min-w-0 flex-1 items-center gap-0.5 ${className}`}>
      {showControls ? (
        <button
          type="button"
          tabIndex={-1}
          disabled={!canLeft}
          onClick={() => scrollByDir(-1)}
          aria-label="Ver pestañas anteriores"
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-surface-panel text-muted shadow-sm transition ${
            canLeft
              ? "hover:bg-surface-hover hover:text-ink"
              : "pointer-events-none opacity-0"
          }`}
        >
          <Icon name="caretDown" size={14} weight="bold" className="rotate-90" />
        </button>
      ) : null}

      <div className="relative min-w-0 flex-1">
        {canLeft ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-gradient-to-r from-[rgb(var(--mck-surface-panel))] to-transparent"
          />
        ) : null}
        {canRight ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 z-10 w-6 bg-gradient-to-l from-[rgb(var(--mck-surface-panel))] to-transparent"
          />
        ) : null}
        <div
          ref={scrollerRef}
          role="tablist"
          aria-label={ariaLabel}
          className={`mck-scroll-tabs flex min-w-0 items-center gap-1 overflow-x-auto overscroll-x-contain scroll-smooth py-0.5 ${
            justify === "end" ? "justify-end" : "justify-start"
          }`}
        >
          {children}
        </div>
      </div>

      {showControls ? (
        <button
          type="button"
          tabIndex={-1}
          disabled={!canRight}
          onClick={() => scrollByDir(1)}
          aria-label="Ver más pestañas"
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-surface-panel text-muted shadow-sm transition ${
            canRight
              ? "hover:bg-surface-hover hover:text-ink"
              : "pointer-events-none opacity-0"
          }`}
        >
          <Icon name="caretDown" size={14} weight="bold" className="-rotate-90" />
        </button>
      ) : null}
    </div>
  );
}
