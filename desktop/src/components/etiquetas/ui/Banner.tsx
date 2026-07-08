import type { ReactNode } from "react";
import { TONE_BORDER, TONE_BG_SOFT, TONE_TEXT, type Tone } from "./tokens";
import { IconButton } from "./IconButton";

interface BannerProps {
  tone?: Tone;
  children: ReactNode;
  onClose?: () => void;
  className?: string;
}

export function Banner({ tone = "neutral", children, onClose, className = "" }: BannerProps) {
  return (
    <div
      className={`flex items-start gap-2 rounded-paper border ${TONE_BORDER[tone]} ${TONE_BG_SOFT[tone]} px-3 py-2.5 text-sm ${TONE_TEXT[tone]} ${className}`}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {onClose && (
        <IconButton icon="close" label="Cerrar aviso" size="xs" tone={tone} onClick={onClose} />
      )}
    </div>
  );
}
