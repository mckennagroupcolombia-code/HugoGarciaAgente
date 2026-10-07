/**
 * Lo que comparte el Mapa (MapaVivo.tsx) con el resto del panel: los colores de cada etapa
 * (Layout los usa para teñir el módulo abierto) y los accesos de la Agenda. El Edificio se
 * retiró el 7-oct-2026: el Mapa es la única vista de inicio.
 */
import type { EtapaApp, TramoApp } from "../lib/flujoApp";
import { ORIGEN_APP } from "../lib/flujoApp";
import { puedeVerSeccionPanel } from "../lib/panelAccess";
import { useAppStore, type AccionesBootTab, type Panel } from "../stores/app";
import { useTicketsAuth } from "../stores/ticketsAuth";
import type { SpriteId } from "./colaboradores/pixel";
import { puedeVerTabInicio } from "./nav/InicioNavTabs";

/** Color de cada etapa (paleta PICO-8) y si su título va en tinta oscura. Son variables CSS con
 *  ese color por defecto: cada tema pone su propia gama en theme/mapa-temas.css. */
export const COLOR: Record<string, { fondo: string; tinta: string; s: SpriteId }> = {
  abastecer: { fondo: "var(--ed-piso-abastecer, #AB5236)", tinta: "var(--ed-tinta-clara, #FFF1E8)", s: "cofre" },
  preparar: { fondo: "var(--ed-piso-preparar, #FFA300)", tinta: "var(--ed-tinta-oscura, #000000)", s: "bloques" },
  publicar: { fondo: "var(--ed-piso-publicar, #29ADFF)", tinta: "var(--ed-tinta-oscura, #000000)", s: "ventana" },
  vender: { fondo: "var(--ed-piso-vender, #006B3F)", tinta: "var(--ed-tinta-clara, #FFF1E8)", s: "moneda" },
  entregar: { fondo: "var(--ed-piso-entregar, #C8003E)", tinta: "var(--ed-tinta-clara, #FFF1E8)", s: "camion" },
  facturar: { fondo: "var(--ed-piso-facturar, #7E2553)", tinta: "var(--ed-tinta-clara, #FFF1E8)", s: "doc" },
  contar: { fondo: "var(--ed-piso-contar, #1D2B53)", tinta: "var(--ed-tinta-clara, #FFF1E8)", s: "datos" },
  dirigir: { fondo: "var(--ed-piso-dirigir, #5F574F)", tinta: "var(--ed-tinta-clara, #FFF1E8)", s: "estrella" },
  sistema: { fondo: "var(--ed-piso-sistema, #83769C)", tinta: "var(--ed-tinta-oscura, #000000)", s: "control" },
};
export const COLOR_DEF = { fondo: "var(--ed-gris-osc, #5F574F)", tinta: "var(--ed-tinta-clara, #FFF1E8)", s: "datos" as SpriteId };

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
 *  de la Agenda. `abrir` decide CÓMO se llega (en el tablero la cámara se acerca). */
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
  // Recordatorios y Notas vivían en la portada de la Agenda (ya no es una pantalla): se
  // llega directo a su pestaña dentro de Acciones, igual que el resto de accesos rápidos.
  const irAcciones = (tab: AccionesBootTab) => {
    setAccionesBootTab(tab);
    setTicketsBootView("acciones");
    setCentroMandoView("acciones");
    abrir(ORIGEN_APP.panel);
  };
  const espacios = DENTRO_DE_LA_AGENDA.filter((p) => user && puedeVerSeccionPanel(user, p));
  return { user, token, verMensajes, vistaAgenda, irAcciones, espacios };
}

