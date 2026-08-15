import { useQuery } from "@tanstack/react-query";
import { useTicketsAuth } from "../stores/ticketsAuth";

export interface EventoActividadEquipo {
  id: number;
  creado_en: string;
  usuario_nombre: string;
  accion: string;
  ticket_numero: string;
  ticket_titulo: string;
  resumen: string;
}

export interface ActividadEquipoResponse {
  eventos: EventoActividadEquipo[];
}

export function useActividadEquipo() {
  const token = useTicketsAuth((s) => s.token);
  return useQuery<ActividadEquipoResponse>({
    queryKey: ["actividad-equipo"],
    queryFn: async () => {
      const res = await fetch(`${window.location.origin}/api/tickets/actividad-equipo`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || `Error ${res.status}`);
      }
      return res.json() as Promise<ActividadEquipoResponse>;
    },
    enabled: !!token,
    refetchInterval: 45_000,
    retry: 1,
  });
}
