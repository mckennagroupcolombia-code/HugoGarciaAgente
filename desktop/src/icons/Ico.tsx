import { Icon } from "./Icon";
import { resolveTopicIcon } from "./emojiMap";

/**
 * Un icono lineal del set McKenna EN LÍNEA con el texto: mide lo que mide la letra que lo rodea
 * y toma su color. Reemplaza a los emojis de la interfaz (`<Ico e="📦" />`): el valor sigue siendo
 * el emoji —así se lee en el código qué se quiso decir— y `icons/emojiMap.ts` decide qué se dibuja.
 * Un emoji sin icono asignado se muestra tal cual, no como un círculo genérico.
 */
export function Ico({ e, className = "" }: { e: string; className?: string }) {
  const nombre = resolveTopicIcon(e);
  if (!nombre) return <span aria-hidden="true">{e}</span>;
  return <Icon name={nombre} weight="regular" className={`mck-ico ${className}`.trim()} />;
}
