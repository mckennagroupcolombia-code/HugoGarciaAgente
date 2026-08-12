import { useEffect, useState } from "react";
import { Icon } from "../icons";
import { usePanelTheme } from "../stores/panelTheme";
import type { ThemeMode } from "../theme/types";

function resolveIsDark(mode: ThemeMode): boolean {
  if (mode === "dark") return true;
  if (mode === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * Toggle rápido claro/oscuro (estilo Cursor).
 * Si el modo es "sistema", fija el opuesto explícito al valor resuelto.
 */
export default function ThemeModeToggle({
  className = "",
  variant = "icon",
}: {
  className?: string;
  variant?: "icon" | "sidebar";
}) {
  const mode = usePanelTheme((s) => s.mode);
  const setMode = usePanelTheme((s) => s.setMode);
  const [dark, setDark] = useState(() => resolveIsDark(mode));

  useEffect(() => {
    setDark(resolveIsDark(mode));
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);

  function toggle() {
    setMode(dark ? "light" : "dark");
  }

  const label = dark ? "Modo claro" : "Modo oscuro";

  if (variant === "sidebar") {
    return (
      <button
        type="button"
        onClick={toggle}
        title={label}
        aria-pressed={dark}
        aria-label={label}
        className={`mck-press flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-muted transition-colors hover:bg-surface-hover hover:text-ink ${className}`.trim()}
      >
        {dark ? (
          <Icon name="sun" size={18} weight="regular" className="shrink-0" />
        ) : (
          <Icon name="moon" size={18} weight="regular" className="shrink-0" />
        )}
        {label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-pressed={dark}
      aria-label={label}
      className={`mck-press inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-surface-panel text-muted shadow-paper-sm transition-colors hover:border-accent/40 hover:bg-surface-hover hover:text-ink sm:h-9 sm:w-9 ${className}`.trim()}
    >
      {dark ? (
        <Icon name="sun" size={18} weight="regular" />
      ) : (
        <Icon name="moon" size={18} weight="regular" />
      )}
    </button>
  );
}
