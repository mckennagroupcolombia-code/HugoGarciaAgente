import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export interface AlertaSistema {
  id: string;
  severidad: "critica" | "advertencia";
  titulo: string;
  detalle: string;
  desde: string;
  accion_sugerida?: string;
}

export function useAlertasSistema() {
  return useQuery<{ alertas: AlertaSistema[] }>({
    queryKey: ["alertas-sistema"],
    queryFn: () => api.get("/api/alertas/sistema"),
    refetchInterval: 30_000,
    // Si falla la consulta, no queremos que un banner de error tape la app entera.
    retry: 1,
  });
}
