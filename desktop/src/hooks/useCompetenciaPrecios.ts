import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

export interface ObservacionManual {
  id: string;
  item_id: string;
  precio: number;
  vendedor?: string;
  titulo?: string;
  permalink?: string;
  notas?: string;
  visto_en?: string;
}

export type VeredictoCompetencia =
  | "mas_caro"
  | "mas_barato"
  | "similar"
  | "sin_competencia";

export interface ProductoCompetencia {
  item_id: string;
  titulo: string;
  sku?: string;
  precio: number;
  permalink: string;
  unidades_periodo: number;
  query: string;
  url_busqueda_meli?: string;
  veredicto: VeredictoCompetencia;
  min_competencia?: number | null;
  delta_pct_vs_min?: number | null;
  n_competidores: number;
  observaciones_manual?: ObservacionManual[];
}

export interface ResumenCompetencia {
  productos: number;
  con_competencia: number;
  nosotros_mas_caros: number;
  nosotros_mas_baratos: number;
  similares: number;
  sin_match: number;
  observaciones_manual?: number;
}

export interface AnalisisCompetencia {
  ok: boolean;
  error?: string;
  generado_en?: string;
  dias?: number;
  top_n?: number;
  consulta?: string;
  metodo_busqueda?: string;
  vacio?: boolean;
  aviso?: string;
  desde_cache?: boolean;
  stale?: boolean;
  resumen?: ResumenCompetencia;
  productos?: ProductoCompetencia[];
}

export function useUltimoAnalisisCompetencia() {
  return useQuery<AnalisisCompetencia>({
    queryKey: ["meli-competencia-precios"],
    queryFn: () => api.get("/api/meli/competencia-precios"),
    staleTime: 30_000,
    retry: false,
  });
}

export function useAnalizarCompetenciaPrecios() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { top_n?: number; dias?: number; consulta?: string }) =>
      api.post<AnalisisCompetencia>(
        "/api/meli/competencia-precios/analizar",
        body,
        { timeoutMs: 180_000 },
      ),
    onSuccess: (data) => {
      qc.setQueryData(["meli-competencia-precios"], data);
    },
  });
}

export function useGuardarObservacionCompetencia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      item_id: string;
      precio: string | number;
      vendedor?: string;
      titulo?: string;
      permalink?: string;
      notas?: string;
    }) => api.post<AnalisisCompetencia>("/api/meli/competencia-precios/observacion", body),
    onSuccess: (data) => {
      qc.setQueryData(["meli-competencia-precios"], data);
    },
  });
}

export function useBorrarObservacionCompetencia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<AnalisisCompetencia>(
        `/api/meli/competencia-precios/observacion?id=${encodeURIComponent(id)}`,
      ),
    onSuccess: (data) => {
      qc.setQueryData(["meli-competencia-precios"], data);
    },
  });
}
