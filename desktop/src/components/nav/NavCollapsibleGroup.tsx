import { useEffect, useState } from "react";
import type { Panel } from "../../stores/app";
import type { TicketsUser } from "../../stores/ticketsAuth";
import { PANEL_INFO } from "../../lib/panelInfo";
import type { NavCategory, NavItemDef } from "../../lib/navStructure";
import { PanelIcon } from "../../icons/PanelIcon";
import { Icon, type UiIconName } from "../../icons";

/** Icono estable por categoría (no cambia según el panel activo). */
const SECTION_ICON: Partial<Record<NavCategory, UiIconName>> = {
  inicio: "home",
  atencion: "bell",
  canales: "chat",
  diseno: "tag",
  "studio-web": "palette",
  docs: "file",
  contabilidad: "receipt",
  tienda: "megaphone",
  logistica: "ship",
  sistemas: "monitor",
};

export default function NavCollapsibleGroup({
  label,
  sectionId,
  items,
  panel,
  user,
  advanced,
  badges = {},
  puedeVer,
  onNavigate,
  open,
  onToggle,
}: {
  label: string;
  sectionId?: NavCategory;
  items: readonly NavItemDef[];
  panel: Panel;
  user: TicketsUser | null;
  advanced: boolean;
  badges?: Partial<Record<string, number>>;
  puedeVer: (user: TicketsUser | null, seccion: string) => boolean;
  onNavigate: (id: Panel) => void;
  /** Controlado: acordeón del sidebar. */
  open?: boolean;
  onToggle?: () => void;
}) {
  const visible = items.filter(
    (item) => puedeVer(user, item.panel) && (item.tier !== "advanced" || advanced),
  );
  const childActive = visible.some((item) => item.panel === panel);
  const [localOpen, setLocalOpen] = useState(childActive);
  const isControlled = open !== undefined && onToggle !== undefined;
  const isOpen = isControlled ? open : localOpen;

  useEffect(() => {
    if (!isControlled && childActive) setLocalOpen(true);
  }, [childActive, isControlled]);

  if (visible.length === 0) return null;

  const headerBadge = visible.reduce((sum, item) => sum + (badges[item.panel] ?? 0), 0);
  const sectionIcon = sectionId ? SECTION_ICON[sectionId] : undefined;
  const headerPanel = visible.find((i) => i.panel === panel)?.panel ?? visible[0]?.panel;

  function toggle() {
    if (isControlled) onToggle();
    else setLocalOpen((v) => !v);
  }

  return (
    <div className="space-y-0.5">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        className={`mck-nav-item mck-press group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold ${
          childActive
            ? isOpen
              ? "bg-accent/10 text-accent"
              : "bg-surface-hover text-ink"
            : "text-ink-secondary hover:bg-surface-hover hover:text-ink"
        }`}
      >
        {sectionIcon ? (
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
              childActive ? "bg-accent/15 text-accent" : "bg-surface-hover text-ink-muted"
            }`}
          >
            <Icon name={sectionIcon} size={18} weight="duotone" />
          </span>
        ) : headerPanel ? (
          <PanelIcon panel={headerPanel} size={26} active={false} className="shrink-0" />
        ) : null}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {headerBadge > 0 && (
          <span className="shrink-0 rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-bold text-white">
            {headerBadge > 99 ? "99+" : headerBadge}
          </span>
        )}
        <Icon
          name="caretDown"
          size={14}
          weight="bold"
          className={`shrink-0 text-muted transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div className="ml-2 space-y-0.5 border-l-2 border-border/70 pl-2">
          {visible.map((item) => {
            const active = panel === item.panel || (item.panel === "hugo" && panel === "tickets");
            const info = PANEL_INFO[item.panel];
            const badge = badges[item.panel] ?? 0;
            return (
              <button
                key={item.panel}
                type="button"
                onClick={() => onNavigate(item.panel)}
                className={`mck-nav-item mck-press group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-semibold ${
                  active
                    ? "is-active bg-accent text-white"
                    : "text-ink-secondary hover:bg-surface-hover hover:text-ink"
                }`}
              >
                <PanelIcon panel={item.panel} size={24} active={active} />
                <span className="min-w-0 flex-1 truncate">{info?.label ?? item.panel}</span>
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
            );
          })}
        </div>
      )}
    </div>
  );
}
