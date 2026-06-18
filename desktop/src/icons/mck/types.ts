import type { SVGAttributes } from "react";

/** Grosor visual del trazo (compatible con la API anterior de Phosphor). */
export type MckIconWeight = "light" | "regular" | "bold" | "duotone" | "fill";

export const MCK_STROKE: Record<MckIconWeight, number> = {
  light: 1.25,
  regular: 1.5,
  bold: 1.75,
  /** Trazo fino + relleno suave de acento (estilo UI illustration). */
  duotone: 1.5,
  /** Compatibilidad API anterior: trazo más marcado. */
  fill: 2,
};

export interface MckSvgProps extends SVGAttributes<SVGSVGElement> {
  size?: number;
  weight?: MckIconWeight;
}
