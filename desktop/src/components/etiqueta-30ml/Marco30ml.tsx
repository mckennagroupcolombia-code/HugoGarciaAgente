import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Reticula30ml } from "./etiqueta30mlTypes";

/** En pantallas angostas la escala no baja de aquí: la etiqueta se recorre
 *  de lado a lado antes que volverse ilegible. */
const ESCALA_MINIMA = 0.55;

/** Marco de formato de la etiqueta 30 mL — el mismo marco punteado de la
 *  ficha de 76 × 66 (tamaño real de la etiqueta), escalado al ancho de la
 *  pantalla. La etiqueta conserva siempre su proporción: nunca se reorganiza,
 *  y si no cabe, el marco se desplaza en horizontal. */
export default function Marco30ml({ reticula, children }: { reticula: Reticula30ml; children: ReactNode }) {
  const contRef = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState(0);
  useLayoutEffect(() => {
    const el = contRef.current;
    if (!el) return;
    const medir = () => setAncho(el.clientWidth);
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 4 px: el borde punteado del marco (2 px por lado).
  const escala = ancho ? Math.min(1, Math.max(ESCALA_MINIMA, (ancho - 4) / reticula.ancho)) : 0.8;

  return (
    <div ref={contRef} className="w-full overflow-x-auto pb-1">
      <div
        className="relative mx-auto overflow-hidden border-2 border-dashed border-[color:var(--acento-60)] bg-[#f4f4f2]"
        style={{ width: reticula.ancho * escala + 4, height: reticula.alto * escala + 4 }}
      >
        <div
          className="absolute left-0 top-0"
          style={{ width: reticula.ancho, height: reticula.alto, transform: `scale(${escala})`, transformOrigin: "top left" }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
