import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export interface Metricas {
  fecha?: string;
  mensajes_whatsapp?: number;
  preguntas_meli?: number;
  ordenes_meli?: number;
  mensajes_posventa?: number;
  pagos_confirmados?: number;
  token_meli?: boolean;
  token_gmail?: boolean;
  web_chat_interacciones_hoy?: number;
  web_chat_sin_revisar?: number;
  web_chat_activas_24h?: number;
  [key: string]: unknown;
}

export function useMetricas() {
  return useQuery<Metricas>({
    queryKey: ["metricas"],
    queryFn: () => api.get("/api/metricas"),
    refetchInterval: 30_000,
  });
}
