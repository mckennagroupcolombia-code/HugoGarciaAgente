import { useState } from "react";
import type { UseMutationResult } from "@tanstack/react-query";
import type { CategoryRow, CincoSWorkspace, TemplateRow, TemplateSavePayload } from "../hooks/useCincoS";

type DelM = UseMutationResult<{ workspace: CincoSWorkspace }, Error, string, unknown>;
type RepM = UseMutationResult<
  { workspace: CincoSWorkspace },
  Error,
  { id: string; body: TemplateSavePayload },
  unknown
>;
type CreM = UseMutationResult<
  { workspace: CincoSWorkspace },
  Error,
  TemplateSavePayload & { id?: string },
  unknown
>;

interface Props {
  categories: CategoryRow[];
  templates: TemplateRow[];
  replaceTpl: RepM;
  deleteTpl: DelM;
  createTpl: CreM;
}

function linesToPreflight(text: string): { label: string }[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((label) => ({ label }));
}

function linesToTasks(text: string): { title: string }[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((title) => ({ title }));
}

export default function CincoSTemplateManager({
  categories,
  templates,
  replaceTpl,
  deleteTpl,
  createTpl,
}: Props) {
  const [editing, setEditing] = useState<null | "new" | string>(null);
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [ritual, setRitual] = useState("");
  const [preflightText, setPreflightText] = useState("");
  const [tasksText, setTasksText] = useState("");

  const openNew = () => {
    setEditing("new");
    setName("");
    setCategoryId(categories[0]?.id ?? "");
    setRitual("");
    setPreflightText("");
    setTasksText("");
  };

  const openEdit = (t: TemplateRow) => {
    setEditing(t.id);
    setName(t.name);
    setCategoryId(t.category_id);
    setRitual(t.ritual_notes ?? "");
    setPreflightText((t.preflight_steps ?? []).map((p) => p.label).join("\n"));
    setTasksText((t.tasks ?? []).map((x) => x.title).join("\n"));
  };

  const close = () => setEditing(null);

  const buildPayload = (): TemplateSavePayload => ({
    name: name.trim(),
    category_id: categoryId,
    ritual_notes: ritual,
    preflight_steps: linesToPreflight(preflightText),
    tasks: linesToTasks(tasksText),
  });

  const save = async () => {
    const body = buildPayload();
    if (!body.name) return;
    if (editing === "new") {
      await createTpl.mutateAsync(body);
    } else if (editing) {
      await replaceTpl.mutateAsync({ id: editing, body });
    }
    close();
  };

  const remove = async (id: string) => {
    if (!window.confirm("¿Eliminar esta plantilla? Los tableros ya creados no se borran.")) return;
    try {
      await deleteTpl.mutateAsync(id);
      if (editing === id) close();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="rounded-xl border border-border bg-surface-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-ink">Plantillas</h3>
          <p className="mt-1 max-w-2xl text-xs text-muted">
            Modelos reutilizables al crear tableros. Editá nombre, área, checklist (una línea por ítem) y tareas (una por
            línea). Podés borrar plantillas que ya no uses.
          </p>
        </div>
        <button
          type="button"
          onClick={openNew}
          className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent"
        >
          + Nueva plantilla
        </button>
      </div>

      <ul className="mt-4 space-y-2">
        {templates.map((t) => (
          <li
            key={t.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-hover/40 px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{t.name}</p>
              <p className="text-[10px] text-muted">
                id <code className="text-ink-muted">{t.id}</code> · {t.preflight_steps?.length ?? 0} preflight ·{" "}
                {t.tasks?.length ?? 0} tareas
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => openEdit(t)}
                className="rounded border border-border px-2 py-1 text-xs text-ink-secondary hover:bg-surface-hover"
              >
                Editar
              </button>
              <button
                type="button"
                onClick={() => remove(t.id)}
                disabled={deleteTpl.isPending}
                className="rounded border border-danger/40 px-2 py-1 text-xs text-danger hover:bg-danger/10"
              >
                Eliminar
              </button>
            </div>
          </li>
        ))}
      </ul>

      {editing && (
        <div className="mt-5 space-y-3 rounded-xl border border-accent/30 bg-surface-hover/30 p-4">
          <p className="text-xs font-semibold text-accent">
            {editing === "new" ? "Nueva plantilla" : `Editar plantilla · ${editing}`}
          </p>
          <label className="block text-xs text-muted">
            Nombre
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm text-ink"
            />
          </label>
          <label className="block text-xs text-muted">
            Área por defecto
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-muted">
            Preflight — una línea por ítem
            <textarea
              value={preflightText}
              onChange={(e) => setPreflightText(e.target.value)}
              rows={4}
              className="mt-1 w-full rounded-lg border border-border bg-surface-hover p-2 font-mono text-xs"
            />
          </label>
          <label className="block text-xs text-muted">
            Tareas — una línea por título
            <textarea
              value={tasksText}
              onChange={(e) => setTasksText(e.target.value)}
              rows={4}
              className="mt-1 w-full rounded-lg border border-border bg-surface-hover p-2 font-mono text-xs"
            />
          </label>
          <label className="block text-xs text-muted">
            Notas del ritual / manual
            <textarea
              value={ritual}
              onChange={(e) => setRitual(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-border bg-surface-hover p-2 text-sm"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={replaceTpl.isPending || createTpl.isPending}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Guardar plantilla
            </button>
            <button type="button" onClick={close} className="rounded-lg border border-border px-4 py-2 text-sm">
              Cancelar
            </button>
          </div>
          {(replaceTpl.isError || createTpl.isError || deleteTpl.isError) && (
            <p className="text-xs text-danger">
              {(replaceTpl.error as Error)?.message ??
                (createTpl.error as Error)?.message ??
                (deleteTpl.error as Error)?.message}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
