import { MCKENNA_THEME_DEFAULT, sanitizePanelTheme } from "../theme/presets";
import type { PanelThemeConfig } from "../theme/types";
import { usePanelTheme } from "../stores/panelTheme";
import { useQuestTheme } from "../stores/questTheme";
import { useTicketsAuth } from "../stores/ticketsAuth";

export interface UserUiPreferences {
  panel?: Partial<PanelThemeConfig>;
  quest?: { dark?: boolean };
  /** Versión del estilo base que esta persona ya adoptó (ver ESTILO_BASE_V). */
  estilo_v?: number;
}

/**
 * v4 (26-sep-2026): se vuelve a llevar a todos a «Pixel». Tras la v3, Armando quedó en «Sakura» (tema retirado el 26-sep-2026) y
 * Cynthia en «Barbie»: veían el Mapa en pixel (lo es siempre) y los módulos por dentro en otra piel,
 * y parecía que la traducción de colores no se aplicaba. Quien prefiera otra la elige en Temas.
 * v3 (25-sep-2026): «Pixel» con la LETRA DE SIEMPRE (Montserrat): la v2 traía también una
 * fuente pixel y se leía peor. Subir a 3 le devuelve la letra a quien ya adoptó la v2.
 * v2 (25-sep-2026): el estilo base pasó a «Pixel» (la app como un videojuego, el lenguaje
 * del Mapa y de Colaboradores). v1 (21-sep-2026) fue «Flujo».
 *
 * El estilo predeterminado de toda la app cambió a «Flujo» (la interfaz como diagrama).
 * Un default nuevo no alcanza a quien ya tenía un tema guardado, así que la primera vez
 * que cada persona entra se le aplica el estilo base UNA vez y se anota esta versión:
 * de ahí en adelante manda lo que elija en Temas. Se conservan el modo claro/oscuro, los
 * tamaños, el zoom y sus temas guardados (siguen en Temas → Mis temas).
 * Subir el número solo si se quiere volver a llevar a todos a un estilo base nuevo.
 */
export const ESTILO_BASE_V = 4;

let migracionPendiente = false;

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
    uiZoom: panel.uiZoom,
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
    estilo_v: ESTILO_BASE_V,
  };
}

/** Aplica preferencias del servidor sin disparar guardado. */
export function applyUserUiPreferences(prefs: UserUiPreferences | null | undefined) {
  hydrating = true;
  try {
    const guardado = prefs?.panel ?? {};
    const adoptar = (prefs?.estilo_v ?? 0) < ESTILO_BASE_V;
    migracionPendiente = adoptar;
    const panel = sanitizePanelTheme(
      adoptar
        ? {
            ...MCKENNA_THEME_DEFAULT,
            mode: guardado.mode ?? MCKENNA_THEME_DEFAULT.mode,
            fontScale: guardado.fontScale ?? MCKENNA_THEME_DEFAULT.fontScale,
            menuScale: guardado.menuScale ?? MCKENNA_THEME_DEFAULT.menuScale,
            uiZoom: guardado.uiZoom ?? MCKENNA_THEME_DEFAULT.uiZoom,
            customThemes: guardado.customThemes ?? [],
          }
        : { ...MCKENNA_THEME_DEFAULT, ...guardado },
    );
    usePanelTheme.getState().hydrate(panel, prefs?.quest?.dark);
  } finally {
    hydrating = false;
  }
}

export function resetSaveBaseline(prefs: UserUiPreferences | null | undefined) {
  lastSavedJson = JSON.stringify(prefs ?? buildUserUiPreferences());
}

/** Tras hidratar: si se acaba de adoptar el estilo base, guardarlo para no repetirlo. */
export function guardarMigracionEstilo(token: string) {
  if (!migracionPendiente || !token) return;
  migracionPendiente = false;
  lastSavedJson = "";
  void flushSaveUserUiPreferences(token);
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
