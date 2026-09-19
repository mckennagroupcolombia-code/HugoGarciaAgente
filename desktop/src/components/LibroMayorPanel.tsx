import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api/client";
import ComprobanteWidget from "./ComprobanteWidget";
import TerceroSelect from "./TerceroSelect";
import { Icon } from "../icons";
import type { IconName } from "../icons/types";
import { usePanelTheme } from "../stores/panelTheme";
import { HUB_TAB_LABEL, hubTabClass } from "../lib/hubTabClass";
import { AddIconButton } from "./AddIconButton";
import { useAppStore } from "../stores/app";
import "./libroMayor.css";

const IngresosEgresosPanel = lazy(() => import("./IngresosEgresosPanel"));
const CreditosAdquiridosPanel = lazy(() => import("./CreditosAdquiridosPanel"));
const SociosPanel = lazy(() => import("./SociosPanel"));
const MayorCuentasPanel = lazy(() => import("./MayorCuentasPanel"));

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

type TipoPersona = "natural" | "juridica";

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
  tipo_persona?: TipoPersona;
  usuario_id?: number | null;
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
  soporte_path?: string;
  soporte_nombre?: string;
  /** Comprobante en Alegra que espeja este asiento, si ya se espejó. */
  alegra_journal_id?: string;
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

const AMBITO_KEY = "mckenna-libro-mayor-ambito";
// «-v2»: hasta sep-2026 el libro abría en Conciliar y eso quedó guardado en el
// navegador de todos; con las claves viejas nadie vería el nuevo punto de
// partida (el PUC con saldos).
const GRUPO_KEY = "mckenna-libro-mayor-grupo-v2";
const SUB_KEY = "mckenna-libro-mayor-sub-v2";

type Ambito = "empresa" | "socios";

function leerLS<T extends string>(key: string, valido: (v: string) => v is T, def: T): T {
  try {
    const v = localStorage.getItem(key) || "";
    return valido(v) ? v : def;
  } catch {
    return def;
  }
}

function guardarLS(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* ignore */
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
  const skin = usePanelTheme((s) => s.skin);
  const libroMayorBootTab = useAppStore((s) => s.libroMayorBootTab);
  const setLibroMayorBootTab = useAppStore((s) => s.setLibroMayorBootTab);
  const [ambito, setAmbito] = useState<Ambito>(() =>
    leerLS(AMBITO_KEY, (v): v is Ambito => v === "empresa" || v === "socios", "empresa"),
  );

  function cambiarAmbito(a: Ambito) {
    setAmbito(a);
    guardarLS(AMBITO_KEY, a);
  }

  // Un atajo externo hacia «Cuenta de Socio» (o «socios») cae en el ámbito Socios;
  // cualquier otra subvista pertenece al ámbito Empresa.
  useEffect(() => {
    if (!libroMayorBootTab) return;
    if (libroMayorBootTab === "cuenta-socio" || libroMayorBootTab === "socios") {
      cambiarAmbito("socios");
    } else {
      cambiarAmbito("empresa");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libroMayorBootTab]);

  return (
    <div className="lm-root mx-auto space-y-3 px-0.5 pb-3 sm:px-0" data-skin={skin}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-xl">
          <h2 className="text-base font-bold tracking-tight text-ink">Libro Mayor</h2>
          <p className="mt-0.5 text-xs text-muted">
            {ambito === "empresa"
              ? "Plan de cuentas con saldos, terceros y cada causación. Registrar, conciliar el banco y configurar quedan en las pestañas de al lado."
              : "Contabilidad personal de cada socio, dentro de la de la empresa: extractos propios, cuenta con McKenna, cruces y declaración de renta."}
          </p>
        </div>
        <div
          className="inline-flex shrink-0 rounded-xl border border-border bg-surface-panel p-0.5 shadow-paper-sm"
          role="tablist"
          aria-label="Ámbito"
        >
          {(
            [
              { id: "empresa", label: "Empresa", icon: "building" },
              { id: "socios", label: "Socios", icon: "users" },
            ] as { id: Ambito; label: string; icon: IconName }[]
          ).map((a) => (
            <button
              key={a.id}
              type="button"
              role="tab"
              aria-selected={ambito === a.id}
              title={a.label}
              aria-label={a.label}
              onClick={() => cambiarAmbito(a.id)}
              className={hubTabClass(ambito === a.id, "mck-hub-tab-etiquetado flex-col")}
            >
              <Icon name={a.icon} size={22} weight="bold" />
              <span className={HUB_TAB_LABEL}>{a.label}</span>
            </button>
          ))}
        </div>
      </div>

      {ambito === "empresa" ? (
        <VistaEmpresa
          bootSub={libroMayorBootTab && libroMayorBootTab !== "socios" && libroMayorBootTab !== "cuenta-socio" ? libroMayorBootTab : null}
          onBootConsumido={() => setLibroMayorBootTab(null)}
        />
      ) : (
        <Suspense fallback={<p className="text-sm text-muted">Cargando…</p>}>
          <SociosPanel embebido />
        </Suspense>
      )}
    </div>
  );
}

/* ─── Vista simple ────────────────────────────────────────────────────────── */

type AccionRapida = "ingreso" | "egreso" | "compra-socio" | "pago-socio" | "compra-proveedor" | "aporte-capital";

const ACCIONES: { id: AccionRapida; icon: IconName; label: string; desc: string }[] = [
  { id: "ingreso", icon: "inbox", label: "Ingreso", desc: "Entra a caja o banco" },
  { id: "egreso", icon: "outbox", label: "Egreso", desc: "Sale de caja o banco" },
  { id: "compra-socio", icon: "package", label: "Compra socio", desc: "Amazon u otra compra con comisión" },
  { id: "pago-socio", icon: "handshake", label: "Pago a socio", desc: "Gira para saldar su cuenta" },
  { id: "compra-proveedor", icon: "receipt", label: "Compra proveedor", desc: "Externo o socio-proveedor" },
  { id: "aporte-capital", icon: "chartBar", label: "Aporte de capital", desc: "Patrimonio, no préstamo" },
];

function BannerPendientes() {
  const setLibroMayorBootTab = useAppStore((s) => s.setLibroMayorBootTab);
  const setAbrirPendientes = useAppStore((s) => s.setLibroMayorAbrirPendientes);

  const desde = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return d.toISOString().slice(0, 10);
  }, []);
  const hasta = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const pendQ = useQuery<{ pendientes: unknown[] }>({
    queryKey: ["extractos-pendientes-banner", desde, hasta],
    queryFn: () => api.get(`/api/contabilidad/extractos/pendientes?desde=${desde}&hasta=${hasta}&limit=500`),
  });

  function irAClasificar() {
    setAbrirPendientes(true);
    setLibroMayorBootTab("diario");
  }

  if (pendQ.isLoading) {
    return <div className="lm-card px-4 py-3 text-xs text-muted">Revisando el banco…</div>;
  }
  const n = pendQ.data?.pendientes?.length ?? 0;
  if (n === 0) {
    return (
      <div className="lm-card flex items-center gap-2 border-emerald-600/30 bg-emerald-600/5 px-4 py-3 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
        ✅ Todo el banco de los últimos 90 días está contabilizado.
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={irAClasificar}
      className="lm-card flex w-full flex-wrap items-center justify-between gap-2 border-amber-600/40 bg-amber-600/10 px-4 py-3 text-left hover:bg-amber-600/15"
    >
      <span className="text-sm font-bold text-amber-800 dark:text-amber-300">
        ⚠️ {n} movimiento{n === 1 ? "" : "s"} del banco sin contabilizar (últimos 90 días)
      </span>
      <span className="text-xs font-bold text-amber-800 underline dark:text-amber-300">Clasificarlos →</span>
    </button>
  );
}

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
      <BannerPendientes />

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
              <Icon name={a.icon} size={16} weight="bold" />
            </span>
            <span className="lm-action-label">{a.label}</span>
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
      {accion === "aporte-capital" && <FormAporteCapital onDone={onDone} onError={onError} />}

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
  const setLibroMayorBootTab = useAppStore((s) => s.setLibroMayorBootTab);
  const setLibroMayorBootTerceroId = useAppStore((s) => s.setLibroMayorBootTerceroId);
  const saldoQ = useQuery<SaldoTercero>({
    queryKey: ["cc-saldo-tercero", tercero.id],
    queryFn: () => api.get(`/api/contabilidad/cc/terceros/${tercero.id}/saldo`),
  });
  const saldo = saldoQ.data?.saldo_por_pagar ?? 0;

  function verCuenta() {
    setLibroMayorBootTerceroId(tercero.id);
    setLibroMayorBootTab("cuenta-socio");
  }

  return (
    <div className="lm-card lm-kpi">
      <div className="flex min-w-0 items-center gap-3">
        <span className="lm-kpi-icon" aria-hidden>
          <Icon name="handshake" size={20} weight="duotone" />
        </span>
        <div className="min-w-0">
          <button type="button" onClick={verCuenta} className="truncate text-sm font-semibold text-ink hover:text-accent hover:underline">
            Por pagar a {tercero.nombre}
          </button>
          <p className={`mt-0.5 text-xl font-extrabold tabular-nums tracking-tight ${saldo > 0 ? "text-accent" : "text-ink"}`}>
            {saldoQ.isLoading ? "…" : formatCop(saldo)}
          </p>
          <button type="button" onClick={verCuenta} className="mt-0.5 text-[11px] font-bold text-accent hover:underline">
            Ver cuenta completa →
          </button>
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

/**
 * El comprobante de este asiento en Alegra: crearlo o anularlo desde acá.
 *
 * Existe porque el contador arma las declaraciones con lo que ve en Alegra, no
 * con el Libro Mayor. Cuando un asiento se anula y se rehace, el comprobante
 * viejo se queda allá con las cifras equivocadas; hasta el 16-sep-2026 había
 * que entrar a Alegra a borrarlo a mano, que es el paso que no se hace.
 */
function EspejoAlegra({ m }: { m: Movimiento }) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const anulado = m.estado === "anulado";

  async function llamar(metodo: "post" | "delete", url: string) {
    setOcupado(true);
    setMsg(null);
    try {
      const r = metodo === "post"
        ? await api.post<{ status?: string; id?: string; message?: string; error?: string }>(url, {})
        : await api.delete<{ status?: string; id?: string; message?: string; error?: string }>(url);
      setMsg(r.error || r.message || (r.status === "success" ? `Alegra #${r.id}` : r.status || "listo"));
      void qc.invalidateQueries({ queryKey: ["cc-movimientos"] });
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px]">
      {m.alegra_journal_id ? (
        <>
          <span className="font-semibold text-emerald-600">🧾 Alegra #{m.alegra_journal_id}</span>
          <button
            type="button"
            disabled={ocupado}
            onClick={() => {
              const aviso = anulado
                ? `Anular en Alegra el comprobante #${m.alegra_journal_id} de este asiento.\n\nEl contador dejará de verlo. ¿Continuar?`
                : `⚠️ El asiento #${m.id} sigue CONFIRMADO.\n\nSi borras su comprobante #${m.alegra_journal_id}, el contador deja de ver este movimiento en Alegra aunque siga vivo en el Libro Mayor. Normalmente primero se anula el asiento.\n\n¿Anular el comprobante de todos modos?`;
              if (!window.confirm(aviso)) return;
              void llamar("delete", `/api/alegra/espejo/${m.id}${anulado ? "" : "?forzar=1"}`);
            }}
            className="rounded-lg border border-border px-2 py-1 font-semibold text-muted hover:border-danger hover:text-danger disabled:opacity-40"
          >
            {ocupado ? "…" : "Anular en Alegra"}
          </button>
        </>
      ) : (
        <>
          <span className="text-muted">Sin comprobante en Alegra</span>
          {!anulado && (
            <button
              type="button"
              disabled={ocupado}
              onClick={() => void llamar("post", `/api/alegra/espejo/${m.id}`)}
              className="rounded-lg border border-border px-2 py-1 font-semibold text-muted hover:border-accent hover:text-accent disabled:opacity-40"
            >
              {ocupado ? "…" : "Espejar a Alegra"}
            </button>
          )}
        </>
      )}
      {msg && <span className="text-muted">{msg}</span>}
    </div>
  );
}

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
  const qc = useQueryClient();
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
                    <div className="mt-1">
                      <EspejoAlegra m={m} />
                    </div>
                    <div className="mt-1">
                      <ComprobanteWidget
                        uploadUrl={`/api/contabilidad/cc/movimientos/${m.id}/comprobante`}
                        viewUrl={`/api/contabilidad/cc/movimientos/${m.id}/comprobante`}
                        deleteUrl={`/api/contabilidad/cc/movimientos/${m.id}/comprobante`}
                        soportePath={m.soporte_path}
                        soporteNombre={m.soporte_nombre}
                        onUpdated={() => void qc.invalidateQueries({ queryKey: ["cc-movimientos"] })}
                      />
                    </div>
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

function FormAporteCapital({
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

  const mut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ ok?: boolean; error?: string; movimiento?: Movimiento }>(
        "/api/contabilidad/cc/plantillas/aporte-capital",
        body,
      ),
    onSuccess: (r) => {
      if (r.error) return onError(new Error(r.error));
      onDone("Aporte de capital registrado");
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
      <p className="text-base font-bold tracking-tight text-ink">Aporte de capital</p>
      <p className="text-sm leading-snug text-muted">
        Dinero que un socio mete como capital — patrimonio, no un préstamo: no se abona ni se
        devuelve como una cuenta por pagar.
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
        <Campo label="Monto (COP)">
          <input type="number" min="0" step="1000" required value={form.monto} onChange={(e) => setForm((f) => ({ ...f, monto: e.target.value }))} className={inputCls} />
        </Campo>
        <Campo label="Hacia">
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
        {mut.isPending ? "Guardando…" : "Registrar aporte"}
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
        <TerceroSelect
          label="Proveedor / tercero"
          value={form.tercero_id}
          onChange={(id) => setForm((f) => ({ ...f, tercero_id: id }))}
          tiposPermitidos={["proveedor", "socio", "otro"]}
        />
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

/* ─── Vista Empresa: jerarquía en cuatro etapas ──────────────────────────── */

type SubvistaAvanzada =
  | "diario"
  | "libro-diario"
  | "mayor"
  | "rapido"
  | "plan-cuentas"
  | "terceros"
  | "movimientos"
  | "cuentas-t"
  | "balance"
  | "asiento-manual"
  | "prestamos"
  | "creditos-adquiridos"
  | "informes"
  | "cuenta-socio";

type GrupoId = "conciliar" | "registrar" | "consultar" | "configurar";

interface Grupo {
  id: GrupoId;
  num: number;
  label: string;
  desc: string;
  icon: IconName;
  subs: { id: SubvistaAvanzada; label: string; icon: IconName; desc: string }[];
}

/**
 * Antes había 10 pestañas planas al mismo nivel y nadie sabía por dónde
 * empezar; luego se ordenaron por etapa con Conciliar primero. Pero lo que se
 * abre a diario es el libro mismo —el PUC con los saldos de cada cuenta, sus
 * terceros y cada causación—, como lo ve el contador. Así que ese va primero y
 * la conciliación del banco, que es un trabajo puntual, queda como apartado.
 */
const GRUPOS: Grupo[] = [
  {
    id: "consultar",
    num: 1,
    label: "Libro Mayor",
    desc: "PUC, saldos y terceros",
    icon: "book",
    subs: [
      { id: "mayor", label: "Plan de cuentas y saldos", icon: "book", desc: "Árbol del PUC, terceros y extracto por cuenta" },
      // El Mayor responde «cómo se movió esta cuenta»; el Diario, «qué pasó ese
      // día»: el asiento completo con el nombre de cada cuenta, débito y crédito.
      { id: "libro-diario", label: "Libro Diario", icon: "listChecks", desc: "Asientos del día con cuenta, débito y crédito" },
      { id: "balance", label: "Balance", icon: "chartBar", desc: "Comprobación débito = crédito" },
      { id: "movimientos", label: "Asientos", icon: "listChecks", desc: "Todos los comprobantes" },
      { id: "cuentas-t", label: "Cuentas T", icon: "receipt", desc: "Debe / haber a dos columnas" },
      { id: "informes", label: "Informes", icon: "chartBar", desc: "Préstamos y pendientes" },
    ],
  },
  {
    id: "registrar",
    num: 2,
    label: "Registrar",
    desc: "Lo que falta por asentar",
    icon: "pencil",
    subs: [
      { id: "rapido", label: "Acciones rápidas", icon: "lightning", desc: "Ingreso, egreso, socios, proveedor" },
      { id: "asiento-manual", label: "Asiento manual", icon: "pencil", desc: "Débito / crédito libre" },
    ],
  },
  {
    id: "conciliar",
    num: 3,
    label: "Conciliar banco",
    desc: "Extracto ↔ libro, paso a paso",
    icon: "receipt",
    subs: [{ id: "diario", label: "Diario y conciliación", icon: "receipt", desc: "Extracto, emparejar, clasificar" }],
  },
  {
    id: "configurar",
    num: 4,
    label: "Configurar",
    desc: "Catálogos del libro",
    icon: "wrench",
    subs: [
      { id: "plan-cuentas", label: "Plan de cuentas", icon: "book", desc: "PUC propio" },
      { id: "terceros", label: "Terceros", icon: "users", desc: "Proveedores, socios, clientes" },
      { id: "creditos-adquiridos", label: "Créditos adquiridos", icon: "chartBar", desc: "Sub-libro con tasa y plazo" },
    ],
  },
];

function grupoDeSub(sub: SubvistaAvanzada | null | undefined): GrupoId {
  for (const g of GRUPOS) if (g.subs.some((x) => x.id === sub)) return g.id;
  return "consultar";
}

function subValida(v: string): v is SubvistaAvanzada {
  return GRUPOS.some((g) => g.subs.some((x) => x.id === v));
}

function grupoValido(v: string): v is GrupoId {
  return GRUPOS.some((g) => g.id === v);
}

function VistaEmpresa({
  bootSub,
  onBootConsumido,
}: {
  bootSub?: SubvistaAvanzada | null;
  onBootConsumido?: () => void;
}) {
  const [sub, setSub] = useState<SubvistaAvanzada>(() =>
    bootSub && subValida(bootSub) ? bootSub : leerLS(SUB_KEY, subValida, "mayor"),
  );
  const [grupo, setGrupo] = useState<GrupoId>(() =>
    bootSub && subValida(bootSub) ? grupoDeSub(bootSub) : leerLS(GRUPO_KEY, grupoValido, "consultar"),
  );
  const [pendientesSignal, setPendientesSignal] = useState(0);
  const [cargaSignal, setCargaSignal] = useState(0);
  const [sugerenciasSignal, setSugerenciasSignal] = useState(0);
  const abrirPendientesBoot = useAppStore((s) => s.libroMayorAbrirPendientes);
  const setAbrirPendientesBoot = useAppStore((s) => s.setLibroMayorAbrirPendientes);

  function irA(next: SubvistaAvanzada) {
    setSub(next);
    setGrupo(grupoDeSub(next));
    guardarLS(SUB_KEY, next);
    guardarLS(GRUPO_KEY, grupoDeSub(next));
  }

  function elegirGrupo(g: GrupoId) {
    const def = GRUPOS.find((x) => x.id === g)!.subs[0].id;
    // Si la subvista actual ya pertenece al grupo, se conserva.
    irA(grupoDeSub(sub) === g ? sub : def);
  }

  useEffect(() => {
    if (bootSub && subValida(bootSub)) {
      irA(bootSub);
      onBootConsumido?.();
    }
    if (bootSub === "diario" && abrirPendientesBoot) {
      setPendientesSignal((n) => n + 1);
      setAbrirPendientesBoot(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootSub, abrirPendientesBoot]);

  function irAPendientes() {
    irA("diario");
    setPendientesSignal((n) => n + 1);
  }

  const grupoActual = GRUPOS.find((g) => g.id === grupo)!;

  return (
    <div className="space-y-4">
      {/* Nivel 1: etapas */}
      <div className="mck-stagger grid grid-cols-2 gap-2 lg:grid-cols-4" role="tablist" aria-label="Etapas del libro">
        {GRUPOS.map((g) => {
          const activo = g.id === grupo;
          return (
            <button
              key={g.id}
              type="button"
              role="tab"
              aria-selected={activo}
              onClick={() => elegirGrupo(g.id)}
              className={`lm-card flex items-center gap-3 px-3 py-2.5 text-left transition ${
                activo ? "border-accent bg-accent/10 shadow-paper-sm" : "hover:bg-surface-hover"
              }`}
            >
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ${
                  activo ? "bg-accent text-white" : "bg-surface-hover text-ink-secondary"
                }`}
              >
                {g.num}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-bold text-ink">
                  <Icon name={g.icon} size={15} weight="bold" />
                  {g.label}
                </span>
                <span className="block truncate text-[11px] text-muted">{g.desc}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Nivel 2: vistas de la etapa (solo si hay más de una) */}
      {grupoActual.subs.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border pb-2" role="tablist" aria-label={grupoActual.label}>
          {grupoActual.subs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={sub === t.id}
              title={t.desc}
              onClick={() => irA(t.id)}
              className={hubTabClass(sub === t.id, "mck-hub-tab-etiquetado flex-col")}
            >
              <Icon name={t.icon} size={22} weight="bold" />
              <span className={HUB_TAB_LABEL}>{t.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Nivel 3: contenido */}
      {sub === "diario" && (
        <>
          <ConciliarWizard
            onCargar={() => setCargaSignal((n) => n + 1)}
            onEmparejar={() => setSugerenciasSignal((n) => n + 1)}
            onClasificar={() => setPendientesSignal((n) => n + 1)}
            onVerificar={() => irA("balance")}
          />
          <Suspense fallback={<p className="text-sm text-muted">Cargando…</p>}>
            <IngresosEgresosPanel
              abrirPendientesSignal={pendientesSignal}
              abrirCargaSignal={cargaSignal}
              abrirSugerenciasSignal={sugerenciasSignal}
            />
          </Suspense>
        </>
      )}
      {sub === "mayor" && (
        <Suspense fallback={<p className="text-sm text-muted">Cargando…</p>}>
          <MayorCuentasPanel />
        </Suspense>
      )}
      {sub === "rapido" && <VistaSimple />}
      {sub === "plan-cuentas" && <PlanCuentasTab />}
      {sub === "terceros" && <TercerosTab />}
      {sub === "movimientos" && <MovimientosTab />}
      {sub === "libro-diario" && <LibroDiarioTab />}
      {sub === "cuentas-t" && <CuentasTTab />}
      {sub === "balance" && <BalanceTab />}
      {sub === "asiento-manual" && <AsientoManualTab />}
      {sub === "informes" && <InformesTab onVerPendientes={irAPendientes} />}
      {sub === "creditos-adquiridos" && (
        <Suspense fallback={<p className="text-sm text-muted">Cargando…</p>}>
          <CreditosAdquiridosPanel />
        </Suspense>
      )}
    </div>
  );
}

/* ─── Wizard de conciliación (estado por paso, calculado en vivo) ───────── */

type EstadoPaso = "hecho" | "parcial" | "pendiente" | "cargando";

interface ChecklistItemApi {
  id: string;
  cantidad: number;
  severidad: "ok" | "media" | "alta";
  detalle: string;
}

const PASO_ESTILO: Record<EstadoPaso, { dot: string; wrap: string; txt: string }> = {
  hecho: { dot: "bg-emerald-600 text-white", wrap: "border-emerald-600/30 bg-emerald-600/5", txt: "text-emerald-700 dark:text-emerald-400" },
  parcial: { dot: "bg-amber-500 text-white", wrap: "border-amber-600/40 bg-amber-600/10", txt: "text-amber-800 dark:text-amber-300" },
  pendiente: { dot: "bg-danger text-white", wrap: "border-danger/40 bg-danger/10", txt: "text-danger" },
  cargando: { dot: "bg-surface-hover text-muted", wrap: "border-border bg-surface-panel", txt: "text-muted" },
};

/**
 * Los cuatro pasos de la conciliación bancaria de la empresa, con su estado
 * real: (1) ¿hay extracto reciente?, (2) ¿quedan emparejamientos automáticos
 * por confirmar? — se lanza bajo demanda porque el cálculo es pesado —, (3)
 * ¿cuántas líneas del banco siguen sin asiento?, (4) ¿cuadra el balance? Cada
 * paso es un botón que ejecuta la acción en el Diario de abajo: el wizard no
 * duplica nada, solo ordena y enfoca.
 */
function ConciliarWizard({
  onCargar,
  onEmparejar,
  onClasificar,
  onVerificar,
}: {
  onCargar: () => void;
  onEmparejar: () => void;
  onClasificar: () => void;
  onVerificar: () => void;
}) {
  const checkQ = useQuery<{ items: ChecklistItemApi[] }>({
    queryKey: ["contabilidad-checklist"],
    queryFn: () => api.get("/api/contabilidad/checklist"),
    staleTime: 30_000,
  });
  const balQ = useQuery<Balance>({
    queryKey: ["cc-balance", "wizard"],
    queryFn: () => api.get("/api/contabilidad/cc/balance-comprobacion"),
    staleTime: 60_000,
  });
  const items = checkQ.data?.items ?? [];
  const itExtracto = items.find((i) => i.id === "extracto_sin_cargar");
  const itPend = items.find((i) => i.id === "extractos_pendientes");

  const est = (it: ChecklistItemApi | undefined, loading: boolean): EstadoPaso => {
    if (loading) return "cargando";
    if (!it) return "pendiente";
    if (it.severidad === "ok") return "hecho";
    return it.severidad === "alta" ? "pendiente" : "parcial";
  };

  const pasos: { n: number; label: string; estado: EstadoPaso; detalle: string; accion: string; onClick: () => void }[] = [
    {
      n: 1,
      label: "Cargar extracto",
      estado: est(itExtracto, checkQ.isLoading),
      detalle: itExtracto?.detalle ?? "Sube el CSV, Excel o PDF del banco.",
      accion: "Elegir archivo",
      onClick: onCargar,
    },
    {
      n: 2,
      label: "Emparejar automáticamente",
      estado: checkQ.isLoading ? "cargando" : itPend?.severidad === "ok" ? "hecho" : "parcial",
      detalle: "Cruza libro y banco por monto y fecha; tú confirmas en bloque.",
      accion: "Buscar coincidencias",
      onClick: onEmparejar,
    },
    {
      n: 3,
      label: "Clasificar pendientes",
      estado: est(itPend, checkQ.isLoading),
      detalle: itPend?.detalle ?? "Líneas del banco sin asiento.",
      accion: "Abrir bandeja",
      onClick: onClasificar,
    },
    {
      n: 4,
      label: "Verificar balance",
      estado: balQ.isLoading ? "cargando" : balQ.data?.cuadra ? "hecho" : "pendiente",
      detalle: balQ.data
        ? balQ.data.cuadra
          ? `Cuadra: ${formatCop(balQ.data.total_debito)} = ${formatCop(balQ.data.total_credito)}`
          : `No cuadra: ${formatCop(balQ.data.total_debito)} ≠ ${formatCop(balQ.data.total_credito)}`
        : "Débitos = créditos en todo el libro.",
      accion: "Ver balance",
      onClick: onVerificar,
    },
  ];
  const hechos = pasos.filter((p) => p.estado === "hecho").length;

  return (
    <div className="lm-card space-y-2 px-3 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-ink">Conciliación paso a paso</h3>
        <span className="text-xs font-bold text-ink-secondary">{hechos}/{pasos.length} listos</span>
      </div>
      <div className="h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-surface-hover">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(hechos / pasos.length) * 100}%` }} />
      </div>
      <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {pasos.map((p) => {
          const st = PASO_ESTILO[p.estado];
          return (
            <li key={p.n} className={`flex flex-col gap-1.5 rounded-xl border px-3 py-2 ${st.wrap}`}>
              <div className="flex items-center gap-2">
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-extrabold ${st.dot}`}>
                  {p.estado === "hecho" ? "✓" : p.n}
                </span>
                <span className="text-sm font-bold text-ink">{p.label}</span>
              </div>
              <p className={`text-[11px] leading-snug ${st.txt}`}>{p.detalle}</p>
              <button
                type="button"
                onClick={p.onClick}
                className="mt-auto self-start rounded-md border border-border bg-surface-panel px-2 py-1 text-[11px] font-bold text-ink hover:border-accent hover:text-accent"
              >
                {p.accion} →
              </button>
            </li>
          );
        })}
      </ol>
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
        <AddIconButton title="Nueva cuenta" open={showForm} onClick={() => setShowForm((v) => !v)} />
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

type UsuarioLogin = { id: number; nombre: string };

function useUsuariosLogin(enabled: boolean) {
  return useQuery<UsuarioLogin[]>({
    queryKey: ["tickets-usuarios-login"],
    queryFn: () => api.get("/api/tickets/usuarios"),
    enabled,
  });
}

function emptyTerceroForm() {
  return {
    nombre: "",
    tipo: "proveedor" as TipoTercero,
    tipo_persona: "juridica" as TipoPersona,
    identificacion: "",
    telefono: "",
    cuenta_por_pagar_id: "",
    usuario_id: "",
    notas: "",
  };
}

function TercerosTab() {
  const qc = useQueryClient();
  const terceros = useTerceros();
  const cuentasQ = usePlanCuentas();
  const [showForm, setShowForm] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState(emptyTerceroForm);
  const [historialDe, setHistorialDe] = useState<number | null>(null);
  const usuariosQ = useUsuariosLogin(showForm && form.tipo === "socio");

  const pasivos = (cuentasQ.data?.cuentas ?? []).filter((c) => c.activa && c.tipo === "pasivo");

  const crearMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post("/api/contabilidad/cc/terceros", body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["cc-terceros"] });
      setShowForm(false);
      setForm(emptyTerceroForm());
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
        <AddIconButton title="Nuevo tercero" open={showForm} onClick={() => setShowForm((v) => !v)} />
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
              tipo_persona: form.tipo_persona,
              identificacion: form.identificacion.trim(),
              telefono: form.telefono.trim(),
              cuenta_por_pagar_id: form.cuenta_por_pagar_id ? Number(form.cuenta_por_pagar_id) : null,
              usuario_id: form.usuario_id ? Number(form.usuario_id) : null,
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
          <Campo label="Naturaleza">
            <div className="flex gap-2 rounded-lg bg-surface p-1">
              {(["natural", "juridica"] as TipoPersona[]).map((tp) => (
                <button
                  key={tp}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, tipo_persona: tp }))}
                  className={`flex-1 rounded-md px-2 py-1.5 text-xs font-bold ${
                    form.tipo_persona === tp ? "bg-accent text-white" : "text-muted"
                  }`}
                >
                  {tp === "natural" ? "Persona natural" : "Persona jurídica"}
                </button>
              ))}
            </div>
          </Campo>
          <Campo label={form.tipo_persona === "natural" ? "Cédula (opcional)" : "NIT (opcional)"}>
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
          {form.tipo === "socio" && (
            <Campo label="Usuario de login (para su Cuenta de Socio privada)">
              <select value={form.usuario_id} onChange={(e) => setForm((f) => ({ ...f, usuario_id: e.target.value }))} className={inputCls}>
                <option value="">Sin vincular todavía</option>
                {(usuariosQ.data ?? []).map((u) => (
                  <option key={u.id} value={u.id}>{u.nombre}</option>
                ))}
              </select>
            </Campo>
          )}
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
                <td className="px-3 py-2 text-muted capitalize">
                  {t.tipo}
                  {t.tipo_persona === "natural" && <span className="ml-1 text-[9px] uppercase text-accent">Natural</span>}
                </td>
                <td className="px-3 py-2 text-muted">{t.identificacion || "—"}</td>
                <td className="px-3 py-2 text-muted">{t.telefono || "—"}</td>
                <td className="px-3 py-2 text-muted">{t.activo ? "Activo" : "Inactivo"}</td>
                <td className="px-3 py-2 text-right">
                  <button type="button" onClick={() => setHistorialDe(t.id)}
                          className="mr-3 text-[10px] font-bold text-accent hover:underline">
                    Historial
                  </button>
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

      {historialDe !== null && (
        <HistorialTercero terceroId={historialDe} onCerrar={() => setHistorialDe(null)} />
      )}
    </div>
  );
}

/* ─── Historial de un tercero ──────────────────────────────────────────────
 *
 * La ficha guarda el ESTADO —que está exento, que es del SIMPLE, a qué cuenta
 * va su gasto—; esto guarda el PORQUÉ y lo que le ha pasado. Es lo que hace
 * falta cuando alguien abre un tercero seis meses después y tiene que decidir
 * si lo que ve sigue vigente.
 *
 * Junta el log propio con lo que ya registran otros módulos —documentos
 * soporte, solicitudes de pago— sin copiarlo: una copia se desactualiza y
 * entonces hay dos versiones de lo que pasó.
 */
interface EventoTercero {
  fecha: string; tipo: string; tipo_label: string; titulo: string;
  detalle: string; referencia: string; monto: number | null; origen: string; por?: string;
}
interface HistorialData {
  tercero: Record<string, unknown> & { nombre: string; identificacion: string };
  perfil_tributario: string[];
  eventos: EventoTercero[];
  total_eventos: number;
}

const COLOR_EVENTO: Record<string, string> = {
  incidente: "border-l-red-500",
  contador: "border-l-amber-500",
  decision: "border-l-accent",
  fiscal: "border-l-emerald-500",
  documento: "border-l-border",
  nota: "border-l-border",
};

function HistorialTercero({ terceroId, onCerrar }: { terceroId: number; onCerrar: () => void }) {
  const qc = useQueryClient();
  const [abierto, setAbierto] = useState<number | null>(null);
  const [nota, setNota] = useState({ titulo: "", detalle: "", tipo: "nota" });

  const hQ = useQuery<HistorialData>({
    queryKey: ["cc-tercero-historial", terceroId],
    queryFn: () => api.get(`/api/contabilidad/cc/terceros/${terceroId}/historial`),
  });
  const agregarMut = useMutation({
    mutationFn: () => api.post(`/api/contabilidad/cc/terceros/${terceroId}/historial`, nota),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["cc-tercero-historial", terceroId] });
      setNota({ titulo: "", detalle: "", tipo: "nota" });
    },
  });
  const h = hQ.data;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div className="lm-card my-8 w-full max-w-3xl p-5">
        <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
          <div className="min-w-0">
            <p className="text-base font-extrabold text-ink">{h?.tercero.nombre ?? "Cargando…"}</p>
            <p className="text-xs text-muted">{h?.tercero.identificacion}</p>
          </div>
          <button type="button" onClick={onCerrar} className="text-sm text-muted hover:text-ink">✕</button>
        </div>

        {h && h.perfil_tributario.length > 0 && (
          <div className="mt-3 rounded-lg border border-border bg-surface px-3 py-2">
            <p className="text-xs font-bold uppercase text-muted">Perfil tributario</p>
            <ul className="mt-1 space-y-0.5">
              {h.perfil_tributario.map((p, i) => (
                <li key={i} className="text-sm text-ink">· {p}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-4 space-y-1.5">
          {hQ.isLoading && <p className="py-6 text-center text-sm text-muted">Cargando el historial…</p>}
          {h?.eventos.length === 0 && (
            <p className="py-6 text-center text-sm text-muted">Todavía no hay nada registrado.</p>
          )}
          {h?.eventos.map((e, i) => (
            <div key={i}
                 className={`border-l-4 ${COLOR_EVENTO[e.tipo] ?? "border-l-border"} rounded-r-lg bg-surface px-3 py-2`}>
              <button type="button" onClick={() => setAbierto(abierto === i ? null : i)}
                      className="flex w-full flex-wrap items-baseline gap-x-2 text-left">
                <span className="font-mono text-xs tabular-nums text-muted">{e.fecha}</span>
                <span className="text-[10px] font-bold uppercase text-muted">{e.tipo_label}</span>
                <span className="min-w-0 flex-1 text-sm font-bold text-ink">{e.titulo}</span>
                {e.monto ? <span className="text-sm font-bold tabular-nums text-ink">{formatCop(e.monto)}</span> : null}
              </button>
              {abierto === i && (e.detalle || e.referencia) && (
                <div className="mt-1.5 border-t border-border/50 pt-1.5">
                  {e.detalle && <p className="text-sm leading-snug text-muted">{e.detalle}</p>}
                  {e.referencia && <p className="mt-1 font-mono text-[10px] text-muted">{e.referencia}</p>}
                  {e.por && <p className="mt-0.5 text-[10px] text-muted">registrado por {e.por}</p>}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-4 space-y-2 rounded-lg border border-dashed border-border p-3">
          <p className="text-xs font-bold uppercase text-muted">Anotar algo</p>
          <div className="flex flex-wrap gap-2">
            <select value={nota.tipo} onChange={(e) => setNota({ ...nota, tipo: e.target.value })}
                    className="rounded border border-border bg-surface-input px-2 py-1 text-sm text-ink">
              <option value="nota">Nota</option>
              <option value="decision">Decisión</option>
              <option value="contador">Indicación del contador</option>
              <option value="incidente">Incidente</option>
              <option value="fiscal">Cambio de perfil tributario</option>
            </select>
            <input value={nota.titulo} onChange={(e) => setNota({ ...nota, titulo: e.target.value })}
                   placeholder="Qué pasó, en una línea"
                   className="min-w-[14rem] flex-1 rounded border border-border bg-surface-input px-2 py-1 text-sm text-ink" />
          </div>
          <textarea value={nota.detalle} onChange={(e) => setNota({ ...nota, detalle: e.target.value })}
                    placeholder="El porqué, para quien lo lea dentro de seis meses" rows={2}
                    className="w-full rounded border border-border bg-surface-input px-2 py-1 text-sm text-ink" />
          <button type="button" disabled={!nota.titulo.trim() || agregarMut.isPending}
                  onClick={() => agregarMut.mutate()}
                  className="rounded-lg bg-accent px-3 py-1.5 text-sm font-bold text-white disabled:opacity-40">
            Anotar
          </button>
          <p className="text-[10px] text-muted">
            El historial no se edita ni se borra: uno que se puede cambiar no sirve para responder qué pasó.
          </p>
        </div>
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

/* ─── Libro Diario ─────────────────────────────────────────────────────────
 *
 * El Mayor responde «cómo se movió esta cuenta»; el Diario responde «qué pasó
 * ese día»: cada asiento completo, con el código y el NOMBRE de cada cuenta, el
 * débito y el crédito. Antes había que abrir asiento por asiento desde la lista
 * de movimientos, y esta es la vista que el contador espera recorrer de corrido.
 *
 * Va en orden ascendente —del más viejo al más nuevo, como se lleva un diario—
 * al revés que la lista de movimientos, donde se busca lo que acaba de pasar.
 */
interface LineaDiario {
  cuenta_codigo: string; cuenta_nombre: string; cuenta_tipo: string;
  debito: number; credito: number; descripcion: string; tercero_nombre: string | null;
}
interface AsientoDiario {
  id: number; fecha: string; concepto: string; referencia: string;
  tipo_origen: string; estado: string;
  tercero: { id: number; nombre: string; identificacion: string } | null;
  lineas: LineaDiario[]; debito: number; credito: number; cuadra: boolean;
}
interface Diario {
  asientos: AsientoDiario[]; total_asientos: number; hay_mas: boolean;
  total_debito: number; total_credito: number; cuadra: boolean; descuadrados: number[];
}

function LibroDiarioTab() {
  const hoy = new Date().toISOString().slice(0, 10);
  const mes = hoy.slice(0, 8) + "01";
  const [desde, setDesde] = useState(mes);
  const [hasta, setHasta] = useState(hoy);
  const [q, setQ] = useState("");
  const [cuenta, setCuenta] = useState("");
  const [limit, setLimit] = useState(100);

  const dQ = useQuery<Diario>({
    queryKey: ["cc-libro-diario", desde, hasta, q, cuenta, limit],
    queryFn: () => api.get(
      `/api/contabilidad/cc/diario?desde=${desde}&hasta=${hasta}&limit=${limit}` +
      `${q ? `&q=${encodeURIComponent(q)}` : ""}${cuenta ? `&cuenta=${encodeURIComponent(cuenta)}` : ""}`),
  });
  const d = dQ.data;

  return (
    <div className="space-y-3">
      <div className="lm-card flex flex-wrap items-end gap-2 p-3">
        <label className="text-xs font-bold text-muted">Desde
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)}
                 className="mt-0.5 block rounded border border-border bg-surface-input px-2 py-1 text-sm text-ink" /></label>
        <label className="text-xs font-bold text-muted">Hasta
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)}
                 className="mt-0.5 block rounded border border-border bg-surface-input px-2 py-1 text-sm text-ink" /></label>
        <label className="text-xs font-bold text-muted">Cuenta
          <input value={cuenta} onChange={(e) => setCuenta(e.target.value)} placeholder="1110"
                 className="mt-0.5 block w-24 rounded border border-border bg-surface-input px-2 py-1 font-mono text-sm text-ink" /></label>
        <label className="flex-1 text-xs font-bold text-muted">Buscar
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="concepto o referencia…"
                 className="mt-0.5 block w-full rounded border border-border bg-surface-input px-2 py-1 text-sm text-ink" /></label>
        <a href={`/api/contabilidad/cc/diario?formato=csv&desde=${desde}&hasta=${hasta}&limit=1000`}
           className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-ink hover:border-accent">
          Descargar CSV
        </a>
      </div>

      {d && (
        <div className="lm-card flex flex-wrap items-center gap-4 px-3 py-2 text-sm">
          <span className="text-muted">{d.total_asientos} asientos</span>
          <span className="text-ink">Débitos <b className="tabular-nums">{formatCop(d.total_debito)}</b></span>
          <span className="text-ink">Créditos <b className="tabular-nums">{formatCop(d.total_credito)}</b></span>
          <span className={d.cuadra ? "font-bold text-emerald-600" : "font-bold text-red-600"}>
            {d.cuadra ? "✓ cuadra" : `✗ descuadre de ${formatCop(Math.abs(d.total_debito - d.total_credito))}`}
          </span>
          {d.descuadrados.length > 0 && (
            <span className="font-bold text-red-600">asientos descuadrados: {d.descuadrados.join(", ")}</span>
          )}
        </div>
      )}

      {dQ.isLoading && <p className="px-3 py-6 text-sm text-muted">Cargando el diario…</p>}
      {d?.asientos.length === 0 && (
        <p className="lm-card px-4 py-8 text-center text-sm text-muted">No hay asientos en ese rango.</p>
      )}

      <div className="space-y-2">
        {d?.asientos.map((a) => (
          <div key={a.id} className={`lm-card overflow-hidden ${a.estado === "anulado" ? "opacity-60" : ""}`}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border bg-surface px-3 py-1.5">
              <span className="font-mono text-sm font-bold text-accent">#{a.id}</span>
              <span className="font-mono text-sm tabular-nums text-ink">{a.fecha}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">{a.concepto}</span>
              {a.tercero && <span className="text-xs text-muted">{a.tercero.nombre}</span>}
              {a.referencia && <span className="font-mono text-[10px] text-muted">{a.referencia}</span>}
              {!a.cuadra && <span className="text-xs font-bold text-red-600">no cuadra</span>}
              {a.estado === "anulado" && <span className="text-xs font-bold text-red-600">ANULADO</span>}
            </div>
            <table className="min-w-full text-sm">
              <tbody>
                {a.lineas.map((l, i) => (
                  <tr key={i} className="border-t border-border/30">
                    <td className="w-24 px-3 py-1 font-mono font-bold tabular-nums text-ink">{l.cuenta_codigo}</td>
                    <td className="px-2 py-1 text-ink">
                      {l.cuenta_nombre}
                      {l.descripcion && <span className="block text-xs text-muted">{l.descripcion}</span>}
                    </td>
                    <td className="w-28 px-2 py-1 text-right tabular-nums text-ink">
                      {l.debito ? formatCop(l.debito) : ""}
                    </td>
                    <td className="w-28 px-3 py-1 text-right tabular-nums text-ink">
                      {l.credito ? formatCop(l.credito) : ""}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-border bg-surface/60 text-xs font-bold">
                  <td className="px-3 py-1" colSpan={2} />
                  <td className="px-2 py-1 text-right tabular-nums text-ink">{formatCop(a.debito)}</td>
                  <td className="px-3 py-1 text-right tabular-nums text-ink">{formatCop(a.credito)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {d?.hay_mas && (
        <button type="button" onClick={() => setLimit((n) => n + 100)}
                className="w-full rounded-lg border border-border py-2 text-sm font-bold text-ink hover:border-accent">
          Ver más asientos ({d.total_asientos - d.asientos.length} restantes)
        </button>
      )}
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

interface InformesResumen {
  prestamos: {
    recibidos: { cantidad: number; total: number; terceros: { tercero_id: number; nombre: string; saldo: number }[] };
    otorgados: { cantidad: number; total: number; terceros: { tercero_id: number; nombre: string; saldo: number }[] };
  };
  balance: { cuadra: boolean; total_debito: number; total_credito: number; cuentas_con_movimiento: number };
  pendientes_por_clasificar: number;
}

function InfoKpi({ label, value, accent, warn }: { label: string; value: string; accent?: boolean; warn?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-surface-panel px-3 py-3">
      <p className="text-[10px] font-bold uppercase text-muted">{label}</p>
      <p
        className={`mt-1 text-lg font-extrabold tabular-nums ${
          warn ? "text-danger" : accent ? "text-accent" : "text-ink"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function InformesTab({ onVerPendientes }: { onVerPendientes: () => void }) {
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const params = new URLSearchParams();
  if (desde) params.set("desde", desde);
  if (hasta) params.set("hasta", hasta);

  const infQ = useQuery<InformesResumen>({
    queryKey: ["cc-informes", desde, hasta],
    queryFn: () => api.get(`/api/contabilidad/cc/informes?${params.toString()}`),
  });
  const r = infQ.data;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        Preguntas que responde este libro: cuántos préstamos hay vigentes, si el balance cuadra, y
        cuántos movimientos del banco todavía no se han contabilizado.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Campo label="Balance desde (opcional)">
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={inputCls} />
        </Campo>
        <Campo label="Balance hasta (opcional)">
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={inputCls} />
        </Campo>
      </div>

      {infQ.isLoading && <p className="text-xs text-muted">Calculando…</p>}
      {r && (
        <>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <InfoKpi
              label="Préstamos recibidos vigentes"
              value={`${r.prestamos.recibidos.cantidad} · ${formatCop(r.prestamos.recibidos.total)}`}
            />
            <InfoKpi
              label="Préstamos otorgados vigentes"
              value={`${r.prestamos.otorgados.cantidad} · ${formatCop(r.prestamos.otorgados.total)}`}
            />
            <InfoKpi
              label="Balance de comprobación"
              value={r.balance.cuadra ? "Cuadra ✓" : "No cuadra ✗"}
              warn={!r.balance.cuadra}
              accent={r.balance.cuadra}
            />
            <InfoKpi
              label="Movimientos bancarios sin contabilizar"
              value={String(r.pendientes_por_clasificar)}
              warn={r.pendientes_por_clasificar > 0}
            />
          </div>

          {r.pendientes_por_clasificar > 0 && (
            <button
              type="button"
              onClick={onVerPendientes}
              className="rounded-lg border-2 border-amber-600 bg-amber-600/10 px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-600/20"
            >
              Ir a clasificarlos en Diario y conciliación →
            </button>
          )}

          {(r.prestamos.recibidos.terceros.length > 0 || r.prestamos.otorgados.terceros.length > 0) && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-[11px] font-bold uppercase text-muted">Le debemos a…</p>
                <ul className="space-y-1 text-xs">
                  {r.prestamos.recibidos.terceros.map((t) => (
                    <li key={t.tercero_id} className="flex justify-between rounded-lg border border-border px-2 py-1.5">
                      <span className="text-ink">{t.nombre}</span>
                      <span className="font-bold tabular-nums text-ink">{formatCop(t.saldo)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-1 text-[11px] font-bold uppercase text-muted">Nos deben…</p>
                <ul className="space-y-1 text-xs">
                  {r.prestamos.otorgados.terceros.map((t) => (
                    <li key={t.tercero_id} className="flex justify-between rounded-lg border border-border px-2 py-1.5">
                      <span className="text-ink">{t.nombre}</span>
                      <span className="font-bold tabular-nums text-ink">{formatCop(t.saldo)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
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
