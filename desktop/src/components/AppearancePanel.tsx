import { useEffect } from "react";
import { usePanelTheme } from "../stores/panelTheme";
import ThemeStudio from "./ThemeStudio";

export default function AppearancePanel() {
  const mode = usePanelTheme((s) => s.mode);
  const apply = usePanelTheme((s) => s.apply);

  useEffect(() => {
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode, apply]);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h2 className="mck-title text-lg font-semibold">Apariencia</h2>
        <p className="mck-subtitle mt-1 text-sm">
          Variantes Matrix y Sakura, más colores, fuentes y temas propios. Se guarda en tu cuenta.
        </p>
      </div>
      <ThemeStudio />
    </div>
  );
}
