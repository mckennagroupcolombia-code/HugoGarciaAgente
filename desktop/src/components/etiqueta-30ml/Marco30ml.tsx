import type { ReactNode } from "react";

/** Marco de formato de las etiquetas de retícula fija (30 mL, 69 × 51 mm,
 *  circular 53) — el mismo marco punteado de la ficha de 76 × 66, que es el
 *  tamaño real de la etiqueta.
 *
 *  Va SIEMPRE al 100 % de su tamaño de diseño: ni se agranda ni se encoge
 *  para caber en la pantalla. Antes se escalaba al ancho disponible (hasta
 *  el 55 %), y sobre un lienzo encogido no se puede trabajar: los textos
 *  quedan por debajo del tamaño al que se diseñaron y cada clic cae en un
 *  sitio distinto del que se ve. Si la ventana es más angosta que la
 *  etiqueta, el marco se recorre en horizontal. */
export default function Marco30ml({
  reticula,
  children,
}: {
  /** Medidas de diseño de la etiqueta (px); sirve para cualquier formato. */
  reticula: { ancho: number; alto: number };
  children: ReactNode;
}) {
  return (
    <div className="w-full overflow-x-auto pb-1">
      <div
        // 4 px: el borde punteado del marco (2 px por lado). Con
        // `box-sizing: border-box` el hueco de adentro mide justo la
        // etiqueta.
        className="relative mx-auto overflow-hidden border-2 border-dashed border-[color:var(--acento-60)] bg-[#f4f4f2]"
        style={{ width: reticula.ancho + 4, height: reticula.alto + 4 }}
      >
        <div className="absolute left-0 top-0" style={{ width: reticula.ancho, height: reticula.alto }}>
          {children}
        </div>
      </div>
    </div>
  );
}
