import type { ReactNode } from "react";
import { Icon } from "./Icon";
import { resolveTopicIcon } from "./emojiMap";
import type { UiIconName } from "./types";
import type { IconWeight } from "@phosphor-icons/react";

export interface TopicIconProps {
  /** Emoji guardado en BD, nombre Phosphor o vacío. */
  value?: string | null;
  fallback?: UiIconName;
  size?: number;
  weight?: IconWeight;
  className?: string;
  /** Si no hay mapeo, muestra el emoji original (default true). */
  showEmojiFallback?: boolean;
}

/** Renderiza emoji de reino/categoría/misión como icono Phosphor. */
export function TopicIcon({
  value,
  fallback,
  size = 16,
  weight = "duotone",
  className,
  showEmojiFallback = true,
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

  if (fallback) {
    return <Icon name={fallback} size={size} weight={weight} className={className} />;
  }

  return null;
}

/** Icono + texto en línea. */
export function TopicIconLabel({
  value,
  fallback,
  children,
  size = 16,
  weight = "duotone",
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
