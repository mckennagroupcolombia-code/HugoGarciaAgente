import { forwardRef, useEffect } from "react";
import type { AttributeKey } from "../etiqueta-ficha/ProductAttributeGrid";
import type { ProductLabelData } from "../etiqueta-ficha/productLabelTypes";
import type { CodigoEan } from "../../lib/etiquetasCodigosEan";
import PanelAuxiliarCapsulas from "./PanelAuxiliarCapsulas";
import PanelPrincipalCapsulas from "./PanelPrincipalCapsulas";
import { parcheInicialCapsulas, variablesCapsulas, type ReticulaCapsulas } from "./etiquetaCapsulasTypes";
import "../etiqueta-30ml/etiqueta30ml.css";
import "./etiquetaCapsulas.css";

interface Props {
  data: ProductLabelData;
  reticula: ReticulaCapsulas;
  /** Edición en el sitio; en vista es la etiqueta terminada (PNG, impresión). */
  editMode: boolean;
  attributeIcons: Partial<Record<AttributeKey, string>>;
  /** Pistas de la retícula (líneas punteadas) para verificarla. */
  guias?: boolean;
  onChange?: (patch: Partial<ProductLabelData>) => void;
  onIconChange?: (campo: AttributeKey, svgDataUrl: string) => void;
  onElegirCodigo?: (codigo: CodigoEan) => void;
}

/** Etiqueta de cápsulas de 66 × 22 mm a su tamaño de diseño. Es el nodo que
 *  se rasteriza para el PNG y la impresión: quien la muestra la escala desde
 *  afuera (`Marco30ml`), nunca por dentro. */
const EtiquetaCapsulas = forwardRef<HTMLDivElement, Props>(function EtiquetaCapsulas(
  { data, reticula, editMode, attributeIcons, guias, onChange, onIconChange, onElegirCodigo },
  ref,
) {
  // Primera vez que se abre en edición: rellena las casillas vacías con los
  // datos iniciales (nombre, subtítulo, composición, conservación, pie).
  // Queda marcada, así lo que luego se borre a propósito no vuelve.
  useEffect(() => {
    if (!editMode || !onChange) return;
    const parche = parcheInicialCapsulas(data);
    if (parche) onChange(parche);
  }, [editMode, onChange, data]);

  return (
    <div
      ref={ref}
      lang="es"
      className={`ecap-etiqueta${guias ? " e30-guias" : ""}${editMode ? " e30-editando" : ""}`}
      style={{ width: reticula.ancho, height: reticula.alto, ...variablesCapsulas(reticula, data.accentColor) }}
    >
      <PanelPrincipalCapsulas data={data} editMode={editMode} onChange={onChange} />
      <PanelAuxiliarCapsulas
        data={data}
        editMode={editMode}
        attributeIcons={attributeIcons}
        onChange={onChange}
        onIconChange={onIconChange}
        onElegirCodigo={onElegirCodigo}
      />
    </div>
  );
});

export default EtiquetaCapsulas;
