import { Icon } from "../../icons";
import type { IconName } from "../../icons/types";

/** Severidad de un item del checklist — decide color e ícono. */
export type ChecklistSeveridad = "ok" | "media" | "alta";

export interface ChecklistGuiadoItem {
  id: string;
  titulo: string;
  detalle: string;
  cantidad?: number;
  severidad: ChecklistSeveridad;
  onClick?: () => void;
  icon?: IconName;
}

const SEVERIDAD_ESTILO: Record<ChecklistSeveridad, { badge: string; icon: IconName; wrap: string }> = {
  ok: {
    badge: "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400",
    icon: "check",
    wrap: "border-emerald-600/30 bg-emerald-600/5",
  },
  media: {
    badge: "bg-amber-600/15 text-amber-800 dark:text-amber-300",
    icon: "warning",
    wrap: "border-amber-600/40 bg-amber-600/10 hover:bg-amber-600/15",
  },
  alta: {
    badge: "bg-danger/15 text-danger",
    icon: "warning",
    wrap: "border-danger/40 bg-danger/10 hover:bg-danger/15",
  },
};

/**
 * Componente genérico reusable para "esto es lo que falta por hacer,
 * paso a paso" — usado por el checklist guiado de Contabilidad y por el de
 * Documentos técnicos (misma lógica visual, sin duplicar nada). Recibe una
 * lista plana de items ya resueltos por el backend; este componente solo
 * pinta y despacha el click.
 */
export default function ChecklistGuiado({
  titulo,
  subtitulo,
  items,
  progreso,
  loading,
  compact,
}: {
  titulo: string;
  subtitulo?: string;
  items: ChecklistGuiadoItem[];
  /** Ej. "3/5 completados" — si se pasa, se muestra como barra de progreso. */
  progreso?: { hechos: number; total: number };
  loading?: boolean;
  /** Modo compacto: solo título + barra de progreso, sin la lista de items —
   * para usar como encabezado dentro de una vista que ya tiene su propia
   * lista/tabla (ej. Documentos técnicos → Catálogo). */
  compact?: boolean;
}) {
  const pct = progreso && progreso.total > 0 ? Math.round((progreso.hechos / progreso.total) * 100) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-ink">{titulo}</h3>
          {subtitulo && <p className="text-xs text-muted">{subtitulo}</p>}
        </div>
        {pct !== null && (
          <span className="text-xs font-bold text-ink-secondary">
            {progreso!.hechos}/{progreso!.total} completado{progreso!.hechos === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {pct !== null && (
        <div className="h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-surface-hover">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {compact ? null : loading ? (
        <div className="rounded-xl border border-border bg-surface-panel px-4 py-3 text-xs text-muted">
          Revisando pendientes…
        </div>
      ) : items.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-600/30 bg-emerald-600/5 px-4 py-3 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
          <Icon name="check" size={18} weight="bold" />
          Todo al día — no hay pendientes.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it) => {
            const estilo = SEVERIDAD_ESTILO[it.severidad];
            const clickable = Boolean(it.onClick) && it.severidad !== "ok";
            const Tag = clickable ? "button" : "div";
            return (
              <li key={it.id}>
                <Tag
                  type={clickable ? "button" : undefined}
                  onClick={clickable ? it.onClick : undefined}
                  className={`flex w-full items-start gap-3 rounded-xl border px-3.5 py-2.5 text-left ${estilo.wrap} ${
                    clickable ? "cursor-pointer" : "cursor-default"
                  }`}
                >
                  <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${estilo.badge}`}>
                    <Icon name={it.icon ?? estilo.icon} size={14} weight="bold" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-bold text-ink">{it.titulo}</span>
                      {typeof it.cantidad === "number" && it.cantidad > 0 && (
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${estilo.badge}`}>
                          {it.cantidad}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-ink-secondary">{it.detalle}</span>
                  </span>
                  {clickable && (
                    <span className="mt-1 shrink-0 text-xs font-bold text-ink-secondary underline">Resolver →</span>
                  )}
                </Tag>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
