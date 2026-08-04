import { useMemo } from "react";
import { useTicketsAuth } from "../stores/ticketsAuth";
import { puedeVerModuloContabilidad } from "../lib/contabilidadAccess";
import ContabilidadHerramientas from "./ContabilidadHerramientas";
import HubNavTabs from "./nav/HubNavTabs";

/**
 * Pestañas Contabilidad + herramientas en el cabezote.
 * Facturación es pestaña plana (como Rentabilidad), sin desplegable.
 */
export default function ContabilidadNavTabs() {
  const { user } = useTicketsAuth();
  const puedeCrearSiigo = Boolean(puedeVerModuloContabilidad(user, "productos-siigo"));

  const leading = useMemo(
    () => <ContabilidadHerramientas puedeCrearSiigo={puedeCrearSiigo} />,
    [puedeCrearSiigo],
  );

  return <HubNavTabs sectionId="contabilidad" leading={leading} />;
}
