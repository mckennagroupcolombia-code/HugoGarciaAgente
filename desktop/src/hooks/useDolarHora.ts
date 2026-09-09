import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export interface DolarPunto {
  t: string;
  v: number;
}

export interface DolarHora {
  valor: number;
  unidad: string;
  simbolo: string;
  hora: string;
  cambio_abs: number;
  cambio_pct: number;
  fuente: "banrep" | string;
  fuente_label: string;
  trm_oficial: number | null;
  trm_fecha: string | null;
  trm_fuente: string | null;
  /** Vacío: el gráfico horario es TradingView en el panel. */
  serie_hora: DolarPunto[];
  serie_dia: DolarPunto[];
  cache_ttl_s: number;
  actualizado: string;
  /** Spot de mercado cuasi tiempo real (Yahoo Finance) — se mueve intradía,
   * a diferencia de la TRM oficial (un valor por día hábil). Puede venir
   * ausente (spot_error) si Yahoo falla; la TRM sigue sirviendo igual. */
  spot_valor: number | null;
  spot_previo?: number | null;
  spot_cambio_abs?: number | null;
  spot_cambio_pct?: number | null;
  spot_hora?: string | null;
  spot_fuente?: string | null;
  spot_fuente_label?: string | null;
  spot_error?: string | null;
}

export function useDolarHora(force = false) {
  return useQuery<DolarHora>({
    queryKey: ["inicio", "dolar-hora", force],
    queryFn: () =>
      api.get(`/api/inicio/dolar-hora${force ? "?force=1" : ""}`),
    // El spot en vivo tiene su propio cache corto en el backend (20s);
    // refrescamos seguido para que se sienta "en vivo" sin recalcular la
    // TRM oficial de más (esa sigue cacheada 10 min server-side).
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}
