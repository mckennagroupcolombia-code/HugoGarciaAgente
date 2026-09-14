import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/** Por debajo de esto la etiqueta ya no se lee: en vez de seguir encogiendo,
 *  se deja que el marco se recorra como antes. */
export const ESCALA_MINIMA = 0.3;

/** Aire bajo el marco para que no quede pegado al borde de la ventana. */
const RESPIRO_INFERIOR = 24;

/**
 * Escala a la que hay que dibujar una etiqueta para que quepa entera en el
 * hueco disponible, sin barras de desplazamiento.
 *
 * Se aplica como `transform: scale()` sobre el lienzo COMPLETO, nunca sobre
 * sus partes ni cambiando medidas. Esa distinción es la que hace que siga
 * siendo editable: el ajuste automático de texto mide con `scrollWidth` y
 * `clientWidth`, que son valores de maquetación y no los toca un `transform`,
 * y los textos curvos miden en unidades del SVG. Los clics también caen donde
 * se ven, porque el navegador transforma las coordenadas. Lo que no se podía
 * hacer —y por eso el marco iba al 100 % fijo— era encoger la etiqueta
 * cambiando sus medidas: ahí sí se descuadraba todo.
 *
 * Nunca agranda (tope en 1): la etiqueta se ve, como mucho, a tamaño real.
 */
export function useEscalaAjuste(
  anchoNecesario: number,
  altoNecesario: number,
): { ref: RefObject<HTMLDivElement | null>; escala: number } {
  const ref = useRef<HTMLDivElement>(null);
  const [escala, setEscala] = useState(1);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => {
      const ancho = el.clientWidth;
      // Alto libre hasta el borde de la ventana desde donde arranca el marco.
      const arriba = el.getBoundingClientRect().top;
      const alto = window.innerHeight - arriba - RESPIRO_INFERIOR;
      const porAncho = ancho > 0 ? ancho / anchoNecesario : 1;
      const porAlto = alto > 0 ? alto / altoNecesario : 1;
      const k = Math.min(1, porAncho, porAlto);
      setEscala(Math.max(ESCALA_MINIMA, Number.isFinite(k) ? k : 1));
    };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    // Nada de recalcular al desplazarse: la escala cambiaría bajo el cursor
    // mientras se mira la etiqueta, que es peor que la propia barra.
    window.addEventListener("resize", medir);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", medir);
    };
  }, [anchoNecesario, altoNecesario]);

  return { ref, escala };
}
