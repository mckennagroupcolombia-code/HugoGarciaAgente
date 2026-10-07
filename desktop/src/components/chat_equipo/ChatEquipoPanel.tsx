import { useEffect, useState } from "react";
import { useAppStore } from "../../stores/app";
import { useTicketsAuth } from "../../stores/ticketsAuth";
import { useCanalesEquipo } from "../../hooks/useCanalesEquipo";
import { puedeVerTabInicio } from "../nav/InicioNavTabs";
import { SelectorMensajes, guardarVistaMensajes } from "./SelectorMensajes";
import HiloCanal from "./HiloCanal";
import NuevoCanal from "./NuevoCanal";
import { sonidoPorId, useAlertasSonido } from "../../lib/alertasSonido";
import "./chatEquipo.css";

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

/** Vista previa de una línea: sin los *asteriscos* del formato de WhatsApp. */
function sinFormato(t: string): string {
  return (t || "").replace(/(^|[^\p{L}\p{N}])[*_~]([^*_~\n]+)[*_~](?![\p{L}\p{N}])/gu, "$1$2");
}

/** `embebido`: dentro de «Mensajes» (MensajesConGrupos), que ya pone el selector y la altura. */
export default function ChatEquipoPanel({ embebido = false }: { embebido?: boolean }) {
  const datos = useCanalesEquipo();
  const setPanel = useAppStore((s) => s.setPanel);
  const setCentroMandoView = useAppStore((s) => s.setCentroMandoView);
  const setTicketsBootView = useAppStore((s) => s.setTicketsBootView);
  const setAccionesBootTab = useAppStore((s) => s.setAccionesBootTab);
  const user = useTicketsAuth((s) => s.user);
  const conSolicitudes = ["acciones", "solicitudes"].some((t) => puedeVerTabInicio(user?.permisos_secciones, user?.rol?.nivel ?? 1, t));
  const irSolicitudes = () => {
    guardarVistaMensajes("solicitudes");
    setAccionesBootTab(null);
    setTicketsBootView("mensajes");
    setCentroMandoView("mensajes");
    setPanel("hugo");
  };
  const [sel, setSel] = useState<number | null>(() => {
    try {
      const v = sessionStorage.getItem(CLAVE);
      return v ? Number(v) : null;
    } catch {
      return null;
    }
  });
  const [creando, setCreando] = useState(false);
  const sonidosCanal = useAlertasSonido((st) => st.ajustes.canales);
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

  const contenido = (
    <div className={embebido ? "flex min-h-0 w-full min-w-0 flex-1 gap-2" : "mx-auto flex h-[calc(100dvh-235px)] min-h-[440px] max-md:h-[calc(100dvh-295px-env(safe-area-inset-bottom))] max-md:min-h-[360px] w-full max-w-[1400px] gap-3"}>
      {/* Lista de canales (en móvil se oculta cuando hay uno abierto) */}
      <aside className={`${actual || creando ? "hidden lg:flex" : "flex"} w-full min-w-0 flex-col rounded-2xl border border-border bg-surface-panel p-2.5 lg:w-[340px] lg:shrink-0`}>
        <div className="flex items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Buscar grupo…"
            className="min-w-0 flex-1 rounded-full border border-border bg-surface-input px-4 py-2.5 text-[15px]" />
          {datos.data?.puede_administrar && (
            <button onClick={() => { setCreando(true); setSel(null); }}
              className="rounded-full bg-accent px-3.5 py-2.5 text-[14px] font-bold text-white" title="Crear un canal">+ Grupo</button>
          )}
        </div>
        <div className="mt-2.5 min-h-0 flex-1 space-y-1.5 overflow-y-auto">
          {datos.isLoading && <p className="px-1 text-[14px] text-muted">Cargando grupos…</p>}
          {!datos.isLoading && canales.length === 0 && (
            <p className="px-1 py-4 text-[14px] text-muted">
              Aún no hay grupos.{datos.data?.puede_administrar ? " Crea el primero con «+ Grupo»." : " Pídele a quien coordina que cree uno."}
            </p>
          )}
          {filtrados.map((c) => {
            const sinLeer = c.no_leidos > 0;
            const sonido = sonidoPorId(sonidosCanal[String(c.id)]);
            return (
              <button key={c.id} onClick={() => { setSel(c.id); setCreando(false); }}
                className={`mck-btn-no-fx flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition ${
                  c.id === sel ? "border-accent bg-accent/10 shadow-sm" : sinLeer ? "border-accent/40 bg-surface hover:border-accent" : "border-transparent bg-surface hover:border-border"}`}>
                <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent/15 text-[19px] font-black text-accent">
                  {c.nombre.slice(0, 1).toUpperCase()}
                  {sonido && <span className="absolute -bottom-1 -right-1 text-[15px] leading-none" title={`Suena: ${sonido.nombre}`}>{sonido.icono}</span>}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1.5">
                    <span className={`truncate text-[15.5px] text-ink ${sinLeer ? "font-black" : "font-bold"}`}>{c.nombre}</span>
                    {c.wa_jid && <span className="shrink-0 rounded-full bg-[#25d366]/15 px-1.5 text-[10.5px] font-bold text-[#128c7e]" title={`Enlazado a ${c.wa_nombre || "WhatsApp"}`}>WA</span>}
                    <span className={`ml-auto shrink-0 text-[12px] ${sinLeer ? "font-bold text-accent" : "text-muted"}`}>{hace(c.ultimo?.creado_en)}</span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-2">
                    <span className={`line-clamp-1 text-[13.5px] ${sinLeer ? "font-semibold text-ink" : "text-ink-secondary"}`}>
                      {c.ultimo ? <><b className="font-bold">{c.ultimo.autor_nombre.split(" ")[0]}:</b> {sinFormato(c.ultimo.texto) || (c.ultimo.adjunto_nombre ? "📎 adjunto" : "📷 foto")}</> : "Sin mensajes"}
                    </span>
                    {sinLeer && (
                      <span className="ml-auto flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-[12.5px] font-black text-white">{c.no_leidos}</span>
                    )}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <button onClick={() => setPanel("whatsapp")}
          className="mt-2 rounded-full border border-border bg-surface px-3 py-2 text-[13px] text-ink-secondary hover:border-accent/60"
          title="Los chats con clientes siguen en el panel de WhatsApp">
          Chats con clientes (WhatsApp) →
        </button>
      </aside>

      {creando && datos.data && (
        <NuevoCanal grupos={datos.data.grupos_wa} modulos={datos.data.modulos ?? []} onCancelar={() => setCreando(false)}
          onCreado={(c) => { setCreando(false); setSel(c.id); }} />
      )}
      {!creando && actual && <HiloCanal key={actual.id} canal={actual} onVolver={() => setSel(null)} />}
      {!creando && !actual && (
        <div className="mck-chat-fondo hidden flex-1 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border text-center lg:flex">
          <span className="text-[44px]" aria-hidden>💬</span>
          <p className="text-[17px] font-bold text-ink">Elige un grupo para leer la conversación</p>
          <p className="max-w-xs text-[14px] text-muted">Con 🔔 «Sonido» le pones a cada grupo su propio aviso de Duck Hunt o Circus Charlie.</p>
        </div>
      )}
    </div>
  );
  if (embebido) return contenido;
  // Abierto como panel propio (campana, burbuja): el mismo selector para volver a Solicitudes.
  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-2">
      <SelectorMensajes actual="grupos" conSolicitudes={conSolicitudes} onCambiar={(v) => { if (v === "solicitudes") irSolicitudes(); }} />
      {contenido}
    </div>
  );
}
