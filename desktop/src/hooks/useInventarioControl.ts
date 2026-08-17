import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

export type EstadoInventario = "agotado" | "critico" | "bajo" | "ok";
export type RotacionInventario = "alta" | "media" | "baja" | "sin_ventas";

export interface ItemInventarioControl {
  meli_id: string;
  sku: string;
  nombre: string;
  stock_meli: number;
  stock_siigo: number | null;
  estado: EstadoInventario;
  divergencia: boolean;
  rotacion: RotacionInventario;
  revisado_en: string | null;
  revisado_por: string | null;
  dias_sin_revisar: number | null;
  proveedor: string;
  notas_proveedor: string;
}

export interface ResumenInventarioControl {
  items: ItemInventarioControl[];
  total: number;
  actualizado_en: string;
  umbral_bajo_stock: number;
  umbral_divergencia_siigo: number;
  error?: string;
}

export function useInventarioControlResumen(refresh = false) {
  return useQuery<ResumenInventarioControl>({
    queryKey: ["inventario-control", "resumen"],
    queryFn: () =>
      api.get(`/api/inventario-control/resumen${refresh ? "?refresh=1" : ""}`),
    refetchInterval: 60_000,
  });
}

function useInvalidarResumen() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["inventario-control", "resumen"] });
}

export function useAjustarStockInventario() {
  const invalidar = useInvalidarResumen();
  return useMutation({
    mutationFn: (vars: { sku: string; meliId: string; delta: number }) =>
      api.post("/api/stock/ajustar", { sku: vars.sku, meli_id: vars.meliId, delta: vars.delta }),
    onSuccess: invalidar,
  });
}

export function useMarcarRevisadoInventario() {
  const invalidar = useInvalidarResumen();
  return useMutation({
    mutationFn: (vars: { meliId: string }) =>
      api.post("/api/inventario-control/revisar", { meli_id: vars.meliId }),
    onSuccess: invalidar,
  });
}

export function useGuardarProveedorInventario() {
  const invalidar = useInvalidarResumen();
  return useMutation({
    mutationFn: (vars: { sku: string; proveedor: string; notas?: string }) =>
      api.post("/api/inventario-control/proveedor", {
        sku: vars.sku,
        proveedor: vars.proveedor,
        notas: vars.notas ?? "",
      }),
    onSuccess: invalidar,
  });
}

export interface SolicitarCompraVars {
  sku: string;
  meliId: string;
  nombre: string;
  cantidadSugerida?: number;
  proveedor?: string;
  motivo?: string;
  prioridadAlta?: boolean;
}

export function useSolicitarCompraInventario() {
  const invalidar = useInvalidarResumen();
  return useMutation({
    mutationFn: (vars: SolicitarCompraVars) =>
      api.post<{ ok: boolean; mensaje: string }>("/api/inventario-control/solicitar-compra", {
        sku: vars.sku,
        meli_id: vars.meliId,
        nombre: vars.nombre,
        cantidad_sugerida: vars.cantidadSugerida,
        proveedor: vars.proveedor,
        motivo: vars.motivo,
        prioridad_alta: vars.prioridadAlta,
      }),
    onSuccess: invalidar,
  });
}

export function useFlagEliminarInventario() {
  const invalidar = useInvalidarResumen();
  return useMutation({
    mutationFn: (vars: { sku: string; meliId: string; nombre: string; motivo?: string }) =>
      api.post<{ ok: boolean; mensaje: string }>("/api/inventario-control/flag-eliminar", {
        sku: vars.sku,
        meli_id: vars.meliId,
        nombre: vars.nombre,
        motivo: vars.motivo,
      }),
    onSuccess: invalidar,
  });
}
