import { api } from "../api/client";
import { esperarJobScan } from "./scanJobPoll";

/** Sugerencia de IA para una casilla del documento técnico. Va en segundo plano:
 *  la IA tarda 30-60 s y el túnel de Cloudflare corta a ~100 s con HTTP 504. */
export async function sugerirCampoFicha(campo: string, nombre: string): Promise<{ valor: string }> {
  const r = await api.post<{ job_id?: string; error?: string }>(
    "/api/fichas/sugerir-campo",
    { campo, nombre, en_segundo_plano: true },
    { timeoutMs: 30000 },
  );
  if (!r.job_id) throw new Error(r.error || "La IA no respondió");
  const fin = await esperarJobScan<{ status?: string; error?: string; valor?: string }>(
    (id) => `/api/fichas/sugerir-campo/${encodeURIComponent(id)}`,
    r.job_id,
    { timeoutMs: 5 * 60 * 1000 },
  );
  return { valor: fin.valor ?? "" };
}
