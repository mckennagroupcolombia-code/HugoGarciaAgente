import type { ReactNode } from "react";
import EditableField, { EditableLabel } from "./EditableField";

/** Un módulo de atributo: ícono (clicable, abre la galería) + título en
 *  mayúscula + valor — una sola unidad visual centrada. Sin `h-full`: se
 *  deja crecer con su propio contenido (la celda de `ProductAttributeGrid`
 *  ya se estira sola al alto de la fila) para que un texto largo nunca
 *  quede cortado. */
export default function ProductAttribute({
  icon,
  iconSrc,
  title,
  value,
  onChange,
  editMode,
  onEditarIcono,
  styleKey,
}: {
  /** Ícono por defecto (SVG propio) cuando no se ha elegido uno de la galería. */
  icon: ReactNode;
  /** Data URL del ícono elegido en la galería, si lo hay. */
  iconSrc?: string;
  title: string;
  value: string;
  onChange: (v: string) => void;
  editMode: boolean;
  /** Abre la galería de íconos para este módulo. */
  onEditarIcono?: () => void;
  /** Clave única del campo (ej. "origin") para el menú de tipografía. */
  styleKey: string;
}) {
  return (
    <div className="flex flex-col items-center px-4 py-2.5 text-center">
      <button
        type="button"
        disabled={!editMode}
        onClick={onEditarIcono}
        title={editMode ? "Cambiar ícono" : undefined}
        className={`mb-[3px] flex h-14 w-14 items-center justify-center rounded-md border-0 bg-transparent p-0 text-[#FFA500] transition-transform duration-150 ${
          editMode ? "cursor-pointer hover:scale-[1.06] hover:bg-[#FFA500]/[0.08]" : "cursor-default"
        }`}
      >
        {iconSrc ? <img src={iconSrc} alt="" className="h-[52px] w-[52px] object-contain" /> : icon}
      </button>
      <EditableLabel
        texto={title}
        editMode={editMode}
        styleKey={`${styleKey}Titulo`}
        defaultFontSize={17}
        className="mb-[5px] font-bold uppercase leading-[1.05] tracking-wide text-[#FFA500]"
      />
      <EditableField
        value={value}
        onChange={onChange}
        editMode={editMode}
        multiline
        styleKey={styleKey}
        defaultFontSize={14}
        className="mx-auto w-[92%] max-w-[320px] text-center font-medium leading-[1.22] text-[#111111]"
      />
    </div>
  );
}
