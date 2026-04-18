import type { PantryItem, ProjectRow, TaskItem } from "../hooks/useCincoS";

export type PrimerPasoKind =
  | "no_workspace"
  | "pick_project"
  | "pantry_low"
  | "prep_task"
  | "preflight"
  | "blocked"
  | "task_pending"
  | "task_in_progress"
  | "all_done";

export interface PrimerPaso {
  kind: PrimerPasoKind;
  /** Etapa 5S que enmarca mentalmente este paso */
  pillar: "Seiri" | "Seiton" | "Seiso" | "Seiketsu" | "Shitsuke";
  title: string;
  subtitle: string;
  preflightId?: string;
  taskId?: string;
  pantryId?: string;
}

const PILLAR_COPY: Record<PrimerPaso["pillar"], string> = {
  Seiri: "Clasificá: solo lo necesario en el espacio de trabajo.",
  Seiton: "Ordená: cada cosa en su puesto, visible y al alcance.",
  Seiso: "Limpiá: espacio listo revela fallas y mejora seguridad.",
  Seiketsu: "Estandarizá: repetí el ritual hasta que sea rutina.",
  Shitsuke: "Disciplina: constancia convierte el método en cultura.",
};

export function pillarHint(p: PrimerPaso["pillar"]): string {
  return PILLAR_COPY[p];
}

function isPrepTask(t: TaskItem): boolean {
  return t.scope === "prep";
}

function isMainTask(t: TaskItem): boolean {
  return t.scope !== "prep";
}

/** Más bajo = más crítico (menos stock vs mínimo). */
function pantryUrgency(it: PantryItem): number {
  if (it.reorder_below <= 0) return 999;
  return it.qty / Math.max(it.reorder_below, 1e-6);
}

function incompletePrepTasks(tks: TaskItem[]): TaskItem[] {
  return tks.filter(
    (t) =>
      isPrepTask(t) &&
      (t.status === "pending" || t.status === "in_progress" || t.status === "blocked"),
  );
}

function incompleteMainTasks(tks: TaskItem[]): TaskItem[] {
  return tks.filter(
    (t) =>
      isMainTask(t) &&
      (t.status === "pending" || t.status === "in_progress" || t.status === "blocked"),
  );
}

/**
 * Orden operativo: despensa bajo mínimo → preparación (tareas prep) → preflight (insumos listos) → tareas principales.
 */
export function computePrimerPaso(project: ProjectRow | null, projectCount: number): PrimerPaso {
  if (projectCount === 0) {
    return {
      kind: "no_workspace",
      pillar: "Seiri",
      title: "Empezá por un espacio de trabajo",
      subtitle:
        "Creá una rutina guiada (insumos + despensa) o desde plantilla. El tablero prioriza reposición y preparación.",
    };
  }
  if (!project) {
    return {
      kind: "pick_project",
      pillar: "Seiton",
      title: "Elegí un proyecto en la barra lateral",
      subtitle: "Ahí tenés tus tableros; los insumos con mínimo generan alertas de reposición.",
    };
  }

  const pantry = project.pantry ?? [];
  const lows = pantry.filter((it) => it.reorder_below > 0 && it.qty <= it.reorder_below);
  if (lows.length) {
    lows.sort((a, b) => pantryUrgency(a) - pantryUrgency(b));
    const it = lows[0];
    const notes = (it as PantryItem & { prep_notes?: string }).prep_notes?.trim();
    return {
      kind: "pantry_low",
      pillar: "Seiri",
      title: `Despensa: ${it.name} bajo mínimo`,
      subtitle: notes
        ? `Stock ${it.qty} ${it.unit} (mín. ${it.reorder_below}). Antes: ${notes}. Reponé o actualizá cantidad en Logística.`
        : `Stock ${it.qty} ${it.unit} (mínimo operativo ${it.reorder_below}). Reponé o actualizá cantidad en Logística → Despensa.`,
      pantryId: it.id,
    };
  }

  const tks = project.tasks ?? [];
  const prepOpen = incompletePrepTasks(tks);
  if (prepOpen.length) {
    prepOpen.sort((a, b) => a.order - b.order);
    const t = prepOpen[0];
    return {
      kind: "prep_task",
      pillar: "Seiton",
      title: "Preparación previa a la rutina",
      subtitle: t.title,
      taskId: t.id,
    };
  }

  const pre = project.preflight ?? [];
  const pf = pre.find((x) => !x.done);
  if (pf) {
    return {
      kind: "preflight",
      pillar: "Seiso",
      title: "Insumos listos (verificación)",
      subtitle: pf.label,
      preflightId: pf.id,
    };
  }

  const mains = incompleteMainTasks(tks);
  const blocked = mains.find((t) => t.status === "blocked");
  if (blocked) {
    return {
      kind: "blocked",
      pillar: "Seiri",
      title: "Desbloqueá antes de avanzar",
      subtitle: blocked.blocked_reason
        ? `${blocked.title} — ${blocked.blocked_reason}`
        : blocked.title,
      taskId: blocked.id,
    };
  }

  const pending = mains.find((t) => t.status === "pending");
  if (pending) {
    return {
      kind: "task_pending",
      pillar: "Seiton",
      title: "Siguiente tarea de la rutina",
      subtitle: pending.title,
      taskId: pending.id,
    };
  }

  const prog = mains.find((t) => t.status === "in_progress");
  if (prog) {
    return {
      kind: "task_in_progress",
      pillar: "Shitsuke",
      title: "Seguí con lo que ya abriste",
      subtitle: prog.title,
      taskId: prog.id,
    };
  }

  if (mains.length && mains.every((t) => t.status === "done")) {
    return {
      kind: "all_done",
      pillar: "Seiketsu",
      title: "Ciclo completo en este proyecto",
      subtitle: "Estandarizá lo que funcionó: revisá despensa y mínimos para la próxima corrida.",
    };
  }

  return {
    kind: "all_done",
    pillar: "Seiketsu",
    title: "Sin tareas pendientes en el tablero",
    subtitle: "Agregá tareas o insumos desde Logística.",
  };
}
