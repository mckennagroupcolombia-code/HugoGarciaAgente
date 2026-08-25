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
  fuente?: string;
}

export type VeredictoCompetencia =
  | "mas_caro"
  | "mas_barato"
  | "similar"
  | "sin_competencia";

export interface ListadoCaptura {
  titulo: string;
  nombre?: string;
  precio: number;
  cantidad?: string;
  valor_total?: number;
  vendedor?: string;
  permalink?: string;
  vendidos?: number | null;
  envio_gratis?: boolean;
  delta_pct?: number | null;
  es_nuestra?: boolean;
}

export interface ReporteCaptura {
  item_id: string;
  generado_en?: string;
  nuestro_precio?: number;
  nuestro_titulo?: string;
  nuestra_cantidad?: string;
  presentacion_requerida?: string | null;
  n_vistos?: number;
  n_comparables?: number;
  min_precio?: number | null;
  veredicto?: VeredictoCompetencia;
  delta_pct_vs_min?: number | null;
  resumen?: string;
  listados?: ListadoCaptura[];
  tabla?: ListadoCaptura[];
  evidencia_png?: string | null;
}

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
  reporte_captura?: ReporteCaptura | null;
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

export function useReporteCapturaCompetencia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      item_id: string;
      titulo?: string;
      precio?: number;
      imagen: Blob;
    }) => {
      const form = new FormData();
      form.append("item_id", args.item_id);
      if (args.titulo) form.append("titulo", args.titulo);
      if (args.precio != null) form.append("precio", String(args.precio));
      const name = args.imagen.type.includes("png") ? "captura.png" : "captura.jpg";
      form.append("imagen", args.imagen, name);
      return api.upload<AnalisisCompetencia & { reporte?: ReporteCaptura }>(
        "/api/meli/competencia-precios/reporte-captura",
        form,
        { timeoutMs: 180_000 },
      );
    },
    onSuccess: (data) => {
      qc.setQueryData(["meli-competencia-precios"], data);
    },
  });
}

export function useActualizarPrecioBaseCompetencia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { item_id: string; precio: number; sku?: string }) =>
      api.post<AnalisisCompetencia & { precio?: number; aviso_meli?: string; meli?: { ok?: boolean; msg?: string } }>(
        "/api/meli/competencia-precios/precio-base",
        body,
        { timeoutMs: 60_000 },
      ),
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
