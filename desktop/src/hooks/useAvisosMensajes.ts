import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { isMcKennaAndroidApp, webNotificationsAvailable } from "../lib/androidApp";
import { reproducirSonido, sonidoDeMensaje, sonidoDeSolicitud, sonidoPorId, useAlertasSonido } from "../lib/alertasSonido";
import { recibirZumbido } from "../lib/zumbido";
import { useResumenMensajes } from "./useCanalesEquipo";

/**
 * Avisos de mensajes nuevos en los grupos (app/services/canales_avisos.py).
 *  - App a la vista: cuando sube el contador de no leídos se piden las novedades y se
 *    muestra una tarjeta con un sonido corto.
 *  - App cerrada o en segundo plano: Web Push al Service Worker (sw-alarm.js); este
 *    hook registra la suscripción del dispositivo en /api/canales/push.
 *  - Solicitud nueva que otra persona te hizo (`solicitudes_para_mi` del resumen): tarjeta
 *    y el sonido elegido para quien la pidió.
 *  - Zumbido de una solicitud (`zumbidos` del resumen): la pantalla tiembla, zumba y sale
 *    la tarjeta; se marca visto para que no vuelva a sonar (lib/zumbido.tsx).
 * El sonido sale de las alertas sonoras de cada quien (lib/alertasSonido.ts): por grupo,
 * por persona o el general, con recortes de Duck Hunt y Circus Charlie.
 */

export type AvisoMensaje = {
  id: number;
  /** "solicitud" y "zumbido": `id` es el del ticket y `canal_id` va en 0. */
  tipo?: "mensaje" | "solicitud" | "zumbido";
  canal_id: number;
  canal_nombre: string;
  autor_nombre: string;
  texto: string;
  /** Icono del sonido que sonó (la tarjeta lo muestra para asociar oído y vista). */
  icono?: string;
  /** El mensaje nombra con @ a quien lo recibe. */
  mencion?: boolean;
};

type Novedades = {
  ultimo_id: number;
  mensajes: { id: number; canal_id: number; usuario_id: number | null; canal_nombre: string; autor_nombre: string; texto: string; adjunto_nombre: string | null; mencion?: boolean }[];
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
  const solicitudesVistas = useRef<Set<number> | null>(null);
  const solicitudes = resumen.data?.solicitudes_para_mi;

  // Solicitudes que otra persona me acaba de hacer: las que ya estaban al abrir no suenan.
  useEffect(() => {
    if (!solicitudes) return;
    const vistas = solicitudesVistas.current;
    solicitudesVistas.current = new Set([...(vistas ?? []), ...solicitudes.map((x) => x.id)]);
    if (!vistas) return;
    const nueva = solicitudes.find((x) => !vistas.has(x.id));
    if (!nueva) return;
    const sonido = sonidoDeSolicitud(useAlertasSonido.getState().ajustes, nueva.creado_por);
    setAviso({ id: nueva.id, tipo: "solicitud", canal_id: 0, canal_nombre: nueva.numero, autor_nombre: nueva.creado_por_nombre || "Alguien",
      texto: nueva.titulo, icono: sonidoPorId(sonido)?.icono });
    if (!document.hidden) reproducirSonido(sonido);
  }, [solicitudes]);

  // Zumbidos: suenan una vez (aunque la app esté en otra pestaña, así se nota al volver).
  const zumbidos = resumen.data?.zumbidos;
  const zumbidosVistos = useRef<Set<number>>(new Set());
  useEffect(() => {
    const nuevos = (zumbidos ?? []).filter((z) => !zumbidosVistos.current.has(z.id));
    if (!nuevos.length) return;
    nuevos.forEach((z) => zumbidosVistos.current.add(z.id));
    const z = nuevos[0];
    recibirZumbido();
    setAviso({ id: z.ticket_id, tipo: "zumbido", canal_id: 0, canal_nombre: z.numero, autor_nombre: z.de_nombre || "Alguien",
      texto: z.titulo, icono: "📳" });
    api.post("/api/tickets/zumbidos/vistos", { ids: nuevos.map((x) => x.id) }).catch(() => {});
  }, [zumbidos]);

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
        const visibles = r.mensajes.filter((x) => x.canal_id !== noMostrarCanal && !(canalesEnPantalla.has(x.canal_id) && !document.hidden));
        // Si alguno te nombra con @, ese es el que se muestra.
        const m = visibles.find((x) => x.mencion) ?? visibles[0];
        if (!m) return;
        const sonido = sonidoDeMensaje(useAlertasSonido.getState().ajustes, m.canal_id, m.usuario_id);
        setAviso({ id: m.id, tipo: "mensaje", canal_id: m.canal_id, canal_nombre: m.canal_nombre, autor_nombre: m.autor_nombre,
          texto: m.texto || (m.adjunto_nombre ? "📎 Adjunto" : "Mensaje nuevo"), icono: sonidoPorId(sonido)?.icono, mencion: Boolean(m.mencion) });
        if (!document.hidden) reproducirSonido(sonido);
      })
      .catch(() => {});
  }, [n]); // eslint-disable-line react-hooks/exhaustive-deps

  // La tarjeta se va sola.
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), aviso.tipo === "mensaje" ? 9000 : 15000);
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
