import { useMutation } from "@tanstack/react-query";
import { api } from "../api/client";

interface ChatResponse {
  respuesta: string;
  timestamp: string;
  status: string;
}

export function useChatMutation() {
  return useMutation({
    mutationFn: (vars: { mensaje: string; session_id: string }) =>
      api.post<ChatResponse>("/chat", vars),
  });
}
