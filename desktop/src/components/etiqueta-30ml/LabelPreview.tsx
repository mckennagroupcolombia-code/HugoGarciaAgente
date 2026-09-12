import { forwardRef } from "react";
import type { AttributeKey } from "../etiqueta-ficha/ProductAttributeGrid";
import type { ProductLabelData } from "../etiqueta-ficha/productLabelTypes";
import type { CodigoEan } from "../../lib/etiquetasCodigosEan";
import LeftTechnicalPanel from "./LeftTechnicalPanel";
import CenterProductPanel from "./CenterProductPanel";
import RightDocumentationPanel from "./RightDocumentationPanel";
import { variables30ml, type Reticula30ml } from "./etiqueta30mlTypes";
import "./etiqueta30ml.css";

interface Props {
  data: ProductLabelData;
  reticula: Reticula30ml;
  /** Edición en el sitio (como la ficha de 76 × 66); en vista es la etiqueta
   *  terminada, tal como sale en el PNG y en la impresión. */
  editMode: boolean;
  attributeIcons: Partial<Record<AttributeKey, string>>;
  /** Muestra las pistas de la retícula (líneas punteadas) para verificarla. */
  guias?: boolean;
  onChange?: (patch: Partial<ProductLabelData>) => void;
  onIconChange?: (campo: AttributeKey, svgDataUrl: string) => void;
  onElegirCodigo?: (codigo: CodigoEan) => void;
}

/** La etiqueta completa, a su tamaño de diseño (ANCHO_30ML × alto del
 *  formato). Es el nodo que se rasteriza para el PNG y la impresión: quien la
 *  muestra la escala desde afuera, nunca por dentro. */
const LabelPreview = forwardRef<HTMLDivElement, Props>(function LabelPreview(
  { data, reticula, editMode, attributeIcons, guias, onChange, onIconChange, onElegirCodigo },
  ref,
) {
  return (
    <div
      ref={ref}
      lang="es"
      className={`e30-etiqueta${guias ? " e30-guias" : ""}${editMode ? " e30-editando" : ""}`}
      style={{ width: reticula.ancho, height: reticula.alto, ...variables30ml(reticula, data.accentColor) }}
    >
      <LeftTechnicalPanel
        data={data}
        editMode={editMode}
        onChange={onChange}
        attributeIcons={attributeIcons}
        onIconChange={onIconChange}
      />
      <CenterProductPanel data={data} editMode={editMode} onChange={onChange} />
      <RightDocumentationPanel
        data={data}
        editMode={editMode}
        onChange={onChange}
        onElegirCodigo={onElegirCodigo}
      />
    </div>
  );
});

export default LabelPreview;
