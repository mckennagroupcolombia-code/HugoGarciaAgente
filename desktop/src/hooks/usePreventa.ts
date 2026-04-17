import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

export interface PreguntaPendiente {
  question_id: string;
  titulo_producto: string;
  pregunta: string;
  timestamp: string;
  respondida: boolean;
}

interface PendientesResponse {
  preguntas: PreguntaPendiente[];
  total: number;
}

export function usePreventa() {
  return useQuery<PendientesResponse>({
    queryKey: ["preventa-pendientes"],
    queryFn: () => api.get("/api/preventa/pendientes"),
    refetchInterval: 20_000,
  });
}

export function useResponderPreventa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { question_id: string; respuesta: string }) =>
      api.post("/api/responder-preventa", vars),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["preventa-pendientes"] });
    },
  });
}
