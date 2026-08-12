import { MCKENNA_THEME_DEFAULT, sanitizePanelTheme } from "../theme/presets";
import type { PanelThemeConfig } from "../theme/types";
import { usePanelTheme } from "../stores/panelTheme";
import { useQuestTheme } from "../stores/questTheme";
import { useTicketsAuth } from "../stores/ticketsAuth";

export interface UserUiPreferences {
  panel?: Partial<PanelThemeConfig>;
  quest?: { dark?: boolean };
}

let hydrating = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSavedJson = "";

export function panelThemeSnapshot(panel: PanelThemeConfig) {
  return {
    mode: panel.mode,
    fontSans: panel.fontSans,
    accentRgb: panel.accentRgb,
    radius: panel.radius,
    skin: panel.skin,
    fontScale: panel.fontScale,
    menuScale: panel.menuScale,
    colors: panel.colors,
    customThemes: panel.customThemes,
    activeCustomId: panel.activeCustomId,
  };
}

export function buildUserUiPreferences(): UserUiPreferences {
  const panel = usePanelTheme.getState();
  const quest = useQuestTheme.getState();
  return {
    panel: panelThemeSnapshot(panel),
    quest: { dark: quest.dark },
  };
}

/** Aplica preferencias del servidor sin disparar guardado. */
export function applyUserUiPreferences(prefs: UserUiPreferences | null | undefined) {
  hydrating = true;
  try {
    const panel = sanitizePanelTheme({
      ...MCKENNA_THEME_DEFAULT,
      ...(prefs?.panel ?? {}),
    });
    usePanelTheme.getState().hydrate(panel, prefs?.quest?.dark);
  } finally {
    hydrating = false;
  }
}

export function resetSaveBaseline(prefs: UserUiPreferences | null | undefined) {
  lastSavedJson = JSON.stringify(prefs ?? buildUserUiPreferences());
}

export function scheduleSaveUserUiPreferences(token: string) {
  if (hydrating || !token) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void flushSaveUserUiPreferences(token);
  }, 500);
}

/** Guarda de inmediato (p. ej. al elegir pack o antes de cerrar sesión). */
export async function flushSaveUserUiPreferences(token: string): Promise<boolean> {
  if (hydrating || !token) return false;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const prefs = buildUserUiPreferences();
  const json = JSON.stringify(prefs);
  if (json === lastSavedJson) return true;
  try {
    const r = await fetch("/api/tickets/auth/me/preferencias", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: json,
    });
    if (!r.ok) return false;
    const data = await r.json().catch(() => null);
    if (!data?.ok) return false;
    lastSavedJson = json;
    // Mantener preferencias en la sesión persistida del navegador.
    const auth = useTicketsAuth.getState();
    if (auth.user && auth.token === token) {
      useTicketsAuth.setState({
        user: { ...auth.user, preferencias_ui: prefs },
      });
    }
    return true;
  } catch {
    return false;
  }
}
