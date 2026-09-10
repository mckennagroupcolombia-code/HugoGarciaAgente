import EditableField from "./EditableField";
import { IconoCorreo, IconoTelefono, IconoUbicacion } from "./iconosLineales";
import { RETICULA_MAESTRA } from "./productLabelTypes";

/** Pie de página: barra naranja sólida con 3 grupos de contacto — misma
 *  retícula maestra de 3 columnas iguales que el resto de la ficha (antes
 *  cada grupo medía su propio ancho de contenido con `flex`, así que las
 *  tres columnas no coincidían con las de arriba). ~10% del alto total. */
export default function ContactFooter({
  city,
  phone,
  email,
  onCityChange,
  onPhoneChange,
  onEmailChange,
  editMode,
}: {
  city: string;
  phone: string;
  email: string;
  onCityChange: (v: string) => void;
  onPhoneChange: (v: string) => void;
  onEmailChange: (v: string) => void;
  editMode: boolean;
}) {
  // size={32} = el doble del tamaño por defecto (16) de este set de íconos.
  const grupos = [
    { key: "city", icon: <IconoUbicacion size={32} />, value: city, onChange: onCityChange },
    { key: "phone", icon: <IconoTelefono size={32} />, value: phone, onChange: onPhoneChange },
    { key: "email", icon: <IconoCorreo size={32} />, value: email, onChange: onEmailChange },
  ];
  return (
    <div className={`${RETICULA_MAESTRA} h-[46px] items-center bg-[color:var(--acento)]`}>
      {grupos.map((g, i) => (
        <div
          key={g.key}
          // Ícono | texto | espaciador invisible del mismo ancho que el
          // ícono — con el ícono a la izquierda y `justify-center` normal,
          // el grupo completo queda centrado pero el TEXTO se ve corrido
          // hacia la derecha (el ícono lo empuja). El espaciador fantasma
          // balancea el otro lado para que el texto sí quede centrado.
          className={`grid min-w-0 grid-cols-[32px_1fr_32px] items-center gap-2 px-2 ${
            i > 0 ? "border-l border-white/60" : ""
          }`}
        >
          <span className="text-white">{g.icon}</span>
          <EditableField
            value={g.value}
            onChange={g.onChange}
            editMode={editMode}
            variant="dark"
            styleKey={g.key}
            defaultFontSize={13}
            className="min-w-0 text-center font-semibold text-white"
          />
          <span aria-hidden="true" />
        </div>
      ))}
    </div>
  );
}
