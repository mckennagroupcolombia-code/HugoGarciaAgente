import { useEffect, type ReactNode, type RefObject } from "react";

/** Centra `target` dentro del scroll del pasteboard. */
export function centrarEnPasteboard(scroll: HTMLElement, target: HTMLElement) {
  const sRect = scroll.getBoundingClientRect();
  const tRect = target.getBoundingClientRect();
  const deltaX = tRect.left + tRect.width / 2 - (sRect.left + sRect.width / 2);
  const deltaY = tRect.top + tRect.height / 2 - (sRect.top + sRect.height / 2);
  scroll.scrollLeft = Math.max(0, scroll.scrollLeft + deltaX);
  scroll.scrollTop = Math.max(0, scroll.scrollTop + deltaY);
}

/** Mesa del capítulo: título + hojas escaladas, centradas en el pasteboard. */
export function MarcoCapitulo({
  titulo,
  zoom,
  hojasCount,
  stageId,
  stageRef,
  pageWidth = 960,
  children,
}: {
  titulo: string;
  zoom: number;
  hojasCount: number;
  stageId: string;
  stageRef: RefObject<HTMLDivElement | null>;
  pageWidth?: number;
  children: ReactNode;
}) {
  const slack = Math.max(1000, hojasCount * 680);
  const scaledW = pageWidth * zoom;

  return (
    <div
      className="flex min-h-full w-full justify-center px-6 py-10"
      style={{ minWidth: Math.max(scaledW + 48, 100) }}
      data-studio-pasteboard-inner=""
    >
      <div style={{ width: scaledW, flex: "0 0 auto" }}>
        <div
          ref={stageRef}
          data-studio-stage={stageId}
          className="origin-top-left space-y-10"
          style={{
            width: pageWidth,
            transform: `scale(${zoom})`,
            marginBottom: `${(zoom - 1) * slack}px`,
          }}
        >
          <header className="pointer-events-none select-none text-center">
            <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-white/50">Capítulo</p>
            <h2 className="mt-1 text-base font-semibold tracking-wide text-white/90">{titulo}</h2>
            <p className="mt-0.5 text-[11px] text-white/45">
              {hojasCount} {hojasCount === 1 ? "hoja" : "hojas"}
            </p>
          </header>
          {children}
        </div>
      </div>
    </div>
  );
}

/** Una página del capítulo (sección del home = una hoja). */
export function FolioHoja({
  index,
  total,
  label,
  sectionId,
  onActivate,
  overlay,
  children,
}: {
  index: number;
  total: number;
  label: string;
  sectionId: string;
  onActivate?: () => void;
  overlay?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div data-studio-hoja={sectionId} className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onActivate?.();
        }}
        className="mb-2 flex w-full items-baseline justify-between px-0.5 text-left"
      >
        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/70">
          Hoja {index + 1}
          <span className="ml-2 font-semibold normal-case tracking-normal text-white/90">{label}</span>
        </span>
        <span className="tabular-nums text-[10px] text-white/40">
          {index + 1} / {total}
        </span>
      </button>
      <div
        data-studio-paper={sectionId}
        className="relative overflow-visible rounded-[2px] bg-white mck-paper-white shadow-[0_18px_50px_rgba(0,0,0,.35),0_2px_8px_rgba(0,0,0,.18)] ring-1 ring-black/15"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {children}
        {overlay}
      </div>
    </div>
  );
}

/** Lleva la hoja activa al centro del scroll del lienzo. */
export function useScrollHojaActiva(
  stageRef: RefObject<HTMLDivElement | null>,
  selectedIds: string[],
) {
  useEffect(() => {
    const id = selectedIds[selectedIds.length - 1];
    if (!id) return;
    const seccion = id.includes(".") ? id.split(".")[0] : id;
    const el = stageRef.current?.querySelector(`[data-studio-hoja="${CSS.escape(seccion)}"]`);
    const scroll = stageRef.current?.closest("[data-studio-pasteboard]") as HTMLElement | null;
    if (el instanceof HTMLElement && scroll) {
      centrarEnPasteboard(scroll, el);
      return;
    }
    el?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  }, [selectedIds, stageRef]);
}

/**
 * Al abrir el lienzo (o cambiar zoom), coloca la primera hoja
 * en el centro del área de trabajo.
 */
export function useCentrarLienzoPorDefecto(
  pasteboardRef: RefObject<HTMLDivElement | null>,
  stageRef: RefObject<HTMLDivElement | null>,
  zoom: number,
  hojasKey: string,
) {
  useEffect(() => {
    const scroll = pasteboardRef.current;
    const stage = stageRef.current;
    if (!scroll || !stage || !hojasKey) return;

    const run = () => {
      const first =
        (stage.querySelector("[data-studio-hoja]") as HTMLElement | null) || stage;
      centrarEnPasteboard(scroll, first);
    };

    const id = window.requestAnimationFrame(() => {
      run();
      window.requestAnimationFrame(run);
    });
    return () => window.cancelAnimationFrame(id);
  }, [pasteboardRef, stageRef, zoom, hojasKey]);
}
