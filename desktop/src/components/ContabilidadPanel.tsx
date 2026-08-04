import { lazy, Suspense, useEffect, useMemo } from "react";
import { useAppStore } from "../stores/app";
import { useTicketsAuth } from "../stores/ticketsAuth";
import { useUiMode } from "../stores/uiMode";
import {
  CONTABILIDAD_PANELS,
  CONTABILIDAD_TAB_OCULTAS,
  esPanelContabilidad,
  guardarUltimoPanelContabilidad,
  primerPanelContabilidad,
  puedeVerModuloContabilidad,
  type ContabilidadPanelId,
} from "../lib/contabilidadAccess";
const SyncPanel = lazy(() => import("./SyncPanel"));
const FacturasCompraPanel = lazy(() => import("./FacturasCompraPanel"));
const CostosProductosPanel = lazy(() => import("./CostosProductosPanel"));
const RentabilidadPanel = lazy(() => import("./RentabilidadPanel"));
const ComprasExteriorPanel = lazy(() => import("./ComprasExteriorPanel"));
const RRHHPanel = lazy(() => import("./RRHHPanel"));

function TabCargando() {
  return (
    <div className="flex min-h-[30vh] items-center justify-center text-sm text-muted">
      Cargando…
    </div>
  );
}

function renderSubpanel(id: ContabilidadPanelId) {
  switch (id) {
    case "facturas":
      return <FacturasCompraPanel />;
    case "sync":
      return <SyncPanel />;
    case "rentabilidad":
      return <RentabilidadPanel />;
    case "compras-exterior":
      return <ComprasExteriorPanel />;
    case "productos-siigo":
      return <FacturasCompraPanel />;
    case "costos-productos":
      return <CostosProductosPanel />;
    case "rrhh":
      return <RRHHPanel />;
    default:
      return null;
  }
}

export default function ContabilidadPanel() {
  const panel = useAppStore((s) => s.panel);
  const setPanel = useAppStore((s) => s.setPanel);
  const { user } = useTicketsAuth();
  const advanced = useUiMode((s) => s.advanced);

  const tabs = useMemo(() => {
    return CONTABILIDAD_PANELS.filter((id) => {
      if (CONTABILIDAD_TAB_OCULTAS.has(id)) return false;
      if (!puedeVerModuloContabilidad(user, id)) return false;
      if (id === "costos-productos" || id === "rrhh") return advanced;
      return true;
    });
  }, [user, advanced]);

  const activo: ContabilidadPanelId = esPanelContabilidad(panel)
    ? panel
    : (tabs[0] ?? "facturas");

  const puedeCrearSiigo = Boolean(puedeVerModuloContabilidad(user, "productos-siigo"));

  useEffect(() => {
    if (!tabs.length) return;
    if (
      !esPanelContabilidad(panel)
      || !tabs.includes(panel)
      || CONTABILIDAD_TAB_OCULTAS.has(panel as ContabilidadPanelId)
    ) {
      const next = primerPanelContabilidad(user, advanced, panel);
      if (next !== panel) setPanel(next);
      return;
    }
    guardarUltimoPanelContabilidad(panel);
  }, [panel, tabs, user, advanced, setPanel]);

  if (!tabs.length) {
    if (puedeCrearSiigo) {
      return (
        <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 p-4">
          <p className="mx-auto max-w-md text-center text-sm text-muted">
            Usa los iconos del encabezado para crear productos en Siigo, consultar facturas o abrir la
            calculadora.
          </p>
        </div>
      );
    }
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-border bg-surface-panel p-6 text-sm text-muted">
        No tienes permisos de Contabilidad. Pide acceso al administrador.
      </div>
    );
  }

  const subpanelId = CONTABILIDAD_TAB_OCULTAS.has(activo)
    ? (tabs[0] ?? "facturas")
    : activo;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-6">
        <Suspense fallback={<TabCargando />}>{renderSubpanel(subpanelId)}</Suspense>
      </div>
    </div>
  );
}
