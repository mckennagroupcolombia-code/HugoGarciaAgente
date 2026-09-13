import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";

/**
 * El préstamo visto como flujo, no como tabla.
 *
 * Un préstamo se lee normalmente como un cronograma de cuotas, pero su efecto
 * contable está repartido en asientos que nadie cruza a mano: el desembolso,
 * los tramos que entraron por la cuenta personal de un socio, las reposiciones
 * de ese socio y el pago de cada cuota. Esta vista los enlaza: de dónde salió
 * la plata, por dónde pasó, en qué cuentas del PUC quedó y qué falta.
 *
 * Cada cuenta muestra dos cifras que NO son lo mismo y se confunden siempre:
 *   - «este préstamo» — lo que estos asientos pusieron ahí,
 *   - «libro» — el saldo real de la cuenta, con todo lo demás de la empresa.
 *
 * Solo lectura. Nada de lo que se ve acá escribe en la contabilidad.
 */

type Socio = { id: number; nombre: string; recibio: number; repuso: number; debe: number };

type LineaAsiento = {
  cuenta_codigo: string;
  cuenta_nombre: string;
  tercero_id: number | null;
  debito: number;
  credito: number;
  descripcion: string;
};

type Asiento = {
  id: number;
  clase: "desembolso" | "tramo" | "reposicion" | "cuota";
  fecha: string;
  concepto: string;
  lineas: LineaAsiento[];
};

type CuentaTraza = {
  codigo: string;
  nombre: string;
  tipo: string;
  naturaleza: string;
  debito: number;
  credito: number;
  saldo_prestamo: number;
  saldo_libro: number;
};

type Traza = {
  prestamo_id: number;
  prestamista: { id: number; nombre: string; identificacion: string };
  socios: Socio[];
  capital: number;
  meses_gracia: number;
  asientos: Asiento[];
  cuentas: CuentaTraza[];
  por_reponer: number;
  proxima_cuota: {
    numero: number;
    fecha: string;
    lineas: { cuenta_codigo: string; concepto: string; debito: number; credito: number }[];
  } | null;
};

function cop(n: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n || 0);
}

function fecha(f: string): string {
  if (!f) return "";
  const [a, m, d] = f.slice(0, 10).split("-");
  return `${d}/${m}/${a.slice(2)}`;
}

const CLASES: Record<Asiento["clase"], { rotulo: string; color: string }> = {
  desembolso: { rotulo: "Entró el capital", color: "bg-emerald-500/15 text-emerald-300" },
  tramo: { rotulo: "Tramo adicional", color: "bg-emerald-500/15 text-emerald-300" },
  reposicion: { rotulo: "El socio repuso", color: "bg-sky-500/15 text-sky-300" },
  cuota: { rotulo: "Cuota pagada", color: "bg-violet-500/15 text-violet-300" },
};

export default function PrestamoFlujoPanel({ prestamoId }: { prestamoId: number }) {
  const [abierto, setAbierto] = useState<number | null>(null);

  const q = useQuery<Traza>({
    queryKey: ["prestamo-trazabilidad", prestamoId],
    queryFn: () => api.get(`/api/prestamos/${prestamoId}/trazabilidad`),
    // El Libro Mayor cambia por fuera de este panel (autopost, pagos, otros
    // usuarios): sin refresco los saldos de la derecha envejecen en silencio.
    refetchInterval: 30_000,
  });

  if (q.isLoading) return <p className="p-4 text-xs text-muted">Cargando el flujo…</p>;
  if (q.error || !q.data)
    return <p className="p-4 text-xs text-red-400">No se pudo cargar la trazabilidad.</p>;

  const t = q.data;
  const entroAlBanco = t.asientos
    .filter((a) => a.clase === "desembolso" || a.clase === "tramo")
    .flatMap((a) => a.lineas)
    .filter((l) => l.cuenta_codigo === "1110")
    .reduce((s, l) => s + l.debito, 0);
  const porSocio = t.socios.reduce((s, x) => s + x.recibio, 0);

  return (
    <div className="space-y-4">
      {/* ── El recorrido de la plata ─────────────────────────────────── */}
      <section className="rounded-lg border border-white/10 bg-surface/40 p-4">
        <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">
          Por dónde entró el capital
        </h4>

        <div className="flex flex-wrap items-stretch gap-2">
          <Nodo
            titulo={t.prestamista.nombre}
            sub={t.prestamista.identificacion ? `CC ${t.prestamista.identificacion}` : "Prestamista"}
            monto={t.capital}
            tono="origen"
          />

          <Flecha />

          <div className="flex min-w-[210px] flex-1 flex-col gap-2">
            {entroAlBanco > 0 && (
              <Nodo
                titulo="Cuenta de McKenna"
                sub="1110 · Bancos"
                monto={entroAlBanco}
                tono="ok"
                nota="Entró directo"
              />
            )}
            {t.socios.map((s) => (
              <Nodo
                key={s.id}
                titulo={s.nombre}
                sub="1355 · Por cobrar a socios"
                monto={s.recibio}
                tono={s.debe > 0 ? "alerta" : "ok"}
                nota={
                  s.debe > 0
                    ? `Repuso ${cop(s.repuso)} · debe ${cop(s.debe)}`
                    : "Repuesto completo"
                }
              />
            ))}
          </div>

          <Flecha />

          <Nodo
            titulo="McKenna le debe"
            sub="2295 · Préstamos por pagar"
            monto={t.capital}
            tono="pasivo"
            nota={t.meses_gracia ? `${t.meses_gracia} mes de gracia` : undefined}
          />
        </div>

        {t.por_reponer > 0 && (
          <p className="mt-3 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <strong>{cop(t.por_reponer)}</strong> de este préstamo nunca llegaron a la cuenta de
            la empresa. La deuda con el prestamista corre igual, y el saldo en 1355 genera
            interés presuntivo (art. 35 ET) mientras exista.
          </p>
        )}
        {porSocio === 0 && (
          <p className="mt-3 text-xs text-muted">
            Todo el capital entró directo a la cuenta de McKenna.
          </p>
        )}
      </section>

      {/* ── Cuentas del Libro Mayor ──────────────────────────────────── */}
      <section className="rounded-lg border border-white/10 bg-surface/40 p-4">
        <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">
          Cuentas que mueve en el Libro Mayor
        </h4>
        <p className="mb-3 text-[11px] text-muted">
          «Este préstamo» es lo que estos asientos pusieron en la cuenta. «Libro» es el saldo
          real, con todo lo demás de la empresa.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {t.cuentas.map((c) => (
            <div key={c.codigo} className="rounded-md border border-white/10 bg-black/20 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-xs font-bold text-accent">{c.codigo}</span>
                <span className="truncate text-[11px] text-muted">{c.nombre}</span>
              </div>
              <div className="mt-2 flex items-end justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase text-muted">Este préstamo</p>
                  <p className="text-sm font-bold">{cop(c.saldo_prestamo)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase text-muted">Libro</p>
                  <p
                    className={`text-sm font-semibold ${
                      c.saldo_libro < 0 ? "text-red-400" : "text-white/80"
                    }`}
                  >
                    {cop(c.saldo_libro)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Qué pasará con la próxima cuota ──────────────────────────── */}
      {t.proxima_cuota && (
        <section className="rounded-lg border border-white/10 bg-surface/40 p-4">
          <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">
            Lo que moverá la próxima cuota
          </h4>
          <p className="mb-3 text-[11px] text-muted">
            Cuota {t.proxima_cuota.numero}, vence el {fecha(t.proxima_cuota.fecha)}. Proyección:
            todavía no está en el libro.
          </p>
          <Asientito lineas={t.proxima_cuota.lineas} proyeccion />
        </section>
      )}

      {/* ── Los asientos reales ──────────────────────────────────────── */}
      <section className="rounded-lg border border-white/10 bg-surface/40 p-4">
        <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">
          Asientos ya registrados ({t.asientos.length})
        </h4>
        <div className="space-y-2">
          {t.asientos.map((a) => (
            <div key={a.id} className="rounded-md border border-white/10 bg-black/20">
              <button
                type="button"
                onClick={() => setAbierto(abierto === a.id ? null : a.id)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left"
              >
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${CLASES[a.clase].color}`}
                >
                  {CLASES[a.clase].rotulo}
                </span>
                <span className="text-xs text-muted">{fecha(a.fecha)}</span>
                <span className="flex-1 truncate text-xs">{a.concepto}</span>
                <span className="text-[10px] text-muted">#{a.id}</span>
                <span className="text-muted">{abierto === a.id ? "▴" : "▾"}</span>
              </button>
              {abierto === a.id && (
                <div className="border-t border-white/10 px-3 py-2">
                  <Asientito
                    lineas={a.lineas.map((l) => ({
                      cuenta_codigo: l.cuenta_codigo,
                      concepto: l.descripcion || l.cuenta_nombre,
                      debito: l.debito,
                      credito: l.credito,
                    }))}
                  />
                </div>
              )}
            </div>
          ))}
          {t.asientos.length === 0 && (
            <p className="text-xs text-muted">Este préstamo todavía no tiene asientos.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function Nodo({
  titulo,
  sub,
  monto,
  nota,
  tono,
}: {
  titulo: string;
  sub: string;
  monto: number;
  nota?: string;
  tono: "origen" | "ok" | "alerta" | "pasivo";
}) {
  const borde = {
    origen: "border-white/20",
    ok: "border-emerald-500/40",
    alerta: "border-amber-500/50",
    pasivo: "border-violet-500/40",
  }[tono];
  return (
    <div className={`min-w-[190px] flex-1 rounded-md border ${borde} bg-black/30 p-3`}>
      <p className="truncate text-sm font-bold">{titulo}</p>
      <p className="truncate text-[11px] text-muted">{sub}</p>
      <p className="mt-1 text-base font-bold">{cop(monto)}</p>
      {nota && <p className="mt-1 text-[11px] text-muted">{nota}</p>}
    </div>
  );
}

function Flecha() {
  return (
    <div className="flex items-center justify-center px-1 text-lg text-muted" aria-hidden>
      →
    </div>
  );
}

function Asientito({
  lineas,
  proyeccion = false,
}: {
  lineas: { cuenta_codigo: string; concepto: string; debito: number; credito: number }[];
  proyeccion?: boolean;
}) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-[10px] uppercase text-muted">
          <th className="py-1 text-left font-semibold">Cuenta</th>
          <th className="py-1 text-left font-semibold">Concepto</th>
          <th className="py-1 text-right font-semibold">Débito</th>
          <th className="py-1 text-right font-semibold">Crédito</th>
        </tr>
      </thead>
      <tbody className={proyeccion ? "opacity-80" : ""}>
        {lineas.map((l, i) => (
          <tr key={`${l.cuenta_codigo}-${i}`} className="border-t border-white/5">
            <td className="py-1 font-mono text-accent">{l.cuenta_codigo}</td>
            <td className="py-1 text-muted">{l.concepto}</td>
            <td className="py-1 text-right">{l.debito ? cop(l.debito) : "—"}</td>
            <td className="py-1 text-right">{l.credito ? cop(l.credito) : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
