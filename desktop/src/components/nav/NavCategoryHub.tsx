import { useState, type ReactNode } from "react";
import type { Panel } from "../../stores/app";
import type { TicketsUser } from "../../stores/ticketsAuth";
import type { NavCategory, NavItemDef } from "../../lib/navStructure";
import { NAV_CATEGORY_LABEL } from "../../lib/navStructure";
import {
  HUB_SECTION_HINT,
  HUB_SECTION_ICON,
  itemsVisiblesHub,
  primerPanelHub,
} from "../../lib/hubNav";
import { Icon } from "../../icons";
import { modoAvanzadoEfectivo } from "../../lib/adminAccess";
import { useUiMode } from "../../stores/uiMode";

/** Un solo botón de menú que abre el hub (pestañas en el cabezote). */
export default function NavCategoryHub({
  sectionId,
  items,
  panel,
  user,
  badges = {},
  puedeVer,
  onNavigate,
  children,
}: {
  sectionId: NavCategory;
  items: readonly NavItemDef[];
  panel: Panel;
  user: TicketsUser | null;
  badges?: Partial<Record<string, number>>;
  puedeVer: (user: TicketsUser | null, seccion: string) => boolean;
  onNavigate: (id: Panel) => void;
  /** Contenido extra opcional (p. ej. nada — Contabilidad ya no necesita variante). */
  children?: ReactNode;
}) {
  const advancedToggle = useUiMode((s) => s.advanced);
  const advanced = modoAvanzadoEfectivo(user, advancedToggle);
  const visible = itemsVisiblesHub(items, user, advanced, puedeVer);
  const active = visible.some((i) => i.panel === panel || (i.panel === "hugo" && panel === "tickets"));
  const [hovered, setHovered] = useState(false);

  if (visible.length === 0) return null;

  const label = NAV_CATEGORY_LABEL[sectionId];
  const icon = HUB_SECTION_ICON[sectionId];
  const hint = HUB_SECTION_HINT[sectionId];
  const badge = visible.reduce((sum, item) => sum + (badges[item.panel] ?? 0), 0);

  function abrir() {
    const next = primerPanelHub(sectionId, user, advanced, puedeVer, panel);
    if (next) onNavigate(next);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={abrir}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={`group mck-nav-item mck-press flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left ${
          active
            ? "is-active bg-accent text-white"
            : "text-ink-secondary hover:bg-surface-hover hover:text-ink"
        }`}
      >
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${
            active ? "bg-white/15 text-white" : "bg-accent/10 text-accent"
          }`}
        >
          <Icon name={icon} size={16} weight="duotone" />
        </span>
        <span className="min-w-0 flex-1 text-[13px] font-semibold leading-none truncate">{label}</span>
        {badge > 0 && (
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
              active ? "bg-white/20 text-white" : "bg-danger text-white"
            }`}
          >
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </button>
      {children}

      {hovered && !active && hint && (
        <div className="mck-tooltip-fly pointer-events-none absolute left-full top-0 z-50 ml-2 w-64 rounded-xl border border-border bg-surface-panel/95 p-3 shadow-paper-lg backdrop-blur-sm">
          <p className="mb-1 text-xs font-bold text-ink">{label}</p>
          <p className="text-xs leading-relaxed text-ink-secondary">{hint}</p>
        </div>
      )}
    </div>
  );
}
