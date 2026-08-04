import { useTicketsAuth } from "../../stores/ticketsAuth";
import { useAppStore, type EtiquetasTab } from "../../stores/app";
import { tabsEtiquetasVisibles } from "../../lib/studioVisualAccess";
import { Icon, type UiIconName } from "../../icons";

const TABS: { id: EtiquetasTab; label: string; shortLabel: string; icon: UiIconName }[] = [
  { id: "imprimir", label: "Imprimir", shortLabel: "Imprimir", icon: "printer" },
  { id: "studio", label: "Studio visual", shortLabel: "Studio", icon: "palette" },
  { id: "inventario", label: "Papel y tinta", shortLabel: "Inventario", icon: "package" },
  { id: "codigos_ean", label: "Códigos EAN", shortLabel: "EAN", icon: "barcode" },
];

/**
 * Pestañas de Diseño en el cabezote (misma estética que Contabilidad / HubNavTabs).
 */
export default function DisenoNavTabs() {
  const tab = useAppStore((s) => s.etiquetasTab);
  const setTab = useAppStore((s) => s.setEtiquetasTab);
  const setPanel = useAppStore((s) => s.setPanel);
  const user = useTicketsAuth((s) => s.user);
  const allowed = tabsEtiquetasVisibles(user);
  const tabs = TABS.filter((t) => allowed.includes(t.id));
  const activo = tabs.some((t) => t.id === tab) ? tab : (tabs[0]?.id ?? "imprimir");

  if (tabs.length === 0) return null;

  function irA(id: EtiquetasTab) {
    setPanel("etiquetas");
    setTab(id);
  }

  return (
    <div
      className="flex min-w-0 flex-1 items-center justify-end gap-1 overflow-x-auto"
      role="tablist"
      aria-label="Secciones de Diseño"
    >
      {tabs.map((t) => {
        const selected = activo === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => irA(t.id)}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition sm:gap-2 sm:px-3 sm:text-xs ${
              selected
                ? "bg-accent text-white shadow-sm"
                : "text-muted hover:bg-surface-hover hover:text-ink"
            }`}
          >
            <Icon name={t.icon} size={16} weight={selected ? "fill" : "duotone"} className="shrink-0" />
            <span className="hidden truncate sm:inline">{t.label}</span>
            <span className="truncate sm:hidden">{t.shortLabel}</span>
          </button>
        );
      })}
    </div>
  );
}
