import { lazy, Suspense, useEffect, useMemo } from "react";
import { useAppStore, type Panel } from "../stores/app";
import { useTicketsAuth } from "../stores/ticketsAuth";
import { useUiMode } from "../stores/uiMode";
import {
  CONTABILIDAD_PANELS,
  esPanelContabilidad,
  guardarUltimoPanelContabilidad,
  primerPanelContabilidad,
  puedeVerModuloContabilidad,
  type ContabilidadPanelId,
} from "../lib/contabilidadAccess";
import { PANEL_INFO } from "../lib/panelInfo";
import { PanelIcon } from "../icons/PanelIcon";
import CalculadoraMagica from "./CalculadoraMagica";

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
      if (!puedeVerModuloContabilidad(user, id)) return false;
      if (id === "costos-productos" || id === "rrhh") return advanced;
      return true;
    });
  }, [user, advanced]);

  const activo: ContabilidadPanelId = esPanelContabilidad(panel)
    ? panel
    : (tabs[0] ?? "facturas");

  useEffect(() => {
    if (!tabs.length) return;
    if (!esPanelContabilidad(panel) || !tabs.includes(panel)) {
      const next = primerPanelContabilidad(user, advanced, panel);
      if (next !== panel) setPanel(next);
      return;
    }
    guardarUltimoPanelContabilidad(panel);
  }, [panel, tabs, user, advanced, setPanel]);

  if (!tabs.length) {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-border bg-surface-panel p-6 text-sm text-muted">
        No tienes permisos de Contabilidad. Pide acceso al administrador.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="shrink-0">
        <div className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1">
          {tabs.map((id) => {
            const info = PANEL_INFO[id];
            const selected = activo === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setPanel(id as Panel)}
                className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition ${
                  selected
                    ? "bg-accent text-white shadow-sm"
                    : "text-muted hover:text-ink"
                }`}
              >
                <PanelIcon panel={id} size={22} active={selected} bubble={false} />
                <span>{info?.label ?? id}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Suspense fallback={<TabCargando />}>{renderSubpanel(activo)}</Suspense>
      </div>

      <CalculadoraMagica />
    </div>
  );
}
