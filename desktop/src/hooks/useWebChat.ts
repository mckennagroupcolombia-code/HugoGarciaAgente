import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

export interface WebChatTurn {
  at: string;
  user_message: string;
  agent_reply: string;
  attachments_count?: number;
  source?: string;
  upstream_error?: string;
}

export interface WebChatSession {
  session_id: string;
  started_at: string;
  last_at: string;
  messages_count: number;
  attachments_count: number;
  reviewed: boolean;
  reviewed_at: string | null;
  page_url?: string;
  user_agent?: string;
  last_user_message: string;
  last_agent_reply: string;
  last_source?: string;
  last_upstream_error?: string;
  recent_turns?: WebChatTurn[];
}

export interface WebChatSummary {
  today_interactions: number;
  unreviewed_count: number;
  active_last_24h: number;
}

export interface WebChatPayload {
  updated_at?: string;
  summary: WebChatSummary;
  sessions: WebChatSession[];
  total_sessions: number;
}

export function useWebChat(onlyUnreviewed = false) {
  const q = onlyUnreviewed ? "?only_unreviewed=1" : "";
  return useQuery<WebChatPayload>({
    queryKey: ["web-chat", onlyUnreviewed],
    queryFn: () => api.get(`/api/web-chat${q}`),
    refetchInterval: 20_000,
  });
}

export function useMarkWebChatReviewed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      api.post<{ ok: boolean; changed: boolean }>(
        `/api/web-chat/${encodeURIComponent(sessionId)}/review`,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["web-chat"] });
      qc.invalidateQueries({ queryKey: ["metricas"] });
    },
  });
}

export function useMarkAllWebChatReviewed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; reviewed: number }>("/api/web-chat/review-all"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["web-chat"] });
      qc.invalidateQueries({ queryKey: ["metricas"] });
    },
  });
}
