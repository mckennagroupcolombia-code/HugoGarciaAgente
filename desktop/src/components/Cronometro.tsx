import { useCallback, useEffect, useRef, useState } from "react";

export function fmtTiempo(seg: number): string {
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  const s = seg % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function useCronometro() {
  const [segundos, setSegundos] = useState(0);
  const [activo, setActivo] = useState(false);
  const acumRef = useRef(0);
  const inicioRef = useRef<number | null>(null);

  useEffect(() => {
    if (!activo) return;
    const iv = setInterval(() => {
      if (inicioRef.current != null) {
        const total = acumRef.current + Math.floor((Date.now() - inicioRef.current) / 1000);
        setSegundos(total);
      }
    }, 250);
    return () => clearInterval(iv);
  }, [activo]);

  function tomarSegundos() {
    if (activo && inicioRef.current != null) {
      return acumRef.current + Math.floor((Date.now() - inicioRef.current) / 1000);
    }
    return acumRef.current;
  }

  function iniciar() {
    if (activo) return;
    inicioRef.current = Date.now();
    setActivo(true);
  }

  function pausar() {
    if (!activo || inicioRef.current == null) return;
    acumRef.current = tomarSegundos();
    inicioRef.current = null;
    setSegundos(acumRef.current);
    setActivo(false);
  }

  function reiniciar() {
    acumRef.current = 0;
    inicioRef.current = null;
    setSegundos(0);
    setActivo(false);
  }

  /** Persiste el tramo actual y sigue contando (o confirma el acumulado si estaba pausado). */
  function guardar(): number {
    const total = tomarSegundos();
    acumRef.current = total;
    if (activo) {
      inicioRef.current = Date.now();
    }
    setSegundos(total);
    return total;
  }

  return { segundos, activo, iniciar, pausar, reiniciar, guardar, tomarSegundos };
}

// ── Cronómetro persistido en servidor (acciones / tickets) ───────────────────

export interface TicketCorridaLite {
  id: number;
  estado: "activa" | "pausada" | "finalizada";
  segundos_transcurridos?: number;
  segundos_acumulados?: number;
  iniciada_en?: string;
  reanudada_en?: string | null;
}

/** Parsea timestamps UTC de SQLite: "YYYY-MM-DD HH:MM:SS". */
export function parseUtcTs(s: string): number {
  if (!s) return Date.now();
  const iso = s.replace(" ", "T");
  const withTz = /Z$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + "Z";
  const ts = new Date(withTz).getTime();
  if (isNaN(ts)) return Date.now();
  return ts > Date.now() ? Date.now() : ts;
}

export function segundosDesdeCorrida(corrida: TicketCorridaLite | null | undefined): number {
  if (!corrida) return 0;
  if (corrida.segundos_transcurridos != null) return corrida.segundos_transcurridos;
  const acc = corrida.segundos_acumulados ?? 0;
  if (corrida.estado !== "activa") return acc;
  const anchor = corrida.reanudada_en || corrida.iniciada_en;
  if (!anchor) return acc;
  return acc + Math.max(0, Math.floor((Date.now() - parseUtcTs(anchor)) / 1000));
}

function corridaAnchorTs(corrida: TicketCorridaLite): number | null {
  if (corrida.estado !== "activa") return null;
  const anchor = corrida.reanudada_en || corrida.iniciada_en;
  return anchor ? parseUtcTs(anchor) : null;
}

async function ticketsFetch<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/tickets${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

type TicketConCorrida = {
  corrida?: TicketCorridaLite | null;
  segundos_trabajo?: number;
};

/**
 * Cronómetro de acción sincronizado con ticket_corridas en el servidor.
 * Sobrevive cerrar la app, cambiar de pestaña y «Continuar donde quedé».
 */
export function useTicketCronometro(ticketId: number, token: string, opts?: { autoResume?: boolean }) {
  const autoResume = opts?.autoResume !== false;
  const [segundos, setSegundos] = useState(0);
  const [activo, setActivo] = useState(false);
  const [corridaId, setCorridaId] = useState<number | null>(null);
  const [listo, setListo] = useState(false);
  const segBaseRef = useRef(0);
  const inicioRef = useRef<number | null>(null);
  const corridaIdRef = useRef<number | null>(null);
  const syncingRef = useRef(false);

  const tick = useCallback(() => {
    if (inicioRef.current == null) {
      setSegundos(segBaseRef.current);
      return;
    }
    const live = Math.floor((Date.now() - inicioRef.current) / 1000);
    setSegundos(segBaseRef.current + live);
  }, []);

  const aplicarCorrida = useCallback((corrida: TicketCorridaLite | null | undefined, segTrabajo?: number) => {
    if (!corrida || corrida.estado === "finalizada") {
      const total = segTrabajo ?? 0;
      segBaseRef.current = total;
      inicioRef.current = null;
      setCorridaId(null);
      corridaIdRef.current = null;
      setActivo(false);
      setSegundos(total);
      return;
    }
    const acc = corrida.segundos_acumulados ?? 0;
    segBaseRef.current = acc;
    setCorridaId(corrida.id);
    corridaIdRef.current = corrida.id;
    if (corrida.estado === "activa") {
      const anchor = corridaAnchorTs(corrida);
      inicioRef.current = anchor;
      setActivo(true);
      const live = anchor ? Math.floor((Date.now() - anchor) / 1000) : 0;
      setSegundos(acc + live);
    } else {
      inicioRef.current = null;
      setActivo(false);
      setSegundos(acc);
    }
  }, []);

  const syncDesdeServidor = useCallback(async (reanudarSiPausada = false) => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    try {
      let ticket = await ticketsFetch<TicketConCorrida>(`/${ticketId}`, token);
      let corrida = ticket.corrida;
      if (reanudarSiPausada && autoResume && ticket.corrida?.estado === "pausada") {
        ticket = await ticketsFetch<TicketConCorrida>(`/${ticketId}/corridas/iniciar`, token, {
          method: "POST",
          body: JSON.stringify({ segundos_previos: ticket.corrida?.segundos_acumulados ?? 0 }),
        });
        corrida = ticket.corrida;
      } else if (reanudarSiPausada && autoResume && !corrida && (ticket.segundos_trabajo ?? 0) >= 0) {
        try {
          ticket = await ticketsFetch<TicketConCorrida>(`/${ticketId}/corridas/iniciar`, token, {
            method: "POST",
            body: JSON.stringify({ segundos_previos: ticket.segundos_trabajo ?? 0 }),
          });
          corrida = ticket.corrida;
        } catch { /* sin corrida previa */ }
      }
      aplicarCorrida(corrida, ticket.segundos_trabajo);
    } finally {
      syncingRef.current = false;
      setListo(true);
    }
  }, [ticketId, token, autoResume, aplicarCorrida]);

  const pausar = useCallback(async () => {
    const cid = corridaIdRef.current;
    if (!cid || !activo) return;
    try {
      const ticket = await ticketsFetch<TicketConCorrida>(`/corridas/${cid}/pausar`, token, { method: "POST" });
      aplicarCorrida(ticket.corrida, ticket.segundos_trabajo);
    } catch {
      if (inicioRef.current != null) {
        const total = segBaseRef.current + Math.floor((Date.now() - inicioRef.current) / 1000);
        segBaseRef.current = total;
        inicioRef.current = null;
        setActivo(false);
        setSegundos(total);
      }
    }
  }, [token, activo, aplicarCorrida]);

  useEffect(() => {
    if (ticketId <= 0) {
      setListo(true);
      return;
    }
    void syncDesdeServidor(true);
  }, [ticketId, syncDesdeServidor]);

  useEffect(() => {
    const iv = setInterval(tick, 500);
    return () => clearInterval(iv);
  }, [tick]);

  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        void pausar();
      } else {
        void syncDesdeServidor(true);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      if (corridaIdRef.current && inicioRef.current != null) {
        void ticketsFetch(`/corridas/${corridaIdRef.current}/pausar`, token, { method: "POST" }).catch(() => {});
      }
    };
  }, [pausar, syncDesdeServidor, token]);

  return {
    segundos,
    activo,
    corridaId,
    listo,
    pausar,
    syncDesdeServidor,
    fmt: fmtTiempo,
  };
}

// ── Recordatorio programable dentro de una acción ────────────────────────────

const ALARMA_OPCIONES_MIN = [5, 10, 15, 20, 30, 45, 60, 90, 120];

function alarmaConfigKey(ticketId: number) {
  return `mckenna-accion-alarma-${ticketId}`;
}

function leerAlarmaConfig(ticketId: number): { activa: boolean; minutos: number } {
  try {
    const raw = localStorage.getItem(alarmaConfigKey(ticketId));
    if (!raw) return { activa: false, minutos: 15 };
    const p = JSON.parse(raw) as { activa?: boolean; minutos?: number };
    return { activa: !!p.activa, minutos: p.minutos && p.minutos > 0 ? p.minutos : 15 };
  } catch {
    return { activa: false, minutos: 15 };
  }
}

function guardarAlarmaConfig(ticketId: number, cfg: { activa: boolean; minutos: number }) {
  localStorage.setItem(alarmaConfigKey(ticketId), JSON.stringify(cfg));
}

function beepRecordatorio() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.value = 0.25;
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
    setTimeout(() => ctx.close(), 500);
  } catch { /* ignore */ }
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    navigator.serviceWorker?.ready
      .then((reg) => reg.showNotification("⏱ Acción en curso", {
        body: "Sigue trabajando en tu acción. Toca para volver.",
        tag: "accion-recordatorio",
      }))
      .catch(() => {});
  }
}

export function AccionAlarmaRecordatorio({
  ticketId,
  tituloAccion: _tituloAccion,
  cronometroActivo,
}: {
  ticketId: number;
  tituloAccion: string;
  cronometroActivo: boolean;
}) {
  const inicial = leerAlarmaConfig(ticketId);
  const [activa, setActiva] = useState(inicial.activa);
  const [minutos, setMinutos] = useState(inicial.minutos);
  const [countdown, setCountdown] = useState(0);
  const ultimaRef = useRef(Date.now());
  const minRef = useRef(minutos);

  useEffect(() => { minRef.current = minutos; }, [minutos]);

  useEffect(() => {
    guardarAlarmaConfig(ticketId, { activa, minutos });
    ultimaRef.current = Date.now();
  }, [ticketId, activa, minutos]);

  useEffect(() => {
    if (!activa || !cronometroActivo) {
      setCountdown(0);
      return;
    }
    ultimaRef.current = Date.now();
    const check = () => {
      const ms = minRef.current * 60_000;
      const elapsed = Date.now() - ultimaRef.current;
      if (elapsed >= ms) {
        ultimaRef.current = Date.now();
        beepRecordatorio();
      }
      setCountdown(Math.max(0, Math.ceil((ms - elapsed) / 1000)));
    };
    check();
    const iv = setInterval(check, 1000);
    return () => clearInterval(iv);
  }, [activa, cronometroActivo, minutos]);

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border/50 px-4 py-2 bg-surface-panel/80">
      <label className="flex items-center gap-2 text-xs font-bold text-muted cursor-pointer">
        <input
          type="checkbox"
          checked={activa}
          onChange={(e) => setActiva(e.target.checked)}
          className="rounded border-border accent-accent"
        />
        🔔 Recordatorio
      </label>
      {activa && (
        <>
          <select
            value={minutos}
            onChange={(e) => setMinutos(Number(e.target.value))}
            className="rounded-lg border border-border bg-surface px-2 py-1 text-xs font-bold text-ink"
            title="Cada cuánto recordar que la acción sigue en curso"
          >
            {ALARMA_OPCIONES_MIN.map((m) => (
              <option key={m} value={m}>{m} min</option>
            ))}
          </select>
          {cronometroActivo && countdown > 0 && (
            <span className="text-[10px] font-mono text-muted tabular-nums">
              próximo en {fmtTiempo(countdown)}
            </span>
          )}
        </>
      )}
      {!cronometroActivo && activa && (
        <span className="text-[10px] text-muted">activo al retomar</span>
      )}
    </div>
  );
}

const btnSm = "rounded-paper border-2 px-3 py-1.5 text-xs font-bold transition";
const btnMd = "rounded-paper border-2 px-4 py-2 text-sm font-bold transition";

/** Cronómetro local (antes de guardar o en formulario de creación). */
export function CronometroPanel({
  segundos,
  activo,
  onIniciar,
  onPausar,
  onReiniciar,
  onGuardar,
  guardando,
  subtitulo,
  etiqueta = "Cronómetro de misión",
  compact = false,
}: {
  segundos: number;
  activo: boolean;
  onIniciar: () => void;
  onPausar: () => void;
  onReiniciar: () => void;
  onGuardar?: () => void | Promise<void>;
  guardando?: boolean;
  subtitulo?: string;
  etiqueta?: string;
  compact?: boolean;
}) {
  const tiempoCls = compact ? "font-mono text-2xl font-black tabular-nums text-accent" : "font-mono text-4xl font-black tabular-nums text-accent";
  const btn = compact ? btnSm : btnMd;

  return (
    <div
      className={`rounded-paper border-2 border-accent/50 bg-accent/10 shadow-paper-sm
        ${compact ? "px-3 py-2" : "p-4"}`}
    >
      <div className={`flex flex-wrap items-center gap-3 ${compact ? "" : "justify-between gap-4"}`}>
        <div className={compact ? "min-w-[5.5rem]" : ""}>
          {!compact && <p className="text-[10px] font-bold uppercase text-muted">{etiqueta}</p>}
          <p className={tiempoCls}>{fmtTiempo(segundos)}</p>
          {!compact && (
            <p className="mt-1 text-xs text-muted">
              {subtitulo || (activo ? "En curso — marca el tiempo real" : "Pulsa iniciar al comenzar")}
            </p>
          )}
          {compact && (
            <p className="text-[10px] text-muted truncate max-w-[140px]">
              {activo ? "En curso" : subtitulo || etiqueta}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {activo ? (
            <button type="button" onClick={onPausar} className={`${btn} border-border bg-surface-panel`}>
              ⏸ Pausar
            </button>
          ) : (
            <button type="button" onClick={onIniciar} className={`${btn} border-accent bg-accent text-white`}>
              ▶ Iniciar
            </button>
          )}
          {onGuardar && (activo || segundos > 0) && (
            <button
              type="button"
              disabled={guardando}
              onClick={() => void onGuardar()}
              className={`${btn} border-sky-600 bg-sky-600 text-white disabled:opacity-50`}
              title="Guarda el tiempo acumulado sin cerrar el cronómetro"
            >
              💾 {compact ? "Guardar" : "Guardar tiempo"}
            </button>
          )}
          <button type="button" onClick={onReiniciar} className={`${btn} border-border text-muted`}>
            ↺
          </button>
        </div>
      </div>
    </div>
  );
}

/** Cronómetro persistido en servidor (misión / receta en elaboración). */
export function CorridaCronometroBlock({
  segundos,
  estado,
  onIniciar,
  onPausar,
  onReanudar,
  onGuardar,
  onFinalizar,
  guardando,
  etiqueta = "Cronómetro",
  compact = false,
}: {
  segundos: number;
  estado: "activa" | "pausada" | "finalizada" | null;
  onIniciar?: () => void;
  onPausar?: () => void;
  onReanudar?: () => void;
  onGuardar?: () => void | Promise<void>;
  onFinalizar?: () => void;
  guardando?: boolean;
  etiqueta?: string;
  compact?: boolean;
}) {
  const btn = compact ? btnSm : btnMd;
  const tiempoCls = compact ? "font-mono text-2xl font-black tabular-nums text-accent" : "font-mono text-4xl font-black tabular-nums text-accent";

  if (estado === "finalizada") {
    return (
      <div className={`rounded-paper border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 ${compact ? "px-3 py-2" : "px-4 py-3"}`}>
        <p className={`font-semibold text-emerald-800 dark:text-emerald-300 ${compact ? "text-xs" : "text-sm"}`}>
          ⏱ {fmtTiempo(segundos)}
        </p>
      </div>
    );
  }

  if (!estado) {
    return (
      <button
        type="button"
        onClick={onIniciar}
        className={`w-full rounded-paper border-2 border-accent bg-accent/10 font-bold text-accent hover:bg-accent hover:text-white
          ${compact ? "px-3 py-2 text-xs" : "px-4 py-3 text-sm"}`}
      >
        ▶ Iniciar {compact ? "" : etiqueta.toLowerCase()}
      </button>
    );
  }

  return (
    <div className={`rounded-paper border-2 border-accent/50 bg-accent/10 ${compact ? "px-3 py-2" : "p-4 shadow-paper-sm"}`}>
      <div className={`flex flex-wrap items-center gap-3 ${compact ? "" : "justify-between gap-4"}`}>
        <div>
          {!compact && <p className="text-[10px] font-bold uppercase text-muted">{etiqueta}</p>}
          <p className={tiempoCls}>{fmtTiempo(segundos)}</p>
          <p className={`text-muted ${compact ? "text-[10px]" : "mt-1 text-xs"}`}>
            {estado === "activa" ? "En curso" : "En pausa"}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {estado === "activa" ? (
            <button type="button" onClick={onPausar} className={`${btn} border-border bg-surface-panel`}>
              ⏸ Pausar
            </button>
          ) : (
            <button type="button" onClick={onReanudar} className={`${btn} border-accent bg-accent text-white`}>
              ▶ Reanudar
            </button>
          )}
          {onGuardar && (
            <button
              type="button"
              disabled={guardando}
              onClick={() => void onGuardar()}
              className={`${btn} border-sky-600 bg-sky-600 text-white disabled:opacity-50`}
              title="Guarda el tiempo acumulado sin cerrar el cronómetro"
            >
              💾 {compact ? "Guardar" : "Guardar tiempo"}
            </button>
          )}
          <button type="button" onClick={onFinalizar} className={`${btn} border-emerald-500 bg-emerald-500 text-white`}>
            ✓ {compact ? "Fin" : "Finalizar"}
          </button>
        </div>
      </div>
    </div>
  );
}
