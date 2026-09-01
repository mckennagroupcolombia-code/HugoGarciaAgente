import { useAppStore } from "../stores/app";
import { useTicketsAuth } from "../stores/ticketsAuth";
import { useUiMode } from "../stores/uiMode";
import { modoAvanzadoEfectivo } from "../lib/adminAccess";
import { puedeVerSeccionPanel } from "../lib/panelAccess";
import { NAV_SECTIONS, NAV_CATEGORY_LABEL } from "../lib/navStructure";
import { HUB_SECTION_ICON, itemsVisiblesHub, primerPanelHub } from "../lib/hubNav";
import { Icon } from "../icons";
import { useNavegarPanel } from "../hooks/useNavegarPanel";

/** Franja de accesos a las demás secciones — en vez de mantenerlas siempre visibles
 * en el sidebar, aparecen aquí como el punto de entrada principal desde Inicio,
 * usando las mismas reglas de permisos/orden que ya usa el menú lateral. */
export default function InicioLauncher() {
  const { user } = useTicketsAuth();
  const panel = useAppStore((s) => s.panel);
  const advancedToggle = useUiMode((s) => s.advanced);
  const advanced = modoAvanzadoEfectivo(user, advancedToggle);
  const navegarPanel = useNavegarPanel();

  const secciones = NAV_SECTIONS.filter((s) => s.id !== "inicio")
    .filter((s) => !s.advancedOnly || advanced)
    .filter((s) => itemsVisiblesHub(s.items, user, advanced, puedeVerSeccionPanel, s.id).length > 0);

  if (secciones.length === 0) return null;

  function ir(sectionId: (typeof secciones)[number]["id"]) {
    const next = primerPanelHub(sectionId, user, advanced, puedeVerSeccionPanel, panel);
    if (next) navegarPanel(next);
  }

  return (
    <div className="mb-4">
      <p className="mb-1.5 px-0.5 text-[11px] font-bold uppercase tracking-wide text-muted">Ir a…</p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {secciones.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => ir(s.id)}
            title={NAV_CATEGORY_LABEL[s.id]}
            className="mck-press flex shrink-0 w-[4.6rem] flex-col items-center gap-1 rounded-2xl border border-border bg-[rgb(var(--mck-card-bg))] px-2 py-2.5 text-center transition hover:border-accent/50 hover:-translate-y-0.5"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent/10 text-accent">
              <Icon name={HUB_SECTION_ICON[s.id]} size={18} weight="duotone" />
            </span>
            <span className="text-[10px] font-bold leading-tight text-ink-secondary">{NAV_CATEGORY_LABEL[s.id]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
