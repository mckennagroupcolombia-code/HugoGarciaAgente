import { useState } from "react";
import { usePreventa, useResponderPreventa } from "../hooks/usePreventa";

export default function PreventaPanel() {
  const { data, isLoading, refetch } = usePreventa();
  const responder = useResponderPreventa();
  const [respuestas, setRespuestas] = useState<Record<string, string>>({});

  const preguntas = data?.preguntas ?? [];

  const handleSubmit = (qid: string) => {
    const texto = (respuestas[qid] ?? "").trim();
    if (!texto) return;
    responder.mutate(
      { question_id: qid, respuesta: texto },
      {
        onSuccess: () => {
          setRespuestas((r) => {
            const next = { ...r };
            delete next[qid];
            return next;
          });
        },
      },
    );
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-100">
          Preventa MeLi
          {data && (
            <span className="ml-2 text-sm font-normal text-muted">
              ({data.total} pendiente{data.total !== 1 ? "s" : ""})
            </span>
          )}
        </h2>
        <button
          onClick={() => refetch()}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition hover:text-gray-100"
        >
          Actualizar
        </button>
      </div>

      {isLoading && <p className="text-sm text-muted">Cargando...</p>}

      {!isLoading && preguntas.length === 0 && (
        <div className="rounded-xl border border-border bg-surface-panel p-8 text-center">
          <p className="text-sm text-success">Sin preguntas pendientes</p>
        </div>
      )}

      {preguntas.map((p) => (
        <div
          key={p.question_id}
          className="rounded-xl border border-border bg-surface-panel p-4 space-y-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-100 truncate">
                {p.titulo_producto}
              </p>
              <p className="mt-1 text-sm text-gray-300">
                &ldquo;{p.pregunta}&rdquo;
              </p>
              <p className="mt-1 text-xs text-muted">
                ID: ...{p.question_id.slice(-4)} &middot;{" "}
                {new Date(p.timestamp).toLocaleString("es-CO", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={respuestas[p.question_id] ?? ""}
              onChange={(e) =>
                setRespuestas((r) => ({ ...r, [p.question_id]: e.target.value }))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit(p.question_id);
              }}
              placeholder="Escribir respuesta..."
              className="flex-1 rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-gray-100 outline-none placeholder:text-muted/50 focus:border-accent"
            />
            <button
              onClick={() => handleSubmit(p.question_id)}
              disabled={!(respuestas[p.question_id] ?? "").trim() || responder.isPending}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-hover disabled:opacity-40"
            >
              {responder.isPending ? "..." : "Responder"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
