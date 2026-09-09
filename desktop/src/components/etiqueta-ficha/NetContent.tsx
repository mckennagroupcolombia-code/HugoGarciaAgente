import EditableField, { EditableLabel } from "./EditableField";

/** Contenido neto — label naranja + valor grande en negro. Divisor naranja
 *  a la derecha lo aplica el contenedor padre (borde compartido con el
 *  bloque de código de barras). */
export default function NetContent({
  value,
  onChange,
  editMode,
}: {
  value: string;
  onChange: (v: string) => void;
  editMode: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 border-r-[1.5px] border-[#FFA500] px-6 py-2.5">
      <EditableLabel
        texto={"Contenido\nNeto"}
        editMode={editMode}
        styleKey="netContentTitulo"
        defaultFontSize={17}
        className="whitespace-pre-line text-center font-bold uppercase leading-[1.05] tracking-wide text-[#FFA500]"
      />
      <EditableField
        value={value}
        onChange={onChange}
        editMode={editMode}
        styleKey="netContent"
        defaultFontSize={24}
        className="text-center font-extrabold leading-none text-[#111111]"
      />
    </div>
  );
}
