import { useState } from "react";
import { usePostventa, useResponderPostventa, type MensajeHistorialPostventa } from "../hooks/usePostventa";
import { api } from "../api/client";

function cop(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);
}

export default function PostventaPanel() {
  const { data, isLoading, refetch } = usePostventa();
  const responder = useResponderPostventa();
  const [respuestas, setRespuestas] = useState<Record<string, string>>({});
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [historialAbierto, setHistorialAbierto] = useState<Set<string>>(new Set());
  const [historiales, setHistoriales] = useState<Record<string, MensajeHistorialPostventa[]>>({});
  const [cargandoHistorial, setCargandoHistorial] = useState<Set<string>>(new Set());

  const mensajes = data?.mensajes ?? [];

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

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-ink">
          Postventa MeLi
          {data && (
            <span className="ml-2 text-lg font-normal text-muted">
              ({data.total} pendiente{data.total !== 1 ? "s" : ""})
            </span>
          )}
        </h2>
        <button
          onClick={() => refetch()}
          className="rounded-lg border border-border px-3 py-1.5 text-base text-muted transition hover:text-ink"
        >
          Actualizar
        </button>
      </div>

      <p className="text-base text-muted">
        Mensajes de compradores post-compra. La respuesta se envía en MeLi y se
        notifica al grupo de postventa en WhatsApp.
      </p>

      {isLoading && <p className="text-lg text-muted">Cargando...</p>}

      {!isLoading && mensajes.length === 0 && (
        <div className="rounded-xl border border-border bg-surface-panel p-8 text-center">
          <p className="text-lg text-success">Sin mensajes postventa pendientes</p>
        </div>
      )}

      <div className="grid gap-4 items-start lg:grid-cols-2">
        {mensajes.map((m) => (
          <div
            key={m.pack_id}
            className="rounded-xl border border-border bg-surface-panel p-4 space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-lg font-medium text-ink truncate">
                  {m.comprador || "Comprador MeLi"}
                </p>
                {(m.productos_detalle ?? []).length > 0 ? (
                  <div className="mt-1 overflow-hidden rounded-lg border border-border">
                    <table className="w-full text-base">
                      <thead className="bg-surface-hover text-[11px] uppercase tracking-wide text-muted">
                        <tr>
                          <th className="px-2 py-1 text-left">Producto</th>
                          <th className="px-2 py-1 text-right">Unid.</th>
                          <th className="px-2 py-1 text-right">Precio unit.</th>
                          <th className="px-2 py-1 text-right">Subtotal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(m.productos_detalle ?? []).map((p, i) => (
                          <tr key={`${p.nombre}-${i}`} className="border-t border-border/50">
                            <td className="px-2 py-1 text-ink">{p.nombre}</td>
                            <td className="px-2 py-1 text-right text-muted">{p.cantidad}</td>
                            <td className="px-2 py-1 text-right text-muted">{cop(p.precio_unitario)}</td>
                            <td className="px-2 py-1 text-right font-medium text-ink">
                              {p.precio_unitario != null ? cop(p.precio_unitario * p.cantidad) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  m.productos.length > 0 && (
                    <ul className="mt-1 text-base text-muted list-disc list-inside">
                      {m.productos.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  )
                )}
                <p className="mt-2 text-lg text-ink-muted whitespace-pre-wrap">
                  &ldquo;{m.texto}&rdquo;
                </p>

                <button
                  type="button"
                  onClick={() => void toggleHistorial(m.pack_id)}
                  className="mt-1 text-sm font-medium text-accent hover:underline"
                >
                  {historialAbierto.has(m.pack_id) ? "Ocultar" : "Ver"} últimos mensajes de la conversación
                </button>

                {historialAbierto.has(m.pack_id) && (
                  <div className="mt-2 space-y-1.5 rounded-lg border border-border bg-surface-hover/50 p-2">
                    {cargandoHistorial.has(m.pack_id) && (
                      <p className="text-sm text-muted">Cargando…</p>
                    )}
                    {!cargandoHistorial.has(m.pack_id) && (historiales[m.pack_id]?.length ?? 0) === 0 && (
                      <p className="text-sm text-muted">Sin historial disponible.</p>
                    )}
                    {(historiales[m.pack_id] ?? []).map((h, i) => (
                      <div
                        key={i}
                        className={`rounded-lg px-3 py-1.5 text-sm ${
                          h.de === "vendedor"
                            ? "ml-6 bg-accent/15 text-ink"
                            : "mr-6 bg-surface text-ink"
                        }`}
                      >
                        <p className="text-[11px] font-semibold text-muted">
                          {h.nombre} {h.fecha && `· ${h.fecha}`}
                        </p>
                        <p className="whitespace-pre-wrap">{h.texto}</p>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 rounded-lg bg-surface-hover px-3 py-2 text-base text-muted">
                  <span>
                    Código: <span className="font-mono font-semibold text-ink">{m.codigo}</span>
                  </span>
                  <span>
                    N.° de venta: <span className="font-mono font-semibold text-ink">{m.pack_id}</span>
                  </span>
                  {m.total && <span>💰 {m.total}</span>}
                  {m.fecha_compra && <span>📅 Compra: {m.fecha_compra}</span>}
                  {m.envio && <span>🚚 {m.envio}</span>}
                  {m.timestamp && (
                    <span>
                      🕒{" "}
                      {new Date(m.timestamp).toLocaleString("es-CO", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {errores[m.codigo] && (
              <p className="text-base text-danger">{errores[m.codigo]}</p>
            )}

            <div className="flex gap-2">
              <input
                type="text"
                spellCheck
                lang="es"
                value={respuestas[m.codigo] ?? ""}
                onChange={(e) =>
                  setRespuestas((r) => ({ ...r, [m.codigo]: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmit(m.codigo);
                }}
                placeholder="Escribir respuesta al comprador..."
                className="flex-1 rounded-lg border border-border bg-surface-input px-3 py-2 text-lg text-ink outline-none placeholder:text-muted/50 focus:border-accent"
              />
              <button
                onClick={() => handleSubmit(m.codigo)}
                disabled={
                  !(respuestas[m.codigo] ?? "").trim() || responder.isPending
                }
                className="rounded-lg bg-accent px-4 py-2 text-lg font-medium text-white transition hover:bg-accent-hover disabled:opacity-40"
              >
                {responder.isPending ? "..." : "Responder"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
