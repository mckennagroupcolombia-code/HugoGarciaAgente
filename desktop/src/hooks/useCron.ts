import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

export interface TareaCron {
  id: string;
  nombre: string;
  descripcion: string;
  script: string;
  intervalo_horas: number;
  ultima_ejecucion: string | null;
  proxima_ejecucion_estimada: string | null;
}

export function useTareasCron() {
  return useQuery<{ tareas: TareaCron[] }>({
    queryKey: ["cron-tareas"],
    queryFn: () => api.get("/api/cron/tareas"),
    refetchInterval: 60_000,
  });
}

export function useEstablecerFrecuenciaCron() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { jobId: string; intervaloHoras: number }) =>
      api.post(`/api/cron/tareas/${vars.jobId}/frecuencia`, { intervalo_horas: vars.intervaloHoras }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cron-tareas"] });
    },
  });
}
