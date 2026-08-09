import { useEffect, type ReactNode, type RefObject } from "react";

/** Mesa del capítulo: título + hojas escaladas sobre el pasteboard gris. */
export function MarcoCapitulo({
  titulo,
  zoom,
  hojasCount,
  stageId,
  stageRef,
  children,
}: {
  titulo: string;
  zoom: number;
  hojasCount: number;
  stageId: string;
  stageRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const slack = Math.max(1000, hojasCount * 680);
  return (
    <div
      ref={stageRef}
      data-studio-stage={stageId}
      className="mx-auto origin-top space-y-10 py-8"
      style={{
        width: 960,
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
  );
}

/** Una página del capítulo (sección del home = una hoja). */
export function FolioHoja({
  index,
  total,
  label,
  sectionId,
  onActivate,
  children,
}: {
  index: number;
  total: number;
  label: string;
  sectionId: string;
  onActivate?: () => void;
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
        className="overflow-hidden rounded-[2px] bg-white mck-paper-white shadow-[0_18px_50px_rgba(0,0,0,.35),0_2px_8px_rgba(0,0,0,.18)] ring-1 ring-black/15"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {children}
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
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedIds, stageRef]);
}
