import { useCallback, useEffect, useState } from "react";

/**
 * «Mi quincena» en la Agenda: horas activas de la quincena frente a las pactadas y
 * las de hoy, para que cada quien sepa si con lo que hizo alcanza o le faltan un par
 * de horas. Es autogestión (prestación de servicios): no hay horario de entrada ni de
 * salida. El tiempo que el panel no registró se explica y administración lo aprueba.
 * Datos: GET /api/tickets/control-horas (app/services/control_horas.py). Sin dinero.
 */

type Explicacion = { id: string; fecha: string; horas: number; descripcion: string; estado: "pendiente" | "aprobada" | "rechazada" };
export type Estado = {
  quincena: { clave: string; desde: string; hasta: string; dias_habiles: number; dias_habiles_pasados: number };
  horas_activas: number;
  horas_explicadas: number;
  horas: number;
  pactadas?: number;
  faltan?: number;
  de_mas?: number;
  al_dia?: number;
  hoy?: { horas: number; meta: number; faltan: number };
  dias?: { fecha: string; dia_semana: number; horas: number; meta: number; diferencia: number; hoy: boolean }[];
  ganadas?: { horas: number; tareas_resueltas: number; sin_estandar: number; funciones: { id: string; funcion: string; veces: number; veces_huella: number; horas: number; estandar_min: number | null }[] };
  promedio?: { dias_habiles: number; horas_dia_habil: number | null; cubre_por_dia: number; dias_completos: number; horas_fin_de_semana: number };
  explicaciones: Explicacion[];
  max_explicadas_semana: number;
  regla?: { requieren_aprobacion: boolean };
};

function hm(h: number): string {
  const t = Math.round(h * 60);
  const hh = Math.floor(t / 60);
  const mm = t % 60;
  if (!hh) return `${mm} min`;
  return mm ? `${hh} h ${mm} min` : `${hh} h`;
}
const fecha = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("es-CO", { day: "numeric", month: "long" });
const hoyIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function MiQuincena({ token }: { token: string }) {
  const [d, setD] = useState<Estado | null>(null);
  const [falla, setFalla] = useState(false);
  const [explicar, setExplicar] = useState(false);

  const cargar = useCallback(() => {
    fetch(`/api/tickets/control-horas?_t=${Date.now()}`, { cache: "no-store", headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setD)
      .catch(() => setFalla(true));
  }, [token]);
  useEffect(() => {
    cargar();
    const iv = setInterval(cargar, 5 * 60 * 1000);
    return () => clearInterval(iv);
  }, [cargar]);

  if (falla) return null;
  if (!d) return <div className="h-28 animate-pulse rounded-xl bg-surface-hover" />;

  const pct = d.pactadas ? Math.min(100, (d.horas / d.pactadas) * 100) : 0;
  const hoy = d.hoy;
  const pendientes = d.explicaciones.filter((x) => x.estado === "pendiente").length;
  return (
    <>
      <div className="mck-card border-accent/25 bg-[rgb(var(--mck-card-bg))] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted">
              Mi quincena · {fecha(d.quincena.desde)} al {fecha(d.quincena.hasta)}
            </p>
            {d.pactadas ? (
              <p className="mt-1 text-lg font-bold text-ink">
                {hm(d.horas)} <span className="font-normal text-muted">de {hm(d.pactadas)} pactadas</span>
              </p>
            ) : (
              <p className="mt-1 text-lg font-bold text-ink">{hm(d.horas)} <span className="font-normal text-muted">registradas</span></p>
            )}
          </div>
          <button type="button" onClick={() => setExplicar(true)} className="mck-press rounded-xl border-2 border-accent px-3 py-2 text-sm font-bold text-accent hover:bg-accent/10">
            Explicar tiempo no registrado
          </button>
        </div>

        {d.pactadas != null && <Acuerdo d={d} />}
        {d.pactadas != null && (
          <div className="mt-3 h-4 overflow-hidden rounded-full bg-surface-hover" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Avance de la quincena">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
          </div>
        )}

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {hoy && hoy.meta > 0 && (
            <p className={`rounded-lg px-3 py-2 text-base ${hoy.faltan <= 0 ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200" : "bg-surface-hover text-ink"}`}>
              {hoy.faltan <= 0 ? (
                <><b>Completaste tu tiempo de hoy</b> ({hm(hoy.horas)}). Si sigues, cuenta como hora adicional.</>
              ) : (
                <>Hoy llevas <b>{hm(hoy.horas)}</b> · tu pago cubre {hm(hoy.meta)} al día · faltan <b>{hm(hoy.faltan)}</b></>
              )}
            </p>
          )}
          {d.al_dia != null && (
            <p className={`rounded-lg px-3 py-2 text-base ${d.al_dia >= 0 ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200" : "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200"}`}>
              {(d.de_mas ?? 0) > 0 ? (
                <><b>Completaste tus horas convenidas.</b> Llevas {hm(d.de_mas!)} adicionales, que se reconocen aparte.</>
              ) : d.al_dia >= 0 ? (
                <>Vas <b>al día</b> en la quincena{d.al_dia >= 1 ? ` (+${hm(d.al_dia)})` : ""}.</>
              ) : (
                <>Vas <b>{hm(-d.al_dia)} atrasado</b> para ir al día en la quincena.</>
              )}
            </p>
          )}
        </div>
        {d.dias && d.dias.length > 0 && <MisDias dias={d.dias} abierto />}
        {(d.horas_explicadas > 0 || pendientes > 0) && (
          <p className="mt-2 text-xs text-muted">
            {d.horas_explicadas > 0 && `Incluye ${hm(d.horas_explicadas)} explicadas y aprobadas. `}
            {pendientes > 0 && `${pendientes} ${pendientes === 1 ? "explicación espera" : "explicaciones esperan"} aprobación.`}
          </p>
        )}
      </div>
      {explicar && <Explicar token={token} d={d} onCerrar={() => setExplicar(false)} onGuardado={cargar} />}
    </>
  );
}

function Explicar({ token, d, onCerrar, onGuardado }: { token: string; d: Estado; onCerrar: () => void; onGuardado: () => void }) {
  const [f, setF] = useState(hoyIso());
  const [h, setH] = useState("1");
  const [txt, setTxt] = useState("");
  const [msg, setMsg] = useState("");
  const [enviando, setEnviando] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onCerrar]);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setMsg("");
    try {
      const r = await fetch("/api/tickets/control-horas/explicaciones", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ fecha: f, horas: Number(h), descripcion: txt }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo guardar");
      setTxt("");
      setMsg("Listo. Queda pendiente de aprobación.");
      onGuardado();
    } catch (err) {
      setMsg(String((err as Error).message || err));
    } finally {
      setEnviando(false);
    }
  }
  const estadoTxt = { pendiente: "Pendiente", aprobada: "Aprobada", rechazada: "No aprobada" } as const;
  const campo = "w-full rounded-xl border-2 border-border bg-surface-panel px-3 py-3 text-lg text-ink";
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/40 p-3 sm:p-6" onClick={onCerrar} role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="explicar-titulo" onClick={(e) => e.stopPropagation()} className="w-full max-w-[640px] rounded-2xl bg-surface-panel p-5 text-ink shadow-2xl sm:p-7">
        <div className="flex items-start justify-between gap-3">
          <h2 id="explicar-titulo" className="text-2xl font-black">Explicar tiempo no registrado</h2>
          <button type="button" onClick={onCerrar} className="rounded-xl bg-ink px-4 py-2 text-base font-bold text-surface-panel" autoFocus>Cerrar</button>
        </div>
        <p className="mt-2 text-base text-muted">
          Si trabajó en algo que no quedó en el panel (una llamada, recibir mercancía, un mandado), cuéntelo aquí. Administración lo revisa y, si lo aprueba, suma a sus horas. Máximo {d.max_explicadas_semana} horas por semana.
        </p>
        <form onSubmit={enviar} className="mt-4 grid gap-3 text-lg sm:grid-cols-2">
          <label className="flex flex-col gap-1">Día<input type="date" value={f} max={hoyIso()} onChange={(e) => setF(e.target.value)} className={campo} required /></label>
          <label className="flex flex-col gap-1">Horas<input type="number" min={0.25} max={8} step={0.25} value={h} onChange={(e) => setH(e.target.value)} className={campo} required /></label>
          <label className="flex flex-col gap-1 sm:col-span-2">¿Qué hizo?<textarea value={txt} onChange={(e) => setTxt(e.target.value)} rows={3} minLength={10} maxLength={500} required className={campo} placeholder="Por ejemplo: recibí y revisé el pedido de Interkrol" /></label>
          <button type="submit" disabled={enviando} className="rounded-xl bg-accent px-4 py-3 text-lg font-bold text-white disabled:opacity-60 sm:col-span-2">
            {enviando ? "Guardando…" : "Enviar para aprobación"}
          </button>
        </form>
        {msg && <p className="mt-3 text-base font-semibold">{msg}</p>}
        {d.explicaciones.length > 0 && (
          <>
            <h3 className="mt-6 text-lg font-bold">Esta quincena</h3>
            <ul className="mt-2 divide-y divide-border">
              {d.explicaciones.map((x) => (
                <li key={x.id} className="flex items-start justify-between gap-3 py-2 text-base">
                  <span className="min-w-0">
                    <b>{fecha(x.fecha)}</b> · {hm(x.horas)}
                    <span className="block text-sm text-muted">{x.descripcion}</span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-sm ${x.estado === "aprobada" ? "bg-emerald-100 text-emerald-900" : x.estado === "rechazada" ? "bg-rose-100 text-rose-900" : "bg-amber-100 text-amber-900"}`}>
                    {estadoTxt[x.estado]}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

const DIAS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

/** Registro día por día de la quincena: cuánto trabajó, la meta y si cumplió. */
export function MisDias({ dias, abierto = false, claro = false }: { dias: NonNullable<Estado["dias"]>; abierto?: boolean; claro?: boolean }) {
  // `claro`: dentro de las fichas en letra grande (fondo claro fijo), colores fijos de alto contraste
  const col = (c: string) => (claro ? { color: c.includes("emerald") ? "#1e5a14" : c.includes("amber") ? "#8a3a10" : c.includes("muted") ? "#5e4e40" : "#1f1711" } : undefined);
  const [ver, setVer] = useState(abierto);
  const cumplidos = dias.filter((x) => x.meta > 0 && x.diferencia >= -0.05 && !x.hoy).length;
  const conMeta = dias.filter((x) => x.meta > 0 && !x.hoy).length;
  return (
    <div className="mt-3">
      <button type="button" onClick={() => setVer(!ver)} aria-expanded={ver} className={`font-bold underline ${claro ? "" : "text-sm text-accent"}`} style={claro ? { color: "#b4581d" } : undefined}>
        {ver ? "Ocultar mis días" : `Ver mis días (${cumplidos} de ${conMeta} días completos)`}
      </button>
      {ver && (
        <table className="mt-2 w-full text-base">
          <thead className={`text-left text-xs uppercase tracking-wider ${claro ? "" : "text-muted"}`} style={col("muted")}>
            <tr><th className="py-1">Día</th><th className="py-1 text-right">Trabajó</th><th className="py-1 text-right">Cubre su pago</th><th className="py-1 text-right">Resultado</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {[...dias].reverse().map((x) => {
              const est = x.meta === 0
                ? { t: x.horas > 0 ? `+${hm(x.horas)} (fin de semana)` : "descanso", c: "text-muted" }
                : x.hoy
                  ? { t: x.diferencia >= 0 ? "completo" : `faltan ${hm(-x.diferencia)}`, c: "text-ink" }
                  : x.diferencia >= -0.05
                    ? { t: x.diferencia > 0.2 ? `completo · +${hm(x.diferencia)}` : "completo", c: "text-emerald-700 dark:text-emerald-400" }
                    : { t: `faltaron ${hm(-x.diferencia)}`, c: "text-amber-700 dark:text-amber-400" };
              return (
                <tr key={x.fecha} className={x.hoy ? "font-bold" : ""}>
                  <td className="py-1.5">{DIAS[x.dia_semana]} {Number(x.fecha.slice(8))}{x.hoy ? " · hoy" : ""}</td>
                  <td className="py-1.5 text-right tabular-nums">{x.horas > 0 ? hm(x.horas) : "–"}</td>
                  <td className={`py-1.5 text-right tabular-nums ${claro ? "" : "text-muted"}`} style={col("muted")}>{x.meta > 0 ? hm(x.meta) : "–"}</td>
                  <td className={`py-1.5 text-right ${claro ? "" : est.c}`} style={col(est.c)}>{est.t}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}


function cargarEstado(token: string, usuarioId?: number): Promise<Estado> {
  const q = new URLSearchParams({ _t: String(Date.now()) });
  if (usuarioId) q.set("usuario_id", String(usuarioId));
  return fetch(`/api/tickets/control-horas?${q}`, { cache: "no-store", headers: { Authorization: `Bearer ${token}` } }).then((r) =>
    r.ok ? r.json() : Promise.reject(r.status),
  );
}

/** «Mis horas» dentro de las fichas en letra grande: promedio diario, quincena y días. */
export function HorasEnFicha({ token, usuarioId, fs, conEstandar = false }: { token: string; usuarioId?: number; fs: number; conEstandar?: boolean }) {
  const [d, setD] = useState<Estado | null>(null);
  useEffect(() => {
    setD(null);
    cargarEstado(token, usuarioId).then(setD).catch(() => undefined);
  }, [token, usuarioId]);
  if (!d) return null;
  const pr = d.promedio;
  const caja = (n: string, t: string) => (
    <div className="rounded-2xl border-2 p-4" style={{ borderColor: "#e4d6c3" }}>
      <b className="block font-semibold tabular-nums" style={{ fontSize: fs * 1.5, lineHeight: 1.1 }}>{n}</b>
      <span style={{ color: "#4a3b2e", fontSize: fs * 0.8 }}>{t}</span>
    </div>
  );
  return (
    <div className="mt-8">
      <h3 className="font-bold" style={{ fontSize: fs * 1.15 }}>Horas trabajadas en la quincena</h3>
      <p style={{ color: "#4a3b2e", fontSize: fs * 0.8 }}>Del {fecha(d.quincena.desde)} al {fecha(d.quincena.hasta)}</p>
      <Acuerdo d={d} fs={fs} />
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {caja(pr?.horas_dia_habil != null ? hm(pr.horas_dia_habil) : "–", `trabaja en promedio por día hábil (${pr?.dias_habiles ?? 0} días)`)}
        {caja(pr ? hm(pr.cubre_por_dia) : "–", "cubre su pago por día hábil")}
        {caja(d.pactadas != null ? `${hm(d.horas)} de ${hm(d.pactadas)}` : hm(d.horas), "llevaba en la quincena")}
      </div>
      {conEstandar && d.ganadas && d.ganadas.horas > 0 && (
        <div className="mt-4 rounded-2xl border-2 p-4" style={{ borderColor: "#e4d6c3" }}>
          <p style={{ fontSize: fs * 0.9 }}>
            <b>Por lo que hizo, a tiempo estándar: {hm(d.ganadas.horas)}</b>
            <span style={{ color: "#4a3b2e" }}> ({d.ganadas.tareas_resueltas} tareas; referencia para administración: cada tarea con cronómetro a lo que tarda el equipo en promedio; las cerradas sin cronómetro, por su tiempo real. No reemplaza las horas convenidas.)</span>
          </p>
          <ul className="mt-2">
            {d.ganadas.funciones.slice(0, 6).map((f) => (
              <li key={f.id} className="flex justify-between gap-3 border-b py-1.5" style={{ borderColor: "#f1e7d8", fontSize: fs * 0.8 }}>
                <span>
                  {f.funcion} · {f.veces} {f.veces === 1 ? "vez" : "veces"}
                  {f.veces_huella === f.veces ? " (tiempo real entre acciones)" : f.estandar_min ? ` × ${hm(f.estandar_min / 60)}` : ""}
                </span>
                <b className="tabular-nums">{hm(f.horas)}</b>
              </li>
            ))}
          </ul>
        </div>
      )}
      {pr && (
        <p className="mt-3" style={{ fontSize: fs * 0.85 }}>
          Completó <b>{pr.dias_completos} de {pr.dias_habiles}</b> días hábiles
          {pr.horas_fin_de_semana > 0 ? <> y trabajó <b>{hm(pr.horas_fin_de_semana)}</b> en fin de semana</> : null}.
          {(d.de_mas ?? 0) > 0 ? <> Ya completó las horas convenidas y lleva <b>{hm(d.de_mas!)} adicionales</b>, que se reconocen aparte.</> : (d.faltan ?? 0) > 0 ? <> Le faltan <b>{hm(d.faltan!)}</b> para completar las horas convenidas de la quincena.</> : null}
        </p>
      )}
      {d.dias && d.dias.length > 0 && (
        <div style={{ fontSize: fs * 0.85 }}>
          <MisDias dias={d.dias} abierto claro />
        </div>
      )}
    </div>
  );
}


/** El acuerdo, dicho claro: lo que cuenta es completar las horas convenidas, no la rapidez. */
export function Acuerdo({ d, fs }: { d: Estado; fs?: number }) {
  if (d.pactadas == null) return null;
  const grande = fs != null;
  const porDia = d.promedio?.cubre_por_dia;
  return (
    <div
      className={grande ? "mt-4 rounded-2xl border-2 p-4" : "mt-2 rounded-lg border border-accent/30 bg-accent/5 p-3 text-sm text-ink"}
      style={grande ? { borderColor: "#b4581d", background: "#fbf1e6", fontSize: fs! * 0.9 } : undefined}
    >
      <p className={grande ? "" : "font-bold"} style={grande ? { fontWeight: 700 } : undefined}>Cómo funciona</p>
      <ul className={grande ? "mt-2 list-disc space-y-1 pl-6" : "mt-1 list-disc space-y-0.5 pl-5"}>
        <li>
          Lo que se necesita es <b>completar las {hm(d.pactadas)} convenidas</b> en la quincena
          {porDia ? <> (unas {hm(porDia)} por día hábil)</> : null}. <b>No se trata de hacerlo más rápido.</b>
        </li>
        <li>Puede repartirlas como le quede mejor: no hay hora de entrada ni de salida.</li>
        <li>
          Las horas que haga <b>después de completar las convenidas</b> son horas adicionales: <b>se reconocen aparte y tienen otro valor</b>
          {d.regla?.requieren_aprobacion ? ", cuando administración las aprueba" : ""}.
        </li>
        <li>Si trabajó en algo que el panel no registró, explíquelo con «Explicar tiempo no registrado».</li>
      </ul>
    </div>
  );
}
