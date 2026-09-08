import { lazy } from "react";
import { useAppStore } from "../stores/app";
import KeepAliveHubShell from "./nav/KeepAliveHubShell";

const RentabilidadPanel = lazy(() => import("./RentabilidadPanel"));
const PublicidadPanel = lazy(() => import("./PublicidadPanel"));
const SaludNegocioPanel = lazy(() => import("./SaludNegocioPanel"));

type NegocioPanelId = "rentabilidad" | "publicidad" | "salud-negocio";

function renderSubpanel(id: NegocioPanelId) {
  switch (id) {
    case "publicidad":
      return <PublicidadPanel />;
    case "salud-negocio":
      return <SaludNegocioPanel />;
    case "rentabilidad":
    default:
      return <RentabilidadPanel />;
  }
}

/** Hub Negocio: indicadores de "cómo va el negocio" — Rentabilidad, Publicidad
 * MeLi, Salud del Negocio. Se mudaron aquí desde Contabilidad porque no tienen
 * relación con la partida doble (solo convivían ahí por historia). Rentabilidad
 * se mantiene montada al cambiar de pestaña (edición en paralelo), igual que
 * cuando vivía en Contabilidad. */
export default function NegocioPanel() {
  const panel = useAppStore((s) => s.panel);
  const activeId: NegocioPanelId =
    panel === "publicidad" || panel === "salud-negocio" ? panel : "rentabilidad";

  return (
    <KeepAliveHubShell<NegocioPanelId>
      activeId={activeId}
      keepAliveIds={["rentabilidad"]}
      fullBleedIds={["rentabilidad"]}
      renderPanel={renderSubpanel}
    />
  );
}
