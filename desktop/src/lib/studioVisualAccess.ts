import type { TicketsUser } from "../stores/ticketsAuth";
import type { EtiquetasTab } from "../stores/app";

/** IDs de usuarios autorizados (tickets.db → usuarios.id). */
const CYNTHIA_USER_IDS = new Set<number>([6]);

const CYNTHIA_EMAILS = new Set(["cynthua0418@gmail.com"]);

/** Tabs de Etiquetas reservados a Cynthia (Imprimir queda abierto). */
export const ETIQUETAS_TABS_SOLO_CYNTHIA = [
  "studio",
  "inventario",
  "codigos_ean",
] as const satisfies readonly EtiquetasTab[];

export type EtiquetasTabSoloCynthia = (typeof ETIQUETAS_TABS_SOLO_CYNTHIA)[number];

/**
 * Studio visual, Papel y tinta, Códigos EAN — solo Cynthia Ruiz (id 6).
 * Sin bypass por rol admin ni por permisos_secciones.
 */
export function esCynthiaEtiquetas(user: TicketsUser | null | undefined): boolean {
  if (!user) return false;
  if (typeof user.id === "number" && CYNTHIA_USER_IDS.has(user.id)) return true;
  const username = (user.username || "").trim().toLowerCase().replace(/^@+/, "");
  if (username === "cynthia") return true;
  const email = (user.email || "").trim().toLowerCase();
  if (email && CYNTHIA_EMAILS.has(email)) return true;
  return false;
}

/** @deprecated usar esCynthiaEtiquetas */
export function puedeVerStudioVisual(user: TicketsUser | null | undefined): boolean {
  return esCynthiaEtiquetas(user);
}

export function esTabEtiquetasSoloCynthia(tab: string): tab is EtiquetasTabSoloCynthia {
  return (ETIQUETAS_TABS_SOLO_CYNTHIA as readonly string[]).includes(tab);
}

export function puedeVerTabEtiquetas(
  user: TicketsUser | null | undefined,
  tab: EtiquetasTab,
): boolean {
  if (!esTabEtiquetasSoloCynthia(tab)) return true;
  return esCynthiaEtiquetas(user);
}

/** Eliminar PNG de la biblioteca de etiquetas — solo Cynthia. */
export function puedeEliminarPngEtiquetas(user: TicketsUser | null | undefined): boolean {
  return esCynthiaEtiquetas(user);
}

/** Lista de pestañas visibles para el usuario actual. */
export function tabsEtiquetasVisibles(user: TicketsUser | null | undefined): EtiquetasTab[] {
  const avanzado = esCynthiaEtiquetas(user);
  const todas: EtiquetasTab[] = ["imprimir", "studio", "inventario", "codigos_ean"];
  return todas.filter((t) => !esTabEtiquetasSoloCynthia(t) || avanzado);
}
