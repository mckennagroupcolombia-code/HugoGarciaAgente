import { useEffect, useMemo, useState } from "react";
import { asignarAutorCommit, useGitLog, type GitAutoCommitEstado } from "../hooks/useGitLog";
import { asignarAutorRecap, useTeamRecaps, type TeamRecap } from "../hooks/useTeamRecaps";
import { layoutCommitGraph, type GraphEdge, type LaidOutCommit } from "../lib/gitGraphLayout";
import { HUB_TAB_LABEL, hubTabClass } from "../lib/hubTabClass";

// Desarrolladores conocidos del proyecto (cuenta git compartida): usado para
// el selector "¿Quién hizo esto?" en commits y recaps. Coincide con
// DESARROLLADORES_CONOCIDOS en app/tools/git_history.py (solo sugerencia de UX;
// el backend acepta cualquier texto).
const DESARROLLADORES_CONOCIDOS = ["Cynthia", "Armando García"];

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

/** Color determinístico por autor (mismo autor → mismo color siempre). */
function colorDeAutor(autor: string): string {
  let h = 0;
  for (let i = 0; i < autor.length; i++) h = (h * 31 + autor.charCodeAt(i)) >>> 0;
  return LANE_COLORS[h % LANE_COLORS.length];
}

function inicialesAutor(autor: string): string {
  const partes = autor.trim().split(/\s+/);
  if (!partes.length || !partes[0]) return "?";
  return (partes[0][0] + (partes[1]?.[0] ?? "")).toUpperCase();
}

function esAutoCommit(asunto: string): boolean {
  return /^auto-commit:/i.test(asunto.trim());
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
          className={hubTabClass(active === t.id, "flex-1 justify-center")}
        >
          <span className={HUB_TAB_LABEL}>{t.label}</span>
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

function fechaRelativa(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "hace un momento";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  if (diff < 86400 * 7) return `hace ${Math.floor(diff / 86400)} d`;
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "short" });
}

// ── Indicadores de auto-commit ───────────────────────────────────────────────

/** Milisegundos que faltan hasta un ISO local; nunca negativo. */
function msRestantes(objetivoIso: string, ahoraMs: number): number {
  const t = new Date(objetivoIso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, t - ahoraMs);
}

function formatRestante(ms: number): string {
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h} h ${m.toString().padStart(2, "0")} min`;
  if (m > 0) return `${m} min`;
  return "menos de 1 min";
}

const DIA_MS = 24 * 3600 * 1000;

function AutoCommitCard({
  titulo,
  detalle,
  objetivoIso,
  ahoraMs,
  acento,
}: {
  titulo: string;
  detalle: string;
  objetivoIso: string;
  ahoraMs: number;
  acento: string;
}) {
  const restante = msRestantes(objetivoIso, ahoraMs);
  // Progreso del ciclo diario: 0% recién pasó, 100% a punto de dispararse.
  const pct = Math.min(100, Math.max(0, ((DIA_MS - restante) / DIA_MS) * 100));
  const inminente = restante < 30 * 60_000;
  return (
    <div className="flex-1 min-w-[210px] rounded-xl border border-border bg-surface-panel px-4 py-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-ink">{titulo}</p>
        <span
          className="text-[10px] font-mono rounded-full px-2 py-0.5 border"
          style={{ color: acento, borderColor: `${acento}55`, backgroundColor: `${acento}18` }}
        >
          {new Date(objetivoIso).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
      <p className={`text-lg font-bold tabular-nums ${inminente ? "text-amber-400" : "text-ink"}`}>
        {formatRestante(restante)}
      </p>
      <div className="h-1.5 rounded-full bg-surface-hover overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: acento }}
        />
      </div>
      <p className="text-[10px] text-muted leading-snug">{detalle}</p>
    </div>
  );
}

function AutoCommitIndicadores({ estado }: { estado: GitAutoCommitEstado }) {
  const [ahoraMs, setAhoraMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAhoraMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const hayPendientes = estado.archivos_pendientes > 0;

  return (
    <div className="flex flex-wrap gap-3">
      <div className="flex-1 min-w-[210px] rounded-xl border border-border bg-surface-panel px-4 py-3 space-y-2">
        <p className="text-xs font-semibold text-ink">Cambios sin commitear</p>
        <p className={`text-lg font-bold tabular-nums ${hayPendientes ? "text-amber-400" : "text-emerald-400"}`}>
          {estado.archivos_pendientes} archivo{estado.archivos_pendientes !== 1 ? "s" : ""}
        </p>
        <p className="text-[10px] text-muted leading-snug">
          {hayPendientes
            ? "Se incluirán en el próximo auto-commit si nadie los commitea antes."
            : "El árbol de trabajo está limpio: el próximo auto-commit no hará nada."}
        </p>
      </div>
      <AutoCommitCard
        titulo="Auto-commit diario"
        detalle="Cron auto_commit.sh: git add -A + commit + push (todos los días a las 23:00)."
        objetivoIso={estado.proximo_diario}
        ahoraMs={ahoraMs}
        acento="#3987e5"
      />
      <AutoCommitCard
        titulo="Backup nocturno + push"
        detalle="backup_drive.py: respaldo a Drive y luego commit + push si hay cambios (02:00)."
        objetivoIso={estado.proximo_backup}
        ahoraMs={ahoraMs}
        acento="#199e70"
      />
    </div>
  );
}

// ── Tab Árbol de commits ─────────────────────────────────────────────────────

const ROW_H = 46;
const LANE_W = 26;
const PAD_X = 20;
const NODE_R = 6;

function rutaArista(e: GraphEdge): string {
  const x1 = PAD_X + e.fromLane * LANE_W;
  const y1 = e.fromRow * ROW_H + ROW_H / 2;
  const x2 = PAD_X + e.toLane * LANE_W;
  const y2 = e.toRow * ROW_H + ROW_H / 2;
  if (e.fromLane === e.toLane) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const yMid = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${yMid}, ${x2} ${yMid}, ${x2} ${y2}`;
}

function AutorChip({ autor, tamano = 24 }: { autor: string; tamano?: number }) {
  const color = colorDeAutor(autor);
  return (
    <span
      title={autor}
      className="shrink-0 rounded-full flex items-center justify-center font-bold text-white"
      style={{
        width: tamano,
        height: tamano,
        fontSize: tamano * 0.42,
        backgroundColor: color,
      }}
    >
      {inicialesAutor(autor)}
    </span>
  );
}

function RefBadge({ nombre }: { nombre: string }) {
  const esHead = nombre.startsWith("HEAD");
  const esOrigin = nombre.startsWith("origin/");
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap ${
        esHead
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
          : esOrigin
            ? "border-blue-500/40 bg-blue-500/10 text-blue-400"
            : "border-accent/30 bg-accent/10 text-accent"
      }`}
    >
      {nombre}
    </span>
  );
}

/** Botón + menú pequeño: "¿Quién hizo esto?" — asigna autor entre los desarrolladores conocidos. */
function SelectorAutorBoton({
  valorActual,
  onAsignar,
  guardando,
  compacto,
  ocultarValorEnBoton,
}: {
  valorActual?: string | null;
  onAsignar: (autor: string) => void;
  guardando?: boolean;
  compacto?: boolean;
  /** Si el autor ya se muestra afuera (ej. chip en la tarjeta), no repetirlo en el botón. */
  ocultarValorEnBoton?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const mostrarValor = valorActual && !ocultarValorEnBoton;
  return (
    <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        disabled={guardando}
        className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium transition disabled:opacity-50 ${
          mostrarValor
            ? "border-accent/30 bg-accent/10 text-accent"
            : "border-border bg-surface-hover text-muted hover:text-ink hover:border-accent/40"
        }`}
        title="Asignar quién hizo esto"
      >
        {guardando ? "…" : mostrarValor ? `👤 ${valorActual}` : compacto ? "¿Quién? ▾" : "¿Quién hizo esto? ▾"}
      </button>
      {abierto && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setAbierto(false)} />
          <div className="absolute right-0 z-20 mt-1 w-48 rounded-lg border border-border bg-surface-panel shadow-lg py-1">
            <p className="px-3 py-1 text-[10px] text-muted uppercase tracking-wide">¿Quién hizo esto?</p>
            {DESARROLLADORES_CONOCIDOS.map((nombre) => (
              <button
                key={nombre}
                type="button"
                onClick={() => {
                  onAsignar(nombre);
                  setAbierto(false);
                }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-surface-hover ${
                  valorActual === nombre ? "text-accent font-semibold" : "text-ink"
                }`}
              >
                <AutorChip autor={nombre} tamano={16} />
                {nombre}
                {valorActual === nombre && <span className="ml-auto">✓</span>}
              </button>
            ))}
            {valorActual && (
              <button
                type="button"
                onClick={() => {
                  onAsignar("");
                  setAbierto(false);
                }}
                className="w-full px-3 py-1.5 mt-1 border-t border-border/60 text-left text-xs text-muted hover:bg-surface-hover"
              >
                Quitar asignación
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function TabCommits() {
  const { data, isLoading, error, refetch } = useGitLog(200);
  const [seleccionado, setSeleccionado] = useState<LaidOutCommit | null>(null);
  const [zoom, setZoom] = useState(100);
  const [atenuarAuto, setAtenuarAuto] = useState(true);
  const [guardandoHash, setGuardandoHash] = useState<string | null>(null);

  const layout = useMemo(() => layoutCommitGraph(data?.commits ?? []), [data?.commits]);

  // Tras reasignar autor, `data` se refresca con objetos nuevos: mantener el
  // commit seleccionado sincronizado con la versión más reciente (mismo hash).
  useEffect(() => {
    if (!seleccionado) return;
    const actualizado = layout.nodes.find((n) => n.hash === seleccionado.hash);
    if (actualizado && actualizado !== seleccionado) setSeleccionado(actualizado);
  }, [layout.nodes, seleccionado]);

  async function handleAsignarCommit(hash: string, autor: string) {
    setGuardandoHash(hash);
    try {
      await asignarAutorCommit(hash, autor);
      await refetch();
    } catch {
      /* silencioso — el chip vuelve a mostrar el valor anterior tras refetch */
    } finally {
      setGuardandoHash(null);
    }
  }

  const autores = useMemo(() => {
    const s = new Map<string, number>();
    for (const c of data?.commits ?? []) s.set(c.autor, (s.get(c.autor) ?? 0) + 1);
    return [...s.entries()].sort((a, b) => b[1] - a[1]);
  }, [data?.commits]);

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

  const svgW = PAD_X * 2 + (layout.laneCount - 1) * LANE_W;
  const svgH = layout.nodes.length * ROW_H;

  return (
    <div className="space-y-4">
      {data?.auto_commit && <AutoCommitIndicadores estado={data.auto_commit} />}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-muted">
            Rama: <span className="font-mono text-ink">{data?.rama_actual ?? "—"}</span> ·{" "}
            {layout.nodes.length} commits
          </p>
          {autores.map(([autor, n]) => (
            <span
              key={autor}
              className="flex items-center gap-1.5 rounded-full border border-border bg-surface-panel px-2 py-0.5"
              title={`${n} commits`}
            >
              <AutorChip autor={autor} tamano={16} />
              <span className="text-[11px] text-muted">{autor}</span>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={atenuarAuto}
              onChange={(e) => setAtenuarAuto(e.target.checked)}
              className="accent-current"
            />
            Atenuar auto-commits
          </label>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setZoom((z) => Math.max(70, z - 10))}
              className="rounded-lg border border-border bg-surface-hover px-2 py-1 text-xs text-muted hover:text-ink"
            >
              −
            </button>
            <span className="text-xs text-muted w-10 text-center">{zoom}%</span>
            <button
              onClick={() => setZoom((z) => Math.min(160, z + 10))}
              className="rounded-lg border border-border bg-surface-hover px-2 py-1 text-xs text-muted hover:text-ink"
            >
              +
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface-panel overflow-auto max-h-[62vh]">
        <div className="flex min-w-max" style={{ zoom: zoom / 100 }}>
          {/* Columna del grafo (carriles + nodos) */}
          <svg width={svgW} height={svgH} className="shrink-0 block">
            {layout.edges.map((e, i) => (
              <path
                key={i}
                d={rutaArista(e)}
                fill="none"
                stroke={colorDeCarril(e.fromLane)}
                strokeWidth={2.5}
                opacity={0.55}
              />
            ))}
            {layout.nodes.map((n) => {
              const x = PAD_X + n.lane * LANE_W;
              const y = n.row * ROW_H + ROW_H / 2;
              const activo = seleccionado?.hash === n.hash;
              const auto = esAutoCommit(n.asunto);
              return (
                <g key={n.hash} onClick={() => setSeleccionado(activo ? null : n)} className="cursor-pointer">
                  <circle
                    cx={x}
                    cy={y}
                    r={activo ? NODE_R + 2.5 : NODE_R}
                    fill={colorDeCarril(n.lane)}
                    opacity={atenuarAuto && auto && !activo ? 0.35 : 1}
                    stroke={activo ? "var(--tw-ring-color, #fff)" : "none"}
                    strokeWidth={activo ? 2 : 0}
                  />
                  {n.parents.length > 1 && (
                    <circle cx={x} cy={y} r={NODE_R * 0.4} fill="#fff" opacity={0.85} />
                  )}
                </g>
              );
            })}
          </svg>

          {/* Filas HTML alineadas al grafo (texto grande y legible) */}
          <div className="flex-1 min-w-[480px]">
            {layout.nodes.map((n) => {
              const activo = seleccionado?.hash === n.hash;
              const auto = esAutoCommit(n.asunto);
              const nombreMostrado = n.autor_manual || n.autor;
              return (
                <div
                  key={n.hash}
                  className={`flex items-center gap-2 pr-3 border-l-2 transition ${
                    activo ? "bg-accent/10 border-accent" : "border-transparent hover:bg-surface-hover"
                  } ${atenuarAuto && auto && !activo ? "opacity-45" : ""}`}
                  style={{ height: ROW_H }}
                >
                  <button
                    type="button"
                    onClick={() => setSeleccionado(activo ? null : n)}
                    className="flex-1 min-w-0 flex items-center gap-3 pl-3 h-full text-left"
                  >
                    <AutorChip autor={nombreMostrado} />
                    <span className="font-mono text-xs text-muted shrink-0">{n.hash_corto}</span>
                    <span
                      className={`text-[13.5px] truncate ${auto ? "text-muted" : "text-ink font-medium"}`}
                    >
                      {n.asunto}
                    </span>
                  </button>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {n.refs.slice(0, 2).map((r) => (
                      <RefBadge key={r} nombre={r} />
                    ))}
                    <span className="text-[11px] text-muted whitespace-nowrap">{fechaRelativa(n.fecha)}</span>
                    <SelectorAutorBoton
                      valorActual={n.autor_manual}
                      guardando={guardandoHash === n.hash}
                      compacto
                      onAsignar={(autor) => handleAsignarCommit(n.hash, autor)}
                    />
                  </span>
                </div>
              );
            })}
          </div>
        </div>
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
            {seleccionado.parents.length > 1 && (
              <span className="text-[10px] rounded-full border border-border px-2 py-0.5 text-muted">
                merge · {seleccionado.parents.length} padres
              </span>
            )}
          </div>
          <p className="text-sm text-ink font-medium">{seleccionado.asunto}</p>
          <div className="flex flex-wrap items-center gap-2">
            <AutorChip autor={seleccionado.autor_manual || seleccionado.autor} tamano={20} />
            <p className="text-xs text-muted">
              {seleccionado.autor} · {seleccionado.email}
              {seleccionado.autor_manual && (
                <span className="text-accent"> · asignado a {seleccionado.autor_manual}</span>
              )}
            </p>
            <SelectorAutorBoton
              valorActual={seleccionado.autor_manual}
              guardando={guardandoHash === seleccionado.hash}
              onAsignar={(autor) => handleAsignarCommit(seleccionado.hash, autor)}
            />
          </div>
          {seleccionado.refs.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {seleccionado.refs.map((r) => (
                <RefBadge key={r} nombre={r} />
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

function RecapCard({
  recap,
  onAsignarAutor,
  guardando,
}: {
  recap: TeamRecap;
  onAsignarAutor: (indice: number, autor: string) => void;
  guardando: boolean;
}) {
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
        {recap.autor && (
          <span className="flex items-center gap-1.5">
            <AutorChip autor={recap.autor} tamano={18} />
            <span className="text-xs text-muted">{recap.autor}</span>
          </span>
        )}
        <SelectorAutorBoton
          valorActual={recap.autor || null}
          guardando={guardando}
          compacto
          ocultarValorEnBoton
          onAsignar={(autor) => onAsignarAutor(recap.indice, autor)}
        />
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
  const { data, isLoading, error, refetch } = useTeamRecaps(100);
  const [autorFiltro, setAutorFiltro] = useState<string | null>(null);
  const [guardandoIndice, setGuardandoIndice] = useState<number | null>(null);

  const recaps = useMemo(() => data?.recaps ?? [], [data?.recaps]);

  async function handleAsignarRecap(indice: number, autor: string) {
    setGuardandoIndice(indice);
    try {
      await asignarAutorRecap(indice, autor);
      await refetch();
    } catch {
      /* silencioso — refetch conserva el valor previo si falló */
    } finally {
      setGuardandoIndice(null);
    }
  }

  const autores = useMemo(() => {
    const s = new Map<string, number>();
    for (const r of recaps) {
      const a = r.autor.trim();
      if (a) s.set(a, (s.get(a) ?? 0) + 1);
    }
    return [...s.entries()].sort((a, b) => b[1] - a[1]);
  }, [recaps]);

  const visibles = autorFiltro ? recaps.filter((r) => r.autor.trim() === autorFiltro) : recaps;

  if (isLoading) return <p className="text-sm text-muted py-4">Cargando recaps del equipo…</p>;

  if (error || data?.error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
        {error instanceof Error ? error.message : data?.error ?? "No se pudo cargar docs/team-recaps.md"}
      </div>
    );
  }

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
      {/* Filtro por desarrollador (cuenta compartida → autor real del cambio) */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => setAutorFiltro(null)}
          className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
            autorFiltro === null
              ? "border-accent bg-accent text-white"
              : "border-border bg-surface-panel text-muted hover:text-ink"
          }`}
        >
          Todos ({recaps.length})
        </button>
        {autores.map(([autor, n]) => (
          <button
            key={autor}
            onClick={() => setAutorFiltro(autorFiltro === autor ? null : autor)}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
              autorFiltro === autor
                ? "border-accent bg-accent/15 text-accent"
                : "border-border bg-surface-panel text-muted hover:text-ink"
            }`}
          >
            <AutorChip autor={autor} tamano={16} />
            {autor} ({n})
          </button>
        ))}
      </div>

      <p className="text-xs text-muted">
        {visibles.length} recap{visibles.length !== 1 ? "s" : ""}
        {autorFiltro ? ` de ${autorFiltro}` : ""} · más reciente primero
      </p>
      {visibles.map((r) => (
        <RecapCard
          key={r.indice}
          recap={r}
          onAsignarAutor={handleAsignarRecap}
          guardando={guardandoIndice === r.indice}
        />
      ))}
    </div>
  );
}

// ── Panel principal ────────────────────────────────────────────────────────

export default function ControlVersionesPanel() {
  const [tab, setTab] = useState<Tab>("commits");

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-ink">Control de Versiones</h2>
        <p className="text-xs text-muted mt-0.5">
          Historial de git del repositorio, recaps por desarrollador y auto-commits programados
        </p>
      </div>

      <TabBar active={tab} onChange={setTab} />

      {tab === "commits" && <TabCommits />}
      {tab === "recaps" && <TabRecaps />}
    </div>
  );
}
