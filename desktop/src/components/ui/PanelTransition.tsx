import type { ReactNode } from "react";
import { useAppStore } from "../../stores/app";
import { esPanelContabilidad } from "../../lib/contabilidadAccess";

/** Entrada suave al cambiar de panel (respeta prefers-reduced-motion). */
export function PanelTransition({ children }: { children: ReactNode }) {
  const panel = useAppStore((s) => s.panel);
  // Hubs con scroll interno (Centro de Mando, Contabilidad, Tienda): altura flex.
  const fillHeight =
    panel === "hugo" ||
    panel === "tickets" ||
    esPanelContabilidad(panel) ||
    panel === "publicaciones" ||
    panel === "placas-concreto";
  // Misma key en todo el hub Contabilidad: si no, cada pestaña remonta el árbol
  // y se pierde keep-alive (Stock/Rentabilidad) + estado de filtros.
  const transitionKey = esPanelContabilidad(panel) ? "hub-contabilidad" : panel;
  return (
    <div
      key={transitionKey}
      className={`mck-animate-enter min-h-0 w-full ${fillHeight ? "flex flex-1 flex-col" : ""}`}
    >
      {children}
    </div>
  );
}
