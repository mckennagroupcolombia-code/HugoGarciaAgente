import BarcodeBlock from "../etiqueta-ficha/BarcodeBlock";
import type { CodigoEan } from "../../lib/etiquetasCodigosEan";

/** Código de barras de la etiqueta 30 mL: es el mismo `BarcodeBlock` de la
 *  ficha de 76 × 66 (generador EAN-13 del repo, `lib/ean13`: barras reales
 *  con los 13 dígitos agrupados debajo, "7 700875 002637"), a la medida de
 *  esta retícula. En edición, clic sobre el código abre el buscador de SKU. */
export default function BarcodeSection({
  value,
  editMode,
  onChange,
  onElegirCodigo,
}: {
  value: string;
  editMode: boolean;
  onChange: (v: string) => void;
  onElegirCodigo?: (codigo: CodigoEan) => void;
}) {
  return (
    <BarcodeBlock
      value={value}
      onChange={onChange}
      onElegirCodigo={onElegirCodigo}
      editMode={editMode}
      className="e30-barras"
      claseBoton="e30-barras-boton mck-btn-no-fx"
      claseImagen="e30-barras-img"
    />
  );
}
