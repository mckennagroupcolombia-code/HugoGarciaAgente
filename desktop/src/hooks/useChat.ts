import { useMutation } from "@tanstack/react-query";
import { api } from "../api/client";

interface ChatResponse {
  respuesta: string;
  timestamp: string;
  status: string;
}

interface PanelChatResponse extends ChatResponse {
  modelo_id: string;
}

export function useChatMutation() {
  return useMutation({
    mutationFn: (vars: { mensaje: string; session_id: string }) =>
      api.post<ChatResponse>("/chat", vars),
  });
}

export function usePanelChatMutation() {
  return useMutation({
    mutationFn: (vars: {
      mensaje: string;
      session_id: string;
      modelo_id: string;
      reset?: boolean;
    }) =>
      api.post<PanelChatResponse>("/api/chat-panel", vars, { timeoutMs: 200_000 }),
  });
}
