import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

interface LogsResponse {
  lines: string[];
}

export function usePanelLogs(enabled = true) {
  return useQuery<LogsResponse>({
    queryKey: ["panel-logs"],
    queryFn: () => api.get("/api/panel/logs?limit=400"),
    refetchInterval: enabled ? 2000 : false,
    enabled,
  });
}

export function useClearPanelLogs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete("/api/panel/logs"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["panel-logs"] }),
  });
}
