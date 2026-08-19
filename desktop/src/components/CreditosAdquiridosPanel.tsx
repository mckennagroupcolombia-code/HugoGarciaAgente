import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api/client";

type FilaAmort = {
  numero: number;
  fecha: string;
  capital: number;
  intereses: number;
  seguro: number;
  cuota: number;
  saldo: number;
};

type PagoCredito = {
  id: number;
  fecha: string;
  monto: number;
  capital: number;
  intereses: number;
  extras: number;
  numero_cuota?: number | null;
  notas?: string;
  comprobante?: string;
};

type Credito = {
  id: number;
  nombre: string;
  acreedor: string;
  tipo: string;
  tipo_label?: string;
  numero_contrato: string;
  monto_original: number;
  tasa_anual_pct: number;
  tipo_tasa: string;
  sistema: string;
  plazo_meses: number;
  periodicidad: string;
  cuota_pactada: number | null;
  seguro_cuota: number;
  fecha_desembolso: string;
  fecha_primera_cuota: string;
  dia_pago: number | null;
  garantia: string;
  estado: string;
  notas: string;
  saldo: number;
  capital_pagado: number;
  intereses_pagados: number;
  total_pagado: number;
  cuota_calculada: number;
  cuota_periodo: number;
  n_cuotas: number;
  cuotas_pagadas: number;
  cuotas_restantes: number;
  proxima_cuota_fecha: string;
  en_mora: boolean;
  total_pagar_estimado: number;
  total_intereses_estimado: number;
  pagos?: PagoCredito[];
  tabla?: FilaAmort[];
};

type Resumen = {
  creditos: number;
  activos: number;
  deuda_vigente: number;
  cuota_mensual_consolidada: number;
  proxima_cuota_fecha: string;
  proxima_cuota_nombre: string;
  proxima_cuota_monto: number;
};

const TIPOS = [
  { id: "prestamo_bancario", label: "Préstamo bancario" },
  { id: "credito_rotativo", label: "Crédito rotativo" },
  { id: "leasing", label: "Leasing" },
  { id: "credito_proveedor", label: "Crédito de proveedor" },
  { id: "tarjeta", label: "Tarjeta empresarial" },
  { id: "socio", label: "Préstamo de socio" },
  { id: "otro", label: "Otro" },
] as const;

const SISTEMAS = [
  { id: "frances", label: "Francés (cuota fija)" },
  { id: "aleman", label: "Alemán (capital fijo)" },
  { id: "interes_solo", label: "Solo interés (capital al final)" },
] as const;

const emptyForm = {
  nombre: "",
  acreedor: "",
  tipo: "prestamo_bancario",
  numero_contrato: "",
  monto_original: "",
  tasa_anual_pct: "",
  tipo_tasa: "EA",
  sistema: "frances",
  plazo_meses: "12",
  periodicidad: "mensual",
  cuota_pactada: "",
  seguro_cuota: "",
  fecha_desembolso: new Date().toISOString().slice(0, 10),
  fecha_primera_cuota: "",
  dia_pago: "",
  garantia: "",
  estado: "activo",
  notas: "",
};

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

function formToBody(form: typeof emptyForm): Record<string, unknown> {
  return {
    nombre: form.nombre.trim(),
    acreedor: form.acreedor.trim(),
    tipo: form.tipo,
    numero_contrato: form.numero_contrato.trim(),
    monto_original: num(form.monto_original),
    tasa_anual_pct: num(form.tasa_anual_pct),
    tipo_tasa: form.tipo_tasa,
    sistema: form.sistema,
    plazo_meses: Math.round(num(form.plazo_meses)),
    periodicidad: form.periodicidad,
    cuota_pactada: form.cuota_pactada.trim() ? num(form.cuota_pactada) : null,
    seguro_cuota: num(form.seguro_cuota),
    fecha_desembolso: form.fecha_desembolso,
    fecha_primera_cuota: form.fecha_primera_cuota || form.fecha_desembolso,
    dia_pago: form.dia_pago.trim() ? Math.round(num(form.dia_pago)) : null,
    garantia: form.garantia.trim(),
    estado: form.estado,
    notas: form.notas.trim(),
  };
}

function creditoToForm(c: Credito): typeof emptyForm {
  return {
    nombre: c.nombre,
    acreedor: c.acreedor || "",
    tipo: c.tipo || "prestamo_bancario",
    numero_contrato: c.numero_contrato || "",
    monto_original: String(c.monto_original || ""),
    tasa_anual_pct: String(c.tasa_anual_pct || ""),
    tipo_tasa: c.tipo_tasa || "EA",
    sistema: c.sistema || "frances",
    plazo_meses: String(c.plazo_meses || "12"),
    periodicidad: c.periodicidad || "mensual",
    cuota_pactada: c.cuota_pactada ? String(c.cuota_pactada) : "",
    seguro_cuota: c.seguro_cuota ? String(c.seguro_cuota) : "",
    fecha_desembolso: (c.fecha_desembolso || "").slice(0, 10),
    fecha_primera_cuota: (c.fecha_primera_cuota || "").slice(0, 10),
    dia_pago: c.dia_pago != null ? String(c.dia_pago) : "",
    garantia: c.garantia || "",
    estado: c.estado || "activo",
    notas: c.notas || "",
  };
}

export default function CreditosAdquiridosPanel() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [msg, setMsg] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<number | null>(null);
  const [verTabla, setVerTabla] = useState<number | null>(null);
  const [pagoForm, setPagoForm] = useState({ fecha: new Date().toISOString().slice(0, 10), monto: "", notas: "" });

  const listQ = useQuery<{ creditos: Credito[]; resumen: Resumen }>({
    queryKey: ["creditos-adquiridos"],
    queryFn: () => api.get("/api/contabilidad/creditos"),
  });

  const detalleQ = useQuery<{ credito: Credito }>({
    queryKey: ["credito-detalle", abierto],
    queryFn: () => api.get(`/api/contabilidad/creditos/${abierto}`),
    enabled: abierto != null,
  });

  const simBody = useMemo(() => formToBody(form), [form]);
  const [simDebounced, setSimDebounced] = useState(simBody);
  useEffect(() => {
    const t = window.setTimeout(() => setSimDebounced(simBody), 350);
    return () => window.clearTimeout(t);
  }, [simBody]);
  const puedeSimular = num(form.monto_original) > 0 && num(form.plazo_meses) > 0;

  const simQ = useQuery<{
    cuota: number;
    n_cuotas: number;
    total_pagar: number;
    total_intereses: number;
    tasa_periodo_pct: number;
  }>({
    queryKey: ["credito-simular", simDebounced],
    queryFn: () => api.post("/api/contabilidad/creditos/simular", simDebounced),
    enabled: showForm && puedeSimular,
    staleTime: 8_000,
    refetchOnWindowFocus: false,
  });

  const guardarMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editingId
        ? api.patch<{ ok?: boolean; credito?: Credito }>(`/api/contabilidad/creditos/${editingId}`, body)
        : api.post<{ ok?: boolean; credito?: Credito }>("/api/contabilidad/creditos", body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["creditos-adquiridos"] });
      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm);
      setMsg(editingId ? "Crédito actualizado" : "Crédito registrado");
    },
    onError: (e) => setMsg((e as Error).message || "No se pudo guardar"),
  });

  const borrarMut = useMutation({
    mutationFn: (id: number) => api.delete<{ ok?: boolean }>(`/api/contabilidad/creditos/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["creditos-adquiridos"] });
      setAbierto(null);
    },
  });

  const pagoMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      api.post<{ ok?: boolean }>(`/api/contabilidad/creditos/${id}/pagos`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["creditos-adquiridos"] });
      void qc.invalidateQueries({ queryKey: ["credito-detalle"] });
      void qc.invalidateQueries({ queryKey: ["ingresos-egresos"] });
      setPagoForm((f) => ({ ...f, monto: "", notas: "" }));
      setMsg("Cuota registrada");
    },
    onError: (e) => setMsg((e as Error).message || "No se pudo registrar el pago"),
  });

  const borrarPagoMut = useMutation({
    mutationFn: (pagoId: number) =>
      api.delete<{ ok?: boolean }>(`/api/contabilidad/creditos/pagos/${pagoId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["creditos-adquiridos"] });
      void qc.invalidateQueries({ queryKey: ["credito-detalle"] });
      void qc.invalidateQueries({ queryKey: ["ingresos-egresos"] });
    },
  });

  useEffect(() => {
    if (!msg) return;
    const t = window.setTimeout(() => setMsg(null), 4000);
    return () => window.clearTimeout(t);
  }, [msg]);

  const creditos = listQ.data?.creditos ?? [];
  const resumen = listQ.data?.resumen;
  const detalle = detalleQ.data?.credito;

  function abrirNuevo() {
    setEditingId(null);
    setForm({
      ...emptyForm,
      fecha_desembolso: new Date().toISOString().slice(0, 10),
    });
    setMsg(null);
    setShowForm(true);
  }

  function abrirEditar(c: Credito) {
    setEditingId(c.id);
    setForm(creditoToForm(c));
    setMsg(null);
    setShowForm(true);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-ink">Créditos adquiridos</h2>
          <p className="mt-1 text-xs text-muted">
            Préstamos, leasing y créditos de proveedores: tasa anual, cuota, plazo y saldo. Las
            cuotas pagadas entran al libro de Ingresos / Egresos.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (showForm) {
              setShowForm(false);
              setEditingId(null);
            } else {
              abrirNuevo();
            }
          }}
          className="rounded-lg bg-accent px-3 py-2 text-xs font-bold text-white hover:bg-accent-hover"
        >
          {showForm ? "Cancelar" : "+ Registrar crédito"}
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Kpi label="Deuda vigente" value={formatCop(resumen?.deuda_vigente || 0)} accent />
        <Kpi label="Cuota mensual consolidada" value={formatCop(resumen?.cuota_mensual_consolidada || 0)} />
        <Kpi label="Créditos activos" value={String(resumen?.activos ?? 0)} />
        <Kpi
          label="Próximo vencimiento"
          value={
            resumen?.proxima_cuota_fecha
              ? `${resumen.proxima_cuota_fecha} · ${formatCop(resumen.proxima_cuota_monto || 0)}`
              : "—"
          }
          small
        />
      </div>

      {showForm && (
        <form
          className="space-y-3 rounded-xl border border-border bg-surface-panel p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.nombre.trim()) {
              setMsg("Indica un nombre (banco, contrato o propósito)");
              return;
            }
            if (!(num(form.monto_original) > 0) || !(num(form.plazo_meses) > 0)) {
              setMsg("Monto y plazo son obligatorios");
              return;
            }
            guardarMut.mutate(formToBody(form));
          }}
        >
          <p className="text-xs font-bold uppercase tracking-wide text-muted">
            {editingId ? "Editar crédito" : "Nuevo crédito"}
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Nombre / propósito">
              <input
                value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                placeholder="Ej. Capital de trabajo Bancolombia"
                className={inputCls}
                required
              />
            </Field>
            <Field label="Acreedor">
              <input
                value={form.acreedor}
                onChange={(e) => setForm((f) => ({ ...f, acreedor: e.target.value }))}
                placeholder="Banco, proveedor o socio"
                className={inputCls}
              />
            </Field>
            <Field label="Tipo">
              <select
                value={form.tipo}
                onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value }))}
                className={inputCls}
              >
                {TIPOS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Monto desembolsado (COP)">
              <input
                type="number"
                min="0"
                step="1000"
                value={form.monto_original}
                onChange={(e) => setForm((f) => ({ ...f, monto_original: e.target.value }))}
                className={inputCls}
                required
              />
            </Field>
            <Field label="Tasa de interés anual (%)">
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.tasa_anual_pct}
                onChange={(e) => setForm((f) => ({ ...f, tasa_anual_pct: e.target.value }))}
                placeholder="Ej. 24.5"
                className={inputCls}
              />
            </Field>
            <Field label="Tipo de tasa">
              <select
                value={form.tipo_tasa}
                onChange={(e) => setForm((f) => ({ ...f, tipo_tasa: e.target.value }))}
                className={inputCls}
              >
                <option value="EA">EA — efectiva anual</option>
                <option value="NA_MV">N.A.M.V. — nominal anual mes vencido</option>
              </select>
            </Field>
            <Field label="Sistema de amortización">
              <select
                value={form.sistema}
                onChange={(e) => setForm((f) => ({ ...f, sistema: e.target.value }))}
                className={inputCls}
              >
                {SISTEMAS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Plazo (meses)">
              <input
                type="number"
                min="1"
                step="1"
                value={form.plazo_meses}
                onChange={(e) => setForm((f) => ({ ...f, plazo_meses: e.target.value }))}
                className={inputCls}
                required
              />
            </Field>
            <Field label="Periodicidad">
              <select
                value={form.periodicidad}
                onChange={(e) => setForm((f) => ({ ...f, periodicidad: e.target.value }))}
                className={inputCls}
              >
                <option value="mensual">Mensual</option>
                <option value="quincenal">Quincenal</option>
                <option value="trimestral">Trimestral</option>
              </select>
            </Field>
            <Field label="Cuota pactada (opcional)">
              <input
                type="number"
                min="0"
                step="1000"
                value={form.cuota_pactada}
                onChange={(e) => setForm((f) => ({ ...f, cuota_pactada: e.target.value }))}
                placeholder="Vacío = se calcula"
                className={inputCls}
              />
            </Field>
            <Field label="Seguro / extra por cuota">
              <input
                type="number"
                min="0"
                step="1000"
                value={form.seguro_cuota}
                onChange={(e) => setForm((f) => ({ ...f, seguro_cuota: e.target.value }))}
                className={inputCls}
              />
            </Field>
            <Field label="Nº contrato / obligación">
              <input
                value={form.numero_contrato}
                onChange={(e) => setForm((f) => ({ ...f, numero_contrato: e.target.value }))}
                className={inputCls}
              />
            </Field>
            <Field label="Fecha de desembolso">
              <input
                type="date"
                value={form.fecha_desembolso}
                onChange={(e) => setForm((f) => ({ ...f, fecha_desembolso: e.target.value }))}
                className={inputCls}
              />
            </Field>
            <Field label="Fecha primera cuota">
              <input
                type="date"
                value={form.fecha_primera_cuota}
                onChange={(e) => setForm((f) => ({ ...f, fecha_primera_cuota: e.target.value }))}
                className={inputCls}
              />
            </Field>
            <Field label="Día de pago (1–31)">
              <input
                type="number"
                min="1"
                max="31"
                value={form.dia_pago}
                onChange={(e) => setForm((f) => ({ ...f, dia_pago: e.target.value }))}
                className={inputCls}
              />
            </Field>
            <Field label="Garantía">
              <input
                value={form.garantia}
                onChange={(e) => setForm((f) => ({ ...f, garantia: e.target.value }))}
                placeholder="Codeudor, prenda, pagaré…"
                className={inputCls}
              />
            </Field>
            {editingId != null && (
              <Field label="Estado">
                <select
                  value={form.estado}
                  onChange={(e) => setForm((f) => ({ ...f, estado: e.target.value }))}
                  className={inputCls}
                >
                  <option value="activo">Activo</option>
                  <option value="en_mora">En mora</option>
                  <option value="pagado">Pagado</option>
                  <option value="cancelado">Cancelado</option>
                </select>
              </Field>
            )}
          </div>
          <Field label="Notas">
            <textarea
              value={form.notas}
              onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))}
              rows={2}
              className={inputCls}
            />
          </Field>

          {puedeSimular && (
            <div className="grid gap-2 rounded-lg border border-accent/30 bg-accent/5 p-3 sm:grid-cols-4">
              <SimStat label="Cuota" value={formatCop(simQ.data?.cuota || 0)} />
              <SimStat label="Nº cuotas" value={String(simQ.data?.n_cuotas ?? "—")} />
              <SimStat label="Total a pagar" value={formatCop(simQ.data?.total_pagar || 0)} />
              <SimStat label="Intereses totales" value={formatCop(simQ.data?.total_intereses || 0)} />
            </div>
          )}

          <button
            type="submit"
            disabled={guardarMut.isPending}
            className="rounded-lg bg-accent px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
          >
            {guardarMut.isPending ? "Guardando…" : editingId ? "Guardar cambios" : "Registrar crédito"}
          </button>
        </form>
      )}

      {msg && <p className="text-xs font-semibold text-emerald-600">{msg}</p>}
      {listQ.isError && (
        <p className="text-xs text-danger">{(listQ.error as Error).message || "No se pudo cargar"}</p>
      )}

      {listQ.isLoading && <p className="text-sm text-muted">Cargando créditos…</p>}
      {!listQ.isLoading && creditos.length === 0 && !showForm && (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
          Aún no hay créditos. Registra el primero con tasa anual, plazo y cuota.
        </p>
      )}

      <div className="space-y-3">
        {creditos.map((c) => {
          const open = abierto === c.id;
          const det = open ? detalle ?? c : c;
          const progreso =
            det.monto_original > 0 ? Math.min(100, (det.capital_pagado / det.monto_original) * 100) : 0;
          return (
            <article key={c.id} className="rounded-xl border border-border bg-surface-panel">
              <button
                type="button"
                onClick={() => setAbierto(open ? null : c.id)}
                className="flex w-full flex-wrap items-start justify-between gap-3 px-4 py-3 text-left"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-ink">{c.nombre}</p>
                  <p className="text-[11px] text-muted">
                    {c.tipo_label || c.tipo}
                    {c.acreedor ? ` · ${c.acreedor}` : ""}
                    {c.numero_contrato ? ` · ${c.numero_contrato}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-right">
                  {c.en_mora && (
                    <span className="rounded-full bg-danger/15 px-2 py-0.5 text-[10px] font-bold uppercase text-danger">
                      En mora
                    </span>
                  )}
                  <span className="text-[10px] font-bold uppercase text-muted">{c.estado}</span>
                  <div>
                    <p className="text-[10px] uppercase text-muted">Saldo</p>
                    <p className="text-sm font-extrabold tabular-nums text-ink">{formatCop(c.saldo)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-muted">Cuota</p>
                    <p className="text-sm font-bold tabular-nums text-accent">{formatCop(c.cuota_periodo)}</p>
                  </div>
                </div>
              </button>

              <div className="h-1 bg-surface">
                <div className="h-1 bg-accent" style={{ width: `${progreso}%` }} />
              </div>

              {open && (
                <div className="space-y-3 border-t border-border px-4 py-3">
                  <dl className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                    <Info k="Tasa anual" v={`${det.tasa_anual_pct}% ${det.tipo_tasa}`} />
                    <Info k="Plazo" v={`${det.plazo_meses} meses · ${det.periodicidad}`} />
                    <Info k="Sistema" v={SISTEMAS.find((s) => s.id === det.sistema)?.label || det.sistema} />
                    <Info k="Desembolso" v={formatCop(det.monto_original)} />
                    <Info k="Capital pagado" v={formatCop(det.capital_pagado)} />
                    <Info k="Intereses pagados" v={formatCop(det.intereses_pagados)} />
                    <Info k="Cuotas" v={`${det.cuotas_pagadas} / ${det.n_cuotas}`} />
                    <Info k="Próxima cuota" v={det.proxima_cuota_fecha || "—"} />
                    {det.garantia ? <Info k="Garantía" v={det.garantia} /> : null}
                    {det.notas ? <Info k="Notas" v={det.notas} /> : null}
                  </dl>

                  <form
                    className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface p-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const monto = num(pagoForm.monto);
                      if (!(monto > 0)) {
                        setMsg("Indica el monto de la cuota");
                        return;
                      }
                      pagoMut.mutate({
                        id: c.id,
                        body: {
                          fecha: pagoForm.fecha,
                          monto,
                          notas: pagoForm.notas.trim(),
                        },
                      });
                    }}
                  >
                    <Field label="Registrar pago">
                      <input
                        type="date"
                        value={pagoForm.fecha}
                        onChange={(e) => setPagoForm((f) => ({ ...f, fecha: e.target.value }))}
                        className={inputCls}
                      />
                    </Field>
                    <Field label="Monto">
                      <input
                        type="number"
                        min="0"
                        step="1000"
                        value={pagoForm.monto}
                        onChange={(e) => setPagoForm((f) => ({ ...f, monto: e.target.value }))}
                        placeholder={String(Math.round(det.cuota_periodo || 0))}
                        className={inputCls}
                      />
                    </Field>
                    <Field label="Notas">
                      <input
                        value={pagoForm.notas}
                        onChange={(e) => setPagoForm((f) => ({ ...f, notas: e.target.value }))}
                        className={inputCls}
                      />
                    </Field>
                    <button
                      type="submit"
                      disabled={pagoMut.isPending}
                      className="rounded-lg bg-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
                    >
                      {pagoMut.isPending ? "…" : "Pagar cuota"}
                    </button>
                  </form>

                  {(det.pagos?.length ?? 0) > 0 && (
                    <table className="min-w-full text-left text-xs">
                      <thead className="text-[10px] uppercase text-muted">
                        <tr>
                          <th className="py-1 font-bold">Fecha</th>
                          <th className="py-1 font-bold">#</th>
                          <th className="py-1 font-bold">Monto</th>
                          <th className="py-1 font-bold">Capital</th>
                          <th className="py-1 font-bold">Intereses</th>
                          <th className="py-1 font-bold" />
                        </tr>
                      </thead>
                      <tbody>
                        {det.pagos!.map((p) => (
                          <tr key={p.id} className="border-t border-border/50">
                            <td className="py-1 tabular-nums">{p.fecha}</td>
                            <td className="py-1">{p.numero_cuota ?? "—"}</td>
                            <td className="py-1 font-semibold tabular-nums">{formatCop(p.monto)}</td>
                            <td className="py-1 tabular-nums">{formatCop(p.capital)}</td>
                            <td className="py-1 tabular-nums">{formatCop(p.intereses)}</td>
                            <td className="py-1 text-right">
                              <button
                                type="button"
                                className="text-[10px] font-bold text-danger hover:underline"
                                onClick={() => {
                                  if (confirm("¿Eliminar este pago?")) borrarPagoMut.mutate(p.id);
                                }}
                              >
                                Borrar
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setVerTabla(verTabla === c.id ? null : c.id)}
                      className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold text-ink hover:bg-surface-hover"
                    >
                      {verTabla === c.id ? "Ocultar amortización" : "Ver tabla de amortización"}
                    </button>
                    <button
                      type="button"
                      onClick={() => abrirEditar(c)}
                      className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold text-ink hover:bg-surface-hover"
                    >
                      Editar condiciones
                    </button>
                    <button
                      type="button"
                      disabled={borrarMut.isPending}
                      onClick={() => {
                        if (confirm("¿Eliminar este crédito y sus pagos?")) borrarMut.mutate(c.id);
                      }}
                      className="rounded-lg px-3 py-1.5 text-[11px] font-bold text-danger hover:underline"
                    >
                      Eliminar crédito
                    </button>
                  </div>

                  {verTabla === c.id && (
                    <div className="max-h-72 overflow-auto rounded-lg border border-border">
                      {detalleQ.isLoading && <p className="px-3 py-2 text-xs text-muted">Calculando…</p>}
                      <table className="min-w-full text-left text-[11px]">
                        <thead className="sticky top-0 bg-surface text-[10px] uppercase text-muted">
                          <tr>
                            <th className="px-2 py-1">#</th>
                            <th className="px-2 py-1">Fecha</th>
                            <th className="px-2 py-1">Cuota</th>
                            <th className="px-2 py-1">Capital</th>
                            <th className="px-2 py-1">Intereses</th>
                            <th className="px-2 py-1">Saldo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(det.tabla || []).map((f) => (
                            <tr key={f.numero} className="border-t border-border/40">
                              <td className="px-2 py-1">{f.numero}</td>
                              <td className="px-2 py-1 tabular-nums">{f.fecha || "—"}</td>
                              <td className="px-2 py-1 tabular-nums">{formatCop(f.cuota)}</td>
                              <td className="px-2 py-1 tabular-nums">{formatCop(f.capital)}</td>
                              <td className="px-2 py-1 tabular-nums">{formatCop(f.intereses)}</td>
                              <td className="px-2 py-1 tabular-nums">{formatCop(f.saldo)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
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

function Kpi({
  label,
  value,
  accent,
  small,
}: {
  label: string;
  value: string;
  accent?: boolean;
  small?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-panel px-3 py-3">
      <p className="text-[10px] font-bold uppercase text-muted">{label}</p>
      <p
        className={`mt-1 font-extrabold tabular-nums ${
          small ? "text-xs" : "text-lg"
        } ${accent ? "text-accent" : "text-ink"}`}
      >
        {value}
      </p>
    </div>
  );
}

function SimStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase text-muted">{label}</p>
      <p className="text-sm font-extrabold tabular-nums text-ink">{value}</p>
    </div>
  );
}

function Info({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase text-muted">{k}</dt>
      <dd className="font-semibold text-ink">{v}</dd>
    </div>
  );
}
