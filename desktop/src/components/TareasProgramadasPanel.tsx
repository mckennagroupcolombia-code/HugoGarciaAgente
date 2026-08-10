import { Icon } from "../icons";
import { useTareasCron, useEstablecerFrecuenciaCron } from "../hooks/useCron";

const FRECUENCIAS: { horas: number; label: string }[] = [
  { horas: 24, label: "Diario" },
  { horas: 72, label: "Cada 3 días" },
  { horas: 168, label: "Semanal" },
  { horas: 336, label: "Cada 2 semanas" },
  { horas: 720, label: "Mensual" },
];

function fmtFecha(iso: string | null): string {
  if (!iso) return "nunca";
  try {
    return new Date(iso).toLocaleString("es-CO", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function TareasProgramadasPanel() {
  const { data, isLoading } = useTareasCron();
  const establecer = useEstablecerFrecuenciaCron();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-paper border-2 border-border bg-surface-panel text-2xl shadow-paper-sm">
          <Icon name="clock" size={28} weight="bold" className="text-accent" />
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">Sistemas</p>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Tareas Programadas</h1>
          <p className="mt-1 text-sm text-muted">
            Frecuencia efectiva de los crons de la app — sin tocar el crontab del servidor.
          </p>
        </div>
      </div>

      <div className="rounded-paper border-2 border-dashed border-border bg-surface-panel p-4 text-xs text-muted">
        ℹ️ Cada job sigue disparándose por el cron real del servidor en su horario de siempre;
        lo que cambia acá es que se salta sin hacer nada si no ha pasado el intervalo
        configurado. Cambiar la frecuencia aquí es instantáneo y no requiere reiniciar nada ni
        tocar el crontab.
      </div>

      {isLoading && <p className="text-sm text-muted">Cargando tareas…</p>}

      <div className="space-y-3">
        {(data?.tareas ?? []).map((t) => (
          <div key={t.id} className="rounded-paper border-2 border-border bg-surface-panel p-4 shadow-paper-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-ink">{t.nombre}</p>
                <p className="mt-0.5 text-xs text-muted">{t.descripcion}</p>
                <p className="mt-1 text-[10px] text-muted">
                  <code>{t.script}</code>
                </p>
              </div>
              <select
                value={t.intervalo_horas}
                onChange={(e) =>
                  establecer.mutate({ jobId: t.id, intervaloHoras: Number(e.target.value) })
                }
                className="rounded-paper border border-border bg-surface-input px-2 py-1.5 text-sm text-ink"
              >
                {FRECUENCIAS.map((f) => (
                  <option key={f.horas} value={f.horas}>
                    {f.label}
                  </option>
                ))}
                {!FRECUENCIAS.some((f) => f.horas === t.intervalo_horas) && (
                  <option value={t.intervalo_horas}>Cada {t.intervalo_horas}h (personalizado)</option>
                )}
              </select>
            </div>
            <div className="mt-3 flex flex-wrap gap-4 border-t border-border pt-2 text-xs text-ink-secondary">
              <span>Última ejecución: {fmtFecha(t.ultima_ejecucion)}</span>
              <span>Próxima estimada: {fmtFecha(t.proxima_ejecucion_estimada)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
