import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../api/client";
import TerminalLog from "./TerminalLog";

interface ActionDef {
  id: string;
  label: string;
  description: string;
  endpoint: string;
  needsInput?: "pack_id" | "fecha" | "nombre";
  inputPlaceholder?: string;
  icon: string;
}

const ACTIONS: ActionDef[] = [
  {
    id: "hoy",
    label: "Sync Hoy",
    description: "Facturas MeLi del último día",
    endpoint: "/api/sync/hoy",
    icon: "📅",
  },
  {
    id: "10dias",
    label: "Sync 10 Días",
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
    id: "aprendizaje",
    label: "Aprendizaje IA",
    description: "Analizar interacciones MeLi",
    endpoint: "/api/sync/aprendizaje",
    icon: "🤖",
  },
  {
    id: "gmail",
    label: "Facturas Gmail",
    description: "Escanear facturas de compra",
    endpoint: "/api/sync/gmail",
    icon: "✉️",
  },
  {
    id: "stock",
    label: "Reporte Stock",
    description: "Generar reporte por WhatsApp",
    endpoint: "/api/sync/stock",
    icon: "📊",
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

function ActionButton({
  action,
  isActive,
  onRun,
}: {
  action: ActionDef;
  isActive: boolean;
  onRun: (action: ActionDef, inputVal: string) => void;
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
      }`}
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
          "Ejecutar"
        )}
      </button>
    </div>
  );
}

export default function SyncPanel() {
  const [lines, setLines] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [activeEndpoint, setActiveEndpoint] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runningTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Poll logs: fast when running, slow otherwise
  useEffect(() => {
    fetchLogs();
    const ms = isRunning ? 700 : 2500;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(fetchLogs, ms);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchLogs, isRunning]);

  // Detect job completion from recent log lines
  useEffect(() => {
    if (!isRunning || lines.length === 0) return;
    const recent = lines.slice(-8);
    const done = recent.some((l) => /[✔✖]/.test(l));
    if (done) {
      if (runningTimeoutRef.current) clearTimeout(runningTimeoutRef.current);
      runningTimeoutRef.current = setTimeout(() => {
        setIsRunning(false);
        setActiveEndpoint(null);
      }, 1800);
    }
  }, [lines, isRunning]);

  const handleRun = useCallback(async (action: ActionDef, inputVal: string) => {
    if (runningTimeoutRef.current) clearTimeout(runningTimeoutRef.current);
    setIsRunning(true);
    setActiveEndpoint(action.endpoint);

    // Safety timeout: mark not-running after 120s even if job hangs
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

  return (
    <div className="flex flex-col gap-4" style={{ minHeight: 0 }}>
      <h2 className="text-lg font-semibold text-ink shrink-0">
        Sincronización y Operaciones
      </h2>

      <div className="flex flex-col lg:flex-row gap-4" style={{ minHeight: 0 }}>
        {/* ── Left: action buttons ── */}
        <div className="w-full lg:w-72 xl:w-80 shrink-0 flex flex-col gap-2 overflow-y-auto">
          {ACTIONS.map((a) => (
            <ActionButton
              key={a.id}
              action={a}
              isActive={activeEndpoint === a.endpoint}
              onRun={handleRun}
            />
          ))}
        </div>

        {/* ── Right: terminal ── */}
        <div className="flex-1 min-w-0">
          <TerminalLog
            lines={lines}
            isRunning={isRunning}
            onClear={handleClear}
            className="h-[600px] lg:h-[700px]"
          />
        </div>
      </div>
    </div>
  );
}
