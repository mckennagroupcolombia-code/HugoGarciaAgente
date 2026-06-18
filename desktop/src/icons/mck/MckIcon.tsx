import type { ReactNode } from "react";
import { MCK_STROKE, type MckSvgProps } from "./types";

export interface MckIconFrameProps extends MckSvgProps {
  children: ReactNode;
}

/**
 * Contenedor SVG McKenna: lineal, trazo uniforme, extremos y uniones redondeados.
 */
export function MckIconFrame({
  children,
  size = 24,
  weight = "regular",
  className,
  ...rest
}: MckIconFrameProps) {
  const strokeWidth = MCK_STROKE[weight];
  const duotone = weight === "duotone";
  const cls = ["mck-icon", duotone ? "mck-icon--duotone" : "", className]
    .filter(Boolean)
    .join(" ");
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cls}
      aria-hidden={rest["aria-label"] ? undefined : true}
      {...rest}
    >
      {duotone && <circle cx="12" cy="12" r="9.5" className="mck-icon__duotone-bg" />}
      {children}
    </svg>
  );
}
