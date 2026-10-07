import { useEffect, useState, type ReactNode } from "react";
import { useAppStore } from "../../stores/app";
import ChatEquipoPanel from "./ChatEquipoPanel";
import { EVENTO_VISTA_MENSAJES, SelectorMensajes, guardarVistaMensajes, leerVistaMensajes, type VistaMensajes } from "./SelectorMensajes";
import { useBandejaAngosta } from "../../lib/bandeja";

/** Envuelve el inbox de Solicitudes y agrega los Grupos al lado, en el mismo apartado.
 *  En pantallas angostas la bandeja ya trae los grupos (BandejaUnificada): el selector solo
 *  aparece estando en la lista completa de Grupos, para volver. */
export default function MensajesConGrupos({ children }: { children: ReactNode }) {
  const [vista, setVista] = useState<VistaMensajes>(leerVistaMensajes);
  const cambiar = (v: VistaMensajes) => {
    guardarVistaMensajes(v);
    setVista(v);
  };
  // Abrir una solicitud desde un grupo (o desde cualquier parte) muestra la parte de Solicitudes.
  const abrirTicketId = useAppStore((s) => s.solicitudBoot?.abrirTicketId ?? null);
  useEffect(() => {
    if (abrirTicketId != null) setVista("solicitudes");
  }, [abrirTicketId]);
  useEffect(() => {
    const oir = (e: Event) => setVista((e as CustomEvent<VistaMensajes>).detail);
    window.addEventListener(EVENTO_VISTA_MENSAJES, oir);
    return () => window.removeEventListener(EVENTO_VISTA_MENSAJES, oir);
  }, []);
  const angosta = useBandejaAngosta();
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {(!angosta || vista === "grupos") && <SelectorMensajes actual={vista} onCambiar={cambiar} />}
      {vista === "grupos" ? (
        <div className="flex min-h-0 min-w-0 flex-1 p-2 max-sm:p-0">
          <ChatEquipoPanel embebido />
        </div>
      ) : (
        children
      )}
    </div>
  );
}
