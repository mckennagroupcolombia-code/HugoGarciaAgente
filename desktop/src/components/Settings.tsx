import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "../stores/auth";
import { useTicketsAuth } from "../stores/ticketsAuth";
import { useStatus } from "../hooks/useStatus";
import { api } from "../api/client";
import TerminalLog from "./TerminalLog";
import TelefonosOperadoresSection from "./TelefonosOperadoresSection";

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
  const { user: ticketsUser, clear: clearTickets } = useTicketsAuth();
  const isAdmin = (ticketsUser?.rol?.nivel ?? 0) >= 3;
  const clearMain = useAuthStore((s) => s.clear);
  function logout() { clearTickets(); clearMain(); }
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

  // Network access
  interface AccesoRed { habilitado: boolean; ip_lan: string | null; puerto: number; url: string | null }
  const { data: accesoRed, refetch: refetchAcceso } = useQuery<AccesoRed>({
    queryKey: ["acceso-red"],
    queryFn: () => api.get("/api/sistema/acceso-red"),
    refetchInterval: 30_000,
  });
  const [copied, setCopied] = useState(false);
  const toggleAccesoMutation = useMutation({
    mutationFn: (habilitado: boolean) =>
      api.post<AccesoRed>("/api/sistema/acceso-red", { habilitado }),
    onSuccess: () => refetchAcceso(),
  });
  const copyUrl = () => {
    if (accesoRed?.url) {
      navigator.clipboard.writeText(accesoRed.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
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
    <div className="mx-auto max-w-4xl space-y-6">
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

      {/* ── Acceso desde red local ── */}
      <section className="rounded-xl border border-border bg-surface-panel p-5 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-ink">Acceso desde red local</h3>
            <p className="text-xs text-muted mt-0.5">
              Abre el panel desde el móvil u otro equipo en la misma red Wi-Fi
            </p>
          </div>
          <button
            onClick={() => toggleAccesoMutation.mutate(!accesoRed?.habilitado)}
            disabled={toggleAccesoMutation.isPending || !accesoRed}
            aria-label="Activar acceso desde red local"
            className={`relative shrink-0 inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 focus:outline-none ${
              accesoRed?.habilitado
                ? "bg-accent"
                : "bg-surface-hover border border-border"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                accesoRed?.habilitado ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        {accesoRed?.habilitado && accesoRed.url && (
          <div className="rounded-lg border border-border bg-surface-hover px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] text-muted mb-1">URL de acceso</p>
              <code className="text-sm text-accent break-all">{accesoRed.url}</code>
            </div>
            <button
              onClick={copyUrl}
              className="shrink-0 rounded-lg border border-border bg-surface-panel px-3 py-1.5 text-xs font-medium text-ink transition hover:border-accent hover:text-accent"
            >
              {copied ? "✓ Copiado" : "Copiar"}
            </button>
          </div>
        )}

        {accesoRed?.habilitado && !accesoRed.ip_lan && (
          <p className="text-xs text-yellow-400">
            No se detectó IP de red local. Verifica la conexión Wi-Fi o ethernet.
          </p>
        )}

        {!accesoRed?.habilitado && (
          <p className="text-xs text-muted">
            Panel solo accesible desde este equipo (localhost).
          </p>
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

      {/* ── Control del Agente WhatsApp ── */}
      <AgentScheduleSection />

      {/* ── Notificaciones WhatsApp ── */}
      {isAdmin && <NotifWaSection />}

      {/* ── Supervisor IA ── */}
      <SupervisorSection onMarkRunning={markRunning} />

      {/* ── App Android ── */}
      {isAdmin && <ApkBuilderSection />}

      {/* ── Teléfonos operadores (notas de voz supervisor) ── */}
      {isAdmin && <TelefonosOperadoresSection />}

      {/* ── Gestión de usuarios ── */}
      {isAdmin && <UsuariosSection />}

      {/* ── Terminal ── */}
      {isAdmin && <TerminalSection logLines={logLines} isRunning={isRunning} onClear={clearLogs} />}
    </div>
  );
}

// ── APK Builder section ────────────────────────────────────────────────────

interface ApkStatus {
  status: "idle" | "building" | "success" | "error";
  log: string[];
  version: string | null;
  error: string | null;
  built_at: string | null;
  apk_size_kb: number | null;
}

function ApkBuilderSection() {
  // apiToken = CHAT_API_TOKEN (devuelto desde /auth/me solo para admins)
  // Es el que valida _api_token_valido() en el backend
  const apiToken = useTicketsAuth((s) => s.apiToken) ?? useAuthStore.getState().token;
  const [version, setVersion] = useState("1.0.0");
  const [status, setStatus] = useState<ApkStatus | null>(null);
  const [polling, setPolling] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const pollRef   = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const d = await api.get<ApkStatus>("/api/build-apk/status");
      setStatus(d);
      if (d.status !== "building") {
        setPolling(false);
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      }
    } catch {}
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  useEffect(() => {
    if (polling && !pollRef.current) {
      pollRef.current = setInterval(fetchStatus, 2000);
    }
    return () => { if (pollRef.current && !polling) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [polling, fetchStatus]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [status?.log]);

  async function startBuild() {
    try {
      await api.post("/api/build-apk", { version });
      setPolling(true);
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(fetchStatus, 2000);
      await fetchStatus();
    } catch (e: any) {
      alert(e.message ?? "Error al iniciar build");
    }
  }

  function downloadApk() {
    window.location.href = `/api/build-apk/download?token=${encodeURIComponent(apiToken ?? "")}`;
  }

  const building = status?.status === "building";
  const ready    = status?.status === "success";
  const failed   = status?.status === "error";

  return (
    <section className="rounded-xl border border-border bg-surface-panel p-5 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
            <span>📱</span> App Android (TWA)
          </h3>
          <p className="text-xs text-muted mt-0.5">
            Genera el APK firmado para distribuir a los colaboradores
          </p>
        </div>
        {ready && (
          <span className="shrink-0 text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2.5 py-0.5">
            ✓ v{status!.version} listo
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted font-medium">Versión</label>
          <input
            className="rounded-lg border border-border bg-surface-hover px-3 py-1.5 text-sm text-ink font-mono w-28 focus:outline-none focus:border-accent"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="1.0.0"
            disabled={building}
          />
        </div>

        <button
          onClick={startBuild}
          disabled={building}
          className="rounded-lg bg-accent/15 px-4 py-2 text-sm font-semibold text-accent transition hover:bg-accent/25 disabled:opacity-40 flex items-center gap-2"
        >
          {building ? (
            <>
              <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
              Compilando…
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
              Generar APK
            </>
          )}
        </button>

        {ready && (
          <button
            onClick={downloadApk}
            className="rounded-lg bg-emerald-500/15 border border-emerald-500/30 px-4 py-2 text-sm font-semibold text-emerald-400 transition hover:bg-emerald-500/25 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Descargar APK
            {status?.apk_size_kb && (
              <span className="text-[11px] text-emerald-600 font-normal">({status.apk_size_kb} KB)</span>
            )}
          </button>
        )}
      </div>

      {status && (status.log.length > 0 || failed) && (
        <div className="rounded-lg border border-border bg-[#0a0d12] p-3 font-mono text-[11px] h-40 overflow-y-auto space-y-0.5">
          {status.log.map((line, i) => {
            const isErr = /error|failed|✖/i.test(line);
            const isOk  = /✔|BUILD SUCCESS/.test(line);
            return (
              <div key={i} className={isErr ? "text-red-400" : isOk ? "text-emerald-400" : "text-gray-400"}>
                {line}
              </div>
            );
          })}
          {failed && status.error && (
            <div className="text-red-400 mt-1">✖ {status.error}</div>
          )}
          <div ref={logEndRef} />
        </div>
      )}

      {ready && status?.built_at && (
        <p className="text-[11px] text-muted">
          Compilado el {status.built_at} · v{status.version} · {status.apk_size_kb} KB
        </p>
      )}
    </section>
  );
}

// ── Supervisor IA section ──────────────────────────────────────────────────

function SupervisorSection({ onMarkRunning }: { onMarkRunning: () => void }) {
  const { data: svStatus, refetch: refetchSv } = useQuery<{
    chunks_indexados: number;
    coleccion: string;
    status: string;
  }>({
    queryKey: ["supervisor-status"],
    queryFn: () => api.get("/api/supervisor/status"),
    retry: false,
    staleTime: 30_000,
  });

  const indexMutation = useMutation({
    mutationFn: () => api.post("/api/supervisor/index", {}),
    onSuccess: () => {
      onMarkRunning();
      setTimeout(() => refetchSv(), 10_000);
    },
  });

  return (
    <section className="rounded-xl border border-border bg-surface-panel p-5 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">Supervisor IA (gemma4:e4b)</h3>
          <p className="text-xs text-muted mt-0.5">
            Índice de código fuente en ChromaDB — permite responder preguntas sobre el proyecto
          </p>
        </div>
        <button
          onClick={() => indexMutation.mutate()}
          disabled={indexMutation.isPending}
          className="shrink-0 rounded-lg border border-border bg-surface-hover px-3 py-1.5 text-xs font-medium text-ink transition hover:border-accent hover:text-accent disabled:opacity-40 flex items-center gap-1.5"
        >
          {indexMutation.isPending ? (
            <span className="inline-block w-3 h-3 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
          Re-indexar
        </button>
      </div>

      <div className="flex items-center gap-6 text-sm">
        <div>
          <p className="text-xs text-muted">Chunks indexados</p>
          <p className="text-ink font-mono font-semibold">
            {svStatus?.status === "ok" ? svStatus.chunks_indexados.toLocaleString("es-CO") : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted">Colección</p>
          <p className="text-ink font-mono text-xs">{svStatus?.coleccion ?? "proyecto_codigo"}</p>
        </div>
        <div>
          <p className="text-xs text-muted">Estado</p>
          <p className={`text-xs font-semibold ${svStatus?.status === "ok" ? "text-emerald-400" : "text-yellow-400"}`}>
            {svStatus?.status === "ok" ? "listo" : "sin índice"}
          </p>
        </div>
      </div>

      {indexMutation.isSuccess && (
        <p className="text-xs text-emerald-400">Indexación iniciada en segundo plano — puede tomar ~30 s</p>
      )}
    </section>
  );
}

// ── Terminal colapsable (admin) ────────────────────────────────────────────

function TerminalSection({
  logLines,
  isRunning,
  onClear,
}: {
  logLines: string[];
  isRunning: boolean;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <section className="rounded-xl border border-border bg-surface-panel overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-3.5 text-left transition hover:bg-surface-hover"
      >
        <h3 className="text-sm font-semibold text-ink">Salida del Sistema</h3>
        <svg
          className={`h-4 w-4 text-muted transition-transform ${open ? "rotate-180" : ""}`}
          fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-5 pb-5">
          <TerminalLog
            lines={logLines}
            isRunning={isRunning}
            onClear={onClear}
            className="h-72"
          />
        </div>
      )}
    </section>
  );
}

// ── Gestión de usuarios (admin) ────────────────────────────────────────────

interface UsuarioResumen {
  id: number;
  nombre: string;
  username: string;
  email: string | null;
  activo: number;
  rol: { id: number; nombre: string; nivel: number } | null;
  permisos_secciones: Record<string, boolean> | null;
}

// Sidebar sections (top-level)
const SIDEBAR_SECCIONES: { id: string; label: string }[] = [
  { id: "dashboard",  label: "Dashboard" },
  { id: "chat",       label: "Chat IA" },
  { id: "voz",        label: "Voz IA" },
  { id: "webchat",    label: "Chat web" },
  { id: "whatsapp",   label: "Agente WA" },
  { id: "preventa",   label: "Preventa MeLi" },
  { id: "postventa",  label: "Postventa MeLi" },
  { id: "stock",      label: "Stock" },
  { id: "fichas",     label: "Docs técnicos" },
  { id: "pedidos",    label: "Pedidos Web" },
  { id: "logistica-internacional", label: "Logística Internacional" },
  { id: "etiquetas",  label: "Impresora · Etiquetas" },
  { id: "etiquetas-config", label: "Configurar productos" },
  { id: "tickets",    label: "Centro de Mando" },
  { id: "settings",   label: "Ajustes" },
];

const CONTABILIDAD_SECCIONES: { id: string; label: string }[] = [
  { id: "facturas",      label: "Facturas de compra" },
  { id: "centros-costo", label: "Centro de costos (incl. con Facturas o Sync)" },
  { id: "sync",          label: "Sincronización" },
];

// Sub-tabs within Centro de Mando (solo los que tienen pVer gating en TicketsPanel)
const TICKETS_TABS: { id: string; label: string }[] = [
  { id: "acciones",    label: "Acciones (+ Recordatorios + Procedimientos)" },
  { id: "solicitudes", label: "Solicitudes" },
  { id: "workload",    label: "Aliados" },
];

function PermisosEditor({
  usuario,
  onSaved,
}: {
  usuario: UsuarioResumen;
  onSaved: () => void;
}) {
  const { token: ticketsToken } = useTicketsAuth();

  // Initialize from current permisos, defaulting to null = empty
  const [permisos, setPermisos] = useState<Record<string, boolean>>(() => {
    return usuario.permisos_secciones ?? {};
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function toggle(key: string) {
    setPermisos((prev) => ({ ...prev, [key]: !prev[key] }));
    setSaved(false);
  }

  // When tickets is toggled off, also clear sub-tabs
  function toggleSeccion(id: string) {
    if (id === "tickets") {
      setPermisos((prev) => {
        const next: Record<string, boolean> = { ...prev, tickets: !prev["tickets"] };
        if (!next["tickets"]) {
          TICKETS_TABS.forEach((t) => { next[`tickets_${t.id}`] = false; });
        }
        return next;
      });
    } else {
      toggle(id);
    }
    setSaved(false);
  }

  async function guardar() {
    setSaving(true);
    try {
      await fetch(`/api/tickets/usuarios/${usuario.id}/permisos`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ticketsToken}`,
        },
        body: JSON.stringify(permisos),
      });
      setSaved(true);
      onSaved();
    } catch {
      alert("Error al guardar permisos");
    } finally {
      setSaving(false);
    }
  }

  const ticketsHabilitado = Boolean(permisos["tickets"]);

  return (
    <div className="mt-3 space-y-4 rounded-lg border border-border bg-surface p-4">
      <div className="space-y-2">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Secciones del panel</p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
          {SIDEBAR_SECCIONES.map((s) => {
            const siempreActivo = s.id === "etiquetas" || s.id === "etiquetas-config";
            return (
            <label key={s.id} className={`flex items-center gap-2 text-sm text-ink ${siempreActivo ? "opacity-70" : "cursor-pointer"}`}>
              <input
                type="checkbox"
                checked={siempreActivo || Boolean(permisos[s.id])}
                disabled={siempreActivo}
                onChange={() => !siempreActivo && toggleSeccion(s.id)}
                className="h-3.5 w-3.5 rounded border-border accent-accent disabled:opacity-60"
              />
              {s.label}{siempreActivo ? " (todos)" : ""}
            </label>
            );
          })}
        </div>
      </div>

      <div className="space-y-2 rounded-lg border border-border bg-surface-hover px-4 py-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Contabilidad</p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
          {CONTABILIDAD_SECCIONES.map((s) => (
            <label key={s.id} className="flex cursor-pointer items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={Boolean(permisos[s.id])}
                onChange={() => toggle(s.id)}
                className="h-3.5 w-3.5 rounded border-border accent-accent"
              />
              {s.label}
            </label>
          ))}
        </div>
      </div>

      {ticketsHabilitado && (
        <div className="space-y-2 rounded-lg border border-border bg-surface-hover px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Tabs — Centro de Mando</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
            {TICKETS_TABS.map((t) => (
              <label key={t.id} className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={Boolean(permisos[`tickets_${t.id}`])}
                  onChange={() => toggle(`tickets_${t.id}`)}
                  className="h-3.5 w-3.5 rounded border-border accent-accent"
                />
                {t.label}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={guardar}
          disabled={saving}
          className="rounded-lg bg-accent/15 px-4 py-1.5 text-sm font-semibold text-accent transition hover:bg-accent/25 disabled:opacity-40"
        >
          {saving ? "Guardando…" : "Guardar permisos"}
        </button>
        {saved && <span className="text-xs text-emerald-400">✓ Guardado</span>}
      </div>
    </div>
  );
}

function UsuariosSection() {
  const { token: ticketsToken } = useTicketsAuth();
  const { data, refetch } = useQuery<UsuarioResumen[]>({
    queryKey: ["tickets-usuarios-admin"],
    queryFn: () =>
      fetch("/api/tickets/usuarios", {
        headers: { Authorization: `Bearer ${ticketsToken ?? ""}` },
      }).then((r) => r.json().then((d) => { if (!r.ok) throw new Error(d?.error || `Error ${r.status}`); return d; })),
    enabled: Boolean(ticketsToken),
    staleTime: 10_000,
  });

  const [expanded, setExpanded] = useState<number | null>(null);

  const usuarios = Array.isArray(data) ? data : [];
  // Excluir admins de la lista (no tiene sentido editar sus permisos)
  const operarios = usuarios.filter((u) => (u.rol?.nivel ?? 0) < 3 && u.activo);

  return (
    <section className="rounded-xl border border-border bg-surface-panel p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-ink">Gestión de usuarios</h3>
        <p className="text-xs text-muted mt-0.5">
          Configura qué secciones puede ver cada colaborador
        </p>
      </div>

      {operarios.length === 0 && (
        <p className="text-sm text-muted">No hay colaboradores registrados.</p>
      )}

      <div className="space-y-2">
        {operarios.map((u) => {
          const isOpen = expanded === u.id;
          const tienePermisos = u.permisos_secciones && Object.keys(u.permisos_secciones).length > 0;
          return (
            <div key={u.id} className="rounded-lg border border-border bg-surface overflow-hidden">
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : u.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-surface-hover"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink truncate">{u.nombre}</p>
                  <p className="text-[11px] text-muted truncate">{u.email ?? u.username}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 border ${
                    tienePermisos
                      ? "bg-accent/10 text-accent border-accent/20"
                      : "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
                  }`}>
                    {tienePermisos ? "Configurado" : "Por defecto"}
                  </span>
                  <span className="text-muted text-xs">{u.rol?.nombre ?? "—"}</span>
                  <svg
                    className={`h-4 w-4 text-muted transition-transform ${isOpen ? "rotate-180" : ""}`}
                    fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>
              {isOpen && (
                <div className="border-t border-border px-4 pb-4">
                  <PermisosEditor
                    usuario={u}
                    onSaved={() => {
                      refetch();
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Notificaciones WhatsApp (admin) ────────────────────────────────────────

interface NotifWaConfig {
  sede_sur_acciones: boolean;
}

function NotifWaSection() {
  const { token: ticketsToken } = useTicketsAuth();
  const [config, setConfig] = useState<NotifWaConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!ticketsToken) return;
    fetch("/api/tickets/config/notif-wa", {
      headers: { Authorization: `Bearer ${ticketsToken}` },
    })
      .then((r) => r.json())
      .then((d) => setConfig(d))
      .catch(() => {});
  }, [ticketsToken]);

  async function toggle() {
    if (!config || !ticketsToken) return;
    setSaving(true);
    setSaved(false);
    const next = { ...config, sede_sur_acciones: !config.sede_sur_acciones };
    try {
      await fetch("/api/tickets/config/notif-wa", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ticketsToken}`,
        },
        body: JSON.stringify(next),
      });
      setConfig(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      alert("Error al guardar la configuración");
    } finally {
      setSaving(false);
    }
  }

  const activo = config?.sede_sur_acciones ?? true;

  return (
    <section className="rounded-xl border border-border bg-surface-panel p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-ink">Notificaciones WhatsApp</h3>
        <p className="text-xs text-muted mt-0.5">
          Configura qué eventos se reportan automáticamente al grupo MCKG SEDE SUR
        </p>
      </div>

      {config === null ? (
        <p className="text-sm text-muted">Cargando configuración…</p>
      ) : (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">Acciones y solicitudes → MCKG SEDE SUR</p>
            <p className="text-xs text-muted mt-0.5">
              Envía un mensaje al grupo cuando alguien inicia o completa una acción/solicitud del Centro de Mando
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {saved && <span className="text-xs text-emerald-400">✓ Guardado</span>}
            <button
              onClick={toggle}
              disabled={saving}
              aria-label="Activar notificaciones de acciones en SEDE SUR"
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 focus:outline-none ${
                activo ? "bg-accent" : "bg-surface-hover border border-border"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  activo ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ── Control global del agente WhatsApp ────────────────────────────────────

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

const DIAS_ISO = [
  { iso: 1, label: "Lun" },
  { iso: 2, label: "Mar" },
  { iso: 3, label: "Mié" },
  { iso: 4, label: "Jue" },
  { iso: 5, label: "Vie" },
  { iso: 6, label: "Sáb" },
  { iso: 7, label: "Dom" },
];

function AgentScheduleSection() {
  const [config, setConfig] = useState<BotConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [draft, setDraft] = useState<BotConfig | null>(null);

  useEffect(() => {
    api
      .get<BotConfig>("/api/bot/config")
      .then((d) => {
        setConfig(d);
        setDraft(d);
      })
      .catch(() => {});
  }, []);

  async function save(patch: BotConfig) {
    setSaving(true);
    setSaved(false);
    try {
      const res = await api.post<{ ok: boolean; activo_ahora: boolean }>("/api/bot/config", {
        bot_global_activo: patch.bot_global_activo,
        horario_bot: patch.horario_bot,
      });
      const updated: BotConfig = { ...patch, activo_ahora: res.activo_ahora };
      setConfig(updated);
      setDraft(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      alert("Error al guardar la configuración del agente");
    } finally {
      setSaving(false);
    }
  }

  function toggleGlobal() {
    if (!draft) return;
    const next = { ...draft, bot_global_activo: !draft.bot_global_activo };
    setDraft(next);
    save(next);
  }

  function toggleSchedule() {
    if (!draft) return;
    const next = {
      ...draft,
      horario_bot: { ...draft.horario_bot, habilitado: !draft.horario_bot.habilitado },
    };
    setDraft(next);
    save(next);
  }

  function toggleDia(iso: number) {
    if (!draft) return;
    const dias = draft.horario_bot.dias.includes(iso)
      ? draft.horario_bot.dias.filter((d) => d !== iso)
      : [...draft.horario_bot.dias, iso].sort((a, b) => a - b);
    setDraft((p) => (p ? { ...p, horario_bot: { ...p.horario_bot, dias } } : p));
  }

  function saveScheduleFields() {
    if (draft) save(draft);
  }

  if (!draft) {
    return (
      <section className="rounded-xl border border-border bg-surface-panel p-5">
        <p className="text-sm text-muted">Cargando configuración del agente…</p>
      </section>
    );
  }

  const globalActivo = draft.bot_global_activo;
  const scheduleHabilitado = draft.horario_bot.habilitado;
  const activoAhora = config?.activo_ahora ?? false;

  return (
    <section className="rounded-xl border border-border bg-surface-panel p-5 space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
            <span>🤖</span> Agente WhatsApp
          </h3>
          <p className="text-xs text-muted mt-0.5">
            Controla cuándo Hugo García responde automáticamente en WhatsApp
          </p>
        </div>
        <span
          className={`shrink-0 text-[11px] font-semibold rounded-full px-2.5 py-0.5 border ${
            activoAhora
              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
              : "bg-red-500/10 text-red-400 border-red-500/20"
          }`}
        >
          {activoAhora ? "● Activo ahora" : "○ Pausado ahora"}
        </span>
      </div>

      {/* Toggle global */}
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">Agente habilitado</p>
          <p className="text-xs text-muted mt-0.5">
            {globalActivo
              ? "Hugo responde automáticamente 24/7 (salvo pausa manual)"
              : "El agente está pausado — ningún chat recibirá respuesta automática"}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {saved && <span className="text-xs text-emerald-400">✓</span>}
          <button
            onClick={toggleGlobal}
            disabled={saving}
            aria-label="Habilitar o pausar el agente globalmente"
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 focus:outline-none ${
              globalActivo ? "bg-accent" : "bg-surface-hover border border-border"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                globalActivo ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
      </div>

      {/* Horario */}
      <div className="rounded-lg border border-border bg-surface overflow-hidden">
        <button
          type="button"
          onClick={toggleSchedule}
          disabled={saving}
          className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition hover:bg-surface-hover disabled:opacity-40"
        >
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">Horario de atención</p>
            <p className="text-xs text-muted mt-0.5">
              {scheduleHabilitado
                ? `Referencia ${draft.horario_bot.hora_inicio}–${draft.horario_bot.hora_fin} (no pausa al bot)`
                : "Sin horario — Hugo responde siempre que el bot esté habilitado"}
            </p>
          </div>
          <span
            className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              scheduleHabilitado ? "bg-accent" : "bg-surface-hover border border-border"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                scheduleHabilitado ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </span>
        </button>

        {scheduleHabilitado && (
          <div className="border-t border-border px-4 pb-4 pt-3 space-y-4">
            {/* Horas */}
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-muted font-medium">Hora inicio</label>
                <input
                  type="time"
                  value={draft.horario_bot.hora_inicio}
                  onChange={(e) =>
                    setDraft((p) =>
                      p ? { ...p, horario_bot: { ...p.horario_bot, hora_inicio: e.target.value } } : p
                    )
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
                    setDraft((p) =>
                      p ? { ...p, horario_bot: { ...p.horario_bot, hora_fin: e.target.value } } : p
                    )
                  }
                  className="rounded-lg border border-border bg-surface-hover px-3 py-1.5 text-sm text-ink font-mono w-32 focus:outline-none focus:border-accent"
                />
              </div>
              <button
                onClick={saveScheduleFields}
                disabled={saving}
                className="rounded-lg bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent/25 disabled:opacity-40"
              >
                {saving ? "Guardando…" : "Guardar horas"}
              </button>
            </div>

            {/* Días */}
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
                onClick={saveScheduleFields}
                disabled={saving}
                className="text-xs text-accent hover:underline disabled:opacity-40 pt-1 block"
              >
                {saving ? "Guardando…" : "Guardar días"}
              </button>
            </div>

            <p className="text-[11px] text-muted">
              Zona horaria: Colombia (UTC−5). El horario es referencia en panel; Hugo responde 24/7 salvo pausa manual.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
