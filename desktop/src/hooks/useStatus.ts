import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export interface StatusInfo {
  estado: string;
  timestamp: string;
  servicios: {
    mercadolibre: boolean;
    google: boolean;
    siigo: boolean;
  };
  version: string;
}

export function useStatus() {
  return useQuery<StatusInfo>({
    queryKey: ["status"],
    queryFn: () => api.get("/api/status"),
    refetchInterval: 60_000,
  });
}
