import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api/client";
import TerceroSelect from "./TerceroSelect";

/**
 * Solicitudes de pago con asiento contable automático.
 *
 * **Por qué existe.** Hasta sep-2026 los pagos se aprobaban como tickets de
 * texto libre ("APROBAR PAGO DE FACTORES") y el asiento dependía de que alguien
 * se acordara después. No se hacía: el Libro Mayor tenía las compras pero no los
 * pagos. Acá el asiento nace del acto de pagar.
 *
 * **El asiento se muestra ANTES de aprobar** — quien aprueba ve contra qué
 * cuenta va. Aprobar un monto sin ver el asiento es firmar a ciegas.
 */

type Categoria = {
  id: string; label: string; ayuda: string; icono: string;
  origen: string; requiere_tercero: boolean; elige_cuenta: boolean;
};

type Opcion = {
  id: number | string; label: string; identificacion?: string;
  monto_sugerido?: number; detalle?: string; tipo_servicio?: string;
};

type LineaAsiento = {
  cuenta_codigo: string; cuenta_nombre: string;
  debito: number; credito: number; descripcion: string;
};

type Previsualizacion = {
  categoria_label: string; concepto: string; fecha: string;
  monto: number; retencion: number; retencion_motivo: string; girado: number;
  tercero: { id: number; nombre: string } | null;
  medio_pago: string; lineas: LineaAsiento[]; cuadra: boolean;
};

type Solicitud = {
  id: number; categoria: string; categoria_label: string; icono: string;
  concepto: string; monto: number; retencion: number; girado: number;
  fecha: string; estado: string; referencia: string; notas: string;
  tercero: { id: number; nombre: string; identificacion: string } | null;
  movimiento_id: number | null; alegra_journal_id: string; ticket_id: number | null;
};

type MedioPago = { id: number; nombre: string; cuenta_id: number; activo: number };

// Patrón de AstroKiller: cada estado con su etiqueta y color, y conjuntos que
// definen qué necesita atención y qué acciones caben.
const ESTADO_BADGE: Record<string, { label: string; cls: string }> = {
  pendiente: { label: "⏳ Esperando aprobación", cls: "bg-amber-500/15 text-amber-600" },
  aprobada: { label: "✅ Aprobada y contabilizada", cls: "bg-emerald-500/15 text-emerald-500" },
  pagada: { label: "✅ Pagada", cls: "bg-emerald-500/15 text-emerald-500" },
  rechazada: { label: "➖ Rechazada", cls: "bg-surface text-muted" },
  anulada: { label: "➖ Anulada", cls: "bg-surface text-muted" },
  borrador: { label: "📝 Borrador", cls: "bg-sky-500/15 text-sky-500" },
};
const NECESITA_ACCION = new Set(["pendiente"]);

function cop(n: number | null | undefined): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency", currency: "COP", maximumFractionDigits: 0,
  }).format(n || 0);
}
const hoy = () => new Date().toISOString().slice(0, 10);

export default function PagosWizardPanel() {
  const qc = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [filtro, setFiltro] = useState<string>("");

  const listaQ = useQuery<{ solicitudes: Solicitud[]; resumen: { pendientes: { n: number; total: number }; aprobadas: { n: number; total: number } } }>({
    queryKey: ["pagos-solicitudes", filtro],
    queryFn: () => api.get(`/api/pagos/solicitudes${filtro ? `?estado=${filtro}` : ""}`),
  });

  useEffect(() => {
    if (!msg) return;
    const t = window.setTimeout(() => setMsg(null), 5000);
    return () => window.clearTimeout(t);
  }, [msg]);

  const solicitudes = listaQ.data?.solicitudes ?? [];
  const r = listaQ.data?.resumen;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-ink">Solicitudes de pago</h2>
          <p className="mt-1 max-w-2xl text-xs text-muted">
            Cada pago aprobado genera su asiento en el Libro Mayor y su comprobante en Alegra.
            El asiento se muestra antes de aprobar, para que quien firma vea contra qué cuenta va.
          </p>
        </div>
        <button
          type="button" onClick={() => setAbierto((v) => !v)}
          className="rounded-lg bg-accent px-3 py-2 text-xs font-bold text-white hover:bg-accent-hover"
        >
          {abierto ? "Cancelar" : "+ Registrar un pago"}
        </button>
      </header>

      {msg && (
        <p className={`rounded-lg px-3 py-2 text-xs font-bold ${
          msg.tipo === "ok" ? "bg-emerald-500/15 text-emerald-500" : "bg-red-500/15 text-red-500"
        }`}>{msg.texto}</p>
      )}

      {r && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Kpi label="Esperando aprobación" valor={cop(r.pendientes.total)}
               sub={`${r.pendientes.n} solicitud(es)`} alerta={r.pendientes.n > 0} />
          <Kpi label="Aprobadas y contabilizadas" valor={cop(r.aprobadas.total)}
               sub={`${r.aprobadas.n} solicitud(es)`} />
        </div>
      )}

      {abierto && (
        <Wizard
          onCerrar={() => setAbierto(false)}
          onCreada={(texto) => {
            setMsg({ tipo: "ok", texto });
            setAbierto(false);
            void qc.invalidateQueries({ queryKey: ["pagos-solicitudes"] });
          }}
          onError={(texto) => setMsg({ tipo: "error", texto })}
        />
      )}

      <div className="flex gap-1 text-[11px]">
        {[["", "Todas"], ["pendiente", "Pendientes"], ["aprobada", "Aprobadas"], ["rechazada", "Rechazadas"]].map(([v, l]) => (
          <button
            key={v} type="button" onClick={() => setFiltro(v)}
            className={`rounded-lg px-2.5 py-1 font-bold ${filtro === v ? "bg-accent text-white" : "bg-surface text-muted"}`}
          >{l}</button>
        ))}
      </div>

      {listaQ.isLoading && <p className="text-xs text-muted">Cargando…</p>}
      {!listaQ.isLoading && !solicitudes.length && (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-xs text-muted">
          No hay solicitudes {filtro ? `en estado «${filtro}»` : "todavía"}.
        </p>
      )}

      <div className="space-y-2">
        {solicitudes.map((s) => (
          <FichaSolicitud key={s.id} s={s} onMensaje={setMsg} />
        ))}
      </div>
    </div>
  );
}

// ─── El wizard: 3 pasos ────────────────────────────────────────────────────

function Wizard({
  onCerrar, onCreada, onError,
}: {
  onCerrar: () => void;
  onCreada: (texto: string) => void;
  onError: (texto: string) => void;
}) {
  const [paso, setPaso] = useState<1 | 2 | 3>(1);
  const [cat, setCat] = useState<Categoria | null>(null);
  const [f, setF] = useState({
    monto: "", concepto: "", fecha: hoy(), tercero_id: "",
    medio_pago_id: "", cuenta_debito: "", tipo_servicio: "",
    referencia: "", origen_ref: "", notas: "",
  });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  const catsQ = useQuery<{ categorias: Categoria[] }>({
    queryKey: ["pagos-categorias"],
    queryFn: () => api.get("/api/pagos/categorias"),
  });
  const opcionesQ = useQuery<{ tipo: string; opciones: Opcion[] }>({
    queryKey: ["pagos-opciones", cat?.id],
    queryFn: () => api.get(`/api/pagos/opciones/${cat!.id}`),
    enabled: !!cat && cat.origen !== "libre",
  });
  const mediosQ = useQuery<{ medios_pago: MedioPago[] }>({
    queryKey: ["cc-medios-pago"],
    queryFn: () => api.get("/api/contabilidad/cc/medios-pago"),
  });
  // Los socios montan y aprueban sus propios pagos: si el usuario es admin, se
  // le ofrece registrar sin pasar por el ciclo de aprobación.
  const puedeQ = useQuery<{ puede: boolean; usuario: string }>({
    queryKey: ["pagos-puedo-registrar"],
    queryFn: () => api.get("/api/pagos/puedo-registrar"),
  });
  const puedeDirecto = Boolean(puedeQ.data?.puede);
  const cuentasQ = useQuery<{ cuentas: Array<{ codigo: string; nombre: string; tipo: string }> }>({
    queryKey: ["cc-plan-cuentas"],
    queryFn: () => api.get("/api/contabilidad/cc/plan-cuentas"),
    enabled: !!cat?.elige_cuenta,
  });
  const medios = (mediosQ.data?.medios_pago ?? []).filter((m) => m.activo);

  // Previsualización en vivo: el asiento se ve mientras se llena el formulario.
  const cuerpo = useMemo(() => ({
    categoria: cat?.id, monto: parseFloat(f.monto.replace(",", ".")) || 0,
    concepto: f.concepto, fecha: f.fecha,
    tercero_id: f.tercero_id ? Number(f.tercero_id) : null,
    medio_pago_id: f.medio_pago_id ? Number(f.medio_pago_id) : null,
    cuenta_debito: f.cuenta_debito, tipo_servicio: f.tipo_servicio,
  }), [cat, f]);

  const prevQ = useQuery<Previsualizacion>({
    queryKey: ["pagos-previsualizar", cuerpo],
    queryFn: () => api.post("/api/pagos/previsualizar", cuerpo),
    enabled: paso === 3 && !!cat && cuerpo.monto > 0,
    retry: false,
  });

  const crearMut = useMutation({
    mutationFn: () => api.post<Solicitud & { error?: string }>("/api/pagos/solicitudes", {
      ...cuerpo, referencia: f.referencia, origen_ref: f.origen_ref, notas: f.notas,
    }),
    onSuccess: (s) => {
      if (s.error) return onError(s.error);
      onCreada(`Solicitud #${s.id} creada — ${cop(s.monto)}. Queda esperando aprobación.`);
    },
    onError: (e) => onError((e as Error).message),
  });

  const directoMut = useMutation({
    mutationFn: () => api.post<Solicitud & { error?: string; alegra?: { status: string; message?: string } }>(
      "/api/pagos/registrar",
      { ...cuerpo, referencia: f.referencia, origen_ref: f.origen_ref, notas: f.notas },
    ),
    onSuccess: (s2) => {
      if (s2.error) return onError(s2.error);
      const al = s2.alegra?.status;
      onCreada(
        `Pago #${s2.id} registrado y contabilizado — ${cop(s2.monto)}.` + (
          al === "success" ? " Espejado en Alegra."
            : al === "bloqueado" ? " En Alegra quedó pendiente: falta el tipo de comprobante."
            : al === "error" ? ` Alegra falló (${s2.alegra?.message ?? ""}) — el asiento interno sí quedó.`
            : ""),
      );
    },
    onError: (e) => onError((e as Error).message),
  });

  const cats = catsQ.data?.categorias ?? [];
  const ops = opcionesQ.data?.opciones ?? [];

  return (
    <div className="space-y-4 rounded-xl border border-accent/40 bg-surface-panel p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {[1, 2, 3].map((n) => (
            <div key={n} className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${
              paso === n ? "bg-accent text-white" : paso > n ? "bg-emerald-500/20 text-emerald-500" : "bg-surface text-muted"
            }`}>{paso > n ? "✓" : n}</div>
          ))}
          <span className="ml-1 text-xs font-bold text-ink">
            {paso === 1 ? "¿Qué se paga?" : paso === 2 ? "Detalles" : "Revisar el asiento"}
          </span>
        </div>
        <button type="button" onClick={onCerrar} className="text-xs text-muted">✕</button>
      </div>

      {/* PASO 1 — categoría */}
      {paso === 1 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {cats.map((c) => (
            <button
              key={c.id} type="button"
              onClick={() => { setCat(c); setPaso(2); }}
              className="rounded-lg border border-border p-3 text-left hover:border-accent"
            >
              <p className="text-sm font-bold text-ink">{c.icono} {c.label}</p>
              <p className="mt-0.5 text-[10px] leading-snug text-muted">{c.ayuda}</p>
            </button>
          ))}
        </div>
      )}

      {/* PASO 2 — detalles */}
      {paso === 2 && cat && (
        <div className="space-y-3">
          <p className="text-xs font-bold text-accent">{cat.icono} {cat.label}</p>

          {cat.origen !== "libre" && (
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase text-muted">
                {opcionesQ.isLoading ? "Cargando pendientes…" : ops.length ? "Elige qué pagar" : "No hay pendientes en esta categoría"}
              </p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {ops.map((o) => (
                  <button
                    key={String(o.id)} type="button"
                    onClick={() => {
                      if (typeof o.id === "number" && cat.requiere_tercero) set("tercero_id", String(o.id));
                      if (o.monto_sugerido) set("monto", String(Math.round(o.monto_sugerido)));
                      if (o.tipo_servicio) set("tipo_servicio", o.tipo_servicio);
                      if (!f.concepto) set("concepto", o.label);
                      set("origen_ref", String(o.id));
                    }}
                    className={`rounded-lg border p-2 text-left text-[11px] ${
                      f.origen_ref === String(o.id) ? "border-accent bg-accent/10" : "border-border hover:border-accent"
                    }`}
                  >
                    <p className="font-bold text-ink">{o.label}</p>
                    <p className="text-[10px] text-muted">{o.detalle}</p>
                    {o.monto_sugerido ? (
                      <p className="mt-0.5 font-bold tabular-nums text-accent">{cop(o.monto_sugerido)}</p>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Campo label="Monto a pagar">
              <input type="number" min="0" step="1000" required value={f.monto}
                     onChange={(e) => set("monto", e.target.value)} className={inputCls} />
            </Campo>
            <Campo label="Fecha">
              <input type="date" value={f.fecha} onChange={(e) => set("fecha", e.target.value)} className={inputCls} />
            </Campo>
            <Campo label="De qué cuenta sale">
              <select value={f.medio_pago_id} onChange={(e) => set("medio_pago_id", e.target.value)} className={inputCls}>
                <option value="">Selecciona…</option>
                {medios.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
              </select>
            </Campo>
            <Campo label="Referencia (opcional)">
              <input value={f.referencia} onChange={(e) => set("referencia", e.target.value)}
                     placeholder="N° de factura o transferencia" className={inputCls} />
            </Campo>
          </div>

          <Campo label="Concepto">
            <input value={f.concepto} onChange={(e) => set("concepto", e.target.value)}
                   placeholder="Qué se está pagando" className={inputCls} />
          </Campo>

          {cat.requiere_tercero && cat.origen === "libre" && (
            <TerceroSelect label="¿A quién se le paga?" value={f.tercero_id}
                           onChange={(id) => set("tercero_id", id)} />
          )}

          {cat.elige_cuenta && (
            <Campo label="Cuenta contable del gasto">
              <select value={f.cuenta_debito} onChange={(e) => set("cuenta_debito", e.target.value)} className={inputCls}>
                <option value="">Selecciona…</option>
                {(cuentasQ.data?.cuentas ?? [])
                  .filter((c) => c.tipo === "gasto" || c.tipo === "costo")
                  .map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} — {c.nombre}</option>)}
              </select>
            </Campo>
          )}

          <div className="flex gap-2">
            <button type="button" onClick={() => setPaso(1)}
                    className="rounded-lg border border-border px-3 py-2 text-xs font-bold text-ink">← Atrás</button>
            <button type="button" onClick={() => setPaso(3)}
                    disabled={!f.monto || !f.medio_pago_id}
                    className="rounded-lg bg-accent px-4 py-2 text-xs font-bold text-white disabled:opacity-40">
              Ver el asiento →
            </button>
          </div>
        </div>
      )}

      {/* PASO 3 — revisar el asiento */}
      {paso === 3 && cat && (
        <div className="space-y-3">
          {prevQ.isLoading && <p className="text-xs text-muted">Armando el asiento…</p>}
          {prevQ.error && (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs font-bold text-red-500">
              {(prevQ.error as Error).message}
            </p>
          )}
          {prevQ.data && <AsientoPreview p={prevQ.data} />}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setPaso(2)}
                    className="rounded-lg border border-border px-3 py-2 text-xs font-bold text-ink">← Corregir</button>
            <button type="button" onClick={() => crearMut.mutate()}
                    disabled={!prevQ.data?.cuadra || crearMut.isPending || directoMut.isPending}
                    className="rounded-lg border-2 border-accent px-4 py-2 text-xs font-bold text-accent disabled:opacity-40">
              {crearMut.isPending ? "Enviando…" : "Enviar a aprobación"}
            </button>
            {puedeDirecto && (
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm(
                    `Registrar y contabilizar ${cop(prevQ.data?.monto ?? 0)} de una vez, sin pasar por aprobación.\n\n` +
                    "Queda anotado que lo registraste tú. ¿Continuar?",
                  )) return;
                  directoMut.mutate();
                }}
                disabled={!prevQ.data?.cuadra || directoMut.isPending || crearMut.isPending}
                className="rounded-lg bg-accent px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
              >
                {directoMut.isPending ? "Registrando…" : "Registrar y contabilizar ya"}
              </button>
            )}
          </div>
          {puedeDirecto && (
            <p className="text-[10px] leading-relaxed text-muted">
              Como {puedeQ.data?.usuario || "administrador"} puedes registrarlo directamente: el asiento
              queda al confirmar, sin ciclo de aprobación. Se anota quién lo hizo, para poder
              distinguirlo después de un pago que sí pasó por otro par de ojos.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── El asiento a la vista ─────────────────────────────────────────────────

/**
 * Lo que hace que esto no sea firmar a ciegas: el asiento completo, con sus
 * cuentas y su cuadre, antes de que nadie apruebe nada.
 */
function AsientoPreview({ p }: { p: Previsualizacion }) {
  const totalD = p.lineas.reduce((a, l) => a + l.debito, 0);
  const totalC = p.lineas.reduce((a, l) => a + l.credito, 0);
  return (
    <div className="space-y-2 rounded-xl border border-accent/30 bg-accent/5 p-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <Mini label="Monto" valor={cop(p.monto)} />
        {p.retencion > 0 && <Mini label="Retención" valor={`− ${cop(p.retencion)}`} />}
        <Mini label="Se gira" valor={cop(p.girado)} acento />
      </div>
      {p.retencion_motivo && (
        <p className="rounded-lg bg-surface px-2 py-1.5 text-[10px] text-muted">{p.retencion_motivo}</p>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-[11px]">
          <thead className="text-[10px] uppercase text-muted">
            <tr>
              <th className="py-1 pr-2 font-bold">Cuenta</th>
              <th className="py-1 pr-2 font-bold">Nombre</th>
              <th className="py-1 pr-2 text-right font-bold">Débito</th>
              <th className="py-1 text-right font-bold">Crédito</th>
            </tr>
          </thead>
          <tbody>
            {p.lineas.map((l, i) => (
              <tr key={`${l.cuenta_codigo}-${i}`} className="border-t border-border/40">
                <td className="py-1 pr-2 font-mono text-accent">{l.cuenta_codigo}</td>
                <td className="py-1 pr-2 text-ink">
                  {l.cuenta_nombre}
                  <span className="block text-[10px] text-muted">{l.descripcion}</span>
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">{l.debito ? cop(l.debito) : "—"}</td>
                <td className="py-1 text-right tabular-nums">{l.credito ? cop(l.credito) : "—"}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-border font-bold">
              <td className="py-1" colSpan={2}>TOTAL</td>
              <td className="py-1 pr-2 text-right tabular-nums">{cop(totalD)}</td>
              <td className="py-1 text-right tabular-nums">{cop(totalC)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className={`text-[11px] font-bold ${p.cuadra ? "text-emerald-500" : "text-red-500"}`}>
        {p.cuadra ? "✓ El asiento cuadra" : "✗ No cuadra — no se puede enviar"}
      </p>
    </div>
  );
}

// ─── Ficha de cada solicitud ───────────────────────────────────────────────

function FichaSolicitud({
  s, onMensaje,
}: { s: Solicitud; onMensaje: (m: { tipo: "ok" | "error"; texto: string }) => void }) {
  const qc = useQueryClient();
  const [ocupado, setOcupado] = useState<"aprobar" | "rechazar" | null>(null);
  const badge = ESTADO_BADGE[s.estado] ?? { label: s.estado, cls: "bg-surface text-muted" };

  async function accion(tipo: "aprobar" | "rechazar") {
    if (tipo === "aprobar" && !window.confirm(
      `Aprobar ${cop(s.monto)} — ${s.concepto}.\n\n` +
      "Al aprobar se crea el asiento en el Libro Mayor y el comprobante en Alegra. ¿Continuar?",
    )) return;
    const motivo = tipo === "rechazar" ? (window.prompt("Motivo del rechazo:") ?? "") : "";
    if (tipo === "rechazar" && !motivo) return;
    setOcupado(tipo);
    try {
      const r = await api.post<{ error?: string; estado?: string; alegra?: { status: string; message?: string } }>(
        `/api/pagos/solicitudes/${s.id}/${tipo}`, tipo === "rechazar" ? { motivo } : {},
      );
      if (r.error) onMensaje({ tipo: "error", texto: r.error });
      else if (tipo === "aprobar") {
        const al = r.alegra?.status;
        onMensaje({
          tipo: "ok",
          texto: `Aprobada y contabilizada.` + (
            al === "success" ? " Espejada en Alegra."
              : al === "bloqueado" ? " En Alegra quedó pendiente: falta el tipo de comprobante."
              : al === "error" ? ` Alegra falló: ${r.alegra?.message ?? ""} — el asiento interno sí quedó.`
              : ""),
        });
      } else onMensaje({ tipo: "ok", texto: "Solicitud rechazada — no quedó ningún asiento." });
      void qc.invalidateQueries({ queryKey: ["pagos-solicitudes"] });
    } catch (e) {
      onMensaje({ tipo: "error", texto: (e as Error).message });
    } finally {
      setOcupado(null);
    }
  }

  return (
    <article className={`rounded-xl border bg-surface-panel p-3 ${
      NECESITA_ACCION.has(s.estado) ? "border-amber-500/40" : "border-border"
    }`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[14rem]">
          <p className="text-sm font-bold text-ink">
            {s.icono} {s.concepto}
          </p>
          <p className="mt-0.5 text-[11px] text-muted">
            {s.categoria_label} · {s.fecha}
            {s.tercero ? ` · ${s.tercero.nombre}` : ""}
            {s.referencia ? ` · ref ${s.referencia}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-sm font-extrabold tabular-nums text-ink">{cop(s.monto)}</p>
            {s.retencion > 0 && (
              <p className="text-[10px] text-muted">
                retención {cop(s.retencion)} · se gira {cop(s.girado)}
              </p>
            )}
          </div>
          <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}>
            {badge.label}
          </span>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-muted">
        {s.movimiento_id && <span>📒 asiento #{s.movimiento_id}</span>}
        {s.alegra_journal_id && <span className="text-emerald-500">✓ Alegra #{s.alegra_journal_id}</span>}
        {s.estado === "aprobada" && !s.alegra_journal_id && (
          <span className="text-amber-500">sin espejar en Alegra</span>
        )}
        {s.ticket_id && <span>🎫 ticket #{s.ticket_id}</span>}
        {/* Un pago auto-aprobado es válido, pero tuvo un solo par de ojos:
            en una revisión hay que poder distinguirlo de uno aprobado por otro. */}
        {s.notas?.includes("Registrado directamente") && (
          <span className="rounded bg-sky-500/10 px-1.5 py-0.5 font-bold text-sky-600">
            registro directo
          </span>
        )}
        {s.notas && !s.notas.includes("Registrado directamente") && (
          <span className="italic">{s.notas}</span>
        )}

        {NECESITA_ACCION.has(s.estado) && (
          <span className="ml-auto flex gap-1.5">
            <button type="button" onClick={() => void accion("rechazar")} disabled={!!ocupado}
                    className="rounded-lg border border-border px-2 py-1 text-[10px] font-bold text-muted hover:border-red-500 hover:text-red-500 disabled:opacity-40">
              Rechazar
            </button>
            <button type="button" onClick={() => void accion("aprobar")} disabled={!!ocupado}
                    className="rounded-lg bg-accent px-2.5 py-1 text-[10px] font-bold text-white disabled:opacity-40">
              {ocupado === "aprobar" ? "…" : "Aprobar y contabilizar"}
            </button>
          </span>
        )}
      </div>
    </article>
  );
}

// ─── Piezas ────────────────────────────────────────────────────────────────

const inputCls = "mt-1 w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-ink";

function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-[9rem] flex-1 text-xs">
      <span className="font-bold text-muted">{label}</span>
      {children}
    </label>
  );
}

function Kpi({ label, valor, sub, alerta }: { label: string; valor: string; sub?: string; alerta?: boolean }) {
  return (
    <div className={`rounded-xl border px-3 py-3 ${alerta ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-surface-panel"}`}>
      <p className="text-[10px] font-bold uppercase text-muted">{label}</p>
      <p className={`mt-1 text-lg font-extrabold tabular-nums ${alerta ? "text-amber-600" : "text-ink"}`}>{valor}</p>
      {sub && <p className="text-[10px] text-muted">{sub}</p>}
    </div>
  );
}

function Mini({ label, valor, acento }: { label: string; valor: string; acento?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <p className="text-[10px] font-bold uppercase text-muted">{label}</p>
      <p className={`mt-0.5 text-sm font-extrabold tabular-nums ${acento ? "text-accent" : "text-ink"}`}>{valor}</p>
    </div>
  );
}
