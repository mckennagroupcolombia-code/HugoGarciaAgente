import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../icons";
import { usePanelTheme } from "../stores/panelTheme";
import { useThemesDialog } from "../stores/themesDialog";
import ThemeStudio from "./ThemeStudio";

export default function ThemesDialog() {
  const open = useThemesDialog((s) => s.open);
  const setOpen = useThemesDialog((s) => s.setOpen);
  const mode = usePanelTheme((s) => s.mode);
  const apply = usePanelTheme((s) => s.apply);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, setOpen]);

  useEffect(() => {
    if (!open || mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [open, mode, apply]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-end justify-center sm:items-center sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-ink/40 backdrop-blur-[3px]"
        aria-label="Cerrar temas"
        onClick={() => setOpen(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mck-temas-title"
        className="relative z-10 flex max-h-[min(92dvh,44rem)] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border-2 border-border bg-surface-panel shadow-paper-lg sm:rounded-2xl"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h2 id="mck-temas-title" className="mck-title text-lg font-bold tracking-tight">
              Temas
            </h2>
            <p className="mck-subtitle text-sm">
              Matrix, Sakura o crea el tuyo. Se guarda en tu cuenta.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mck-press inline-flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted hover:bg-surface-hover hover:text-ink"
            aria-label="Cerrar"
          >
            <Icon name="close" size={18} weight="bold" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
          <ThemeStudio />
        </div>
      </div>
    </div>,
    document.body,
  );
}
