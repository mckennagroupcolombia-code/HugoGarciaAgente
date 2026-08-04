import { useState } from "react";
import {
  useWebChat,
  useWebChatNotify,
  useSetWebChatNotify,
  useMarkWebChatReviewed,
  useMarkAllWebChatReviewed,
  useWebChatQuickReplies,
  useAddWebChatQuickReply,
  useDeleteWebChatQuickReply,
  type WebChatSession,
  type QuickReply,
} from "../hooks/useWebChat";
import { useTicketsAuth } from "../stores/ticketsAuth";
import { esAdminPanel } from "../lib/adminAccess";
import { ProseTextarea } from "./ProseTextarea";

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

function RespuestasRapidasSection() {
  const { user } = useTicketsAuth();
  const isAdmin = esAdminPanel(user);
  const { data, isLoading } = useWebChatQuickReplies();
  const addReply = useAddWebChatQuickReply();
  const deleteReply = useDeleteWebChatQuickReply();
  const [abierto, setAbierto] = useState(true);
  const [titulo, setTitulo] = useState("");
  const [texto, setTexto] = useState("");
  const [global, setGlobal] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [formAbierto, setFormAbierto] = useState(false);

  async function copiar(item: QuickReply) {
    try {
      await navigator.clipboard.writeText(item.texto);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      window.prompt("Copia el texto:", item.texto);
    }
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!texto.trim()) return;
    try {
      await addReply.mutateAsync({
        texto: texto.trim(),
        titulo: titulo.trim(),
        scope: global && isAdmin ? "global" : "mine",
      });
      setTitulo("");
      setTexto("");
      setFormAbierto(false);
      setGlobal(false);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "No se pudo guardar");
    }
  }

  const items: { item: QuickReply; scope: "mine" | "global" }[] = [
    ...(data?.mine ?? []).map((item) => ({ item, scope: "mine" as const })),
    ...(data?.global ?? []).map((item) => ({ item, scope: "global" as const })),
  ];

  return (
    <section className="shrink-0 border-t border-border pt-3 mt-2">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="text-xs font-semibold text-ink">Respuestas rápidas</span>
        <span className="text-[10px] text-muted">{abierto ? "▲" : "▼"}</span>
      </button>
      {abierto && (
        <div className="mt-2 space-y-2">
          <p className="text-[10px] text-muted leading-snug">
            Toca una respuesta para copiarla al portapapeles y pegarla donde atiendas al cliente.
          </p>

          {isLoading && <p className="text-[11px] text-muted">Cargando…</p>}

          {!isLoading && items.length === 0 && (
            <p className="text-[11px] text-muted">Aún no hay respuestas guardadas.</p>
          )}

          <ul className="max-h-36 space-y-1 overflow-y-auto pr-0.5">
            {items.map(({ item, scope }) => (
              <li key={`${scope}-${item.id}`} className="group flex gap-1">
                <button
                  type="button"
                  onClick={() => copiar(item)}
                  className="min-w-0 flex-1 rounded-lg border border-border bg-surface-hover px-2.5 py-1.5 text-left transition hover:border-accent-sky/40 hover:bg-accent-sky/10"
                  title={item.texto}
                >
                  <span className="block truncate text-[11px] font-semibold text-ink">
                    {scope === "global" ? "🌐 " : ""}
                    {item.titulo}
                    {copiedId === item.id && (
                      <span className="ml-1 text-emerald-400 font-normal">· copiado</span>
                    )}
                  </span>
                  <span className="block truncate text-[10px] text-muted mt-0.5">
                    {item.texto}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!window.confirm("¿Eliminar esta respuesta rápida?")) return;
                    deleteReply.mutate({ id: item.id, scope });
                  }}
                  disabled={deleteReply.isPending}
                  className="shrink-0 rounded-lg border border-transparent px-1.5 text-[10px] text-muted opacity-0 transition group-hover:opacity-100 hover:border-red-500/30 hover:text-red-400 disabled:opacity-40"
                  aria-label="Eliminar"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>

          {formAbierto ? (
            <form onSubmit={guardar} className="space-y-2 rounded-lg border border-border bg-surface p-2.5">
              <input
                type="text"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="Nombre corto (ej: Saludo Jenniffer)"
                className="w-full rounded-lg border border-border bg-surface-panel px-2 py-1.5 text-[11px] text-ink focus:outline-none focus:border-accent-sky"
              />
              <ProseTextarea
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                placeholder="Hola, buenas tardes. Soy Jenniffer, su asesora comercial…"
                rows={3}
                className="w-full resize-none rounded-lg border border-border bg-surface-panel px-2 py-1.5 text-[11px] text-ink focus:outline-none focus:border-accent-sky"
                required
              />
              {isAdmin && (
                <label className="flex items-center gap-2 text-[10px] text-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={global}
                    onChange={(e) => setGlobal(e.target.checked)}
                    className="rounded border-border"
                  />
                  Compartir con todo el equipo (global)
                </label>
              )}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={addReply.isPending || !texto.trim()}
                  className="flex-1 rounded-lg bg-accent-sky px-2 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
                >
                  {addReply.isPending ? "Guardando…" : "Guardar"}
                </button>
                <button
                  type="button"
                  onClick={() => setFormAbierto(false)}
                  className="rounded-lg border border-border px-2 py-1.5 text-[11px] text-muted hover:text-ink"
                >
                  Cancelar
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setFormAbierto(true)}
              className="w-full rounded-lg border border-dashed border-border px-2 py-1.5 text-[11px] font-medium text-accent-sky hover:bg-accent-sky/10 transition"
            >
              + Agregar respuesta
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export default function WebChatPanel() {
  const [onlyUnreviewed, setOnlyUnreviewed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data, isLoading, isError, error, refetch } = useWebChat(onlyUnreviewed);
  const { data: notifyState } = useWebChatNotify();
  const setNotify = useSetWebChatNotify();
  const markOne = useMarkWebChatReviewed();
  const markAll = useMarkAllWebChatReviewed();

  const sessions = data?.sessions ?? [];
  const selected =
    sessions.find((s) => s.session_id === selectedId) ?? sessions[0] ?? null;

  const summary = data?.summary;
  const notifyEnabled =
    notifyState?.enabled ?? data?.notify_to_group?.enabled ?? true;

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-6xl flex-col gap-4 lg:flex-row lg:h-[calc(100vh-6rem)]">
      <div className="flex w-full flex-col gap-3 lg:w-80 lg:shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-ink">Chat web</h2>
            <p className="text-[10px] text-muted mt-0.5">
              Notificación a WhatsApp (Guias_Envios pagina web):{" "}
              <span className={notifyEnabled ? "text-accent-sky" : "text-warning"}>
                {notifyEnabled ? "ACTIVA" : "PAUSADA"}
              </span>
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

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={setNotify.isPending}
            onClick={() => setNotify.mutate(!notifyEnabled)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
              notifyEnabled
                ? "bg-accent-sky text-white"
                : "border border-border bg-surface-panel text-muted hover:text-ink"
            }`}
            title="Activa/pausa el envío de notificaciones al grupo Guias_Envios pagina web"
          >
            {notifyEnabled ? "Deshabilitar notificación WA" : "Habilitar notificación WA"}
          </button>
          <p className="text-[10px] text-muted">
            Aplica a nuevas interacciones del chat burbuja.
          </p>
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

        <RespuestasRapidasSection />

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          {isLoading && (
            <p className="text-sm text-muted">Cargando conversaciones…</p>
          )}
          {isError && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error instanceof Error ? error.message : "No se pudo cargar el chat web"}
            </div>
          )}
          {!isLoading && !isError && sessions.length === 0 && (
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
