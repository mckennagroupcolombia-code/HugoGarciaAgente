import type { ReactNode } from "react";
import { IllustrationIcon } from "../../../icons/IllustrationIcon";
import type { IllustrationTone } from "../../../icons/IllustrationIcon";
import type { UiIconName } from "../../../icons";
import { TONE_TEXT, type Tone } from "./tokens";

const ILLUSTRATION_TONE: Record<Tone, IllustrationTone> = {
  neutral: "neutral",
  accent: "accent",
  success: "leaf",
  danger: "rose",
  warning: "sun",
  plum: "plum",
};

interface CardProps {
  children: ReactNode;
  padding?: "none" | "sm" | "md";
  className?: string;
  interactive?: boolean;
}

const PADDING_CLS: Record<"none" | "sm" | "md", string> = {
  none: "",
  sm: "px-3 py-2",
  md: "px-3 py-2.5",
};

export function Card({ children, padding = "md", className = "", interactive }: CardProps) {
  return (
    <div
      className={`mck-card rounded-paper border border-border bg-surface ${PADDING_CLS[padding]} ${
        interactive ? "mck-card-interactive" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

interface StatTileProps {
  label: string;
  value: ReactNode;
  tone?: Tone;
  icon?: UiIconName;
  interactive?: boolean;
  active?: boolean;
  onClick?: () => void;
}

export function StatTile({
  label,
  value,
  tone = "neutral",
  icon,
  interactive,
  active,
  onClick,
}: StatTileProps) {
  const Tag = onClick ? "button" : "div";
  const illusTone = ILLUSTRATION_TONE[tone];

  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`mck-card w-full rounded-paper border px-3 py-2.5 text-left transition ${
        active
          ? "border-accent bg-accent/10 ring-2 ring-accent/20"
          : "border-border bg-surface"
      } ${interactive || onClick ? "mck-card-interactive cursor-pointer" : ""}`}
    >
      <div className="flex items-start gap-2">
        {icon && (
          <IllustrationIcon
            name={icon}
            size={28}
            tone={illusTone}
            className="mck-illus-icon--hoverable shrink-0"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</div>
          <div className={`text-lg font-bold tabular-nums ${TONE_TEXT[tone]}`}>{value}</div>
        </div>
      </div>
    </Tag>
  );
}
