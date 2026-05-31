import { useQuery } from "@tanstack/react-query";
import { useTicketsAuth } from "../stores/ticketsAuth";

export interface OperadorPanelMetrica {
  usuario_id: number;
  nombre: string;
  username: string;
  rol: string | null;
  minutos_sesion: number;
  tareas_completadas: number;
  eventos_por_tipo: Record<string, number>;
  paneles_mas_usados: { panel: string; visitas: number }[];
  en_linea: boolean;
  panel_actual: string | null;
}

export interface PanelMetricasResponse {
  fecha: string;
  operadores: OperadorPanelMetrica[];
}

export interface PanelMiResumenResponse {
  fecha: string;
  resumen: OperadorPanelMetrica | null;
}

async function fetchTicketsJson<T>(path: string): Promise<T> {
  const jwt = useTicketsAuth.getState().token;
  if (!jwt) throw new Error("Sin sesión");
  const apiPath = path.startsWith("/api/") ? path : `/api/${path}`;
  const url = `${window.location.origin}${apiPath}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function usePanelMetricas(enabled: boolean, fecha?: string) {
  const q = fecha ? `?fecha=${encodeURIComponent(fecha)}` : "";
  return useQuery<PanelMetricasResponse>({
    queryKey: ["panel-metricas", fecha ?? "hoy"],
    queryFn: () => fetchTicketsJson(`/api/tickets/panel/metricas${q}`),
    enabled,
    refetchInterval: enabled ? 30_000 : false,
  });
}

export function usePanelMiResumen(enabled: boolean) {
  return useQuery<PanelMiResumenResponse>({
    queryKey: ["panel-mi-resumen"],
    queryFn: () => fetchTicketsJson("/api/tickets/panel/mi-resumen"),
    enabled,
    refetchInterval: enabled ? 30_000 : false,
  });
}
