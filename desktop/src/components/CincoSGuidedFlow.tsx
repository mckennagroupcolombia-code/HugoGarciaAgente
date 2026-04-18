import { useMemo, useState, type ReactNode } from "react";
import type { CategoryRow, SupplyCreatePayload, SuggestRoutineResponse } from "../hooks/useCincoS";
import { useCreateCincoSRoutine, useSuggestCincoSRoutine } from "../hooks/useCincoS";

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
        <h2 className="mt-2 text-2xl font-bold tracking-tight text-gray-100">Tu espacio de trabajo</h2>
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
          className="rounded-2xl border border-border bg-surface-panel px-6 py-4 text-left text-sm font-medium text-gray-100 transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span className="block text-base">Mis tableros</span>
          <span className="mt-1 block text-xs font-normal text-muted">
            {hasProjects ? "Kanban, logística y agendas" : "Creá la primera rutina arriba"}
          </span>
        </button>

        <button
          type="button"
          onClick={onHugo}
          className="rounded-2xl border border-border bg-surface-panel px-6 py-4 text-left text-sm font-medium text-gray-100 transition hover:bg-surface-hover"
        >
          <span className="block text-base">Hablar con Hugo</span>
          <span className="mt-1 block text-xs font-normal text-muted">
            Consultas 5S sobre el tablero abierto (Ollama / Gemini según servidor)
          </span>
        </button>
      </div>

      <details className="rounded-xl border border-border bg-surface-panel p-4">
        <summary className="cursor-pointer text-sm font-medium text-gray-200">
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

function StepDots({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex justify-center gap-2" role="status" aria-label={`Paso ${step + 1} de ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`h-2 w-2 rounded-full ${i === step ? "bg-accent" : i < step ? "bg-accent/40" : "bg-border"}`}
        />
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
}: {
  label: string;
  hint: string;
  rows: string[];
  setRows: (v: string[]) => void;
  placeholder: string;
}) {
  const update = (i: number, v: string) => {
    const next = [...rows];
    next[i] = v;
    setRows(next);
  };
  const add = () => setRows([...rows, ""]);
  const del = (i: number) => setRows(rows.filter((_, j) => j !== i));

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-gray-100">{label}</p>
        <p className="text-xs text-muted">{hint}</p>
      </div>
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex gap-2">
            <input
              value={row}
              onChange={(e) => update(i, e.target.value)}
              placeholder={placeholder}
              className="min-w-0 flex-1 rounded-lg border border-border bg-surface-hover px-3 py-2.5 text-sm text-gray-100"
            />
            <button
              type="button"
              onClick={() => del(i)}
              disabled={rows.length <= 1}
              className="shrink-0 rounded-lg border border-border px-3 text-xs text-muted hover:bg-surface-hover disabled:opacity-30"
            >
              Quitar
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={add} className="text-xs font-medium text-accent hover:underline">
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
}: {
  rows: SupplyDraft[];
  setRows: (v: SupplyDraft[]) => void;
}) {
  const upd = (i: number, patch: Partial<SupplyDraft>) => {
    const next = [...rows];
    next[i] = { ...next[i], ...patch };
    setRows(next);
  };
  const add = () => setRows([...rows, emptySupply()]);
  const del = (i: number) => setRows(rows.filter((_, j) => j !== i));

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-muted">
        Cada insumo vive en <strong className="text-gray-300">despensa</strong> con cantidad y mínimo: si queda bajo el
        mínimo, el tablero prioriza <strong className="text-gray-300">reponer</strong> y crea una tarea de reposición
        (con aviso por voz una vez al día). La columna &quot;Qué falta antes&quot; genera tareas de{" "}
        <strong className="text-gray-300">preparación</strong> (elaborar kefir, comprar fruta…){" "}
        <em>antes</em> del checklist de verificación. Si no usás despensa, dejá las filas vacías y cargá solo pasos en el
        siguiente paso.
      </p>
      {rows.map((row, i) => (
        <div key={i} className="space-y-2 rounded-xl border border-border bg-surface-hover/40 p-4">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => del(i)}
              disabled={rows.length <= 1}
              className="text-[10px] text-muted hover:text-danger disabled:opacity-30"
            >
              Quitar insumo
            </button>
          </div>
          <label className="block text-[11px] text-muted">
            Insumo
            <input
              value={row.name}
              onChange={(e) => upd(i, { name: e.target.value })}
              placeholder="Ej.: Kefir, Granola, Fruta, Suplementos"
              className="mt-1 w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm text-gray-100"
            />
          </label>
          <label className="block text-[11px] text-muted">
            Qué tenés que hacer antes para tenerlo listo
            <input
              value={row.prep_action}
              onChange={(e) => upd(i, { prep_action: e.target.value })}
              placeholder="Ej.: Elaborar fermentación · Comprar en mercado · Hornear tanda"
              className="mt-1 w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm text-gray-100"
            />
          </label>
          <label className="block text-[10px] text-muted">
            Unidad de medida (cantidad y mínimo van en esta unidad)
            <select
              value={row.unit}
              onChange={(e) => upd(i, { unit: e.target.value })}
              className="mt-1 w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm text-gray-100"
            >
              {PANTRY_UNITS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <label className="block text-[10px] text-muted">
              Cant. inicial
              <input
                type="number"
                min={0}
                step={0.01}
                value={row.initial_qty}
                onChange={(e) => upd(i, { initial_qty: e.target.value })}
                className="mt-1 w-full rounded border border-border bg-surface-hover px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block text-[10px] text-muted">
              Mínimo (alerta)
              <input
                type="number"
                min={0}
                step={0.01}
                value={row.reorder_below}
                onChange={(e) => upd(i, { reorder_below: e.target.value })}
                className="mt-1 w-full rounded border border-border bg-surface-hover px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block text-[10px] text-muted">
              Prioridad 1–5 (1 = más urgente al reponer)
              <input
                type="number"
                min={1}
                max={5}
                step={1}
                value={row.priority}
                onChange={(e) => upd(i, { priority: e.target.value })}
                className="mt-1 w-full rounded border border-border bg-surface-hover px-2 py-1.5 text-sm"
              />
            </label>
          </div>
        </div>
      ))}
      <button type="button" onClick={add} className="text-xs font-medium text-accent hover:underline">
        + Agregar insumo
      </button>
    </div>
  );
}

const WIZARD_STEPS = 6;

type WizardProps = {
  categories: CategoryRow[];
  onCancel: () => void;
  onDone: (projectId: string) => void;
};

export function CincoSRoutineWizard({ categories, onCancel, onDone }: WizardProps) {
  const suggest = useSuggestCincoSRoutine();
  const create = useCreateCincoSRoutine();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [customTag, setCustomTag] = useState("");
  const [supplies, setSupplies] = useState<SupplyDraft[]>(() => [emptySupply()]);
  const [tasks, setTasks] = useState<string[]>(["", ""]);
  const [extraPreflight, setExtraPreflight] = useState("");
  const [ritual, setRitual] = useState("");
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
    if (step === 0) return name.trim().length >= 2;
    if (step === 1) return tagList.length >= 1;
    if (step === 2) return true;
    if (step === 3) return namedSupplies.length >= 1 || tasks.some((t) => t.trim());
    if (step === 4) return true;
    if (step === 5) {
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
      setExtraPreflight(lines.join("\n"));
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
    const extras = extraPreflight
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const body = {
      name: name.trim(),
      tags: tagList,
      preflight: extras,
      tasks: tasks.map((x) => x.trim()).filter(Boolean),
      ritual_notes: ritual.trim(),
      category_id: catOverride.trim() || undefined,
      also_save_template: saveTpl,
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
    "Nombre de la rutina",
    "Patrones (área inferida)",
    "Insumos y despensa",
    "Pasos de la rutina",
    "Hugo (opcional)",
    "Revisar y crear",
  ];

  return (
    <div className="mx-auto max-w-lg space-y-6 pb-20 pt-2">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={onCancel} className="text-xs text-muted hover:text-gray-200">
          ← Volver al inicio
        </button>
        <span className="text-[10px] uppercase tracking-wide text-muted">
          Paso {step + 1}/{WIZARD_STEPS}
        </span>
      </div>

      <StepDots step={step} total={WIZARD_STEPS} />
      <p className="text-center text-sm font-medium text-accent">{labels[step]}</p>

      {step === 0 && (
        <div className="rounded-2xl border border-border bg-surface-panel p-6">
          <label className="block text-xs text-muted">
            ¿Cómo querés llamar a esta rutina?
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              placeholder="Ej.: Desayuno · Cierre de local · Paseo mañana"
              className="mt-2 w-full rounded-xl border border-border bg-surface-hover px-4 py-3 text-base text-gray-100"
            />
          </label>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4 rounded-2xl border border-border bg-surface-panel p-6">
          <p className="text-xs text-muted">
            Elegí uno o más patrones (no es obligatorio mapear todo a &quot;área&quot;; eso lo inferimos o lo afinás al
            final).
          </p>
          <div className="flex flex-wrap gap-2">
            {PATTERN_CHIPS.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => toggleChip(c.id)}
                title={c.hint}
                className={`rounded-full border px-3 py-2 text-xs font-medium transition ${
                  picked.has(c.id)
                    ? "border-accent bg-accent/20 text-accent"
                    : "border-border bg-surface-hover text-gray-200 hover:border-accent/40"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <label className="block text-xs text-muted">
            Palabra clave propia (opcional)
            <input
              value={customTag}
              onChange={(e) => setCustomTag(e.target.value)}
              placeholder="Ej.: proveedor X, frío, fin de mes"
              className="mt-2 w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm text-gray-100"
            />
          </label>
        </div>
      )}

      {step === 2 && (
        <div className="rounded-2xl border border-border bg-surface-panel p-6">
          <h3 className="text-sm font-semibold text-gray-100">¿Qué tenés listo antes de arrancar?</h3>
          <SuppliesEditor rows={supplies} setRows={setSupplies} />
        </div>
      )}

      {step === 3 && (
        <div className="rounded-2xl border border-border bg-surface-panel p-6">
          <ListEditor
            label="Pasos de la rutina (después de la despensa)"
            hint="Ej.: armar bowl, tomar suplementos, limpiar mesa. Si solo cargaste insumos, podés dejar una línea genérica."
            rows={tasks}
            setRows={setTasks}
            placeholder="Ej.: Servir desayuno · Limpiar mesa"
          />
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4 rounded-2xl border border-border bg-surface-panel p-6">
          <p className="text-sm text-gray-200">
            Describí en tus palabras qué hacés, dónde y con qué restricciones. Hugo devuelve un borrador de tags,
            tareas y notas (JSON; insumos los afinás en pasos anteriores).
          </p>
          <textarea
            value={hugoDesc}
            onChange={(e) => setHugoDesc(e.target.value)}
            rows={5}
            placeholder="Ej.: Los sábados cierro el local: apagar máquinas, basura, alarma y revisar que quede listo el lunes."
            className="w-full rounded-xl border border-border bg-surface-hover p-3 text-sm text-gray-100"
          />
          <button
            type="button"
            onClick={() => void runSuggest()}
            disabled={suggest.isPending}
            className="w-full rounded-xl bg-accent py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {suggest.isPending ? "Hugo está pensando…" : "Pedir sugerencias a Hugo"}
          </button>
          {suggestMsg && <p className="text-xs text-muted">{suggestMsg}</p>}
          {lastSuggestion && (
            <button
              type="button"
              onClick={() => applySuggestionFromResult(lastSuggestion)}
              className="text-xs font-medium text-accent hover:underline"
            >
              Reaplicar última sugerencia de Hugo
            </button>
          )}
          <p className="text-[10px] text-muted">Podés saltar este paso con &quot;Siguiente&quot;.</p>
        </div>
      )}

      {step === 5 && (
        <div className="space-y-4 rounded-2xl border border-border bg-surface-panel p-6">
          <label className="block text-xs text-muted">
            Otras condiciones (opcional, una por línea) — se suman al checklist de verificación
            <textarea
              value={extraPreflight}
              onChange={(e) => setExtraPreflight(e.target.value)}
              rows={2}
              placeholder="Ej.: Mesa despejada · Tupper listo"
              className="mt-2 w-full rounded-lg border border-border bg-surface-hover p-2 font-mono text-xs text-gray-100"
            />
          </label>
          <label className="block text-xs text-muted">
            Nota del ritual / hábito (visible en el tablero)
            <textarea
              value={ritual}
              onChange={(e) => setRitual(e.target.value)}
              rows={3}
              className="mt-2 w-full rounded-lg border border-border bg-surface-hover p-2 text-sm text-gray-100"
            />
          </label>
          <label className="block text-xs text-muted">
            Área del negocio (opcional; si no elegís, usamos los patrones)
            <select
              value={catOverride}
              onChange={(e) => setCatOverride(e.target.value)}
              className="mt-2 w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm"
            >
              <option value="">Inferir por patrones</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-xs text-gray-200">
            <input
              type="checkbox"
              checked={saveTpl}
              onChange={(e) => setSaveTpl(e.target.checked)}
              className="mt-1 rounded border-border"
            />
            <span>
              Guardar también como <strong className="text-accent">plantilla &quot;Patrón: …&quot;</strong> para
              reutilizar cuando reconozcamos actividades similares.
            </span>
          </label>
          <div className="rounded-lg border border-border bg-surface-hover/50 p-3 text-xs text-muted">
            <p className="font-medium text-gray-200">Resumen</p>
            <p className="mt-1">Nombre: {name.trim() || "—"}</p>
            <p>Patrones: {tagList.join(", ") || "—"}</p>
            <p>Insumos en despensa: {namedSupplies.length}</p>
            <p>Condiciones extra: {extraPreflight.split("\n").filter((l) => l.trim()).length}</p>
            <p>Pasos de rutina: {tasks.filter(Boolean).length}</p>
          </div>
          {create.isError && (
            <p className="text-xs text-danger">{(create.error as Error)?.message ?? "Error al crear"}</p>
          )}
          <button
            type="button"
            onClick={() => void finish()}
            disabled={create.isPending || !canNext()}
            className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white disabled:opacity-40"
          >
            {create.isPending ? "Creando tablero…" : "Crear tablero"}
          </button>
        </div>
      )}

      <div className="flex justify-between gap-2">
        <button
          type="button"
          disabled={step === 0}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          className="rounded-xl border border-border px-4 py-2 text-xs text-gray-200 disabled:opacity-30"
        >
          Atrás
        </button>
        {step < WIZARD_STEPS - 1 ? (
          <button
            type="button"
            disabled={!canNext()}
            onClick={() => setStep((s) => Math.min(WIZARD_STEPS - 1, s + 1))}
            className="rounded-xl bg-accent px-5 py-2 text-xs font-semibold text-white disabled:opacity-40"
          >
            Siguiente
          </button>
        ) : null}
      </div>
    </div>
  );
}
