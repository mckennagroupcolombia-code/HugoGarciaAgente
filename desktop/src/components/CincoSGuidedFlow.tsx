import { useMemo, useState, type ReactNode } from "react";
import type { CategoryRow, ScheduleItem, SupplyCreatePayload, SuggestRoutineResponse } from "../hooks/useCincoS";
import { useCreateCincoSRoutine, useSuggestCincoSRoutine } from "../hooks/useCincoS";

export type WizardAppearance = "claude" | "dark";

function stepDotsClasses(appearance: WizardAppearance, i: number, step: number) {
  if (appearance === "claude") {
    return i === step ? "bg-c5s-accent" : i < step ? "bg-c5s-accent/40" : "bg-c5s-line";
  }
  return i === step ? "bg-accent" : i < step ? "bg-accent/40" : "bg-border";
}

/** Patrones guiados (clasificación dinámica); el área se infiere después si no la tocás. */
export const PATTERN_CHIPS: { id: string; label: string; hint: string }[] = [
  { id: "hogar", label: "Hogar", hint: "orden y espacio" },
  { id: "mascotas", label: "Mascotas", hint: "cuidado animal" },
  { id: "cocina", label: "Cocina", hint: "alimentos y limpieza" },
  { id: "alimentacion", label: "Alimentación", hint: "comidas y nutrición" },
  { id: "taller", label: "Taller", hint: "diseño / herramientas" },
  { id: "finanzas", label: "Finanzas", hint: "pagos y control" },
  { id: "limpieza", label: "Limpieza", hint: "aseo profundo" },
  { id: "salud", label: "Salud", hint: "bienestar" },
  { id: "ingenieria", label: "Ingeniería", hint: "procesos técnicos" },
];

type GuidedHomeProps = {
  hasProjects: boolean;
  onNewRoutine: () => void;
  onMyBoards: () => void;
  onHugo: () => void;
  advancedSection: ReactNode;
};

export function CincoSGuidedHome({
  hasProjects,
  onNewRoutine,
  onMyBoards,
  onHugo,
  advancedSection,
}: GuidedHomeProps) {
  return (
    <div className="mx-auto max-w-xl space-y-8 pb-16 pt-4">
      <header className="text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-accent">McKenna · 5S</p>
        <h2 className="mt-2 text-2xl font-bold tracking-tight text-ink">Tu espacio de trabajo</h2>
        <p className="mx-auto mt-3 max-w-md text-sm text-muted">
          Una pantalla a la vez: primero definís la rutina con patrones y checklist; el tablero aparece cuando ya
          tenés algo concreto.
        </p>
      </header>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={onNewRoutine}
          className="rounded-2xl bg-accent px-6 py-4 text-left text-sm font-semibold text-white shadow-lg shadow-accent/25 transition hover:bg-accent-hover"
        >
          <span className="block text-base">Nueva rutina guiada</span>
          <span className="mt-1 block text-xs font-normal text-white/85">
            Paso a paso: nombre → patrones → insumos y despensa → pasos de la rutina → Hugo → guardar
          </span>
        </button>

        <button
          type="button"
          onClick={() => (hasProjects ? onMyBoards() : undefined)}
          disabled={!hasProjects}
          className="rounded-2xl border border-border bg-surface-panel px-6 py-4 text-left text-sm font-medium text-ink transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span className="block text-base">Mis tableros</span>
          <span className="mt-1 block text-xs font-normal text-muted">
            {hasProjects ? "Kanban, logística y agendas" : "Creá la primera rutina arriba"}
          </span>
        </button>

        <button
          type="button"
          onClick={onHugo}
          className="rounded-2xl border border-border bg-surface-panel px-6 py-4 text-left text-sm font-medium text-ink transition hover:bg-surface-hover"
        >
          <span className="block text-base">Hablar con Hugo</span>
          <span className="mt-1 block text-xs font-normal text-muted">
            Consultas 5S sobre el tablero abierto (Ollama / Gemini según servidor)
          </span>
        </button>
      </div>

      <details className="rounded-xl border border-border bg-surface-panel p-4">
        <summary className="cursor-pointer text-sm font-medium text-ink-secondary">
          Avanzado · plantillas, áreas y creación clásica
        </summary>
        <p className="mt-2 text-xs text-muted">
          Las plantillas siguen disponibles: sirven como atajos. La rutina guiada prioriza patrones y checklist; si
          pedís guardar patrón, el sistema puede crear una plantilla automática a partir de lo mismo.
        </p>
        <div className="mt-4">{advancedSection}</div>
      </details>
    </div>
  );
}

function StepExample({ title, lines, appearance }: { title: string; lines: string[]; appearance: WizardAppearance }) {
  if (appearance === "claude") {
    return (
      <div className="mt-4 rounded-xl border border-c5s-line bg-c5s-canvas/80 p-4 text-left">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-c5s-muted">{title}</p>
        <ul className="mt-2 list-inside list-disc space-y-1 text-[11px] text-c5s-ink">
          {lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="mt-4 rounded-xl border border-sky-500/30 bg-gradient-to-br from-sky-500/10 to-transparent p-4 text-left shadow-inner shadow-sky-500/5">
      <p className="text-[11px] font-bold uppercase tracking-wide text-sky-200">{title}</p>
      <ul className="mt-2 list-inside list-disc space-y-1 text-[11px] text-ink-muted">
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    </div>
  );
}

function StepDots({ step, total, appearance }: { step: number; total: number; appearance: WizardAppearance }) {
  return (
    <div className="flex justify-center gap-2" role="status" aria-label={`Paso ${step + 1} de ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`h-2 w-2 rounded-full ${stepDotsClasses(appearance, i, step)}`} />
      ))}
    </div>
  );
}

function ListEditor({
  label,
  hint,
  rows,
  setRows,
  placeholder,
  appearance,
}: {
  label: string;
  hint: string;
  rows: string[];
  setRows: (v: string[]) => void;
  placeholder: string;
  appearance: WizardAppearance;
}) {
  const update = (i: number, v: string) => {
    const next = [...rows];
    next[i] = v;
    setRows(next);
  };
  const add = () => setRows([...rows, ""]);
  const del = (i: number) => setRows(rows.filter((_, j) => j !== i));

  const isClaude = appearance === "claude";
  return (
    <div className="space-y-3">
      <div>
        <p className={`text-sm font-semibold ${isClaude ? "text-c5s-ink" : "text-ink"}`}>{label}</p>
        <p className={`text-xs ${isClaude ? "text-c5s-muted" : "text-muted"}`}>{hint}</p>
      </div>
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex gap-2">
            <input
              value={row}
              onChange={(e) => update(i, e.target.value)}
              placeholder={placeholder}
              className={
                isClaude
                  ? "min-w-0 flex-1 rounded-lg border border-c5s-line bg-white px-3 py-2.5 text-sm text-c5s-ink shadow-sm"
                  : "min-w-0 flex-1 rounded-lg border border-border bg-surface-hover px-3 py-2.5 text-sm text-ink"
              }
            />
            <button
              type="button"
              onClick={() => del(i)}
              disabled={rows.length <= 1}
              className={
                isClaude
                  ? "shrink-0 rounded-lg border border-c5s-line bg-c5s-panel px-3 text-xs text-c5s-muted hover:bg-c5s-canvas disabled:opacity-30"
                  : "shrink-0 rounded-lg border border-border px-3 text-xs text-muted hover:bg-surface-hover disabled:opacity-30"
              }
            >
              Quitar
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={add} className={`text-xs font-medium ${isClaude ? "text-c5s-accent hover:underline" : "text-accent hover:underline"}`}>
        + Agregar fila
      </button>
    </div>
  );
}

type SupplyDraft = {
  name: string;
  prep_action: string;
  initial_qty: string;
  reorder_below: string;
  priority: string;
  unit: string;
};

const PANTRY_UNITS: { value: string; label: string }[] = [
  { value: "g", label: "Gramos (g)" },
  { value: "kg", label: "Kilogramos (kg)" },
  { value: "mg", label: "Miligramos (mg)" },
  { value: "ml", label: "Mililitros (ml)" },
  { value: "l", label: "Litros (l)" },
  { value: "ud", label: "Unidades (ud)" },
  { value: "porción", label: "Porciones" },
  { value: "servicio", label: "Servicios" },
  { value: "caja", label: "Caja" },
  { value: "bolsa", label: "Bolsa" },
  { value: "bandeja", label: "Bandeja" },
  { value: "taza", label: "Taza" },
];

function emptySupply(): SupplyDraft {
  return { name: "", prep_action: "", initial_qty: "1", reorder_below: "0.25", priority: "3", unit: "g" };
}

function SuppliesEditor({
  rows,
  setRows,
  appearance,
}: {
  rows: SupplyDraft[];
  setRows: (v: SupplyDraft[]) => void;
  appearance: WizardAppearance;
}) {
  const upd = (i: number, patch: Partial<SupplyDraft>) => {
    const next = [...rows];
    next[i] = { ...next[i], ...patch };
    setRows(next);
  };
  const add = () => setRows([...rows, emptySupply()]);
  const del = (i: number) => setRows(rows.filter((_, j) => j !== i));

  const isClaude = appearance === "claude";
  const field = isClaude
    ? "mt-1 w-full rounded-lg border border-c5s-line bg-white px-3 py-2 text-sm text-c5s-ink shadow-sm"
    : "mt-1 w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm text-ink";
  const fieldSm = isClaude
    ? "mt-1 w-full rounded border border-c5s-line bg-white px-2 py-1.5 text-sm text-c5s-ink"
    : "mt-1 w-full rounded border border-border bg-surface-hover px-2 py-1.5 text-sm";
  const card = isClaude ? "space-y-2 rounded-xl border border-c5s-line bg-c5s-canvas/60 p-4 shadow-sm" : "space-y-2 rounded-xl border border-border bg-surface-hover/40 p-4";

  return (
    <div className="space-y-4">
      <p className={`text-xs leading-relaxed ${isClaude ? "text-c5s-muted" : "text-muted"}`}>
        Cada insumo vive en <strong className={isClaude ? "text-c5s-ink" : "text-ink-muted"}>despensa</strong> con cantidad y mínimo: si queda bajo el
        mínimo, el tablero prioriza <strong className={isClaude ? "text-c5s-ink" : "text-ink-muted"}>reponer</strong> y crea una tarea de reposición
        (con aviso por voz una vez al día). La columna &quot;Qué falta antes&quot; genera tareas de{" "}
        <strong className={isClaude ? "text-c5s-ink" : "text-ink-muted"}>preparación</strong> (elaborar kefir, comprar fruta…){" "}
        <em>antes</em> del checklist de verificación. Si no usás despensa, dejá las filas vacías y cargá solo pasos en el
        siguiente paso.
      </p>
      {rows.map((row, i) => (
        <div key={i} className={card}>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => del(i)}
              disabled={rows.length <= 1}
              className={`text-[10px] disabled:opacity-30 ${isClaude ? "text-c5s-muted hover:text-c5s-accent" : "text-muted hover:text-danger"}`}
            >
              Quitar insumo
            </button>
          </div>
          <label className={`block text-[11px] ${isClaude ? "text-c5s-muted" : "text-muted"}`}>
            Insumo
            <input
              value={row.name}
              onChange={(e) => upd(i, { name: e.target.value })}
              placeholder="Ej.: Kefir, Granola, Fruta, Suplementos"
              className={field}
            />
          </label>
          <label className={`block text-[11px] ${isClaude ? "text-c5s-muted" : "text-muted"}`}>
            Qué tenés que hacer antes para tenerlo listo
            <input
              value={row.prep_action}
              onChange={(e) => upd(i, { prep_action: e.target.value })}
              placeholder="Ej.: Elaborar fermentación · Comprar en mercado · Hornear tanda"
              className={field}
            />
          </label>
          <label className={`block text-[10px] ${isClaude ? "text-c5s-muted" : "text-muted"}`}>
            Unidad de medida (cantidad y mínimo van en esta unidad)
            <select value={row.unit} onChange={(e) => upd(i, { unit: e.target.value })} className={field}>
              {PANTRY_UNITS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <label className={`block text-[10px] ${isClaude ? "text-c5s-muted" : "text-muted"}`}>
              Cant. inicial
              <input
                type="number"
                min={0}
                step={0.01}
                value={row.initial_qty}
                onChange={(e) => upd(i, { initial_qty: e.target.value })}
                className={fieldSm}
              />
            </label>
            <label className={`block text-[10px] ${isClaude ? "text-c5s-muted" : "text-muted"}`}>
              Mínimo (alerta)
              <input
                type="number"
                min={0}
                step={0.01}
                value={row.reorder_below}
                onChange={(e) => upd(i, { reorder_below: e.target.value })}
                className={fieldSm}
              />
            </label>
            <label className={`block text-[10px] ${isClaude ? "text-c5s-muted" : "text-muted"}`}>
              Prioridad 1–5 (1 = más urgente al reponer)
              <input
                type="number"
                min={1}
                max={5}
                step={1}
                value={row.priority}
                onChange={(e) => upd(i, { priority: e.target.value })}
                className={fieldSm}
              />
            </label>
          </div>
        </div>
      ))}
      <button type="button" onClick={add} className={`text-xs font-medium ${isClaude ? "text-c5s-accent hover:underline" : "text-accent hover:underline"}`}>
        + Agregar insumo
      </button>
    </div>
  );
}

const WIZARD_STEPS = 8;

type WizardProps = {
  categories: CategoryRow[];
  onCancel: () => void;
  onDone: (projectId: string) => void;
  /** `claude`: canvas Pampas + acento Crail (diseño 5S Integration). `dark`: tema panel McKenna. */
  appearance?: WizardAppearance;
};

export function CincoSRoutineWizard({ categories, onCancel, onDone, appearance = "claude" }: WizardProps) {
  const suggest = useSuggestCincoSRoutine();
  const create = useCreateCincoSRoutine();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [customTag, setCustomTag] = useState("");
  const [scheduleFreq, setScheduleFreq] = useState<"Diaria" | "Semanal" | "Mensual">("Diaria");
  const [scheduleTime, setScheduleTime] = useState("07:00");
  const [supplies, setSupplies] = useState<SupplyDraft[]>(() => [emptySupply()]);
  const [tasks, setTasks] = useState<string[]>(["", ""]);
  const [preflightBlock, setPreflightBlock] = useState("");
  const [ritual, setRitual] = useState("");
  const [materialsText, setMaterialsText] = useState("");
  const [recipeNotes, setRecipeNotes] = useState("");
  const [postflightBlock, setPostflightBlock] = useState(
    "Registrar consumos y ajustar inventario\nEstandarizar: dejar checklist listo para el próximo uso\nDisciplina: confirmar área ordenada",
  );
  const [shoppingTrigger, setShoppingTrigger] = useState("");
  const [hugoDesc, setHugoDesc] = useState("");
  const [catOverride, setCatOverride] = useState("");
  const [saveTpl, setSaveTpl] = useState(true);
  const [suggestMsg, setSuggestMsg] = useState("");
  const [lastSuggestion, setLastSuggestion] = useState<SuggestRoutineResponse["suggestion"]>(null);

  const tagList = useMemo(() => {
    const t = [...picked].map((x) => x.trim()).filter(Boolean);
    if (customTag.trim()) t.push(customTag.trim());
    return t;
  }, [picked, customTag]);

  const toggleChip = (id: string) => {
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const namedSupplies = useMemo(
    () => supplies.map((s) => s.name.trim()).filter(Boolean),
    [supplies],
  );

  const canNext = () => {
    if (step === 0) return name.trim().length >= 2 && tagList.length >= 1;
    if (step === 1) return preflightBlock.split("\n").some((l) => l.trim());
    if (step === 2) return tasks.some((t) => t.trim());
    if (step === 3) return namedSupplies.length >= 1 || tasks.some((t) => t.trim());
    if (step === 4) return true;
    if (step === 5) return postflightBlock.split("\n").some((l) => l.trim());
    if (step === 6) return true;
    if (step === 7) {
      const hasTasks = tasks.some((t) => t.trim());
      return Boolean(name.trim()) && (namedSupplies.length >= 1 || hasTasks);
    }
    return false;
  };

  const runSuggest = async () => {
    setSuggestMsg("");
    const desc = hugoDesc.trim();
    if (!desc) {
      setSuggestMsg("Escribí al menos una frase sobre la rutina.");
      return;
    }
    try {
      const res = await suggest.mutateAsync({
        description: desc,
        hints: {
          nombre: name.trim(),
          patrones_elegidos: tagList,
          insumos_borrador: supplies.filter((s) => s.name.trim()).map((s) => ({
            nombre: s.name.trim(),
            preparacion: s.prep_action.trim(),
          })),
          tareas_borrador: tasks.filter(Boolean),
        },
      });
      if (!res.ok || !res.suggestion) {
        setSuggestMsg(res.error || "Sin sugerencia");
        return;
      }
      setLastSuggestion(res.suggestion);
      applySuggestionFromResult(res.suggestion);
      setSuggestMsg("Hugo completó un borrador. Revisá el último paso o volvé atrás para afinar insumos y tareas.");
    } catch (e) {
      setSuggestMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const applySuggestionFromResult = (su: NonNullable<SuggestRoutineResponse["suggestion"]>) => {
    if (su.tags?.length) {
      const known = new Set(PATTERN_CHIPS.map((c) => c.id.toLowerCase()));
      const lower = su.tags.map((x) => String(x).toLowerCase());
      const fromPat = lower.filter((x) => known.has(x));
      const rest = su.tags.filter((_, i) => !known.has(lower[i] ?? ""));
      setPicked(new Set(fromPat));
      if (rest.length) setCustomTag(rest.map((x) => String(x).trim()).join(", "));
    }
    if (su.preflight?.length) {
      const lines = su.preflight.map((x) => String(x));
      setPreflightBlock(lines.join("\n"));
    }
    if (su.tasks?.length) setTasks(su.tasks.map((x) => String(x)));
    if (su.ritual_notes) setRitual(su.ritual_notes);
  };

  const finish = async () => {
    const supPayload: SupplyCreatePayload[] = supplies
      .filter((s) => s.name.trim())
      .map((s) => ({
        name: s.name.trim(),
        prep_action: s.prep_action.trim(),
        initial_qty: Math.max(0, Number.parseFloat(s.initial_qty) || 1),
        reorder_below: Math.max(0, Number.parseFloat(s.reorder_below) || 0.25),
        priority: Math.min(5, Math.max(1, Math.round(Number.parseFloat(s.priority) || 3))),
        unit: (s.unit || "ud").trim() || "ud",
      }));
    const preflightLines = preflightBlock
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const postflightLines = postflightBlock
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const weekdaysAll = [1, 2, 3, 4, 5, 6, 0];
    const weekdaysWeek = [1, 2, 3, 4, 5];
    const sch: ScheduleItem = {
      id: `sch-${crypto.randomUUID().slice(0, 8)}`,
      title: scheduleFreq,
      time_local: scheduleTime || "07:00",
      weekdays: scheduleFreq === "Diaria" ? weekdaysAll : scheduleFreq === "Semanal" ? weekdaysWeek : [],
      sound_url: "",
    };
    const ritualMerged = [ritual.trim(), shoppingTrigger.trim() ? `Shopping trigger: ${shoppingTrigger.trim()}` : ""]
      .filter(Boolean)
      .join("\n");
    const body = {
      name: name.trim(),
      tags: tagList,
      preflight: preflightLines,
      postflight: postflightLines,
      tasks: tasks.map((x) => x.trim()).filter(Boolean),
      ritual_notes: ritualMerged,
      recipe_notes: recipeNotes.trim(),
      materials: materialsText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((line) => {
          const m = line.match(/^(.+?)\s*[:|-]\s*([\d.]+)\s*([A-Za-záéíóúñ/%]+)?$/i);
          if (!m) return { name: line, qty: 1, unit: "ud", consumption_per_run: 1 };
          return {
            name: m[1].trim(),
            qty: Math.max(0, Number.parseFloat(m[2]) || 1),
            unit: (m[3] || "ud").trim().toLowerCase(),
            consumption_per_run: 1,
          };
        }),
      category_id: catOverride.trim() || undefined,
      also_save_template: saveTpl,
      schedules: [sch],
      ...(supPayload.length ? { supplies: supPayload } : {}),
    };
    try {
      const res = await create.mutateAsync(body);
      onDone(res.project.id);
    } catch {
      /* error UI via create.isError */
    }
  };

  const labels = [
    "Configuración (nombre, área y frecuencia)",
    "Pre-flight (Seiri · Seiton · Seiso)",
    "Core-process (pasos técnicos)",
    "Inventario / despensa",
    "Materiales y protocolo",
    "Post-flight + disparador de compras",
    "Hugo (opcional)",
    "Revisar y crear",
  ];

  const v = appearance === "claude";
  const shell = v ? "mx-auto max-w-2xl space-y-6 pb-20 pt-2 text-c5s-ink" : "mx-auto max-w-2xl space-y-6 pb-20 pt-2";
  const card = v
    ? "rounded-2xl border border-c5s-line bg-c5s-panel p-6 shadow-sm"
    : "rounded-2xl border border-border bg-surface-panel p-6 shadow-sm";
  const cardSpace = v
    ? "space-y-4 rounded-2xl border border-c5s-line bg-c5s-panel p-6 shadow-sm"
    : "space-y-4 rounded-2xl border border-border bg-surface-panel p-6 shadow-sm";
  const muted = v ? "text-c5s-muted" : "text-muted";
  const lab = `block text-xs ${muted}`;
  const inp = v
    ? "mt-2 w-full rounded-xl border border-c5s-line bg-white px-4 py-3 text-base text-c5s-ink shadow-sm placeholder:text-c5s-muted/60"
    : "mt-2 w-full rounded-xl border border-border bg-surface-hover px-4 py-3 text-base text-ink";
  const sel = v
    ? "mt-2 w-full rounded-lg border border-c5s-line bg-white px-3 py-2 text-sm text-c5s-ink shadow-sm"
    : "mt-2 w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm";
  const taMono = v
    ? "w-full rounded-xl border border-c5s-line bg-white p-3 font-mono text-xs text-c5s-ink shadow-sm"
    : "w-full rounded-xl border border-border bg-surface-hover p-3 font-mono text-xs text-ink";
  const taSm = v
    ? "mt-2 w-full rounded-lg border border-c5s-line bg-white p-2 font-mono text-xs text-c5s-ink shadow-sm"
    : "mt-2 w-full rounded-lg border border-border bg-surface-hover p-2 font-mono text-xs text-ink";
  const taBody = v
    ? "mt-2 w-full rounded-lg border border-c5s-line bg-white p-2 text-sm text-c5s-ink shadow-sm"
    : "mt-2 w-full rounded-lg border border-border bg-surface-hover p-2 text-sm text-ink";
  const taHugo = v
    ? "w-full rounded-xl border border-c5s-line bg-white p-3 text-sm text-c5s-ink shadow-sm"
    : "w-full rounded-xl border border-border bg-surface-hover p-3 text-sm text-ink";
  const chipOn = v ? "border-c5s-accent bg-c5s-accent-soft text-c5s-accent" : "border-accent bg-accent/20 text-accent";
  const chipOff = v
    ? "border-c5s-line bg-white text-c5s-ink hover:border-c5s-accent/40"
    : "border-border bg-surface-hover text-ink-secondary hover:border-accent/40";
  const titleStep = v ? "text-center text-sm font-medium text-c5s-accent" : "text-center text-sm font-medium text-accent";
  const navBack = v ? "text-xs text-c5s-muted hover:text-c5s-ink" : "text-xs text-muted hover:text-ink-secondary";
  const btnGhost = v
    ? "rounded-xl border border-c5s-line bg-white px-4 py-2 text-xs font-medium text-c5s-ink shadow-sm hover:bg-c5s-canvas disabled:opacity-30"
    : "rounded-xl border border-border px-4 py-2 text-xs text-ink-secondary disabled:opacity-30";
  const btnPrimary = v
    ? "rounded-xl bg-c5s-accent px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-c5s-accent-hover disabled:opacity-40"
    : "rounded-xl bg-accent px-5 py-2 text-xs font-semibold text-white disabled:opacity-40";
  const bodySm = v ? "text-sm text-c5s-ink" : "text-sm text-ink-secondary";
  const checkLab = v ? "flex cursor-pointer items-start gap-2 text-xs text-c5s-ink" : "flex cursor-pointer items-start gap-2 text-xs text-ink-secondary";
  const summaryBox = v
    ? "rounded-lg border border-c5s-line bg-c5s-canvas/80 p-3 text-xs text-c5s-muted"
    : "rounded-lg border border-border bg-surface-hover/50 p-3 text-xs text-muted";
  const summaryStrong = v ? "font-medium text-c5s-ink" : "font-medium text-ink-secondary";
  const accentStrong = v ? "text-c5s-accent" : "text-accent";
  const err = v ? "text-xs text-red-600" : "text-xs text-danger";

  return (
    <div className={shell}>
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={onCancel} className={navBack}>
          ← Volver al inicio
        </button>
        <span className={`text-[10px] uppercase tracking-wide ${muted}`}>
          Paso {step + 1}/{WIZARD_STEPS}
        </span>
      </div>

      <StepDots step={step} total={WIZARD_STEPS} appearance={appearance} />
      <p className={titleStep}>{labels[step]}</p>

      {step === 0 && (
        <div className={`space-y-4 ${card}`}>
          <label className={lab}>
            Nombre de la rutina
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              placeholder="Ej.: Desayuno fitness · Cierre de caja · Setup CNC"
              className={inp}
            />
          </label>
          <label className={lab}>
            Área (opcional; si no elegís, inferimos por patrones)
            <select value={catOverride} onChange={(e) => setCatOverride(e.target.value)} className={sel}>
              <option value="">Inferir por patrones</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.name}
                </option>
              ))}
            </select>
          </label>
          <div>
            <p className={`text-xs ${muted}`}>Patrones (al menos uno)</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {PATTERN_CHIPS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleChip(c.id)}
                  title={c.hint}
                  className={`rounded-full border px-3 py-2 text-xs font-medium transition ${
                    picked.has(c.id) ? chipOn : chipOff
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <label className={`mt-3 ${lab}`}>
              Palabra clave propia (opcional)
              <input
                value={customTag}
                onChange={(e) => setCustomTag(e.target.value)}
                placeholder="Ej.: fin de mes · turno noche"
                className={sel}
              />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={lab}>
              Frecuencia
              <select
                value={scheduleFreq}
                onChange={(e) => setScheduleFreq(e.target.value as typeof scheduleFreq)}
                className={sel}
              >
                <option>Diaria</option>
                <option>Semanal</option>
                <option>Mensual</option>
              </select>
            </label>
            <label className={lab}>
              Hora habitual
              <input type="time" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} className={sel} />
            </label>
          </div>
          <StepExample
            appearance={appearance}
            title="Ejemplo"
            lines={["Desayuno fitness / Alimentación · Diaria 06:30.", "Cierre de caja / Finanzas · Semanal viernes 18:00."]}
          />
        </div>
      )}

      {step === 1 && (
        <div className={card}>
          <p className={`mb-2 text-xs ${muted}`}>
            Condiciones iniciales (Seiri · Seiton · Seiso). Una por línea; se convierten en checks antes del core.
          </p>
          <textarea
            value={preflightBlock}
            onChange={(e) => setPreflightBlock(e.target.value)}
            rows={6}
            placeholder={"Mesa de trabajo despejada\nHerramientas a la mano\nSuperficie desinfectada"}
            className={taMono}
          />
          <StepExample
            appearance={appearance}
            title="Ejemplo alimentación"
            lines={["Cocina limpia", "Vajilla disponible", "Ingredientes en mise en place"]}
          />
        </div>
      )}

      {step === 2 && (
        <div className={card}>
          <ListEditor
            appearance={appearance}
            label="Core-process (pasos técnicos del dominio)"
            hint="Alimentación: mise en place → cocción → servicio. Taller: setup → mecanizado → control. Finanzas: datos → cálculo → registro/pago."
            rows={tasks}
            setRows={setTasks}
            placeholder="Ej.: Mise en place · Cocción · Emplatado"
          />
        </div>
      )}

      {step === 3 && (
        <div className={card}>
          <h3 className={`text-sm font-semibold ${v ? "text-c5s-ink" : "text-ink"}`}>Inventario / despensa</h3>
          <SuppliesEditor appearance={appearance} rows={supplies} setRows={setSupplies} />
          <StepExample
            appearance={appearance}
            title="Ejemplo"
            lines={["Huevos: mínimo 6 ud antes de reponer.", "Avena: agregar a compras si queda &lt; 1 kg (usá el disparador en el siguiente bloque)."]}
          />
        </div>
      )}

      {step === 4 && (
        <div className={cardSpace}>
          <label className={lab}>
            Materiales (uno por línea: Nombre: cantidad unidad)
            <textarea
              value={materialsText}
              onChange={(e) => setMaterialsText(e.target.value)}
              rows={3}
              placeholder={"Sartén antiadherente: 1 ud\nBáscula gramera: 1 ud"}
              className={taSm}
            />
          </label>
          <label className={lab}>
            Protocolo / receta / procedimiento (texto de referencia)
            <textarea
              value={recipeNotes}
              onChange={(e) => setRecipeNotes(e.target.value)}
              rows={4}
              placeholder="Pasos estándar, HACCP, tolerancias, checklist de calidad…"
              className={taBody}
            />
          </label>
        </div>
      )}

      {step === 5 && (
        <div className={cardSpace}>
          <p className={`text-xs ${muted}`}>
            Post-flight (Seiketsu · Shitsuke): cierre y sostenibilidad. Una por línea; se ejecutan al final, después del core.
          </p>
          <textarea
            value={postflightBlock}
            onChange={(e) => setPostflightBlock(e.target.value)}
            rows={5}
            className={taMono}
          />
          <label className={lab}>
            Shopping trigger (regla o recordatorio para reponer)
            <textarea
              value={shoppingTrigger}
              onChange={(e) => setShoppingTrigger(e.target.value)}
              rows={2}
              placeholder='Ej.: "Añadir a compras si queda &lt; 1 kg de avena"'
              className={taBody}
            />
          </label>
          <label className={lab}>
            Nota del hábito / ritual (opcional)
            <textarea value={ritual} onChange={(e) => setRitual(e.target.value)} rows={2} className={taBody} />
          </label>
        </div>
      )}

      {step === 6 && (
        <div className={cardSpace}>
          <p className={bodySm}>Opcional: pedile a Hugo un borrador de pre-flight y core-process a partir de tu descripción.</p>
          <textarea
            value={hugoDesc}
            onChange={(e) => setHugoDesc(e.target.value)}
            rows={5}
            placeholder="Ej.: Rutina de desayuno en cocina chica, sin horno, dos adultos…"
            className={taHugo}
          />
          <button
            type="button"
            onClick={() => void runSuggest()}
            disabled={suggest.isPending}
            className={
              v
                ? "w-full rounded-xl bg-c5s-accent py-3 text-sm font-semibold text-white shadow-sm hover:bg-c5s-accent-hover disabled:opacity-50"
                : "w-full rounded-xl bg-accent py-3 text-sm font-semibold text-white disabled:opacity-50"
            }
          >
            {suggest.isPending ? "Hugo está pensando…" : "Pedir sugerencias a Hugo"}
          </button>
          {suggestMsg && <p className={`text-xs ${muted}`}>{suggestMsg}</p>}
          {lastSuggestion && (
            <button
              type="button"
              onClick={() => applySuggestionFromResult(lastSuggestion)}
              className={`text-xs font-medium ${v ? "text-c5s-accent hover:underline" : "text-accent hover:underline"}`}
            >
              Reaplicar última sugerencia
            </button>
          )}
          <p className={`text-[10px] ${muted}`}>Podés saltar este paso con &quot;Siguiente&quot;.</p>
        </div>
      )}

      {step === 7 && (
        <div className={cardSpace}>
          <label className={checkLab}>
            <input
              type="checkbox"
              checked={saveTpl}
              onChange={(e) => setSaveTpl(e.target.checked)}
              className={v ? "mt-1 rounded border-c5s-line" : "mt-1 rounded border-border"}
            />
            <span>
              Guardar también como <strong className={accentStrong}>plantilla &quot;Patrón: …&quot;</strong>
            </span>
          </label>
          <div className={summaryBox}>
            <p className={summaryStrong}>Resumen</p>
            <p className="mt-1">Nombre: {name.trim() || "—"}</p>
            <p>Área: {catOverride ? categories.find((c) => c.id === catOverride)?.name ?? catOverride : "Inferida"}</p>
            <p>Patrones: {tagList.join(", ") || "—"}</p>
            <p>
              Frecuencia: {scheduleFreq} · {scheduleTime}
            </p>
            <p>Pre-flight: {preflightBlock.split("\n").filter((l) => l.trim()).length} ítems</p>
            <p>Core: {tasks.filter(Boolean).length} pasos</p>
            <p>Despensa: {namedSupplies.length} insumos</p>
            <p>Post-flight: {postflightBlock.split("\n").filter((l) => l.trim()).length} ítems</p>
          </div>
          {create.isError && <p className={err}>{(create.error as Error)?.message ?? "Error al crear"}</p>}
          <button
            type="button"
            onClick={() => void finish()}
            disabled={create.isPending || !canNext()}
            className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-40"
          >
            {create.isPending ? "Creando…" : "Crear rutina"}
          </button>
        </div>
      )}

      <div className="flex justify-between gap-2">
        <button type="button" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))} className={btnGhost}>
          Atrás
        </button>
        {step < WIZARD_STEPS - 1 ? (
          <button type="button" disabled={!canNext()} onClick={() => setStep((s) => Math.min(WIZARD_STEPS - 1, s + 1))} className={btnPrimary}>
            Siguiente
          </button>
        ) : null}
      </div>
    </div>
  );
}
