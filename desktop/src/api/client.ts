import { useTicketsAuth } from "../stores/ticketsAuth";
import { useAuthStore } from "../stores/auth";

/**
 * Bajo `/app/…`, algunos proxies enrutan distinto `/api` vs `/app/api`.
 * Los mutadores prefieren `/app/api`; los GET empiezan en `/api` y reintentan si llega HTML.
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

/** URL alterna cuando el proxy devuelve HTML o 404 en el primer intento. */
export function alternatePanelApiUrl(
  attemptedUrl: string,
  apiPath: string,
  origin: string,
): string | null {
  if (!apiPath.startsWith("/api/")) return null;
  const withApp = `${origin}/app${apiPath}`;
  const plain = `${origin}${apiPath}`;
  if (attemptedUrl === withApp) return plain;
  if (attemptedUrl === plain) return withApp;
  return null;
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

/** Bearer para /api/* del panel: admins pueden usar CHAT_API_TOKEN; operarios usan JWT de tickets. */
function panelBearerToken(): string | null {
  const tickets = useTicketsAuth.getState();
  return tickets.apiToken || tickets.token || useAuthStore.getState().token || null;
}

async function request<T>(
  path: string,
  opts: RequestInit = {},
): Promise<T> {
  const token = panelBearerToken();
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
  let res: Response;
  try {
    res = await fetch(url, fetchOpts);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error("La solicitud tardó demasiado (timeout). Intente de nuevo.");
    }
    throw e;
  }
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

  const ctFirst = (res.headers.get("content-type") ?? "").toLowerCase();
  if (
    !ctFirst.includes("application/json") &&
    typeof window !== "undefined" &&
    origin &&
    path.startsWith("/api/")
  ) {
    const alt = alternatePanelApiUrl(url, path, origin);
    if (alt) {
      const retry = await fetch(alt, fetchOpts);
      const ctRetry = (retry.headers.get("content-type") ?? "").toLowerCase();
      if (ctRetry.includes("application/json") || retry.status !== res.status) {
        res = retry;
      }
    }
  }

  if (res.status === 401) {
    const tickets = useTicketsAuth.getState();
    if (path.startsWith("/api/tickets/")) {
      tickets.clear();
    } else if (!tickets.token) {
      // Login legacy solo con CHAT_API_TOKEN en authStore
      useAuthStore.getState().clear();
    }
    throw new Error(
      tickets.token
        ? "No autorizado para esta acción. Si acabas de cambiar permisos, cierra sesión y vuelve a entrar."
        : "No autorizado",
    );
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
  get: <T>(path: string, options?: { timeoutMs?: number }) => {
    const ms = options?.timeoutMs;
    if (ms && ms > 0) {
      const ctrl = new AbortController();
      const tid = window.setTimeout(() => ctrl.abort(), ms);
      return request<T>(path, { signal: ctrl.signal }).finally(() =>
        window.clearTimeout(tid),
      );
    }
    return request<T>(path);
  },
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
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "PATCH",
      body: body != null ? JSON.stringify(body) : undefined,
    }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),

  /** Envía FormData (multipart). No pone Content-Type; el browser lo añade con el boundary correcto. */
  upload: async <T>(path: string, form: FormData): Promise<T> => {
    const token = panelBearerToken();
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    let url = resolvePanelApiUrl(path, "POST");
    const headers: Record<string, string> = token
      ? { Authorization: `Bearer ${token}` }
      : {};
    let res = await fetch(url, { method: "POST", headers, body: form });
    if (res.status === 405 && origin && path.startsWith("/api/")) {
      const alt = alternateMutatingApiUrl(url, path, "POST", origin);
      if (alt) res = await fetch(alt, { method: "POST", headers, body: form });
    }
    if (res.status === 401) throw new Error("No autorizado");
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || body.mensaje || `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  },
};
