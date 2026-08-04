import { useMemo } from "react";
import { useAppStore, type Panel } from "../stores/app";
import { useTicketsAuth } from "../stores/ticketsAuth";
import { useUiMode } from "../stores/uiMode";
import {
  CONTABILIDAD_PANELS,
  CONTABILIDAD_TAB_OCULTAS,
  esPanelContabilidad,
  puedeVerModuloContabilidad,
  type ContabilidadPanelId,
} from "../lib/contabilidadAccess";
import { PANEL_INFO } from "../lib/panelInfo";
import { PanelIcon } from "../icons/PanelIcon";
import ContabilidadHerramientas from "./ContabilidadHerramientas";

/**
 * Pestañas + herramientas del hub Contabilidad.
 * Vive en el cabezote de Layout (fijo, no scroll).
 */
export default function ContabilidadNavTabs() {
  const panel = useAppStore((s) => s.panel);
  const setPanel = useAppStore((s) => s.setPanel);
  const { user } = useTicketsAuth();
  const advanced = useUiMode((s) => s.advanced);

  const tabs = useMemo(() => {
    return CONTABILIDAD_PANELS.filter((id) => {
      if (CONTABILIDAD_TAB_OCULTAS.has(id)) return false;
      if (!puedeVerModuloContabilidad(user, id)) return false;
      if (id === "costos-productos" || id === "rrhh") return advanced;
      return true;
    });
  }, [user, advanced]);

  const activo: ContabilidadPanelId = esPanelContabilidad(panel)
    ? panel
    : (tabs[0] ?? "facturas");
  const subpanelId = CONTABILIDAD_TAB_OCULTAS.has(activo)
    ? (tabs[0] ?? "facturas")
    : activo;
  const puedeCrearSiigo = Boolean(puedeVerModuloContabilidad(user, "productos-siigo"));

  if (!tabs.length && !puedeCrearSiigo) return null;

  return (
    <div
      className="flex min-w-0 flex-1 items-center justify-end gap-1 overflow-x-auto"
      role="tablist"
      aria-label="Secciones de Contabilidad"
    >
      <ContabilidadHerramientas puedeCrearSiigo={puedeCrearSiigo} />
      {tabs.map((id) => {
        const info = PANEL_INFO[id];
        const selected = subpanelId === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => setPanel(id as Panel)}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition sm:gap-2 sm:px-3 sm:text-xs ${
              selected
                ? "bg-accent text-white shadow-sm"
                : "text-muted hover:bg-surface-hover hover:text-ink"
            }`}
          >
            <PanelIcon panel={id} size={20} active={selected} bubble={false} />
            <span className="hidden truncate sm:inline">{info?.label ?? id}</span>
          </button>
        );
      })}
    </div>
  );
}
