import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "../../stores/app";
import { useTicketsAuth } from "../../stores/ticketsAuth";
import { useConversaciones, type Conversacion } from "../../hooks/useConversaciones";
import { ESTADO_LABEL, ESTADO_PILL_CLASS, tiempoRelativo } from "../tickets/ticketsFormat";
import { Icon } from "../../icons";

/**
 * Burbuja flotante global (portal a body, mismo patrón que CrearSiigoFab): mientras el
 * usuario navega por otros paneles, recuerda sus solicitudes/acciones "en proceso" o
 * "esperando aprobación" (mismo agrupado que la pestaña Mensajes del Centro de Mando)
 * y permite volver directo al hilo con un clic, sin tener que ir a Inicio → Mensajes
 * y buscarla de nuevo. Se oculta dentro del propio Centro de Mando (panel "hugo"/"tickets"),
 * donde el inbox ya está a la vista.
 */
export default function SolicitudesEnProcesoFab() {
  const [abierta, setAbierta] = useState(false);
  const contenedorRef = useRef<HTMLDivElement>(null);

  const panel = useAppStore((s) => s.panel);
  const setPanel = useAppStore((s) => s.setPanel);
  const setCentroMandoView = useAppStore((s) => s.setCentroMandoView);
  const setSolicitudBoot = useAppStore((s) => s.setSolicitudBoot);
  const user = useTicketsAuth((s) => s.user);

  const { data: conversaciones = [] } = useConversaciones("todas", "mias");
  const enProceso = conversaciones
    .filter((c) => c.estado === "en_proceso" || c.estado === "esperando_aprobacion")
    .sort((a, b) => b.ultima_actividad.localeCompare(a.ultima_actividad));

  useEffect(() => {
    if (!abierta) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierta(false);
    };
    const onClickOutside = (e: MouseEvent) => {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target as Node)) setAbierta(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClickOutside);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClickOutside);
    };
  }, [abierta]);

  // Nunca se muestra dentro del propio Centro de Mando, sin sesión, o sin nada pendiente.
  const enCentroMando = panel === "hugo" || panel === "tickets";
  useEffect(() => {
    if (enCentroMando) setAbierta(false);
  }, [enCentroMando]);
  if (!user || enCentroMando || enProceso.length === 0) return null;
  if (typeof document === "undefined") return null;

  function irA(c?: Conversacion) {
    setCentroMandoView("mensajes");
    setSolicitudBoot(c ? { abrirTicketId: c.id } : null);
    setPanel("hugo");
    setAbierta(false);
  }

  return createPortal(
    <div
      ref={contenedorRef}
      className="pointer-events-none fixed bottom-5 right-5 z-[900] flex flex-col items-end gap-3 sm:bottom-6 sm:right-6"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {abierta && (
        <div
          className="pointer-events-auto flex max-h-[min(70vh,32rem)] w-[min(calc(100vw-1.5rem),22rem)] flex-col overflow-hidden rounded-paper-lg border-2 border-accent/50 bg-surface-panel shadow-paper-lg"
          role="dialog"
          aria-label="Solicitudes y acciones en proceso"
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-accent/10 px-3 py-2">
            <div className="flex items-center gap-1.5 text-accent">
              <Icon name="inbox" size={14} weight="bold" />
              <span className="text-[11px] font-extrabold uppercase tracking-wide">
                En proceso ({enProceso.length})
              </span>
            </div>
            <button
              type="button"
              onClick={() => setAbierta(false)}
              className="rounded-lg px-2 py-0.5 text-sm text-muted hover:bg-surface-hover hover:text-ink"
              aria-label="Cerrar"
            >
              ✕
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {enProceso.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => irA(c)}
                className="flex w-full flex-col gap-1 border-b border-border/40 px-3 py-2.5 text-left transition hover:bg-surface-hover"
              >
                <div className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">
                    {c.titulo}
                  </span>
                  {c.no_leidos > 0 && (
                    <span className="flex h-4.5 min-w-[18px] shrink-0 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-white">
                      {c.no_leidos > 99 ? "99+" : c.no_leidos}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px]">
                  <span className={`shrink-0 rounded px-1.5 py-0.5 font-bold uppercase tracking-wide ${ESTADO_PILL_CLASS[c.estado] ?? "bg-muted/10 text-muted"}`}>
                    {ESTADO_LABEL[c.estado] ?? c.estado}
                  </span>
                  <span className="min-w-0 max-w-[9rem] truncate text-muted/80">{c.contraparte_nombre}</span>
                  <span className="ml-auto shrink-0 text-muted/70">{tiempoRelativo(c.ultima_actividad)}</span>
                </div>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => irA()}
            className="shrink-0 border-t border-border px-3 py-2 text-center text-[12px] font-bold text-accent hover:bg-accent/5"
          >
            Ver todo en Mensajes →
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        className={`pointer-events-auto group relative flex h-14 w-14 items-center justify-center rounded-full border-2 shadow-paper-lg transition active:scale-95 ${
          abierta
            ? "border-accent bg-accent text-white"
            : "border-accent/70 bg-surface-panel text-accent hover:border-accent hover:bg-accent hover:text-white"
        }`}
        title="Solicitudes y acciones en proceso"
        aria-label={abierta ? "Cerrar solicitudes en proceso" : "Ver solicitudes en proceso"}
        aria-expanded={abierta}
      >
        <span className="absolute -right-0.5 -top-0.5 flex h-4.5 min-w-[18px] items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-black text-white shadow-sm">
          {enProceso.length > 99 ? "99+" : enProceso.length}
        </span>
        <Icon name="inbox" size={22} weight={abierta ? "bold" : "regular"} />
      </button>
    </div>,
    document.body,
  );
}
