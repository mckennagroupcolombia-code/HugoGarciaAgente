import { useEffect, useState, type ReactNode } from "react";
import { useAppStore } from "../../stores/app";
import ChatEquipoPanel from "./ChatEquipoPanel";
import { SelectorMensajes, guardarVistaMensajes, leerVistaMensajes, type VistaMensajes } from "./SelectorMensajes";

/** Envuelve el inbox de Solicitudes y agrega los Grupos al lado, en el mismo apartado. */
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
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <SelectorMensajes actual={vista} onCambiar={cambiar} />
      {vista === "grupos" ? (
        <div className="flex min-h-0 min-w-0 flex-1 p-2">
          <ChatEquipoPanel embebido />
        </div>
      ) : (
        children
      )}
    </div>
  );
}
