import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export interface TelemetriaDiaMetricas {
  fecha?: string;
  contadores?: Record<string, number>;
  por_canal?: Record<string, number>;
}

export interface TelemetriaResumen {
  metricas: {
    hoy: TelemetriaDiaMetricas;
    historial_30d: TelemetriaDiaMetricas[];
  };
  errores_resumen: {
    total: number;
    dias: number;
    por_evento: Record<string, number>;
    por_origen: Record<string, number>;
  };
  servicios: Record<string, boolean>;
  error?: string;
}

export interface TelemetriaError {
  ts: number;
  iso: string;
  event: string;
  origen: string;
  request_id?: string;
  mensaje?: string;
  traceback?: string;
  contexto?: string;
}

export function useTelemetriaResumen() {
  return useQuery<TelemetriaResumen>({
    queryKey: ["telemetria-resumen"],
    queryFn: () => api.get("/api/telemetria/resumen"),
    refetchInterval: 30_000,
  });
}

export function useTelemetriaErrores(limite = 50) {
  return useQuery<{ errores: TelemetriaError[]; error?: string }>({
    queryKey: ["telemetria-errores", limite],
    queryFn: () => api.get(`/api/telemetria/errores?limite=${limite}`),
    refetchInterval: 30_000,
  });
}
