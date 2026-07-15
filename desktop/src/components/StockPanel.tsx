import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import PanelHelp from "./PanelHelp";

interface StockItem {
  meli_id: string;
  sku: string;
  nombre: string;
  stock: number;
  fila?: number | null;
  estado_meli?: string;
  es_full?: boolean;
  sync_bloqueado?: boolean;
}

interface StockResumen {
  items: StockItem[];
  total: number;
}

interface CanalResultado {
  ok?: boolean;
  mensaje: string;
  stock?: number | null;
  numerico?: boolean;
  no_aplica?: boolean;
}

interface SincronizarResultado {
  sku: string;
  stock_objetivo: number;
  meli: CanalResultado;
  web: CanalResultado;
  siigo: CanalResultado;
}

function estadoDe(stock: number): { label: string; className: string } {
  if (stock <= 0) return { label: "Agotado", className: "bg-danger/15 text-danger" };
  if (stock === 1) return { label: "Última unidad", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400" };
  return { label: "OK", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" };
}

const ESTADO_MELI_LABELS: Record<string, string> = {
  active: "Activo",
  paused: "Pausado",
  closed: "Cerrado",
  inactive: "Inactivo",
  under_review: "En revisión",
};

export default function StockPanel() {
  const [search, setSearch] = useState("");
  const [syncingSku, setSyncingSku] = useState<string | null>(null);
  const [rowResult, setRowResult] = useState<Record<string, SincronizarResultado>>({});
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery<StockResumen>({
    queryKey: ["stock-resumen"],
    queryFn: () => api.get<StockResumen>("/api/stock/resumen"),
    staleTime: 60_000,
  });

  const items = useMemo(() => {
    const list = data?.items ?? [];
    const q = search.trim().toLowerCase();
    const filtered = q
      ? list.filter((i) => i.nombre.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q))
      : list;
    return [...filtered].sort((a, b) => a.stock - b.stock);
  }, [data, search]);

  const counts = useMemo(() => {
    const list = data?.items ?? [];
    return {
      agotados: list.filter((i) => i.stock <= 0).length,
      criticos: list.filter((i) => i.stock === 1).length,
      bloqueados: list.filter((i) => i.sync_bloqueado).length,
    };
  }, [data]);

  const sincronizarUnoMut = useMutation({
    mutationFn: ({ sku, stock, meli_id }: { sku: string; stock: number; meli_id: string }) =>
      api.post<SincronizarResultado>("/api/stock/sincronizar", { sku, stock, meli_id }),
    onMutate: ({ sku }) => setSyncingSku(sku),
    onSuccess: (res, { sku }) => {
      setRowResult((prev) => ({ ...prev, [sku]: res }));
    },
    onError: (err, { sku }) => {
      setRowResult((prev) => ({
        ...prev,
        [sku]: {
          sku,
          stock_objetivo: 0,
          meli: { ok: false, mensaje: `Error: ${err.message}` },
          web: { ok: false, mensaje: "—" },
          siigo: { stock: null, mensaje: "—" },
        },
      }));
    },
    onSettled: () => setSyncingSku(null),
  });

  const sincronizarTodoMut = useMutation({
    mutationFn: () => api.post("/api/stock/sincronizar-todo"),
  });

  const reporteMut = useMutation({
    mutationFn: () => api.post<{ mensaje?: string }>("/api/sync/stock"),
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PanelHelp panelId="stock" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-extrabold text-ink">📦 Stock e Inventario</h2>
        <div className="flex gap-2">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="rounded-lg border border-border bg-surface-panel px-3 py-2 text-xs font-semibold text-ink transition hover:border-accent/50 disabled:opacity-40"
          >
            {isFetching ? "Actualizando..." : "🔄 Actualizar desde MeLi"}
          </button>
          <button
            onClick={() => sincronizarTodoMut.mutate()}
            disabled={sincronizarTodoMut.isPending || !items.length}
            className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-white transition hover:bg-accent-hover disabled:opacity-40"
          >
            {sincronizarTodoMut.isPending ? "Sincronizando..." : "⇄ Sincronizar todo a los canales"}
          </button>
        </div>
      </div>

      <p className="text-xs text-muted -mt-3">
        El stock real se edita a mano en MercadoLibre. Esta pantalla muestra ese valor en vivo y,
        al sincronizar, empuja el número a la página web y muestra de referencia el stock en Siigo
        (Siigo solo se usa para facturación, nunca se le escribe stock).
      </p>

      {sincronizarTodoMut.isSuccess && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">
          Sincronización masiva iniciada en segundo plano. Revisa Sincronización → Actividad para
          ver el detalle.
        </p>
      )}
      {sincronizarTodoMut.isError && (
        <p className="text-xs text-danger">{sincronizarTodoMut.error.message}</p>
      )}

      {/* Summary chips */}
      {!!data?.total && (
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border border-border bg-surface-panel px-3 py-1 text-xs text-ink-muted">
            {data.total} productos con MeLi vinculado
          </span>
          {counts.agotados > 0 && (
            <span className="rounded-full bg-danger/15 px-3 py-1 text-xs font-semibold text-danger">
              {counts.agotados} agotados
            </span>
          )}
          {counts.criticos > 0 && (
            <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
              {counts.criticos} en última unidad
            </span>
          )}
          {counts.bloqueados > 0 && (
            <span
              className="rounded-full bg-muted/20 px-3 py-1 text-xs font-semibold text-muted"
              title="Publicaciones pausadas, cerradas o en revisión en MeLi: no se les puede sincronizar el stock hasta reactivarlas allá"
            >
              {counts.bloqueados} sin publicación activa en MeLi
            </span>
          )}
        </div>
      )}

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Filtrar por nombre o SKU..."
        className="w-full rounded-lg border border-border bg-surface-input px-3 py-2.5 text-sm text-ink outline-none placeholder:text-muted/50 focus:border-accent"
      />

      {isLoading && <p className="text-sm text-muted">Cargando stock desde MeLi...</p>}
      {isError && (
        <p className="text-sm text-danger">
          No se pudo cargar el stock: {error instanceof Error ? error.message : "error desconocido"}
        </p>
      )}

      {!isLoading && !isError && items.length === 0 && (
        <p className="text-sm text-muted">No hay productos que coincidan.</p>
      )}

      <div className="space-y-2">
        {items.map((it) => {
          const estado = estadoDe(it.stock);
          const isSyncing = syncingSku === it.sku;
          const resultado = rowResult[it.sku];
          return (
            <div key={it.meli_id} className="rounded-xl border border-border bg-surface-panel p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink truncate">{it.nombre}</p>
                  <p className="text-xs text-muted">
                    SKU: {it.sku || "—"} · MeLi: {it.meli_id}
                  </p>
                </div>
                {it.sync_bloqueado && (
                  <span
                    className="shrink-0 rounded-full bg-muted/20 px-2.5 py-1 text-xs font-semibold text-muted"
                    title="MeLi no permite cambiar el stock de una publicación que no está activa"
                  >
                    {ESTADO_MELI_LABELS[it.estado_meli ?? ""] ?? it.estado_meli ?? "No activa"} en MeLi
                  </span>
                )}
                {!it.sync_bloqueado && it.es_full && (
                  <span
                    className="shrink-0 rounded-full bg-muted/20 px-2.5 py-1 text-xs font-semibold text-muted"
                    title="Mercado Envíos Full: MeLi administra este stock según el inventario físico enviado a su bodega. Solo se puede sincronizar hacia la web, no escribir en MeLi."
                  >
                    Full (MeLi)
                  </span>
                )}
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${estado.className}`}>
                  {estado.label}
                </span>
                <span className="shrink-0 w-14 text-right text-sm font-bold text-ink tabular-nums">
                  {it.stock} uds
                </span>
                <button
                  onClick={() => {
                    setRowResult((prev) => {
                      const next = { ...prev };
                      delete next[it.sku];
                      return next;
                    });
                    sincronizarUnoMut.mutate({ sku: it.sku, stock: it.stock, meli_id: it.meli_id });
                  }}
                  disabled={!it.sku || isSyncing || it.sync_bloqueado}
                  title={
                    !it.sku
                      ? "Este producto no tiene SKU asignado"
                      : it.sync_bloqueado
                        ? "Reactiva la publicación en MeLi antes de sincronizar su stock"
                        : undefined
                  }
                  className="shrink-0 rounded-lg bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent/25 disabled:opacity-40"
                >
                  {isSyncing ? "..." : "Sincronizar a los canales"}
                </button>
              </div>

              {resultado && (
                <div className="grid gap-2 sm:grid-cols-3 border-t border-border pt-3">
                  <div className="rounded-lg bg-surface px-3 py-2">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-muted">
                      {resultado.meli.ok ? "✅" : resultado.meli.no_aplica ? "ℹ️" : "❌"} MeLi
                    </p>
                    <p className="mt-0.5 text-[11px] text-ink-muted leading-snug">
                      {resultado.meli.mensaje}
                    </p>
                  </div>
                  <div className="rounded-lg bg-surface px-3 py-2">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-muted">
                      {resultado.web.ok ? (resultado.web.numerico ? "✅" : "⚠️") : "❌"} Página web
                    </p>
                    <p className="mt-0.5 text-[11px] text-ink-muted leading-snug">
                      {resultado.web.mensaje}
                    </p>
                  </div>
                  <div className="rounded-lg bg-surface px-3 py-2">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-muted">
                      ℹ️ Siigo{resultado.siigo.stock != null ? `: ${resultado.siigo.stock} uds` : ""}
                    </p>
                    <p className="mt-0.5 text-[11px] text-ink-muted leading-snug">
                      {resultado.siigo.mensaje}
                    </p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Reporte por WhatsApp */}
      <section className="rounded-xl border border-border bg-surface-panel p-5">
        <p className="text-sm font-medium text-ink">Reporte de Stock por WhatsApp</p>
        <p className="mt-1 text-xs text-muted">
          {reporteMut.isPending
            ? "Generando..."
            : reporteMut.isSuccess
              ? "Reporte enviado al grupo de Inventario"
              : "Envía el resumen de agotados y últimas unidades al grupo de Inventario"}
        </p>
        {reporteMut.isError && <p className="mt-1 text-xs text-danger">{reporteMut.error.message}</p>}
        <button
          onClick={() => {
            reporteMut.mutate();
            queryClient.invalidateQueries({ queryKey: ["stock-resumen"] });
          }}
          disabled={reporteMut.isPending}
          className="mt-3 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-accent/50 disabled:opacity-40"
        >
          Generar reporte
        </button>
      </section>
    </div>
  );
}
