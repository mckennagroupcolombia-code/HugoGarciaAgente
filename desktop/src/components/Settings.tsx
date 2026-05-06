import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "../stores/auth";
import { useStatus } from "../hooks/useStatus";
import { api } from "../api/client";
import TerminalLog from "./TerminalLog";

// ── Types ──────────────────────────────────────────────────────────────────

interface Servicio {
  id: string;
  label: string;
  estado: string;
}

interface GitStatus {
  branch: string;
  last_commit: string;
  modified_files: number;
  commits_behind: number;
}

// ── Service status badge ───────────────────────────────────────────────────

const ESTADO_CLS: Record<string, string> = {
  active:       "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  inactive:     "bg-gray-500/15 text-gray-400 border-gray-500/25",
  failed:       "bg-red-500/15 text-red-400 border-red-500/25",
  activating:   "bg-yellow-500/15 text-yellow-400 border-yellow-500/25",
  deactivating: "bg-yellow-500/15 text-yellow-400 border-yellow-500/25",
};

function EstadoBadge({ estado }: { estado: string }) {
  const cls = ESTADO_CLS[estado] ?? "bg-gray-500/10 text-gray-400 border-gray-500/20";
  const icons: Record<string, string> = {
    active: "●", inactive: "○", failed: "✕", activating: "◌", deactivating: "◌",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${cls}`}>
      <span>{icons[estado] ?? "?"}</span>
      {estado}
    </span>
  );
}

// ── Service card ───────────────────────────────────────────────────────────

function ServiceCard({
  svc,
  onRestart,
  restarting,
}: {
  svc: Servicio;
  onRestart: (id: string) => void;
  restarting: boolean;
}) {
  const isAgente = svc.id === "agente-pro";

  return (
    <div className="flex items-center justify-between rounded-xl border border-border bg-surface-panel px-4 py-3 gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink truncate">{svc.label}</p>
        <p className="text-[11px] text-muted font-mono">{svc.id}</p>
      </div>
      <EstadoBadge estado={svc.estado} />
      <button
        onClick={() => onRestart(svc.id)}
        disabled={restarting}
        title={isAgente ? "El panel perderá conexión ~15 s mientras reinicia" : undefined}
        className="shrink-0 rounded-lg border border-border bg-surface-hover px-3 py-1.5 text-xs font-medium text-ink transition hover:border-accent hover:text-accent disabled:opacity-40 flex items-center gap-1.5"
      >
        {restarting ? (
          <span className="inline-block w-3 h-3 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        )}
        Reiniciar
      </button>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function Settings() {
  const token = useAuthStore((s) => s.token);
  const logout = useAuthStore((s) => s.clear);
  const { data: status } = useStatus();
  const qc = useQueryClient();

  // Terminal log (polls panel_activity)
  const [logLines, setLogLines] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchLogs = useCallback(async () => {
    try {
      const d = await api.get<{ lines: string[]; count: number }>("/api/panel/logs?limit=200");
      if (d.lines) setLogLines(d.lines);
    } catch {}
  }, []);

  useEffect(() => {
    fetchLogs();
    const ms = isRunning ? 800 : 3000;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(fetchLogs, ms);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchLogs, isRunning]);

  // Detect job completion
  useEffect(() => {
    if (!isRunning || logLines.length === 0) return;
    const recent = logLines.slice(-6);
    if (recent.some((l) => /[✔✖]/.test(l))) {
      if (runTimerRef.current) clearTimeout(runTimerRef.current);
      runTimerRef.current = setTimeout(() => {
        setIsRunning(false);
        qc.invalidateQueries({ queryKey: ["servicios"] });
        qc.invalidateQueries({ queryKey: ["git-status"] });
      }, 1500);
    }
  }, [logLines, isRunning, qc]);

  const markRunning = () => {
    if (runTimerRef.current) clearTimeout(runTimerRef.current);
    setIsRunning(true);
    runTimerRef.current = setTimeout(() => setIsRunning(false), 120_000);
  };

  // Services
  const { data: serviciosData, refetch: refetchServicios } = useQuery<{ servicios: Servicio[] }>({
    queryKey: ["servicios"],
    queryFn: () => api.get("/api/sistema/servicios"),
    refetchInterval: 15_000,
  });

  const [restarting, setRestarting] = useState<string | null>(null);

  const restartMutation = useMutation({
    mutationFn: (servicio: string) =>
      api.post<{ aviso?: string }>("/api/sistema/reiniciar", { servicio }),
    onMutate: (servicio) => setRestarting(servicio),
    onSettled: () => {
      setRestarting(null);
      setTimeout(() => refetchServicios(), 3000);
    },
    onSuccess: (data, servicio) => {
      markRunning();
      if (servicio === "agente-pro" && data.aviso) {
        setAgenteRestarting(true);
        setTimeout(() => setAgenteRestarting(false), 20_000);
      }
    },
  });

  const [agenteRestarting, setAgenteRestarting] = useState(false);

  // Git status
  const { data: gitData, refetch: refetchGit } = useQuery<GitStatus>({
    queryKey: ["git-status"],
    queryFn: () => api.get("/api/sistema/git-status"),
    retry: false,
  });

  const [rebuildFrontend, setRebuildFrontend] = useState(false);

  const pullMutation = useMutation({
    mutationFn: () =>
      api.post("/api/sistema/git-pull", { rebuild_frontend: rebuildFrontend }),
    onSuccess: () => {
      markRunning();
      setTimeout(() => refetchGit(), 5000);
    },
  });

  const clearLogs = async () => {
    try { await api.delete("/api/panel/logs"); setLogLines([]); } catch {}
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h2 className="text-lg font-semibold text-ink">Ajustes y Sistema</h2>

      {/* ── Sesión ── */}
      <section className="rounded-xl border border-border bg-surface-panel p-5 space-y-4">
        <h3 className="text-sm font-semibold text-ink">Sesión</h3>
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted">
            Token:{" "}
            <code className="text-xs text-ink">
              {token.slice(0, 8)}…{token.slice(-4)}
            </code>
          </p>
          <button
            onClick={logout}
            className="rounded-lg bg-danger/15 px-4 py-2 text-sm font-medium text-danger transition hover:bg-danger/25"
          >
            Cerrar sesión
          </button>
        </div>
        {status && (
          <dl className="flex gap-6 text-sm">
            <div>
              <dt className="text-muted text-xs">Versión</dt>
              <dd className="text-ink font-mono">{status.version}</dd>
            </div>
            <div>
              <dt className="text-muted text-xs">Estado</dt>
              <dd className="text-emerald-400 font-semibold">{status.estado}</dd>
            </div>
          </dl>
        )}
      </section>

      {/* ── Servicios ── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">Servicios del Sistema</h3>
          <button
            onClick={() => refetchServicios()}
            className="text-xs text-muted hover:text-ink transition"
          >
            🔄 Actualizar
          </button>
        </div>

        {agenteRestarting && (
          <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-400 flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin shrink-0" />
            Reiniciando agente-pro… El panel puede perder conexión ~15 segundos. Recarga la página si no vuelve solo.
          </div>
        )}

        <div className="space-y-2">
          {serviciosData?.servicios?.map((svc) => (
            <ServiceCard
              key={svc.id}
              svc={svc}
              restarting={restarting === svc.id}
              onRestart={(id) => restartMutation.mutate(id)}
            />
          )) ?? (
            <p className="text-sm text-muted px-1">Cargando servicios…</p>
          )}
        </div>
      </section>

      {/* ── Repositorio ── */}
      <section className="rounded-xl border border-border bg-surface-panel p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">Repositorio GitHub</h3>
          <button
            onClick={() => refetchGit()}
            className="text-xs text-muted hover:text-ink transition"
          >
            🔄
          </button>
        </div>

        {gitData && !("error" in gitData) ? (
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-muted text-xs mb-0.5">Rama</dt>
              <dd className="font-mono text-ink">{gitData.branch}</dd>
            </div>
            <div>
              <dt className="text-muted text-xs mb-0.5">Archivos modificados</dt>
              <dd className={`font-semibold ${gitData.modified_files > 0 ? "text-yellow-400" : "text-emerald-400"}`}>
                {gitData.modified_files}
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-muted text-xs mb-0.5">Último commit</dt>
              <dd className="font-mono text-xs text-ink break-all">{gitData.last_commit}</dd>
            </div>
            {gitData.commits_behind > 0 && (
              <div className="col-span-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-400">
                ⚠️ {gitData.commits_behind} commit{gitData.commits_behind !== 1 ? "s" : ""} por detrás del remoto
              </div>
            )}
          </dl>
        ) : (
          <p className="text-sm text-muted">Cargando estado del repositorio…</p>
        )}

        <div className="flex items-center gap-4 pt-1">
          <label className="flex items-center gap-2 text-sm text-ink cursor-pointer select-none">
            <input
              type="checkbox"
              checked={rebuildFrontend}
              onChange={(e) => setRebuildFrontend(e.target.checked)}
              className="rounded border-border accent-accent"
            />
            Compilar panel React tras el pull
          </label>
        </div>

        <button
          onClick={() => pullMutation.mutate()}
          disabled={pullMutation.isPending || isRunning}
          className="rounded-lg bg-accent/15 px-4 py-2 text-sm font-semibold text-accent transition hover:bg-accent/25 disabled:opacity-40 flex items-center gap-2"
        >
          {pullMutation.isPending ? (
            <>
              <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
              Actualizando…
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
              </svg>
              Git Pull
            </>
          )}
        </button>
      </section>

      {/* ── Terminal ── */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-ink">Salida del Sistema</h3>
        <TerminalLog
          lines={logLines}
          isRunning={isRunning}
          onClear={clearLogs}
          className="h-72"
        />
      </section>
    </div>
  );
}
