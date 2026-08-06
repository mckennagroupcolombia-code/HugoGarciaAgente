import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";

type ImpuestoPago = {
  id: string;
  tipo: string;
  periodo: string;
  fecha_pago: string;
  monto: number;
  entidad: string;
  referencia: string;
  notas: string;
  creado_en?: string;
};

const TIPOS = [
  "IVA",
  "Retención en la fuente",
  "ReteIVA",
  "ICA",
  "ReteICA",
  "Autorretención",
  "Predial",
  "Industria y comercio",
  "Aportes / parafiscales",
  "Otro",
] as const;

function formatCop(n: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n || 0);
}

/**
 * Registro de pagos de impuestos / obligaciones tributarias.
 */
export default function ImpuestosPanel() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    tipo: "IVA",
    periodo: "",
    fecha_pago: new Date().toISOString().slice(0, 10),
    monto: "",
    entidad: "DIAN",
    referencia: "",
    notas: "",
  });
  const [msg, setMsg] = useState<string | null>(null);

  const listQ = useQuery<{ pagos: ImpuestoPago[] }>({
    queryKey: ["impuestos-pagos"],
    queryFn: () => api.get("/api/impuestos/pagos"),
  });

  const crearMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ ok?: boolean; pago?: ImpuestoPago }>("/api/impuestos/pagos", body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["impuestos-pagos"] });
      setShowForm(false);
      setMsg("Pago registrado");
      setForm((f) => ({ ...f, monto: "", referencia: "", notas: "", periodo: "" }));
    },
    onError: (e) => setMsg((e as Error).message || "No se pudo guardar"),
  });

  const borrarMut = useMutation({
    mutationFn: (id: string) => api.delete<{ ok?: boolean }>(`/api/impuestos/pagos/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["impuestos-pagos"] }),
  });

  const pagos = listQ.data?.pagos ?? [];
  const totalMes = pagos
    .filter((p) => (p.fecha_pago || "").startsWith(new Date().toISOString().slice(0, 7)))
    .reduce((a, p) => a + (Number(p.monto) || 0), 0);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-ink">Pagos de impuestos</h2>
          <p className="mt-1 text-xs text-muted">
            Bitácora de IVA, retenciones, ICA y otras obligaciones. Útil para control interno y
            cruces con contabilidad.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setMsg(null);
            setShowForm((v) => !v);
          }}
          className="rounded-lg bg-accent px-3 py-2 text-xs font-bold text-white hover:bg-accent-hover"
        >
          {showForm ? "Cancelar" : "+ Registrar pago"}
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-surface-panel px-3 py-3">
          <p className="text-[10px] font-bold uppercase text-muted">Registros</p>
          <p className="mt-1 text-xl font-extrabold tabular-nums text-ink">{pagos.length}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface-panel px-3 py-3">
          <p className="text-[10px] font-bold uppercase text-muted">Pagado este mes</p>
          <p className="mt-1 text-xl font-extrabold tabular-nums text-accent">
            {formatCop(totalMes)}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface-panel px-3 py-3">
          <p className="text-[10px] font-bold uppercase text-muted">Entidades</p>
          <p className="mt-1 text-sm font-bold text-ink">
            {[...new Set(pagos.map((p) => p.entidad).filter(Boolean))].slice(0, 4).join(" · ") ||
              "—"}
          </p>
        </div>
      </div>

      {showForm && (
        <form
          className="space-y-3 rounded-xl border border-border bg-surface-panel p-4"
          onSubmit={(e) => {
            e.preventDefault();
            const monto = parseFloat(form.monto);
            if (!(monto > 0)) {
              setMsg("Ingresa un monto válido");
              return;
            }
            crearMut.mutate({
              tipo: form.tipo,
              periodo: form.periodo.trim(),
              fecha_pago: form.fecha_pago,
              monto,
              entidad: form.entidad.trim() || "DIAN",
              referencia: form.referencia.trim(),
              notas: form.notas.trim(),
            });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs">
              <span className="font-bold text-muted">Tipo</span>
              <select
                value={form.tipo}
                onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-ink"
              >
                {TIPOS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs">
              <span className="font-bold text-muted">Periodo gravable</span>
              <input
                value={form.periodo}
                onChange={(e) => setForm((f) => ({ ...f, periodo: e.target.value }))}
                placeholder="Ej. 2026-Q1 · Marzo 2026"
                className="mt-1 w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-ink"
              />
            </label>
            <label className="block text-xs">
              <span className="font-bold text-muted">Fecha de pago</span>
              <input
                type="date"
                value={form.fecha_pago}
                onChange={(e) => setForm((f) => ({ ...f, fecha_pago: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-ink"
                required
              />
            </label>
            <label className="block text-xs">
              <span className="font-bold text-muted">Monto (COP)</span>
              <input
                type="number"
                min="0"
                step="1000"
                value={form.monto}
                onChange={(e) => setForm((f) => ({ ...f, monto: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-ink"
                required
              />
            </label>
            <label className="block text-xs">
              <span className="font-bold text-muted">Entidad</span>
              <input
                value={form.entidad}
                onChange={(e) => setForm((f) => ({ ...f, entidad: e.target.value }))}
                placeholder="DIAN, Alcaldía…"
                className="mt-1 w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-ink"
              />
            </label>
            <label className="block text-xs">
              <span className="font-bold text-muted">Referencia / formulario</span>
              <input
                value={form.referencia}
                onChange={(e) => setForm((f) => ({ ...f, referencia: e.target.value }))}
                placeholder="Nº formulario o radicado"
                className="mt-1 w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-ink"
              />
            </label>
          </div>
          <label className="block text-xs">
            <span className="font-bold text-muted">Notas</span>
            <textarea
              value={form.notas}
              onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))}
              rows={2}
              className="mt-1 w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-ink"
            />
          </label>
          <button
            type="submit"
            disabled={crearMut.isPending}
            className="rounded-lg bg-accent px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
          >
            {crearMut.isPending ? "Guardando…" : "Guardar pago"}
          </button>
        </form>
      )}

      {msg && <p className="text-xs font-semibold text-emerald-600">{msg}</p>}
      {listQ.isError && (
        <p className="text-xs text-danger">
          {(listQ.error as Error).message || "No se pudo cargar"}
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-border">
        <table className="min-w-full text-left text-xs">
          <thead className="border-b border-border bg-surface text-[10px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2 font-bold">Fecha</th>
              <th className="px-3 py-2 font-bold">Tipo</th>
              <th className="px-3 py-2 font-bold">Periodo</th>
              <th className="px-3 py-2 font-bold">Entidad</th>
              <th className="px-3 py-2 font-bold">Monto</th>
              <th className="px-3 py-2 font-bold" />
            </tr>
          </thead>
          <tbody>
            {listQ.isLoading && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-muted">
                  Cargando…
                </td>
              </tr>
            )}
            {!listQ.isLoading && pagos.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-muted">
                  Aún no hay pagos registrados.
                </td>
              </tr>
            )}
            {pagos.map((p) => (
              <tr key={p.id} className="border-t border-border/60">
                <td className="px-3 py-2 tabular-nums text-ink">{p.fecha_pago}</td>
                <td className="px-3 py-2 font-semibold text-ink">{p.tipo}</td>
                <td className="px-3 py-2 text-muted">{p.periodo || "—"}</td>
                <td className="px-3 py-2 text-muted">{p.entidad || "—"}</td>
                <td className="px-3 py-2 font-bold tabular-nums text-ink">
                  {formatCop(Number(p.monto) || 0)}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    disabled={borrarMut.isPending}
                    onClick={() => {
                      if (confirm("¿Eliminar este registro?")) borrarMut.mutate(p.id);
                    }}
                    className="text-[10px] font-bold text-danger hover:underline"
                  >
                    Borrar
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
