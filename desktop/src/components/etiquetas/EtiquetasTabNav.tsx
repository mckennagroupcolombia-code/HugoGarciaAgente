import { IllustrationIcon } from "../../icons/IllustrationIcon";
import type { IllustrationTone } from "../../icons/IllustrationIcon";
import type { UiIconName } from "../../icons";
import type { EtiquetasTab } from "../../stores/app";

interface TabDef {
  id: EtiquetasTab;
  label: string;
  shortLabel: string;
  icon: UiIconName;
  tone: IllustrationTone;
  description: string;
}

const TABS: TabDef[] = [
  {
    id: "imprimir",
    label: "Imprimir",
    shortLabel: "Imprimir",
    icon: "printer",
    tone: "accent",
    description: "Archivos PNG listos para imprimir",
  },
  {
    id: "studio",
    label: "Studio visual",
    shortLabel: "Studio",
    icon: "palette",
    tone: "plum",
    description: "Plantillas y diseño de etiquetas",
  },
  {
    id: "inventario",
    label: "Papel y tinta",
    shortLabel: "Inventario",
    icon: "package",
    tone: "leaf",
    description: "Rollos, consumibles y niveles",
  },
  {
    id: "codigos_ean",
    label: "Códigos EAN",
    shortLabel: "EAN",
    icon: "barcode",
    tone: "sky",
    description: "Generación y registro EAN-13",
  },
];

interface Props {
  active: EtiquetasTab;
  onChange: (tab: EtiquetasTab) => void;
  /** Pestañas permitidas (si no se pasa, solo Imprimir). */
  allowedTabs: readonly EtiquetasTab[];
}

export function EtiquetasTabNav({ active, onChange, allowedTabs }: Props) {
  const permitidas = new Set(allowedTabs.length > 0 ? allowedTabs : (["imprimir"] as EtiquetasTab[]));
  const tabs = TABS.filter((t) => permitidas.has(t.id));
  const current = tabs.find((t) => t.id === active) ?? tabs[0] ?? TABS[0];
  /** Con una sola sección no tiene sentido mostrar el botón de pestaña. */
  const mostrarNav = tabs.length > 1;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start gap-3">
        <IllustrationIcon
          name={current.icon}
          size={40}
          tone={current.tone}
          className="mck-illus-icon--hoverable shrink-0"
        />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-extrabold text-ink">Etiquetas</h2>
          <p className="mt-0.5 text-sm text-muted">{current.description}</p>
        </div>
      </div>

      {mostrarNav && (
        <nav
          className="mck-card flex gap-1 overflow-x-auto p-1"
          aria-label="Secciones de etiquetas"
        >
          {tabs.map((t) => {
            const isActive = active === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onChange(t.id)}
                className={`mck-press flex min-w-0 flex-1 items-center justify-center gap-2 rounded-paper px-2 py-2.5 text-sm font-semibold transition sm:px-3 ${
                  isActive
                    ? "bg-accent text-white shadow-paper-sm"
                    : "text-ink-secondary hover:bg-surface-hover hover:text-ink"
                }`}
              >
                <IllustrationIcon
                  name={t.icon}
                  size={22}
                  tone={isActive ? "accent" : t.tone}
                  bubble={!isActive}
                  className={isActive ? "text-white [&_.mck-illus-icon__glyph]:text-white" : ""}
                />
                <span className="hidden truncate sm:inline">{t.label}</span>
                <span className="truncate sm:hidden">{t.shortLabel}</span>
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}
