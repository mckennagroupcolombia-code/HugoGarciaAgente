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
        className={`mb-[3px] flex h-16 w-16 items-center justify-center rounded-md border-0 bg-transparent p-0 text-[color:var(--acento)] transition-transform duration-150 ${
          editMode ? "cursor-pointer hover:scale-[1.06] hover:bg-[color:var(--acento-08)]" : "cursor-default"
        }`}
      >
        {iconSrc ? <img src={iconSrc} alt="" className="h-[58px] w-[58px] object-contain" /> : icon}
      </button>
      <EditableLabel
        texto={title}
        editMode={editMode}
        styleKey={`${styleKey}Titulo`}
        defaultFontSize={17}
        className="mb-[5px] font-bold uppercase leading-[1.05] tracking-wide text-[color:var(--acento)]"
      />
      <EditableField
        value={value}
        onChange={onChange}
        editMode={editMode}
        multiline
        marcoVisible
        styleKey={styleKey}
        defaultFontSize={14}
        // Texto descriptivo justificado al ancho del cuadro; la última línea
        // va centrada (un texto de una sola línea no se estira) y la
        // separación silábica (lang="es" en la raíz de la ficha) evita
        // huecos grandes entre palabras — justificado sin deformarse.
        //
        // min-h de 3 renglones (3 × line-height 1.22, en em para seguir al
        // tamaño de letra elegido): el cuadro reserva ese alto siempre, así
        // la ficha no crece —ni se encoge dentro del marco de formato— al
        // pasar de 1 a 3 renglones; la letra se mantiene. Ancho completo de
        // la celda (antes 92 % con tope 320 px) para que quepan más palabras
        // por renglón.
        className="w-full min-h-[3.7em] break-words text-justify [text-align-last:center] hyphens-auto font-medium leading-[1.22] text-[#111111]"
      />
    </div>
  );
}
