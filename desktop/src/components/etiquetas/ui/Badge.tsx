import type { ReactNode } from "react";
import { TONE_BORDER, TONE_BG_SOFT, TONE_TEXT, TONE_SOLID_BG, type Tone } from "./tokens";

interface BadgeProps {
  tone?: Tone;
  solid?: boolean;
  children: ReactNode;
  className?: string;
}

export function Badge({ tone = "neutral", solid, children, className = "" }: BadgeProps) {
  const cls = solid
    ? TONE_SOLID_BG[tone]
    : `border ${TONE_BORDER[tone]} ${TONE_BG_SOFT[tone]} ${TONE_TEXT[tone]}`;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${cls} ${className}`}
    >
      {children}
    </span>
  );
}
