import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

/** Cambia cada vez que termina de cargar una fuente web (Montserrat y sus
 *  pesos): lo medido con la fuente de respaldo queda mal en cuanto llega la
 *  real. `document.fonts.status` no sirve de aviso: dice "loaded" antes de
 *  que se pida la fuente, así que se escucha `loadingdone`. */
export function useVersionFuentes(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (typeof document === "undefined" || !document.fonts) return;
    const fuentes = document.fonts;
    let vivo = true;
    const avanzar = () => {
      if (vivo) setVersion((v) => v + 1);
    };
    fuentes.addEventListener("loadingdone", avanzar);
    void fuentes.ready.then(avanzar);
    return () => {
      vivo = false;
      fuentes.removeEventListener("loadingdone", avanzar);
    };
  }, []);
  return version;
}

interface OpcionesAjuste {
  /** Tamaño de letra máximo y mínimo, en px de diseño. */
  max: number;
  min: number;
  /** Renglones permitidos a cualquier tamaño. */
  maxLineas?: number;
  /** Caja de alto fijo que debe contener al texto (la celda, el bloque…). */
  cajaRef?: RefObject<HTMLElement | null>;
  /** El elemento es un <textarea>: su alto sigue al contenido en cada paso. */
  autoAlto?: boolean;
  /** Cualquier otro dato que obligue a volver a medir (modo, fuente…). */
  clave?: string;
  /** Avisa si el texto no cabe ni al tamaño mínimo. */
  onDesborde?: (desborda: boolean) => void;
}

/**
 * Ajusta el tamaño de letra de un texto a su casilla: arranca en `max` y baja
 * de medio en medio píxel hasta que cabe (ancho, renglones y alto de la caja)
 * o llega a `min`. La casilla nunca cambia de tamaño por el texto: es el texto
 * el que se adapta a la retícula. Sirve igual para el texto terminado que
 * para la casilla de edición en el sitio (textarea/input).
 *
 * Mide sin escala (offset/scroll), así funciona igual dentro del marco con
 * `transform: scale()` de la vista previa.
 */
export function useAjusteTexto(
  ref: RefObject<HTMLElement | null>,
  texto: string,
  { max, min, maxLineas, cajaRef, autoAlto, clave, onDesborde }: OpcionesAjuste,
) {
  const versionFuentes = useVersionFuentes();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const caja = cajaRef?.current ?? null;
    // Un <input> es de un renglón por naturaleza: su scrollHeight no mide
    // renglones y daría un falso "no cabe".
    const unRenglon = el instanceof HTMLInputElement;
    const ajustarAlto = () => {
      if (!autoAlto) return;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    };
    const cabe = () => {
      if (el.scrollWidth > el.clientWidth + 1) return false;
      if (maxLineas && !unRenglon) {
        // Renglones redondeando: el scrollHeight incluye la tinta de las
        // letras que sobresale del renglón (con line-height 1, un renglón de
        // 38 px mide 42) y no debe contar como un renglón de más.
        const lh = parseFloat(getComputedStyle(el).lineHeight);
        if (Number.isFinite(lh) && lh > 0 && Math.round(el.scrollHeight / lh) > maxLineas) return false;
      }
      if (caja && caja.scrollHeight > caja.clientHeight + 1) return false;
      return true;
    };
    let f = max;
    el.style.fontSize = `${f}px`;
    ajustarAlto();
    while (f > min && !cabe()) {
      f = Math.max(min, f - 0.5);
      el.style.fontSize = `${f}px`;
      ajustarAlto();
    }
    onDesborde?.(texto.trim() !== "" && !cabe());
    // onDesborde cambia en cada render del padre; no debe relanzar la medida.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto, max, min, maxLineas, autoAlto, clave, versionFuentes]);
}
