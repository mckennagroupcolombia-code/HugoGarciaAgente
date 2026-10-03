import { useUsuariosActivos } from "../../hooks/useConversaciones";
import { useTicketsAuth } from "../../stores/ticketsAuth";
import UserAvatar from "../UserAvatar";

/** Franja horizontal con la foto de los pocos usuarios que de verdad usan el panel
 * (por último login real, no el roster completo) (sin indicador de
 * conexión: se quitó a pedido el 23-sep-2026). Visible de forma persistente en el encabezado de Inicio. */
export default function EquipoConectadoBar() {
  const { token } = useTicketsAuth();
  const { data: usuarios = [] } = useUsuariosActivos(4);

  if (!token || usuarios.length === 0) return null;

  return (
    <div className="flex shrink-0 items-center gap-2 overflow-x-auto pl-1" aria-label="Equipo">
      {usuarios.map((u) => (
        <div key={u.id} title={u.nombre} className="shrink-0">
          <UserAvatar user={u} token={token} size="sm" />
        </div>
      ))}
    </div>
  );
}
