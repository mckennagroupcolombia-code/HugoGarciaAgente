import type { SVGAttributes } from "react";

/** Grosor visual del trazo (compatible con la API anterior de Phosphor). */
export type MckIconWeight = "light" | "regular" | "bold" | "duotone" | "fill";

export const MCK_STROKE: Record<MckIconWeight, number> = {
  light: 1.5,
  regular: 1.75,
  bold: 2,
  /** Estilo lineal: mismo trazo que regular (sin relleno duotone). */
  duotone: 1.75,
  /** Compatibilidad API anterior: trazo más marcado. */
  fill: 2.25,
};

export interface MckSvgProps extends SVGAttributes<SVGSVGElement> {
  size?: number;
  weight?: MckIconWeight;
}
