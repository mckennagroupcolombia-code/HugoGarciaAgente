import { useEffect } from "react";
import { useTicketsAuth } from "../../stores/ticketsAuth";
import { useAppStore } from "../../stores/app";
import { PanelIcon } from "../../icons/PanelIcon";
import { Icon } from "../../icons";
import { guardarUltimoPanelHub } from "../../lib/hubNav";
import { HUB_TAB_LABEL, hubTabClass } from "../../lib/hubTabClass";
import ScrollableTabList from "./ScrollableTabList";

function puedeVerTabInicio(
  permisos: Record<string, boolean> | null | undefined,
  nivel: number,
  tab: string,
): boolean {
  if (nivel >= 3) return true;
  if (!permisos) return tab === "acciones" || tab === "solicitudes";
  return Boolean(permisos[`tickets_${tab}`]);
}

/**
 * Navegación de Inicio en el cabezote, a la izquierda de Temas.
 * Une Agenda / Acciones / Solicitudes (Centro de Mando) + Métricas.
 */
export default function InicioNavTabs() {
  const panel = useAppStore((s) => s.panel);
  const centroMandoView = useAppStore((s) => s.centroMandoView);
  const setPanel = useAppStore((s) => s.setPanel);
  const setCentroMandoView = useAppStore((s) => s.setCentroMandoView);
  const setTicketsBootView = useAppStore((s) => s.setTicketsBootView);
  const setAccionesBootTab = useAppStore((s) => s.setAccionesBootTab);
  const { user } = useTicketsAuth();
  const nivel = user?.rol?.nivel ?? 1;
  const permisos = user?.permisos_secciones;
  const enAgenda = panel === "hugo" || panel === "tickets";

  const showAcciones = puedeVerTabInicio(permisos, nivel, "acciones");
  const showSolicitudes = puedeVerTabInicio(permisos, nivel, "solicitudes");

  useEffect(() => {
    if (panel === "dashboard") guardarUltimoPanelHub("inicio", "dashboard");
    else if (enAgenda) guardarUltimoPanelHub("inicio", "hugo");
  }, [panel, enAgenda]);

  function irAgenda() {
    setAccionesBootTab(null);
    setTicketsBootView("home");
    setCentroMandoView("home");
    setPanel("hugo");
  }

  function irAcciones() {
    setAccionesBootTab("activas");
    setTicketsBootView("acciones");
    setCentroMandoView("acciones");
    setPanel("hugo");
  }

  function irSolicitudes() {
    setAccionesBootTab(null);
    setTicketsBootView("solicitudes");
    setCentroMandoView("solicitudes");
    setPanel("hugo");
  }

  function irMetricas() {
    setAccionesBootTab(null);
    setTicketsBootView(null);
    setPanel("dashboard");
  }

  const agendaActiva = enAgenda && (centroMandoView === "home" || centroMandoView === "agente");
  const accionesActiva = enAgenda && centroMandoView === "acciones";
  const solicitudesActiva = enAgenda && centroMandoView === "solicitudes";
  const metricasActiva = panel === "dashboard";

  return (
    <ScrollableTabList aria-label="Secciones de Inicio" justify="start">
      <button
        type="button"
        role="tab"
        aria-selected={agendaActiva}
        aria-label="Agenda"
        title="Agenda"
        onClick={irAgenda}
        className={hubTabClass(agendaActiva)}
      >
        <Icon name="target" size={22} weight="bold" />
        <span className={HUB_TAB_LABEL}>Agenda</span>
      </button>
      {showAcciones && (
        <button
          type="button"
          role="tab"
          aria-selected={accionesActiva}
          aria-label="Acciones"
          title="Acciones"
          onClick={irAcciones}
          className={hubTabClass(accionesActiva)}
        >
          <Icon name="lightning" size={22} weight="bold" />
          <span className={HUB_TAB_LABEL}>Acciones</span>
        </button>
      )}
      {showSolicitudes && (
        <button
          type="button"
          role="tab"
          aria-selected={solicitudesActiva}
          aria-label="Solicitudes"
          title="Solicitudes"
          onClick={irSolicitudes}
          className={hubTabClass(solicitudesActiva)}
        >
          <Icon name="listChecks" size={22} weight="bold" />
          <span className={HUB_TAB_LABEL}>Solicitudes</span>
        </button>
      )}
      <button
        type="button"
        role="tab"
        aria-selected={metricasActiva}
        aria-label="Métricas"
        title="Métricas"
        onClick={irMetricas}
        className={hubTabClass(metricasActiva)}
      >
        <PanelIcon panel="dashboard" size={22} active={metricasActiva} bubble={false} />
        <span className={HUB_TAB_LABEL}>Métricas</span>
      </button>
    </ScrollableTabList>
  );
}
