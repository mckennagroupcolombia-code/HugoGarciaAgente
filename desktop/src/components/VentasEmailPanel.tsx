import { useState } from "react";
import {
  useVentasEmailPendientes,
  useVentasEmailDetalle,
  useResponderVentasEmail,
  type CorreoVentasResumen,
} from "../hooks/useVentasEmail";

function nombreDe(de: string): string {
  const m = de.match(/^"?([^"<]*)"?\s*<?([^>]*)>?$/);
  const nombre = (m?.[1] ?? "").trim();
  return nombre || de;
}

function CorreoDetalle({
  correo,
  onCerrar,
}: {
  correo: CorreoVentasResumen;
  onCerrar: () => void;
}) {
  const { data, isLoading } = useVentasEmailDetalle(correo.id);
  const responder = useResponderVentasEmail();
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);

  const handleEnviar = () => {
    const t = texto.trim();
    if (!t) return;
    setError(null);
    responder.mutate(
      { message_id: correo.id, texto: t },
      {
        onSuccess: (res) => {
          if (res?.ok) {
            setEnviado(true);
            setTexto("");
          } else {
            setError(res?.error || "No se pudo enviar la respuesta");
          }
        },
        onError: () => setError("Error de conexión al enviar"),
      },
    );
  };

  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface-hover/50 p-3">
      {isLoading && <p className="text-sm text-muted">Cargando correo…</p>}
      {!isLoading && data && (
        <blockquote className="max-h-64 overflow-y-auto rounded-xl border border-border/60 bg-surface px-3 py-2.5 text-[15px] leading-relaxed text-ink-muted whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {data.cuerpo || "(sin contenido de texto)"}
        </blockquote>
      )}

      {enviado ? (
        <p className="text-sm font-medium text-success">Respuesta enviada.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {error && <p className="text-sm text-danger break-words">{error}</p>}
          <textarea
            rows={4}
            spellCheck
            lang="es"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Escribir respuesta…"
            className="min-h-[6rem] w-full resize-y rounded-xl border border-border bg-surface-input px-3 py-2.5 text-base leading-relaxed text-ink outline-none placeholder:text-muted/50 focus:border-accent"
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleEnviar}
              disabled={!texto.trim() || responder.isPending}
              className="min-h-11 rounded-xl bg-accent px-3 py-2.5 text-base font-semibold text-white transition hover:bg-accent-hover disabled:opacity-40"
            >
              {responder.isPending ? "…" : "Enviar respuesta"}
            </button>
            <button
              type="button"
              onClick={onCerrar}
              className="min-h-11 rounded-xl border border-border px-3 py-2.5 text-base font-semibold text-muted transition hover:text-ink"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function VentasEmailPanel() {
  const { data, isLoading, error, refetch } = useVentasEmailPendientes();
  const [abierto, setAbierto] = useState<string | null>(null);

  const correos = data?.correos ?? [];

  return (
    <div className="mx-auto w-full max-w-4xl space-y-3 sm:space-y-4">
      <div className="flex items-start justify-between gap-2">
        <h2 className="min-w-0 text-xl font-semibold leading-tight text-ink sm:text-2xl">
          Correo Ventas
          {data && (
            <span className="ml-1.5 text-base font-normal text-muted sm:text-lg">
              ({data.total})
            </span>
          )}
        </h2>
        <button
          type="button"
          onClick={() => refetch()}
          className="min-h-10 shrink-0 rounded-lg border border-border px-3 py-2 text-sm text-muted transition hover:text-ink sm:text-base"
        >
          Actualizar
        </button>
      </div>

      <p className="hidden text-base text-muted sm:block">
        Correos sin leer de ventas@mckennagroup.co. Responder envía el correo y
        lo marca como leído.
      </p>

      {isLoading && <p className="text-base text-muted">Cargando...</p>}

      {!!error && (
        <div className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger break-words">
          {(error as any)?.message || "No se pudo cargar la bandeja de ventas@."}
        </div>
      )}

      {!isLoading && !error && correos.length === 0 && (
        <div className="rounded-xl border border-border bg-surface-panel px-4 py-8 text-center">
          <p className="text-base text-success sm:text-lg">
            Sin correos pendientes en ventas@
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:gap-4">
        {correos.map((c) => (
          <article
            key={c.id}
            className="rounded-xl border border-border bg-surface-panel p-3 space-y-3 sm:p-4"
          >
            <header className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-base font-semibold text-ink break-words [overflow-wrap:anywhere] sm:text-lg">
                  {nombreDe(c.de)}
                </p>
                <p className="text-sm text-muted break-words [overflow-wrap:anywhere]">
                  {c.asunto || "(sin asunto)"}
                </p>
              </div>
              {c.no_leido && (
                <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent">
                  No leído
                </span>
              )}
            </header>

            <blockquote className="rounded-xl border border-border/60 bg-surface px-3 py-2.5 text-[15px] leading-relaxed text-ink-muted break-words [overflow-wrap:anywhere] sm:text-base">
              {c.snippet}
            </blockquote>

            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted">{c.fecha}</p>
              <button
                type="button"
                onClick={() => setAbierto(abierto === c.id ? null : c.id)}
                className="min-h-10 rounded-lg border border-border px-3 py-2 text-sm font-medium text-accent transition hover:bg-surface-hover"
              >
                {abierto === c.id ? "Ocultar" : "Ver y responder"}
              </button>
            </div>

            {abierto === c.id && (
              <CorreoDetalle correo={c} onCerrar={() => setAbierto(null)} />
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
