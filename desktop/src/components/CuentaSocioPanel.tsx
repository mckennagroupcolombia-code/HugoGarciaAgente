import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import ComprobanteWidget from "./ComprobanteWidget";
import { useAppStore } from "../stores/app";

type Tercero = { id: number; nombre: string; tipo: string; activo: number };
type Movimiento = { id: number; fecha: string; concepto: string; tipo_origen: string; referencia: string };
type SaldoCuenta = { cuenta_id: number; codigo: string; nombre: string; tipo: string; saldo: number };
type Saldo = { tercero: Tercero; cuentas: SaldoCuenta[]; saldo_por_pagar: number };
type GastoPersonal = {
  id: number;
  tercero_id: number;
  fecha: string;
  categoria: string;
  descripcion: string;
  monto: number;
  soporte_path?: string;
  soporte_nombre?: string;
};
type CuentaSocio = { saldo: Saldo; movimientos: Movimiento[]; gastos_personales: GastoPersonal[] };
type MiTercero = { tercero: Tercero | null; es_admin: boolean };

const CATEGORIAS_SUGERIDAS = [
  "Vivienda",
  "Transporte",
  "Alimentación",
  "Salud",
  "Educación",
  "Ocio",
  "Otro",
];

function formatCop(n: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n || 0);
}

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

const inputMini =
  "rounded-lg border-2 border-border bg-surface-panel px-2 py-1.5 text-xs text-ink outline-none focus:border-accent";

/**
 * Cuenta de Socio: en un solo lugar, la relación financiera del socio con
 * McKenna (saldos y movimientos, que ya vivían dispersos entre Préstamos,
 * Diario y Movimientos) y su registro de gastos personales — estos últimos NO
 * pasan por partida doble y son privados: cada socio ve solo los suyos (el
 * backend lo valida, no basta con ocultarlos aquí).
 */
export default function CuentaSocioPanel() {
  const qc = useQueryClient();
  const bootTerceroId = useAppStore((s) => s.libroMayorBootTerceroId);
  const setBootTerceroId = useAppStore((s) => s.setLibroMayorBootTerceroId);
  const [terceroId, setTerceroId] = useState<number | null>(null);
  const [gastoForm, setGastoForm] = useState({ fecha: hoy(), categoria: "", descripcion: "", monto: "" });
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  const miTerceroQ = useQuery<MiTercero>({
    queryKey: ["cc-mi-tercero"],
    queryFn: () => api.get("/api/contabilidad/cc/mi-tercero"),
  });

  const esAdmin = miTerceroQ.data?.es_admin ?? false;

  const sociosQ = useQuery<{ terceros: Tercero[] }>({
    queryKey: ["cc-terceros-socios"],
    queryFn: () => api.get("/api/contabilidad/cc/terceros?activos=1&tipo=socio"),
    enabled: esAdmin,
  });

  useEffect(() => {
    if (bootTerceroId) {
      setTerceroId(bootTerceroId);
      setBootTerceroId(null);
      return;
    }
    if (miTerceroQ.data?.tercero && terceroId == null) {
      setTerceroId(miTerceroQ.data.tercero.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootTerceroId, miTerceroQ.data]);

  const cuentaQ = useQuery<CuentaSocio>({
    queryKey: ["cc-cuenta-socio", terceroId],
    queryFn: () => api.get(`/api/contabilidad/cc/terceros/${terceroId}/cuenta-socio`),
    enabled: Boolean(terceroId),
  });

  const gastoMut = useMutation({
    mutationFn: () =>
      api.post<{ error?: string } & GastoPersonal>("/api/contabilidad/cc/gastos-personales", {
        tercero_id: terceroId,
        fecha: gastoForm.fecha,
        categoria: gastoForm.categoria.trim(),
        descripcion: gastoForm.descripcion.trim(),
        monto: parseFloat(gastoForm.monto) || 0,
      }),
    onSuccess: (r) => {
      if (r.error) {
        setMsg({ tipo: "error", texto: r.error });
        return;
      }
      setMsg({ tipo: "ok", texto: "Gasto registrado" });
      setGastoForm({ fecha: hoy(), categoria: "", descripcion: "", monto: "" });
      void qc.invalidateQueries({ queryKey: ["cc-cuenta-socio", terceroId] });
    },
    onError: (e: unknown) => setMsg({ tipo: "error", texto: (e as Error).message || "No se pudo registrar" }),
  });

  const borrarGastoMut = useMutation({
    mutationFn: (id: number) => api.delete(`/api/contabilidad/cc/gastos-personales/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["cc-cuenta-socio", terceroId] }),
  });

  if (miTerceroQ.isLoading) return <p className="text-sm text-muted">Cargando…</p>;

  if (!esAdmin && !miTerceroQ.data?.tercero) {
    return (
      <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
        Tu usuario no está vinculado a ningún socio todavía — pide que te vinculen desde Libro
        Mayor → Terceros (campo «Usuario de login»).
      </p>
    );
  }

  const cuenta = cuentaQ.data;

  return (
    <div className="space-y-4">
      {esAdmin && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-ink-secondary">Ver cuenta de:</span>
          <select
            value={terceroId ?? ""}
            onChange={(e) => setTerceroId(e.target.value ? Number(e.target.value) : null)}
            className="rounded-lg border-2 border-border bg-surface-panel px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
          >
            <option value="">Selecciona un socio…</option>
            {(sociosQ.data?.terceros ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </div>
      )}

      {!terceroId && <p className="text-sm text-muted">Selecciona un socio para ver su cuenta.</p>}
      {terceroId && cuentaQ.isLoading && <p className="text-sm text-muted">Cargando cuenta…</p>}
      {terceroId && cuentaQ.isError && (
        <p className="text-sm font-semibold text-danger">
          {(cuentaQ.error as Error).message || "No se pudo cargar esta cuenta"}
        </p>
      )}

      {cuenta && (
        <>
          <div>
            <h3 className="text-sm font-bold text-ink">
              {cuenta.saldo.tercero.nombre} — relación con McKenna
            </h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {cuenta.saldo.cuentas.length === 0 && (
                <p className="text-xs text-muted">Sin saldos pendientes con la empresa.</p>
              )}
              {cuenta.saldo.cuentas.map((c) => (
                <div key={c.cuenta_id} className="rounded-xl border border-border bg-surface-panel px-3 py-2">
                  <p className="text-[10px] font-bold uppercase text-muted">
                    {c.codigo} · {c.nombre}
                  </p>
                  <p className="mt-0.5 text-sm font-extrabold tabular-nums text-ink">{formatCop(c.saldo)}</p>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">
              Historial con McKenna ({cuenta.movimientos.length})
            </h4>
            <div className="max-h-64 overflow-auto rounded-xl border border-border">
              <table className="min-w-full text-left text-xs">
                <thead className="border-b border-border bg-surface text-[10px] uppercase text-muted">
                  <tr>
                    <th className="px-3 py-2 font-bold">Fecha</th>
                    <th className="px-3 py-2 font-bold">Concepto</th>
                    <th className="px-3 py-2 font-bold">Referencia</th>
                  </tr>
                </thead>
                <tbody>
                  {cuenta.movimientos.map((m) => (
                    <tr key={m.id} className="border-t border-border/50">
                      <td className="px-3 py-1.5 tabular-nums text-ink">{m.fecha}</td>
                      <td className="px-3 py-1.5 text-ink">{m.concepto}</td>
                      <td className="px-3 py-1.5 text-muted">{m.referencia || "—"}</td>
                    </tr>
                  ))}
                  {cuenta.movimientos.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-3 py-4 text-muted">
                        Sin movimientos con la empresa.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-accent/30 bg-accent/5 p-3">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wide text-accent">
                Gastos personales (privado)
              </h4>
              <p className="text-[11px] text-muted">
                Dinero propio, sin relación con McKenna — no entra a la contabilidad de la empresa
                ni al balance. Solo lo ves tú (y el administrador).
              </p>
            </div>

            <form
              className="grid gap-2 sm:grid-cols-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!(parseFloat(gastoForm.monto) > 0)) {
                  setMsg({ tipo: "error", texto: "Ingresa un monto válido" });
                  return;
                }
                gastoMut.mutate();
              }}
            >
              <input
                type="date"
                required
                value={gastoForm.fecha}
                onChange={(e) => setGastoForm((f) => ({ ...f, fecha: e.target.value }))}
                className={inputMini}
              />
              <input
                list="categorias-gasto-personal"
                placeholder="Categoría"
                value={gastoForm.categoria}
                onChange={(e) => setGastoForm((f) => ({ ...f, categoria: e.target.value }))}
                className={inputMini}
              />
              <input
                placeholder="Descripción"
                value={gastoForm.descripcion}
                onChange={(e) => setGastoForm((f) => ({ ...f, descripcion: e.target.value }))}
                className={inputMini}
              />
              <div className="flex gap-1">
                <input
                  type="number"
                  min="0"
                  step="1000"
                  required
                  placeholder="Monto"
                  value={gastoForm.monto}
                  onChange={(e) => setGastoForm((f) => ({ ...f, monto: e.target.value }))}
                  className={`w-full ${inputMini}`}
                />
                <button
                  type="submit"
                  disabled={gastoMut.isPending}
                  className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
                >
                  {gastoMut.isPending ? "…" : "Agregar"}
                </button>
              </div>
              <datalist id="categorias-gasto-personal">
                {CATEGORIAS_SUGERIDAS.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </form>

            {msg && (
              <p className={`text-xs font-semibold ${msg.tipo === "error" ? "text-danger" : "text-emerald-600"}`}>
                {msg.texto}
              </p>
            )}

            <div className="space-y-1.5">
              {cuenta.gastos_personales.map((g) => (
                <div
                  key={g.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">
                      {g.categoria || "Sin categoría"}
                      {g.descripcion ? ` · ${g.descripcion}` : ""}
                    </p>
                    <p className="text-muted">{g.fecha}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-bold tabular-nums text-ink">{formatCop(g.monto)}</span>
                    <ComprobanteWidget
                      uploadUrl={`/api/contabilidad/cc/gastos-personales/${g.id}/comprobante`}
                      viewUrl={`/api/contabilidad/cc/gastos-personales/${g.id}/comprobante`}
                      deleteUrl={`/api/contabilidad/cc/gastos-personales/${g.id}/comprobante`}
                      soportePath={g.soporte_path}
                      soporteNombre={g.soporte_nombre}
                      onUpdated={() => void qc.invalidateQueries({ queryKey: ["cc-cuenta-socio", terceroId] })}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm("¿Eliminar este gasto personal?")) borrarGastoMut.mutate(g.id);
                      }}
                      className="font-bold text-danger hover:underline"
                    >
                      Borrar
                    </button>
                  </div>
                </div>
              ))}
              {cuenta.gastos_personales.length === 0 && (
                <p className="text-xs text-muted">Sin gastos personales registrados.</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
