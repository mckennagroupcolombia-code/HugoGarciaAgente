import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAppStore } from "../stores/app";

/**
 * Conciliación con el contador — wizard de hallazgos.
 *
 * **Por qué existe.** El cruce de las declaraciones del contador (350/490) contra
 * la cuenta 2365 del Libro Mayor encontró pagos sin registrar, compras a socios
 * que solo él tenía y retenciones indebidas — y todo eso vivía en un markdown
 * (docs/agentic/PENDIENTES-CONTABILIDAD.md). Acá cada inconsistencia es un paso:
 * se lee, se decide, y si toca resolverlo con el contador nace un TKT.
 *
 * **Una cosa a la vez, tipo Duolingo:** barra de avance arriba, una tarjeta por
 * hallazgo, botones grandes de decisión, y una pantalla de cierre cuando no
 * queda nada. La lista completa (con tickets y estados) vive en «Historial».
 *
 * El backend (app/services/conciliacion_contador.py) no llama a ningún LLM y
 * solo muta la base cuando el usuario marca un tercero como natural / SIMPLE.
 */

type AccionInfo = { id: string; label: string; muta_datos: boolean };

type Hallazgo = {
  id: number; clave: string; tipo: string; titulo: string; resumen: string; detalle: string;
  por_que: string; accion_sugerida: string; periodo: string; severidad: "alta" | "media" | "baja";
  monto: number; datos: Record<string, unknown>; acciones: string[]; acciones_info: AccionInfo[];
  tercero_id: number | null; estado: "pendiente" | "ticket" | "resuelto" | "descartado";
  decision: string; notas: string; ticket_id: number | null; ticket_numero: string; ticket_estado: string;
  decidido_por_nombre: string; decidido_en: string; vigente: number; updated_at: string;
};

type Job = { estado: "idle" | "corriendo" | "ok" | "error"; mensaje: string; inicio: string | null; fin: string | null };

type Resumen = {
  total: number; pendientes: number; con_ticket: number; resueltos: number; descartados: number;
  avance_pct: number; monto_pendiente: number; decididos_hoy: number; racha_dias: number;
  ultima_corrida: { fin: string; nuevos: number; cerrados: number; error: string; descargo_correo: number } | null;
  soportes: Record<string, { documentos: number; por_tipo: Record<string, number> }>;
  job: Job;
};

const TIPO_META: Record<string, { emoji: string; label: string }> = {
  soportes: { emoji: "📥", label: "Soportes" },
  "350_pj": { emoji: "🏢", label: "350 · personas jurídicas" },
  "350_pn": { emoji: "🧑", label: "350 · personas naturales" },
  pago_490: { emoji: "🏦", label: "Pago a la DIAN" },
  por_vencer: { emoji: "⏰", label: "Vence pronto" },
  faltantes: { emoji: "📭", label: "No llegó por correo" },
  tercero_tipo: { emoji: "🪪", label: "Tercero" },
  ret_simple: { emoji: "🚫", label: "Régimen SIMPLE" },
};

const SEV: Record<string, { label: string; cls: string; bar: string }> = {
  alta: { label: "Alta", cls: "bg-red-500/15 text-red-500", bar: "bg-red-500" },
  media: { label: "Media", cls: "bg-amber-500/15 text-amber-600", bar: "bg-amber-500" },
  baja: { label: "Baja", cls: "bg-sky-500/15 text-sky-500", bar: "bg-sky-500" },
};

const ESTADO_BADGE: Record<string, { label: string; cls: string }> = {
  pendiente: { label: "⏳ Por decidir", cls: "bg-amber-500/15 text-amber-600" },
  ticket: { label: "🎫 En ticket", cls: "bg-sky-500/15 text-sky-500" },
  resuelto: { label: "✅ Resuelto", cls: "bg-emerald-500/15 text-emerald-500" },
  descartado: { label: "➖ Descartado", cls: "bg-surface text-muted" },
};

const ACCION_STYLE: Record<string, string> = {
  crear_ticket: "bg-accent text-white hover:bg-accent-hover",
  resolver: "bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25",
  descartar: "bg-surface text-muted hover:bg-surface-hover",
  marcar_natural: "bg-sky-500/15 text-sky-600 hover:bg-sky-500/25",
  marcar_simple: "bg-violet-500/15 text-violet-600 hover:bg-violet-500/25",
  registrar_pago: "bg-emerald-600 text-white hover:bg-emerald-700",
  reabrir: "bg-surface text-muted hover:bg-surface-hover",
};

function cop(n: number | null | undefined): string {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n || 0);
}

function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "—";
  return iso.replace("T", " ").slice(0, 16);
}

export default function ConciliacionContadorPanel() {
  const qc = useQueryClient();
  const setPanel = useAppStore((s) => s.setPanel);
  const setTicketsBootView = useAppStore((s) => s.setTicketsBootView);
  const [vista, setVista] = useState<"wizard" | "historial">("wizard");
  const [idx, setIdx] = useState(0);
  const [notas, setNotas] = useState("");
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [esperandoJob, setEsperandoJob] = useState(false);

  const resumenQ = useQuery<Resumen>({
    queryKey: ["conciliacion-resumen"],
    queryFn: () => api.get("/api/conciliacion/resumen"),
    refetchInterval: esperandoJob ? 2500 : false,
  });
  const pendientesQ = useQuery<{ hallazgos: Hallazgo[] }>({
    queryKey: ["conciliacion-hallazgos", "pendiente"],
    queryFn: () => api.get("/api/conciliacion/hallazgos?estado=pendiente"),
  });
  const todosQ = useQuery<{ hallazgos: Hallazgo[] }>({
    queryKey: ["conciliacion-hallazgos", "todos"],
    queryFn: () => api.get("/api/conciliacion/hallazgos?estado=todos"),
    enabled: vista === "historial",
  });

  // El análisis corre en segundo plano (bajar del correo tarda más que el proxy);
  // se hace poll al resumen hasta que el job termine y entonces se recargan las listas.
  const job = resumenQ.data?.job;
  useEffect(() => {
    if (!esperandoJob || !job) return;
    if (job.estado === "ok" || job.estado === "error") {
      setEsperandoJob(false);
      setMsg({ tipo: job.estado === "ok" ? "ok" : "error", texto: job.mensaje || (job.estado === "ok" ? "Análisis listo" : "Falló el análisis") });
      qc.invalidateQueries({ queryKey: ["conciliacion-hallazgos"] });
      qc.invalidateQueries({ queryKey: ["contabilidad-checklist"] });
      setIdx(0);
    }
  }, [esperandoJob, job, qc]);

  useEffect(() => {
    if (!msg) return;
    const t = window.setTimeout(() => setMsg(null), 6000);
    return () => window.clearTimeout(t);
  }, [msg]);

  const analizar = useMutation({
    mutationFn: (descargar: boolean) => api.post<{ ok: boolean; job: Job }>("/api/conciliacion/analizar", { descargar_correo: descargar }),
    onSuccess: () => { setEsperandoJob(true); resumenQ.refetch(); },
    onError: (e: Error) => setMsg({ tipo: "error", texto: e.message }),
  });

  const decidir = useMutation({
    mutationFn: ({ id, accion }: { id: number; accion: string }) =>
      api.post<{ ok: boolean; hallazgo: Hallazgo; mensaje: string }>(`/api/conciliacion/hallazgos/${id}/decidir`, { accion, notas }),
    onSuccess: (r) => {
      setMsg({ tipo: "ok", texto: r.mensaje || "Listo" });
      setNotas("");
      qc.invalidateQueries({ queryKey: ["conciliacion-hallazgos"] });
      qc.invalidateQueries({ queryKey: ["conciliacion-resumen"] });
      qc.invalidateQueries({ queryKey: ["contabilidad-checklist"] });
    },
    onError: (e: Error) => setMsg({ tipo: "error", texto: e.message }),
  });

  const pendientes = pendientesQ.data?.hallazgos ?? [];
  const actual = pendientes[Math.min(idx, Math.max(0, pendientes.length - 1))];
  const r = resumenQ.data;
  const corriendo = esperandoJob || job?.estado === "corriendo";
  const sinSoportes = !r || Object.keys(r.soportes || {}).length === 0;

  const titulo = useMemo(() => {
    if (!r || r.total === 0) return "Cruce con el contador";
    if (pendientes.length === 0) return "¡Cruce al día!";
    return `Paso ${Math.min(idx, pendientes.length - 1) + 1} de ${pendientes.length}`;
  }, [r, pendientes.length, idx]);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-ink">Conciliación con el contador</h2>
          <p className="mt-1 max-w-2xl text-xs text-muted">
            Lo que el contador declaró (formularios 350, recibos 490) contra lo que el Libro Mayor tiene en la 2365.
            Cada diferencia es un paso: se decide aquí y, si hay que resolverla con él, se vuelve TKT.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={corriendo || analizar.isPending} onClick={() => analizar.mutate(false)}
            className="rounded-lg bg-surface px-3 py-2 text-xs font-bold text-ink hover:bg-surface-hover disabled:opacity-50">
            {corriendo ? "Cruzando…" : "↻ Volver a cruzar"}
          </button>
          <button type="button" disabled={corriendo || analizar.isPending} onClick={() => analizar.mutate(true)}
            className="rounded-lg bg-accent px-3 py-2 text-xs font-bold text-white hover:bg-accent-hover disabled:opacity-50">
            📥 Bajar del correo y analizar
          </button>
        </div>
      </header>

      {msg && (
        <p className={`rounded-lg px-3 py-2 text-xs font-bold ${msg.tipo === "ok" ? "bg-emerald-500/15 text-emerald-500" : "bg-red-500/15 text-red-500"}`}>
          {msg.texto}
        </p>
      )}

      {r && <Progreso r={r} corriendo={corriendo} />}

      <nav className="flex gap-1 rounded-lg bg-surface p-1 text-xs font-bold">
        {(["wizard", "historial"] as const).map((v) => (
          <button key={v} type="button" onClick={() => setVista(v)}
            className={`flex-1 rounded-md px-3 py-1.5 ${vista === v ? "bg-accent text-white" : "text-muted hover:text-ink"}`}>
            {v === "wizard" ? `Por decidir (${r?.pendientes ?? 0})` : `Historial (${r?.total ?? 0})`}
          </button>
        ))}
      </nav>

      {vista === "wizard" && (
        pendientesQ.isLoading ? (
          <Caja>Cargando hallazgos…</Caja>
        ) : !r || r.total === 0 ? (
          <Caja>
            <div className="space-y-2 text-center">
              <div className="text-4xl">🧭</div>
              <p className="text-sm font-bold text-ink">Todavía no se ha corrido el cruce</p>
              <p className="text-xs text-muted">
                {sinSoportes
                  ? "Primero hay que bajar del Gmail de la empresa los formularios que envía el contador. Tarda uno o dos minutos."
                  : "Ya hay soportes descargados; falta cruzarlos contra el Libro Mayor."}
              </p>
              <button type="button" disabled={corriendo} onClick={() => analizar.mutate(sinSoportes)}
                className="rounded-lg bg-accent px-4 py-2 text-xs font-bold text-white hover:bg-accent-hover disabled:opacity-50">
                {sinSoportes ? "📥 Bajar del correo y analizar" : "↻ Cruzar ahora"}
              </button>
            </div>
          </Caja>
        ) : pendientes.length === 0 ? (
          <Caja>
            <div className="space-y-2 text-center">
              <div className="text-5xl">🎉</div>
              <p className="text-base font-bold text-ink">¡Cruce al día!</p>
              <p className="text-xs text-muted">
                {r.con_ticket} hallazgo(s) esperando en tickets · {r.resueltos} resuelto(s) · {r.descartados} descartado(s).
                {r.racha_dias > 1 ? ` Llevas ${r.racha_dias} días seguidos revisando.` : ""}
              </p>
              <div className="flex justify-center gap-2">
                <button type="button" onClick={() => setVista("historial")} className="rounded-lg bg-surface px-3 py-2 text-xs font-bold text-ink hover:bg-surface-hover">Ver historial</button>
                {r.con_ticket > 0 && (
                  <button type="button" onClick={() => { setTicketsBootView("list"); setPanel("tickets"); }}
                    className="rounded-lg bg-accent px-3 py-2 text-xs font-bold text-white hover:bg-accent-hover">Ir a los tickets</button>
                )}
              </div>
            </div>
          </Caja>
        ) : actual ? (
          <Tarjeta
            h={actual}
            titulo={titulo}
            notas={notas}
            setNotas={setNotas}
            ocupado={decidir.isPending}
            onDecidir={(accion) => decidir.mutate({ id: actual.id, accion })}
            onSaltar={() => setIdx((i) => (i + 1) % pendientes.length)}
            onAtras={() => setIdx((i) => (i - 1 + pendientes.length) % pendientes.length)}
          />
        ) : null
      )}

      {vista === "historial" && (
        <Historial
          items={todosQ.data?.hallazgos ?? []}
          cargando={todosQ.isLoading}
          onReabrir={(id) => decidir.mutate({ id, accion: "reabrir" })}
          onIrTicket={() => { setTicketsBootView("list"); setPanel("tickets"); }}
        />
      )}

      {r?.ultima_corrida && (
        <p className="text-[11px] text-muted">
          Último cruce: {fechaCorta(r.ultima_corrida.fin)} · {r.ultima_corrida.nuevos} nuevo(s), {r.ultima_corrida.cerrados} cerrado(s) por sí solos
          {r.ultima_corrida.descargo_correo ? ` · ${r.ultima_corrida.descargo_correo} archivo(s) nuevos del correo` : ""}
          {r.ultima_corrida.error ? ` · ⚠️ ${r.ultima_corrida.error}` : ""}.
          {" "}Soportes: {Object.entries(r.soportes).map(([a, s]) => `${a}: ${s.documentos} doc.`).join(" · ") || "ninguno"}.
        </p>
      )}
    </div>
  );
}

function Progreso({ r, corriendo }: { r: Resumen; corriendo: boolean }) {
  const pct = r.total ? Math.round(100 * (r.total - r.pendientes) / r.total) : 0;
  return (
    <section className="rounded-xl border border-border bg-surface-elevated p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-bold text-ink">{r.pendientes} por decidir · {r.con_ticket} en ticket · {r.resueltos + r.descartados} cerrados</span>
        <span className="text-muted">
          {r.monto_pendiente > 0 ? `${cop(r.monto_pendiente)} en juego` : "nada pendiente"}
          {r.decididos_hoy > 0 ? ` · 🔥 ${r.decididos_hoy} hoy` : ""}
          {r.racha_dias > 1 ? ` · ${r.racha_dias} días seguidos` : ""}
        </span>
      </div>
      <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-surface">
        <div className={`h-full rounded-full transition-all ${corriendo ? "animate-pulse bg-accent/60" : "bg-emerald-500"}`} style={{ width: `${Math.max(pct, corriendo ? 30 : 0)}%` }} />
      </div>
      {corriendo && <p className="mt-1 text-[11px] text-muted">{r.job?.mensaje || "Cruzando…"}</p>}
    </section>
  );
}

function Tarjeta({ h, titulo, notas, setNotas, ocupado, onDecidir, onSaltar, onAtras }: {
  h: Hallazgo; titulo: string; notas: string; setNotas: (v: string) => void; ocupado: boolean;
  onDecidir: (accion: string) => void; onSaltar: () => void; onAtras: () => void;
}) {
  const meta = TIPO_META[h.tipo] ?? { emoji: "🔎", label: h.tipo };
  const sev = SEV[h.severidad] ?? SEV.media;
  const terceros = h.datos?.terceros_libro as Record<string, { retencion: number; tipo_persona?: string } | number> | undefined;
  const periodos = h.datos?.periodos as string[] | undefined;
  const movimientos = h.datos?.movimientos as number[] | undefined;
  const archivo = h.datos?.archivo as string | undefined;

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface-elevated shadow-sm">
      <div className={`h-1.5 ${sev.bar}`} />
      <div className="space-y-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-muted">{titulo}</span>
          <div className="flex gap-2">
            <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-bold text-muted">{meta.label}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${sev.cls}`}>Prioridad {sev.label}</span>
            {h.periodo && <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-bold text-muted">{h.periodo}</span>}
          </div>
        </div>

        <div className="flex items-start gap-4">
          <div className="text-5xl leading-none">{meta.emoji}</div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold leading-snug text-ink">{h.titulo}</h3>
            <p className="mt-1 text-sm text-ink/90">{h.resumen}</p>
            {h.monto > 0 && <p className="mt-2 text-2xl font-black text-ink">{cop(h.monto)}</p>}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-surface p-3">
            <p className="text-[11px] font-bold uppercase text-muted">Por qué importa</p>
            <p className="mt-1 text-xs leading-relaxed text-ink/90">{h.por_que}</p>
          </div>
          <div className="rounded-xl bg-surface p-3">
            <p className="text-[11px] font-bold uppercase text-muted">Qué se sugiere</p>
            <p className="mt-1 text-xs leading-relaxed text-ink/90">{h.accion_sugerida}</p>
          </div>
        </div>

        {terceros && Object.keys(terceros).length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-xs">
              <thead className="bg-surface text-left text-[11px] uppercase text-muted">
                <tr><th className="px-3 py-1.5">Tercero en el libro ese mes</th><th className="px-3 py-1.5">Tipo</th><th className="px-3 py-1.5 text-right">Retención</th></tr>
              </thead>
              <tbody>
                {Object.entries(terceros).map(([nombre, v]) => {
                  const ret = typeof v === "number" ? v : v.retencion;
                  const tp = typeof v === "number" ? "" : (v.tipo_persona ?? "");
                  return (
                    <tr key={nombre} className="border-t border-border">
                      <td className="px-3 py-1.5 text-ink">{nombre}</td>
                      <td className="px-3 py-1.5 text-muted">{tp}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-ink">{cop(ret)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {periodos && periodos.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {periodos.map((p) => <span key={p} className="rounded-md bg-surface px-2 py-0.5 font-mono text-[11px] text-ink">{p}</span>)}
          </div>
        )}
        {movimientos && movimientos.length > 0 && (
          <p className="text-[11px] text-muted">Asientos del Libro Mayor: {movimientos.map((m) => `#${m}`).join(", ")}</p>
        )}
        {archivo && <p className="truncate text-[11px] text-muted" title={archivo}>Soporte: {archivo}</p>}

        <label className="block">
          <span className="text-[11px] font-bold uppercase text-muted">Notas (van al ticket si lo creas)</span>
          <textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2}
            placeholder="Qué revisaste, con quién lo hablaste, qué se acordó…"
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-ink outline-none focus:border-accent" />
        </label>

        <div className="flex flex-wrap gap-2">
          {h.acciones_info.map((a) => (
            <button key={a.id} type="button" disabled={ocupado} onClick={() => onDecidir(a.id)}
              title={a.muta_datos ? "Cambia datos del tercero en el Libro Mayor" : undefined}
              className={`rounded-xl px-4 py-2.5 text-xs font-bold transition disabled:opacity-50 ${ACCION_STYLE[a.id] ?? "bg-surface text-ink"}`}>
              {a.label}{a.muta_datos ? " ✎" : ""}
            </button>
          ))}
          <span className="flex-1" />
          <button type="button" onClick={onAtras} className="rounded-xl px-3 py-2.5 text-xs font-bold text-muted hover:text-ink">← Anterior</button>
          <button type="button" onClick={onSaltar} className="rounded-xl px-3 py-2.5 text-xs font-bold text-muted hover:text-ink">Saltar →</button>
        </div>
      </div>
    </section>
  );
}

function Historial({ items, cargando, onReabrir, onIrTicket }: {
  items: Hallazgo[]; cargando: boolean; onReabrir: (id: number) => void; onIrTicket: () => void;
}) {
  if (cargando) return <Caja>Cargando historial…</Caja>;
  if (items.length === 0) return <Caja>Sin hallazgos todavía.</Caja>;
  return (
    <div className="space-y-2">
      {items.map((h) => {
        const meta = TIPO_META[h.tipo] ?? { emoji: "🔎", label: h.tipo };
        const est = ESTADO_BADGE[h.estado] ?? ESTADO_BADGE.pendiente;
        return (
          <div key={h.id} className={`flex flex-wrap items-start gap-3 rounded-xl border border-border bg-surface-elevated p-3 ${h.vigente ? "" : "opacity-70"}`}>
            <div className="text-2xl leading-none">{meta.emoji}</div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-ink">{h.titulo}</p>
              <p className="text-[11px] text-muted">
                {meta.label}{h.periodo ? ` · ${h.periodo}` : ""}{h.monto > 0 ? ` · ${cop(h.monto)}` : ""}
                {h.decidido_por_nombre ? ` · ${h.decidido_por_nombre}, ${fechaCorta(h.decidido_en)}` : ""}
                {!h.vigente ? " · ya no se detecta" : ""}
              </p>
              {h.notas && <p className="mt-1 text-[11px] italic text-ink/80">“{h.notas}”</p>}
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${est.cls}`}>{est.label}</span>
              {h.ticket_numero && (
                <button type="button" onClick={onIrTicket} className="font-mono text-[11px] text-accent hover:underline">
                  {h.ticket_numero}{h.ticket_estado ? ` · ${h.ticket_estado}` : ""}
                </button>
              )}
              {h.estado !== "pendiente" && h.estado !== "ticket" && h.vigente === 1 && (
                <button type="button" onClick={() => onReabrir(h.id)} className="text-[11px] text-muted hover:text-ink">Reabrir</button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Caja({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-border bg-surface-elevated p-6 text-xs text-muted">{children}</div>;
}
