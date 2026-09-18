import { useAppStore, type DocsTab } from "../../stores/app";
import { Icon, type UiIconName } from "../../icons";
import { HUB_TAB_LABEL, hubTabClass } from "../../lib/hubTabClass";
import ScrollableTabList from "./ScrollableTabList";

/** "revision" va primera a propósito: es la entrada guiada — "esto es lo
 * que falta por revisar/corregir contra el formato vigente" — antes de que
 * el usuario tenga que decidir en cuál de las demás pestañas entrar. */
const TABS: { id: DocsTab; label: string; icon: UiIconName }[] = [
  { id: "revision", label: "Revisión guiada", icon: "listChecks" },
  { id: "biblioteca", label: "Biblioteca", icon: "books" },
  { id: "completo", label: "Ficha Técnica COA SDS", icon: "file" },
];

/**
 * Pestañas de Docs técnicos en el cabezote (misma estética que Contabilidad):
 * quedan fijas arriba y no se pierden al desplazar el formulario.
 */
export default function DocsNavTabs() {
  const tab = useAppStore((s) => s.docsTab);
  const setTab = useAppStore((s) => s.setDocsTab);
  return (
    <ScrollableTabList aria-label="Secciones de Docs técnicos">
      {TABS.map((t) => {
        const selected = tab === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-label={t.label}
            title={t.label}
            onClick={() => setTab(t.id)}
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
