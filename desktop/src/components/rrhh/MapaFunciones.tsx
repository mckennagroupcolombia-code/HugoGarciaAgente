import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { HorasEnFicha } from "../MiQuincena";
import { useTicketsAuth } from "../../stores/ticketsAuth";

/**
 * Mapa de funciones (RRHH · Compensaciones): persona × etapa de la operación, en vivo.
 * Cada casilla suma horas y valor (horas × tarifa del nivel); al tocar una persona se
 * abre su ficha en letra grande. Datos: GET /api/rrhh/mapa-funciones
 * (app/services/mapa_funciones.py). Tonos cálidos y un solo modo claro a propósito:
 * se lee en reuniones y por personas de todas las edades.
 */

type Funcion = {
  id: string;
  extra_id?: string;
  funcion: string;
  implica: string;
  nivel: number;
  veces: number;
  horas: number;
  promedio_min: number | null;
  fuente: string;
  valor: number;
  tarifa: number;
  manual: boolean;
};
type Persona = {
  usuario_id: number;
  username: string;
  nombre: string;
  rol: string;
  horas_mes: number;
  horas_mes_anterior: number;
  dias_activos: number;
  valor_mes: number;
  pago_hoy: number;
  propuesta: number;
  razon: string;
  tarifa_media: number;
  horas_pagadas: number;
  colectas?: boolean;
  comision: null | { pct: number; base_promedio: number; promedio: number; mes_actual: number; base_mes_actual: number; fijo: number; bono: number };
  tipos: { nivel: number; nombre: string; horas: number; porcentaje: number }[];
  nota: string;
  carga: { panel: number; cronometro: number; anotada: number };
  celdas: Record<string, Funcion[]>;
  mercado?: Mercado | null;
};
type Mercado = {
  cargo: string; min: number; max: number; fuente: string; piso_legal: number;
  honorario_min: number; honorario_max: number; hora_min: number; hora_max: number;
  por_sus_horas_min: number; por_sus_horas_max: number; horas_referencia: number;
};
type Mapa = {
  periodo: { dias: number; hasta: string };
  etapas: { id: string; nombre: string }[];
  recorrido: { etapa: string; funcion: string; texto: string }[];
  tarifas: Record<string, number>;
  niveles: Record<string, string>;
  jornada: number;
  comision_pct: number;
  whatsapp: { chats?: number; mensajes_clientes?: number; respuestas_humanas?: number; respuestas_bot?: number };
  personas: Persona[];
  config_cargada: boolean;
};

const C = {
  bg: "#f6efe4", surface: "#fffcf7", surface2: "#f1e7d8", ink: "#2b2119", ink2: "#5e4e40", muted: "#8a7866",
  line: "#e4d6c3", accent: "#b4581d", heat: "#d9822b", up: "#3f7a2e", upSoft: "#e3efd6", down: "#a4471d", downSoft: "#f7e0d2",
  in: "#c1742b", out: "#6f8f4e", anot: "#7a5c9e",
};
const NIV_COLOR: Record<number, string> = { 1: "#f5e2c4", 2: "#eec68b", 3: "#df9f55", 4: "#c1742b", 5: "#8f4d17" };
const NIV_INK: Record<number, string> = { 1: C.ink, 2: C.ink, 3: C.ink, 4: "#fff", 5: "#fff" };

const pesos = (v: number) => "$" + Math.round(v).toLocaleString("es-CO");
const millones = (v: number) => "$" + (Math.round(v / 1e5) / 10).toLocaleString("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "M";
const corto = (v: number) => (v >= 1e6 ? millones(v) : `$${Math.round(v / 1000)} mil`);
const dur = (m: number | null) => (m == null ? "continuo" : m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` : `${m} min`);
const sumH = (fs: Funcion[]) => fs.reduce((a, f) => a + f.horas, 0);
const sumV = (fs: Funcion[]) => fs.reduce((a, f) => a + f.valor, 0);

type Sel = { tipo: "persona"; uid: number } | { tipo: "celda"; uid: number; etapa: string } | { tipo: "etapa"; etapa: string } | { tipo: "todo" };

export default function MapaFunciones() {
  const qc = useQueryClient();
  const [dias, setDias] = useState(30);
  const { data, isLoading, error } = useQuery({
    queryKey: ["rrhh-mapa-funciones", dias],
    queryFn: () => api.get<Mapa>(`/api/rrhh/mapa-funciones?dias=${dias}`, { timeoutMs: 60000 }),
  });
  const [sel, setSel] = useState<Sel>({ tipo: "todo" });
  const [ficha, setFicha] = useState<number | null>(null);
  const recargar = () => void qc.invalidateQueries({ queryKey: ["rrhh-mapa-funciones"] });

  if (isLoading) return <p className="p-4 text-sm text-muted">Calculando el mapa…</p>;
  if (error || !data) return <p className="p-4 text-sm text-red-600">No se pudo cargar el mapa: {String((error as Error)?.message || "")}</p>;

  const totalHoy = data.personas.reduce((a, p) => a + p.pago_hoy, 0);
  const totalValor = data.personas.reduce((a, p) => a + p.valor_mes, 0);
  const totalProp = data.personas.reduce((a, p) => a + (p.propuesta || p.pago_hoy), 0);
  const totalH = data.personas.reduce((a, p) => a + p.horas_mes, 0);
  const nFun = data.personas.reduce((a, p) => a + Object.values(p.celdas).reduce((b, fs) => b + fs.length, 0), 0);
  const maxCelda = Math.max(1, ...data.personas.flatMap((p) => data.etapas.map((e) => sumV(p.celdas[e.id] || []))));
  const quien = (etapa: string, funcion: string) =>
    data.personas.filter((p) => (p.celdas[etapa] || []).some((f) => f.id === funcion)).map((p) => p.nombre.split(" ")[0]).join(", ");

  return (
    <div className="space-y-3 rounded-2xl p-3 sm:p-4" style={{ background: C.bg, color: C.ink }}>
      {/* Encabezado y totales */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[.12em]" style={{ color: C.accent }}>
            Quién hace qué y cuánto vale · últimos {data.periodo.dias} días, llevado a un mes
          </p>
          <h3 className="text-xl font-black">Mapa de funciones</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={dias} onChange={(e) => setDias(Number(e.target.value))} className="rounded-lg border px-2 py-1 text-xs" style={{ borderColor: C.line, background: C.surface }} aria-label="Periodo">
            <option value={30}>Últimos 30 días</option>
            <option value={60}>Últimos 60 días</option>
            <option value={90}>Últimos 90 días</option>
          </select>
          <div className="flex overflow-hidden rounded-xl border text-center" style={{ borderColor: C.line, background: C.line, gap: 1 }}>
            {[
              [String(nFun), "funciones"],
              [`${Math.round(totalH)} h`, "al mes"],
              [millones(totalValor), "valor de las funciones"],
              [millones(totalHoy), "se paga hoy"],
              [millones(totalProp), "propuesta"],
            ].map(([n, t]) => (
              <div key={t} className="px-3 py-1.5" style={{ background: C.surface }}>
                <b className="block font-mono text-sm tabular-nums">{n}</b>
                <span className="text-[10.5px]" style={{ color: C.muted }}>{t}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {!data.config_cargada && (
        <p className="rounded-lg border p-2 text-xs" style={{ borderColor: C.line, background: C.surface2 }}>
          Faltan los pagos y las propuestas: se cargan en la ficha de cada persona (botón «Editar pago»).
        </p>
      )}

      {/* Recorrido y WhatsApp */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs" style={{ color: C.ink2 }}>
        <span className="mr-1 font-mono text-[10.5px] uppercase tracking-wider" style={{ color: C.muted }}>Recorrido de un pedido</span>
        {data.recorrido.map((r, i) => (
          <span key={r.texto} className="flex items-center gap-1.5">
            {i > 0 && <span style={{ color: C.accent }}>▸</span>}
            <span className="rounded-full border px-2 py-0.5" style={{ borderColor: C.line, background: C.surface }}>
              {r.texto} <i className="not-italic" style={{ color: C.muted }}>· {quien(r.etapa, r.funcion) || "—"}</i>
            </span>
          </span>
        ))}
      </div>
      {data.whatsapp?.chats != null && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border px-3 py-2 text-xs" style={{ borderColor: C.line, background: C.surface, color: C.ink2 }}>
          <span className="font-mono text-[10.5px] uppercase tracking-wider" style={{ color: "#2f8a6e" }}>WhatsApp con clientes</span>
          <span><b className="font-mono" style={{ color: C.ink }}>≈{data.whatsapp.chats}</b> chats/mes</span>
          <span><b className="font-mono" style={{ color: C.ink }}>≈{data.whatsapp.mensajes_clientes?.toLocaleString("es-CO")}</b> mensajes de clientes</span>
          <span><b className="font-mono" style={{ color: C.ink }}>≈{data.whatsapp.respuestas_humanas?.toLocaleString("es-CO")}</b> respuestas a mano</span>
          <span><b className="font-mono" style={{ color: C.ink }}>≈{data.whatsapp.respuestas_bot?.toLocaleString("es-CO")}</b> del bot</span>
          <span className="ml-auto flex gap-3">
            <Clave c={C.in} t="en el panel" /> <Clave c={C.out} t="cronómetro" /> <Clave c={C.anot} t="anotado a mano" />
          </span>
        </div>
      )}

      <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_400px]">
        {/* Matriz */}
        <div className="overflow-x-auto rounded-xl border" style={{ borderColor: C.line, background: C.surface }}>
          <table className="w-full min-w-[900px] table-fixed border-separate border-spacing-0 text-left">
            <colgroup>
              <col style={{ width: 170 }} />
              {data.etapas.map((e) => <col key={e.id} />)}
            </colgroup>
            <thead>
              <tr>
                <th className="border-b border-r p-0" style={{ borderColor: C.line, background: C.surface2 }}>
                  <button type="button" onClick={() => setSel({ tipo: "todo" })} className="block w-full px-2 py-1.5 text-left">
                    <span className="block font-mono text-[9.5px]" style={{ color: C.accent }}>TODO</span>
                    <b className="text-xs">Persona · Etapa</b>
                  </button>
                </th>
                {data.etapas.map((e, i) => (
                  <th key={e.id} className="border-b border-r p-0" style={{ borderColor: C.line, background: C.surface2, outline: sel.tipo === "etapa" && sel.etapa === e.id ? `2px solid ${C.accent}` : undefined, outlineOffset: -2 }}>
                    <button type="button" onClick={() => setSel({ tipo: "etapa", etapa: e.id })} className="block w-full px-2 py-1.5 text-left">
                      <span className="block font-mono text-[9.5px]" style={{ color: C.accent }}>{String(i + 1).padStart(2, "0")}</span>
                      <b className="text-xs leading-tight">{e.nombre}</b>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.personas.map((p) => {
                const t = p.carga.panel + p.carga.cronometro + p.carga.anotada || 1;
                const vale = p.valor_mes >= p.pago_hoy;
                return (
                  <tr key={p.usuario_id}>
                    <th className="border-b border-r p-0 align-top" style={{ borderColor: C.line, outline: sel.tipo === "persona" && sel.uid === p.usuario_id ? `2px solid ${C.accent}` : undefined, outlineOffset: -2 }}>
                      <button type="button" onClick={() => { setSel({ tipo: "persona", uid: p.usuario_id }); setFicha(p.usuario_id); }} className="flex w-full flex-col gap-1 px-2.5 py-2 text-left">
                        <b className="text-[15px] font-black leading-tight">{p.nombre.split(" ")[0]}</b>
                        <span className="text-[11px] leading-tight" style={{ color: C.ink2 }}>{p.rol || p.username}</span>
                        <span className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
                          {millones(p.valor_mes)}
                          {p.pago_hoy > 0 && (
                            <span className="rounded-full px-1.5 py-0.5 text-[10px]" style={{ background: vale ? C.upSoft : C.downSoft, color: vale ? C.up : C.down }}>
                              hoy {millones(p.pago_hoy)}
                            </span>
                          )}
                        </span>
                        <span className="flex h-1.5 overflow-hidden rounded" style={{ background: C.surface2 }}>
                          <i style={{ width: `${(p.carga.panel / t) * 100}%`, background: C.in }} />
                          <i style={{ width: `${(p.carga.cronometro / t) * 100}%`, background: C.out }} />
                          <i style={{ width: `${(p.carga.anotada / t) * 100}%`, background: C.anot }} />
                        </span>
                        <span className="text-[11px] font-semibold underline" style={{ color: C.accent }}>Ver ficha</span>
                      </button>
                    </th>
                    {data.etapas.map((e) => {
                      const fs = p.celdas[e.id] || [];
                      if (!fs.length)
                        return <td key={e.id} className="border-b border-r" style={{ borderColor: C.line, background: `repeating-linear-gradient(135deg,transparent 0 7px,${C.surface2} 7px 8px)` }} />;
                      const v = sumV(fs);
                      const a = Math.max(0.06, Math.min(0.85, (v / maxCelda) * 0.85));
                      const osc = a > 0.5;
                      const activa = sel.tipo === "celda" && sel.uid === p.usuario_id && sel.etapa === e.id;
                      return (
                        <td key={e.id} className="border-b border-r p-0 align-top" style={{ borderColor: C.line, background: `color-mix(in srgb, ${C.heat} ${Math.round(a * 100)}%, ${C.surface})`, outline: activa ? `2px solid ${C.accent}` : undefined, outlineOffset: -2 }}>
                          <button type="button" onClick={() => setSel({ tipo: "celda", uid: p.usuario_id, etapa: e.id })} className="flex min-h-[86px] w-full flex-col justify-between gap-1 px-2 py-1.5 text-left" style={{ color: osc ? "#fff" : C.ink }}>
                            <span className="font-mono text-[15px] tabular-nums">{Math.round(sumH(fs))}<small className="text-[10px] opacity-80"> h/mes</small></span>
                            <span className="font-mono text-[11px] opacity-90">{corto(v)}</span>
                            <span className="text-[10px] opacity-70">{fs.length}{" "}{fs.length === 1 ? "función" : "funciones"}</span>
                            <Mezcla fs={fs} />
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="border-r px-2 py-2 text-xs font-bold" style={{ borderColor: C.line, background: C.surface2 }}>Total por etapa</td>
                {data.etapas.map((e) => {
                  const fs = data.personas.flatMap((p) => p.celdas[e.id] || []);
                  return (
                    <td key={e.id} className="border-r px-2 py-2 font-mono" style={{ borderColor: C.line, background: C.surface2 }}>
                      <span className="block text-sm">{Math.round(sumH(fs))} h</span>
                      <span className="text-[11px]" style={{ color: C.ink2 }}>{corto(sumV(fs))}</span>
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
          <p className="flex flex-wrap gap-x-3 gap-y-1 border-t px-3 py-2 text-[11px]" style={{ borderColor: C.line, color: C.ink2 }}>
            Tono = valor de la casilla · barra = mezcla de niveles:
            {Object.entries(data.niveles).map(([n, nom]) => (
              <span key={n} className="inline-flex items-center gap-1">
                <i className="inline-block h-2 w-3.5 rounded-sm" style={{ background: NIV_COLOR[Number(n)] }} />N{n} {nom} ({pesos(data.tarifas[n] || 0)}/h)
              </span>
            ))}
          </p>
        </div>

        {/* Panel de detalle */}
        <Detalle data={data} sel={sel} onFicha={setFicha} onCambio={recargar} />
      </div>

      <p className="text-[11px]" style={{ color: C.muted }}>
        Valor = horas al mes × tarifa del nivel (escala interna para discutir). Las horas salen de lo que registra el panel: tareas con cronómetro y
        tiempo en cada módulo; lo que no se registra se anota a mano en la ficha de la persona. Quien desarrolla el sistema no «empaca»: su tiempo en
        esos apartados cuenta como trabajo sobre el módulo.
      </p>

      {ficha != null && (
        <Ficha p={data.personas.find((x) => x.usuario_id === ficha)!} data={data} onCerrar={() => setFicha(null)} onCambio={recargar} />
      )}
    </div>
  );
}

function Clave({ c, t }: { c: string; t: string }) {
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[10.5px]">
      <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c }} />
      {t}
    </span>
  );
}

function Mezcla({ fs }: { fs: Funcion[] }) {
  const t = sumH(fs) || 1;
  const por: Record<number, number> = {};
  fs.forEach((f) => (por[f.nivel] = (por[f.nivel] || 0) + f.horas));
  return (
    <span className="flex h-[5px] gap-px overflow-hidden rounded">
      {[1, 2, 3, 4, 5].filter((n) => por[n]).map((n) => <i key={n} style={{ width: `${(por[n] / t) * 100}%`, background: NIV_COLOR[n] }} />)}
    </span>
  );
}

function FilaFuncion({ f, quien }: { f: Funcion; quien?: string }) {
  const [abierta, setAbierta] = useState(false);
  return (
    <div className="border-b" style={{ borderColor: C.line }}>
      <button type="button" onClick={() => setAbierta(!abierta)} className="grid w-full grid-cols-[6px_minmax(0,1fr)_auto] items-center gap-2 px-1.5 py-2 text-left" style={{ background: abierta ? C.surface2 : undefined }}>
        <span className="self-stretch rounded" style={{ background: NIV_COLOR[f.nivel] }} />
        <span className="min-w-0">
          <b className="block text-[12.5px] leading-tight">{f.funcion}</b>
          <span className="font-mono text-[11px]" style={{ color: C.ink2 }}>
            {quien ? `${quien} · ` : ""}{f.promedio_min != null ? `⏱ ${dur(f.promedio_min)}` : f.manual ? "anotada" : "continuo"}
            {f.veces ? ` · ${f.veces}×` : ""} · {f.horas.toLocaleString("es-CO")} h/mes
          </span>
        </span>
        <span className="flex flex-col items-end gap-1 font-mono text-xs font-semibold">
          {pesos(f.valor)}
          <span className="rounded px-1 py-0.5 text-[10px]" style={{ background: NIV_COLOR[f.nivel], color: NIV_INK[f.nivel] }}>N{f.nivel}</span>
        </span>
      </button>
      {abierta && (
        <div className="px-5 pb-2 text-xs" style={{ color: C.ink2 }}>
          {f.implica} · tarifa {pesos(f.tarifa)}/h · dato: {f.fuente}
        </div>
      )}
    </div>
  );
}

function Detalle({ data, sel, onFicha, onCambio }: { data: Mapa; sel: Sel; onFicha: (uid: number) => void; onCambio: () => void }) {
  let titulo = "Todas las funciones";
  let sub = "Ordenadas por valor al mes";
  let grupos: { g: string; filas: { f: Funcion; quien?: string }[] }[] = [];
  const persona = sel.tipo === "persona" || sel.tipo === "celda" ? data.personas.find((p) => p.usuario_id === sel.uid) : undefined;
  if (sel.tipo === "celda" && persona) {
    const e = data.etapas.find((x) => x.id === sel.etapa)!;
    titulo = `${persona.nombre.split(" ")[0]} · ${e.nombre}`;
    sub = persona.rol;
    grupos = [{ g: "", filas: (persona.celdas[sel.etapa] || []).map((f) => ({ f })) }];
  } else if (sel.tipo === "persona" && persona) {
    titulo = persona.nombre;
    sub = `${persona.rol} · usuario ${persona.username}`;
    grupos = data.etapas.map((e) => ({ g: e.nombre, filas: (persona.celdas[e.id] || []).map((f) => ({ f })) })).filter((x) => x.filas.length);
  } else if (sel.tipo === "etapa") {
    const e = data.etapas.find((x) => x.id === sel.etapa)!;
    titulo = e.nombre;
    sub = "Todas las personas que participan en esta etapa";
    grupos = data.personas.map((p) => ({ g: p.nombre, filas: (p.celdas[e.id] || []).map((f) => ({ f })) })).filter((x) => x.filas.length);
  } else {
    grupos = [{
      g: "",
      filas: data.personas
        .flatMap((p) => data.etapas.flatMap((e) => (p.celdas[e.id] || []).map((f) => ({ f, quien: `${p.nombre.split(" ")[0]} · ${e.nombre}` }))))
        .sort((a, b) => b.f.valor - a.f.valor),
    }];
  }
  const todas = grupos.flatMap((g) => g.filas.map((x) => x.f));
  return (
    <aside className="flex max-h-[calc(100vh-150px)] min-h-[420px] flex-col rounded-xl border xl:sticky xl:top-3" style={{ borderColor: C.line, background: C.surface }}>
      <div className="space-y-1.5 border-b px-3.5 py-3" style={{ borderColor: C.line }}>
        <h4 className="text-base font-black">{titulo}</h4>
        <p className="text-xs" style={{ color: C.ink2 }}>{sub}</p>
        <div className="grid grid-cols-3 gap-1.5">
          {[[String(todas.length), "funciones"], [`${Math.round(sumH(todas))} h`, "al mes"], [corto(sumV(todas)), "valor al mes"]].map(([n, t]) => (
            <div key={t} className="rounded-lg px-2 py-1" style={{ background: C.surface2 }}>
              <b className="block font-mono text-sm">{n}</b>
              <span className="text-[10.5px]" style={{ color: C.muted }}>{t}</span>
            </div>
          ))}
        </div>
        {persona?.mercado && (
          <p className="text-[11.5px]" style={{ color: C.ink2 }}>
            Mercado ({persona.mercado.cargo}): {millones(persona.mercado.honorario_min)}–{millones(persona.mercado.honorario_max)} en honorarios · hoy {millones(persona.pago_hoy)}
          </p>
        )}
        {persona && (
          <button type="button" onClick={() => onFicha(persona.usuario_id)} className="w-full rounded-lg px-3 py-2 text-sm font-bold text-white" style={{ background: C.accent }}>
            Abrir ficha en letra grande
          </button>
        )}
      </div>
      <div className="overflow-y-auto px-2 pb-3">
        {grupos.map((g) => (
          <div key={g.g || "todo"}>
            {g.g && (
              <p className="px-1.5 pb-1 pt-2.5 font-mono text-[11px] font-semibold uppercase tracking-wider" style={{ color: C.accent }}>
                {g.g} · {Math.round(sumH(g.filas.map((x) => x.f)))} h · {corto(sumV(g.filas.map((x) => x.f)))}
              </p>
            )}
            {g.filas.map((x) => <FilaFuncion key={(x.quien || "") + x.f.id} f={x.f} quien={x.quien} />)}
          </div>
        ))}
        {sel.tipo === "persona" && persona && <Anotar p={persona} data={data} onCambio={onCambio} />}
      </div>
    </aside>
  );
}

function Anotar({ p, data, onCambio }: { p: Persona; data: Mapa; onCambio: () => void }) {
  const [f, setF] = useState("");
  const [h, setH] = useState("");
  const [n, setN] = useState(2);
  const [e, setE] = useState("dirigir");
  const [msg, setMsg] = useState("");
  const extras = Object.values(p.celdas).flat().filter((x) => x.manual);
  async function agregar(ev: React.FormEvent) {
    ev.preventDefault();
    try {
      await api.post("/api/rrhh/mapa-funciones/extras", { usuario_id: p.usuario_id, funcion: f, horas_semana: Number(h), nivel: n, etapa: e });
      setF(""); setH(""); setMsg("Agregada.");
      onCambio();
    } catch (err) {
      setMsg(String((err as Error).message || err));
    }
  }
  async function quitar(id: string) {
    await api.delete(`/api/rrhh/mapa-funciones/extras/${id}`).catch(() => undefined);
    onCambio();
  }
  return (
    <div className="mt-3 space-y-2 rounded-xl border p-2.5" style={{ borderColor: C.line, background: C.surface2 }}>
      <b className="text-xs">Funciones que el panel no registra</b>
      {extras.map((x) => (
        <div key={x.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1 text-xs" style={{ background: C.surface }}>
          <span>{x.funcion} · {x.horas} h/mes · N{x.nivel}</span>
          <button type="button" onClick={() => x.extra_id && void quitar(x.extra_id)} className="text-[11px] underline" style={{ color: C.down }}>Quitar</button>
        </div>
      ))}
      <form onSubmit={agregar} className="grid grid-cols-[minmax(0,1fr)_64px] gap-1.5 text-xs">
        <input value={f} onChange={(ev) => setF(ev.target.value)} placeholder="Qué hace (p. ej. atiende proveedores por teléfono)" required maxLength={120} className="rounded-md border px-2 py-1" style={{ borderColor: C.line, background: C.surface }} aria-label="Función" />
        <input value={h} onChange={(ev) => setH(ev.target.value)} type="number" min={0.5} max={60} step={0.5} placeholder="h/sem" required className="rounded-md border px-2 py-1" style={{ borderColor: C.line, background: C.surface }} aria-label="Horas por semana" />
        <select value={n} onChange={(ev) => setN(Number(ev.target.value))} className="rounded-md border px-1 py-1" style={{ borderColor: C.line, background: C.surface }} aria-label="Nivel">
          {Object.entries(data.niveles).map(([k, v]) => <option key={k} value={k}>N{k} {v}</option>)}
        </select>
        <select value={e} onChange={(ev) => setE(ev.target.value)} className="rounded-md border px-1 py-1" style={{ borderColor: C.line, background: C.surface }} aria-label="Etapa">
          {data.etapas.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
        </select>
        <button type="submit" className="col-span-2 rounded-md px-2 py-1.5 font-bold text-white" style={{ background: C.accent }}>Agregar</button>
      </form>
      {msg && <p className="text-[11px]" style={{ color: C.muted }}>{msg}</p>}
    </div>
  );
}

function horasTexto(h: number) {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return hh ? `${hh} hora${hh === 1 ? "" : "s"}${mm ? ` y ${mm} minutos` : ""}` : `${mm} minutos`;
}

function Ficha({ p, data, onCerrar, onCambio }: { p: Persona; data: Mapa; onCerrar: () => void; onCambio: () => void }) {
  const [grande, setGrande] = useState(() => {
    try { return localStorage.getItem("mck-ficha-grande") === "1"; } catch { return false; }
  });
  const [editar, setEditar] = useState(false);
  const ticketsToken = useTicketsAuth((st) => st.token);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = prev; };
  }, [onCerrar]);
  const todas = useMemo(
    () => data.etapas.flatMap((e) => (p.celdas[e.id] || []).map((f) => ({ ...f, etapa: e.nombre }))).sort((a, b) => b.horas - a.horas),
    [p, data],
  );
  const fs = grande ? 24 : 20;
  const dif = p.horas_mes - p.horas_pagadas;
  const max = Math.max(p.horas_mes, p.horas_pagadas, data.jornada, 1);
  const top = todas.slice(0, 10);
  const resto = todas.slice(10).reduce((a, f) => a + f.horas, 0);
  const propuesta = p.comision ? p.comision.fijo + p.comision.promedio + p.comision.bono : p.propuesta;
  const barra = (lab: string, h: number, col: string) => (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span>{lab}</span>
        <span className="font-semibold tabular-nums">{Math.round(h)} h</span>
      </div>
      <span className="mt-1 block h-6 overflow-hidden rounded-full" style={{ background: C.surface2 }}>
        <span className="block h-full rounded-full" style={{ width: `${(h / max) * 100}%`, background: col }} />
      </span>
    </div>
  );
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto p-3 sm:p-6" style={{ background: "rgba(43,33,25,.5)" }} onClick={onCerrar} role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="mf-ficha" onClick={(e) => e.stopPropagation()} className="w-full max-w-[880px] rounded-2xl p-5 shadow-2xl sm:p-8" style={{ background: "#fffdf9", color: "#1f1711", fontSize: fs, lineHeight: 1.5 }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 id="mf-ficha" className="font-black leading-tight" style={{ fontSize: fs * 1.8 }}>{p.nombre}</h2>
            <p style={{ color: "#4a3b2e", fontSize: fs * 0.85 }}>{p.rol} · usuario <b>{p.username}</b></p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={grande} onClick={() => { const n = !grande; setGrande(n); try { localStorage.setItem("mck-ficha-grande", n ? "1" : "0"); } catch { /* sin almacenamiento */ } }} className="rounded-xl border-2 px-4 py-3 font-bold" style={{ borderColor: "#1f1711", fontSize: fs * 0.8, minHeight: 52 }}>
              {grande ? "Letra normal" : "Letra más grande"}
            </button>
            <button type="button" autoFocus onClick={onCerrar} className="rounded-xl px-4 py-3 font-bold" style={{ background: "#1f1711", color: "#fffdf9", fontSize: fs * 0.8, minHeight: 52 }}>Cerrar ficha</button>
          </div>
        </div>

        {p.pago_hoy > 0 && (
          <p className="mt-5 rounded-2xl border-2 p-4" style={Math.abs(dif) < 8 ? { background: C.surface2, borderColor: C.muted } : dif > 0 ? { background: "#e6f1dc", borderColor: "#3f7a2e", color: "#1e4a14" } : { background: "#fbe6da", borderColor: "#a4471d", color: "#6e2a0c" }}>
            {Math.abs(dif) < 8 ? "Trabaja más o menos las mismas horas que se le pagan." : dif > 0 ? <><b>Trabaja {Math.round(dif)} horas al mes más</b> de las que cubre su pago.</> : <><b>Se le pagan {Math.round(-dif)} horas al mes más</b> de las que quedan registradas.</>}
          </p>
        )}

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {[[Math.round(p.horas_mes), "horas que trabaja al mes"], [Math.round(p.horas_pagadas), "horas que cubre su pago"], [data.jornada, "horas de una jornada completa"]].map(([n, t]) => (
            <div key={String(t)} className="rounded-2xl border-2 p-4" style={{ borderColor: C.line }}>
              <b className="block font-semibold tabular-nums" style={{ fontSize: fs * 1.8, lineHeight: 1.05 }}>{n}</b>
              <span style={{ color: "#4a3b2e", fontSize: fs * 0.8 }}>{t}</span>
            </div>
          ))}
        </div>
        <div className="mt-5 space-y-3">
          {barra("Trabaja", p.horas_mes, C.accent)}
          {barra("Se le paga", p.horas_pagadas, "#df9f55")}
          {barra("Jornada", data.jornada, "#cdbba4")}
        </div>

        {ticketsToken && <HorasEnFicha token={ticketsToken} usuarioId={p.usuario_id} fs={fs} conEstandar />}

        <h3 className="mt-8 font-bold" style={{ fontSize: fs * 1.15 }}>¿En qué se le va el tiempo cada mes?</h3>
        <ol className="mt-2">
          {top.map((f) => (
            <li key={f.id} className="grid gap-x-4 border-b-2 py-3" style={{ borderColor: C.surface2, gridTemplateColumns: "minmax(0,1fr) auto" }}>
              <span className="font-semibold">{f.funcion}</span>
              <span className="text-right font-semibold tabular-nums">{Math.round(f.horas)} h</span>
              <span className="col-span-2" style={{ color: "#4a3b2e", fontSize: fs * 0.8 }}>
                {f.etapa} · {f.veces ? `lo hizo ${f.veces} ${f.veces === 1 ? "vez" : "veces"} · ` : ""}
                {f.manual ? "anotada a mano" : f.promedio_min == null ? "trabajo continuo, no se mide por vez" : `cada vez tarda ${f.promedio_min >= 60 ? horasTexto(f.promedio_min / 60) : `${f.promedio_min} minutos`}`}
              </span>
            </li>
          ))}
          {resto >= 0.5 && (
            <li className="grid gap-x-4 py-3" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
              <span className="font-semibold">Otras tareas más pequeñas</span>
              <span className="text-right font-semibold tabular-nums">{Math.round(resto)} h</span>
            </li>
          )}
        </ol>

        <h3 className="mt-8 font-bold" style={{ fontSize: fs * 1.15 }}>Tipo de trabajo</h3>
        <div className="mt-3 space-y-3">
          {p.tipos.map((t) => (
            <div key={t.nivel}>
              <div className="flex items-baseline justify-between gap-3">
                <span>{t.nombre}</span>
                <span className="font-semibold tabular-nums">{t.porcentaje}%</span>
              </div>
              <span className="mt-1 block h-6 overflow-hidden rounded-full" style={{ background: C.surface2 }}>
                <span className="block h-full rounded-full" style={{ width: `${t.porcentaje}%`, background: NIV_COLOR[t.nivel] }} />
              </span>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold" style={{ fontSize: fs * 1.15 }}>Pago</h3>
          <button type="button" onClick={() => setEditar(!editar)} className="rounded-xl border-2 px-3 py-2 font-bold" style={{ borderColor: "#1f1711", fontSize: fs * 0.7 }}>{editar ? "Cerrar edición" : "Editar pago"}</button>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {[[millones(p.pago_hoy), "recibe hoy al mes"], [millones(p.valor_mes), "valen sus funciones al mes"], [millones(propuesta), p.comision ? "propuesta (fijo + comisión + bono)" : "propuesta"]].map(([n, t]) => (
            <div key={t} className="rounded-2xl p-4" style={{ background: C.bg }}>
              <b className="block font-mono font-semibold" style={{ fontSize: fs * 1.4 }}>{n}</b>
              <span style={{ color: "#4a3b2e", fontSize: fs * 0.8 }}>{t}</span>
            </div>
          ))}
        </div>
        {p.comision && (
          <p className="mt-3" style={{ fontSize: fs * 0.8, color: "#4a3b2e" }}>
            Comisión {p.comision.pct} % sobre ventas de WhatsApp: promedio {pesos(p.comision.promedio)} al mes (base {pesos(p.comision.base_promedio)}); este mes van {pesos(p.comision.mes_actual)} según Cotizar/Facturar.
          </p>
        )}
        {p.razon && <p className="mt-2" style={{ fontSize: fs * 0.8, color: "#4a3b2e" }}>{p.razon}</p>}

        {p.mercado && (
          <>
            <h3 className="mt-8 font-bold" style={{ fontSize: fs * 1.15 }}>¿Cuánto vale en el mercado?</h3>
            <p className="mt-1" style={{ fontSize: fs * 0.85, color: "#4a3b2e" }}>Cargo comparable: <b>{p.mercado.cargo}</b></p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {[
                [`${millones(p.mercado.min)} – ${millones(p.mercado.max)}`, "salario de un empleado de tiempo completo"],
                [`${millones(p.mercado.honorario_min)} – ${millones(p.mercado.honorario_max)}`, "lo mismo, llevado a honorarios"],
                [`${millones(p.mercado.por_sus_horas_min)} – ${millones(p.mercado.por_sus_horas_max)}`, `por las ${Math.round(Math.min(p.horas_mes, p.mercado.horas_referencia))} horas que registra`],
              ].map(([n, t]) => (
                <div key={t} className="rounded-2xl p-4" style={{ background: C.bg }}>
                  <b className="block font-mono font-semibold" style={{ fontSize: fs * 1.05 }}>{n}</b>
                  <span style={{ color: "#4a3b2e", fontSize: fs * 0.8 }}>{t}</span>
                </div>
              ))}
            </div>
            {(() => {
              const lo = p.mercado!.honorario_min, hi = p.mercado!.honorario_max, x = p.pago_hoy;
              const est = x < lo ? { t: `Recibe menos que el mercado: ${millones(lo - x)} por debajo del mínimo del rango.`, s: { background: "#fbe6da", borderColor: "#a4471d", color: "#6e2a0c" } }
                : x > hi ? { t: `Recibe más que el mercado: ${millones(x - hi)} por encima del máximo del rango.`, s: { background: "#e6f1dc", borderColor: "#3f7a2e", color: "#1e4a14" } }
                : { t: "Recibe lo que paga el mercado por un cargo así a tiempo completo.", s: { background: C.surface2, borderColor: C.muted } };
              return x > 0 ? <p className="mt-3 rounded-2xl border-2 p-4" style={est.s}>{est.t}</p> : null;
            })()}
            <p className="mt-2" style={{ fontSize: fs * 0.7, color: "#5e4e40" }}>
              {p.mercado.fuente} Un empleado recibe además prima, cesantías, intereses y vacaciones (21,8 %) y el auxilio de transporte si gana hasta 2 salarios mínimos; quien cobra por honorarios no los recibe y paga su propia seguridad social (≈11,6 %). Por eso el valor en honorarios es mayor que el salario.
            </p>
          </>
        )}
        {editar && <EditarPago p={p} fs={fs} onGuardado={() => { setEditar(false); onCambio(); }} />}

        <p className="mt-8" style={{ color: "#5e4e40", fontSize: fs * 0.72 }}>
          {p.nota} Tarifa promedio de sus funciones: {pesos(p.tarifa_media)} por hora; las horas pagadas son su pago dividido por esa tarifa.
        </p>
      </div>
    </div>
  );
}

function EditarPago({ p, fs, onGuardado }: { p: Persona; fs: number; onGuardado: () => void }) {
  const [v, setV] = useState({
    pago_hoy: String(p.pago_hoy || ""),
    propuesta: String(p.propuesta || ""),
    rol: p.rol,
    razon: p.razon,
    comision: !!p.comision,
    colectas: !!p.colectas,
    fijo: String(p.comision?.fijo || ""),
    bono: String(p.comision?.bono || ""),
  });
  const [msg, setMsg] = useState("");
  const campo = "w-full rounded-lg border-2 px-3 py-2";
  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.put(`/api/rrhh/mapa-funciones/persona/${p.usuario_id}`, {
        pago_hoy: Number(v.pago_hoy || 0), propuesta: Number(v.propuesta || 0), rol: v.rol, razon: v.razon,
        comision: v.comision, colectas: v.colectas, fijo: Number(v.fijo || 0), bono: Number(v.bono || 0),
      });
      onGuardado();
    } catch (err) {
      setMsg(String((err as Error).message || err));
    }
  }
  return (
    <form onSubmit={guardar} className="mt-4 grid gap-3 rounded-2xl border-2 p-4 sm:grid-cols-2" style={{ borderColor: C.line, fontSize: fs * 0.8 }}>
      <label className="flex flex-col gap-1">Pago de hoy (neto al mes)<input className={campo} style={{ borderColor: C.line }} type="number" min={0} step={1000} value={v.pago_hoy} onChange={(e) => setV({ ...v, pago_hoy: e.target.value })} /></label>
      <label className="flex flex-col gap-1">Propuesta<input className={campo} style={{ borderColor: C.line }} type="number" min={0} step={1000} value={v.propuesta} onChange={(e) => setV({ ...v, propuesta: e.target.value })} /></label>
      <label className="flex flex-col gap-1 sm:col-span-2">Rol<input className={campo} style={{ borderColor: C.line }} value={v.rol} maxLength={120} onChange={(e) => setV({ ...v, rol: e.target.value })} /></label>
      <label className="flex flex-col gap-1 sm:col-span-2">Por qué<textarea className={campo} style={{ borderColor: C.line }} rows={3} value={v.razon} maxLength={600} onChange={(e) => setV({ ...v, razon: e.target.value })} /></label>
      <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" checked={v.colectas} onChange={(e) => setV({ ...v, colectas: e.target.checked })} className="h-5 w-5" /> Atiende colectas de Mercado Libre (disponible de lunes a viernes)</label>
      <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" checked={v.comision} onChange={(e) => setV({ ...v, comision: e.target.checked })} className="h-5 w-5" /> Tiene comisión por ventas de WhatsApp</label>
      {v.comision && (
        <>
          <label className="flex flex-col gap-1">Parte fija<input className={campo} style={{ borderColor: C.line }} type="number" min={0} step={1000} value={v.fijo} onChange={(e) => setV({ ...v, fijo: e.target.value })} /></label>
          <label className="flex flex-col gap-1">Bono por metas<input className={campo} style={{ borderColor: C.line }} type="number" min={0} step={1000} value={v.bono} onChange={(e) => setV({ ...v, bono: e.target.value })} /></label>
        </>
      )}
      <button type="submit" className="rounded-xl px-4 py-3 font-bold sm:col-span-2" style={{ background: "#1f1711", color: "#fffdf9" }}>Guardar</button>
      {msg && <p className="sm:col-span-2" style={{ color: C.down }}>{msg}</p>}
    </form>
  );
}
