import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";

/**
 * Agente WhatsApp → Buscar.
 *
 * 1. Buscador de chats: palabras, teléfono o un valor («320.000», «320000» y «320,000» se
 *    buscan juntos). Agrupa por conversación y abre el chat.
 * 2. Cobros sin factura: los cobros por Llave/QR/Nequi del banco que no están vinculados,
 *    con lo que su chat dice del cliente (cédula/NIT, correo, lo cotizado). Sirve para
 *    facturarlos en Facturación → Cotizar/Facturar y luego vincular el cobro en el Taller.
 * Backend: app/services/wa_busqueda.py (solo lectura, sin LLM, sin llamar a Alegra).
 */

type Fragmento = { ts: number; direccion: string; por: string; texto: string };
type Resultado = { jid: string; display: string; telefono: string | null; coincidencias: number; ultimo_ts: number; fragmentos: Fragmento[] };
type Chat = {
  jid: string; display: string; telefono: string | null; mensajes: number;
  documentos: string[]; correos: string[]; cotizado: string[];
  conversacion: Fragmento[];
  en_libro: { id: number; nombre: string; identificacion: string; tipo: string }[];
};
type Cobro = {
  linea: { id: number; fecha: string; descripcion: string; monto: number; banco_nombre: string };
  chats: Chat[];
  estado: "identificado" | "ambiguo" | "sin_rastro";
};

const cop = (n: number) => "$" + Math.round(n).toLocaleString("es-CO");
const cuando = (ts: number) =>
  new Date(ts * 1000).toLocaleString("es-CO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const ESTADO: Record<Cobro["estado"], { txt: string; tono: string }> = {
  identificado: { txt: "cliente identificado", tono: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  ambiguo: { txt: "varios chats con ese valor", tono: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  sin_rastro: { txt: "sin rastro en los chats", tono: "bg-red-500/10 text-red-600" },
};

function Burbuja({ f }: { f: Fragmento }) {
  const sale = f.direccion !== "entrada";
  return (
    <div className={`flex ${sale ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] rounded-lg px-2 py-1 text-[12px] ${sale ? "bg-accent/10 text-ink" : "bg-surface text-ink"}`}>
        <span className="mr-1 text-[10px] text-muted">{cuando(f.ts)}{f.por ? ` · ${f.por}` : ""}</span>
        {f.texto}
      </div>
    </div>
  );
}

function Buscador({ onAbrirChat }: { onAbrirChat: (jid: string) => void }) {
  const [q, setQ] = useState("");
  const [enviado, setEnviado] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [grupos, setGrupos] = useState(false);
  const r = useQuery<{ resultados: Resultado[]; total_mensajes: number; es_valor: boolean }>({
    queryKey: ["wa-buscar", enviado, desde, hasta, grupos],
    queryFn: () => api.get(`/api/bot/chats/buscar?q=${encodeURIComponent(enviado)}&desde=${desde}&hasta=${hasta}&grupos=${grupos ? 1 : 0}`),
    enabled: enviado.trim().length >= 2,
  });
  const res = r.data?.resultados ?? [];
  return (
    <div className="space-y-3">
      <form onSubmit={(e) => { e.preventDefault(); setEnviado(q.trim()); }}
        className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-panel p-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus
          placeholder="Palabras, teléfono o valor (320.000)…"
          className="min-w-[220px] flex-1 rounded-lg border border-border bg-surface-input px-3 py-2 text-[13px]" />
        <label className="text-[11px] text-muted">desde <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="rounded border border-border bg-surface-input px-1 py-1 text-[12px]" /></label>
        <label className="text-[11px] text-muted">hasta <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="rounded border border-border bg-surface-input px-1 py-1 text-[12px]" /></label>
        <label className="flex items-center gap-1 text-[11px] text-muted"><input type="checkbox" checked={grupos} onChange={(e) => setGrupos(e.target.checked)} /> grupos</label>
        <button type="submit" className="rounded-lg bg-accent px-3 py-2 text-[13px] font-bold text-white">Buscar</button>
      </form>
      {r.isFetching && <p className="text-[12px] text-muted">Buscando…</p>}
      {r.data && (
        <p className="text-[12px] text-muted">
          {res.length} conversación{res.length === 1 ? "" : "es"} · {r.data.total_mensajes} mensaje{r.data.total_mensajes === 1 ? "" : "s"}
          {r.data.es_valor ? " · búsqueda por valor (con y sin puntos)" : ""}
        </p>
      )}
      {res.map((x) => (
        <div key={x.jid} className="rounded-xl border border-border bg-surface-input p-2.5">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-[13px] font-bold text-ink">{x.display}</span>
            <span className="text-[11px] text-muted">{x.coincidencias} coincidencia{x.coincidencias === 1 ? "" : "s"} · {cuando(x.ultimo_ts)}</span>
            <button type="button" onClick={() => onAbrirChat(x.jid)} className="ml-auto rounded-md border border-border px-2 py-1 text-[11.5px] font-bold text-accent">Abrir chat</button>
          </div>
          <div className="space-y-1">{x.fragmentos.map((f, i) => <Burbuja key={i} f={f} />)}</div>
        </div>
      ))}
    </div>
  );
}

function datosParaCopiar(c: Cobro, ch: Chat): string {
  return [
    `Cobro ${c.linea.fecha} · ${cop(c.linea.monto)} · banco: ${c.linea.banco_nombre}`,
    `WhatsApp: ${ch.display}`,
    ch.documentos.length ? `Cédula/NIT: ${ch.documentos.join(", ")}` : "",
    ch.correos.length ? `Correo: ${ch.correos.join(", ")}` : "",
    ch.cotizado.length ? `Cotizado:\n- ${ch.cotizado.join("\n- ")}` : "",
  ].filter(Boolean).join("\n");
}

function CobrosSinFactura({ onAbrirChat }: { onAbrirChat: (jid: string) => void }) {
  const [desde, setDesde] = useState("2026-09-01");
  const [abierto, setAbierto] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string>("");
  const r = useQuery<{ cobros: Cobro[]; total: number; identificados: number }>({
    queryKey: ["wa-cobros-sin-factura", desde],
    queryFn: () => api.get(`/api/bot/chats/cobros-sin-factura?desde=${desde}`),
  });
  const cobros = r.data?.cobros ?? [];
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-surface-panel p-3 text-[12.5px] text-ink">
        Cobros por <b>Llave, QR o Nequi</b> del extracto que <b>no están vinculados</b> a ninguna factura. Para cada
        uno, el chat donde se confirmó ese valor y los datos que el cliente escribió. Con eso se factura en
        <b> Facturación → Cotizar/Facturar</b> y después se vincula el cobro en el Taller de conciliación.
        <div className="mt-2 flex items-center gap-2 text-[12px] text-muted">
          desde <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="rounded border border-border bg-surface-input px-1 py-1" />
          {r.data && <span>· {cobros.length} cobros · {cop(r.data.total)} · {r.data.identificados} con cliente identificado</span>}
        </div>
      </div>
      {r.isLoading && <p className="text-[12px] text-muted">Cruzando cobros con los chats…</p>}
      {cobros.map((c) => {
        const k = String(c.linea.id);
        return (
          <div key={k} className="rounded-xl border border-border bg-surface-input p-2.5">
            <button type="button" onClick={() => setAbierto(abierto === k ? null : k)} className="flex w-full flex-wrap items-center gap-2 text-left">
              <span className="text-[12px] text-muted">{c.linea.fecha}</span>
              <span className="text-[13px] font-bold text-ink">{c.linea.banco_nombre || c.linea.descripcion}</span>
              <span className="font-mono text-[13px] font-bold text-ink">{cop(c.linea.monto)}</span>
              <span className={`rounded-full px-1.5 text-[10.5px] font-bold ${ESTADO[c.estado].tono}`}>{ESTADO[c.estado].txt}</span>
              {c.chats[0] && <span className="text-[12px] text-muted">{c.chats[0].display}{c.chats[0].documentos[0] ? ` · CC/NIT ${c.chats[0].documentos[0]}` : ""}</span>}
            </button>
            {abierto === k && (
              <div className="mt-2 space-y-2">
                {c.chats.length === 0 && (
                  <p className="text-[12px] text-muted">Ningún chat de clientes menciona este valor en las dos semanas anteriores. Busca por el nombre que trae el banco en el buscador.</p>
                )}
                {c.chats.map((ch) => (
                  <div key={ch.jid} className="rounded-lg border border-border bg-surface p-2">
                    <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                      <b className="text-ink">{ch.display}</b>
                      <span className="text-muted">{ch.mensajes} mensajes</span>
                      {ch.documentos.length > 0 && <span>CC/NIT: <b>{ch.documentos.join(", ")}</b></span>}
                      {ch.correos.length > 0 && <span>Correo: <b>{ch.correos.join(", ")}</b></span>}
                      {ch.en_libro.length > 0 && <span className="text-emerald-700 dark:text-emerald-300">ya es tercero: {ch.en_libro.map((t) => t.nombre).join(", ")}</span>}
                      <span className="ml-auto flex gap-1.5">
                        <button type="button" onClick={() => { void navigator.clipboard?.writeText(datosParaCopiar(c, ch)); setCopiado(ch.jid + k); }}
                          className="rounded-md border border-border px-2 py-1 text-[11.5px] font-bold text-ink">{copiado === ch.jid + k ? "Copiado ✓" : "Copiar datos"}</button>
                        <button type="button" onClick={() => onAbrirChat(ch.jid)} className="rounded-md border border-border px-2 py-1 text-[11.5px] font-bold text-accent">Abrir chat</button>
                      </span>
                    </div>
                    {ch.cotizado.length > 0 && (
                      <ul className="mt-1 list-disc pl-5 text-[12px] text-ink-secondary">{ch.cotizado.map((t, i) => <li key={i}>{t}</li>)}</ul>
                    )}
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[11.5px] text-muted">Conversación de esos días</summary>
                      <div className="mt-1 max-h-72 space-y-1 overflow-y-auto">{ch.conversacion.map((f, i) => <Burbuja key={i} f={f} />)}</div>
                    </details>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function WhatsAppBuscar({ onAbrirChat }: { onAbrirChat: (jid: string) => void }) {
  const [vista, setVista] = useState<"buscar" | "cobros">("buscar");
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        {([["buscar", "Buscar en chats"], ["cobros", "Cobros sin factura"]] as const).map(([id, txt]) => (
          <button key={id} type="button" onClick={() => setVista(id)}
            className={`rounded-full border px-3 py-1.5 text-[12.5px] font-bold ${vista === id ? "border-accent bg-accent/10 text-accent" : "border-border text-ink"}`}>
            {txt}
          </button>
        ))}
      </div>
      {vista === "buscar" ? <Buscador onAbrirChat={onAbrirChat} /> : <CobrosSinFactura onAbrirChat={onAbrirChat} />}
    </div>
  );
}
