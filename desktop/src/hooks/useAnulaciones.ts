import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

/** Estados de la máquina del expediente (app/services/anulaciones_db.py::ESTADOS). */
export type AnulacionEstado =
  | "detectada"
  | "en_margen"
  | "lista"
  | "emitiendo"
  | "emitida"
  | "subida_meli"
  | "posteado_libro"
  | "cerrada"
  | "requiere_decision"
  | "bloqueada"
  | "descartada";

export interface AnulacionEvento {
  id: number;
  ts: string;
  actor: string;
  tipo: string;
  resumen: string;
}

export interface Anulacion {
  id: number;
  codigo: string;
  referencia: string;
  origen: string;
  order_id: string;
  pack_id: string;
  claim_id: string;
  cliente_nombre: string;
  cliente_doc: string;
  factura_proveedor: string;
  factura_id: string;
  factura_numero: string;
  factura_cufe: string;
  factura_fecha: string;
  factura_total: number;
  motivo: string;
  monto_reintegrado: number;
  alcance: string;
  producto_retorna: number | null;
  financia: string;
  estado: AnulacionEstado;
  autonomia: string;
  bloqueo_motivo: string;
  nc_proveedor: string;
  nc_id: string;
  nc_numero: string;
  nc_cufe: string;
  nc_total: number;
  nc_url: string;
  movimiento_id: string;
  inventario_estado: string;
  ticket_id: number | null;
  relato: string;
  abierta_en: string;
  cerrada_en: string | null;
}

export interface AnulacionExpediente extends Anulacion {
  eventos: AnulacionEvento[];
  enlaces: Record<string, string>;
}

export interface AnulacionesDeuda {
  abiertas: number;
  monto: number;
  mas_antigua: string | null;
  dias_mas_antigua: number | null;
  por_estado: Record<string, { n: number; monto: number }>;
}

export interface EmitirResultado {
  ok?: boolean;
  error?: string;
  modo_sombra?: boolean;
  requiere_decision?: boolean;
  motivos?: string[];
  bloqueo?: string;
  nc_numero?: string;
  expediente?: AnulacionExpediente;
}

export function useAnulacionesDeuda() {
  return useQuery<AnulacionesDeuda>({
    queryKey: ["anulaciones-deuda"],
    queryFn: () => api.get("/api/anulaciones/resumen"),
    refetchInterval: 60_000,
  });
}

export function useAnulaciones(filtro: { estado?: string; abiertos?: boolean; q?: string }) {
  const params = new URLSearchParams();
  if (filtro.estado) params.set("estado", filtro.estado);
  if (filtro.abiertos) params.set("abiertos", "1");
  if (filtro.q) params.set("q", filtro.q);
  const qs = params.toString();
  return useQuery<{ anulaciones: Anulacion[] }>({
    queryKey: ["anulaciones", qs],
    queryFn: () => api.get(`/api/anulaciones${qs ? `?${qs}` : ""}`),
    refetchInterval: 60_000,
  });
}

export function useAnulacionExpediente(identificador: string | null) {
  return useQuery<AnulacionExpediente>({
    queryKey: ["anulacion", identificador],
    queryFn: () => api.get(`/api/anulaciones/${encodeURIComponent(identificador ?? "")}`),
    enabled: Boolean(identificador),
  });
}

/** Invalida expediente + lista + deuda: una acción sobre un caso cambia los tres. */
function useRefrescarAnulaciones() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["anulacion"] });
    void qc.invalidateQueries({ queryKey: ["anulaciones"] });
    void qc.invalidateQueries({ queryKey: ["anulaciones-deuda"] });
  };
}

export function useAgregarNota() {
  const refrescar = useRefrescarAnulaciones();
  return useMutation({
    mutationFn: ({ id, texto }: { id: number; texto: string }) =>
      api.post<AnulacionExpediente>(`/api/anulaciones/${id}/nota`, { texto }),
    onSuccess: refrescar,
  });
}

export function useRegistrarInventario() {
  const refrescar = useRefrescarAnulaciones();
  return useMutation({
    mutationFn: ({ id, recibido, nota }: { id: number; recibido: boolean; nota?: string }) =>
      api.post<AnulacionExpediente>(`/api/anulaciones/${id}/inventario`, { recibido, nota }),
    onSuccess: refrescar,
  });
}

export function useDescartarAnulacion() {
  const refrescar = useRefrescarAnulaciones();
  return useMutation({
    mutationFn: ({ id, motivo }: { id: number; motivo: string }) =>
      api.post<AnulacionExpediente>(`/api/anulaciones/${id}/descartar`, { motivo }),
    onSuccess: refrescar,
  });
}

export function useEmitirNotaCredito() {
  const refrescar = useRefrescarAnulaciones();
  return useMutation({
    mutationFn: ({ id, forzar }: { id: number; forzar?: boolean }) =>
      api.post<EmitirResultado>(`/api/anulaciones/${id}/emitir`, { forzar: Boolean(forzar) }),
    onSuccess: refrescar,
  });
}
