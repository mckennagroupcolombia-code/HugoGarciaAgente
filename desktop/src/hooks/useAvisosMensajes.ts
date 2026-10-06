import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { isMcKennaAndroidApp, webNotificationsAvailable } from "../lib/androidApp";
import { useResumenMensajes } from "./useCanalesEquipo";

/**
 * Avisos de mensajes nuevos en los grupos (app/services/canales_avisos.py).
 *  - App a la vista: cuando sube el contador de no leídos se piden las novedades y se
 *    muestra una tarjeta con un sonido corto.
 *  - App cerrada o en segundo plano: Web Push al Service Worker (sw-alarm.js); este
 *    hook registra la suscripción del dispositivo en /api/canales/push.
 */

export type AvisoMensaje = { id: number; canal_id: number; canal_nombre: string; autor_nombre: string; texto: string };

type Novedades = {
  ultimo_id: number;
  mensajes: { id: number; canal_id: number; canal_nombre: string; autor_nombre: string; texto: string; adjunto_nombre: string | null }[];
};

/** Grupos que alguien tiene abiertos en pantalla ahora (HiloCanal los anota): de esos no se avisa. */
export const canalesEnPantalla = new Set<number>();

export type PermisoAvisos = "activo" | "pendiente" | "bloqueado" | "no-disponible";

function permisoActual(): PermisoAvisos {
  if (isMcKennaAndroidApp() || !webNotificationsAvailable() || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return "no-disponible";
  }
  const p = globalThis.Notification.permission;
  return p === "granted" ? "activo" : p === "denied" ? "bloqueado" : "pendiente";
}

let ctxAudio: AudioContext | null = null;

/** Dos notas cortas (sin archivo de audio). Si el navegador aún no deja sonar, se calla. */
function sonar() {
  try {
    ctxAudio = ctxAudio ?? new AudioContext();
    const ctx = ctxAudio;
    if (ctx.state === "suspended") void ctx.resume();
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const t = ctx.currentTime + i * 0.12;
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.2);
    });
  } catch {
    /* sin audio */
  }
}

function base64AUint8(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function suscribirDispositivo(): Promise<void> {
  const kr = await fetch("/api/voz/push/vapid-key");
  const { publicKey, disponible } = (await kr.json()) as { publicKey: string; disponible: boolean };
  if (!disponible || !publicKey) return;
  // El mismo Service Worker y alcance que la alarma de tareas (TicketsPanel).
  const reg = await navigator.serviceWorker.register("/app/sw-alarm.js", { scope: "/app/" });
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64AUint8(publicKey) as BufferSource }));
  await api.post("/api/canales/push", { subscription: sub.toJSON() });
}

export function useAvisosMensajes(activo: boolean, noMostrarCanal: number | null) {
  const resumen = useResumenMensajes(activo);
  const n = resumen.data?.canales_no_leidos ?? null;
  const ultimoId = useRef<number | null>(null);
  const prevN = useRef<number | null>(null);
  const [aviso, setAviso] = useState<AvisoMensaje | null>(null);
  const [permiso, setPermiso] = useState<PermisoAvisos>(permisoActual);

  // Punto de partida: lo que ya existía al abrir la app no se avisa.
  useEffect(() => {
    if (!activo) return;
    api.get<Novedades>("/api/canales/novedades?inicio=1")
      .then((r) => { ultimoId.current = r.ultimo_id; })
      .catch(() => {});
  }, [activo]);

  // Con permiso ya concedido, el dispositivo queda suscrito sin preguntar nada.
  useEffect(() => {
    if (activo && permiso === "activo") suscribirDispositivo().catch(() => {});
  }, [activo, permiso]);

  useEffect(() => {
    if (n == null) return;
    const antes = prevN.current;
    prevN.current = n;
    if (antes == null || n <= antes || ultimoId.current == null) return;
    api.get<Novedades>(`/api/canales/novedades?desde=${ultimoId.current}`)
      .then((r) => {
        ultimoId.current = r.ultimo_id;
        const m = r.mensajes.find((x) => x.canal_id !== noMostrarCanal && !(canalesEnPantalla.has(x.canal_id) && !document.hidden));
        if (!m) return;
        setAviso({ id: m.id, canal_id: m.canal_id, canal_nombre: m.canal_nombre, autor_nombre: m.autor_nombre,
          texto: m.texto || (m.adjunto_nombre ? "📎 Adjunto" : "Mensaje nuevo") });
        if (!document.hidden) sonar();
      })
      .catch(() => {});
  }, [n]); // eslint-disable-line react-hooks/exhaustive-deps

  // La tarjeta se va sola.
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 9000);
    return () => clearTimeout(t);
  }, [aviso]);

  const activarAvisos = useCallback(async () => {
    if (permisoActual() === "no-disponible") return;
    const p = await globalThis.Notification.requestPermission();
    setPermiso(permisoActual());
    if (p === "granted") await suscribirDispositivo().catch(() => {});
  }, []);

  return { aviso, cerrarAviso: () => setAviso(null), permiso, activarAvisos };
}
