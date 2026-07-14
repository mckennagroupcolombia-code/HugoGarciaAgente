import type { ReactNode } from "react";
import { useAppStore } from "../../stores/app";

/** Entrada suave al cambiar de panel (respeta prefers-reduced-motion). */
export function PanelTransition({ children }: { children: ReactNode }) {
  const panel = useAppStore((s) => s.panel);
  // Centro de Mando depende de un scroll interno (quest-canvas → overflow-y-auto):
  // sin la cadena flex con altura definida, el contenido queda recortado por los
  // overflow-hidden de Layout y no se puede desplazar (visible sobre todo en móvil).
  const isCentroMando = panel === "hugo" || panel === "tickets";
  return (
    <div
      key={panel}
      className={`mck-animate-enter min-h-0 w-full ${isCentroMando ? "flex flex-1 flex-col" : ""}`}
    >
      {children}
    </div>
  );
}
