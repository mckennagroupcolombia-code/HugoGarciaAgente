import type { ReactNode } from "react";
import { useAppStore } from "../../stores/app";

/** Entrada suave al cambiar de panel (respeta prefers-reduced-motion). */
export function PanelTransition({ children }: { children: ReactNode }) {
  const panel = useAppStore((s) => s.panel);
  return (
    <div key={panel} className="mck-animate-enter min-h-0 w-full">
      {children}
    </div>
  );
}
