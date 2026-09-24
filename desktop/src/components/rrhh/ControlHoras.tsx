import { Fragment, useState } from "react";
import { MisDias } from "../MiQuincena";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";

/**
 * Control de horas por quincena (RRHH): horas activas de cada persona frente a las
 * pactadas (pago ÷ valor hora de mercado), explicaciones de tiempo por aprobar y la
 * cuenta de cobro sugerida por las horas de más. Datos: /api/rrhh/control-horas*.
 */

type Persona = {
  usuario: { id: number; nombre: string; username: string };
  quincena: { clave: string; desde: string; hasta: string };
  horas_activas: number;
  horas_explicadas: number;
  horas: number;
  pactadas?: number;
  faltan?: number;
  de_mas?: number;
  al_dia?: number;
  valor_hora?: number;
  valor_hora_adicional?: number;
  recargo_pct?: number;
  valor_de_mas?: number;
  valor_faltante?: number;
  ganadas?: { horas: number; tareas_resueltas: number };
  dias?: { fecha: string; dia_semana: number; horas: number; meta: number; diferencia: number; hoy: boolean }[];
};
type Pendiente = { id: string; usuario_id: number; nombre: string; fecha: string; horas: number; descripcion: string };
type Cuenta = { concepto: string; valor: number; horas_de_mas: number; valor_hora: number; cerrada: boolean; quincena: { desde: string; hasta: string } };

const pesos = (v: number) => "$" + Math.round(v || 0).toLocaleString("es-CO");
function clave(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getDate() <= 15 ? "Q1" : "Q2"}`;
}
function anterior(k: string) {
  const [a, m, q] = k.split("-");
  if (q === "Q2") return `${a}-${m}-Q1`;
  const d = new Date(Number(a), Number(m) - 2, 20);
  return clave(d);
}

export default function ControlHoras() {
  const qc = useQueryClient();
  const actual = clave(new Date());
  const [q, setQ] = useState(actual);
  const { data, isLoading } = useQuery({
    queryKey: ["rrhh-control-horas", q],
    queryFn: () => api.get<{ personas: Persona[]; pendientes: Pendiente[] }>(`/api/rrhh/control-horas?quincena=${q}`, { timeoutMs: 60000 }),
  });
  const [cuenta, setCuenta] = useState<(Cuenta & { nombre: string }) | null>(null);
  const [abierta, setAbierta] = useState<number | null>(null);

  async function revisar(id: string, aprobar: boolean) {
    await api.post(`/api/rrhh/control-horas/explicaciones/${id}`, { aprobar }).catch(() => undefined);
    void qc.invalidateQueries({ queryKey: ["rrhh-control-horas"] });
  }
  async function verCuenta(p: Persona) {
    const c = await api.get<Cuenta>(`/api/rrhh/control-horas/cuenta-cobro?usuario_id=${p.usuario.id}&quincena=${q}`);
    setCuenta({ ...c, nombre: p.usuario.nombre });
  }

  const opciones = [actual, anterior(actual), anterior(anterior(actual)), anterior(anterior(anterior(actual)))];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-ink">Control de horas por quincena</h3>
          <p className="text-sm text-muted">
            Lo que se pide es completar las horas convenidas, no la rapidez; lo que se haga después son horas adicionales, con su propio valor.
            Horas pactadas = pago de la quincena ÷ valor hora de mercado de su labor. Horas activas: bloques de 15 min con actividad en el panel, tareas
            con cronómetro y sesiones de desarrollo con IA, sin contar dos veces; más el tiempo explicado y aprobado.
          </p>
        </div>
        <select value={q} onChange={(e) => setQ(e.target.value)} className="rounded-lg border border-border bg-surface-panel px-3 py-2 text-sm" aria-label="Quincena">
          {opciones.map((o) => (
            <option key={o} value={o}>{o.replace("-Q1", " · 1ª quincena").replace("-Q2", " · 2ª quincena")}</option>
          ))}
        </select>
      </div>

      {data && data.pendientes.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-900/20">
          <p className="mb-2 text-sm font-bold text-ink">Tiempo explicado por aprobar ({data.pendientes.length})</p>
          <ul className="space-y-2">
            {data.pendientes.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-panel p-2 text-sm">
                <span className="min-w-0">
                  <b>{x.nombre}</b> · {x.fecha} · {x.horas} h
                  <span className="block text-muted">{x.descripcion}</span>
                </span>
                <span className="flex gap-2">
                  <button type="button" onClick={() => void revisar(x.id, true)} className="rounded-lg bg-emerald-600 px-3 py-1.5 font-bold text-white">Aprobar</button>
                  <button type="button" onClick={() => void revisar(x.id, false)} className="rounded-lg border border-border px-3 py-1.5 font-bold">No aprobar</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted">Calculando…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-surface-hover text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2">Persona</th>
                <th className="px-3 py-2 text-right">Horas activas</th>
                <th className="px-3 py-2 text-right">Explicadas</th>
                <th className="px-3 py-2 text-right" title="Ejecuciones con cronómetro × tiempo estándar medido, más tareas sin cronómetro por su tiempo real">Tiempo estándar</th>
                <th className="px-3 py-2 text-right">Pactadas</th>
                <th className="px-3 py-2 text-right">Diferencia</th>
                <th className="px-3 py-2 text-right">Valor hora / adicional</th>
                <th className="px-3 py-2 text-right" title="Horas adicionales × valor de la hora adicional">Valor adicionales</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data?.personas.map((p) => {
                const dif = p.pactadas != null ? p.horas - p.pactadas : null;
                return (
                  <Fragment key={p.usuario.id}>
                  <tr>
                    <td className="px-3 py-2">
                      <button type="button" onClick={() => setAbierta(abierta === p.usuario.id ? null : p.usuario.id)} className="text-left" aria-expanded={abierta === p.usuario.id}>
                        <b>{abierta === p.usuario.id ? "▾" : "▸"} {p.usuario.nombre}</b> <span className="text-xs text-muted">{p.usuario.username}</span>
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.horas_activas.toFixed(1)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.horas_explicadas ? p.horas_explicadas.toFixed(1) : "–"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.ganadas ? `${p.ganadas.horas.toFixed(1)} (${p.ganadas.tareas_resueltas})` : "–"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.pactadas != null ? p.pactadas.toFixed(1) : "sin pactar"}</td>
                    <td className={`px-3 py-2 text-right font-semibold tabular-nums ${dif == null ? "" : dif >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>
                      {dif == null ? "–" : `${dif >= 0 ? "+" : ""}${dif.toFixed(1)} h`}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.valor_hora ? `${pesos(p.valor_hora)} / ${pesos(p.valor_hora_adicional || p.valor_hora)}` : "–"}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{p.valor_de_mas ? pesos(p.valor_de_mas) : "–"}</td>
                    <td className="px-3 py-2 text-right">
                      {(p.de_mas ?? 0) > 0 && (
                        <button type="button" onClick={() => void verCuenta(p)} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-white">Cuenta de cobro</button>
                      )}
                    </td>
                  </tr>
                  {abierta === p.usuario.id && p.dias && (
                    <tr><td colSpan={9} className="bg-surface-hover/40 px-4 pb-3"><MisDias dias={p.dias} abierto /></td></tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <ValorAdicionales />
      <Estandares />
      <p className="text-xs text-muted">
        Lo que falta no se descuenta solo: el trabajo físico sin tarea abierta no queda registrado; para eso está «Explicar tiempo no registrado» en la
        Agenda. Sin horario de entrada ni salida: es dedicación pactada, no control de horario.
      </p>

      {cuenta && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={() => setCuenta(null)} role="presentation">
          <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} className="w-full max-w-lg space-y-3 rounded-2xl bg-surface-panel p-5 text-ink shadow-2xl">
            <h4 className="text-lg font-bold">Cuenta de cobro sugerida · {cuenta.nombre}</h4>
            {!cuenta.cerrada && <p className="rounded-lg bg-amber-100 p-2 text-sm text-amber-900">La quincena todavía no termina: el valor puede subir.</p>}
            <p className="text-3xl font-black tabular-nums">{pesos(cuenta.valor)}</p>
            <p className="text-sm">{cuenta.concepto}</p>
            <p className="text-xs text-muted">
              Se registra como solicitud de pago de «asesoría técnica» (511035, ReteICA a cargo de McKenna) con su documento soporte, igual que los honorarios de la quincena.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => void navigator.clipboard?.writeText(`${cuenta.concepto}. Valor: ${pesos(cuenta.valor)}`).catch(() => undefined)} className="rounded-lg border border-border px-3 py-2 text-sm font-bold">Copiar concepto</button>
              <button type="button" onClick={() => setCuenta(null)} className="rounded-lg bg-ink px-3 py-2 text-sm font-bold text-surface-panel">Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type Estandar = { id: string; funcion: string; minutos: number | null; muestras: number; origen: string; minutos_por_unidad?: number; unidad?: string };

/** Tiempos estándar por función: mediana de lo cronometrado por el equipo (o estimado si hay pocas muestras). */
function Estandares() {
  const [ver, setVer] = useState(false);
  const { data } = useQuery({
    queryKey: ["rrhh-tiempos-estandar"],
    queryFn: () => api.get<{ estandares: Estandar[]; dias_base: number; min_muestras: number }>("/api/rrhh/tiempos-estandar"),
    enabled: ver,
  });
  const min = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, "0")}` : `${Math.round(m)} min`);
  return (
    <div className="rounded-xl border border-border p-3">
      <button type="button" onClick={() => setVer(!ver)} className="text-sm font-bold text-accent underline" aria-expanded={ver}>
        {ver ? "Ocultar tiempos estándar" : "Ver tiempos estándar por función"}
      </button>
      {ver && data && (
        <>
          <p className="mt-2 text-xs text-muted">
            Mediana de lo que tardó el equipo cada vez que hizo la tarea con cronómetro, en los últimos {data.dias_base} días (mínimo {data.min_muestras} veces).
            No hay tiempos estimados a mano. Cada ejecución con cronómetro cuenta a su tiempo estándar; una tarea cerrada sin cronómetro cuenta el tiempo
            real desde la acción anterior de la persona en el panel (máximo 30 min), porque muchas se cierran en tandas de segundos.
          </p>
          <table className="mt-2 w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr><th className="py-1">Función</th><th className="py-1 text-right">Por vez</th><th className="py-1 text-right">Por unidad</th><th className="py-1 text-right">Muestras</th><th className="py-1 text-right">Origen</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.estandares.map((e) => (
                <tr key={e.id}>
                  <td className="py-1">{e.funcion}</td>
                  <td className="py-1 text-right tabular-nums">{e.minutos != null ? min(e.minutos) : "–"}</td>
                  <td className="py-1 text-right tabular-nums">{e.minutos_por_unidad ? `${e.minutos_por_unidad.toLocaleString("es-CO")} min/${e.unidad}` : "–"}</td>
                  <td className="py-1 text-right tabular-nums">{e.muestras || "–"}</td>
                  <td className={`py-1 text-right ${e.origen === "estimado" ? "text-amber-700 dark:text-amber-400" : ""}`}>{e.origen}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

/** Valor de las horas adicionales: recargo sobre el valor hora de mercado (0 % = el mismo valor). */
function ValorAdicionales() {
  const qc = useQueryClient();
  const [recargo, setRecargo] = useState("");
  const [msg, setMsg] = useState("");
  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.put("/api/rrhh/mapa-funciones/general", { horas_adicionales: { recargo_pct: Number(recargo || 0), requieren_aprobacion: true } });
      setMsg("Guardado.");
      void qc.invalidateQueries({ queryKey: ["rrhh-control-horas"] });
    } catch (err) {
      setMsg(String((err as Error).message || err));
    }
  }
  return (
    <form onSubmit={guardar} className="flex flex-wrap items-end gap-2 rounded-xl border border-border p-3 text-sm">
      <label className="flex flex-col gap-1">
        <span className="font-bold">Valor de las horas adicionales</span>
        <span className="text-xs text-muted">Recargo sobre el valor hora de mercado de cada persona (0 % = mismo valor; 25 % = un cuarto más).</span>
        <input type="number" min={-50} max={200} step={5} value={recargo} onChange={(e) => setRecargo(e.target.value)} placeholder="0" className="w-28 rounded-lg border border-border bg-surface-panel px-2 py-1" aria-label="Recargo en porcentaje" />
      </label>
      <button type="submit" className="rounded-lg bg-accent px-3 py-1.5 font-bold text-white">Guardar</button>
      {msg && <span className="text-xs text-muted">{msg}</span>}
    </form>
  );
}
