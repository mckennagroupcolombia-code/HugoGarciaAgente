import { useEffect } from "react";
import { usePanelTheme } from "../stores/panelTheme";
import { hexToRgb, rgbToHex } from "../theme/applyTheme";
import { MCKENNA_THEME_DEFAULT } from "../theme/presets";
import type { FontChoice, RadiusScale, ThemeMode } from "../theme/types";

const MODES: { id: ThemeMode; label: string }[] = [
  { id: "light", label: "Claro" },
  { id: "dark", label: "Oscuro" },
  { id: "system", label: "Sistema" },
];

const FONTS: { id: FontChoice; label: string }[] = [
  { id: "Montserrat", label: "Montserrat" },
  { id: "Inter", label: "Inter" },
  { id: "DM Sans", label: "DM Sans" },
  { id: "Nunito", label: "Nunito" },
  { id: "system-ui", label: "Sistema" },
];

const RADII: { id: RadiusScale; label: string }[] = [
  { id: "sm", label: "Suave (10px)" },
  { id: "md", label: "McKenna (14px)" },
  { id: "lg", label: "Redondeado (22px)" },
];

function PreviewCard() {
  return (
    <div
      className="rounded-paper border-2 border-border bg-surface-panel p-4 shadow-paper space-y-3"
      style={{ borderRadius: "var(--mck-radius-paper, 14px)" }}
    >
      <p className="text-sm font-extrabold text-ink">Vista previa</p>
      <p className="text-xs text-muted">Texto secundario y bordes del panel.</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-paper border-2 border-accent bg-accent px-3 py-1.5 text-xs font-bold text-white shadow-[0_2px_0_rgb(var(--mck-accent-hover))] hover:bg-accent-hover"
        >
          Primario
        </button>
        <button
          type="button"
          className="rounded-paper border-2 border-border bg-surface-hover px-3 py-1.5 text-xs font-bold text-ink"
        >
          Secundario
        </button>
        <span className="inline-flex items-center rounded-full border border-border bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent">
          ⚔️ Badge
        </span>
      </div>
    </div>
  );
}

export default function AppearancePanel() {
  const mode = usePanelTheme((s) => s.mode);
  const fontSans = usePanelTheme((s) => s.fontSans);
  const accentRgb = usePanelTheme((s) => s.accentRgb);
  const radius = usePanelTheme((s) => s.radius);
  const setMode = usePanelTheme((s) => s.setMode);
  const setFontSans = usePanelTheme((s) => s.setFontSans);
  const setAccentRgb = usePanelTheme((s) => s.setAccentRgb);
  const setRadius = usePanelTheme((s) => s.setRadius);
  const reset = usePanelTheme((s) => s.reset);
  const apply = usePanelTheme((s) => s.apply);

  useEffect(() => {
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode, apply]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-ink">Apariencia</h2>
        <p className="mt-1 text-sm text-muted">
          Tipografía, colores, cajas y modo del panel. Los cambios se guardan en este navegador.
        </p>
      </div>

      <section className="rounded-xl border border-border bg-surface-panel p-5 space-y-4">
        <h3 className="text-sm font-semibold text-ink">Modo</h3>
        <div className="flex flex-wrap gap-2">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={`rounded-paper border-2 px-4 py-2 text-sm font-semibold transition ${
                mode === m.id
                  ? "border-accent bg-accent/15 text-accent"
                  : "border-border text-ink-secondary hover:bg-surface-hover"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-surface-panel p-5 space-y-4">
        <h3 className="text-sm font-semibold text-ink">Tipografía</h3>
        <select
          value={fontSans}
          onChange={(e) => setFontSans(e.target.value as FontChoice)}
          className="w-full rounded-paper border border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent"
        >
          {FONTS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted">
          Inter, DM Sans y Nunito se cargan desde Google Fonts al elegirlas.
        </p>
      </section>

      <section className="rounded-xl border border-border bg-surface-panel p-5 space-y-4">
        <h3 className="text-sm font-semibold text-ink">Color de acento</h3>
        <div className="flex items-center gap-4">
          <input
            type="color"
            value={rgbToHex(accentRgb)}
            onChange={(e) => setAccentRgb(hexToRgb(e.target.value))}
            className="h-11 w-14 cursor-pointer rounded-lg border border-border bg-transparent"
            aria-label="Color de acento"
          />
          <code className="text-sm text-muted">{rgbToHex(accentRgb)}</code>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-surface-panel p-5 space-y-4">
        <h3 className="text-sm font-semibold text-ink">Cajas (radio)</h3>
        <div className="flex flex-col gap-2">
          {RADII.map((r) => (
            <label
              key={r.id}
              className={`flex cursor-pointer items-center gap-3 rounded-paper border-2 px-3 py-2.5 text-sm font-medium transition ${
                radius === r.id
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border text-ink-secondary hover:bg-surface-hover"
              }`}
            >
              <input
                type="radio"
                name="radius"
                checked={radius === r.id}
                onChange={() => setRadius(r.id)}
                className="accent-accent"
              />
              {r.label}
            </label>
          ))}
        </div>
      </section>

      <PreviewCard />

      <section className="rounded-xl border border-dashed border-border/80 bg-surface-hover/40 p-4 text-sm text-muted">
        <p className="font-medium text-ink-secondary">Próximamente</p>
        <p className="mt-1 text-xs">
          Editor de emojis del tablero, estilos de botones del Centro de Mando y presets guardados con nombre.
        </p>
      </section>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-paper border-2 border-border px-4 py-2 text-sm font-semibold text-ink transition hover:border-accent hover:text-accent"
        >
          Restaurar McKenna
        </button>
        <p className="self-center text-xs text-muted">
          Valores por defecto: modo {MCKENNA_THEME_DEFAULT.mode}, acento #0c6069
        </p>
      </div>
    </div>
  );
}
