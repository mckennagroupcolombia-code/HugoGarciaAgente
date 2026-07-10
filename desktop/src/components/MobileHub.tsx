import React, { useState, useRef, useEffect, useCallback } from "react";
import { useTicketsAuth, type TicketsUser } from "../stores/ticketsAuth";
import { puedeVerSeccionPanel } from "./Sidebar";
import { useAppStore, type Panel, type MobileHubTab } from "../stores/app";
import { usePanelChatMutation } from "../hooks/useChat";
import { cerrarSesionPanel } from "../hooks/usePanelSession";
import { IllustrationIcon } from "../icons/IllustrationIcon";
import { PanelIcon } from "../icons/PanelIcon";
import { Icon, type UiIconName } from "../icons";
import UserAvatar from "./UserAvatar";

// ── Helpers ────────────────────────────────────────────────────────────────────

function tapi(path: string, token: string, opts: RequestInit = {}) {
  const isForm = opts.body instanceof FormData;
  const hasJson = opts.body != null && !isForm;
  const method = (opts.method ?? "GET").toUpperCase();
  let url = `/api/tickets${path}`;
  if (method === "GET") url += `${path.includes("?") ? "&" : "?"}_t=${Date.now()}`;
  return fetch(url, {
    cache: "no-store",
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      Pragma: "no-cache",
      ...(hasJson ? { "Content-Type": "application/json" } : {}),
      ...(opts.headers ?? {}),
    },
  }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data?.error ?? `Error ${r.status}`);
    return data;
  });
}

function formatRelative(ts: string): string {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return "ahora";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Buenos días";
  if (h < 18) return "Buenas tardes";
  return "Buenas noches";
}

// ── Types ──────────────────────────────────────────────────────────────────────

type Tab = MobileHubTab;

interface Ticket {
  id: number;
  numero: string;
  titulo: string;
  categoria: string;
  estado: string;
  prioridad: string;
  creado_en: string;
}

interface ChatMessage {
  role: "user" | "agent";
  text: string;
  time: string;
}

interface QuickCategory {
  slug: string;
  label: string;
  icon: UiIconName;
  tone: "plum" | "sky" | "leaf" | "sun" | "rose" | "neutral";
  color: string;
}

// ── Quick categories ───────────────────────────────────────────────────────────

const QUICK_CATS: QuickCategory[] = [
  { slug: "etiquetas",     label: "Etiquetas",    icon: "tag",     tone: "plum",    color: "bg-accent/10 text-accent dark:bg-accent/20 dark:text-accent/20" },
  { slug: "inventario",    label: "Inventario",   icon: "package", tone: "sky",     color: "bg-accent/10 text-accent dark:bg-accent/20 dark:text-accent/20" },
  { slug: "ventas",        label: "Ventas MeLi",  icon: "cart",    tone: "sun",     color: "bg-accent/10 text-accent dark:bg-accent/20 dark:text-accent/20" },
  { slug: "contabilidad",  label: "Contabilidad", icon: "receipt", tone: "leaf",    color: "bg-accent/10 text-accent dark:bg-accent/20 dark:text-accent/20" },
  { slug: "mantenimiento", label: "Mantenim.",    icon: "wrench",  tone: "rose",    color: "bg-accent/10 text-accent dark:bg-accent/20 dark:text-accent/20" },
  { slug: "general",       label: "General",      icon: "chat",    tone: "neutral", color: "bg-gray-100 text-gray-600 dark:bg-surface-input dark:text-muted" },
];

const ESTADO_COLOR: Record<string, string> = {
  pendiente:            "bg-accent/10 text-accent dark:bg-accent/40 dark:text-accent/20",
  en_proceso:           "bg-accent/10 text-accent dark:bg-accent/40 dark:text-accent/20",
  esperando_aprobacion: "bg-accent/10 text-accent dark:bg-accent/40 dark:text-accent/20",
  resuelto:             "bg-accent/10 text-accent dark:bg-accent/40 dark:text-accent/20",
  rechazado:            "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-200",
};

const ESTADO_LABEL: Record<string, string> = {
  pendiente: "Pendiente", en_proceso: "En proceso",
  esperando_aprobacion: "En revisión", resuelto: "Resuelto", rechazado: "Rechazado",
};

// ── NuevaSolicitudSheet ────────────────────────────────────────────────────────

function NuevaSolicitudSheet({
  open, onClose, token, defaultCat = "", onCreated,
}: {
  open: boolean;
  onClose: () => void;
  token: string;
  defaultCat?: string;
  onCreated: () => void;
}) {
  const [cat, setCat] = useState(defaultCat);
  const [desc, setDesc] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setCat(defaultCat);
      setDesc("");
      setDone(false);
      setErr("");
      setTimeout(() => textRef.current?.focus(), 350);
    }
  }, [open, defaultCat]);

  async function submit() {
    if (!cat) { setErr("Elige una categoría"); return; }
    if (desc.trim().length < 5) { setErr("Describe un poco más tu solicitud"); return; }
    setErr("");
    setSending(true);
    try {
      const catInfo = QUICK_CATS.find((c) => c.slug === cat);
      const titulo = desc.trim().split("\n")[0].slice(0, 80) || `${catInfo?.label ?? cat} — solicitud`;
      const fd = new FormData();
      fd.append("titulo", titulo);
      fd.append("categoria", cat);
      fd.append("descripcion", desc.trim());
      fd.append("prioridad", "media");
      await tapi("/", token, { method: "POST", body: fd });
      setDone(true);
      setTimeout(() => { onCreated(); onClose(); setDone(false); }, 1200);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Error al enviar");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-ink/30 backdrop-blur-sm transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onClick={onClose}
      />
      {/* Sheet */}
      <div
        className={`fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-3xl bg-surface-panel shadow-paper-lg transition-transform duration-300 ease-out ${open ? "translate-y-0" : "translate-y-full"}`}
        style={{ maxHeight: "88vh" }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full bg-border" />
        </div>

        <div className="overflow-y-auto px-5 pb-8 pt-2">
          {done ? (
            <div className="flex flex-col items-center gap-3 py-10">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/10 dark:bg-accent/30">
                <Icon name="check" size={32} weight="duotone" className="text-accent dark:text-accent/40" />
              </div>
              <p className="text-center font-bold text-ink">Solicitud enviada</p>
              <p className="text-center text-sm text-muted">El equipo la recibirá pronto</p>
            </div>
          ) : (
            <>
              <h2 className="mb-4 text-lg font-extrabold text-ink">Nueva solicitud</h2>

              {/* Category chips */}
              <div className="mb-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">¿De qué se trata?</p>
                <div className="flex flex-wrap gap-2">
                  {QUICK_CATS.map((c) => (
                    <button
                      key={c.slug}
                      type="button"
                      onClick={() => setCat(c.slug)}
                      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold transition-all active:scale-95 ${
                        cat === c.slug
                          ? `${c.color} ring-2 ring-accent/50`
                          : "bg-surface text-muted border border-border hover:border-accent/40"
                      }`}
                    >
                      <IllustrationIcon name={c.icon} size={22} tone={c.tone} bubble={false} />
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Description */}
              <div className="mb-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">¿Qué necesitas?</p>
                <textarea
                  ref={textRef}
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  placeholder="Ej: Necesito imprimir 50 etiquetas del lote 2025-06 para el producto Urea Cosmética…"
                  rows={4}
                  className="w-full resize-none rounded-xl border border-border bg-surface-input p-3 text-sm text-ink placeholder-muted outline-none focus:border-accent transition-colors"
                />
              </div>

              {err && (
                <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-300">
                  {err}
                </p>
              )}

              <button
                type="button"
                onClick={submit}
                disabled={sending}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-accent py-4 text-sm font-extrabold text-white shadow-[0_4px_0_rgba(2,45,51,0.25)] transition-all active:translate-y-1 active:shadow-none disabled:opacity-60"
              >
                {sending ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : "Enviar solicitud →"}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ── ActionResult ───────────────────────────────────────────────────────────────

interface ActionResult {
  ok: boolean;
  msg: string;
}

// ── HomeTab ────────────────────────────────────────────────────────────────────

function HomeTab({
  token, userName, onNewSolicitud, onSolicitudCreated, onNavigateTo,
}: {
  token: string;
  userName: string;
  onNewSolicitud: (cat?: string) => void;
  onSolicitudCreated: number;
  onNavigateTo: (p: Panel) => void;
}) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [status, setStatus] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      tapi("/?mis=1&activas=1&limit=3", token),
      fetch("/api/status", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
    ]).then(([t, s]) => {
      setTickets(Array.isArray(t?.items) ? t.items : []);
      const st: Record<string, boolean> = {};
      if (s?.meli_token_activo != null) st["MeLi"] = !!s.meli_token_activo;
      if (s?.google_sheets != null) st["Sheets"] = !!s.google_sheets;
      if (s?.siigo_ok != null) st["Siigo"] = !!s.siigo_ok;
      setStatus(st);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { load(); }, [load, onSolicitudCreated]);

  const quickActions = [
    { icon: "listChecks" as UiIconName, tone: "accent" as const, label: "Nueva\nsolicitud", cat: "", action: () => onNewSolicitud(), color: "bg-accent text-white", shadow: "shadow-[0_4px_0_rgba(2,45,51,0.3)]" },
    { icon: "chat" as UiIconName, tone: "plum" as const, label: "Chat con\nHugo", cat: "", action: () => onNavigateTo("hugo"), color: "bg-surface-panel border-2 border-border text-ink", shadow: "shadow-paper" },
    { icon: "package" as UiIconName, tone: "sky" as const, label: "Stock &\ninventario", cat: "", action: () => onNavigateTo("stock"), color: "bg-surface-panel border-2 border-border text-ink", shadow: "shadow-paper" },
    { icon: "tag" as UiIconName, tone: "plum" as const, label: "Imprimir\netiquetas", cat: "etiquetas", action: () => onNewSolicitud("etiquetas"), color: "bg-surface-panel border-2 border-border text-ink", shadow: "shadow-paper" },
  ];

  return (
    <div className="overflow-y-auto pb-24 pt-2">
      {/* Greeting */}
      <div className="px-4 pb-5">
        <p className="text-xs font-semibold text-muted">{greeting()},</p>
        <h1 className="text-2xl font-extrabold leading-tight text-ink flex items-center gap-2">
          {userName.split(" ")[0]}
          <Icon name="wave" size={22} weight="duotone" className="text-accent" />
        </h1>
      </div>

      {/* Quick action grid */}
      <div className="px-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">¿Qué necesitas hacer?</p>
        <div className="grid grid-cols-2 gap-3">
          {quickActions.map((a, i) => (
            <button
              key={i}
              type="button"
              onClick={a.action}
              className={`mck-press flex min-h-[100px] flex-col items-start justify-between rounded-2xl p-4 text-left transition-all ${a.color} ${a.shadow}`}
            >
              <IllustrationIcon name={a.icon} size={32} tone={a.tone} />
              <span className="mt-2 whitespace-pre-line text-sm font-bold leading-tight">{a.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Recent solicitudes */}
      <div className="mt-6 px-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Mis solicitudes</p>
          <button
            type="button"
            onClick={() => onNavigateTo("hugo")}
            className="text-xs font-semibold text-accent"
          >
            Ver todas →
          </button>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[1, 2].map((n) => (
              <div key={n} className="h-16 animate-pulse rounded-xl bg-surface-hover" />
            ))}
          </div>
        ) : tickets.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border py-8 text-center">
            <IllustrationIcon name="star" size={40} tone="sun" />
            <p className="text-sm font-semibold text-muted">Sin solicitudes pendientes</p>
          </div>
        ) : (
          <div className="space-y-2">
            {tickets.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onNavigateTo("hugo")}
                className="flex w-full items-center gap-3 rounded-2xl bg-surface-panel px-4 py-3 text-left shadow-paper-sm transition-all active:scale-[0.98]"
              >
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{t.titulo}</p>
                  <p className="mt-0.5 text-xs text-muted">#{t.numero} · {formatRelative(t.creado_en)}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${ESTADO_COLOR[t.estado] ?? "bg-gray-100 text-gray-600"}`}>
                  {ESTADO_LABEL[t.estado] ?? t.estado}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* System status */}
      {Object.keys(status).length > 0 && (
        <div className="mt-6 px-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Sistema</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(status).map(([key, ok]) => (
              <span
                key={key}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                  ok ? "bg-accent/5 text-accent dark:bg-accent/30 dark:text-accent/30" : "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-300"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-accent/50" : "bg-red-500"}`} />
                {key}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── ChatTab ────────────────────────────────────────────────────────────────────

const SESSION_ID = "mobile_" + Math.random().toString(36).slice(2, 8);

function ChatTab() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const mutation = usePanelChatMutation();
  const bottomRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || mutation.isPending) return;
    setInput("");
    const now = new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
    setMessages((prev) => [...prev, { role: "user", text, time: now }]);
    try {
      const res = await mutation.mutateAsync({
        mensaje: text,
        session_id: SESSION_ID,
        modelo_id: "claude-sonnet-4-6",
      });
      setMessages((prev) => [
        ...prev,
        { role: "agent", text: res.respuesta, time: new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }) },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "agent", text: "Tuve un problema procesando tu mensaje. Intenta de nuevo.", time: new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }) },
      ]);
    }
  }, [input, mutation]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="flex flex-col" style={{ height: "calc(100dvh - 128px)" }}>
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center gap-3 pt-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-2xl font-black text-white shadow-[0_4px_0_rgba(2,45,51,0.25)]">
              H
            </div>
            <p className="font-bold text-ink">Hola, soy Hugo</p>
            <p className="max-w-[220px] text-sm text-muted">Tu asesor de McKenna Group. Pregúntame lo que necesites.</p>
            <div className="mt-2 flex flex-col gap-2 w-full max-w-xs">
              {["¿Cuánto stock hay de Urea Cosmética?", "¿Qué preguntas de preventa hay pendientes?", "Genera el reporte de stock"].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => { setInput(s); textRef.current?.focus(); }}
                  className="rounded-xl border border-border bg-surface-panel px-3 py-2.5 text-left text-sm text-muted transition-all active:scale-95 hover:border-accent/40 hover:text-ink"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    m.role === "user"
                      ? "bg-accent text-white rounded-br-sm"
                      : "bg-surface-panel border border-border text-ink rounded-bl-sm shadow-paper-sm"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{m.text}</p>
                  <p className={`mt-1 text-[10px] ${m.role === "user" ? "text-white/60" : "text-muted"}`}>{m.time}</p>
                </div>
              </div>
            ))}
            {mutation.isPending && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-sm bg-surface-panel border border-border px-4 py-3 shadow-paper-sm">
                  <div className="flex gap-1">
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className="h-2 w-2 rounded-full bg-muted animate-bounce"
                        style={{ animationDelay: `${i * 0.15}s` }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-border bg-surface-panel px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={textRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder="Escribe tu mensaje…"
            rows={1}
            className="flex-1 resize-none rounded-xl border border-border bg-surface-input px-3 py-2.5 text-sm text-ink placeholder-muted outline-none focus:border-accent transition-colors"
            style={{ maxHeight: "120px" }}
            onInput={(e) => {
              const t = e.currentTarget;
              t.style.height = "auto";
              t.style.height = Math.min(t.scrollHeight, 120) + "px";
            }}
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!input.trim() || mutation.isPending}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-white shadow-[0_3px_0_rgba(2,45,51,0.25)] transition-all active:translate-y-0.5 active:shadow-none disabled:opacity-40"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2L11 13" /><path d="M22 2L15 22l-4-9-9-4 20-7z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── AccionesTab ────────────────────────────────────────────────────────────────

interface QuickAction {
  icon: UiIconName;
  tone: "sun" | "sky" | "plum" | "rose";
  label: string;
  sub: string;
  endpoint: string;
  method: "POST" | "GET";
}

const QUICK_ACTIONS: QuickAction[] = [
  { icon: "lightning", label: "Sync facturas hoy",   sub: "Últimas 24 horas",   endpoint: "/api/sync/hoy",   method: "POST", tone: "sun" },
  { icon: "chartBar",  label: "Reporte de stock",    sub: "Envía por WhatsApp", endpoint: "/api/sync/stock", method: "POST", tone: "sky" },
  { icon: "robot",     label: "Aprendizaje IA",      sub: "Q&A MeLi",           endpoint: "/api/sync/aprendizaje", method: "POST", tone: "plum" },
  { icon: "envelope",  label: "Facturas de compra",  sub: "Registrar desde Gmail", endpoint: "/api/sync/gmail", method: "POST", tone: "rose" },
];

function AccionesTab({ apiToken, user, onNavigateTo }: { apiToken: string; user: TicketsUser | null; onNavigateTo: (p: Panel) => void }) {
  const [results, setResults] = useState<Record<number, ActionResult | "loading">>({});
  const [preventa, setPreventa] = useState<number | null>(null);

  useEffect(() => {
    if (!apiToken) return;
    fetch("/api/preventa/pendientes", {
      headers: { Authorization: `Bearer ${apiToken}` },
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((d) => setPreventa(Array.isArray(d?.preguntas) ? d.preguntas.length : null))
      .catch(() => {});
  }, [apiToken]);

  async function fire(i: number, action: QuickAction) {
    setResults((p) => ({ ...p, [i]: "loading" }));
    try {
      const r = await fetch(action.endpoint, {
        method: action.method,
        headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
        cache: "no-store",
      });
      const d = await r.json().catch(() => ({}));
      setResults((p) => ({ ...p, [i]: { ok: r.ok, msg: d?.mensaje ?? d?.resultado ?? (r.ok ? "Listo" : "Error") } }));
    } catch {
      setResults((p) => ({ ...p, [i]: { ok: false, msg: "No se pudo conectar" } }));
    }
    setTimeout(() => setResults((p) => { const n = { ...p }; delete n[i]; return n; }), 5000);
  }

  return (
    <div className="overflow-y-auto pb-24 pt-4 px-4">
      <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted">Operaciones rápidas</p>

      {/* Preventa banner */}
      {preventa != null && preventa > 0 && (
        <button
          type="button"
          onClick={() => onNavigateTo("preventa")}
          className="mb-4 flex w-full items-center gap-3 rounded-2xl bg-accent/5 border border-accent/20 dark:bg-accent/20 dark:border-accent/40 px-4 py-3.5 text-left transition-all active:scale-[0.98]"
        >
          <IllustrationIcon name="question" size={28} tone="sun" />
          <div className="flex-1">
            <p className="font-bold text-accent dark:text-accent/20">{preventa} pregunta{preventa > 1 ? "s" : ""} sin responder</p>
            <p className="text-sm text-accent dark:text-accent/40">Preventa MercadoLibre · Toca para ver</p>
          </div>
          <span className="text-accent/50">→</span>
        </button>
      )}

      <div className="space-y-2.5">
        {QUICK_ACTIONS.map((a, i) => {
          const res = results[i];
          return (
            <button
              key={i}
              type="button"
              onClick={() => { if (res !== "loading") void fire(i, a); }}
              disabled={res === "loading"}
              className="mck-card mck-card-interactive mck-press flex w-full items-center gap-4 rounded-2xl px-4 py-4 text-left"
            >
              <IllustrationIcon name={a.icon} size={28} tone={a.tone} />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-ink">{a.label}</p>
                {res === "loading" ? (
                  <p className="mt-0.5 text-xs text-accent animate-pulse">Procesando…</p>
                ) : res ? (
                  <p className={`mt-0.5 text-xs font-semibold ${res.ok ? "text-accent dark:text-accent/40" : "text-red-500"}`}>
                    {res.ok ? "✓ " : "✗ "}{res.msg}
                  </p>
                ) : (
                  <p className="mt-0.5 text-xs text-muted">{a.sub}</p>
                )}
              </div>
              {res === "loading" ? (
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              ) : (
                <span className="text-muted text-sm">→</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Direct panel shortcuts */}
      <p className="mb-3 mt-6 text-xs font-semibold uppercase tracking-wider text-muted">Ir a panel</p>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {([
          { panel: "preventa" as Panel, label: "Preventa MeLi" },
          { panel: "postventa" as Panel, label: "Postventa" },
          { panel: "stock" as Panel, label: "Stock" },
          { panel: "etiquetas" as Panel, label: "Etiquetas" },
          { panel: "facturas" as Panel, label: "Facturas" },
          { panel: "sync" as Panel, label: "Sync" },
        ]).filter((s) => puedeVerSeccionPanel(user, s.panel)).map((s) => (
          <button
            key={s.panel}
            type="button"
            onClick={() => onNavigateTo(s.panel)}
            className="flex items-center gap-2.5 rounded-xl border border-border bg-surface-panel px-3 py-3 text-sm font-semibold text-ink transition-all active:scale-95 hover:border-accent/40"
          >
            <PanelIcon panel={s.panel} size={24} />
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── PerfilTab ──────────────────────────────────────────────────────────────────

function PerfilTab({ onSwitchDesktop, onNavigateTo }: { onSwitchDesktop: () => void; onNavigateTo: (p: Panel) => void }) {
  const { user, token } = useTicketsAuth();

  return (
    <div className="overflow-y-auto pb-24 pt-6 px-4">
      {/* Avatar block */}
      <div className="mb-6 flex flex-col items-center gap-3">
        {user && token ? (
          <UserAvatar user={user} token={token} size="lg" expandable />
        ) : (
          <div
            className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-white text-3xl font-black text-white shadow-lg"
            style={{ background: "#0c6069" }}
          >
            ?
          </div>
        )}
        <div className="text-center">
          <p className="font-extrabold text-ink text-lg">{user?.nombre ?? "Usuario"}</p>
          <p className="text-sm text-muted">{user?.departamento?.nombre ?? user?.rol?.nombre ?? ""}</p>
        </div>
      </div>

      {/* Menu */}
      <div className="space-y-2">
        {[
          { icon: "nut" as UiIconName, label: "Ajustes y preferencias", action: () => onNavigateTo("settings") },
          { icon: "user" as UiIconName, label: "Mi perfil", action: () => onNavigateTo("perfil") },
          { icon: "monitor" as UiIconName, label: "Cambiar a vista escritorio", action: onSwitchDesktop },
        ].map((item, i) => (
          <button
            key={i}
            type="button"
            onClick={item.action}
            className="flex w-full items-center gap-3 rounded-2xl bg-surface-panel px-4 py-4 text-left shadow-paper-sm transition-all active:scale-[0.98]"
          >
            <IllustrationIcon name={item.icon} size={24} tone="neutral" />
            <span className="flex-1 text-sm font-semibold text-ink">{item.label}</span>
            <span className="text-muted text-sm">→</span>
          </button>
        ))}

        <button
          type="button"
          onClick={() => { if (token) cerrarSesionPanel(token); }}
          className="flex w-full items-center gap-3 rounded-2xl bg-red-50 dark:bg-red-950/30 px-4 py-4 text-left transition-all active:scale-[0.98]"
        >
          <IllustrationIcon name="signOut" size={24} tone="rose" />
          <span className="flex-1 text-sm font-semibold text-red-600 dark:text-red-400">Cerrar sesión</span>
        </button>
      </div>
    </div>
  );
}

// ── BottomNav ──────────────────────────────────────────────────────────────────

const NAV_ITEMS: { id: Tab; label: string; icon: UiIconName }[] = [
  { id: "home", label: "Inicio", icon: "home" },
  { id: "chat", label: "Hugo", icon: "chat" },
  { id: "acciones", label: "Acciones", icon: "lightning" },
  { id: "yo", label: "Yo", icon: "user" },
];

function BottomNav({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-surface-panel/95 backdrop-blur-sm" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
      {NAV_ITEMS.map((item) => {
        const isActive = active === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={`mck-press flex flex-1 flex-col items-center gap-0.5 py-2.5 transition-colors ${
              isActive ? "text-accent" : "text-muted"
            }`}
          >
            <span className={`transition-transform ${isActive ? "scale-110" : ""}`}>
              <Icon name={item.icon} size={22} weight={isActive ? "bold" : "duotone"} />
            </span>
            <span className={`text-[10px] font-bold ${isActive ? "text-accent" : "text-muted"}`}>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── FAB ────────────────────────────────────────────────────────────────────────

function FAB({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mck-press fixed bottom-[72px] right-4 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white shadow-[0_6px_0_rgba(2,45,51,0.3)] transition-all active:translate-y-1.5 active:shadow-[0_2px_0_rgba(2,45,51,0.3)]"
      style={{ marginBottom: "env(safe-area-inset-bottom, 0px)" }}
      aria-label="Nueva solicitud"
    >
      <Icon name="plus" size={24} weight="bold" />
    </button>
  );
}

// ── MobileHub ──────────────────────────────────────────────────────────────────

export default function MobileHub({ onSwitchDesktop }: { onSwitchDesktop: () => void }) {
  const { user, token, apiToken } = useTicketsAuth();
  const setPanel = useAppStore((s) => s.setPanel);
  const tab = useAppStore((s) => s.mobileTab);
  const setTab = useAppStore((s) => s.setMobileTab);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetCat, setSheetCat] = useState("");
  const [solicitudCreated, setSolicitudCreated] = useState(0);

  const navigateTo = useCallback((p: Panel) => {
    setPanel(p);
    if (p === "hugo" || p === "tickets") {
      setTab("chat");
    } else {
      onSwitchDesktop();
    }
  }, [setPanel, onSwitchDesktop, setTab]);

  function openSheet(cat = "") {
    setSheetCat(cat);
    setSheetOpen(true);
  }

  if (!token) return null;

  const nombre = user?.nombre ?? "Usuario";

  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden bg-surface">
      {/* Top header */}
      <div className="flex items-center gap-3 border-b border-border bg-surface-panel px-4 py-3 shadow-paper-sm" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}>
        <div
          className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-black text-white shadow"
          style={{ background: user?.departamento?.color ?? "#0c6069" }}
        >
          {nombre.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-extrabold leading-none text-ink">McKenna Group</p>
          <p className="text-[10px] text-muted leading-none mt-0.5">{nombre}</p>
        </div>
        <div className="flex items-center gap-1">
          <div className="h-2 w-2 rounded-full bg-accent/50" />
          <span className="text-[10px] font-semibold text-muted">En línea</span>
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {tab === "home" && (
          <HomeTab
            token={token}
            userName={nombre}
            onNewSolicitud={openSheet}
            onSolicitudCreated={solicitudCreated}
            onNavigateTo={navigateTo}
          />
        )}
        {tab === "chat" && <ChatTab />}
        {tab === "acciones" && <AccionesTab apiToken={apiToken ?? token ?? ""} user={user} onNavigateTo={navigateTo} />}
        {tab === "yo" && <PerfilTab onSwitchDesktop={onSwitchDesktop} onNavigateTo={navigateTo} />}
      </div>

      {/* FAB — only on home & acciones */}
      {(tab === "home" || tab === "acciones") && (
        <FAB onClick={() => openSheet()} />
      )}

      {/* Bottom nav */}
      <BottomNav active={tab} onChange={setTab} />

      {/* Nueva Solicitud sheet */}
      <NuevaSolicitudSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        token={token}
        defaultCat={sheetCat}
        onCreated={() => setSolicitudCreated((n) => n + 1)}
      />
    </div>
  );
}

// ── Mobile detection hook ──────────────────────────────────────────────────────

export function useMobileLayout(): boolean {
  const [mobile, setMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches
  );

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const handler = (e: MediaQueryListEvent) => setMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return mobile;
}
