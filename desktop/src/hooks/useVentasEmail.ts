import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

export interface CorreoVentasResumen {
  id: string;
  threadId?: string;
  de: string;
  asunto: string;
  fecha: string;
  snippet: string;
  no_leido: boolean;
}

interface PendientesResponse {
  correos: CorreoVentasResumen[];
  total: number;
}

export interface CorreoVentasDetalle extends CorreoVentasResumen {
  cuerpo: string;
}

export function useVentasEmailPendientes() {
  return useQuery<PendientesResponse>({
    queryKey: ["ventas-email-pendientes"],
    queryFn: () => api.get("/api/ventas-email/pendientes"),
    refetchInterval: 30_000,
  });
}

export function useVentasEmailDetalle(id: string | null) {
  return useQuery<CorreoVentasDetalle>({
    queryKey: ["ventas-email-detalle", id],
    queryFn: () => api.get(`/api/ventas-email/${id}`),
    enabled: !!id,
  });
}

interface ResponderResult {
  ok: boolean;
  error?: string;
  enviado_id?: string;
  para?: string;
  asunto?: string;
}

export function useResponderVentasEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { message_id: string; texto: string }) =>
      api.post<ResponderResult>("/api/responder-ventas-email", vars),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ventas-email-pendientes"] });
    },
  });
}
