import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from "react";

export const StudioDeleteContext = createContext<(() => void) | undefined>(undefined);

/** X roja sobre el objeto seleccionado (dentro de la caja: overflow de la hoja no la recorta). */
export function SelectionDeleteBtn() {
  const onDelete = useContext(StudioDeleteContext);
  if (!onDelete) return null;
  const fire = (e: PointerEvent | MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDelete();
  };
  return (
    <button
      type="button"
      data-studio-handle="delete"
      title="Eliminar (Supr)"
      className="absolute -top-7 right-0 z-50 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-red-600 text-sm font-bold leading-none text-white shadow-md hover:bg-red-700"
      onPointerDown={fire}
      onClick={fire}
    >
      ×
    </button>
  );
}

/** Medida real (px CSS del sitio, sin zoom del lienzo) — offsetWidth ignora scale del stage. */
export function SelectionSizeBadge() {
  const ref = useRef<HTMLSpanElement>(null);
  const [label, setLabel] = useState("");
  useLayoutEffect(() => {
    const host = ref.current?.parentElement;
    if (!host) return;
    const tick = () => {
      setLabel(`${Math.round(host.offsetWidth)} × ${Math.round(host.offsetHeight)} px`);
    };
    tick();
    const ro = new ResizeObserver(tick);
    ro.observe(host);
    return () => ro.disconnect();
  }, []);
  return (
    <span
      ref={ref}
      className="pointer-events-none absolute -bottom-6 left-1/2 z-40 -translate-x-1/2 whitespace-nowrap rounded bg-sky-600 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white shadow"
    >
      {label || "…"}
    </span>
  );
}
