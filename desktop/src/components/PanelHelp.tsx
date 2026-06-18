import { useState } from "react";
import type { Panel } from "../stores/app";
import { PANEL_INFO } from "../lib/panelInfo";
import { useUiMode } from "../stores/uiMode";
import { PanelIcon } from "../icons/PanelIcon";
import { Icon } from "../icons";

/**
 * Banner de ayuda contextual para cada panel.
 * Muestra descripción y tips del panel al usuario.
 * Puede cerrarse permanentemente (persistido en localStorage).
 */
export default function PanelHelp({ panelId }: { panelId: string }) {
  const info = PANEL_INFO[panelId];
  const { dismissedHelps, dismissHelp } = useUiMode();
  const [open, setOpen] = useState(false);

  if (!info) return null;
  if (dismissedHelps.includes(panelId)) {
    // Show tiny "?" button to re-open
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`¿Qué es ${info.label}?`}
        className="mb-4 flex items-center gap-1.5 rounded-full border border-border bg-surface-panel px-3 py-1 text-xs font-semibold text-muted shadow-paper-sm transition hover:border-accent hover:text-accent"
      >
        <span className="mt-0.5 shrink-0">
          <Icon name="question" size={14} weight="duotone" />
        </span>
        ¿Cómo funciona esto?
      </button>
    );
  }

  return (
    <div className="mb-5 overflow-hidden rounded-2xl border border-accent/20 bg-gradient-to-br from-accent/5 to-accent/10 shadow-paper-sm">
      <div className="flex items-start gap-3 px-5 py-4">
        <PanelIcon panel={panelId as Panel} size={36} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-extrabold text-ink">{info.label}</h3>
            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">
              {info.tier === "core" ? "Esencial" : info.tier === "standard" ? "Frecuente" : "Avanzado"}
            </span>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-ink-secondary">{info.description}</p>

          {info.tips.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="mt-2 flex items-center gap-1 text-xs font-semibold text-accent transition hover:underline"
              >
                <span>{open ? "▾" : "▸"}</span>
                {open ? "Ocultar tips" : `Ver ${info.tips.length} tip${info.tips.length > 1 ? "s" : ""}`}
              </button>

              {open && (
                <ul className="mt-2 space-y-1.5">
                  {info.tips.map((tip, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-ink-secondary">
                      <span className="mt-0.5 shrink-0 text-accent">✦</span>
                      {tip}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => dismissHelp(panelId)}
          title="Cerrar y no mostrar de nuevo"
          className="shrink-0 rounded-full p-1 text-muted transition hover:bg-surface-hover hover:text-ink"
          aria-label="Cerrar ayuda"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="mck-icon">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/**
 * Versión inline compacta — solo el título y la descripción en una línea,
 * con tooltip de tips al pasar el cursor. Para usar en headers de sección.
 */
export function PanelHelpInline({ panelId }: { panelId: string }) {
  const info = PANEL_INFO[panelId];
  const [show, setShow] = useState(false);
  if (!info) return null;
  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onClick={() => setShow((v) => !v)}
        className="flex h-5 w-5 items-center justify-center rounded-full border border-muted/40 text-[10px] font-bold text-muted transition hover:border-accent hover:text-accent"
        aria-label={`Ayuda: ${info.label}`}
      >
        ?
      </button>
      {show && (
        <div className="absolute left-7 top-0 z-50 w-72 rounded-xl border border-border bg-surface-panel p-3 shadow-paper-lg text-xs text-ink-secondary leading-relaxed">
          <p className="font-bold text-ink mb-1 flex items-center gap-2">
            <PanelIcon panel={panelId as Panel} size={20} bubble={false} />
            {info.label}
          </p>
          <p>{info.description}</p>
          {info.tips.length > 0 && (
            <ul className="mt-2 space-y-1">
              {info.tips.slice(0, 2).map((t, i) => (
                <li key={i} className="flex gap-1.5">
                  <span className="text-accent shrink-0">✦</span>{t}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </span>
  );
}
