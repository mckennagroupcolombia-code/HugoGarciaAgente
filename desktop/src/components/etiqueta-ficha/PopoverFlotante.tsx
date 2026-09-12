/**
 * Desplegable flotante compartido por los buscadores de la ficha (código de
 * barras, ficha técnica, logos). Se porta a `document.body` y se posiciona
 * con coordenadas de viewport (`position: fixed`) bajo el ancla — o encima,
 * si abajo no cabe.
 *
 * Motivo: el lienzo de la ficha tiene `overflow-hidden` (esquinas
 * redondeadas) y, con un Formato elegido, vive dentro de un marco con
 * `transform: scale()` + `overflow-hidden`. Un hijo `absolute` ahí queda
 * RECORTADO (el del código de barras, al pie de la ficha, no se veía casi
 * nunca) y además ESCALADO junto con la ficha. Mismo patrón que
 * `MenuTamanoFuente` en EditableField.
 */
import { useEffect, useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

/** Marca el popover (ya fuera del árbol del ancla) como "adentro" al
 *  detectar clics afuera. */
const ATTR_POPOVER = "data-popover-ficha";
const MARGEN = 8;
const SEPARACION = 6;
/** Si abajo queda menos que esto y arriba hay más sitio, se abre hacia arriba. */
const MIN_ALTO_ABAJO = 240;

interface Posicion {
  left: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

export default function PopoverFlotante({
  anchorRef,
  abierto,
  onCerrar,
  alinear = "centro",
  ancho = 288,
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  abierto: boolean;
  onCerrar: () => void;
  /** Alineación horizontal respecto al ancla. */
  alinear?: "centro" | "izquierda" | "derecha";
  ancho?: number;
  children: ReactNode;
}) {
  const [pos, setPos] = useState<Posicion | null>(null);

  useLayoutEffect(() => {
    if (!abierto) {
      setPos(null);
      return;
    }
    const el = anchorRef.current;
    if (!el) return;
    const actualizar = () => {
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const anchoReal = Math.min(ancho, vw - MARGEN * 2);
      let left =
        alinear === "centro"
          ? r.left + r.width / 2 - anchoReal / 2
          : alinear === "derecha"
            ? r.right - anchoReal
            : r.left;
      left = Math.max(MARGEN, Math.min(left, vw - anchoReal - MARGEN));
      const espacioAbajo = vh - r.bottom - SEPARACION - MARGEN;
      const espacioArriba = r.top - SEPARACION - MARGEN;
      if (espacioAbajo < MIN_ALTO_ABAJO && espacioArriba > espacioAbajo) {
        setPos({ left, bottom: vh - r.top + SEPARACION, maxHeight: Math.max(120, espacioArriba) });
      } else {
        setPos({ left, top: r.bottom + SEPARACION, maxHeight: Math.max(120, espacioAbajo) });
      }
    };
    actualizar();
    window.addEventListener("scroll", actualizar, true);
    window.addEventListener("resize", actualizar);
    return () => {
      window.removeEventListener("scroll", actualizar, true);
      window.removeEventListener("resize", actualizar);
    };
  }, [abierto, anchorRef, alinear, ancho]);

  useEffect(() => {
    if (!abierto) return;
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t)) return;
      if (t instanceof Element && t.closest(`[${ATTR_POPOVER}]`)) return;
      onCerrar();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [abierto, anchorRef, onCerrar]);

  if (!abierto || !pos || typeof document === "undefined") return null;

  return createPortal(
    <div
      {...{ [ATTR_POPOVER]: true }}
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        bottom: pos.bottom,
        width: Math.min(ancho, window.innerWidth - MARGEN * 2),
        maxHeight: pos.maxHeight,
      }}
      className="z-[300] flex flex-col overflow-y-auto rounded-lg border border-border bg-surface-panel p-2.5 text-left text-ink shadow-2xl"
    >
      {children}
    </div>,
    document.body,
  );
}
