/**
 * Encoge el cladograma lo justo para que quepa en el lienzo sin scroll. Usa `zoom` (no
 * `transform`): así el árbol reducido ocupa de verdad menos sitio y sigue centrado. Por
 * debajo de `minimo` ya no se lee bien: ahí vuelve el scroll del lienzo.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

export function AjustarAlLienzo({ children, minimo = 0.6 }: { children: ReactNode; minimo?: number }) {
  const caja = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);

  useLayoutEffect(() => {
    const hijo = caja.current;
    const lienzo = hijo?.parentElement;
    if (!hijo || !lienzo) return;
    const medir = () => {
      const z = Number(getComputedStyle(hijo).zoom) || 1;
      // Alto natural (a zoom 1): el del árbol no depende del ancho (hojas en 4 columnas fijas).
      const natural = hijo.getBoundingClientRect().height / z;
      if (!natural) return;
      let nuevo = Math.min(1, lienzo.clientHeight / natural);
      if (lienzo.scrollWidth > lienzo.clientWidth + 1) nuevo = Math.min(nuevo, (z * lienzo.clientWidth) / lienzo.scrollWidth);
      nuevo = Math.max(minimo, Math.floor(nuevo * 100) / 100);
      setZoom((antes) => (Math.abs(antes - nuevo) >= 0.01 ? nuevo : antes));
    };
    const ro = new ResizeObserver(medir);
    ro.observe(lienzo);
    ro.observe(hijo);
    medir();
    return () => ro.disconnect();
  }, [minimo]);

  return (
    <div ref={caja} style={{ zoom }} className="my-auto w-full shrink-0">
      {children}
    </div>
  );
}
