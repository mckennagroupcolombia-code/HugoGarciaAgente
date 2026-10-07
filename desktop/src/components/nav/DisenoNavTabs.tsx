import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTicketsAuth } from "../../stores/ticketsAuth";
import { useAppStore, type EtiquetasTab } from "../../stores/app";
import { tabsEtiquetasVisibles } from "../../lib/studioVisualAccess";
import { guardarUltimoPanelHub } from "../../lib/hubNav";
import { Icon, type UiIconName } from "../../icons";
import { HUB_TAB_LABEL, hubTabClass } from "../../lib/hubTabClass";
import ScrollableTabList from "./ScrollableTabList";
import { puedeVerSeccionPanel } from "../../lib/panelAccess";
import { precargarDiseno } from "../../lib/etiquetasPrefetch";

/** En una fila, icono al lado del nombre: apilados ocupaban el doble de alto
 *  que el resto de botones del cabezote. `!min-h-0` gana a la altura mínima de
 *  `.mck-hub-tab-etiquetado` en index.css. */
const COMPACTA = "mck-hub-tab-etiquetado flex-row !min-h-0 !py-1";

const TABS: { id: EtiquetasTab; label: string; shortLabel: string; icon: UiIconName }[] = [
  { id: "imprimir", label: "Imprimir", shortLabel: "Imprimir", icon: "printer" },
  { id: "studio", label: "Studio visual", shortLabel: "Studio", icon: "palette" },
  { id: "codigos_ean", label: "Códigos EAN", shortLabel: "EAN", icon: "barcode" },
];

/**
 * Pestañas de Diseño en el cabezote, a la izquierda de Temas y estilo visual.
 */
export default function DisenoNavTabs() {
  const panel = useAppStore((s) => s.panel);
  const tab = useAppStore((s) => s.etiquetasTab);
  const setTab = useAppStore((s) => s.setEtiquetasTab);
  const setPanel = useAppStore((s) => s.setPanel);
  const user = useTicketsAuth((s) => s.user);
  const qc = useQueryClient();
  const allowed = tabsEtiquetasVisibles(user);
  const tabs = TABS.filter((t) => allowed.includes(t.id));
  // Papel y tinta vive dentro de Imprimir (27-sep-2026): la pestaña Imprimir queda marcada en los dos.
  const tabNav: EtiquetasTab = tab === "inventario" ? "imprimir" : tab;
  const activo = tabs.some((t) => t.id === tabNav) ? tabNav : (tabs[0]?.id ?? "imprimir");
  // Documentos técnicos (FT · COA · SDS) es otro panel, pero vive en Diseño desde el 27-sep-2026.
  const enDocs = panel === "fichas";
  const verDocs = Boolean(user && puedeVerSeccionPanel(user, "fichas"));
  // Fórmulas de producto (1-oct-2026): otro panel, con permiso propio (`formulas`).
  const enFormulas = panel === "formulas";
  const verFormulas = Boolean(user && puedeVerSeccionPanel(user, "formulas"));
  // Desarrollar idea (4-oct-2026): la idea de producto en un cladograma, con permiso propio (`ideas`).
  const enIdeas = panel === "ideas";
  const verIdeas = Boolean(user && puedeVerSeccionPanel(user, "ideas"));

  useEffect(() => {
    if (panel === "etiquetas" || panel === "etiquetas-config") {
      guardarUltimoPanelHub("diseno", "etiquetas");
    }
    if (panel === "fichas") guardarUltimoPanelHub("diseno", "fichas");
    if (panel === "formulas") guardarUltimoPanelHub("diseno", "formulas");
    if (panel === "ideas") guardarUltimoPanelHub("diseno", "ideas");
  }, [panel]);

  // Con el hub de Diseño visible ya se pueden pedir las etiquetas de todas las
  // pestañas: al hacer clic la vista aparece con datos, sin "Cargando…".
  useEffect(() => {
    precargarDiseno(qc, user);
  }, [qc, user]);

  if (tabs.length === 0 && !verDocs && !verFormulas && !verIdeas) return null;

  function irAEtiquetas(id: EtiquetasTab) {
    setPanel("etiquetas");
    setTab(id);
  }

  return (
    <ScrollableTabList aria-label="Secciones de Diseño" justify="start">
      {tabs.map((t) => {
        const selected = !enDocs && !enFormulas && !enIdeas && activo === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-label={t.label}
            title={t.label}
            onClick={() => irAEtiquetas(t.id)}
            onMouseEnter={() => precargarDiseno(qc, user)}
            onFocus={() => precargarDiseno(qc, user)}
            className={hubTabClass(selected, COMPACTA)}
          >
            <Icon name={t.icon} size={16} weight="bold" className="shrink-0" />
            <span className={HUB_TAB_LABEL}>{t.label}</span>
          </button>
        );
      })}
      {verDocs && (
        <button
          type="button"
          role="tab"
          aria-selected={enDocs}
          aria-label="Documentos técnicos"
          title="Ficha técnica, COA y SDS de cada producto"
          onClick={() => setPanel("fichas")}
          className={hubTabClass(enDocs, COMPACTA)}
        >
          <Icon name="file" size={16} weight="bold" className="shrink-0" />
          <span className={HUB_TAB_LABEL}>Documentos técnicos</span>
        </button>
      )}
      {verFormulas && (
        <button
          type="button"
          role="tab"
          aria-selected={enFormulas}
          aria-label="Fórmulas"
          title="Fórmulas de producto: ingredientes, porcentajes y procedimiento"
          onClick={() => setPanel("formulas")}
          className={hubTabClass(enFormulas, COMPACTA)}
        >
          <Icon name="flask" size={16} weight="bold" className="shrink-0" />
          <span className={HUB_TAB_LABEL}>Fórmulas</span>
        </button>
      )}
      {verIdeas && (
        <button
          type="button"
          role="tab"
          aria-selected={enIdeas}
          aria-label="Desarrollar idea"
          title="Desarrollar una idea de producto en un cladograma"
          onClick={() => setPanel("ideas")}
          className={hubTabClass(enIdeas, COMPACTA)}
        >
          <Icon name="tree" size={16} weight="bold" className="shrink-0" />
          <span className={HUB_TAB_LABEL}>Desarrollar idea</span>
        </button>
      )}
    </ScrollableTabList>
  );
}
