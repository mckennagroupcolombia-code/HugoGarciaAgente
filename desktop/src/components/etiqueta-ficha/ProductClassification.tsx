import EditableField from "./EditableField";

/** Banda naranja sólida con la clasificación del producto, centrada bajo
 *  el nombre (columnas 1+2 de la retícula maestra) — texto blanco, 100% de
 *  ancho (antes 85%; 85%×1.2 pasa de 100, así que el ancho máximo posible
 *  sin invadir la columna 3 es el tope natural), esquinas ligeramente
 *  redondeadas. */
export default function ProductClassification({
  value,
  onChange,
  editMode,
}: {
  value: string;
  onChange: (v: string) => void;
  editMode: boolean;
}) {
  return (
    <div className="mx-auto flex w-full min-h-[40px] items-center justify-center rounded-[3px] bg-[#FFA500] px-4">
      <EditableField
        value={value}
        onChange={onChange}
        editMode={editMode}
        variant="dark"
        styleKey="classification"
        defaultFontSize={15}
        className="w-full text-center font-bold uppercase leading-[1.1] tracking-wide text-white"
      />
    </div>
  );
}
