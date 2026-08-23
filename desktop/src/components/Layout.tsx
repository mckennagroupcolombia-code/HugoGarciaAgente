import type { ReactNode } from "react";
import Sidebar from "./Sidebar";
import ActivityLog from "./ActivityLog";
import SystemAlertsBanner from "./SystemAlertsBanner";
import TeamActivityBanner from "./TeamActivityBanner";
import ContabilidadNavTabs from "./ContabilidadNavTabs";
import ContabilidadHerramientas from "./ContabilidadHerramientas";
import HubNavTabs from "./nav/HubNavTabs";
import DisenoNavTabs from "./nav/DisenoNavTabs";
import InicioNavTabs from "./nav/InicioNavTabs";
import ThemeModeToggle from "./ThemeModeToggle";
import { TemasHeaderButton } from "./TemasSidebarButton";
import { useAppStore } from "../stores/app";
import { useTicketsAuth } from "../stores/ticketsAuth";
import { usePanelSession } from "../hooks/usePanelSession";
import { Icon } from "../icons";
import { PANEL_INFO } from "../lib/panelInfo";
import { esAdminPanel, modoAvanzadoEfectivo } from "../lib/adminAccess";
import { puedeVerModuloContabilidad } from "../lib/contabilidadAccess";
import {
  esSeccionHub,
  navSectionForPanel,
  NAV_CATEGORY_LABEL,
} from "../lib/navStructure";
import { HUB_SECTION_ICON } from "../lib/hubNav";
import { useUiMode } from "../stores/uiMode";
import { PanelTransition } from "./ui/PanelTransition";

export default function Layout({
  children,
  onBackToMobileHub,
  onExitForceDesktop,
}: {
  children: ReactNode;
  /** Vuelve al hub móvil simplificado (sin forzar escritorio). */
  onBackToMobileHub?: () => void;
  /** Sale del modo “vista escritorio” forzada en el teléfono. */
  onExitForceDesktop?: () => void;
}) {
  usePanelSession();
  const panel = useAppStore((s) => s.panel);
  const centroMandoView = useAppStore((s) => s.centroMandoView);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const toggle = useAppStore((s) => s.toggleSidebar);
  const etiquetasStudioInmersivo = useAppStore((s) => s.etiquetasStudioInmersivo);
  const user = useTicketsAuth((s) => s.user);
  const isAdmin = esAdminPanel(user);
  const { advanced: advancedToggle } = useUiMode();
  const advanced = modoAvanzadoEfectivo(user, advancedToggle);
  const isCentroMando = panel === "hugo" || panel === "tickets";
  const hubIntegrado = isCentroMando && centroMandoView === "home";

  const sectionId = navSectionForPanel(panel);
  const isHub = esSeccionHub(sectionId);
  const sectionLabel = sectionId ? NAV_CATEGORY_LABEL[sectionId] : null;
  const panelInfo = PANEL_INFO[panel];

  const headerTitle = panel === "perfil"
    ? "Mi perfil"
    : panel === "settings"
    ? "Ajustes"
    : isHub && sectionLabel
    ? sectionLabel
    : panelInfo?.label ?? "Panel de operaciones";

  /** Contenedor de contenido: hubs = flex + scroll interno (como Contabilidad). */
  const studioEtiquetasFill = panel === "etiquetas" && etiquetasStudioInmersivo;
  const contentScrollClass = isCentroMando
    ? hubIntegrado
      ? "flex min-h-0 flex-col overflow-hidden px-2 pt-2 sm:px-3 sm:pt-2.5 lg:px-4 lg:pt-3"
      : "overflow-x-hidden overflow-y-auto px-2 py-2 sm:px-3 sm:py-3 lg:px-4 lg:py-3"
    : isHub
    ? studioEtiquetasFill
      ? "flex min-h-0 flex-col overflow-hidden"
      : "flex min-h-0 flex-col overflow-hidden px-2 pt-1.5 sm:px-3 sm:pt-2 lg:px-4 lg:pt-2"
    : "overflow-x-hidden overflow-y-auto px-2 py-2 sm:px-3 sm:py-3 lg:px-4 lg:py-3";

  const showHubTabs = isHub && sectionId;

  return (
    <div className="mck-app-shell flex h-dvh max-w-[100vw] overflow-hidden bg-surface">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-ink/25 backdrop-blur-sm transition-opacity duration-200 lg:hidden"
          onClick={toggle}
          role="presentation"
        />
      )}

      <Sidebar />

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-transparent">
        <SystemAlertsBanner />
        <TeamActivityBanner />
        <header
          className="mck-header-glass z-30 flex shrink-0 flex-col gap-2 border-b border-border/80 px-3 py-2 shadow-paper-sm sm:gap-2.5 sm:px-4 sm:py-2.5"
          style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top, 0px))" }}
        >
          <div className="flex min-w-0 items-center gap-1.5 sm:gap-3">
            {onBackToMobileHub && (
              <button
                type="button"
                onClick={onBackToMobileHub}
                className="mck-press shrink-0 rounded-full p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-ink lg:hidden"
                aria-label="Volver al inicio móvil"
                title="Inicio móvil"
              >
                <Icon name="caretDown" size={22} weight="bold" className="rotate-90" />
              </button>
            )}
            <button
              type="button"
              onClick={toggle}
              className="mck-press shrink-0 rounded-full p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-ink lg:hidden"
              aria-label="Abrir menú"
            >
              <Icon name="menu" size={22} weight="bold" aria-label="Abrir menú" />
            </button>

            <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-2.5">
              {isHub && sectionId ? (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
                  <Icon name={HUB_SECTION_ICON[sectionId]} size={22} weight="duotone" />
                </span>
              ) : panel === "perfil" || panel === "settings" ? (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
                  <Icon name={panel === "perfil" ? "user" : "wrench"} size={22} weight="duotone" />
                </span>
              ) : null}
              <div className="min-w-0 flex-1">
                <h1 className="mck-title truncate text-[26px] font-bold leading-tight tracking-tight">
                  {headerTitle}
                </h1>
              </div>
            </div>

            {!isHub && advanced && (
              <span className="hidden shrink-0 rounded-full border border-accent/20 bg-accent/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-accent md:inline">
                Avanzado
              </span>
            )}

            {onExitForceDesktop && (
              <button
                type="button"
                onClick={onExitForceDesktop}
                className="mck-press hidden shrink-0 rounded-lg border border-border px-2 py-1 text-[10px] font-bold text-muted hover:bg-surface-hover hover:text-ink sm:inline lg:hidden"
              >
                Vista móvil
              </button>
            )}

            {/* Controles fijos a la derecha: no pelean con pestañas en pantallas angostas */}
            <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
              {sectionId === "contabilidad" && (
                <ContabilidadHerramientas
                  puedeCrearSiigo={Boolean(puedeVerModuloContabilidad(user, "productos-siigo"))}
                />
              )}
              {/* Diseño / Inicio: pestañas inline solo con ancho suficiente (≥ xl) */}
              {sectionId === "diseno" && (
                <div className="mr-0.5 hidden min-w-0 max-w-[min(100%,42rem)] border-r border-border/80 pr-1.5 xl:block">
                  <DisenoNavTabs />
                </div>
              )}
              {sectionId === "inicio" && (
                <div className="mr-0.5 hidden min-w-0 max-w-[min(100%,48rem)] border-r border-border/80 pr-1.5 xl:block">
                  <InicioNavTabs />
                </div>
              )}
              <TemasHeaderButton />
              <ThemeModeToggle />
            </div>
          </div>

          {showHubTabs && (
            <div
              className={`mck-submenu min-w-0 w-full rounded-xl px-1 py-0.5 ${
                sectionId === "diseno" || sectionId === "inicio" ? "xl:hidden" : ""
              }`}
            >
              {sectionId === "contabilidad" ? (
                <ContabilidadNavTabs />
              ) : sectionId === "diseno" ? (
                <DisenoNavTabs />
              ) : sectionId === "inicio" ? (
                <InicioNavTabs />
              ) : (
                <HubNavTabs sectionId={sectionId} />
              )}
            </div>
          )}
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className={`mck-panel-scroll min-h-0 min-w-0 flex-1 ${contentScrollClass}`}>
            {isHub && !isCentroMando ? (
              sectionId === "contabilidad" ||
              sectionId === "publicaciones" ||
              studioEtiquetasFill ? (
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                  <PanelTransition>{children}</PanelTransition>
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-2">
                  <PanelTransition>{children}</PanelTransition>
                </div>
              )
            ) : (
              <PanelTransition>{children}</PanelTransition>
            )}
          </div>
          {isAdmin && !hubIntegrado && panel !== "stock" && !studioEtiquetasFill && (
            <div className="hidden shrink-0 border-t border-border bg-surface-panel/90 px-4 pb-3 pt-2 shadow-paper-sm backdrop-blur-sm md:block lg:px-8">
              <ActivityLog />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
