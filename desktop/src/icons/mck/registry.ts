import type { ReactNode } from "react";
import type { Panel } from "../../stores/app";
import type { IconName, UiIconName } from "../types";
import { MCK_PANEL_PATHS } from "./paths/panels";
import { MCK_UI_PATHS } from "./paths/ui";

export function resolveMckPaths(name: IconName): ReactNode | null {
  if (name in MCK_PANEL_PATHS) {
    return MCK_PANEL_PATHS[name as Panel];
  }
  if (name in MCK_UI_PATHS) {
    return MCK_UI_PATHS[name as UiIconName];
  }
  return null;
}

export { MCK_PANEL_PATHS, MCK_UI_PATHS };
