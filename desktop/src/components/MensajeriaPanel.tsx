import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../api/client";
import ComprobanteWidget from "./ComprobanteWidget";

/**
 * Pagos de mensajería (Interrapidísimo y otras transportadoras).
 *
 * Reemplaza el Excel "ENVIOS INTERRA": un renglón por día (cantidad de envíos,
 * enlace a la factura de guías y valor), los días pendientes se agrupan en un
 * lote, el lote abre su ticket de aprobación y al pagarlo queda con fecha,
 * referencia y comprobante — y entra solo a Ingresos/Egresos.
 */

type Envio = {
  id: number;
  transportadora: string;
  fecha: string;
  cantidad: number;
  enlace: string;
  valor: number;
  nota: string;
  lote_id: number | null;
  estado: "pendiente" | "en_aprobacion" | "pagado";
  fecha_pago?: string | null;
};

type Lote = {
  id: number;
  transportadora: string;
  estado: "solicitado" | "pagado";
  total: number;
  fecha_solicitud: string;
  fecha_pago: string | null;
  banco: string;
  referencia: string;
  notas: string;
  ticket_id: number | null;
  soporte_path?: string;
  soporte_nombre?: string;
  rango: string;
  dias: Envio[];
};

type Resumen = {
  dias_pendientes: number;
  pendiente_por_pagar: number;
  lotes_en_aprobacion: number;
  total_en_aprobacion: number;
  pagado_mes: number;
  envios_mes: number;
  ultimo_pago: { fecha: string; total: number } | null;
};

const TRANSPORTADORAS = ["Interrapidísimo", "Servientrega", "Coordinadora", "Envía", "Otra"];

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

const ESTADO_BADGE: Record<Envio["estado"], { label: string; clase: string }> = {
  pendiente: { label: "Pte. de pago", clase: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  en_aprobacion: { label: "En aprobación", clase: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  pagado: { label: "Cancelado", clase: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
};

export default function MensajeriaPanel() {
  const qc = useQueryClient();
  const [transportadora, setTransportadora] = useState(TRANSPORTADORAS[0]);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seleccion, setSeleccion] = useState<number[]>([]);
  const [showImportar, setShowImportar] = useState(false);
  const [pegado, setPegado] = useState("");
  const [pagando, setPagando] = useState<Lote | null>(null);
  const [formPago, setFormPago] = useState({
    fecha_pago: hoy(),
    banco: "Bancolombia",
    referencia: "",
    monto: "",
    notas: "",
  });
  const [form, setForm] = useState({
    fecha: hoy(),
    cantidad: "",
    enlace: "",
    valor: "",
    nota: "",
  });

  const envQ = useQuery<{ envios: Envio[]; resumen: Resumen }>({
    queryKey: ["mensajeria-envios", transportadora],
    queryFn: () =>
      api.get(`/api/mensajeria/envios?transportadora=${encodeURIComponent(transportadora)}`),
    refetchInterval: 60_000,
  });
  // Rótulos impresos ese día en Atención → Guías de envío: es el conteo real de
  // paquetes que salieron, así no hay que contarlos a mano.
  const rotulosQ = useQuery<{ fecha: string; rotulos: number; copias: number }>({
    queryKey: ["guias-conteo", form.fecha],
    queryFn: () => api.get(`/api/guias/conteo?fecha=${form.fecha}`),
    enabled: Boolean(form.fecha),
  });

  const lotesQ = useQuery<{ lotes: Lote[] }>({
    queryKey: ["mensajeria-lotes"],
    queryFn: () => api.get("/api/mensajeria/lotes"),
  });

  const refrescar = () => {
    void qc.invalidateQueries({ queryKey: ["mensajeria-envios"] });
    void qc.invalidateQueries({ queryKey: ["mensajeria-lotes"] });
  };
  const fallo = (e: unknown) => setError((e as Error).message || "No se pudo completar");

  const guardarMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ ok?: boolean; error?: string }>("/api/mensajeria/envios", body),
    onSuccess: (r) => {
      if (r.error) return setError(r.error);
      setMsg("Día guardado");
      setForm((f) => ({ ...f, cantidad: "", enlace: "", valor: "", nota: "" }));
      refrescar();
    },
    onError: fallo,
  });

  const borrarMut = useMutation({
    mutationFn: (id: number) => api.delete<{ ok?: boolean; error?: string }>(`/api/mensajeria/envios/${id}`),
    onSuccess: (r) => {
      if (r.error) return setError(r.error);
      refrescar();
    },
    onError: fallo,
  });

  const importarMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ ok?: boolean; error?: string; creados?: number; actualizados?: number; lotes_pagados?: number; ignoradas?: string[] }>(
        "/api/mensajeria/importar",
        body,
      ),
    onSuccess: (r) => {
      if (r.error) return setError(r.error);
      setMsg(
        `Importado: ${r.creados ?? 0} días nuevos, ${r.actualizados ?? 0} actualizados` +
          (r.lotes_pagados ? `, ${r.lotes_pagados} pago(s) del histórico` : "") +
          (r.ignoradas?.length ? ` · ${r.ignoradas.length} línea(s) sin fecha ignoradas` : ""),
      );
      setPegado("");
      setShowImportar(false);
      refrescar();
    },
    onError: fallo,
  });

  const loteMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ ok?: boolean; error?: string; lote?: Lote; ticket?: { numero?: string; error?: string } }>(
        "/api/mensajeria/lotes",
        body,
      ),
    onSuccess: (r) => {
      if (r.error) return setError(r.error);
      setSeleccion([]);
      setMsg(
        r.ticket?.numero
          ? `Lote #${r.lote?.id} creado y enviado a aprobación (ticket ${r.ticket.numero})`
          : `Lote #${r.lote?.id} creado` + (r.ticket?.error ? ` — sin ticket: ${r.ticket.error}` : ""),
      );
      refrescar();
    },
    onError: fallo,
  });

  const pagarMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      api.post<{ ok?: boolean; error?: string }>(`/api/mensajeria/lotes/${id}/pagar`, body),
    onSuccess: (r) => {
      if (r.error) return setError(r.error);
      setPagando(null);
      setMsg("Pago registrado — ya aparece en Ingresos / Egresos");
      refrescar();
    },
    onError: fallo,
  });

  const borrarLoteMut = useMutation({
    mutationFn: (id: number) => api.delete<{ ok?: boolean }>(`/api/mensajeria/lotes/${id}`),
    onSuccess: () => {
      setMsg("Lote deshecho — los días vuelven a quedar pendientes");
      refrescar();
    },
    onError: fallo,
  });

  const aprobacionMut = useMutation({
    mutationFn: (id: number) =>
      api.post<{ ok?: boolean; error?: string; numero?: string }>(
        `/api/mensajeria/lotes/${id}/aprobacion`,
        {},
      ),
    onSuccess: (r) => {
      if (r.error) return setError(r.error);
      setMsg(r.numero ? `Ticket de aprobación ${r.numero} creado` : "Solicitud enviada");
      refrescar();
    },
    onError: fallo,
  });

  const envios = envQ.data?.envios ?? [];
  const resumen = envQ.data?.resumen;
  const lotes = lotesQ.data?.lotes ?? [];
  const pendientes = useMemo(
    () => envios.filter((e) => e.estado === "pendiente" && e.valor > 0),
    [envios],
  );
  const totalSeleccion = useMemo(
    () => pendientes.filter((e) => seleccion.includes(e.id)).reduce((a, e) => a + e.valor, 0),
    [pendientes, seleccion],
  );

  const toggle = (id: number) =>
    setSeleccion((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-ink">Pagos de mensajería</h2>
          <p className="mt-1 max-w-2xl text-xs text-muted">
            Un renglón por día: cuántos envíos salieron, el enlace de la factura de guías y el
            valor. Los días pendientes se agrupan en un pago, se envían a aprobación y al
            registrarlos quedan con comprobante — y entran solos a Ingresos / Egresos.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={transportadora}
            onChange={(e) => setTransportadora(e.target.value)}
            className="rounded-lg border border-border bg-surface-input px-2 py-2 text-xs font-semibold text-ink"
          >
            {TRANSPORTADORAS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setShowImportar((v) => !v);
            }}
            className="rounded-lg border border-border px-3 py-2 text-xs font-bold text-ink hover:bg-surface"
          >
            {showImportar ? "Cancelar" : "Importar del Excel"}
          </button>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Kpi titulo="Pendiente por pagar" valor={formatCop(resumen?.pendiente_por_pagar ?? 0)} destacado />
        <Kpi titulo="Días pendientes" valor={String(resumen?.dias_pendientes ?? 0)} />
        <Kpi titulo="En aprobación" valor={formatCop(resumen?.total_en_aprobacion ?? 0)} />
        <Kpi
          titulo="Pagado este mes"
          valor={formatCop(resumen?.pagado_mes ?? 0)}
          pie={`${resumen?.envios_mes ?? 0} envíos`}
        />
      </div>

      {showImportar && (
        <div className="space-y-2 rounded-xl border border-border bg-surface-panel p-4">
          <p className="text-xs text-muted">
            Copia las filas del Excel (FECHA · CANT ENVÍOS · FACTURA GUÍAS · VALOR · ESTADO ·
            FECHA DE PAGO) y pégalas aquí. Los días que ya decían CANCELADO con su fecha de pago
            quedan registrados como pagos del histórico.
          </p>
          <textarea
            value={pegado}
            onChange={(e) => setPegado(e.target.value)}
            rows={6}
            placeholder={"18/08/2026\t2\thttp://inter.la/…\t$ 50.700\tCANCELADO\t19-ago"}
            className="w-full rounded-lg border border-border bg-surface-input px-3 py-2 font-mono text-xs text-ink"
          />
          <button
            type="button"
            disabled={importarMut.isPending || !pegado.trim()}
            onClick={() => importarMut.mutate({ texto: pegado, transportadora })}
            className="rounded-lg bg-accent px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
          >
            {importarMut.isPending ? "Importando…" : "Importar filas"}
          </button>
        </div>
      )}

      <form
        className="grid gap-3 rounded-xl border border-border bg-surface-panel p-4 sm:grid-cols-5"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          setMsg(null);
          guardarMut.mutate({
            fecha: form.fecha,
            transportadora,
            cantidad: Number(form.cantidad || 0),
            enlace: form.enlace.trim(),
            valor: form.valor,
            nota: form.nota.trim(),
          });
        }}
      >
        <Campo label="Fecha">
          <input
            type="date"
            required
            value={form.fecha}
            onChange={(e) => setForm((f) => ({ ...f, fecha: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-border bg-surface-input px-2 py-2 text-sm text-ink"
          />
        </Campo>
        <Campo label="Envíos">
          <input
            type="number"
            min="0"
            value={form.cantidad}
            onChange={(e) => setForm((f) => ({ ...f, cantidad: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-border bg-surface-input px-2 py-2 text-sm text-ink"
          />
          {(rotulosQ.data?.rotulos ?? 0) > 0 &&
            String(rotulosQ.data?.rotulos) !== form.cantidad && (
              <button
                type="button"
                onClick={() =>
                  setForm((f) => ({ ...f, cantidad: String(rotulosQ.data?.rotulos ?? "") }))
                }
                className="mt-1 text-[10px] font-bold text-accent hover:underline"
              >
                {rotulosQ.data?.rotulos} rótulo(s) impresos ese día — usar
              </button>
            )}
        </Campo>
        <Campo label="Factura / guías (enlace)" className="sm:col-span-2">
          <input
            value={form.enlace}
            onChange={(e) => setForm((f) => ({ ...f, enlace: e.target.value }))}
            placeholder="http://inter.la/…"
            className="mt-1 w-full rounded-lg border border-border bg-surface-input px-2 py-2 text-sm text-ink"
          />
        </Campo>
        <Campo label="Valor del día">
          <input
            type="number"
            min="0"
            step="100"
            value={form.valor}
            onChange={(e) => setForm((f) => ({ ...f, valor: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-border bg-surface-input px-2 py-2 text-sm text-ink"
          />
        </Campo>
        <Campo label="Nota (opcional)" className="sm:col-span-4">
          <input
            value={form.nota}
            onChange={(e) => setForm((f) => ({ ...f, nota: e.target.value }))}
            placeholder="domingo · no salen · festivo"
            className="mt-1 w-full rounded-lg border border-border bg-surface-input px-2 py-2 text-sm text-ink"
          />
        </Campo>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={guardarMut.isPending}
            className="w-full rounded-lg bg-accent px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
          >
            {guardarMut.isPending ? "Guardando…" : "Guardar día"}
          </button>
        </div>
      </form>

      {msg && <p className="text-xs font-semibold text-emerald-600">{msg}</p>}
      {error && <p className="text-xs font-semibold text-danger">{error}</p>}

      {seleccion.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/40 bg-accent/5 px-4 py-3">
          <p className="text-xs font-semibold text-ink">
            {seleccion.length} día(s) seleccionados · {formatCop(totalSeleccion)}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSeleccion([])}
              className="rounded-lg border border-border px-3 py-2 text-xs font-bold text-muted"
            >
              Limpiar
            </button>
            <button
              type="button"
              disabled={loteMut.isPending}
              onClick={() => {
                setError(null);
                setMsg(null);
                loteMut.mutate({
                  envio_ids: seleccion,
                  transportadora,
                  solicitar_aprobacion: true,
                });
              }}
              className="rounded-lg bg-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
            >
              {loteMut.isPending ? "Enviando…" : "Solicitar aprobación de pago"}
            </button>
          </div>
        </div>
      )}

      <section className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-muted">Días registrados</h3>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="min-w-full text-left text-xs">
            <thead className="border-b border-border bg-surface text-[10px] uppercase tracking-wide text-muted">
              <tr>
                <th className="w-8 px-2 py-2" />
                <th className="px-3 py-2 font-bold">Fecha</th>
                <th className="px-3 py-2 font-bold">Envíos</th>
                <th className="px-3 py-2 font-bold">Factura guías</th>
                <th className="px-3 py-2 font-bold">Valor</th>
                <th className="px-3 py-2 font-bold">Estado</th>
                <th className="px-3 py-2 font-bold">Pago</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {envQ.isLoading && (
                <tr>
                  <td colSpan={8} className="px-3 py-4 text-muted">
                    Cargando…
                  </td>
                </tr>
              )}
              {!envQ.isLoading && envios.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-4 text-muted">
                    Aún no hay días registrados. Usa «Importar del Excel» para traer el histórico.
                  </td>
                </tr>
              )}
              {envios.map((e) => {
                const badge = ESTADO_BADGE[e.estado];
                const seleccionable = e.estado === "pendiente" && e.valor > 0;
                return (
                  <tr key={e.id} className="border-t border-border/60">
                    <td className="px-2 py-2">
                      {seleccionable && (
                        <input
                          type="checkbox"
                          checked={seleccion.includes(e.id)}
                          onChange={() => toggle(e.id)}
                          aria-label={`Seleccionar ${e.fecha}`}
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums font-semibold text-ink">{e.fecha}</td>
                    <td className="px-3 py-2 tabular-nums text-ink">{e.cantidad || "—"}</td>
                    <td className="max-w-[220px] truncate px-3 py-2">
                      {e.enlace ? (
                        <a
                          href={e.enlace}
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold text-accent hover:underline"
                        >
                          Ver guías
                        </a>
                      ) : (
                        <span className="text-muted">{e.nota || "—"}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-bold tabular-nums text-ink">
                      {e.valor > 0 ? formatCop(e.valor) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.clase}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-muted">
                      {e.fecha_pago || (e.lote_id ? `Lote #${e.lote_id}` : "—")}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {!e.lote_id && (
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm(`¿Borrar el registro del ${e.fecha}?`)) borrarMut.mutate(e.id);
                          }}
                          className="text-[10px] font-bold text-danger hover:underline"
                        >
                          Borrar
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-muted">Pagos</h3>
        {lotes.length === 0 && (
          <p className="rounded-xl border border-border bg-surface-panel px-4 py-3 text-xs text-muted">
            Todavía no hay pagos agrupados.
          </p>
        )}
        <div className="space-y-2">
          {lotes.map((l) => (
            <div key={l.id} className="rounded-xl border border-border bg-surface-panel p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-ink">
                    Lote #{l.id} · {formatCop(l.total)}{" "}
                    <span
                      className={`ml-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        l.estado === "pagado"
                          ? ESTADO_BADGE.pagado.clase
                          : ESTADO_BADGE.en_aprobacion.clase
                      }`}
                    >
                      {l.estado === "pagado" ? "Pagado" : "En aprobación"}
                    </span>
                  </p>
                  <p className="mt-1 text-[11px] text-muted">
                    {l.transportadora} · {l.dias.length} día(s) {l.rango && `(${l.rango})`}
                    {l.fecha_pago && ` · pagado el ${l.fecha_pago}`}
                    {l.banco && ` · ${l.banco}`}
                    {l.referencia && ` · ref. ${l.referencia}`}
                    {l.ticket_id && ` · ticket #${l.ticket_id}`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {l.estado === "solicitado" && (
                    <>
                      {!l.ticket_id && (
                        <button
                          type="button"
                          onClick={() => aprobacionMut.mutate(l.id)}
                          className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold text-ink hover:bg-surface"
                        >
                          Pedir aprobación
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setError(null);
                          setPagando(l);
                          setFormPago((f) => ({ ...f, monto: String(l.total), fecha_pago: hoy() }));
                        }}
                        className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-bold text-white"
                      >
                        Registrar pago
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm("¿Deshacer el lote? Los días vuelven a quedar pendientes."))
                            borrarLoteMut.mutate(l.id);
                        }}
                        className="text-[11px] font-bold text-danger hover:underline"
                      >
                        Deshacer
                      </button>
                    </>
                  )}
                  {l.estado === "pagado" && (
                    <ComprobanteWidget
                      uploadUrl={`/api/mensajeria/lotes/${l.id}/comprobante`}
                      viewUrl={`/api/mensajeria/lotes/${l.id}/comprobante`}
                      deleteUrl={`/api/mensajeria/lotes/${l.id}/comprobante`}
                      soportePath={l.soporte_path || undefined}
                      soporteNombre={l.soporte_nombre || undefined}
                      onUpdated={refrescar}
                    />
                  )}
                </div>
              </div>

              {pagando?.id === l.id && (
                <form
                  className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    pagarMut.mutate({
                      id: l.id,
                      body: {
                        fecha_pago: formPago.fecha_pago,
                        banco: formPago.banco,
                        referencia: formPago.referencia,
                        notas: formPago.notas,
                        monto: formPago.monto === "" ? undefined : Number(formPago.monto),
                      },
                    });
                  }}
                >
                  <Campo label="Fecha de pago">
                    <input
                      type="date"
                      required
                      value={formPago.fecha_pago}
                      onChange={(e) => setFormPago((f) => ({ ...f, fecha_pago: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-border bg-surface-input px-2 py-2 text-sm text-ink"
                    />
                  </Campo>
                  <Campo label="Banco / medio">
                    <input
                      value={formPago.banco}
                      onChange={(e) => setFormPago((f) => ({ ...f, banco: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-border bg-surface-input px-2 py-2 text-sm text-ink"
                    />
                  </Campo>
                  <Campo label="Referencia">
                    <input
                      value={formPago.referencia}
                      onChange={(e) => setFormPago((f) => ({ ...f, referencia: e.target.value }))}
                      placeholder="Nº de transacción"
                      className="mt-1 w-full rounded-lg border border-border bg-surface-input px-2 py-2 text-sm text-ink"
                    />
                  </Campo>
                  <Campo label="Monto pagado">
                    <input
                      type="number"
                      min="0"
                      step="100"
                      value={formPago.monto}
                      onChange={(e) => setFormPago((f) => ({ ...f, monto: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-border bg-surface-input px-2 py-2 text-sm text-ink"
                    />
                  </Campo>
                  <div className="flex gap-2 sm:col-span-4">
                    <button
                      type="submit"
                      disabled={pagarMut.isPending}
                      className="rounded-lg bg-accent px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
                    >
                      {pagarMut.isPending ? "Guardando…" : "Confirmar pago"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPagando(null)}
                      className="rounded-lg border border-border px-4 py-2 text-xs font-bold text-muted"
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              )}

              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
                {l.dias.map((d) => (
                  <li key={d.id} className="tabular-nums">
                    {d.fecha} · {formatCop(d.valor)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Kpi({
  titulo,
  valor,
  pie,
  destacado,
}: {
  titulo: string;
  valor: string;
  pie?: string;
  destacado?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-panel px-3 py-3">
      <p className="text-[10px] font-bold uppercase text-muted">{titulo}</p>
      <p
        className={`mt-1 text-lg font-extrabold tabular-nums ${destacado ? "text-accent" : "text-ink"}`}
      >
        {valor}
      </p>
      {pie && <p className="text-[10px] text-muted">{pie}</p>}
    </div>
  );
}

function Campo({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block text-xs ${className ?? ""}`}>
      <span className="font-bold text-muted">{label}</span>
      {children}
    </label>
  );
}
