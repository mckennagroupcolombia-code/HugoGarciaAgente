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

export interface PreventaConversionBloque {
  oportunidades: number;
  compraron_mismo_item: number;
  no_compraron_mismo_item: number;
  tasa_compra_pct: number;
  compraron_cualquier_item: number;
  tasa_compra_tienda_pct: number;
  preguntadores_unicos: number;
  compradores_unicos: number;
}

export interface PreventaProductoConv extends PreventaConversionBloque {
  item_id: string;
  titulo: string;
  preguntas: number;
}

export interface PreventaMetricas {
  generado_en: string;
  periodo: { dias: number; desde: string; hasta: string };
  preguntas_en_periodo: number;
  oportunidades_en_espera: number;
  margen_horas: number;
  resumen: PreventaConversionBloque;
  por_respuesta: {
    respondidas: PreventaConversionBloque;
    sin_responder: PreventaConversionBloque;
  };
  por_producto: PreventaProductoConv[];
  conversion_explicacion: {
    titulo: string;
    formula: string;
    numerador: number;
    denominador: number;
    resultado_pct: number;
    texto: string;
    compra_significa: string;
  };
  fuente?: { preguntas_meli: number; ordenes_pagadas: number };
  desde_cache?: boolean;
  stale?: boolean;
}

export function usePreventa() {
  return useQuery<PendientesResponse>({
    queryKey: ["preventa-pendientes"],
    queryFn: () => api.get("/api/preventa/pendientes"),
    refetchInterval: 20_000,
  });
}

export function usePreventaMetricas(dias: number) {
  const qc = useQueryClient();
  const query = useQuery<PreventaMetricas>({
    queryKey: ["preventa-metricas", dias],
    queryFn: () => api.get(`/api/preventa/metricas?dias=${dias}`),
    staleTime: 10 * 60_000,
    refetchInterval: false,
  });
  const recalcular = () =>
    api
      .get<PreventaMetricas>(`/api/preventa/metricas?dias=${dias}&refresh=1`)
      .then((d) => {
        qc.setQueryData(["preventa-metricas", dias], d);
        return d;
      });
  return { ...query, recalcular };
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
