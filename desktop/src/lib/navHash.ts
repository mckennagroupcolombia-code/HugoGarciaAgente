import type { Panel } from "../stores/app";

const PANEL_RE = /^#\/([a-z0-9-]+)(?:\/([a-z0-9_]+))?$/i;

export interface NavHash {
  panel: Panel;
  view?: string;
}

/** Lee panel (y sub-vista) desde el hash `#/panel`, `#/hugo/acciones` o `#/etiquetas/studio`. */
export function readNavHash(): NavHash | null {
  if (typeof window === "undefined") return null;
  const m = window.location.hash.match(PANEL_RE);
  if (!m?.[1]) return null;
  return { panel: m[1] as Panel, view: m[2] || undefined };
}

/** Sincroniza hash sin añadir entrada al historial del navegador. */
export function writeNavHash(panel: Panel, view?: string) {
  if (typeof window === "undefined") return;
  const next = view ? `#/${panel}/${view}` : `#/${panel}`;
  if (window.location.hash === next) return;
  const url = `${window.location.pathname}${window.location.search}${next}`;
  window.history.replaceState(window.history.state, "", url);
}
