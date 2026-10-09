/**
 * El enrutador de paneles de la app: dado un panel, monta su módulo (perezoso, cada uno en su
 * chunk). Lo usan la app (App.tsx, con el panel del store), la ventana auxiliar (panel propio) y
 * Empresa viva, que abre los módulos DENTRO del juego (con lib/panelLocal.tsx para que los módulos
 * con secciones vean su panel y no el de la app). Sacado de App.tsx el 8-oct-2026 para eso.
 */
import { lazy, Suspense } from "react";
import { esPanelContabilidad } from "../lib/contabilidadAccess";
import { useAppStore, type Panel } from "../stores/app";
import Dashboard from "./Dashboard";
import TicketsPanel from "./TicketsPanel";

// Paneles bajo demanda: cada uno baja en su propio chunk al abrirlo, en vez de
// inflar el bundle inicial. Dashboard y TicketsPanel quedan estáticos por ser
// los paneles de aterrizaje.
const Chat = lazy(() => import("./Chat"));
const VozIA = lazy(() => import("./VozIA"));
const PreventaPanel = lazy(() => import("./PreventaPanel"));
const PostventaPanel = lazy(() => import("./PostventaPanel"));
const VentasEmailPanel = lazy(() => import("./VentasEmailPanel"));
const FichasTecnicasPanel = lazy(() => import("./FichasTecnicasPanel"));
const FormulasPanel = lazy(() => import("./formulas/FormulasPanel"));
const IdeasPanel = lazy(() => import("./ideas/IdeasPanel"));
const PedidosWebPanel = lazy(() => import("./PedidosWebPanel"));
const EmpaquePanel = lazy(() => import("./EmpaquePanel"));
const GuiasEnvioPanel = lazy(() => import("./GuiasEnvioPanel"));
const EntregasFlexPanel = lazy(() => import("./EntregasFlexPanel"));
const MapaSistemaPanel = lazy(() => import("./MapaSistemaPanel"));
const ColaboradoresPanel = lazy(() => import("./ColaboradoresPanel"));
const MapaVivo = lazy(() => import("./MapaVivo"));
const JuegosPanel = lazy(() => import("./JuegosPanel"));
const EmpresaViva = lazy(() => import("./empresa/EmpresaViva"));
const ArquitecturaPanel = lazy(() => import("./ArquitecturaPanel"));
const ContabilidadPanel = lazy(() => import("./ContabilidadPanel"));
const NegocioPanel = lazy(() => import("./NegocioPanel"));
const FacturacionPanel = lazy(() => import("./FacturacionPanel"));
const WebChatPanel = lazy(() => import("./WebChatPanel"));
const WhatsAppPanel = lazy(() => import("./WhatsAppPanel"));
const SupervisorPanel = lazy(() => import("./SupervisorPanel"));
const ControlVersionesPanel = lazy(() => import("./ControlVersionesPanel"));
const TelemetriaPanel = lazy(() => import("./TelemetriaPanel"));
const MeliOAuthPanel = lazy(() => import("./MeliOAuthPanel"));
const GmailOAuthPanel = lazy(() => import("./GmailOAuthPanel"));
const ConexionesPanel = lazy(() => import("./ConexionesPanel"));
const TareasProgramadasPanel = lazy(() => import("./TareasProgramadasPanel"));
const EtiquetasPanel = lazy(() => import("./EtiquetasPanel"));
const ConfigurarProductosPanel = lazy(() =>
  import("./EtiquetasPanel").then((m) => ({
    default: m.ConfigurarProductosPanel,
  })),
);
const PlacasConcretoPanel = lazy(() => import("./PlacasConcretoPanel"));
const ContenidoPanel = lazy(() => import("./ContenidoPanel"));
const InventarioPanel = lazy(() => import("./InventarioPanel"));
const PublicacionesPanel = lazy(() => import("./PublicacionesPanel"));
const CanalesProductoPanel = lazy(() => import("./canales_producto/CanalesProductoPanel"));
const ChatEquipoPanel = lazy(() => import("./chat_equipo/ChatEquipoPanel"));
const RecepcionMercanciaPanel = lazy(() => import("./recepcion/RecepcionMercanciaPanel"));
const VitrinaWebPanel = lazy(() => import("./VitrinaWebPanel"));
const LogisticaInternacionalPanel = lazy(
  () => import("./LogisticaInternacionalPanel"),
);
const Settings = lazy(() => import("./Settings"));
const PerfilPanel = lazy(() => import("./PerfilPanel"));

function PanelCargando() {
  return (
    <div className="flex h-full min-h-[40vh] items-center justify-center text-sm text-muted">
      Cargando panel…
    </div>
  );
}

export function PanelRouter({ panel }: { panel?: Panel } = {}) {
  return (
    <Suspense fallback={<PanelCargando />}>
      <PanelRouterInner impuesto={panel} />
    </Suspense>
  );
}

/** `impuesto` gana sobre el store: ver VentanaAuxiliarShell. */
function PanelRouterInner({ impuesto }: { impuesto?: Panel } = {}) {
  const delStore = useAppStore((s) => s.panel);
  const panel = impuesto ?? delStore;
  switch (panel) {
    case "hugo":
    case "tickets":
      return <TicketsPanel />;
    case "dashboard":
      return <Dashboard />;
    case "chat":
      return <Chat />;
    case "voz":
      return <VozIA />;
    case "webchat":
      return <WebChatPanel />;
    case "whatsapp":
      return <WhatsAppPanel />;
    case "supervisor":
      return <SupervisorPanel />;
    case "control-versiones":
      return <ControlVersionesPanel />;
    case "telemetria":
      return <TelemetriaPanel />;
    case "meli-oauth":
      return <MeliOAuthPanel />;
    case "gmail-oauth":
      return <GmailOAuthPanel />;
    case "conexiones":
      return <ConexionesPanel />;
    case "tareas-programadas":
      return <TareasProgramadasPanel />;
    case "preventa":
      return <PreventaPanel />;
    case "postventa":
      return <PostventaPanel />;
    case "ventas-email":
      return <VentasEmailPanel />;
    case "costos-productos":
    case "catalogo-alegra":
    case "compras-exterior":
    case "productos-siigo":
    case "rrhh":
    case "operativos":
    case "ingresos-egresos":
    case "creditos-adquiridos":
    case "prestamos":
    case "pagos":
    case "conciliacion-contador":
    case "libro-mayor":
    case "socios":
      return <ContabilidadPanel />;
    case "rentabilidad":
    case "publicidad":
    case "salud-negocio":
      return <NegocioPanel />;
    case "facturacion":
    case "sync":
    case "facturas":
    case "astro-killer":
      return <FacturacionPanel />;
    case "fichas":
      return <FichasTecnicasPanel />;
    case "formulas":
      return <FormulasPanel />;
    case "ideas":
      return <IdeasPanel />;
    case "pedidos":
      return <PedidosWebPanel />;
    case "empaque":
      return <EmpaquePanel />;
    case "guias-envio":
      return <GuiasEnvioPanel />;
    case "entregas-flex":
      return <EntregasFlexPanel />;
    case "mapa-sistema":
      return <MapaSistemaPanel />;
    case "mapa-vivo":
      return <MapaVivo />;
    case "colaboradores":
      return <ColaboradoresPanel />;
    case "juegos":
      return <JuegosPanel />;
    case "empresa-viva":
      return <EmpresaViva />;
    case "arquitectura":
      return <ArquitecturaPanel />;
    case "etiquetas":
      return <EtiquetasPanel />;
    case "etiquetas-config":
      return <ConfigurarProductosPanel />;
    case "placas-concreto":
      return <PlacasConcretoPanel />;
    case "contenido":
      return <ContenidoPanel />;
    case "control-inventario":
    case "stock":
      return <InventarioPanel />;
    case "publicaciones":
      return <PublicacionesPanel />;
    case "canales-producto":
      return <CanalesProductoPanel />;
    case "chat-equipo":
      return <ChatEquipoPanel />;
    case "recepcion-mercancia":
      return <RecepcionMercanciaPanel />;
    case "vitrina-web":
      return <VitrinaWebPanel />;
    case "logistica-importaciones":
    case "logistica-embarques":
    case "logistica-aduanas":
    case "logistica-proveedores":
    case "logistica-seguimiento":
      return <LogisticaInternacionalPanel />;
    case "settings":
      return <Settings />;
    case "perfil":
      return <PerfilPanel />;
    default:
      return esPanelContabilidad(panel) ? <ContabilidadPanel /> : <Dashboard />;
  }
}
