import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useTicketsAuth } from "../stores/ticketsAuth";
import { useAppStore } from "../stores/app";
import {
  OPERATIVOS_SUBTABS,
  guardarSubtabOperativos,
  leerSubtabOperativos,
  puedeVerModuloContabilidad,
  subtabOperativosDesdeLegacy,
  type OperativosSubtabId,
} from "../lib/contabilidadAccess";
import { PanelIcon } from "../icons/PanelIcon";
import { HUB_TAB_LABEL, hubTabClass } from "../lib/hubTabClass";

const RRHHPanel = lazy(() => import("./RRHHPanel"));
const ImpuestosPanel = lazy(() => import("./ImpuestosPanel"));
const TabServicios = lazy(() =>
  import("./RentabilidadPanel").then((m) => ({ default: m.TabServicios })),
);

function Cargando() {
  return (
    <div className="flex min-h-[30vh] items-center justify-center text-sm text-muted">
      Cargando…
    </div>
  );
}

/**
 * Pestaña Operativos: RR.HH., pagos de impuestos y servicios públicos.
 */
export default function OperativosPanel() {
  const { user } = useTicketsAuth();
  const panel = useAppStore((s) => s.panel);

  const puedeRrhh = Boolean(puedeVerModuloContabilidad(user, "rrhh"));
  const puedeImpuestos = Boolean(puedeVerModuloContabilidad(user, "impuestos"));
  const puedeServicios = Boolean(puedeVerModuloContabilidad(user, "servicios"));

  const subtabs = useMemo(
    () =>
      OPERATIVOS_SUBTABS.filter((t) => {
        if (t.id === "rrhh") return puedeRrhh;
        if (t.id === "impuestos") return puedeImpuestos;
        return puedeServicios;
      }),
    [puedeRrhh, puedeImpuestos, puedeServicios],
  );

  const [sub, setSub] = useState<OperativosSubtabId>(() => {
    const fromLegacy = subtabOperativosDesdeLegacy(panel);
    if (fromLegacy) return fromLegacy;
    return leerSubtabOperativos();
  });

  useEffect(() => {
    const fromLegacy = subtabOperativosDesdeLegacy(panel);
    if (fromLegacy) setSub(fromLegacy);
  }, [panel]);

  useEffect(() => {
    if (!subtabs.length) return;
    if (!subtabs.some((t) => t.id === sub)) {
      setSub(subtabs[0].id);
    }
  }, [subtabs, sub]);

  useEffect(() => {
    if (!subtabs.some((t) => t.id === sub)) return;
    guardarSubtabOperativos(sub);
  }, [sub, subtabs]);

  if (!subtabs.length) {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-border bg-surface-panel p-6 text-sm text-muted">
        No tienes permisos de operativos. Pide acceso al administrador (RRHH, impuestos o
        servicios).
      </div>
    );
  }

  const iconFor = (id: OperativosSubtabId) => {
    if (id === "rrhh") return "rrhh";
    if (id === "impuestos") return "impuestos";
    return "servicios";
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div
        className="flex flex-wrap gap-1 rounded-xl border border-border bg-surface-panel p-1"
        role="tablist"
        aria-label="Operativos"
      >
        {subtabs.map((t) => {
          const selected = sub === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setSub(t.id)}
              className={hubTabClass(selected)}
            >
              <PanelIcon panel={iconFor(t.id)} size={16} active={selected} bubble={false} />
              <span className={HUB_TAB_LABEL}>{t.label}</span>
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-4">
        <Suspense fallback={<Cargando />}>
          {sub === "rrhh" && <RRHHPanel />}
          {sub === "impuestos" && <ImpuestosPanel />}
          {sub === "servicios" && <TabServicios />}
        </Suspense>
      </div>
    </div>
  );
}
