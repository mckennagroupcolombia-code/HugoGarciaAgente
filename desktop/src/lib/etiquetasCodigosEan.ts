import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

export interface CodigoEan {
  id: string;
  sku: string;
  nombre_producto: string;
  numero_producto: number;
  presentacion: string;
  anio: number;
  bimestre: number;
  codigo: string;
  creado_at: string;
}

export interface NuevoCodigoEan {
  sku: string;
  nombre_producto?: string;
  numero_producto: number;
  presentacion?: string;
  anio?: number;
  mes: number;
}

export const BIMESTRE_LABEL: Record<number, string> = {
  0: "Ene-Feb",
  1: "Mar-Abr",
  2: "May-Jun",
  3: "Jul-Ago",
  4: "Sep-Oct",
  5: "Nov-Dic",
};

export function mesABimestre(mes: number): number {
  return Math.max(0, Math.min(5, Math.floor((mes - 1) / 2)));
}

/** Arma los 12 dígitos de datos (sin el verificador) para previsualizar el código. */
export function construirCodigo12(
  numeroProducto: number,
  presentacion: string,
  anio: number,
  bimestre: number,
): string {
  const prod = String(Math.max(1, Math.min(900, Math.round(numeroProducto) || 0))).padStart(3, "0");
  const pres = (presentacion || "000").replace(/\D/g, "").padStart(3, "0").slice(0, 3);
  const yy = String(((Math.round(anio) % 100) + 100) % 100).padStart(2, "0");
  const b = Math.max(0, Math.min(5, Math.round(bimestre) || 0));
  return `770${prod}${pres}${yy}${b}`;
}

const QUERY_KEY = ["etiquetas-codigos-ean"];

export function useCodigosEan() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const data = await api.get<{ codigos: CodigoEan[] }>("/api/etiquetas/codigos-ean");
      return data.codigos ?? [];
    },
    staleTime: 30_000,
  });
}

export function useCrearCodigoEan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (nuevo: NuevoCodigoEan) =>
      api.post<CodigoEan & { ok: boolean }>("/api/etiquetas/codigos-ean", nuevo),
    onSuccess: () => void qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useEliminarCodigoEan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: boolean }>(`/api/etiquetas/codigos-ean/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}
