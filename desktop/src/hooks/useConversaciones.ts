import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

// ── Tipos ────────────────────────────────────────────────────────────────────

export type ConversacionTipo = "solicitud" | "accion";
export type ConversacionEstado = "pendiente" | "en_proceso" | "esperando_aprobacion" | "resuelto" | "rechazado";

export interface Conversacion {
  id: number;
  numero: string;
  titulo: string;
  tipo: ConversacionTipo;
  subtipo: string | null;
  estado: ConversacionEstado;
  prioridad: "baja" | "media" | "alta" | "urgente";
  creado_por: number;
  asignado_a: number | null;
  creado_en: string;
  actualizado_en: string;
  creado_por_nombre: string | null;
  asignado_a_nombre: string | null;
  adjuntos_total: number;
  ultimo_texto: string | null;
  ultimo_en: string | null;
  ultimo_usuario_id: number | null;
  ultimo_autor: string | null;
  no_leidos: number;
  contraparte_id: number | null;
  contraparte_nombre: string | null;
  ultima_actividad: string;
}

export interface TimelineEvento {
  tipo: "mensaje" | "sistema";
  id: string | number;
  creado_en: string;
  usuario_id: number | null;
  autor_nombre: string | null;
  texto: string;
  es_interno?: boolean;
  accion?: string;
}

export interface EquipoUsuario {
  id: number;
  nombre: string;
  username: string;
  foto?: string | null;
  activo?: number;
  rol?: { id: number; nombre: string; nivel: number } | null;
}

export type ConversacionScope = "mias" | "equipo";
export type ConversacionFiltroTipo = "todas" | ConversacionTipo;

// ── Lista de conversaciones (inbox) ─────────────────────────────────────────

export function useConversaciones(tipo: ConversacionFiltroTipo, scope: ConversacionScope) {
  return useQuery<Conversacion[]>({
    queryKey: ["tickets-conversaciones", tipo, scope],
    queryFn: () => api.get(`/api/tickets/conversaciones?tipo=${tipo}&scope=${scope}`),
    refetchInterval: 9000,
    placeholderData: (prev) => prev,
  });
}

// ── Hilo de una conversación ─────────────────────────────────────────────────

export function useTimeline(ticketId: number | null) {
  return useQuery<TimelineEvento[]>({
    queryKey: ["tickets-timeline", ticketId],
    queryFn: () => api.get(`/api/tickets/${ticketId}/timeline`),
    enabled: ticketId != null,
    refetchInterval: 4500,
    placeholderData: (prev) => prev,
  });
}

export function useMarcarVisto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ticketId: number) => api.post(`/api/tickets/${ticketId}/visto`),
    onSuccess: (_data, ticketId) => {
      qc.setQueriesData<Conversacion[]>({ queryKey: ["tickets-conversaciones"] }, (prev) =>
        prev?.map((c) => (c.id === ticketId ? { ...c, no_leidos: 0 } : c)),
      );
    },
  });
}

export function useEnviarMensajeConversacion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ticketId, texto, archivos }: { ticketId: number; texto: string; archivos: File[] }) => {
      if (archivos.length > 0) {
        for (const archivo of archivos) {
          const fd = new FormData();
          fd.append("archivo", archivo);
          await api.upload(`/api/tickets/${ticketId}/adjuntos`, fd);
        }
      }
      const textoFinal = texto.trim() || (archivos.length > 1
        ? `📎 ${archivos.length} imágenes adjuntas`
        : archivos.length === 1 ? "📎 Imagen adjunta" : "");
      if (textoFinal) {
        await api.post(`/api/tickets/${ticketId}/comentarios`, { texto: textoFinal });
      }
    },
    onSuccess: (_data, { ticketId }) => {
      qc.invalidateQueries({ queryKey: ["tickets-timeline", ticketId] });
      qc.invalidateQueries({ queryKey: ["tickets-conversaciones"] });
      qc.invalidateQueries({ queryKey: ["tickets-adjuntos", ticketId] });
    },
  });
}

export interface Adjunto {
  id: number;
  ticket_id: number;
  nombre_archivo: string;
  nombre_original: string;
  mime?: string | null;
  creado_por?: number | null;
  creado_por_nombre?: string | null;
  creado_en: string;
  paso_id?: number | null;
}

export function useAdjuntosConversacion(ticketId: number | null) {
  return useQuery<Adjunto[]>({
    queryKey: ["tickets-adjuntos", ticketId],
    queryFn: () => api.get(`/api/tickets/${ticketId}/adjuntos`),
    enabled: ticketId != null,
    refetchInterval: 4500,
    placeholderData: (prev) => prev,
  });
}

// ── Cambios de estado / asignación ──────────────────────────────────────────

export function useCambiarEstadoConversacion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ticketId, body }: { ticketId: number; body: Record<string, unknown> }) =>
      api.put(`/api/tickets/${ticketId}/estado`, body),
    onSuccess: (_data, { ticketId }) => {
      qc.invalidateQueries({ queryKey: ["tickets-conversaciones"] });
      qc.invalidateQueries({ queryKey: ["tickets-timeline", ticketId] });
    },
  });
}

export function useAsignarConversacion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ticketId, asignadoA }: { ticketId: number; asignadoA: number | null }) =>
      api.put(`/api/tickets/${ticketId}/asignar`, { asignado_a: asignadoA }),
    onSuccess: (_data, { ticketId }) => {
      qc.invalidateQueries({ queryKey: ["tickets-conversaciones"] });
      qc.invalidateQueries({ queryKey: ["tickets-timeline", ticketId] });
    },
  });
}

// ── Detalle liviano de un ticket (header del hilo, independiente del filtro activo) ──

export interface TicketResumen {
  id: number;
  numero: string;
  titulo: string;
  tipo: "ticket" | "accion" | "solicitud";
  subtipo: string | null;
  estado: ConversacionEstado;
  prioridad: string;
  creado_por: number;
  creado_por_nombre?: string | null;
  asignado_a: number | null;
  asignado_a_nombre?: string | null;
  bloqueado_por?: number | null;
}

export function useTicketResumen(ticketId: number | null) {
  return useQuery<TicketResumen>({
    queryKey: ["tickets-resumen", ticketId],
    queryFn: () => api.get(`/api/tickets/${ticketId}`),
    enabled: ticketId != null,
    refetchInterval: 9000,
    placeholderData: (prev) => prev,
  });
}

// ── Presencia / equipo ───────────────────────────────────────────────────────

export function usePresenciaEnLinea() {
  return useQuery<{ usuario_ids: number[] }>({
    queryKey: ["tickets-presencia"],
    queryFn: () => api.get("/api/tickets/presencia/en-linea"),
    refetchInterval: 10000,
  });
}

export function useUsuariosEquipo() {
  return useQuery<EquipoUsuario[]>({
    queryKey: ["tickets-usuarios"],
    queryFn: () => api.get("/api/tickets/usuarios"),
    staleTime: 5 * 60 * 1000,
  });
}
