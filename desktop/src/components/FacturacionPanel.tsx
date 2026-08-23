import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useTicketsAuth } from "../stores/ticketsAuth";
import { useAppStore } from "../stores/app";
import {
  FACTURACION_SUBTABS,
  guardarSubtabFacturacion,
  leerSubtabFacturacion,
  puedeVerModuloContabilidad,
  subtabDesdePanelLegacy,
  type FacturacionSubtabId,
} from "../lib/contabilidadAccess";
import { PanelIcon } from "../icons/PanelIcon";
import { HUB_TAB_LABEL, hubTabClass } from "../lib/hubTabClass";

const SyncPanel = lazy(() => import("./SyncPanel"));
const FacturasCompraPanel = lazy(() => import("./FacturasCompraPanel"));
const VentasFacturacionPanel = lazy(() => import("./VentasFacturacionPanel"));

function Cargando() {
  return (
    <div className="flex min-h-[30vh] items-center justify-center text-sm text-muted">
      Cargando…
    </div>
  );
}

/**
 * Pestaña plana Facturación (como Rentabilidad): Sync + Facturas de compra.
 * «Consultar factura» queda en el icono del cabezote, no aquí.
 */
export default function FacturacionPanel() {
  const { user } = useTicketsAuth();
  const panel = useAppStore((s) => s.panel);
  const setFacturasBootVista = useAppStore((s) => s.setFacturasBootVista);

  const puedeSync = Boolean(puedeVerModuloContabilidad(user, "sync"));
  const puedeFacturas = Boolean(puedeVerModuloContabilidad(user, "facturas"));

  const subtabs = useMemo(
    () =>
      FACTURACION_SUBTABS.filter((t) => {
        if (t.id === "sync") return puedeSync;
        return puedeFacturas;
      }),
    [puedeSync, puedeFacturas],
  );

  const [sub, setSub] = useState<FacturacionSubtabId>(() => {
    const fromLegacy = subtabDesdePanelLegacy(panel);
    if (fromLegacy === "sync" || fromLegacy === "compra") return fromLegacy;
    return leerSubtabFacturacion();
  });

  useEffect(() => {
    const fromLegacy = subtabDesdePanelLegacy(panel);
    if (fromLegacy === "sync" || fromLegacy === "compra") setSub(fromLegacy);
  }, [panel]);

  useEffect(() => {
    if (!subtabs.length) return;
    if (!subtabs.some((t) => t.id === sub)) {
      setSub(subtabs[0].id);
    }
  }, [subtabs, sub]);

  useEffect(() => {
    if (!subtabs.some((t) => t.id === sub)) return;
    guardarSubtabFacturacion(sub);
    if (sub === "compra") setFacturasBootVista("pendientes");
    else setFacturasBootVista(null);
  }, [sub, subtabs, setFacturasBootVista]);

  if (!subtabs.length) {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-border bg-surface-panel p-6 text-sm text-muted">
        No tienes permisos de facturación. Pide acceso al administrador.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div
        className="flex flex-wrap gap-1 rounded-xl border border-border bg-surface-panel p-1"
        role="tablist"
        aria-label="Facturación"
      >
        {subtabs.map((t) => {
          const selected = sub === t.id;
          const iconPanel = t.id === "sync" ? "sync" : "facturas";
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-label={t.label}
              title={t.label}
              onClick={() => setSub(t.id)}
              className={hubTabClass(selected)}
            >
              <PanelIcon panel={iconPanel} size={22} active={selected} bubble={false} />
              <span className={HUB_TAB_LABEL}>{t.label}</span>
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1">
        <Suspense fallback={<Cargando />}>
          {sub === "sync" ? (
            <SyncPanel />
          ) : sub === "ventas" ? (
            <VentasFacturacionPanel key="ventas" />
          ) : (
            <FacturasCompraPanel key="compra" />
          )}
        </Suspense>
      </div>
    </div>
  );
}
