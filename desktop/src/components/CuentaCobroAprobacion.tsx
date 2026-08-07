import { useMemo, useState } from "react";
import { api } from "../api/client";
import { usePanelTheme } from "../stores/panelTheme";
import { useTicketsAuth } from "../stores/ticketsAuth";
import { datos_emisor_documento, datos_emisor_label } from "./cuentaCobroLabels";

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
 * Concepto / liquidación por producto adquirido + cuota % editable (o flete aparte).
 */
export default function CuentaCobroAprobacion({
  compra,
  tipo = "mercancia",
  onAprobada,
  onDescargar,
  compact,
}: Props) {
  const accentRgb = usePanelTheme((s) => s.accentRgb);
  const emisorUser = useTicketsAuth((s) => s.user);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pctEdit, setPctEdit] = useState(() =>
    String(compra.cuota_pct != null && compra.cuota_pct > 0 ? compra.cuota_pct : 5),
  );

  const esFlete = tipo === "flete";
  const emisorNombre = (emisorUser?.nombre || "").trim() || datos_emisor_label();
  const emisorDoc =
    (emisorUser?.documento_identidad || "").trim() || datos_emisor_documento();
  const pctNum = useMemo(() => {
    const v = Number(String(pctEdit).replace(",", "."));
    if (!Number.isFinite(v) || v <= 0) return compra.cuota_pct ?? 5;
    return Math.min(v, 100);
  }, [pctEdit, compra.cuota_pct]);

  const productos = useMemo(
    () => productosConValorCop(compra.lineas, compra.moneda, compra.trm),
    [compra.lineas, compra.moneda, compra.trm],
  );

  const valor =
    compra.valor_compra_cop && compra.valor_compra_cop > 0
      ? compra.valor_compra_cop
      : productos.reduce((a, p) => a + p.valorCop, 0);
  const cuota = esFlete ? 0 : Math.round(valor * (pctNum / 100));
  const fleteCop = compra.flete_cobro_cop ?? 0;
  const total = esFlete ? fleteCop : Math.round((valor + cuota) * 100) / 100;

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
    if (!emisorDoc) {
      setErr("Completa tu documento de identidad en Mi perfil antes de aprobar.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const body: Record<string, string | number> = {
        accent_rgb: accentRgb,
        tipo,
      };
      if (!esFlete) body.cuota_pct = pctNum;
      if (emisorUser?.id) body.emisor_usuario_id = emisorUser.id;
      const res = await api.post<{ ok: boolean; historial: CuentaCobroDatos }>(
        `/api/rentabilidad/compras-exterior/${compra.id}/cuenta-cobro`,
        body,
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
            <p className="font-semibold">{emisorNombre}</p>
            <p className="text-[11px] text-muted font-mono">
              {emisorDoc ? `CC/NIT ${emisorDoc}` : "Sin documento en perfil"}
            </p>
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
              Reembolso de flete / envío de la compra exterior
              {compra.proveedor ? ` · ${compra.proveedor}` : ""}.
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
                  <span className="font-semibold text-accent">{pctNum}%</span> sobre el valor de los
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
                  <span className="font-semibold text-accent">{pctNum}%</span>.
                </>
              )}
            </p>
            {(pendiente || aprobada) && (
              <label className="mt-2 flex items-center gap-2 text-[11px]">
                <span className="font-bold text-muted">Cuota manejo %</span>
                <input
                  type="number"
                  min={0.01}
                  max={100}
                  step="0.1"
                  value={pctEdit}
                  disabled={busy}
                  onChange={(e) => setPctEdit(e.target.value)}
                  onBlur={() => {
                    const v = Number(String(pctEdit).replace(",", "."));
                    if (!Number.isFinite(v) || v <= 0) setPctEdit("5");
                    else if (v > 100) setPctEdit("100");
                  }}
                  className="w-20 rounded-lg border border-border bg-surface-input px-2 py-1 font-mono text-xs"
                />
              </label>
            )}
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
                      Cuota de manejo (<span className="text-accent">{pctNum}%</span>)
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
        {pendiente && !emisorDoc && (
          <p className="text-[11px] text-amber-700 dark:text-amber-300">
            Ve a Mi perfil y guarda tu documento de identidad para poder generar la cuenta de cobro.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {pendiente && (
            <button
              type="button"
              disabled={busy || total <= 0 || !emisorDoc}
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
                disabled={busy || !emisorDoc}
                onClick={() => void aprobar()}
                className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-medium text-muted hover:text-ink"
                title="Vuelve a generar el PDF con el % y el acento actuales"
              >
                {busy ? "…" : "Regenerar PDF"}
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
