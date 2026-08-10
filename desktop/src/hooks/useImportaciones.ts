import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

export type TipoModalidad = "ddp" | "importacion_ordinaria";

export interface Aliado {
  id: string;
  nombre: string;
  tipo_modalidad: TipoModalidad;
  servicio: string;
  tiene_cotizador: boolean;
  fuente: string;
  fecha_extraccion: string;
  contacto: Record<string, string | string[]>;

  // Campos específicos del aliado DDP (China Latin Agent)
  aplicabilidad_materia_prima_farmaceutica_cosmetica?: string;
  aplicabilidad_nota?: string;
  modos?: Record<
    string,
    {
      nombre: string;
      unidad: string;
      minimo?: number;
      tiers?: { hasta: number | null; usd_por_unidad: number }[];
      rango_kg?: [number, number];
      proveedores?: Record<string, { usd_por_kg_min: number; usd_por_kg_max: number }>;
      dias_transito: [number, number];
    }
  >;
  restricciones_producto?: { no_maneja: string[]; requiere_revision_previa: string[] };
  etapas_proceso?: string[];

  // Campos específicos de aliados de importación ordinaria (Aduamarcol)
  credenciales?: { nivel_agencia: number; anos_experiencia: number; resolucion_dian: string; codigo: string };
  servicios?: string[];
  nota_tarifas?: string;
  etapas_proceso_generico?: string[];
}

export interface GuiaModalidad {
  titulo: string;
  actualizado: string;
  resumen: string;
  cuando_usar_ddp: string[];
  cuando_usar_ordinaria: string[];
  riesgos_ddp: string[];
  matiz_importante: string;
  fuente: string;
}

export interface CotizacionImportacion {
  modo: string;
  modo_nombre: string;
  cantidad: number;
  unidad: string;
  costo_transporte_usd: number;
  dias_transito_min: number | null;
  dias_transito_max: number | null;
  arancel_estimado: { arancel_pct: number | null; iva_pct: number | null; nota: string } | null;
  advertencias: string[];
}

export interface ProcesoImportacion {
  id: number;
  numero: string;
  titulo: string;
  descripcion: string;
  estado: "pendiente" | "en_proceso" | "esperando_aprobacion" | "resuelto" | "rechazado";
  prioridad: "baja" | "media" | "alta" | "urgente";
  creado_en: string;
}

export function useAliadosImportacion() {
  return useQuery<{ aliados: Aliado[]; guia_modalidad: GuiaModalidad }>({
    queryKey: ["importaciones-aliados"],
    queryFn: () => api.get("/api/importaciones/aliados"),
    staleTime: 5 * 60_000,
  });
}

export function useCotizarImportacion() {
  return useMutation({
    mutationFn: (vars: { aliado_id?: string; kg?: number; cbm?: number; valor_fob_usd?: number; modo?: string }) =>
      api.post<CotizacionImportacion>("/api/importaciones/cotizar", vars),
  });
}

export function useProcesosImportacion() {
  return useQuery<{ procesos: ProcesoImportacion[] }>({
    queryKey: ["importaciones-procesos"],
    queryFn: () => api.get("/api/importaciones/procesos"),
    refetchInterval: 30_000,
  });
}

export interface CasoHistoricoImportacion {
  id: string;
  producto: string;
  categoria_producto: string;
  origen: string;
  peso_kg: number | null;
  cantidad_unidades: number | null;
  modalidad: string;
  agente: string;
  guia_referencia: string | null;
  fecha_apertura: string;
  fecha_cierre: string | null;
  cotizado_cop: number | null;
  facturado_cop: number | null;
  variacion_pct: number | null;
  incidencias: string[];
}

export type CompradoPor = "" | "mckenna" | "socio";

export interface CompraChicaHistorico {
  id: number;
  proveedor: string | null;
  fecha_compra: string;
  moneda: string;
  trm: number;
  flete: number;
  moneda_flete: string;
  total_cobro_cop?: number;
  lineas?: { nombre: string; costo_unitario: number; unidad: string }[];
  comprado_por: CompradoPor;
}

export interface HistoricoImportaciones {
  casos_grandes: CasoHistoricoImportacion[];
  compras_chicas: CompraChicaHistorico[];
  fuente: string;
  nota_metodologica: string;
}

export function useHistoricoImportaciones() {
  return useQuery<HistoricoImportaciones>({
    queryKey: ["importaciones-historico"],
    queryFn: () => api.get("/api/importaciones/historico"),
    staleTime: 5 * 60_000,
  });
}

export function useMarcarCompradoPor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { compraId: number; comprado_por: CompradoPor }) =>
      api.post(`/api/importaciones/compras-chicas/${vars.compraId}/comprado-por`, {
        comprado_por: vars.comprado_por,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["importaciones-historico"] });
    },
  });
}

export function useCrearProcesoImportacion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      titulo: string;
      proveedor?: string;
      aliado_id?: string;
      modo?: string;
      kg?: number;
      cbm?: number;
      valor_fob_usd?: number;
    }) => api.post("/api/importaciones/procesos", vars),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["importaciones-procesos"] });
    },
  });
}
