import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api/client";
import ComprobanteWidget from "./ComprobanteWidget";

type Tercero = {
  id: number;
  nombre: string;
  tipo: string;
  activo: number;
};

type MedioPago = {
  id: number;
  nombre: string;
  cuenta_id: number;
  activo: number;
};

type MovLinea = {
  cuenta_id: number;
  cuenta_codigo: string;
  cuenta_nombre: string;
  tercero_id: number | null;
  tercero_nombre: string | null;
  debito: number;
  credito: number;
  descripcion: string;
};

type Movimiento = {
  id: number;
  fecha: string;
  concepto: string;
  tipo_origen: string;
  referencia: string;
  estado: string;
  tercero_id: number | null;
  lineas: MovLinea[];
  soporte_path?: string;
  soporte_nombre?: string;
};

type Direccion = "recibido" | "otorgado";

// "pago_socio" queda incluido en recibidos: un giro a un socio abona tanto
// préstamos como compras a su nombre (misma cuenta de pasivo, 2380/2295) —
// ver contabilidad_core.py::registrar_abono_pasivo_tercero.
const TIPOS_RECIBIDO = new Set(["prestamo_recibido", "abono_prestamo_recibido", "pago_socio"]);
const TIPOS_OTORGADO = new Set(["prestamo_otorgado", "abono_prestamo_otorgado"]);
const TIPOS_PRESTAMO = new Set<string>([...TIPOS_RECIBIDO, ...TIPOS_OTORGADO]);
const CUENTAS_PASIVO = new Set(["2380", "2295"]);
const CUENTAS_ACTIVO = new Set(["1355", "1290"]);

function formatCop(n: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n || 0);
}

function num(v: string): number {
  const n = parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

const emptyForm = {
  tercero_id: "",
  fecha: hoy(),
  monto: "",
  medio_pago_id: "",
  tasa_interes_pct: "",
  plazo_meses: "",
  referencia: "",
  concepto: "",
};

type Saldo = { tercero_id: number; nombre: string; saldo: number };

export default function PrestamosPanel() {
  const qc = useQueryClient();
  const [direccion, setDireccion] = useState<Direccion>("recibido");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [abonoAbierto, setAbonoAbierto] = useState<{ terceroId: number; direccion: Direccion } | null>(null);
  const [abonoForm, setAbonoForm] = useState({ fecha: hoy(), monto: "", medio_pago_id: "", referencia: "" });
  const [verHistorial, setVerHistorial] = useState<number | null>(null);

  const tercerosQ = useQuery<{ terceros: Tercero[] }>({
    queryKey: ["cc-terceros"],
    queryFn: () => api.get("/api/contabilidad/cc/terceros?activos=0"),
  });
  const mediosQ = useQuery<{ medios_pago: MedioPago[] }>({
    queryKey: ["cc-medios-pago"],
    queryFn: () => api.get("/api/contabilidad/cc/medios-pago"),
  });
  const movQ = useQuery<{ movimientos: Movimiento[] }>({
    queryKey: ["cc-movimientos-prestamos"],
    queryFn: () => api.get("/api/contabilidad/cc/movimientos?limit=500"),
  });

  const terceros = (tercerosQ.data?.terceros ?? []).filter((t) => t.activo);
  const medios = (mediosQ.data?.medios_pago ?? []).filter((m) => m.activo);

  const movsPrestamo = useMemo(
    () => (movQ.data?.movimientos ?? []).filter((m) => TIPOS_PRESTAMO.has(m.tipo_origen) && m.estado !== "anulado"),
    [movQ.data],
  );

  const { recibido, otorgado } = useMemo(() => {
    const rec = new Map<number, Saldo>();
    const otr = new Map<number, Saldo>();
    for (const m of movsPrestamo) {
      for (const l of m.lineas) {
        if (!l.tercero_id) continue;
        if (CUENTAS_PASIVO.has(l.cuenta_codigo)) {
          const cur = rec.get(l.tercero_id) ?? { tercero_id: l.tercero_id, nombre: l.tercero_nombre || "", saldo: 0 };
          cur.saldo += l.credito - l.debito;
          rec.set(l.tercero_id, cur);
        }
        if (CUENTAS_ACTIVO.has(l.cuenta_codigo)) {
          const cur = otr.get(l.tercero_id) ?? { tercero_id: l.tercero_id, nombre: l.tercero_nombre || "", saldo: 0 };
          cur.saldo += l.debito - l.credito;
          otr.set(l.tercero_id, cur);
        }
      }
    }
    const orden = (a: Saldo, b: Saldo) => b.saldo - a.saldo || a.nombre.localeCompare(b.nombre);
    return {
      recibido: [...rec.values()].sort(orden),
      otorgado: [...otr.values()].sort(orden),
    };
  }, [movsPrestamo]);

  const totalRecibido = recibido.reduce((a, s) => a + Math.max(s.saldo, 0), 0);
  const totalOtorgado = otorgado.reduce((a, s) => a + Math.max(s.saldo, 0), 0);

  useEffect(() => {
    if (!msg) return;
    const t = window.setTimeout(() => setMsg(null), 4500);
    return () => window.clearTimeout(t);
  }, [msg]);

  const prestamoMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => {
      const tipo = direccion === "recibido" ? "prestamo-recibido" : "prestamo-otorgado";
      return api.post<{ ok?: boolean; error?: string }>(`/api/contabilidad/cc/plantillas/${tipo}`, body);
    },
    onSuccess: (r) => {
      if (r.error) {
        setMsg({ tipo: "error", texto: r.error });
        return;
      }
      setMsg({ tipo: "ok", texto: direccion === "recibido" ? "Préstamo recibido registrado" : "Préstamo otorgado registrado" });
      setForm(emptyForm);
      setShowForm(false);
      void qc.invalidateQueries({ queryKey: ["cc-movimientos-prestamos"] });
      void qc.invalidateQueries({ queryKey: ["cc-movimientos"] });
    },
    onError: (e) => setMsg({ tipo: "error", texto: (e as Error).message || "No se pudo registrar" }),
  });

  const abonoMut = useMutation({
    mutationFn: ({ terceroId, direccionAbono, body }: { terceroId: number; direccionAbono: Direccion; body: Record<string, unknown> }) =>
      api.post<{ ok?: boolean; error?: string }>("/api/contabilidad/cc/plantillas/abono-prestamo", {
        ...body,
        tercero_id: terceroId,
        direccion: direccionAbono,
      }),
    onSuccess: (r) => {
      if (r.error) {
        setMsg({ tipo: "error", texto: r.error });
        return;
      }
      setMsg({ tipo: "ok", texto: "Abono registrado" });
      setAbonoAbierto(null);
      setAbonoForm({ fecha: hoy(), monto: "", medio_pago_id: "", referencia: "" });
      void qc.invalidateQueries({ queryKey: ["cc-movimientos-prestamos"] });
      void qc.invalidateQueries({ queryKey: ["cc-movimientos"] });
    },
    onError: (e) => setMsg({ tipo: "error", texto: (e as Error).message || "No se pudo registrar el abono" }),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-ink">Préstamos</h2>
          <p className="mt-1 text-xs text-muted">
            Dinero que un socio o tercero le presta a la empresa, y dinero que la empresa presta a un
            socio o tercero — cada uno con su cuenta PUC (2380/2295 por pagar, 1355/1290 por cobrar) y
            visible en el balance de comprobación del Libro Mayor.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-lg bg-accent px-3 py-2 text-xs font-bold text-white hover:bg-accent-hover"
        >
          {showForm ? "Cancelar" : "+ Registrar préstamo"}
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Kpi label="Debemos por préstamos recibidos" value={formatCop(totalRecibido)} accent />
        <Kpi label="Nos deben por préstamos otorgados" value={formatCop(totalOtorgado)} />
      </div>

      {showForm && (
        <form
          className="space-y-3 rounded-xl border border-border bg-surface-panel p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.tercero_id || !(num(form.monto) > 0) || !form.medio_pago_id) {
              setMsg({ tipo: "error", texto: "Tercero, monto y medio de pago son obligatorios" });
              return;
            }
            prestamoMut.mutate({
              fecha: form.fecha,
              tercero_id: Number(form.tercero_id),
              monto: num(form.monto),
              medio_pago_id: Number(form.medio_pago_id),
              tasa_interes_pct: form.tasa_interes_pct.trim() ? num(form.tasa_interes_pct) : undefined,
              plazo_meses: form.plazo_meses.trim() ? Math.round(num(form.plazo_meses)) : undefined,
              referencia: form.referencia.trim(),
              concepto: form.concepto.trim(),
            });
          }}
        >
          <div className="flex gap-2 rounded-lg bg-surface p-1">
            <button
              type="button"
              onClick={() => setDireccion("recibido")}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-bold ${direccion === "recibido" ? "bg-accent text-white" : "text-muted"}`}
            >
              Nos prestan a nosotros
            </button>
            <button
              type="button"
              onClick={() => setDireccion("otorgado")}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-bold ${direccion === "otorgado" ? "bg-accent text-white" : "text-muted"}`}
            >
              Le prestamos a alguien
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={direccion === "recibido" ? "¿Quién nos presta?" : "¿A quién le prestamos?"}>
              <select
                value={form.tercero_id}
                onChange={(e) => setForm((f) => ({ ...f, tercero_id: e.target.value }))}
                className={inputCls}
                required
              >
                <option value="">Selecciona…</option>
                {terceros.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre} {t.tipo === "socio" ? "(socio)" : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Fecha">
              <input
                type="date"
                value={form.fecha}
                onChange={(e) => setForm((f) => ({ ...f, fecha: e.target.value }))}
                className={inputCls}
                required
              />
            </Field>
            <Field label="Monto (COP)">
              <input
                type="number"
                min="0"
                step="1000"
                value={form.monto}
                onChange={(e) => setForm((f) => ({ ...f, monto: e.target.value }))}
                className={inputCls}
                required
              />
            </Field>
            <Field label="Medio de pago">
              <select
                value={form.medio_pago_id}
                onChange={(e) => setForm((f) => ({ ...f, medio_pago_id: e.target.value }))}
                className={inputCls}
                required
              >
                <option value="">Selecciona…</option>
                {medios.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nombre}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Tasa de interés anual % (opcional)">
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.tasa_interes_pct}
                onChange={(e) => setForm((f) => ({ ...f, tasa_interes_pct: e.target.value }))}
                placeholder="Solo referencia del acuerdo"
                className={inputCls}
              />
            </Field>
            <Field label="Plazo en meses (opcional)">
              <input
                type="number"
                min="0"
                step="1"
                value={form.plazo_meses}
                onChange={(e) => setForm((f) => ({ ...f, plazo_meses: e.target.value }))}
                className={inputCls}
              />
            </Field>
            <Field label="Referencia (opcional)">
              <input
                value={form.referencia}
                onChange={(e) => setForm((f) => ({ ...f, referencia: e.target.value }))}
                className={inputCls}
              />
            </Field>
          </div>
          <Field label="Descripción de la operación">
            <textarea
              value={form.concepto}
              onChange={(e) => setForm((f) => ({ ...f, concepto: e.target.value }))}
              rows={2}
              placeholder="Ej. Préstamo para cubrir compra courier de Cynthia (sin factura fiscal, ver comprobante en el grupo)"
              className={inputCls}
            />
          </Field>

          <button
            type="submit"
            disabled={prestamoMut.isPending}
            className="rounded-lg bg-accent px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
          >
            {prestamoMut.isPending ? "Guardando…" : "Registrar préstamo"}
          </button>
        </form>
      )}

      {msg && (
        <p className={`text-xs font-semibold ${msg.tipo === "error" ? "text-danger" : "text-emerald-600"}`}>
          {msg.texto}
        </p>
      )}
      {movQ.isError && <p className="text-xs text-danger">{(movQ.error as Error).message || "No se pudo cargar"}</p>}
      {movQ.isLoading && <p className="text-sm text-muted">Cargando préstamos…</p>}

      <SeccionSaldos
        titulo="Préstamos recibidos (le debemos a…)"
        vacio="No hay préstamos recibidos registrados."
        saldos={recibido}
        direccion="recibido"
        movimientos={movsPrestamo}
        medios={medios}
        abonoAbierto={abonoAbierto}
        setAbonoAbierto={setAbonoAbierto}
        abonoForm={abonoForm}
        setAbonoForm={setAbonoForm}
        abonoMut={abonoMut}
        verHistorial={verHistorial}
        setVerHistorial={setVerHistorial}
      />
      <SeccionSaldos
        titulo="Préstamos otorgados (nos deben…)"
        vacio="No hay préstamos otorgados registrados."
        saldos={otorgado}
        direccion="otorgado"
        movimientos={movsPrestamo}
        medios={medios}
        abonoAbierto={abonoAbierto}
        setAbonoAbierto={setAbonoAbierto}
        abonoForm={abonoForm}
        setAbonoForm={setAbonoForm}
        abonoMut={abonoMut}
        verHistorial={verHistorial}
        setVerHistorial={setVerHistorial}
      />
    </div>
  );
}

function SeccionSaldos({
  titulo,
  vacio,
  saldos,
  direccion,
  movimientos,
  medios,
  abonoAbierto,
  setAbonoAbierto,
  abonoForm,
  setAbonoForm,
  abonoMut,
  verHistorial,
  setVerHistorial,
}: {
  titulo: string;
  vacio: string;
  saldos: Saldo[];
  direccion: Direccion;
  movimientos: Movimiento[];
  medios: MedioPago[];
  abonoAbierto: { terceroId: number; direccion: Direccion } | null;
  setAbonoAbierto: (v: { terceroId: number; direccion: Direccion } | null) => void;
  abonoForm: { fecha: string; monto: string; medio_pago_id: string; referencia: string };
  setAbonoForm: (fn: (f: { fecha: string; monto: string; medio_pago_id: string; referencia: string }) => typeof abonoForm) => void;
  abonoMut: ReturnType<typeof useMutation<{ ok?: boolean; error?: string }, Error, { terceroId: number; direccionAbono: Direccion; body: Record<string, unknown> }>>;
  verHistorial: number | null;
  setVerHistorial: (v: number | null) => void;
}) {
  const qc = useQueryClient();
  const tiposSet = direccion === "recibido" ? TIPOS_RECIBIDO : TIPOS_OTORGADO;

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-bold uppercase tracking-wide text-muted">{titulo}</h3>
      {saldos.length === 0 && (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-muted">{vacio}</p>
      )}
      <div className="space-y-2">
        {saldos.map((s) => {
          const abonando = abonoAbierto?.terceroId === s.tercero_id && abonoAbierto.direccion === direccion;
          const historial = movimientos.filter(
            (m) => m.tercero_id === s.tercero_id && tiposSet.has(m.tipo_origen),
          );
          const viendoHistorial = verHistorial === s.tercero_id;
          return (
            <article key={s.tercero_id} className="rounded-xl border border-border bg-surface-panel px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-ink">{s.nombre}</p>
                  <button
                    type="button"
                    onClick={() => setVerHistorial(viendoHistorial ? null : s.tercero_id)}
                    className="text-[10px] font-bold text-accent hover:underline"
                  >
                    {viendoHistorial ? "Ocultar historial" : `Ver historial (${historial.length})`}
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-[10px] uppercase text-muted">Saldo</p>
                    <p className="text-sm font-extrabold tabular-nums text-ink">{formatCop(Math.max(s.saldo, 0))}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAbonoAbierto(abonando ? null : { terceroId: s.tercero_id, direccion })}
                    className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold text-ink hover:bg-surface-hover"
                  >
                    {direccion === "recibido" ? "Abonar" : "Registrar devolución"}
                  </button>
                </div>
              </div>

              {abonando && (
                <form
                  className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface p-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!(num(abonoForm.monto) > 0) || !abonoForm.medio_pago_id) return;
                    abonoMut.mutate({
                      terceroId: s.tercero_id,
                      direccionAbono: direccion,
                      body: {
                        fecha: abonoForm.fecha,
                        monto: num(abonoForm.monto),
                        medio_pago_id: Number(abonoForm.medio_pago_id),
                        referencia: abonoForm.referencia.trim(),
                      },
                    });
                  }}
                >
                  <Field label="Fecha">
                    <input
                      type="date"
                      value={abonoForm.fecha}
                      onChange={(e) => setAbonoForm((f) => ({ ...f, fecha: e.target.value }))}
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Monto">
                    <input
                      type="number"
                      min="0"
                      step="1000"
                      value={abonoForm.monto}
                      onChange={(e) => setAbonoForm((f) => ({ ...f, monto: e.target.value }))}
                      placeholder={String(Math.round(s.saldo))}
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Medio de pago">
                    <select
                      value={abonoForm.medio_pago_id}
                      onChange={(e) => setAbonoForm((f) => ({ ...f, medio_pago_id: e.target.value }))}
                      className={inputCls}
                    >
                      <option value="">Selecciona…</option>
                      {medios.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.nombre}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <button
                    type="submit"
                    disabled={abonoMut.isPending}
                    className="rounded-lg bg-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
                  >
                    {abonoMut.isPending ? "…" : "Guardar"}
                  </button>
                </form>
              )}

              {viendoHistorial && historial.length > 0 && (
                <table className="mt-3 min-w-full text-left text-[11px]">
                  <thead className="text-[10px] uppercase text-muted">
                    <tr>
                      <th className="py-1 font-bold">Fecha</th>
                      <th className="py-1 font-bold">Concepto</th>
                      <th className="py-1 font-bold">Referencia</th>
                      <th className="py-1 font-bold">Comprobante</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historial.map((m) => (
                      <tr key={m.id} className="border-t border-border/40">
                        <td className="py-1 tabular-nums">{m.fecha}</td>
                        <td className="py-1">{m.concepto}</td>
                        <td className="py-1 text-muted">{m.referencia || "—"}</td>
                        <td className="py-1">
                          <ComprobanteWidget
                            movimientoId={m.id}
                            soportePath={m.soporte_path}
                            soporteNombre={m.soporte_nombre}
                            onUpdated={() => void qc.invalidateQueries({ queryKey: ["cc-movimientos-prestamos"] })}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

const inputCls =
  "mt-1 w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-ink";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-[9rem] flex-1 text-xs">
      <span className="font-bold text-muted">{label}</span>
      {children}
    </label>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-surface-panel px-3 py-3">
      <p className="text-[10px] font-bold uppercase text-muted">{label}</p>
      <p className={`mt-1 text-lg font-extrabold tabular-nums ${accent ? "text-accent" : "text-ink"}`}>{value}</p>
    </div>
  );
}
