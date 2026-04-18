import { useAuthStore } from "../stores/auth";

/**
 * Bajo `/app/…`, algunos proxies solo enrutan POST/PUT/DELETE bajo `/app/*`; GET a `/app/api/…`
 * a veces cae en `try_files` → HTML del SPA y `JSON.parse` falla. Por eso solo mutadores usan `/app/api`.
 */
export function resolvePanelApiUrl(
  path: string,
  method: string = "GET",
): string {
  if (typeof window === "undefined") {
    return path.startsWith("/") ? path : `/${path}`;
  }
  const { origin, pathname } = window.location;
  if (!path.startsWith("/")) {
    return new URL(path, `${origin}/`).toString();
  }
  const underPanel =
    pathname === "/app" ||
    pathname.startsWith("/app/") ||
    (import.meta.env.PROD &&
      (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "") === "/app" &&
      (pathname === "/" || pathname === ""));
  const m = method.toUpperCase();
  const mutating = m !== "GET" && m !== "HEAD";
  if (path.startsWith("/api/") && underPanel && mutating) {
    return `${origin}/app${path}`;
  }
  return `${origin}${path}`;
}

/** Si nginx bloquea POST en `/api` o en `/app/api`, reintentar con el otro prefijo (solo mutadores). */
export function alternateMutatingApiUrl(
  attemptedUrl: string,
  apiPath: string,
  method: string,
  origin: string,
): string | null {
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD") return null;
  if (!apiPath.startsWith("/api/")) return null;
  const withApp = `${origin}/app${apiPath}`;
  const plain = `${origin}${apiPath}`;
  if (attemptedUrl === withApp) return plain;
  if (attemptedUrl === plain) return withApp;
  return null;
}

async function request<T>(
  path: string,
  opts: RequestInit = {},
): Promise<T> {
  const token = useAuthStore.getState().token;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(opts.headers as Record<string, string> ?? {}),
  };

  const method = (opts.method ?? "GET").toString();
  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  let url = resolvePanelApiUrl(path, method);

  const fetchOpts: RequestInit = {
    ...opts,
    headers,
    signal: opts.signal,
  };
  let res = await fetch(url, fetchOpts);
  if (
    res.status === 405 &&
    typeof window !== "undefined" &&
    origin &&
    path.startsWith("/api/")
  ) {
    const alt = alternateMutatingApiUrl(url, path, method, origin);
    if (alt) {
      url = alt;
      res = await fetch(url, fetchOpts);
    }
  }

  if (res.status === 401) {
    useAuthStore.getState().clear();
    throw new Error("No autorizado");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || body.mensaje || `HTTP ${res.status}`);
  }
  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  if (!ct.includes("application/json")) {
    const preview = (await res.clone().text()).slice(0, 120).trim();
    throw new Error(
      preview.startsWith("<")
        ? "El servidor devolvió HTML en lugar de JSON (revisá proxy/nginx para /api o reiniciá Flask)."
        : preview
          ? `Respuesta no JSON (${ct || "sin Content-Type"}): ${preview}`
          : "Respuesta vacía o no JSON.",
    );
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown, options?: { timeoutMs?: number }) => {
    const init: RequestInit = {
      method: "POST",
      body: body != null ? JSON.stringify(body) : undefined,
    };
    const ms = options?.timeoutMs;
    if (ms && ms > 0) {
      const ctrl = new AbortController();
      const tid = window.setTimeout(() => ctrl.abort(), ms);
      return request<T>(path, { ...init, signal: ctrl.signal }).finally(() =>
        window.clearTimeout(tid),
      );
    }
    return request<T>(path, init);
  },
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "PUT",
      body: body != null ? JSON.stringify(body) : undefined,
    }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
