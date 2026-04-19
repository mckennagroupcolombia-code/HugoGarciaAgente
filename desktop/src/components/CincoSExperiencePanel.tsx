import { useEffect, useId, useMemo, useState } from "react";
import { useCincoSAssistant, useCincoSWorkspace, useSaveCincoSWorkspace, type CincoSWorkspace, type ProjectRow, type ShoppingItem } from "../hooks/useCincoS";
import { CincoSRoutineWizard } from "./CincoSGuidedFlow";
import { RoutineMascot } from "./CincoSMascots";

type Section = "create" | "routines" | "hugo" | "detail";
type LedState = "ok" | "bad" | "off";
type ExecRow = { kind: "mat" | "pre" | "task" | "post"; id: string; label: string };
const WEEKDAY_OPTIONS = [
  { id: 1, label: "L" },
  { id: 2, label: "M" },
  { id: 3, label: "X" },
  { id: 4, label: "J" },
  { id: 5, label: "V" },
  { id: 6, label: "S" },
  { id: 0, label: "D" },
] as const;

/** Notas de color (sin rojo/verde de fondo); estado en LED aparte. */
const NOTE_STICKY = [
  { card: "bg-c5s-note-sky", border: "border-sky-200/70", accent: "border-l-sky-400" },
  { card: "bg-c5s-note-amber", border: "border-amber-200/70", accent: "border-l-amber-400" },
  { card: "bg-c5s-note-violet", border: "border-violet-200/70", accent: "border-l-violet-400" },
  { card: "bg-c5s-note-cyan", border: "border-cyan-200/70", accent: "border-l-cyan-500" },
  { card: "bg-c5s-note-fuchsia", border: "border-fuchsia-200/70", accent: "border-l-fuchsia-400" },
  { card: "bg-c5s-note-orange", border: "border-orange-200/70", accent: "border-l-orange-400" },
  { card: "bg-c5s-note-indigo", border: "border-indigo-200/70", accent: "border-l-indigo-400" },
] as const;

function cloneWs(w: CincoSWorkspace): CincoSWorkspace {
  try {
    return structuredClone(w);
  } catch {
    return JSON.parse(JSON.stringify(w)) as CincoSWorkspace;
  }
}

function normalizeWorkspace(ws: CincoSWorkspace): CincoSWorkspace {
  const out = cloneWs(ws);
  for (const p of out.projects) {
    p.preflight = p.preflight ?? [];
    p.postflight = p.postflight ?? [];
    p.tasks = p.tasks ?? [];
    p.materials = p.materials ?? [];
    p.pantry = p.pantry ?? [];
    p.shopping_list = p.shopping_list ?? [];
    p.recipe_notes = p.recipe_notes ?? "";
    p.ritual_notes = p.ritual_notes ?? "";
    p.routine_state = p.routine_state ?? "pending";
    for (const it of p.pantry) {
      it.consumption_per_run = it.consumption_per_run ?? 1;
      it.unit = it.unit || "ud";
    }
    for (const m of p.materials) {
      m.consumption_per_run = m.consumption_per_run ?? 1;
      m.required_for_start = m.required_for_start ?? true;
      m.unit = m.unit || "ud";
    }
  }
  return out;
}

function routineDone(p: ProjectRow) {
  const post = p.postflight ?? [];
  return (
    p.preflight.every((x) => x.done) &&
    post.every((x) => x.done) &&
    p.tasks.every((x) => x.status === "done") &&
    (p.shopping_list ?? []).every((x) => x.done)
  );
}

function blockers(p: ProjectRow): string[] {
  const out: string[] = [];
  if ((p.shopping_list ?? []).some((x) => !x.done)) out.push("Lista de compras pendiente");
  for (const it of p.pantry) if (it.qty < (it.consumption_per_run ?? 1)) out.push(`Falta ${it.name}`);
  for (const m of p.materials) if (m.required_for_start && m.qty < (m.consumption_per_run ?? 1)) out.push(`Material insuficiente: ${m.name}`);
  return out;
}

function areaLed(projects: ProjectRow[]): LedState {
  if (!projects.length) return "off";
  return projects.every(routineDone) ? "ok" : "bad";
}

function routineTagline(p: ProjectRow): string | null {
  const t = (p.recipe_notes || "").trim();
  if (!t) return null;
  const line = t.split("\n").find((l) => l.trim()) ?? "";
  const s = line.trim();
  return s ? (s.length > 140 ? `${s.slice(0, 137)}…` : s) : null;
}

function routineScheduleSnippet(p: ProjectRow): string {
  const sch = p.schedules?.[0];
  if (!sch) return "Sin horario fijo";
  const t = sch.time_local || "07:00";
  if (sch.title === "Diaria") return `Hoy · ${t}`;
  const wd = sch.weekdays ?? [];
  if (wd.length) {
    const labels = [...wd]
      .sort((a, b) => a - b)
      .map((id) => WEEKDAY_OPTIONS.find((d) => d.id === id)?.label)
      .filter(Boolean)
      .join(", ");
    return `${labels} · ${t}`;
  }
  return `${sch.title} · ${t}`;
}

function routineStatus(project: ProjectRow) {
  const hasBlockers = blockers(project).length > 0;
  if (hasBlockers) return { label: "Bloqueada", cls: "border-amber-200/80 bg-amber-50 text-amber-900" };
  if (project.routine_state === "in_progress") return { label: "En curso", cls: "border-sky-200/80 bg-sky-50 text-sky-950" };
  if (routineDone(project)) return { label: "Completada", cls: "border-emerald-200/80 bg-emerald-50 text-emerald-900" };
  return { label: "Pendiente", cls: "border-c5s-line bg-c5s-panel-deep text-c5s-muted" };
}

function buildExecRows(p: ProjectRow): ExecRow[] {
  const mats = p.materials.map((m) => ({ kind: "mat" as const, id: `mat-${m.id}`, label: `Material listo: ${m.name}` }));
  const pre = p.preflight.map((x) => ({ kind: "pre" as const, id: x.id, label: `Pre-flight: ${x.label}` }));
  const tasks = p.tasks.slice().sort((a, b) => a.order - b.order).map((x) => ({ kind: "task" as const, id: x.id, label: x.title }));
  const post = (p.postflight ?? []).map((x) => ({ kind: "post" as const, id: x.id, label: `Post-flight: ${x.label}` }));
  return [...mats, ...pre, ...tasks, ...post];
}

function rowDone(p: ProjectRow, row: ExecRow, matDone: Set<string>) {
  if (row.kind === "mat") return matDone.has(row.id);
  if (row.kind === "pre") return Boolean(p.preflight.find((x) => x.id === row.id)?.done);
  if (row.kind === "post") return Boolean((p.postflight ?? []).find((x) => x.id === row.id)?.done);
  return p.tasks.find((x) => x.id === row.id)?.status === "done";
}

function LedBulb({ state, label }: { state: LedState; label: string }) {
  const uid = useId().replace(/:/g, "");
  const ok = state === "ok";
  const bad = state === "bad";
  const lens = ok ? "#4ade80" : bad ? "#f87171" : "#64748b";
  const glow = ok ? "rgba(74,222,128,0.9)" : bad ? "rgba(248,113,113,0.9)" : "rgba(100,116,139,0.35)";
  return (
    <span className="inline-flex items-center gap-1.5" title={label}>
      <svg width="24" height="30" viewBox="0 0 24 30" style={{ filter: `drop-shadow(0 0 7px ${glow})` }} aria-hidden>
        <defs><filter id={`led-${uid}`} x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation={ok || bad ? 2.2 : 0.8} result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
        <rect x="9" y="22" width="6" height="6" rx="1" fill="#334155" /><rect x="7" y="26" width="10" height="3" rx="1" fill="#1e293b" />
        <path d="M12 2c-4 0-7 3.2-7 7.2 0 3.1 1.9 5.7 4.5 6.7V18h5v-2.1c2.6-1 4.5-3.6 4.5-6.7C19 5.2 16 2 12 2z" fill="#475569" />
        <circle cx="12" cy="9.5" r="5.2" fill={lens} filter={`url(#led-${uid})`} />
      </svg>
    </span>
  );
}

export default function CincoSExperiencePanel() {
  const { data, isPending, isError, error, refetch } = useCincoSWorkspace();
  const save = useSaveCincoSWorkspace();
  const assistant = useCincoSAssistant();
  const [draft, setDraft] = useState<CincoSWorkspace | null>(null);
  const [section, setSection] = useState<Section>("routines");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [execIndex, setExecIndex] = useState(0);
  const [matVerified, setMatVerified] = useState<Set<string>>(() => new Set());
  const [shopName, setShopName] = useState("");
  const [shopQty, setShopQty] = useState("1");
  const [shopUnit, setShopUnit] = useState("ud");
  const [aiMsg, setAiMsg] = useState("");
  const [aiReply, setAiReply] = useState("");

  useEffect(() => {
    if (data) setDraft(normalizeWorkspace(data));
  }, [data]);

  const selected = useMemo(() => draft?.projects.find((p) => p.id === selectedId) ?? null, [draft, selectedId]);
  const grouped = useMemo(() => {
    if (!draft) return [];
    return draft.categories.map((cat) => ({ cat, projects: draft.projects.filter((p) => p.category_id === cat.id) }));
  }, [draft]);

  const updateProject = (pid: string, fn: (p: ProjectRow) => void) => {
    setDraft((cur) => {
      if (!cur) return cur;
      const next = cloneWs(cur);
      const idx = next.projects.findIndex((p) => p.id === pid);
      if (idx < 0) return cur;
      fn(next.projects[idx]);
      next.projects[idx].updated_at = new Date().toISOString();
      next.updated_at = next.projects[idx].updated_at;
      return next;
    });
  };

  const persist = () => draft && save.mutate(draft);

  const openRoutinePage = (p: ProjectRow) => {
    setSelectedId(p.id);
    setSection("detail");
    setExecIndex(0);
    setMatVerified(new Set());
  };

  const startRoutine = (p: ProjectRow, rows: ExecRow[]) => {
    const b = blockers(p);
    if (b.length) return window.alert(`No podés iniciar la rutina:\n- ${b.join("\n- ")}`);
    if (p.routine_state === "in_progress") return;
    const emptyMat = new Set<string>();
    const firstPending = rows.findIndex((row) => !rowDone(p, row, emptyMat));
    updateProject(p.id, (x) => { x.routine_state = "in_progress"; });
    setExecIndex(firstPending >= 0 ? firstPending : 0);
    setMatVerified(new Set());
  };

  const restartRoutine = (p: ProjectRow) => {
    updateProject(p.id, (x) => {
      x.routine_state = "pending";
      x.preflight.forEach((i) => { i.done = false; });
      (x.postflight ?? []).forEach((i) => { i.done = false; });
      x.tasks.forEach((t) => { t.status = "pending"; });
    });
    setExecIndex(0);
    setMatVerified(new Set());
  };

  const finishRoutine = (p: ProjectRow) => {
    updateProject(p.id, (x) => {
      x.pantry.forEach((it) => { it.qty = Math.max(0, Number((it.qty - (it.consumption_per_run ?? 1)).toFixed(4))); });
      x.materials.forEach((m) => { m.qty = Math.max(0, Number((m.qty - (m.consumption_per_run ?? 1)).toFixed(4))); });
      x.routine_state = "pending";
      x.preflight.forEach((i) => { i.done = false; });
      (x.postflight ?? []).forEach((i) => { i.done = false; });
      x.tasks.forEach((t) => { t.status = "pending"; });
    });
    setExecIndex(0);
    setMatVerified(new Set());
  };

  const addShoppingItem = (p: ProjectRow, name: string, qty: number, unit: string) => {
    const n = name.trim();
    if (!n) return;
    updateProject(p.id, (x) => {
      const row: ShoppingItem = { id: `buy-${crypto.randomUUID().slice(0, 8)}`, name: n, qty: Number.isFinite(qty) && qty > 0 ? qty : 1, unit: unit || "ud", done: false };
      x.shopping_list = [...(x.shopping_list ?? []), row];
      x.shopping_required = true;
    });
  };

  const ensureDefaultSchedule = (p: ProjectRow) => {
    if (p.schedules?.length) return;
    p.schedules = [
      { id: `sch-${crypto.randomUUID().slice(0, 8)}`, title: "Diaria", time_local: "07:00", weekdays: [1, 2, 3, 4, 5, 6, 0], sound_url: "" },
    ];
  };

  const markExecStepDone = (p: ProjectRow, row: ExecRow, enabled: boolean) => {
    if (!enabled) return;
    if (row.kind === "mat") {
      setMatVerified((prev) => {
        const next = new Set(prev);
        next.add(row.id);
        return next;
      });
    } else if (row.kind === "pre") {
      updateProject(p.id, (x) => {
        const found = x.preflight.find((it) => it.id === row.id);
        if (found) found.done = true;
      });
    } else if (row.kind === "post") {
      updateProject(p.id, (x) => {
        const found = (x.postflight ?? []).find((it) => it.id === row.id);
        if (found) found.done = true;
      });
    } else {
      updateProject(p.id, (x) => {
        const found = x.tasks.find((it) => it.id === row.id);
        if (found) found.status = "done";
      });
    }
    setExecIndex((n) => n + 1);
  };

  if (isPending || !draft) return <p className="text-sm text-c5s-muted">Cargando 5S…</p>;
  if (isError) return <p className="text-sm text-red-600">{(error as Error)?.message ?? "Error 5S"}</p>;

  const navBtn = (id: Exclude<Section, "detail">, label: string) => (
    <button
      type="button"
      onClick={() => setSection(id)}
      className={`w-full rounded-lg px-3 py-2.5 text-left text-sm transition ${
        section === id
          ? "bg-c5s-canvas font-medium text-c5s-ink shadow-[inset_0_0_0_1px_#e5e3dc]"
          : "text-c5s-muted hover:bg-c5s-canvas/70 hover:text-c5s-ink"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="-m-4 min-h-full bg-c5s-canvas px-4 py-5 font-sans text-c5s-ink antialiased selection:bg-c5s-accent-soft lg:-m-6 lg:px-6">
      <nav className="mb-4 flex gap-1 rounded-xl border border-c5s-line bg-c5s-panel p-1 shadow-sm lg:hidden">
        {(["create", "routines", "hugo"] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setSection(id)}
            className={`flex-1 rounded-lg px-2 py-2 text-center text-xs font-medium ${
              section === id ? "bg-c5s-canvas text-c5s-ink shadow-[inset_0_0_0_1px_#e5e3dc]" : "text-c5s-muted"
            }`}
          >
            {id === "create" ? "Crear" : id === "routines" ? "Rutinas" : "Hugo"}
          </button>
        ))}
      </nav>

      <div className="mx-auto flex max-w-7xl flex-col gap-6 pb-24 lg:flex-row-reverse lg:pb-16">
        <aside className="hidden w-[260px] shrink-0 lg:block lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-2xl border border-c5s-line bg-c5s-panel p-1 shadow-sm">
            <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-c5s-muted">Navegación</p>
            <div className="space-y-0.5 px-1 pb-2">
              {navBtn("create", "Crear rutina guiada")}
              {navBtn("routines", "Mis rutinas")}
              {navBtn("hugo", "Habla con Hugo")}
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 space-y-5">
          <header className="flex flex-wrap items-end justify-between gap-3 border-b border-c5s-line pb-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-c5s-muted">McKenna · operaciones</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight text-c5s-ink">5S · Rutinas y flujos</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => refetch()}
                className="rounded-lg border border-c5s-line bg-c5s-panel px-3 py-2 text-xs font-medium text-c5s-ink shadow-sm hover:bg-c5s-canvas"
              >
                Sincronizar
              </button>
              <button
                type="button"
                onClick={persist}
                className="rounded-lg bg-c5s-accent px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-c5s-accent-hover"
              >
                {save.isPending ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </header>

          {section === "create" && (
            <section className="rounded-2xl border border-c5s-line bg-c5s-panel p-4 shadow-sm">
              <CincoSRoutineWizard
                appearance="claude"
                categories={draft.categories}
                onCancel={() => setSection("routines")}
                onDone={(id) => {
                  setSelectedId(id);
                  setSection("detail");
                }}
              />
            </section>
          )}

          {section === "routines" && (
            <section className="overflow-hidden rounded-2xl border border-c5s-line bg-c5s-panel shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-c5s-line px-4 py-3">
                <h3 className="text-sm font-semibold text-c5s-ink">Tablero por área</h3>
                <span className="text-[11px] text-c5s-muted">Tarjeta = rutina · LED = estado</span>
              </div>
              <div className="relative overflow-x-auto p-4">
                <div className="relative grid min-w-[980px] grid-cols-3 gap-5 xl:grid-cols-4">
                  {grouped
                    .filter(({ projects }) => projects.length > 0)
                    .map(({ cat, projects }) => (
                      <div key={cat.id} className="rounded-xl border border-c5s-line bg-c5s-canvas/80 p-3">
                        <div className="mb-3 flex w-full items-center justify-between gap-2 rounded-lg border border-c5s-line bg-c5s-panel px-3 py-2">
                          <span className="text-xs font-semibold text-c5s-ink">
                            {cat.icon} {cat.name}
                          </span>
                          <LedBulb state={areaLed(projects)} label="Estado área" />
                        </div>

                        <div className="space-y-3">
                          {projects.map((p, idx) => {
                            const pal = NOTE_STICKY[idx % NOTE_STICKY.length];
                            const status = routineStatus(p);
                            const tagline = routineTagline(p);
                            return (
                              <div key={p.id} className="relative pl-5">
                                <span className="absolute left-1.5 top-0 h-3 w-px bg-c5s-line-strong" />
                                <span className="absolute left-1.5 top-3 h-px w-2.5 bg-c5s-line-strong" />
                                <div
                                  className={`w-full rounded-xl border border-black/[0.06] border-l-4 p-3 text-left shadow-sm transition hover:shadow ${pal.accent} ${pal.border} ${pal.card}`}
                                >
                                  <div className="mb-2 flex gap-3">
                                    <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl border border-c5s-line bg-white shadow-sm">
                                      <RoutineMascot categoryId={p.category_id} size={44} />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-start justify-between gap-2">
                                        <p className="text-sm font-bold tracking-tight text-c5s-ink">{p.name}</p>
                                        <LedBulb state={routineDone(p) ? "ok" : "bad"} label="Estado rutina" />
                                      </div>
                                      {tagline ? (
                                        <p className="mt-0.5 line-clamp-2 text-[11px] font-medium text-c5s-muted">{tagline}</p>
                                      ) : null}
                                    </div>
                                  </div>
                                  <span className={`mb-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${status.cls}`}>{status.label}</span>
                                  <p className="mb-3 text-[12px] leading-snug text-c5s-muted">Pre-flight → Core-process → Post-flight. Lista de compras bloquea el reinicio.</p>
                                  <div className="grid grid-cols-2 gap-2">
                                    <button
                                      type="button"
                                      onClick={() => openRoutinePage(p)}
                                      className="rounded-lg border border-c5s-line bg-white/80 px-2 py-2 text-[11px] font-semibold text-c5s-ink shadow-sm hover:bg-white"
                                    >
                                      Abrir detalle
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        openRoutinePage(p);
                                        const rows = buildExecRows(p);
                                        startRoutine(p, rows);
                                      }}
                                      className="rounded-lg bg-[#2563eb] px-2 py-2 text-[11px] font-semibold text-white shadow-sm hover:bg-blue-700"
                                    >
                                      Iniciar rutina
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </section>
          )}

          {section === "detail" && selected && (() => {
            const execRows = buildExecRows(selected);
            const allDone = execRows.every((row) => rowDone(selected, row, matVerified));
            const isRunning = selected.routine_state === "in_progress";
            const branches = [
              { id: "mat", label: "Materiales", color: "border-cyan-200 bg-cyan-50 text-cyan-950" },
              { id: "pre", label: "Pre-flight (5S)", color: "border-violet-200 bg-violet-50 text-violet-950" },
              { id: "task", label: "Core-process", color: "border-amber-200 bg-amber-50 text-amber-950" },
              { id: "post", label: "Post-flight (5S)", color: "border-emerald-200 bg-emerald-50 text-emerald-950" },
            ] as const;
            const catName = draft.categories.find((c) => c.id === selected.category_id)?.name ?? "Área";
            const tag = routineTagline(selected);
            const doneN = execRows.filter((row) => rowDone(selected, row, matVerified)).length;
            const totalN = execRows.length;
            const progressPct = totalN ? Math.round((doneN / totalN) * 100) : 0;
            return (
              <section className="space-y-5 rounded-2xl border border-c5s-line bg-c5s-panel p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setSection("routines")}
                    className="rounded-lg border border-c5s-line bg-white px-3 py-2 text-xs font-medium text-c5s-ink shadow-sm hover:bg-c5s-canvas"
                  >
                    ← Volver al tablero
                  </button>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => restartRoutine(selected)}
                      className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 hover:bg-amber-100"
                    >
                      Reiniciar (pruebas)
                    </button>
                    <button
                      type="button"
                      onClick={persist}
                      className="rounded-lg bg-c5s-accent px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-c5s-accent-hover"
                    >
                      Guardar
                    </button>
                  </div>
                </div>

                <div className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-[0_18px_50px_-22px_rgba(15,23,42,0.12)]">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-c5s-muted">
                    Agentic <span className="text-c5s-line-strong">·</span> 5S <span className="text-c5s-line-strong">·</span>{" "}
                    <span className="text-c5s-ink">{selected.name.toUpperCase()}</span>
                  </p>
                  <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-center">
                    <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-full border-2 border-c5s-sun/50 bg-[#fff9e8] shadow-inner">
                      <RoutineMascot categoryId={selected.category_id} size={92} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-2xl font-extrabold tracking-tight text-c5s-ink">{selected.name}</h3>
                      {tag ? (
                        <p className="mt-1 text-sm font-medium text-c5s-muted">{tag}</p>
                      ) : (
                        <p className="mt-1 text-sm text-c5s-muted">{catName}</p>
                      )}
                      <div className="mt-4 grid gap-3 sm:grid-cols-3">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wide text-c5s-muted">Progreso</p>
                          <p className="mt-0.5 text-sm font-semibold text-c5s-ink">
                            {doneN}/{totalN}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wide text-c5s-muted">Cuándo</p>
                          <p className="mt-0.5 text-sm font-semibold text-c5s-ink">{routineScheduleSnippet(selected)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wide text-c5s-muted">Estado</p>
                          <p className="mt-0.5 text-sm font-semibold text-c5s-ink">{progressPct}%</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-3 rounded-xl border border-c5s-line bg-c5s-canvas/50 p-4">
                    <label className="text-xs font-medium text-c5s-muted">
                      Nombre rutina
                      <input
                        value={selected.name}
                        onChange={(e) => updateProject(selected.id, (p) => {
                          p.name = e.target.value;
                        })}
                        className="mt-1 w-full rounded-lg border border-c5s-line bg-white px-3 py-2 text-sm text-c5s-ink shadow-sm"
                      />
                    </label>
                    <label className="text-xs font-medium text-c5s-muted">
                      Instrucciones / protocolo
                      <textarea
                        value={selected.recipe_notes}
                        onChange={(e) => updateProject(selected.id, (p) => {
                          p.recipe_notes = e.target.value;
                        })}
                        rows={4}
                        className="mt-1 w-full rounded-lg border border-c5s-line bg-white px-3 py-2 text-sm text-c5s-ink shadow-sm"
                      />
                    </label>
                    <div className="rounded-lg border border-c5s-line bg-white p-3 shadow-sm">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-xs font-semibold text-c5s-ink">Programación de rutina</p>
                        <button
                          type="button"
                          className="text-[11px] font-medium text-c5s-accent hover:underline"
                          onClick={() =>
                            updateProject(selected.id, (p) => {
                              ensureDefaultSchedule(p);
                              p.schedules.push({
                                id: `sch-${crypto.randomUUID().slice(0, 8)}`,
                                title: "Semanal",
                                time_local: "07:00",
                                weekdays: [1, 3, 5],
                                sound_url: "",
                              });
                            })
                          }
                        >
                          + frecuencia
                        </button>
                      </div>
                      <div className="space-y-2">
                        {(selected.schedules ?? []).map((sch) => (
                          <div key={sch.id} className="rounded-lg border border-c5s-line bg-c5s-panel-deep p-2">
                            <div className="grid gap-2 sm:grid-cols-[1fr_110px_24px]">
                              <select
                                value={sch.title}
                                onChange={(e) =>
                                  updateProject(selected.id, (p) => {
                                    const row = p.schedules.find((x) => x.id === sch.id);
                                    if (row) row.title = e.target.value;
                                  })
                                }
                                className="rounded border border-c5s-line bg-white px-2 py-1 text-xs text-c5s-ink"
                              >
                                <option>Diaria</option>
                                <option>Semanal</option>
                                <option>Mensual</option>
                              </select>
                              <input
                                type="time"
                                value={sch.time_local || "07:00"}
                                onChange={(e) =>
                                  updateProject(selected.id, (p) => {
                                    const row = p.schedules.find((x) => x.id === sch.id);
                                    if (row) row.time_local = e.target.value;
                                  })
                                }
                                className="rounded border border-c5s-line bg-white px-2 py-1 text-xs text-c5s-ink"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  updateProject(selected.id, (p) => {
                                    p.schedules = p.schedules.filter((x) => x.id !== sch.id);
                                  })
                                }
                                className="rounded border border-c5s-line text-xs text-c5s-muted hover:bg-white"
                              >
                                ×
                              </button>
                            </div>
                            {sch.title !== "Mensual" ? (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {WEEKDAY_OPTIONS.map((d) => {
                                  const active = sch.weekdays.includes(d.id);
                                  return (
                                    <button
                                      key={d.id}
                                      type="button"
                                      onClick={() =>
                                        updateProject(selected.id, (p) => {
                                          const row = p.schedules.find((x) => x.id === sch.id);
                                          if (!row) return;
                                          const set = new Set(row.weekdays);
                                          if (set.has(d.id)) set.delete(d.id);
                                          else set.add(d.id);
                                          row.weekdays = [...set];
                                        })
                                      }
                                      className={`h-6 w-6 rounded text-[10px] font-medium ${active ? "bg-c5s-accent text-white" : "border border-c5s-line bg-white text-c5s-muted"}`}
                                    >
                                      {d.label}
                                    </button>
                                  );
                                })}
                              </div>
                            ) : (
                              <p className="mt-2 text-[10px] text-c5s-muted">Mensual: se ejecuta una vez al mes en el horario indicado.</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="rounded-xl border border-c5s-line bg-c5s-canvas/50 p-4">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-c5s-ink">Checklist de la rutina</p>
                      <button
                        type="button"
                        onClick={() => startRoutine(selected, execRows)}
                        className="shrink-0 rounded-lg bg-[#2563eb] px-3 py-2 text-[11px] font-semibold text-white shadow-sm hover:bg-blue-700"
                      >
                        {isRunning ? "Rutina en curso" : "Iniciar rutina"}
                      </button>
                    </div>
                    {!isRunning && (
                      <p className="mb-3 text-[11px] text-c5s-muted">Iniciá la rutina para desbloquear los ítems en orden.</p>
                    )}
                    <div className="rounded-xl border border-c5s-line bg-white p-3 shadow-sm">
                      <div className="space-y-4">
                        {branches.map((branch) => {
                          const rows = execRows.filter((r) => r.kind === branch.id);
                          if (!rows.length) return null;
                          return (
                            <div key={branch.id} className="relative pl-5">
                              <span className="absolute left-1.5 top-5 h-[calc(100%-20px)] w-px bg-c5s-line-strong" />
                              <div className={`mb-2 inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${branch.color}`}>{branch.label}</div>
                              <div className="space-y-2">
                                {rows.map((row) => {
                                  const globalIdx = execRows.findIndex((x) => x.id === row.id);
                                  const enabled = isRunning && globalIdx <= execIndex;
                                  const done = rowDone(selected, row, matVerified);
                                  return (
                                    <label
                                      key={row.id}
                                      className={`relative flex items-center gap-2 rounded-lg border px-2.5 py-2.5 text-xs ${
                                        done
                                          ? "border-c5s-line bg-c5s-panel-deep text-c5s-muted line-through underline decoration-c5s-line-strong"
                                          : enabled
                                            ? "border-c5s-accent/30 bg-c5s-accent-soft text-c5s-ink"
                                            : "border-c5s-line/80 bg-white text-c5s-muted opacity-60"
                                      }`}
                                    >
                                      <span className="absolute -left-3.5 top-1/2 h-px w-2.5 -translate-y-1/2 bg-c5s-line-strong" />
                                      <input
                                        type="checkbox"
                                        checked={done}
                                        disabled={!enabled || done}
                                        onChange={(e) => {
                                          if (!e.target.checked) return;
                                          markExecStepDone(selected, row, enabled);
                                        }}
                                      />
                                      <span className="min-w-0 flex-1">{row.label}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={!allDone}
                      onClick={() => finishRoutine(selected)}
                      className="mt-3 w-full rounded-lg border border-emerald-200 bg-emerald-600 px-3 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-40"
                    >
                      Finalizar y descontar
                    </button>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-3">
                  <div className="rounded-xl border border-c5s-line bg-c5s-canvas/50 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-semibold text-c5s-ink">Pre-flight (editable)</p>
                      <button
                        type="button"
                        className="text-xs font-medium text-c5s-accent hover:underline"
                        onClick={() =>
                          updateProject(selected.id, (p) => {
                            p.preflight.push({
                              id: `pre-${crypto.randomUUID().slice(0, 8)}`,
                              label: "Nueva condición inicial",
                              done: false,
                              assignee: "owner",
                            });
                          })
                        }
                      >
                        + condición
                      </button>
                    </div>
                    <div className="space-y-2">
                      {selected.preflight.map((item) => (
                        <div key={item.id} className="grid grid-cols-[1fr_72px_24px] gap-2">
                          <input
                            value={item.label}
                            onChange={(e) =>
                              updateProject(selected.id, (p) => {
                                const x = p.preflight.find((k) => k.id === item.id);
                                if (x) x.label = e.target.value;
                              })
                            }
                            className="rounded border border-c5s-line bg-white px-2 py-1 text-xs text-c5s-ink"
                          />
                          <span className="rounded border border-c5s-line bg-c5s-panel-deep px-2 py-1 text-center text-[10px] text-c5s-muted">pre</span>
                          <button
                            type="button"
                            onClick={() => updateProject(selected.id, (p) => {
                              p.preflight = p.preflight.filter((k) => k.id !== item.id);
                            })}
                            className="rounded border border-c5s-line text-xs text-c5s-muted hover:bg-white"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-xl border border-c5s-line bg-c5s-canvas/50 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-semibold text-c5s-ink">Core-process (editable)</p>
                      <button
                        type="button"
                        className="text-xs font-medium text-c5s-accent hover:underline"
                        onClick={() =>
                          updateProject(selected.id, (p) => {
                            p.tasks.push({
                              id: `task-${crypto.randomUUID().slice(0, 8)}`,
                              title: "Nuevo paso",
                              status: "pending",
                              assignee: "owner",
                              blocked_reason: "",
                              order: p.tasks.length + 1,
                            });
                          })
                        }
                      >
                        + paso
                      </button>
                    </div>
                    <div className="space-y-2">
                      {selected.tasks.sort((a, b) => a.order - b.order).map((t) => (
                        <div key={t.id} className="grid grid-cols-[1fr_60px_24px] gap-2">
                          <input
                            value={t.title}
                            onChange={(e) =>
                              updateProject(selected.id, (p) => {
                                const x = p.tasks.find((k) => k.id === t.id);
                                if (x) x.title = e.target.value;
                              })
                            }
                            className="rounded border border-c5s-line bg-white px-2 py-1 text-xs text-c5s-ink"
                          />
                          <input
                            type="number"
                            min={1}
                            value={t.order}
                            onChange={(e) =>
                              updateProject(selected.id, (p) => {
                                const x = p.tasks.find((k) => k.id === t.id);
                                if (x) x.order = Number(e.target.value) || 1;
                              })
                            }
                            className="rounded border border-c5s-line bg-white px-2 py-1 text-xs text-c5s-ink"
                          />
                          <button
                            type="button"
                            onClick={() => updateProject(selected.id, (p) => {
                              p.tasks = p.tasks.filter((k) => k.id !== t.id);
                            })}
                            className="rounded border border-c5s-line text-xs text-c5s-muted hover:bg-white"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-xl border border-c5s-line bg-c5s-canvas/50 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-semibold text-c5s-ink">Post-flight (editable)</p>
                      <button
                        type="button"
                        className="text-xs font-medium text-c5s-accent hover:underline"
                        onClick={() =>
                          updateProject(selected.id, (p) => {
                            (p.postflight ??= []).push({
                              id: `post-${crypto.randomUUID().slice(0, 8)}`,
                              label: "Nuevo cierre / estandarización",
                              done: false,
                              assignee: "owner",
                            });
                          })
                        }
                      >
                        + cierre
                      </button>
                    </div>
                    <div className="space-y-2">
                      {(selected.postflight ?? []).map((item) => (
                        <div key={item.id} className="grid grid-cols-[1fr_72px_24px] gap-2">
                          <input
                            value={item.label}
                            onChange={(e) =>
                              updateProject(selected.id, (p) => {
                                const x = (p.postflight ?? []).find((k) => k.id === item.id);
                                if (x) x.label = e.target.value;
                              })
                            }
                            className="rounded border border-c5s-line bg-white px-2 py-1 text-xs text-c5s-ink"
                          />
                          <span className="rounded border border-c5s-line bg-c5s-panel-deep px-2 py-1 text-center text-[10px] text-c5s-muted">post</span>
                          <button
                            type="button"
                            onClick={() => updateProject(selected.id, (p) => {
                              p.postflight = (p.postflight ?? []).filter((k) => k.id !== item.id);
                            })}
                            className="rounded border border-c5s-line text-xs text-c5s-muted hover:bg-white"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-c5s-line bg-c5s-canvas/50 p-4">
                  <p className="mb-2 text-xs font-semibold text-c5s-ink">Lista de compras (bloquea la rutina)</p>
                  <div className="mb-2 grid gap-2 sm:grid-cols-[1fr_90px_90px_110px]">
                    <input
                      value={shopName}
                      onChange={(e) => setShopName(e.target.value)}
                      placeholder="Item faltante"
                      className="rounded-lg border border-c5s-line bg-white px-2 py-2 text-xs text-c5s-ink shadow-sm"
                    />
                    <input
                      value={shopQty}
                      onChange={(e) => setShopQty(e.target.value)}
                      type="number"
                      min={0.01}
                      step={0.01}
                      className="rounded-lg border border-c5s-line bg-white px-2 py-2 text-xs text-c5s-ink shadow-sm"
                    />
                    <input
                      value={shopUnit}
                      onChange={(e) => setShopUnit(e.target.value)}
                      className="rounded-lg border border-c5s-line bg-white px-2 py-2 text-xs text-c5s-ink shadow-sm"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        addShoppingItem(selected, shopName, Number(shopQty), shopUnit);
                        setShopName("");
                        setShopQty("1");
                        setShopUnit("ud");
                      }}
                      className="rounded-lg bg-amber-600 px-2 py-2 text-xs font-semibold text-white shadow-sm hover:bg-amber-700"
                    >
                      Agregar
                    </button>
                  </div>
                  <div className="space-y-1">
                    {(selected.shopping_list ?? []).map((it) => (
                      <label key={it.id} className="flex items-center gap-2 rounded-lg border border-c5s-line bg-white px-2 py-2 text-xs shadow-sm">
                        <input
                          type="checkbox"
                          checked={it.done}
                          onChange={(e) =>
                            updateProject(selected.id, (p) => {
                              const row = (p.shopping_list ?? []).find((x) => x.id === it.id);
                              if (row) row.done = e.target.checked;
                              p.shopping_required = (p.shopping_list ?? []).some((x) => !x.done);
                            })
                          }
                        />
                        <span className={`flex-1 ${it.done ? "text-c5s-muted line-through" : "text-c5s-ink"}`}>
                          {it.name} · {it.qty} {it.unit}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </section>
            );
          })()}

          {section === "hugo" && (
            <section className="rounded-2xl border border-c5s-line bg-c5s-panel p-5 shadow-sm">
              <h3 className="text-base font-semibold tracking-tight text-c5s-ink">Habla con Hugo</h3>
              <p className="mt-1 text-sm text-c5s-muted">Consultas sobre la rutina seleccionada o el flujo 5S.</p>
              <textarea
                value={aiMsg}
                onChange={(e) => setAiMsg(e.target.value)}
                rows={5}
                className="mt-3 w-full rounded-xl border border-c5s-line bg-white p-3 text-sm text-c5s-ink shadow-sm"
              />
              <button
                type="button"
                className="mt-3 rounded-xl bg-c5s-accent px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-c5s-accent-hover"
                onClick={() =>
                  assistant.mutate(
                    {
                      message: aiMsg.trim(),
                      context: selected
                        ? { proyecto: selected.name, tasks: selected.tasks, preflight: selected.preflight, pantry: selected.pantry, shopping: selected.shopping_list }
                        : null,
                    },
                    { onSuccess: (r) => setAiReply(r.reply || r.error || "Sin respuesta") },
                  )
                }
              >
                {assistant.isPending ? "Consultando…" : "Enviar"}
              </button>
              {aiReply ? (
                <p className="mt-3 whitespace-pre-wrap rounded-xl border border-c5s-line bg-c5s-canvas/80 p-3 text-sm text-c5s-ink">{aiReply}</p>
              ) : null}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
