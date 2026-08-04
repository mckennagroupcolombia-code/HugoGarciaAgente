import { useMemo, useState } from "react";
import { useGitLog, type GitCommit } from "../hooks/useGitLog";
import { useTeamRecaps, type TeamRecap } from "../hooks/useTeamRecaps";
import { layoutCommitGraph, type GraphEdge, type LaidOutCommit } from "../lib/gitGraphLayout";

// ── Paleta categórica (skill dataviz — references/palette.md, columna dark) ─
// Orden fijo, nunca ciclado por rango/rank: se asigna por índice de carril.
const LANE_COLORS = [
  "#3987e5", // 1 azul
  "#d95926", // 2 naranja
  "#199e70", // 3 aqua
  "#c98500", // 4 amarillo
  "#d55181", // 5 magenta
  "#008300", // 6 verde
  "#9085e9", // 7 violeta
  "#e66767", // 8 rojo
];

function colorDeCarril(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length];
}

// ── Tab bar (mismo patrón que SupervisorPanel) ───────────────────────────────

type Tab = "commits" | "recaps";

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "commits", label: "Árbol de commits" },
    { id: "recaps", label: "Recaps del equipo" },
  ];
  return (
    <div className="flex gap-1 rounded-xl border border-border bg-surface-panel p-1 mb-4">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`flex-1 rounded-lg py-2 text-xs font-semibold transition ${
            active === t.id
              ? "bg-accent text-white shadow-sm"
              : "text-muted hover:text-ink hover:bg-surface-hover"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function formatFecha(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Tab Árbol de commits ─────────────────────────────────────────────────────

const ROW_H = 34;
const LANE_W = 22;
const PAD_X = 18;
const PAD_Y = 18;
const NODE_R = 5;

function rutaArista(e: GraphEdge): string {
  const x1 = PAD_X + e.fromLane * LANE_W;
  const y1 = PAD_Y + e.fromRow * ROW_H;
  const x2 = PAD_X + e.toLane * LANE_W;
  const y2 = PAD_Y + e.toRow * ROW_H;
  if (e.fromLane === e.toLane) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const yMid = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${yMid}, ${x2} ${yMid}, ${x2} ${y2}`;
}

function TabCommits() {
  const { data, isLoading, error } = useGitLog(200);
  const [seleccionado, setSeleccionado] = useState<LaidOutCommit | null>(null);
  const [zoom, setZoom] = useState(100);

  const layout = useMemo(() => layoutCommitGraph(data?.commits ?? []), [data?.commits]);

  if (isLoading) return <p className="text-sm text-muted py-4">Cargando historial de commits…</p>;

  if (error || data?.error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
        {error instanceof Error ? error.message : data?.error ?? "No se pudo cargar el historial de git"}
      </div>
    );
  }

  if (!layout.nodes.length) {
    return (
      <div className="rounded-xl border border-border bg-surface-panel px-5 py-8 text-center">
        <p className="text-sm text-muted">Sin commits para mostrar</p>
      </div>
    );
  }

  const svgW = PAD_X * 2 + layout.laneCount * LANE_W;
  const svgH = PAD_Y * 2 + layout.nodes.length * ROW_H;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">
          Rama actual: <span className="font-mono text-ink">{data?.rama_actual ?? "—"}</span> ·{" "}
          {layout.nodes.length} commits
        </p>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setZoom((z) => Math.max(50, z - 10))}
            className="rounded-lg border border-border bg-surface-hover px-2 py-1 text-xs text-muted hover:text-ink"
          >
            −
          </button>
          <span className="text-xs text-muted w-10 text-center">{zoom}%</span>
          <button
            onClick={() => setZoom((z) => Math.min(200, z + 10))}
            className="rounded-lg border border-border bg-surface-hover px-2 py-1 text-xs text-muted hover:text-ink"
          >
            +
          </button>
          <button
            onClick={() => setZoom(100)}
            className="rounded-lg border border-border bg-surface-hover px-2 py-1 text-xs text-muted hover:text-ink"
          >
            reset
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface-panel p-3 overflow-auto max-h-[65vh]">
        <svg
          width={svgW * (zoom / 100)}
          height={svgH * (zoom / 100)}
          viewBox={`0 0 ${svgW} ${svgH}`}
          className="block"
        >
          {layout.edges.map((e, i) => (
            <path
              key={i}
              d={rutaArista(e)}
              fill="none"
              stroke={colorDeCarril(e.fromLane)}
              strokeWidth={2}
              opacity={0.55}
            />
          ))}
          {layout.nodes.map((n) => {
            const x = PAD_X + n.lane * LANE_W;
            const y = PAD_Y + n.row * ROW_H;
            const activo = seleccionado?.hash === n.hash;
            return (
              <g
                key={n.hash}
                onClick={() => setSeleccionado(n)}
                className="cursor-pointer"
              >
                <circle
                  cx={x}
                  cy={y}
                  r={activo ? NODE_R + 2 : NODE_R}
                  fill={colorDeCarril(n.lane)}
                  stroke={activo ? "#fff" : "none"}
                  strokeWidth={activo ? 1.5 : 0}
                />
                <text x={x + LANE_W * layout.laneCount - PAD_X + 6} y={y + 4} className="hidden" />
                <foreignObject x={PAD_X + layout.laneCount * LANE_W} y={y - 12} width={2000} height={24}>
                  <div
                    className="text-[11px] text-ink truncate pr-4 flex items-center gap-2"
                    style={{ maxWidth: 900 }}
                  >
                    <span className="font-mono text-muted">{n.hash_corto}</span>
                    <span className="truncate">{n.asunto}</span>
                    {n.refs.length > 0 && (
                      <span className="shrink-0 rounded-full border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
                        {n.refs[0]}
                      </span>
                    )}
                  </div>
                </foreignObject>
              </g>
            );
          })}
        </svg>
      </div>

      {seleccionado && (
        <div className="rounded-xl border border-border bg-surface-panel px-4 py-3 space-y-1.5">
          <div className="flex items-center gap-2">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: colorDeCarril(seleccionado.lane) }}
            />
            <span className="font-mono text-xs text-muted">{seleccionado.hash_corto}</span>
            <span className="text-xs text-muted">{formatFecha(seleccionado.fecha)}</span>
          </div>
          <p className="text-sm text-ink font-medium">{seleccionado.asunto}</p>
          <p className="text-xs text-muted">
            {seleccionado.autor} · {seleccionado.email}
          </p>
          {seleccionado.refs.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {seleccionado.refs.map((r) => (
                <span
                  key={r}
                  className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] text-accent"
                >
                  {r}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Tab Recaps del equipo ─────────────────────────────────────────────────────

const TIPO_BADGE: Record<string, string> = {
  "nueva funcionalidad": "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  correccion: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  corrección: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  "mejora tecnica": "border-blue-500/30 bg-blue-500/10 text-blue-400",
  "mejora técnica": "border-blue-500/30 bg-blue-500/10 text-blue-400",
};

function badgeTipo(tipo: string): string {
  return TIPO_BADGE[tipo.trim().toLowerCase()] ?? "border-border bg-surface-hover text-muted";
}

function RecapCard({ recap }: { recap: TeamRecap }) {
  return (
    <div className="rounded-xl border border-border bg-surface-panel px-4 py-3.5 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">{recap.titulo || "(sin título)"}</p>
        <span className="text-[11px] text-muted whitespace-nowrap">{recap.fecha}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {recap.tipo_cambio && (
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${badgeTipo(recap.tipo_cambio)}`}>
            {recap.tipo_cambio}
          </span>
        )}
        {recap.autor && <span className="text-xs text-muted">por {recap.autor}</span>}
      </div>
      {recap.que_se_implemento.length > 0 && (
        <ul className="list-disc list-inside space-y-0.5 text-xs text-ink/90">
          {recap.que_se_implemento.map((linea, i) => (
            <li key={i}>{linea}</li>
          ))}
        </ul>
      )}
      {recap.archivos_modificados && (
        <p className="text-[11px] text-muted font-mono pt-1 border-t border-border/60 mt-2">
          {recap.archivos_modificados}
        </p>
      )}
    </div>
  );
}

function TabRecaps() {
  const { data, isLoading, error } = useTeamRecaps(100);

  if (isLoading) return <p className="text-sm text-muted py-4">Cargando recaps del equipo…</p>;

  if (error || data?.error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
        {error instanceof Error ? error.message : data?.error ?? "No se pudo cargar docs/team-recaps.md"}
      </div>
    );
  }

  const recaps = data?.recaps ?? [];

  if (!recaps.length) {
    return (
      <div className="rounded-xl border border-border bg-surface-panel px-5 py-8 text-center">
        <p className="text-sm text-muted">Sin recaps registrados aún</p>
        <p className="text-xs text-muted mt-1">
          Se agregan automáticamente en <code>docs/team-recaps.md</code> al terminar una tarea con la IA.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">{recaps.length} recaps · más reciente primero</p>
      {recaps.map((r, i) => (
        <RecapCard key={i} recap={r} />
      ))}
    </div>
  );
}

// ── Panel principal ────────────────────────────────────────────────────────

export default function ControlVersionesPanel() {
  const [tab, setTab] = useState<Tab>("commits");

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-ink">Control de Versiones</h2>
        <p className="text-xs text-muted mt-0.5">
          Historial de git del repositorio y recaps de cada tarea trabajada con la IA
        </p>
      </div>

      <TabBar active={tab} onChange={setTab} />

      {tab === "commits" && <TabCommits />}
      {tab === "recaps" && <TabRecaps />}
    </div>
  );
}

// Tipos re-exportados por conveniencia para consumidores externos del panel.
export type { GitCommit };
