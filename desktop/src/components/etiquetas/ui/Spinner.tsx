const SIZE_CLS: Record<"sm" | "md" | "lg", string> = {
  sm: "h-4 w-4 border-2",
  md: "h-7 w-7 border-2",
  lg: "h-8 w-8 border-[3px]",
};

const TONE_CLS: Record<"accent" | "white", string> = {
  accent: "border-accent border-t-transparent",
  white: "border-white border-t-transparent",
};

interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  tone?: "accent" | "white";
  className?: string;
}

export function Spinner({ size = "sm", tone = "accent", className = "" }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label="Cargando"
      className={`inline-block animate-spin rounded-full ${SIZE_CLS[size]} ${TONE_CLS[tone]} ${className}`}
    />
  );
}
