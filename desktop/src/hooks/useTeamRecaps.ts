import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export interface TeamRecap {
  fecha: string;
  titulo: string;
  autor: string;
  tipo_cambio: string;
  que_se_implemento: string[];
  archivos_modificados: string;
}

export interface TeamRecapsResponse {
  recaps?: TeamRecap[];
  error?: string;
}

export function useTeamRecaps(limit = 100) {
  return useQuery<TeamRecapsResponse>({
    queryKey: ["team-recaps", limit],
    queryFn: () => api.get(`/api/team-recaps?limit=${limit}`),
    refetchInterval: 60_000,
  });
}
