import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTicketsAuth } from "../../stores/ticketsAuth";
import { useAppStore } from "../../stores/app";
import { Icon } from "../../icons";
import { CalculadoraPad } from "../CalculadoraMagica";
import FloatingToolWindow, { defaultFloatRect } from "../FloatingToolWindow";

/**
 * Calculadora siempre a mano: burbuja flotante global, igual que la de «En proceso»
 * (SolicitudesEnProcesoFab), a su izquierda para no taparla. Abre la misma ventana
 * flotante que antes vivía solo en el cabezote de Contabilidad/Diseño (id "calc", así
 * conserva la posición que cada quien le dio).
 */
export default function CalculadoraFab() {
  const [abierta, setAbierta] = useState(false);
  const user = useTicketsAuth((s) => s.user);
  // En el celular, dentro de Mensajes/Grupos, la burbuja tapaba la hora y la etiqueta de cada fila.
  const panel = useAppStore((s) => s.panel);
  const enMensajes = panel === "hugo" || panel === "tickets" || panel === "chat-equipo";

  useEffect(() => {
    if (!abierta) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierta(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [abierta]);

  if (!user || typeof document === "undefined") return null;

  return (
    <>
      {createPortal(
        <div
          data-fab="calculadora"
          className={`pointer-events-none fixed bottom-5 right-[5.25rem] z-[900] max-md:bottom-[5.5rem] sm:bottom-6 sm:right-[5.75rem] ${enMensajes && !abierta ? "max-md:hidden" : ""}`}
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        >
          <button
            type="button"
            onClick={() => setAbierta((v) => !v)}
            className={`pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full border-2 shadow-paper-lg transition active:scale-95 ${
              abierta
                ? "border-accent bg-accent text-white"
                : "border-accent/70 bg-surface-panel text-accent hover:border-accent hover:bg-accent hover:text-white"
            }`}
            title="Calculadora"
            aria-label={abierta ? "Cerrar calculadora" : "Abrir calculadora"}
            aria-pressed={abierta}
          >
            <Icon name="calculator" size={22} weight={abierta ? "bold" : "regular"} />
          </button>
        </div>,
        document.body,
      )}
      {abierta && (
        <FloatingToolWindow
          id="calc"
          title="Calculadora"
          titleExtra={<Icon name="calculator" size={14} weight="regular" className="text-accent" />}
          headerClassName="border-border bg-accent/10 text-accent"
          borderClassName="border-accent/50"
          defaultRect={defaultFloatRect("tr", 272, 600)}
          minWidth={240}
          minHeight={360}
          zIndex={900}
          onClose={() => setAbierta(false)}
        >
          <CalculadoraPad bare onClose={() => setAbierta(false)} />
        </FloatingToolWindow>
      )}
    </>
  );
}
