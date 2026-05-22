import { useState, useRef, useEffect, type FormEvent } from "react";
import { api } from "../api/client";
import { usePanelChatMutation } from "../hooks/useChat";
import { useModelos, CATEGORIA_LABEL, CATEGORIA_COLOR, type Modelo } from "../hooks/useModelos";
import {
  useCanales,
  useAsignarModeloCanal,
  type CanalConfig,
} from "../hooks/useCanales";

interface Message {
  role: "user" | "agent";
  text: string;
  time: string;
  modelo?: string;
}

function formatTime(d: Date) {
  return d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
}

const SESSION_BASE = "panel_" + Math.random().toString(36).slice(2, 8);

// ── Model badge ─────────────────────────────────────────────────────────────

function ModelBadge({ modelo, categoria }: { modelo: string; categoria: string }) {
  const cls = CATEGORIA_COLOR[categoria] ?? "text-gray-400 border-gray-500/30 bg-gray-500/10";
  const label = modelo.length > 22 ? modelo.slice(0, 20) + "…" : modelo;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-mono ${cls}`}>
      {label}
    </span>
  );
}

// ── Category tab ────────────────────────────────────────────────────────────

function CatTab({
  cat,
  active,
  onClick,
}: {
  cat: string;
  active: boolean;
  onClick: () => void;
}) {
  const base = "px-3 py-1 text-xs font-semibold rounded-full border transition-colors cursor-pointer";
  const cls = active
    ? `${CATEGORIA_COLOR[cat]} border-current`
    : "text-muted border-border bg-transparent hover:border-accent/40 hover:text-ink";
  return (
    <button className={`${base} ${cls}`} onClick={onClick}>
      {CATEGORIA_LABEL[cat] ?? cat}
    </button>
  );
}

// ── Model pill ──────────────────────────────────────────────────────────────

function ModelPill({
  m,
  selected,
  onClick,
}: {
  m: Modelo;
  selected: boolean;
  onClick: () => void;
}) {
  const label = m.nombre.length > 26 ? m.nombre.slice(0, 24) + "…" : m.nombre;
  const base = "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all cursor-pointer";
  const cls = selected
    ? `${CATEGORIA_COLOR[m.categoria]} border-current font-bold`
    : "text-muted border-border bg-surface-hover hover:border-accent/50 hover:text-ink";
  return (
    <button className={`${base} ${cls}`} onClick={onClick} title={m.id}>
      {selected && <span className="h-1.5 w-1.5 rounded-full bg-current shrink-0" />}
      <span>{label}</span>
      {m.size_mb && (
        <span className="text-[10px] opacity-60 ml-0.5">{m.size_mb > 1000 ? `${(m.size_mb / 1024).toFixed(0)}G` : `${m.size_mb}M`}</span>
      )}
    </button>
  );
}

// ── Channel assignments panel ──────────────────────────────────────────────

const CANAL_ICONO: Record<string, string> = {
  wa: "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z M11.5 2.5A9.5 9.5 0 002 12c0 1.674.435 3.247 1.198 4.613L2 22l5.54-1.175A9.5 9.5 0 1011.5 2.5z",
  ml: "M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z M16 3H8L6 7h12l-2-4z",
  web: "M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 18c-4.418 0-8-3.582-8-8s3.582-8 8-8 8 3.582 8 8-3.582 8-8 8z M12 6v6l4 2",
  panel: "M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  mic: "M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8",
};

const CANAL_COLOR: Record<string, string> = {
  wa:    "text-emerald-400",
  ml:    "text-yellow-400",
  web:   "text-blue-400",
  panel: "text-accent",
  mic:   "text-purple-400",
};

function CanalModeloSelector({
  canal,
  modelos,
  onSaved,
}: {
  canal: CanalConfig;
  modelos: Modelo[];
  onSaved?: () => void;
}) {
  const asignar = useAsignarModeloCanal();
  const cats = canal.categorias_modelo ?? ["claude", "gemini"];
  const opciones = modelos.filter((m) => cats.includes(m.categoria));
  const [draft, setDraft] = useState(canal.modelo_id);
  const dirty = draft !== canal.modelo_id;

  useEffect(() => {
    setDraft(canal.modelo_id);
  }, [canal.modelo_id]);

  const guardar = () => {
    asignar.mutate(
      { canalId: canal.id, modeloId: draft },
      { onSuccess: () => onSaved?.() },
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="min-w-[10rem] flex-1 rounded-lg border border-border bg-surface-input px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
        disabled={asignar.isPending}
      >
        {opciones.map((m) => (
          <option key={m.id} value={m.id}>
            {m.nombre} ({m.categoria})
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={guardar}
        disabled={!dirty || asignar.isPending}
        className="shrink-0 rounded-lg border border-accent bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent/20 disabled:opacity-40"
      >
        {asignar.isPending ? "Guardando…" : "Guardar"}
      </button>
      {asignar.isError && (
        <span className="text-[10px] text-danger w-full">
          {(asignar.error as Error).message}
        </span>
      )}
    </div>
  );
}

function CanalesPanel({
  modeloId,
  onLoadModel,
}: {
  modeloId: string;
  onLoadModel: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const { data, isLoading } = useCanales();
  const { data: modelos = [] } = useModelos();

  const canales = data?.canales ?? [];

  return (
    <div className="rounded-xl border border-border bg-surface-panel overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-surface-hover transition-colors"
      >
        <span className="text-xs font-semibold text-muted uppercase tracking-wider">
          Canales activos — modelo por canal
        </span>
        <svg
          className={`w-3.5 h-3.5 text-muted transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-border divide-y divide-border">
          {isLoading && (
            <p className="px-4 py-3 text-xs text-muted">Cargando canales…</p>
          )}
          {canales.map((c) => {
            const isPanel = c.id === "panel_chat";
            const catColor =
              CATEGORIA_COLOR[c.modelo_categoria ?? "claude"] ?? "text-muted";
            return (
              <div key={c.id} className="px-4 py-3 space-y-2">
                <div className="flex items-start gap-3">
                  <svg
                    className={`h-4 w-4 shrink-0 mt-0.5 ${CANAL_COLOR[c.icono] ?? "text-muted"}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d={CANAL_ICONO[c.icono] ?? ""}
                    />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-ink">
                        {c.nombre}
                      </span>
                      <span className="text-[10px] text-muted border border-border rounded px-1.5 py-0.5 font-mono">
                        {c.modo}
                      </span>
                    </div>
                    <p className={`text-[11px] font-medium mt-0.5 ${catColor.split(" ")[0]}`}>
                      {c.modelo_nombre}
                      {c.proveedor ? ` · ${c.proveedor}` : ""}
                    </p>
                    <p className="text-[10px] text-muted mt-1 leading-snug">
                      {c.descripcion}
                    </p>
                  </div>
                  {isPanel && c.modelo_id === "seleccionable" && (
                    <button
                      type="button"
                      onClick={() => onLoadModel(modeloId)}
                      className="shrink-0 text-[10px] text-muted border border-border rounded px-2 py-1 hover:text-ink hover:border-accent/50 transition"
                      title="Usar el modelo del selector superior"
                    >
                      Sync panel
                    </button>
                  )}
                </div>
                {c.editable ? (
                  <CanalModeloSelector canal={c} modelos={modelos} />
                ) : (
                  <p className="text-[10px] text-muted pl-7">
                    Modelo elegido en este panel (selector superior).
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export default function Chat() {
  const { data: modelos = [], isLoading: loadingModelos } = useModelos();

  const categorias = Array.from(new Set(modelos.map((m) => m.categoria)));
  const [catActiva, setCatActiva] = useState<string>("claude");
  const [modeloId, setModeloId] = useState<string>("claude-sonnet-4-6");
  const [selectorOpen, setSelectorOpen] = useState(false);

  // Derive categoria of selected model
  const modeloActual = modelos.find((m) => m.id === modeloId);
  const catModeloActual = modeloActual?.categoria ?? "claude";

  // When models load, set default to first available
  useEffect(() => {
    if (modelos.length > 0 && !modelos.find((m) => m.id === modeloId)) {
      setModeloId(modelos[0].id);
      setCatActiva(modelos[0].categoria);
    }
  }, [modelos]);

  // Per-model message history (client-side display only; server keeps context)
  const [histories, setHistories] = useState<Record<string, Message[]>>({});
  const messages = histories[modeloId] ?? [];

  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chat = usePanelChatMutation();

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chat.isPending]);

  const sessionId = `${SESSION_BASE}_${modeloId.replace(/[^a-z0-9]/gi, "_")}`;

  const send = (e?: FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || chat.isPending) return;

    const now = new Date();
    setHistories((h) => ({
      ...h,
      [modeloId]: [...(h[modeloId] ?? []), { role: "user", text, time: formatTime(now) }],
    }));
    setInput("");

    chat.mutate(
      { mensaje: text, session_id: sessionId, modelo_id: modeloId },
      {
        onSuccess: (data) => {
          setHistories((h) => ({
            ...h,
            [modeloId]: [
              ...(h[modeloId] ?? []),
              {
                role: "agent",
                text: data.respuesta,
                time: formatTime(new Date()),
                modelo: data.modelo_id,
              },
            ],
          }));
        },
        onError: (err) => {
          setHistories((h) => ({
            ...h,
            [modeloId]: [
              ...(h[modeloId] ?? []),
              { role: "agent", text: `Error: ${err.message}`, time: formatTime(new Date()) },
            ],
          }));
        },
      },
    );

    inputRef.current?.focus();
  };

  const clearChat = () => {
    setHistories((h) => ({ ...h, [modeloId]: [] }));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const selectModel = (m: Modelo) => {
    setModeloId(m.id);
    setSelectorOpen(false);
    inputRef.current?.focus();
  };

  const modelosFiltrados = modelos.filter((m) => m.categoria === catActiva);

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-3">

      {/* ── Header + selector toggle ── */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink">Chat de Agentes</h2>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button
              onClick={clearChat}
              className="text-xs text-muted hover:text-ink transition"
              title="Limpiar conversación"
            >
              Limpiar
            </button>
          )}
          <button
            onClick={() => setSelectorOpen((o) => !o)}
            className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors ${
              CATEGORIA_COLOR[catModeloActual]
            } border-current`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {modeloActual?.nombre ?? modeloId}
            <svg
              className={`w-3 h-3 transition-transform ${selectorOpen ? "rotate-180" : ""}`}
              fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Model selector panel ── */}
      {selectorOpen && (
        <div className="rounded-xl border border-border bg-surface-panel p-4 space-y-3 shadow-paper-sm">
          {loadingModelos ? (
            <p className="text-xs text-muted">Cargando modelos…</p>
          ) : (
            <>
              {/* Category tabs */}
              <div className="flex gap-2 flex-wrap">
                {categorias.map((cat) => (
                  <CatTab
                    key={cat}
                    cat={cat}
                    active={catActiva === cat}
                    onClick={() => setCatActiva(cat)}
                  />
                ))}
              </div>

              {/* Model pills */}
              <div className="flex flex-wrap gap-2">
                {modelosFiltrados.length === 0 && (
                  <p className="text-xs text-muted">
                    {catActiva === "ollama"
                      ? "Ollama no disponible o sin modelos descargados"
                      : "Sin modelos en esta categoría"}
                  </p>
                )}
                {modelosFiltrados.map((m) => (
                  <ModelPill
                    key={m.id}
                    m={m}
                    selected={m.id === modeloId}
                    onClick={() => selectModel(m)}
                  />
                ))}
              </div>

              {/* Info del modelo seleccionado */}
              {modeloActual && (
                <p className="text-[11px] text-muted">
                  <span className="font-mono">{modeloActual.id}</span>
                  {" · "}
                  {modeloActual.proveedor}
                  {modeloActual.categoria === "ollama" &&
                    " · contexto independiente por modelo · sin tool-use"}
                  {modeloActual.categoria === "claude" &&
                    " · sin tool-use en modo panel"}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Channel assignments ── */}
      <CanalesPanel modeloId={modeloId} onLoadModel={(id) => {
        const m = modelos.find((x) => x.id === id);
        if (m) { setModeloId(m.id); setCatActiva(m.categoria); }
      }} />

      {/* ── Messages ── */}
      <div className="flex-1 space-y-3 overflow-auto rounded-xl border border-border bg-surface-panel p-4 shadow-paper-sm">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <p className="text-sm text-muted text-center">
              Conversación con{" "}
              <span className={`font-semibold ${CATEGORIA_COLOR[catModeloActual].split(" ")[0]}`}>
                {modeloActual?.nombre ?? modeloId}
              </span>
            </p>
            <p className="text-xs text-muted/60 text-center max-w-xs">
              {catModeloActual === "ollama"
                ? "Modelo local. Cambia de modelo en cualquier momento — cada uno mantiene su propio contexto."
                : "Modo conversacional sin herramientas. Para operaciones completas usa WhatsApp."}
            </p>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                m.role === "user"
                  ? "rounded-br-md bg-accent text-white"
                  : "rounded-bl-md bg-surface-hover text-ink"
              }`}
            >
              <p className="whitespace-pre-wrap">{m.text}</p>
              <div className={`mt-1.5 flex items-center gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <span className={`text-[10px] ${m.role === "user" ? "text-white/60" : "text-muted"}`}>
                  {m.time}
                </span>
                {m.role === "agent" && m.modelo && (
                  <ModelBadge
                    modelo={m.modelo}
                    categoria={modelos.find((x) => x.id === m.modelo)?.categoria ?? "claude"}
                  />
                )}
              </div>
            </div>
          </div>
        ))}

        {chat.isPending && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md bg-surface-hover px-4 py-3">
              <div className="flex gap-1.5 items-center">
                <span className="h-2 w-2 animate-bounce rounded-full bg-muted [animation-delay:0ms]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-muted [animation-delay:150ms]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-muted [animation-delay:300ms]" />
                <span className="text-[10px] text-muted ml-1">
                  {modeloActual?.nombre ?? modeloId}
                </span>
              </div>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* ── Input ── */}
      <form onSubmit={send} className="flex gap-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`Mensaje para ${modeloActual?.nombre ?? "el agente"}…`}
          rows={1}
          className="flex-1 resize-none rounded-xl border border-border bg-surface-input px-4 py-3 text-sm text-ink outline-none placeholder:text-muted/50 focus:border-accent"
        />
        <button
          type="submit"
          disabled={!input.trim() || chat.isPending}
          className="rounded-full bg-accent px-6 py-3 text-sm font-bold text-white shadow-[0_3px_0_rgba(0,0,0,0.15)] transition hover:-translate-y-px hover:bg-accent-hover disabled:opacity-40 disabled:hover:translate-y-0"
        >
          Enviar
        </button>
      </form>
    </div>
  );
}
