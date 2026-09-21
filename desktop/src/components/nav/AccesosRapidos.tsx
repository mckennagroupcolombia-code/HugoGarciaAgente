import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Icon } from "../../icons";
import { PanelIcon } from "../../icons/PanelIcon";
import { PANEL_INFO } from "../../lib/panelInfo";
import { NAV_PANEL_ORDER } from "../../lib/navStructure";
import { puedeVerSeccionPanel } from "../../lib/panelAccess";
import { useNavegarPanel } from "../../hooks/useNavegarPanel";
import { useAppStore, type Panel } from "../../stores/app";
import { useTicketsAuth } from "../../stores/ticketsAuth";

interface Atajos {
  frecuentes: { panel: string; visitas: number; puntaje: number; ultima: string }[];
  recientes: string[];
}

const MAX_FRECUENTES = 8;

function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Accesos rápidos: los paneles a los que más va cada persona, sacados de su
 * telemetría de navegación (`panel_view` → GET /api/tickets/panel/atajos, con
 * más peso a lo reciente), más un buscador sobre todo lo que puede abrir.
 *
 * Botón ⚡ en el cabezote o Ctrl/⌘+K desde cualquier parte. Con el buscador
 * vacío, las teclas 1–8 abren el atajo de ese número; con texto, Enter abre el
 * primer resultado. Solo ofrece paneles que el usuario puede ver (misma regla
 * que el menú, `puedeVerSeccionPanel`): un atajo que rebota es peor que ninguno.
 */
export default function AccesosRapidos() {
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const user = useTicketsAuth((s) => s.user);
  const token = useTicketsAuth((s) => s.token);
  const panelActual = useAppStore((s) => s.panel);
  const navegarPanel = useNavegarPanel();

  const atajosQ = useQuery<Atajos>({
    queryKey: ["panel-atajos"],
    queryFn: () => api.get("/api/tickets/panel/atajos?limite=12"),
    enabled: Boolean(token),
    staleTime: 5 * 60 * 1000,
  });

  const visible = (p: string): p is Panel =>
    Boolean(PANEL_INFO[p]) && puedeVerSeccionPanel(user, p);

  const frecuentes = useMemo(
    () => (atajosQ.data?.frecuentes ?? []).map((f) => f.panel).filter(visible).slice(0, MAX_FRECUENTES),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [atajosQ.data, user],
  );
  const recientes = useMemo(
    () => (atajosQ.data?.recientes ?? []).filter((p) => p !== panelActual).filter(visible).slice(0, 4),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [atajosQ.data, user, panelActual],
  );
  const resultados = useMemo(() => {
    const t = normalizar(q.trim());
    if (!t) return [];
    const todos = Array.from(new Set<string>([...NAV_PANEL_ORDER, "hugo"])).filter(visible);
    return todos
      .filter((p) => {
        const info = PANEL_INFO[p];
        return normalizar(`${info.label} ${info.description} ${p}`).includes(t);
      })
      // Primero los que casan por nombre; entre ellos, los que más usa la persona.
      .sort((a, b) => {
        const na = normalizar(PANEL_INFO[a].label).includes(t) ? 0 : 1;
        const nb = normalizar(PANEL_INFO[b].label).includes(t) ? 0 : 1;
        if (na !== nb) return na - nb;
        const fa = frecuentes.indexOf(a as Panel);
        const fb = frecuentes.indexOf(b as Panel);
        return (fa < 0 ? 99 : fa) - (fb < 0 ? 99 : fb);
      })
      .slice(0, 10) as Panel[];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, user, frecuentes]);

  function ir(p: Panel) {
    setAbierto(false);
    setQ("");
    navegarPanel(p);
  }

  // Ctrl/⌘+K abre y cierra desde cualquier parte de la app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setAbierto((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!abierto) return;
    setQ("");
    void atajosQ.refetch();
    const id = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto]);

  if (!token || !user) return null;

  function onInputKey(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setAbierto(false);
    } else if (e.key === "Enter") {
      const p = resultados[0] ?? (!q.trim() ? frecuentes[0] : undefined);
      if (p) ir(p);
    } else if (!q && /^[1-8]$/.test(e.key)) {
      const p = frecuentes[Number(e.key) - 1];
      if (p) {
        e.preventDefault();
        ir(p);
      }
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className={`mck-press flex shrink-0 items-center gap-1 rounded-full border px-2 py-1.5 text-[12px] font-bold transition ${
          abierto ? "border-accent bg-accent/10 text-accent" : "border-border text-muted hover:border-accent/40 hover:text-ink"
        }`}
        title="Accesos rápidos — lo que más usas (Ctrl+K)"
        aria-label="Accesos rápidos"
        aria-expanded={abierto}
      >
        <Icon name="lightning" size={16} weight="bold" />
        <span className="hidden md:inline">Rápido</span>
      </button>

      {abierto && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/25 px-3 pt-[10vh]"
             onMouseDown={(e) => { if (e.target === e.currentTarget) setAbierto(false); }}>
          <div role="dialog" aria-label="Accesos rápidos"
               className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-paper-lg">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
              <Icon name="search" size={18} className="shrink-0 text-muted" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onInputKey}
                placeholder="¿A dónde vas? Escribe o usa 1–8"
                className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-muted"
              />
              <kbd className="hidden rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted sm:inline">Esc</kbd>
            </div>

            <div className="max-h-[60vh] overflow-y-auto p-3">
              {q.trim() ? (
                resultados.length ? (
                  <ul className="space-y-1">
                    {resultados.map((p, i) => (
                      <li key={p}>
                        <button type="button" onClick={() => ir(p)}
                          className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-surface-hover ${i === 0 ? "bg-accent/5" : ""}`}>
                          <PanelIcon panel={p} size={22} bubble={false} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-bold text-ink">{PANEL_INFO[p].label}</span>
                            <span className="block truncate text-xs text-muted">{PANEL_INFO[p].description}</span>
                          </span>
                          {i === 0 && <kbd className="shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted">Enter</kbd>}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-1 py-3 text-sm text-muted">Nada con «{q.trim()}» entre los paneles a los que tienes acceso.</p>
                )
              ) : (
                <>
                  <p className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wide text-muted">Lo que más usas</p>
                  {frecuentes.length ? (
                    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                      {frecuentes.map((p, i) => (
                        <button key={p} type="button" onClick={() => ir(p)}
                          title={PANEL_INFO[p].description}
                          className={`relative flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-center transition hover:border-accent hover:bg-accent/5 ${
                            p === panelActual ? "border-accent/60 bg-accent/5" : "border-border"
                          }`}>
                          <span className="absolute left-1.5 top-1 font-mono text-[10px] text-muted">{i + 1}</span>
                          <PanelIcon panel={p} size={26} bubble={false} />
                          <span className="line-clamp-2 text-[12px] font-bold leading-tight text-ink">{PANEL_INFO[p].label}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="px-1 text-sm text-muted">
                      {atajosQ.isLoading ? "Cargando…" : "Aún no hay suficiente uso para sugerir atajos. Mientras tanto, escribe el nombre del panel."}
                    </p>
                  )}

                  {recientes.length > 0 && (
                    <>
                      <p className="mb-2 mt-4 px-1 text-[11px] font-bold uppercase tracking-wide text-muted">Volver a</p>
                      <div className="flex flex-wrap gap-1.5">
                        {recientes.map((p) => (
                          <button key={p} type="button" onClick={() => ir(p)}
                            className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[12px] font-bold text-ink hover:border-accent hover:bg-accent/5">
                            <PanelIcon panel={p} size={16} bubble={false} />
                            {PANEL_INFO[p].label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  <p className="mt-4 px-1 text-[11px] text-muted">
                    Se arma solo con lo que abres, y lo de esta semana pesa más que lo del mes pasado.
                    Ábrelo desde cualquier parte con <kbd className="font-mono">Ctrl+K</kbd>.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
