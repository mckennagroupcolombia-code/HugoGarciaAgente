import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { alternateMutatingApiUrl, api, resolvePanelApiUrl } from "../api/client";
import { useAuthStore } from "../stores/auth";

export type TaskStatus = "pending" | "in_progress" | "done" | "blocked";

export interface PreflightItem {
  id: string;
  label: string;
  done: boolean;
  assignee: string;
}

export interface TaskItem {
  id: string;
  title: string;
  status: TaskStatus;
  assignee: string;
  blocked_reason: string;
  order: number;
  /** prep = antes de la rutina o reposición; main = flujo principal */
  scope?: "prep" | "main";
  linked_pantry_id?: string;
}

export interface MaterialItem {
  id: string;
  name: string;
  qty: number;
  unit: string;
}

export interface PantryItem {
  id: string;
  name: string;
  qty: number;
  unit: string;
  reorder_below: number;
  /** Qué implica tenerlo listo (elaborar, comprar, etc.) */
  prep_notes?: string;
}

export interface ScheduleItem {
  id: string;
  title: string;
  time_local: string;
  weekdays: number[];
  sound_url: string;
}

export interface CategoryRow {
  id: string;
  name: string;
  icon: string;
}

export interface TemplateRow {
  id: string;
  category_id: string;
  name: string;
  preflight_steps: { label: string; assignee?: string }[];
  tasks: { title: string; assignee?: string }[];
  ritual_notes: string;
}

export interface ProjectRow {
  id: string;
  category_id: string;
  template_id?: string;
  tags?: string[];
  name: string;
  created_at: string;
  updated_at: string;
  preflight: PreflightItem[];
  tasks: TaskItem[];
  materials: MaterialItem[];
  pantry: PantryItem[];
  recipe_notes: string;
  schedules: ScheduleItem[];
  ritual_notes: string;
}

export interface CincoSWorkspace {
  version: number;
  updated_at: string;
  categories: CategoryRow[];
  templates: TemplateRow[];
  projects: ProjectRow[];
}

const KEY = ["cinco-s", "workspace"] as const;

export function useCincoSWorkspace() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api.get<CincoSWorkspace>("/api/5s/workspace"),
    staleTime: 120_000,
    retry: (n, err) => {
      const msg = (err as Error)?.message ?? "";
      if (/HTTP 4\d\d/.test(msg) || /No autorizado/i.test(msg)) return false;
      return n < 1;
    },
  });
}

export function useSaveCincoSWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CincoSWorkspace) =>
      api.put<CincoSWorkspace>("/api/5s/workspace", body),
    onSuccess: (data) => {
      qc.setQueryData(KEY, data);
    },
  });
}

export type SupplyCreatePayload = {
  name: string;
  prep_action: string;
  initial_qty: number;
  reorder_below: number;
  /** 1 = más urgente en alertas de reposición */
  priority: number;
  /** g, kg, ml, L, ud, porción, servicio, … */
  unit?: string;
};

export type RoutineCreatePayload = {
  name: string;
  tags: string[];
  preflight: string[];
  tasks: string[];
  ritual_notes: string;
  category_id?: string;
  also_save_template: boolean;
  supplies?: SupplyCreatePayload[];
};

export type SuggestRoutineResponse = {
  ok: boolean;
  suggestion: {
    tags: string[];
    preflight: string[];
    tasks: string[];
    ritual_notes: string;
  } | null;
  error: string;
};

const SUGGEST_ROUTINE_TIMEOUT_MS = 125_000;

export function useSuggestCincoSRoutine() {
  return useMutation({
    mutationFn: (body: { description: string; hints?: Record<string, unknown> }) =>
      api.post<SuggestRoutineResponse>("/api/5s/suggest-routine", body, {
        timeoutMs: SUGGEST_ROUTINE_TIMEOUT_MS,
      }),
  });
}

export function useCreateCincoSRoutine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RoutineCreatePayload) =>
      api.post<{ project: ProjectRow; workspace: CincoSWorkspace }>(
        "/api/5s/project/routine",
        body,
      ),
    onSuccess: (data) => {
      qc.setQueryData(KEY, data.workspace);
    },
  });
}

export function useCreateCincoSProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { template_id: string; name: string; category_id?: string }) => {
      const body: Record<string, string> = {
        template_id: p.template_id,
        name: p.name,
      };
      if (p.category_id?.trim()) body.category_id = p.category_id.trim();
      return api.post<{ project: ProjectRow; workspace: CincoSWorkspace }>(
        "/api/5s/project",
        body,
      );
    },
    onSuccess: (data) => {
      qc.setQueryData(KEY, data.workspace);
    },
  });
}

const ASSISTANT_TIMEOUT_MS = 240_000;

export function useCincoSAssistant() {
  return useMutation({
    mutationFn: (p: { message: string; context: Record<string, unknown> | null }) =>
      api.post<{ ok: boolean; reply: string; error: string; provider?: string }>(
        "/api/5s/assistant",
        p,
        { timeoutMs: ASSISTANT_TIMEOUT_MS },
      ),
  });
}

/** Subida multipart .wav → URL relativa `/api/5s/audio/....wav` */
export async function uploadCincoSWav(file: File): Promise<string> {
  const token = useAuthStore.getState().token;
  const apiPath = "/api/5s/audio";
  const origin = window.location.origin;
  let url = resolvePanelApiUrl(apiPath, "POST");
  const headers: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : {};
  const mkFd = () => {
    const fd = new FormData();
    fd.append("file", file);
    return fd;
  };
  let res = await fetch(url, {
    method: "POST",
    headers,
    body: mkFd(),
  });
  if (res.status === 405) {
    const alt = alternateMutatingApiUrl(url, apiPath, "POST", origin);
    if (alt) {
      url = alt;
      res = await fetch(url, {
        method: "POST",
        headers,
        body: mkFd(),
      });
    }
  }
  if (res.status === 401) {
    useAuthStore.getState().clear();
    throw new Error("No autorizado");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  const j = (await res.json()) as { url: string };
  if (!j.url) throw new Error("Respuesta sin URL");
  return j.url;
}

export function useDeleteCincoSProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ workspace: CincoSWorkspace }>(
        `/api/5s/project/${encodeURIComponent(id)}/delete`,
        {},
      ),
    onSuccess: (d) => {
      qc.setQueryData(KEY, d.workspace);
    },
  });
}

export function useDeleteCincoSTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ workspace: CincoSWorkspace }>(
        `/api/5s/template/${encodeURIComponent(id)}/delete`,
        {},
      ),
    onSuccess: (d) => {
      qc.setQueryData(KEY, d.workspace);
      void qc.invalidateQueries({ queryKey: KEY });
    },
  });
}

export type TemplateSavePayload = {
  name: string;
  category_id: string;
  ritual_notes: string;
  preflight_steps: { label: string; assignee?: string }[];
  tasks: { title: string; assignee?: string }[];
};

export function useReplaceCincoSTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { id: string; body: TemplateSavePayload }) =>
      api.put<{ workspace: CincoSWorkspace }>(
        `/api/5s/template/${encodeURIComponent(p.id)}`,
        p.body,
      ),
    onSuccess: (d) => {
      qc.setQueryData(KEY, d.workspace);
    },
  });
}

export function useCreateCincoSTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TemplateSavePayload & { id?: string }) =>
      api.post<{ workspace: CincoSWorkspace }>("/api/5s/template", body),
    onSuccess: (d) => {
      qc.setQueryData(KEY, d.workspace);
    },
  });
}
