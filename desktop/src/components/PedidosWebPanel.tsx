import { useState, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

interface OrderItem {
  id?: string;
  name?: string;
  title?: string;
  quantity?: number;
  qty?: number;
  unit_price?: number;
  price?: number;
  total_price?: number;
  total?: number;
  sku?: string;
}

interface Billing {
  name?: string;
  nit?: string;
  city?: string;
  address?: string;
  email?: string;
}

interface Order {
  id: number;
  reference: string;
  buyer_name: string;
  buyer_email: string;
  buyer_phone: string;
  buyer_city: string;
  buyer_dept?: string;
  buyer_address?: string;
  buyer_notes?: string;
  buyer_cedula?: string;
  items: OrderItem[];
  total: number;
  shipping_cost?: number;
  status: string;
  shipping_status: string;
  tracking_number?: string;
  tracking_carrier?: string;
  created_at: string;
  payu_ref?: string;
  billing?: Billing;
  siigo_invoice_number?: string;
  siigo_invoice_status?: string;
  siigo_invoice_error?: string;
}

interface OrdersResponse {
  orders: Order[];
  total: number;
  page: number;
  per_page: number;
}

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  pending:  { label: "Pendiente",   cls: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
  approved: { label: "Aprobado",    cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  rejected: { label: "Rechazado",   cls: "bg-red-500/15 text-red-400 border-red-500/30" },
  refunded: { label: "Reembolsado", cls: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
};

const SHIP_LABELS: Record<string, { label: string; icon: string; cls: string }> = {
  preparing: { label: "Preparando", icon: "📦", cls: "text-gray-400" },
  shipped:   { label: "Enviado",    icon: "🚚", cls: "text-blue-400" },
  delivered: { label: "Entregado",  icon: "✅", cls: "text-emerald-400" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_LABELS[status] ?? { label: status, cls: "bg-gray-500/10 text-gray-400 border-gray-500/20" };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${s.cls}`}>
      {s.label}
    </span>
  );
}

function ShipBadge({ status }: { status: string }) {
  if (!status) return <span className="text-muted text-xs">—</span>;
  const s = SHIP_LABELS[status] ?? { label: status, icon: "📦", cls: "text-gray-400" };
  return (
    <span className={`text-xs font-medium ${s.cls}`}>
      {s.icon} {s.label}
    </span>
  );
}

function fmtCOP(n: number | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);
}

function fmtDate(s: string) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString("es-CO", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return s; }
}

interface FacturarResponse {
  ok: boolean;
  message: string;
  reference: string;
}

function OrderRow({
  order,
  onExpand,
  expanded,
  onFacturar,
  facturando,
}: {
  order: Order;
  onExpand: () => void;
  expanded: boolean;
  onFacturar: (reference: string) => void;
  facturando: boolean;
}) {
  const facturaEmitida = Boolean(order.siigo_invoice_number);
  const puedeFacturar = order.status === "approved" && !facturaEmitida;

  return (
    <>
      <tr
        onClick={onExpand}
        className="border-b border-border/50 hover:bg-surface-hover cursor-pointer transition-colors"
      >
        <td className="px-4 py-3">
          <span className="font-mono text-xs text-accent">{order.reference}</span>
        </td>
        <td className="px-4 py-3">
          <p className="text-sm font-medium text-ink truncate max-w-[160px]">{order.buyer_name}</p>
          <p className="text-[11px] text-muted truncate max-w-[160px]">{order.buyer_email}</p>
        </td>
        <td className="px-4 py-3 text-sm text-ink">{order.buyer_city}</td>
        <td className="px-4 py-3 text-sm font-semibold text-ink">{fmtCOP(order.total)}</td>
        <td className="px-4 py-3"><StatusBadge status={order.status} /></td>
        <td className="px-4 py-3"><ShipBadge status={order.shipping_status} /></td>
        <td className="px-4 py-3 text-[11px] text-muted whitespace-nowrap">{fmtDate(order.created_at)}</td>
        <td className="px-4 py-3 text-center">
          <svg
            className={`w-4 h-4 text-muted transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-border/50 bg-surface-panel/50">
          <td colSpan={8} className="px-4 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
              {/* Items */}
              <div>
                <p className="font-semibold text-muted uppercase tracking-wide mb-2">Productos</p>
                <div className="space-y-1">
                  {(order.items ?? []).length === 0 ? (
                    <p className="text-muted italic">Sin items</p>
                  ) : (
                    order.items.map((item, i) => (
                      <div key={i} className="flex justify-between gap-2">
                        <span className="text-ink truncate flex-1">
                          {item.name ?? item.title ?? `Ítem ${i + 1}`}
                          {" "}
                          <span className="text-muted">×{item.quantity ?? item.qty ?? 1}</span>
                        </span>
                        <span className="text-ink shrink-0">
                          {fmtCOP(item.total_price ?? item.total ?? ((item.unit_price ?? item.price ?? 0) * (item.quantity ?? item.qty ?? 1)))}
                        </span>
                      </div>
                    ))
                  )}
                  {order.shipping_cost != null && order.shipping_cost > 0 && (
                    <div className="flex justify-between gap-2 border-t border-border/30 pt-1 mt-1">
                      <span className="text-muted">Envío</span>
                      <span className="text-ink">{fmtCOP(order.shipping_cost)}</span>
                    </div>
                  )}
                  <div className="flex justify-between gap-2 font-semibold border-t border-border/30 pt-1">
                    <span className="text-ink">Total</span>
                    <span className="text-ink">{fmtCOP(order.total)}</span>
                  </div>
                </div>
              </div>

              {/* Datos comprador */}
              <div>
                <p className="font-semibold text-muted uppercase tracking-wide mb-2">Comprador</p>
                <dl className="space-y-1">
                  {order.buyer_phone && (
                    <div className="flex gap-2">
                      <dt className="text-muted w-16 shrink-0">Tel</dt>
                      <dd className="text-ink">{order.buyer_phone}</dd>
                    </div>
                  )}
                  {order.buyer_cedula && (
                    <div className="flex gap-2">
                      <dt className="text-muted w-16 shrink-0">Cédula</dt>
                      <dd className="text-ink">{order.buyer_cedula}</dd>
                    </div>
                  )}
                  {order.buyer_city && (
                    <div className="flex gap-2">
                      <dt className="text-muted w-16 shrink-0">Ciudad</dt>
                      <dd className="text-ink">{order.buyer_city}{order.buyer_dept ? `, ${order.buyer_dept}` : ""}</dd>
                    </div>
                  )}
                  {order.buyer_address && (
                    <div className="flex gap-2">
                      <dt className="text-muted w-16 shrink-0">Dirección</dt>
                      <dd className="text-ink">{order.buyer_address}</dd>
                    </div>
                  )}
                  {order.buyer_notes && (
                    <div className="flex gap-2">
                      <dt className="text-muted w-16 shrink-0">Notas</dt>
                      <dd className="text-ink italic">{order.buyer_notes}</dd>
                    </div>
                  )}
                </dl>
              </div>

              {/* Envío y facturación */}
              <div className="space-y-4">
                {/* Envío */}
                <div>
                  <p className="font-semibold text-muted uppercase tracking-wide mb-2">Envío</p>
                  <dl className="space-y-1">
                    <div className="flex gap-2">
                      <dt className="text-muted w-16 shrink-0">Estado</dt>
                      <dd><ShipBadge status={order.shipping_status} /></dd>
                    </div>
                    {order.tracking_number && (
                      <div className="flex gap-2">
                        <dt className="text-muted w-16 shrink-0">Guía</dt>
                        <dd className="text-ink font-mono">{order.tracking_carrier ? `${order.tracking_carrier}: ` : ""}{order.tracking_number}</dd>
                      </div>
                    )}
                    {order.payu_ref && (
                      <div className="flex gap-2">
                        <dt className="text-muted w-16 shrink-0">MP ref</dt>
                        <dd className="text-ink font-mono text-[10px]">{order.payu_ref}</dd>
                      </div>
                    )}
                  </dl>
                </div>

                {/* Facturación */}
                <div>
                  <p className="font-semibold text-muted uppercase tracking-wide mb-2">Facturación</p>
                  {order.billing ? (
                    <dl className="space-y-1">
                      {order.billing.name && (
                        <div className="flex gap-2">
                          <dt className="text-muted w-16 shrink-0">Nombre</dt>
                          <dd className="text-ink">{order.billing.name}</dd>
                        </div>
                      )}
                      {order.billing.nit && (
                        <div className="flex gap-2">
                          <dt className="text-muted w-16 shrink-0">NIT/CC</dt>
                          <dd className="text-ink">{order.billing.nit}</dd>
                        </div>
                      )}
                      {order.billing.city && (
                        <div className="flex gap-2">
                          <dt className="text-muted w-16 shrink-0">Ciudad</dt>
                          <dd className="text-ink">{order.billing.city}</dd>
                        </div>
                      )}
                    </dl>
                  ) : (
                    <p className="text-muted italic">Sin datos de facturación</p>
                  )}
                  {order.siigo_invoice_number ? (
                    <div className="mt-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 text-[11px] text-emerald-400">
                      Factura Siigo #{order.siigo_invoice_number}
                      {order.siigo_invoice_status ? ` — ${order.siigo_invoice_status}` : ""}
                    </div>
                  ) : puedeFacturar ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onFacturar(order.reference);
                      }}
                      disabled={!puedeFacturar || facturando}
                      className="mt-2 inline-flex items-center gap-2 rounded-lg bg-emerald-500/15 px-3 py-1.5 text-[11px] font-bold text-emerald-400 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                      title={
                        order.status !== "approved"
                          ? "Solo se puede facturar cuando el pago está aprobado"
                          : "Emitir factura electrónica en Siigo"
                      }
                    >
                      {facturando && (
                        <span className="inline-block h-3 w-3 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin" />
                      )}
                      {facturando ? "Facturando…" : "Facturar con Siigo"}
                    </button>
                  ) : (
                    <p className="mt-2 text-[11px] text-muted">
                      Disponible cuando el pago esté aprobado.
                    </p>
                  )}
                  {order.siigo_invoice_error && (
                    <p className="mt-2 text-[11px] text-danger">{order.siigo_invoice_error}</p>
                  )}
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function PedidosWebPanel() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [expandedRef, setExpandedRef] = useState<string | null>(null);
  const [facturarMsg, setFacturarMsg] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const queryParams = new URLSearchParams({
    q: search,
    status: statusFilter,
    page: String(page),
  }).toString();

  const { data, isLoading, error, refetch } = useQuery<OrdersResponse>({
    queryKey: ["pedidos-web", search, statusFilter, page],
    queryFn: () => api.get<OrdersResponse>(`/api/pedidos/web?${queryParams}`),
    refetchInterval: 30_000,
  });

  const facturar = useMutation({
    mutationFn: (reference: string) =>
      api.post<FacturarResponse>("/api/pedidos/web/facturar", { reference }, { timeoutMs: 120_000 }),
    onMutate: () => setFacturarMsg(null),
    onSuccess: (res) => {
      setFacturarMsg({ type: "ok", text: res.message || "Factura emitida en Siigo." });
      qc.invalidateQueries({ queryKey: ["pedidos-web"] });
    },
    onError: (e: Error) => {
      setFacturarMsg({ type: "error", text: e.message || "No se pudo facturar el pedido." });
      qc.invalidateQueries({ queryKey: ["pedidos-web"] });
    },
  });

  const totalPages = data ? Math.ceil(data.total / data.per_page) : 1;

  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
  }, []);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-ink">Pedidos Tienda Web</h2>
          <p className="text-xs text-muted">
            {data ? `${data.total} pedido${data.total !== 1 ? "s" : ""} en total` : "Cargando…"}
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="rounded-lg border border-border bg-surface-panel px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-hover transition"
        >
          🔄 Actualizar
        </button>
      </div>

      {/* Filters */}
      <form onSubmit={handleSearch} className="flex flex-wrap gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Buscar por referencia, email o nombre…"
          className="flex-1 min-w-48 rounded-lg border border-border bg-surface-input px-4 py-2 text-sm text-ink outline-none placeholder:text-muted/50 focus:border-accent"
        />
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent"
        >
          <option value="">Todos los estados</option>
          <option value="pending">Pendiente</option>
          <option value="approved">Aprobado</option>
          <option value="rejected">Rechazado</option>
          <option value="refunded">Reembolsado</option>
        </select>
      </form>

      {facturarMsg && (
        <div
          className={`rounded-lg border px-4 py-2 text-xs ${
            facturarMsg.type === "ok"
              ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
              : "border-red-500/25 bg-red-500/10 text-red-300"
          }`}
        >
          {facturarMsg.text}
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-border bg-surface-panel overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted text-sm">
            <span className="inline-block w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin mr-3" />
            Cargando pedidos…
          </div>
        ) : error ? (
          <div className="py-12 text-center text-danger text-sm">
            Error al cargar pedidos. Verifica la base de datos.
          </div>
        ) : !data?.orders?.length ? (
          <div className="py-16 text-center text-muted text-sm">
            No hay pedidos{search || statusFilter ? " con los filtros aplicados" : " todavía"}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border bg-surface-hover/50">
                  <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">Referencia</th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">Cliente</th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">Ciudad</th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">Total</th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">Pago</th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">Envío</th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">Fecha</th>
                  <th className="px-4 py-3 w-8" />
                </tr>
              </thead>
              <tbody>
                {data.orders.map((order) => (
                  <OrderRow
                    key={order.reference}
                    order={order}
                    expanded={expandedRef === order.reference}
                    facturando={facturar.isPending && facturar.variables === order.reference}
                    onFacturar={(reference) => facturar.mutate(reference)}
                    onExpand={() =>
                      setExpandedRef((prev) =>
                        prev === order.reference ? null : order.reference,
                      )
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-ink disabled:opacity-40 hover:bg-surface-hover transition"
          >
            ← Anterior
          </button>
          <span className="text-sm text-muted">
            Página {page} de {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-ink disabled:opacity-40 hover:bg-surface-hover transition"
          >
            Siguiente →
          </button>
        </div>
      )}
    </div>
  );
}
