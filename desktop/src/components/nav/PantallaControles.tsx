import { useEffect, useState } from "react";
import { Icon } from "../../icons";
import { useAppStore } from "../../stores/app";
import { usePantallaCompleta, soportaPantallaCompleta } from "../../hooks/usePantallaCompleta";
import { abrirVentanaAuxiliar } from "../../lib/ventanaAuxiliar";

/**
 * Los dos controles de ventana del cabezote, al lado del tema.
 *
 * — Pantalla completa: el panel ocupa el monitor entero, sin barra del
 *   navegador ni pestañas. Sirve en cualquier apartado, no en uno en concreto:
 *   quien está causando movimientos o revisando el stock una hora seguida gana
 *   ~120 px de alto, que es una fila más de tabla y la barra de acciones sin
 *   tener que desplazar.
 * — Ventana aparte: el apartado actual en su propia ventana del sistema, para
 *   dejarlo en el segundo monitor. Las dos ventanas son la misma app con la
 *   misma sesión, así que lo que se guarda en una se ve en la otra al refrescar.
 */
export default function PantallaControles() {
  const panel = useAppStore((s) => s.panel);
  const { activa, alternar } = usePantallaCompleta();
  const [avisoPopup, setAvisoPopup] = useState(false);

  useEffect(() => {
    if (!avisoPopup) return;
    const t = window.setTimeout(() => setAvisoPopup(false), 6000);
    return () => window.clearTimeout(t);
  }, [avisoPopup]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (!abrirVentanaAuxiliar(panel)) setAvisoPopup(true);
        }}
        className="mck-press hidden shrink-0 rounded-full p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-ink lg:inline-flex"
        aria-label="Abrir este apartado en una ventana aparte"
        title="Abrir en ventana aparte — para dejarlo en el otro monitor"
      >
        <Icon name="monitor" size={18} weight="regular" />
      </button>

      {soportaPantallaCompleta() && (
        <button
          type="button"
          onClick={() => void alternar()}
          aria-pressed={activa}
          className="mck-press shrink-0 rounded-full p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-ink"
          aria-label={activa ? "Salir de pantalla completa" : "Pantalla completa"}
          title={activa ? "Salir de pantalla completa (F11 o Esc)" : "Pantalla completa (F11)"}
        >
          <Icon name={activa ? "collapse" : "expand"} size={18} weight="regular" />
        </button>
      )}

      {avisoPopup && (
        <span
          role="status"
          className="fixed bottom-4 left-1/2 z-[80] -translate-x-1/2 rounded-lg border border-accent-sun/50 bg-accent-sun/15 px-3 py-2 text-[12px] font-semibold text-ink shadow-paper-lg"
        >
          El navegador bloqueó la ventana. Permite las ventanas emergentes de este sitio y
          vuelve a intentarlo.
        </span>
      )}
    </>
  );
}
