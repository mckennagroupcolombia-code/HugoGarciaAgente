import type { ButtonHTMLAttributes } from "react";
import { Icon, type IconName } from "../../../icons";
import { Spinner } from "./Spinner";

type ButtonVariant = "primary" | "success" | "warning" | "secondary" | "destructive" | "ghost";
type ButtonSize = "sm" | "md";

const VARIANT_CLS: Record<ButtonVariant, string> = {
  primary: "border-2 border-accent bg-accent text-white hover:bg-accent-hover",
  success: "border-2 border-success bg-success text-white hover:opacity-90",
  warning: "border-2 border-warning bg-warning text-white hover:opacity-90",
  secondary: "border border-border bg-surface text-ink hover:bg-surface-hover",
  destructive: "border-2 border-danger bg-danger text-white hover:opacity-90",
  ghost: "border border-transparent text-ink-secondary hover:bg-surface-hover",
};

const SIZE_CLS: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: IconName;
}

export function Button({
  variant = "secondary",
  size = "md",
  loading,
  icon,
  disabled,
  className = "",
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center rounded-paper font-semibold transition disabled:opacity-50 disabled:pointer-events-none ${VARIANT_CLS[variant]} ${SIZE_CLS[size]} ${className}`}
      {...rest}
    >
      {loading ? (
        <Spinner size="sm" tone={variant === "secondary" || variant === "ghost" ? "accent" : "white"} />
      ) : (
        icon && <Icon name={icon} size={size === "sm" ? 14 : 16} />
      )}
      {children}
    </button>
  );
}
