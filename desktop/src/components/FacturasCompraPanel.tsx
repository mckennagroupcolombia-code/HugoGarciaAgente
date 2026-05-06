import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import TerminalLog from "./TerminalLog";
import { usePanelLogs, useClearPanelLogs } from "../hooks/usePanelLogs";

interface Factura {
  sufijo: string;
  numero_factura: string;
  proveedor: string;
  nit: string;
  es_nuevo_proveedor: boolean;
  items_count: number;
  total: number;
  estado: string;
}

type Cmd = "inventario" | "gasto" | "skip";

function FacturaCard({
  factura,
  onClasificar,
  loading,
}: {
  factura: Factura;
  onClasificar: (sufijo: string, cmd: Cmd) => void;
  loading: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-panel p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs font-bold text-accent bg-accent/10 px-2 py-0.5 rounded">
              #{factura.sufijo}
            </span>
            <span className="text-sm font-semibold text-ink truncate">
              {factura.numero_factura}
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-secondary font-medium">{factura.proveedor}</p>
          {factura.nit && (
            <p className="text-[11px] text-muted font-mono">NIT: {factura.nit}</p>
          )}
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
            factura.es_nuevo_proveedor
              ? "bg-yellow-500/15 text-yellow-400"
              : "bg-emerald-500/15 text-emerald-400"
          }`}
        >
          {factura.es_nuevo_proveedor ? "Nuevo proveedor" : "Conocido"}
        </span>
      </div>

      <div className="flex gap-4 text-xs text-muted font-mono">
        <span>📦 {factura.items_count} ítem(s)</span>
        <span>💰 ${factura.total.toLocaleString("es-CO")} COP</span>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          disabled={loading}
          onClick={() => onClasificar(factura.sufijo, "inventario")}
          className="flex-1 rounded-lg bg-emerald-500/15 px-3 py-1.5 text-xs font-bold text-emerald-400 transition hover:bg-emerald-500/30 disabled:opacity-40"
        >
          📦 Inventario
        </button>
        <button
          disabled={loading}
          onClick={() => onClasificar(factura.sufijo, "gasto")}
          className="flex-1 rounded-lg bg-yellow-500/15 px-3 py-1.5 text-xs font-bold text-yellow-400 transition hover:bg-yellow-500/30 disabled:opacity-40"
        >
          🧾 Gasto
        </button>
        <button
          disabled={loading}
          onClick={() => onClasificar(factura.sufijo, "skip")}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted transition hover:border-border-strong hover:text-ink disabled:opacity-40"
        >
          Omitir
        </button>
      </div>
    </div>
  );
}

export default function FacturasCompraPanel() {
  const queryClient = useQueryClient();
  const [localLines, setLocalLines] = useState<string[]>([]);
  const clearPanelLogs = useClearPanelLogs();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["facturas-pendientes"],
    queryFn: () => api.get<{ pendientes: Factura[]; total: number }>("/api/facturas/pendientes"),
    refetchInterval: 8000,
  });

  const { data: logData } = usePanelLogs(true);
  const panelLines = logData?.lines ?? [];
  const allLines = [...panelLines, ...localLines];

  const clasificar = useMutation({
    mutationFn: ({ cmd, sufijo }: { cmd: Cmd; sufijo: string }) =>
      api.post<{ ok: boolean; mensaje: string }>("/api/facturas/clasificar", { cmd, sufijo }),
    onSuccess: (result) => {
      const ts = new Date().toLocaleTimeString("es-CO");
      setLocalLines((prev) => [
        ...prev,
        `${ts} ${result.mensaje?.replace(/\*/g, "").slice(0, 300) ?? "✔ Clasificado"}`,
      ]);
      queryClient.invalidateQueries({ queryKey: ["facturas-pendientes"] });
      setTimeout(() => refetch(), 1200);
    },
    onError: (err: Error) => {
      setLocalLines((prev) => [
        ...prev,
        `❌ Error: ${err.message}`,
      ]);
    },
  });

  const handleClasificar = useCallback(
    (sufijo: string, cmd: Cmd) => {
      clasificar.mutate({ cmd, sufijo });
    },
    [clasificar],
  );

  const handleClearLogs = useCallback(async () => {
    setLocalLines([]);
    clearPanelLogs.mutate();
  }, [clearPanelLogs]);

  const pendientes = data?.pendientes ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="flex flex-col gap-4" style={{ minHeight: 0 }}>
      {/* Header */}
      <div className="flex items-center gap-3 shrink-0">
        <h2 className="text-lg font-semibold text-ink">Facturas de Compra</h2>
        {total > 0 && (
          <span className="rounded-full bg-yellow-500/20 px-2.5 py-0.5 text-xs font-bold text-yellow-400">
            {total} pendiente{total !== 1 ? "s" : ""}
          </span>
        )}
        <button
          onClick={() => refetch()}
          className="ml-auto text-xs text-muted hover:text-ink transition"
        >
          ↻ Actualizar
        </button>
      </div>

      <div className="flex flex-col lg:flex-row gap-4" style={{ minHeight: 0 }}>
        {/* Left: facturas list */}
        <div className="w-full lg:w-80 xl:w-96 shrink-0 flex flex-col gap-3 overflow-y-auto">
          {isLoading && (
            <div className="text-sm text-muted text-center py-8">Cargando facturas…</div>
          )}
          {!isLoading && pendientes.length === 0 && (
            <div className="rounded-xl border border-border bg-surface-panel p-6 text-center">
              <p className="text-2xl mb-2">✅</p>
              <p className="text-sm font-semibold text-ink">Sin facturas pendientes</p>
              <p className="text-xs text-muted mt-1">
                Ejecuta "Facturas Gmail" en Sincronización para escanear nuevas facturas.
              </p>
            </div>
          )}
          {pendientes.map((f) => (
            <FacturaCard
              key={f.sufijo}
              factura={f}
              onClasificar={handleClasificar}
              loading={clasificar.isPending}
            />
          ))}
        </div>

        {/* Right: terminal output */}
        <div className="flex-1 min-w-0">
          <TerminalLog
            lines={allLines}
            isRunning={clasificar.isPending}
            onClear={handleClearLogs}
            className="h-[500px] lg:h-[600px]"
          />
          <p className="mt-2 text-[11px] text-muted px-1">
            💡 <strong>Inventario</strong>: registra en SIIGO como materia prima (proveedor nuevo se agrega automáticamente).&nbsp;
            <strong>Gasto</strong>: registra como consumible/gasto directo.&nbsp;
            <strong>Omitir</strong>: descarta sin registrar.
          </p>
        </div>
      </div>
    </div>
  );
}
