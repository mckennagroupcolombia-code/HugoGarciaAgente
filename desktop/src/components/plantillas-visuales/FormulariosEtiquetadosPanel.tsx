/**
 * Formularios etiquetados — entrada dentro de Studio Visual (botón junto a
 * "Nueva plantilla" en PlantillasVisualesPanel). Reemplaza la versión
 * anterior (formato+categoría+lienzo canvas reusando el motor de
 * plantillas): ahora es una réplica HTML/Tailwind fiel de la ficha técnica
 * de materia prima (ver `../../components/etiqueta-ficha/ProductLabelForm`),
 * con sus propios modos vista/edición — sin el motor `PlantillaVisualDoc`.
 */
import ProductLabelForm from "../etiqueta-ficha/ProductLabelForm";

interface Props {
  onVolver: () => void;
}

export default function FormulariosEtiquetadosPanel({ onVolver }: Props) {
  return <ProductLabelForm onVolver={onVolver} />;
}
