import { EtiquetasStudioCatalogo } from "./EtiquetasStudioCatalogo";

/** Workbench: formato → plantilla (.ai + PDF) → escanear líneas y guardar diagramación. */
export function TabPlantillasPanel() {
  return (
    <EtiquetasStudioCatalogo
      layout="workbench"
      modoSeleccion="fila"
      accionLabel={null}
      modoModeloRelacionado
      formatoInicial="500 g"
      onSeleccionar={() => {}}
    />
  );
}
