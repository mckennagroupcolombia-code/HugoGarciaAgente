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
  fuente: "yahoo" | "banrep" | string;
  fuente_label: string;
  trm_oficial: number | null;
  trm_fecha: string | null;
  trm_fuente: string | null;
  serie_hora: DolarPunto[];
  serie_dia: DolarPunto[];
  cache_ttl_s: number;
  actualizado: string;
}

export function useDolarHora(force = false) {
  return useQuery<DolarHora>({
    queryKey: ["inicio", "dolar-hora", force],
    queryFn: () =>
      api.get(`/api/inicio/dolar-hora${force ? "?force=1" : ""}`),
    refetchInterval: 10 * 60_000,
    staleTime: 5 * 60_000,
  });
}
