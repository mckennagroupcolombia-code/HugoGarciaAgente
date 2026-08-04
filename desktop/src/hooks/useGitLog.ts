import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export interface GitCommit {
  hash: string;
  hash_corto: string;
  parents: string[];
  autor: string;
  email: string;
  fecha: string;
  asunto: string;
  refs: string[];
}

export interface GitLog {
  rama_actual?: string;
  commits?: GitCommit[];
  error?: string;
}

export function useGitLog(limit = 200) {
  return useQuery<GitLog>({
    queryKey: ["git-log", limit],
    queryFn: () => api.get(`/api/git/log?limit=${limit}`),
    refetchInterval: 60_000,
  });
}
