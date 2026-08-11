import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { api } from "../api/client";
import { Icon } from "../icons";
import type { IconName } from "../icons/types";
import { usePanelTheme } from "../stores/panelTheme";
import { HUB_TAB_LABEL, hubTabClass } from "../lib/hubTabClass";
import "./libroMayor.css";

/* ─── Tipos ──────────────────────────────────────────────────────────────── */

type TipoCuenta = "activo" | "pasivo" | "patrimonio" | "ingreso" | "gasto" | "costo";
type Naturaleza = "debito" | "credito";
type TipoTercero = "proveedor" | "cliente" | "socio" | "empleado" | "otro";

interface PlanCuenta {
  id: number;
  codigo: string;
  nombre: string;
  tipo: TipoCuenta;
  naturaleza: Naturaleza;
  es_movimiento: number;
  activa: number;
  notas: string;
}

interface Tercero {
  id: number;
  nombre: string;
  tipo: TipoTercero;
  identificacion: string;
  telefono: string;
  email: string;
  cuenta_bancaria: string;
  cuenta_por_pagar_id: number | null;
  notas: string;
  activo: number;
}

interface MedioPago {
  id: number;
  nombre: string;
  tipo: string;
  cuenta_id: number;
  cuenta_codigo: string;
  cuenta_nombre: string;
  activo: number;
}

interface MovimientoLinea {
  id: number;
  cuenta_id: number;
  tercero_id: number | null;
  debito: number;
  credito: number;
  descripcion: string;
  cuenta_codigo: string;
  cuenta_nombre: string;
  tercero_nombre: string | null;
}

interface Movimiento {
  id: number;
  fecha: string;
  concepto: string;
  tipo_origen: string;
  tercero_id: number | null;
  referencia: string;
  estado: string;
  lineas: MovimientoLinea[];
  total_debito: number;
  total_credito: number;
  tercero: Tercero | null;
}

interface MayorLinea {
  movimiento_id: number;
  fecha: string;
  concepto: string;
  referencia: string;
  descripcion: string;
  tercero_nombre: string | null;
  debito: number;
  credito: number;
  saldo: number;
}

interface MayorCuenta {
  cuenta: PlanCuenta;
  saldo_inicial: number;
  movimientos: MayorLinea[];
  total_debito: number;
  total_credito: number;
  saldo_final: number;
}

interface BalanceFila {
  cuenta_id: number;
  codigo: string;
  nombre: string;
  tipo: TipoCuenta;
  naturaleza: Naturaleza;
  saldo_inicial: number;
  debito: number;
  credito: number;
  saldo_final: number;
}

interface Balance {
  cuentas: BalanceFila[];
  total_debito: number;
  total_credito: number;
  cuadra: boolean;
}

interface SaldoTercero {
  tercero: Tercero;
  cuentas: { cuenta_id: number; codigo: string; nombre: string; tipo: string; debito: number; credito: number; saldo: number }[];
  saldo_por_pagar: number;
}

/* ─── Helpers de formato y estilo ────────────────────────────────────────── */

function formatCop(n: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n || 0);
}

const inputCls = "lm-input";
const cardCls = "lm-card p-4 space-y-3";

function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="lm-campo">
      <span className="lm-campo-label">{label}</span>
      <div>{children}</div>
    </label>
  );
}

function TIPO_ORIGEN_LABEL(t: string): string {
  const map: Record<string, string> = {
    manual: "Asiento manual",
    ingreso: "Ingreso",
    egreso: "Egreso",
    compra_socio_amazon: "Compra socio (Amazon)",
    pago_socio: "Pago a socio",
    compra_proveedor: "Compra a proveedor",
  };
  return map[t] || t;
}

const VISTA_KEY = "mckenna-libro-mayor-vista";

function leerVista(): "simple" | "avanzada" {
  try {
    const v = localStorage.getItem(VISTA_KEY);
    return v === "avanzada" ? "avanzada" : "simple";
  } catch {
    return "simple";
  }
}

/* ─── Queries compartidas ────────────────────────────────────────────────── */

function usePlanCuentas() {
  return useQuery<{ cuentas: PlanCuenta[] }>({
    queryKey: ["cc-plan-cuentas"],
    queryFn: () => api.get("/api/contabilidad/cc/plan-cuentas?activas=0"),
  });
}

function useTerceros() {
  return useQuery<{ terceros: Tercero[] }>({
    queryKey: ["cc-terceros"],
    queryFn: () => api.get("/api/contabilidad/cc/terceros?activos=0"),
  });
}

function useMediosPago() {
  return useQuery<{ medios_pago: MedioPago[] }>({
    queryKey: ["cc-medios-pago"],
    queryFn: () => api.get("/api/contabilidad/cc/medios-pago"),
  });
}

function invalidarTodo(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["cc-movimientos"] });
  void qc.invalidateQueries({ queryKey: ["cc-saldo-tercero"] });
  void qc.invalidateQueries({ queryKey: ["cc-mayor-cuenta"] });
  void qc.invalidateQueries({ queryKey: ["cc-balance"] });
}

/* ─── Panel principal ─────────────────────────────────────────────────────── */

export default function LibroMayorPanel() {
  const [vista, setVista] = useState<"simple" | "avanzada">(leerVista);
  const skin = usePanelTheme((s) => s.skin);
  const applyPack = usePanelTheme((s) => s.applyPack);

  function cambiarVista(v: "simple" | "avanzada") {
    setVista(v);
    try {
      localStorage.setItem(VISTA_KEY, v);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="lm-root mx-auto space-y-4 px-0.5 pb-8 sm:px-0" data-skin={skin}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-xl">
          <h2 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">Libro Mayor</h2>
          <p className="mt-1.5 text-base leading-snug text-muted">
            Partida doble propia: ingresos, egresos, compras de socios y proveedores.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="text-muted">Estilo</span>
            <button
              type="button"
              onClick={() => applyPack("matrix")}
              className={`rounded-full px-2.5 py-0.5 font-semibold transition ${
                skin === "matrix" ? "bg-accent text-white" : "bg-surface-hover text-ink hover:text-accent"
              }`}
            >
              Matrix
            </button>
            <button
              type="button"
              onClick={() => applyPack("sakura")}
              className={`rounded-full px-2.5 py-0.5 font-semibold transition ${
                skin === "sakura" ? "bg-accent text-white" : "bg-surface-hover text-ink hover:text-accent"
              }`}
            >
              Sakura
            </button>
            <button
              type="button"
              onClick={() => applyPack("barbie")}
              className={`rounded-full px-2.5 py-0.5 font-semibold transition ${
                skin === "barbie" ? "bg-accent text-white" : "bg-surface-hover text-ink hover:text-accent"
              }`}
            >
              Barbie
            </button>
          </div>
        </div>
        <div className="inline-flex shrink-0 rounded-xl border border-border bg-surface-panel p-0.5 shadow-paper-sm">
          {(["simple", "avanzada"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => cambiarVista(v)}
              className={hubTabClass(vista === v)}
            >
              <span className={HUB_TAB_LABEL}>{v === "simple" ? "Simple" : "Avanzada"}</span>
            </button>
          ))}
        </div>
      </div>

      {vista === "simple" ? <VistaSimple /> : <VistaAvanzada />}
    </div>
  );
}

/* ─── Vista simple ────────────────────────────────────────────────────────── */

type AccionRapida = "ingreso" | "egreso" | "compra-socio" | "pago-socio" | "compra-proveedor";

const ACCIONES: { id: AccionRapida; icon: IconName; label: string; desc: string }[] = [
  { id: "ingreso", icon: "inbox", label: "Ingreso", desc: "Entra a caja o banco" },
  { id: "egreso", icon: "outbox", label: "Egreso", desc: "Sale de caja o banco" },
  { id: "compra-socio", icon: "package", label: "Compra socio", desc: "Amazon u otra compra con comisión" },
  { id: "pago-socio", icon: "handshake", label: "Pago a socio", desc: "Gira para saldar su cuenta" },
  { id: "compra-proveedor", icon: "receipt", label: "Compra proveedor", desc: "Externo o socio-proveedor" },
];

function VistaSimple() {
  const qc = useQueryClient();
  const [accion, setAccion] = useState<AccionRapida | null>(null);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  const terceros = useTerceros();
  const socios = (terceros.data?.terceros ?? []).filter((t) => t.tipo === "socio" && t.activo);

  const movQ = useQuery<{ movimientos: Movimiento[] }>({
    queryKey: ["cc-movimientos", "recientes"],
    queryFn: () => api.get("/api/contabilidad/cc/movimientos?limit=25"),
  });

  function onDone(texto: string) {
    setMsg({ tipo: "ok", texto });
    setAccion(null);
    invalidarTodo(qc);
  }
  function onError(e: unknown) {
    setMsg({ tipo: "error", texto: (e as Error).message || "No se pudo registrar" });
  }

  return (
    <div className="space-y-4">
      {socios.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {socios.map((s) => (
            <SaldoSocioCard key={s.id} tercero={s} onGirar={() => setAccion("pago-socio")} />
          ))}
        </div>
      )}

      <div className="mck-stagger grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {ACCIONES.map((a) => (
          <button
            key={a.id}
            type="button"
            title={a.desc}
            onClick={() => {
              setMsg(null);
              setAccion((cur) => (cur === a.id ? null : a.id));
            }}
            className={`lm-action ${accion === a.id ? "is-active" : ""}`}
          >
            <span className="lm-action-icon">
              <Icon name={a.icon} size={18} weight="duotone" />
            </span>
            <span className="lm-action-label">{a.label}</span>
            <span className="lm-action-desc">{a.desc}</span>
          </button>
        ))}
      </div>

      {msg && (
        <p
          className={`rounded-lg px-3 py-2 text-sm font-semibold ${
            msg.tipo === "ok" ? "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400" : "bg-danger/10 text-danger"
          }`}
        >
          {msg.texto}
        </p>
      )}

      {accion === "ingreso" && <FormIngresoEgreso tipo="ingreso" onDone={onDone} onError={onError} />}
      {accion === "egreso" && <FormIngresoEgreso tipo="egreso" onDone={onDone} onError={onError} />}
      {accion === "compra-socio" && <FormCompraSocio onDone={onDone} onError={onError} />}
      {accion === "pago-socio" && <FormPagoSocio onDone={onDone} onError={onError} />}
      {accion === "compra-proveedor" && <FormCompraProveedor onDone={onDone} onError={onError} />}

      <div>
        <h3 className="mb-2 text-sm font-semibold tracking-tight text-ink">
          Movimientos recientes
        </h3>
        <TablaMovimientos
          movimientos={movQ.data?.movimientos ?? []}
          cargando={movQ.isLoading}
          compacta
        />
      </div>
    </div>
  );
}

function SaldoSocioCard({ tercero, onGirar }: { tercero: Tercero; onGirar: () => void }) {
  const saldoQ = useQuery<SaldoTercero>({
    queryKey: ["cc-saldo-tercero", tercero.id],
    queryFn: () => api.get(`/api/contabilidad/cc/terceros/${tercero.id}/saldo`),
  });
  const saldo = saldoQ.data?.saldo_por_pagar ?? 0;
  return (
    <div className="lm-card lm-kpi">
      <div className="flex min-w-0 items-center gap-3">
        <span className="lm-kpi-icon" aria-hidden>
          <Icon name="handshake" size={20} weight="duotone" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">Por pagar a {tercero.nombre}</p>
          <p className={`mt-0.5 text-xl font-extrabold tabular-nums tracking-tight ${saldo > 0 ? "text-accent" : "text-ink"}`}>
            {saldoQ.isLoading ? "…" : formatCop(saldo)}
          </p>
        </div>
      </div>
      {saldo > 0 && (
        <button
          type="button"
          onClick={onGirar}
          className="mck-btn mck-btn-ghost shrink-0 px-3 py-1.5 text-xs font-bold"
        >
          Girar pago
        </button>
      )}
    </div>
  );
}

/* ─── Tabla de movimientos (compartida simple/avanzada) ──────────────────── */

function TablaMovimientos({
  movimientos,
  cargando,
  compacta,
  onAnular,
  onEliminar,
}: {
  movimientos: Movimiento[];
  cargando?: boolean;
  compacta?: boolean;
  onAnular?: (id: number) => void;
  onEliminar?: (id: number) => void;
}) {
  const [expandido, setExpandido] = useState<number | null>(null);
  return (
    <div className="lm-card mck-table-wrap overflow-hidden">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-border bg-surface text-[11px] font-semibold text-muted">
          <tr>
            <th className="px-3 py-2.5">Fecha</th>
            <th className="px-3 py-2.5">Concepto</th>
            <th className="px-3 py-2.5">Tipo</th>
            <th className="px-3 py-2.5">Tercero</th>
            <th className="px-3 py-2.5 text-right">Monto</th>
            {!compacta && <th className="px-3 py-2.5" />}
          </tr>
        </thead>
        <tbody>
          {cargando && (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-sm text-muted">Cargando…</td>
            </tr>
          )}
          {!cargando && movimientos.length === 0 && (
            <tr>
              <td colSpan={6}>
                <div className="lm-empty">
                  <span className="lm-empty-icon">
                    <Icon name="scroll" size={22} weight="duotone" />
                  </span>
                  <p className="text-sm font-semibold text-ink">Sin movimientos aún</p>
                  <p className="max-w-xs text-xs text-muted">
                    Elige una acción arriba para registrar el primero.
                  </p>
                </div>
              </td>
            </tr>
          )}
          {movimientos.map((m) => (
            <Fragment key={m.id}>
              <tr
                className={`border-t border-border/60 ${!compacta ? "cursor-pointer hover:bg-surface-hover" : ""} ${m.estado === "anulado" ? "opacity-50" : ""}`}
                onClick={() => !compacta && setExpandido((cur) => (cur === m.id ? null : m.id))}
              >
                <td className="px-3 py-2.5 tabular-nums text-ink">{m.fecha}</td>
                <td className="px-3 py-2.5 font-semibold text-ink">
                  {m.concepto}
                  {m.estado === "anulado" && <span className="ml-1 text-danger">(anulado)</span>}
                </td>
                <td className="px-3 py-2.5">
                  <span className="lm-badge">{TIPO_ORIGEN_LABEL(m.tipo_origen)}</span>
                </td>
                <td className="px-3 py-2.5 text-muted">{m.tercero?.nombre || "—"}</td>
                <td className="px-3 py-2.5 text-right font-bold tabular-nums text-ink">
                  {formatCop(m.total_debito)}
                </td>
                {!compacta && (
                  <td className="px-3 py-2.5 text-right">
                    {m.estado !== "anulado" && onAnular && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAnular(m.id);
                        }}
                        className="mr-2 text-xs font-bold text-muted hover:underline"
                      >
                        Anular
                      </button>
                    )}
                    {onEliminar && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm("¿Eliminar este movimiento? Esta acción no se puede deshacer.")) {
                            onEliminar(m.id);
                          }
                        }}
                        className="text-xs font-bold text-danger hover:underline"
                      >
                        Borrar
                      </button>
                    )}
                  </td>
                )}
              </tr>
              {!compacta && expandido === m.id && (
                <tr className="border-t border-border/40 bg-surface">
                  <td colSpan={6} className="px-3 py-2">
                    <table className="w-full text-xs">
                      <thead className="text-muted">
                        <tr>
                          <th className="py-1 text-left font-bold">Cuenta</th>
                          <th className="py-1 text-left font-bold">Descripción</th>
                          <th className="py-1 text-right font-bold">Débito</th>
                          <th className="py-1 text-right font-bold">Crédito</th>
                        </tr>
                      </thead>
                      <tbody>
                        {m.lineas.map((l) => (
                          <tr key={l.id} className="border-t border-border/30">
                            <td className="py-1 text-ink">{l.cuenta_codigo} · {l.cuenta_nombre}</td>
                            <td className="py-1 text-muted">{l.descripcion || "—"}</td>
                            <td className="py-1 text-right tabular-nums text-ink">
                              {l.debito > 0 ? formatCop(l.debito) : ""}
                            </td>
                            <td className="py-1 text-right tabular-nums text-ink">
                              {l.credito > 0 ? formatCop(l.credito) : ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {m.referencia && (
                      <p className="mt-1 text-[11px] text-muted">Referencia: {m.referencia}</p>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Formularios de acciones rápidas ────────────────────────────────────── */

function FormIngresoEgreso({
  tipo,
  onDone,
  onError,
}: {
  tipo: "ingreso" | "egreso";
  onDone: (msg: string) => void;
  onError: (e: unknown) => void;
}) {
  const cuentasQ = usePlanCuentas();
  const mediosQ = useMediosPago();
  const terceros = useTerceros();
  const [form, setForm] = useState({
    fecha: new Date().toISOString().slice(0, 10),
    concepto: "",
    valor: "",
    cuenta_id: "",
    medio_pago_id: "",
    tercero_id: "",
    referencia: "",
  });

  const cuentas = (cuentasQ.data?.cuentas ?? []).filter(
    (c) => c.activa && (tipo === "ingreso" ? c.tipo === "ingreso" : c.tipo === "gasto" || c.tipo === "costo"),
  );
  const medios = mediosQ.data?.medios_pago ?? [];
  const terc = terceros.data?.terceros ?? [];

  const mut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ ok?: boolean; error?: string; movimiento?: Movimiento }>(
        `/api/contabilidad/cc/plantillas/${tipo}`,
        body,
      ),
    onSuccess: (r) => {
      if (r.error) return onError(new Error(r.error));
      onDone(tipo === "ingreso" ? "Ingreso registrado" : "Egreso registrado");
    },
    onError,
  });

  return (
    <form
      className={`${cardCls} space-y-3`}
      onSubmit={(e) => {
        e.preventDefault();
        const valor = parseFloat(form.valor);
        if (!(valor > 0)) return onError(new Error("Ingresa un monto válido"));
        if (!form.cuenta_id || !form.medio_pago_id) return onError(new Error("Selecciona cuenta y medio de pago"));
        mut.mutate({
          fecha: form.fecha,
          concepto: form.concepto.trim(),
          valor,
          [tipo === "ingreso" ? "cuenta_ingreso_id" : "cuenta_gasto_id"]: Number(form.cuenta_id),
          medio_pago_id: Number(form.medio_pago_id),
          tercero_id: form.tercero_id ? Number(form.tercero_id) : null,
          referencia: form.referencia.trim(),
        });
      }}
    >
      <p className="text-base font-bold tracking-tight text-ink">
        {tipo === "ingreso" ? "Nuevo ingreso" : "Nuevo egreso"}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo label="Fecha">
          <input type="date" required value={form.fecha} onChange={(e) => setForm((f) => ({ ...f, fecha: e.target.value }))} className={inputCls} />
        </Campo>
        <Campo label="Monto (COP)">
          <input type="number" min="0" step="1000" required value={form.valor} onChange={(e) => setForm((f) => ({ ...f, valor: e.target.value }))} className={inputCls} />
        </Campo>
        <Campo label="Concepto">
          <input required value={form.concepto} onChange={(e) => setForm((f) => ({ ...f, concepto: e.target.value }))} className={inputCls} placeholder="Ej. Venta mostrador, pago arriendo…" />
        </Campo>
        <Campo label={tipo === "ingreso" ? "Cuenta de ingreso" : "Cuenta de gasto/costo"}>
          <select required value={form.cuenta_id} onChange={(e) => setForm((f) => ({ ...f, cuenta_id: e.target.value }))} className={inputCls}>
            <option value="">Selecciona…</option>
            {cuentas.map((c) => (
              <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>
            ))}
          </select>
        </Campo>
        <Campo label={tipo === "ingreso" ? "¿A dónde entró?" : "¿De dónde salió?"}>
          <select required value={form.medio_pago_id} onChange={(e) => setForm((f) => ({ ...f, medio_pago_id: e.target.value }))} className={inputCls}>
            <option value="">Selecciona…</option>
            {medios.map((m) => (
              <option key={m.id} value={m.id}>{m.nombre}</option>
            ))}
          </select>
        </Campo>
        <Campo label="Tercero (opcional)">
          <select value={form.tercero_id} onChange={(e) => setForm((f) => ({ ...f, tercero_id: e.target.value }))} className={inputCls}>
            <option value="">—</option>
            {terc.map((t) => (
              <option key={t.id} value={t.id}>{t.nombre}</option>
            ))}
          </select>
        </Campo>
        <Campo label="Referencia (opcional)">
          <input value={form.referencia} onChange={(e) => setForm((f) => ({ ...f, referencia: e.target.value }))} className={inputCls} />
        </Campo>
      </div>
      <button type="submit" disabled={mut.isPending} className="mck-btn mck-btn-primary px-4 py-2 text-sm disabled:opacity-40">
        {mut.isPending ? "Guardando…" : "Registrar"}
      </button>
    </form>
  );
}

function FormCompraSocio({
  onDone,
  onError,
}: {
  onDone: (msg: string) => void;
  onError: (e: unknown) => void;
}) {
  const cuentasQ = usePlanCuentas();
  const terceros = useTerceros();
  const [form, setForm] = useState({
    fecha: new Date().toISOString().slice(0, 10),
    tercero_id: "",
    descripcion: "",
    moneda: "COP" as "COP" | "USD",
    valor: "",
    trm: "",
    comision_pct: "5",
    cuenta_destino_id: "",
    referencia: "",
  });

  const socios = (terceros.data?.terceros ?? []).filter((t) => t.tipo === "socio" && t.activo);
  const cuentas = (cuentasQ.data?.cuentas ?? []).filter((c) => c.activa && (c.tipo === "activo" || c.tipo === "costo"));

  const desglose = useMemo(() => {
    const valor = parseFloat(form.valor) || 0;
    const trm = parseFloat(form.trm) || 0;
    const comisionPct = parseFloat(form.comision_pct) || 0;
    const valorCop = form.moneda === "USD" ? valor * trm : valor;
    const comisionCop = valorCop * (comisionPct / 100);
    return { valorCop, comisionCop, totalCop: valorCop + comisionCop };
  }, [form.valor, form.trm, form.moneda, form.comision_pct]);

  const mut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ ok?: boolean; error?: string; movimiento?: Movimiento }>(
        "/api/contabilidad/cc/plantillas/compra-socio-amazon",
        body,
      ),
    onSuccess: (r) => {
      if (r.error) return onError(new Error(r.error));
      onDone("Compra del socio registrada — queda como cuenta por pagar");
    },
    onError,
  });

  return (
    <form
      className={`${cardCls} space-y-3`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!form.tercero_id || !form.cuenta_destino_id) return onError(new Error("Selecciona socio y cuenta destino"));
        const valor = parseFloat(form.valor);
        if (!(valor > 0)) return onError(new Error("Ingresa un valor válido"));
        if (form.moneda === "USD" && !(parseFloat(form.trm) > 0)) return onError(new Error("Ingresa la TRM"));
        mut.mutate({
          fecha: form.fecha,
          tercero_id: Number(form.tercero_id),
          descripcion: form.descripcion.trim(),
          valor,
          moneda: form.moneda,
          trm: form.moneda === "USD" ? parseFloat(form.trm) : undefined,
          comision_pct: parseFloat(form.comision_pct) || 0,
          cuenta_destino_id: Number(form.cuenta_destino_id),
          referencia: form.referencia.trim(),
        });
      }}
    >
      <p className="text-base font-bold tracking-tight text-ink">Compra de un socio</p>
      <p className="text-sm leading-snug text-muted">
        El socio compra a nombre propio y le vende la mercancía a McKenna con comisión.
        Queda como cuenta por pagar — aún no se gira dinero.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo label="Fecha">
          <input type="date" required value={form.fecha} onChange={(e) => setForm((f) => ({ ...f, fecha: e.target.value }))} className={inputCls} />
        </Campo>
        <Campo label="Socio">
          <select required value={form.tercero_id} onChange={(e) => setForm((f) => ({ ...f, tercero_id: e.target.value }))} className={inputCls}>
            <option value="">Selecciona…</option>
            {socios.map((s) => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>
        </Campo>
        <Campo label="Descripción de la mercancía">
          <input value={form.descripcion} onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))} className={inputCls} placeholder="Ej. Envases, insumos…" />
        </Campo>
        <Campo label="Cuenta destino (inventario/costo)">
          <select required value={form.cuenta_destino_id} onChange={(e) => setForm((f) => ({ ...f, cuenta_destino_id: e.target.value }))} className={inputCls}>
            <option value="">Selecciona…</option>
            {cuentas.map((c) => (
              <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>
            ))}
          </select>
        </Campo>
        <Campo label="Moneda">
          <select value={form.moneda} onChange={(e) => setForm((f) => ({ ...f, moneda: e.target.value as "COP" | "USD" }))} className={inputCls}>
            <option value="COP">COP</option>
            <option value="USD">USD</option>
          </select>
        </Campo>
        <Campo label={`Valor (${form.moneda})`}>
          <input type="number" min="0" step="0.01" required value={form.valor} onChange={(e) => setForm((f) => ({ ...f, valor: e.target.value }))} className={inputCls} />
        </Campo>
        {form.moneda === "USD" && (
          <Campo label="TRM del día">
            <input type="number" min="0" step="0.01" required value={form.trm} onChange={(e) => setForm((f) => ({ ...f, trm: e.target.value }))} className={inputCls} />
          </Campo>
        )}
        <Campo label="Comisión del socio (%)">
          <input type="number" min="0" step="0.1" value={form.comision_pct} onChange={(e) => setForm((f) => ({ ...f, comision_pct: e.target.value }))} className={inputCls} />
        </Campo>
        <Campo label="Referencia (opcional)">
          <input value={form.referencia} onChange={(e) => setForm((f) => ({ ...f, referencia: e.target.value }))} className={inputCls} placeholder="Nº de orden Amazon…" />
        </Campo>
      </div>

      {(form.valor || form.trm) && (
        <div className="rounded-lg border border-border/60 bg-surface px-3 py-2 text-xs">
          <p className="text-muted">
            Mercancía: <span className="font-bold text-ink">{formatCop(desglose.valorCop)}</span>
            {"  ·  "}Comisión: <span className="font-bold text-ink">{formatCop(desglose.comisionCop)}</span>
          </p>
          <p className="mt-0.5 font-bold text-accent">
            Total por pagar al socio: {formatCop(desglose.totalCop)}
          </p>
        </div>
      )}

      <button type="submit" disabled={mut.isPending} className="mck-btn mck-btn-primary px-4 py-2 text-sm disabled:opacity-40">
        {mut.isPending ? "Guardando…" : "Registrar compra del socio"}
      </button>
    </form>
  );
}

function FormPagoSocio({
  onDone,
  onError,
}: {
  onDone: (msg: string) => void;
  onError: (e: unknown) => void;
}) {
  const terceros = useTerceros();
  const mediosQ = useMediosPago();
  const [form, setForm] = useState({
    fecha: new Date().toISOString().slice(0, 10),
    tercero_id: "",
    monto: "",
    medio_pago_id: "",
    referencia: "",
    concepto: "",
  });

  const socios = (terceros.data?.terceros ?? []).filter((t) => t.tipo === "socio" && t.activo);
  const medios = mediosQ.data?.medios_pago ?? [];

  const saldoQ = useQuery<SaldoTercero>({
    queryKey: ["cc-saldo-tercero", form.tercero_id ? Number(form.tercero_id) : 0],
    queryFn: () => api.get(`/api/contabilidad/cc/terceros/${form.tercero_id}/saldo`),
    enabled: Boolean(form.tercero_id),
  });

  const mut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ ok?: boolean; error?: string; movimiento?: Movimiento }>(
        "/api/contabilidad/cc/plantillas/pago-socio",
        body,
      ),
    onSuccess: (r) => {
      if (r.error) return onError(new Error(r.error));
      onDone("Giro al socio registrado");
    },
    onError,
  });

  return (
    <form
      className={`${cardCls} space-y-3`}
      onSubmit={(e) => {
        e.preventDefault();
        const monto = parseFloat(form.monto);
        if (!form.tercero_id || !form.medio_pago_id) return onError(new Error("Selecciona socio y medio de pago"));
        if (!(monto > 0)) return onError(new Error("Ingresa un monto válido"));
        mut.mutate({
          fecha: form.fecha,
          tercero_id: Number(form.tercero_id),
          monto,
          medio_pago_id: Number(form.medio_pago_id),
          referencia: form.referencia.trim(),
          concepto: form.concepto.trim(),
        });
      }}
    >
      <p className="text-base font-bold tracking-tight text-ink">Pago a un socio</p>
      <p className="text-sm leading-snug text-muted">Salda total o parcialmente la cuenta por pagar.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo label="Fecha">
          <input type="date" required value={form.fecha} onChange={(e) => setForm((f) => ({ ...f, fecha: e.target.value }))} className={inputCls} />
        </Campo>
        <Campo label="Socio">
          <select required value={form.tercero_id} onChange={(e) => setForm((f) => ({ ...f, tercero_id: e.target.value }))} className={inputCls}>
            <option value="">Selecciona…</option>
            {socios.map((s) => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>
        </Campo>
        {form.tercero_id && (
          <p className="col-span-full -mt-1 text-[11px] text-muted">
            Saldo pendiente actual: <span className="font-bold text-ink">{saldoQ.isLoading ? "…" : formatCop(saldoQ.data?.saldo_por_pagar ?? 0)}</span>
          </p>
        )}
        <Campo label="Monto a girar (COP)">
          <input type="number" min="0" step="1000" required value={form.monto} onChange={(e) => setForm((f) => ({ ...f, monto: e.target.value }))} className={inputCls} />
        </Campo>
        <Campo label="Desde">
          <select required value={form.medio_pago_id} onChange={(e) => setForm((f) => ({ ...f, medio_pago_id: e.target.value }))} className={inputCls}>
            <option value="">Selecciona…</option>
            {medios.map((m) => (
              <option key={m.id} value={m.id}>{m.nombre}</option>
            ))}
          </select>
        </Campo>
        <Campo label="Nota (opcional)">
          <input value={form.concepto} onChange={(e) => setForm((f) => ({ ...f, concepto: e.target.value }))} className={inputCls} />
        </Campo>
        <Campo label="Referencia (opcional)">
          <input value={form.referencia} onChange={(e) => setForm((f) => ({ ...f, referencia: e.target.value }))} className={inputCls} />
        </Campo>
      </div>
      <button type="submit" disabled={mut.isPending} className="mck-btn mck-btn-primary px-4 py-2 text-sm disabled:opacity-40">
        {mut.isPending ? "Guardando…" : "Registrar giro"}
      </button>
    </form>
  );
}

function FormCompraProveedor({
  onDone,
  onError,
}: {
  onDone: (msg: string) => void;
  onError: (e: unknown) => void;
}) {
  const cuentasQ = usePlanCuentas();
  const terceros = useTerceros();
  const mediosQ = useMediosPago();
  const [form, setForm] = useState({
    fecha: new Date().toISOString().slice(0, 10),
    tercero_id: "",
    concepto: "",
    valor: "",
    cuenta_destino_id: "",
    forma_pago: "credito" as "credito" | "contado",
    medio_pago_id: "",
    referencia: "",
  });

  const terc = (terceros.data?.terceros ?? []).filter((t) => t.activo);
  const cuentas = (cuentasQ.data?.cuentas ?? []).filter((c) => c.activa && (c.tipo === "activo" || c.tipo === "costo"));
  const medios = mediosQ.data?.medios_pago ?? [];

  const mut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ ok?: boolean; error?: string; movimiento?: Movimiento }>(
        "/api/contabilidad/cc/plantillas/compra-proveedor",
        body,
      ),
    onSuccess: (r) => {
      if (r.error) return onError(new Error(r.error));
      onDone("Compra registrada");
    },
    onError,
  });

  return (
    <form
      className={`${cardCls} space-y-3`}
      onSubmit={(e) => {
        e.preventDefault();
        const valor = parseFloat(form.valor);
        if (!form.tercero_id || !form.cuenta_destino_id) return onError(new Error("Selecciona tercero y cuenta destino"));
        if (!(valor > 0)) return onError(new Error("Ingresa un valor válido"));
        if (form.forma_pago === "contado" && !form.medio_pago_id) return onError(new Error("Selecciona el medio de pago de contado"));
        mut.mutate({
          fecha: form.fecha,
          tercero_id: Number(form.tercero_id),
          concepto: form.concepto.trim(),
          valor,
          cuenta_destino_id: Number(form.cuenta_destino_id),
          forma_pago: form.forma_pago,
          medio_pago_id: form.forma_pago === "contado" ? Number(form.medio_pago_id) : undefined,
          referencia: form.referencia.trim(),
        });
      }}
    >
      <p className="text-base font-bold tracking-tight text-ink">Compra a proveedor</p>
      <p className="text-sm leading-snug text-muted">
        Proveedor externo o socio como proveedor (p.ej. cacao ya transformado).
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo label="Fecha">
          <input type="date" required value={form.fecha} onChange={(e) => setForm((f) => ({ ...f, fecha: e.target.value }))} className={inputCls} />
        </Campo>
        <Campo label="Proveedor / tercero">
          <select required value={form.tercero_id} onChange={(e) => setForm((f) => ({ ...f, tercero_id: e.target.value }))} className={inputCls}>
            <option value="">Selecciona…</option>
            {terc.map((t) => (
              <option key={t.id} value={t.id}>{t.nombre}{t.tipo === "socio" ? " (socio)" : ""}</option>
            ))}
          </select>
        </Campo>
        <Campo label="Concepto">
          <input required value={form.concepto} onChange={(e) => setForm((f) => ({ ...f, concepto: e.target.value }))} className={inputCls} placeholder="Ej. Manteca de cacao 10kg" />
        </Campo>
        <Campo label="Cuenta destino (inventario/costo)">
          <select required value={form.cuenta_destino_id} onChange={(e) => setForm((f) => ({ ...f, cuenta_destino_id: e.target.value }))} className={inputCls}>
            <option value="">Selecciona…</option>
            {cuentas.map((c) => (
              <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>
            ))}
          </select>
        </Campo>
        <Campo label="Valor (COP)">
          <input type="number" min="0" step="1000" required value={form.valor} onChange={(e) => setForm((f) => ({ ...f, valor: e.target.value }))} className={inputCls} />
        </Campo>
        <Campo label="Forma de pago">
          <select value={form.forma_pago} onChange={(e) => setForm((f) => ({ ...f, forma_pago: e.target.value as "credito" | "contado" }))} className={inputCls}>
            <option value="credito">A crédito (queda como cuenta por pagar)</option>
            <option value="contado">De contado</option>
          </select>
        </Campo>
        {form.forma_pago === "contado" && (
          <Campo label="Pagado desde">
            <select required value={form.medio_pago_id} onChange={(e) => setForm((f) => ({ ...f, medio_pago_id: e.target.value }))} className={inputCls}>
              <option value="">Selecciona…</option>
              {medios.map((m) => (
                <option key={m.id} value={m.id}>{m.nombre}</option>
              ))}
            </select>
          </Campo>
        )}
        <Campo label="Referencia (opcional)">
          <input value={form.referencia} onChange={(e) => setForm((f) => ({ ...f, referencia: e.target.value }))} className={inputCls} />
        </Campo>
      </div>
      <button type="submit" disabled={mut.isPending} className="mck-btn mck-btn-primary px-4 py-2 text-sm disabled:opacity-40">
        {mut.isPending ? "Guardando…" : "Registrar compra"}
      </button>
    </form>
  );
}

/* ─── Vista avanzada ──────────────────────────────────────────────────────── */

type SubvistaAvanzada = "plan-cuentas" | "terceros" | "movimientos" | "cuentas-t" | "balance" | "asiento-manual";

const SUBTABS: { id: SubvistaAvanzada; label: string }[] = [
  { id: "plan-cuentas", label: "Plan de cuentas" },
  { id: "terceros", label: "Terceros" },
  { id: "movimientos", label: "Movimientos" },
  { id: "cuentas-t", label: "Cuentas T" },
  { id: "balance", label: "Balance de comprobación" },
  { id: "asiento-manual", label: "Asiento manual" },
];

function VistaAvanzada() {
  const [sub, setSub] = useState<SubvistaAvanzada>("plan-cuentas");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5 border-b border-border pb-2">
        {SUBTABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSub(t.id)}
            className={hubTabClass(sub === t.id)}
          >
            <span className={HUB_TAB_LABEL}>{t.label}</span>
          </button>
        ))}
      </div>
      {sub === "plan-cuentas" && <PlanCuentasTab />}
      {sub === "terceros" && <TercerosTab />}
      {sub === "movimientos" && <MovimientosTab />}
      {sub === "cuentas-t" && <CuentasTTab />}
      {sub === "balance" && <BalanceTab />}
      {sub === "asiento-manual" && <AsientoManualTab />}
    </div>
  );
}

function PlanCuentasTab() {
  const qc = useQueryClient();
  const cuentasQ = usePlanCuentas();
  const [showForm, setShowForm] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ codigo: "", nombre: "", tipo: "activo" as TipoCuenta, notas: "" });

  const crearMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post("/api/contabilidad/cc/plan-cuentas", body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["cc-plan-cuentas"] });
      setShowForm(false);
      setForm({ codigo: "", nombre: "", tipo: "activo", notas: "" });
      setMsg("Cuenta creada");
    },
    onError: (e) => setMsg((e as Error).message),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, activa }: { id: number; activa: boolean }) =>
      api.patch(`/api/contabilidad/cc/plan-cuentas/${id}`, { activa }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["cc-plan-cuentas"] }),
  });

  const cuentas = cuentasQ.data?.cuentas ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">{cuentas.length} cuentas en el plan contable.</p>
        <button type="button" onClick={() => setShowForm((v) => !v)} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-white">
          {showForm ? "Cancelar" : "+ Nueva cuenta"}
        </button>
      </div>
      {msg && <p className="text-xs font-semibold text-emerald-600">{msg}</p>}
      {showForm && (
        <form
          className={`${cardCls} grid gap-3 sm:grid-cols-2`}
          onSubmit={(e) => {
            e.preventDefault();
            crearMut.mutate({ codigo: form.codigo.trim(), nombre: form.nombre.trim(), tipo: form.tipo, notas: form.notas.trim() });
          }}
        >
          <Campo label="Código">
            <input required value={form.codigo} onChange={(e) => setForm((f) => ({ ...f, codigo: e.target.value }))} className={inputCls} placeholder="Ej. 1440" />
          </Campo>
          <Campo label="Nombre">
            <input required value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} className={inputCls} />
          </Campo>
          <Campo label="Tipo">
            <select value={form.tipo} onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value as TipoCuenta }))} className={inputCls}>
              {(["activo", "pasivo", "patrimonio", "ingreso", "gasto", "costo"] as TipoCuenta[]).map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Campo>
          <Campo label="Notas (opcional)">
            <input value={form.notas} onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))} className={inputCls} />
          </Campo>
          <button type="submit" disabled={crearMut.isPending} className="col-span-full w-fit rounded-lg bg-accent px-4 py-2 text-xs font-bold text-white disabled:opacity-40">
            {crearMut.isPending ? "Guardando…" : "Crear cuenta"}
          </button>
        </form>
      )}
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="min-w-full text-left text-xs">
          <thead className="border-b border-border bg-surface text-[10px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2 font-bold">Código</th>
              <th className="px-3 py-2 font-bold">Nombre</th>
              <th className="px-3 py-2 font-bold">Tipo</th>
              <th className="px-3 py-2 font-bold">Naturaleza</th>
              <th className="px-3 py-2 font-bold">Estado</th>
              <th className="px-3 py-2 font-bold" />
            </tr>
          </thead>
          <tbody>
            {cuentas.map((c) => (
              <tr key={c.id} className={`border-t border-border/60 ${!c.activa ? "opacity-50" : ""}`}>
                <td className="px-3 py-2 tabular-nums text-ink">{c.codigo}</td>
                <td className="px-3 py-2 font-semibold text-ink">{c.nombre}</td>
                <td className="px-3 py-2 text-muted capitalize">{c.tipo}</td>
                <td className="px-3 py-2 text-muted capitalize">{c.naturaleza}</td>
                <td className="px-3 py-2 text-muted">{c.activa ? "Activa" : "Inactiva"}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => toggleMut.mutate({ id: c.id, activa: !c.activa })}
                    className="text-[10px] font-bold text-muted hover:underline"
                  >
                    {c.activa ? "Desactivar" : "Activar"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TercerosTab() {
  const qc = useQueryClient();
  const terceros = useTerceros();
  const cuentasQ = usePlanCuentas();
  const [showForm, setShowForm] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({
    nombre: "",
    tipo: "proveedor" as TipoTercero,
    identificacion: "",
    telefono: "",
    cuenta_por_pagar_id: "",
    notas: "",
  });

  const pasivos = (cuentasQ.data?.cuentas ?? []).filter((c) => c.activa && c.tipo === "pasivo");

  const crearMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post("/api/contabilidad/cc/terceros", body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["cc-terceros"] });
      setShowForm(false);
      setForm({ nombre: "", tipo: "proveedor", identificacion: "", telefono: "", cuenta_por_pagar_id: "", notas: "" });
      setMsg("Tercero creado");
    },
    onError: (e) => setMsg((e as Error).message),
  });

  const toggleMut = useMutation({
    mutationFn: (id: number) => api.delete(`/api/contabilidad/cc/terceros/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["cc-terceros"] }),
  });

  const lista = terceros.data?.terceros ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">{lista.length} terceros registrados.</p>
        <button type="button" onClick={() => setShowForm((v) => !v)} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-white">
          {showForm ? "Cancelar" : "+ Nuevo tercero"}
        </button>
      </div>
      {msg && <p className="text-xs font-semibold text-emerald-600">{msg}</p>}
      {showForm && (
        <form
          className={`${cardCls} grid gap-3 sm:grid-cols-2`}
          onSubmit={(e) => {
            e.preventDefault();
            crearMut.mutate({
              nombre: form.nombre.trim(),
              tipo: form.tipo,
              identificacion: form.identificacion.trim(),
              telefono: form.telefono.trim(),
              cuenta_por_pagar_id: form.cuenta_por_pagar_id ? Number(form.cuenta_por_pagar_id) : null,
              notas: form.notas.trim(),
            });
          }}
        >
          <Campo label="Nombre">
            <input required value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} className={inputCls} />
          </Campo>
          <Campo label="Tipo">
            <select value={form.tipo} onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value as TipoTercero }))} className={inputCls}>
              {(["proveedor", "cliente", "socio", "empleado", "otro"] as TipoTercero[]).map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Campo>
          <Campo label="Identificación (opcional)">
            <input value={form.identificacion} onChange={(e) => setForm((f) => ({ ...f, identificacion: e.target.value }))} className={inputCls} />
          </Campo>
          <Campo label="Teléfono (opcional)">
            <input value={form.telefono} onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))} className={inputCls} />
          </Campo>
          <Campo label="Cuenta por pagar asociada (opcional)">
            <select value={form.cuenta_por_pagar_id} onChange={(e) => setForm((f) => ({ ...f, cuenta_por_pagar_id: e.target.value }))} className={inputCls}>
              <option value="">Usar la genérica (2380 / 2205)</option>
              {pasivos.map((c) => (
                <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>
              ))}
            </select>
          </Campo>
          <Campo label="Notas (opcional)">
            <input value={form.notas} onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))} className={inputCls} />
          </Campo>
          <button type="submit" disabled={crearMut.isPending} className="col-span-full w-fit rounded-lg bg-accent px-4 py-2 text-xs font-bold text-white disabled:opacity-40">
            {crearMut.isPending ? "Guardando…" : "Crear tercero"}
          </button>
        </form>
      )}
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="min-w-full text-left text-xs">
          <thead className="border-b border-border bg-surface text-[10px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2 font-bold">Nombre</th>
              <th className="px-3 py-2 font-bold">Tipo</th>
              <th className="px-3 py-2 font-bold">Identificación</th>
              <th className="px-3 py-2 font-bold">Teléfono</th>
              <th className="px-3 py-2 font-bold">Estado</th>
              <th className="px-3 py-2 font-bold" />
            </tr>
          </thead>
          <tbody>
            {lista.map((t) => (
              <tr key={t.id} className={`border-t border-border/60 ${!t.activo ? "opacity-50" : ""}`}>
                <td className="px-3 py-2 font-semibold text-ink">{t.nombre}</td>
                <td className="px-3 py-2 text-muted capitalize">{t.tipo}</td>
                <td className="px-3 py-2 text-muted">{t.identificacion || "—"}</td>
                <td className="px-3 py-2 text-muted">{t.telefono || "—"}</td>
                <td className="px-3 py-2 text-muted">{t.activo ? "Activo" : "Inactivo"}</td>
                <td className="px-3 py-2 text-right">
                  {t.activo && (
                    <button type="button" onClick={() => toggleMut.mutate(t.id)} className="text-[10px] font-bold text-danger hover:underline">
                      Desactivar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MovimientosTab() {
  const qc = useQueryClient();
  const [filtros, setFiltros] = useState({ desde: "", hasta: "", q: "" });
  const [msg, setMsg] = useState<string | null>(null);

  const params = new URLSearchParams();
  if (filtros.desde) params.set("desde", filtros.desde);
  if (filtros.hasta) params.set("hasta", filtros.hasta);
  if (filtros.q) params.set("q", filtros.q);
  params.set("limit", "150");

  const movQ = useQuery<{ movimientos: Movimiento[] }>({
    queryKey: ["cc-movimientos", filtros],
    queryFn: () => api.get(`/api/contabilidad/cc/movimientos?${params.toString()}`),
  });

  const anularMut = useMutation({
    mutationFn: (id: number) => api.post(`/api/contabilidad/cc/movimientos/${id}/anular`),
    onSuccess: () => invalidarTodo(qc),
    onError: (e) => setMsg((e as Error).message),
  });
  const eliminarMut = useMutation({
    mutationFn: (id: number) => api.delete(`/api/contabilidad/cc/movimientos/${id}`),
    onSuccess: () => invalidarTodo(qc),
    onError: (e) => setMsg((e as Error).message),
  });

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <Campo label="Desde">
          <input type="date" value={filtros.desde} onChange={(e) => setFiltros((f) => ({ ...f, desde: e.target.value }))} className={inputCls} />
        </Campo>
        <Campo label="Hasta">
          <input type="date" value={filtros.hasta} onChange={(e) => setFiltros((f) => ({ ...f, hasta: e.target.value }))} className={inputCls} />
        </Campo>
        <Campo label="Buscar en concepto">
          <input value={filtros.q} onChange={(e) => setFiltros((f) => ({ ...f, q: e.target.value }))} className={inputCls} placeholder="Ej. Amazon, cacao…" />
        </Campo>
      </div>
      {msg && <p className="text-xs font-semibold text-danger">{msg}</p>}
      <TablaMovimientos
        movimientos={movQ.data?.movimientos ?? []}
        cargando={movQ.isLoading}
        onAnular={(id) => anularMut.mutate(id)}
        onEliminar={(id) => eliminarMut.mutate(id)}
      />
    </div>
  );
}

function CuentasTTab() {
  const cuentasQ = usePlanCuentas();
  const [cuentaId, setCuentaId] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");

  const params = new URLSearchParams();
  if (desde) params.set("desde", desde);
  if (hasta) params.set("hasta", hasta);

  const mayorQ = useQuery<MayorCuenta>({
    queryKey: ["cc-mayor-cuenta", cuentaId, desde, hasta],
    queryFn: () => api.get(`/api/contabilidad/cc/cuentas-t/${cuentaId}?${params.toString()}`),
    enabled: Boolean(cuentaId),
  });

  const cuentas = cuentasQ.data?.cuentas ?? [];
  const m = mayorQ.data;

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <Campo label="Cuenta">
          <select value={cuentaId} onChange={(e) => setCuentaId(e.target.value)} className={inputCls}>
            <option value="">Selecciona una cuenta…</option>
            {cuentas.map((c) => (
              <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>
            ))}
          </select>
        </Campo>
        <Campo label="Desde (opcional)">
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={inputCls} />
        </Campo>
        <Campo label="Hasta (opcional)">
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={inputCls} />
        </Campo>
      </div>

      {!cuentaId && <p className="text-xs text-muted">Selecciona una cuenta para ver su cuenta T.</p>}
      {mayorQ.isLoading && <p className="text-xs text-muted">Cargando…</p>}

      {m && (
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="border-b border-border bg-surface px-3 py-2">
            <p className="text-sm font-bold text-ink">{m.cuenta.codigo} · {m.cuenta.nombre}</p>
            <p className="text-[10px] uppercase text-muted">Naturaleza: {m.cuenta.naturaleza}</p>
          </div>
          <div className="grid grid-cols-2">
            <div className="border-r border-border">
              <p className="border-b border-border bg-surface-panel px-3 py-1.5 text-center text-[10px] font-bold uppercase text-muted">Debe</p>
              {m.saldo_inicial !== 0 && (
                <p className="border-b border-border/40 px-3 py-1.5 text-[11px] italic text-muted">Saldo inicial: {formatCop(m.saldo_inicial)}</p>
              )}
              {m.movimientos.filter((l) => l.debito > 0).map((l) => (
                <div key={l.movimiento_id + "-d"} className="flex justify-between border-b border-border/30 px-3 py-1.5 text-[11px]">
                  <span className="text-muted">{l.fecha} · {l.concepto}</span>
                  <span className="tabular-nums font-semibold text-ink">{formatCop(l.debito)}</span>
                </div>
              ))}
            </div>
            <div>
              <p className="border-b border-border bg-surface-panel px-3 py-1.5 text-center text-[10px] font-bold uppercase text-muted">Haber</p>
              {m.movimientos.filter((l) => l.credito > 0).map((l) => (
                <div key={l.movimiento_id + "-c"} className="flex justify-between border-b border-border/30 px-3 py-1.5 text-[11px]">
                  <span className="text-muted">{l.fecha} · {l.concepto}</span>
                  <span className="tabular-nums font-semibold text-ink">{formatCop(l.credito)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 border-t border-border">
            <p className="border-r border-border px-3 py-2 text-right text-xs font-bold tabular-nums text-ink">
              {formatCop(m.total_debito)}
            </p>
            <p className="px-3 py-2 text-right text-xs font-bold tabular-nums text-ink">
              {formatCop(m.total_credito)}
            </p>
          </div>
          <div className="border-t border-border bg-surface px-3 py-2 text-center">
            <span className="text-xs font-bold text-accent">Saldo final: {formatCop(m.saldo_final)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function BalanceTab() {
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const params = new URLSearchParams();
  if (desde) params.set("desde", desde);
  if (hasta) params.set("hasta", hasta);

  const balQ = useQuery<Balance>({
    queryKey: ["cc-balance", desde, hasta],
    queryFn: () => api.get(`/api/contabilidad/cc/balance-comprobacion?${params.toString()}`),
  });
  const b = balQ.data;

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Campo label="Desde (opcional)">
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={inputCls} />
        </Campo>
        <Campo label="Hasta (opcional)">
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={inputCls} />
        </Campo>
      </div>
      {balQ.isLoading && <p className="text-xs text-muted">Cargando…</p>}
      {b && (
        <>
          <p className={`text-xs font-bold ${b.cuadra ? "text-emerald-600" : "text-danger"}`}>
            {b.cuadra ? "✓ El balance cuadra" : "✗ El balance no cuadra — revisa los movimientos"}
          </p>
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="min-w-full text-left text-xs">
              <thead className="border-b border-border bg-surface text-[10px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2 font-bold">Código</th>
                  <th className="px-3 py-2 font-bold">Cuenta</th>
                  <th className="px-3 py-2 font-bold text-right">Saldo inicial</th>
                  <th className="px-3 py-2 font-bold text-right">Débito</th>
                  <th className="px-3 py-2 font-bold text-right">Crédito</th>
                  <th className="px-3 py-2 font-bold text-right">Saldo final</th>
                </tr>
              </thead>
              <tbody>
                {b.cuentas.map((c) => (
                  <tr key={c.cuenta_id} className="border-t border-border/60">
                    <td className="px-3 py-2 tabular-nums text-ink">{c.codigo}</td>
                    <td className="px-3 py-2 font-semibold text-ink">{c.nombre}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{formatCop(c.saldo_inicial)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink">{formatCop(c.debito)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink">{formatCop(c.credito)}</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums text-ink">{formatCop(c.saldo_final)}</td>
                  </tr>
                ))}
                {b.cuentas.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-4 text-muted">Sin movimientos en el rango.</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border font-bold">
                  <td className="px-3 py-2" colSpan={3}>Totales</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink">{formatCop(b.total_debito)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink">{formatCop(b.total_credito)}</td>
                  <td className="px-3 py-2" />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

interface LineaAsiento {
  cuenta_id: string;
  tercero_id: string;
  debito: string;
  credito: string;
  descripcion: string;
}

function lineaVacia(): LineaAsiento {
  return { cuenta_id: "", tercero_id: "", debito: "", credito: "", descripcion: "" };
}

function AsientoManualTab() {
  const qc = useQueryClient();
  const cuentasQ = usePlanCuentas();
  const terceros = useTerceros();
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [concepto, setConcepto] = useState("");
  const [referencia, setReferencia] = useState("");
  const [lineas, setLineas] = useState<LineaAsiento[]>([lineaVacia(), lineaVacia()]);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  const cuentas = (cuentasQ.data?.cuentas ?? []).filter((c) => c.activa);
  const terc = terceros.data?.terceros ?? [];

  const totalDebito = lineas.reduce((a, l) => a + (parseFloat(l.debito) || 0), 0);
  const totalCredito = lineas.reduce((a, l) => a + (parseFloat(l.credito) || 0), 0);
  const cuadra = lineas.some((l) => l.cuenta_id) && Math.round(totalDebito * 100) === Math.round(totalCredito * 100) && totalDebito > 0;

  const mut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ ok?: boolean; error?: string }>("/api/contabilidad/cc/movimientos", body),
    onSuccess: (r) => {
      if (r.error) {
        setMsg({ tipo: "error", texto: r.error });
        return;
      }
      setMsg({ tipo: "ok", texto: "Asiento registrado" });
      setConcepto("");
      setReferencia("");
      setLineas([lineaVacia(), lineaVacia()]);
      invalidarTodo(qc);
    },
    onError: (e) => setMsg({ tipo: "error", texto: (e as Error).message }),
  });

  function actualizarLinea(i: number, campo: keyof LineaAsiento, valor: string) {
    setLineas((cur) => cur.map((l, idx) => (idx === i ? { ...l, [campo]: valor } : l)));
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const payloadLineas = lineas
          .filter((l) => l.cuenta_id && (parseFloat(l.debito) > 0 || parseFloat(l.credito) > 0))
          .map((l) => ({
            cuenta_id: Number(l.cuenta_id),
            tercero_id: l.tercero_id ? Number(l.tercero_id) : null,
            debito: parseFloat(l.debito) || 0,
            credito: parseFloat(l.credito) || 0,
            descripcion: l.descripcion.trim(),
          }));
        if (payloadLineas.length < 2) {
          setMsg({ tipo: "error", texto: "Se requieren al menos 2 líneas con cuenta y monto" });
          return;
        }
        mut.mutate({ fecha, concepto: concepto.trim(), referencia: referencia.trim(), lineas: payloadLineas });
      }}
    >
      <div className={`${cardCls} space-y-3`}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Campo label="Fecha">
            <input type="date" required value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputCls} />
          </Campo>
          <Campo label="Concepto">
            <input required value={concepto} onChange={(e) => setConcepto(e.target.value)} className={inputCls} />
          </Campo>
          <Campo label="Referencia (opcional)">
            <input value={referencia} onChange={(e) => setReferencia(e.target.value)} className={inputCls} />
          </Campo>
        </div>

        <div className="space-y-2">
          {lineas.map((l, i) => (
            <div key={i} className="grid grid-cols-12 items-end gap-2 rounded-lg border border-border/60 p-2">
              <div className="col-span-4">
                <Campo label="Cuenta">
                  <select value={l.cuenta_id} onChange={(e) => actualizarLinea(i, "cuenta_id", e.target.value)} className={inputCls}>
                    <option value="">—</option>
                    {cuentas.map((c) => (
                      <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>
                    ))}
                  </select>
                </Campo>
              </div>
              <div className="col-span-2">
                <Campo label="Débito">
                  <input type="number" min="0" step="1" value={l.debito} onChange={(e) => actualizarLinea(i, "debito", e.target.value)} className={inputCls} />
                </Campo>
              </div>
              <div className="col-span-2">
                <Campo label="Crédito">
                  <input type="number" min="0" step="1" value={l.credito} onChange={(e) => actualizarLinea(i, "credito", e.target.value)} className={inputCls} />
                </Campo>
              </div>
              <div className="col-span-3">
                <Campo label="Descripción">
                  <input value={l.descripcion} onChange={(e) => actualizarLinea(i, "descripcion", e.target.value)} className={inputCls} />
                </Campo>
              </div>
              <div className="col-span-1">
                <Campo label="Tercero">
                  <select value={l.tercero_id} onChange={(e) => actualizarLinea(i, "tercero_id", e.target.value)} className={inputCls}>
                    <option value="">—</option>
                    {terc.map((t) => (
                      <option key={t.id} value={t.id}>{t.nombre}</option>
                    ))}
                  </select>
                </Campo>
              </div>
              {lineas.length > 2 && (
                <button
                  type="button"
                  onClick={() => setLineas((cur) => cur.filter((_, idx) => idx !== i))}
                  className="col-span-full text-right text-[10px] font-bold text-danger hover:underline"
                >
                  Quitar línea
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setLineas((cur) => [...cur, lineaVacia()])}
            className="rounded-lg border border-dashed border-border px-3 py-1.5 text-[11px] font-bold text-muted hover:text-ink"
          >
            + Añadir línea
          </button>
        </div>

        <div className={`flex items-center justify-between rounded-lg px-3 py-2 text-xs font-bold ${cuadra ? "bg-emerald-600/10 text-emerald-600" : "bg-danger/10 text-danger"}`}>
          <span>Débitos: {formatCop(totalDebito)}</span>
          <span>Créditos: {formatCop(totalCredito)}</span>
          <span>{cuadra ? "✓ Cuadra" : "✗ No cuadra"}</span>
        </div>

        {msg && (
          <p className={`text-xs font-semibold ${msg.tipo === "ok" ? "text-emerald-600" : "text-danger"}`}>{msg.texto}</p>
        )}

        <button type="submit" disabled={mut.isPending || !cuadra} className="rounded-lg bg-accent px-4 py-2 text-xs font-bold text-white disabled:opacity-40">
          {mut.isPending ? "Guardando…" : "Registrar asiento"}
        </button>
      </div>
    </form>
  );
}
