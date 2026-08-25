import { api } from "../api/client";

export type ScanJobStatus = {
  ok?: boolean;
  error?: string;
  job_id?: string;
  status?: string;
  progreso?: string;
  campos?: Record<string, unknown>;
};

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Espera un job de escáner (COA/FT) hasta done/error. El POST ya no bloquea el proxy. */
export async function esperarJobScan<T extends ScanJobStatus>(
  estadoPath: (jobId: string) => string,
  jobId: string,
  opts?: {
    onProgreso?: (msg: string) => void;
    isStale?: () => boolean;
    timeoutMs?: number;
  },
): Promise<T> {
  const deadline = Date.now() + (opts?.timeoutMs ?? 8 * 60 * 1000);
  while (Date.now() < deadline) {
    if (opts?.isStale?.()) throw new DOMException("Aborted", "AbortError");
    await esperar(1500);
    if (opts?.isStale?.()) throw new DOMException("Aborted", "AbortError");
    const estado = await api.get<T>(estadoPath(jobId), { timeoutMs: 20000 });
    if (estado.progreso) opts?.onProgreso?.(estado.progreso);
    if (estado.status === "done" || estado.status === "listo") return estado;
    if (estado.status === "error" || estado.error) {
      throw new Error(estado.error || "No se pudo analizar el documento");
    }
  }
  throw new Error(
    "El análisis sigue en el servidor pero tardó más de 8 minutos. Recarga e intenta de nuevo.",
  );
}
