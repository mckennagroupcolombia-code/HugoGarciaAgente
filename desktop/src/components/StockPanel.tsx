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
  stock_anterior?: number;
  delta?: number;
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

function CanalResultBox({ resultado }: { resultado: SincronizarResultado }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3 border-t border-border pt-3">
      {typeof resultado.stock_anterior === "number" && (
        <div className="sm:col-span-3 text-[11px] text-muted -mb-1">
          {resultado.stock_anterior} → <span className="font-bold text-ink">{resultado.stock_objetivo}</span> uds
          {typeof resultado.delta === "number" && (
            <span> ({resultado.delta >= 0 ? "+" : ""}{resultado.delta})</span>
          )}
        </div>
      )}
      <div className="rounded-lg bg-surface px-3 py-2">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted">
          {resultado.meli.ok ? "✅" : resultado.meli.no_aplica ? "ℹ️" : "❌"} MeLi
        </p>
        <p className="mt-0.5 text-[11px] text-ink-muted leading-snug">{resultado.meli.mensaje}</p>
      </div>
      <div className="rounded-lg bg-surface px-3 py-2">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted">
          {resultado.web.ok ? (resultado.web.numerico ? "✅" : "⚠️") : "❌"} Página web
        </p>
        <p className="mt-0.5 text-[11px] text-ink-muted leading-snug">{resultado.web.mensaje}</p>
      </div>
      <div className="rounded-lg bg-surface px-3 py-2">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted">
          ℹ️ Siigo{resultado.siigo.stock != null ? `: ${resultado.siigo.stock} uds` : ""}
        </p>
        <p className="mt-0.5 text-[11px] text-ink-muted leading-snug">{resultado.siigo.mensaje}</p>
      </div>
    </div>
  );
}

function StockRow({
  item,
  isBusy,
  resultado,
  onAjustar,
  onSincronizar,
}: {
  item: StockItem;
  isBusy: boolean;
  resultado?: SincronizarResultado;
  onAjustar: (delta: number) => void;
  onSincronizar: () => void;
}) {
  const [cantidad, setCantidad] = useState("");
  const estado = estadoDe(item.stock);
  const cantidadNum = Math.max(0, parseInt(cantidad, 10) || 0);

  const aplicar = (signo: 1 | -1) => {
    if (!cantidadNum) return;
    onAjustar(signo * cantidadNum);
    setCantidad("");
  };

  return (
    <div className="rounded-xl border border-border bg-surface-panel p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink truncate">{item.nombre}</p>
          <p className="text-xs text-muted">
            SKU: {item.sku || "—"} · MeLi: {item.meli_id}
          </p>
        </div>
        {item.sync_bloqueado && (
          <span
            className="shrink-0 rounded-full bg-muted/20 px-2.5 py-1 text-xs font-semibold text-muted"
            title="MeLi no permite cambiar el stock de una publicación que no está activa"
          >
            {ESTADO_MELI_LABELS[item.estado_meli ?? ""] ?? item.estado_meli ?? "No activa"} en MeLi
          </span>
        )}
        {!item.sync_bloqueado && item.es_full && (
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
          {item.stock} uds
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          min={0}
          inputMode="numeric"
          value={cantidad}
          onChange={(e) => setCantidad(e.target.value)}
          placeholder="Cantidad"
          disabled={!item.sku || isBusy || item.sync_bloqueado}
          className="w-24 rounded-lg border border-border bg-surface-input px-2.5 py-1.5 text-xs text-ink outline-none placeholder:text-muted/50 focus:border-accent disabled:opacity-40"
        />
        <button
          onClick={() => aplicar(1)}
          disabled={!item.sku || isBusy || item.sync_bloqueado || !cantidadNum}
          className="rounded-lg bg-emerald-600/15 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 transition hover:bg-emerald-600/25 disabled:opacity-40"
        >
          + Entrada
        </button>
        <button
          onClick={() => aplicar(-1)}
          disabled={!item.sku || isBusy || item.sync_bloqueado || !cantidadNum}
          className="rounded-lg bg-danger/15 px-3 py-1.5 text-xs font-semibold text-danger transition hover:bg-danger/25 disabled:opacity-40"
        >
          − Salida
        </button>
        <span className="text-muted/50 px-1">|</span>
        <button
          onClick={onSincronizar}
          disabled={!item.sku || isBusy}
          title="Reenvía el stock actual de MeLi a los canales sin cambiar la cantidad"
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-ink-muted transition hover:border-accent/50 hover:text-accent disabled:opacity-40"
        >
          {isBusy ? "..." : "Reenviar sin cambios"}
        </button>
      </div>

      {resultado && <CanalResultBox resultado={resultado} />}
    </div>
  );
}

export default function StockPanel() {
  const [search, setSearch] = useState("");
  const [busySku, setBusySku] = useState<string | null>(null);
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

  const errorResultado = (sku: string, message: string): SincronizarResultado => ({
    sku,
    stock_objetivo: 0,
    meli: { ok: false, mensaje: `Error: ${message}` },
    web: { ok: false, mensaje: "—" },
    siigo: { stock: null, mensaje: "—" },
  });

  const ajustarMut = useMutation({
    mutationFn: ({ sku, meli_id, delta }: { sku: string; meli_id: string; delta: number }) =>
      api.post<SincronizarResultado>("/api/stock/ajustar", { sku, meli_id, delta }),
    onMutate: ({ sku }) => setBusySku(sku),
    onSuccess: (res, { sku }) => {
      setRowResult((prev) => ({ ...prev, [sku]: res }));
      queryClient.invalidateQueries({ queryKey: ["stock-resumen"] });
    },
    onError: (err, { sku }) => setRowResult((prev) => ({ ...prev, [sku]: errorResultado(sku, err.message) })),
    onSettled: () => setBusySku(null),
  });

  const sincronizarUnoMut = useMutation({
    mutationFn: ({ sku, stock, meli_id }: { sku: string; stock: number; meli_id: string }) =>
      api.post<SincronizarResultado>("/api/stock/sincronizar", { sku, stock, meli_id }),
    onMutate: ({ sku }) => setBusySku(sku),
    onSuccess: (res, { sku }) => setRowResult((prev) => ({ ...prev, [sku]: res })),
    onError: (err, { sku }) => setRowResult((prev) => ({ ...prev, [sku]: errorResultado(sku, err.message) })),
    onSettled: () => setBusySku(null),
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
            {sincronizarTodoMut.isPending ? "Sincronizando..." : "⇄ Reenviar todo a los canales"}
          </button>
        </div>
      </div>

      <p className="text-xs text-muted -mt-3">
        Este panel es el punto único de entrada de inventario: registra aquí las entradas y salidas
        de unidades y se propagan a MeLi y a la página web. Siigo se muestra solo de referencia — su
        API no permite escribirle stock, así que ahí se sigue ajustando aparte (compras/ventas ya lo
        mueven solas al facturar).
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
        {items.map((it) => (
          <StockRow
            key={it.meli_id}
            item={it}
            isBusy={busySku === it.sku}
            resultado={rowResult[it.sku]}
            onAjustar={(delta) => {
              setRowResult((prev) => {
                const next = { ...prev };
                delete next[it.sku];
                return next;
              });
              ajustarMut.mutate({ sku: it.sku, meli_id: it.meli_id, delta });
            }}
            onSincronizar={() => {
              setRowResult((prev) => {
                const next = { ...prev };
                delete next[it.sku];
                return next;
              });
              sincronizarUnoMut.mutate({ sku: it.sku, stock: it.stock, meli_id: it.meli_id });
            }}
          />
        ))}
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
