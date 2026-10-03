import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTicketsAuth } from "../stores/ticketsAuth";
import { useAppStore } from "../stores/app";
import { ORIGEN_APP } from "../lib/flujoApp";
import { isMcKennaAndroidApp, mckennaAndroidBridge, webNotificationsAvailable } from "../lib/androidApp";
import {
  esHorarioSilencio,
  marcarAvisoTarea,
  msDesdeUltimoAviso,
  playAlarmAudio,
  unlockAudioContext,
} from "../lib/avisoTareaEnCurso";
import { fmtTiempo, parseUtcTs } from "./Cronometro";

/**
 * Reloj de la tarea en curso, en el cabezote de TODAS las pantallas (27-sep-2026).
 *
 * Quien iniciaba una actividad y se iba al Mapa (o bloqueaba el celular) dejaba de ver su
 * cronómetro, y el aviso «Pilas, veci: tiene una tarea en proceso» solo sonaba dentro de la
 * vista Acciones, que ya casi nunca está montada. Aquí se ve siempre lo que corre, se pausa o
 * se reanuda con un toque, y cada AVISO_MIN minutos suena el aviso de voz mientras haya un
 * cronómetro activo. Con el APK de Android el aviso lo da la alarma nativa (suena con la
 * pantalla apagada); en el navegador, la notificación del service worker.
 */

type EnCurso = {
  corrida_id: number;
  ticket_id: number;
  numero: string;
  titulo: string;
  estado: "activa" | "pausada";
  segundos_acumulados: number;
  iniciada_en: string;
  reanudada_en: string | null;
};

const AVISO_MIN = 15;
const CLAVE_VOZ = "mck-aviso-tarea-voz";

function leerVoz(): boolean {
  try { return localStorage.getItem(CLAVE_VOZ) !== "0"; } catch { return true; }
}

function segundosDe(c: EnCurso): number {
  if (c.estado !== "activa") return c.segundos_acumulados ?? 0;
  const anchor = c.reanudada_en || c.iniciada_en;
  return (c.segundos_acumulados ?? 0) + Math.max(0, Math.floor((Date.now() - parseUtcTs(anchor)) / 1000));
}

async function tickets<T>(path: string, token: string, method = "GET"): Promise<T> {
  const res = await fetch(`/api/tickets${path}${method === "GET" ? `?_t=${Date.now()}` : ""}`, {
    method,
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export default function TareaEnCurso({ compacto = false }: { compacto?: boolean }) {
  const token = useTicketsAuth((s) => s.token);
  const apiToken = useTicketsAuth((s) => s.apiToken);
  const setPanel = useAppStore((s) => s.setPanel);
  const setTicketsBootView = useAppStore((s) => s.setTicketsBootView);
  const setAccionesBootTab = useAppStore((s) => s.setAccionesBootTab);
  const setCentroMandoView = useAppStore((s) => s.setCentroMandoView);
  const qc = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [voz, setVoz] = useState(leerVoz);
  const [, setTick] = useState(0);
  const [ocupado, setOcupado] = useState<number | null>(null);
  const [confirmarFin, setConfirmarFin] = useState<number | null>(null);

  const q = useQuery({
    queryKey: ["tareas-en-curso", token],
    queryFn: () => tickets<EnCurso[]>("/corridas/en-curso", token!),
    enabled: !!token,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const lista = q.data ?? [];
  const activas = lista.filter((c) => c.estado === "activa");
  const hayActiva = activas.length > 0;

  // El reloj avanza en el navegador; el servidor solo se relee cada 30 s.
  useEffect(() => {
    if (!hayActiva) return;
    const iv = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, [hayActiva]);

  // Android Chrome solo deja sonar audio sin gesto si el contexto se abrió con un toque.
  useEffect(() => {
    const unlock = () => unlockAudioContext();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  // Alarma nativa del APK y push del navegador: se encienden mientras haya un cronómetro
  // activo. Solo se avisa en los cambios, para no pelear con la vista Acciones.
  const prevHayActiva = useRef<boolean | null>(null);
  useEffect(() => {
    if (!q.isSuccess || prevHayActiva.current === hayActiva) return;
    prevHayActiva.current = hayActiva;
    const encender = hayActiva && voz;
    const bridge = mckennaAndroidBridge();
    if (bridge?.syncAlarma) {
      bridge.syncAlarma(encender, AVISO_MIN, hayActiva, encender);
      return;
    }
    if (isMcKennaAndroidApp() || !token || !("serviceWorker" in navigator) || !webNotificationsAvailable()) return;
    if (globalThis.Notification.permission !== "granted") return;
    void (async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration("/app/");
        const sub = await reg?.pushManager?.getSubscription();
        if (!sub) return;
        await fetch("/api/voz/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ subscription: sub.toJSON(), minutes: AVISO_MIN, active: encender }),
        });
      } catch { /* el push es opcional */ }
    })();
  }, [q.isSuccess, hayActiva, voz, token]);

  // Aviso de voz con la app abierta. La marca es compartida con la vista Acciones.
  const hayActivaRef = useRef(hayActiva);
  const vozRef = useRef(voz);
  useEffect(() => { hayActivaRef.current = hayActiva; }, [hayActiva]);
  useEffect(() => { vozRef.current = voz; }, [voz]);
  useEffect(() => {
    const check = () => {
      if (!hayActivaRef.current || !vozRef.current || esHorarioSilencio()) return;
      if (msDesdeUltimoAviso() < AVISO_MIN * 60_000) return;
      marcarAvisoTarea();
      if (!document.hidden) {
        void playAlarmAudio(apiToken ?? token ?? undefined);
      } else if (!isMcKennaAndroidApp()) {
        const ctrl = navigator.serviceWorker?.controller;
        if (ctrl && webNotificationsAvailable() && globalThis.Notification.permission === "granted") {
          ctrl.postMessage({ type: "alarm-notification" });
        }
      }
    };
    const iv = setInterval(check, 10_000);
    return () => clearInterval(iv);
  }, [apiToken, token]);

  const accion = useCallback(async (c: EnCurso, que: "pausar" | "reanudar" | "finalizar") => {
    if (!token) return;
    setOcupado(c.corrida_id);
    setConfirmarFin(null);
    try {
      await tickets(`/corridas/${c.corrida_id}/${que}`, token, "POST");
      if (que === "reanudar") marcarAvisoTarea();
    } catch { /* se relee abajo */ }
    finally {
      setOcupado(null);
      void qc.invalidateQueries({ queryKey: ["tareas-en-curso"] });
    }
  }, [token, qc]);

  const cambiarVoz = () => {
    const v = !voz;
    setVoz(v);
    try { localStorage.setItem(CLAVE_VOZ, v ? "1" : "0"); } catch { /* */ }
    prevHayActiva.current = null; // re-sincroniza la alarma nativa / push con la nueva preferencia
  };

  const irAAcciones = () => {
    setAbierto(false);
    setAccionesBootTab("activas");
    setTicketsBootView("acciones");
    setCentroMandoView("acciones");
    setPanel(ORIGEN_APP.panel);
  };

  if (!token || lista.length === 0) return null;
  const principal = activas[0] ?? lista[0];
  const enPausa = principal.estado !== "activa";

  return (
    <div className="relative">
      <button
        type="button"
        data-sin-sonido
        onClick={() => setAbierto((v) => !v)}
        title={`${principal.titulo} — ${enPausa ? "en pausa" : "en curso"}`}
        className={`mck-press flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[12px] font-bold transition ${
          enPausa ? "border-border text-muted" : "border-accent bg-accent/10 text-accent"
        }`}
      >
        {!enPausa && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent animate-pulse" />}
        <span className="font-mono tabular-nums">{fmtTiempo(segundosDe(principal))}</span>
        {!compacto && <span className="hidden max-w-[160px] truncate md:inline">{principal.titulo}</span>}
        {enPausa && <span className="text-[10px] font-semibold">en pausa</span>}
        {lista.length > 1 && <span className="text-[10px] font-semibold">+{lista.length - 1}</span>}
      </button>

      {abierto && (
        <>
          <div className="fixed inset-0 z-[69]" onMouseDown={() => setAbierto(false)} />
          <div role="dialog" aria-label="Tareas en curso"
            className="absolute right-0 top-10 z-[70] w-[min(92vw,360px)] overflow-hidden rounded-2xl border border-border bg-surface shadow-paper-lg">
            <p className="px-3 pt-2.5 text-[12.5px] font-bold text-ink">Tus tareas con cronómetro</p>
            <p className="px-3 pb-2 text-[11px] text-muted">
              Sigue contando aunque bloquees el celular o cambies de pantalla. Solo ⏸ lo pausa y ✓ lo termina.
            </p>
            <ul className="max-h-[50vh] divide-y divide-border overflow-y-auto border-t border-border">
              {lista.map((c) => (
                <li key={c.corrida_id} className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-semibold text-ink">{c.titulo}</p>
                    <p className="font-mono text-[11px] text-muted">
                      {fmtTiempo(segundosDe(c))} · {c.estado === "activa" ? "en curso" : "en pausa"}
                    </p>
                  </div>
                  {confirmarFin === c.corrida_id ? (
                    <>
                      <button
                        type="button"
                        disabled={ocupado === c.corrida_id}
                        onClick={() => void accion(c, "finalizar")}
                        title="Detiene el cronómetro y guarda el tiempo en la bitácora. La tarea sigue abierta."
                        className="shrink-0 rounded-lg border border-emerald-500 bg-emerald-500 px-2.5 py-1.5 text-[12px] font-bold text-white disabled:opacity-50"
                      >
                        ✓ Sí, finalizar
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmarFin(null)}
                        className="shrink-0 rounded-lg border border-border px-2 py-1.5 text-[12px] font-bold text-muted"
                      >
                        No
                      </button>
                    </>
                  ) : (<>
                  <button
                    type="button"
                    disabled={ocupado === c.corrida_id}
                    onClick={() => void accion(c, c.estado === "activa" ? "pausar" : "reanudar")}
                    className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-[12px] font-bold disabled:opacity-50 ${
                      c.estado === "activa" ? "border-border text-ink" : "border-accent bg-accent text-white"
                    }`}
                  >
                    {c.estado === "activa" ? "⏸ Pausar" : "▶ Reanudar"}
                  </button>
                  <button
                    type="button"
                    disabled={ocupado === c.corrida_id}
                    onClick={() => setConfirmarFin(c.corrida_id)}
                    title="Finalizar el cronómetro de esta tarea"
                    className="shrink-0 rounded-lg border border-emerald-500 px-2.5 py-1.5 text-[12px] font-bold text-emerald-700 disabled:opacity-50 dark:text-emerald-300"
                  >
                    ✓ Fin
                  </button>
                  </>)}
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
              <label className="flex cursor-pointer items-center gap-1.5 text-[11.5px] text-muted">
                <input type="checkbox" checked={voz} onChange={cambiarVoz} className="accent-accent" />
                Aviso de voz cada {AVISO_MIN} min
              </label>
              <button type="button" onClick={irAAcciones} className="text-[12px] font-bold text-accent underline">
                Ir a mis acciones →
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
