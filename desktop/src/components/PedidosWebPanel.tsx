import { useState, useCallback, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

/** Prefill desde `?q=` / `?ref=` en la URL (p. ej. /app/?q=Alejandra#/pedidos). */
function initialPedidosSearch(): string {
  if (typeof window === "undefined") return "";
  try {
    const sp = new URLSearchParams(window.location.search);
    const q = (sp.get("q") || sp.get("ref") || "").trim();
    if (q) return q;
  } catch {
    /* ignore */
  }
  return "";
}

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

interface ReciboReembolso {
  titulo?: string;
  pedido?: string;
  comprador?: string;
  email?: string;
  payment_id?: string;
  refund_id?: string;
  monto?: number;
  monto_fmt?: string;
  moneda?: string;
  estado?: string;
  fecha?: string;
  metodo?: string;
  tipo_pago?: string;
  motivo?: string;
  parcial?: boolean;
  ya_existia?: boolean;
  mp_activity_url?: string;
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
  /** Mercado Pago payment_method_id (pse, visa, boton_bancolombia, …) */
  payment_method?: string;
  /** Mercado Pago payment_type_id (credit_card, bank_transfer, …) */
  payment_type?: string;
  billing?: Billing;
  siigo_invoice_number?: string;
  siigo_invoice_status?: string;
  siigo_invoice_error?: string;
  mp_refund_id?: string;
  refunded_at?: string;
  recibo_reembolso?: ReciboReembolso;
}

interface OrdersResponse {
  orders: Order[];
  total: number;
  page: number;
  per_page: number;
}

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  pending:      { label: "Pendiente",    cls: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
  approved:     { label: "Aprobado",     cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  declined:     { label: "Rechazado",    cls: "bg-red-500/15 text-red-400 border-red-500/30" },
  rejected:     { label: "Rechazado",    cls: "bg-red-500/15 text-red-400 border-red-500/30" },
  cancelled:    { label: "Anulado",      cls: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30" },
  canceled:     { label: "Anulado",      cls: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30" },
  refunded:     { label: "Reembolsado",  cls: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  no_realizado: { label: "No realizado", cls: "bg-orange-500/15 text-orange-300 border-orange-500/30" },
  unknown:      { label: "Por verificar", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
};

const SHIP_LABELS: Record<string, { label: string; icon: string; cls: string }> = {
  preparing: { label: "Preparando", icon: "📦", cls: "text-gray-400" },
  shipped:   { label: "Enviado",    icon: "🚚", cls: "text-blue-400" },
  delivered: { label: "Entregado",  icon: "✅", cls: "text-emerald-400" },
};

/** Etiquetas legibles para payment_method_id / payment_type_id de Mercado Pago. */
const MP_METHOD_LABELS: Record<string, string> = {
  pse: "PSE",
  boton_bancolombia: "Bancolombia",
  bancolombia: "Bancolombia",
  nequi: "Nequi",
  daviplata: "Daviplata",
  efecty: "Efecty",
  visa: "Visa",
  master: "Mastercard",
  debvisa: "Visa Débito",
  debmaster: "Mastercard Débito",
  amex: "American Express",
  elo: "Elo",
  diners: "Diners",
  account_money: "Saldo Mercado Pago",
  codensa: "Codensa",
  rappipay: "RappiPay",
};

const MP_TYPE_LABELS: Record<string, string> = {
  credit_card: "Tarjeta crédito",
  debit_card: "Tarjeta débito",
  prepaid_card: "Tarjeta prepago",
  bank_transfer: "Transferencia",
  ticket: "Efectivo / convenio",
  atm: "Cajero ATM",
  account_money: "Saldo Mercado Pago",
  digital_currency: "Moneda digital",
  digital_wallet: "Billetera digital",
};

function labelMetodoPago(method?: string, type?: string): string | null {
  const m = (method || "").trim().toLowerCase();
  const t = (type || "").trim().toLowerCase();
  if (m && MP_METHOD_LABELS[m]) return MP_METHOD_LABELS[m];
  if (m) {
    // p. ej. "debvisa" sin mapear → título amigable
    return m.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (t && MP_TYPE_LABELS[t]) return MP_TYPE_LABELS[t];
  if (t) return t.replace(/_/g, " ");
  return null;
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_LABELS[status] ?? { label: status, cls: "bg-gray-500/10 text-gray-400 border-gray-500/20" };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${s.cls}`}>
      {s.label}
    </span>
  );
}

function PagoCell({ order }: { order: Order }) {
  const metodo = labelMetodoPago(order.payment_method, order.payment_type);
  const viaMp = Boolean(order.payu_ref) && !metodo;
  return (
    <div className="flex flex-col gap-0.5">
      <StatusBadge status={order.status} />
      {metodo ? (
        <span className="text-[10px] text-muted leading-tight" title={order.payu_ref ? `MP ${order.payu_ref}` : undefined}>
          {metodo}
        </span>
      ) : viaMp ? (
        <span className="text-[10px] text-muted leading-tight" title={`MP ${order.payu_ref}`}>
          Mercado Pago
        </span>
      ) : null}
    </div>
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

interface AnularResponse {
  ok: boolean;
  message: string;
  reference: string;
}

interface ReembolsarResponse {
  ok: boolean;
  message: string;
  reference: string;
  recibo?: ReciboReembolso;
}

function parseReciboOrder(order: Order): ReciboReembolso | null {
  if (order.recibo_reembolso && typeof order.recibo_reembolso === "object") {
    return order.recibo_reembolso;
  }
  return null;
}

function ReciboReembolsoCard({
  recibo,
  compact = false,
}: {
  recibo: ReciboReembolso;
  compact?: boolean;
}) {
  const rows: Array<[string, string]> = [
    ["Pedido", recibo.pedido || "—"],
    ["Cliente", recibo.comprador || "—"],
    ["Monto", `${recibo.monto_fmt || fmtCOP(recibo.monto ?? 0)} ${recibo.moneda || "COP"}`],
    ["Estado", (recibo.estado || "—").toUpperCase()],
    ["Payment ID", recibo.payment_id || "—"],
    ["Refund ID", recibo.refund_id || "—"],
    ["Fecha", recibo.fecha ? fmtDate(recibo.fecha) : "—"],
    ["Método", [recibo.metodo, recibo.tipo_pago].filter(Boolean).join(" · ") || "Mercado Pago"],
  ];
  if (recibo.motivo) rows.push(["Motivo", recibo.motivo]);
  if (recibo.parcial) rows.push(["Tipo", "Reembolso parcial"]);
  if (recibo.ya_existia) rows.push(["Nota", "El pago ya estaba reembolsado en MP"]);

  const copyText = () => {
    const text = [
      recibo.titulo || "Recibo de reembolso — Mercado Pago",
      ...rows.map(([k, v]) => `${k}: ${v}`),
      recibo.mp_activity_url ? `Ver en MP: ${recibo.mp_activity_url}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    void navigator.clipboard?.writeText(text);
  };

  return (
    <div
      className={`rounded-xl border border-blue-500/30 bg-blue-500/5 ${
        compact ? "p-3 mt-2" : "p-4 mt-3"
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-blue-300">
            {recibo.titulo || "Recibo de reembolso"}
          </p>
          <p className="text-[10px] text-muted mt-0.5">Comprobante Mercado Pago</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              copyText();
            }}
            className="rounded-md border border-border/60 px-2 py-1 text-[10px] text-ink hover:bg-surface-hover"
          >
            Copiar
          </button>
          {recibo.mp_activity_url && (
            <a
              href={recibo.mp_activity_url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="rounded-md border border-border/60 px-2 py-1 text-[10px] text-accent hover:bg-surface-hover"
            >
              Ver en MP
            </a>
          )}
        </div>
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-2 min-w-0">
            <dt className="text-muted w-20 shrink-0">{k}</dt>
            <dd className="text-ink font-mono break-all">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function OrderRow({
  order,
  onExpand,
  expanded,
  onFacturar,
  facturando,
  onAnular,
  anulando,
  onReembolsar,
  reembolsando,
}: {
  order: Order;
  onExpand: () => void;
  expanded: boolean;
  onFacturar: (reference: string) => void;
  facturando: boolean;
  onAnular: (reference: string, force: boolean) => void;
  anulando: boolean;
  onReembolsar: (reference: string, force: boolean) => void;
  reembolsando: boolean;
}) {
  const facturaEmitida = Boolean(order.siigo_invoice_number);
  const status = (order.status || "").toLowerCase();
  const anulado = status === "cancelled" || status === "canceled" || status === "refunded";
  const reembolsado = status === "refunded";
  const pagoFallido =
    status === "declined" ||
    status === "rejected" ||
    status === "pending" ||
    status === "no_realizado";
  const puedeFacturar = status === "approved" && !facturaEmitida && !anulado;
  const enviado =
    (order.shipping_status || "").toLowerCase() === "shipped" ||
    (order.shipping_status || "").toLowerCase() === "delivered";
  const puedeAnular =
    !anulado &&
    (status === "approved" ||
      status === "pending" ||
      status === "unknown" ||
      status === "declined" ||
      status === "rejected" ||
      status === "no_realizado" ||
      !status);
  const busy = facturando || anulando || reembolsando;
  // Si hay payment_id MP y no está reembolsado/fallido, se puede devolver (incluye "unknown").
  const puedeReembolsar =
    Boolean(order.payu_ref) && !reembolsado && !pagoFallido;

  return (
    <>
      <tr
        onClick={onExpand}
        className="border-b border-border/50 hover:bg-surface-hover cursor-pointer transition-colors"
      >
        <td className="px-4 py-3">
          <span className="font-mono text-xs text-accent">{order.reference}</span>
          {facturaEmitida && (
            <p className="text-[10px] text-muted mt-0.5">FE {order.siigo_invoice_number}</p>
          )}
        </td>
        <td className="px-4 py-3">
          <p className="text-sm font-medium text-ink truncate max-w-[200px]" title={order.buyer_name}>
            {order.buyer_name}
          </p>
          <p className="text-[11px] text-muted truncate max-w-[200px]" title={order.buyer_email}>
            {order.buyer_email}
          </p>
        </td>
        <td className="px-4 py-3 text-sm text-ink">{order.buyer_city}</td>
        <td className="px-4 py-3 text-sm font-semibold text-ink">{fmtCOP(order.total)}</td>
        <td className="px-4 py-3"><PagoCell order={order} /></td>
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
                {/* Pago */}
                <div>
                  <p className="font-semibold text-muted uppercase tracking-wide mb-2">Pago</p>
                  <dl className="space-y-1">
                    <div className="flex gap-2">
                      <dt className="text-muted w-16 shrink-0">Estado</dt>
                      <dd><StatusBadge status={order.status} /></dd>
                    </div>
                    {(labelMetodoPago(order.payment_method, order.payment_type) || order.payu_ref) && (
                      <div className="flex gap-2">
                        <dt className="text-muted w-16 shrink-0">Método</dt>
                        <dd className="text-ink">
                          {labelMetodoPago(order.payment_method, order.payment_type) || "Mercado Pago"}
                        </dd>
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
                      disabled={busy}
                      className="mt-2 inline-flex items-center gap-2 rounded-lg bg-emerald-500/15 px-3 py-1.5 text-[11px] font-bold text-emerald-400 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                      title="Emitir factura electrónica en Siigo"
                    >
                      {facturando && (
                        <span className="inline-block h-3 w-3 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin" />
                      )}
                      {facturando ? "Facturando…" : "Facturar con Siigo"}
                    </button>
                  ) : anulado ? (
                    <p className="mt-2 text-[11px] text-muted">
                      {reembolsado ? "Pedido reembolsado." : "Pedido anulado."}
                    </p>
                  ) : (
                    <p className="mt-2 text-[11px] text-muted">
                      Disponible cuando el pago esté aprobado.
                    </p>
                  )}
                  {order.siigo_invoice_error && (
                    <p className="mt-2 text-[11px] text-danger">{order.siigo_invoice_error}</p>
                  )}
                </div>

                {reembolsado && parseReciboOrder(order) && (
                  <ReciboReembolsoCard recibo={parseReciboOrder(order)!} compact />
                )}

                {(puedeAnular || puedeReembolsar) && (
                  <div className="space-y-2">
                    <p className="font-semibold text-muted uppercase tracking-wide mb-2">
                      Anular / reembolsar
                    </p>
                    {puedeReembolsar && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const feWarn = facturaEmitida
                            ? " Hay factura Siigo: se creará ticket de nota crédito."
                            : "";
                          const msg = enviado
                            ? `El pedido ${order.reference} ya tiene guía. ¿Reembolsar ${fmtCOP(order.total)} por Mercado Pago de todas formas y cerrar el pedido?${feWarn}`
                            : `¿Devolver ${fmtCOP(order.total)} por Mercado Pago (ref ${order.payu_ref}) y marcar el pedido ${order.reference} como reembolsado?${feWarn}`;
                          if (!window.confirm(msg)) return;
                          onReembolsar(order.reference, enviado);
                        }}
                        disabled={busy}
                        className="inline-flex items-center gap-2 rounded-lg bg-blue-500/15 px-3 py-1.5 text-[11px] font-bold text-blue-300 transition hover:bg-blue-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                        title="Devuelve el dinero vía Mercado Pago usando el payment_id guardado"
                      >
                        {reembolsando && (
                          <span className="inline-block h-3 w-3 rounded-full border-2 border-blue-300 border-t-transparent animate-spin" />
                        )}
                        {reembolsando
                          ? "Reembolsando…"
                          : enviado
                            ? "Reembolsar MP (forzar)"
                            : "Reembolsar por Mercado Pago"}
                      </button>
                    )}
                    {puedeAnular && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const msg = enviado
                            ? `El pedido ${order.reference} ya tiene guía. ¿Anular de todas formas y devolver stock? (no devuelve el dinero)`
                            : `¿Anular el pedido ${order.reference} y devolver el stock? (no devuelve el dinero por la pasarela)`;
                          if (!window.confirm(msg)) return;
                          onAnular(order.reference, enviado);
                        }}
                        disabled={busy}
                        className="inline-flex items-center gap-2 rounded-lg bg-red-500/15 px-3 py-1.5 text-[11px] font-bold text-red-300 transition hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                        title="Anula el pedido y restaura el stock web sin tocar Mercado Pago"
                      >
                        {anulando && (
                          <span className="inline-block h-3 w-3 rounded-full border-2 border-red-300 border-t-transparent animate-spin" />
                        )}
                        {anulando ? "Anulando…" : enviado ? "Anular (forzar)" : "Anular sin reembolso"}
                      </button>
                    )}
                  </div>
                )}
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
  const [search, setSearch] = useState(initialPedidosSearch);
  const [statusFilter, setStatusFilter] = useState("");
  const [shipFilter, setShipFilter] = useState("");
  const [page, setPage] = useState(1);
  const [expandedRef, setExpandedRef] = useState<string | null>(null);
  const [facturarMsg, setFacturarMsg] = useState<{
    type: "ok" | "error";
    text: string;
    recibo?: ReciboReembolso | null;
  } | null>(null);

  const queryParams = new URLSearchParams({
    page: String(page),
  });
  if (search.trim()) queryParams.set("q", search.trim());
  if (statusFilter) queryParams.set("status", statusFilter);
  if (shipFilter) queryParams.set("shipping", shipFilter);

  const { data, isLoading, error, refetch } = useQuery<OrdersResponse>({
    queryKey: ["pedidos-web", search, statusFilter, shipFilter, page],
    queryFn: () => api.get<OrdersResponse>(`/api/pedidos/web?${queryParams}`),
    refetchInterval: 30_000,
  });

  // Si la búsqueda deja un solo pedido, abrirlo para ver detalle al instante.
  useEffect(() => {
    if (!search.trim() || !data?.orders?.length) return;
    if (data.orders.length === 1) {
      setExpandedRef(data.orders[0].reference);
    }
  }, [search, data?.orders]);

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

  const anular = useMutation({
    mutationFn: ({ reference, force }: { reference: string; force: boolean }) =>
      api.post<AnularResponse>(
        "/api/pedidos/web/anular",
        { reference, force },
        { timeoutMs: 60_000 },
      ),
    onMutate: () => setFacturarMsg(null),
    onSuccess: (res) => {
      setFacturarMsg({ type: "ok", text: res.message || "Pedido anulado." });
      qc.invalidateQueries({ queryKey: ["pedidos-web"] });
    },
    onError: (e: Error) => {
      setFacturarMsg({ type: "error", text: e.message || "No se pudo anular el pedido." });
      qc.invalidateQueries({ queryKey: ["pedidos-web"] });
    },
  });

  const reembolsar = useMutation({
    mutationFn: ({ reference, force }: { reference: string; force: boolean }) =>
      api.post<ReembolsarResponse>(
        "/api/pedidos/web/reembolsar",
        { reference, force },
        { timeoutMs: 90_000 },
      ),
    onMutate: () => setFacturarMsg(null),
    onSuccess: (res) => {
      setFacturarMsg({
        type: "ok",
        text: res.message || "Reembolso enviado a Mercado Pago.",
        recibo: res.recibo || null,
      });
      qc.invalidateQueries({ queryKey: ["pedidos-web"] });
    },
    onError: (e: Error) => {
      setFacturarMsg({ type: "error", text: e.message || "No se pudo reembolsar el pedido." });
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
          placeholder="Buscar por nombre, ref, email, teléfono o factura…"
          className="flex-1 min-w-48 rounded-lg border border-border bg-surface-input px-4 py-2 text-sm text-ink outline-none placeholder:text-muted/50 focus:border-accent"
        />
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent"
        >
          <option value="">Todos los pagos</option>
          <option value="pending">Pendiente</option>
          <option value="approved">Aprobado</option>
          <option value="cancelled">Anulado</option>
          <option value="declined">Rechazado</option>
          <option value="no_realizado">No realizado</option>
          <option value="refunded">Reembolsado</option>
          <option value="unknown">Por verificar</option>
        </select>
        <select
          value={shipFilter}
          onChange={(e) => { setShipFilter(e.target.value); setPage(1); }}
          className="rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-ink outline-none focus:border-accent"
        >
          <option value="">Todo envío</option>
          <option value="preparing">Preparando</option>
          <option value="shipped">Enviado</option>
          <option value="delivered">Entregado</option>
        </select>
      </form>

      {facturarMsg && (
        <div
          className={`rounded-lg border px-4 py-3 text-xs ${
            facturarMsg.type === "ok"
              ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
              : "border-red-500/25 bg-red-500/10 text-red-300"
          }`}
        >
          <p>{facturarMsg.text}</p>
          {facturarMsg.recibo && <ReciboReembolsoCard recibo={facturarMsg.recibo} />}
        </div>
      )}

      {/* Table — overflow-auto + sticky th para encabezado fijo al scroll */}
      <div className="rounded-xl border border-border bg-surface-panel overflow-auto max-h-[min(70vh,800px)]">
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
            No hay pedidos{search || statusFilter || shipFilter ? " con los filtros aplicados" : " todavía"}.
          </div>
        ) : (
          <table className="w-full min-w-[720px] text-left">
            <thead className="sticky top-0 z-10 border-b border-border bg-surface-panel shadow-[0_1px_0_0_var(--color-border,rgba(0,0,0,0.08))] [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-surface-panel">
              <tr>
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
                  anulando={anular.isPending && anular.variables?.reference === order.reference}
                  reembolsando={
                    reembolsar.isPending && reembolsar.variables?.reference === order.reference
                  }
                  onFacturar={(reference) => facturar.mutate(reference)}
                  onAnular={(reference, force) => anular.mutate({ reference, force })}
                  onReembolsar={(reference, force) => reembolsar.mutate({ reference, force })}
                  onExpand={() =>
                    setExpandedRef((prev) =>
                      prev === order.reference ? null : order.reference,
                    )
                  }
                />
              ))}
            </tbody>
          </table>
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
