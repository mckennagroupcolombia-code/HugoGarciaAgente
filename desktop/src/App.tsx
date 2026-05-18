import { useAuthStore } from "./stores/auth";
import { useAppStore } from "./stores/app";
import Layout from "./components/Layout";
import LoginGate from "./components/LoginGate";
import Dashboard from "./components/Dashboard";
import Chat from "./components/Chat";
import PreventaPanel from "./components/PreventaPanel";
import SyncPanel from "./components/SyncPanel";
import StockPanel from "./components/StockPanel";
import PedidosWebPanel from "./components/PedidosWebPanel";
import FacturasCompraPanel from "./components/FacturasCompraPanel";
import DailyQuestPanel from "./components/DailyQuestPanel";
import TicketsPanel from "./components/TicketsPanel";
import Settings from "./components/Settings";

function PanelRouter() {
  const panel = useAppStore((s) => s.panel);
  switch (panel) {
    case "dashboard":
      return <Dashboard />;
    case "chat":
      return <Chat />;
    case "preventa":
      return <PreventaPanel />;
    case "sync":
      return <SyncPanel />;
    case "stock":
      return <StockPanel />;
    case "pedidos":
      return <PedidosWebPanel />;
    case "facturas":
      return <FacturasCompraPanel />;
    case "daily_quest":
      return <DailyQuestPanel />;
    case "tickets":
      return <TicketsPanel />;
    case "settings":
      return <Settings />;
    default:
      return <Dashboard />;
  }
}

export default function App() {
  const token = useAuthStore((s) => s.token);

  if (!token) return <LoginGate />;

  return (
    <Layout>
      <PanelRouter />
    </Layout>
  );
}
