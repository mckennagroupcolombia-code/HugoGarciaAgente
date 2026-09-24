import { useCallback, useEffect, useState } from "react";
import { HorasEnFicha } from "./MiQuincena";

/**
 * «Mi mes en el panel»: la ficha de rendimiento de cada persona en la Agenda.
 * Qué hizo, cuántas veces, cuánto tarda en promedio y cuántas horas le dedica al
 * mes, con los datos que ya registra el panel (ver app/services/rendimiento.py).
 * La ficha se abre en letra grande: la leen personas de todas las edades.
 * Sin pagos ni valoraciones: eso es de administración.
 */

type Funcion = {
  id: string;
  funcion: string;
  implica: string;
  nivel: number;
  veces: number;
  horas: number;
  promedio_min: number | null;
  fuente: string;
};
type Rendimiento = {
  usuario: { id: number; nombre: string; username: string };
  periodo: { desde: string; hasta: string; dias: number };
  horas_mes: number;
  horas_mes_anterior: number;
  variacion_pct: number | null;
  dias_activos: number;
  jornada_referencia: number;
  funciones: Funcion[];
  tipos: { nivel: number; nombre: string; horas: number; porcentaje: number }[];
  nota: string;
  equipo?: { id: number; nombre: string; username: string }[];
};

const COLOR_NIVEL: Record<number, string> = { 1: "#f5e2c4", 2: "#eec68b", 3: "#df9f55", 4: "#c1742b", 5: "#8f4d17" };

async function traer(token: string, usuarioId?: number): Promise<Rendimiento> {
  const q = new URLSearchParams({ _t: String(Date.now()) });
  if (usuarioId) q.set("usuario_id", String(usuarioId));
  const r = await fetch(`/api/tickets/rendimiento?${q}`, { cache: "no-store", headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `Error ${r.status}`);
  return r.json();
}

function horasTexto(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  if (!hh) return `${mm} minutos`;
  return `${hh} hora${hh === 1 ? "" : "s"}${mm ? ` y ${mm} minutos` : ""}`;
}
function porVez(f: Funcion): string {
  if (f.promedio_min == null) return "trabajo continuo, no se mide por vez";
  return `cada vez tarda ${f.promedio_min >= 60 ? horasTexto(f.promedio_min / 60) : `${f.promedio_min} minutos`}`;
}
function fechaCorta(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("es-CO", { day: "numeric", month: "long" });
}

export default function MiRendimiento({ token }: { token: string }) {
  const [d, setD] = useState<Rendimiento | null>(null);
  const [error, setError] = useState("");
  const [abierta, setAbierta] = useState(false);

  useEffect(() => {
    traer(token).then(setD).catch((e) => setError(String(e.message || e)));
  }, [token]);

  if (error) return null;
  if (!d) return <div className="h-24 animate-pulse rounded-xl bg-surface-hover" />;

  const top = d.funciones.slice(0, 3);
  return (
    <>
      <div className="mck-card border-accent/25 bg-[rgb(var(--mck-card-bg))] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-black text-ink">Mi ficha</h3>
            <p className="text-base text-muted">Lo que hizo este mes y en qué se le va el tiempo.</p>
          </div>
          <button type="button" onClick={() => setAbierta(true)} className="mck-press min-h-[48px] rounded-xl bg-accent px-5 py-2 text-base font-bold text-white hover:opacity-90">
            Ver mi ficha
          </button>
        </div>
        {top.length > 0 && (
          <ul className="mt-3 space-y-1">
            {top.map((f) => (
              <li key={f.id} className="flex items-baseline justify-between gap-3 text-base">
                <span className="min-w-0 truncate text-ink">{f.funcion}</span>
                <span className="shrink-0 font-semibold tabular-nums text-ink">{Math.round(f.horas)} h</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {abierta && <FichaGrande token={token} inicial={d} onCerrar={() => setAbierta(false)} />}
    </>
  );
}

function FichaGrande({ token, inicial, onCerrar }: { token: string; inicial: Rendimiento; onCerrar: () => void }) {
  const [d, setD] = useState<Rendimiento>(inicial);
  const [grande, setGrande] = useState<boolean>(() => {
    try {
      return localStorage.getItem("mck-ficha-grande") === "1";
    } catch {
      return false;
    }
  });
  const [cargando, setCargando] = useState(false);
  const equipo = inicial.equipo;

  const ver = useCallback(
    (id: number) => {
      setCargando(true);
      traer(token, id)
        .then((x) => setD({ ...x, equipo }))
        .finally(() => setCargando(false));
    },
    [token, equipo],
  );

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", k);
      document.body.style.overflow = prev;
    };
  }, [onCerrar]);

  const fs = grande ? 24 : 20;
  const max = Math.max(d.horas_mes, d.horas_mes_anterior, d.jornada_referencia, 1);
  const barra = (lab: string, h: number, color: string) => (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span>{lab}</span>
        <span className="font-semibold tabular-nums">{Math.round(h)} h</span>
      </div>
      <span className="mt-1 block h-6 overflow-hidden rounded-full" style={{ background: "#f1e7d8" }}>
        <span className="block h-full rounded-full" style={{ width: `${(h / max) * 100}%`, background: color }} />
      </span>
    </div>
  );
  const visibles = d.funciones.filter((f) => f.horas >= 0.5);
  const top = visibles.slice(0, 10);
  const resto = visibles.slice(10).reduce((a, f) => a + f.horas, 0);
  const v = d.variacion_pct;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto p-3 sm:p-6"
      style={{ background: "rgba(43,33,25,.5)" }}
      onClick={onCerrar}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ficha-titulo"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[880px] rounded-2xl p-5 shadow-2xl sm:p-8"
        style={{ background: "#fffdf9", color: "#1f1711", fontSize: fs, lineHeight: 1.5 }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 id="ficha-titulo" className="font-black leading-tight" style={{ fontSize: fs * 1.8 }}>
              {d.usuario.nombre}
            </h2>
            <p style={{ color: "#4a3b2e", fontSize: fs * 0.85 }}>
              Usuario <b>{d.usuario.username}</b>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-pressed={grande}
              onClick={() => {
                const n = !grande;
                setGrande(n);
                try {
                  localStorage.setItem("mck-ficha-grande", n ? "1" : "0");
                } catch {
                  /* sin almacenamiento */
                }
              }}
              className="rounded-xl border-2 px-4 py-3 font-bold"
              style={{ borderColor: "#1f1711", fontSize: fs * 0.8, minHeight: 52 }}
            >
              {grande ? "Letra normal" : "Letra más grande"}
            </button>
            <button
              type="button"
              autoFocus
              onClick={onCerrar}
              className="rounded-xl px-4 py-3 font-bold"
              style={{ background: "#1f1711", color: "#fffdf9", fontSize: fs * 0.8, minHeight: 52 }}
            >
              Cerrar ficha
            </button>
          </div>
        </div>

        {equipo && equipo.length > 0 && (
          <label className="mt-4 flex flex-wrap items-center gap-3" style={{ fontSize: fs * 0.8 }}>
            Ver la ficha de:
            <select
              value={d.usuario.id}
              onChange={(e) => ver(Number(e.target.value))}
              className="rounded-lg border-2 px-3 py-2"
              style={{ borderColor: "#cdbba4", background: "#fffdf9", color: "#1f1711", fontSize: fs * 0.8 }}
            >
              {equipo.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre} ({u.username})
                </option>
              ))}
            </select>
            {cargando && <span style={{ color: "#6b5a4a" }}>Cargando…</span>}
          </label>
        )}

        <HorasEnFicha token={token} usuarioId={d.usuario.id} fs={fs} />

        <h3 className="mt-10 font-bold" style={{ fontSize: fs * 1.15 }}>
          Su mes en el panel
        </h3>
        <p style={{ color: "#4a3b2e", fontSize: fs * 0.8 }}>
          Del {fechaCorta(d.periodo.desde)} al {fechaCorta(d.periodo.hasta)}: tareas con cronómetro y tiempo en cada parte del panel.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {[
            [Math.round(d.horas_mes), "horas registradas en el mes"],
            [Math.round(d.horas_mes_anterior), "horas el mes anterior"],
            [d.dias_activos, "días en que trabajó"],
          ].map(([n, t]) => (
            <div key={String(t)} className="rounded-2xl border-2 p-4" style={{ borderColor: "#e4d6c3" }}>
              <b className="block font-semibold tabular-nums" style={{ fontSize: fs * 1.8, lineHeight: 1.05 }}>
                {n}
              </b>
              <span style={{ color: "#4a3b2e", fontSize: fs * 0.8 }}>{t}</span>
            </div>
          ))}
        </div>

        {v != null && (
          <p
            className="mt-4 rounded-2xl border-2 p-4"
            style={
              Math.abs(v) < 10
                ? { background: "#f1e7d8", borderColor: "#cdbba4", color: "#1f1711" }
                : v >= 0
                ? { background: "#e6f1dc", borderColor: "#3f7a2e", color: "#1e4a14" }
                : { background: "#fbe6da", borderColor: "#a4471d", color: "#6e2a0c" }
            }
          >
            {Math.abs(v) < 10 ? <>Este mes registró <b>casi las mismas horas</b> que el mes anterior.</> : <>Este mes registró <b>{v >= 0 ? `${v}% más` : `${-v}% menos`}</b> horas que el mes anterior.</>}
          </p>
        )}

        <div className="mt-5 space-y-3">
          {barra("Este mes", d.horas_mes, "#b4581d")}
          {barra("Mes anterior", d.horas_mes_anterior, "#df9f55")}
          {barra("Jornada", d.jornada_referencia, "#cdbba4")}
        </div>

        <h3 className="mt-8 font-bold" style={{ fontSize: fs * 1.15 }}>
          ¿En qué se le va el tiempo?
        </h3>
        {top.length === 0 ? (
          <p className="mt-2" style={{ color: "#4a3b2e" }}>
            Todavía no hay tareas registradas en este periodo.
          </p>
        ) : (
          <ol className="mt-2">
            {top.map((f) => (
              <li key={f.id} className="grid gap-x-4 border-b-2 py-3" style={{ borderColor: "#f1e7d8", gridTemplateColumns: "minmax(0,1fr) auto" }}>
                <span className="font-semibold">{f.funcion}</span>
                <span className="text-right font-semibold tabular-nums">{Math.round(f.horas)} h</span>
                <span className="col-span-2" style={{ color: "#4a3b2e", fontSize: fs * 0.8 }}>
                  {f.veces ? `Lo hizo ${f.veces} ${f.veces === 1 ? "vez" : "veces"} · ` : ""}
                  {porVez(f)}
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
        )}

        {d.tipos.length > 0 && (
          <>
            <h3 className="mt-8 font-bold" style={{ fontSize: fs * 1.15 }}>
              Tipo de trabajo
            </h3>
            <div className="mt-3 space-y-3">
              {d.tipos.map((t) => (
                <div key={t.nivel}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span>{t.nombre}</span>
                    <span className="font-semibold tabular-nums">{t.porcentaje}%</span>
                  </div>
                  <span className="mt-1 block h-6 overflow-hidden rounded-full" style={{ background: "#f1e7d8" }}>
                    <span className="block h-full rounded-full" style={{ width: `${t.porcentaje}%`, background: COLOR_NIVEL[t.nivel] }} />
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        <p className="mt-8" style={{ color: "#5e4e40", fontSize: fs * 0.75 }}>
          {d.nota} Si hace algo que no queda registrado, cuénteselo a administración para sumarlo.
        </p>
      </div>
    </div>
  );
}
