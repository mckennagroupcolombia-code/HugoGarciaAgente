import { useEffect } from "react";
import { useTicketsAuth } from "../../stores/ticketsAuth";
import { useAppStore } from "../../stores/app";
import { PanelIcon } from "../../icons/PanelIcon";
import { Icon } from "../../icons";
import { guardarUltimoPanelHub } from "../../lib/hubNav";
import { HUB_TAB_LABEL, hubTabClass } from "../../lib/hubTabClass";
import { puedeVerSeccionPanel } from "../../lib/panelAccess";
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
 * Navegación de Agenda en el cabezote (izquierda): Agenda / Mensajes / Colaboradores / Juegos / Métricas / Mapa.
 * Sustituye el título "Agenda" para no repetir el texto.
 * `soloVistas`: con la navegación por flujo, Métricas y Mapa ya están en la secuencia del
 * cabezote; aquí quedan solo las vistas DENTRO de la Agenda (Agenda / Mensajes).
 */
export default function InicioNavTabs({ soloVistas = false }: { soloVistas?: boolean }) {
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
  const showMensajes = showAcciones || showSolicitudes;

  // El mapa de la aplicación es la otra forma de llegar a todo: por secuencia, no por menú.
  const showMapa = !soloVistas && Boolean(user && puedeVerSeccionPanel(user, "mapa-sistema"));
  const mapaActivo = panel === "mapa-sistema";

  // Colaboradores vive DENTRO de la Agenda (no es una etapa del negocio), así que
  // en el flujo no aparecía por ningún lado: solo por Ctrl+K. Va aquí, con las demás
  // vistas de la Agenda, también en `soloVistas`.
  const showColaboradores = Boolean(user && puedeVerSeccionPanel(user, "colaboradores"));
  const colaboradoresActivo = panel === "colaboradores";
  const showJuegos = Boolean(user && puedeVerSeccionPanel(user, "juegos"));
  const juegosActivo = panel === "juegos";

  useEffect(() => {
    if (panel === "dashboard") guardarUltimoPanelHub("inicio", "dashboard");
    else if (panel === "mapa-sistema") guardarUltimoPanelHub("inicio", "mapa-sistema");
    else if (panel === "colaboradores") guardarUltimoPanelHub("inicio", "colaboradores");
    else if (panel === "juegos") guardarUltimoPanelHub("inicio", "juegos");
    else if (enAgenda) guardarUltimoPanelHub("inicio", "hugo");
  }, [panel, enAgenda]);

  function irAgenda() {
    setAccionesBootTab(null);
    setTicketsBootView("home");
    setCentroMandoView("home");
    setPanel("hugo");
  }

  /** Inbox unificado de Solicitudes + Acciones (chat estilo WhatsApp Web). */
  function irMensajes() {
    setAccionesBootTab(null);
    setTicketsBootView("mensajes");
    setCentroMandoView("mensajes");
    setPanel("hugo");
  }

  function irMetricas() {
    setAccionesBootTab(null);
    setTicketsBootView(null);
    setPanel("dashboard");
  }

  const agendaActiva = enAgenda && (centroMandoView === "home" || centroMandoView === "agente");
  const mensajesActiva = enAgenda && (
    centroMandoView === "mensajes" || centroMandoView === "acciones" || centroMandoView === "solicitudes"
  );
  const metricasActiva = panel === "dashboard";
  // Métricas del equipo: solo tiene sentido para quien administra la operación.
  const showMetricas = !soloVistas && nivel >= 3;
  const tabClass = (selected: boolean) => hubTabClass(selected, "mck-hub-tab-etiquetado flex-col");

  return (
    <ScrollableTabList aria-label="Secciones de Agenda" justify="start">
      <button
        type="button"
        role="tab"
        aria-selected={agendaActiva}
        aria-label="Agenda"
        title="Agenda"
        onClick={irAgenda}
        className={tabClass(agendaActiva)}
      >
        <Icon name="target" size={22} weight="bold" />
        <span className={HUB_TAB_LABEL}>{soloVistas ? "Mi día" : "Agenda"}</span>
      </button>
      {showMensajes && (
        <button
          type="button"
          role="tab"
          aria-selected={mensajesActiva}
          aria-label="Mensajes"
          title="Mensajes (Solicitudes y Acciones)"
          onClick={irMensajes}
          className={tabClass(mensajesActiva)}
        >
          <Icon name="chat" size={22} weight="bold" />
          <span className={HUB_TAB_LABEL}>Mensajes</span>
        </button>
      )}
      {showColaboradores && (
        <button
          type="button"
          role="tab"
          aria-selected={colaboradoresActivo}
          aria-label="Colaboradores"
          title="Colaboradores — diagramas compartidos"
          onClick={() => setPanel("colaboradores")}
          className={tabClass(colaboradoresActivo)}
        >
          <PanelIcon panel="colaboradores" size={22} active={colaboradoresActivo} bubble={false} />
          <span className={HUB_TAB_LABEL}>Colaboradores</span>
        </button>
      )}
      {showJuegos && (
        <button
          type="button"
          role="tab"
          aria-selected={juegosActivo}
          aria-label="Juegos"
          title="Juegos — un rato de descanso"
          onClick={() => setPanel("juegos")}
          className={tabClass(juegosActivo)}
        >
          <PanelIcon panel="juegos" size={22} active={juegosActivo} bubble={false} />
          <span className={HUB_TAB_LABEL}>Juegos</span>
        </button>
      )}
      {showMetricas && (
        <button
          type="button"
          role="tab"
          aria-selected={metricasActiva}
          aria-label="Métricas"
          title="Métricas"
          onClick={irMetricas}
          className={tabClass(metricasActiva)}
        >
          <PanelIcon panel="dashboard" size={22} active={metricasActiva} bubble={false} />
          <span className={HUB_TAB_LABEL}>Métricas</span>
        </button>
      )}
      {showMapa && (
        <button
          type="button"
          role="tab"
          aria-selected={mapaActivo}
          aria-label="Mapa de la aplicación"
          title="Mapa de la aplicación"
          onClick={() => setPanel("mapa-sistema")}
          className={tabClass(mapaActivo)}
        >
          <PanelIcon panel="mapa-sistema" size={22} active={mapaActivo} bubble={false} />
          <span className={HUB_TAB_LABEL}>Mapa</span>
        </button>
      )}
    </ScrollableTabList>
  );
}
