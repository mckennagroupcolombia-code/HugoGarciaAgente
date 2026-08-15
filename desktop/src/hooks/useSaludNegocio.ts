import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

export type SaludPeriodicidad = "semana" | "mes";

export interface SaludCostosAdmin {
  nomina: number;
  servicios: number;
  total: number;
}

export interface SaludBucket {
  inicio: string;
  fin: string;
  label: string;
  dias: number;
  ingresos_meli: number;
  ingresos_web: number;
  ingresos_total: number;
  costo_producto: number;
  comisiones_meli: number;
  gasto_ads: number;
  acos_ads: number | null;
  costos_admin: SaludCostosAdmin;
  utilidad_neta: number;
  margen_pct: number;
  score: number;
  calificacion: "excelente" | "bueno" | "regular" | "riesgo";
  componentes: {
    margen: number;
    eficiencia_ads: number;
    tendencia: number;
  };
}

export interface SaludNegocioResumen {
  periodicidad: SaludPeriodicidad;
  n: number;
  generado_en: string;
  buckets: SaludBucket[];
  actual: SaludBucket | null;
  tendencia_margen_pp: number | null;
}

export function useSaludNegocioResumen(periodicidad: SaludPeriodicidad = "semana", n: number = 8) {
  return useQuery<SaludNegocioResumen>({
    queryKey: ["salud-negocio-resumen", periodicidad, n],
    queryFn: () =>
      api.get(`/api/salud-negocio/resumen?periodicidad=${periodicidad}&n=${n}`, { timeoutMs: 60_000 }),
    staleTime: 5 * 60_000,
  });
}

export function useRefrescarSaludNegocio(periodicidad: SaludPeriodicidad, n: number) {
  const queryClient = useQueryClient();
  return async () => {
    const data = await api.get<SaludNegocioResumen>(
      `/api/salud-negocio/resumen?periodicidad=${periodicidad}&n=${n}&refresh=1`,
      { timeoutMs: 60_000 },
    );
    queryClient.setQueryData(["salud-negocio-resumen", periodicidad, n], data);
    return data;
  };
}
