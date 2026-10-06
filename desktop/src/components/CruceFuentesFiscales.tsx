/**
 * Cruce de tres fuentes: lo que declaró William ↔ lo que la DIAN ve facturado ↔
 * los extractos de la cuenta de la empresa.
 *
 *  · Ventas: total facturado del 300 (ingresos + IVA) contra las ventas netas
 *    del reporte mensual de facturación electrónica. Deben cuadrar casi al peso.
 *  · Compras: base con retención del 350 contra las compras que la DIAN ve
 *    recibidas. No tienen que cuadrar; el porcentaje sirve para preguntar.
 *  · Pagos: cada recibo 490 / SDH contra su línea en el extracto y su asiento.
 * Backend: `cruce_tripartito()` en app/services/declaraciones_impuestos.py.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, fetchAuthBlobUrl } from "../api/client";

type MP = { ventas: number; envios: number; devoluciones: number; cashback: number; comisiones: number; neto: number };
type Mes = {
  mes: string;
  mercado_pago: MP | null;
  dian: { ventas_netas: number; compras_netas: number; doc_soporte: number; fuente: string } | null;
  william_350: { base_sujeta: number; compras_base: number; total: number; numero?: string } | null;
  banco: { abonos: number; cargos: number; abonos_mercado_pago: number; abonos_clientes: number; abonos_otros: number; pagos_fisco: number } | null;
  pct_compras_con_retencion?: number;
};
type Iva = {
  cuatrimestre: number; meses: string[]; numero?: string; dian_completa: boolean;
  william_ingresos: number; william_iva_generado: number; william_total_facturado: number;
  dian_ventas: number; diferencia_ventas: number; pct_ventas: number | null; mp_ventas_netas?: number | null;
  william_iva_descontable: number; william_compras_gravadas_con_iva: number; dian_compras: number;
};
type Pago = {
  recibo: string; numero: string; etiqueta: string; periodo: string; fecha_pago: string; valor: number; archivo?: string | null;
  banco: { fecha: string; descripcion: string; monto: number; diferencia?: number; dias?: number } | null;
  banco_estado: "encontrado" | "pagado_con_diferencia" | "no_encontrado" | "sin_extracto";
  libro_estado: string; movimiento_id?: number;
};
type Cruce = {
  anio: number;
  fuentes: { dian_meses: string[]; dian_meses_deducidos: string[]; extractos_meses: string[]; declaraciones: number; recibos: number; mercado_pago_meses?: string[] };
  meses: Mes[]; iva: Iva[]; pagos: Pago[];
  hallazgos: { nivel: string; tema: string; texto: string }[];
  mercado_pago: (MP & { banco_desde_mp: number; diferencia_banco: number; meses: string[] }) | null;
  renta: { pasos: { concepto: string; valor: number }[]; explicado: number; terceros: number | null;
           sin_explicar: number | null; plazo?: string; radicado?: string; nota: string } | null;
};

const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const nm = (k: string) => `${MES[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}`;
function cop(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);
}
function mill(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${(n / 1e6).toLocaleString("es-CO", { maximumFractionDigits: 1 })} M`;
}
function rango(ms: string[]): string {
  if (!ms.length) return "ninguno";
  return ms.length === 1 ? nm(ms[0]) : `${nm(ms[0])} – ${nm(ms[ms.length - 1])}`;
}
async function abrirPdf(archivo: string) {
  const url = await fetchAuthBlobUrl(`/api/contabilidad/declaraciones/pdf?${new URLSearchParams({ archivo })}`);
  if (url) window.open(url, "_blank", "noopener");
}

const LIBRO: Record<string, { t: string; c: string }> = {
  registrado: { t: "Asentado", c: "text-emerald-600" },
  solicitado: { t: "En solicitud", c: "text-amber-600" },
  pendiente: { t: "Falta asentar", c: "font-bold text-red-600" },
  antes_del_corte: { t: "Antes del corte (saldo inicial)", c: "text-muted" },
};
const BANCO: Record<Pago["banco_estado"], { t: string; c: string }> = {
  encontrado: { t: "✓ En el extracto", c: "text-emerald-600" },
  pagado_con_diferencia: { t: "✓ Pagado tarde, con mora", c: "text-amber-600" },
  no_encontrado: { t: "✗ No está en el extracto", c: "font-bold text-red-600" },
  sin_extracto: { t: "Sin extracto cargado", c: "text-muted" },
};

export default function CruceFuentesFiscales({ soloLectura }: { soloLectura: boolean }) {
  const qc = useQueryClient();
  const [anio, setAnio] = useState(() => new Date().getFullYear());
  const q = useQuery<Cruce>({
    queryKey: ["contabilidad-cruce-fiscal", anio],
    queryFn: () => api.get(`/api/contabilidad/declaraciones/cruce?anio=${anio}`),
  });
  const [msg, setMsg] = useState<string | null>(null);
  const actualizar = useMutation({
    mutationFn: () => api.post<{ soportes_contador_nuevos: number; reportes_dian_nuevos: number }>(
      "/api/contabilidad/declaraciones/actualizar-fuentes", {}, { timeoutMs: 240000 }),
    onSuccess: (r) => {
      setMsg(`Listo: ${r.soportes_contador_nuevos} soporte(s) nuevo(s) de William y ${r.reportes_dian_nuevos} reporte(s) nuevo(s) de la DIAN.`);
      qc.invalidateQueries({ queryKey: ["contabilidad-cruce-fiscal"] });
      qc.invalidateQueries({ queryKey: ["contabilidad-declaraciones-contraste"] });
      qc.invalidateQueries({ queryKey: ["contabilidad-declaraciones"] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  if (q.isLoading) return <p className="text-sm text-muted">Cruzando declaraciones, DIAN y banco…</p>;
  if (q.error || !q.data) return <p className="text-sm text-red-500">{(q.error as Error)?.message ?? "Sin datos"}</p>;
  const d = q.data;
  const f = d.fuentes;

  return (
    <div className="space-y-3">
      <section className="lm-card space-y-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-bold text-ink">Declarado ↔ DIAN ↔ banco</h3>
          <div className="ml-auto inline-flex rounded-lg border border-border p-0.5">
            {[new Date().getFullYear() - 1, new Date().getFullYear()].map((a) => (
              <button key={a} type="button" onClick={() => setAnio(a)}
                      className={`rounded-md px-2.5 py-1 text-xs font-bold ${anio === a ? "bg-accent text-white" : "text-muted hover:text-ink"}`}>{a}</button>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted">
          Tres miradas del mismo año: lo que William declaró, lo que la DIAN ve facturado a nombre de McKenna (reporte
          mensual de facturación electrónica, con IVA) y lo que pasó por la cuenta de la empresa (extractos cargados en
          Conciliación; el banco de los socios no entra).
        </p>
        <div className="flex flex-wrap gap-2 text-xs">
          <Fuente titulo="William" texto={`${f.declaraciones} declaraciones · ${f.recibos} recibos de pago`} />
          <Fuente titulo="DIAN" texto={!f.dian_meses.length ? "sin reportes mensuales ese año (empiezan en feb-2026)" : `${rango(f.dian_meses)}${f.dian_meses_deducidos.length ? ` (${f.dian_meses_deducidos.map(nm).join(", ")} deducido del acumulado)` : ""}`} />
          <Fuente titulo="Banco" texto={`extractos ${rango(f.extractos_meses)}`} />
          <Fuente titulo="Mercado Pago" texto={f.mercado_pago_meses?.length ? `liquidaciones ${rango(f.mercado_pago_meses)}` : "sin reportes"} />
          {!soloLectura && (
            <button type="button" disabled={actualizar.isPending} onClick={() => { setMsg(null); actualizar.mutate(); }}
                    className="ml-auto rounded-lg border border-accent px-3 py-1 font-bold text-accent hover:bg-accent/10 disabled:opacity-50">
              {actualizar.isPending ? "Leyendo el correo…" : "Traer lo último del correo"}
            </button>
          )}
        </div>
        {msg && <p className="text-xs text-muted">{msg}</p>}
      </section>

      <section className="lm-card space-y-1.5 p-3">
        <h4 className="text-sm font-bold text-ink">Para ajustar o preguntar ({d.hallazgos.length})</h4>
        {!d.hallazgos.length && <p className="text-xs text-emerald-600">Las tres fuentes cuadran.</p>}
        {d.hallazgos.map((h, i) => (
          <p key={i} className={`rounded-md border-l-4 px-2 py-1 text-xs text-ink ${h.nivel === "alta" ? "border-red-500 bg-red-500/5" : "border-amber-500 bg-amber-500/5"}`}>
            {h.texto}
          </p>
        ))}
      </section>

      {d.renta && (
        <section className="lm-card space-y-2 p-3">
          <h4 className="text-sm font-bold text-ink">Renta {d.anio}: de lo declarado a lo que reportaron terceros</h4>
          <table className="w-full text-sm">
            <tbody>
              {d.renta.pasos.map((p) => (
                <tr key={p.concepto} className="border-b border-border/40">
                  <td className="py-1 pr-2 text-ink">{p.concepto}</td>
                  <td className="py-1 text-right font-mono">{cop(p.valor)}</td>
                </tr>
              ))}
              <tr className="border-b border-border font-bold">
                <td className="py-1 pr-2 text-ink">= Explicado</td>
                <td className="py-1 text-right font-mono">{cop(d.renta.explicado)}</td>
              </tr>
              {d.renta.terceros != null && (
                <>
                  <tr>
                    <td className="py-1 pr-2 text-ink">Lo que la DIAN dice que reportaron terceros{d.renta.radicado ? ` (comunicado ${d.renta.radicado})` : ""}</td>
                    <td className="py-1 text-right font-mono">{cop(d.renta.terceros)}</td>
                  </tr>
                  <tr className="font-bold">
                    <td className="py-1 pr-2 text-ink">Sin explicar</td>
                    <td className={`py-1 text-right font-mono ${Math.abs(d.renta.sin_explicar ?? 0) / (d.renta.terceros || 1) <= 0.02 ? "text-emerald-600" : "text-red-600"}`}>
                      {cop(d.renta.sin_explicar)} ({(((d.renta.sin_explicar ?? 0) / (d.renta.terceros || 1)) * 100).toFixed(1)}%)
                    </td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
          <p className="text-[11px] text-muted">{d.renta.nota}{d.renta.plazo ? ` Plazo para responder: ${d.renta.plazo}.` : ""}</p>
        </section>
      )}

      {d.mercado_pago && (
        <section className="lm-card space-y-1 p-3">
          <h4 className="text-sm font-bold text-ink">Mercado Pago ↔ banco · {d.anio}</h4>
          <p className="text-xs text-ink">
            Ventas brutas {cop(d.mercado_pago.ventas)} + envíos {cop(d.mercado_pago.envios)} + cashback {cop(d.mercado_pago.cashback)}
            {" "}− devoluciones y disputas {cop(-d.mercado_pago.devoluciones)} − comisiones y cargos {cop(-d.mercado_pago.comisiones)}
            {" "}= <b>neto liquidado {cop(d.mercado_pago.neto)}</b>. Al banco llegaron <b>{cop(d.mercado_pago.banco_desde_mp)}</b> desde
            Mercado Pago (diferencia {cop(d.mercado_pago.diferencia_banco)}, por los cortes de fin de año).
          </p>
        </section>
      )}

      <section className="lm-card space-y-2 p-3">
        <h4 className="text-sm font-bold text-ink">Ventas · IVA (300) contra lo que la DIAN ve facturado</h4>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] text-muted">
                <th className="py-1 pr-2">Cuatrimestre</th>
                <th className="py-1 pr-2 text-right">William: ingresos (43)</th>
                <th className="py-1 pr-2 text-right">+ IVA generado (67)</th>
                <th className="py-1 pr-2 text-right">= Total facturado</th>
                <th className="py-1 pr-2 text-right">DIAN: ventas netas</th>
                <th className="py-1 pr-2 text-right" title="Ventas por Mercado Pago menos devoluciones y disputas, con IVA">de ellas por Mercado Pago</th>
                <th className="py-1 text-right">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {d.iva.map((r) => {
                const ok = r.pct_ventas != null && Math.abs(r.pct_ventas) <= 1;
                return (
                  <tr key={r.cuatrimestre} className="border-b border-border/40">
                    <td className="py-1 pr-2 text-ink">{r.cuatrimestre} · {rango(r.meses)}{!r.dian_completa && <span className="text-[10px] text-amber-600"> (DIAN incompleta)</span>}</td>
                    <td className="py-1 pr-2 text-right font-mono">{cop(r.william_ingresos)}</td>
                    <td className="py-1 pr-2 text-right font-mono">{cop(r.william_iva_generado)}</td>
                    <td className="py-1 pr-2 text-right font-mono font-bold">{cop(r.william_total_facturado)}</td>
                    <td className="py-1 pr-2 text-right font-mono font-bold">{r.dian_completa || r.dian_ventas ? cop(r.dian_ventas) : "—"}</td>
                    <td className="py-1 pr-2 text-right font-mono text-muted">{cop(r.mp_ventas_netas)}</td>
                    <td className={`py-1 text-right font-mono ${ok ? "text-emerald-600" : "font-bold text-red-600"}`}>
                      {cop(r.diferencia_ventas)} <span className="text-[10px]">({r.pct_ventas ?? "—"}%){ok ? " ✓" : ""}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted">
          Compras con IVA, mismo período: la DIAN ve {d.iva.map((r) => `C${r.cuatrimestre} ${mill(r.dian_compras)}`).join(" · ")}; el IVA
          descontable de William equivale a {d.iva.map((r) => `C${r.cuatrimestre} ${mill(r.william_compras_gravadas_con_iva)}`).join(" · ")} de compras
          gravadas (la diferencia son compras sin IVA o sin derecho a descuento).
        </p>
      </section>

      <section className="lm-card space-y-2 p-3">
        <h4 className="text-sm font-bold text-ink">Mes a mes</h4>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted">
                <th />
                <th colSpan={3} className="border-b border-border px-1 pb-0.5 text-center">DIAN · facturación electrónica</th>
                <th colSpan={2} className="border-b border-border px-1 pb-0.5 text-center">Mercado Pago</th>
                <th colSpan={2} className="border-b border-border px-1 pb-0.5 text-center">William · 350</th>
                <th colSpan={4} className="border-b border-border px-1 pb-0.5 text-center">Banco · cuenta de la empresa</th>
              </tr>
              <tr className="border-b border-border text-left text-[11px] text-muted">
                <th className="py-1 pr-2">Mes</th>
                <th className="py-1 pr-2 text-right">Ventas</th>
                <th className="py-1 pr-2 text-right">Compras</th>
                <th className="py-1 pr-2 text-right">Doc. soporte</th>
                <th className="py-1 pr-2 text-right" title="Ventas brutas con IVA">Ventas</th>
                <th className="py-1 pr-2 text-right" title="Lo que quedó liquidado después de comisiones">Neto</th>
                <th className="py-1 pr-2 text-right">Base compras</th>
                <th className="py-1 pr-2 text-right" title="Base de compras del 350 ÷ compras DIAN sin IVA (aprox.)">% con retención</th>
                <th className="py-1 pr-2 text-right" title="Mercado Pago · clientes (QR, llave, Nequi) · otros">Abonos</th>
                <th className="py-1 pr-2 text-right">Cargos</th>
                <th className="py-1 pr-2 text-right">Pagado al fisco</th>
                <th className="py-1 text-right">Declarado 350</th>
              </tr>
            </thead>
            <tbody>
              {d.meses.map((m) => (
                <tr key={m.mes} className="border-b border-border/40">
                  <td className="py-1 pr-2 font-bold capitalize text-ink">{nm(m.mes)}{m.dian?.fuente && m.dian.fuente !== "reporte" ? "*" : ""}</td>
                  <td className="py-1 pr-2 text-right font-mono">{mill(m.dian?.ventas_netas)}</td>
                  <td className="py-1 pr-2 text-right font-mono">{mill(m.dian?.compras_netas)}</td>
                  <td className="py-1 pr-2 text-right font-mono">{mill(m.dian?.doc_soporte)}</td>
                  <td className="py-1 pr-2 text-right font-mono">{mill(m.mercado_pago?.ventas)}</td>
                  <td className="py-1 pr-2 text-right font-mono">{mill(m.mercado_pago?.neto)}</td>
                  <td className="py-1 pr-2 text-right font-mono">{mill(m.william_350?.compras_base)}</td>
                  <td className={`py-1 pr-2 text-right font-mono ${(m.pct_compras_con_retencion ?? 100) < 40 ? "font-bold text-amber-600" : ""}`}>
                    {m.pct_compras_con_retencion != null ? `${m.pct_compras_con_retencion}%` : "—"}
                  </td>
                  <td className="py-1 pr-2 text-right font-mono" title={m.banco ? `Mercado Pago ${cop(m.banco.abonos_mercado_pago)} · clientes ${cop(m.banco.abonos_clientes)} · otros ${cop(m.banco.abonos_otros)}` : ""}>
                    {mill(m.banco?.abonos)}
                  </td>
                  <td className="py-1 pr-2 text-right font-mono">{mill(m.banco?.cargos)}</td>
                  <td className="py-1 pr-2 text-right font-mono">{m.banco ? cop(m.banco.pagos_fisco) : "—"}</td>
                  <td className="py-1 text-right font-mono">{m.william_350 ? cop(m.william_350.total) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted">
          * Mes sin correo de la DIAN: deducido del acumulado del mes siguiente. Los abonos del banco no son ventas del mes
          (Mercado Pago retiene y gira después; también entran aportes y traslados): pasa el cursor para ver el desglose.
          «Pagado al fisco» es lo que sale del banco a la DIAN y a la Secretaría de Hacienda; se paga el mes siguiente al declarado.
        </p>
      </section>

      <section className="lm-card space-y-2 p-3">
        <h4 className="text-sm font-bold text-ink">Pagos de impuestos · recibo ↔ banco ↔ libro</h4>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-xs">
            <thead>
              <tr className="border-b border-border text-left text-[11px] text-muted">
                <th className="py-1 pr-2">Recibo</th>
                <th className="py-1 pr-2">Qué paga</th>
                <th className="py-1 pr-2 text-right">Valor</th>
                <th className="py-1 pr-2">Pagado</th>
                <th className="py-1 pr-2">Banco</th>
                <th className="py-1">Libro</th>
              </tr>
            </thead>
            <tbody>
              {d.pagos.map((p) => (
                <tr key={p.numero} className="border-b border-border/40">
                  <td className="py-1 pr-2 font-mono">
                    {p.recibo} {p.numero}
                    {p.archivo && <button type="button" onClick={() => abrirPdf(p.archivo!)} className="ml-1 rounded border border-border px-1 text-[10px] font-bold text-ink">PDF</button>}
                  </td>
                  <td className="py-1 pr-2 text-ink">{p.etiqueta} · {p.periodo}</td>
                  <td className="py-1 pr-2 text-right font-mono font-bold">{cop(p.valor)}</td>
                  <td className="py-1 pr-2">{p.fecha_pago}</td>
                  <td className={`py-1 pr-2 ${BANCO[p.banco_estado].c}`} title={p.banco ? `${p.banco.fecha} · ${p.banco.descripcion}` : undefined}>
                    {BANCO[p.banco_estado].t}{p.banco && <span className="text-muted"> ({p.banco.fecha}{p.banco.diferencia ? ` · +${cop(p.banco.diferencia)}` : ""})</span>}
                  </td>
                  <td className={`py-1 ${(LIBRO[p.libro_estado] ?? LIBRO.pendiente).c}`}>
                    {(LIBRO[p.libro_estado] ?? { t: p.libro_estado }).t}{p.movimiento_id ? <span className="font-mono text-muted"> #{p.movimiento_id}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Fuente({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <span className="rounded-lg border border-border px-2 py-1">
      <b className="text-ink">{titulo}:</b> <span className="text-muted">{texto}</span>
    </span>
  );
}
