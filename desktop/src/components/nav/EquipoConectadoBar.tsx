import { useMemo } from "react";
import { usePresenciaEnLinea, useUsuariosActivos } from "../../hooks/useConversaciones";
import { useTicketsAuth } from "../../stores/ticketsAuth";
import UserAvatar from "../UserAvatar";

/** Franja horizontal con la foto de los pocos usuarios que de verdad usan el panel
 * (por último login real, no el roster completo) — punto verde = con el panel
 * abierto ahora. Visible de forma persistente en el encabezado de Inicio. */
export default function EquipoConectadoBar() {
  const { token } = useTicketsAuth();
  const { data: presencia } = usePresenciaEnLinea();
  const { data: usuarios = [] } = useUsuariosActivos(4);
  const enLineaIds = useMemo(() => new Set(presencia?.usuario_ids ?? []), [presencia]);

  if (!token || usuarios.length === 0) return null;

  return (
    <div className="flex shrink-0 items-center gap-2 overflow-x-auto pl-1" aria-label="Equipo">
      {usuarios.map((u) => {
        const enLinea = enLineaIds.has(u.id);
        return (
          <div key={u.id} title={u.nombre} className="relative shrink-0">
            <UserAvatar user={u} token={token} size="sm" />
            <span
              className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface ${
                enLinea ? "bg-emerald-500" : "bg-muted/40"
              }`}
            />
          </div>
        );
      })}
    </div>
  );
}
