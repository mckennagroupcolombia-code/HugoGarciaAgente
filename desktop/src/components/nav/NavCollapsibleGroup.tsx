import { useEffect, useState } from "react";
import type { Panel } from "../../stores/app";
import type { TicketsUser } from "../../stores/ticketsAuth";
import { PANEL_INFO } from "../../lib/panelInfo";
import type { NavItemDef } from "../../lib/navStructure";
import { PanelIcon } from "../../icons/PanelIcon";
import { Icon } from "../../icons";

export default function NavCollapsibleGroup({
  label,
  items,
  panel,
  user,
  advanced,
  badges = {},
  puedeVer,
  onNavigate,
  badgePanel,
}: {
  label: string;
  items: readonly NavItemDef[];
  panel: Panel;
  user: TicketsUser | null;
  advanced: boolean;
  badges?: Partial<Record<string, number>>;
  puedeVer: (user: TicketsUser | null, seccion: string) => boolean;
  onNavigate: (id: Panel) => void;
  /** Panel cuyo badge se muestra en el encabezado del grupo. */
  badgePanel?: Panel;
}) {
  const visible = items.filter(
    (item) => puedeVer(user, item.panel) && (item.tier !== "advanced" || advanced),
  );
  const childActive = visible.some((item) => item.panel === panel);
  const [open, setOpen] = useState(childActive);

  useEffect(() => {
    if (childActive) setOpen(true);
  }, [childActive]);

  if (visible.length === 0) return null;

  const headerBadge = badgePanel ? badges[badgePanel] ?? 0 : 0;
  const headerPanel = visible.find((i) => i.panel === panel)?.panel ?? visible[0]?.panel;

  return (
    <div className="space-y-0.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`mck-nav-item mck-press group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold ${
          childActive && !open
            ? "bg-surface-hover text-ink"
            : "text-ink-secondary hover:bg-surface-hover hover:text-ink"
        }`}
      >
        {headerPanel && (
          <PanelIcon panel={headerPanel} size={26} active={false} className="shrink-0" />
        )}
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
          className={`shrink-0 text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="ml-2 space-y-0.5 border-l-2 border-border/70 pl-2">
          {visible.map((item) => {
            const active = panel === item.panel;
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
