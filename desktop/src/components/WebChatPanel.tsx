import { useState } from "react";
import {
  useWebChat,
  useMarkWebChatReviewed,
  useMarkAllWebChatReviewed,
  type WebChatSession,
} from "../hooks/useWebChat";

function sourceLabel(source?: string) {
  switch (source) {
    case "catalog_fallback":
      return "Catálogo (fallback)";
    case "offline":
      return "Sin conexión";
    case "agent":
      return "Agente IA";
    default:
      return source || "—";
  }
}

function SessionCard({
  session,
  selected,
  onSelect,
}: {
  session: WebChatSession;
  selected: boolean;
  onSelect: () => void;
}) {
  const unread = !session.reviewed;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-xl border p-3 text-left transition ${
        selected
          ? "border-accent-sky bg-surface-hover"
          : "border-border bg-surface-panel hover:bg-surface-hover"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="truncate text-xs font-mono text-muted">
          {session.session_id.slice(0, 18)}…
        </span>
        {unread && (
          <span className="shrink-0 rounded-full bg-warning px-2 py-0.5 text-[10px] font-bold text-black">
            Nuevo
          </span>
        )}
      </div>
      <p className="mt-1 line-clamp-2 text-sm text-ink">
        {session.last_user_message || "(sin mensaje)"}
      </p>
      <p className="mt-1 text-[11px] text-muted">
        {session.messages_count} msg ·{" "}
        {new Date(session.last_at).toLocaleString("es-CO", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </p>
    </button>
  );
}

export default function WebChatPanel() {
  const [onlyUnreviewed, setOnlyUnreviewed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data, isLoading, refetch } = useWebChat(onlyUnreviewed);
  const markOne = useMarkWebChatReviewed();
  const markAll = useMarkAllWebChatReviewed();

  const sessions = data?.sessions ?? [];
  const selected =
    sessions.find((s) => s.session_id === selectedId) ?? sessions[0] ?? null;

  const summary = data?.summary;

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-6xl flex-col gap-4 lg:flex-row lg:h-[calc(100vh-6rem)]">
      <div className="flex w-full flex-col gap-3 lg:w-80 lg:shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-ink">Chat web</h2>
            <p className="text-[10px] text-muted mt-0.5">
              Cada interacción también se notifica al grupo WhatsApp Guias_Envios (pedidos web).
            </p>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded-lg border border-border px-2 py-1 text-xs text-muted hover:text-ink"
          >
            Actualizar
          </button>
        </div>

        {summary && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border border-border bg-surface-panel p-2">
              <p className="text-lg font-bold text-ink">
                {summary.today_interactions}
              </p>
              <p className="text-[10px] text-muted">Hoy</p>
            </div>
            <div className="rounded-lg border border-border bg-surface-panel p-2">
              <p className="text-lg font-bold text-warning">
                {summary.unreviewed_count}
              </p>
              <p className="text-[10px] text-muted">Sin revisar</p>
            </div>
            <div className="rounded-lg border border-border bg-surface-panel p-2">
              <p className="text-lg font-bold text-accent-sky">
                {summary.active_last_24h}
              </p>
              <p className="text-[10px] text-muted">24 h</p>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={onlyUnreviewed}
              onChange={(e) => {
                setOnlyUnreviewed(e.target.checked);
                setSelectedId(null);
              }}
              className="rounded border-border"
            />
            Solo sin revisar
          </label>
          {summary && summary.unreviewed_count > 0 && (
            <button
              type="button"
              disabled={markAll.isPending}
              onClick={() => markAll.mutate()}
              className="rounded-lg border border-border px-2 py-1 text-xs text-muted hover:text-ink disabled:opacity-50"
            >
              Marcar todas revisadas
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          {isLoading && (
            <p className="text-sm text-muted">Cargando conversaciones…</p>
          )}
          {!isLoading && sessions.length === 0 && (
            <div className="rounded-xl border border-border bg-surface-panel p-6 text-center">
              <p className="text-sm text-muted">
                No hay conversaciones
                {onlyUnreviewed ? " pendientes de revisión" : ""}.
              </p>
            </div>
          )}
          {sessions.map((s) => (
            <SessionCard
              key={s.session_id}
              session={s}
              selected={selected?.session_id === s.session_id}
              onSelect={() => setSelectedId(s.session_id)}
            />
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-border bg-surface-panel">
        {!selected ? (
          <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted">
            Seleccione una conversación del chat de la página web.
          </div>
        ) : (
          <>
            <div className="border-b border-border px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono text-xs text-muted break-all">
                    {selected.session_id}
                  </p>
                  {selected.page_url && (
                    <a
                      href={selected.page_url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 block truncate text-xs text-accent-sky hover:underline"
                    >
                      {selected.page_url}
                    </a>
                  )}
                </div>
                {!selected.reviewed && (
                  <button
                    type="button"
                    disabled={markOne.isPending}
                    onClick={() => markOne.mutate(selected.session_id)}
                    className="shrink-0 rounded-lg bg-accent-sky px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    Marcar revisada
                  </button>
                )}
              </div>
              <p className="mt-2 text-xs text-muted">
                Origen última respuesta: {sourceLabel(selected.last_source)}
                {selected.last_upstream_error
                  ? ` · ${selected.last_upstream_error}`
                  : ""}
              </p>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              {(selected.recent_turns ?? []).map((turn, i) => (
                <div key={`${turn.at}-${i}`} className="space-y-2">
                  <div className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent-sky/20 px-3 py-2 text-sm text-ink">
                      <p className="text-[10px] font-semibold uppercase text-muted mb-1">
                        Cliente
                      </p>
                      {turn.user_message || "—"}
                    </div>
                  </div>
                  <div className="flex justify-start">
                    <div className="max-w-[90%] rounded-2xl rounded-bl-md border border-border bg-surface px-3 py-2 text-sm text-ink whitespace-pre-wrap">
                      <p className="text-[10px] font-semibold uppercase text-muted mb-1">
                        Hugo · {sourceLabel(turn.source)}
                      </p>
                      {turn.agent_reply || "—"}
                      {turn.upstream_error && (
                        <p className="mt-1 text-[10px] text-warning">
                          Upstream: {turn.upstream_error}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {(!selected.recent_turns ||
                selected.recent_turns.length === 0) && (
                <>
                  <div className="rounded-lg bg-accent-sky/10 p-3 text-sm">
                    <span className="text-xs font-semibold text-muted">
                      Cliente
                    </span>
                    <p className="mt-1">{selected.last_user_message}</p>
                  </div>
                  <div className="rounded-lg border border-border p-3 text-sm whitespace-pre-wrap">
                    <span className="text-xs font-semibold text-muted">
                      Hugo
                    </span>
                    <p className="mt-1">{selected.last_agent_reply}</p>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
