import type { ButtonHTMLAttributes } from "react";
import { Icon, type IconName } from "../../../icons";
import { TONE_TEXT, type Tone } from "./tokens";

type IconButtonVariant = "ghost" | "outline" | "solid";
type IconButtonSize = "xs" | "sm" | "md";

const SIZE_CLS: Record<IconButtonSize, string> = {
  xs: "h-6 w-6",
  sm: "h-8 w-8",
  md: "h-9 w-9",
};

const ICON_SIZE: Record<IconButtonSize, number> = {
  xs: 14,
  sm: 16,
  md: 18,
};

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
  icon: IconName;
  /** Obligatorio: se usa como aria-label y title — todo botón-solo-símbolo queda accesible. */
  label: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  tone?: Tone;
}

export function IconButton({
  icon,
  label,
  variant = "ghost",
  size = "sm",
  tone = "neutral",
  className = "",
  type = "button",
  ...rest
}: IconButtonProps) {
  const base = "inline-flex shrink-0 items-center justify-center rounded-full transition disabled:opacity-40 disabled:pointer-events-none";
  const variantCls =
    variant === "solid"
      ? `${TONE_TEXT[tone]} bg-surface-hover hover:bg-surface-hover/80`
      : variant === "outline"
        ? `border border-border ${TONE_TEXT[tone]} hover:bg-surface-hover`
        : `${TONE_TEXT[tone]} hover:bg-surface-hover`;

  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`${base} ${SIZE_CLS[size]} ${variantCls} ${className}`}
      {...rest}
    >
      <Icon name={icon} size={ICON_SIZE[size]} />
    </button>
  );
}
