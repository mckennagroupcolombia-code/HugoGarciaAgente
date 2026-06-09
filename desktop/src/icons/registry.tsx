import type { Panel } from "../stores/app";
import { MCK_PANEL_PATHS, MCK_UI_PATHS, resolveMckPaths } from "./mck/registry";
import type { UiIconName } from "./types";

/** @deprecated Usar resolveMckPaths / componente Icon. Mapa de paths por panel. */
export const PANEL_ICON = MCK_PANEL_PATHS;

/** @deprecated Usar resolveMckPaths / componente Icon. Mapa de paths por acción UI. */
export const UI_ICON = MCK_UI_PATHS;

export function isUiIconName(v: string): v is UiIconName {
  return v in MCK_UI_PATHS;
}

/** Resuelve paths SVG del set McKenna. */
export function resolvePhosphorIcon(name: Panel | UiIconName) {
  return resolveMckPaths(name);
}

export { resolveMckPaths, MCK_PANEL_PATHS, MCK_UI_PATHS };
