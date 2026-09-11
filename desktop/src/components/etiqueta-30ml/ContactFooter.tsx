import type { ReactNode } from "react";
import CampoEtiqueta from "./CampoEtiqueta";
import { TAM_30ML } from "./etiqueta30mlTypes";

export interface DatoContacto {
  clave: string;
  icono: ReactNode;
  texto: string;
  ejemplo: string;
  onChange?: (v: string) => void;
}

/** Franja inferior de un solo color (el acento). Con dos datos se parte en dos
 *  columnas iguales —las mismas de la matriz de arriba— separadas por una
 *  línea blanca; con uno, el dato va centrado. Cada dato se edita en el sitio,
 *  como el pie de la ficha de 76 × 66. */
export default function ContactFooter({ datos, editMode }: { datos: DatoContacto[]; editMode: boolean }) {
  return (
    <div className="e30-franja" style={{ gridTemplateColumns: `repeat(${datos.length}, minmax(0, 1fr))` }}>
      {datos.map((d) => (
        <div key={d.clave} className="e30-franja-dato">
          <span className="e30-franja-icono" aria-hidden="true">
            {d.icono}
          </span>
          <CampoEtiqueta
            as="span"
            valor={d.texto}
            onChange={d.onChange}
            editMode={editMode}
            styleKey={`e30_${d.clave}`}
            ejemplo={d.ejemplo}
            tam={TAM_30ML.franja}
            maxLineas={1}
            oscuro
            className="e30-franja-texto"
          />
        </div>
      ))}
    </div>
  );
}
