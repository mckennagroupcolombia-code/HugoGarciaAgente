import { useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { usePanelTheme } from "../stores/panelTheme";
import { hexToRgb, rgbToHex } from "../theme/applyTheme";
import { ACCENT_PRESETS } from "../theme/presets";
import type { ThemeMode } from "../theme/types";

const SIDEBAR_BTN =
  "flex w-full items-center gap-3 rounded-paper border-2 border-transparent px-3 py-2.5 text-left text-sm font-semibold text-muted transition hover:border-border-strong hover:bg-surface-hover hover:text-ink";

const MODES: { id: ThemeMode; label: string }[] = [
  { id: "light", label: "Claro" },
  { id: "dark", label: "Oscuro" },
  { id: "system", label: "Sistema" },
];

/** Botón del sidebar: panel de temas (modo + color de acento). */
export default function TemasSidebarButton() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const mode = usePanelTheme((s) => s.mode);
  const accentRgb = usePanelTheme((s) => s.accentRgb);
  const setMode = usePanelTheme((s) => s.setMode);
  const setAccentRgb = usePanelTheme((s) => s.setAccentRgb);
  const reset = usePanelTheme((s) => s.reset);
  const apply = usePanelTheme((s) => s.apply);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode, apply]);

  function pickMode(next: ThemeMode) {
    setMode(next);
  }

  function pickAccent(rgb: string) {
    setAccentRgb(rgb);
  }

  function restoreDefault() {
    reset();
  }

  const accentHex = rgbToHex(accentRgb);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={SIDEBAR_BTN}
      >
        <Icon name="palette" size={20} weight="regular" className="shrink-0" />
        Temas
        <span
          className="ml-auto h-4 w-4 shrink-0 rounded-full border border-border shadow-sm"
          style={{ backgroundColor: accentHex }}
          aria-hidden
        />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Ajustar temas"
          className="absolute left-0 right-0 top-full z-50 mt-1.5 rounded-xl border-2 border-border bg-surface-panel p-3 shadow-paper-lg space-y-3"
        >
          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-muted">Modo</p>
            <div className="grid grid-cols-3 gap-1">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => pickMode(m.id)}
                  className={`rounded-lg border-2 px-2 py-1.5 text-[11px] font-bold transition ${
                    mode === m.id
                      ? "border-accent bg-accent/12 text-accent"
                      : "border-border text-muted hover:border-accent/50 hover:text-ink"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-muted">Color de acento</p>
            <div className="grid grid-cols-4 gap-1.5">
              {ACCENT_PRESETS.map((p) => {
                const active = accentRgb === p.rgb;
                return (
                  <button
                    key={p.id}
                    type="button"
                    title={p.label}
                    onClick={() => pickAccent(p.rgb)}
                    className={`flex flex-col items-center gap-1 rounded-lg border-2 p-1.5 transition ${
                      active ? "border-accent bg-accent/10" : "border-transparent hover:border-border hover:bg-surface-hover"
                    }`}
                  >
                    <span
                      className="h-6 w-6 rounded-full border border-black/10 shadow-sm"
                      style={{ backgroundColor: p.hex }}
                    />
                    <span className="w-full truncate text-center text-[9px] font-semibold text-muted">{p.label}</span>
                  </button>
                );
              })}
            </div>
            <label className="mt-2 flex items-center gap-2 rounded-lg border border-border bg-surface-input px-2 py-1.5">
              <input
                type="color"
                value={accentHex}
                onChange={(e) => pickAccent(hexToRgb(e.target.value))}
                className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent p-0"
                aria-label="Color personalizado"
              />
              <span className="text-[11px] font-mono text-muted">{accentHex}</span>
            </label>
          </div>

          <button
            type="button"
            onClick={restoreDefault}
            className="w-full rounded-lg border border-border px-2 py-1.5 text-[11px] font-semibold text-muted transition hover:border-accent hover:text-accent"
          >
            Restaurar McKenna
          </button>
          <p className="text-center text-[10px] text-muted">Se guarda en tu cuenta</p>
        </div>
      )}
    </div>
  );
}
