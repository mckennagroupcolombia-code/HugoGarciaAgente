import { useResumenMensajes } from "../../hooks/useCanalesEquipo";
import { useAppStore } from "../../stores/app";

/**
 * «Mensajes» es un solo apartado con dos partes (pedido del 5-oct-2026):
 * Solicitudes (el inbox de conversaciones de la Agenda) y Grupos (los canales del
 * equipo vinculados a módulos). La parte elegida se recuerda en la sesión.
 */
export type VistaMensajes = "solicitudes" | "grupos";

const CLAVE = "mck-mensajes-vista";

export function leerVistaMensajes(): VistaMensajes {
  try {
    return sessionStorage.getItem(CLAVE) === "grupos" ? "grupos" : "solicitudes";
  } catch {
    return "solicitudes";
  }
}

export function guardarVistaMensajes(v: VistaMensajes) {
  try {
    sessionStorage.setItem(CLAVE, v);
  } catch {
    /* sin almacenamiento: solo esta vez */
  }
}

/** Cambia «Mensajes» a otra parte desde dentro de la bandeja (MensajesConGrupos escucha). */
export const EVENTO_VISTA_MENSAJES = "mck-mensajes-vista";
export function irAVistaMensajes(v: VistaMensajes) {
  guardarVistaMensajes(v);
  window.dispatchEvent(new CustomEvent<VistaMensajes>(EVENTO_VISTA_MENSAJES, { detail: v }));
}

export function SelectorMensajes({
  actual, onCambiar, conSolicitudes = true,
}: {
  actual: VistaMensajes;
  onCambiar: (v: VistaMensajes) => void;
  conSolicitudes?: boolean;
}) {
  const noLeidosGrupos = useResumenMensajes().data?.canales_no_leidos ?? 0;
  const opciones: { v: VistaMensajes; texto: string; n: number }[] = [
    ...(conSolicitudes ? [{ v: "solicitudes" as const, texto: "Solicitudes", n: 0 }] : []),
    { v: "grupos", texto: "Grupos", n: noLeidosGrupos },
  ];
  return (
    <div role="tablist" aria-label="Mensajes" className="flex shrink-0 items-center gap-1 px-2 pt-2">
      {opciones.map((o) => (
        <button
          key={o.v}
          type="button"
          role="tab"
          aria-selected={actual === o.v}
          onClick={() => onCambiar(o.v)}
          className={`mck-btn-no-fx flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-bold transition ${
            actual === o.v ? "border-accent bg-accent text-white" : "border-border bg-surface-input text-ink hover:border-accent/60"
          }`}
        >
          {o.texto}
          {o.n > 0 && (
            <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] text-white">
              {o.n > 99 ? "99+" : o.n}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Abre la solicitud en Mensajes → Solicitudes (InboxConversaciones la abre con `abrirTicketId`). */
export function abrirSolicitud(ticketId: number) {
  const st = useAppStore.getState();
  guardarVistaMensajes("solicitudes");
  st.setAccionesBootTab(null);
  st.setTicketsBootView("mensajes");
  st.setCentroMandoView("mensajes");
  st.setSolicitudBoot({ abrirTicketId: ticketId });
  st.setPanel("hugo");
}
