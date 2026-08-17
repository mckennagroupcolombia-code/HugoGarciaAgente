import { useState } from "react";
import {
  usePostventaEstadisticas,
  type PostventaBarra,
} from "../hooks/usePostventa";
import { IllustrationIcon } from "../icons/IllustrationIcon";
import type { IllustrationTone } from "../icons/IllustrationIcon";
import type { UiIconName } from "../icons";

const PERIODOS = [
  { dias: 7, label: "7 días" },
  { dias: 30, label: "30 días" },
  { dias: 90, label: "90 días" },
];

const SLA_COLOR: Record<string, string> = {
  excelente: "bg-emerald-500",
  bueno: "bg-sky-500",
  aceptable: "bg-amber-500",
  lento: "bg-orange-500",
  critico: "bg-red-500",
};

const BAR_PALETTE = [
  "bg-accent",
  "bg-sky-500",
  "bg-amber-500",
  "bg-violet-500",
  "bg-emerald-500",
  "bg-orange-500",
  "bg-rose-500",
];

function fmtMin(min: number | null | undefined): string {
  if (min == null) return "—";
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return rh ? `${d}d ${rh}h` : `${d}d`;
  }
  return m ? `${h}h ${m}m` : `${h}h`;
}

function BarList({
  items,
  empty,
  colorByGrado,
}: {
  items: PostventaBarra[];
  empty: string;
  colorByGrado?: boolean;
}) {
  if (!items.length) {
    return <p className="text-sm text-muted">{empty}</p>;
  }
  const maxPct = Math.max(...items.map((i) => i.pct), 1);
  return (
    <div className="space-y-2.5">
      {items.map((item, i) => (
        <div key={item.id || item.label} className="space-y-1">
          <div className="flex justify-between gap-2 text-sm">
            <span className="min-w-0 truncate text-ink">{item.label}</span>
            <span className="shrink-0 tabular-nums text-muted">
              {item.count} · {item.pct.toFixed(0)}%
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-hover">
            <div
              className={`h-full rounded-full ${
                colorByGrado
                  ? (SLA_COLOR[item.grado ?? ""] ?? "bg-accent")
                  : BAR_PALETTE[i % BAR_PALETTE.length]
              }`}
              style={{ width: `${Math.max(4, (item.pct / maxPct) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  icon,
  tone = "accent",
}: {
  label: string;
  value: string;
  sub?: string;
  icon: UiIconName;
  tone?: IllustrationTone;
}) {
  return (
    <div className="mck-card mck-card-interactive group flex gap-3 p-4">
      <IllustrationIcon
        name={icon}
        size={36}
        tone={tone}
        className="mck-illus-icon--hoverable shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold tracking-tight text-muted">{label}</p>
        <p className="mt-0.5 text-2xl font-extrabold tabular-nums tracking-tight text-ink sm:text-3xl">
          {value}
        </p>
        {sub && <p className="mt-0.5 text-sm text-muted">{sub}</p>}
      </div>
    </div>
  );
}

export default function PostventaEstadisticas() {
  const [dias, setDias] = useState(30);
  const { data, isLoading, isError, refetch } = usePostventaEstadisticas(dias);

  return (
    <section className="rounded-xl border border-border bg-surface-panel p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <IllustrationIcon name="chartBar" size={32} tone="sky" />
          <div>
            <h3 className="text-lg font-extrabold text-ink">Estadísticas</h3>
            <p className="text-sm text-muted">
              Motivos de reclamo, tiempos de respuesta y solicitudes frecuentes.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {PERIODOS.map((p) => (
            <button
              key={p.dias}
              type="button"
              onClick={() => setDias(p.dias)}
              className={`min-h-9 rounded-lg px-2.5 py-1.5 text-sm font-medium transition ${
                dias === p.dias
                  ? "bg-accent text-white"
                  : "border border-border text-muted hover:text-ink"
              }`}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void refetch()}
            className="min-h-9 rounded-lg border border-border px-2.5 py-1.5 text-sm text-muted hover:text-ink"
          >
            Recalcular
          </button>
        </div>
      </div>

      {isLoading && !data && (
        <p className="mt-3 text-sm text-muted">Calculando estadísticas…</p>
      )}
      {isError && (
        <p className="mt-3 text-sm text-danger">
          No se pudieron cargar las estadísticas.
        </p>
      )}

      {data && (
        <div className="mt-3 space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Kpi
              label="En cola"
              value={String(data.cola.pendientes)}
              sub={
                data.cola.espera_mediana_min != null
                  ? `espera típica ${fmtMin(data.cola.espera_mediana_min)}`
                  : "sin espera abierta"
              }
              icon="inbox"
              tone="sun"
            />
            <Kpi
              label="Mediana respuesta"
              value={fmtMin(data.tiempos.mediana_min)}
              sub={
                data.tiempos.respondidos
                  ? `${data.tiempos.respondidos} respondidos`
                  : "se mide al responder"
              }
              icon="clock"
              tone="plum"
            />
            <Kpi
              label="Reclamos"
              value={String(data.reclamos.total)}
              sub={
                data.reclamos.total
                  ? `${data.reclamos.abiertos} abiertos`
                  : "sin reclamos en el período"
              }
              icon="package"
              tone="rose"
            />
            <Kpi
              label="Solicitudes"
              value={String(data.solicitudes_total)}
              sub={
                data.tiempos.sla_24h_pct != null
                  ? `${data.tiempos.sla_24h_pct.toFixed(0)}% en <24 h`
                  : undefined
              }
              icon="chartBar"
              tone="sky"
            />
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-border bg-surface px-3 py-3">
              <p className="mb-2 text-sm font-semibold text-ink">
                Motivos de reclamo
              </p>
              <BarList
                items={data.reclamos.motivos}
                empty="Aún no hay reclamos registrados. Aparecen con webhooks de MeLi o tickets de nota crédito."
              />
            </div>
            <div className="rounded-xl border border-border bg-surface px-3 py-3">
              <p className="mb-2 text-sm font-semibold text-ink">
                Tiempos de respuesta
              </p>
              <BarList
                items={data.tiempos.sla}
                empty="Cuando respondan o omitan mensajes de la cola, aquí se verá qué tan rápido se atiende."
                colorByGrado
              />
            </div>
            <div className="rounded-xl border border-border bg-surface px-3 py-3">
              <p className="mb-2 text-sm font-semibold text-ink">
                Solicitudes frecuentes
              </p>
              <BarList
                items={data.solicitudes}
                empty="No hay mensajes clasificados en este período."
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
