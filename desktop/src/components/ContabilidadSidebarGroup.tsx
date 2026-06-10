import { useEffect, useState } from "react";
import type { Panel } from "../stores/app";
import { type TicketsUser } from "../stores/ticketsAuth";
import { Icon } from "../icons";

export const CONTABILIDAD_NAV: { id: Panel; label: string }[] = [
  { id: "facturas", label: "Facturas de compra" },
  { id: "centros-costo", label: "Centro de costos" },
  { id: "rentabilidad", label: "Rentabilidad" },
  { id: "sync", label: "Sincronización" },
];

export function contabilidadNavVisible(
  user: TicketsUser | null,
  puedeVer: (user: TicketsUser | null, seccion: string) => boolean,
): boolean {
  if (!user) return false;
  return CONTABILIDAD_NAV.some((item) => puedeVer(user, item.id));
}

const ITEM_BTN =
  "flex w-full items-center gap-3 rounded-paper border-2 px-3 py-2 text-left text-sm font-semibold transition";

export default function ContabilidadSidebarGroup({
  user,
  panel,
  puedeVer,
  facturasPendientes,
  onNavigate,
}: {
  user: TicketsUser | null;
  panel: Panel;
  puedeVer: (user: TicketsUser | null, seccion: string) => boolean;
  facturasPendientes: number;
  onNavigate: (id: Panel) => void;
}) {
  const visibleItems = CONTABILIDAD_NAV.filter((item) => puedeVer(user, item.id));
  const childActive = visibleItems.some((item) => panel === item.id);
  const [open, setOpen] = useState(childActive);

  useEffect(() => {
    if (childActive) setOpen(true);
  }, [childActive]);

  if (visibleItems.length === 0) return null;

  return (
    <div className="space-y-0.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`${ITEM_BTN} ${
          childActive && !open
            ? "border-ink/30 bg-surface-hover text-ink"
            : "border-transparent text-ink-secondary hover:bg-surface-hover"
        }`}
      >
        <Icon name="receipt" size={20} weight={childActive ? "bold" : "regular"} className="shrink-0 opacity-80" />
        <span className="min-w-0 flex-1 truncate">Contabilidad</span>
        {facturasPendientes > 0 && (
          <span className="shrink-0 rounded-full bg-yellow-500 px-2 py-0.5 text-[11px] font-bold text-black">
            {facturasPendientes}
          </span>
        )}
        <Icon
          name="caretDown"
          size={14}
          weight="bold"
          className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="ml-3 space-y-0.5 border-l-2 border-border pl-2">
          {visibleItems.map((item) => {
            const active = panel === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`${ITEM_BTN} ${
                  active
                    ? "border-ink bg-surface-hover text-ink"
                    : "border-transparent text-muted hover:border-border-strong hover:bg-surface-hover hover:text-ink"
                }`}
              >
                <Icon
                  name={item.id}
                  size={18}
                  weight={active ? "bold" : "regular"}
                  className="shrink-0 opacity-80"
                />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.id === "facturas" && facturasPendientes > 0 && (
                  <span className="shrink-0 rounded-full bg-yellow-500 px-1.5 py-0.5 text-[10px] font-bold text-black">
                    {facturasPendientes}
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
