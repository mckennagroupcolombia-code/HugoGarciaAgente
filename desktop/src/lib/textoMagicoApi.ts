import { api } from "../api/client";

export interface TextoMagicoRespuesta {
  ok: boolean;
  status?: string;
  sugerencias?: { texto: string; titulo?: string; fuente?: string }[];
  fichas?: { titulo?: string; fuente?: string }[];
  mensaje?: string;
  error?: string;
  job_id?: string;
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export interface ContextoCapasTexto {
  titulo?: string;
  subtitulo?: string;
}

export async function solicitarTextoMagico(
  fragmento: string,
  opts: {
    max_chars?: number;
    palabras_por_parrafo?: number;
    contexto_capas?: ContextoCapasTexto;
    /** Refuerza prompt MeLi + validación estricta (default true en plantillas). */
    modo_descripcion_mp?: boolean;
  },
  signal?: AbortSignal,
): Promise<TextoMagicoRespuesta> {
  const inicio = await api.post<TextoMagicoRespuesta>(
    "/api/plantillas-visuales/texto-sugerir",
    {
      fragmento,
      max_chars: opts.max_chars,
      palabras_por_parrafo: opts.palabras_por_parrafo,
      contexto_capas: opts.contexto_capas,
      modo_descripcion_mp: opts.modo_descripcion_mp ?? true,
    },
  );

  if (inicio.status === "done" || (inicio.sugerencias && !inicio.job_id)) {
    return inicio;
  }

  const jobId = inicio.job_id;
  if (!jobId) {
    throw new Error(inicio.error || inicio.mensaje || "No se pudo iniciar la generación");
  }

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    await esperar(2000);
    const estado = await api.get<TextoMagicoRespuesta>(
      `/api/plantillas-visuales/texto-sugerir/${jobId}`,
    );
    if (estado.status === "done") return estado;
    if (estado.status === "error" || estado.ok === false) {
      throw new Error(estado.error || estado.mensaje || "Error al generar texto");
    }
  }

  throw new Error(
    "La generación tardó demasiado. El servidor sigue trabajando; intenta de nuevo en unos segundos.",
  );
}
