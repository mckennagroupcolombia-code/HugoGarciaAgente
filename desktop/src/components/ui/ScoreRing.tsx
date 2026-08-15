/**
 * Gauge circular de calificación (0-100) — extraído de WhatsAppMetricas.tsx
 * para reutilizarlo en SaludNegocioPanel.tsx sin duplicar la pieza visual.
 * Los cortes de color (85/70/50) son la referencia visual que otros módulos
 * también citan (ver app/services/salud_negocio.py::_CORTES_CALIFICACION).
 */
export function colorNota(n: number): string {
  if (n >= 85) return "text-emerald-400";
  if (n >= 70) return "text-sky-400";
  if (n >= 50) return "text-amber-400";
  return "text-red-400";
}

export function ringNota(n: number): string {
  if (n >= 85) return "stroke-emerald-500";
  if (n >= 70) return "stroke-sky-500";
  if (n >= 50) return "stroke-amber-500";
  return "stroke-red-500";
}

export function ScoreRing({ nota, label, sub }: { nota: number; label: string; sub: string }) {
  const r = 42;
  const circ = 2 * Math.PI * r;
  const offset = circ - (nota / 100) * circ;
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-28 h-28">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeWidth="8" className="text-surface-hover" />
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            strokeWidth="8"
            strokeLinecap="round"
            className={ringNota(nota)}
            strokeDasharray={circ}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-2xl font-bold tabular-nums ${colorNota(nota)}`}>{nota}</span>
          <span className="text-[9px] text-muted uppercase">/ 100</span>
        </div>
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold text-ink">{label}</p>
        <p className="text-[11px] text-muted">{sub}</p>
      </div>
    </div>
  );
}
