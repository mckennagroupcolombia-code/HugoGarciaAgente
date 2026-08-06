import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

type Movimiento = {
  fecha: string;
  tipo: "ingreso" | "egreso";
  fuente: string;
  concepto: string;
  monto: number;
  referencia: string;
  contraparte: string;
  extra?: Record<string, unknown>;
};

type Libro = {
  desde: string;
  hasta: string;
  movimientos: Movimiento[];
  totales: { ingresos: number; egresos: number; neto: number; cantidad: number };
  por_fuente?: Record<string, { ingreso: number; egreso: number }>;
  avisos?: string[];
  error?: string;
};

/** Agrupa por fecha + fuente + tipo + concepto (mismo concepto → una casilla con sumatoria). */
const FUENTE_LABEL: Record<string, string> = {
  siigo_venta: "Venta Siigo",
  meli_venta: "Venta MeLi",
  meli_cobro: "Cobro MeLi",
  web_venta: "Venta página web",
  compra_gmail: "Pago factura compra",
  compra_exterior: "Compra exterior",
  cuenta_cobro_correo: "Cuenta de cobro (correo)",
  operativos_impuestos: "Impuestos",
  operativos_servicios: "Servicios (operativos)",
};

type RowView =
  | { kind: "single"; m: Movimiento; key: string }
  | {
      kind: "group";
      key: string;
      fecha: string;
      tipo: "ingreso" | "egreso";
      fuente: string;
      concepto: string;
      monto: number;
      count: number;
      detalle: Movimiento[];
    };

function groupLabel(row: Extract<RowView, { kind: "group" }>): string {
  return `${row.concepto} · ${row.count} del día`;
}

function groupContraparte(detalle: Movimiento[]): string {
  const vals = [...new Set(detalle.map((m) => (m.contraparte || "").trim()).filter(Boolean))];
  if (vals.length === 0) return "—";
  if (vals.length === 1) return vals[0];
  return `Varios (${vals.length})`;
}

function detalleConcepto(m: Movimiento): string {
  const ref = (m.referencia || "").trim();
  const oid = typeof m.extra?.order_id === "string" ? m.extra.order_id : "";
  if (m.fuente === "siigo_venta" && ref) return `Factura ${ref}`;
  if (m.fuente === "compra_gmail" && ref) return `Factura ${ref}`;
  if (m.fuente === "web_venta" && ref) return `Pedido ${ref}`;
  if (m.fuente === "meli_venta") return oid ? `Orden #${oid}` : ref ? `Pack ${ref}` : m.concepto;
  if (m.fuente === "meli_cobro") return oid ? `Comisión orden #${oid}` : ref ? `Pack ${ref}` : m.concepto;
  if (m.fuente === "compra_exterior" && ref) return `Compra #${ref}`;
  if (ref && ref !== m.concepto) return `${m.concepto} · ${ref}`;
  return m.concepto;
}

function haceNDias(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function formatCop(n: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n || 0);
}

/**
 * Misma regla para todas las fuentes: si comparten concepto en la misma fecha,
 * una casilla con sumatoria; clic despliega el detalle del día.
 */
function agruparParaVista(rows: Movimiento[]): RowView[] {
  const buckets = new Map<string, Movimiento[]>();

  for (const m of rows) {
    const k = `${m.fecha}|${m.fuente}|${m.tipo}|${m.concepto}`;
    const list = buckets.get(k) ?? [];
    list.push(m);
    buckets.set(k, list);
  }

  const views: RowView[] = [];
  for (const [key, detalle] of buckets) {
    if (detalle.length === 1) {
      views.push({ kind: "single", m: detalle[0], key: `s-${key}` });
      continue;
    }
    const first = detalle[0];
    const ordenado = [...detalle].sort((a, b) =>
      (a.referencia || "").localeCompare(b.referencia || ""),
    );
    views.push({
      kind: "group",
      key: `g-${key}`,
      fecha: first.fecha,
      tipo: first.tipo,
      fuente: first.fuente,
      concepto: first.concepto,
      monto: detalle.reduce((a, m) => a + m.monto, 0),
      count: detalle.length,
      detalle: ordenado,
    });
  }

  views.sort((a, b) => {
    const fa = a.kind === "group" ? a.fecha : a.m.fecha;
    const fb = b.kind === "group" ? b.fecha : b.m.fecha;
    if (fa !== fb) return fb.localeCompare(fa);
    const ta = a.kind === "group" ? a.tipo : a.m.tipo;
    const tb = b.kind === "group" ? b.tipo : b.m.tipo;
    if (ta !== tb) return ta.localeCompare(tb);
    const sa = a.kind === "group" ? a.fuente : a.m.fuente;
    const sb = b.kind === "group" ? b.fuente : b.m.fuente;
    if (sa !== sb) return sa.localeCompare(sb);
    const ca = a.kind === "group" ? a.concepto : a.m.concepto;
    const cb = b.kind === "group" ? b.concepto : b.m.concepto;
    return ca.localeCompare(cb);
  });
  return views;
}

/**
 * Tabla contable de ingresos y egresos con fecha.
 */
export default function IngresosEgresosPanel() {
  const [desde, setDesde] = useState(() => haceNDias(30));
  const [hasta, setHasta] = useState(() => new Date().toISOString().slice(0, 10));
  const [filtroTipo, setFiltroTipo] = useState<"todos" | "ingreso" | "egreso">("todos");
  const [filtroFuente, setFiltroFuente] = useState<string>("todas");
  const [q, setQ] = useState("");
  const [incluirMeli, setIncluirMeli] = useState(true);
  const [incluirSiigo, setIncluirSiigo] = useState(true);
  const [syncCobroMsg, setSyncCobroMsg] = useState<string | null>(null);
  const [syncCobroBusy, setSyncCobroBusy] = useState(false);
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({});

  const queryKey = ["ingresos-egresos", desde, hasta, incluirMeli, incluirSiigo] as const;

  const libroQ = useQuery<Libro>({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams({
        desde,
        hasta,
        meli: incluirMeli ? "1" : "0",
        siigo: incluirSiigo ? "1" : "0",
      });
      return api.get(`/api/contabilidad/ingresos-egresos?${params}`, { timeoutMs: 60_000 });
    },
    retry: 1,
  });

  const movimientos = useMemo(() => {
    let rows = libroQ.data?.movimientos ?? [];
    if (filtroTipo !== "todos") rows = rows.filter((r) => r.tipo === filtroTipo);
    if (filtroFuente !== "todas") rows = rows.filter((r) => r.fuente === filtroFuente);
    const qq = q.trim().toLowerCase();
    if (qq) {
      rows = rows.filter(
        (r) =>
          r.concepto.toLowerCase().includes(qq) ||
          r.contraparte.toLowerCase().includes(qq) ||
          r.referencia.toLowerCase().includes(qq),
      );
    }
    return rows;
  }, [libroQ.data, filtroTipo, filtroFuente, q]);

  const filas = useMemo(() => agruparParaVista(movimientos), [movimientos]);

  const fuentes = useMemo(() => {
    const set = new Set((libroQ.data?.movimientos ?? []).map((m) => m.fuente));
    return Array.from(set).sort();
  }, [libroQ.data]);

  const totFiltrado = useMemo(() => {
    const ing = movimientos.filter((m) => m.tipo === "ingreso").reduce((a, m) => a + m.monto, 0);
    const egr = movimientos.filter((m) => m.tipo === "egreso").reduce((a, m) => a + m.monto, 0);
    return { ing, egr, neto: ing - egr };
  }, [movimientos]);

  const totales = libroQ.data?.totales;

  const toggle = (key: string) => {
    setAbiertos((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="rounded-xl border border-border bg-surface-panel p-4 space-y-3">
        <div>
          <h2 className="text-base font-bold text-ink">Tabla de contabilidad</h2>
          <p className="text-xs text-muted">
            Ingresos y egresos por fecha: ventas Siigo / MeLi / web, pagos de facturas de compra,
            compras exterior, operativos (impuestos y servicios) y cuentas de cobro. Mismo
            concepto el mismo día → una casilla con sumatoria (clic para el detalle).
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-xs font-semibold text-ink-secondary">
            Desde
            <input
              type="date"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              className="block rounded-lg border-2 border-border bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
            />
          </label>
          <label className="space-y-1 text-xs font-semibold text-ink-secondary">
            Hasta
            <input
              type="date"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
              className="block rounded-lg border-2 border-border bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
            />
          </label>
          <div className="flex flex-wrap gap-1">
            {[
              { label: "7 días", n: 7 },
              { label: "30 días", n: 30 },
              { label: "90 días", n: 90 },
            ].map(({ label, n }) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  setDesde(haceNDias(n));
                  setHasta(new Date().toISOString().slice(0, 10));
                }}
                className="rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold text-ink hover:border-accent hover:text-accent"
              >
                {label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-xs font-medium text-ink">
            <input type="checkbox" checked={incluirSiigo} onChange={(e) => setIncluirSiigo(e.target.checked)} />
            Siigo
          </label>
          <label className="flex items-center gap-1.5 text-xs font-medium text-ink">
            <input type="checkbox" checked={incluirMeli} onChange={(e) => setIncluirMeli(e.target.checked)} />
            MeLi
          </label>
          <button
            type="button"
            onClick={() => void libroQ.refetch()}
            disabled={libroQ.isFetching}
            className="rounded-lg border-2 border-accent bg-accent px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
          >
            {libroQ.isFetching ? "Cargando…" : "Actualizar"}
          </button>
          <button
            type="button"
            disabled={syncCobroBusy}
            onClick={() => {
              void (async () => {
                setSyncCobroBusy(true);
                setSyncCobroMsg(null);
                try {
                  const r = await api.post<{
                    ok?: boolean;
                    cobros?: number;
                    correos_revisados?: number;
                    william?: number;
                    fidel_rocha?: number;
                    error?: string;
                  }>("/api/contabilidad/cuentas-cobro/sincronizar", {});
                  if (r.error) throw new Error(r.error);
                  setSyncCobroMsg(
                    `Correo: ${r.cobros ?? 0} cobros (William ${r.william ?? "—"} · Fidel/NEXT ${r.fidel_rocha ?? "—"})`,
                  );
                  await libroQ.refetch();
                } catch (e) {
                  setSyncCobroMsg((e as Error).message || "Error al leer correo");
                } finally {
                  setSyncCobroBusy(false);
                }
              })();
            }}
            className="rounded-lg border-2 border-border px-3 py-1.5 text-xs font-bold text-ink hover:border-accent hover:text-accent disabled:opacity-50"
          >
            {syncCobroBusy ? "Leyendo correo…" : "Revisar cuentas de cobro (correo)"}
          </button>
        </div>
        {syncCobroMsg && <p className="text-xs text-muted">{syncCobroMsg}</p>}

        {totales && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg border border-border bg-surface px-3 py-2">
              <div className="text-[10px] font-bold uppercase text-muted">Ingresos</div>
              <div className="text-sm font-bold text-emerald-600">{formatCop(totales.ingresos)}</div>
            </div>
            <div className="rounded-lg border border-border bg-surface px-3 py-2">
              <div className="text-[10px] font-bold uppercase text-muted">Egresos</div>
              <div className="text-sm font-bold text-rose-600">{formatCop(totales.egresos)}</div>
            </div>
            <div className="rounded-lg border border-border bg-surface px-3 py-2">
              <div className="text-[10px] font-bold uppercase text-muted">Neto</div>
              <div className={`text-sm font-bold ${totales.neto >= 0 ? "text-ink" : "text-rose-600"}`}>
                {formatCop(totales.neto)}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-surface px-3 py-2">
              <div className="text-[10px] font-bold uppercase text-muted">Movimientos</div>
              <div className="text-sm font-bold text-ink">{totales.cantidad}</div>
            </div>
          </div>
        )}

        {(libroQ.data?.avisos?.length ?? 0) > 0 && (
          <ul className="text-xs text-amber-700 dark:text-amber-400 list-disc pl-4">
            {libroQ.data!.avisos!.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        )}
        {libroQ.isError && (
          <p className="text-sm text-rose-600">{(libroQ.error as Error)?.message || "Error al cargar"}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filtroTipo}
          onChange={(e) => setFiltroTipo(e.target.value as "todos" | "ingreso" | "egreso")}
          className="rounded-lg border-2 border-border bg-surface px-2 py-1.5 text-xs font-semibold text-ink"
        >
          <option value="todos">Todos</option>
          <option value="ingreso">Solo ingresos</option>
          <option value="egreso">Solo egresos</option>
        </select>
        <select
          value={filtroFuente}
          onChange={(e) => setFiltroFuente(e.target.value)}
          className="rounded-lg border-2 border-border bg-surface px-2 py-1.5 text-xs font-semibold text-ink"
        >
          <option value="todas">Todas las fuentes</option>
          <option value="operativos_impuestos">Impuestos</option>
          <option value="operativos_servicios">Servicios (operativos)</option>
          <option value="compra_gmail">Pago factura compra</option>
          <option value="compra_exterior">Compra exterior</option>
          <option value="meli_venta">Venta MeLi</option>
          <option value="meli_cobro">Cobro MeLi</option>
          {fuentes
            .filter(
              (f) =>
                ![
                  "operativos_impuestos",
                  "operativos_servicios",
                  "compra_gmail",
                  "compra_exterior",
                  "meli_venta",
                  "meli_cobro",
                ].includes(f),
            )
            .map((f) => (
              <option key={f} value={f}>
                {FUENTE_LABEL[f] || f}
              </option>
            ))}
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar concepto, proveedor, ref…"
          className="min-w-[12rem] flex-1 rounded-lg border-2 border-border bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
        />
        {(filtroTipo !== "todos" || filtroFuente !== "todas" || q) && (
          <span className="text-[11px] text-muted">
            Vista: {formatCop(totFiltrado.ing)} / {formatCop(totFiltrado.egr)} · neto{" "}
            {formatCop(totFiltrado.neto)} · {filas.length} filas
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border bg-surface-panel">
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <thead className="sticky top-0 bg-surface-panel text-[11px] uppercase tracking-wide text-muted">
            <tr className="border-b border-border">
              <th className="px-3 py-2 font-bold">Fecha</th>
              <th className="px-3 py-2 font-bold">Tipo</th>
              <th className="px-3 py-2 font-bold">Fuente</th>
              <th className="px-3 py-2 font-bold">Concepto</th>
              <th className="px-3 py-2 font-bold">Contraparte</th>
              <th className="px-3 py-2 font-bold">Ref.</th>
              <th className="px-3 py-2 font-bold text-right">Monto</th>
            </tr>
          </thead>
          <tbody>
            {libroQ.isLoading && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted">
                  Cargando movimientos (Siigo/MeLi ~30s)…
                </td>
              </tr>
            )}
            {libroQ.isError && !libroQ.isLoading && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-rose-600">
                  {(libroQ.error as Error)?.message || "Error al cargar el libro"}
                </td>
              </tr>
            )}
            {!libroQ.isLoading && !libroQ.isError && filas.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted">
                  No hay movimientos en este rango.
                </td>
              </tr>
            )}
            {filas.map((row) => {
              if (row.kind === "single") {
                const m = row.m;
                return (
                  <tr
                    key={row.key}
                    className="border-b border-border/60 hover:bg-surface-hover/50"
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-xs font-medium text-ink">{m.fecha}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                          m.tipo === "ingreso"
                            ? "bg-emerald-500/15 text-emerald-700"
                            : "bg-rose-500/15 text-rose-700"
                        }`}
                      >
                        {m.tipo}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted">{FUENTE_LABEL[m.fuente] || m.fuente}</td>
                    <td className="max-w-[280px] truncate px-3 py-2 text-xs text-ink" title={detalleConcepto(m)}>
                      {detalleConcepto(m)}
                    </td>
                    <td className="max-w-[140px] truncate px-3 py-2 text-xs text-muted" title={m.contraparte}>
                      {m.contraparte || "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted">{m.referencia || "—"}</td>
                    <td
                      className={`whitespace-nowrap px-3 py-2 text-right text-xs font-bold ${
                        m.tipo === "ingreso" ? "text-emerald-700" : "text-rose-700"
                      }`}
                    >
                      {m.tipo === "egreso" ? "−" : ""}
                      {formatCop(m.monto)}
                    </td>
                  </tr>
                );
              }

              const open = !!abiertos[row.key];
              const label = groupLabel(row);
              return (
                <Fragment key={row.key}>
                  <tr
                    className="border-b border-border/60 bg-accent/5 hover:bg-accent/10 cursor-pointer"
                    onClick={() => toggle(row.key)}
                    title="Clic para ver / ocultar detalle del día"
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-xs font-medium text-ink">
                      <span className="mr-1.5 inline-block w-3 text-accent" aria-hidden>
                        {open ? "▾" : "▸"}
                      </span>
                      {row.fecha}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                          row.tipo === "ingreso"
                            ? "bg-emerald-500/15 text-emerald-700"
                            : "bg-rose-500/15 text-rose-700"
                        }`}
                      >
                        {row.tipo}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted">{FUENTE_LABEL[row.fuente] || row.fuente}</td>
                    <td className="px-3 py-2 text-xs font-semibold text-ink">{label}</td>
                    <td className="px-3 py-2 text-xs text-muted">{groupContraparte(row.detalle)}</td>
                    <td className="px-3 py-2 text-xs text-muted">{row.count} ítems</td>
                    <td
                      className={`whitespace-nowrap px-3 py-2 text-right text-xs font-bold ${
                        row.tipo === "ingreso" ? "text-emerald-700" : "text-rose-700"
                      }`}
                    >
                      {row.tipo === "egreso" ? "−" : ""}
                      {formatCop(row.monto)}
                    </td>
                  </tr>
                  {open &&
                    row.detalle.map((m, i) => (
                      <tr
                        key={`${row.key}-d-${i}`}
                        className="border-b border-border/40 bg-surface/80"
                      >
                        <td className="whitespace-nowrap px-3 py-1.5 pl-8 text-[11px] text-muted">
                          {m.fecha}
                        </td>
                        <td className="px-3 py-1.5 text-[11px] text-muted">{m.tipo}</td>
                        <td className="px-3 py-1.5 text-[11px] text-muted">detalle</td>
                        <td
                          className="max-w-[280px] truncate px-3 py-1.5 text-[11px] text-ink"
                          title={detalleConcepto(m)}
                        >
                          {detalleConcepto(m)}
                        </td>
                        <td className="max-w-[140px] truncate px-3 py-1.5 text-[11px] text-muted" title={m.contraparte}>
                          {m.contraparte || "—"}
                        </td>
                        <td className="px-3 py-1.5 text-[11px] text-muted">{m.referencia || "—"}</td>
                        <td
                          className={`whitespace-nowrap px-3 py-1.5 text-right text-[11px] font-semibold ${
                            m.tipo === "ingreso" ? "text-emerald-700" : "text-rose-700"
                          }`}
                        >
                          {m.tipo === "egreso" ? "−" : ""}
                          {formatCop(m.monto)}
                        </td>
                      </tr>
                    ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
