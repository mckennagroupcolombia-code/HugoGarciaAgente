import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";

function TabCargando() {
  return (
    <div className="flex min-h-[30vh] items-center justify-center text-sm text-muted">
      Cargando…
    </div>
  );
}

/**
 * Shell genérico para un hub con pestañas donde una o más deben quedar
 * montadas al cambiar de pestaña (edición en paralelo — no perder scroll,
 * filtros o estado a medio llenar). Extraído de ContabilidadPanel.tsx, que lo
 * usaba solo para Stock/Rentabilidad; ahora lo reusan también los hubs a los
 * que esos paneles se mudaron (Inventario, Negocio).
 */
export default function KeepAliveHubShell<Id extends string>({
  activeId,
  keepAliveIds,
  fullBleedIds = [],
  renderPanel,
}: {
  activeId: Id;
  keepAliveIds: readonly Id[];
  /** ids cuyo scroll vive dentro del propio panel (contenedor en overflow-hidden). */
  fullBleedIds?: readonly Id[];
  renderPanel: (id: Id) => ReactNode;
}) {
  const keepAliveSet = useMemo(() => new Set<Id>(keepAliveIds), [keepAliveIds]);
  const fullBleedSet = useMemo(() => new Set<Id>(fullBleedIds), [fullBleedIds]);

  const [vivos, setVivos] = useState<Set<Id>>(() =>
    keepAliveSet.has(activeId) ? new Set<Id>([activeId]) : new Set<Id>(),
  );

  useEffect(() => {
    if (!keepAliveSet.has(activeId)) return;
    setVivos((prev) => (prev.has(activeId) ? prev : new Set(prev).add(activeId)));
  }, [activeId, keepAliveSet]);

  // Incluye el keep-alive activo aunque el efecto anterior aún no haya corrido
  // (evita un primer frame en blanco).
  const vivosEfectivos = useMemo(() => {
    const s = new Set(vivos);
    if (keepAliveSet.has(activeId)) s.add(activeId);
    return s;
  }, [vivos, activeId, keepAliveSet]);

  const activoEsKeepAlive = keepAliveSet.has(activeId);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {[...vivosEfectivos].map((id) => {
        const active = activeId === id;
        const scroll = fullBleedSet.has(id) ? "overflow-hidden" : "overflow-x-hidden overflow-y-auto pb-6";
        return (
          <div
            key={id}
            className={`min-h-0 flex-1 flex-col ${scroll} ${active ? "flex" : "hidden"}`}
            aria-hidden={!active}
            // Evitar `inert={false}` (algunos navegadores lo tratan como activo).
            {...(!active ? { inert: true as const } : {})}
          >
            <Suspense fallback={<TabCargando />}>{renderPanel(id)}</Suspense>
          </div>
        );
      })}

      {!activoEsKeepAlive && (
        <div
          className={
            fullBleedSet.has(activeId)
              ? "flex min-h-0 flex-1 flex-col overflow-hidden"
              : "min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-6"
          }
        >
          <Suspense fallback={<TabCargando />}>{renderPanel(activeId)}</Suspense>
        </div>
      )}
    </div>
  );
}
