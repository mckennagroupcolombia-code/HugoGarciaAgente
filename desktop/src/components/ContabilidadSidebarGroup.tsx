import type { Panel } from "../stores/app";
import type { TicketsUser } from "../stores/ticketsAuth";
import { PANEL_INFO } from "../lib/panelInfo";
import { NAV_SECTIONS } from "../lib/navStructure";
import { puedeVerModuloContabilidad } from "../lib/contabilidadAccess";

const CONTABILIDAD_ITEMS = NAV_SECTIONS.find((s) => s.id === "contabilidad")?.items ?? [];

/** @deprecated Usar NAV_SECTIONS (id: contabilidad). */
export const CONTABILIDAD_NAV: { id: Panel; label: string }[] = CONTABILIDAD_ITEMS.map((item) => ({
  id: item.panel,
  label: PANEL_INFO[item.panel]?.label ?? item.panel,
}));

export function contabilidadNavVisible(
  user: TicketsUser | null,
  puedeVer: (user: TicketsUser | null, seccion: string) => boolean,
): boolean {
  if (!user) return false;
  return CONTABILIDAD_ITEMS.some((item) => {
    const contab = puedeVerModuloContabilidad(user, item.panel);
    if (contab !== null) return contab;
    return puedeVer(user, item.panel);
  });
}
