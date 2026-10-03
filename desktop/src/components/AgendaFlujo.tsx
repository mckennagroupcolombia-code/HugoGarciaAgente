import { useMemo } from "react";
import { ETAPAS_APP } from "../lib/flujoApp";
import { etapaDeTicket, type UbicacionTicket } from "../lib/flujoTickets";
import { puedeVerSeccionPanel } from "../lib/panelAccess";
import { PANEL_INFO } from "../lib/panelInfo";
import { useAppStore, type Panel } from "../stores/app";
import { useTicketsAuth } from "../stores/ticketsAuth";

/**
 * «Tu día, en orden» — el interior de la Agenda con la misma gramática del flujo.
 *
 * Tres carriles en secuencia: lo que te pidieron (solicitudes asignadas) ⇢ lo que puedes
 * iniciar (acciones activas) ⇢ lo que te espera (recordatorios). Cada nodo abre su ticket,
 * como siempre; y a la derecha dice a qué ETAPA del negocio pertenece, para saltar al panel
 * donde eso se resuelve. Debajo, las etapas en secuencia con cuántas cosas tuyas hay en cada
 * una: la Agenda es el origen y aquí se ve a dónde lleva.
 *
 * La etapa de un ticket es una sugerencia por palabras del título (lib/flujoTickets.ts, sin IA);
 * si no hay regla que aplique, el nodo no lleva etapa.
 */

type Ticket = { id: number; titulo: string; categoria?: string | null; creado_por?: number; creado_por_nombre?: string | null };
type Recordatorio = { id: number; titulo: string; proxima_fecha?: string | null };

const MAX = 4;

function Conector() {
  return (
    <div className="flex shrink-0 items-center justify-center py-1 text-muted lg:w-6 lg:py-0 lg:pt-9" aria-hidden="true">
      <span className="lg:hidden">⇣</span>
      <span className="hidden lg:inline">⇢</span>
    </div>
  );
}

export default function AgendaFlujo({
  userId,
  solicitudes,
  acciones,
  recordatorios,
  hoy,
  verSolicitudes,
  verAcciones,
  onSolicitudes,
  onVerSolicitud,
  onAcciones,
  onRecordatorios,
}: {
  userId: number;
  solicitudes: Ticket[];
  acciones: Ticket[];
  recordatorios: Recordatorio[];
  hoy: string;
  verSolicitudes: boolean;
  verAcciones: boolean;
  onSolicitudes: () => void;
  onVerSolicitud: (id: number) => void;
  onAcciones: () => void;
  onRecordatorios: () => void;
}) {
  const setPanel = useAppStore((s) => s.setPanel);
  const user = useTicketsAuth((s) => s.user);
  const puede = (p: Panel) => Boolean(user && puedeVerSeccionPanel(user, p));

  // Cuántas cosas mías hay en cada etapa, y a qué panel lleva la primera.
  const porEtapa = useMemo(() => {
    const m = new Map<string, { n: number; panel: Panel }>();
    for (const t of [...(verSolicitudes ? solicitudes : []), ...(verAcciones ? acciones : [])]) {
      const u = etapaDeTicket(t);
      if (!u) continue;
      const act = m.get(u.etapa.id);
      m.set(u.etapa.id, { n: (act?.n ?? 0) + 1, panel: act?.panel ?? u.panel });
    }
    return m;
  }, [solicitudes, acciones, verSolicitudes, verAcciones]);
  const sinEtapa = (verSolicitudes ? solicitudes : []).concat(verAcciones ? acciones : []).filter((t) => !etapaDeTicket(t)).length;

  const ChipEtapa = ({ u }: { u: UbicacionTicket }) => {
    const ok = puede(u.panel);
    const cls = "mck-flujo-nodo shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-bold";
    return ok ? (
      <button type="button" onClick={() => setPanel(u.panel)} title={`Se resuelve en ${u.etapa.titulo} → ${PANEL_INFO[u.panel]?.label ?? u.panel}`} className={`${cls} border-accent/40 text-accent hover:bg-accent/10`}>
        ⇢ {u.etapa.titulo}
      </button>
    ) : (
      <span title={`Pertenece a la etapa ${u.etapa.titulo}`} className={`${cls} border-border text-muted`}>{u.etapa.titulo}</span>
    );
  };

  const NodoTicket = ({ t, abrir }: { t: Ticket; abrir: () => void }) => {
    const u = etapaDeTicket(t);
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-input px-2 py-1.5 transition hover:border-accent/50">
        <button type="button" onClick={abrir} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[12.5px] font-semibold text-ink">{t.titulo}</span>
          {t.creado_por_nombre && t.creado_por !== userId && <span className="block truncate text-[10px] text-muted">Pidió: {t.creado_por_nombre}</span>}
        </button>
        {u && <ChipEtapa u={u} />}
      </div>
    );
  };

  const Carril = ({ n, titulo, sub, total, vacio, onVerTodo, children }: { n: number; titulo: string; sub: string; total: number; vacio: string; onVerTodo: () => void; children: React.ReactNode }) => (
    <div className="mck-flujo-tramo min-w-0 flex-1 rounded-xl border border-dashed border-border p-2">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-[9.5px] font-bold uppercase tracking-wider text-muted">{n} · {sub}</p>
          <p className="mck-flujo-nodo text-[13px] font-bold text-ink">
            {titulo}
            {total > 0 && <span className="ml-1.5 rounded-full bg-accent px-1.5 text-[10px] tabular-nums text-white">{total}</span>}
          </p>
        </div>
        <button type="button" onClick={onVerTodo} className="shrink-0 text-[11px] font-semibold text-accent hover:underline">
          {total > MAX ? `Ver las ${total} →` : "Abrir →"}
        </button>
      </div>
      {total === 0 ? <p className="py-1 text-[12px] text-muted">{vacio}</p> : <div className="space-y-1">{children}</div>}
    </div>
  );

  const etapasConLoMio = ETAPAS_APP.filter((e) => e.tipo === "linea");

  return (
    <section className="mck-card bg-[rgb(var(--mck-card-bg))] p-3" aria-label="Tu día, en orden">
      <div className="flex flex-col lg:flex-row lg:items-stretch">
        {verSolicitudes && (
          <Carril n={1} titulo="Me pidieron" sub="solicitudes a tu nombre" total={solicitudes.length} vacio="Nadie te ha pedido nada." onVerTodo={onSolicitudes}>
            {solicitudes.slice(0, MAX).map((s) => (
              <NodoTicket key={s.id} t={s} abrir={() => onVerSolicitud(s.id)} />
            ))}
          </Carril>
        )}
        {verSolicitudes && verAcciones && <Conector />}
        {verAcciones && (
          <Carril n={2} titulo="Puedo iniciar" sub="acciones activas" total={acciones.length} vacio="Sin acciones activas." onVerTodo={onAcciones}>
            {acciones.slice(0, MAX).map((a) => (
              <NodoTicket key={a.id} t={a} abrir={onAcciones} />
            ))}
          </Carril>
        )}
        {verAcciones && <Conector />}
        {verAcciones && (
          <Carril n={3} titulo="Me espera" sub="recordatorios" total={recordatorios.length} vacio="Sin recordatorios programados." onVerTodo={onRecordatorios}>
            {recordatorios.slice(0, MAX).map((r) => {
              const vencido = (r.proxima_fecha ?? "") <= hoy;
              return (
                <button key={r.id} type="button" onClick={onRecordatorios} className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface-input px-2 py-1.5 text-left transition hover:border-accent/50">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">{r.titulo}</span>
                  <span className={`mck-flujo-nodo shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${vencido ? "border-accent-sun/60 bg-accent-sun/15 text-ink" : "border-border text-muted"}`}>
                    {vencido ? "hoy" : r.proxima_fecha ? r.proxima_fecha.slice(5).replace("-", "/") : ""}
                  </span>
                </button>
              );
            })}
          </Carril>
        )}
      </div>

      {/* A dónde lleva tu día: lo tuyo repartido en la secuencia del negocio */}
      {(porEtapa.size > 0 || sinEtapa > 0) && (
        <div className="mt-3 border-t border-border/70 pt-2">
          <p className="mb-1.5 font-mono text-[9.5px] font-bold uppercase tracking-wider text-muted">⇣ a dónde lleva tu día</p>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {etapasConLoMio.map((e, i) => {
              const mio = porEtapa.get(e.id);
              const ok = mio && puede(mio.panel);
              return (
                <span key={e.id} className="flex shrink-0 items-center gap-1.5">
                  {i > 0 && <span className="text-[11px] text-muted" aria-hidden="true">⇢</span>}
                  <button
                    type="button"
                    disabled={!ok}
                    onClick={() => mio && setPanel(mio.panel)}
                    title={mio ? `${mio.n} de tus pendientes se resuelven en ${e.titulo}` : `Nada tuyo en ${e.titulo}`}
                    className={`mck-flujo-nodo flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] font-bold ${
                      mio ? "border-accent bg-accent/10 text-ink hover:bg-accent/20" : "border-border text-muted opacity-60"
                    } ${ok ? "" : "cursor-default"}`}
                  >
                    {e.titulo}
                    {mio && <span className="rounded-full bg-accent px-1.5 text-[10px] tabular-nums text-white">{mio.n}</span>}
                  </button>
                </span>
              );
            })}
            {sinEtapa > 0 && <span className="ml-2 shrink-0 font-mono text-[10px] text-muted">+{sinEtapa} sin etapa</span>}
          </div>
        </div>
      )}
    </section>
  );
}
