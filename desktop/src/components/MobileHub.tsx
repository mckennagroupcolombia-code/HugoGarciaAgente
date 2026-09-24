import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useTicketsAuth, type TicketsUser } from "../stores/ticketsAuth";
import { puedeVerSeccionPanel } from "../lib/panelAccess";
import { NAV_SECTIONS, NAV_CATEGORY_LABEL } from "../lib/navStructure";
import { itemsVisiblesHub } from "../lib/hubNav";
import { PANEL_INFO } from "../lib/panelInfo";
import { modoAvanzadoEfectivo } from "../lib/adminAccess";
import { useUiMode } from "../stores/uiMode";
import { useAppStore, type Panel, type MobileHubTab } from "../stores/app";
import { usePanelChatMutation } from "../hooks/useChat";
import { useConversaciones } from "../hooks/useConversaciones";
import InboxConversaciones from "./tickets/InboxConversaciones";
import { salirDelPanel } from "../hooks/usePanelSession";
import { IllustrationIcon } from "../icons/IllustrationIcon";
import { PanelIcon } from "../icons/PanelIcon";
import { Icon, type UiIconName } from "../icons";
import UserAvatar from "./UserAvatar";
import ThemeModeToggle from "./ThemeModeToggle";
import { useThemesDialog } from "../stores/themesDialog";

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

// ── Types ──────────────────────────────────────────────────────────────────────

type Tab = MobileHubTab;

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
  { slug: "etiquetas",     label: "Etiquetas",    icon: "tag",     tone: "plum",    color: "bg-accent/10 text-accent" },
  { slug: "inventario",    label: "Inventario",   icon: "package", tone: "sky",     color: "bg-accent/10 text-accent" },
  { slug: "ventas",        label: "Ventas MeLi",  icon: "cart",    tone: "sun",     color: "bg-accent/10 text-accent" },
  { slug: "contabilidad",  label: "Contabilidad", icon: "receipt", tone: "leaf",    color: "bg-accent/10 text-accent" },
  { slug: "mantenimiento", label: "Mantenim.",    icon: "wrench",  tone: "rose",    color: "bg-accent/10 text-accent" },
  { slug: "general",       label: "General",      icon: "chat",    tone: "neutral", color: "bg-gray-100 text-gray-600 dark:bg-surface-input dark:text-muted" },
];

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
        className={`fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-2xl border-t border-border bg-surface-panel shadow-paper-lg transition-transform duration-300 ease-out ${open ? "translate-y-0" : "translate-y-full"}`}
        style={{ maxHeight: "88vh" }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full bg-border" />
        </div>

        <div className="overflow-y-auto px-5 pb-8 pt-2">
          {done ? (
            <div className="flex flex-col items-center gap-3 py-10">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/10">
                <Icon name="check" size={32} weight="duotone" className="text-accent" />
              </div>
              <p className="text-center font-bold text-ink">Solicitud enviada</p>
              <p className="text-center text-sm text-muted">El equipo la recibirá pronto</p>
            </div>
          ) : (
            <>
              <h2 className="mck-title mb-4 text-[19px] font-bold text-ink">Nueva solicitud</h2>

              {/* Category chips */}
              <div className="mb-4">
                <p className="mb-2 mck-flujo-miga font-mono text-[10px] font-bold uppercase tracking-wider text-muted">¿De qué se trata?</p>
                <div className="flex flex-wrap gap-2">
                  {QUICK_CATS.map((c) => (
                    <button
                      key={c.slug}
                      type="button"
                      onClick={() => setCat(c.slug)}
                      className={`mck-flujo-nodo flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] font-semibold transition ${
                        cat === c.slug
                          ? "border-accent bg-accent/10 text-ink"
                          : "border-border bg-surface-input text-ink-secondary hover:border-accent/40"
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
                <p className="mb-2 mck-flujo-miga font-mono text-[10px] font-bold uppercase tracking-wider text-muted">¿Qué necesitas?</p>
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
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-3.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-60"
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
    <div className="flex h-full flex-col">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center gap-3 pt-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-2xl font-black text-white">
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
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-white transition hover:opacity-90 disabled:opacity-40"
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
  // Ya no registra: desde el 18-sep-2026 la compra se contabiliza antes de
  // pagarla, en Solicitudes de pago → Productos. Lo que sigue haciendo es bajar
  // los XML, que alimentan el perfil tributario de cada proveedor.
  { icon: "envelope",  label: "Bajar XML de facturas",  sub: "Solo descarga · el registro va en Solicitudes de pago", endpoint: "/api/sync/gmail", method: "POST", tone: "rose" },
];

function AccionesTab({ apiToken, user, onNavigateTo }: { apiToken: string; user: TicketsUser | null; onNavigateTo: (p: Panel) => void }) {
  const [results, setResults] = useState<Record<number, ActionResult | "loading">>({});
  const [preventa, setPreventa] = useState<number | null>(null);
  const advancedToggle = useUiMode((st) => st.advanced);
  const advanced = modoAvanzadoEfectivo(user, advancedToggle);

  const seccionesIrA = useMemo(
    () =>
      NAV_SECTIONS.filter((sec) => !sec.advancedOnly || advanced)
        .map((sec) => ({
          id: sec.id,
          items: itemsVisiblesHub(sec.items, user, advanced, puedeVerSeccionPanel, sec.id),
        }))
        .filter((sec) => sec.items.length > 0),
    [user, advanced],
  );

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
    <div className="h-full overflow-y-auto px-4 pb-6 pt-4">
      <p className="mb-4 mck-flujo-miga font-mono text-[10px] font-bold uppercase tracking-wider text-muted">Operaciones rápidas</p>

      {/* Preventa banner */}
      {preventa != null && preventa > 0 && (
        <button
          type="button"
          onClick={() => onNavigateTo("preventa")}
          className="mb-4 flex w-full items-center gap-3 rounded-lg border border-accent/40 bg-accent/5 px-3.5 py-3 text-left"
        >
          <IllustrationIcon name="question" size={28} tone="sun" />
          <div className="flex-1">
            <p className="font-bold text-accent">{preventa} pregunta{preventa > 1 ? "s" : ""} sin responder</p>
            <p className="text-sm text-accent">Preventa MercadoLibre · Toca para ver</p>
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
              className="mck-press flex w-full items-center gap-3 rounded-lg border border-border bg-surface-panel px-3.5 py-3 text-left hover:border-accent/40"
            >
              <IllustrationIcon name={a.icon} size={28} tone={a.tone} />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-ink">{a.label}</p>
                {res === "loading" ? (
                  <p className="mt-0.5 text-xs text-accent animate-pulse">Procesando…</p>
                ) : res ? (
                  <p className={`mt-0.5 text-xs font-semibold ${res.ok ? "text-accent" : "text-red-500"}`}>
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

      {/* Accesos a paneles — salen de NAV_SECTIONS (la misma estructura y las
          mismas reglas de permisos del menú de escritorio). Escribir aquí una
          lista a mano dejaba paneles inalcanzables desde el celular: pasó con
          Guías de envío (TKT-2026-1307), visible en escritorio e invisible aquí. */}
      {seccionesIrA.map((sec) => (
        <div key={sec.id}>
          <p className="mb-3 mt-6 mck-flujo-miga font-mono text-[10px] font-bold uppercase tracking-wider text-muted">
            {NAV_CATEGORY_LABEL[sec.id]}
          </p>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {sec.items.map((item) => (
              <button
                key={item.panel}
                type="button"
                onClick={() => onNavigateTo(item.panel)}
                className="mck-flujo-nodo flex items-center gap-2 rounded-lg border border-border bg-surface-panel px-2.5 py-2.5 text-left text-[13px] font-semibold text-ink hover:border-accent/40"
              >
                <PanelIcon panel={item.panel} size={24} />
                <span className="min-w-0 flex-1 leading-tight">
                  {PANEL_INFO[item.panel]?.label ?? item.panel}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── PerfilTab ──────────────────────────────────────────────────────────────────

function PerfilTab({
  onSwitchDesktop,
  onNavigateTo,
}: {
  onSwitchDesktop: () => void;
  onNavigateTo: (p: Panel) => void;
}) {
  const { user, token } = useTicketsAuth();
  const openTemas = useThemesDialog((s) => s.setOpen);

  return (
    <div className="h-full overflow-y-auto px-4 pb-6 pt-6">
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
          <p className="mck-title text-[19px] font-bold text-ink">{user?.nombre ?? "Usuario"}</p>
          <p className="text-sm text-muted">{user?.departamento?.nombre ?? user?.rol?.nombre ?? ""}</p>
        </div>
      </div>

      {/* Menu */}
      <div className="space-y-2">
        <ThemeModeToggle variant="sidebar" className="rounded-lg border border-border bg-surface-panel px-3.5 py-3 !text-sm !text-ink" />
        <button
          type="button"
          onClick={() => openTemas(true)}
          className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface-panel px-3.5 py-3 text-left hover:border-accent/40"
        >
          <IllustrationIcon name="palette" size={24} tone="neutral" />
          <span className="flex-1 text-sm font-semibold text-ink">Temas y estilo visual</span>
        </button>
        {[
          { icon: "nut" as UiIconName, label: "Ajustes y preferencias", action: () => onNavigateTo("settings") },
          { icon: "user" as UiIconName, label: "Mi perfil", action: () => onNavigateTo("perfil") },
          {
            icon: "monitor" as UiIconName,
            label: "Abrir todos los paneles",
            action: () => onNavigateTo("dashboard"),
          },
          { icon: "monitor" as UiIconName, label: "Forzar vista escritorio", action: onSwitchDesktop },
        ].map((item, i) => (
          <button
            key={i}
            type="button"
            onClick={item.action}
            className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface-panel px-3.5 py-3 text-left hover:border-accent/40"
          >
            <IllustrationIcon name={item.icon} size={24} tone="neutral" />
            <span className="flex-1 text-sm font-semibold text-ink">{item.label}</span>
            <span className="text-muted text-sm">→</span>
          </button>
        ))}

        <button
          type="button"
          onClick={() => { if (token) void salirDelPanel(token); }}
          className="flex w-full items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-left dark:border-red-900/60 dark:bg-red-950/30"
        >
          <IllustrationIcon name="signOut" size={24} tone="rose" />
          <span className="flex-1 text-sm font-semibold text-red-600 dark:text-red-400">Cerrar sesión</span>
        </button>
      </div>
    </div>
  );
}

// ── Barra inferior ─────────────────────────────────────────────────────────────
// La misma en el hub (Hugo · Mensajes · Rápido · Yo) y dentro del Layout (Agenda y
// cualquier panel): así el celular se navega igual en todas partes. Va EN el flujo
// de la columna, no fija: nada queda tapado debajo y no hace falta reservarle hueco.

const NAV_ITEMS: { id: Tab; label: string; icon: UiIconName }[] = [
  { id: "home", label: "Agenda", icon: "home" },
  { id: "chat", label: "Hugo", icon: "chat" },
  { id: "mensajes", label: "Mensajes", icon: "inbox" },
  { id: "acciones", label: "Rápido", icon: "lightning" },
  { id: "yo", label: "Yo", icon: "user" },
];

const TITULO_TAB: Record<Tab, string> = {
  home: "Mi agenda",
  chat: "Hugo",
  mensajes: "Mensajes",
  acciones: "Rápido",
  yo: "Yo",
};

/** Barra inferior del celular, con el «+» de nueva solicitud cuando `conNueva`. */
export function BarraMovil({
  active,
  onChange,
  conNueva = false,
}: {
  active: Tab;
  onChange: (t: Tab) => void;
  conNueva?: boolean;
}) {
  const token = useTicketsAuth((s) => s.token);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Total de no-leídos (mías, todas las conversaciones) para el aviso de Mensajes.
  const { data: conversaciones = [] } = useConversaciones("todas", "mias");
  const noLeidos = conversaciones.reduce((acc, c) => acc + c.no_leidos, 0);
  const badges: Partial<Record<Tab, number>> = { mensajes: noLeidos };

  return (
    <>
      {conNueva && (
        <div className="pointer-events-none relative z-20 h-0">
          <div className="absolute bottom-3 right-4">
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent text-white shadow-paper-lg hover:opacity-90"
              aria-label="Nueva solicitud"
              title="Nueva solicitud"
            >
              <Icon name="plus" size={22} weight="bold" />
            </button>
          </div>
        </div>
      )}
      <nav className="mck-barra-movil relative z-30 shrink-0" aria-label="Navegación del celular">
        {NAV_ITEMS.map((item) => {
          const isActive = active === item.id;
          const badge = badges[item.id] ?? 0;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              aria-current={isActive ? "page" : undefined}
              className={`mck-barra-movil-item${isActive ? " is-active" : ""}`}
            >
              <span className="relative">
                <Icon name={item.icon} size={21} weight={isActive ? "bold" : "regular"} />
                {badge > 0 && (
                  <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-accent-leaf px-1 text-[9px] font-bold text-white">
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </span>
              <span className="mck-barra-movil-label">{item.label}</span>
            </button>
          );
        })}
      </nav>
      {conNueva && token && (
        <NuevaSolicitudSheet open={sheetOpen} onClose={() => setSheetOpen(false)} token={token} onCreated={() => {}} />
      )}
    </>
  );
}

// ── MobileHub ──────────────────────────────────────────────────────────────────

export default function MobileHub({
  onSwitchDesktop,
  onOpenPanel,
  onAgenda,
}: {
  onSwitchDesktop: () => void;
  /** Abre Layout responsive (paneles completos) sin forzar modo escritorio. */
  onOpenPanel?: () => void;
  /** «Agenda» en la barra: la misma agenda de escritorio (Layout). */
  onAgenda: () => void;
}) {
  const { user, token, apiToken } = useTicketsAuth();
  const setPanel = useAppStore((s) => s.setPanel);
  const tab = useAppStore((s) => s.mobileTab);
  const setTab = useAppStore((s) => s.setMobileTab);

  const navigateTo = useCallback((p: Panel) => {
    setPanel(p);
    if (p === "hugo" || p === "tickets") {
      onAgenda();
    } else {
      onOpenPanel?.();
    }
  }, [setPanel, onOpenPanel, onAgenda]);

  if (!token) return null;

  const nombre = user?.nombre ?? "Usuario";

  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden bg-surface">
      {/* Cabezote: la misma gramática del de escritorio (miga + título con punto). */}
      <header
        className="mck-header-glass flex shrink-0 items-center gap-3 border-b border-border/80 px-3 py-2"
        style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top, 0px))" }}
      >
        <div className="min-w-0 flex-1">
          <p className="mck-flujo-miga truncate font-mono text-[10px] font-bold uppercase tracking-wider text-muted">
            McKenna · {nombre}
          </p>
          <h1 className="mck-title truncate text-[22px] font-bold leading-tight tracking-tight">{TITULO_TAB[tab]}</h1>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "chat" && <ChatTab />}
        {tab === "mensajes" && user && (
          <div className="flex h-full overflow-hidden">
            <InboxConversaciones token={token} user={user} />
          </div>
        )}
        {tab === "acciones" && <AccionesTab apiToken={apiToken ?? token ?? ""} user={user} onNavigateTo={navigateTo} />}
        {tab === "yo" && <PerfilTab onSwitchDesktop={onSwitchDesktop} onNavigateTo={navigateTo} />}
      </div>

      {/* «+» solo en Rápido: en Mensajes el botón Enviar del hilo queda en esa misma esquina. */}
      <BarraMovil
        active={tab}
        onChange={(t) => (t === "home" ? onAgenda() : setTab(t))}
        conNueva={tab === "acciones"}
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
