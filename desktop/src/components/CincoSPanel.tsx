import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  useCincoSWorkspace,
  useSaveCincoSWorkspace,
  useCreateCincoSProject,
  useCincoSAssistant,
  useDeleteCincoSProject,
  useDeleteCincoSTemplate,
  useReplaceCincoSTemplate,
  useCreateCincoSTemplate,
  uploadCincoSWav,
  type CincoSWorkspace,
  type ProjectRow,
  type TaskStatus,
  type ScheduleItem,
} from "../hooks/useCincoS";
import CincoSTemplateManager from "./CincoSTemplateManager";
import { CincoSGuidedHome, CincoSRoutineWizard } from "./CincoSGuidedFlow";
import { computePrimerPaso, pillarHint, type PrimerPaso } from "../lib/cincoSPrimerPaso";

const WD_LABELS = ["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"];

const PANTRY_UNIT_OPTIONS: { value: string; label: string }[] = [
  { value: "g", label: "g" },
  { value: "kg", label: "kg" },
  { value: "mg", label: "mg" },
  { value: "ml", label: "ml" },
  { value: "l", label: "l" },
  { value: "ud", label: "ud" },
  { value: "porción", label: "porción" },
  { value: "servicio", label: "servicio" },
  { value: "caja", label: "caja" },
  { value: "bolsa", label: "bolsa" },
  { value: "bandeja", label: "bandeja" },
  { value: "taza", label: "taza" },
];

const PILLARS = [
  { id: "Seiri", jp: "整理", tag: "Clasificar", desc: "Quitar lo innecesario del espacio de trabajo.", ring: "ring-rose-500/30", bar: "bg-rose-500" },
  { id: "Seiton", jp: "整頓", tag: "Ordenar", desc: "Un lugar para cada cosa; localización visual.", ring: "ring-amber-500/30", bar: "bg-amber-500" },
  { id: "Seiso", jp: "清掃", tag: "Limpiar", desc: "Limpieza profunda que expone fallas e inseguridades.", ring: "ring-emerald-500/30", bar: "bg-emerald-500" },
  { id: "Seiketsu", jp: "清潔", tag: "Estandarizar", desc: "Mantener lo logrado con checklists y rituales visibles.", ring: "ring-sky-500/30", bar: "bg-sky-500" },
  { id: "Shitsuke", jp: "躾", tag: "Disciplina", desc: "Hábito constante: el tablero es el entrenador diario.", ring: "ring-violet-500/30", bar: "bg-violet-500" },
] as const;

const KANBAN_COLS: { status: TaskStatus; title: string; hint: string }[] = [
  { status: "pending", title: "Por hacer", hint: "Backlog ordenado (Seiton)" },
  { status: "in_progress", title: "En curso", hint: "Un foco a la vez (Shitsuke)" },
  { status: "blocked", title: "Bloqueado", hint: "Anotá la novedad (Seiri)" },
  { status: "done", title: "Hecho", hint: "Estandarizá el aprendizaje (Seiketsu)" },
];

function newId(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 10)}`;
}

function cloneWs(w: CincoSWorkspace): CincoSWorkspace {
  try {
    return structuredClone(w);
  } catch {
    return JSON.parse(JSON.stringify(w)) as CincoSWorkspace;
  }
}

function normalizeWorkspace(ws: CincoSWorkspace): CincoSWorkspace {
  const out = cloneWs(ws);
  out.categories = out.categories ?? [];
  out.templates = out.templates ?? [];
  out.projects = out.projects ?? [];
  const catIds = new Set(out.categories.map((c) => c.id));
  const fallbackCat = out.categories[0]?.id ?? "";
  for (const p of out.projects) {
    p.preflight = p.preflight ?? [];
    p.tasks = p.tasks ?? [];
    p.materials = p.materials ?? [];
    p.pantry = p.pantry ?? [];
    p.schedules = p.schedules ?? [];
    p.tags = Array.isArray(p.tags)
      ? p.tags.filter((t): t is string => typeof t === "string" && Boolean(t.trim()))
      : [];
    if (!p.category_id || !catIds.has(p.category_id)) p.category_id = fallbackCat;
    for (const t of p.tasks) {
      if (t.scope !== "prep") t.scope = "main";
    }
    for (const it of p.pantry) {
      if (it.prep_notes === undefined) it.prep_notes = "";
    }
  }
  return out;
}

function pillarCardClass(pillar: PrimerPaso["pillar"]) {
  const m: Record<PrimerPaso["pillar"], string> = {
    Seiri: "ring-rose-500/40 border-rose-500/20",
    Seiton: "ring-amber-500/40 border-amber-500/20",
    Seiso: "ring-emerald-500/40 border-emerald-500/20",
    Seiketsu: "ring-sky-500/40 border-sky-500/20",
    Shitsuke: "ring-violet-500/40 border-violet-500/20",
  };
  return m[pillar];
}

export default function CincoSPanel() {
  const { data, isPending, isError, error, refetch } = useCincoSWorkspace();
  const save = useSaveCincoSWorkspace();
  const createProj = useCreateCincoSProject();
  const assistant = useCincoSAssistant();
  const deleteProj = useDeleteCincoSProject();
  const deleteTpl = useDeleteCincoSTemplate();
  const replaceTpl = useReplaceCincoSTemplate();
  const createTpl = useCreateCincoSTemplate();
  const [wavUploadingId, setWavUploadingId] = useState<string | null>(null);

  const [draft, setDraft] = useState<CincoSWorkspace | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [newProjName, setNewProjName] = useState("");
  const [tplForNew, setTplForNew] = useState("");
  const [newProjCategoryId, setNewProjCategoryId] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"all" | string>("all");
  const [aiMsg, setAiMsg] = useState("");
  const [aiReply, setAiReply] = useState("");
  const [lastProvider, setLastProvider] = useState("");
  const [newCat, setNewCat] = useState("");
  const [tab, setTab] = useState<"tablero" | "logistica" | "hugo">("tablero");
  const [panelMode, setPanelMode] = useState<"home" | "wizard" | "work">("home");
  const [tagFilter, setTagFilter] = useState<"all" | string>("all");
  const firedRef = useRef<Set<string>>(new Set());
  const lowStockSpokenRef = useRef<Set<string>>(new Set());
  const boardRef = useRef<HTMLDivElement>(null);
  const createWizardRef = useRef<HTMLDetailsElement>(null);
  const hugoReplyRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (data) setDraft(normalizeWorkspace(data));
  }, [data]);

  useEffect(() => {
    if (data?.projects?.length && !selId) setSelId(data.projects[0].id);
  }, [data, selId]);

  useEffect(() => {
    if (!draft?.categories.length) return;
    if (tplForNew) {
      const t = draft.templates.find((x) => x.id === tplForNew);
      if (t?.category_id) setNewProjCategoryId(t.category_id);
      return;
    }
    setNewProjCategoryId((prev) => prev || draft.categories[0].id);
  }, [draft, tplForNew]);

  const allPatternTags = useMemo(() => {
    if (!draft) return [] as string[];
    const s = new Set<string>();
    for (const p of draft.projects) {
      for (const t of p.tags ?? []) {
        const x = String(t).trim().toLowerCase();
        if (x) s.add(x);
      }
    }
    return [...s].sort();
  }, [draft?.projects]);

  const filteredProjects = useMemo(() => {
    if (!draft) return [];
    let list = draft.projects;
    if (categoryFilter !== "all") list = list.filter((p) => p.category_id === categoryFilter);
    if (tagFilter !== "all") {
      const want = tagFilter.toLowerCase();
      list = list.filter((p) => (p.tags ?? []).some((t) => String(t).trim().toLowerCase() === want));
    }
    return list;
  }, [draft, categoryFilter, tagFilter]);

  const projectFilterKey = useMemo(
    () => (draft?.projects ?? []).map((p) => `${p.id}:${p.category_id}`).join("|"),
    [draft?.projects],
  );

  useEffect(() => {
    if (categoryFilter === "all" || !draft?.projects.length) return;
    const list = draft.projects.filter((p) => p.category_id === categoryFilter);
    if (!list.length) return;
    if (!selId || !list.some((p) => p.id === selId)) setSelId(list[0].id);
  }, [categoryFilter, selId, projectFilterKey]);

  useEffect(() => {
    if (tagFilter === "all" || !draft?.projects.length) return;
    const want = tagFilter.toLowerCase();
    const list = draft.projects.filter((p) =>
      (p.tags ?? []).some((t) => String(t).trim().toLowerCase() === want),
    );
    if (!list.length) return;
    if (!selId || !list.some((p) => p.id === selId)) setSelId(list[0].id);
  }, [tagFilter, selId, projectFilterKey, draft?.projects]);

  useEffect(() => {
    if (!aiReply) return;
    hugoReplyRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [aiReply]);

  const selected = useMemo(() => {
    if (!draft) return null;
    return draft.projects.find((p) => p.id === selId) ?? null;
  }, [draft, selId]);

  const primerPaso = useMemo(
    () => computePrimerPaso(selected, draft?.projects.length ?? 0),
    [selected, draft?.projects.length],
  );

  const persist = useCallback(() => {
    if (!draft) return;
    save.mutate(draft);
  }, [draft, save]);

  const handleDeleteBoard = () => {
    if (!selected) return;
    if (
      !window.confirm(
        `¿Eliminar el tablero "${selected.name}"? Se borra del servidor (JSON). No se puede deshacer.`,
      )
    )
      return;
    deleteProj.mutate(selected.id, {
      onSuccess: (d) => {
        setSelId(d.workspace.projects[0]?.id ?? null);
        setCategoryFilter("all");
      },
    });
  };

  const updateProject = useCallback(
    (pid: string, fn: (p: ProjectRow) => void) => {
      setDraft((d) => {
        if (!d) return d;
        const next = cloneWs(d);
        const i = next.projects.findIndex((x) => x.id === pid);
        if (i < 0) return d;
        fn(next.projects[i]);
        next.projects[i].updated_at = new Date().toISOString();
        next.updated_at = next.projects[i].updated_at;
        return next;
      });
    },
    [],
  );

  const handleCreateFromTemplate = () => {
    if (!tplForNew.trim()) return;
    createProj.mutate(
      {
        template_id: tplForNew,
        name: newProjName.trim(),
        category_id: newProjCategoryId.trim() || undefined,
      },
      {
        onSuccess: (res) => {
          setSelId(res.project.id);
          setNewProjName("");
          setTab("tablero");
          setCategoryFilter("all");
        },
      },
    );
  };

  const addCategory = () => {
    const name = newCat.trim();
    if (!name || !draft) return;
    setDraft((d) => {
      if (!d) return d;
      const next = cloneWs(d);
      next.categories.push({ id: newId("c"), name, icon: "📁" });
      next.updated_at = new Date().toISOString();
      return next;
    });
    setNewCat("");
  };

  const addSchedule = () => {
    if (!selected) return;
    const row: ScheduleItem = {
      id: newId("sch"),
      title: "Nueva agenda",
      time_local: "08:00",
      weekdays: [1, 2, 3, 4, 5],
      sound_url: "",
    };
    updateProject(selected.id, (p) => {
      p.schedules.push(row);
    });
  };

  const addPantry = () => {
    if (!selected) return;
    updateProject(selected.id, (p) => {
      p.pantry.push({ id: newId("pan"), name: "Item", qty: 1, unit: "ud", reorder_below: 0.2, prep_notes: "" });
    });
  };

  const addMaterial = () => {
    if (!selected) return;
    updateProject(selected.id, (p) => {
      p.materials.push({ id: newId("mat"), name: "Material", qty: 1, unit: "ud" });
    });
  };

  const consumePantry = (itemId: string, amount: number) => {
    if (!selected) return;
    updateProject(selected.id, (p) => {
      const it = p.pantry.find((x) => x.id === itemId);
      if (it) it.qty = Math.max(0, Number((it.qty - amount).toFixed(4)));
    });
  };

  const speak = (text: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "es-CO";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  };

  const playScheduleAlert = (title: string, url: string) => {
    const u = url.trim();
    if (u) {
      const a = new Audio(u);
      a.play().catch(() => speak(`Recordatorio 5S: ${title}`));
    } else speak(`Recordatorio 5S: ${title}`);
  };

  useEffect(() => {
    const tick = () => {
      if (!draft?.projects.length) return;
      const now = new Date();
      const wd = now.getDay();
      const hm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const dayKey = now.toISOString().slice(0, 10);
      for (const pr of draft.projects) {
        for (const sch of pr.schedules || []) {
          if ((sch.time_local || "").trim() !== hm) continue;
          if (sch.weekdays?.length && !sch.weekdays.includes(wd)) continue;
          const key = `${sch.id}-${dayKey}-${hm}`;
          if (firedRef.current.has(key)) continue;
          firedRef.current.add(key);
          playScheduleAlert(sch.title, sch.sound_url || "");
        }
      }

      setDraft((d) => {
        if (!d) return d;
        let touched = false;
        const next = cloneWs(d);
        for (const pr of next.projects) {
          for (const it of pr.pantry ?? []) {
            if (!(it.reorder_below > 0 && it.qty <= it.reorder_below)) continue;
            const has = (pr.tasks ?? []).some(
              (t) =>
                t.linked_pantry_id === it.id &&
                t.title.startsWith("Reponer:") &&
                t.status !== "done",
            );
            if (has) {
              const ak = `${pr.id}-${it.id}-${dayKey}`;
              if (!lowStockSpokenRef.current.has(ak)) {
                lowStockSpokenRef.current.add(ak);
                speak(`5S: reponer ${it.name}, stock bajo`);
              }
              continue;
            }
            touched = true;
            const orders = (pr.tasks ?? []).map((x) => x.order);
            const minOrd = orders.length ? Math.min(0, ...orders) : 0;
            pr.tasks = pr.tasks ?? [];
            pr.tasks.push({
              id: newId("tk"),
              title: `Reponer: ${it.name} (bajo mínimo en despensa)`,
              status: "pending",
              assignee: "",
              blocked_reason: "",
              order: minOrd - 1,
              scope: "prep",
              linked_pantry_id: it.id,
            });
            pr.updated_at = new Date().toISOString();
            next.updated_at = pr.updated_at;
            const ak = `${pr.id}-${it.id}-${dayKey}`;
            if (!lowStockSpokenRef.current.has(ak)) {
              lowStockSpokenRef.current.add(ak);
              speak(`5S: tarea nueva — reponer ${it.name}`);
            }
          }
        }
        return touched ? next : d;
      });
    };
    const id = window.setInterval(tick, 45_000);
    tick();
    return () => window.clearInterval(id);
  }, [draft?.projects]);

  const applyHeroAction = () => {
    if (!selected) {
      createWizardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (primerPaso.kind === "pantry_low") {
      setTab("logistica");
      return;
    }
    if (
      (primerPaso.kind === "prep_task" ||
        primerPaso.kind === "task_pending" ||
        primerPaso.kind === "blocked") &&
      primerPaso.taskId
    ) {
      updateProject(selected.id, (p) => {
        const x = p.tasks.find((y) => y.id === primerPaso.taskId);
        if (x) x.status = "in_progress";
        if (x && primerPaso.kind === "blocked") x.blocked_reason = "";
      });
      setTab("tablero");
      boardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (primerPaso.kind === "preflight" && primerPaso.preflightId) {
      updateProject(selected.id, (p) => {
        const x = p.preflight.find((y) => y.id === primerPaso.preflightId);
        if (x) x.done = true;
      });
      return;
    }
    if (primerPaso.kind === "task_in_progress" && primerPaso.taskId) {
      setTab("tablero");
      boardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setTab("tablero");
    boardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const heroCtaLabel = () => {
    switch (primerPaso.kind) {
      case "no_workspace":
        return "Ir a crear tablero";
      case "pick_project":
        return "Ver espacios";
      case "pantry_low":
        return "Ir a despensa y reponer";
      case "prep_task":
        return "Empezar preparación";
      case "preflight":
        return "Marcar insumo verificado";
      case "blocked":
      case "task_pending":
        return "Empezar esta tarea";
      case "task_in_progress":
        return "Ir al tablero Trello";
      case "all_done":
        return "Ver tablero";
      default:
        return "Continuar";
    }
  };

  const sendAssistant = () => {
    const msg = aiMsg.trim();
    if (!msg) return;
    setAiReply("");
    setLastProvider("");
    const ctx = selected
      ? {
          proyecto: selected.name,
          ritual: selected.ritual_notes,
          tareas: selected.tasks,
          preflight: selected.preflight,
          despensa: selected.pantry,
          notas_receta: selected.recipe_notes,
        }
      : { vista: "tablero general", proyectos: draft?.projects.map((p) => p.name) };
    assistant.mutate(
      { message: msg, context: ctx },
      {
        onSuccess: (r) => {
          const text = r.ok && r.reply ? r.reply : (r.error || "Sin respuesta");
          setAiReply(text);
          setLastProvider(r.provider || "");
        },
        onError: (err) => {
          const m = err instanceof Error ? err.message : String(err);
          const aborted =
            (err instanceof Error && err.name === "AbortError") ||
            /aborted|AbortError|signal/i.test(m);
          setAiReply(
            aborted
              ? "Tiempo máximo (4 min) agotado. Revisá que Ollama esté activo (`ollama serve`), el modelo cargado y probá una pregunta más corta."
              : m,
          );
          setLastProvider("");
        },
      },
    );
  };

  if (isError) {
    const msg = (error as Error)?.message ?? "Error desconocido";
    return (
      <div className="mx-auto max-w-lg space-y-4 rounded-2xl border border-danger/40 bg-danger/10 p-6">
        <h2 className="text-lg font-semibold text-danger">No se pudo cargar 5S</h2>
        <p className="text-sm text-gray-200">{msg}</p>
        <ul className="list-inside list-disc text-xs text-muted">
          <li>Reiniciá Flask en :8081 tras actualizar el repo (ruta GET /api/5s/workspace).</li>
          <li>Si el mensaje habla de HTML en lugar de JSON, el proxy debe enviar <code className="text-accent">/api/*</code> al backend (no solo archivos bajo <code className="text-accent">/app</code>).</li>
          <li>Ejecutá <code className="text-accent">cd desktop &amp;&amp; npm run build</code> y recargá el panel.</li>
          <li>Si ves &quot;No autorizado&quot;, volvé a ingresar el token (debe coincidir con CHAT_API_TOKEN del servidor).</li>
        </ul>
        <button
          type="button"
          onClick={() => refetch()}
          className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white"
        >
          Reintentar
        </button>
      </div>
    );
  }

  if (isPending || !data) {
    return <p className="text-sm text-muted">Cargando espacio 5S…</p>;
  }

  if (!draft) {
    return <p className="text-sm text-muted">Preparando tablero…</p>;
  }

  if (panelMode === "home") {
    return (
      <div className="mx-auto max-w-7xl space-y-4 pb-16">
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded-xl border border-border px-4 py-2 text-xs text-muted transition hover:bg-surface-hover hover:text-gray-100"
          >
            Sincronizar
          </button>
          <button
            type="button"
            onClick={persist}
            disabled={save.isPending}
            className="rounded-xl bg-accent px-5 py-2 text-xs font-semibold text-white shadow-lg shadow-accent/20 disabled:opacity-50"
          >
            {save.isPending ? "Guardando…" : "Guardar"}
          </button>
        </div>
        {save.isError && (
          <p className="text-sm text-danger">{(save.error as Error)?.message ?? "Error al guardar"}</p>
        )}
        <CincoSGuidedHome
          hasProjects={draft.projects.length > 0}
          onNewRoutine={() => setPanelMode("wizard")}
          onMyBoards={() => setPanelMode("work")}
          onHugo={() => {
            setPanelMode("work");
            setTab("hugo");
          }}
          advancedSection={
            <CincoSTemplateManager
              categories={draft.categories}
              templates={draft.templates}
              replaceTpl={replaceTpl}
              deleteTpl={deleteTpl}
              createTpl={createTpl}
            />
          }
        />
      </div>
    );
  }

  if (panelMode === "wizard") {
    return (
      <div className="mx-auto max-w-7xl pb-16">
        <CincoSRoutineWizard
          categories={draft.categories}
          onCancel={() => setPanelMode("home")}
          onDone={(id) => {
            setSelId(id);
            setPanelMode("work");
            setTab("tablero");
            setCategoryFilter("all");
            setTagFilter("all");
          }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-28">
      <header className="flex flex-col gap-4 border-b border-border pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-widest text-accent">McKenna · Operaciones</p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-gray-100">Espacio 5S · Tableros</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Vista de trabajo: kanban, logística y Hugo. Volvé al <strong className="text-gray-200">inicio guiado</strong>{" "}
            cuando quieras enfocarte solo en el siguiente paso.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setPanelMode("home")}
            className="rounded-xl border border-border px-4 py-2 text-xs text-muted transition hover:bg-surface-hover hover:text-gray-100"
          >
            Inicio guiado
          </button>
          <button
            type="button"
            onClick={() => setPanelMode("wizard")}
            className="rounded-xl border border-accent/50 bg-accent/10 px-4 py-2 text-xs font-semibold text-accent transition hover:bg-accent/20"
          >
            Nueva rutina guiada
          </button>
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded-xl border border-border px-4 py-2 text-xs text-muted transition hover:bg-surface-hover hover:text-gray-100"
          >
            Sincronizar
          </button>
          <button
            type="button"
            onClick={persist}
            disabled={save.isPending}
            className="rounded-xl bg-accent px-5 py-2 text-xs font-semibold text-white shadow-lg shadow-accent/20 disabled:opacity-50"
          >
            {save.isPending ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </header>

      {save.isError && (
        <p className="text-sm text-danger">{(save.error as Error)?.message ?? "Error al guardar"}</p>
      )}

      <details className="rounded-xl border border-border bg-surface-panel">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-200">
          Referencia 5S (Seiri… Shitsuke) — tocá para expandir
        </summary>
        <div className="grid gap-2 border-t border-border p-3 sm:grid-cols-2 xl:grid-cols-5">
          {PILLARS.map((p) => (
            <div
              key={p.id}
              className={`relative overflow-hidden rounded-xl border border-border bg-surface-hover/40 p-3 ring-1 ${p.ring}`}
            >
              <div className={`absolute left-0 top-0 h-full w-1 ${p.bar}`} />
              <p className="pl-2 text-[10px] font-bold uppercase tracking-wider text-muted">{p.jp}</p>
              <p className="pl-2 text-sm font-semibold text-gray-100">
                {p.id} · {p.tag}
              </p>
              <p className="mt-1 pl-2 text-xs leading-snug text-muted">{p.desc}</p>
            </div>
          ))}
        </div>
      </details>

      {/* Hero: primera acción */}
      <section
        className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br from-surface-panel to-surface-hover p-6 ring-2 ${pillarCardClass(primerPaso.pillar)}`}
      >
        <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-accent/10 blur-3xl" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl space-y-2">
            <span className="inline-flex items-center rounded-full border border-border bg-surface-hover px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent">
              Empezá acá · {primerPaso.pillar}
            </span>
            <h3 className="text-xl font-bold text-gray-100">{primerPaso.title}</h3>
            <p className="text-sm text-gray-300">{primerPaso.subtitle}</p>
            <p className="text-xs italic text-muted">{pillarHint(primerPaso.pillar)}</p>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={applyHeroAction}
              className="rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-accent-hover"
            >
              {heroCtaLabel()}
            </button>
            <button
              type="button"
              onClick={() => {
                setTab("hugo");
                setAiMsg("¿Cuál es mi siguiente paso concreto en este proyecto según 5S?");
              }}
              className="rounded-xl border border-border px-5 py-3 text-sm text-gray-200 transition hover:bg-surface-hover"
            >
              Preguntar a Hugo
            </button>
          </div>
        </div>
      </section>

      <p className="text-center text-xs text-muted">
        Tip: usá <strong className="text-gray-300">Nueva rutina guiada</strong> para cargar tareas con interfaz paso a paso.
        Hugo puede tardar hasta ~4 min si Ollama está generando.
      </p>

      <details ref={createWizardRef} className="rounded-xl border border-border bg-surface-panel">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-200">
          Creación clásica · plantillas, áreas y editor de plantillas
        </summary>
        <div className="space-y-6 border-t border-border p-5">
          <section>
            <h3 className="text-base font-semibold text-gray-100">Crear tablero desde plantilla</h3>
            <p className="mt-1 text-xs text-muted">
              Tres campos y listo. Para menos ruido visual, preferí el asistente guiado desde el encabezado.
            </p>
            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <div className="rounded-lg border border-border bg-surface-hover/50 p-3">
                <p className="text-[10px] font-bold uppercase text-accent">Plantilla</p>
                <select
                  value={tplForNew}
                  onChange={(e) => setTplForNew(e.target.value)}
                  className="mt-2 w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm"
                >
                  <option value="">Elegí plantilla…</option>
                  {draft.templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="rounded-lg border border-border bg-surface-hover/50 p-3">
                <p className="text-[10px] font-bold uppercase text-accent">Nombre del tablero</p>
                <input
                  value={newProjName}
                  onChange={(e) => setNewProjName(e.target.value)}
                  placeholder="Ej: Paseo mañana"
                  className="mt-2 w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm"
                />
              </div>
              <div className="rounded-lg border border-border bg-surface-hover/50 p-3">
                <p className="text-[10px] font-bold uppercase text-accent">Área</p>
                <select
                  value={newProjCategoryId}
                  onChange={(e) => setNewProjCategoryId(e.target.value)}
                  className="mt-2 w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm"
                >
                  {draft.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.icon} {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleCreateFromTemplate}
                disabled={!tplForNew || createProj.isPending}
                className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                {createProj.isPending ? "Creando…" : "Crear tablero"}
              </button>
              {createProj.isError && (
                <p className="text-xs text-danger">{(createProj.error as Error)?.message}</p>
              )}
            </div>
          </section>

          <section>
            <h4 className="text-sm font-medium text-gray-200">Áreas personalizadas</h4>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                value={newCat}
                onChange={(e) => setNewCat(e.target.value)}
                placeholder="Nombre del área nueva"
                className="min-w-[200px] flex-1 rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm"
              />
              <button type="button" onClick={addCategory} className="rounded-lg border border-border px-4 py-2 text-sm">
                Añadir área
              </button>
            </div>
          </section>

          <CincoSTemplateManager
            categories={draft.categories}
            templates={draft.templates}
            replaceTpl={replaceTpl}
            deleteTpl={deleteTpl}
            createTpl={createTpl}
          />
        </div>
      </details>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,260px)_1fr]">
        {/* Rail estilo Notion */}
        <aside className="space-y-3">
          <div className="rounded-xl border border-border bg-surface-panel p-3">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted">Tus tableros</h3>
            <p className="mt-1 text-[10px] leading-snug text-muted">
              Área + patrones (tags). Más tableros: inicio guiado o creación clásica abajo.
            </p>
            <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-muted">Área</p>
            <div className="mt-1 flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => setCategoryFilter("all")}
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  categoryFilter === "all" ? "bg-accent text-white" : "bg-surface-hover text-muted"
                }`}
              >
                Todas
              </button>
              {draft.categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategoryFilter(c.id)}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    categoryFilter === c.id ? "bg-accent text-white" : "bg-surface-hover text-muted"
                  }`}
                >
                  {c.icon} {c.name}
                </button>
              ))}
            </div>
            {allPatternTags.length > 0 && (
              <>
                <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-muted">Patrones</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => setTagFilter("all")}
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      tagFilter === "all" ? "bg-emerald-600 text-white" : "bg-surface-hover text-muted"
                    }`}
                  >
                    Todos
                  </button>
                  {allPatternTags.map((tg) => (
                    <button
                      key={tg}
                      type="button"
                      onClick={() => setTagFilter(tg)}
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        tagFilter === tg ? "bg-emerald-600 text-white" : "bg-surface-hover text-muted"
                      }`}
                    >
                      {tg}
                    </button>
                  ))}
                </div>
              </>
            )}
            <ul className="mt-2 max-h-[50vh] space-y-0.5 overflow-y-auto pr-1">
              {filteredProjects.map((p) => {
                const cat = draft.categories.find((c) => c.id === p.category_id);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelId(p.id);
                        setTab("tablero");
                      }}
                      className={`flex w-full flex-col rounded-lg px-2 py-2.5 text-left transition ${
                        p.id === selId ? "bg-accent/15 ring-1 ring-accent/40" : "hover:bg-surface-hover"
                      }`}
                    >
                      <span className="text-sm font-medium text-gray-100">{p.name}</span>
                      <span className="text-[10px] text-muted">
                        Área: {cat?.icon} {cat?.name ?? "Sin área"}
                        {(p.tags ?? []).length > 0 && (
                          <>
                            {" "}
                            · {p.tags!.slice(0, 4).join(", ")}
                            {p.tags!.length > 4 ? "…" : ""}
                          </>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {draft.projects.length === 0 && (
              <p className="mt-2 text-xs text-muted">
                No hay tableros todavía. Volvé a <strong className="text-gray-300">Inicio guiado</strong> → Nueva rutina
                guiada, o abrí creación clásica más arriba.
              </p>
            )}
            {draft.projects.length > 0 && filteredProjects.length === 0 && (
              <p className="mt-2 text-xs text-warning">
                Ningún tablero en esta área. Elegí &quot;Todas&quot; o creá uno con esa área en el paso 3.
              </p>
            )}
          </div>
        </aside>

        <div className="min-w-0 space-y-4">
          {!selected ? (
            <p className="rounded-xl border border-border bg-surface-panel p-8 text-center text-sm text-muted">
              Elegí un tablero o creá uno. El hero de arriba te dice el siguiente movimiento.
            </p>
          ) : (
            <>
              <div className="border-b border-border pb-3">
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ["tablero", "Tablero", "Kanban de tareas"],
                      ["logistica", "Logística", "Checklist, despensa, agenda"],
                      ["hugo", "Hugo", "Consultas Ollama"],
                    ] as const
                  ).map(([id, lab, sub]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setTab(id)}
                      className={`rounded-xl px-4 py-2 text-left text-xs font-semibold transition ${
                        tab === id ? "bg-accent text-white" : "bg-surface-hover text-muted hover:text-gray-100"
                      }`}
                    >
                      <span className="block">{lab}</span>
                      <span
                        className={`mt-0.5 block text-[10px] font-normal ${
                          tab === id ? "text-white/80" : "text-muted"
                        }`}
                      >
                        {sub}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {tab === "tablero" && (
                <div ref={boardRef} className="space-y-4">
                  <div className="rounded-xl border border-border bg-surface-panel p-4">
                    <input
                      value={selected.name}
                      onChange={(e) =>
                        updateProject(selected.id, (p) => {
                          p.name = e.target.value;
                        })
                      }
                      className="w-full border-none bg-transparent text-lg font-bold text-gray-100 outline-none"
                    />
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                      <label className="flex min-w-0 flex-1 flex-col text-[10px] uppercase tracking-wide text-muted">
                        Área del tablero
                        <select
                          value={selected.category_id}
                          onChange={(e) =>
                            updateProject(selected.id, (p) => {
                              p.category_id = e.target.value;
                            })
                          }
                          className="mt-1 rounded-lg border border-border bg-surface-hover px-2 py-1.5 text-sm text-gray-100"
                        >
                          {draft.categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.icon} {c.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p className="text-xs text-muted sm:pt-4">
                        Origen: <code className="text-gray-300">{selected.template_id ?? "—"}</code>
                        {(selected.tags ?? []).length > 0 && (
                          <>
                            {" "}
                            · Patrones:{" "}
                            <span className="text-gray-300">{(selected.tags ?? []).join(", ")}</span>
                          </>
                        )}{" "}
                        · Último cambio {new Date(selected.updated_at).toLocaleString("es-CO")}
                      </p>
                    </div>
                    <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-border pt-3">
                      <button
                        type="button"
                        onClick={handleDeleteBoard}
                        disabled={deleteProj.isPending}
                        className="rounded-lg border border-danger/50 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
                      >
                        {deleteProj.isPending ? "Eliminando…" : "Eliminar tablero"}
                      </button>
                      {deleteProj.isError && (
                        <p className="w-full text-right text-xs text-danger">
                          {(deleteProj.error as Error)?.message}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="overflow-x-auto pb-2">
                    <div className="flex min-h-[420px] gap-3" style={{ minWidth: "min(100%, 900px)" }}>
                      {KANBAN_COLS.map((col) => (
                        <div
                          key={col.status}
                          className="flex w-[min(100%,220px)] shrink-0 flex-col rounded-xl border border-border bg-surface-hover/40"
                        >
                          <div className="border-b border-border px-3 py-2">
                            <p className="text-xs font-bold uppercase tracking-wide text-gray-200">{col.title}</p>
                            <p className="text-[10px] text-muted">{col.hint}</p>
                          </div>
                          <div className="flex flex-1 flex-col gap-2 p-2">
                            {selected.tasks
                              .filter((t) => t.status === col.status)
                              .sort((a, b) => a.order - b.order)
                              .map((t) => (
                                <div
                                  key={t.id}
                                  className={`rounded-lg border bg-surface-panel p-2.5 shadow-sm ${
                                    primerPaso.taskId === t.id ? "ring-2 ring-accent/50" : "border-border"
                                  }`}
                                >
                                  {t.scope === "prep" && (
                                    <span className="mb-1 inline-block rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-200">
                                      {t.title.startsWith("Reponer:") ? "Reposición" : "Preparación / despensa"}
                                    </span>
                                  )}
                                  <input
                                    value={t.title}
                                    onChange={(e) =>
                                      updateProject(selected.id, (p) => {
                                        const x = p.tasks.find((y) => y.id === t.id);
                                        if (x) x.title = e.target.value;
                                      })
                                    }
                                    className="w-full border-none bg-transparent text-sm font-medium text-gray-100 outline-none"
                                  />
                                  <select
                                    value={t.status}
                                    onChange={(e) =>
                                      updateProject(selected.id, (p) => {
                                        const x = p.tasks.find((y) => y.id === t.id);
                                        if (x) x.status = e.target.value as TaskStatus;
                                      })
                                    }
                                    className="mt-2 w-full rounded border border-border bg-surface-hover py-1 text-xs text-gray-200"
                                  >
                                    <option value="pending">Por hacer</option>
                                    <option value="in_progress">En curso</option>
                                    <option value="blocked">Bloqueado</option>
                                    <option value="done">Hecho</option>
                                  </select>
                                  {t.status === "blocked" && (
                                    <input
                                      value={t.blocked_reason}
                                      onChange={(e) =>
                                        updateProject(selected.id, (p) => {
                                          const x = p.tasks.find((y) => y.id === t.id);
                                          if (x) x.blocked_reason = e.target.value;
                                        })
                                      }
                                      placeholder="¿Qué novedad lo frena?"
                                      className="mt-2 w-full rounded border border-border bg-surface-hover px-2 py-1 text-xs"
                                    />
                                  )}
                                  <input
                                    value={t.assignee}
                                    onChange={(e) =>
                                      updateProject(selected.id, (p) => {
                                        const x = p.tasks.find((y) => y.id === t.id);
                                        if (x) x.assignee = e.target.value;
                                      })
                                    }
                                    placeholder="Asignado a"
                                    className="mt-2 w-full rounded border border-border bg-surface-hover px-2 py-1 text-xs"
                                  />
                                </div>
                              ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {tab === "logistica" && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-border bg-surface-panel p-4">
                    <h3 className="text-sm font-semibold text-accent">Preflight · condiciones iniciales</h3>
                    <ul className="mt-3 space-y-2">
                      {selected.preflight.map((row) => (
                        <li key={row.id} className="flex flex-wrap items-center gap-2 text-sm">
                          <label className="flex flex-1 items-center gap-2">
                            <input
                              type="checkbox"
                              checked={row.done}
                              onChange={(e) =>
                                updateProject(selected.id, (p) => {
                                  const x = p.preflight.find((y) => y.id === row.id);
                                  if (x) x.done = e.target.checked;
                                })
                              }
                              className="rounded border-border"
                            />
                            <span className={row.done ? "text-muted line-through" : "text-gray-200"}>{row.label}</span>
                          </label>
                          <input
                            value={row.assignee}
                            onChange={(e) =>
                              updateProject(selected.id, (p) => {
                                const x = p.preflight.find((y) => y.id === row.id);
                                if (x) x.assignee = e.target.value;
                              })
                            }
                            placeholder="Responsable"
                            className="w-36 rounded border border-border bg-surface-hover px-2 py-1 text-xs"
                          />
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="rounded-xl border border-border bg-surface-panel p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-accent">Materiales</h3>
                      <button type="button" onClick={addMaterial} className="text-xs text-accent">
                        + fila
                      </button>
                    </div>
                    <div className="space-y-2">
                      {selected.materials.map((m) => (
                        <div key={m.id} className="flex flex-wrap gap-2 text-sm">
                          <input
                            value={m.name}
                            onChange={(e) =>
                              updateProject(selected.id, (p) => {
                                const x = p.materials.find((y) => y.id === m.id);
                                if (x) x.name = e.target.value;
                              })
                            }
                            className="min-w-[120px] flex-1 rounded border border-border bg-surface-hover px-2 py-1"
                          />
                          <input
                            type="number"
                            value={m.qty}
                            onChange={(e) =>
                              updateProject(selected.id, (p) => {
                                const x = p.materials.find((y) => y.id === m.id);
                                if (x) x.qty = Number(e.target.value);
                              })
                            }
                            className="w-20 rounded border border-border bg-surface-hover px-2 py-1"
                          />
                          <input
                            value={m.unit}
                            onChange={(e) =>
                              updateProject(selected.id, (p) => {
                                const x = p.materials.find((y) => y.id === m.id);
                                if (x) x.unit = e.target.value;
                              })
                            }
                            className="w-20 rounded border border-border bg-surface-hover px-2 py-1"
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-surface-panel p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-accent">Despensa</h3>
                      <button type="button" onClick={addPantry} className="text-xs text-accent">
                        + item
                      </button>
                    </div>
                    <div className="space-y-2">
                      {selected.pantry.map((it) => {
                        const low = it.reorder_below > 0 && it.qty <= it.reorder_below;
                        return (
                          <div
                            key={it.id}
                            className={`flex flex-wrap items-end gap-2 rounded-lg border p-2 text-sm ${
                              low ? "border-danger/50 bg-danger/5" : "border-border"
                            }`}
                          >
                            <input
                              value={it.name}
                              onChange={(e) =>
                                updateProject(selected.id, (p) => {
                                  const x = p.pantry.find((y) => y.id === it.id);
                                  if (x) x.name = e.target.value;
                                })
                              }
                              className="min-w-[100px] flex-1 rounded border border-border bg-surface-hover px-2 py-1"
                            />
                            <input
                              value={it.prep_notes ?? ""}
                              onChange={(e) =>
                                updateProject(selected.id, (p) => {
                                  const x = p.pantry.find((y) => y.id === it.id);
                                  if (x) x.prep_notes = e.target.value;
                                })
                              }
                              placeholder="Qué implica tenerlo listo (elaborar, comprar…)"
                              className="min-w-[140px] flex-[2] rounded border border-border bg-surface-hover px-2 py-1 text-xs"
                            />
                            <input
                              type="number"
                              value={it.qty}
                              onChange={(e) =>
                                updateProject(selected.id, (p) => {
                                  const x = p.pantry.find((y) => y.id === it.id);
                                  if (x) x.qty = Number(e.target.value);
                                })
                              }
                              className="w-16 rounded border border-border bg-surface-hover px-1 py-1 text-xs"
                            />
                            <select
                              value={it.unit?.trim() || "ud"}
                              onChange={(e) =>
                                updateProject(selected.id, (p) => {
                                  const x = p.pantry.find((y) => y.id === it.id);
                                  if (x) x.unit = e.target.value;
                                })
                              }
                              title="Unidad"
                              className="w-[6.5rem] rounded border border-border bg-surface-hover px-1 py-1 text-xs"
                            >
                              {it.unit &&
                              !PANTRY_UNIT_OPTIONS.some((o) => o.value === it.unit) ? (
                                <option value={it.unit}>{it.unit}</option>
                              ) : null}
                              {PANTRY_UNIT_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                            <input
                              type="number"
                              value={it.reorder_below}
                              onChange={(e) =>
                                updateProject(selected.id, (p) => {
                                  const x = p.pantry.find((y) => y.id === it.id);
                                  if (x) x.reorder_below = Number(e.target.value);
                                })
                              }
                              title="Reponer si cantidad <="
                              className="w-16 rounded border border-border bg-surface-hover px-1 py-1 text-xs"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const n = Number(window.prompt("Descontar del inventario", "0.5"));
                                if (!Number.isFinite(n) || n <= 0) return;
                                consumePantry(it.id, n);
                              }}
                              className="rounded bg-surface-hover px-2 py-1 text-xs"
                            >
                              − consumo
                            </button>
                            {low && <span className="text-xs font-semibold text-danger">Reponer</span>}
                          </div>
                        );
                      })}
                    </div>
                    <textarea
                      value={selected.recipe_notes}
                      onChange={(e) =>
                        updateProject(selected.id, (p) => {
                          p.recipe_notes = e.target.value;
                        })
                      }
                      placeholder="Recetas, listas, rituales de compra…"
                      rows={3}
                      className="mt-3 w-full rounded-lg border border-border bg-surface-hover p-2 text-sm"
                    />
                  </div>

                  <div className="rounded-xl border border-border bg-surface-panel p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-accent">Agenda · alertas</h3>
                      <button type="button" onClick={addSchedule} className="text-xs text-accent">
                        + recordatorio
                      </button>
                    </div>
                    {selected.schedules.map((s) => (
                      <div key={s.id} className="mb-3 rounded-lg border border-border p-3 text-sm last:mb-0">
                        <input
                          value={s.title}
                          onChange={(e) =>
                            updateProject(selected.id, (p) => {
                              const x = p.schedules.find((y) => y.id === s.id);
                              if (x) x.title = e.target.value;
                            })
                          }
                          className="mb-2 w-full rounded border border-border bg-surface-hover px-2 py-1"
                        />
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                          <input
                            type="time"
                            value={s.time_local}
                            onChange={(e) =>
                              updateProject(selected.id, (p) => {
                                const x = p.schedules.find((y) => y.id === s.id);
                                if (x) x.time_local = e.target.value;
                              })
                            }
                            className="rounded border border-border bg-surface-hover px-2 py-1 text-gray-100"
                          />
                          <div className="flex flex-wrap gap-1">
                            {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                              <button
                                key={d}
                                type="button"
                                onClick={() =>
                                  updateProject(selected.id, (p) => {
                                    const x = p.schedules.find((y) => y.id === s.id);
                                    if (!x) return;
                                    const set = new Set(x.weekdays || []);
                                    if (set.has(d)) set.delete(d);
                                    else set.add(d);
                                    x.weekdays = [...set].sort();
                                  })
                                }
                                className={`rounded px-1.5 py-0.5 ${
                                  s.weekdays?.includes(d) ? "bg-accent text-white" : "bg-surface-hover"
                                }`}
                              >
                                {WD_LABELS[d]}
                              </button>
                            ))}
                          </div>
                        </div>
                        <p className="mt-2 text-[10px] text-muted">
                          Sonido al disparar el recordatorio: subí un <strong className="text-gray-300">.wav</strong> o pegá
                          una URL pública.
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <label className="cursor-pointer rounded-lg border border-border bg-surface-hover px-3 py-1.5 text-xs text-gray-200 hover:bg-surface-panel">
                            <input
                              type="file"
                              accept=".wav,audio/wav"
                              className="hidden"
                              disabled={wavUploadingId === s.id}
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                e.target.value = "";
                                if (!file) return;
                                if (!file.name.toLowerCase().endsWith(".wav")) {
                                  window.alert("Solo archivos .wav");
                                  return;
                                }
                                setWavUploadingId(s.id);
                                try {
                                  const url = await uploadCincoSWav(file);
                                  updateProject(selected.id, (p) => {
                                    const x = p.schedules.find((y) => y.id === s.id);
                                    if (x) x.sound_url = url;
                                  });
                                } catch (err) {
                                  window.alert((err as Error).message);
                                } finally {
                                  setWavUploadingId(null);
                                }
                              }}
                            />
                            {wavUploadingId === s.id ? "Subiendo…" : "Subir .wav"}
                          </label>
                          {s.sound_url && (
                            <button
                              type="button"
                              onClick={() =>
                                updateProject(selected.id, (p) => {
                                  const x = p.schedules.find((y) => y.id === s.id);
                                  if (x) x.sound_url = "";
                                })
                              }
                              className="rounded-lg border border-border px-2 py-1 text-xs text-muted hover:text-danger"
                            >
                              Quitar audio
                            </button>
                          )}
                        </div>
                        <input
                          value={s.sound_url}
                          onChange={(e) =>
                            updateProject(selected.id, (p) => {
                              const x = p.schedules.find((y) => y.id === s.id);
                              if (x) x.sound_url = e.target.value;
                            })
                          }
                          placeholder="URL de audio (opcional) o dejá la que generó la subida"
                          className="mt-2 w-full rounded border border-border bg-surface-hover px-2 py-1 text-xs"
                        />
                        {s.sound_url?.trim() && (
                          <audio controls src={s.sound_url} className="mt-2 h-9 w-full max-w-md rounded border border-border" />
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="rounded-xl border border-border bg-surface-panel p-4">
                    <h3 className="text-sm font-semibold text-accent">Manual del ritual</h3>
                    <textarea
                      value={selected.ritual_notes}
                      onChange={(e) =>
                        updateProject(selected.id, (p) => {
                          p.ritual_notes = e.target.value;
                        })
                      }
                      rows={5}
                      className="mt-2 w-full rounded-lg border border-border bg-surface-hover p-2 text-sm"
                    />
                  </div>
                </div>
              )}

              {tab === "hugo" && (
                <div className="rounded-xl border border-border bg-surface-panel p-5">
                  <p className="text-sm text-gray-200">
                    Escribí abajo y tocá <strong>Enviar</strong>. La respuesta aparece en el recuadro gris{" "}
                    <strong>debajo del botón</strong> (podés hacer scroll). El servidor llama a Ollama (
                    <code className="rounded bg-surface-hover px-1 text-xs">hugo-garcia:latest</code>) con tope de 4
                    minutos. Si falla, configurá <code className="text-xs">GOOGLE_API_KEY</code> para fallback Gemini (
                    <code className="text-xs">AGENTE_5S_LLM=auto</code>).
                  </p>
                  {lastProvider && (
                    <p className="mt-2 text-xs text-success">
                      Última respuesta vía: <strong>{lastProvider}</strong>
                    </p>
                  )}
                  <textarea
                    value={aiMsg}
                    onChange={(e) => setAiMsg(e.target.value)}
                    rows={6}
                    placeholder="Ej: ¿Qué reviso en cocina antes de cocinar? ¿Cómo desbloqueo la tarea de render?"
                    className="mt-4 w-full rounded-xl border border-border bg-surface-hover p-3 text-sm"
                  />
                  <button
                    type="button"
                    onClick={sendAssistant}
                    disabled={assistant.isPending}
                    className="mt-3 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {assistant.isPending ? "Hugo pensando (puede tardar varios minutos)…" : "Enviar a Hugo"}
                  </button>
                  {assistant.isError && (
                    <p className="mt-2 text-xs text-danger">
                      {(assistant.error as Error)?.message ?? "Error de red"}
                    </p>
                  )}
                  {aiReply ? (
                    <div
                      ref={hugoReplyRef}
                      className="mt-4 rounded-xl border border-border bg-surface-hover/80 p-4 text-sm leading-relaxed text-gray-100 whitespace-pre-wrap ring-1 ring-accent/20"
                    >
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-accent">Respuesta</p>
                      {aiReply}
                    </div>
                  ) : (
                    !assistant.isPending && (
                      <p className="mt-4 text-xs text-muted">
                        Todavía no hay respuesta en esta sesión. Enviá una pregunta para ver el texto acá.
                      </p>
                    )
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
