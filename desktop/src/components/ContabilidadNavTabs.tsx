import HubNavTabs from "./nav/HubNavTabs";

/**
 * Pestañas Contabilidad en el cabezote.
 * Facturación es pestaña plana (como Rentabilidad), sin desplegable.
 * Herramientas (Alegra / factura / calc) viven a la izquierda de Temas en Layout.
 */
export default function ContabilidadNavTabs() {
  return <HubNavTabs sectionId="contabilidad" />;
}
