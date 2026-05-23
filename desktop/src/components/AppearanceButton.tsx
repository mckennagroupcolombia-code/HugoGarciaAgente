import { useAppStore } from "../stores/app";

const PALETTE_ICON = (
  <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
    />
  </svg>
);

type Variant = "nav" | "icon" | "compact";

export default function AppearanceButton({
  variant = "icon",
  className = "",
}: {
  variant?: Variant;
  className?: string;
}) {
  const panel = useAppStore((s) => s.panel);
  const setPanel = useAppStore((s) => s.setPanel);
  const active = panel === "appearance";

  const open = () => setPanel("appearance");

  if (variant === "nav") {
    return (
      <button
        type="button"
        onClick={open}
        title="Apariencia del panel"
        className={`
          flex w-full items-center gap-3 rounded-paper border-2 px-3 py-2.5 text-left text-sm font-semibold transition
          ${active
            ? "border-ink bg-surface-hover text-ink"
            : "border-transparent text-ink-secondary hover:bg-surface-hover"
          }
          ${className}
        `}
      >
        {PALETTE_ICON}
        <span className="min-w-0 flex-1 truncate">Apariencia</span>
      </button>
    );
  }

  if (variant === "compact") {
    return (
      <button
        type="button"
        onClick={open}
        title="Apariencia"
        aria-label="Abrir ajustes de apariencia"
        aria-current={active ? "page" : undefined}
        className={`
          inline-flex h-9 w-9 items-center justify-center rounded-full border-2 transition
          ${active
            ? "border-accent bg-accent/15 text-accent"
            : "border-border bg-surface-panel text-muted hover:border-accent hover:text-accent"
          }
          ${className}
        `}
      >
        {PALETTE_ICON}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={open}
      title="Apariencia del panel"
      aria-label="Abrir ajustes de apariencia"
      aria-current={active ? "page" : undefined}
      className={`
        inline-flex items-center gap-2 rounded-paper border-2 px-3 py-2 text-sm font-semibold transition
        ${active
          ? "border-accent bg-accent/15 text-accent"
          : "border-border bg-surface-panel text-ink-secondary hover:border-accent hover:text-accent"
        }
        ${className}
      `}
    >
      {PALETTE_ICON}
      <span className="hidden sm:inline">Apariencia</span>
    </button>
  );
}
