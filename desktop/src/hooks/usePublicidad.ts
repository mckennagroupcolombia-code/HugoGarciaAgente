import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

export interface PublicidadItem {
  item_id: string;
  titulo: string;
  marca: string | null;
  dominio?: string | null;
  status?: string | null;
  permalink?: string | null;
  campaign_id?: number | null;
  costo: number;
  ventas: number;
  clicks: number;
  prints: number;
  unidades: number;
  acos: number;
}

export interface PublicidadResumen {
  dias: number;
  advertiser_id: number;
  periodo: { desde: string; hasta: string };
  actualizado_en: string;
  fuente: "live" | "cache";
  cache_ttl_s: number;
  campanas: Array<{
    id: number | null;
    nombre: string | null;
    estrategia: string | null;
    acos_target: number | null;
    roas_target: number | null;
    presupuesto: number | null;
    canal: string | null;
    estado: string | null;
    costo: number;
    ventas: number;
    acos: number;
  }>;
  totales: {
    costo: number;
    ventas_atribuidas: number;
    acos: number;
    roas: number;
    clicks: number;
    prints: number;
    unidades: number;
    anuncios_total: number;
    anuncios_activos: number;
    costo_activos: number;
  };
  riesgo: {
    cero_ventas: { count: number; costo: number };
    perdida_directa: { count: number; costo: number; ventas: number };
    acos_60_100: { count: number; costo: number };
    resto: { costo: number };
  };
  marca: {
    propia: { count: number; costo: number; ventas: number; acos: number | null };
    ajena: { count: number; costo: number; ventas: number; acos: number | null };
  };
  top_gastadores: PublicidadItem[];
  cero_ventas_lista: PublicidadItem[];
  perdida_directa_lista: PublicidadItem[];
  ajena_lista: PublicidadItem[];
}

export function usePublicidadResumen(dias: number = 30) {
  return useQuery<PublicidadResumen>({
    queryKey: ["publicidad-resumen", dias],
    queryFn: () => api.get(`/api/publicidad/resumen?dias=${dias}`, { timeoutMs: 45_000 }),
    staleTime: 5 * 60_000,
  });
}

export interface PublicidadRecomendacionItem extends PublicidadItem {
  nivel_rotacion: "alta" | "media" | "baja" | "sin_ventas";
  rotacion_con_dato: boolean;
  margen_real?: boolean;
  motivo: string;
  activo_en_meli: boolean;
}

export interface PublicidadRecomendaciones {
  generado_en: string;
  dias: number;
  campanas: Array<{ id: number | null; nombre: string | null; acos_target: number | null }>;
  resumen: {
    pausar: number;
    revisar: number;
    ok: number;
    sin_dato_rotacion: number;
    con_margen_real: number;
    no_activos: number;
    campana_inexistente: number;
    costo_pausar: number;
    costo_revisar: number;
  };
  pausar: PublicidadRecomendacionItem[];
  revisar: PublicidadRecomendacionItem[];
}

export function usePublicidadRecomendaciones(dias: number = 30) {
  return useQuery<PublicidadRecomendaciones>({
    queryKey: ["publicidad-recomendaciones", dias],
    queryFn: () => api.get(`/api/publicidad/recomendaciones?dias=${dias}`, { timeoutMs: 45_000 }),
    staleTime: 5 * 60_000,
  });
}

export function useRefrescarPublicidad(dias: number = 30) {
  const queryClient = useQueryClient();
  return async () => {
    const data = await api.get<PublicidadResumen>(
      `/api/publicidad/resumen?dias=${dias}&refresh=1`,
      { timeoutMs: 45_000 },
    );
    queryClient.setQueryData(["publicidad-resumen", dias], data);
    return data;
  };
}

// ── Plan de migración a 3 campañas (alta / baja / marca ajena) ─────────────

export type GrupoCampana = "alta" | "media" | "baja";

export interface PublicidadPlanItem extends PublicidadItem {
  nivel_rotacion: GrupoCampana;
  rotacion_con_dato: boolean;
  grupo_recomendado: GrupoCampana;
  margen_real?: boolean;
  acos_objetivo_real?: number | null;
}

export interface PublicidadPlanGrupo {
  nombre: string;
  descripcion: string;
  acos_target_sugerido: number;
  acos_target_fuente: string;
  presupuesto_diario_sugerido: number;
  count: number;
  con_margen_real: number;
  costo_30d: number;
  ventas_30d: number;
  acos_actual: number | null;
  items: PublicidadPlanItem[];
}

export interface PublicidadPlanMigracion {
  dias: number;
  generado_en: string;
  grupos: Record<GrupoCampana, PublicidadPlanGrupo>;
}

export function usePublicidadPlanMigracion(dias: number = 30) {
  return useQuery<PublicidadPlanMigracion>({
    queryKey: ["publicidad-plan-migracion", dias],
    queryFn: () => api.get(`/api/publicidad/plan-migracion?dias=${dias}`, { timeoutMs: 45_000 }),
    staleTime: 5 * 60_000,
  });
}

export interface PublicidadConfigGrupos {
  mapa: Record<GrupoCampana, number | null>;
  actualizado_en: string | null;
}

export function usePublicidadConfigGrupos() {
  return useQuery<PublicidadConfigGrupos>({
    queryKey: ["publicidad-config-grupos"],
    queryFn: () => api.get("/api/publicidad/config-grupos"),
    staleTime: 60_000,
  });
}

export function useGuardarConfigGrupos() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mapa: Record<GrupoCampana, number | null>) =>
      api.post<PublicidadConfigGrupos>("/api/publicidad/config-grupos", mapa),
    onSuccess: (data) => {
      queryClient.setQueryData(["publicidad-config-grupos"], data);
      queryClient.invalidateQueries({ queryKey: ["publicidad-alertas-reasignacion"] });
    },
  });
}

export interface PublicidadAlertaReasignar extends PublicidadItem {
  nivel_rotacion: GrupoCampana;
  grupo_actual: GrupoCampana;
  grupo_actual_nombre: string;
  grupo_recomendado_nombre: string;
  motivo: string;
}

export interface PublicidadAlertaPausar extends PublicidadItem {
  nivel_rotacion: GrupoCampana;
  grupo_actual: GrupoCampana;
  grupo_actual_nombre: string;
  motivo: string;
}

export interface PublicidadAlertaMigrar extends PublicidadItem {
  nivel_rotacion: GrupoCampana;
  grupo_recomendado_nombre: string;
  motivo: string;
}

export interface PublicidadAlertasReasignacion {
  configurado: boolean;
  reasignar: PublicidadAlertaReasignar[];
  pausar_de_campana: PublicidadAlertaPausar[];
  migrar_a_campana: PublicidadAlertaMigrar[];
  count?: number;
}

export function usePublicidadAlertasReasignacion(dias: number = 30) {
  return useQuery<PublicidadAlertasReasignacion>({
    queryKey: ["publicidad-alertas-reasignacion", dias],
    queryFn: () => api.get(`/api/publicidad/alertas-reasignacion?dias=${dias}`, { timeoutMs: 45_000 }),
    staleTime: 5 * 60_000,
  });
}

// ── Margen real (SKU MeLi ↔ costo de combo Alegra) ───────────────────────────

export interface PublicidadItemConMargen extends PublicidadItem {
  sku: string;
  costo_combo: number;
  precio_venta_ref: number;
  margen_neto_pct: number;
  acos_equilibrio_pct: number;
  acos_objetivo_pct: number;
  rentable_hoy: boolean;
}

export interface PublicidadMargenesReales {
  dias: number;
  generado_en: string;
  comision_meli_pct: number;
  cobertura: {
    total_pautado: number;
    con_margen_real: number;
    sin_sku_en_meli: number;
    con_sku_sin_costo_siigo: number;
    con_costo_pero_sin_ventas_periodo: number;
  };
  con_margen: PublicidadItemConMargen[];
  sin_sku_en_meli: PublicidadItem[];
  con_sku_sin_costo_siigo: Array<PublicidadItem & { sku: string }>;
}

export function usePublicidadMargenesReales(dias: number = 30) {
  return useQuery<PublicidadMargenesReales>({
    queryKey: ["publicidad-margenes-reales", dias],
    queryFn: () => api.get(`/api/publicidad/margenes-reales?dias=${dias}`, { timeoutMs: 60_000 }),
    staleTime: 5 * 60_000,
  });
}

// ── Ads vs. Promociones (qué canal conviene por producto) ──────────────────

export type CanalPublicidad = "ninguno" | "ads" | "promocion" | "ambos";

export interface PublicidadPromoCandidata {
  nombre: string | null;
  tipo: string | null;
  descuento_pct: number;
  meli_percentage: number;
  seller_percentage: number;
  costo_promo_por_unidad: number;
  margen_neto_con_promo_pct: number | null;
}

export interface PublicidadComparacionCanal {
  item_id: string;
  titulo: string;
  permalink: string | null;
  sku: string;
  nivel_rotacion: "alta" | "media" | "baja";
  margen_neto_pct: number;
  costo_ads_por_unidad: number;
  acos_actual: number;
  canal_actual: CanalPublicidad;
  canal_recomendado: CanalPublicidad;
  coincide: boolean;
  promo_candidata: PublicidadPromoCandidata | null;
}

export interface PublicidadAdsVsPromociones {
  dias: number;
  generado_en: string;
  total_evaluados: number;
  resumen: {
    ninguno: number;
    ads: number;
    promocion: number;
    ambos: number;
    desalineados: number;
    errores_consultando_promos: number;
    campana_inexistente: number;
  };
  productos: PublicidadComparacionCanal[];
}

export function usePublicidadAdsVsPromociones(dias: number = 30) {
  return useQuery<PublicidadAdsVsPromociones>({
    queryKey: ["publicidad-ads-vs-promociones", dias],
    queryFn: () => api.get(`/api/publicidad/ads-vs-promociones?dias=${dias}`, { timeoutMs: 280_000 }),
    staleTime: 10 * 60_000,
    retry: false,
  });
}
