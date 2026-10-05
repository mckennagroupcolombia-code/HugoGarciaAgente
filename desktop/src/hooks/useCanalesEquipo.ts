import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

/** Contrato de /api/canales/* (app/routes_canales.py → app/services/canales_internos.py). */

export type CanalEquipo = {
  id: number;
  nombre: string;
  descripcion: string;
  clave: string | null;
  /** Grupo de trabajo: módulo del panel al que está vinculado (canales_vinculos.MODULOS). */
  modulo: string | null;
  wa_jid: string;
  wa_nombre: string;
  espejo_salida: boolean;
  archivado: boolean;
  miembros: number[];
  no_leidos: number;
  ultimo: { id: number; texto: string; autor_nombre: string; creado_en: number; adjunto_nombre: string | null } | null;
};

export type MensajeCanal = {
  id: number;
  canal_id: number;
  usuario_id: number | null;
  autor_nombre: string;
  origen: "panel" | "wa";
  tipo: "mensaje" | "sistema";
  texto: string;
  adjunto_archivo: string | null;
  adjunto_nombre: string | null;
  adjunto_mime: string | null;
  wa_media_path: string | null;
  ref: Record<string, unknown> | null;
  creado_en: number;
};

export type ModuloCanal = { clave: string; nombre: string; panel: string; item: string };

/** Elemento de un módulo vinculado en un mensaje. */
export type RefMensaje = { modulo: string; id: string; titulo: string; detalle: string };

export type RespCanalesEquipo = {
  canales: CanalEquipo[];
  puede_administrar: boolean;
  modulos: ModuloCanal[];
  grupos_wa: { jid: string; nombre: string; enlazado: boolean }[];
};

export function useCanalesEquipo(enabled = true) {
  return useQuery<RespCanalesEquipo>({
    queryKey: ["canales-equipo"],
    queryFn: () => api.get("/api/canales"),
    refetchInterval: 9000,
    enabled,
  });
}

export function useMensajesCanal(canalId: number | null) {
  return useQuery<{ mensajes: MensajeCanal[] }>({
    queryKey: ["canales-equipo-mensajes", canalId],
    queryFn: () => api.get(`/api/canales/${canalId}/mensajes?limite=120`),
    enabled: canalId != null,
    refetchInterval: 4500,
  });
}

export function useEnviarCanal(canalId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ texto, archivo, ref }: { texto: string; archivo?: File | null; ref?: RefMensaje | null }) => {
      if (canalId == null) throw new Error("Sin canal");
      if (archivo) {
        const form = new FormData();
        form.append("texto", texto);
        form.append("archivo", archivo);
        if (ref) form.append("ref", JSON.stringify(ref));
        return api.upload<MensajeCanal>(`/api/canales/${canalId}/mensajes`, form, { timeoutMs: 120_000 });
      }
      return api.post<MensajeCanal>(`/api/canales/${canalId}/mensajes`, { texto, ref: ref ?? null });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["canales-equipo-mensajes", canalId] });
      void qc.invalidateQueries({ queryKey: ["canales-equipo"] });
    },
  });
}

export function useBuscarVinculos(modulo: string, q: string) {
  return useQuery<{ items: { id: string; titulo: string; detalle: string }[] }>({
    queryKey: ["canales-vinculos", modulo, q],
    queryFn: () => api.get(`/api/canales/vinculos?modulo=${encodeURIComponent(modulo)}&q=${encodeURIComponent(q)}`),
    enabled: !!modulo,
    staleTime: 30_000,
    retry: false,
  });
}

export function useMarcarCanalLeido() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (canalId: number) => api.post(`/api/canales/${canalId}/leido`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["canales-equipo"] });
      void qc.invalidateQueries({ queryKey: ["mensajes-resumen"] });
    },
  });
}

export type ResumenMensajes = { canales_no_leidos: number; notificaciones_no_leidas: number };

export function useResumenMensajes(enabled = true) {
  return useQuery<ResumenMensajes>({
    queryKey: ["mensajes-resumen"],
    queryFn: () => api.get("/api/mensajes/resumen"),
    refetchInterval: 10_000,
    enabled,
  });
}

export type Notificacion = {
  id: number;
  tipo: string;
  titulo: string;
  cuerpo: string;
  panel_destino: string | null;
  ref_id: string | null;
  creada_en: number;
  leida_en: number | null;
};

export function useNotificaciones(enabled: boolean) {
  return useQuery<{ notificaciones: Notificacion[]; no_leidas: number; preferencia: "ambos" | "inapp" | "wa" }>({
    queryKey: ["notificaciones"],
    queryFn: () => api.get("/api/notificaciones"),
    enabled,
  });
}
