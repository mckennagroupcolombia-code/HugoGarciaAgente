import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

export interface ProductoPostventa {
  nombre: string;
  cantidad: number;
  precio_unitario: number | null;
}

export interface MensajePostventaPendiente {
  codigo: string;
  pack_id: string;
  comprador: string;
  texto: string;
  productos: string[];
  productos_detalle: ProductoPostventa[];
  total: string;
  fecha_compra: string;
  envio: string;
  timestamp: string;
  msg_id: string;
  tipo_solicitud?: string;
  tipo_solicitud_label?: string;
  espera_min?: number | null;
}

export interface MensajeHistorialPostventa {
  de: "comprador" | "vendedor";
  nombre: string;
  texto: string;
  fecha: string;
}

export interface PostventaBarra {
  id?: string;
  label: string;
  count: number;
  pct: number;
  grado?: string;
}

export interface PostventaEstadisticas {
  periodo: { dias: number; desde: string | null; hasta: string; zona: string };
  cola: {
    pendientes: number;
    espera_mediana_min: number | null;
    espera_max_min: number | null;
  };
  tiempos: {
    n: number;
    mediana_min: number | null;
    media_min: number | null;
    p90_min: number | null;
    sla_15_pct: number | null;
    sla_24h_pct: number | null;
    sla: PostventaBarra[];
    por_via: Record<string, number>;
    omitidos: number;
    respondidos: number;
  };
  solicitudes: PostventaBarra[];
  solicitudes_total: number;
  reclamos: {
    total: number;
    abiertos: number;
    cerrados: number;
    motivos: PostventaBarra[];
  };
  nota?: string;
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

interface OmitirResult {
  ok: boolean;
  error?: string;
  omitido?: boolean;
  pack_id?: string;
  codigo?: string;
  comprador?: string;
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
      qc.invalidateQueries({ queryKey: ["postventa-estadisticas"] });
    },
  });
}

export function useOmitirPostventa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { codigo: string }) =>
      api.post<OmitirResult>("/api/postventa/omitir", vars),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["postventa-pendientes"] });
      qc.invalidateQueries({ queryKey: ["postventa-estadisticas"] });
    },
  });
}

export function usePostventaEstadisticas(dias: number) {
  return useQuery<PostventaEstadisticas>({
    queryKey: ["postventa-estadisticas", dias],
    queryFn: () => api.get(`/api/postventa/estadisticas?dias=${dias}`),
    refetchInterval: 60_000,
    staleTime: 20_000,
  });
}
