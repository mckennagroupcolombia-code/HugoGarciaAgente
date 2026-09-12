import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

/**
 * Bandeja de movimientos de banco sin clasificar, con la propuesta del
 * clasificador al lado de cada línea.
 *
 * Antes esto era una lista plana: 185 líneas iguales, y el operador tenía que
 * decidir cuenta y tercero de cada una desde cero. La mayoría no necesitaba
 * criterio —costos bancarios, 4x1000, intereses de ahorros, pagos a proveedores
 * identificables por el nombre— y esas se aplican en lote. Lo que queda es lo
 * que de verdad requiere a alguien: quién es «PAGO QR MARIA», si un giro a un
 * socio fue reintegro o servicios, si una entrada es venta o préstamo.
 */

type Propuesta = {
  extracto_mov_id: number;
  fecha: string;
  descripcion: string;
  monto: number;
  tipo: "debito" | "credito";
  cuenta: string | null;
  concepto: string;
  confianza: "alta" | "revisar";
  nota: string;
  tercero: { id: number; nombre: string } | null;
};

type Grupo = {
  concepto: string;
  cuenta: string | null;
  confianza: string;
  lineas: number;
  monto: number;
  nota: string;
};

type Resumen = {
  total: number;
  automaticas: number;
  monto_automatico: number;
  para_revisar: number;
  monto_para_revisar: number;
  grupos: Grupo[];
};

const cop = (n: number) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n || 0);

export default function ClasificadorBancoPanel({
  desde,
  hasta,
  onClasificar,
}: {
  desde: string;
  hasta: string;
  /** Abre el formulario manual del panel padre para una línea concreta. */
  onClasificar: (extractoMovId: number) => void;
}) {
  const qc = useQueryClient();
  const [abierto, setAbierto] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  const params = new URLSearchParams({ desde, hasta });

  const resumenQ = useQuery<Resumen>({
    queryKey: ["clasificacion-resumen", desde, hasta],
    queryFn: () => api.get(`/api/contabilidad/extractos/clasificacion?${params}&resumen=1`),
  });

  const propuestasQ = useQuery<{ propuestas: Propuesta[] }>({
    queryKey: ["clasificacion-propuestas", desde, hasta],
    queryFn: () => api.get(`/api/contabilidad/extractos/clasificacion?${params}`),
  });

  const aplicar = useMutation({
    mutationFn: () =>
      api.post("/api/contabilidad/extractos/clasificacion/aplicar", {
        desde,
        hasta,
        simular: false,
      }),
    onSuccess: () => {
      setConfirmando(false);
      void qc.invalidateQueries({ queryKey: ["clasificacion-resumen"] });
      void qc.invalidateQueries({ queryKey: ["clasificacion-propuestas"] });
      void qc.invalidateQueries({ queryKey: ["extractos-pendientes"] });
      void qc.invalidateQueries({ queryKey: ["cc-movimientos"] });
    },
  });

  const porConcepto = useMemo(() => {
    const m = new Map<string, Propuesta[]>();
    for (const p of propuestasQ.data?.propuestas ?? []) {
      if (p.confianza === "alta") continue; // esas van por el botón de lote
      const arr = m.get(p.concepto) ?? [];
      arr.push(p);
      m.set(p.concepto, arr);
    }
    return [...m.entries()].sort(
      (a, b) => b[1].reduce((s, p) => s + p.monto, 0) - a[1].reduce((s, p) => s + p.monto, 0),
    );
  }, [propuestasQ.data]);

  const r = resumenQ.data;

  return (
    <div className="space-y-3">
      {/* ── Resumen ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-surface px-3 py-2">
          <div className="text-[10px] font-bold uppercase text-muted">Sin clasificar</div>
          <div className="text-sm font-bold text-ink">{r?.total ?? "—"} líneas</div>
        </div>
        <div className="rounded-lg border border-emerald-600/40 bg-emerald-500/5 px-3 py-2">
          <div className="text-[10px] font-bold uppercase text-emerald-700">Se aplican solas</div>
          <div className="text-sm font-bold text-emerald-700">
            {r?.automaticas ?? "—"} · {cop(r?.monto_automatico ?? 0)}
          </div>
        </div>
        <div className="rounded-lg border border-amber-600/40 bg-amber-500/5 px-3 py-2">
          <div className="text-[10px] font-bold uppercase text-amber-700">Necesitan criterio</div>
          <div className="text-sm font-bold text-amber-700">
            {r?.para_revisar ?? "—"} · {cop(r?.monto_para_revisar ?? 0)}
          </div>
        </div>
      </div>

      {/* ── Lote automático ─────────────────────────────────────── */}
      {(r?.automaticas ?? 0) > 0 && (
        <div className="rounded-lg border border-emerald-600/40 bg-emerald-500/5 p-3">
          {!confirmando ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-ink">
                <strong>{r!.automaticas} líneas</strong> por {cop(r!.monto_automatico)} tienen una
                cuenta sin ambigüedad: costos bancarios, 4x1000, intereses de ahorros e impuestos, y
                pagos a proveedores que sí están en el libro.
              </p>
              <button
                type="button"
                onClick={() => setConfirmando(true)}
                className="shrink-0 rounded-lg border-2 border-emerald-600 bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white"
              >
                Aplicar las {r!.automaticas}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-ink">
                Se van a crear {r!.automaticas} asientos en el Libro Mayor por {cop(r!.monto_automatico)} y
                se van a vincular esas líneas del extracto. Se puede repetir sin duplicar, pero
                deshacerlo es asiento por asiento.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={aplicar.isPending}
                  onClick={() => aplicar.mutate()}
                  className="rounded-lg border-2 border-emerald-600 bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-60"
                >
                  {aplicar.isPending ? "Aplicando…" : "Sí, aplicar"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmando(false)}
                  className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold text-muted"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
          {aplicar.isError && (
            <p className="mt-2 text-xs text-rose-600">{(aplicar.error as Error).message}</p>
          )}
          {aplicar.isSuccess && (
            <p className="mt-2 text-xs text-emerald-700">
              Listo: {(aplicar.data as { aplicadas: number }).aplicadas} asientos creados.
            </p>
          )}
        </div>
      )}

      {/* ── Lo que necesita criterio, agrupado ──────────────────── */}
      {propuestasQ.isLoading && <p className="text-xs text-muted">Clasificando…</p>}
      {propuestasQ.isError && (
        <p className="text-xs text-rose-600">{(propuestasQ.error as Error).message}</p>
      )}

      {porConcepto.map(([concepto, lineas]) => {
        const total = lineas.reduce((s, p) => s + p.monto, 0);
        const estaAbierto = abierto === concepto;
        return (
          <div key={concepto} className="rounded-lg border border-border bg-surface">
            <button
              type="button"
              onClick={() => setAbierto(estaAbierto ? null : concepto)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
            >
              <div className="min-w-0">
                <div className="text-xs font-bold text-ink">{concepto}</div>
                <div className="text-[11px] text-muted">
                  {lineas.length} {lineas.length === 1 ? "línea" : "líneas"} · {cop(total)}
                </div>
              </div>
              <span className="shrink-0 text-xs text-muted">{estaAbierto ? "▲" : "▼"}</span>
            </button>

            {estaAbierto && (
              <div className="border-t border-border px-3 py-2 space-y-2">
                {lineas[0].nota && (
                  <p className="rounded bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-800">
                    {lineas[0].nota}
                  </p>
                )}
                <ul className="space-y-1">
                  {lineas.map((p) => (
                    <li
                      key={p.extracto_mov_id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded border border-border px-2 py-1.5"
                    >
                      <div className="min-w-0 text-[11px]">
                        <div className="font-semibold text-ink">
                          {p.fecha} · {p.tipo === "credito" ? "Entró" : "Salió"} · {cop(p.monto)}
                          {p.cuenta && (
                            <span className="ml-1.5 rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-bold text-sky-700">
                              sugerida {p.cuenta}
                            </span>
                          )}
                          {p.tercero && (
                            <span className="ml-1.5 rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-bold text-violet-700">
                              {p.tercero.nombre}
                            </span>
                          )}
                        </div>
                        <div className="truncate text-muted" title={p.descripcion}>
                          {p.descripcion || "(sin descripción)"}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onClasificar(p.extracto_mov_id)}
                        className="shrink-0 rounded border-2 border-amber-600 bg-amber-600 px-2 py-0.5 text-[10px] font-bold text-white"
                      >
                        Clasificar
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })}

      {!propuestasQ.isLoading && porConcepto.length === 0 && (r?.automaticas ?? 0) === 0 && (
        <p className="text-xs text-emerald-700">
          Todo lo que llegó en los extractos de este rango ya está clasificado. ✅
        </p>
      )}
    </div>
  );
}
