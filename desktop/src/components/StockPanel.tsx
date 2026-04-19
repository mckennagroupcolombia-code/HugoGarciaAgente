import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../api/client";

interface StockResult {
  status: string;
  mensaje?: string;
  resultado?: unknown;
}

export default function StockPanel() {
  const [search, setSearch] = useState("");
  const [searchResult, setSearchResult] = useState<string | null>(null);

  const reporteMut = useMutation({
    mutationFn: () => api.post<StockResult>("/api/sync/stock"),
  });

  const verificarMut = useMutation({
    mutationFn: () => api.post<StockResult>("/api/sync/completo"),
  });

  const buscarMut = useMutation({
    mutationFn: (nombre: string) =>
      api.get<StockResult>(`/api/consultar/producto?nombre=${encodeURIComponent(nombre)}`),
    onSuccess: (data) => {
      setSearchResult(
        typeof data.resultado === "string"
          ? data.resultado
          : JSON.stringify(data.resultado, null, 2),
      );
    },
    onError: (err) => setSearchResult(`Error: ${err.message}`),
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h2 className="text-lg font-semibold text-ink">Stock e Inventario</h2>

      {/* Search product */}
      <section className="rounded-xl border border-border bg-surface-panel p-5 space-y-3">
        <h3 className="text-sm font-medium text-ink">Buscar producto</h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && search.trim()) buscarMut.mutate(search.trim());
            }}
            placeholder="Nombre del producto..."
            className="flex-1 rounded-lg border border-border bg-surface-input px-3 py-2.5 text-sm text-ink outline-none placeholder:text-muted/50 focus:border-accent"
          />
          <button
            onClick={() => buscarMut.mutate(search.trim())}
            disabled={!search.trim() || buscarMut.isPending}
            className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition hover:bg-accent-hover disabled:opacity-40"
          >
            {buscarMut.isPending ? "..." : "Buscar"}
          </button>
        </div>
        {searchResult && (
          <pre className="max-h-64 overflow-auto rounded-lg bg-surface p-3 text-xs text-ink-muted">
            {searchResult}
          </pre>
        )}
      </section>

      {/* Quick actions */}
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          onClick={() => reporteMut.mutate()}
          disabled={reporteMut.isPending}
          className="rounded-xl border border-border bg-surface-panel p-5 text-left transition hover:border-accent/50"
        >
          <p className="text-sm font-medium text-ink">Reporte de Stock</p>
          <p className="mt-1 text-xs text-muted">
            {reporteMut.isPending
              ? "Generando..."
              : reporteMut.isSuccess
                ? "Reporte en camino por WhatsApp"
                : "Genera y envia reporte por WhatsApp"}
          </p>
          {reporteMut.isError && (
            <p className="mt-1 text-xs text-danger">{reporteMut.error.message}</p>
          )}
        </button>

        <button
          onClick={() => verificarMut.mutate()}
          disabled={verificarMut.isPending}
          className="rounded-xl border border-border bg-surface-panel p-5 text-left transition hover:border-accent/50"
        >
          <p className="text-sm font-medium text-ink">Verificar SKUs</p>
          <p className="mt-1 text-xs text-muted">
            {verificarMut.isPending
              ? "Verificando..."
              : verificarMut.isSuccess
                ? "Verificacion iniciada"
                : "Sync completo + verificacion de SKUs"}
          </p>
          {verificarMut.isError && (
            <p className="mt-1 text-xs text-danger">{verificarMut.error.message}</p>
          )}
        </button>
      </div>
    </div>
  );
}
