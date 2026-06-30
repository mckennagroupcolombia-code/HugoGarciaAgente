import type { Panel } from "../stores/app";
import { IllustrationIcon } from "./IllustrationIcon";

export interface PanelIconProps {
  panel: Panel;
  size?: number;
  active?: boolean;
  bubble?: boolean;
  className?: string;
}

/** Icono de panel del sidebar — siempre en color accent del tema elegido. */
export function PanelIcon({ panel, size = 28, active = false, bubble = true, className }: PanelIconProps) {
  return (
    <IllustrationIcon
      name={panel}
      size={size}
      weight="regular"
      bubble={bubble}
      tone={active ? "neutral" : "accent"}
      className={[
        active ? "mck-illus-icon--on-accent text-white" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}
