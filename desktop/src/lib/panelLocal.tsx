/**
 * «Panel local»: un módulo abierto DENTRO de otro sitio (hoy, dentro de Empresa viva) sin tocar el
 * panel de la app (`useAppStore.panel`).
 *
 * Los módulos con secciones (Contabilidad, Facturación, Negocio, Inventario, Logística, Operativos)
 * eligen la sección por el panel abierto y, al cambiar de pestaña, llaman `setPanel`. Afuera eso es
 * el store; adentro del juego ese panel es «empresa-viva» y cambiarlo sacaría a la persona del
 * juego. Con este contexto el módulo ve SU panel y navega dentro de la ventana del juego.
 *
 * Uso en un módulo: `usePanelActual()` en vez de `useAppStore((s) => s.panel)` y `useIrAPanel()` en
 * vez de `useAppStore((s) => s.setPanel)`. Sin proveedor, se comportan igual que el store.
 *
 * Lo que un módulo navegue por el store directo (un botón de otro componente) lo atrapa el juego con
 * `interceptarPanel` (stores/app.ts), solo si el clic salió de su ventana.
 */
import { createContext, useContext } from "react";
import { useAppStore, type Panel } from "../stores/app";

export interface PanelLocalValor {
  panel: Panel;
  irA: (p: Panel) => void;
}

export const PanelLocal = createContext<PanelLocalValor | null>(null);

/** El panel que este módulo debe mostrar: el local (dentro del juego) o el de la app. */
export function usePanelActual(): Panel {
  const local = useContext(PanelLocal);
  const global = useAppStore((s) => s.panel);
  return local?.panel ?? global;
}

/** Ir a otro panel: dentro del juego, en la misma ventana; afuera, como siempre. */
export function useIrAPanel(): (p: Panel) => void {
  const local = useContext(PanelLocal);
  const global = useAppStore((s) => s.setPanel);
  return local?.irA ?? global;
}
