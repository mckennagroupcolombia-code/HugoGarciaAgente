import EditableField from "./EditableField";
import { IconoCorreo, IconoTelefono, IconoUbicacion } from "./iconosLineales";

/** Pie de página: barra naranja sólida con 3 grupos de contacto separados
 *  por divisores blancos. ~10% del alto total de la ficha. */
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
  const grupos = [
    { key: "city", icon: <IconoUbicacion />, value: city, onChange: onCityChange },
    { key: "phone", icon: <IconoTelefono />, value: phone, onChange: onPhoneChange },
    { key: "email", icon: <IconoCorreo />, value: email, onChange: onEmailChange },
  ];
  return (
    <div className="flex h-[46px] items-center justify-center divide-x divide-white/60 bg-[#FFA500] px-3">
      {grupos.map((g) => (
        <div key={g.key} className="flex items-center gap-2 px-4 first:pl-0 last:pr-0">
          <span className="text-white">{g.icon}</span>
          <EditableField
            value={g.value}
            onChange={g.onChange}
            editMode={editMode}
            variant="dark"
            styleKey={g.key}
            defaultFontSize={13}
            className="text-center font-semibold text-white"
          />
        </div>
      ))}
    </div>
  );
}
