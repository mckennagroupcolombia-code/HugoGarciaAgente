import { useEffect, useState } from "react";
import ColaboradoresPanel from "../components/ColaboradoresPanel";
import { useTicketsAuth, type TicketsUser } from "./stubs/ticketsAuth";
import AgendaColab from "./AgendaColab";

type Vista = "diagramas" | "agenda";

/** Toma la sesión: `?_token=` (recién entró) o la que ya estaba en este navegador. */
function useSesion() {
  const { token, user, setAuth, clear } = useTicketsAuth();
  const [listo, setListo] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const deUrl = params.get("_token");
    if (deUrl) {
      params.delete("_token");
      const q = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (q ? `?${q}` : ""));
    }
    const tok = deUrl || token;
    if (!tok) { setListo(true); return; }
    fetch(`/api/tickets/auth/me?_t=${Date.now()}`, {
      headers: { Authorization: `Bearer ${tok}` }, cache: "no-store",
    })
      .then(async (r) => {
        if (r.ok) {
          const u = (await r.json()) as TicketsUser;
          if (u?.id) setAuth(tok, u);
        } else if (r.status === 401) {
          clear();
        }
      })
      .catch(() => { /* sin red: se conserva la sesión local */ })
      .finally(() => setListo(true));
    // Solo al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { listo, token, user, clear };
}

async function salir(token: string | null, clear: () => void) {
  try {
    if (token) {
      await fetch("/api/tickets/auth/logout", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}",
      });
    }
  } catch { /* igual se cierra localmente */ }
  clear();
  window.location.replace("/app");
}

export default function ColabApp() {
  const { listo, token, user, clear } = useSesion();
  const [vista, setVista] = useState<Vista>("diagramas");

  if (!listo) {
    return <div className="flex h-full items-center justify-center text-sm text-muted">Cargando…</div>;
  }
  if (!token || !user) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-ink">Tu sesión terminó.</p>
        <button type="button" onClick={() => void salir(null, clear)} className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white">
          Volver a entrar
        </button>
      </div>
    );
  }

  const tab = (v: Vista, texto: string) => (
    <button
      type="button"
      onClick={() => setVista(v)}
      className={`rounded-lg px-3 py-1.5 text-sm font-bold ${vista === v ? "bg-accent text-white" : "text-ink-secondary hover:bg-surface-hover"}`}
    >
      {texto}
    </button>
  );

  return (
    <div className="flex h-[100dvh] flex-col" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <header className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-panel px-3 py-2">
        <span className="mr-1 text-lg font-black text-accent">M</span>
        <nav className="flex gap-1">
          {tab("diagramas", "Diagramas")}
          {tab("agenda", "Agenda con Armando")}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-xs text-muted sm:inline">{user.nombre}</span>
          <button type="button" onClick={() => void salir(token, clear)} className="text-xs font-bold text-muted hover:text-ink">
            Salir
          </button>
        </div>
      </header>
      <main className="flex min-h-0 flex-1 flex-col p-2 sm:p-3">
        {vista === "diagramas" ? <ColaboradoresPanel /> : <AgendaColab yo={user} />}
      </main>
    </div>
  );
}
