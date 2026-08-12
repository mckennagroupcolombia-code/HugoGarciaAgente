import { Icon } from "../icons";
import { usePanelTheme } from "../stores/panelTheme";
import { useThemesDialog } from "../stores/themesDialog";
import { rgbToHex } from "../theme/applyTheme";

const SIDEBAR_BTN =
  "flex w-full items-center gap-2 rounded-lg border border-transparent px-2 py-2 text-left text-[11px] font-semibold text-muted transition hover:border-border-strong hover:bg-surface-hover hover:text-ink";

/** Abre el diálogo de temas (portal). No despliega dentro del sidebar. */
export default function TemasSidebarButton() {
  const toggle = useThemesDialog((s) => s.toggle);
  const open = useThemesDialog((s) => s.open);
  const accentRgb = usePanelTheme((s) => s.accentRgb);
  const accentHex = rgbToHex(accentRgb);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-expanded={open}
      aria-haspopup="dialog"
      className={SIDEBAR_BTN}
    >
      <Icon name="palette" size={20} weight="regular" className="shrink-0" />
      Temas
      <span
        className="ml-auto h-4 w-4 shrink-0 rounded-full border border-border shadow-sm"
        style={{ backgroundColor: accentHex }}
        aria-hidden
      />
    </button>
  );
}

/** Botón compacto del cabezote (junto a claro/oscuro). */
export function TemasHeaderButton() {
  const toggle = useThemesDialog((s) => s.toggle);
  const open = useThemesDialog((s) => s.open);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-expanded={open}
      aria-haspopup="dialog"
      title="Temas y estilo visual"
      aria-label="Temas y estilo visual"
      className="mck-press inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-surface-panel text-muted shadow-paper-sm transition-colors hover:border-accent/40 hover:bg-surface-hover hover:text-ink sm:h-9 sm:w-9"
    >
      <Icon name="palette" size={18} weight="regular" />
    </button>
  );
}
