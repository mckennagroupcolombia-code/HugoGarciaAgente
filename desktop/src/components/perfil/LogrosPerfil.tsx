import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

/**
 * Logros y monedas del usuario (Perfil): lo que cada quien hace en la app (tareas, clientes,
 * despachos, contabilidad, publicaciones, aprobaciones) se juega como misiones y paga monedas
 * según su dificultad. La tarifa y el conteo los pone el servidor
 * (`app/services/logros_usuario.py`); aquí solo se muestran.
 */
interface Resumen {
  total: number;
  nivel: { numero: number; nombre: string; desde: number; hasta: number | null; siguiente: string | null };
  hoy: { misiones: number; monedas: number };
  racha: number;
  tarifa: { clave: string; titulo: string; monedas: number; dificultad: string; area: string; tope_dia: number | null; veces: number }[];
  logros: { clave: string; nombre: string; descripcion: string; icono: string; desbloqueado_en: string | null }[];
  historial: { mision: string; titulo: string; ref: string; detalle: string; monedas: number; creado_en: string }[];
}

const COLOR_DIFICULTAD: Record<string, string> = {
  fácil: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  media: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  difícil: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
};

const num = (n: number) => n.toLocaleString("es-CO");

function cuando(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("es-CO", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export default function LogrosPerfil() {
  const q = useQuery({
    queryKey: ["logros-usuario"],
    queryFn: () => api.get<Resumen>("/api/tickets/auth/logros"),
    staleTime: 0,
  });
  const { refetch } = q;
  // Cada aprobación avisa al cobrar: el perfil abierto se pone al día solo.
  useEffect(() => {
    const f = () => void refetch();
    window.addEventListener("mck-logros-cambio", f);
    return () => window.removeEventListener("mck-logros-cambio", f);
  }, [refetch]);

  const r = q.data;
  const caja = "rounded-paper border-2 border-border bg-surface-panel p-5 shadow-paper-sm";
  if (q.isLoading) return <div className={`${caja} text-sm text-muted`}>Cargando logros…</div>;
  if (!r) return <div className={`${caja} text-sm text-muted`}>No se pudieron cargar los logros.</div>;

  const { nivel } = r;
  const avance = nivel.hasta ? Math.min(100, ((r.total - nivel.desde) / (nivel.hasta - nivel.desde)) * 100) : 100;
  const ganados = r.logros.filter((l) => l.desbloqueado_en).length;
  // Primero las áreas donde ya juega; dentro de cada una, como las ordena el servidor.
  const areas = [...new Set(r.tarifa.map((t) => t.area))]
    .map((area) => ({ area, misiones: r.tarifa.filter((t) => t.area === area) }))
    .sort((a, b) => b.misiones.reduce((n, t) => n + t.veces, 0) - a.misiones.reduce((n, t) => n + t.veces, 0));

  return (
    <section className="grid grid-cols-1 gap-5 xl:grid-cols-12">
      {/* Monedero + nivel */}
      <div className={`${caja} space-y-4 xl:col-span-5`}>
        <h3 className="text-sm font-extrabold uppercase tracking-wide text-muted">Logros y monedas</h3>
        <div className="flex items-center gap-4">
          <span className="text-5xl leading-none" aria-hidden="true">🪙</span>
          <div>
            <p className="font-mono text-3xl font-black text-amber-600 dark:text-amber-400">{num(r.total)}</p>
            <p className="text-xs font-semibold text-muted">monedas ganadas</p>
          </div>
        </div>
        <div>
          <div className="flex items-baseline justify-between gap-2 text-xs font-bold">
            <span className="text-ink">Nivel {nivel.numero} · {nivel.nombre}</span>
            <span className="font-mono text-muted">
              {nivel.hasta ? `${num(r.total)} / ${num(nivel.hasta)} → ${nivel.siguiente}` : "nivel máximo"}
            </span>
          </div>
          <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-surface-hover">
            <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-yellow-300 transition-all" style={{ width: `${avance}%` }} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-surface-hover px-2 py-2">
            <p className="font-mono text-lg font-black text-ink">{r.hoy.misiones}</p>
            <p className="text-[10px] font-bold uppercase text-muted">misiones hoy</p>
          </div>
          <div className="rounded-lg bg-surface-hover px-2 py-2">
            <p className="font-mono text-lg font-black text-amber-600 dark:text-amber-400">+{num(r.hoy.monedas)}</p>
            <p className="text-[10px] font-bold uppercase text-muted">monedas hoy</p>
          </div>
          <div className="rounded-lg bg-surface-hover px-2 py-2">
            <p className="font-mono text-lg font-black text-ink">{r.racha > 0 ? `🔥 ${r.racha}` : "0"}</p>
            <p className="text-[10px] font-bold uppercase text-muted">días de racha</p>
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-extrabold uppercase tracking-wide text-muted">Cuánto paga cada misión</p>
          <div className="max-h-96 space-y-1 overflow-y-auto pr-1">
            {areas.map(({ area, misiones }, i) => (
              <details key={area} open={i === 0} className="rounded-lg border border-border px-2 py-1">
                <summary className="cursor-pointer text-xs font-extrabold text-ink">
                  {area}
                  <span className="ml-1 font-mono text-[10px] font-bold text-muted">
                    · {misiones.reduce((n, t) => n + t.veces, 0)} hechas
                  </span>
                </summary>
                <ul className="mt-1 space-y-1 pb-1">
                  {misiones.map((t) => (
                    <li key={t.clave} className="flex items-center gap-2 text-xs">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${COLOR_DIFICULTAD[t.dificultad] ?? ""}`}>{t.dificultad}</span>
                      <span className="min-w-0 flex-1 truncate text-ink" title={t.tope_dia ? `Paga hasta ${t.tope_dia} veces al día` : undefined}>{t.titulo}</span>
                      {t.veces > 0 && <span className="font-mono text-[10px] text-muted">×{t.veces}</span>}
                      <span className="w-14 text-right font-mono font-black text-amber-600 dark:text-amber-400">{t.monedas} 🪙</span>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-muted">
            Lo mismo paga una vez al día y las misiones repetitivas tienen tope diario (pasa el cursor sobre la misión).
            Las monedas son del juego: no son dinero.
          </p>
        </div>
      </div>

      {/* Insignias + historial */}
      <div className={`${caja} space-y-4 xl:col-span-7`}>
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-extrabold uppercase tracking-wide text-muted">Insignias</h3>
          <span className="font-mono text-xs font-bold text-muted">{ganados} / {r.logros.length}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {r.logros.map((l) => (
            <div
              key={l.clave}
              title={l.desbloqueado_en ? `Desbloqueado el ${cuando(l.desbloqueado_en)}` : "Aún bloqueado"}
              className={`rounded-lg border-2 px-2 py-2 text-center ${
                l.desbloqueado_en ? "border-amber-400 bg-amber-400/10" : "border-dashed border-border opacity-50 grayscale"
              }`}
            >
              <div className="text-2xl leading-none" aria-hidden="true">{l.desbloqueado_en ? l.icono : "🔒"}</div>
              <p className="mt-1 text-[11px] font-extrabold text-ink">{l.nombre}</p>
              <p className="text-[10px] leading-tight text-muted">{l.descripcion}</p>
            </div>
          ))}
        </div>

        <div>
          <p className="mb-1.5 text-xs font-extrabold uppercase tracking-wide text-muted">Últimas misiones</p>
          {r.historial.length === 0 ? (
            <p className="text-xs text-muted">Todavía no hay misiones. Resuelve una tarea, responde a un cliente o aprueba una etiqueta para ganar tus primeras monedas.</p>
          ) : (
            <ul className="max-h-72 divide-y divide-border overflow-y-auto">
              {r.historial.map((h, i) => (
                <li key={i} className="flex items-center gap-2 py-1.5 text-xs">
                  <span className="w-24 shrink-0 font-mono text-[10px] text-muted">{cuando(h.creado_en)}</span>
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-semibold text-ink">{h.titulo}</span>
                    {(h.detalle || h.ref) && <span className="text-muted"> · {h.detalle || h.ref}</span>}
                  </span>
                  <span className="shrink-0 font-mono font-black text-amber-600 dark:text-amber-400">+{h.monedas}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
