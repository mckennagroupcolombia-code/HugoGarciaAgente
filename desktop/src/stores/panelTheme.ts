import { create } from "zustand";
import { persist } from "zustand/middleware";
import { applyPanelTheme } from "../theme/applyTheme";
import { MCKENNA_THEME_DEFAULT } from "../theme/presets";
import type { FontChoice, PanelThemeConfig, RadiusScale, ThemeMode } from "../theme/types";

interface PanelThemeState extends PanelThemeConfig {
  setMode: (mode: ThemeMode) => void;
  setFontSans: (font: FontChoice) => void;
  setAccentRgb: (rgb: string) => void;
  setRadius: (radius: RadiusScale) => void;
  reset: () => void;
  apply: () => void;
}

export const usePanelTheme = create<PanelThemeState>()(
  persist(
    (set, get) => ({
      ...MCKENNA_THEME_DEFAULT,
      setMode: (mode) => {
        set({ mode });
        applyPanelTheme({ ...get(), mode });
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
      },
      apply: () => applyPanelTheme(get()),
    }),
    {
      name: "mckenna-panel-theme",
      partialize: (s) => ({
        mode: s.mode,
        fontSans: s.fontSans,
        accentRgb: s.accentRgb,
        radius: s.radius,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) applyPanelTheme(state);
      },
    },
  ),
);
