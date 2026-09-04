import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

interface NotaCredito {
  id: string | number;
  numero: string | null;
  fecha: string | null;
  total: number | null;
  tipo: string | null;
  cufe: string;
  legal_status: string | null;
  url: string;
}

interface ItemLinea {
  sku: string;
  nombre: string | null;
  cantidad: number | null;
  total?: number | null;
  precio_unitario?: number | null;
}

interface FacturaAlegra {
  factura_id: string;
  numero: string | null;
  fecha: string | null;
  estado: string | null;
  total: number | null;
  cufe: string;
  url: string;
  notas_credito: NotaCredito[];
  items: ItemLinea[];
}

interface FacturaLegado {
  factura_id: string | number;
  factura_numero: string | null;
  factura_fecha: string | null;
  total: number | null;
  integracion: string | null;
}

interface VentaOriginal {
  total_pagado: number;
  items: ItemLinea[];
}

interface VentaTrazabilidad {
  order_id: string;
  es_meli: boolean;
  facturas: FacturaAlegra[];
  factura_legado: FacturaLegado | null;
  posible_duplicado: boolean;
  venta_original: VentaOriginal | null;
}

function pesos(v: number | null | undefined) {
  if (v == null) return "—";
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(v);
}

function EstadoBadge({ estado }: { estado: string | null }) {
  const cerrado = estado === "closed";
  return (
    <span
      className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
        cerrado
          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
          : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
      }`}
    >
      {cerrado ? "Pagada" : estado ?? "—"}
    </span>
  );
}

/** Nombre legible de la integración legada (previa a Alegra) que emitió una factura. */
function nombreIntegracionLegado(integracion: string | null) {
  if (integracion === "astroselling") return "Astroselling (Siigo)";
  if (integracion === "mckenna") return "Siigo (McKenna)";
  return integracion ?? "Alegra";
}

/** Tabla compacta de líneas SKU/producto/cantidad/valor, reusada en ambas columnas. */
function TablaItems({ items, columnaValor }: { items: ItemLinea[]; columnaValor: "total" | "precio_unitario" }) {
  if (items.length === 0) {
    return <p className="px-3 py-2 text-xs text-muted">Sin ítems.</p>;
  }
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-[10px] uppercase tracking-wide text-muted">
          <th className="px-3 py-1 font-semibold">SKU</th>
          <th className="px-1 py-1 font-semibold">Producto</th>
          <th className="px-1 py-1 text-right font-semibold">Cant</th>
          <th className="px-3 py-1 text-right font-semibold">Valor</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border/40">
        {items.map((it, idx) => {
          const valor = columnaValor === "total" ? it.total : it.precio_unitario;
          return (
            <tr key={idx}>
              <td className="px-3 py-1 font-mono text-[11px] text-ink">{it.sku || "—"}</td>
              <td className="px-1 py-1 text-ink-secondary">{it.nombre ?? "—"}</td>
              <td className="px-1 py-1 text-right text-ink-secondary">{it.cantidad ?? "—"}</td>
              <td className="px-3 py-1 text-right font-semibold text-ink">{pesos(valor)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function AstroKillerPanel() {
  const [busqueda, setBusqueda] = useState("");
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["alegra-trazabilidad-meli"],
    queryFn: () => api.get<{ ventas: VentaTrazabilidad[]; total: number }>("/api/alegra/trazabilidad-meli"),
    staleTime: 60_000,
  });

  const ventas = data?.ventas ?? [];
  const filtradas = busqueda.trim()
    ? ventas.filter((v) => v.order_id.includes(busqueda.trim()))
    : ventas;

  const totalDuplicados = ventas.filter((v) => v.posible_duplicado).length;

  return (
    <div className="mx-auto max-w-6xl space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-ink">Astro Killer — Trazabilidad MeLi → Alegra</h2>
          <p className="text-xs text-muted">
            Cada venta MeLi/web comparada lado a lado: lo que se vendió contra lo que se facturó
            en Alegra, con sus notas crédito — para corroborar de un vistazo que coincide.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {totalDuplicados > 0 && (
            <span className="rounded-full bg-red-100 px-2.5 py-1 text-[11px] font-bold uppercase text-red-700 dark:bg-red-900/30 dark:text-red-400">
              ⚠️ {totalDuplicados} posible{totalDuplicados !== 1 ? "s" : ""} factura doble
            </span>
          )}
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="rounded-paper border-2 border-border px-4 py-2 text-sm font-semibold text-ink transition hover:border-accent hover:text-accent disabled:opacity-40"
          >
            {isFetching ? "Actualizando…" : "Actualizar"}
          </button>
        </div>
      </div>

      <input
        type="text"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="Buscar por ID de orden MeLi o referencia de pedido web…"
        className="w-full rounded-paper border-2 border-border bg-surface px-4 py-2 text-sm text-ink outline-none focus:border-accent"
      />

      {isLoading && (
        <p className="text-sm text-muted">
          Consultando Alegra y MeLi… la primera carga puede tardar un momento (cruza cada venta con
          su detalle real en MeLi).
        </p>
      )}

      {error && (
        <div className="rounded-xl border border-red-300/50 bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {(error as Error).message || "No se pudo cargar la trazabilidad"}
        </div>
      )}

      {!isLoading && !error && filtradas.length === 0 && (
        <p className="text-sm text-muted">
          {busqueda ? "Sin resultados para esa búsqueda." : "Todavía no hay ventas facturadas por Alegra."}
        </p>
      )}

      <div className="space-y-3">
        {filtradas.map((venta) => {
          const facturasVigentes = venta.facturas.filter((f) => f.notas_credito.length === 0);
          const totalFacturado = facturasVigentes.reduce((s, f) => s + (f.total ?? 0), 0);
          const totalPagado = venta.venta_original?.total_pagado ?? null;
          const hayFacturaVigente = facturasVigentes.length > 0;
          const coincide = totalPagado != null && hayFacturaVigente && Math.abs(totalPagado - totalFacturado) < 1;

          return (
            <div
              key={venta.order_id}
              className={`overflow-hidden rounded-xl border bg-surface-panel ${
                venta.posible_duplicado ? "border-red-300 dark:border-red-800" : "border-border"
              }`}
            >
              {/* Encabezado: # de venta siempre visible, sin necesidad de desplegar nada */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-hover px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                      venta.es_meli
                        ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
                        : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                    }`}
                  >
                    {venta.es_meli ? "MeLi" : "Web"}
                  </span>
                  <span className="font-mono text-sm font-semibold text-ink">{venta.order_id}</span>
                  {venta.posible_duplicado && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase text-red-700 dark:bg-red-900/30 dark:text-red-400">
                      ⚠️ Posible doble
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {hayFacturaVigente ? (
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-bold ${
                        coincide
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                      }`}
                    >
                      {coincide ? "✅ Coincide" : "⚠️ No coincide"}
                    </span>
                  ) : (
                    <span className="rounded-full bg-surface px-2 py-0.5 font-bold text-muted">Sin factura vigente</span>
                  )}
                  <span className="font-semibold text-ink">{pesos(totalPagado ?? totalFacturado)}</span>
                </div>
              </div>

              {venta.factura_legado && (
                <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
                  <span className="font-semibold">
                    ⚠️ También tiene factura de {nombreIntegracionLegado(venta.factura_legado.integracion)}:
                  </span>{" "}
                  <span className="font-mono font-semibold">
                    {venta.factura_legado.factura_numero ?? venta.factura_legado.factura_id}
                  </span>{" "}
                  · {venta.factura_legado.factura_fecha ?? "—"} · {pesos(venta.factura_legado.total)}
                </div>
              )}

              {/* Comparativo lateral: vendido (izquierda) vs facturado (derecha) */}
              <div className="grid grid-cols-1 divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0">
                <div className="min-w-0">
                  <p className="border-b border-border/60 bg-surface px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">
                    Vendido en {venta.es_meli ? "MeLi" : "la web"}
                  </p>
                  {venta.venta_original ? (
                    <div className="overflow-x-auto">
                      <TablaItems items={venta.venta_original.items} columnaValor="precio_unitario" />
                    </div>
                  ) : (
                    <p className="px-3 py-2 text-xs text-muted">No se pudo consultar el detalle de la venta.</p>
                  )}
                </div>

                <div className="min-w-0">
                  <p className="border-b border-border/60 bg-surface px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">
                    Facturado en Alegra
                  </p>
                  <div className="divide-y divide-border/60">
                    {venta.facturas.map((f) => (
                      <div key={f.factura_id} className="px-3 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <a
                              href={f.url}
                              target="_blank"
                              rel="noreferrer"
                              className="font-semibold text-accent hover:underline"
                            >
                              {f.numero ?? f.factura_id}
                            </a>
                            <EstadoBadge estado={f.estado} />
                          </div>
                          <span className="text-xs text-muted">{f.fecha ?? "—"}</span>
                        </div>
                        <div className="overflow-x-auto">
                          <TablaItems items={f.items} columnaValor="total" />
                        </div>
                        {f.cufe && (
                          <p className="mt-1 truncate font-mono text-[10px] text-muted" title={f.cufe}>
                            CUFE: {f.cufe}
                          </p>
                        )}
                        {f.notas_credito.length > 0 && (
                          <div className="mt-2 space-y-1.5 border-l-2 border-red-300 pl-3 dark:border-red-800">
                            {f.notas_credito.map((nc) => (
                              <div key={nc.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                <div className="flex items-center gap-2">
                                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase text-red-700 dark:bg-red-900/30 dark:text-red-400">
                                    Nota crédito
                                  </span>
                                  <a href={nc.url} target="_blank" rel="noreferrer" className="font-semibold text-accent hover:underline">
                                    {nc.numero ?? nc.id}
                                  </a>
                                  <span className="text-muted">{nc.fecha ?? "—"}</span>
                                </div>
                                <span className="font-semibold text-ink">{pesos(nc.total)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted">
        Fuente: Alegra (facturas + notas crédito) cruzado con el detalle real de cada venta en MeLi/web · {data?.total ?? 0} venta
        {(data?.total ?? 0) !== 1 ? "s" : ""}
      </p>
    </div>
  );
}
