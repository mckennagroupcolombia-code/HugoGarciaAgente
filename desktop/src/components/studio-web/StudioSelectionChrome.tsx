import {
  useLayoutEffect,
  useState,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ElementType,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { medirCajaEnPapel, type CajaPapel } from "../../lib/studioSelectionBox";
import { SelectionDeleteBtn, SelectionSizeBadge } from "./StudioDeleteContext";

export type StudioChromeMode = "move" | "scale" | "resize-e" | "resize-s" | "resize-se";

const HANDLE =
  "absolute z-30 h-3.5 w-3.5 rounded-sm border-2 border-white bg-sky-500 shadow-md touch-none";

function pin(left: string, top: string): CSSProperties {
  return { left, top, transform: "translate(-50%, -50%)" };
}

/** Marco + asas anclados al recuadro real (portal al papel; no al flujo flex/inline). */
export function StudioSelectionChrome({
  host,
  hugText = false,
  onHandle,
}: {
  host: HTMLElement | null;
  hugText?: boolean;
  onHandle: (mode: StudioChromeMode, e: ReactPointerEvent) => void;
}) {
  const [box, setBox] = useState<CajaPapel | null>(null);
  const [paper, setPaper] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!host) {
      setBox(null);
      setPaper(null);
      return;
    }
    const hoja = host.closest("[data-studio-paper]") as HTMLElement | null;
    setPaper(hoja);
    if (!hoja) return;

    let raf = 0;
    const tick = () => {
      setBox(medirCajaEnPapel(host, hoja));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [host]);

  if (!host || !paper || !box || box.width < 1 || box.height < 1) return null;

  const mk = (mode: StudioChromeMode) => (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onHandle(mode, e);
  };

  return createPortal(
    <div
      data-studio-chrome=""
      className="pointer-events-none absolute z-40"
      style={{
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
      }}
    >
      <span className="pointer-events-none absolute inset-0 rounded border-2 border-sky-400 shadow-[0_0_0_1px_rgba(14,165,233,0.35)]" />
      <div className="pointer-events-auto">
        <SelectionDeleteBtn />
        <button
          type="button"
          data-studio-handle="move"
          title="Arrastrar"
          className="absolute z-30 flex h-5 -translate-y-full cursor-grab items-center gap-0.5 rounded-full border border-sky-400 bg-sky-500 px-2 text-[9px] font-bold uppercase tracking-wide text-white shadow active:cursor-grabbing touch-none"
          style={{ left: 0, top: -6 }}
          onPointerDown={mk("move")}
        >
          <span aria-hidden>⠿</span> mover
        </button>
        <button
          type="button"
          data-studio-handle="resize-e"
          title="Ancho"
          className={`${HANDLE} cursor-ew-resize`}
          style={pin("100%", "50%")}
          onPointerDown={mk("resize-e")}
        />
        {!hugText && (
          <>
            <button
              type="button"
              data-studio-handle="resize-s"
              title="Alto"
              className={`${HANDLE} cursor-ns-resize`}
              style={pin("50%", "100%")}
              onPointerDown={mk("resize-s")}
            />
            <button
              type="button"
              data-studio-handle="resize-se"
              title="Redimensionar"
              className={`${HANDLE} cursor-nwse-resize`}
              style={pin("100%", "100%")}
              onPointerDown={mk("resize-se")}
            />
          </>
        )}
        <button
          type="button"
          data-studio-handle="scale"
          title="Escala uniforme"
          className="absolute z-30 h-3.5 w-3.5 cursor-nesw-resize rounded-full border-2 border-white bg-amber-400 shadow-md touch-none"
          style={pin("0%", "100%")}
          onPointerDown={mk("scale")}
        />
      </div>
      <SelectionSizeBadge />
    </div>,
    paper,
  );
}

type FrameProps<T extends ElementType> = {
  as?: T;
  selected: boolean;
  primary?: boolean;
  hugText?: boolean;
  onHandle: (mode: StudioChromeMode, e: ReactPointerEvent) => void;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, "as">;

/** Nodo o sección: recuadro secundario in-situ; asas primarias en portal. */
export function StudioSelectableFrame<T extends ElementType = "div">({
  as,
  selected,
  primary,
  hugText,
  onHandle,
  children,
  className,
  ...rest
}: FrameProps<T>) {
  const Tag = (as || "div") as ElementType;
  const [host, setHost] = useState<HTMLElement | null>(null);
  const showHandles = selected && (primary ?? selected);
  return (
    <Tag
      ref={setHost as never}
      className={`relative ${className || ""}`}
      {...rest}
    >
      {children}
      {selected && !showHandles && (
        <span className="pointer-events-none absolute inset-0 rounded border-2 border-sky-300/90 bg-sky-400/10" />
      )}
      {showHandles ? (
        <StudioSelectionChrome host={host} hugText={hugText} onHandle={onHandle} />
      ) : null}
    </Tag>
  );
}
