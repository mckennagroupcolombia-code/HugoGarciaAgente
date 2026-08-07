import { useEffect, useMemo, type ReactNode } from "react";
import { useAppStore, type Panel } from "../../stores/app";
import { useTicketsAuth } from "../../stores/ticketsAuth";
import { useUiMode } from "../../stores/uiMode";
import { NAV_SECTIONS, type NavCategory } from "../../lib/navStructure";
import { PANEL_INFO } from "../../lib/panelInfo";
import {
  guardarUltimoPanelHub,
  itemsVisiblesHub,
} from "../../lib/hubNav";
import { PanelIcon } from "../../icons/PanelIcon";
import { modoAvanzadoEfectivo } from "../../lib/adminAccess";
import { puedeVerSeccionPanel } from "../../lib/panelAccess";
import ScrollableTabList from "./ScrollableTabList";

/**
 * Pestañas del hub en el cabezote (misma estética que Contabilidad).
 */
export default function HubNavTabs({
  sectionId,
  leading,
}: {
  sectionId: NavCategory;
  leading?: ReactNode;
}) {
  const panel = useAppStore((s) => s.panel);
  const setPanel = useAppStore((s) => s.setPanel);
  const setTicketsBootView = useAppStore((s) => s.setTicketsBootView);
  const setCentroMandoView = useAppStore((s) => s.setCentroMandoView);
  const setAccionesBootTab = useAppStore((s) => s.setAccionesBootTab);
  const { user } = useTicketsAuth();
  const advancedToggle = useUiMode((s) => s.advanced);
  const advanced = modoAvanzadoEfectivo(user, advancedToggle);

  const section = NAV_SECTIONS.find((s) => s.id === sectionId);
  const tabs = useMemo(() => {
    if (!section) return [];
    return itemsVisiblesHub(section.items, user, advanced, puedeVerSeccionPanel, sectionId);
  }, [section, sectionId, user, advanced]);

  const activo = tabs.find((t) => t.panel === panel || (t.panel === "hugo" && panel === "tickets"));
  const subpanelId = activo?.panel ?? tabs[0]?.panel;

  useEffect(() => {
    if (subpanelId) guardarUltimoPanelHub(sectionId, subpanelId);
  }, [sectionId, subpanelId]);

  function irA(id: Panel) {
    setAccionesBootTab(null);
    if (id === "hugo") {
      setTicketsBootView("agente");
      setCentroMandoView("home");
    }
    setPanel(id);
  }

  if (!tabs.length) {
    return leading ? <div className="flex min-w-0 flex-1 items-center">{leading}</div> : null;
  }

  // Secciones individuales (1 panel): el botón del menú basta; no mostrar pestaña duplicada.
  if (tabs.length === 1 && !leading) {
    return null;
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      {/* Fuera del scroll: herramientas siempre visibles. */}
      {leading ? <div className="shrink-0">{leading}</div> : null}
      <ScrollableTabList aria-label={`Secciones de ${section?.label ?? sectionId}`}>
        {tabs.map((item) => {
          const id = item.panel;
          const info = PANEL_INFO[id];
          const selected = subpanelId === id || (id === "hugo" && panel === "tickets");
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => irA(id)}
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
      </ScrollableTabList>
    </div>
  );
}
