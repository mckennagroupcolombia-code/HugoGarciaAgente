import type { ReactNode } from "react";
import { Icon } from "./Icon";
import { resolveTopicIcon } from "./emojiMap";
import type { IconWeight, UiIconName } from "./types";

export interface TopicIconProps {
  /** Emoji guardado en BD, nombre de icono o vacío. */
  value?: string | null;
  fallback?: UiIconName;
  size?: number;
  weight?: IconWeight;
  className?: string;
  /** Si no hay mapeo, muestra emoji (default: false — solo líneas SVG). */
  showEmojiFallback?: boolean;
}

/** Renderiza emoji de reino/categoría/misión como icono SVG lineal. */
export function TopicIcon({
  value,
  fallback = "circle",
  size = 16,
  weight = "regular",
  className,
  showEmojiFallback = false,
}: TopicIconProps) {
  const trimmed = (value ?? "").trim();
  const iconName = resolveTopicIcon(trimmed, fallback);

  if (iconName) {
    return <Icon name={iconName} size={size} weight={weight} className={className} />;
  }

  if (showEmojiFallback && trimmed) {
    return (
      <span className={className} aria-hidden>
        {trimmed}
      </span>
    );
  }

  return <Icon name={fallback} size={size} weight={weight} className={className} />;
}

/** Icono + texto en línea. */
export function TopicIconLabel({
  value,
  fallback,
  children,
  size = 16,
  weight = "regular",
  className = "",
  gap = "gap-1.5",
}: TopicIconProps & { children: ReactNode; gap?: string }) {
  return (
    <span className={`inline-flex items-center ${gap} ${className}`.trim()}>
      <TopicIcon value={value} fallback={fallback} size={size} weight={weight} className="shrink-0" />
      {children != null && children !== "" ? <span>{children}</span> : null}
    </span>
  );
}
