import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export interface Modelo {
  id: string;
  nombre: string;
  categoria: "claude" | "gemini" | "ollama";
  proveedor: string;
  size_mb?: number;
}

interface ModelosResponse {
  modelos: Modelo[];
}

export const CATEGORIA_LABEL: Record<string, string> = {
  claude: "Anthropic",
  gemini: "Google",
  ollama: "Local",
};

export const CATEGORIA_COLOR: Record<string, string> = {
  claude:  "text-orange-400 border-orange-500/40 bg-orange-500/10",
  gemini:  "text-blue-400  border-blue-500/40  bg-blue-500/10",
  ollama:  "text-emerald-400 border-emerald-500/40 bg-emerald-500/10",
};

export function useModelos() {
  return useQuery<Modelo[]>({
    queryKey: ["modelos"],
    queryFn: async () => {
      const data = await api.get<ModelosResponse>("/api/sistema/modelos");
      return data.modelos;
    },
    staleTime: 60_000,
    retry: 1,
  });
}
