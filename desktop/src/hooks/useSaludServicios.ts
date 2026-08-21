import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export interface SaludItem {
  nombre: string;
  estado: "ok" | "alerta" | "caido";
  detalle: string;
}

export interface SaludEcosistema {
  general?: "ok" | "alerta" | "caido";
  items?: SaludItem[];
  error?: string;
}

export function useSaludServicios() {
  return useQuery<SaludEcosistema>({
    queryKey: ["salud-servicios"],
    queryFn: () => api.get("/api/sistema/salud"),
    refetchInterval: 60_000,
  });
}
