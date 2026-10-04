/**
 * Retenciones que le PRACTICARON a McKenna y temas para la reunión con el contador.
 *
 * Mercado Pago expide un certificado mensual (IVA y Fuente + ICA Bogotá) de lo
 * que los bancos retuvieron sobre las ventas con tarjeta: plata a favor de
 * McKenna en el 350, el 300 y el ICA. Acá el contador los ve por mes, abre el PDF
 * y compara contra lo causado en el libro (135515/135517/135518).
 *
 * Los temas salen de app/data/temas_reunion_contador.json con cifras en vivo
 * (app/services/certificados_retencion.py). Solo lectura: lo ve igual el perfil
 * contador.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, fetchAuthBlobUrl } from "../api/client";

type Impuesto = "retefuente" | "reteiva" | "reteica";

type Concepto = { concepto: string; impuesto: Impuesto; cuenta: string; base: number; tarifa_pct: number; retencion: number };
type Certificado = {
  archivo: string; nombre: string; emisor: string; nit_emisor: string; fecha_expedicion: string;
  periodo: string; tipo: string; conceptos: Concepto[]; total: number; legible: boolean;
};
type Periodo = { periodo: string; certificados: Certificado[]; total: number } & Record<Impuesto, number>;
type Listado = {
  periodos: Periodo[];
  totales: Record<Impuesto | "total", number>;
  cuentas: Record<Impuesto, { codigo: string; nombre: string }>;
  causado_en_libro: Record<Impuesto, number>;
};
type Tema = {
  id: string; creado: string; estado: string; titulo: string; detalle: string; pregunta?: string;
  cifras?: { periodo: string; lineas: number; valor: number }[];
  cifras_certificados?: Record<Impuesto | "total", number>;
};

const IMPUESTOS: { id: Impuesto; label: string }[] = [
  { id: "retefuente", label: "Retefuente (renta)" },
  { id: "reteiva", label: "ReteIVA" },
  { id: "reteica", label: "ReteICA Bogotá" },
];

const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function cop(n: number | null | undefined, dec = 0): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency", currency: "COP", minimumFractionDigits: dec, maximumFractionDigits: dec,
  }).format(n || 0);
}

function nombrePeriodo(p: string): string {
  const [a, m] = p.split("-");
  return `${MES[Number(m) - 1] ?? m} ${a}`;
}

async function abrirPdf(archivo: string) {
  const url = await fetchAuthBlobUrl(
    `/api/contabilidad/certificados-retencion/pdf?${new URLSearchParams({ archivo }).toString()}`);
  if (url) window.open(url, "_blank", "noopener");
  else window.alert("No se pudo abrir el certificado.");
}

function Temas() {
  const q = useQuery<{ temas: Tema[] }>({
    queryKey: ["contabilidad-temas-reunion"],
    queryFn: () => api.get("/api/contabilidad/temas-reunion"),
  });
  const abiertos = (q.data?.temas ?? []).filter((t) => t.estado !== "cerrado");
  if (q.isLoading) return <p className="text-sm text-muted">Cargando temas…</p>;
  if (!abiertos.length) return null;
  return (
    <section className="lm-card space-y-3 p-3">
      <h3 className="text-sm font-bold text-ink">Para la próxima reunión con el contador</h3>
      {abiertos.map((t) => (
        <article key={t.id} className="rounded-lg border-l-4 border-amber-500 bg-amber-500/5 px-3 py-2">
          <p className="text-sm font-bold text-ink">{t.titulo}</p>
          <p className="mt-1 text-xs text-muted">{t.detalle}</p>
          {t.cifras && t.cifras.length > 0 && (
            <table className="mt-2 text-xs">
              <tbody>
                {t.cifras.map((c) => (
                  <tr key={c.periodo}>
                    <td className="pr-4 text-muted">{nombrePeriodo(c.periodo)}</td>
                    <td className="pr-4 text-muted">{c.lineas} cobros</td>
                    <td className="text-right font-mono text-ink">{cop(c.valor, 2)}</td>
                  </tr>
                ))}
                <tr className="font-bold">
                  <td className="pr-4">Total</td><td />
                  <td className="text-right font-mono text-ink">{cop(t.cifras.reduce((s, c) => s + c.valor, 0), 2)}</td>
                </tr>
              </tbody>
            </table>
          )}
          {t.cifras_certificados && (
            <p className="mt-2 text-xs text-ink">
              Certificado: {IMPUESTOS.map((i) => `${i.label} ${cop(t.cifras_certificados![i.id])}`).join(" · ")}
              {" · "}<b>Total {cop(t.cifras_certificados.total)}</b>
            </p>
          )}
          {t.pregunta && <p className="mt-2 text-xs font-bold text-amber-700 dark:text-amber-300">Pregunta: {t.pregunta}</p>}
          <p className="mt-1 text-[10px] text-muted">Anotado el {t.creado}</p>
        </article>
      ))}
    </section>
  );
}

export default function RetencionesContadorTab() {
  const [abierto, setAbierto] = useState<string | null>(null);
  const q = useQuery<Listado>({
    queryKey: ["contabilidad-certificados-retencion"],
    queryFn: () => api.get("/api/contabilidad/certificados-retencion"),
  });
  const d = q.data;

  return (
    <div className="space-y-3">
      <Temas />

      <section className="lm-card space-y-2 p-3">
        <h3 className="text-sm font-bold text-ink">Certificados de retención que nos practicaron</h3>
        <p className="text-xs text-muted">
          Lo que los bancos retuvieron sobre las ventas con tarjeta cobradas por Mercado Pago y consignaron a la
          DIAN / Secretaría de Hacienda. Es saldo a favor de McKenna: se descuenta en la declaración de renta
          (retefuente), en el IVA (reteIVA) y en el ICA (reteICA). Un clic en el mes abre el detalle; el PDF es el
          certificado original.
        </p>
        {q.isLoading && <p className="text-sm text-muted">Cargando certificados…</p>}
        {q.error && <p className="text-sm text-red-500">{(q.error as Error).message}</p>}
        {d && !d.periodos.length && (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
            Todavía no hay certificados cargados.</p>
        )}
        {d && d.periodos.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="py-1 pr-2">Mes</th>
                  {IMPUESTOS.map((i) => (
                    <th key={i.id} className="py-1 pr-2 text-right">{i.label}<br />
                      <span className="font-mono font-normal">{d.cuentas[i.id].codigo}</span></th>
                  ))}
                  <th className="py-1 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {d.periodos.map((p) => (
                  <PeriodoFila key={p.periodo} p={p} abierto={abierto === p.periodo}
                               onToggle={() => setAbierto(abierto === p.periodo ? null : p.periodo)} />
                ))}
                <tr className="border-t-2 border-border font-bold">
                  <td className="py-1 pr-2">Total certificado</td>
                  {IMPUESTOS.map((i) => <td key={i.id} className="py-1 pr-2 text-right font-mono">{cop(d.totales[i.id])}</td>)}
                  <td className="py-1 text-right font-mono">{cop(d.totales.total)}</td>
                </tr>
                <tr className="text-xs text-muted">
                  <td className="py-1 pr-2">Causado en el Libro Mayor</td>
                  {IMPUESTOS.map((i) => <td key={i.id} className="py-1 pr-2 text-right font-mono">{cop(d.causado_en_libro[i.id])}</td>)}
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function PeriodoFila({ p, abierto, onToggle }: { p: Periodo; abierto: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="cursor-pointer border-b border-border/50 hover:bg-surface-input" onClick={onToggle}>
        <td className="py-1 pr-2 font-bold">{abierto ? "▾" : "▸"} {nombrePeriodo(p.periodo)}</td>
        {IMPUESTOS.map((i) => <td key={i.id} className="py-1 pr-2 text-right font-mono">{cop(p[i.id])}</td>)}
        <td className="py-1 text-right font-mono font-bold">{cop(p.total)}</td>
      </tr>
      {abierto && (
        <tr>
          <td colSpan={5} className="bg-surface-input/50 px-3 py-2">
            {p.certificados.map((c) => (
              <div key={c.archivo} className="mb-2 last:mb-0">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <b className="text-ink">{c.tipo}</b>
                  <span className="text-muted">{c.emisor} · NIT {c.nit_emisor} · expedido {c.fecha_expedicion}</span>
                  <button type="button" onClick={() => abrirPdf(c.archivo)}
                          className="ml-auto rounded border border-border px-2 py-0.5 text-xs font-bold text-ink hover:bg-surface">
                    Ver PDF</button>
                </div>
                {!c.legible && <p className="text-xs text-amber-600">No se pudieron leer las cifras de este PDF: ábrelo.</p>}
                {c.conceptos.map((x) => (
                  <p key={x.concepto} className="text-xs text-muted">
                    {x.concepto}: base {cop(x.base, 2)} × {x.tarifa_pct}% = <b className="text-ink">{cop(x.retencion, 2)}</b>
                  </p>
                ))}
              </div>
            ))}
          </td>
        </tr>
      )}
    </>
  );
}
