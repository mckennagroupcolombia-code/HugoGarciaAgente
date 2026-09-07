import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useAppStore } from "../stores/app";
import { useTicketsAuth } from "../stores/ticketsAuth";
import { useUiMode } from "../stores/uiMode";
import { modoAvanzadoEfectivo } from "../lib/adminAccess";
import {
  CONTABILIDAD_PANELS,
  CONTABILIDAD_TAB_OCULTAS,
  guardarUltimoPanelContabilidad,
  normalizarPanelContabilidad,
  primerPanelContabilidad,
  puedeVerModuloContabilidad,
  type ContabilidadPanelId,
} from "../lib/contabilidadAccess";

const FacturacionPanel = lazy(() => import("./FacturacionPanel"));
const OperativosPanel = lazy(() => import("./OperativosPanel"));
const IngresosEgresosPanel = lazy(() => import("./IngresosEgresosPanel"));
const LibroMayorPanel = lazy(() => import("./LibroMayorPanel"));
const CreditosAdquiridosPanel = lazy(() => import("./CreditosAdquiridosPanel"));
const CostosProductosPanel = lazy(() => import("./CostosProductosPanel"));
const CatalogoAlegraPanel = lazy(() => import("./CatalogoAlegraPanel"));
const RentabilidadPanel = lazy(() => import("./RentabilidadPanel"));
const PublicidadPanel = lazy(() => import("./PublicidadPanel"));
const SaludNegocioPanel = lazy(() => import("./SaludNegocioPanel"));
const ComprasExteriorPanel = lazy(() => import("./ComprasExteriorPanel"));
const StockPanel = lazy(() => import("./StockPanel"));

/** Subpaneles que se mantienen montados al cambiar de pestaña (edición paralela). */
const KEEP_ALIVE: ReadonlySet<ContabilidadPanelId> = new Set(["stock", "rentabilidad"]);

function TabCargando() {
  return (
    <div className="flex min-h-[30vh] items-center justify-center text-sm text-muted">
      Cargando…
    </div>
  );
}

function renderSubpanel(id: ContabilidadPanelId) {
  switch (id) {
    // Ya no navegable directo (tab oculta, se accede vía el icono del
    // encabezado) — Facturación/Sync/Facturas/Astro Killer viven ahora en su
    // propia sección de nivel superior (ver FacturacionPanel.tsx).
    case "productos-siigo":
      return <FacturacionPanel />;
    case "stock":
      return <StockPanel />;
    case "rentabilidad":
      return <RentabilidadPanel />;
    case "publicidad":
      return <PublicidadPanel />;
    case "salud-negocio":
      return <SaludNegocioPanel />;
    case "compras-exterior":
      return <ComprasExteriorPanel />;
    case "costos-productos":
      return <CostosProductosPanel />;
    case "catalogo-alegra":
      return <CatalogoAlegraPanel />;
    case "ingresos-egresos":
      return <IngresosEgresosPanel />;
    case "creditos-adquiridos":
      return <CreditosAdquiridosPanel />;
    case "libro-mayor":
      return <LibroMayorPanel />;
    case "operativos":
    case "rrhh":
      return <OperativosPanel />;
    default:
      return null;
  }
}

function KeepAlivePane({
  id,
  active,
  mounted,
}: {
  id: ContabilidadPanelId;
  active: boolean;
  mounted: boolean;
}) {
  if (!mounted) return null;
  // Stock y Rentabilidad: el scroll vive dentro del panel (tabla/listas), no en el wrapper.
  const scroll =
    id === "rentabilidad" || id === "stock"
      ? "overflow-hidden"
      : "overflow-x-hidden overflow-y-auto pb-6";
  return (
    <div
      className={`min-h-0 flex-1 flex-col ${scroll} ${active ? "flex" : "hidden"}`}
      aria-hidden={!active}
      // Evitar `inert={false}` (algunos navegadores lo tratan como activo).
      {...(!active ? { inert: true as const } : {})}
    >
      <Suspense fallback={<TabCargando />}>{renderSubpanel(id)}</Suspense>
    </div>
  );
}

export default function ContabilidadPanel() {
  const panel = useAppStore((s) => s.panel);
  const setPanel = useAppStore((s) => s.setPanel);
  const { user } = useTicketsAuth();
  const advancedToggle = useUiMode((s) => s.advanced);
  const advanced = modoAvanzadoEfectivo(user, advancedToggle);
  /** Una vez visitados, Stock y Rentabilidad no se desmontan. */
  const [vivos, setVivos] = useState<Set<ContabilidadPanelId>>(() => {
    const n = normalizarPanelContabilidad(useAppStore.getState().panel);
    return n && KEEP_ALIVE.has(n) ? new Set<ContabilidadPanelId>([n]) : new Set();
  });

  const tabs = useMemo(() => {
    return CONTABILIDAD_PANELS.filter((id) => {
      if (CONTABILIDAD_TAB_OCULTAS.has(id)) return false;
      if (!puedeVerModuloContabilidad(user, id)) return false;
      if (id === "costos-productos") return advanced;
      // Operativos (p. ej. Servicios) activo con permiso, aunque la sesión no esté en modo avanzado.
      if (id === "operativos") {
        return advanced || Boolean(puedeVerModuloContabilidad(user, "servicios"));
      }
      return true;
    });
  }, [user, advanced]);

  const puedeCrearSiigo = Boolean(puedeVerModuloContabilidad(user, "productos-siigo"));

  useEffect(() => {
    if (!tabs.length) return;
    const n = normalizarPanelContabilidad(panel);
    if (n && n !== panel) {
      setPanel(n);
      return;
    }
    if (!n || !tabs.includes(n)) {
      const next = primerPanelContabilidad(user, advanced, panel);
      if (next !== panel) setPanel(next);
      return;
    }
    guardarUltimoPanelContabilidad(n);
  }, [panel, tabs, user, advanced, setPanel]);

  const nActivo = normalizarPanelContabilidad(panel);
  const subpanelId = nActivo && tabs.includes(nActivo) ? nActivo : (tabs[0] ?? CONTABILIDAD_PANELS[0]);

  useEffect(() => {
    if (!KEEP_ALIVE.has(subpanelId)) return;
    setVivos((prev) => {
      if (prev.has(subpanelId)) return prev;
      const next = new Set(prev);
      next.add(subpanelId);
      return next;
    });
  }, [subpanelId]);

  // Incluye el subpanel keep-alive activo aunque el useEffect aún no haya corrido
  // (evita primer frame en blanco donde no hay filtros ni tabla).
  // Debe ir antes del return por !tabs.length — si no, React #310 al ganar permisos.
  const vivosEfectivos = useMemo(() => {
    const s = new Set(vivos);
    if (KEEP_ALIVE.has(subpanelId)) s.add(subpanelId);
    return s;
  }, [vivos, subpanelId]);

  if (!tabs.length) {
    if (puedeCrearSiigo) {
      return (
        <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 p-4">
          <p className="mx-auto max-w-md text-center text-sm text-muted">
            Usa los iconos del encabezado para crear productos en Alegra, consultar facturas o abrir la
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

  const keepAliveIds = (["stock", "rentabilidad"] as const).filter(
    (id) => tabs.includes(id) && vivosEfectivos.has(id),
  );
  const activoEsKeepAlive = KEEP_ALIVE.has(subpanelId);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {keepAliveIds.map((id) => (
        <KeepAlivePane key={id} id={id} active={subpanelId === id} mounted />
      ))}

      {!activoEsKeepAlive && (
        <div
          className={
            subpanelId === "rentabilidad"
              ? "flex min-h-0 flex-1 flex-col overflow-hidden"
              : "min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-6"
          }
        >
          <Suspense fallback={<TabCargando />}>{renderSubpanel(subpanelId)}</Suspense>
        </div>
      )}
    </div>
  );
}
