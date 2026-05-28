import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

export interface CanalConfig {
  id: string;
  nombre: string;
  icono: string;
  modelo_id: string;
  modelo_nombre: string;
  modelo_categoria?: string;
  proveedor: string;
  modo: string;
  /** cliente_texto | operaciones | interno | panel */
  flujo?: string;
  flujo_label?: string;
  es_cliente?: boolean;
  descripcion: string;
  editable: boolean;
  categorias_modelo?: string[];
}

interface CanalesResponse {
  canales: CanalConfig[];
}

export function useCanales() {
  return useQuery<CanalesResponse>({
    queryKey: ["canales"],
    queryFn: () => api.get("/api/sistema/canales"),
    staleTime: 30_000,
  });
}

export function useAsignarModeloCanal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      canalId,
      modeloId,
    }: {
      canalId: string;
      modeloId: string;
    }) =>
      api.put<{ ok: boolean; canal: CanalConfig }>(
        `/api/sistema/canales/${encodeURIComponent(canalId)}`,
        { modelo_id: modeloId },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["canales"] });
    },
  });
}
