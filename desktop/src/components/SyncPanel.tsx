import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../api/client";
import TerminalLog from "./TerminalLog";
import PanelHelp from "./PanelHelp";
import { useAppStore } from "../stores/app";

interface ActionDef {
  id: string;
  label: string;
  description: string;
  endpoint: string;
  needsInput?: "pack_id" | "fecha" | "nombre";
  inputPlaceholder?: string;
  icon: string;
}

interface ScheduleJob {
  id: string;
  label: string;
  description: string;
  cadence: string;
  automated: boolean;
}

interface ScheduleStatus {
  enabled: boolean;
  daily_hour: number;
  deep_interval_days: number;
  deep_lookback_days: number;
  jobs: ScheduleJob[];
  last_daily_run: string | null;
  last_deep_run: string | null;
  next_daily_run: string;
  next_deep_run: string;
  history: { kind: string; at: string; ok: boolean; detail?: string }[];
}

/** Acciones que corren solas — solo override manual bajo demanda. */
const AUTOMATED_ACTION_IDS = new Set(["hoy", "10dias", "inteligente", "completo", "stock"]);

const MANUAL_ACTIONS: ActionDef[] = [
  {
    id: "aprendizaje",
    label: "Aprendizaje IA",
    description: "Analizar interacciones MeLi",
    endpoint: "/api/sync/aprendizaje",
    icon: "🤖",
  },
  {
    id: "skus-meli",
    label: "Sincronizar SKUs",
    description: "Actualizar SKUs MeLi → Google Sheets",
    endpoint: "/api/sync/skus-meli",
    icon: "🏷️",
  },
  {
    id: "reporte-skus",
    label: "Reporte SKUs Pendientes",
    description: "Enviar lista sin combo al grupo Inventario",
    endpoint: "/api/sync/reporte-skus-pendientes",
    icon: "📋",
  },
  {
    id: "pack",
    label: "Sync por Pack",
    description: "Sincronizar un Pack ID específico",
    endpoint: "/api/sync/pack",
    needsInput: "pack_id",
    inputPlaceholder: "Pack ID",
    icon: "📋",
  },
  {
    id: "fecha",
    label: "Sync por Fecha",
    description: "Sincronizar facturas de un día",
    endpoint: "/api/sync/fecha",
    needsInput: "fecha",
    inputPlaceholder: "AAAA-MM-DD",
    icon: "📆",
  },
  {
    id: "producto",
    label: "Consultar Producto",
    description: "Buscar en Google Sheets",
    endpoint: "/api/consultar/producto",
    needsInput: "nombre",
    inputPlaceholder: "Nombre del producto",
    icon: "🔍",
  },
];

const OVERRIDE_ACTIONS: ActionDef[] = [
  {
    id: "hoy",
    label: "Sync Hoy",
    description: "Facturas MeLi del último día",
    endpoint: "/api/sync/hoy",
    icon: "📅",
  },
  {
    id: "10dias",
    label: "Sync Profunda (10 días)",
    description: "Facturas de los últimos 10 días",
    endpoint: "/api/sync/10dias",
    icon: "🗓️",
  },
  {
    id: "inteligente",
    label: "Sync Inteligente",
    description: "Cruce MeLi vs Siigo",
    endpoint: "/api/sync/inteligente",
    icon: "🔄",
  },
  {
    id: "completo",
    label: "Sync Completo",
    description: "Sync + reporte de stock",
    endpoint: "/api/sync/completo",
    icon: "📦",
  },
  {
    id: "stock",
    label: "Reporte Stock",
    description: "Generar reporte por WhatsApp",
    endpoint: "/api/sync/stock",
    icon: "📊",
  },
];

function fmtWhen(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-CO", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function AutomatedScheduleCard({
  schedule,
  expanded,
  onToggle,
}: {
  schedule: ScheduleStatus | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  const hour = schedule?.daily_hour ?? 5;
  const deepDays = schedule?.deep_interval_days ?? 30;

  return (
    <div className="rounded-xl border-2 border-emerald-500/40 bg-emerald-50/60 dark:bg-emerald-950/25 dark:border-emerald-600/40 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              Automatizado
            </span>
            <p className="text-sm font-bold text-emerald-900 dark:text-emerald-100">
              Sincronizaciones programadas
            </p>
          </div>
          <p className="mt-1 text-xs text-emerald-800/80 dark:text-emerald-200/80 leading-snug">
            Cada día a las {hour}:00 se ejecutan sync diaria, inteligente y completo con reporte
            de stock. La sync profunda (10 días) corre cada {deepDays} días.
          </p>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="shrink-0 rounded-lg border border-emerald-600/50 bg-white/80 dark:bg-emerald-900/40 px-3 py-1.5 text-xs font-semibold text-emerald-800 dark:text-emerald-100 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition"
        >
          {expanded ? "Ocultar detalle" : "Ver programación"}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg border border-emerald-200/80 dark:border-emerald-800/60 bg-white/70 dark:bg-black/20 px-3 py-2">
          <p className="font-semibold text-emerald-900 dark:text-emerald-100">Próximo lote diario</p>
          <p className="text-emerald-700 dark:text-emerald-300 tabular-nums">
            {fmtWhen(schedule?.next_daily_run ?? null)}
          </p>
          {schedule?.last_daily_run && (
            <p className="text-[10px] text-muted mt-0.5">
              Último: {fmtWhen(schedule.last_daily_run)}
            </p>
          )}
        </div>
        <div className="rounded-lg border border-emerald-200/80 dark:border-emerald-800/60 bg-white/70 dark:bg-black/20 px-3 py-2">
          <p className="font-semibold text-emerald-900 dark:text-emerald-100">Próxima sync profunda</p>
          <p className="text-emerald-700 dark:text-emerald-300 tabular-nums">
            {fmtWhen(schedule?.next_deep_run ?? null)}
          </p>
          {schedule?.last_deep_run && (
            <p className="text-[10px] text-muted mt-0.5">
              Último: {fmtWhen(schedule.last_deep_run)}
            </p>
          )}
        </div>
      </div>

      {expanded && schedule && (
        <div className="space-y-2 pt-1 border-t border-emerald-200/60 dark:border-emerald-800/50">
          {schedule.jobs.map((job) => (
            <div
              key={job.id}
              className="flex items-start gap-2 rounded-lg bg-white/50 dark:bg-black/15 px-3 py-2"
            >
              <span className="text-emerald-600 dark:text-emerald-400 mt-0.5">✓</span>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-ink">{job.label}</p>
                <p className="text-[11px] text-muted">{job.description}</p>
                <p className="text-[10px] text-emerald-700 dark:text-emerald-400 font-medium">
                  {job.cadence}
                </p>
              </div>
            </div>
          ))}
          {schedule.history.length > 0 && (
            <div className="mt-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted mb-1">
                Ejecuciones recientes
              </p>
              <ul className="space-y-1 max-h-28 overflow-y-auto">
                {schedule.history.slice(0, 5).map((h, i) => (
                  <li key={i} className="text-[10px] text-muted flex gap-2">
                    <span>{h.ok ? "✔" : "✖"}</span>
                    <span className="tabular-nums shrink-0">{fmtWhen(h.at)}</span>
                    <span className="truncate">{h.kind}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ActionButton({
  action,
  isActive,
  onRun,
  compact,
}: {
  action: ActionDef;
  isActive: boolean;
  onRun: (action: ActionDef, inputVal: string) => void;
  compact?: boolean;
}) {
  const [inputVal, setInputVal] = useState("");
  const canSubmit = action.needsInput ? inputVal.trim().length > 0 : true;

  const trigger = () => {
    if (!canSubmit || isActive) return;
    onRun(action, inputVal);
  };

  return (
    <div
      className={`rounded-xl border p-3 space-y-2 transition-colors ${
        isActive
          ? "border-accent bg-accent/10"
          : "border-border bg-surface-panel hover:border-border-strong"
      } ${compact ? "opacity-90" : ""}`}
    >
      <div className="flex items-start gap-2">
        <span className="text-lg leading-none mt-0.5 shrink-0">{action.icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink leading-tight">{action.label}</p>
          <p className="text-[11px] text-muted leading-snug">{action.description}</p>
        </div>
      </div>

      {action.needsInput && (
        <input
          type="text"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") trigger();
          }}
          placeholder={action.inputPlaceholder}
          className="w-full rounded-lg border border-border bg-surface-input px-3 py-1.5 text-xs text-ink outline-none placeholder:text-muted/40 focus:border-accent"
        />
      )}

      <button
        onClick={trigger}
        disabled={!canSubmit || isActive}
        className="w-full rounded-lg bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent/25 disabled:opacity-40 flex items-center justify-center gap-1.5"
      >
        {isActive ? (
          <>
            <span className="inline-block w-3 h-3 rounded-full border-2 border-accent border-t-transparent animate-spin" />
            Ejecutando…
          </>
        ) : (
          "Ejecutar manualmente"
        )}
      </button>
    </div>
  );
}

export default function SyncPanel() {
  const [lines, setLines] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [activeEndpoint, setActiveEndpoint] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<ScheduleStatus | null>(null);
  const [scheduleExpanded, setScheduleExpanded] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runningTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSchedule = useCallback(async () => {
    try {
      const data = await api.get<ScheduleStatus>("/api/sync/schedule");
      setSchedule(data);
    } catch {
      // ignore
    }
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      const data = await api.get<{ lines: string[]; count: number }>(
        "/api/panel/logs?limit=400",
      );
      if (data.lines) setLines(data.lines);
    } catch {
      // ignore transient errors
    }
  }, []);

  useEffect(() => {
    fetchSchedule();
    const iv = setInterval(fetchSchedule, 60_000);
    return () => clearInterval(iv);
  }, [fetchSchedule]);

  useEffect(() => {
    fetchLogs();
    const ms = isRunning ? 700 : 2500;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(fetchLogs, ms);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchLogs, isRunning]);

  useEffect(() => {
    if (!isRunning || lines.length === 0) return;
    const recent = lines.slice(-8);
    const done = recent.some((l) => /[✔✖]/.test(l));
    if (done) {
      if (runningTimeoutRef.current) clearTimeout(runningTimeoutRef.current);
      runningTimeoutRef.current = setTimeout(() => {
        setIsRunning(false);
        setActiveEndpoint(null);
        fetchSchedule();
      }, 1800);
    }
  }, [lines, isRunning, fetchSchedule]);

  const handleRun = useCallback(async (action: ActionDef, inputVal: string) => {
    if (runningTimeoutRef.current) clearTimeout(runningTimeoutRef.current);
    setIsRunning(true);
    setActiveEndpoint(action.endpoint);

    runningTimeoutRef.current = setTimeout(() => {
      setIsRunning(false);
      setActiveEndpoint(null);
    }, 120_000);

    try {
      if (action.needsInput === "nombre") {
        await api.get(`${action.endpoint}?nombre=${encodeURIComponent(inputVal)}`);
      } else {
        const body = action.needsInput ? { [action.needsInput]: inputVal } : undefined;
        await api.post(action.endpoint, body);
      }
    } catch {
      // Log errors show up in the terminal via panel_activity
    }
  }, []);

  const handleClear = useCallback(async () => {
    try {
      await api.delete("/api/panel/logs");
      setLines([]);
    } catch {
      // ignore
    }
  }, []);

  const handleStop = useCallback(async () => {
    setIsRunning(false);
    setActiveEndpoint(null);
    if (runningTimeoutRef.current) clearTimeout(runningTimeoutRef.current);
    try {
      await api.post("/api/sync/stop");
    } catch {
      // ignore
    }
  }, []);

  return (
    <div className="flex flex-col gap-4" style={{ minHeight: 0 }}>
      <PanelHelp panelId="sync" />
      <h2 className="text-xl font-extrabold text-ink shrink-0">🔄 Sincronización y Operaciones</h2>

      <div className="flex flex-col lg:flex-row gap-4" style={{ minHeight: 0 }}>
        <div className="w-full lg:w-72 xl:w-80 shrink-0 flex flex-col gap-3 overflow-y-auto">
          <AutomatedScheduleCard
            schedule={schedule}
            expanded={scheduleExpanded}
            onToggle={() => setScheduleExpanded((v) => !v)}
          />

          <div className="rounded-xl border border-border bg-surface-panel overflow-hidden">
            <button
              type="button"
              onClick={() => setManualOpen((v) => !v)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-surface-hover transition"
            >
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted">
                  Sincronización manual
                </p>
                <p className="text-[11px] text-muted/80">
                  Herramientas puntuales y casos especiales
                </p>
              </div>
              <span className="text-muted text-sm">{manualOpen ? "▾" : "▸"}</span>
            </button>
            {manualOpen && (
              <div className="px-2 pb-2 space-y-2 border-t border-border">
                {MANUAL_ACTIONS.map((a) => (
                  <ActionButton
                    key={a.id}
                    action={a}
                    isActive={activeEndpoint === a.endpoint}
                    onRun={handleRun}
                    compact
                  />
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              useAppStore.getState().setRentabilidadBootTab("precios");
              useAppStore.getState().setPanel("rentabilidad");
            }}
            className="rounded-xl border border-accent/40 bg-accent/5 px-3 py-2.5 text-left hover:bg-accent/10 transition"
          >
            <p className="text-xs font-bold uppercase tracking-wide text-accent">
              💲 Precios multicanal
            </p>
            <p className="mt-0.5 text-[11px] text-muted/90">
              Cambiaste un precio en MeLi — sincronízalo a Siigo y a la página web desde acá.
            </p>
          </button>

          <div className="rounded-xl border border-dashed border-border/80 bg-surface-panel/50 overflow-hidden">
            <button
              type="button"
              onClick={() => setOverrideOpen((v) => !v)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-surface-hover transition"
            >
              <div>
                <p className="text-xs font-semibold text-muted">
                  Forzar sync programada
                </p>
                <p className="text-[10px] text-muted/70">
                  Solo si necesitas adelantar una corrida automática
                </p>
              </div>
              <span className="text-muted text-sm">{overrideOpen ? "▾" : "▸"}</span>
            </button>
            {overrideOpen && (
              <div className="px-2 pb-2 space-y-2 border-t border-border/60">
                {OVERRIDE_ACTIONS.filter((a) => AUTOMATED_ACTION_IDS.has(a.id)).map((a) => (
                  <ActionButton
                    key={a.id}
                    action={a}
                    isActive={activeEndpoint === a.endpoint}
                    onRun={handleRun}
                    compact
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <TerminalLog
            lines={lines}
            isRunning={isRunning}
            onClear={handleClear}
            onStop={handleStop}
            className="h-[600px] lg:h-[700px]"
          />
        </div>
      </div>
    </div>
  );
}
