import { create } from "zustand";
import { applyPanelTheme } from "../theme/applyTheme";
import { MCKENNA_THEME_DEFAULT } from "../theme/presets";
import type { FontChoice, PanelThemeConfig, RadiusScale, ThemeMode } from "../theme/types";
import { useQuestTheme } from "./questTheme";

function syncQuestDark(mode: ThemeMode, questDarkOverride?: boolean) {
  if (questDarkOverride !== undefined) {
    useQuestTheme.getState().setDark(questDarkOverride);
    return;
  }
  const dark =
    mode === "dark"
      ? true
      : mode === "light"
        ? false
        : window.matchMedia("(prefers-color-scheme: dark)").matches;
  useQuestTheme.getState().setDark(dark);
}

interface PanelThemeState extends PanelThemeConfig {
  setMode: (mode: ThemeMode) => void;
  setFontSans: (font: FontChoice) => void;
  setAccentRgb: (rgb: string) => void;
  setRadius: (radius: RadiusScale) => void;
  reset: () => void;
  apply: () => void;
  /** Carga preferencias del usuario (servidor) sin persistencia local global. */
  hydrate: (config: PanelThemeConfig, questDarkOverride?: boolean) => void;
}

export const usePanelTheme = create<PanelThemeState>()((set, get) => ({
  ...MCKENNA_THEME_DEFAULT,
  setMode: (mode) => {
    set({ mode });
    applyPanelTheme({ ...get(), mode });
    syncQuestDark(mode);
  },
  setFontSans: (fontSans) => {
    set({ fontSans });
    applyPanelTheme({ ...get(), fontSans });
  },
  setAccentRgb: (accentRgb) => {
    set({ accentRgb });
    applyPanelTheme({ ...get(), accentRgb });
  },
  setRadius: (radius) => {
    set({ radius });
    applyPanelTheme({ ...get(), radius });
  },
  reset: () => {
    set({ ...MCKENNA_THEME_DEFAULT });
    applyPanelTheme(MCKENNA_THEME_DEFAULT);
    syncQuestDark(MCKENNA_THEME_DEFAULT.mode);
  },
  apply: () => {
    const state = get();
    applyPanelTheme(state);
    syncQuestDark(state.mode);
  },
  hydrate: (config, questDarkOverride) => {
    set(config);
    applyPanelTheme(config);
    syncQuestDark(config.mode, questDarkOverride);
  },
}));
