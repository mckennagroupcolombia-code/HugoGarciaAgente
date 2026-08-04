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
  /** Asignación manual ("¿quién hizo este commit?") — no viene de git, es override del panel. */
  autor_manual?: string | null;
}

export interface GitAutoCommitEstado {
  archivos_pendientes: number;
  /** ISO local del server: próximo cron auto_commit.sh (23:00, commit+push). */
  proximo_diario: string;
  /** ISO local del server: próximo backup nocturno (02:00, commit+push). */
  proximo_backup: string;
  ahora: string;
}

export interface GitLog {
  rama_actual?: string;
  commits?: GitCommit[];
  auto_commit?: GitAutoCommitEstado;
  desarrolladores_conocidos?: string[];
  error?: string;
}

export function useGitLog(limit = 200) {
  return useQuery<GitLog>({
    queryKey: ["git-log", limit],
    queryFn: () => api.get(`/api/git/log?limit=${limit}`),
    refetchInterval: 60_000,
  });
}

export function asignarAutorCommit(hash: string, autor: string) {
  return api.post<{ ok: boolean; error?: string }>("/api/git/log/autor", { hash, autor });
}
