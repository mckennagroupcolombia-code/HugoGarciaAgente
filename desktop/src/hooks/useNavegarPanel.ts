import { useAppStore, type Panel } from "../stores/app";

/** Misma navegación que ya usa el sidebar (Sidebar.tsx::navegarPanel) — reutilizable
 * desde otros puntos de entrada (ej. la franja "Ir a…" de Inicio) sin duplicar la
 * regla de "entrar a hugo siempre resetea a la agenda". */
export function useNavegarPanel() {
  const setPanel = useAppStore((s) => s.setPanel);
  const setAccionesBootTab = useAppStore((s) => s.setAccionesBootTab);
  const setTicketsBootView = useAppStore((s) => s.setTicketsBootView);
  const setCentroMandoView = useAppStore((s) => s.setCentroMandoView);

  return function navegarPanel(id: Panel) {
    setAccionesBootTab(null);
    if (id === "hugo") {
      setTicketsBootView("agente");
      setCentroMandoView("home");
    }
    setPanel(id);
  };
}
