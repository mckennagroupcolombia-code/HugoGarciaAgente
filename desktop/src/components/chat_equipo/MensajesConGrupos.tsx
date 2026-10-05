import { useState, type ReactNode } from "react";
import ChatEquipoPanel from "./ChatEquipoPanel";
import { SelectorMensajes, guardarVistaMensajes, leerVistaMensajes, type VistaMensajes } from "./SelectorMensajes";

/** Envuelve el inbox de Solicitudes y agrega los Grupos al lado, en el mismo apartado. */
export default function MensajesConGrupos({ children }: { children: ReactNode }) {
  const [vista, setVista] = useState<VistaMensajes>(leerVistaMensajes);
  const cambiar = (v: VistaMensajes) => {
    guardarVistaMensajes(v);
    setVista(v);
  };
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
