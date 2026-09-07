import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

export type SaludPeriodicidad = "dia" | "semana" | "mes";

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
  ingresos_otros_canales: number;
  otros_canales_facturas: number;
  otros_canales_con_marcador_wa: number;
  ingresos_total: number;
  costo_producto: number;
  comisiones_meli: number;
  gasto_ads: number;
  ads_disponible: boolean;
  cerrado: boolean;
  acos_ads: number | null;
  costos_admin: SaludCostosAdmin;
  utilidad_neta: number;
  margen_pct: number;
  unidades_vendidas: number;
  score: number;
  calificacion: "excelente" | "bueno" | "regular" | "riesgo";
  componentes: {
    margen: number;
    eficiencia_ads: number;
    tendencia: number;
  };
}

export interface SaludAdsRecomendaciones {
  pausar: number;
  revisar: number;
  costo_pausar: number;
  costo_revisar: number;
}

export interface SaludBancario {
  saldo: number;
  fecha: string;
  banco: string;
  cuenta: string;
}

export interface SaludNegocioResumen {
  periodicidad: SaludPeriodicidad;
  n: number;
  generado_en: string;
  buckets: SaludBucket[];
  actual: SaludBucket | null;
  tendencia_margen_pp: number | null;
  nomina_mensual: number;
  fuente_nomina: "rrhh_compensaciones" | "contabilidad_empleados" | "sin_datos";
  ads_recomendaciones: SaludAdsRecomendaciones | null;
  saldo_bancario: SaludBancario | null;
  /** true si el backend sirvió un resumen en caché mientras recalcula en background */
  stale?: boolean;
}

export function useSaludNegocioResumen(periodicidad: SaludPeriodicidad = "semana", n: number = 8) {
  return useQuery<SaludNegocioResumen>({
    queryKey: ["salud-negocio-resumen", periodicidad, n],
    queryFn: () =>
      api.get(`/api/salud-negocio/resumen?periodicidad=${periodicidad}&n=${n}`, { timeoutMs: 120_000 }),
    staleTime: 5 * 60_000,
    // Una sola reintento: el backend ya cachea 3 min; reintentar 3 veces × 40 s
    // dejaba el panel "pensando" varios minutos si MeLi iba lento.
    retry: 1,
    refetchOnWindowFocus: false,
  });
}

export function useRefrescarSaludNegocio(periodicidad: SaludPeriodicidad, n: number) {
  const queryClient = useQueryClient();
  return async () => {
    const data = await api.get<SaludNegocioResumen>(
      `/api/salud-negocio/resumen?periodicidad=${periodicidad}&n=${n}&refresh=1`,
      { timeoutMs: 120_000 },
    );
    queryClient.setQueryData(["salud-negocio-resumen", periodicidad, n], data);
    return data;
  };
}
