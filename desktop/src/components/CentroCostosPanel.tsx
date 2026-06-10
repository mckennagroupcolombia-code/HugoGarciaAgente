import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

interface CentroCosto {
  id: number;
  code: string;
  name: string;
  active: boolean;
}

export default function CentroCostosPanel() {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["siigo-centros-costo"],
    queryFn: () => api.get<{ centros: CentroCosto[]; total: number }>("/api/siigo/centros-costo"),
    staleTime: 60_000,
  });

  const centros = data?.centros ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">Centro de costos</h2>
          <p className="mt-1 text-sm text-muted">
            Catálogo de centros de costo en Siigo — referencia para facturas de compra y contabilidad.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="rounded-paper border-2 border-border px-4 py-2 text-sm font-semibold text-ink transition hover:border-accent hover:text-accent disabled:opacity-40"
        >
          {isFetching ? "Actualizando…" : "Actualizar"}
        </button>
      </div>

      {isLoading && (
        <p className="text-sm text-muted">Consultando Siigo…</p>
      )}

      {error && (
        <div className="rounded-xl border border-red-300/50 bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {(error as Error).message || "No se pudieron cargar los centros de costo"}
        </div>
      )}

      {!isLoading && !error && centros.length === 0 && (
        <p className="text-sm text-muted">No hay centros de costo registrados en Siigo.</p>
      )}

      {centros.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-surface-panel">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-surface-hover text-[11px] font-bold uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2.5">Código</th>
                <th className="px-4 py-2.5">Nombre</th>
                <th className="px-4 py-2.5">ID Siigo</th>
                <th className="px-4 py-2.5">Estado</th>
              </tr>
            </thead>
            <tbody>
              {centros.map((c) => (
                <tr key={c.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2.5 font-mono text-xs text-ink">{c.code ?? "—"}</td>
                  <td className="px-4 py-2.5 font-medium text-ink">{c.name ?? "—"}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted">{c.id}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                        c.active
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : "bg-surface-hover text-muted"
                      }`}
                    >
                      {c.active ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted">
        Fuente: API Siigo · {data?.total ?? 0} centro{(data?.total ?? 0) !== 1 ? "s" : ""}
      </p>
    </div>
  );
}
