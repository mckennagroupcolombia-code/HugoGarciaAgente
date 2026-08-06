import { useMemo, useState } from "react";
import { api } from "../api/client";
import { usePanelTheme } from "../stores/panelTheme";
import { datos_emisor_label } from "./cuentaCobroLabels";

export type CuentaCobroTipo = "mercancia" | "flete";

export type LineaCuentaCobro = {
  nombre: string;
  nombre_ocr?: string;
  codigo?: string | null;
  cantidad?: number;
  unidad?: string;
  precio_unit?: number;
  subtotal?: number;
  descuento?: number;
};

export type CuentaCobroDatos = {
  id: number;
  proveedor?: string;
  fecha_compra?: string;
  moneda?: string;
  moneda_flete?: string;
  trm?: number;
  flete?: number;
  valor_compra_cop?: number;
  cuota_manejo_cop?: number;
  total_cobro_cop?: number;
  flete_cobro_cop?: number;
  cuota_pct?: number;
  lineas?: LineaCuentaCobro[];
  cuenta_cobro_estado?: string;
  tiene_cuenta_cobro?: boolean;
  cuenta_cobro_pendiente?: boolean;
  cuenta_flete_estado?: string;
  tiene_cuenta_flete?: boolean;
  cuenta_flete_pendiente?: boolean;
};

function fmtCop(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(v);
}

function productosConValorCop(
  lineas: LineaCuentaCobro[] | undefined,
  moneda: string | undefined,
  trm: number | undefined,
): Array<{ etiqueta: string; valorCop: number }> {
  const mon = (moneda || "USD").toUpperCase();
  const tasa = mon === "COP" ? 1 : Math.max(Number(trm) || 0, 0);
  if (tasa <= 0) return [];
  const out: Array<{ etiqueta: string; valorCop: number }> = [];
  for (const ln of lineas || []) {
    const nombre = (ln.nombre || ln.nombre_ocr || "").trim();
    if (!nombre) continue;
    let s = Number(ln.subtotal) || 0;
    if (s <= 0) s = (Number(ln.cantidad) || 0) * (Number(ln.precio_unit) || 0);
    const neto = Math.max(s - Math.max(Number(ln.descuento) || 0, 0), 0);
    if (neto <= 0) continue;
    const bits = [nombre];
    const cant = Number(ln.cantidad);
    if (Number.isFinite(cant) && cant > 0) {
      const u = (ln.unidad || "").trim();
      bits.push(u ? `${cant} ${u}` : String(cant));
    }
    if (ln.codigo) bits.push(`Ref. ${ln.codigo}`);
    out.push({ etiqueta: bits.join(" · "), valorCop: Math.round(neto * tasa * 100) / 100 });
  }
  return out;
}

type Props = {
  compra: CuentaCobroDatos;
  tipo?: CuentaCobroTipo;
  onAprobada?: (historial: CuentaCobroDatos) => void;
  onDescargar?: () => void;
  compact?: boolean;
};

/**
 * Formato en pantalla de cuenta de cobro para aprobar.
 * Concepto / liquidación por producto adquirido + cuota 5% (o flete aparte).
 */
export default function CuentaCobroAprobacion({
  compra,
  tipo = "mercancia",
  onAprobada,
  onDescargar,
  compact,
}: Props) {
  const accentRgb = usePanelTheme((s) => s.accentRgb);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const esFlete = tipo === "flete";
  const pct = compra.cuota_pct ?? 5;
  const valor = compra.valor_compra_cop ?? 0;
  const cuota = compra.cuota_manejo_cop ?? 0;
  const fleteCop = compra.flete_cobro_cop ?? 0;
  const total = esFlete ? fleteCop : (compra.total_cobro_cop ?? valor + cuota);

  const productos = useMemo(
    () => productosConValorCop(compra.lineas, compra.moneda, compra.trm),
    [compra.lineas, compra.moneda, compra.trm],
  );

  const pendiente = esFlete
    ? compra.cuenta_flete_pendiente ||
      compra.cuenta_flete_estado === "pendiente" ||
      (!compra.tiene_cuenta_flete && fleteCop > 0)
    : compra.cuenta_cobro_pendiente ||
      compra.cuenta_cobro_estado === "pendiente" ||
      (!compra.tiene_cuenta_cobro && total > 0);

  const aprobada = esFlete
    ? compra.tiene_cuenta_flete || compra.cuenta_flete_estado === "aprobada"
    : compra.tiene_cuenta_cobro || compra.cuenta_cobro_estado === "aprobada";

  const numero = esFlete
    ? `CC-CE-${String(compra.id).padStart(5, "0")}-FLETE`
    : `CC-CE-${String(compra.id).padStart(5, "0")}`;

  const aprobar = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await api.post<{ ok: boolean; historial: CuentaCobroDatos }>(
        `/api/rentabilidad/compras-exterior/${compra.id}/cuenta-cobro`,
        { accent_rgb: accentRgb, tipo },
      );
      onAprobada?.(res.historial);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article
      className={`overflow-hidden rounded-paper border border-border bg-surface-panel shadow-paper-sm ${
        compact ? "" : "max-w-xl"
      }`}
    >
      <header className="border-b-2 border-accent px-4 py-3 text-center">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
          McKenna Group · Compras exterior
        </p>
        <h3 className="text-base font-extrabold tracking-wide text-accent">
          {esFlete ? "Cuenta de cobro · Flete" : "Cuenta de cobro · Productos"}
        </h3>
        <p className="mt-0.5 font-mono text-[11px] text-ink-secondary">
          <span className="text-accent font-semibold">{numero}</span>
          {compra.fecha_compra ? ` · ${compra.fecha_compra}` : ""}
        </p>
      </header>

      <div className="space-y-3 px-4 py-3 text-sm text-ink">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-border px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-accent">Emisor</p>
            <p className="font-semibold">{datos_emisor_label()}</p>
          </div>
          <div className="rounded-lg border border-border px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-accent">Dirigida a</p>
            <p className="font-semibold">McKenna Group S.A.S.</p>
            <p className="text-[11px] text-muted">NIT 901.952.087-1</p>
          </div>
        </div>

        {esFlete ? (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-accent">Concepto</p>
            <p className="text-[12px] leading-relaxed text-ink-secondary">
              Reembolso del flete / envío
              {compra.proveedor ? (
                <>
                  {" "}
                  (<span className="font-medium text-ink">{compra.proveedor}</span>)
                </>
              ) : null}
              {compra.flete
                ? ` · ${compra.flete} ${compra.moneda_flete || compra.moneda || ""}`
                : ""}
              {compra.trm && (compra.moneda_flete || compra.moneda || "").toUpperCase() !== "COP"
                ? ` · TRM ${compra.trm}`
                : ""}
              . Cuenta aparte de los productos.
            </p>
          </div>
        ) : (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-accent">Concepto</p>
            <p className="text-[12px] leading-relaxed text-ink-secondary">
              {productos.length > 0 ? (
                <>
                  Adquisición de:{" "}
                  <span className="font-medium text-ink">
                    {productos.map((p) => p.etiqueta).join("; ")}
                  </span>
                  . Incluye cuota de manejo del{" "}
                  <span className="font-semibold text-accent">{pct}%</span> sobre el valor de los
                  productos
                  {compra.proveedor ? ` · ${compra.proveedor}` : ""}
                  {compra.moneda ? ` · ${compra.moneda}` : ""}
                  {compra.trm && compra.moneda && compra.moneda.toUpperCase() !== "COP"
                    ? ` · TRM ${compra.trm}`
                    : ""}
                  .
                </>
              ) : (
                <>
                  Adquisición de productos y cuota de manejo del{" "}
                  <span className="font-semibold text-accent">{pct}%</span>.
                </>
              )}
            </p>
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-left text-[12px]">
            <thead className="border-b border-accent/40 text-[10px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2 font-bold">
                  {esFlete ? "Concepto" : "Producto / concepto"}
                </th>
                <th className="px-3 py-2 text-right font-bold">Valor</th>
              </tr>
            </thead>
            <tbody>
              {esFlete ? (
                <tr className="border-t border-border/70">
                  <td className="px-3 py-2">Flete / envío (reembolso)</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold">
                    {fmtCop(fleteCop)}
                  </td>
                </tr>
              ) : (
                <>
                  {productos.length > 0 ? (
                    productos.map((p, i) => (
                      <tr key={i} className="border-t border-border/70">
                        <td className="px-3 py-2">{p.etiqueta}</td>
                        <td className="px-3 py-2 text-right font-mono font-semibold">
                          {fmtCop(p.valorCop)}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr className="border-t border-border/70">
                      <td className="px-3 py-2">Productos adquiridos</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold">
                        {fmtCop(valor)}
                      </td>
                    </tr>
                  )}
                  <tr className="border-t border-border/70">
                    <td className="px-3 py-2">
                      Cuota de manejo (<span className="text-accent">{pct}%</span>)
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">
                      {fmtCop(cuota)}
                    </td>
                  </tr>
                </>
              )}
              <tr className="border-t-2 border-accent">
                <td className="px-3 py-2.5 font-bold text-accent">Total a cobrar</td>
                <td className="px-3 py-2.5 text-right font-mono text-base font-extrabold text-accent">
                  {fmtCop(total)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {err && <p className="text-[11px] text-danger">{err}</p>}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {pendiente && (
            <button
              type="button"
              disabled={busy || total <= 0}
              onClick={() => void aprobar()}
              className="rounded-lg border-2 border-accent px-4 py-2 text-xs font-bold text-accent hover:bg-surface-hover disabled:opacity-40"
            >
              {busy ? "Generando PDF…" : "Aprobar y generar PDF"}
            </button>
          )}
          {aprobada && (
            <>
              <span className="rounded-full border border-accent px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-accent">
                Aprobada
              </span>
              {onDescargar && (
                <button
                  type="button"
                  onClick={onDescargar}
                  className="rounded-lg border border-accent px-3 py-1.5 text-xs font-semibold text-accent hover:bg-surface-hover"
                >
                  Descargar PDF
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => void aprobar()}
                className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-medium text-muted hover:text-ink"
                title="Vuelve a generar el PDF con el acento actual del tema"
              >
                {busy ? "…" : "Regenerar con tema actual"}
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
