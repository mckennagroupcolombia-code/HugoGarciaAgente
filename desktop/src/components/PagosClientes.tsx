import { useCallback, useEffect, useState } from "react";

/**
 * «Pagos de clientes» en la Agenda: los comprobantes que llegan por WhatsApp y esperan
 * «ok/no <3 dígitos>», y las últimas decisiones con quién y cuándo. Es la vista del registro
 * durable (app/services/pagos_clientes.py) — antes esto vivía solo en el grupo y en la RAM.
 * La tarjeta solo aparece si hay algo que mostrar. Datos: GET /api/tickets/pagos-clientes.
 */

type Fila = {
  id: number;
  creado_en: string;
  estado: "pendiente" | "confirmado" | "rechazado" | "vencido";
  cliente: string;
  codigo: string;
  monto: number | null;
  decidido_en: string | null;
  decidido_por: string;
};

const ESTADO: Record<Fila["estado"], { t: string; c: string }> = {
  pendiente: { t: "por decidir", c: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100" },
  confirmado: { t: "confirmado", c: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100" },
  rechazado: { t: "rechazado", c: "bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100" },
  vencido: { t: "vencido", c: "bg-surface-hover text-muted" },
};

const pesos = (v: number) => `$${Math.round(v).toLocaleString("es-CO")}`;

function hora(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso.replace(" ", "T")}Z`); // guardado en UTC
  return d.toLocaleString("es-CO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function PagosClientes({ token }: { token: string }) {
  const [d, setD] = useState<{ pendientes: Fila[]; recientes: Fila[] } | null>(null);
  const [verTodo, setVerTodo] = useState(false);

  const cargar = useCallback(() => {
    fetch(`/api/tickets/pagos-clientes?_t=${Date.now()}`, { cache: "no-store", headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setD)
      .catch(() => setD(null));
  }, [token]);
  useEffect(() => {
    cargar();
    const iv = setInterval(cargar, 2 * 60 * 1000);
    return () => clearInterval(iv);
  }, [cargar]);

  if (!d || (d.pendientes.length === 0 && d.recientes.length === 0)) return null;
  const recientes = verTodo ? d.recientes : d.recientes.slice(0, 4);

  return (
    <section className="mck-card border-accent/25 bg-[rgb(var(--mck-card-bg))] p-4 text-ink sm:p-5" aria-labelledby="pagos-clientes">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 id="pagos-clientes" className="text-lg font-black">Pagos de clientes</h3>
        <span className="text-sm text-muted">comprobantes por WhatsApp, con registro</span>
      </div>

      {d.pendientes.length > 0 && (
        <ul className="mt-3 space-y-2" aria-label="Comprobantes esperando decisión">
          {d.pendientes.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border-l-[6px] border-l-amber-500 bg-surface-hover px-4 py-2.5">
              <span className="min-w-0 text-base">
                Cliente <b>{p.cliente}</b> envió comprobante{p.monto ? <> por <b>{pesos(p.monto)}</b></> : null}
                <span className="block text-sm text-muted">{hora(p.creado_en)} · responda en el grupo: <b className="text-ink">ok {p.codigo}</b> o <b className="text-ink">no {p.codigo}</b></span>
              </span>
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-sm font-bold ${ESTADO.pendiente.c}`}>{ESTADO.pendiente.t}</span>
            </li>
          ))}
        </ul>
      )}

      {recientes.length > 0 && (
        <ul className={`${d.pendientes.length ? "mt-3 border-t border-border pt-2" : "mt-3"} divide-y divide-border`} aria-label="Decisiones recientes">
          {recientes.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-3 py-1.5 text-base">
              <span className="min-w-0">
                {p.cliente}
                {p.monto ? <span className="text-muted"> · {pesos(p.monto)}</span> : null}
                <span className="text-sm text-muted"> · {hora(p.decidido_en || p.creado_en)}{p.decidido_por ? <> · por <b className="text-ink">{p.decidido_por}</b></> : null}</span>
              </span>
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-sm font-bold ${ESTADO[p.estado].c}`}>{ESTADO[p.estado].t}</span>
            </li>
          ))}
        </ul>
      )}
      {d.recientes.length > 4 && (
        <button type="button" onClick={() => setVerTodo(!verTodo)} className="mt-2 text-sm font-bold text-accent underline">
          {verTodo ? "ver menos" : `ver los ${d.recientes.length} de la semana`}
        </button>
      )}
    </section>
  );
}
