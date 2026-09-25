import { useEffect, useState } from "react";
import { useAppStore } from "../../stores/app";
import { useCanalesEquipo } from "../../hooks/useCanalesEquipo";
import HiloCanal from "./HiloCanal";
import NuevoCanal from "./NuevoCanal";

/**
 * Chat del equipo — la conversación operativa dentro del panel, no en WhatsApp.
 *
 * Canales (no atados a un ticket): lo que llega, fotos, cantidades, avisos. Queda
 * registrado, se puede buscar, cuenta como actividad. Un canal puede enlazarse a un
 * grupo oficial de WhatsApp mientras dura la transición (app/services/canales_internos.py).
 */
const CLAVE = "mck-chat-equipo-canal";

function hace(ts?: number): string {
  if (!ts) return "";
  const s = Date.now() / 1000 - ts;
  if (s < 60) return "ahora";
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
}

export default function ChatEquipoPanel() {
  const datos = useCanalesEquipo();
  const setPanel = useAppStore((s) => s.setPanel);
  const [sel, setSel] = useState<number | null>(() => {
    try {
      const v = sessionStorage.getItem(CLAVE);
      return v ? Number(v) : null;
    } catch {
      return null;
    }
  });
  const [creando, setCreando] = useState(false);
  const [q, setQ] = useState("");

  const canales = datos.data?.canales ?? [];
  const actual = canales.find((c) => c.id === sel) ?? null;

  useEffect(() => {
    try {
      if (sel != null) sessionStorage.setItem(CLAVE, String(sel));
    } catch {
      /* sin almacenamiento */
    }
  }, [sel]);

  const filtrados = canales.filter((c) => !q.trim() || c.nombre.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="mx-auto flex h-[calc(100dvh-190px)] min-h-[480px] w-full max-w-[1400px] gap-2">
      {/* Lista de canales (en móvil se oculta cuando hay uno abierto) */}
      <aside className={`${actual || creando ? "hidden lg:flex" : "flex"} w-full min-w-0 flex-col rounded-xl border border-border bg-surface-panel p-2 lg:w-[300px] lg:shrink-0`}>
        <div className="flex items-center gap-1.5">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar canal…"
            className="min-w-0 flex-1 rounded-md border border-border bg-surface-input px-2 py-1.5 text-[12px]" />
          {datos.data?.puede_administrar && (
            <button onClick={() => { setCreando(true); setSel(null); }}
              className="rounded-md bg-accent px-2 py-1.5 text-[11.5px] font-bold text-white" title="Crear un canal">+ Canal</button>
          )}
        </div>
        <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto">
          {datos.isLoading && <p className="px-1 text-[12px] text-muted">Cargando canales…</p>}
          {!datos.isLoading && canales.length === 0 && (
            <p className="px-1 py-4 text-[12px] text-muted">
              Aún no hay canales.{datos.data?.puede_administrar ? " Crea el primero con «+ Canal»." : " Pídele a quien coordina que cree uno."}
            </p>
          )}
          {filtrados.map((c) => (
            <button key={c.id} onClick={() => { setSel(c.id); setCreando(false); }}
              className={`mck-btn-no-fx flex w-full items-start gap-2 rounded-lg border p-2 text-left ${c.id === sel ? "border-accent bg-accent/10" : "border-border bg-surface-input hover:border-accent/50"}`}>
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[13px] font-bold text-accent">
                {c.nombre.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1">
                  <span className="truncate text-[12.5px] font-bold text-ink">{c.nombre}</span>
                  {c.wa_jid && <span className="shrink-0 rounded bg-surface px-1 text-[9px] text-muted" title={`Enlazado a ${c.wa_nombre || "WhatsApp"}`}>WA</span>}
                  <span className="ml-auto shrink-0 font-mono text-[9.5px] text-muted">{hace(c.ultimo?.creado_en)}</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="truncate text-[11px] text-ink-secondary">
                    {c.ultimo ? `${c.ultimo.autor_nombre}: ${c.ultimo.texto || (c.ultimo.adjunto_nombre ? "📎 adjunto" : "📷 foto")}` : "Sin mensajes"}
                  </span>
                  {c.no_leidos > 0 && (
                    <span className="ml-auto shrink-0 rounded-full bg-accent px-1.5 text-[10px] font-bold text-white">{c.no_leidos}</span>
                  )}
                </span>
              </span>
            </button>
          ))}
        </div>
        <button onClick={() => setPanel("whatsapp")}
          className="mt-2 rounded-md border border-border bg-surface px-2 py-1.5 text-[11px] text-ink-secondary hover:border-accent/60"
          title="Los chats con clientes siguen en el panel de WhatsApp">
          Chats con clientes (WhatsApp) →
        </button>
      </aside>

      {creando && datos.data && (
        <NuevoCanal grupos={datos.data.grupos_wa} onCancelar={() => setCreando(false)}
          onCreado={(c) => { setCreando(false); setSel(c.id); }} />
      )}
      {!creando && actual && <HiloCanal key={actual.id} canal={actual} onVolver={() => setSel(null)} />}
      {!creando && !actual && (
        <div className="hidden flex-1 items-center justify-center rounded-xl border border-dashed border-border text-[12.5px] text-muted lg:flex">
          Elige un canal para ver la conversación.
        </div>
      )}
    </div>
  );
}
