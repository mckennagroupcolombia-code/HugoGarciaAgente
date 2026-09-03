import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export type EmisorCuentaCobro = {
  id: number;
  nombre: string;
  username?: string;
  documento_identidad?: string;
  email?: string;
  /** Acento RGB del tema del panel de ese usuario ("12 96 105"). */
  accent_rgb?: string;
};

export function useEmisoresCuentaCobro() {
  return useQuery<{ emisores: EmisorCuentaCobro[] }>({
    queryKey: ["compras-exterior-emisores"],
    queryFn: () => api.get("/api/rentabilidad/compras-exterior/emisores"),
    staleTime: 5 * 60 * 1000,
  });
}
