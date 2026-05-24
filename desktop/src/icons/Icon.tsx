import { resolvePhosphorIcon } from "./registry";
import type { IconProps } from "./types";

/**
 * Icono unificado del panel (Phosphor Icons).
 * Uso: `<Icon name="dashboard" />` o `<Icon name="refresh" size={16} weight="bold" />`
 */
export function Icon({
  name,
  size = 20,
  weight = "regular",
  className,
  ...rest
}: IconProps) {
  const Comp = resolvePhosphorIcon(name);
  return (
    <Comp
      size={size}
      weight={weight}
      className={className}
      aria-hidden={rest["aria-label"] ? undefined : true}
      {...rest}
    />
  );
}
