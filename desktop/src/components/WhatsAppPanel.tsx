import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../api/client";
import { ProseTextarea } from "./ProseTextarea";
import { useTicketsAuth } from "../stores/ticketsAuth";
import ImageLightbox from "./ImageLightbox";
import WhatsAppMetricas from "./WhatsAppMetricas";

// ── Tipos ──────────────────────────────────────────────────────────────────

interface BotConfig {
  bot_global_activo: boolean;
  horario_bot: {
    habilitado: boolean;
    hora_inicio: string;
    hora_fin: string;
    dias: number[];
  };
  activo_ahora: boolean;
}

interface NumeroInfo {
  jid: string;
  lista: "humano" | "silenciado";
  ts: number | null;
  razon: string;
  ultimo_mensaje: string;
}

interface NumerosData {
  humano: NumeroInfo[];
  silenciados: NumeroInfo[];
}

interface Evento {
  ts: number;
  tipo: string;
  sender: string;
  detalle: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatJid(jid: string): string {
  const num = jid.replace(/@(c|g|lid)\.us$/, "").replace(/@lid$/, "");
  const digits = num.replace(/\D/g, "");
  if (digits.startsWith("57") && digits.length === 12 && digits[2] === "3") {
    const local = digits.slice(2);
    return `+57 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
  }
  if (digits.length === 10 && digits.startsWith("3")) {
    return `+57 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }
  if (jid.includes("@lid")) {
    return `Contacto WA · …${digits.slice(-6)}`;
  }
  if (digits.startsWith("57") && digits.length > 12) {
    return `Contacto WA · …${digits.slice(-6)}`;
  }
  return num;
}

function etiquetaConversacion(conv: {
  jid: string;
  display?: string;
  telefono?: string | null;
}): string {
  if (conv.telefono?.trim()) return conv.telefono.trim();
  const disp = conv.display?.trim();
  if (disp && !disp.startsWith("Contacto WA")) return disp;
  return formatJid(conv.jid);
}

type RemitenteTipo = "cliente" | "bot" | "asesor" | "salida";

const REMITENTE_META: Record<
  RemitenteTipo,
  { label: string; preview: string; avatarBg: string; avatarText: string; bubbleOut: string }
> = {
  cliente: {
    label: "Cliente",
    preview: "Cliente:",
    avatarBg: "bg-slate-500/25",
    avatarText: "text-slate-300",
    bubbleOut: "",
  },
  bot: {
    label: "Bot Hugo",
    preview: "Bot:",
    avatarBg: "bg-emerald-500/25",
    avatarText: "text-emerald-300",
    bubbleOut: "bg-emerald-600/90 text-white rounded-tr-sm",
  },
  asesor: {
    label: "Asesor",
    preview: "Asesor:",
    avatarBg: "bg-blue-500/30",
    avatarText: "text-blue-200",
    bubbleOut: "bg-blue-700 text-white rounded-tr-sm ring-2 ring-blue-400/50",
  },
  salida: {
    label: "Salida",
    preview: "↑",
    avatarBg: "bg-accent/20",
    avatarText: "text-accent",
    bubbleOut: "bg-accent/80 text-white rounded-tr-sm",
  },
};

function metaRemitentePreview(rem?: string): { preview: string; color: string } {
  if (rem === "cliente") return { preview: "Cliente:", color: "text-slate-400" };
  if (rem === "bot") return { preview: "Bot:", color: "text-emerald-400" };
  if (rem === "asesor") return { preview: "Asesor:", color: "text-blue-400" };
  return { preview: "", color: "text-muted" };
}

function tiempoRelativo(ts: number | null): string {
  if (!ts) return "—";
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return "hace un momento";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`;
  return `hace ${Math.floor(diff / 86400)}d`;
}

function fechaHora(ts: number): string {
  return new Date(ts * 1000).toLocaleString("es-CO", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const TIPO_LABEL: Record<string, { label: string; color: string }> = {
  handoff_humano:       { label: "→ Humano",         color: "text-amber-400" },
  handoff_bot:          { label: "→ Bot",             color: "text-emerald-400" },
  bot_pausado_auto:     { label: "Auto-pausado",      color: "text-red-400" },
  bot_pausado_global:   { label: "Global pausado",    color: "text-orange-400" },
  silenciado_ignorado:  { label: "Silenciado",        color: "text-gray-400" },
  modo_humano:          { label: "En humano",         color: "text-blue-400" },
  manual_humano:        { label: "+ Humano (panel)",  color: "text-amber-400" },
  manual_quita_humano:  { label: "− Humano (panel)",  color: "text-emerald-400" },
  manual_silenciar:     { label: "Silenciado (panel)",color: "text-gray-400" },
  manual_activar:       { label: "Activado (panel)",  color: "text-emerald-400" },
};

// ── Tab bar ────────────────────────────────────────────────────────────────

type Tab = "chats" | "filtro" | "metricas" | "control" | "cuenta" | "numeros" | "interacciones";

interface BridgeSesion {
  conectado: boolean;
  sistema_listo: boolean;
  numero: string | null;
  pushname: string | null;
  qr_pendiente: boolean;
  qr_data_url: string | null;
  qr_generado_en: string | null;
  sesion_reseteando: boolean;
  mensaje: string;
  bridge_responde: boolean;
}

interface BridgeStatus {
  bridge_unit: string;
  bridge_estado: string;
  bridge_activo: boolean;
  sesion: BridgeSesion;
}

function TabBar({ active, onChange, noLeidos }: { active: Tab; onChange: (t: Tab) => void; noLeidos?: number }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "chats",         label: "Chats" },
    { id: "filtro",        label: "Filtro" },
    { id: "metricas",      label: "Métricas" },
    { id: "control",       label: "Control" },
    { id: "cuenta",        label: "Cuenta WA" },
    { id: "numeros",       label: "Números" },
    { id: "interacciones", label: "Actividad" },
  ];
  return (
    <div className="flex gap-1 rounded-xl border border-border bg-surface-panel p-1 mb-4">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`relative flex-1 rounded-lg py-2 text-xs font-semibold transition ${
            active === t.id
              ? "bg-accent text-white shadow-sm"
              : "text-muted hover:text-ink hover:bg-surface-hover"
          }`}
        >
          {t.label}
          {t.id === "chats" && (noLeidos ?? 0) > 0 && (
            <span className="absolute -top-1 -right-1 rounded-full bg-red-500 text-white text-[9px] font-bold w-4 h-4 flex items-center justify-center">
              {(noLeidos ?? 0) > 9 ? "9+" : noLeidos}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ── Toggle component ───────────────────────────────────────────────────────

function Toggle({
  value,
  onChange,
  disabled,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 focus:outline-none ${
        value ? "bg-accent" : "bg-surface-hover border border-border"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          value ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

// ── Tab Control ────────────────────────────────────────────────────────────

const DIAS_ISO = [
  { iso: 1, label: "Lun" },
  { iso: 2, label: "Mar" },
  { iso: 3, label: "Mié" },
  { iso: 4, label: "Jue" },
  { iso: 5, label: "Vie" },
  { iso: 6, label: "Sáb" },
  { iso: 7, label: "Dom" },
];

function TabControl() {
  const [config, setConfig] = useState<BotConfig | null>(null);
  const [draft, setDraft] = useState<BotConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get<BotConfig>("/api/bot/config").then((d) => {
      setConfig(d);
      setDraft(d);
    }).catch(() => {});
  }, []);

  async function guardar(patch: BotConfig) {
    setSaving(true);
    setSaved(false);
    try {
      const res = await api.post<{ ok: boolean; activo_ahora: boolean }>("/api/bot/config", {
        bot_global_activo: patch.bot_global_activo,
        horario_bot: patch.horario_bot,
      });
      const updated = { ...patch, activo_ahora: res.activo_ahora };
      setConfig(updated);
      setDraft(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      alert("Error al guardar la configuración");
    } finally {
      setSaving(false);
    }
  }

  function toggleGlobal() {
    if (!draft) return;
    const next = { ...draft, bot_global_activo: !draft.bot_global_activo };
    setDraft(next);
    guardar(next);
  }

  function toggleSchedule() {
    if (!draft) return;
    const next = {
      ...draft,
      horario_bot: { ...draft.horario_bot, habilitado: !draft.horario_bot.habilitado },
    };
    setDraft(next);
    guardar(next);
  }

  function toggleDia(iso: number) {
    if (!draft) return;
    const dias = draft.horario_bot.dias.includes(iso)
      ? draft.horario_bot.dias.filter((d) => d !== iso)
      : [...draft.horario_bot.dias, iso].sort((a, b) => a - b);
    setDraft((p) => (p ? { ...p, horario_bot: { ...p.horario_bot, dias } } : p));
  }

  if (!draft) {
    return <p className="text-sm text-muted py-4">Cargando configuración…</p>;
  }

  return (
    <div className="space-y-4">
      {/* Estado actual */}
      <div className={`rounded-xl border px-5 py-4 flex items-center gap-3 ${
        config?.activo_ahora
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-red-500/30 bg-red-500/5"
      }`}>
        <span className={`text-2xl ${config?.activo_ahora ? "text-emerald-400" : "text-red-400"}`}>
          {config?.activo_ahora ? "●" : "○"}
        </span>
        <div>
          <p className={`font-semibold text-sm ${config?.activo_ahora ? "text-emerald-400" : "text-red-400"}`}>
            {config?.activo_ahora ? "Agente activo ahora" : "Agente pausado ahora"}
          </p>
          <p className="text-xs text-muted mt-0.5">
            {config?.activo_ahora
              ? "Hugo García está respondiendo mensajes de WhatsApp automáticamente"
              : "No se enviará ninguna respuesta automática hasta que se reactive"}
          </p>
        </div>
        {saved && <span className="ml-auto text-xs text-emerald-400 shrink-0">✓ Guardado</span>}
      </div>

      {/* Toggle global */}
      <section className="rounded-xl border border-border bg-surface-panel p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-ink">Agente habilitado</p>
            <p className="text-xs text-muted mt-0.5">
              {draft.bot_global_activo
                ? "El agente responde automáticamente"
                : "El agente está pausado globalmente — nadie recibe respuesta automática"}
            </p>
          </div>
          <Toggle value={draft.bot_global_activo} onChange={toggleGlobal} disabled={saving} />
        </div>
      </section>

      {/* Horario */}
      <section className="rounded-xl border border-border bg-surface-panel overflow-hidden">
        <button
          type="button"
          onClick={toggleSchedule}
          disabled={saving}
          className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-surface-hover disabled:opacity-40"
        >
          <div>
            <p className="text-sm font-semibold text-ink">Horario de atención</p>
            <p className="text-xs text-muted mt-0.5">
              {draft.horario_bot.habilitado
                ? `Referencia ${draft.horario_bot.hora_inicio}–${draft.horario_bot.hora_fin} (no pausa al bot)`
                : "Sin horario — responde siempre que esté habilitado"}
            </p>
          </div>
          <Toggle value={draft.horario_bot.habilitado} onChange={() => {}} disabled={saving} />
        </button>

        {draft.horario_bot.habilitado && (
          <div className="border-t border-border px-5 pb-5 pt-4 space-y-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-muted font-medium">Hora inicio</label>
                <input
                  type="time"
                  value={draft.horario_bot.hora_inicio}
                  onChange={(e) =>
                    setDraft((p) => p ? { ...p, horario_bot: { ...p.horario_bot, hora_inicio: e.target.value } } : p)
                  }
                  className="rounded-lg border border-border bg-surface-hover px-3 py-1.5 text-sm text-ink font-mono w-32 focus:outline-none focus:border-accent"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-muted font-medium">Hora fin</label>
                <input
                  type="time"
                  value={draft.horario_bot.hora_fin}
                  onChange={(e) =>
                    setDraft((p) => p ? { ...p, horario_bot: { ...p.horario_bot, hora_fin: e.target.value } } : p)
                  }
                  className="rounded-lg border border-border bg-surface-hover px-3 py-1.5 text-sm text-ink font-mono w-32 focus:outline-none focus:border-accent"
                />
              </div>
              <button
                onClick={() => draft && guardar(draft)}
                disabled={saving}
                className="rounded-lg bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent/25 disabled:opacity-40"
              >
                {saving ? "Guardando…" : "Guardar horas"}
              </button>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] text-muted font-medium uppercase tracking-wide">Días activos</p>
              <div className="flex flex-wrap gap-2">
                {DIAS_ISO.map(({ iso, label }) => {
                  const on = draft.horario_bot.dias.includes(iso);
                  return (
                    <button
                      key={iso}
                      type="button"
                      onClick={() => toggleDia(iso)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold border transition ${
                        on
                          ? "bg-accent/15 text-accent border-accent/30"
                          : "bg-surface-hover text-muted border-border hover:border-accent/30 hover:text-ink"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => draft && guardar(draft)}
                disabled={saving}
                className="text-xs text-accent hover:underline disabled:opacity-40 pt-1 block"
              >
                {saving ? "Guardando…" : "Guardar días"}
              </button>
            </div>

            <p className="text-[11px] text-muted">Zona horaria: Colombia (UTC−5)</p>
          </div>
        )}
      </section>
    </div>
  );
}

// ── Tab Cuenta (puente Node / vincular otro número) ─────────────────────────

function formatNumeroWa(num: string | null): string {
  if (!num) return "—";
  const digits = num.replace(/\D/g, "");
  if (digits.startsWith("57") && digits.length === 12) {
    const local = digits.slice(2);
    return `+57 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
  }
  if (digits.length === 10 && digits.startsWith("3")) {
    return `+57 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }
  return `+${digits}`;
}

function BotonInfoInstrucciones({
  abierto,
  onToggle,
}: {
  abierto: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={abierto}
      aria-label={abierto ? "Ocultar instrucciones" : "Ver instrucciones"}
      className={`shrink-0 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${
        abierto
          ? "border-accent/25 bg-accent/10 text-accent"
          : "border-border/80 bg-transparent text-muted hover:border-border hover:text-ink hover:bg-surface-hover"
      }`}
    >
      Info
    </button>
  );
}

function PanelInstruccionesCuentaWa() {
  return (
    <div className="rounded-xl border border-border/70 bg-surface/40 px-4 py-3.5 text-xs text-muted space-y-3 leading-relaxed">
      <p className="text-ink/90 font-medium text-[13px]">Instrucciones — vincular otra línea</p>

      <div>
        <p className="text-[11px] uppercase tracking-wide font-semibold text-muted/90 mb-1.5">
          Qué hace esta pestaña
        </p>
        <p>
          Gestiona la cuenta de WhatsApp del puente Node (puerto 3000). Aquí puedes pasar el bot a
          otro número sin usar SSH en el servidor.
        </p>
      </div>

      <div>
        <p className="text-[11px] uppercase tracking-wide font-semibold text-muted/90 mb-1.5">
          Cambiar de número
        </p>
        <ol className="list-decimal list-inside space-y-1 pl-0.5">
          <li>Pulsa «Desvincular y vincular otro número» y confirma.</li>
          <li>Espera ~1 minuto mientras se reinicia el puente.</li>
          <li>Cuando aparezca el QR, ábrelo en esta misma pantalla.</li>
          <li>
            En el teléfono de la <span className="text-ink/80">nueva línea</span>: WhatsApp → menú
            (⋮) → Dispositivos vinculados → Vincular dispositivo → escanea el código.
          </li>
          <li>Comprueba que el número mostrado arriba sea el correcto y el estado diga «WhatsApp listo».</li>
        </ol>
      </div>

      <div>
        <p className="text-[11px] uppercase tracking-wide font-semibold text-muted/90 mb-1.5">
          Antes de escanear
        </p>
        <ul className="list-disc list-inside space-y-1 pl-0.5">
          <li>El nuevo número debe estar en los grupos operativos de la empresa (preventa, postventa, pedidos web, etc.).</li>
          <li>Solo personal autorizado debe escanear el QR (equivale a acceso completo a esa línea).</li>
          <li>Habrá 1–3 minutos sin envío ni recepción de mensajes durante el cambio.</li>
        </ul>
      </div>

      <div>
        <p className="text-[11px] uppercase tracking-wide font-semibold text-muted/90 mb-1.5">
          Si el QR no aparece
        </p>
        <ul className="list-disc list-inside space-y-1 pl-0.5">
          <li>Usa «Actualizar estado» o espera unos segundos (la vista se refresca sola).</li>
          <li>Verifica que el servicio del puente figure como <span className="text-ink/80">active</span>.</li>
          <li>En Ajustes puedes reiniciar «Puente WhatsApp (Node :3000)» si hace falta.</li>
        </ul>
      </div>
    </div>
  );
}

function TabCuentaWa() {
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [desvinculando, setDesvinculando] = useState(false);
  const [error, setError] = useState("");
  const [infoAbierto, setInfoAbierto] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cargar = useCallback(async () => {
    try {
      const d = await api.get<BridgeStatus>("/api/bot/bridge/status");
      setStatus(d);
      setError("");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "No se pudo consultar el puente";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cargar();
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(cargar, 2500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [cargar]);

  const ses = status?.sesion;
  const necesitaQr =
    ses &&
    !ses.conectado &&
    (ses.qr_pendiente || ses.qr_data_url || status?.bridge_activo);

  async function desvincular() {
    const ok = window.confirm(
      "¿Desvincular la cuenta de WhatsApp actual?\n\n" +
        "• El bot dejará de enviar/recibir unos minutos.\n" +
        "• Deberás escanear un QR con el teléfono de la nueva línea.\n" +
        "• Ese número debe estar en los grupos operativos de la empresa."
    );
    if (!ok) return;
    setDesvinculando(true);
    setError("");
    try {
      await api.post<{ mensaje?: string }>("/api/bot/bridge/desvincular", {});
      setLoading(true);
      await cargar();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al desvincular");
    } finally {
      setDesvinculando(false);
    }
  }

  if (loading && !status) {
    return <p className="text-sm text-muted py-4">Consultando puente WhatsApp…</p>;
  }

  const conectado = ses?.conectado && ses?.sistema_listo;
  const conectando = ses?.conectado && !ses?.sistema_listo;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted min-w-0">
          Cuenta vinculada al puente WhatsApp del servidor.
        </p>
        <BotonInfoInstrucciones
          abierto={infoAbierto}
          onToggle={() => setInfoAbierto((v) => !v)}
        />
      </div>
      {infoAbierto && <PanelInstruccionesCuentaWa />}

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Estado puente + sesión */}
      <div
        className={`rounded-xl border px-5 py-4 space-y-3 ${
          conectado
            ? "border-emerald-500/30 bg-emerald-500/5"
            : necesitaQr
              ? "border-amber-500/30 bg-amber-500/5"
              : "border-border bg-surface-panel"
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`text-[11px] font-semibold rounded-full px-2.5 py-0.5 border ${
              status?.bridge_activo
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                : "bg-red-500/10 text-red-400 border-red-500/20"
            }`}
          >
            Servicio {status?.bridge_estado ?? "?"}
          </span>
          {conectado && (
            <span className="text-[11px] font-semibold rounded-full px-2.5 py-0.5 border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
              ● WhatsApp listo
            </span>
          )}
          {conectando && (
            <span className="text-[11px] font-semibold rounded-full px-2.5 py-0.5 border bg-yellow-500/10 text-yellow-400 border-yellow-500/20">
              ◌ Sincronizando (~15 s)
            </span>
          )}
          {ses?.sesion_reseteando && (
            <span className="text-[11px] font-semibold rounded-full px-2.5 py-0.5 border bg-amber-500/10 text-amber-400 border-amber-500/20">
              Cambiando cuenta…
            </span>
          )}
        </div>

        <div>
          <p className="text-xs text-muted uppercase tracking-wide font-medium">Número vinculado</p>
          <p className="text-lg font-semibold text-ink font-mono mt-0.5">
            {ses?.conectado ? formatNumeroWa(ses.numero) : "Sin vincular"}
          </p>
          {ses?.pushname && (
            <p className="text-sm text-muted mt-0.5">Perfil: {ses.pushname}</p>
          )}
        </div>

        <p className="text-xs text-muted">{ses?.mensaje}</p>
      </div>

      {/* QR */}
      {necesitaQr && (
        <section className="rounded-xl border border-border bg-surface-panel p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-ink">Escanear QR</h3>
            {!infoAbierto && (
              <button
                type="button"
                onClick={() => setInfoAbierto(true)}
                className="text-[11px] text-muted hover:text-accent transition"
              >
                ¿Cómo escanear?
              </button>
            )}
          </div>
          {ses?.qr_data_url ? (
            <div className="flex flex-col items-center gap-3">
              <img
                src={ses.qr_data_url}
                alt="Código QR para vincular WhatsApp"
                className="rounded-xl border border-border bg-white p-3 max-w-[280px] w-full"
              />
              <p className="text-[11px] text-muted text-center">
                El código se actualiza solo. Esta vista se refresca cada pocos segundos.
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted py-6 justify-center">
              <span className="inline-block w-4 h-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
              Generando QR… (reinicio del puente puede tardar ~1 min)
            </div>
          )}
        </section>
      )}

      {/* Acciones */}
      <section className="rounded-xl border border-border bg-surface-panel p-5 space-y-3">
        <h3 className="text-sm font-semibold text-ink">Cambiar de número</h3>
        <button
          type="button"
          onClick={desvincular}
          disabled={desvinculando || ses?.sesion_reseteando}
          className="w-full rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm font-semibold text-amber-400 transition hover:bg-amber-500/20 disabled:opacity-40"
        >
          {desvinculando ? "Desvinculando…" : "Desvincular y vincular otro número"}
        </button>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            cargar();
          }}
          className="w-full rounded-lg border border-border bg-surface-hover px-4 py-2 text-sm text-muted hover:text-ink transition"
        >
          Actualizar estado
        </button>
      </section>
    </div>
  );
}

// ── Tab Números ────────────────────────────────────────────────────────────

function NumeroCard({
  info,
  onAction,
}: {
  info: NumeroInfo;
  onAction: (jid: string, accion: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const esHumano = info.lista === "humano";

  return (
    <div className="rounded-xl border border-border bg-surface-panel overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-ink font-mono">{formatJid(info.jid)}</p>
            <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 border ${
              esHumano
                ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                : "bg-gray-500/10 text-gray-400 border-gray-500/20"
            }`}>
              {esHumano ? "🤝 Modo humano" : "🔇 Silenciado"}
            </span>
          </div>
          <p className="text-xs text-muted mt-0.5">
            {info.razon} · {tiempoRelativo(info.ts)}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {info.ultimo_mensaje && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-xs text-muted hover:text-ink transition"
              title="Ver último mensaje"
            >
              {expanded ? "▲" : "▼"}
            </button>
          )}
          {esHumano ? (
            <button
              onClick={() => onAction(info.jid, "humano_quitar")}
              className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-400 transition hover:bg-emerald-500/20"
            >
              Reactivar bot
            </button>
          ) : (
            <button
              onClick={() => onAction(info.jid, "activar")}
              className="rounded-lg bg-accent/10 border border-accent/20 px-3 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent/20"
            >
              Activar
            </button>
          )}
        </div>
      </div>
      {expanded && info.ultimo_mensaje && (
        <div className="border-t border-border px-4 py-2 text-xs text-muted bg-surface">
          "{info.ultimo_mensaje}"
        </div>
      )}
    </div>
  );
}

function TabNumeros() {
  const [data, setData] = useState<NumerosData | null>(null);
  const [loading, setLoading] = useState(true);
  const [accionando, setAccionando] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addNumero, setAddNumero] = useState("");
  const [addTipo, setAddTipo] = useState<"humano_agregar" | "silenciar">("humano_agregar");
  const [addRazon, setAddRazon] = useState("");
  const [addError, setAddError] = useState("");

  const cargar = useCallback(async () => {
    try {
      const d = await api.get<NumerosData>("/api/bot/numeros");
      setData(d);
    } catch {
      setData({ humano: [], silenciados: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  async function ejecutarAccion(jid: string, accion: string) {
    setAccionando(true);
    try {
      await api.post("/api/bot/numeros", { numero: jid, accion, razon: "operador desde panel" });
      await cargar();
    } catch (e: any) {
      alert(e.message ?? "Error al ejecutar la acción");
    } finally {
      setAccionando(false);
    }
  }

  async function agregarNumero() {
    setAddError("");
    if (!addNumero.trim()) {
      setAddError("Ingresa un número válido");
      return;
    }
    setAccionando(true);
    try {
      await api.post("/api/bot/numeros", {
        numero: addNumero.trim(),
        accion: addTipo,
        razon: addRazon || "agregado manualmente desde panel",
      });
      setShowAddForm(false);
      setAddNumero("");
      setAddRazon("");
      await cargar();
    } catch (e: any) {
      setAddError(e.message ?? "Número no reconocido");
    } finally {
      setAccionando(false);
    }
  }

  if (loading) return <p className="text-sm text-muted py-4">Cargando números…</p>;

  const humano = data?.humano ?? [];
  const silenciados = data?.silenciados ?? [];

  return (
    <div className="space-y-5">
      {/* Botón agregar */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">
          {humano.length + silenciados.length === 0
            ? "Sin números en listas especiales"
            : `${humano.length} en modo humano · ${silenciados.length} silenciados`}
        </p>
        <button
          onClick={() => setShowAddForm((v) => !v)}
          className="rounded-lg bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent/25 flex items-center gap-1.5"
        >
          {showAddForm ? "✕ Cancelar" : "+ Agregar número"}
        </button>
      </div>

      {/* Formulario agregar */}
      {showAddForm && (
        <div className="rounded-xl border border-border bg-surface-panel p-4 space-y-3">
          <p className="text-sm font-semibold text-ink">Agregar número a lista</p>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-muted font-medium">
              Número (ej: 3001234567 o 573001234567)
            </label>
            <input
              type="tel"
              value={addNumero}
              onChange={(e) => setAddNumero(e.target.value)}
              placeholder="3001234567"
              className="rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm text-ink font-mono focus:outline-none focus:border-accent"
            />
          </div>
          <div className="flex gap-3">
            <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
              <input
                type="radio"
                name="tipo_add"
                checked={addTipo === "humano_agregar"}
                onChange={() => setAddTipo("humano_agregar")}
                className="accent-accent"
              />
              <span>Modo humano</span>
              <span className="text-xs text-muted">(reenvía al grupo)</span>
            </label>
            <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
              <input
                type="radio"
                name="tipo_add"
                checked={addTipo === "silenciar"}
                onChange={() => setAddTipo("silenciar")}
                className="accent-accent"
              />
              <span>Silenciar</span>
              <span className="text-xs text-muted">(ignorar completamente)</span>
            </label>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-muted font-medium">Razón (opcional)</label>
            <input
              type="text"
              value={addRazon}
              onChange={(e) => setAddRazon(e.target.value)}
              placeholder="ej: no es cliente, spam, número de prueba…"
              className="rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent"
            />
          </div>
          {addError && <p className="text-xs text-red-400">{addError}</p>}
          <button
            onClick={agregarNumero}
            disabled={accionando}
            className="rounded-lg bg-accent/15 px-4 py-2 text-sm font-semibold text-accent transition hover:bg-accent/25 disabled:opacity-40"
          >
            {accionando ? "Guardando…" : "Agregar"}
          </button>
        </div>
      )}

      {/* Lista modo humano */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-muted">
            Modo humano
          </h3>
          <span className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full px-2 py-0.5 font-semibold">
            {humano.length}
          </span>
          <span className="text-[10px] text-muted">— el bot guarda silencio, mensajes se reenvían al grupo</span>
        </div>
        {humano.length === 0 ? (
          <p className="text-sm text-muted pl-1">Sin números en modo humano</p>
        ) : (
          humano.map((info) => (
            <NumeroCard
              key={info.jid}
              info={info}
              onAction={(jid, accion) => !accionando && ejecutarAccion(jid, accion)}
            />
          ))
        )}
      </div>

      {/* Lista silenciados */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-muted">
            Silenciados
          </h3>
          <span className="text-[10px] bg-gray-500/10 text-gray-400 border border-gray-500/20 rounded-full px-2 py-0.5 font-semibold">
            {silenciados.length}
          </span>
          <span className="text-[10px] text-muted">— mensajes ignorados completamente (spam / no clientes)</span>
        </div>
        {silenciados.length === 0 ? (
          <p className="text-sm text-muted pl-1">Sin números silenciados</p>
        ) : (
          silenciados.map((info) => (
            <NumeroCard
              key={info.jid}
              info={info}
              onAction={(jid, accion) => !accionando && ejecutarAccion(jid, accion)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── Tab Interacciones ──────────────────────────────────────────────────────

function TabInteracciones() {
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroSender, setFiltroSender] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cargar = useCallback(async () => {
    try {
      const senderParam = filtroSender.trim()
        ? `&sender=${encodeURIComponent(filtroSender.trim())}`
        : "";
      const d = await api.get<{ eventos: Evento[] }>(
        `/api/bot/interacciones?limit=150${senderParam}`
      );
      setEventos(d.eventos ?? []);
    } catch {
      setEventos([]);
    } finally {
      setLoading(false);
    }
  }, [filtroSender]);

  useEffect(() => {
    cargar();
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(cargar, 20_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [cargar]);

  const eventosFiltrados = filtroTipo
    ? eventos.filter((e) => e.tipo === filtroTipo)
    : eventos;

  const tiposUnicos = Array.from(new Set(eventos.map((e) => e.tipo)));

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          value={filtroSender}
          onChange={(e) => setFiltroSender(e.target.value)}
          placeholder="Filtrar por número…"
          className="rounded-lg border border-border bg-surface-hover px-3 py-1.5 text-sm text-ink font-mono flex-1 min-w-40 focus:outline-none focus:border-accent"
        />
        <select
          value={filtroTipo}
          onChange={(e) => setFiltroTipo(e.target.value)}
          className="rounded-lg border border-border bg-surface-hover px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-accent"
        >
          <option value="">Todos los eventos</option>
          {tiposUnicos.map((t) => (
            <option key={t} value={t}>
              {TIPO_LABEL[t]?.label ?? t}
            </option>
          ))}
        </select>
        <button
          onClick={cargar}
          className="rounded-lg border border-border bg-surface-hover px-3 py-1.5 text-sm text-muted hover:text-ink transition"
        >
          🔄
        </button>
      </div>

      {/* Lista */}
      {loading ? (
        <p className="text-sm text-muted">Cargando eventos…</p>
      ) : eventosFiltrados.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface-panel px-5 py-8 text-center">
          <p className="text-sm text-muted">
            {filtroSender || filtroTipo
              ? "Sin eventos que coincidan con el filtro"
              : "Sin interacciones registradas aún"}
          </p>
          <p className="text-xs text-muted mt-1">
            Los eventos se registran cuando el bot procesa o ignora mensajes de WhatsApp
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {eventosFiltrados.map((ev, i) => {
            const meta = TIPO_LABEL[ev.tipo] ?? { label: ev.tipo, color: "text-muted" };
            return (
              <div
                key={i}
                className="rounded-xl border border-border bg-surface-panel px-4 py-3 flex items-start gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs font-semibold ${meta.color}`}>{meta.label}</span>
                    <span className="text-xs text-muted font-mono">{formatJid(ev.sender)}</span>
                  </div>
                  {ev.detalle && (
                    <p className="text-xs text-muted mt-0.5 line-clamp-2">{ev.detalle}</p>
                  )}
                </div>
                <span className="shrink-0 text-[11px] text-muted whitespace-nowrap">
                  {fechaHora(ev.ts)}
                </span>
              </div>
            );
          })}
          <p className="text-[11px] text-muted text-center pt-1">
            {eventosFiltrados.length} evento{eventosFiltrados.length !== 1 ? "s" : ""} (últimos 150)
          </p>
        </div>
      )}
    </div>
  );
}

// ── Tab Chats ──────────────────────────────────────────────────────────────

interface Conversacion {
  jid: string;
  display?: string;
  telefono?: string | null;
  es_lid?: boolean;
  jid_raw?: string;
  ts: number;
  texto: string | null;
  direccion: "entrada" | "salida";
  tiene_media: number;
  enviado_por: string;
  ultimo_remitente?: RemitenteTipo;
  no_leidos: number;
  modo?: "bot" | "humano" | "silenciado";
}

interface Mensaje {
  id: number;
  ts: number;
  jid: string;
  direccion: "entrada" | "salida";
  texto: string | null;
  tiene_media: number;
  nombre_arch: string;
  enviado_por: string;
  leido: number;
  media_path?: string;
  media_mime?: string;
}

function metaRemitenteMensaje(msg: Mensaje): typeof REMITENTE_META.cliente {
  if (msg.direccion === "entrada") return REMITENTE_META.cliente;
  if (msg.enviado_por === "bot") return REMITENTE_META.bot;
  if (msg.enviado_por === "humano") return REMITENTE_META.asesor;
  return REMITENTE_META.salida;
}

function modoBadge(modo: string) {
  if (modo === "humano")
    return <span className="text-[9px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-full px-1.5 py-0.5">HUMANO</span>;
  if (modo === "silenciado")
    return <span className="text-[9px] font-bold bg-gray-500/20 text-gray-400 border border-gray-500/30 rounded-full px-1.5 py-0.5">SILENCIADO</span>;
  return <span className="text-[9px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full px-1.5 py-0.5">BOT</span>;
}

function ChatBubble({ msg }: { msg: Mensaje }) {
  const esEntrada = msg.direccion === "entrada";
  const meta = metaRemitenteMensaje(msg);
  const hora = new Date(msg.ts * 1000).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaErr, setMediaErr] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const mpath = (msg.media_path || "").trim();
  const mmime = (msg.media_mime || "").toLowerCase();
  const esImagen = !!mpath && (mmime.startsWith("image/") || /\.(jpe?g|png|gif|webp)$/i.test(mpath));
  const esPdf = !!mpath && (mmime.includes("pdf") || mpath.toLowerCase().endsWith(".pdf"));

  useEffect(() => {
    if (!mpath || (!esImagen && !esPdf)) return;
    let revoke: string | null = null;
    (async () => {
      try {
        const { useTicketsAuth } = await import("../stores/ticketsAuth");
        const { useAuthStore } = await import("../stores/auth");
        const token =
          useTicketsAuth.getState().apiToken ||
          useTicketsAuth.getState().token ||
          useAuthStore.getState().token ||
          "";
        const { resolvePanelApiUrl } = await import("../api/client");
        const url = resolvePanelApiUrl(
          `/api/bot/media?path=${encodeURIComponent(mpath)}`,
          "GET",
        );
        const res = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error("media");
        const blob = await res.blob();
        revoke = URL.createObjectURL(blob);
        setMediaUrl(revoke);
        setMediaErr(false);
      } catch {
        setMediaErr(true);
      }
    })();
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [mpath, esImagen, esPdf]);

  const textoVisible =
    msg.texto && msg.texto !== "[adjunto]" ? msg.texto : null;

  const bubbleClass = esEntrada
    ? "bg-surface-hover text-ink rounded-tl-sm border border-border/60"
    : meta.bubbleOut || REMITENTE_META.salida.bubbleOut;

  return (
    <div className={`flex gap-2 ${esEntrada ? "justify-start" : "justify-end flex-row-reverse"}`}>
      <div
        className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5 ${meta.avatarBg} ${meta.avatarText}`}
        title={meta.label}
      >
        {meta.label.slice(0, 1)}
      </div>
      <div className="max-w-[76%] min-w-0">
        <p className={`text-[10px] font-semibold mb-0.5 ${esEntrada ? "text-slate-400" : meta.avatarText}`}>
          {meta.label}
        </p>
        <div className={`rounded-2xl px-3.5 py-2 text-sm leading-snug ${bubbleClass}`}>
        {esImagen && mediaUrl && (
          <>
            <img
              src={mediaUrl}
              alt={msg.nombre_arch || "Adjunto"}
              title="Clic para ampliar"
              onClick={() => setLightbox(true)}
              className="max-h-56 rounded-lg object-contain cursor-zoom-in hover:opacity-90 transition-opacity mb-1.5"
            />
            {lightbox && <ImageLightbox url={mediaUrl} onClose={() => setLightbox(false)} />}
          </>
        )}
        {esPdf && mediaUrl && (
          <a
            href={mediaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`block mb-1.5 text-[11px] underline ${esEntrada ? "text-accent" : "text-white/90"}`}
          >
            📄 {msg.nombre_arch || "Ver PDF"}
          </a>
        )}
        {msg.tiene_media && !esImagen && !esPdf && (
          <span className="italic text-[11px] opacity-70 block mb-1">
            📎 {msg.nombre_arch || "Adjunto"}
            {mediaErr && mpath ? " (no disponible en servidor)" : ""}
          </span>
        )}
        {textoVisible && (
          <p className="whitespace-pre-wrap break-words">{textoVisible}</p>
        )}
        <div className={`flex items-center gap-1 mt-0.5 ${esEntrada ? "justify-start" : "justify-end"}`}>
          <span className={`text-[10px] ${esEntrada ? "text-muted" : "text-white/60"}`}>{hora}</span>
        </div>
        </div>
      </div>
    </div>
  );
}

// ── Biblioteca de recursos rápidos ────────────────────────────────────────

interface BibliotecaItem {
  id: string;
  tipo: "texto" | "link" | "archivo";
  titulo: string;
  contenido: string;
  url: string;
  nombre_arch: string;
  mime_type: string;
  categoria: string;
  ts: number;
}

const CATEGORIAS_BLIB = ["General", "Pagos", "Envíos", "Catálogos", "Información", "Otros"];

function BibliotecaDrawer({ jid, onClose }: { jid: string; onClose: () => void }) {
  const [items, setItems]             = useState<BibliotecaItem[]>([]);
  const [cargando, setCargando]       = useState(true);
  const [enviandoId, setEnviandoId]   = useState<string | null>(null);
  const [errorId, setErrorId]         = useState<string | null>(null);
  const [modoGestion, setModoGestion] = useState(false);
  const [formTipo, setFormTipo]       = useState<"texto" | "link" | "archivo">("texto");
  const [formTitulo, setFormTitulo]   = useState("");
  const [formContenido, setFormContenido] = useState("");
  const [formUrl, setFormUrl]         = useState("");
  const [formCategoria, setFormCategoria] = useState("General");
  const [formArchivo, setFormArchivo] = useState<File | null>(null);
  const [guardando, setGuardando]     = useState(false);
  const [errorForm, setErrorForm]     = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function cargarItems() {
    setCargando(true);
    try {
      const d = await api.get<{ items: BibliotecaItem[] }>("/api/bot/biblioteca");
      setItems(d.items ?? []);
    } catch { /* silencioso */ }
    finally { setCargando(false); }
  }

  useEffect(() => { cargarItems(); }, []);

  async function enviarItem(item: BibliotecaItem) {
    setEnviandoId(item.id);
    setErrorId(null);
    try {
      await api.post(`/api/bot/chats/${encodeURIComponent(jid)}/enviar-biblioteca/${item.id}`, {});
      onClose();
    } catch (e: any) {
      setErrorId(item.id);
      setTimeout(() => setErrorId(null), 3000);
    } finally {
      setEnviandoId(null);
    }
  }

  async function eliminarItem(id: string) {
    if (!confirm("¿Eliminar este ítem de la biblioteca?")) return;
    try {
      const token = useTicketsAuth.getState().token ?? "";
      await fetch(`/api/bot/biblioteca/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      setItems((prev) => prev.filter((x) => x.id !== id));
    } catch { /* silencioso */ }
  }

  async function guardarItem() {
    setErrorForm("");
    if (!formTitulo.trim()) { setErrorForm("El título es requerido"); return; }
    setGuardando(true);
    try {
      if (formTipo === "archivo" && formArchivo) {
        const token = useTicketsAuth.getState().token ?? "";
        const fd = new FormData();
        fd.append("titulo", formTitulo.trim());
        fd.append("categoria", formCategoria);
        fd.append("archivo", formArchivo);
        const resp = await fetch("/api/bot/biblioteca", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        if (!resp.ok) {
          const j = await resp.json().catch(() => ({}));
          throw new Error(j.error || `Error ${resp.status}`);
        }
      } else if (formTipo === "link") {
        if (!formUrl.trim()) { setErrorForm("La URL es requerida"); setGuardando(false); return; }
        await api.post("/api/bot/biblioteca", { tipo: "link", titulo: formTitulo.trim(), url: formUrl.trim(), categoria: formCategoria });
      } else {
        if (!formContenido.trim()) { setErrorForm("El contenido es requerido"); setGuardando(false); return; }
        await api.post("/api/bot/biblioteca", { tipo: "texto", titulo: formTitulo.trim(), contenido: formContenido.trim(), categoria: formCategoria });
      }
      setFormTitulo(""); setFormContenido(""); setFormUrl(""); setFormArchivo(null);
      await cargarItems();
      setModoGestion(false);
    } catch (e: any) {
      setErrorForm(e.message ?? "Error al guardar");
    } finally {
      setGuardando(false);
    }
  }

  // Group items by category
  const porCategoria = CATEGORIAS_BLIB.reduce<Record<string, BibliotecaItem[]>>((acc, cat) => {
    acc[cat] = items.filter((i) => i.categoria === cat);
    return acc;
  }, {});

  function iconoTipo(tipo: string) {
    if (tipo === "link") return "🔗";
    if (tipo === "archivo") return "📎";
    return "📝";
  }

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 z-30 rounded-xl border border-border bg-surface-panel shadow-paper max-h-[420px] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border shrink-0">
        <span className="text-sm font-bold text-ink flex-1">Biblioteca</span>
        <button
          onClick={() => setModoGestion(!modoGestion)}
          className={`text-xs px-2.5 py-1 rounded-lg border transition font-semibold ${
            modoGestion
              ? "bg-accent text-white border-accent"
              : "border-border text-muted hover:text-ink hover:border-accent"
          }`}
        >
          {modoGestion ? "← Cerrar" : "+ Agregar"}
        </button>
        <button onClick={onClose} className="text-muted hover:text-ink text-lg leading-none transition">×</button>
      </div>

      {/* Formulario de gestión */}
      {modoGestion && (
        <div className="px-3 py-3 border-b border-border bg-surface shrink-0 space-y-2">
          <div className="flex gap-1">
            {(["texto", "link", "archivo"] as const).map((t) => (
              <button key={t} onClick={() => setFormTipo(t)}
                className={`flex-1 py-1 text-xs font-semibold rounded-lg border transition capitalize ${
                  formTipo === t ? "bg-accent text-white border-accent" : "border-border text-muted hover:text-ink"
                }`}
              >{t === "texto" ? "📝 Texto" : t === "link" ? "🔗 Link" : "📎 Archivo"}</button>
            ))}
          </div>
          <input
            value={formTitulo} onChange={(e) => setFormTitulo(e.target.value)}
            placeholder="Título (ej: Cuenta bancaria Bancolombia)"
            className="w-full rounded-lg border border-border bg-surface-hover px-3 py-1.5 text-xs text-ink placeholder:text-muted focus:outline-none focus:border-accent"
          />
          {formTipo === "texto" && (
            <ProseTextarea value={formContenido} onChange={(e) => setFormContenido(e.target.value)}
              placeholder="Texto completo que se enviará al cliente…"
              rows={3}
              className="w-full resize-none rounded-lg border border-border bg-surface-hover px-3 py-1.5 text-xs text-ink placeholder:text-muted focus:outline-none focus:border-accent"
            />
          )}
          {formTipo === "link" && (
            <input value={formUrl} onChange={(e) => setFormUrl(e.target.value)}
              placeholder="https://…"
              className="w-full rounded-lg border border-border bg-surface-hover px-3 py-1.5 text-xs text-ink placeholder:text-muted focus:outline-none focus:border-accent"
            />
          )}
          {formTipo === "archivo" && (
            <div>
              <input ref={fileInputRef} type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.zip"
                onChange={(e) => setFormArchivo(e.target.files?.[0] ?? null)}
                className="hidden"
              />
              <button onClick={() => fileInputRef.current?.click()}
                className="w-full rounded-lg border border-dashed border-border bg-surface-hover px-3 py-2 text-xs text-muted hover:text-ink hover:border-accent transition text-center"
              >
                {formArchivo ? `📎 ${formArchivo.name}` : "Elegir archivo (PDF, imagen, etc.)"}
              </button>
            </div>
          )}
          <select value={formCategoria} onChange={(e) => setFormCategoria(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface-hover px-3 py-1.5 text-xs text-ink focus:outline-none focus:border-accent"
          >
            {CATEGORIAS_BLIB.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          {errorForm && <p className="text-xs text-red-400">{errorForm}</p>}
          <button onClick={guardarItem} disabled={guardando}
            className="w-full rounded-lg bg-accent py-1.5 text-xs font-semibold text-white transition hover:bg-accent/90 disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Guardar en biblioteca"}
          </button>
        </div>
      )}

      {/* Lista de ítems */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        {cargando ? (
          <p className="text-xs text-muted text-center py-4">Cargando…</p>
        ) : items.length === 0 ? (
          <p className="text-xs text-muted text-center py-4">
            La biblioteca está vacía. Usa el botón <strong>+ Agregar</strong> para guardar textos, links o archivos de acceso rápido.
          </p>
        ) : (
          CATEGORIAS_BLIB.filter((cat) => porCategoria[cat].length > 0).map((cat) => (
            <div key={cat}>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted mb-1">{cat}</p>
              <div className="space-y-1">
                {porCategoria[cat].map((item) => (
                  <div key={item.id} className="flex items-start gap-2 rounded-lg bg-surface hover:bg-surface-hover px-2.5 py-2 transition group">
                    <span className="text-sm shrink-0 mt-0.5">{iconoTipo(item.tipo)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-ink truncate">{item.titulo}</p>
                      {item.tipo === "texto" && (
                        <p className="text-[11px] text-muted truncate">{item.contenido}</p>
                      )}
                      {item.tipo === "link" && (
                        <p className="text-[11px] text-muted truncate">{item.url}</p>
                      )}
                      {item.tipo === "archivo" && (
                        <p className="text-[11px] text-muted truncate">{item.nombre_arch}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {modoGestion ? (
                        <button onClick={() => eliminarItem(item.id)}
                          className="text-[11px] font-semibold text-red-400 hover:text-red-500 transition px-1"
                        >Eliminar</button>
                      ) : (
                        <button
                          onClick={() => enviarItem(item)}
                          disabled={enviandoId === item.id}
                          className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                            errorId === item.id
                              ? "bg-red-500/10 text-red-400 border border-red-500/20"
                              : "bg-accent/10 text-accent border border-accent/20 hover:bg-accent hover:text-white"
                          }`}
                        >
                          {enviandoId === item.id ? "…" : errorId === item.id ? "Error" : "Enviar"}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function TabChats() {
  const [conversaciones, setConversaciones] = useState<Conversacion[]>([]);
  const [noLeidos, setNoLeidos]             = useState(0);
  const [jidActivo, setJidActivo]           = useState<string | null>(null);
  const [mensajes, setMensajes]             = useState<Mensaje[]>([]);
  const [modoActivo, setModoActivo]         = useState<string>("bot");
  const [texto, setTexto]                   = useState("");
  const [enviando, setEnviando]             = useState(false);
  const [errorEnvio, setErrorEnvio]         = useState("");
  const [vistaMovil, setVistaMovil]         = useState<"lista" | "chat">("lista");
  const [bibliotecaAbierta, setBibliotecaAbierta] = useState(false);
  const [cambiandoModo, setCambiandoModo] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [displayActivo, setDisplayActivo] = useState("");
  const [telefonoActivo, setTelefonoActivo] = useState<string | null>(null);
  const [esLidActivo, setEsLidActivo] = useState(false);
  const [filtroRemitente, setFiltroRemitente] = useState<"todos" | "cliente" | "bot" | "asesor">("todos");
  const bottomRef  = useRef<HTMLDivElement>(null);
  const pollMsgRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollLstRef = useRef<ReturnType<typeof setInterval> | null>(null);


  // ── Cargar lista de conversaciones ────────────────────────────────────────
  const cargarLista = useCallback(async () => {
    try {
      const d = await api.get<{ conversaciones: Conversacion[]; no_leidos_total: number }>("/api/bot/chats");
      setConversaciones(d.conversaciones ?? []);
      setNoLeidos(d.no_leidos_total ?? 0);
    } catch { /* silencioso */ }
  }, []);

  // ── Cargar mensajes de la conversación activa ─────────────────────────────
  const cargarMensajes = useCallback(async (jid: string) => {
    try {
      const d = await api.get<{
        mensajes: Mensaje[];
        modo: string;
        display?: string;
        telefono?: string | null;
        es_lid?: boolean;
      }>(
        `/api/bot/chats/${encodeURIComponent(jid)}?limit=250`,
      );
      setMensajes(d.mensajes ?? []);
      setModoActivo(d.modo ?? "bot");
      setTelefonoActivo(d.telefono ?? null);
      setEsLidActivo(!!d.es_lid);
      setDisplayActivo(d.telefono?.trim() || d.display?.trim() || formatJid(jid));
    } catch { /* silencioso */ }
  }, []);

  const sincronizarRecientes = useCallback(async () => {
    try {
      await api.post("/api/bot/chats/sincronizar-recientes", { max_chats: 12, limit: 45 });
      await cargarLista();
      if (jidActivo) await cargarMensajes(jidActivo);
    } catch { /* silencioso */ }
  }, [cargarLista, cargarMensajes, jidActivo]);

  useEffect(() => {
    cargarLista();
    void sincronizarRecientes();
    pollLstRef.current = setInterval(cargarLista, 4_000);
    const syncRec = setInterval(() => void sincronizarRecientes(), 20_000);
    return () => {
      if (pollLstRef.current) clearInterval(pollLstRef.current);
      clearInterval(syncRec);
    };
  }, [cargarLista, sincronizarRecientes]);

  const sincronizarDesdeWa = useCallback(async (jid: string, silencioso = false) => {
    if (!silencioso) setSincronizando(true);
    try {
      await api.post(`/api/bot/chats/${encodeURIComponent(jid)}/sincronizar`, { limit: 80 });
      await cargarMensajes(jid);
      await cargarLista();
    } catch (e: any) {
      if (!silencioso) {
        alert(e.message ?? "No se pudo sincronizar con WhatsApp");
      }
    } finally {
      if (!silencioso) setSincronizando(false);
    }
  }, [cargarMensajes, cargarLista]);

  useEffect(() => {
    if (!jidActivo) return;
    void sincronizarDesdeWa(jidActivo, true);
    cargarMensajes(jidActivo);
    if (pollMsgRef.current) clearInterval(pollMsgRef.current);
    pollMsgRef.current = setInterval(() => cargarMensajes(jidActivo), 2_000);
    const syncWa = setInterval(() => void sincronizarDesdeWa(jidActivo, true), 12_000);
    return () => {
      if (pollMsgRef.current) clearInterval(pollMsgRef.current);
      clearInterval(syncWa);
    };
  }, [jidActivo, cargarMensajes, sincronizarDesdeWa]);

  // Scroll al fondo cuando llegan nuevos mensajes
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensajes.length]);

  function abrirChat(conv: Conversacion) {
    setJidActivo(conv.jid);
    setTelefonoActivo(conv.telefono ?? null);
    setEsLidActivo(!!conv.es_lid);
    setDisplayActivo(etiquetaConversacion(conv));
    setFiltroRemitente("todos");
    setTexto("");
    setErrorEnvio("");
    setVistaMovil("chat");
  }

  const conteosRemitente = {
    cliente: mensajes.filter((m) => m.direccion === "entrada").length,
    bot: mensajes.filter((m) => m.direccion === "salida" && m.enviado_por === "bot").length,
    asesor: mensajes.filter((m) => m.direccion === "salida" && m.enviado_por === "humano").length,
  };

  const mensajesVisibles = mensajes.filter((m) => {
    if (filtroRemitente === "todos") return true;
    if (filtroRemitente === "cliente") return m.direccion === "entrada";
    if (filtroRemitente === "bot") return m.direccion === "salida" && m.enviado_por === "bot";
    return m.direccion === "salida" && m.enviado_por === "humano";
  });

  function volverALista() {
    setJidActivo(null);
    setVistaMovil("lista");
  }

  async function enviarMensaje() {
    if (!jidActivo || !texto.trim() || enviando) return;
    setEnviando(true);
    setErrorEnvio("");
    try {
      await api.post(`/api/bot/chats/${encodeURIComponent(jidActivo)}/enviar`, { texto: texto.trim() });
      setTexto("");
      await cargarMensajes(jidActivo);
      await cargarLista();
    } catch (e: any) {
      setErrorEnvio(e.message ?? "Error al enviar");
    } finally {
      setEnviando(false);
    }
  }

  async function cambiarModo(accion: string) {
    if (!jidActivo || cambiandoModo) return;
    setCambiandoModo(true);
    try {
      await api.post("/api/bot/numeros", {
        numero: jidActivo,
        accion,
        razon: "operador desde panel de chats",
      });
      await cargarMensajes(jidActivo);
      await cargarLista();
    } catch (e: any) {
      alert(e.message ?? "Error al cambiar modo");
    } finally {
      setCambiandoModo(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-[calc(100vh-160px)] min-h-[500px] gap-0 rounded-xl border border-border overflow-hidden">

      {/* ── Lista de conversaciones ── */}
      <div className={`${vistaMovil === "chat" ? "hidden md:flex" : "flex"} w-full md:w-64 lg:w-72 shrink-0 flex-col border-r border-border bg-surface-panel`}>
        <div className="px-3 py-2.5 border-b border-border flex items-center justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-muted">
            Conversaciones {noLeidos > 0 && <span className="text-red-400">({noLeidos} sin leer)</span>}
          </p>
          <button
            type="button"
            onClick={() => void sincronizarRecientes()}
            className="text-[10px] font-semibold text-accent hover:underline shrink-0"
            title="Traer respuestas recientes desde WhatsApp (incluye celular del operador)"
          >
            ↻ Sync
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversaciones.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-muted">Sin conversaciones aún</p>
              <p className="text-xs text-muted mt-1">Los mensajes aparecerán aquí cuando los clientes escriban</p>
            </div>
          ) : (
            conversaciones.map((conv) => {
              const previewMeta = metaRemitentePreview(conv.ultimo_remitente);
              const previewTexto =
                conv.tiene_media && !conv.texto ? "📎 Adjunto" : (conv.texto ?? "—");
              return (
              <button
                key={conv.jid}
                onClick={() => abrirChat(conv)}
                className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left border-b border-border/50 transition hover:bg-surface-hover ${
                  jidActivo === conv.jid ? "bg-surface-hover border-l-2 border-l-accent" : ""
                }`}
              >
                {/* Avatar */}
                <div className="shrink-0 w-9 h-9 rounded-full bg-accent/20 text-accent flex items-center justify-center text-sm font-bold">
                  {etiquetaConversacion(conv).replace(/\D/g, "").slice(-2) || etiquetaConversacion(conv).slice(0, 1)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-xs font-semibold text-ink truncate">{etiquetaConversacion(conv)}</span>
                    {conv.es_lid && !conv.telefono && (
                      <span className="text-[8px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/25 rounded px-1">LID</span>
                    )}
                    {modoBadge(conv.modo ?? "bot")}
                  </div>
                  <p className="text-[11px] text-muted truncate mt-0.5">
                    {previewMeta.preview && (
                      <span className={`font-semibold ${previewMeta.color}`}>{previewMeta.preview} </span>
                    )}
                    {previewTexto}
                  </p>
                  <p className="text-[10px] text-muted mt-0.5">{tiempoRelativo(conv.ts)}</p>
                </div>
                {conv.no_leidos > 0 && (
                  <span className="shrink-0 rounded-full bg-red-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] flex items-center justify-center px-1">
                    {conv.no_leidos > 9 ? "9+" : conv.no_leidos}
                  </span>
                )}
              </button>
            );
            })
          )}
        </div>
      </div>

      {/* ── Ventana de chat ── */}
      <div className={`${vistaMovil === "lista" && !jidActivo ? "hidden md:flex" : "flex"} flex-1 flex-col bg-surface min-w-0`}>
        {!jidActivo ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center px-8">
              <p className="text-3xl mb-3">💬</p>
              <p className="text-sm font-semibold text-ink">Selecciona una conversación</p>
              <p className="text-xs text-muted mt-1">Los mensajes de clientes aparecen en la lista de la izquierda</p>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-surface-panel shrink-0">
              <button onClick={volverALista} className="md:hidden text-muted hover:text-ink transition text-lg leading-none">‹</button>
              <div className="w-8 h-8 rounded-full bg-accent/20 text-accent flex items-center justify-center text-sm font-bold shrink-0">
                {(telefonoActivo || displayActivo || formatJid(jidActivo)).replace(/\D/g, "").slice(-2) || "?"}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink truncate">
                  {telefonoActivo || displayActivo || formatJid(jidActivo)}
                </p>
                {esLidActivo && !telefonoActivo && (
                  <p className="text-[10px] text-amber-400">
                    Teléfono no resuelto — pulsa ↻ Actualizar tras un mensaje del cliente
                  </p>
                )}
                {jidActivo.includes("@lid") && (
                  <p className="text-[10px] text-muted font-mono truncate" title={jidActivo}>
                    ID interno: …{jidActivo.split("@")[0].slice(-8)}
                  </p>
                )}
                <div className="flex items-center gap-1.5 mt-0.5">{modoBadge(modoActivo)}</div>
              </div>
              {/* Acciones rápidas de modo */}
              <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                <button
                  type="button"
                  onClick={() => jidActivo && sincronizarDesdeWa(jidActivo)}
                  disabled={sincronizando}
                  title="Traer mensajes recientes desde WhatsApp (incluye los enviados desde el celular)"
                  className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-semibold text-muted transition hover:text-ink hover:border-accent disabled:opacity-40"
                >
                  {sincronizando ? "Sincronizando…" : "↻ Actualizar"}
                </button>
                {modoActivo === "bot" ? (
                  <button
                    onClick={() => cambiarModo("humano_agregar")}
                    disabled={cambiandoModo}
                    className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 text-[11px] font-semibold text-amber-400 transition hover:bg-amber-500/20 disabled:opacity-40"
                  >
                    {cambiandoModo ? "Aplicando…" : "Tomar conversación"}
                  </button>
                ) : modoActivo === "humano" ? (
                  <button
                    onClick={() => cambiarModo("humano_quitar")}
                    disabled={cambiandoModo}
                    className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-[11px] font-semibold text-emerald-400 transition hover:bg-emerald-500/20 disabled:opacity-40"
                  >
                    {cambiandoModo ? "Aplicando…" : "Devolver al bot"}
                  </button>
                ) : null}
              </div>
            </div>

            {/* Filtro por remitente */}
            <div className="shrink-0 px-4 py-2 border-b border-border bg-surface-panel flex flex-wrap items-center gap-1.5">
              {([
                ["todos", "Todos", mensajes.length],
                ["cliente", "Cliente", conteosRemitente.cliente],
                ["asesor", "Asesor", conteosRemitente.asesor],
                ["bot", "Bot", conteosRemitente.bot],
              ] as const).map(([id, label, n]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFiltroRemitente(id)}
                  className={`rounded-full px-2.5 py-1 text-[10px] font-semibold transition ${
                    filtroRemitente === id
                      ? id === "asesor"
                        ? "bg-blue-600 text-white"
                        : id === "bot"
                          ? "bg-emerald-600 text-white"
                          : id === "cliente"
                            ? "bg-slate-600 text-white"
                            : "bg-accent text-white"
                      : "bg-surface-hover text-muted hover:text-ink border border-border"
                  }`}
                >
                  {label} ({n})
                </button>
              ))}
            </div>

            {/* Mensajes */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {mensajesVisibles.length === 0 ? (
                <p className="text-sm text-muted text-center py-8">
                  {mensajes.length === 0
                    ? "Sin mensajes registrados en esta conversación"
                    : "Ningún mensaje con este filtro — prueba otro o pulsa ↻ Actualizar"}
                </p>
              ) : (
                mensajesVisibles.map((msg) => <ChatBubble key={msg.id} msg={msg} />)
              )}
              <div ref={bottomRef} />
            </div>

            {/* Aviso si bot activo */}
            {modoActivo === "bot" && (
              <div className="shrink-0 px-4 py-2 border-t border-border bg-amber-500/5 border-amber-500/20">
                <p className="text-[11px] text-amber-400 text-center">
                  ⚠️ El bot está activo para este número. Si envías, el cliente recibirá tu mensaje <em>y</em> posiblemente también una respuesta del bot. Pulsa <strong>Tomar conversación</strong> para silenciar el bot primero.
                </p>
              </div>
            )}

            {/* Input de envío */}
            <div className="shrink-0 border-t border-border bg-surface-panel px-3 py-3">
              <div className="relative flex items-end gap-2">
                {/* Biblioteca drawer */}
                {bibliotecaAbierta && jidActivo && (
                  <BibliotecaDrawer jid={jidActivo} onClose={() => setBibliotecaAbierta(false)} />
                )}
                {/* Botón adjuntos / biblioteca */}
                <button
                  onClick={() => setBibliotecaAbierta((v) => !v)}
                  title="Biblioteca de recursos"
                  className={`shrink-0 rounded-xl border px-3 py-2.5 text-lg transition self-end ${
                    bibliotecaAbierta
                      ? "bg-accent text-white border-accent"
                      : "border-border text-muted hover:text-ink hover:border-accent bg-surface-hover"
                  }`}
                >
                  📎
                </button>
                <ProseTextarea
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviarMensaje(); }
                  }}
                  placeholder="Escribe un mensaje… (Enter para enviar, Shift+Enter para nueva línea)"
                  rows={2}
                  className="flex-1 resize-none rounded-xl border border-border bg-surface-hover px-3 py-2.5 text-sm text-ink placeholder:text-muted focus:outline-none focus:border-accent"
                />
                <button
                  onClick={enviarMensaje}
                  disabled={!texto.trim() || enviando}
                  className="shrink-0 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-accent/90 disabled:opacity-40 self-end"
                >
                  {enviando ? "…" : "Enviar"}
                </button>
              </div>
              {errorEnvio && <p className="text-xs text-red-400 mt-1">{errorEnvio}</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Tab Filtro de Respuesta ────────────────────────────────────────────────

function TabFiltroRespuesta() {
  const [texto, setTexto] = useState("");
  const [resultado, setResultado] = useState("");
  const [loading, setLoading] = useState(false);
  const [copiado, setCopiado] = useState(false);

  async function mejorar() {
    if (!texto.trim() || loading) return;
    setLoading(true);
    setResultado("");
    try {
      const r = await api.post<{ texto_mejorado: string }>("/api/filtro-respuesta", { texto });
      setResultado(r.texto_mejorado);
    } catch (e: any) {
      setResultado(`Error: ${e.message ?? "No se pudo procesar"}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-3 pt-2">
      <ProseTextarea
        value={texto}
        onChange={(e) => { setTexto(e.target.value); setResultado(""); }}
        onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) mejorar(); }}
        placeholder="Tu respuesta al cliente…"
        rows={4}
        className="w-full resize-none rounded-xl border border-border bg-surface-hover px-4 py-3 text-sm text-ink placeholder:text-muted focus:outline-none focus:border-accent"
      />
      <button
        type="button"
        onClick={mejorar}
        disabled={!texto.trim() || loading}
        className="w-full rounded-xl bg-accent py-2.5 text-sm font-semibold text-white transition hover:bg-accent/90 disabled:opacity-40 flex items-center justify-center gap-2"
      >
        {loading && <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />}
        {loading ? "Mejorando…" : "Mejorar respuesta"}
      </button>

      {resultado && (
        <div className="rounded-xl border border-border bg-surface-panel p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold text-muted uppercase tracking-wide">Versión mejorada</p>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(resultado).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 2000); })}
              className={`text-xs font-semibold px-2.5 py-1 rounded-lg border transition ${copiado ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-border text-muted hover:text-ink"}`}
            >
              {copiado ? "✓ Copiado" : "Copiar"}
            </button>
          </div>
          <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap">{resultado}</p>
        </div>
      )}
    </div>
  );
}

// ── Panel principal ────────────────────────────────────────────────────────

export default function WhatsAppPanel() {
  const [tab, setTab] = useState<Tab>("chats");
  const [noLeidos, setNoLeidos] = useState(0);
  const wide = tab === "chats" || tab === "metricas";

  // Polling ligero del contador de no leídos para el badge del TabBar
  useEffect(() => {
    async function fetchUnread() {
      try {
        const d = await api.get<{ no_leidos_total: number }>("/api/bot/chats");
        setNoLeidos(d.no_leidos_total ?? 0);
      } catch { /* silencioso */ }
    }
    fetchUnread();
    const t = setInterval(fetchUnread, 5_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className={wide ? "mx-auto max-w-5xl" : "mx-auto max-w-2xl"}>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-ink">Agente WhatsApp</h2>
        <p className="text-xs text-muted mt-0.5">
          Chat con clientes, métricas de atención, control del bot y gestión de números
        </p>
      </div>

      <TabBar active={tab} onChange={setTab} noLeidos={noLeidos} />

      {tab === "chats"         && <TabChats />}
      {tab === "filtro"        && <TabFiltroRespuesta />}
      {tab === "metricas"      && <WhatsAppMetricas />}
      {tab === "control"       && <TabControl />}
      {tab === "cuenta"        && <TabCuentaWa />}
      {tab === "numeros"       && <TabNumeros />}
      {tab === "interacciones" && <TabInteracciones />}
    </div>
  );
}
