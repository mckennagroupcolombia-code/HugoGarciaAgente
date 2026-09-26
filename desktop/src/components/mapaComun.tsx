/**
 * Lo que comparten las dos vistas de la pantalla de inicio: el tablero (MapaVivo.tsx) y el
 * edificio (MapaEdificio.tsx). Los datos de cada etapa se calculan UNA vez en MapaVivo y las
 * dos vistas los dibujan distinto: así no pueden contar cosas diferentes.
 */
import type { EtapaApp, TramoApp } from "../lib/flujoApp";
import { ETAPAS_APP, ORIGEN_APP } from "../lib/flujoApp";
import { puedeVerSeccionPanel } from "../lib/panelAccess";
import { useAppStore, type Panel } from "../stores/app";
import { useTicketsAuth } from "../stores/ticketsAuth";
import type { SpriteId } from "./colaboradores/pixel";
import { puedeVerTabInicio } from "./nav/InicioNavTabs";

/** Color de cada etapa (paleta PICO-8) y si su título va en tinta oscura. */
export const COLOR: Record<string, { fondo: string; tinta: string; s: SpriteId }> = {
  abastecer: { fondo: "#AB5236", tinta: "#FFF1E8", s: "cofre" },
  preparar: { fondo: "#FFA300", tinta: "#000000", s: "bloques" },
  publicar: { fondo: "#29ADFF", tinta: "#000000", s: "ventana" },
  vender: { fondo: "#006B3F", tinta: "#FFF1E8", s: "moneda" },
  entregar: { fondo: "#C8003E", tinta: "#FFF1E8", s: "camion" },
  facturar: { fondo: "#7E2553", tinta: "#FFF1E8", s: "doc" },
  contar: { fondo: "#1D2B53", tinta: "#FFF1E8", s: "datos" },
  dirigir: { fondo: "#5F574F", tinta: "#FFF1E8", s: "estrella" },
  sistema: { fondo: "#83769C", tinta: "#000000", s: "control" },
};
export const COLOR_DEF = { fondo: "#5F574F", tinta: "#FFF1E8", s: "datos" as SpriteId };

export type Bloqueo = { etapa: string; id: string; n: number; texto: string; panel: string; severidad: "alta" | "media" };
export type Bloqueos = { por_etapa: Record<string, { alta: number; media: number; items: Bloqueo[] }> };
/** Lo que titila en un panel: cuántas cosas urgentes y por qué (para el título al pasar). */
export type Urgencia = { n: number; porque: string[] };

export type TramoVisible = TramoApp & { visibles: { panel: Panel; hace: string }[] };
export type DatosEtapa = {
  etapa: EtapaApp;
  tramos: TramoVisible[];
  participa: boolean;
  nivel: number;
  bloqueos?: { alta: number; media: number; items: Bloqueo[] };
  mias: number;
  /** Paneles de esta etapa que titilan: lo detenido grave + tus solicitudes urgentes. */
  urgentes: Record<string, Urgencia>;
  guia: boolean;
  ancha: boolean;
};
export type DatosOrigen = { nombre: string; pedidas: number; urgentes: number; recordatorios: number; puede: boolean };

/** Lo que antes estaba en el menú de arriba con la Agenda abierta: sus vistas y los espacios
 *  que viven dentro de ella (no son etapas del negocio). Se abren desde Inicio. */
const DENTRO_DE_LA_AGENDA: Panel[] = ["chat-equipo", "colaboradores", "juegos"];

/** Las acciones de Inicio (Mi agenda, Mensajes, los espacios del equipo) con la regla de permisos
 *  de la Agenda. `abrir` decide CÓMO se llega (en el tablero la cámara se acerca; en el edificio
 *  sube el ascensor). */
export function useInicio(abrir: (p: Panel) => void) {
  const user = useTicketsAuth((s) => s.user);
  const token = useTicketsAuth((s) => s.token);
  const setCentroMandoView = useAppStore((s) => s.setCentroMandoView);
  const setTicketsBootView = useAppStore((s) => s.setTicketsBootView);
  const setAccionesBootTab = useAppStore((s) => s.setAccionesBootTab);
  const nivel = user?.rol?.nivel ?? 1;
  const permisos = user?.permisos_secciones;
  const verMensajes = puedeVerTabInicio(permisos, nivel, "acciones") || puedeVerTabInicio(permisos, nivel, "solicitudes");
  // Igual que las pestañas de la Agenda (InicioNavTabs): la vista se fija ANTES de abrir.
  const vistaAgenda = (vista: "home" | "mensajes") => {
    setAccionesBootTab(null);
    setTicketsBootView(vista);
    setCentroMandoView(vista);
    abrir(ORIGEN_APP.panel);
  };
  const espacios = DENTRO_DE_LA_AGENDA.filter((p) => user && puedeVerSeccionPanel(user, p));
  return { user, token, verMensajes, vistaAgenda, espacios };
}

// ─── Los pisos del Edificio ─────────────────────────────────────────────────────────────
// Cada etapa es un piso: la mercancía entra por Abastecer (P1) y sube hasta Contar; Dirigir
// es el último piso y Sistema el sótano. El cabezote de cada módulo lleva la misma placa
// («P5»), así que el módulo abierto y el edificio dicen lo mismo.

const PISOS_DE_ARRIBA = ["dirigir", "contar", "facturar", "entregar", "vender", "publicar", "preparar"];
export const SOTANO = "sistema";
const BASE = "abastecer";

/** Las etapas de arriba abajo, sin el sótano. Lo que flujoApp.ts agregue entra sobre Abastecer. */
export function pisosDelEdificio(ids: string[]): string[] {
  const conocidos = new Set([...PISOS_DE_ARRIBA, SOTANO, BASE]);
  const otros = ids.filter((id) => !conocidos.has(id));
  const hay = new Set(ids);
  return [...PISOS_DE_ARRIBA, ...otros, BASE].filter((id) => hay.has(id));
}

/** «P5», «S1»… la placa del piso de una etapa (null si no es una etapa). */
export function placaDePiso(etapaId: string): string | null {
  if (etapaId === SOTANO) return "S1";
  const pisos = pisosDelEdificio(ETAPAS_APP.map((e) => e.id));
  const i = pisos.indexOf(etapaId);
  return i < 0 ? null : `P${pisos.length - i}`;
}
