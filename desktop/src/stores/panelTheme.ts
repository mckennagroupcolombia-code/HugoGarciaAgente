import { create } from "zustand";
import { applyPanelTheme } from "../theme/applyTheme";
import {
  MCKENNA_THEME_DEFAULT,
  MAX_CUSTOM_THEMES,
  sanitizePanelTheme,
  snapshotAsCustomTheme,
  THEME_PACKS,
} from "../theme/presets";
import type {
  FontChoice,
  FontScale,
  MenuScale,
  PanelThemeConfig,
  RadiusScale,
  ThemeColorKey,
  ThemeMode,
  ThemePackId,
  UiSkin,
} from "../theme/types";
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

function commit(patch: Partial<PanelThemeConfig>, set: (p: Partial<PanelThemeConfig>) => void, get: () => PanelThemeState) {
  set(patch);
  applyPanelTheme({ ...get() });
}

interface PanelThemeState extends PanelThemeConfig {
  setMode: (mode: ThemeMode) => void;
  setFontSans: (font: FontChoice) => void;
  setAccentRgb: (rgb: string) => void;
  setRadius: (radius: RadiusScale) => void;
  setSkin: (skin: UiSkin) => void;
  setFontScale: (fontScale: FontScale) => void;
  setMenuScale: (menuScale: MenuScale) => void;
  setColor: (key: ThemeColorKey, rgb: string) => void;
  clearColor: (key: ThemeColorKey) => void;
  clearColors: () => void;
  applyPack: (id: ThemePackId) => void;
  saveCustomTheme: (name: string) => string | null;
  applyCustomTheme: (id: string) => void;
  deleteCustomTheme: (id: string) => void;
  renameCustomTheme: (id: string, name: string) => void;
  reset: () => void;
  apply: () => void;
  hydrate: (config: PanelThemeConfig, questDarkOverride?: boolean) => void;
}

export const usePanelTheme = create<PanelThemeState>()((set, get) => ({
  ...MCKENNA_THEME_DEFAULT,
  setMode: (mode) => {
    commit({ mode, activeCustomId: null }, set, get);
    syncQuestDark(mode);
  },
  setFontSans: (fontSans) => commit({ fontSans, activeCustomId: null }, set, get),
  setAccentRgb: (accentRgb) => commit({ accentRgb, activeCustomId: null }, set, get),
  setRadius: (radius) => commit({ radius, activeCustomId: null }, set, get),
  setSkin: (skin) => commit({ skin, activeCustomId: null }, set, get),
  setFontScale: (fontScale) => commit({ fontScale, activeCustomId: null }, set, get),
  setMenuScale: (menuScale) => commit({ menuScale, activeCustomId: null }, set, get),
  setColor: (key, rgb) => {
    const colors = { ...get().colors, [key]: rgb };
    commit({ colors, activeCustomId: null }, set, get);
  },
  clearColor: (key) => {
    const colors = { ...get().colors };
    delete colors[key];
    commit({ colors, activeCustomId: null }, set, get);
  },
  clearColors: () => commit({ colors: {}, activeCustomId: null }, set, get),
  applyPack: (id) => {
    const pack = THEME_PACKS.find((p) => p.id === id);
    if (!pack) return;
    const next = {
      skin: pack.skin,
      fontSans: pack.fontSans,
      radius: pack.radius,
      fontScale: pack.fontScale,
      menuScale: pack.menuScale,
      accentRgb: pack.accentRgb,
      mode: pack.mode,
      colors: {},
      activeCustomId: null,
    };
    set(next);
    applyPanelTheme({ ...get() });
    syncQuestDark(pack.mode);
  },
  saveCustomTheme: (name) => {
    const state = get();
    if (state.customThemes.length >= MAX_CUSTOM_THEMES) return null;
    const preset = snapshotAsCustomTheme(name, state);
    const customThemes = [...state.customThemes, preset];
    set({ customThemes, activeCustomId: preset.id });
    applyPanelTheme({ ...get() });
    return preset.id;
  },
  applyCustomTheme: (id) => {
    const preset = get().customThemes.find((t) => t.id === id);
    if (!preset) return;
    set({
      mode: preset.mode,
      fontSans: preset.fontSans,
      accentRgb: preset.accentRgb,
      radius: preset.radius,
      skin: preset.skin,
      fontScale: preset.fontScale,
      menuScale: preset.menuScale,
      colors: { ...preset.colors },
      activeCustomId: preset.id,
    });
    applyPanelTheme({ ...get() });
    syncQuestDark(preset.mode);
  },
  deleteCustomTheme: (id) => {
    const customThemes = get().customThemes.filter((t) => t.id !== id);
    const activeCustomId = get().activeCustomId === id ? null : get().activeCustomId;
    set({ customThemes, activeCustomId });
    applyPanelTheme({ ...get() });
  },
  renameCustomTheme: (id, name) => {
    const trimmed = name.trim().slice(0, 40);
    if (!trimmed) return;
    set({
      customThemes: get().customThemes.map((t) => (t.id === id ? { ...t, name: trimmed } : t)),
    });
  },
  reset: () => {
    set({ ...MCKENNA_THEME_DEFAULT, customThemes: get().customThemes });
    applyPanelTheme({ ...get() });
    syncQuestDark(MCKENNA_THEME_DEFAULT.mode);
  },
  apply: () => {
    const state = get();
    applyPanelTheme(state);
    syncQuestDark(state.mode);
  },
  hydrate: (config, questDarkOverride) => {
    const safe = sanitizePanelTheme(config);
    set(safe);
    applyPanelTheme(safe);
    syncQuestDark(safe.mode, questDarkOverride);
  },
}));
