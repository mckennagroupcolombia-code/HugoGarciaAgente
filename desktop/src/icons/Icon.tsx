import { MckIconFrame } from "./mck/MckIcon";
import { resolveMckPaths } from "./mck/registry";
import type { IconProps } from "./types";

/**
 * Icono unificado del panel (set SVG McKenna: lineal, trazo uniforme, bordes redondeados).
 * Uso: `<Icon name="dashboard" />` o `<Icon name="refresh" size={16} weight="bold" />`
 */
export function Icon({
  name,
  size = 20,
  weight = "duotone",
  className,
  ...rest
}: IconProps) {
  const paths = resolveMckPaths(name);
  if (!paths) {
    if (import.meta.env.DEV) {
      console.warn(`[Icon] Sin SVG para "${name}"`);
    }
    return null;
  }
  return (
    <MckIconFrame size={size} weight={weight} className={className} {...rest}>
      {paths}
    </MckIconFrame>
  );
}
