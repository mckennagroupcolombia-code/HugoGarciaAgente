import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { Ico } from "../icons/Ico";

/**
 * Cotizar/Facturar → «Por facturar»: el taller de los cobros de WhatsApp sin factura.
 *
 * Mismo espíritu del Taller de conciliación: una lista de casos a la izquierda y, a
 * la derecha, UN caso con todo lo que hace falta para cerrarlo — el cobro del banco,
 * lo que dice el chat, y las facturas que ya existen con ese valor. Se resuelve así:
 *   · ya existe la factura  → «Es esta»: se amarra al cobro (no se emite nada);
 *   · no existe             → se factura (a Consumidor Final por defecto) y el cobro
 *                             queda amarrado al emitirse;
 *   · se hizo en Siigo o no es una venta → se anota y sale de la lista, con rastro.
 */

export interface CasoPorFacturar {
  cobro: { id: number; fecha: string; monto: number; descripcion: string; banco_nombre: string };
  estado: "identificado" | "ambiguo" | "sin_rastro";
  estado_factura: "con_factura" | "sin_factura";
  facturas_candidatas: {
    movimiento_id: string; numero: string; fecha: string; monto: number; identificacion: string;
    cliente: string; dias: number; lineas: { nombre: string; cantidad: number; precio: number }[];
  }[];
  cliente_sugerido: { nombre: string; identificacion: string; correo: string; telefono: string; en_libro: boolean };
  cotizado: string[];
  conversacion: { ts: number; direccion: string; por: string; texto: string }[];
  n_chats: number;
  preparada: { id: number; numero: string; estado: string } | null;
}

const cop = (v: number | null | undefined) =>
  v == null ? "—" : new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(v);

type Filtro = "todos" | "con_factura" | "sin_factura";

export default function TallerPorFacturar({ casos, onRecargar, onFacturar, onCerrar }: {
  casos: CasoPorFacturar[] | null;
  onRecargar: () => void;
  onFacturar: (c: CasoPorFacturar, consumidorFinal: boolean) => void;
  onCerrar: () => void;
}) {
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [selId, setSelId] = useState<number | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [modo, setModo] = useState<"siigo" | "no_aplica" | null>(null);
  const [nota, setNota] = useState("");

  const lista = useMemo(
    () => (casos ?? []).filter((c) => filtro === "todos" || c.estado_factura === filtro),
    [casos, filtro],
  );
  const conFactura = (casos ?? []).filter((c) => c.estado_factura === "con_factura").length;
  const sinFactura = (casos ?? []).length - conFactura;
  const idx = Math.max(0, lista.findIndex((c) => c.cobro.id === selId));
  const caso = lista[idx] ?? null;

  useEffect(() => {
    if (lista.length && !lista.some((c) => c.cobro.id === selId)) setSelId(lista[0].cobro.id);
  }, [lista, selId]);
  useEffect(() => { setModo(null); setNota(""); setMsg(null); }, [selId]);

  const ir = (d: number) => {
    if (!lista.length) return;
    setSelId(lista[(idx + d + lista.length) % lista.length].cobro.id);
  };

  async function vincular(c: CasoPorFacturar, movimiento_id: string) {
    setOcupado(true); setMsg(null);
    try {
      await api.post("/api/ventas-directas/por-facturar/vincular", { cobro_id: c.cobro.id, movimiento_id });
      setMsg({ ok: true, texto: "Cobro amarrado a la factura." });
      onRecargar();
    } catch (e) {
      setMsg({ ok: false, texto: (e as Error).message });
    } finally { setOcupado(false); }
  }

  async function resolver(c: CasoPorFacturar) {
    if (!modo) return;
    setOcupado(true); setMsg(null);
    try {
      await api.post("/api/ventas-directas/por-facturar/resolver", { cobro_id: c.cobro.id, tipo: modo, nota });
      setModo(null); setNota("");
      onRecargar();
    } catch (e) {
      setMsg({ ok: false, texto: (e as Error).message });
    } finally { setOcupado(false); }
  }

  const chip = (f: Filtro, texto: string) => (
    <button key={f} type="button" onClick={() => setFiltro(f)} aria-pressed={filtro === f}
      className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${filtro === f ? "border-accent bg-accent/10 text-accent" : "border-border text-muted hover:text-ink"}`}>
      {texto}
    </button>
  );

  return (
    <div className="rounded-xl border border-accent/40 bg-accent/5 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-ink">
          <Ico e="🧾" /> Taller de cobros por facturar{casos ? ` · ${casos.length}` : ""}
        </p>
        <div className="flex items-center gap-3 text-xs">
          {chip("todos", `Todos (${casos?.length ?? 0})`)}
          {chip("con_factura", `Ya tienen factura (${conFactura})`)}
          {chip("sin_factura", `Sin factura (${sinFactura})`)}
          <button type="button" className="text-muted underline" onClick={onRecargar}>recargar</button>
          <button type="button" className="text-muted underline" onClick={onCerrar}>cerrar</button>
        </div>
      </div>

      {casos === null ? (
        <p className="text-xs text-muted">Buscando cobros sin factura…</p>
      ) : casos.length === 0 ? (
        <p className="text-xs text-muted">No hay cobros de WhatsApp sin factura. 🎉</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-[280px_minmax(0,1fr)]">
          <ul className="max-h-[32rem] space-y-1 overflow-y-auto pr-1">
            {lista.map((c) => (
              <li key={c.cobro.id}>
                <button type="button" onClick={() => setSelId(c.cobro.id)} aria-current={c.cobro.id === caso?.cobro.id}
                  className={`w-full rounded-lg border p-2 text-left text-xs ${c.cobro.id === caso?.cobro.id ? "border-accent bg-surface" : "border-border bg-surface/60 hover:bg-surface"}`}>
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-semibold tabular-nums text-ink">{cop(c.cobro.monto)}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${c.estado_factura === "con_factura" ? "bg-emerald-500/15 text-emerald-700" : "bg-amber-500/20 text-amber-800"}`}>
                      {c.estado_factura === "con_factura" ? `ya: ${c.facturas_candidatas[0]?.numero}` : "sin factura"}
                    </span>
                  </span>
                  <span className="block truncate text-muted">{c.cobro.fecha} · {c.cobro.banco_nombre || c.cobro.descripcion}</span>
                </button>
              </li>
            ))}
            {lista.length === 0 && <li className="text-xs text-muted">Nada en este filtro.</li>}
          </ul>

          {caso && (
            <div className="min-w-0 space-y-3 rounded-lg border border-border bg-surface p-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-base font-bold tabular-nums text-ink">{cop(caso.cobro.monto)}</p>
                  <p className="text-muted">{caso.cobro.fecha} · {caso.cobro.banco_nombre || caso.cobro.descripcion}</p>
                </div>
                <div className="flex items-center gap-2 text-muted">
                  <button type="button" onClick={() => ir(-1)} className="rounded border border-border px-2 py-1 hover:bg-surface-hover">← Anterior</button>
                  <span>{idx + 1} de {lista.length}</span>
                  <button type="button" onClick={() => ir(1)} className="rounded border border-border px-2 py-1 hover:bg-surface-hover">Siguiente →</button>
                </div>
              </div>

              {caso.facturas_candidatas.length > 0 && (
                <div className="space-y-2 rounded-lg border-2 border-emerald-500/50 bg-emerald-500/5 p-2.5">
                  <p className="font-bold text-emerald-800">
                    Ya hay una factura con este valor — no se factura otra vez, se amarra al cobro
                  </p>
                  {caso.facturas_candidatas.map((f) => (
                    <div key={f.movimiento_id} className="rounded border border-border/60 bg-surface p-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold text-ink">
                          {f.numero} · {f.fecha} · {cop(f.monto)}
                          <span className="font-normal text-muted"> · {f.cliente || f.identificacion || "sin cliente"}
                            {" · "}{f.dias === 0 ? "el mismo día del cobro" : f.dias > 0 ? `${f.dias} días después del cobro` : `${-f.dias} días antes del cobro`}</span>
                        </p>
                        <button type="button" disabled={ocupado} onClick={() => void vincular(caso, f.movimiento_id)}
                          className="rounded-lg bg-emerald-600 px-3 py-1 font-bold text-white disabled:opacity-40">
                          ✅ Es esta: amarrar al cobro
                        </button>
                      </div>
                      {f.lineas.length > 0 && (
                        <ul className="mt-1 text-muted">
                          {f.lineas.map((l, i) => <li key={i}>• {l.cantidad}× {l.nombre} — {cop(l.precio)}</li>)}
                        </ul>
                      )}
                    </div>
                  ))}
                  <p className="text-[11px] text-muted">Verifica que los productos y el cliente correspondan a este cobro antes de amarrar.</p>
                </div>
              )}

              <div className="rounded-lg border border-border/70 p-2.5">
                <p className="mb-1 font-bold text-ink">Lo que dice el chat</p>
                <p className="text-muted">
                  {caso.cliente_sugerido.nombre || "sin nombre en el chat"}
                  {caso.cliente_sugerido.identificacion ? ` · ${caso.cliente_sugerido.identificacion}` : " · sin cédula"}
                  {caso.cliente_sugerido.telefono ? ` · ${caso.cliente_sugerido.telefono}` : ""}
                  {caso.cliente_sugerido.correo ? ` · ${caso.cliente_sugerido.correo}` : ""}
                  {caso.estado === "ambiguo" ? " · ⚠️ varios chats con este valor" : caso.estado === "sin_rastro" ? " · ⚠️ no se encontró el chat" : ""}
                </p>
                {caso.cotizado.length > 0 && (
                  <div className="mt-1.5">
                    <p className="font-semibold text-ink">Lo cotizado</p>
                    <ul className="text-muted">{caso.cotizado.map((t, i) => <li key={i} className="break-words">🗨️ {t}</li>)}</ul>
                  </div>
                )}
                {caso.conversacion.length > 0 && (
                  <details className="mt-1.5">
                    <summary className="cursor-pointer text-muted underline">Conversación ({caso.conversacion.length})</summary>
                    <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto">
                      {caso.conversacion.map((m, i) => (
                        <li key={i} className={m.direccion === "salida" ? "text-accent" : "text-ink-secondary"}>
                          <span className="text-[10px] text-muted">{new Date(m.ts * 1000).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })} </span>
                          {m.direccion === "salida" ? "Nosotros: " : "Cliente: "}{m.texto}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>

              {caso.preparada ? (
                <p className="rounded bg-surface-hover px-2 py-1 text-muted">Ya hay una factura en preparación para este cobro ({caso.preparada.numero} · {caso.preparada.estado}).</p>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" disabled={ocupado} onClick={() => onFacturar(caso, true)}
                    className={`rounded-lg px-3 py-1.5 font-bold ${caso.estado_factura === "sin_factura" ? "bg-accent text-white" : "border border-border text-ink"}`}>
                    🧾 Facturar a Consumidor Final
                  </button>
                  {caso.cliente_sugerido.identificacion && (
                    <button type="button" disabled={ocupado} onClick={() => onFacturar(caso, false)}
                      className="rounded-lg border border-accent px-3 py-1.5 font-semibold text-accent">
                      Facturar a {caso.cliente_sugerido.nombre || caso.cliente_sugerido.identificacion}
                    </button>
                  )}
                  <button type="button" onClick={() => setModo(modo === "siigo" ? null : "siigo")} className="text-muted underline">Ya se facturó en Siigo</button>
                  <button type="button" onClick={() => setModo(modo === "no_aplica" ? null : "no_aplica")} className="text-muted underline">No es una venta</button>
                </div>
              )}
              {caso.estado_factura === "con_factura" && !caso.preparada && (
                <p className="text-[11px] text-amber-700">⚠️ Este cobro ya tiene una factura candidata arriba: facturar de nuevo duplicaría la venta.</p>
              )}

              {modo && (
                <div className="flex flex-wrap items-center gap-2 rounded border border-border/70 p-2">
                  <input value={nota} onChange={(e) => setNota(e.target.value)} autoFocus
                    placeholder={modo === "siigo" ? "Número de la factura en Siigo (ej. FV-2-12345)" : "¿Por qué no es una venta?"}
                    className="min-w-[16rem] flex-1 rounded border border-border bg-surface px-2 py-1" />
                  <button type="button" disabled={ocupado || nota.trim().length < 3} onClick={() => void resolver(caso)}
                    className="rounded-lg bg-ink px-3 py-1 font-bold text-surface disabled:opacity-40">Sacar de la lista</button>
                </div>
              )}
              {msg && <p className={msg.ok ? "text-emerald-700" : "text-danger"}>{msg.texto}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
