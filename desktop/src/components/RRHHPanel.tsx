import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { AddIconButton } from "./AddIconButton";

// ── Tipos ──────────────────────────────────────────────────────────────────────

interface ActividadMes {
  horas: number;
  dias: number;
  sesiones: number;
}

interface ActividadUsuario {
  usuario_id: number;
  nombre: string;
  horas_total: number;
  dias_total: number;
  sesiones_total: number;
  por_mes: Record<string, ActividadMes>;
  tickets_asignados: number;
  tickets_resueltos: number;
  solicitudes_resueltas: number;
  ultimo_uso_panel: string | null;
}

interface WhatsAppMes {
  mes: string;
  entrantes: number;
  salientes_humano: number;
  salientes_bot: number;
  contactos_unicos: number;
}

interface VentasMes {
  mes: string;
  contactos_wa: number;
  comprobantes_wa: number;
  pagos_confirmados_wa: number;
  conversion_comprobante_pct: number | null;
  web: {
    pedidos: number;
    aprobados: number;
    valor_aprobado: number;
    rechazados: number;
    valor_rechazado: number;
  };
}

interface NominaFila {
  persona: string;
  esquema: string;
  devengado: number;
  deducciones: number;
  deducciones_detalle: string;
  neto: number;
  puntaje: number | null;
  notas: string;
}

interface Resumen {
  generado: string;
  actividad_equipo: ActividadUsuario[];
  whatsapp: WhatsAppMes[];
  ventas: VentasMes[];
  nomina: NominaFila[];
  matriz_factores: Record<string, unknown>;
  hallazgos_abiertos: number;
}

interface NotaHallazgo {
  texto: string;
  autor: string;
  fecha: string;
}

interface Hallazgo {
  id: number;
  titulo: string;
  categoria: string;
  severidad: string;
  estado: string;
  detalle: string;
  accion: string;
  responsable: string;
  notas: NotaHallazgo[];
  creado: string;
  actualizado: string;
}

type Tab = "resumen" | "hallazgos" | "nomina" | "agente";

// ── Helpers ────────────────────────────────────────────────────────────────────

function cop(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);
}

/** Mes vencido = último mes calendario cerrado (M-1).
 *  Mes corrido = mes calendario en curso (M); cifras solo al cierre, no parciales. */
function mesesResumenReferencia(ahora = new Date()): { corrido: string; vencido: string } {
  const y = ahora.getFullYear();
  const m = ahora.getMonth(); // 0-11
  const toYm = (year: number, month0: number) =>
    `${year}-${String(month0 + 1).padStart(2, "0")}`;
  const vencidoDate = new Date(y, m - 1, 1);
  const corridoDate = new Date(y, m, 1);
  return {
    vencido: toYm(vencidoDate.getFullYear(), vencidoDate.getMonth()),
    corrido: toYm(corridoDate.getFullYear(), corridoDate.getMonth()),
  };
}

function ymCalendario(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** True si el mes YYYY-MM ya terminó (cierre calendario). */
function mesYaCerrado(ym: string, ahora = new Date()): boolean {
  return ym < ymCalendario(ahora);
}

function etiquetaCierreMes(ym: string): string {
  const [ys, ms] = ym.split("-");
  const idx = Math.max(0, Math.min(11, (parseInt(ms || "1", 10) || 1) - 1));
  const nombre = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][idx];
  return `Cierre ${nombre} ${ys ?? ""}`;
}

function ultimoDiaMes(ym: string): string {
  const [ys, ms] = ym.split("-");
  const y = parseInt(ys || "2000", 10);
  const m = parseInt(ms || "1", 10);
  const last = new Date(y, m, 0).getDate();
  const idx = Math.max(0, Math.min(11, m - 1));
  const nombre = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][idx];
  return `${last} ${nombre}`;
}

function actividadDeMes(
  porMes: Record<string, ActividadMes>,
  mes: string,
): ActividadMes {
  return porMes[mes] ?? { horas: 0, dias: 0, sesiones: 0 };
}

const SEVERIDAD_CHIP: Record<string, string> = {
  critica: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
  alta: "bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300",
  media: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  baja: "bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300",
};

const ESTADO_CHIP: Record<string, string> = {
  pendiente: "bg-red-50 text-red-600 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900",
  en_curso: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900",
  resuelto: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
  descartado: "bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-900/60 dark:text-slate-400 dark:border-slate-700",
};

const ESTADO_LABEL: Record<string, string> = {
  pendiente: "Pendiente",
  en_curso: "En curso",
  resuelto: "Resuelto",
  descartado: "Descartado",
};

const CATEGORIA_LABEL: Record<string, string> = {
  nomina_ugpp: "Nómina / UGPP",
  equidad_interna: "Equidad interna",
  carga_laboral: "Carga laboral",
  capacidad_ventas: "Capacidad de ventas",
  flujo_caja: "Flujo de caja",
  plan_accion: "Plan de acción",
  otro: "Otro",
};

// ── Sub-vistas ─────────────────────────────────────────────────────────────────

function TabResumen({ resumen }: { resumen: Resumen }) {
  const { corrido, vencido } = useMemo(() => mesesResumenReferencia(), []);
  const corridoCerrado = mesYaCerrado(corrido);

  return (
    <div className="space-y-6">
      {/* Actividad del equipo */}
      <section>
        <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-muted">
          Carga digital por persona (panel /app)
        </h3>
        <p className="mb-3 text-xs text-muted">
          Cifras al cierre de mes calendario (sin parciales). Mes vencido: {etiquetaCierreMes(vencido)}.
          Mes corrido: {etiquetaCierreMes(corrido)}
          {!corridoCerrado ? ` — disponible al cierre (${ultimoDiaMes(corrido)})` : ""}.
          Mide trabajo digital — no captura bodega, empaque ni atención telefónica.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {resumen.actividad_equipo.map((u) => {
            const mesVencido = actividadDeMes(u.por_mes, vencido);
            const mesCorrido = actividadDeMes(u.por_mes, corrido);
            return (
              <div key={u.usuario_id} className="rounded-xl border border-border bg-surface-panel p-4">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <p className="truncate text-sm font-extrabold text-ink">{u.nombre}</p>
                  <p className="shrink-0 text-[10px] text-muted">
                    {u.tickets_resueltos}
                    <span className="font-semibold">/{u.tickets_asignados}</span> tickets
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-surface px-2.5 py-2">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Mes vencido</p>
                    <p className="text-[10px] text-muted">{etiquetaCierreMes(vencido)}</p>
                    <p className="mt-1 text-lg font-black text-ink">{mesVencido.horas}h</p>
                    <p className="text-[10px] text-muted">{mesVencido.dias} días activos</p>
                  </div>
                  <div className="rounded-lg border border-accent/30 bg-accent/5 px-2.5 py-2">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-accent">Mes corrido</p>
                    <p className="text-[10px] text-muted">{etiquetaCierreMes(corrido)}</p>
                    {corridoCerrado ? (
                      <>
                        <p className="mt-1 text-lg font-black text-accent">{mesCorrido.horas}h</p>
                        <p className="text-[10px] text-muted">{mesCorrido.dias} días activos</p>
                      </>
                    ) : (
                      <p className="mt-2 text-xs font-semibold text-muted">
                        Al cierre
                        <span className="block text-[10px] font-normal">({ultimoDiaMes(corrido)})</span>
                      </p>
                    )}
                  </div>
                </div>
                <p className="mt-2 text-[10px] text-muted">
                  {u.solicitudes_resueltas} solicitudes resueltas · último uso: {u.ultimo_uso_panel ?? "—"}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* WhatsApp mensual */}
      <section>
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">
          Carga del canal WhatsApp (bot pausado — respuestas humanas)
        </h3>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-surface text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2">Mes</th>
                <th className="px-3 py-2 text-right">Entrantes</th>
                <th className="px-3 py-2 text-right">Respuestas humano</th>
                <th className="px-3 py-2 text-right">Respuestas bot</th>
                <th className="px-3 py-2 text-right">Contactos únicos</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-surface-panel">
              {resumen.whatsapp.map((w) => (
                <tr key={w.mes}>
                  <td className="px-3 py-2 font-semibold text-ink">{w.mes}</td>
                  <td className="px-3 py-2 text-right text-ink">{w.entrantes}</td>
                  <td className="px-3 py-2 text-right font-bold text-accent">{w.salientes_humano}</td>
                  <td className="px-3 py-2 text-right text-muted">{w.salientes_bot}</td>
                  <td className="px-3 py-2 text-right text-ink">{w.contactos_unicos}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Ventas / conversión */}
      <section>
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">
          Ventas por WhatsApp y tienda web
        </h3>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="bg-surface text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2">Mes</th>
                <th className="px-3 py-2 text-right">Contactos WA</th>
                <th className="px-3 py-2 text-right">Comprobantes</th>
                <th className="px-3 py-2 text-right">Pagos confirmados</th>
                <th className="px-3 py-2 text-right">Conversión</th>
                <th className="px-3 py-2 text-right">Web aprobados</th>
                <th className="px-3 py-2 text-right">Web rechazados</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-surface-panel">
              {resumen.ventas.map((v) => (
                <tr key={v.mes}>
                  <td className="px-3 py-2 font-semibold text-ink">{v.mes}</td>
                  <td className="px-3 py-2 text-right text-ink">{v.contactos_wa}</td>
                  <td className="px-3 py-2 text-right text-ink">{v.comprobantes_wa}</td>
                  <td className="px-3 py-2 text-right font-bold text-accent">{v.pagos_confirmados_wa}</td>
                  <td className="px-3 py-2 text-right text-ink">
                    {v.conversion_comprobante_pct != null ? `${v.conversion_comprobante_pct}%` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-emerald-600 dark:text-emerald-400">
                    {v.web.aprobados} · {cop(v.web.valor_aprobado)}
                  </td>
                  <td className="px-3 py-2 text-right text-red-500">
                    {v.web.rechazados > 0 ? `${v.web.rechazados} · ${cop(v.web.valor_rechazado)}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">
          Conversión = comprobantes recibidos / contactos únicos del mes. Una caída con demanda
          creciente indica saturación de la capacidad de atención.
        </p>
      </section>
    </div>
  );
}

function TabHallazgos() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["rrhh-hallazgos"],
    queryFn: () => api.get<{ hallazgos: Hallazgo[] }>("/api/rrhh/hallazgos"),
  });
  const [filtro, setFiltro] = useState<string>("abiertos");
  const [notaDraft, setNotaDraft] = useState<Record<number, string>>({});
  const [nuevoAbierto, setNuevoAbierto] = useState(false);
  const [nuevo, setNuevo] = useState({ titulo: "", detalle: "", accion: "", categoria: "otro", severidad: "media", responsable: "" });

  const patchHallazgo = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      api.patch<Hallazgo>(`/api/rrhh/hallazgos/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rrhh-hallazgos"] }),
  });
  const crear = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<Hallazgo>("/api/rrhh/hallazgos", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rrhh-hallazgos"] });
      setNuevoAbierto(false);
      setNuevo({ titulo: "", detalle: "", accion: "", categoria: "otro", severidad: "media", responsable: "" });
    },
  });
  const borrar = useMutation({
    mutationFn: (id: number) => api.delete<{ ok: boolean }>(`/api/rrhh/hallazgos/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rrhh-hallazgos"] }),
  });

  const hallazgos = data?.hallazgos ?? [];
  const visibles = hallazgos.filter((h) => {
    if (filtro === "todos") return true;
    if (filtro === "abiertos") return h.estado === "pendiente" || h.estado === "en_curso";
    return h.estado === filtro;
  });

  if (isLoading) return <p className="text-sm text-muted">Cargando hallazgos…</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {["abiertos", "pendiente", "en_curso", "resuelto", "descartado", "todos"].map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFiltro(f)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
              filtro === f
                ? "border-accent bg-accent text-white"
                : "border-border bg-surface-panel text-muted hover:text-ink"
            }`}
          >
            {f === "abiertos" ? "Abiertos" : f === "todos" ? "Todos" : ESTADO_LABEL[f] ?? f}
          </button>
        ))}
        <div className="flex-1" />
        <AddIconButton title="Nuevo hallazgo" open={nuevoAbierto} onClick={() => setNuevoAbierto((v) => !v)} />
      </div>

      {nuevoAbierto && (
        <div className="space-y-2 rounded-xl border border-accent/40 bg-surface-panel p-4">
          <input
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
            placeholder="Título del hallazgo"
            value={nuevo.titulo}
            onChange={(e) => setNuevo({ ...nuevo, titulo: e.target.value })}
          />
          <textarea
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
            rows={2}
            placeholder="Detalle / evidencia"
            value={nuevo.detalle}
            onChange={(e) => setNuevo({ ...nuevo, detalle: e.target.value })}
          />
          <textarea
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
            rows={1}
            placeholder="Acción recomendada"
            value={nuevo.accion}
            onChange={(e) => setNuevo({ ...nuevo, accion: e.target.value })}
          />
          <div className="flex flex-wrap gap-2">
            <select
              className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-ink"
              value={nuevo.categoria}
              onChange={(e) => setNuevo({ ...nuevo, categoria: e.target.value })}
            >
              {Object.entries(CATEGORIA_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <select
              className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-ink"
              value={nuevo.severidad}
              onChange={(e) => setNuevo({ ...nuevo, severidad: e.target.value })}
            >
              {["critica", "alta", "media", "baja"].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <input
              className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-ink"
              placeholder="Responsable"
              value={nuevo.responsable}
              onChange={(e) => setNuevo({ ...nuevo, responsable: e.target.value })}
            />
            <div className="flex-1" />
            <button
              type="button"
              disabled={!nuevo.titulo.trim() || crear.isPending}
              onClick={() => crear.mutate(nuevo)}
              className="rounded-lg bg-accent px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50"
            >
              Guardar
            </button>
          </div>
        </div>
      )}

      {visibles.length === 0 && (
        <p className="rounded-xl border border-border bg-surface-panel p-6 text-center text-sm text-muted">
          No hay hallazgos en este filtro.
        </p>
      )}

      {visibles.map((h) => (
        <div key={h.id} className="rounded-xl border border-border bg-surface-panel p-4">
          <div className="flex flex-wrap items-start gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${SEVERIDAD_CHIP[h.severidad] ?? SEVERIDAD_CHIP.baja}`}>
              {h.severidad}
            </span>
            <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold text-muted">
              {CATEGORIA_LABEL[h.categoria] ?? h.categoria}
            </span>
            {h.responsable && (
              <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] text-muted">
                👤 {h.responsable}
              </span>
            )}
            <div className="flex-1" />
            <select
              value={h.estado}
              onChange={(e) => patchHallazgo.mutate({ id: h.id, body: { estado: e.target.value } })}
              className={`rounded-lg border px-2 py-1 text-xs font-semibold ${ESTADO_CHIP[h.estado] ?? ""}`}
            >
              {Object.entries(ESTADO_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <button
              type="button"
              title="Eliminar hallazgo"
              onClick={() => {
                if (window.confirm(`¿Eliminar "${h.titulo}"?`)) borrar.mutate(h.id);
              }}
              className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
            >
              ✕
            </button>
          </div>
          <p className="mt-2 text-sm font-extrabold text-ink">{h.titulo}</p>
          {h.detalle && <p className="mt-1 text-sm leading-relaxed text-ink-secondary">{h.detalle}</p>}
          {h.accion && (
            <p className="mt-2 rounded-lg bg-accent/5 px-3 py-2 text-xs text-ink">
              <span className="font-bold text-accent">Acción: </span>{h.accion}
            </p>
          )}
          {(h.notas ?? []).length > 0 && (
            <div className="mt-2 space-y-1 border-t border-border pt-2">
              {h.notas.map((n, i) => (
                <p key={i} className="text-xs text-muted">
                  <span className="font-semibold text-ink-secondary">{n.autor}</span> ({n.fecha}): {n.texto}
                </p>
              ))}
            </div>
          )}
          <div className="mt-2 flex gap-2">
            <input
              className="flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-ink"
              placeholder="Agregar nota de seguimiento…"
              value={notaDraft[h.id] ?? ""}
              onChange={(e) => setNotaDraft({ ...notaDraft, [h.id]: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (notaDraft[h.id] ?? "").trim()) {
                  patchHallazgo.mutate({ id: h.id, body: { nota: notaDraft[h.id].trim() } });
                  setNotaDraft({ ...notaDraft, [h.id]: "" });
                }
              }}
            />
          </div>
          <p className="mt-1.5 text-[10px] text-muted">Creado {h.creado} · actualizado {h.actualizado}</p>
        </div>
      ))}
    </div>
  );
}

function TabNomina({ resumen, onRefetch }: { resumen: Resumen; onRefetch: () => void }) {
  const [filas, setFilas] = useState<NominaFila[]>(() => resumen.nomina.map((f) => ({ ...f })));
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState("");

  const lineaPunto = Number(
    (resumen.matriz_factores as { linea_por_punto_cop?: number })?.linea_por_punto_cop ?? 760000,
  );

  const set = (i: number, campo: keyof NominaFila, valor: string) => {
    setFilas((prev) => {
      const next = [...prev];
      const fila = { ...next[i] };
      if (campo === "devengado" || campo === "deducciones" || campo === "neto") {
        (fila[campo] as number) = Number(valor.replace(/[^\d.]/g, "")) || 0;
      } else if (campo === "puntaje") {
        fila.puntaje = valor === "" ? null : Number(valor) || null;
      } else {
        (fila[campo] as string) = valor;
      }
      next[i] = fila;
      return next;
    });
  };

  const guardar = async () => {
    setGuardando(true);
    setMsg("");
    try {
      await api.put("/api/rrhh/nomina", { nomina: filas });
      setMsg("Guardado ✓");
      onRefetch();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        Matriz acordada: Complejidad 30% · Responsabilidad 30% · Autonomía 20% · Resolución 20%
        (escala 1-5). Línea de equidad de referencia: <b className="text-ink">{cop(lineaPunto)}/punto</b>.
        Los valores se guardan en <code>rrhh_compensaciones.json</code>.
      </p>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-surface text-left text-xs text-muted">
            <tr>
              <th className="px-3 py-2">Persona</th>
              <th className="px-3 py-2">Esquema</th>
              <th className="px-3 py-2 text-right">Devengado</th>
              <th className="px-3 py-2 text-right">Deducciones</th>
              <th className="px-3 py-2 text-right">Neto</th>
              <th className="px-3 py-2 text-right">Puntaje</th>
              <th className="px-3 py-2 text-right">$/punto</th>
              <th className="px-3 py-2 text-right">Vs. línea</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-surface-panel">
            {filas.map((f, i) => {
              const porPunto = f.puntaje && f.devengado ? f.devengado / f.puntaje : null;
              const desvio = porPunto ? ((porPunto - lineaPunto) / lineaPunto) * 100 : null;
              return (
                <tr key={f.persona}>
                  <td className="px-3 py-2">
                    <p className="font-bold text-ink">{f.persona}</p>
                    {f.notas && <p className="max-w-[260px] text-[10px] leading-snug text-muted">{f.notas}</p>}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      f.esquema === "sin_salario_fijo"
                        ? "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300"
                        : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                    }`}>
                      {f.esquema === "sin_salario_fijo" ? "SIN FIJO" : "Nómina"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      className="w-28 rounded border border-border bg-surface px-2 py-1 text-right text-xs text-ink"
                      value={f.devengado || ""}
                      onChange={(e) => set(i, "devengado", e.target.value)}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      className="w-24 rounded border border-border bg-surface px-2 py-1 text-right text-xs text-ink"
                      value={f.deducciones || ""}
                      onChange={(e) => set(i, "deducciones", e.target.value)}
                    />
                  </td>
                  <td className="px-3 py-2 text-right text-xs text-ink">{cop(f.devengado - f.deducciones)}</td>
                  <td className="px-3 py-2 text-right">
                    <input
                      className="w-14 rounded border border-border bg-surface px-2 py-1 text-right text-xs text-ink"
                      value={f.puntaje ?? ""}
                      placeholder="—"
                      onChange={(e) => set(i, "puntaje", e.target.value)}
                    />
                  </td>
                  <td className="px-3 py-2 text-right text-xs font-semibold text-ink">
                    {porPunto ? cop(porPunto) : "—"}
                  </td>
                  <td className={`px-3 py-2 text-right text-xs font-bold ${
                    desvio == null ? "text-muted" : desvio > 10 ? "text-orange-500" : desvio < -10 ? "text-sky-500" : "text-emerald-600"
                  }`}>
                    {desvio == null ? "—" : `${desvio > 0 ? "+" : ""}${desvio.toFixed(0)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={guardar}
          disabled={guardando}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {guardando ? "Guardando…" : "Guardar nómina"}
        </button>
        {msg && <span className="text-xs text-muted">{msg}</span>}
      </div>
      <p className="text-[11px] leading-relaxed text-muted">
        ⚠️ Recordatorios del diagnóstico: nunca rebajas nominales de salario (ineficacia jurídica +
        desmotivación); quien esté sobre la línea se congela hasta que la línea lo alcance; deducciones
        deben cuadrar con PILA (riesgo UGPP).
      </p>
    </div>
  );
}

interface TurnoAgente {
  rol: "user" | "assistant";
  texto: string;
}

function TabAgente() {
  const [historial, setHistorial] = useState<TurnoAgente[]>([]);
  const [mensaje, setMensaje] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const sugerencias = [
    "¿Cuál es el hallazgo más urgente y por qué?",
    "Simula el costo empresa mensual si formalizamos a Cynthia con $2,6M",
    "¿Cómo comunico el congelamiento de Jenniffer sin desmotivarla?",
    "Resume el riesgo UGPP actual en 3 puntos",
  ];

  const enviar = async (texto?: string) => {
    const m = (texto ?? mensaje).trim();
    if (!m || cargando) return;
    setError("");
    setMensaje("");
    const nuevoHistorial: TurnoAgente[] = [...historial, { rol: "user", texto: m }];
    setHistorial(nuevoHistorial);
    setCargando(true);
    try {
      const res = await api.post<{ respuesta: string }>(
        "/api/rrhh/agente",
        { mensaje: m, historial },
        { timeoutMs: 90000 },
      );
      setHistorial([...nuevoHistorial, { rol: "assistant", texto: res.respuesta }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error del agente");
      setHistorial(historial);
      setMensaje(m);
    } finally {
      setCargando(false);
      setTimeout(() => scrollRef.current?.scrollTo({ top: 999999, behavior: "smooth" }), 50);
    }
  };

  return (
    <div className="flex h-[calc(100vh-260px)] min-h-[420px] flex-col rounded-xl border border-border bg-surface-panel">
      <div className="border-b border-border px-4 py-3">
        <p className="text-sm font-extrabold text-ink">Agente RRHH · Compensaciones</p>
        <p className="text-xs text-muted">
          Conoce los hallazgos registrados, la nómina, la matriz de puntos y las métricas en vivo
          (panel, WhatsApp, ventas). Especializado en normativa laboral colombiana y riesgos UGPP.
        </p>
      </div>
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {historial.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted">Prueba con:</p>
            <div className="flex flex-wrap gap-2">
              {sugerencias.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => enviar(s)}
                  className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-ink-secondary hover:border-accent hover:text-ink"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {historial.map((t, i) => (
          <div key={i} className={`flex ${t.rol === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                t.rol === "user"
                  ? "bg-accent text-white"
                  : "border border-border bg-surface text-ink"
              }`}
            >
              {t.texto}
            </div>
          </div>
        ))}
        {cargando && (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-border bg-surface px-4 py-2.5 text-sm text-muted">
              Analizando datos…
            </div>
          </div>
        )}
        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        )}
      </div>
      <div className="flex gap-2 border-t border-border p-3">
        <input
          className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
          placeholder="Pregunta sobre compensaciones, equidad, UGPP, escenarios de nómina…"
          value={mensaje}
          onChange={(e) => setMensaje(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && enviar()}
          disabled={cargando}
        />
        <button
          type="button"
          onClick={() => enviar()}
          disabled={cargando || !mensaje.trim()}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          Enviar
        </button>
      </div>
    </div>
  );
}

// ── Panel principal ────────────────────────────────────────────────────────────

export default function RRHHPanel() {
  const [tab, setTab] = useState<Tab>("resumen");
  const { data: resumen, isLoading, error, refetch } = useQuery({
    queryKey: ["rrhh-resumen"],
    queryFn: () => api.get<Resumen>("/api/rrhh/resumen", { timeoutMs: 30000 }),
    refetchInterval: 120000,
  });

  const tabs = useMemo(
    () =>
      [
        { id: "resumen" as Tab, label: "📊 Resumen en vivo" },
        { id: "hallazgos" as Tab, label: `🚩 Hallazgos${resumen?.hallazgos_abiertos ? ` (${resumen.hallazgos_abiertos})` : ""}` },
        { id: "nomina" as Tab, label: "💵 Nómina y matriz" },
        { id: "agente" as Tab, label: "🤖 Agente RRHH" },
      ],
    [resumen?.hallazgos_abiertos],
  );

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 lg:p-6">
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-xl px-3.5 py-2 text-sm font-bold transition ${
              tab === t.id
                ? "bg-accent text-white"
                : "border border-border bg-surface-panel text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-sm text-muted">Cargando métricas…</p>}
      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error instanceof Error ? error.message : "Error al cargar"}
        </p>
      )}

      {resumen && tab === "resumen" && <TabResumen resumen={resumen} />}
      {tab === "hallazgos" && <TabHallazgos />}
      {resumen && tab === "nomina" && <TabNomina resumen={resumen} onRefetch={() => void refetch()} />}
      {tab === "agente" && <TabAgente />}
    </div>
  );
}
