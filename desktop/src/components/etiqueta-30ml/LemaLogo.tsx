/**
 * Lema de la casa bajo el logo, con el MISMO ancho que el logo dibujado.
 *
 * El tamaño de letra sale de una regla de tres: se mide el texto una sola vez
 * a un tamaño de referencia con una copia invisible (medir el propio lema
 * haría oscilar el cálculo) y se compara con el ancho del logo. El <img> del
 * logo llena su caja con `object-fit: contain`, así que su ancho visible no
 * es el de la caja: se deduce de la proporción natural de la imagen.
 * Sin logo cargado, el lema queda en el tamaño de su hoja de estilos.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { ESLOGAN } from "../etiqueta-ficha/ProductHeader";

const TAM_ESPEJO = 100;

export default function LemaLogo({
  logoRef,
  logoUrl,
  className = "",
}: {
  /** Contenedor donde vive el <img> del logo. */
  logoRef: RefObject<HTMLElement | null>;
  logoUrl?: string;
  className?: string;
}) {
  const espejo = useRef<HTMLSpanElement>(null);
  const [tam, setTam] = useState<number | null>(null);

  // useEffect y no useLayoutEffect: el `logoRef` es del padre y React lo
  // asigna después de los efectos de layout de este hijo.
  useEffect(() => {
    const img = logoRef.current?.querySelector("img");
    const esp = espejo.current;
    if (!img || !esp) {
      setTam(null);
      return;
    }
    const medir = () => {
      // offset*: sin la escala del marco, igual que `useAjusteTexto`.
      const { offsetWidth: w, offsetHeight: h, naturalWidth: nw, naturalHeight: nh } = img;
      const anchoTexto = esp.offsetWidth;
      if (!w || !h || !nw || !nh || !anchoTexto) return;
      const anchoLogo = Math.min(w, (h * nw) / nh);
      const nuevo = Math.round(((TAM_ESPEJO * anchoLogo) / anchoTexto) * 10) / 10;
      setTam((prev) => (prev !== null && Math.abs(prev - nuevo) < 0.15 ? prev : nuevo));
    };
    medir();
    img.addEventListener("load", medir);
    const ro = new ResizeObserver(medir);
    ro.observe(img);
    ro.observe(esp);
    // La medida del texto cambia cuando termina de cargar Montserrat.
    document.fonts?.ready.then(medir).catch(() => {});
    return () => {
      img.removeEventListener("load", medir);
      ro.disconnect();
    };
  }, [logoRef, logoUrl]);

  return (
    <>
      <span ref={espejo} className="e30-lema e30-lema-espejo" aria-hidden="true">
        {ESLOGAN}
      </span>
      <p className={`e30-lema ${className}`} style={tam ? { fontSize: tam } : undefined}>
        {ESLOGAN}
      </p>
    </>
  );
}
