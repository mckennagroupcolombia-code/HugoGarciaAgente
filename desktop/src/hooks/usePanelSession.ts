import { useEffect, useRef } from "react";
import { alternateMutatingApiUrl } from "../api/client";
import { useAppStore } from "../stores/app";
import { useTicketsAuth } from "../stores/ticketsAuth";

const STORAGE_KEY = "mckenna-panel-session-uuid";
const PING_MS = 45_000;

function getOrCreateSessionUuid(): string {
  try {
    const existing = sessionStorage.getItem(STORAGE_KEY);
    if (existing && existing.length >= 8) return existing;
  } catch {
    /* private mode */
  }
  const id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `ps_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  try {
    sessionStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
  return id;
}

function clearSessionUuid(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Misma convención que TicketsPanel (`tapi`): POST a `/api/tickets/...`
 * (no `/app/api/...`, que no existe en Flask para tickets).
 */
async function ticketsPost(
  jwt: string,
  path: string,
  body: Record<string, unknown>,
): Promise<boolean> {
  const apiPath = path.startsWith("/api/tickets")
    ? path
    : `/api/tickets${path.startsWith("/") ? path : `/${path}`}`;
  const origin = window.location.origin;
  const urls = [`${origin}${apiPath}`];
  const alt = alternateMutatingApiUrl(urls[0], apiPath, "POST", origin);
  if (alt) urls.push(alt);

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify(body),
      });
      if (res.ok) return true;
      if (res.status !== 405) return false;
    } catch {
      /* try next */
    }
  }
  return false;
}

export function usePanelSession() {
  const token = useTicketsAuth((s) => s.token);
  const panel = useAppStore((s) => s.panel);
  const sessionRef = useRef<string | null>(null);
  const lastPanelRef = useRef<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!token) {
      startedRef.current = false;
      sessionRef.current = null;
      return;
    }

    const sid = getOrCreateSessionUuid();
    sessionRef.current = sid;

    const ping = () => {
      if (!sessionRef.current || document.visibilityState !== "visible") return;
      void ticketsPost(token, "/api/tickets/panel/sesion/ping", {
        session_uuid: sessionRef.current,
        panel,
      });
    };

    if (!startedRef.current) {
      startedRef.current = true;
      void ticketsPost(token, "/api/tickets/panel/sesion/inicio", {
        session_uuid: sid,
        panel,
      }).then(() => ping());
    } else {
      ping();
    }

    const pingId = window.setInterval(ping, PING_MS);
    document.addEventListener("visibilitychange", ping);

    const endSession = () => {
      const s = sessionRef.current;
      if (!s || !token) return;
      const payload = JSON.stringify({ session_uuid: s });
      const urls = [
        `${window.location.origin}/api/tickets/panel/sesion/fin`,
        `${window.location.origin}/app/api/tickets/panel/sesion/fin`,
      ];
      for (const url of urls) {
        try {
          void fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: payload,
            keepalive: true,
          });
          break;
        } catch {
          /* next */
        }
      }
    };

    window.addEventListener("pagehide", endSession);

    return () => {
      window.clearInterval(pingId);
      document.removeEventListener("visibilitychange", ping);
      window.removeEventListener("pagehide", endSession);
    };
  }, [token, panel]);

  useEffect(() => {
    if (!token || !sessionRef.current) return;
    if (lastPanelRef.current === panel) return;
    lastPanelRef.current = panel;
    void ticketsPost(token, "/api/tickets/panel/evento", {
      session_uuid: sessionRef.current,
      tipo: "panel_view",
      panel,
    });
    void ticketsPost(token, "/api/tickets/panel/sesion/ping", {
      session_uuid: sessionRef.current,
      panel,
    });
  }, [token, panel]);
}

export async function cerrarSesionPanel(jwt: string): Promise<void> {
  let sid: string | null = null;
  try {
    sid = sessionStorage.getItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  if (sid) {
    await ticketsPost(jwt, "/api/tickets/panel/sesion/fin", { session_uuid: sid });
  }
  clearSessionUuid();
}
