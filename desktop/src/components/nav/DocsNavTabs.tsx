import { useAppStore, type DocsTab } from "../../stores/app";
import { Icon, type UiIconName } from "../../icons";
import ScrollableTabList from "./ScrollableTabList";

/**
 * Las tres vistas en el orden en que se trabaja: ver qué falta → editar el documento → el PDF
 * queda en la biblioteca. Cada una dice en una línea para qué sirve; antes eran tres iconos
 * apilados («Revisión guiada · Biblioteca · Ficha Técnica COA SDS») que no decían por dónde empezar.
 */
const TABS: { id: DocsTab; paso: string; label: string; ayuda: string; icon: UiIconName }[] = [
  { id: "revision", paso: "1", label: "Qué falta", ayuda: "productos sin FT, COA o SDS", icon: "listChecks" },
  { id: "completo", paso: "2", label: "Editar documento", ayuda: "ficha técnica · COA · SDS", icon: "file" },
  { id: "biblioteca", paso: "3", label: "Biblioteca", ayuda: "PDF generados", icon: "books" },
];

/** Pestañas de Docs técnicos en el cabezote: quedan fijas arriba al desplazar el formulario. */
export default function DocsNavTabs() {
  const tab = useAppStore((s) => s.docsTab);
  const setTab = useAppStore((s) => s.setDocsTab);
  const retorno = useAppStore((s) => s.tallerRetorno);
  const volver = useAppStore((s) => s.volverAlTaller);
  return (
    <div className="flex min-w-0 items-center gap-2">
      {retorno && (
        <button
          type="button"
          onClick={volver}
          title={`Volver al taller de combos: ${retorno.nombre}`}
          className="flex max-w-[16rem] shrink-0 items-center gap-1.5 rounded-lg border border-accent/60 bg-accent/10 px-2.5 py-1.5 text-left text-[12px] font-semibold text-accent hover:bg-accent/20"
        >
          <span aria-hidden="true">←</span>
          <span className="min-w-0">
            <span className="block font-mono text-[9.5px] uppercase tracking-wide text-muted">Taller</span>
            <span className="block truncate">{retorno.nombre}</span>
          </span>
        </button>
      )}
      <ScrollableTabList aria-label="Secciones de Docs técnicos">
        {TABS.map((t, i) => {
          const selected = tab === t.id;
          return (
            <div key={t.id} className="flex shrink-0 items-center gap-1">
              {i > 0 && <span aria-hidden="true" className="px-0.5 text-[11px] text-muted">→</span>}
              <button
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setTab(t.id)}
                className={[
                  "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors",
                  selected
                    ? "border-accent bg-accent text-white"
                    : "border-border bg-surface-input text-ink hover:border-accent/60 hover:bg-surface-hover",
                ].join(" ")}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[10.5px] font-bold ${selected ? "bg-white/25 text-white" : "bg-accent/15 text-accent"}`}
                >
                  {t.paso}
                </span>
                <Icon name={t.icon} size={15} weight="bold" className="shrink-0" />
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-bold leading-tight">{t.label}</span>
                  <span className={`block text-[10.5px] leading-tight ${selected ? "text-white/80" : "text-muted"}`}>{t.ayuda}</span>
                </span>
              </button>
            </div>
          );
        })}
      </ScrollableTabList>
    </div>
  );
}
