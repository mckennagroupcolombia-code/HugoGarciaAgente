import EditableField, { EditableLabel } from "./EditableField";
import { TITULOS_CAS } from "./productLabelTypes";

/** Cuadro técnico de Concentración / CAS — borde naranja, dos filas, un
 *  divisor naranja horizontal y uno vertical entre label y dato. Tabla
 *  editorial abierta, no dos cajas separadas. */
export default function TechnicalIdentity({
  concentration,
  cas,
  onConcentrationChange,
  onCasChange,
  casTitulo,
  onCasTituloChange,
  editMode,
}: {
  concentration: string;
  cas: string;
  onConcentrationChange: (v: string) => void;
  onCasChange: (v: string) => void;
  /** "CAS" o "EINECS" (sin dato = "CAS"). */
  casTitulo?: string;
  onCasTituloChange?: (v: string) => void;
  editMode: boolean;
}) {
  const rotuloCas = casTitulo || TITULOS_CAS[0];
  const filas: {
    key: string;
    label: string;
    value: string;
    onChange: (v: string) => void;
    opciones?: readonly string[];
    opcion?: string;
    onOpcion?: (v: string) => void;
  }[] = [
    { key: "concentration", label: "Pureza:", value: concentration, onChange: onConcentrationChange },
    {
      key: "cas",
      label: `${rotuloCas}:`,
      value: cas,
      onChange: onCasChange,
      opciones: TITULOS_CAS,
      opcion: rotuloCas,
      onOpcion: onCasTituloChange,
    },
  ];
  return (
    <div className="grid w-full grid-cols-[auto_1fr] overflow-hidden rounded-[4px] border-[1.5px] border-[color:var(--acento)] text-center">
      {filas.map((fila, i) => (
        <div key={fila.key} className="contents">
          <div
            className={`flex min-h-[34px] items-center justify-center border-r-[1.5px] border-[color:var(--acento)] px-3 ${
              i > 0 ? "border-t-[1.5px]" : ""
            }`}
          >
            <EditableLabel
              texto={fila.label}
              editMode={editMode}
              styleKey={`${fila.key}Titulo`}
              defaultFontSize={15}
              className="font-bold text-[#111111]"
              opciones={fila.opciones}
              valorOpcion={fila.opcion}
              onElegirOpcion={fila.onOpcion}
            />
          </div>
          <div
            className={`flex min-h-[34px] items-center justify-center px-3 ${i > 0 ? "border-t-[1.5px] border-[color:var(--acento)]" : ""}`}
          >
            <EditableField
              value={fila.value}
              onChange={fila.onChange}
              editMode={editMode}
              styleKey={fila.key}
              defaultFontSize={15}
              className="text-center font-semibold text-[#111111]"
            />
          </div>
        </div>
      ))}
    </div>
  );
}
