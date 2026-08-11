import { useState } from "react";
import { hexToRgb, readCssColor, rgbToHex } from "../theme/applyTheme";
import {
  ACCENT_PRESETS,
  COLOR_CSS_VARS,
  COLOR_LABELS,
  FONT_CHOICES,
  FONT_SCALES,
  MAX_CUSTOM_THEMES,
  MENU_SCALES,
  THEME_COLOR_KEYS,
} from "../theme/presets";
import type { FontChoice, FontScale, MenuScale, ThemeColorKey, ThemeMode } from "../theme/types";
import { usePanelTheme } from "../stores/panelTheme";
import ThemePackPicker from "./ThemePackPicker";

const MODES: { id: ThemeMode; label: string }[] = [
  { id: "light", label: "Claro" },
  { id: "dark", label: "Oscuro" },
  { id: "system", label: "Sistema" },
];

const COLOR_GROUPS: { title: string; keys: ThemeColorKey[] }[] = [
  { title: "Superficies y cajas", keys: ["surface", "sectionBg", "surfacePanel", "cardBg", "surfaceInput", "surfaceHover"] },
  { title: "Textos", keys: ["title", "subtitle", "ink", "inkSecondary", "muted"] },
  { title: "Menú lateral", keys: ["menuBg", "menuText", "menuActiveBg", "menuActiveText"] },
  { title: "Submenús y pestañas", keys: ["submenuBg", "submenuText"] },
  { title: "Bordes", keys: ["border", "borderStrong"] },
];

function ColorField({ colorKey }: { colorKey: ThemeColorKey }) {
  const override = usePanelTheme((s) => s.colors[colorKey]);
  const setColor = usePanelTheme((s) => s.setColor);
  const clearColor = usePanelTheme((s) => s.clearColor);
  const effective = override || readCssColor(COLOR_CSS_VARS[colorKey]);
  const hex = rgbToHex(effective);

  return (
    <label className="flex items-center gap-2 rounded-xl border border-border bg-surface-input px-2.5 py-2">
      <input
        type="color"
        value={hex}
        onChange={(e) => setColor(colorKey, hexToRgb(e.target.value))}
        className="h-8 w-9 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
        aria-label={COLOR_LABELS[colorKey]}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold text-ink">{COLOR_LABELS[colorKey]}</span>
        <span className="font-mono text-[10px] text-muted">{hex}</span>
      </span>
      {override && (
        <button
          type="button"
          onClick={() => clearColor(colorKey)}
          className="shrink-0 text-[10px] font-bold text-muted hover:text-accent"
        >
          Reset
        </button>
      )}
    </label>
  );
}

/** Editor completo: variantes, tipo, tamaños, colores y temas del usuario. */
export default function ThemeStudio() {
  const mode = usePanelTheme((s) => s.mode);
  const fontSans = usePanelTheme((s) => s.fontSans);
  const fontScale = usePanelTheme((s) => s.fontScale);
  const menuScale = usePanelTheme((s) => s.menuScale);
  const accentRgb = usePanelTheme((s) => s.accentRgb);
  const customThemes = usePanelTheme((s) => s.customThemes);
  const activeCustomId = usePanelTheme((s) => s.activeCustomId);
  const setMode = usePanelTheme((s) => s.setMode);
  const setFontSans = usePanelTheme((s) => s.setFontSans);
  const setFontScale = usePanelTheme((s) => s.setFontScale);
  const setMenuScale = usePanelTheme((s) => s.setMenuScale);
  const setAccentRgb = usePanelTheme((s) => s.setAccentRgb);
  const saveCustomTheme = usePanelTheme((s) => s.saveCustomTheme);
  const applyCustomTheme = usePanelTheme((s) => s.applyCustomTheme);
  const deleteCustomTheme = usePanelTheme((s) => s.deleteCustomTheme);
  const reset = usePanelTheme((s) => s.reset);
  const clearColors = usePanelTheme((s) => s.clearColors);

  const [newName, setNewName] = useState("");
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  function guardar() {
    const id = saveCustomTheme(newName || "Mi tema");
    if (!id) {
      setSaveMsg(`Tope de ${MAX_CUSTOM_THEMES} temas propios.`);
      return;
    }
    setNewName("");
    setSaveMsg("Tema guardado en tu cuenta.");
  }

  const accentHex = rgbToHex(accentRgb);

  return (
    <div className="space-y-5">
      <ThemePackPicker />

      <section>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Mis temas</p>
        {customThemes.length > 0 && (
          <div className="mb-2 space-y-1.5">
            {customThemes.map((t) => (
              <div
                key={t.id}
                className={`flex items-center gap-2 rounded-xl border-2 px-2.5 py-2 ${
                  activeCustomId === t.id ? "border-accent bg-accent/10" : "border-border"
                }`}
              >
                <button
                  type="button"
                  onClick={() => applyCustomTheme(t.id)}
                  className="min-w-0 flex-1 truncate text-left text-sm font-bold text-ink"
                >
                  {t.name}
                </button>
                <button
                  type="button"
                  onClick={() => deleteCustomTheme(t.id)}
                  className="text-[11px] font-bold text-danger hover:underline"
                >
                  Borrar
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nombre de tu tema"
            maxLength={40}
            className="min-w-0 flex-1 rounded-xl border border-border bg-surface-input px-3 py-2 text-sm text-ink"
          />
          <button
            type="button"
            onClick={guardar}
            className="mck-btn mck-btn-primary shrink-0 px-3 py-2 text-sm"
          >
            Guardar actual
          </button>
        </div>
        {saveMsg && <p className="mt-1.5 text-xs font-semibold text-muted">{saveMsg}</p>}
      </section>

      <section>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Modo</p>
        <div className="grid grid-cols-3 gap-2">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={`rounded-xl border-2 px-2 py-2 text-sm font-bold transition ${
                mode === m.id
                  ? "border-accent bg-accent/12 text-accent"
                  : "border-border text-muted hover:border-accent/50 hover:text-ink"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Fuente</span>
          <select
            value={fontSans}
            onChange={(e) => setFontSans(e.target.value as FontChoice)}
            className="w-full rounded-xl border border-border bg-surface-input px-3 py-2 text-sm text-ink"
          >
            {FONT_CHOICES.map((f) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Tamaño de texto</span>
          <select
            value={fontScale}
            onChange={(e) => setFontScale(e.target.value as FontScale)}
            className="w-full rounded-xl border border-border bg-surface-input px-3 py-2 text-sm text-ink"
          >
            {FONT_SCALES.map((f) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Tamaño del menú</span>
          <select
            value={menuScale}
            onChange={(e) => setMenuScale(e.target.value as MenuScale)}
            className="w-full rounded-xl border border-border bg-surface-input px-3 py-2 text-sm text-ink"
          >
            {MENU_SCALES.map((f) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>
        </label>
      </section>

      <section>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Color de acento</p>
        <div className="grid grid-cols-5 gap-2">
          {ACCENT_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              title={p.label}
              onClick={() => setAccentRgb(p.rgb)}
              className={`flex flex-col items-center gap-1 rounded-xl border-2 p-1.5 ${
                accentRgb === p.rgb ? "border-accent bg-accent/10" : "border-transparent hover:border-border"
              }`}
            >
              <span className="h-7 w-7 rounded-full border border-black/10 shadow-sm" style={{ backgroundColor: p.hex }} />
              <span className="w-full truncate text-center text-[10px] font-semibold text-muted">{p.label}</span>
            </button>
          ))}
        </div>
        <label className="mt-2 flex items-center gap-2 rounded-xl border border-border bg-surface-input px-3 py-2">
          <input
            type="color"
            value={accentHex}
            onChange={(e) => setAccentRgb(hexToRgb(e.target.value))}
            className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent p-0"
            aria-label="Acento personalizado"
          />
          <span className="text-xs font-mono text-muted">{accentHex}</span>
        </label>
      </section>

      {COLOR_GROUPS.map((group) => (
        <section key={group.title}>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">{group.title}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {group.keys.map((key) => (
              <ColorField key={key} colorKey={key} />
            ))}
          </div>
        </section>
      ))}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => clearColors()} className="rounded-xl border border-border px-3 py-2 text-sm font-semibold text-muted hover:text-accent">
          Quitar colores propios
        </button>
        <button type="button" onClick={() => reset()} className="rounded-xl border border-border px-3 py-2 text-sm font-semibold text-muted hover:text-accent">
          Restaurar Sakura
        </button>
      </div>
    </div>
  );
}
