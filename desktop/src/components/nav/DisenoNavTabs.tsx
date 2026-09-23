import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTicketsAuth } from "../../stores/ticketsAuth";
import { useAppStore, type EtiquetasTab } from "../../stores/app";
import { tabsEtiquetasVisibles } from "../../lib/studioVisualAccess";
import { guardarUltimoPanelHub } from "../../lib/hubNav";
import { Icon, type UiIconName } from "../../icons";
import { HUB_TAB_LABEL, hubTabClass } from "../../lib/hubTabClass";
import ScrollableTabList from "./ScrollableTabList";
import { PanelIcon } from "../../icons/PanelIcon";
import { puedeVerSeccionPanel } from "../../lib/panelAccess";
import { precargarDiseno } from "../../lib/etiquetasPrefetch";

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
  const qc = useQueryClient();
  const allowed = tabsEtiquetasVisibles(user);
  const tabs = TABS.filter((t) => allowed.includes(t.id));
  const activo = tabs.some((t) => t.id === tab) ? tab : (tabs[0]?.id ?? "imprimir");
  const enProducto = panel === "producto";
  const verProducto = Boolean(user && puedeVerSeccionPanel(user, "producto"));

  useEffect(() => {
    if (panel === "etiquetas" || panel === "etiquetas-config") {
      guardarUltimoPanelHub("diseno", "etiquetas");
    }
    if (panel === "producto") guardarUltimoPanelHub("diseno", "producto");
  }, [panel]);

  // Con el hub de Diseño visible ya se pueden pedir las etiquetas de todas las
  // pestañas: al hacer clic la vista aparece con datos, sin "Cargando…".
  useEffect(() => {
    precargarDiseno(qc, user);
  }, [qc, user]);

  if (tabs.length === 0 && !verProducto) return null;

  function irAEtiquetas(id: EtiquetasTab) {
    setPanel("etiquetas");
    setTab(id);
  }

  return (
    <ScrollableTabList aria-label="Secciones de Diseño" justify="start">
      {/* Un producto con todo lo suyo (ficha técnica, etiqueta, EAN, PNG): la misma
          pestaña está en Docs técnicos, porque une las dos secciones. */}
      {verProducto && (
        <button
          type="button"
          role="tab"
          aria-selected={enProducto}
          aria-label="Por producto"
          title="Espacio de producto: ficha técnica, etiqueta, EAN y PNG de una presentación"
          onClick={() => setPanel("producto")}
          className={hubTabClass(enProducto, "mck-hub-tab-etiquetado flex-col")}
        >
          <PanelIcon panel="producto" size={22} bubble={false} className="shrink-0" />
          <span className={HUB_TAB_LABEL}>Por producto</span>
        </button>
      )}
      {tabs.map((t) => {
        const selected = !enProducto && activo === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-label={t.label}
            title={t.label}
            onClick={() => irAEtiquetas(t.id)}
            onMouseEnter={() => precargarDiseno(qc, user)}
            onFocus={() => precargarDiseno(qc, user)}
            className={hubTabClass(selected, "mck-hub-tab-etiquetado flex-col")}
          >
            <Icon name={t.icon} size={22} weight="bold" className="shrink-0" />
            <span className={HUB_TAB_LABEL}>{t.label}</span>
          </button>
        );
      })}
    </ScrollableTabList>
  );
}
