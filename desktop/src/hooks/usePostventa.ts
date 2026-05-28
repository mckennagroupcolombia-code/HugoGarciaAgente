import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

export interface MensajePostventaPendiente {
  codigo: string;
  pack_id: string;
  comprador: string;
  texto: string;
  productos: string[];
  timestamp: string;
  msg_id: string;
}

interface PendientesResponse {
  mensajes: MensajePostventaPendiente[];
  total: number;
}

interface ResponderResult {
  ok: boolean;
  error?: string;
  pack_id?: string;
  comprador?: string;
  cerrada_en_meli?: boolean;
  motivo?: string;
}

export function usePostventa() {
  return useQuery<PendientesResponse>({
    queryKey: ["postventa-pendientes"],
    queryFn: () => api.get("/api/postventa/pendientes"),
    refetchInterval: 20_000,
  });
}

export function useResponderPostventa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { codigo: string; respuesta: string }) =>
      api.post<ResponderResult>("/api/responder-postventa", vars),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["postventa-pendientes"] });
    },
  });
}
