import { useEffect } from "react";
import { useTicketsAuth } from "../../stores/ticketsAuth";
import { useAppStore, type EtiquetasTab } from "../../stores/app";
import { tabsEtiquetasVisibles } from "../../lib/studioVisualAccess";
import { puedeVerSeccionPanel } from "../../lib/panelAccess";
import { guardarUltimoPanelHub } from "../../lib/hubNav";
import { Icon, type UiIconName } from "../../icons";
import { HUB_TAB_LABEL, hubTabClass } from "../../lib/hubTabClass";
import ScrollableTabList from "./ScrollableTabList";

const TABS: { id: EtiquetasTab; label: string; shortLabel: string; icon: UiIconName }[] = [
  { id: "imprimir", label: "Imprimir", shortLabel: "Imprimir", icon: "printer" },
  { id: "studio", label: "Studio visual", shortLabel: "Studio", icon: "palette" },
  { id: "inventario", label: "Papel y tinta", shortLabel: "Inventario", icon: "package" },
  { id: "codigos_ean", label: "Códigos EAN", shortLabel: "EAN", icon: "barcode" },
];

/**
 * Pestañas de Diseño en el cabezote, a la izquierda de Temas y estilo visual.
 */
export default function DisenoNavTabs() {
  const panel = useAppStore((s) => s.panel);
  const tab = useAppStore((s) => s.etiquetasTab);
  const setTab = useAppStore((s) => s.setEtiquetasTab);
  const setPanel = useAppStore((s) => s.setPanel);
  const user = useTicketsAuth((s) => s.user);
  const allowed = tabsEtiquetasVisibles(user);
  const tabs = TABS.filter((t) => allowed.includes(t.id));
  const showStudioWeb = puedeVerSeccionPanel(user, "sitioweb");
  const enStudioWeb = panel === "sitioweb";
  const activo = tabs.some((t) => t.id === tab) ? tab : (tabs[0]?.id ?? "imprimir");

  useEffect(() => {
    if (enStudioWeb) guardarUltimoPanelHub("diseno", "sitioweb");
    else if (panel === "etiquetas" || panel === "etiquetas-config") {
      guardarUltimoPanelHub("diseno", "etiquetas");
    }
  }, [enStudioWeb, panel]);

  if (tabs.length === 0 && !showStudioWeb) return null;

  function irAEtiquetas(id: EtiquetasTab) {
    setPanel("etiquetas");
    setTab(id);
  }

  function irAStudioWeb() {
    setPanel("sitioweb");
  }

  return (
    <ScrollableTabList aria-label="Secciones de Diseño" justify="end">
      {tabs.map((t) => {
        const selected = !enStudioWeb && activo === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => irAEtiquetas(t.id)}
            className={hubTabClass(selected)}
          >
            <Icon name={t.icon} size={16} weight={selected ? "fill" : "duotone"} className="shrink-0" />
            <span className={`hidden sm:inline ${HUB_TAB_LABEL}`}>{t.label}</span>
            <span className={`sm:hidden ${HUB_TAB_LABEL}`}>{t.shortLabel}</span>
          </button>
        );
      })}
      {showStudioWeb && (
        <button
          type="button"
          role="tab"
          aria-selected={enStudioWeb}
          onClick={irAStudioWeb}
          className={hubTabClass(enStudioWeb)}
        >
          <Icon name="monitor" size={16} weight={enStudioWeb ? "fill" : "duotone"} className="shrink-0" />
          <span className={`hidden sm:inline ${HUB_TAB_LABEL}`}>Studio web</span>
          <span className={`sm:hidden ${HUB_TAB_LABEL}`}>Web</span>
        </button>
      )}
    </ScrollableTabList>
  );
}
