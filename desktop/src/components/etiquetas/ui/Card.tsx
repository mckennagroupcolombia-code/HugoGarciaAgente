import type { ReactNode } from "react";
import { TONE_TEXT, type Tone } from "./tokens";

interface CardProps {
  children: ReactNode;
  padding?: "none" | "sm" | "md";
  className?: string;
}

const PADDING_CLS: Record<"none" | "sm" | "md", string> = {
  none: "",
  sm: "px-3 py-2",
  md: "px-3 py-2.5",
};

export function Card({ children, padding = "md", className = "" }: CardProps) {
  return (
    <div className={`rounded-paper border border-border bg-surface ${PADDING_CLS[padding]} ${className}`}>
      {children}
    </div>
  );
}

interface StatTileProps {
  label: string;
  value: ReactNode;
  tone?: Tone;
}

export function StatTile({ label, value, tone = "neutral" }: StatTileProps) {
  return (
    <Card padding="sm">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={`text-lg font-bold ${TONE_TEXT[tone]}`}>{value}</div>
    </Card>
  );
}
