import { lazy } from "react";
import { useAppStore } from "../stores/app";
import KeepAliveHubShell from "./nav/KeepAliveHubShell";

const InventarioControlPanel = lazy(() => import("./InventarioControlPanel"));
const StockPanel = lazy(() => import("./StockPanel"));

type InventarioPanelId = "control-inventario" | "stock";

function renderSubpanel(id: InventarioPanelId) {
  switch (id) {
    case "stock":
      return <StockPanel />;
    case "control-inventario":
    default:
      return <InventarioControlPanel />;
  }
}

/** Hub Inventario: checklist de atención (control-inventario) + registro de
 * entradas/salidas (stock, mudado aquí desde Contabilidad — no tiene relación
 * con la partida doble, solo convivía ahí por historia). Stock se mantiene
 * montado al cambiar de pestaña (edición en paralelo), igual que antes. */
export default function InventarioPanel() {
  const panel = useAppStore((s) => s.panel);
  const activeId: InventarioPanelId = panel === "stock" ? "stock" : "control-inventario";

  return (
    <KeepAliveHubShell<InventarioPanelId>
      activeId={activeId}
      keepAliveIds={["stock"]}
      fullBleedIds={["stock"]}
      renderPanel={renderSubpanel}
    />
  );
}
