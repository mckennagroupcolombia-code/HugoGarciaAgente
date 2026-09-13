import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

/** Diagnóstico del abandono de compra en la tienda web (Pedidos web → Abandono). */

interface Hipotesis {
  tipo: string;
  gravedad: "alta" | "media" | "info";
  titulo: string;
  evidencia: string;
  accion?: string;
}
interface Diagnostico {
  dias: number;
  desde: string;
  total: number;
  aprobados: number;
  rechazados: number;
  sin_pago: number;
  tasa_conversion_pct: number;
  motivos_rechazo: { motivo: string; texto: string; n: number }[];
  medios: { medio: string; rechazados: number; aprobados: number }[];
  ticket: { rango: string; total: number; abandonados: number; pct: number }[];
  horas: { franja: string; total: number; abandonados: number; pct: number }[];
  ciudades: { ciudad: string; total: number; abandonados: number; pct: number }[];
  productos_abandonados: { producto: string; unidades: number; compradas: number }[];
  recurrentes: { email: string; intentos: number }[];
  embudo_web: {
    carrito?: number;
    checkout?: number;
    clic_pagar?: number;
    respuesta?: number;
    errores_checkout?: { detalle: string; n: number }[];
    errores_envio?: number;
    dispositivo?: Record<string, number>;
    dispositivo_pagar?: Record<string, number>;
    respuestas?: Record<string, number>;
    error?: string;
  };
  correos: { enviados: number; por_etapa: Record<string, number>; clics: number; recuperados: number; bajas: number };
  hipotesis: Hipotesis[];
  abandonados_recientes: { reference: string; email: string; total: number; status: string; created_at: string; motivo: string; medio: string }[];
}

export function useAbandonoCompra(dias: number) {
  return useQuery<Diagnostico>({
    queryKey: ["pedidos-web", "abandono", dias],
    queryFn: () => api.get<Diagnostico>(`/api/pedidos/web/abandono?dias=${dias}`),
    staleTime: 60_000,
  });
}

function Cifra({ label, valor, sub }: { label: string; valor: number | string; sub?: string }) {
  return (
    <div className="rounded-paper border border-border bg-surface-panel px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="text-xl font-bold tabular-nums text-ink dark:text-white">{typeof valor === "number" ? valor.toLocaleString("es-CO") : valor}</div>
      {sub ? <div className="text-[11px] text-muted">{sub}</div> : null}
    </div>
  );
}

const COP = (n: number) => "$" + Math.round(n).toLocaleString("es-CO");
const GRAVEDAD: Record<string, string> = {
  alta: "border-red-500/40 bg-red-500/5",
  media: "border-amber-500/40 bg-amber-500/5",
  info: "border-border bg-surface-panel",
};
const ESTADO: Record<string, string> = { no_realizado: "No volvió de MP", pending: "Pendiente", declined: "Rechazado" };

function Barra({ n, total }: { n: number; total: number }) {
  const w = total ? Math.round((100 * n) / total) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded bg-border/60">
      <div className="h-full bg-accent" style={{ width: `${w}%` }} />
    </div>
  );
}

export default function AbandonoCompraPanel() {
  const [dias, setDias] = useState(30);
  const { data, isLoading, isError } = useAbandonoCompra(dias);

  if (isLoading) return <p className="text-sm text-muted">Cargando diagnóstico…</p>;
  if (isError || !data) return <p className="text-sm text-red-500">No se pudo leer el diagnóstico de abandono.</p>;

  const e = data.embudo_web || {};
  const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)} %` : "—");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted">
          Por qué la gente no termina la compra, con datos de la base de pedidos, de MercadoPago y del navegador. Las hipótesis se
          ordenan por lo que más pedidos cuesta.
        </p>
        <div className="ml-auto flex gap-1">
          {[7, 30, 90, 180].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDias(d)}
              className={`min-h-8 rounded-paper border px-2 text-xs font-bold ${dias === d ? "border-accent bg-accent text-white" : "border-border text-ink"}`}
            >
              {d} días
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Cifra label="Pedidos creados" valor={data.total} sub={`desde ${data.desde}`} />
        <Cifra label="Pagados" valor={data.aprobados} sub={`${data.tasa_conversion_pct} % de conversión`} />
        <Cifra label="Rechazados por MP" valor={data.rechazados} sub="tarjeta, banco o fraude" />
        <Cifra label="Fueron a pagar y no volvieron" valor={data.sin_pago} sub="pending → no realizado" />
      </div>

      <section>
        <h2 className="mb-1 text-sm font-bold text-ink dark:text-white">Qué puede estar pasando</h2>
        {data.hipotesis.length ? (
          <div className="space-y-2">
            {data.hipotesis.map((h, i) => (
              <div key={i} className={`rounded-paper border p-3 ${GRAVEDAD[h.gravedad] || GRAVEDAD.info}`}>
                <div className="flex items-start gap-2">
                  <span className={`mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${h.gravedad === "alta" ? "bg-red-500/15 text-red-500" : h.gravedad === "media" ? "bg-amber-500/15 text-amber-600" : "bg-border text-muted"}`}>
                    {h.gravedad}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-ink dark:text-white">{h.titulo}</div>
                    <div className="mt-0.5 text-xs text-muted">{h.evidencia}</div>
                    {h.accion ? <div className="mt-1 text-xs font-semibold text-accent">→ {h.accion}</div> : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">Sin pedidos en el período.</p>
        )}
      </section>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <section>
          <h2 className="mb-1 text-sm font-bold text-ink dark:text-white">Embudo en el navegador (sesiones)</h2>
          {e.error ? (
            <p className="text-xs text-muted">Sin eventos: {e.error}</p>
          ) : (
            <div className="space-y-1.5 rounded-paper border border-border bg-surface-panel p-3 text-xs">
              {[
                ["Vieron el carrito", e.carrito ?? 0],
                ["Vieron el checkout", e.checkout ?? 0],
                ["Pulsaron «Pagar»", e.clic_pagar ?? 0],
                ["Volvieron de MercadoPago", e.respuesta ?? 0],
              ].map(([l, n]) => (
                <div key={String(l)} className="grid grid-cols-[150px_1fr_40px] items-center gap-2">
                  <span className="text-muted">{l}</span>
                  <Barra n={Number(n)} total={Number(e.carrito ?? 0) || 1} />
                  <span className="text-right font-semibold tabular-nums">{Number(n)}</span>
                </div>
              ))}
              <div className="pt-1 text-[11px] text-muted">
                Checkout por dispositivo: {Object.entries(e.dispositivo || {}).map(([k, v]) => `${k} ${v} (pagar ${e.dispositivo_pagar?.[k] ?? 0})`).join(" · ") || "sin datos todavía"}
                {e.errores_envio ? ` · fallos al cotizar envío: ${e.errores_envio}` : ""}
              </div>
              {e.errores_checkout?.length ? (
                <div className="text-[11px] text-muted">Errores de formulario: {e.errores_checkout.map((x) => `${x.detalle} (${x.n})`).join(", ")}</div>
              ) : null}
              {e.respuestas && Object.keys(e.respuestas).length ? (
                <div className="text-[11px] text-muted">Respuestas de pago vistas: {Object.entries(e.respuestas).map(([k, v]) => `${k} ${v}`).join(" · ")}</div>
              ) : null}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-1 text-sm font-bold text-ink dark:text-white">Motivo del rechazo (MercadoPago)</h2>
          {data.motivos_rechazo.length ? (
            <table className="w-full text-xs">
              <tbody>
                {data.motivos_rechazo.map((m) => (
                  <tr key={m.motivo} className="border-t border-border/60">
                    <td className="py-1">{m.texto}</td>
                    <td className="py-1 text-right tabular-nums">{m.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-xs text-muted">Sin rechazos en el período.</p>
          )}
          <h2 className="mb-1 mt-3 text-sm font-bold text-ink dark:text-white">Por medio de pago</h2>
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted"><th className="py-1">Medio</th><th className="py-1 text-right">Aprobados</th><th className="py-1 text-right">Rechazados</th></tr></thead>
            <tbody>
              {data.medios.map((m) => (
                <tr key={m.medio} className="border-t border-border/60">
                  <td className="py-1">{m.medio}</td>
                  <td className="py-1 text-right tabular-nums">{m.aprobados}</td>
                  <td className="py-1 text-right tabular-nums">{m.rechazados}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {[
          ["Por valor del pedido", data.ticket.map((t) => ({ k: t.rango, a: t.abandonados, t: t.total, p: t.pct }))],
          ["Por franja horaria", data.horas.map((t) => ({ k: t.franja, a: t.abandonados, t: t.total, p: t.pct }))],
          ["Por ciudad", data.ciudades.map((t) => ({ k: t.ciudad, a: t.abandonados, t: t.total, p: t.pct }))],
        ].map(([titulo, filas]) => (
          <section key={String(titulo)}>
            <h2 className="mb-1 text-sm font-bold text-ink dark:text-white">{String(titulo)}</h2>
            <table className="w-full text-xs">
              <thead><tr className="text-left text-muted"><th className="py-1"></th><th className="py-1 text-right">Abandon.</th><th className="py-1 text-right">Total</th><th className="py-1 text-right">%</th></tr></thead>
              <tbody>
                {(filas as { k: string; a: number; t: number; p: number }[]).map((f) => (
                  <tr key={f.k} className="border-t border-border/60">
                    <td className="py-1">{f.k}</td>
                    <td className="py-1 text-right tabular-nums">{f.a}</td>
                    <td className="py-1 text-right tabular-nums">{f.t}</td>
                    <td className={`py-1 text-right tabular-nums ${f.p >= 50 ? "font-bold text-red-500" : ""}`}>{f.p} %</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <section>
          <h2 className="mb-1 text-sm font-bold text-ink dark:text-white">Productos que más se quedan en el carrito</h2>
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted"><th className="py-1">Producto</th><th className="py-1 text-right">Abandonadas</th><th className="py-1 text-right">Compradas</th></tr></thead>
            <tbody>
              {data.productos_abandonados.map((p) => (
                <tr key={p.producto} className="border-t border-border/60">
                  <td className="py-1">{p.producto}</td>
                  <td className="py-1 text-right tabular-nums">{p.unidades}</td>
                  <td className="py-1 text-right tabular-nums">{p.compradas}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section>
          <h2 className="mb-1 text-sm font-bold text-ink dark:text-white">Correos de recuperación</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Cifra label="Enviados" valor={data.correos.enviados} sub={Object.entries(data.correos.por_etapa).map(([k, v]) => `${k} ${v}`).join(" · ") || undefined} />
            <Cifra label="Abrieron el enlace" valor={data.correos.clics} sub={pct(data.correos.clics, data.correos.enviados)} />
            <Cifra label="Compraron después" valor={data.correos.recuperados} sub={pct(data.correos.recuperados, data.correos.enviados)} />
            <Cifra label="Pidieron no recibir" valor={data.correos.bajas} />
          </div>
          {data.recurrentes.length ? (
            <div className="mt-3">
              <h3 className="text-xs font-bold text-ink dark:text-white">Intentaron varias veces sin lograrlo</h3>
              <ul className="mt-1 flex flex-wrap gap-2 text-xs">
                {data.recurrentes.map((r) => (
                  <li key={r.email} className="rounded-full border border-border px-2 py-1">{r.email} <b className="tabular-nums">×{r.intentos}</b></li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      </div>

      <section>
        <h2 className="mb-1 text-sm font-bold text-ink dark:text-white">Últimos pedidos sin pagar</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted"><th className="py-1">Ref.</th><th className="py-1">Correo</th><th className="py-1 text-right">Total</th><th className="py-1">Estado</th><th className="py-1">Motivo / medio</th><th className="py-1">Fecha</th></tr></thead>
            <tbody>
              {data.abandonados_recientes.map((p) => (
                <tr key={p.reference} className="border-t border-border/60">
                  <td className="py-1 font-mono">{p.reference}</td>
                  <td className="py-1">{p.email}</td>
                  <td className="py-1 text-right tabular-nums">{COP(p.total)}</td>
                  <td className="py-1">{ESTADO[p.status] || p.status}</td>
                  <td className="py-1 text-muted">{[p.motivo, p.medio].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="py-1 text-muted">{p.created_at.slice(0, 16).replace("T", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
