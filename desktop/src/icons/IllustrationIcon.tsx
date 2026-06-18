import type { SVGAttributes } from "react";
import { Icon } from "./Icon";
import type { IconName, IconWeight } from "./types";

export type IllustrationTone =
  | "accent"
  | "sky"
  | "leaf"
  | "rose"
  | "plum"
  | "sun"
  | "neutral";

const TONE_CLASS: Record<IllustrationTone, string> = {
  accent: "mck-illus-icon--accent",
  sky: "mck-illus-icon--sky",
  leaf: "mck-illus-icon--leaf",
  rose: "mck-illus-icon--rose",
  plum: "mck-illus-icon--plum",
  sun: "mck-illus-icon--sun",
  neutral: "mck-illus-icon--neutral",
};

export interface IllustrationIconProps extends Omit<SVGAttributes<SVGSVGElement>, "name"> {
  name: IconName;
  /** Tamaño del contenedor (default 28). */
  size?: number;
  weight?: IconWeight;
  /** Fondo suave tipo UI illustration (default true). */
  bubble?: boolean;
  tone?: IllustrationTone;
}

/**
 * Icono minimalista con burbuja pastel — estilo vector UI illustration
 * (trazo fino + fondo suave redondeado).
 */
export function IllustrationIcon({
  name,
  size = 28,
  weight = "duotone",
  bubble = true,
  tone = "accent",
  className,
  ...rest
}: IllustrationIconProps) {
  const glyph = Math.round(size * 0.52);
  const icon = (
    <Icon
      name={name}
      size={glyph}
      weight={weight}
      className="mck-illus-icon__glyph"
      {...rest}
    />
  );

  if (!bubble) {
    return (
      <span
        className={["mck-illus-icon", "mck-illus-icon--plain", TONE_CLASS[tone], className]
          .filter(Boolean)
          .join(" ")}
        style={{ width: size, height: size }}
        aria-hidden
      >
        {icon}
      </span>
    );
  }

  return (
    <span
      className={["mck-illus-icon", TONE_CLASS[tone], className].filter(Boolean).join(" ")}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <span className="mck-illus-icon__bubble" />
      {icon}
    </span>
  );
}
