import { useEffect, useMemo, useState } from "react";
import { useConversaciones, type Conversacion } from "../hooks/useConversaciones";
import { useCanalesEquipo, type CanalEquipo } from "../hooks/useCanalesEquipo";
import { useTicketsAuth } from "../stores/ticketsAuth";
import { puedeVerSeccionPanel } from "./panelAccess";
import { fechaServidorToDate, uidEq } from "../components/tickets/ticketsFormat";

/**
 * La bandeja personal (7-oct-2026): solicitudes, acciones y grupos en una sola lista, repartidos
 * en lo que a la persona le TOCA hacer, lo que tiene que SABER y lo que ESTÁ HACIENDO.
 * Una sola regla y un solo número («por atender») para la bandeja del celular, la barra de
 * abajo y la burbuja de chat: antes cada una contaba distinto (17 · 83 · 14).
 */
export type SeccionBandeja = "te_toca" | "enterarte" | "haciendo" | "hechas";

export type ItemBandeja =
  | { kind: "solicitud"; key: string; ts: number; noLeidos: number; c: Conversacion }
  | { kind: "grupo"; key: string; ts: number; noLeidos: number; g: CanalEquipo };

/** Dónde cae una solicitud/acción para quien mira (`uid`). */
export function seccionDe(c: Conversacion, uid: number): SeccionBandeja {
  const mia = uidEq(c.asignado_a, uid);
  const lapedi = uidEq(c.creado_por, uid);
  switch (c.estado) {
    case "pendiente":
      // Asignada a mí, o sin dueño y pedida por otra persona: me toca. Si la pedí yo, espero.
      return mia || (c.asignado_a == null && !lapedi) ? "te_toca" : "enterarte";
    case "esperando_aprobacion":
      // Entregada: a quien la pidió le toca finalizarla; quien la hizo solo se entera.
      return lapedi ? "te_toca" : "enterarte";
    case "en_proceso":
      return mia ? "haciendo" : "enterarte";
    default:
      // Cerrada: al historial aunque tenga mensajes sin leer. Casi siempre son avisos automáticos
      // («Pago #69 girado…») que llenaban «Enterarte» de cosas ya resueltas.
      return "hechas";
  }
}

function tsServidor(s: string | null | undefined): number {
  if (!s) return 0;
  const t = fechaServidorToDate(s).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Lo sin leer primero; después lo que se movió más reciente. */
function ordenar(items: ItemBandeja[]): ItemBandeja[] {
  return [...items].sort((a, b) => (b.noLeidos > 0 ? 1 : 0) - (a.noLeidos > 0 ? 1 : 0) || b.ts - a.ts);
}

function puedeVerTipo(permisos: Record<string, boolean> | null | undefined, nivel: number, tab: "acciones" | "solicitudes") {
  if (nivel >= 3 || !permisos) return true;
  return Boolean(permisos[`tickets_${tab}`]);
}

export function useBandeja() {
  const user = useTicketsAuth((s) => s.user);
  const uid = user?.id ?? -1;
  const nivel = user?.rol?.nivel ?? 1;
  const verAcciones = puedeVerTipo(user?.permisos_secciones, nivel, "acciones");
  const verSolicitudes = puedeVerTipo(user?.permisos_secciones, nivel, "solicitudes");
  const verGrupos = Boolean(user && puedeVerSeccionPanel(user, "chat-equipo"));

  // Mismas claves de caché que el resto del panel: no agrega consultas nuevas.
  const conv = useConversaciones("todas", "mias");
  const canales = useCanalesEquipo(verGrupos);

  return useMemo(() => {
    const secciones: Record<SeccionBandeja, ItemBandeja[]> = { te_toca: [], enterarte: [], haciendo: [], hechas: [] };
    for (const c of conv.data ?? []) {
      if (c.tipo === "accion" ? !verAcciones : !verSolicitudes) continue;
      secciones[seccionDe(c, uid)].push({
        kind: "solicitud", key: `s${c.id}`, ts: tsServidor(c.ultima_actividad), noLeidos: c.no_leidos || 0, c,
      });
    }
    // Los grupos con mensajes sin leer son para enterarse; el resto queda en «Todos los grupos».
    const grupos: ItemBandeja[] = [];
    for (const g of verGrupos ? canales.data?.canales ?? [] : []) {
      if (g.archivado) continue;
      const it: ItemBandeja = { kind: "grupo", key: `g${g.id}`, ts: (g.ultimo?.creado_en ?? 0) * 1000, noLeidos: g.no_leidos || 0, g };
      if (it.noLeidos > 0) secciones.enterarte.push(it);
      grupos.push(it);
    }
    for (const k of Object.keys(secciones) as SeccionBandeja[]) secciones[k] = ordenar(secciones[k]);
    // Por atender: lo que me toca + todo lo demás que tenga algo sin leer (cada cosa cuenta una vez).
    const conAlgoNuevo = [...secciones.enterarte, ...secciones.haciendo].filter((i) => i.noLeidos > 0).length;
    return {
      ...secciones,
      grupos: ordenar(grupos),
      porAtender: secciones.te_toca.length + conAlgoNuevo,
      cargando: conv.isLoading,
      error: conv.isError ? conv.error : null,
      reintentar: () => { void conv.refetch(); void canales.refetch(); },
      puedeAdministrarGrupos: Boolean(canales.data?.puede_administrar),
    };
  }, [conv.data, conv.isLoading, conv.isError, conv.error, canales.data, uid, verAcciones, verSolicitudes, verGrupos]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Pantalla angosta (lista e hilo no caben lado a lado): ahí la bandeja es la unificada. */
export function useBandejaAngosta(): boolean {
  const consulta = "(max-width: 1023px)";
  const [angosta, setAngosta] = useState(() => typeof window !== "undefined" && window.matchMedia(consulta).matches);
  useEffect(() => {
    const mq = window.matchMedia(consulta);
    const cambio = (e: MediaQueryListEvent) => setAngosta(e.matches);
    mq.addEventListener("change", cambio);
    return () => mq.removeEventListener("change", cambio);
  }, []);
  return angosta;
}
