import { useCallback, useEffect, useState } from "react";
import { PANEL_INFO } from "../lib/panelInfo";

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
  regla?: { requieren_aprobacion: boolean; colectas?: boolean };
};

function hm(h: number): string {
  const t = Math.round(h * 60);
  const hh = Math.floor(t / 60);
  const mm = t % 60;
  if (!hh) return `${mm} min`;
  return mm ? `${hh} h ${mm} min` : `${hh} h`;
}
/** Anillo de avance con el número adentro. `pct` 0–1 (más de 1 = anillo lleno). */
function Anillo({ pct, numero, completo = false, descanso = false }: { pct: number; numero: number; completo?: boolean; descanso?: boolean }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const avance = Math.max(0, Math.min(1, pct));
  const color = completo ? "text-emerald-600 dark:text-emerald-400" : descanso ? "text-violet-500 dark:text-violet-400" : "text-accent";
  const n = `${Math.round(numero * 10) / 10}`.replace(".", ",");
  return (
    <span className="relative inline-flex h-[68px] w-[68px] shrink-0 items-center justify-center" aria-hidden="true">
      <svg width="68" height="68" viewBox="0 0 68 68" className="-rotate-90">
        <circle cx="34" cy="34" r={r} fill="none" strokeWidth="7" stroke="currentColor" className="text-border" />
        {avance > 0 && (
          <circle cx="34" cy="34" r={r} fill="none" strokeWidth="7" stroke="currentColor" strokeLinecap="round"
            strokeDasharray={`${c * avance} ${c}`} className={color} />
        )}
      </svg>
      <span className={`absolute font-black tabular-nums ${n.length >= 4 ? "text-sm" : "text-base"}`}>
        {n}
        <span className="text-[10px] font-bold text-muted"> h</span>
      </span>
    </span>
  );
}

const fecha = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("es-CO", { day: "numeric", month: "long" });
const hoyIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function MiQuincena({ token }: { token: string }) {
  const [d, setD] = useState<Estado | null>(null);
  const [falla, setFalla] = useState(false);
  const [explicar, setExplicar] = useState<string | null>(null);
  const [dia, setDia] = useState<string | null>(null);
  const [como, setComo] = useState(false);

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
  if (!d) return <div className="h-40 animate-pulse rounded-2xl bg-surface-hover" />;

  const alternarComo = () => setComo(!como);
  const hoy = d.hoy;
  const pendientes = d.explicaciones.filter((x) => x.estado === "pendiente").length;
  const descansoHoy = !!hoy && hoy.meta === 0;

  // Anillo de HOY: cuánto lleva frente a la meta del día.
  const hoyPct = hoy ? (hoy.meta > 0 ? hoy.horas / hoy.meta : hoy.horas > 0 ? 1 : 0) : 0;
  let hoyEstado: { t: string; c: string } = { t: "", c: "text-muted" };
  if (hoy) {
    if (descansoHoy) hoyEstado = hoy.horas > 0 ? { t: `descanso · ${hm(hoy.horas)} adicionales`, c: "text-violet-700 dark:text-violet-300" } : { t: "día de descanso", c: "text-muted" };
    else if (hoy.faltan <= 0) hoyEstado = { t: "¡día completo!", c: "text-emerald-700 dark:text-emerald-400" };
    else hoyEstado = { t: `le faltan ${hm(hoy.faltan)}`, c: "text-amber-700 dark:text-amber-400" };
  }
  // Anillo de la QUINCENA: cuánto lleva frente a lo acordado.
  const qPct = d.pactadas ? d.horas / d.pactadas : 0;
  let qEstado: { t: string; c: string } = { t: "", c: "text-muted" };
  if (d.pactadas != null) {
    if ((d.de_mas ?? 0) > 0) qEstado = { t: `+${hm(d.de_mas!)} adicionales`, c: "text-emerald-700 dark:text-emerald-400" };
    else if ((d.al_dia ?? 0) >= 0) qEstado = { t: "va al día", c: "text-emerald-700 dark:text-emerald-400" };
    else qEstado = { t: `faltan ${hm(d.faltan ?? 0)}`, c: "text-muted" };
  }

  return (
    <>
      <section className="mck-card border-accent/25 bg-[rgb(var(--mck-card-bg))] p-4 text-ink sm:p-5" aria-labelledby="mi-quincena">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h3 id="mi-quincena" className="text-lg font-black">Mi quincena</h3>
          <span className="text-sm text-muted">{fecha(d.quincena.desde)} – {fecha(d.quincena.hasta)}</span>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setDia(hoyIso())}
            className="mck-press flex items-center gap-4 rounded-2xl bg-surface-hover px-4 py-3 text-left hover:bg-surface-hover/70"
            aria-label={`Hoy: ${hoy ? hm(hoy.horas) : hm(0)}${hoyEstado.t ? `, ${hoyEstado.t}` : ""}. Tocar para ver qué se contó y cómo se midió`}
          >
            <Anillo pct={hoyPct} numero={hoy ? hoy.horas : 0} completo={!!hoy && !descansoHoy && hoy.faltan <= 0} descanso={descansoHoy} />
            <span className="min-w-0">
              <span className="block text-xs font-bold uppercase tracking-wider text-muted">Hoy</span>
              {hoyEstado.t && <span className={`block text-lg font-bold leading-tight ${hoyEstado.c}`}>{hoyEstado.t}</span>}
              <span className="mt-0.5 block text-sm text-muted">ver el detalle ›</span>
            </span>
          </button>

          {d.pactadas != null ? (
            <div className="flex items-center gap-4 rounded-2xl bg-surface-hover px-4 py-3">
              <Anillo pct={qPct} numero={d.horas} completo={(d.de_mas ?? 0) > 0} />
              <span className="min-w-0">
                <span className="block text-xs font-bold uppercase tracking-wider text-muted">Quincena</span>
                <span className="block text-base leading-tight text-muted">de {hm(d.pactadas)} acordadas</span>
                {qEstado.t && <span className={`block text-lg font-bold leading-tight ${qEstado.c}`}>{qEstado.t}</span>}
              </span>
            </div>
          ) : (
            <div className="flex items-center rounded-2xl bg-surface-hover px-4 py-3 text-base text-muted">
              Esta quincena lleva <b className="mx-1 text-ink">{hm(d.horas)}</b> registradas.
            </div>
          )}
        </div>

        {d.dias && d.dias.length > 0 && <Semana dias={d.dias} onDia={(f) => setDia(f)} />}

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button type="button" onClick={() => setExplicar(hoyIso())} className="mck-press min-h-[44px] rounded-xl bg-accent px-4 py-2 text-base font-bold text-white hover:opacity-90">
            Contar un trabajo que no quedó registrado
          </button>
          <button type="button" onClick={alternarComo} aria-expanded={como} className="min-h-[44px] text-base font-bold text-accent underline">
            {como ? "Ocultar cómo funciona" : "¿Cómo funciona?"}
          </button>
        </div>
        {como && <Acuerdo d={d} />}
        {pendientes > 0 && (
          <p className="mt-3 text-base text-muted">
            {pendientes === 1 ? "Tiene 1 trabajo contado que espera aprobación." : `Tiene ${pendientes} trabajos contados que esperan aprobación.`}
          </p>
        )}
      </section>
      {dia && !explicar && (
        <DiaDetalle token={token} fecha={dia} meta={d.dias?.find((x) => x.fecha === dia)?.meta} onCerrar={() => setDia(null)} onContar={(f) => setExplicar(f)} />
      )}
      {explicar && <Explicar token={token} d={d} fechaInicial={explicar} onCerrar={() => setExplicar(null)} onGuardado={cargar} />}
    </>
  );
}

const LETRAS = ["L", "M", "M", "J", "V", "S", "D"];
const LEYENDA: Record<string, string> = {
  completo: "completó el día", parcial: "le faltó un poco", sinregistro: "sin registrar", extra: "descanso trabajado", descanso: "descanso",
};
const NOMBRE_DIA = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

type Dia = NonNullable<Estado["dias"]>[number];
function estadoDia(x: Dia) {
  if (x.meta === 0) return x.horas > 0 ? "extra" : "descanso";
  if (x.hoy) return x.diferencia >= 0 ? "completo" : "hoy";
  if (x.diferencia >= -0.05) return "completo";
  return x.horas > 0 ? "parcial" : "sinregistro";
}
const TEXTO_DIA: Record<string, string> = {
  completo: "completo", parcial: "le faltó un poco", sinregistro: "sin registrar", hoy: "hoy", extra: "adicional", descanso: "descanso",
};
// Paleta fija clara: para las fichas en letra grande, que tienen fondo claro fijo.
const ESTILO_DIA: Record<string, { bg: string; borde: string; txt: string }> = {
  completo: { bg: "#d9efd3", borde: "#2e7d32", txt: "#1b4d1e" },
  parcial: { bg: "#fff1c7", borde: "#b7791f", txt: "#6b4410" },
  sinregistro: { bg: "#f3f0ea", borde: "#b9ad9c", txt: "#5e4e40" },
  hoy: { bg: "#ffffff", borde: "#b4581d", txt: "#1f1711" },
  extra: { bg: "#e8e1f4", borde: "#7a5c9e", txt: "#3f2c5a" },
  descanso: { bg: "#f7f5f1", borde: "#e2dbd0", txt: "#8a7866" },
};
// Paleta que sigue el tema del panel (claro/oscuro), para «Mi quincena».
const CLASE_DIA: Record<string, string> = {
  completo: "border-emerald-600 bg-emerald-100 text-emerald-950 dark:border-emerald-400 dark:bg-emerald-900/40 dark:text-emerald-100",
  parcial: "border-amber-600 bg-amber-100 text-amber-950 dark:border-amber-400 dark:bg-amber-900/40 dark:text-amber-100",
  sinregistro: "border-dashed border-muted/70 bg-surface-hover text-muted",
  hoy: "border-accent bg-surface-panel text-ink",
  extra: "border-violet-600 bg-violet-100 text-violet-950 dark:border-violet-400 dark:bg-violet-900/40 dark:text-violet-100",
  descanso: "border-border bg-surface-hover text-muted",
};

/** Los días como círculos grandes: verde completo, amarillo le faltó un poco, gris sin registrar.
 *  Tocar un día sin registro (o incompleto) abre «contar un trabajo» con esa fecha. */
export function Semana({ dias, onDia, todos = false, grande = false }: { dias: Dia[]; onDia?: (fecha: string) => void; todos?: boolean; grande?: boolean }) {
  // `grande` = dentro de las fichas en letra grande (fondo claro fijo): paleta fija; si no, sigue el tema.
  const [ver, setVer] = useState(todos);
  const hoyI = dias.findIndex((x) => x.hoy);
  const fin = hoyI >= 0 ? hoyI + 1 : dias.length;
  const lista = ver ? dias.slice(0, fin) : dias.slice(Math.max(0, fin - 7), fin);
  const tam = grande ? 58 : 48;
  const fijo = grande;
  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className={grande ? "font-bold" : "text-base font-bold"}>{ver ? "Todos los días de la quincena" : "Sus últimos días"}</p>
        {onDia && <span className={fijo ? "text-sm" : "text-sm text-muted"} style={fijo ? { color: "#5e4e40" } : undefined}>toque un día para ver su detalle</span>}
      </div>
      <ul className="mt-2 grid grid-cols-7 gap-1.5" aria-label="Días de la quincena">
        {lista.map((x) => {
          const e = estadoDia(x);
          const st = ESTILO_DIA[e];
          const tocable = !!onDia && e !== "descanso";
          const contenido = (
            <>
              <span className={fijo ? "text-xs font-bold" : "text-xs font-bold text-muted"} style={fijo ? { color: "#5e4e40" } : undefined}>{LETRAS[x.dia_semana]} {Number(x.fecha.slice(8))}</span>
              <span
                className={`flex aspect-square w-full items-center justify-center rounded-full border-[3px] font-bold tabular-nums ${fijo ? "" : CLASE_DIA[e]}`}
                style={{ maxWidth: tam, fontSize: grande ? 17 : 15, ...(fijo ? { background: st.bg, borderColor: st.borde, color: st.txt, borderStyle: e === "sinregistro" ? "dashed" : "solid" } : {}) }}
              >
                {x.horas > 0 ? `${Math.round(x.horas * 10) / 10}`.replace(".", ",") : e === "completo" ? "✓" : "–"}
              </span>
            </>
          );
          const etiqueta = `${NOMBRE_DIA[x.dia_semana]} ${Number(x.fecha.slice(8))}: ${x.horas > 0 ? hm(x.horas) : "sin horas registradas"}, ${TEXTO_DIA[e]}`;
          return (
            <li key={x.fecha} className="flex min-w-0 flex-col items-center gap-0.5 text-center">
              {tocable ? (
                <button type="button" onClick={() => onDia!(x.fecha)} className="flex w-full flex-col items-center gap-0.5" aria-label={`${etiqueta}. Tocar para ver qué se contó ese día`}>
                  {contenido}
                </button>
              ) : (
                <span className="flex w-full flex-col items-center gap-0.5" aria-label={etiqueta}>{contenido}</span>
              )}
            </li>
          );
        })}
      </ul>
      <details className="mt-2">
        <summary className={`cursor-pointer text-sm underline ${fijo ? "" : "text-muted"}`} style={fijo ? { color: "#5e4e40" } : undefined}>¿Qué significa cada color?</summary>
        <ul className={`mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5 text-sm ${fijo ? "" : "text-muted"}`} style={fijo ? { color: "#3d3128" } : undefined} aria-label="Qué significa cada color">
          {(["completo", "parcial", "sinregistro", "extra", "descanso"] as const).map((k) => (
            <li key={k} className="flex items-center gap-1.5">
              <span
                className={`inline-block h-4 w-4 rounded-full border-2 ${fijo ? "" : CLASE_DIA[k]}`}
                style={fijo ? { background: ESTILO_DIA[k].bg, borderColor: ESTILO_DIA[k].borde, borderStyle: k === "sinregistro" ? "dashed" : "solid" } : undefined}
              />
              {LEYENDA[k]}
            </li>
          ))}
        </ul>
        <p className={`mt-1 text-sm ${fijo ? "" : "text-muted"}`} style={fijo ? { color: "#5e4e40" } : undefined}>El número del círculo es cuántas horas se contaron ese día.</p>
      </details>
      {!todos && fin > 7 && (
        <button type="button" onClick={() => setVer(!ver)} className="mt-1 text-sm font-bold text-accent underline">
          {ver ? "ver solo los últimos días" : "ver toda la quincena"}
        </button>
      )}
    </div>
  );
}

function Explicar({ token, d, fechaInicial, onCerrar, onGuardado }: { token: string; d: Estado; fechaInicial?: string; onCerrar: () => void; onGuardado: () => void }) {
  const [f, setF] = useState(fechaInicial || hoyIso());
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
          <h2 id="explicar-titulo" className="text-2xl font-black">Contar un trabajo que no quedó registrado</h2>
          <button type="button" onClick={onCerrar} className="rounded-xl bg-ink px-4 py-2 text-base font-bold text-surface-panel" autoFocus>Cerrar</button>
        </div>
        <p className="mt-2 text-base text-muted">
          Si trabajó en algo que no quedó en el panel (una llamada, recibir mercancía, un mandado), cuéntelo aquí. Administración lo revisa y, si lo aprueba, se suma a sus horas. Puede contar hasta {d.max_explicadas_semana} horas por semana.
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
export function MisDias({ dias, abierto = false, claro = false, onDia }: { dias: NonNullable<Estado["dias"]>; abierto?: boolean; claro?: boolean; onDia?: (fecha: string) => void }) {
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
                ? { t: x.horas > 0 ? `+${hm(x.horas)} (día de descanso)` : "descanso", c: "text-muted" }
                : x.hoy
                  ? { t: x.diferencia >= 0 ? "completo" : `faltan ${hm(-x.diferencia)}`, c: "text-ink" }
                  : x.diferencia >= -0.05
                    ? { t: x.diferencia > 0.2 ? `completo · +${hm(x.diferencia)}` : "completo", c: "text-emerald-700 dark:text-emerald-400" }
                    : { t: `faltaron ${hm(-x.diferencia)}`, c: "text-amber-700 dark:text-amber-400" };
              return (
                <tr key={x.fecha} className={x.hoy ? "font-bold" : ""}>
                  <td className="py-1.5">
                    {onDia && (x.horas > 0 || x.meta > 0) ? (
                      <button type="button" onClick={() => onDia(x.fecha)} className="font-semibold text-accent underline">
                        {DIAS[x.dia_semana]} {Number(x.fecha.slice(8))}{x.hoy ? " · hoy" : ""}
                      </button>
                    ) : <>{DIAS[x.dia_semana]} {Number(x.fecha.slice(8))}{x.hoy ? " · hoy" : ""}</>}
                  </td>
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
  const [dia, setDia] = useState<string | null>(null);
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
    <div className="mt-6">
      <h3 className="font-bold" style={{ fontSize: fs * 1.15 }}>Su quincena</h3>
      <p style={{ color: "#4a3b2e", fontSize: fs * 0.8 }}>Del {fecha(d.quincena.desde)} al {fecha(d.quincena.hasta)}</p>
      <details className="mt-3">
        <summary className="cursor-pointer font-bold underline" style={{ color: "#b4581d", fontSize: fs * 0.9 }}>¿Cómo funciona?</summary>
        <Acuerdo d={d} fs={fs} />
      </details>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {caja(pr?.horas_dia_habil != null ? hm(pr.horas_dia_habil) : "–", `trabaja en promedio por día hábil (${pr?.dias_habiles ?? 0} días)`)}
        {caja(pr ? hm(pr.cubre_por_dia) : "–", "es su jornada acordada por día hábil")}
        {caja(d.pactadas != null ? `${hm(d.horas)} de ${hm(d.pactadas)}` : hm(d.horas), "lleva en la quincena")}
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
          {pr.horas_fin_de_semana > 0 ? <> y trabajó <b>{hm(pr.horas_fin_de_semana)}</b> en fines de semana y festivos</> : null}.
          {(d.de_mas ?? 0) > 0 ? <> Ya completó las horas acordadas y lleva <b>{hm(d.de_mas!)} adicionales</b>, que se pagan al mismo valor de la hora.</> : (d.faltan ?? 0) > 0 ? <> Le faltan <b>{hm(d.faltan!)}</b> para completar las horas acordadas de la quincena.</> : null}
        </p>
      )}
      {d.dias && d.dias.length > 0 && (
        <div style={{ fontSize: fs * 0.85 }}>
          <Semana dias={d.dias} todos grande onDia={(f) => setDia(f)} />
        </div>
      )}
      {dia && <DiaDetalle token={token} usuarioId={usuarioId} fecha={dia} meta={d.dias?.find((x) => x.fecha === dia)?.meta} onCerrar={() => setDia(null)} />}
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
      className={grande ? "mt-4 rounded-2xl border-2 p-4" : "mt-3 rounded-xl border border-accent/30 bg-accent/5 p-4 text-base text-ink"}
      style={grande ? { borderColor: "#b4581d", background: "#fbf1e6", fontSize: fs! * 0.9 } : undefined}
    >
      <p className={grande ? "" : "text-base font-bold"} style={grande ? { fontWeight: 700 } : undefined}>Cómo funciona</p>
      <ul className={grande ? "mt-2 list-disc space-y-1 pl-6" : "mt-1 list-disc space-y-0.5 pl-5"}>
        <li>
          Lo que se necesita es <b>completar las {hm(d.pactadas)} acordadas</b> en la quincena
          {porDia ? <> (unas {hm(porDia)} por día hábil)</> : null}. <b>No se trata de hacerlo más rápido.</b>
        </li>
        {d.regla?.colectas ? (
          <li>
            <b>De lunes a viernes necesitamos su disponibilidad para las colectas de Mercado Libre.</b> Dentro de eso, organiza
            su trabajo como le quede mejor: no hay hora de entrada ni de salida.
          </li>
        ) : (
          <li>Usted las reparte como le quede mejor: no hay hora de entrada ni de salida.</li>
        )}
        <li>
          Las horas que haga <b>después de completar las acordadas</b> son horas adicionales y <b>se pagan al mismo valor de la hora</b>
          {d.regla?.requieren_aprobacion ? ", cuando administración las aprueba" : ""}. No son horas extra: esto es un contrato de
          honorarios, no un contrato laboral.
        </li>
        <li>
          <b>Cómo se cuentan sus horas:</b> el día se divide en ratos de 15 minutos. Un rato cuenta si en él tenía una{" "}
          <b>tarea con el cronómetro andando</b> o <b>trabajó en el panel</b> (abrir, registrar, facturar…). Los ratos sin nada de
          eso no cuentan, y el mismo rato nunca se cuenta dos veces. Toque cualquier día para ver qué se contó y a qué hora.
        </li>
        <li>
          Lo que se hace fuera del panel (alistar, empacar, cocinar) cuenta si <b>arranca el cronómetro de la tarea</b> al empezar y
          lo para al terminar. Si se le olvidó, cuéntelo con el botón «Contar un trabajo que no quedó registrado».
        </li>
      </ul>
    </div>
  );
}


type Tramo = {
  tipo: "tarea" | "panel" | "desarrollo" | "pausa";
  desde: string;
  hasta: string;
  horas: number;
  titulo?: string;
  panel?: string;
  acciones?: number;
  cronometro?: string;
  resultado?: { cantidad: number; unidad: string | null } | null;
};
type Detalle = {
  fecha: string;
  dia_semana: number;
  habil: boolean;
  horas_activas: number;
  horas_explicadas: number;
  horas: number;
  tramos: Tramo[];
  hechas: { titulo: string; hora: string; resultado: { cantidad: number; unidad: string | null } | null }[];
  explicaciones: Explicacion[];
};

// Cómo se midió cada tramo: colores que siguen el tema del panel (claro/oscuro).
const COMO_SE_MIDIO: Record<Tramo["tipo"], { chip: string; pastilla: string; borde: string }> = {
  tarea: { chip: "Tarea con cronómetro", pastilla: "bg-emerald-100 text-emerald-950 dark:bg-emerald-900/50 dark:text-emerald-100", borde: "border-l-emerald-600 dark:border-l-emerald-400" },
  panel: { chip: "Trabajo en el panel", pastilla: "bg-sky-100 text-sky-950 dark:bg-sky-900/50 dark:text-sky-100", borde: "border-l-sky-700 dark:border-l-sky-400" },
  desarrollo: { chip: "Desarrollo del sistema", pastilla: "bg-violet-100 text-violet-950 dark:bg-violet-900/50 dark:text-violet-100", borde: "border-l-violet-600 dark:border-l-violet-400" },
  pausa: { chip: "Sin registro", pastilla: "", borde: "" },
};
const BORDE_CHIP: Record<string, string> = {
  tarea: "border-emerald-600 dark:border-emerald-400",
  panel: "border-sky-700 dark:border-sky-400",
  desarrollo: "border-violet-600 dark:border-violet-400",
};

function nombrePanel(id?: string) {
  if (!id) return "La aplicación";
  return PANEL_INFO[id]?.label || id.replace(/-/g, " ");
}
function resultadoTxt(r?: { cantidad: number; unidad: string | null } | null) {
  if (!r) return null;
  const n = Number.isInteger(r.cantidad) ? r.cantidad : String(r.cantidad).replace(".", ",");
  return `${n} ${r.unidad || ""}`.trim();
}

/** Un día abierto: cada tramo de trabajo, a qué hora, qué se hizo y cómo se midió; los ratos sin registro
 *  (que no cuentan) y lo que quedó terminado. Es la misma cuenta del total, no otra. */
export function DiaDetalle({ token, usuarioId, fecha: f, meta, onCerrar, onContar }: {
  token: string; usuarioId?: number; fecha: string; meta?: number; onCerrar: () => void; onContar?: (fecha: string) => void;
}) {
  const [d, setD] = useState<Detalle | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const q = new URLSearchParams({ fecha: f, _t: String(Date.now()) });
    if (usuarioId) q.set("usuario_id", String(usuarioId));
    fetch(`/api/tickets/control-horas/dia?${q}`, { cache: "no-store", headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setD)
      .catch(() => setError("No se pudo cargar este día."));
  }, [token, usuarioId, f]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onCerrar]);

  const titulo = new Date(`${f}T12:00:00`).toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" });
  const pausaLarga = d?.tramos.some((t) => t.tipo === "pausa" && t.horas >= 1);
  const porTipo = (tipo: Tramo["tipo"]) => d?.tramos.filter((t) => t.tipo === tipo).reduce((a, t) => a + t.horas, 0) ?? 0;

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/40 p-3 sm:p-6" onClick={onCerrar} role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="dia-titulo" onClick={(e) => e.stopPropagation()} className="w-full max-w-[720px] rounded-2xl bg-surface-panel p-5 text-ink shadow-2xl sm:p-7">
        <div className="flex items-start justify-between gap-3">
          <h2 id="dia-titulo" className="text-2xl font-black first-letter:uppercase">{titulo}</h2>
          <button type="button" onClick={onCerrar} className="rounded-xl bg-ink px-4 py-2 text-base font-bold text-surface-panel" autoFocus>Cerrar</button>
        </div>
        {error && <p className="mt-4 text-lg">{error}</p>}
        {!d && !error && <div className="mt-4 h-40 animate-pulse rounded-2xl bg-surface-hover" />}
        {d && (
          <>
            <p className="mt-3 text-xl">
              Se contaron <b>{hm(d.horas)}</b>
              {meta ? <> de unas <b>{hm(meta)}</b> acordadas para el día</> : !d.habil ? <> (día de descanso: cuentan como adicionales)</> : null}.
            </p>
            {d.horas > 0 && (
              <ul className="mt-2 flex flex-wrap gap-2 text-base" aria-label="De dónde salen las horas">
                {(["tarea", "panel", "desarrollo"] as const).filter((t) => porTipo(t) > 0).map((t) => (
                  <li key={t} className={`rounded-full border-2 px-3 py-0.5 ${COMO_SE_MIDIO[t].pastilla} ${BORDE_CHIP[t]}`}>
                    {COMO_SE_MIDIO[t].chip}: <b>{hm(porTipo(t))}</b>
                  </li>
                ))}
                {d.horas_explicadas > 0 && <li className="rounded-full border-2 border-accent px-3 py-0.5">Contado a mano y aprobado: <b>{hm(d.horas_explicadas)}</b></li>}
              </ul>
            )}
            <p className="mt-3 rounded-xl bg-surface-hover px-4 py-3 text-base">
              <b>Cómo se mide:</b> el día se parte en ratos de 15 minutos. Cuenta cada rato en el que hubo una tarea con el cronómetro
              andando o trabajo en el panel. Los ratos sin registro no cuentan, y ningún rato se cuenta dos veces.
            </p>

            {d.tramos.length === 0 ? (
              <p className="mt-5 text-lg">Este día no quedó nada registrado.</p>
            ) : (
              <ol className="mt-5 space-y-2" aria-label="Lo que se contó, hora por hora">
                {d.tramos.map((t, i) => {
                  const st = COMO_SE_MIDIO[t.tipo];
                  if (t.tipo === "pausa") {
                    return (
                      <li key={i} className="flex items-center justify-between gap-3 rounded-xl border-2 border-dashed border-muted/60 px-4 py-2 text-base text-muted">
                        <span><span className="tabular-nums">{t.desde} – {t.hasta}</span> · sin registro</span>
                        <span className="shrink-0">{hm(t.horas)} · <b>no cuenta</b></span>
                      </li>
                    );
                  }
                  const res = resultadoTxt(t.resultado);
                  return (
                    <li key={i} className={`grid grid-cols-[auto_1fr_auto] items-start gap-x-3 rounded-xl border-l-[6px] bg-surface-hover px-4 py-3 ${st.borde}`}>
                      <span className="pt-0.5 text-base font-bold tabular-nums">{t.desde}<br /><span className="font-normal text-muted">{t.hasta}</span></span>
                      <span className="min-w-0">
                        <span className={`inline-block rounded-full px-2.5 py-0.5 text-sm font-bold ${st.pastilla}`}>{st.chip}</span>
                        <span className="mt-1 block text-lg font-bold leading-snug">
                          {t.tipo === "tarea" ? t.titulo : t.tipo === "panel" ? nombrePanel(t.panel) : "Trabajo en el sistema con IA"}
                        </span>
                        <span className="block text-base text-muted">
                          {t.tipo === "tarea" && <>Cronómetro de {t.cronometro}. </>}
                          {t.tipo === "panel" && <>{t.acciones} {t.acciones === 1 ? "acción" : "acciones"} en ese rato. </>}
                          {t.tipo === "desarrollo" && <>Instrucciones al asistente de programación. </>}
                          {res && <b className="text-ink">Resultado: {res}.</b>}
                        </span>
                      </span>
                      <b className="text-lg tabular-nums">{hm(t.horas)}</b>
                    </li>
                  );
                })}
              </ol>
            )}

            {d.hechas.length > 0 && (
              <>
                <h3 className="mt-6 text-lg font-bold">Lo que dejó terminado</h3>
                <ul className="mt-2 divide-y divide-border text-base">
                  {d.hechas.map((h, i) => (
                    <li key={i} className="flex justify-between gap-3 py-2">
                      <span className="min-w-0"><span className="tabular-nums text-muted">{h.hora}</span> · {h.titulo}</span>
                      {h.resultado && <b className="shrink-0">{resultadoTxt(h.resultado)}</b>}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {d.explicaciones.length > 0 && (
              <>
                <h3 className="mt-6 text-lg font-bold">Trabajo contado a mano</h3>
                <ul className="mt-2 divide-y divide-border text-base">
                  {d.explicaciones.map((x) => (
                    <li key={x.id} className="flex justify-between gap-3 py-2">
                      <span className="min-w-0">{x.descripcion}</span>
                      <span className="shrink-0">{hm(x.horas)} · {x.estado === "aprobada" ? "aprobado" : x.estado === "rechazada" ? "no aprobado" : "por aprobar"}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {pausaLarga && (
              <p className="mt-5 rounded-xl border-2 border-accent/40 bg-accent/5 px-4 py-3 text-base">
                ¿Trabajó en algún rato sin registro (alistando, empacando, en una diligencia)? Para que cuente, la próxima vez arranque el
                cronómetro de la tarea{onContar ? ", o cuéntelo ahora con el botón de abajo" : ""}.
              </p>
            )}
            {onContar && (
              <button type="button" onClick={() => onContar(f)} className="mck-press mt-4 min-h-[52px] w-full rounded-xl bg-accent px-4 py-2 text-lg font-bold text-white hover:opacity-90">
                Contar un trabajo de este día que no quedó registrado
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
