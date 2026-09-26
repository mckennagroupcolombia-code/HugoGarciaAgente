import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api/client";
import { Icon } from "../../icons";
import { useAppStore, type Panel } from "../../stores/app";
import { useNotificaciones, useResumenMensajes } from "../../hooks/useCanalesEquipo";

const PREFS: { id: "inapp" | "ambos"; texto: string }[] = [
  { id: "inapp", texto: "Solo en el panel" },
  { id: "ambos", texto: "Panel y WhatsApp" },
];

function hace(ts: number): string {
  const s = Date.now() / 1000 - ts;
  if (s < 60) return "ahora";
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}

/** La campana del cabezote: avisos del panel + mensajes del equipo sin leer.
 *  Una sola consulta liviana cada 10 s; el detalle solo con el popover abierto. */
export default function CampanaNotificaciones() {
  const qc = useQueryClient();
  const setPanel = useAppStore((s) => s.setPanel);
  const [abierto, setAbierto] = useState(false);
  const resumen = useResumenMensajes();
  const notifs = useNotificaciones(abierto);
  const nNotif = resumen.data?.notificaciones_no_leidas ?? 0;
  const nChat = resumen.data?.canales_no_leidos ?? 0;
  const total = nNotif + nChat;

  const marcarTodas = async () => {
    await api.post("/api/notificaciones/leidas", {});
    void qc.invalidateQueries({ queryKey: ["notificaciones"] });
    void qc.invalidateQueries({ queryKey: ["mensajes-resumen"] });
  };
  const fijarPref = async (p: string) => {
    await api.put("/api/notificaciones/preferencia", { preferencia: p });
    void qc.invalidateQueries({ queryKey: ["notificaciones"] });
  };
  const ir = (panel: string | null) => {
    setAbierto(false);
    if (panel) setPanel(panel as Panel);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className={`mck-press relative flex shrink-0 items-center rounded-full border px-2 py-1.5 transition ${
          abierto ? "border-accent bg-accent/10 text-accent" : "border-border text-muted hover:border-accent/40 hover:text-ink"
        }`}
        title="Avisos y mensajes del equipo"
        aria-label={`Avisos${total ? `: ${total} sin leer` : ""}`}
        aria-expanded={abierto}
      >
        <Icon name="bell" size={16} weight="bold" />
        {total > 0 && (
          <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-accent-rose px-1 text-center text-[10px] font-bold leading-[18px] text-white">
            {total > 99 ? "99+" : total}
          </span>
        )}
      </button>

      {abierto && (
        <>
          <div className="fixed inset-0 z-[69]" onMouseDown={() => setAbierto(false)} />
          <div role="dialog" aria-label="Avisos"
            className="absolute right-0 top-10 z-[70] w-[min(92vw,380px)] overflow-hidden rounded-2xl border border-border bg-surface shadow-paper-lg">
            {nChat > 0 && (
              <button onClick={() => ir("chat-equipo")}
                className="flex w-full items-center gap-2 border-b border-border bg-accent/10 px-3 py-2 text-left text-[12.5px] font-bold text-ink">
                <Icon name="chat" size={16} /> {nChat} mensaje{nChat === 1 ? "" : "s"} del equipo sin leer →
              </button>
            )}
            <div className="flex items-center justify-between px-3 py-2">
              <p className="text-[12.5px] font-bold text-ink">Avisos</p>
              {nNotif > 0 && <button onClick={() => void marcarTodas()} className="text-[11px] text-accent underline">Marcar todo leído</button>}
            </div>
            <div className="max-h-[50vh] overflow-y-auto">
              {notifs.isLoading && <p className="px-3 py-2 text-[12px] text-muted">Cargando…</p>}
              {(notifs.data?.notificaciones ?? []).length === 0 && !notifs.isLoading && (
                <p className="px-3 py-4 text-[12px] text-muted">Sin avisos por ahora.</p>
              )}
              {(notifs.data?.notificaciones ?? []).map((n) => (
                <button key={n.id} onClick={() => ir(n.panel_destino)}
                  className={`block w-full border-t border-border/60 px-3 py-2 text-left hover:bg-surface-hover ${n.leida_en ? "opacity-60" : ""}`}>
                  <span className="flex items-start gap-2">
                    {!n.leida_en && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />}
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12.5px] font-bold text-ink">{n.titulo}</span>
                      {n.cuerpo && <span className="line-clamp-3 block whitespace-pre-wrap text-[11.5px] text-ink-secondary">{n.cuerpo}</span>}
                      <span className="block font-mono text-[9.5px] text-muted">{hace(n.creada_en)}</span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
            {notifs.data && (
              <div className="border-t border-border px-3 py-2">
                <p className="text-[10.5px] font-bold uppercase tracking-wide text-muted">¿Dónde quieres recibir los avisos?</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {PREFS.map((p) => (
                    <button key={p.id} onClick={() => void fijarPref(p.id)} aria-pressed={notifs.data?.preferencia === p.id}
                      className={`rounded-full border px-2 py-0.5 text-[11px] ${notifs.data?.preferencia === p.id ? "border-accent bg-accent text-white" : "border-border text-ink"}`}>
                      {p.texto}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
