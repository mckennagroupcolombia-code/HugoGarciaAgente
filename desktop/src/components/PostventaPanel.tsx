import { useState } from "react";
import {
  usePostventa,
  useResponderPostventa,
  useOmitirPostventa,
  type MensajeHistorialPostventa,
  type MensajePostventaPendiente,
  type ProductoPostventa,
} from "../hooks/usePostventa";
import { api } from "../api/client";
import PostventaEstadisticas from "./PostventaEstadisticas";

function cop(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);
}

function ProductosLista({ productos }: { productos: ProductoPostventa[] }) {
  return (
    <ul className="mt-2 divide-y divide-border/60 overflow-hidden rounded-xl border border-border">
      {productos.map((p, i) => (
        <li key={`${p.nombre}-${i}`} className="bg-surface-hover/30 px-3 py-2.5">
          <p className="text-[15px] leading-snug text-ink break-words [overflow-wrap:anywhere]">
            {p.nombre}
          </p>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-surface px-1.5 py-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Unid.
              </p>
              <p className="text-sm font-semibold text-ink">{p.cantidad}</p>
            </div>
            <div className="rounded-lg bg-surface px-1.5 py-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Unit.
              </p>
              <p className="text-sm font-semibold text-ink tabular-nums">
                {cop(p.precio_unitario)}
              </p>
            </div>
            <div className="rounded-lg bg-surface px-1.5 py-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Subt.
              </p>
              <p className="text-sm font-semibold text-ink tabular-nums">
                {p.precio_unitario != null
                  ? cop(p.precio_unitario * p.cantidad)
                  : "—"}
              </p>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function MetaVenta({ m }: { m: MensajePostventaPendiente }) {
  const filas: { label: string; value: string }[] = [
    { label: "Código", value: m.codigo },
    { label: "Venta", value: m.pack_id },
  ];
  if (m.total) filas.push({ label: "Total", value: m.total });
  if (m.fecha_compra) filas.push({ label: "Compra", value: m.fecha_compra });
  if (m.envio) filas.push({ label: "Envío", value: m.envio });
  if (m.timestamp) {
    filas.push({
      label: "Alerta",
      value: new Date(m.timestamp).toLocaleString("es-CO", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }),
    });
  }

  return (
    <dl className="mt-2 grid grid-cols-1 gap-1.5 rounded-xl bg-surface-hover px-3 py-2.5 sm:grid-cols-2">
      {filas.map((f) => (
        <div key={f.label} className="min-w-0">
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">
            {f.label}
          </dt>
          <dd className="text-sm font-medium text-ink break-all [overflow-wrap:anywhere]">
            {f.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function PostventaPanel() {
  const { data, isLoading, refetch } = usePostventa();
  const responder = useResponderPostventa();
  const omitir = useOmitirPostventa();
  const [respuestas, setRespuestas] = useState<Record<string, string>>({});
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [historialAbierto, setHistorialAbierto] = useState<Set<string>>(new Set());
  const [historiales, setHistoriales] = useState<Record<string, MensajeHistorialPostventa[]>>({});
  const [cargandoHistorial, setCargandoHistorial] = useState<Set<string>>(new Set());

  const mensajes = data?.mensajes ?? [];
  const ocupado = responder.isPending || omitir.isPending;

  const toggleHistorial = async (packId: string) => {
    if (historialAbierto.has(packId)) {
      setHistorialAbierto((prev) => {
        const s = new Set(prev);
        s.delete(packId);
        return s;
      });
      return;
    }
    setHistorialAbierto((prev) => new Set(prev).add(packId));
    if (historiales[packId]) return;
    setCargandoHistorial((prev) => new Set(prev).add(packId));
    try {
      const res = await api.get<{ historial: MensajeHistorialPostventa[] }>(
        `/api/postventa/historial/${packId}`,
      );
      setHistoriales((prev) => ({ ...prev, [packId]: res.historial ?? [] }));
    } catch {
      /* ignore */
    } finally {
      setCargandoHistorial((prev) => {
        const s = new Set(prev);
        s.delete(packId);
        return s;
      });
    }
  };

  const handleSubmit = (codigo: string) => {
    const texto = (respuestas[codigo] ?? "").trim();
    if (!texto) return;
    setErrores((e) => {
      const next = { ...e };
      delete next[codigo];
      return next;
    });
    responder.mutate(
      { codigo, respuesta: texto },
      {
        onSuccess: (res) => {
          if (res?.ok) {
            setRespuestas((r) => {
              const next = { ...r };
              delete next[codigo];
              return next;
            });
          } else {
            setErrores((e) => ({
              ...e,
              [codigo]: res?.error || "No se pudo enviar la respuesta",
            }));
          }
        },
        onError: () => {
          setErrores((e) => ({
            ...e,
            [codigo]: "Error de conexión con el servidor",
          }));
        },
      },
    );
  };

  const handleOmitir = (codigo: string) => {
    if (
      !window.confirm(
        "¿Omitir este mensaje? Se quita de la cola y dejan de enviarse recordatorios a WhatsApp. No se responde en MeLi.",
      )
    ) {
      return;
    }
    setErrores((e) => {
      const next = { ...e };
      delete next[codigo];
      return next;
    });
    omitir.mutate(
      { codigo },
      {
        onSuccess: (res) => {
          if (res?.ok) {
            setRespuestas((r) => {
              const next = { ...r };
              delete next[codigo];
              return next;
            });
          } else {
            setErrores((e) => ({
              ...e,
              [codigo]: res?.error || "No se pudo omitir el mensaje",
            }));
          }
        },
        onError: () => {
          setErrores((e) => ({
            ...e,
            [codigo]: "Error de conexión al omitir",
          }));
        },
      },
    );
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-3 sm:space-y-4">
      <div className="flex items-start justify-between gap-2">
        <h2 className="min-w-0 text-xl font-semibold leading-tight text-ink sm:text-2xl">
          Postventa MeLi
          {data && (
            <span className="ml-1.5 text-base font-normal text-muted sm:text-lg">
              ({data.total})
            </span>
          )}
        </h2>
        <button
          type="button"
          onClick={() => refetch()}
          className="min-h-10 shrink-0 rounded-lg border border-border px-3 py-2 text-sm text-muted transition hover:text-ink sm:text-base"
        >
          Actualizar
        </button>
      </div>

      <p className="hidden text-base text-muted sm:block">
        Mensajes post-compra. Responder envía a MeLi; Omitir saca de la cola y
        corta recordatorios de WhatsApp.
      </p>

      <PostventaEstadisticas />

      {isLoading && <p className="text-base text-muted">Cargando...</p>}

      {!isLoading && mensajes.length === 0 && (
        <div className="rounded-xl border border-border bg-surface-panel px-4 py-8 text-center">
          <p className="text-base text-success sm:text-lg">
            Sin mensajes postventa pendientes
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:gap-4">
        {mensajes.map((m) => (
          <article
            key={m.pack_id}
            className="rounded-xl border border-border bg-surface-panel p-3 space-y-3 sm:p-4"
          >
            <header className="flex flex-wrap items-start justify-between gap-2">
              <p className="text-base font-semibold text-ink break-words [overflow-wrap:anywhere] sm:text-lg">
                {m.comprador || "Comprador MeLi"}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                {m.tipo_solicitud_label && (
                  <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[11px] font-semibold text-ink">
                    {m.tipo_solicitud_label}
                  </span>
                )}
                {m.espera_min != null && (
                  <span className="rounded-full border border-border px-2 py-0.5 text-[11px] tabular-nums text-muted">
                    {m.espera_min < 60
                      ? `${Math.round(m.espera_min)} min`
                      : `${Math.floor(m.espera_min / 60)} h`}
                  </span>
                )}
              </div>
            </header>

            {(m.productos_detalle ?? []).length > 0 ? (
              <ProductosLista productos={m.productos_detalle} />
            ) : (
              m.productos.length > 0 && (
                <ul className="space-y-1.5 rounded-xl border border-border bg-surface-hover/30 px-3 py-2">
                  {m.productos.map((p) => (
                    <li
                      key={p}
                      className="text-[15px] leading-snug text-muted break-words [overflow-wrap:anywhere]"
                    >
                      {p}
                    </li>
                  ))}
                </ul>
              )
            )}

            <blockquote className="rounded-xl border border-border/60 bg-surface px-3 py-2.5 text-[15px] leading-relaxed text-ink-muted break-words whitespace-pre-wrap [overflow-wrap:anywhere] sm:text-base">
              {m.texto}
            </blockquote>

            <button
              type="button"
              onClick={() => void toggleHistorial(m.pack_id)}
              className="min-h-10 w-full rounded-lg border border-border px-3 py-2 text-left text-sm font-medium text-accent transition hover:bg-surface-hover sm:w-auto sm:border-0 sm:px-0 sm:py-0 sm:hover:bg-transparent sm:hover:underline"
            >
              {historialAbierto.has(m.pack_id) ? "Ocultar" : "Ver"} conversación
            </button>

            {historialAbierto.has(m.pack_id) && (
              <div className="space-y-2 rounded-xl border border-border bg-surface-hover/50 p-2.5">
                {cargandoHistorial.has(m.pack_id) && (
                  <p className="text-sm text-muted">Cargando…</p>
                )}
                {!cargandoHistorial.has(m.pack_id) &&
                  (historiales[m.pack_id]?.length ?? 0) === 0 && (
                    <p className="text-sm text-muted">Sin historial disponible.</p>
                  )}
                {(historiales[m.pack_id] ?? []).map((h, i) => (
                  <div
                    key={i}
                    className={`rounded-lg px-3 py-2 text-sm break-words [overflow-wrap:anywhere] ${
                      h.de === "vendedor"
                        ? "bg-accent/15 text-ink sm:ml-4"
                        : "bg-surface text-ink sm:mr-4"
                    }`}
                  >
                    <p className="text-[11px] font-semibold text-muted">
                      {h.nombre} {h.fecha && `· ${h.fecha}`}
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap">{h.texto}</p>
                  </div>
                ))}
              </div>
            )}

            <MetaVenta m={m} />

            {errores[m.codigo] && (
              <p className="text-sm text-danger break-words">{errores[m.codigo]}</p>
            )}

            <div className="flex flex-col gap-2">
              <textarea
                rows={3}
                spellCheck
                lang="es"
                value={respuestas[m.codigo] ?? ""}
                onChange={(e) =>
                  setRespuestas((r) => ({ ...r, [m.codigo]: e.target.value }))
                }
                placeholder="Escribir respuesta al comprador…"
                className="min-h-[5.5rem] w-full resize-y rounded-xl border border-border bg-surface-input px-3 py-2.5 text-base leading-relaxed text-ink outline-none placeholder:text-muted/50 focus:border-accent"
              />
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleSubmit(m.codigo)}
                  disabled={!(respuestas[m.codigo] ?? "").trim() || ocupado}
                  className="min-h-11 rounded-xl bg-accent px-3 py-2.5 text-base font-semibold text-white transition hover:bg-accent-hover disabled:opacity-40"
                >
                  {responder.isPending ? "…" : "Responder"}
                </button>
                <button
                  type="button"
                  onClick={() => handleOmitir(m.codigo)}
                  disabled={ocupado}
                  title="Quitar de la cola sin responder en MeLi"
                  className="min-h-11 rounded-xl border border-border px-3 py-2.5 text-base font-semibold text-muted transition hover:border-danger/40 hover:text-danger disabled:opacity-40"
                >
                  {omitir.isPending ? "…" : "Omitir"}
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
