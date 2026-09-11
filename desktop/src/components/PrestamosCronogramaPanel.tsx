import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, fetchAuthBlobUrl } from "../api/client";
import TerceroSelect from "./TerceroSelect";

/**
 * Préstamos recibidos de terceros, con cronograma, retención y documentos.
 *
 * Distinto del registro simple de `PrestamosPanel` (un desembolso y abonos
 * sueltos): acá el préstamo es un producto con condiciones pactadas — tasa
 * efectiva anual, plazo, reparto de amortización por tramos — del que se
 * derivan un cronograma de N cuotas, un contrato en PDF para el prestamista y
 * un ticket mensual a despachos para montar los pagos en el banco.
 *
 * Las tres cifras que el panel muestra siempre juntas, porque confundirlas es
 * el error clásico del producto:
 *   - tasa pactada (lo único que se acuerda),
 *   - rendimiento bruto del plazo (consecuencia del cronograma),
 *   - rendimiento neto girado (después de la retención del 7%).
 */

type Tercero = {
  id: number;
  nombre: string;
  tipo: string;
  tipo_persona?: string;
  identificacion: string;
  email: string;
  telefono?: string;
  cuenta_bancaria?: string;
};

type Cuota = {
  id: number;
  numero: number;
  fecha_vencimiento: string;
  saldo_inicial: number;
  interes_bruto: number;
  retencion: number;
  interes_girado: number;
  abono_capital: number;
  cuota_causada: number;
  cuota_girada: number;
  saldo_final: number;
  estado: "pendiente" | "solicitada" | "pagada";
  fecha_pago: string;
  movimiento_id: number | null;
  ticket_id: number | null;
  doc_soporte_estado: "" | "pendiente" | "sombra" | "emitido" | "no_aplica" | "error";
  doc_soporte_id: string;
  doc_soporte_numero: string;
};

type Resumen = {
  cuotas: number;
  cuotas_pagadas: number;
  capital_pagado: number;
  capital_pendiente: number;
  interes_pagado: number;
  interes_total: number;
  retencion_practicada: number;
  retencion_total: number;
  rendimiento_bruto_pct: number;
  rendimiento_neto_pct: number;
  tasa_mensual_pct: number;
};

type Prestamo = {
  id: number;
  tercero_id: number;
  capital: number;
  tasa_ea: number;
  plazo_meses: number;
  meses_tramo1: number;
  pct_capital_tramo1: number;
  retencion_pct: number;
  gross_up: boolean;
  fecha_desembolso: string;
  dia_pago: number | null;
  estado: "vigente" | "pagado" | "anulado";
  referencia: string;
  notas: string;
  tercero: Tercero | null;
  resumen: Resumen;
  doc_soporte?: Record<string, number>;
  cuotas?: Cuota[];
};

type MedioPago = { id: number; nombre: string; cuenta_id: number; activo: number };

type Simulacion = {
  cuotas: Array<Omit<Cuota, "id" | "estado" | "fecha_pago" | "movimiento_id" | "ticket_id" | "fecha_vencimiento"> & { fecha: string | null }>;
  totales: {
    capital: number;
    interes_bruto: number;
    retencion: number;
    interes_girado: number;
    total_causado: number;
    total_girado: number;
    saldo_promedio: number;
    rendimiento_bruto_pct: number;
    rendimiento_neto_pct: number;
    costo_real_ea_pct: number;
  };
  parametros: { tasa_mensual_pct: number };
};

type Retenciones = {
  periodo: string;
  terceros: Array<{ nombre: string; identificacion: string; base: number; retencion: number }>;
  base_total: number;
  total_retencion: number;
  pagos: number;
  control_2365: number;
  cuadra_con_libro: boolean;
  documentos_soporte_pendientes: number;
  vencimiento: {
    conocido: boolean;
    fecha?: string;
    dias_restantes?: number;
    ultimo_digito?: number | null;
    nit?: string;
    estado: "vencido" | "hoy" | "proximo" | "a_tiempo" | "desconocido";
    motivo?: string;
    fuente?: string;
  };
};

type AlegraEstado = { existe: boolean; id: string | null; nombre: string; email: string; error: string };

function cop(n: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n || 0);
}

function pct(n: number, dec = 2): string {
  return `${(n ?? 0).toFixed(dec).replace(".", ",")}%`;
}

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

function num(v: string): number {
  const n = parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

const emptyForm = {
  tercero_id: "",
  capital: "",
  fecha_desembolso: hoy(),
  medio_pago_id: "",
  tasa_ea_pct: "25",
  plazo_meses: "24",
  meses_tramo1: "12",
  pct_capital_tramo1: "30",
  retencion_pct: "7",
  gross_up: false,
  dia_pago: "5",
  referencia: "",
  notas: "",
};

export default function PrestamosCronogramaPanel() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [abierto, setAbierto] = useState<number | null>(null);
  const [altaAbierta, setAltaAbierta] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  const listaQ = useQuery<{ prestamos: Prestamo[] }>({
    queryKey: ["prestamos"],
    queryFn: () => api.get("/api/prestamos"),
  });
  const mediosQ = useQuery<{ medios_pago: MedioPago[] }>({
    queryKey: ["cc-medios-pago"],
    queryFn: () => api.get("/api/contabilidad/cc/medios-pago"),
  });
  const medios = (mediosQ.data?.medios_pago ?? []).filter((m) => m.activo);
  const prestamos = listaQ.data?.prestamos ?? [];

  useEffect(() => {
    if (!msg) return;
    const t = window.setTimeout(() => setMsg(null), 5000);
    return () => window.clearTimeout(t);
  }, [msg]);

  // Simulación en vivo mientras se llena el formulario: el operador ve qué
  // ofrece y qué le cuesta ANTES de comprometerse con el prestamista.
  const paramsSim = useMemo(
    () => ({
      capital: num(form.capital),
      tasa_ea: num(form.tasa_ea_pct) / 100,
      plazo_meses: Math.round(num(form.plazo_meses)) || 24,
      meses_tramo1: Math.round(num(form.meses_tramo1)),
      pct_capital_tramo1: num(form.pct_capital_tramo1) / 100,
      retencion_pct: num(form.retencion_pct) / 100,
      gross_up: form.gross_up,
      fecha_desembolso: form.fecha_desembolso,
      dia_pago: Math.round(num(form.dia_pago)) || null,
    }),
    [form],
  );
  const simQ = useQuery<Simulacion>({
    queryKey: ["prestamo-simular", paramsSim],
    queryFn: () => api.post("/api/prestamos/simular", paramsSim),
    enabled: showForm && paramsSim.capital > 0,
    retry: false,
  });

  const crearMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ ok?: boolean; error?: string; prestamo?: Prestamo }>("/api/prestamos", body),
    onSuccess: (r) => {
      if (r.error) return setMsg({ tipo: "error", texto: r.error });
      setMsg({ tipo: "ok", texto: `Préstamo #${r.prestamo?.id} registrado con su cronograma` });
      setForm(emptyForm);
      setShowForm(false);
      setAbierto(r.prestamo?.id ?? null);
      void qc.invalidateQueries({ queryKey: ["prestamos"] });
      void qc.invalidateQueries({ queryKey: ["cc-movimientos"] });
    },
    onError: (e) => setMsg({ tipo: "error", texto: (e as Error).message }),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-ink">Préstamos con cronograma</h2>
          <p className="mt-1 max-w-3xl text-xs text-muted">
            Préstamos de terceros con condiciones pactadas: tasa efectiva anual, plazo y reparto de
            amortización. Genera el cronograma, el contrato en PDF para el prestamista, el ticket
            mensual a despachos y los asientos contables (capital a 2295/2380, interés a 5305,
            retención a 2365).
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setAltaAbierta((v) => !v)}
            className="rounded-lg border border-border px-3 py-2 text-xs font-bold text-ink hover:border-accent"
          >
            {altaAbierta ? "Cancelar" : "+ Prestamista"}
          </button>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="rounded-lg bg-accent px-3 py-2 text-xs font-bold text-white hover:bg-accent-hover"
          >
            {showForm ? "Cancelar" : "+ Nuevo préstamo"}
          </button>
        </div>
      </div>

      {msg && (
        <div
          className={`rounded-lg px-3 py-2 text-xs font-bold ${
            msg.tipo === "ok" ? "bg-emerald-500/15 text-emerald-500" : "bg-red-500/15 text-red-500"
          }`}
        >
          {msg.texto}
        </div>
      )}

      {altaAbierta && (
        <AltaPrestamista
          onCerrar={() => setAltaAbierta(false)}
          onCreado={(t) => {
            setForm((f) => ({ ...f, tercero_id: String(t.id) }));
            setAltaAbierta(false);
            setShowForm(true);
            setMsg({ tipo: "ok", texto: `${t.nombre} quedó registrado y seleccionado` });
          }}
          onMensaje={setMsg}
        />
      )}

      {showForm && (
        <FormularioPrestamo
          form={form}
          setForm={setForm}
          medios={medios}
          sim={simQ.data}
          simError={simQ.error ? (simQ.error as Error).message : null}
          pendiente={crearMut.isPending}
          onNuevoPrestamista={() => setAltaAbierta(true)}
          onSubmit={() => {
            if (!form.tercero_id || !(num(form.capital) > 0) || !form.medio_pago_id) {
              setMsg({ tipo: "error", texto: "Prestamista, capital y medio de pago son obligatorios" });
              return;
            }
            crearMut.mutate({
              tercero_id: Number(form.tercero_id),
              capital: num(form.capital),
              medio_pago_id: Number(form.medio_pago_id),
              fecha_desembolso: form.fecha_desembolso,
              tasa_ea: num(form.tasa_ea_pct) / 100,
              plazo_meses: Math.round(num(form.plazo_meses)),
              meses_tramo1: Math.round(num(form.meses_tramo1)),
              pct_capital_tramo1: num(form.pct_capital_tramo1) / 100,
              retencion_pct: num(form.retencion_pct) / 100,
              gross_up: form.gross_up,
              dia_pago: Math.round(num(form.dia_pago)) || undefined,
              referencia: form.referencia.trim(),
              notas: form.notas.trim(),
            });
          }}
        />
      )}

      {prestamos.length > 0 && <PanelRetenciones onMensaje={setMsg} />}

      {listaQ.isLoading && <p className="text-xs text-muted">Cargando préstamos…</p>}
      {!listaQ.isLoading && prestamos.length === 0 && (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-xs text-muted">
          Todavía no hay préstamos con cronograma registrados.
        </p>
      )}

      <div className="space-y-3">
        {prestamos.map((p) => (
          <TarjetaPrestamo
            key={p.id}
            prestamo={p}
            abierto={abierto === p.id}
            onToggle={() => setAbierto(abierto === p.id ? null : p.id)}
            medios={medios}
            onMensaje={setMsg}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Formulario + simulador ────────────────────────────────────────────────

function FormularioPrestamo({
  form,
  setForm,
  medios,
  sim,
  simError,
  pendiente,
  onSubmit,
  onNuevoPrestamista,
}: {
  form: typeof emptyForm;
  setForm: (fn: (f: typeof emptyForm) => typeof emptyForm) => void;
  medios: MedioPago[];
  sim?: Simulacion;
  simError: string | null;
  pendiente: boolean;
  onSubmit: () => void;
  onNuevoPrestamista: () => void;
}) {
  const set = (k: keyof typeof emptyForm, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));
  const t = sim?.totales;

  return (
    <form
      className="space-y-4 rounded-xl border border-border bg-surface-panel p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="min-w-[9rem] flex-1">
          <TerceroSelect
            label="¿Quién presta?"
            value={form.tercero_id}
            onChange={(id) => set("tercero_id", id)}
          />
          <button
            type="button" onClick={onNuevoPrestamista}
            className="mt-1 text-[10px] font-bold text-accent underline"
          >
            + Registrar un prestamista nuevo
          </button>
        </div>
        <Field label="Capital (COP)">
          <input
            type="number" min="0" step="10000" required className={inputCls}
            value={form.capital} onChange={(e) => set("capital", e.target.value)}
          />
        </Field>
        <Field label="Fecha de desembolso">
          <input
            type="date" required className={inputCls}
            value={form.fecha_desembolso} onChange={(e) => set("fecha_desembolso", e.target.value)}
          />
        </Field>
        <Field label="Medio de pago">
          <select
            required className={inputCls}
            value={form.medio_pago_id} onChange={(e) => set("medio_pago_id", e.target.value)}
          >
            <option value="">Selecciona…</option>
            {medios.map((m) => (
              <option key={m.id} value={m.id}>{m.nombre}</option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Tasa efectiva anual %">
          <input
            type="number" min="0" step="0.01" className={inputCls}
            value={form.tasa_ea_pct} onChange={(e) => set("tasa_ea_pct", e.target.value)}
          />
        </Field>
        <Field label="Plazo (cuotas)">
          <input
            type="number" min="1" step="1" className={inputCls}
            value={form.plazo_meses} onChange={(e) => set("plazo_meses", e.target.value)}
          />
        </Field>
        <Field label="Meses del 1er tramo">
          <input
            type="number" min="0" step="1" className={inputCls}
            value={form.meses_tramo1} onChange={(e) => set("meses_tramo1", e.target.value)}
          />
        </Field>
        <Field label="% capital en 1er tramo">
          <input
            type="number" min="0" max="100" step="1" className={inputCls}
            value={form.pct_capital_tramo1} onChange={(e) => set("pct_capital_tramo1", e.target.value)}
          />
        </Field>
        <Field label="Día de pago del mes">
          <input
            type="number" min="1" max="28" step="1" className={inputCls}
            value={form.dia_pago} onChange={(e) => set("dia_pago", e.target.value)}
          />
        </Field>
      </div>

      <p className="text-[11px] leading-relaxed text-muted">
        Devolver el capital más tarde sube lo que gana el prestamista <strong>sin cambiar la tasa</strong>:
        con 30% en el primer tramo el rendimiento del plazo es mayor que con 50% (amortización recta),
        y McKenna paga la misma efectiva anual porque tuvo el capital trabajando más tiempo.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Retención en la fuente %">
          <input
            type="number" min="0" max="100" step="0.1" className={inputCls}
            value={form.retencion_pct} onChange={(e) => set("retencion_pct", e.target.value)}
          />
        </Field>
        <Field label="Referencia (opcional)">
          <input
            className={inputCls} value={form.referencia}
            onChange={(e) => set("referencia", e.target.value)}
          />
        </Field>
        <label className="flex items-end gap-2 pb-2 text-xs">
          <input
            type="checkbox" checked={form.gross_up}
            onChange={(e) => set("gross_up", e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          <span className="font-bold text-muted">
            McKenna asume la retención (gross-up)
          </span>
        </label>
      </div>

      {simError && (
        <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs font-bold text-red-500">{simError}</p>
      )}

      {t && (
        <div className="space-y-3 rounded-xl border border-accent/30 bg-accent/5 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-accent">
            Simulación — así queda el préstamo
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Mini label="Tasa pactada" value={pct(num(form.tasa_ea_pct))}
                  sub={`${pct(sim!.parametros.tasa_mensual_pct, 4)} mensual`} />
            <Mini label="Gana el prestamista (bruto)" value={cop(t.interes_bruto)}
                  sub={`${pct(t.rendimiento_bruto_pct)} del capital`} accent />
            <Mini label="Recibe neto (tras retención)" value={cop(t.interes_girado)}
                  sub={`${pct(t.rendimiento_neto_pct)} del capital`} />
            <Mini label="Costo real McKenna" value={pct(t.costo_real_ea_pct)}
                  sub={`capital promedio ${cop(t.saldo_promedio)}`} />
          </div>
          <div className="grid gap-2 text-[11px] sm:grid-cols-3">
            <Dato label="Retención a la DIAN" value={cop(t.retencion)} />
            <Dato label="Total que desembolsa McKenna" value={cop(t.total_causado)} />
            <Dato label="Total que recibe el prestamista" value={cop(t.total_girado)} />
          </div>
          <TablaCuotas cuotas={sim!.cuotas as unknown as Cuota[]} compacta />
        </div>
      )}

      <button
        type="submit" disabled={pendiente}
        className="rounded-lg bg-accent px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
      >
        {pendiente ? "Registrando…" : "Registrar préstamo y generar cronograma"}
      </button>
    </form>
  );
}

// ─── Tarjeta de un préstamo ────────────────────────────────────────────────

function TarjetaPrestamo({
  prestamo,
  abierto,
  onToggle,
  medios,
  onMensaje,
}: {
  prestamo: Prestamo;
  abierto: boolean;
  onToggle: () => void;
  medios: MedioPago[];
  onMensaje: (m: { tipo: "ok" | "error"; texto: string }) => void;
}) {
  const qc = useQueryClient();
  const [enviando, setEnviando] = useState<string | null>(null);
  const t = prestamo.tercero;
  const r = prestamo.resumen;
  const progreso = r.cuotas ? (r.cuotas_pagadas / r.cuotas) * 100 : 0;

  const detalleQ = useQuery<{ prestamo: Prestamo }>({
    queryKey: ["prestamo", prestamo.id],
    queryFn: () => api.get(`/api/prestamos/${prestamo.id}`),
    enabled: abierto,
  });
  // Solo se consulta al abrir la tarjeta: es una llamada a la API de Alegra.
  const alegraQ = useQuery<AlegraEstado>({
    queryKey: ["prestamo-alegra", prestamo.id],
    queryFn: () => api.get(`/api/prestamos/${prestamo.id}/alegra`),
    enabled: abierto,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const cuotas = detalleQ.data?.prestamo.cuotas ?? [];

  const pagarMut = useMutation({
    mutationFn: ({ numero, body }: { numero: number; body: Record<string, unknown> }) =>
      api.post<{ ok?: boolean; error?: string }>(
        `/api/prestamos/${prestamo.id}/cuotas/${numero}/pagar`, body,
      ),
    onSuccess: (res) => {
      if (res.error) return onMensaje({ tipo: "error", texto: res.error });
      onMensaje({ tipo: "ok", texto: "Cuota pagada — asiento contable creado" });
      void qc.invalidateQueries({ queryKey: ["prestamo", prestamo.id] });
      void qc.invalidateQueries({ queryKey: ["prestamos"] });
      void qc.invalidateQueries({ queryKey: ["cc-movimientos"] });
    },
    onError: (e) => onMensaje({ tipo: "error", texto: (e as Error).message }),
  });

  async function descargar(tipo: "contrato" | "certificado") {
    const url = await fetchAuthBlobUrl(`/api/prestamos/${prestamo.id}/documento?tipo=${tipo}`);
    if (!url) return onMensaje({ tipo: "error", texto: "No se pudo generar el PDF" });
    window.open(url, "_blank", "noopener");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async function enviar(tipo: "contrato" | "certificado") {
    const correo = t?.email || "";
    if (!window.confirm(
      `Se enviará el ${tipo} por correo a ${correo}.\n\n` +
      "Es correspondencia financiera a un tercero: revisa el PDF antes. ¿Continuar?",
    )) return;
    setEnviando(tipo);
    try {
      const res = await api.post<{ ok?: boolean; error?: string; destinatario?: string }>(
        `/api/prestamos/${prestamo.id}/enviar`, { tipo },
      );
      if (res.error) onMensaje({ tipo: "error", texto: res.error });
      else onMensaje({ tipo: "ok", texto: `Enviado a ${res.destinatario}` });
    } catch (e) {
      onMensaje({ tipo: "error", texto: (e as Error).message });
    } finally {
      setEnviando(null);
    }
  }

  return (
    <article className="rounded-xl border border-border bg-surface-panel">
      <button
        type="button" onClick={onToggle}
        className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="min-w-[12rem]">
          <p className="text-sm font-bold text-ink">
            {t?.nombre || "—"}{" "}
            <span className="text-[11px] font-normal text-muted">
              CC/NIT {t?.identificacion || "—"}
            </span>
          </p>
          <p className="mt-0.5 text-[11px] text-muted">
            {cop(prestamo.capital)} · {pct(prestamo.tasa_ea * 100)} E.A. ·{" "}
            {prestamo.plazo_meses} cuotas · desde {prestamo.fecha_desembolso}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase text-muted">Saldo</p>
            <p className="text-sm font-extrabold tabular-nums text-accent">
              {cop(r.capital_pendiente)}
            </p>
          </div>
          <div className="w-28">
            <p className="text-[10px] text-muted">
              {r.cuotas_pagadas}/{r.cuotas} cuotas
            </p>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface">
              <div className="h-full rounded-full bg-accent" style={{ width: `${progreso}%` }} />
            </div>
          </div>
          <EstadoChip estado={prestamo.estado} />
        </div>
      </button>

      {abierto && (
        <div className="space-y-4 border-t border-border/60 px-4 py-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Mini label="Rendimiento bruto del plazo" value={cop(r.interes_total)}
                  sub={`${pct(r.rendimiento_bruto_pct)} del capital`} accent />
            <Mini label="Neto al prestamista" value={cop(r.interes_total - r.retencion_total)}
                  sub={`${pct(r.rendimiento_neto_pct)} del capital`} />
            <Mini label="Retención total (a la DIAN)" value={cop(r.retencion_total)}
                  sub={`practicada ${cop(r.retencion_practicada)}`} />
            <Mini label="Tasa pactada" value={pct(prestamo.tasa_ea * 100)}
                  sub={`${pct(r.tasa_mensual_pct, 4)} mensual vencido`} />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-border bg-surface p-3">
              <p className="text-[10px] font-bold uppercase text-muted">Datos del prestamista</p>
              <dl className="mt-2 space-y-1 text-[11px]">
                <Linea k="Nombre" v={t?.nombre || "—"} />
                <Linea k="Cédula / NIT" v={t?.identificacion || "—"} />
                <Linea k="Correo" v={t?.email || "—"} />
                <Linea k="Cuenta bancaria" v={t?.cuenta_bancaria || "⚠️ sin registrar"} />
                <div className="flex justify-between gap-2 pt-1">
                  <dt className="text-muted">Contacto en Alegra</dt>
                  <dd className="text-right font-bold">
                    {alegraQ.isLoading && <span className="text-muted">consultando…</span>}
                    {alegraQ.data?.error && (
                      <span className="text-amber-500" title={alegraQ.data.error}>no verificable</span>
                    )}
                    {alegraQ.data && !alegraQ.data.error && (
                      alegraQ.data.existe ? (
                        <span className="text-emerald-500">✓ inscrito</span>
                      ) : (
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const res = await api.post<{ ok?: boolean; creado?: boolean; error?: string }>(
                                `/api/prestamos/prestamistas/${prestamo.tercero_id}/alegra`, {},
                              );
                              if (res.error || res.ok === false) {
                                onMensaje({ tipo: "error", texto: res.error ?? "Alegra rechazó el contacto" });
                              } else {
                                onMensaje({ tipo: "ok", texto: res.creado ? "Inscrito en Alegra" : "Ya estaba en Alegra" });
                                void qc.invalidateQueries({ queryKey: ["prestamo-alegra", prestamo.id] });
                              }
                            } catch (e) {
                              onMensaje({ tipo: "error", texto: (e as Error).message });
                            }
                          }}
                          className="text-amber-500 underline"
                        >
                          no inscrito — inscribir
                        </button>
                      )
                    )}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="rounded-lg border border-border bg-surface p-3">
              <p className="text-[10px] font-bold uppercase text-muted">Documentos</p>
              <p className="mt-1 text-[11px] text-muted">
                Generar es seguro; enviar es correspondencia al tercero y pide confirmación.
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {(["contrato", "certificado"] as const).map((tipo) => (
                  <div key={tipo} className="flex gap-1">
                    <button
                      type="button" onClick={() => void descargar(tipo)}
                      className="flex-1 rounded-lg border border-border px-2 py-1.5 text-[11px] font-bold text-ink hover:border-accent"
                    >
                      Ver {tipo}
                    </button>
                    <button
                      type="button" onClick={() => void enviar(tipo)}
                      disabled={!t?.email || enviando === tipo}
                      title={t?.email ? `Enviar a ${t.email}` : "El tercero no tiene correo"}
                      className="rounded-lg bg-accent px-2 py-1.5 text-[11px] font-bold text-white disabled:opacity-40"
                    >
                      {enviando === tipo ? "…" : "Enviar"}
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-2 border-t border-border/50 pt-2">
                <ReporteMensual
                  prestamoId={prestamo.id}
                  correo={t?.email ?? ""}
                  onMensaje={onMensaje}
                />
              </div>
            </div>
          </div>

          <div>
            <p className="mb-2 text-[10px] font-bold uppercase text-muted">
              Cronograma — {r.cuotas_pagadas} pagadas, {r.cuotas - r.cuotas_pagadas} pendientes
            </p>
            <AvisoDocSoporte prestamo={detalleQ.data?.prestamo ?? prestamo} />
            {detalleQ.isLoading ? (
              <p className="text-xs text-muted">Cargando cronograma…</p>
            ) : (
              <TablaCuotas
                cuotas={cuotas}
                medios={medios}
                onPagar={
                  prestamo.estado === "vigente"
                    ? (numero, body) => pagarMut.mutate({ numero, body })
                    : undefined
                }
                pagando={pagarMut.isPending}
              />
            )}
          </div>
        </div>
      )}
    </article>
  );
}

// ─── Tabla del cronograma ──────────────────────────────────────────────────

function TablaCuotas({
  cuotas,
  compacta,
  medios,
  onPagar,
  pagando,
}: {
  cuotas: Cuota[];
  compacta?: boolean;
  medios?: MedioPago[];
  onPagar?: (numero: number, body: Record<string, unknown>) => void;
  pagando?: boolean;
}) {
  // En la simulación no hace falta ver 24 filas: interesa el arranque, el
  // salto de tramo y el cierre. El detalle completo va en el PDF.
  const [verTodo, setVerTodo] = useState(false);
  const proxima = cuotas.find((c) => c.estado !== "pagada");
  const visibles = compacta && !verTodo && cuotas.length > 8
    ? [...cuotas.slice(0, 3), ...cuotas.slice(-3)]
    : cuotas;
  const hayCorte = compacta && !verTodo && cuotas.length > 8;

  if (!cuotas.length) return <p className="text-xs text-muted">Sin cuotas.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-[11px]">
        <thead className="text-[10px] uppercase text-muted">
          <tr>
            <th className="py-1 pr-2 font-bold">#</th>
            <th className="py-1 pr-2 font-bold">Vence</th>
            <th className="py-1 pr-2 text-right font-bold">Saldo</th>
            <th className="py-1 pr-2 text-right font-bold">Interés bruto</th>
            <th className="py-1 pr-2 text-right font-bold">Retención</th>
            <th className="py-1 pr-2 text-right font-bold">Capital</th>
            <th className="py-1 pr-2 text-right font-bold">A girar</th>
            {!compacta && <th className="py-1 pr-2 font-bold">Estado</th>}
            {!compacta && <th className="py-1 pr-2 font-bold">Doc. soporte</th>}
            {onPagar && <th className="py-1 font-bold" />}
          </tr>
        </thead>
        <tbody>
          {visibles.map((c, i) => {
            const cortar = hayCorte && i === 3;
            const esProxima = proxima?.numero === c.numero;
            return (
              <>
                {cortar && (
                  <tr key={`corte-${c.numero}`}>
                    <td colSpan={9} className="py-1 text-center text-[10px] text-muted">
                      ⋯ {cuotas.length - 6} cuotas más ⋯{" "}
                      <button
                        type="button" onClick={() => setVerTodo(true)}
                        className="font-bold text-accent underline"
                      >
                        ver todas
                      </button>
                    </td>
                  </tr>
                )}
                <tr
                  key={c.numero}
                  className={`border-t border-border/40 ${
                    c.estado === "pagada" ? "text-muted" : esProxima ? "bg-accent/5" : ""
                  }`}
                >
                  <td className="py-1 pr-2 tabular-nums">{c.numero}</td>
                  <td className="py-1 pr-2 tabular-nums">
                    {(c.fecha_vencimiento ?? (c as unknown as { fecha: string }).fecha) || "—"}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">{cop(c.saldo_inicial)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{cop(c.interes_bruto)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums text-amber-600">
                    −{cop(c.retencion)}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">{cop(c.abono_capital)}</td>
                  <td className="py-1 pr-2 text-right font-bold tabular-nums text-ink">
                    {cop(c.cuota_girada)}
                  </td>
                  {!compacta && (
                    <td className="py-1 pr-2">
                      <EstadoCuota estado={c.estado} fechaPago={c.fecha_pago} />
                    </td>
                  )}
                  {!compacta && (
                    <td className="py-1 pr-2">
                      <DocSoporte cuota={c} />
                    </td>
                  )}
                  {onPagar && (
                    <td className="py-1">
                      {c.estado !== "pagada" && esProxima && (
                        <BotonPagar
                          numero={c.numero}
                          medios={medios ?? []}
                          pagando={!!pagando}
                          onPagar={onPagar}
                        />
                      )}
                    </td>
                  )}
                </tr>
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BotonPagar({
  numero,
  medios,
  pagando,
  onPagar,
}: {
  numero: number;
  medios: MedioPago[];
  pagando: boolean;
  onPagar: (numero: number, body: Record<string, unknown>) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [fecha, setFecha] = useState(hoy());
  const [medio, setMedio] = useState("");
  const [referencia, setReferencia] = useState("");

  if (!abierto) {
    return (
      <button
        type="button" onClick={() => setAbierto(true)}
        className="whitespace-nowrap rounded-lg border border-accent px-2 py-1 text-[10px] font-bold text-accent hover:bg-accent hover:text-white"
      >
        Marcar pagada
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      <input
        type="date" value={fecha} onChange={(e) => setFecha(e.target.value)}
        className="rounded border border-border bg-surface-input px-1 py-0.5 text-[10px] text-ink"
      />
      <select
        value={medio} onChange={(e) => setMedio(e.target.value)}
        className="rounded border border-border bg-surface-input px-1 py-0.5 text-[10px] text-ink"
      >
        <option value="">Medio del préstamo</option>
        {medios.map((m) => (
          <option key={m.id} value={m.id}>{m.nombre}</option>
        ))}
      </select>
      <input
        placeholder="Referencia" value={referencia}
        onChange={(e) => setReferencia(e.target.value)}
        className="w-24 rounded border border-border bg-surface-input px-1 py-0.5 text-[10px] text-ink"
      />
      <button
        type="button" disabled={pagando}
        onClick={() => {
          onPagar(numero, {
            fecha,
            medio_pago_id: medio ? Number(medio) : undefined,
            referencia: referencia.trim() || undefined,
          });
          setAbierto(false);
        }}
        className="rounded bg-accent px-2 py-1 text-[10px] font-bold text-white disabled:opacity-40"
      >
        {pagando ? "…" : "Confirmar"}
      </button>
      <button
        type="button" onClick={() => setAbierto(false)}
        className="px-1 text-[10px] text-muted"
      >
        ✕
      </button>
    </div>
  );
}

// ─── Piezas pequeñas ───────────────────────────────────────────────────────

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

function Mini({
  label, value, sub, accent,
}: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <p className="text-[10px] font-bold uppercase leading-tight text-muted">{label}</p>
      <p className={`mt-1 text-sm font-extrabold tabular-nums ${accent ? "text-accent" : "text-ink"}`}>
        {value}
      </p>
      {sub && <p className="text-[10px] text-muted">{sub}</p>}
    </div>
  );
}

function Dato({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 rounded-lg bg-surface px-2 py-1">
      <span className="text-muted">{label}</span>
      <span className="font-bold tabular-nums text-ink">{value}</span>
    </div>
  );
}

function Linea({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted">{k}</dt>
      <dd className="text-right font-bold text-ink">{v}</dd>
    </div>
  );
}

function EstadoChip({ estado }: { estado: Prestamo["estado"] }) {
  const cls = {
    vigente: "bg-accent/15 text-accent",
    pagado: "bg-emerald-500/15 text-emerald-500",
    anulado: "bg-red-500/15 text-red-500",
  }[estado];
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${cls}`}>{estado}</span>;
}

function EstadoCuota({ estado, fechaPago }: { estado: Cuota["estado"]; fechaPago: string }) {
  if (estado === "pagada") {
    return (
      <span className="text-[10px] font-bold text-emerald-500">
        ✓ pagada {fechaPago ? `· ${fechaPago}` : ""}
      </span>
    );
  }
  if (estado === "solicitada") {
    return <span className="text-[10px] font-bold text-amber-500">en trámite</span>;
  }
  return <span className="text-[10px] text-muted">pendiente</span>;
}


/**
 * Estado del documento soporte de una cuota (DIAN Concepto 000112 int 7 de
 * 2024): se emite por los INTERESES pagados a una persona natural no obligada
 * a facturar. Por el capital nunca — el mutuo no es venta de bienes ni
 * servicios y se respalda con el contrato y la transferencia.
 */
function DocSoporte({ cuota }: { cuota: Cuota }) {
  if (cuota.estado !== "pagada") return <span className="text-[10px] text-muted">—</span>;
  switch (cuota.doc_soporte_estado) {
    case "emitido":
      return (
        <span className="text-[10px] font-bold text-emerald-500">
          ✓ {cuota.doc_soporte_numero || cuota.doc_soporte_id}
        </span>
      );
    case "sombra":
      return <span className="text-[10px] font-bold text-sky-500" title="Modo sombra: calculado, no transmitido a la DIAN">simulado</span>;
    case "no_aplica":
      return <span className="text-[10px] text-muted" title="El prestamista debe facturar los intereses">no aplica</span>;
    case "error":
      return <span className="text-[10px] font-bold text-red-500">error</span>;
    default:
      return <span className="text-[10px] text-amber-500">pendiente</span>;
  }
}

function AvisoDocSoporte({ prestamo }: { prestamo: Prestamo }) {
  const t = prestamo.tercero;
  const sinDefinir = !t?.tipo_persona;
  const juridica = t?.tipo_persona === "juridica";
  const sombra = (prestamo.doc_soporte?.sombra ?? 0) > 0;

  if (sinDefinir) {
    return (
      <p className="mb-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-600">
        Falta definir si el prestamista es persona natural o jurídica en Contabilidad → Terceros.
        Sin ese dato no se emite documento soporte por los intereses, y el gasto financiero podría
        quedar sin soporte para la deducción.
      </p>
    );
  }
  if (juridica) {
    return (
      <p className="mb-2 rounded-lg bg-surface px-3 py-2 text-[11px] text-muted">
        Prestamista persona jurídica: McKenna no emite documento soporte —{" "}
        <strong>él debe expedir factura electrónica por los intereses</strong>. El capital no se
        factura en ningún caso (contrato de mutuo).
      </p>
    );
  }
  if (sombra) {
    return (
      <p className="mb-2 rounded-lg bg-sky-500/10 px-3 py-2 text-[11px] text-sky-600">
        <strong>Modo sombra:</strong> los documentos soporte se calculan pero no se transmiten a la
        DIAN. Para activarlos, crea el ítem de intereses en Alegra y pon{" "}
        <code>PRESTAMOS_DOC_SOPORTE_ACTIVO=1</code>.
      </p>
    );
  }
  return null;
}


/**
 * Retención en la fuente practicada sobre intereses, mes a mes.
 *
 * El módulo NO declara — eso lo hace el contador en el portal de la DIAN. Lo
 * que evita es que nadie se entere tarde: la retención se acredita a 2365 en
 * cada pago y queda como deuda hasta que se declara y se paga. El cron abre el
 * ticket el día 3 del mes siguiente; este bloque permite adelantarlo y revisar.
 *
 * Deliberadamente no muestra fecha de vencimiento: va por el último dígito del
 * NIT y cambia cada año por decreto. Inventarla sería peor que omitirla.
 */
function PanelRetenciones({
  onMensaje,
}: {
  onMensaje: (m: { tipo: "ok" | "error"; texto: string }) => void;
}) {
  const ahora = new Date();
  const previo = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
  const [anio, setAnio] = useState(previo.getFullYear());
  const [mes, setMes] = useState(previo.getMonth() + 1);
  const [abierto, setAbierto] = useState(false);
  const [creando, setCreando] = useState(false);

  const q = useQuery<Retenciones>({
    queryKey: ["prestamo-retenciones", anio, mes],
    queryFn: () => api.get(`/api/prestamos/retenciones?anio=${anio}&mes=${mes}`),
    enabled: abierto,
  });
  const r = q.data;

  async function crearTicket() {
    setCreando(true);
    try {
      const res = await api.post<{ ok?: boolean; creado?: boolean; error?: string; motivo?: string; ticket_id?: number }>(
        "/api/prestamos/retenciones/ticket", { anio, mes },
      );
      if (res.error) onMensaje({ tipo: "error", texto: res.error });
      else if (res.creado) onMensaje({ tipo: "ok", texto: `Ticket #${res.ticket_id} creado para declarar la retención` });
      else onMensaje({ tipo: "ok", texto: `No se creó ticket: ${res.motivo}` });
    } catch (e) {
      onMensaje({ tipo: "error", texto: (e as Error).message });
    } finally {
      setCreando(false);
    }
  }

  return (
    <section className="rounded-xl border border-border bg-surface-panel">
      <button
        type="button" onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div>
          <p className="text-sm font-bold text-ink">Retención en la fuente</p>
          <p className="text-[11px] text-muted">
            Lo practicado sobre intereses, para la declaración mensual. El cron abre el ticket el día 3.
          </p>
        </div>
        <span className="text-xs text-muted">{abierto ? "▲" : "▼"}</span>
      </button>

      {abierto && (
        <div className="space-y-3 border-t border-border/60 px-4 py-4">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Año">
              <input
                type="number" value={anio} onChange={(e) => setAnio(Number(e.target.value))}
                className={`${inputCls} w-24`}
              />
            </Field>
            <Field label="Mes">
              <select value={mes} onChange={(e) => setMes(Number(e.target.value))} className={`${inputCls} w-32`}>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {new Date(2000, i, 1).toLocaleDateString("es-CO", { month: "long" })}
                  </option>
                ))}
              </select>
            </Field>
            <button
              type="button" onClick={() => void crearTicket()}
              disabled={creando || !r || r.total_retencion <= 0}
              className="rounded-lg bg-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
            >
              {creando ? "…" : "Crear ticket para declarar"}
            </button>
          </div>

          {q.isLoading && <p className="text-xs text-muted">Cargando…</p>}
          {r && r.total_retencion <= 0 && (
            <p className="text-xs text-muted">No se practicó retención en {r.periodo}.</p>
          )}
          {r && r.total_retencion > 0 && (
            <>
              <Vencimiento v={r.vencimiento} />

              <div className="grid gap-2 sm:grid-cols-3">
                <Mini label="Base (intereses brutos)" value={cop(r.base_total)} sub={`${r.pagos} pago(s)`} />
                <Mini label="Retención a declarar" value={cop(r.total_retencion)} sub="formulario 350" accent />
                <Mini label="Control cuenta 2365" value={cop(r.control_2365)}
                      sub={r.cuadra_con_libro ? "cuadra con el libro" : "⚠️ no cuadra"} />
              </div>

              {!r.cuadra_con_libro && (
                <p className="rounded-lg bg-red-500/10 px-3 py-2 text-[11px] text-red-500">
                  La cuenta 2365 movió {cop(r.control_2365)} pero los préstamos suman {cop(r.total_retencion)}.
                  Puede haber retenciones de otro origen o un asiento manual — revisar antes de declarar.
                </p>
              )}
              {r.documentos_soporte_pendientes > 0 && (
                <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-600">
                  {r.documentos_soporte_pendientes} documento(s) soporte sin emitir a la DIAN. Declarar la
                  retención con el soporte pendiente deja el gasto por intereses expuesto en una revisión.
                </p>
              )}

              <table className="min-w-full text-left text-[11px]">
                <thead className="text-[10px] uppercase text-muted">
                  <tr>
                    <th className="py-1 pr-2 font-bold">Prestamista</th>
                    <th className="py-1 pr-2 font-bold">CC/NIT</th>
                    <th className="py-1 pr-2 text-right font-bold">Base</th>
                    <th className="py-1 text-right font-bold">Retención</th>
                  </tr>
                </thead>
                <tbody>
                  {r.terceros.map((t) => (
                    <tr key={t.identificacion || t.nombre} className="border-t border-border/40">
                      <td className="py-1 pr-2">{t.nombre}</td>
                      <td className="py-1 pr-2 tabular-nums text-muted">{t.identificacion || "—"}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{cop(t.base)}</td>
                      <td className="py-1 text-right font-bold tabular-nums text-ink">{cop(t.retencion)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[10px] text-muted">
                El vencimiento sale del calendario tributario cargado ({r.vencimiento.fuente ?? "DUR 1625 de 2016"}),
                según el último dígito del NIT. Para un año sin calendario cargado el sistema lo dice y no
                inventa fecha.
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}


/**
 * Vencimiento de la declaración de retención.
 *
 * Si el año no está en el calendario cargado se dice explícitamente en vez de
 * mostrar nada: un vencimiento tributario silencioso es el que se pasa. El
 * calendario lo fija un decreto distinto cada año, así que el módulo nunca
 * extrapola — ver app/services/calendario_tributario.py.
 */
function Vencimiento({ v }: { v: Retenciones["vencimiento"] }) {
  if (!v?.conocido) {
    return (
      <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-600">
        <strong>Fecha de vencimiento no confirmada.</strong>{" "}
        {v?.motivo ?? "No hay calendario tributario cargado para este año."}
      </p>
    );
  }
  const dias = v.dias_restantes ?? 0;
  const estilo = {
    vencido: "bg-red-500/15 text-red-500",
    hoy: "bg-red-500/15 text-red-500",
    proximo: "bg-amber-500/15 text-amber-600",
    a_tiempo: "bg-emerald-500/10 text-emerald-600",
    desconocido: "bg-surface text-muted",
  }[v.estado];
  const texto =
    v.estado === "vencido"
      ? `Venció hace ${Math.abs(dias)} día(s) — hay sanción por extemporaneidad e intereses de mora`
      : v.estado === "hoy"
        ? "Vence hoy"
        : `Quedan ${dias} día(s)`;
  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-[11px] ${estilo}`}>
      <span>
        <strong>Vence {v.fecha}</strong> · NIT {v.nit}, último dígito {v.ultimo_digito}
      </span>
      <span className="font-bold">{texto}</span>
    </div>
  );
}

// ─── Alta de prestamista ───────────────────────────────────────────────────

/**
 * Registra al prestamista con TODO lo que el préstamo va a necesitar después:
 * cédula (contrato y documento soporte), correo (contrato y reportes), cuenta
 * bancaria (para que despachos pueda girar) y si es persona natural o jurídica
 * (define quién emite el documento soporte por los intereses).
 *
 * Se valida acá y no al desembolsar: descubrir que falta la cédula con la plata
 * ya girada es mucho peor. Además lo inscribe como contacto en Alegra, con
 * botón para reintentar si esa parte falla — un fallo de Alegra no debe hacer
 * perder el tercero ya creado.
 */
function AltaPrestamista({
  onCerrar,
  onCreado,
  onMensaje,
}: {
  onCerrar: () => void;
  onCreado: (t: Tercero) => void;
  onMensaje: (m: { tipo: "ok" | "error"; texto: string }) => void;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    nombre: "",
    identificacion: "",
    tipo_persona: "natural",
    email: "",
    telefono: "",
    cuenta_bancaria: "",
    obligado_a_facturar: false,
    notas: "",
    inscribir_en_alegra: true,
  });
  const set = (k: keyof typeof f, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  const mut = useMutation({
    mutationFn: () =>
      api.post<{
        ok?: boolean;
        error?: string;
        tercero?: Tercero;
        reutilizado?: boolean;
        alegra?: { ok: boolean; creado: boolean; existe: boolean; error?: string };
        documento_soporte?: { requiere: boolean; motivo: string };
      }>("/api/prestamos/prestamistas", f),
    onSuccess: (r) => {
      if (r.error || !r.tercero) {
        onMensaje({ tipo: "error", texto: r.error ?? "No se pudo registrar" });
        return;
      }
      const partes: string[] = [];
      if (r.reutilizado) partes.push("ya existía, se completaron sus datos");
      if (r.alegra?.creado) partes.push("inscrito en Alegra");
      else if (r.alegra?.existe) partes.push("ya estaba en Alegra");
      else if (r.alegra && !r.alegra.ok) partes.push(`Alegra falló: ${r.alegra.error}`);
      if (partes.length) onMensaje({ tipo: r.alegra?.ok === false ? "error" : "ok", texto: partes.join(" · ") });
      void qc.invalidateQueries({ queryKey: ["cc-terceros"] });
      onCreado(r.tercero);
    },
    onError: (e) => onMensaje({ tipo: "error", texto: (e as Error).message }),
  });

  // Espeja `prestamos.requiere_documento_soporte` para avisar antes de guardar.
  const emiteDocSoporte = f.tipo_persona === "natural" && !f.obligado_a_facturar;

  return (
    <form
      className="space-y-3 rounded-xl border border-accent/40 bg-surface-panel p-4"
      onSubmit={(e) => {
        e.preventDefault();
        mut.mutate();
      }}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-ink">Registrar prestamista</h3>
        <button type="button" onClick={onCerrar} className="text-xs text-muted">✕</button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Nombre completo / razón social">
          <input required className={inputCls} value={f.nombre}
                 onChange={(e) => set("nombre", e.target.value)} />
        </Field>
        <Field label="Cédula / NIT">
          <input required className={inputCls} value={f.identificacion}
                 onChange={(e) => set("identificacion", e.target.value)}
                 placeholder="Sin puntos ni dígito de verificación" />
        </Field>
        <Field label="Tipo de persona">
          <select className={inputCls} value={f.tipo_persona}
                  onChange={(e) => set("tipo_persona", e.target.value)}>
            <option value="natural">Persona natural</option>
            <option value="juridica">Persona jurídica</option>
          </select>
        </Field>
        <Field label="Correo (contrato y reportes)">
          <input required type="email" className={inputCls} value={f.email}
                 onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field label="Teléfono">
          <input className={inputCls} value={f.telefono}
                 onChange={(e) => set("telefono", e.target.value)} />
        </Field>
        <Field label="Cuenta bancaria (para girarle)">
          <input className={inputCls} value={f.cuenta_bancaria}
                 onChange={(e) => set("cuenta_bancaria", e.target.value)}
                 placeholder="Banco, tipo y número" />
        </Field>
      </div>

      <Field label="Notas (opcional)">
        <input className={inputCls} value={f.notas} onChange={(e) => set("notas", e.target.value)} />
      </Field>

      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={f.obligado_a_facturar}
                 onChange={(e) => set("obligado_a_facturar", e.target.checked)}
                 className="h-4 w-4 rounded border-border" />
          <span className="font-bold text-muted">Está obligado a facturar</span>
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={f.inscribir_en_alegra}
                 onChange={(e) => set("inscribir_en_alegra", e.target.checked)}
                 className="h-4 w-4 rounded border-border" />
          <span className="font-bold text-muted">Inscribir como contacto en Alegra</span>
        </label>
      </div>

      <p className={`rounded-lg px-3 py-2 text-[11px] ${emiteDocSoporte ? "bg-sky-500/10 text-sky-600" : "bg-surface text-muted"}`}>
        {emiteDocSoporte ? (
          <>Por los intereses, <strong>McKenna le emitirá documento soporte</strong> a la DIAN
          (persona natural no obligada a facturar). Por el capital no se emite ninguno.</>
        ) : (
          <>Por los intereses, <strong>él debe expedir factura electrónica</strong> — McKenna no
          emite documento soporte. Por el capital no se emite ninguno en ningún caso.</>
        )}
      </p>

      <button type="submit" disabled={mut.isPending}
              className="rounded-lg bg-accent px-4 py-2 text-xs font-bold text-white disabled:opacity-40">
        {mut.isPending ? "Registrando…" : "Registrar y continuar"}
      </button>
    </form>
  );
}


/**
 * Reporte de desembolso del mes al prestamista: qué se le giró, cuánto fue
 * capital, cuánto interés, cuánta retención y cómo va el saldo — con el
 * certificado de estado adjunto.
 *
 * Manual a propósito, como todo envío a un tercero: si saliera solo con cada
 * pago, un error de registro se convertiría en un correo ya enviado que no se
 * recoge.
 */
function ReporteMensual({
  prestamoId,
  correo,
  onMensaje,
}: {
  prestamoId: number;
  correo: string;
  onMensaje: (m: { tipo: "ok" | "error"; texto: string }) => void;
}) {
  const previo = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
  const [anio, setAnio] = useState(previo.getFullYear());
  const [mes, setMes] = useState(previo.getMonth() + 1);
  const [enviando, setEnviando] = useState(false);

  async function enviar() {
    if (!window.confirm(
      `Se enviará el reporte de ${String(mes).padStart(2, "0")}/${anio} a ${correo}.\n\n` +
      "Revisa que las cuotas del mes estén bien registradas antes. ¿Continuar?",
    )) return;
    setEnviando(true);
    try {
      const r = await api.post<{ ok?: boolean; enviado?: boolean; error?: string; motivo?: string; destinatario?: string }>(
        `/api/prestamos/${prestamoId}/reporte-mensual`, { anio, mes },
      );
      if (r.error) onMensaje({ tipo: "error", texto: r.error });
      else if (!r.enviado) onMensaje({ tipo: "error", texto: r.motivo ?? "No se envió" });
      else onMensaje({ tipo: "ok", texto: `Reporte enviado a ${r.destinatario}` });
    } catch (e) {
      onMensaje({ tipo: "error", texto: (e as Error).message });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <span className="text-[10px] font-bold uppercase text-muted">Reporte mensual</span>
      <input
        type="number" value={anio} onChange={(e) => setAnio(Number(e.target.value))}
        className="w-20 rounded border border-border bg-surface-input px-1 py-1 text-[11px] text-ink"
      />
      <select
        value={mes} onChange={(e) => setMes(Number(e.target.value))}
        className="rounded border border-border bg-surface-input px-1 py-1 text-[11px] text-ink"
      >
        {Array.from({ length: 12 }, (_, i) => (
          <option key={i + 1} value={i + 1}>
            {new Date(2000, i, 1).toLocaleDateString("es-CO", { month: "short" })}
          </option>
        ))}
      </select>
      <button
        type="button" onClick={() => void enviar()} disabled={!correo || enviando}
        title={correo ? `Enviar a ${correo}` : "El prestamista no tiene correo"}
        className="rounded-lg bg-accent px-2 py-1 text-[11px] font-bold text-white disabled:opacity-40"
      >
        {enviando ? "…" : "Enviar"}
      </button>
    </div>
  );
}
