import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

// ── Banners promocionales ────────────────────────────────────────────────

export type BannerLinkTipo = "catalogo" | "producto" | "whatsapp" | "url";

export interface Banner {
  id: string;
  titulo: string;
  texto: string;
  etiqueta: string;
  activo: boolean;
  vigente_desde: string | null;
  vigente_hasta: string | null;
  link_tipo: BannerLinkTipo;
  link_valor: string;
  orden: number;
}

export type BannerInput = Partial<Omit<Banner, "id">>;

export function useBanners() {
  return useQuery<{ banners: Banner[] }>({
    queryKey: ["vitrina-web", "banners"],
    queryFn: () => api.get<{ banners: Banner[] }>("/api/web/banners"),
    staleTime: 15_000,
  });
}

export function useCrearBanner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (datos: BannerInput) =>
      api.post<{ ok: boolean; banner: Banner }>("/api/web/banners", datos),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vitrina-web", "banners"] }),
  });
}

export function useActualizarBanner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, datos }: { id: string; datos: BannerInput }) =>
      api.put<{ ok: boolean; banner: Banner }>(`/api/web/banners/${id}`, datos),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vitrina-web", "banners"] }),
  });
}

export function useEliminarBanner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: boolean }>(`/api/web/banners/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vitrina-web", "banners"] }),
  });
}

// ── Origen de materias primas ────────────────────────────────────────────

export const LINEAS_ORIGEN: { id: string; label: string }[] = [
  { id: "aceites-ceras-grasas", label: "Aceites, ceras y grasas" },
  { id: "agro", label: "Agro" },
  { id: "alimentario", label: "Alimentario" },
  { id: "cosmetica", label: "Cosmética" },
  { id: "industria", label: "Industria" },
  { id: "laboratorio", label: "Laboratorio" },
];

export interface OrigenMateriasResumen {
  lineas_cubiertas: number;
  total_lineas: number;
  overrides_sku: number;
  paises_usados: string[];
}

export interface OrigenMateriasConfig {
  actualizado: string | null;
  paises: Record<string, { lat?: number; lon?: number; puerto_entrada?: string }>;
  lineas_default: Record<string, string>;
  overrides_sku: Record<string, string>;
  resumen: OrigenMateriasResumen;
}

export function useOrigenMaterias() {
  return useQuery<OrigenMateriasConfig>({
    queryKey: ["vitrina-web", "origen-materias"],
    queryFn: () => api.get<OrigenMateriasConfig>("/api/web/origen-materias"),
    staleTime: 15_000,
  });
}

export function useGuardarOrigenMaterias() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cambios: {
      lineas_default?: Record<string, string>;
      overrides_sku?: Record<string, string>;
    }) => api.put<OrigenMateriasConfig>("/api/web/origen-materias", cambios),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vitrina-web", "origen-materias"] }),
  });
}
