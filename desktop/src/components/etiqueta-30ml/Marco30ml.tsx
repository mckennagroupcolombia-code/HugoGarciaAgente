import type { ReactNode } from "react";
import { ESCALA_MINIMA, useEscalaAjuste } from "../etiqueta-ficha/useEscalaAjuste";

/** Marco de formato de las etiquetas de retícula fija (30 mL, 69 × 51 mm,
 *  circular 53) — el mismo marco punteado de la ficha de 76 × 66, que es el
 *  tamaño real de la etiqueta.
 *
 *  La etiqueta se maqueta SIEMPRE a su tamaño de diseño y, si no cabe en el
 *  hueco, se dibuja escalada con un `transform` sobre el lienzo entero: así
 *  se ve completa de un vistazo, sin barras que recorrer. Escalar así no es
 *  lo mismo que encogerla cambiando medidas —que fue lo que se intentó al
 *  principio y rompía la edición—: con `transform`, el ajuste automático de
 *  texto sigue midiendo a tamaño de diseño (`scrollWidth`/`clientWidth`, que
 *  no ve transformaciones) y los clics caen donde se ven. Nunca se agranda
 *  por encima del 100 %, y por debajo de `ESCALA_MINIMA` se deja de encoger
 *  y el marco vuelve a recorrerse. */
export default function Marco30ml({
  reticula,
  children,
}: {
  /** Medidas de diseño de la etiqueta (px); sirve para cualquier formato. */
  reticula: { ancho: number; alto: number };
  children: ReactNode;
}) {
  // 4 px: el borde punteado del marco (2 px por lado). Con
  // `box-sizing: border-box` el hueco de adentro mide justo la etiqueta.
  const anchoMarco = reticula.ancho + 4;
  const altoMarco = reticula.alto + 4;
  const { ref, escala } = useEscalaAjuste(anchoMarco, altoMarco);

  return (
    <div ref={ref} className={`w-full pb-1 ${escala <= ESCALA_MINIMA ? "overflow-x-auto" : ""}`}>
      {/* Esta caja mide lo que ocupa la etiqueta YA escalada: un `transform`
          no cambia el hueco que el elemento reserva en la maqueta, así que
          sin ella quedaría un vacío del tamaño sin escalar debajo. */}
      <div className="mx-auto" style={{ width: anchoMarco * escala, height: altoMarco * escala }}>
        <div
          className="relative overflow-hidden border-2 border-dashed border-[color:var(--acento-60)] bg-[#f4f4f2]"
          style={{
            width: anchoMarco,
            height: altoMarco,
            transform: `scale(${escala})`,
            transformOrigin: "top left",
          }}
        >
          <div className="absolute left-0 top-0" style={{ width: reticula.ancho, height: reticula.alto }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
