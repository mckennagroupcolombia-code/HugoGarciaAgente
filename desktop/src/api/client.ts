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

/** Bearer para /api/* del panel: JWT en rutas tickets; CHAT_API_TOKEN en el resto (admins). */
export function panelBearerToken(path: string): string | null {
  const tickets = useTicketsAuth.getState();
  if (path.startsWith("/api/tickets/")) {
    return tickets.token || null;
  }
  return tickets.apiToken || tickets.token || useAuthStore.getState().token || null;
}

/** JWT de tickets para identificar a la persona cuando el Bearer es CHAT_API_TOKEN. */
export function ticketsSessionHeaders(): Record<string, string> {
  const tok = useTicketsAuth.getState().token;
  return tok ? { "X-Tickets-Token": tok } : {};
}

async function request<T>(
  path: string,
  opts: RequestInit = {},
): Promise<T> {
  const token = panelBearerToken(path);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...ticketsSessionHeaders(),
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
    (res.status === 405 || res.status === 404) &&
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
    const body401 = await res.clone().json().catch(() => ({}));
    const errMsg = String((body401 as { error?: string }).error ?? "").toLowerCase();
    const invalidSession =
      errMsg.includes("sesión") ||
      errMsg.includes("sesion") ||
      errMsg.includes("expirada") ||
      errMsg.includes("inválida") ||
      errMsg.includes("invalida");
    if (
      path.startsWith("/api/tickets/") &&
      tickets.token &&
      token === tickets.token &&
      invalidSession
    ) {
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
    const detail = body.error || body.mensaje || `HTTP ${res.status}`;
    if (res.status === 405) {
      throw new Error(
        `${detail} — el agente en :8081 no tiene esta ruta (proceso viejo). Reinícialo y recarga el panel.`,
      );
    }
    throw new Error(detail);
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

/** Clona FormData: el body se consume en el primer fetch y el reintento iría vacío. */
export function cloneFormData(form: FormData): FormData {
  const copy = new FormData();
  form.forEach((value, key) => {
    copy.append(key, value);
  });
  return copy;
}

function mensajeSiHtml(status: number, preview: string): string {
  if (status === 413) {
    return "Las fotos pesan demasiado. Use imágenes más livianas o un PDF comprimido.";
  }
  if (status === 403) {
    return "Acceso restringido. En Ajustes activa el acceso desde red, o abre el panel en este equipo.";
  }
  if (status === 502 || status === 504 || status === 524) {
    return "El análisis tardó demasiado y el servidor cortó la conexión. Espera a que termine o adjunta las páginas de una en una.";
  }
  if (preview.startsWith("<")) {
    return (
      `El servidor devolvió HTML (HTTP ${status}) en lugar de JSON. ` +
      "Recarga el panel; si el agente se acaba de reiniciar, espera unos segundos e inténtalo de nuevo."
    );
  }
  return preview
    ? `Respuesta no JSON (HTTP ${status}): ${preview}`
    : `Respuesta vacía o no JSON (HTTP ${status}).`;
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
  upload: async <T>(
    path: string,
    form: FormData,
    options?: { timeoutMs?: number },
  ): Promise<T> => {
    const token = panelBearerToken(path);
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    let url = resolvePanelApiUrl(path, "POST");
    const headers: Record<string, string> = {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...ticketsSessionHeaders(),
    };
    const ms = options?.timeoutMs;
    const ctrl = ms && ms > 0 ? new AbortController() : null;
    const tid =
      ctrl && ms ? window.setTimeout(() => ctrl.abort(), ms) : null;
    const doFetch = (target: string) =>
      fetch(target, {
        method: "POST",
        headers,
        body: form,
        signal: ctrl?.signal,
      });
    let res: Response;
    try {
      res = await doFetch(url);
      // Solo 404/405: otro prefijo /api ↔ /app/api. No reintentar HTML 5xx
      // (el análisis ya pudo haber arrancado; un 2.º POST vacío o duplicado empeora).
      const needsAlt =
        origin &&
        path.startsWith("/api/") &&
        (res.status === 404 || res.status === 405);
      if (needsAlt) {
        const alt = alternateMutatingApiUrl(url, path, "POST", origin);
        if (alt) {
          const retry = await fetch(alt, {
            method: "POST",
            headers,
            body: cloneFormData(form),
            signal: ctrl?.signal,
          });
          const ctR = (retry.headers.get("content-type") ?? "").toLowerCase();
          if (
            ctR.includes("application/json") ||
            (retry.status !== res.status && retry.status < 500)
          ) {
            url = alt;
            res = retry;
          }
        }
      }
    } catch (e) {
      if (ctrl?.signal.aborted) {
        throw new Error("La solicitud tardó demasiado (timeout). Intente de nuevo.");
      }
      const msg = e instanceof Error ? e.message : String(e);
      if (/NetworkError|Failed to fetch|Network request failed|Load failed|ECONNREFUSED/i.test(msg)) {
        throw new Error(
          "No hay conexión con el agente (:8081). Reinicia el servicio y recarga el panel.",
        );
      }
      throw e;
    } finally {
      if (tid != null) window.clearTimeout(tid);
    }
    if (res.status === 401) throw new Error("No autorizado");
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!ct.includes("application/json")) {
      const preview = (await res.clone().text()).slice(0, 120).trim();
      throw new Error(
        res.status === 404
          ? "Ruta no encontrada (404). Recarga el panel o reinicia el agente."
          : mensajeSiHtml(res.status, preview),
      );
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const msg =
        (typeof body.error === "string" && body.error) ||
        (typeof body.mensaje === "string" && body.mensaje) ||
        (res.status === 404
          ? "Ruta no encontrada (404). Recarga el panel o reinicia el agente."
          : `HTTP ${res.status}`);
      throw new Error(msg);
    }
    return body as T;
  },
};
