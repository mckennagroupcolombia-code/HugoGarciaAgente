import { useMemo, type ReactNode } from "react";
import { Icon } from "../icons";
import { type Panel } from "../stores/app";
import { useTicketsAuth } from "../stores/ticketsAuth";
import { PANEL_INFO } from "../lib/panelInfo";
import { NAV_PANEL_ORDER } from "../lib/navStructure";
import { puedeVerSeccionPanel } from "../lib/panelAccess";
import { usePantallaCompleta, soportaPantallaCompleta } from "../hooks/usePantallaCompleta";

/**
 * El marco de una ventana auxiliar: casi nada.
 *
 * Es una pantalla de apoyo puesta en el otro monitor, así que no repite la
 * navegación ni el cabezote grande de la ventana principal —serían 160 px de
 * alto gastados en algo que ya se tiene al lado—. Solo una barra delgada que
 * dice qué se está mirando y deja cambiarlo, porque la gracia de la auxiliar es
 * dejarla fija en un apartado mientras la principal se mueve.
 *
 * El apartado va CONTROLADO desde afuera, no en `useAppStore`, y esa es la
 * decisión importante: las dos ventanas comparten `localStorage`, así que si la
 * auxiliar guardara su panel en el store, la ventana principal abriría la
 * próxima vez en el apartado que se dejó en el monitor de al lado. Acá el panel
 * de la auxiliar vive y muere con la ventana.
 *
 * Todo lo demás sí se comparte, que es lo que se quiere: misma sesión, mismo
 * tema, mismos permisos. Lo que NO hace es registrar presencia (`usePanelSession`,
 * que vive en Layout): si lo hiciera, la misma persona aparecería dos veces en
 * «Equipo conectado» por tener abierto su segundo monitor.
 */
export default function VentanaAuxiliarShell({
  panel,
  onPanel,
  children,
}: {
  panel: Panel;
  onPanel: (p: Panel) => void;
  children: ReactNode;
}) {
  const user = useTicketsAuth((s) => s.user);
  const { activa, alternar } = usePantallaCompleta();

  const disponibles = useMemo(
    () => NAV_PANEL_ORDER.filter((p) => puedeVerSeccionPanel(user, p)),
    [user],
  );
  const titulo = PANEL_INFO[panel]?.label ?? "Panel";

  return (
    <div className="mck-app-shell flex h-dvh max-w-[100vw] flex-col overflow-hidden bg-surface">
      <header className="flex shrink-0 items-center gap-2 border-b border-border/80 bg-surface-panel px-3 py-1.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
          <Icon name="monitor" size={14} weight="duotone" />
        </span>
        <span className="hidden font-mono text-[9.5px] font-bold uppercase tracking-wider text-muted sm:inline">
          Ventana auxiliar
        </span>
        <h1 className="min-w-0 truncate text-[14px] font-bold text-ink">{titulo}</h1>

        <label className="ml-auto flex shrink-0 items-center gap-1.5">
          <span className="sr-only">Apartado que muestra esta ventana</span>
          <select
            value={panel}
            onChange={(e) => onPanel(e.target.value as Panel)}
            className="rounded-md border border-border bg-surface px-2 py-1 text-[11.5px] font-semibold text-ink outline-none focus:border-accent"
            title="Cambiar el apartado de esta ventana"
          >
            {disponibles.map((p) => (
              <option key={p} value={p}>
                {PANEL_INFO[p]?.label ?? p}
              </option>
            ))}
          </select>
        </label>

        {soportaPantallaCompleta() && (
          <button
            type="button"
            onClick={() => void alternar()}
            aria-pressed={activa}
            className="mck-press shrink-0 rounded-full p-1 text-muted transition-colors hover:bg-surface-hover hover:text-ink"
            aria-label={activa ? "Salir de pantalla completa" : "Pantalla completa"}
            title={activa ? "Salir de pantalla completa (F11 o Esc)" : "Pantalla completa (F11)"}
          >
            <Icon name={activa ? "collapse" : "expand"} size={16} weight="regular" />
          </button>
        )}
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 pt-2">{children}</main>
    </div>
  );
}
