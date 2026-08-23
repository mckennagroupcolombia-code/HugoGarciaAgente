/**
 * Estilo unificado de pestañas (cabezote y tabs internos).
 * Misma tipografía/densidad que el menú lateral (`mck-nav-item`).
 */
export function hubTabClass(selected: boolean, extra = ""): string {
  return [
    "mck-hub-tab mck-nav-item mck-press inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-left",
    selected ? "is-active" : "hover:bg-surface-hover hover:text-ink",
    extra,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Etiqueta de pestaña: el CSS la oculta cuando hay icono (tooltip / aria-label). */
export const HUB_TAB_LABEL = "mck-hub-tab-label text-[13px] font-semibold leading-none truncate";
