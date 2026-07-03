import { useState } from "react";
import { usePostventa, useResponderPostventa } from "../hooks/usePostventa";

export default function PostventaPanel() {
  const { data, isLoading, refetch } = usePostventa();
  const responder = useResponderPostventa();
  const [respuestas, setRespuestas] = useState<Record<string, string>>({});
  const [errores, setErrores] = useState<Record<string, string>>({});

  const mensajes = data?.mensajes ?? [];

  const handleSubmit = (codigo: string) => {
    const texto = (respuestas[codigo] ?? "").trim();
    if (!texto) return;
    setErrores((e) => {
      const next = { ...e };
      delete next[codigo];
      return next;
    });
    responder.mutate(
      { codigo, respuesta: texto },
      {
        onSuccess: (res) => {
          if (res?.ok) {
            setRespuestas((r) => {
              const next = { ...r };
              delete next[codigo];
              return next;
            });
          } else {
            setErrores((e) => ({
              ...e,
              [codigo]: res?.error || "No se pudo enviar la respuesta",
            }));
          }
        },
        onError: () => {
          setErrores((e) => ({
            ...e,
            [codigo]: "Error de conexión con el servidor",
          }));
        },
      },
    );
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-ink">
          Postventa MeLi
          {data && (
            <span className="ml-2 text-lg font-normal text-muted">
              ({data.total} pendiente{data.total !== 1 ? "s" : ""})
            </span>
          )}
        </h2>
        <button
          onClick={() => refetch()}
          className="rounded-lg border border-border px-3 py-1.5 text-base text-muted transition hover:text-ink"
        >
          Actualizar
        </button>
      </div>

      <p className="text-base text-muted">
        Mensajes de compradores post-compra. La respuesta se envía en MeLi y se
        notifica al grupo de postventa en WhatsApp.
      </p>

      {isLoading && <p className="text-lg text-muted">Cargando...</p>}

      {!isLoading && mensajes.length === 0 && (
        <div className="rounded-xl border border-border bg-surface-panel p-8 text-center">
          <p className="text-lg text-success">Sin mensajes postventa pendientes</p>
        </div>
      )}

      <div className="grid gap-4 items-start lg:grid-cols-2">
        {mensajes.map((m) => (
          <div
            key={m.pack_id}
            className="rounded-xl border border-border bg-surface-panel p-4 space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-lg font-medium text-ink truncate">
                  {m.comprador || "Comprador MeLi"}
                </p>
                {m.productos.length > 0 && (
                  <ul className="mt-1 text-base text-muted list-disc list-inside">
                    {m.productos.map((p) => (
                      <li key={p} className="truncate">
                        {p}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-lg text-ink-muted whitespace-pre-wrap">
                  &ldquo;{m.texto}&rdquo;
                </p>
                <p className="mt-1 text-base text-muted">
                  Código: <span className="font-mono font-semibold">{m.codigo}</span>
                  {" · "}
                  Pack: …{m.pack_id.slice(-6)}
                  {m.timestamp && (
                    <>
                      {" · "}
                      {new Date(m.timestamp).toLocaleString("es-CO", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </>
                  )}
                </p>
              </div>
            </div>

            {errores[m.codigo] && (
              <p className="text-base text-danger">{errores[m.codigo]}</p>
            )}

            <div className="flex gap-2">
              <input
                type="text"
                value={respuestas[m.codigo] ?? ""}
                onChange={(e) =>
                  setRespuestas((r) => ({ ...r, [m.codigo]: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmit(m.codigo);
                }}
                placeholder="Escribir respuesta al comprador..."
                className="flex-1 rounded-lg border border-border bg-surface-input px-3 py-2 text-lg text-ink outline-none placeholder:text-muted/50 focus:border-accent"
              />
              <button
                onClick={() => handleSubmit(m.codigo)}
                disabled={
                  !(respuestas[m.codigo] ?? "").trim() || responder.isPending
                }
                className="rounded-lg bg-accent px-4 py-2 text-lg font-medium text-white transition hover:bg-accent-hover disabled:opacity-40"
              >
                {responder.isPending ? "..." : "Responder"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
