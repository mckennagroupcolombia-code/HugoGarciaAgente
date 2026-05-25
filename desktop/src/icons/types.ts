import type { IconProps as PhosphorIconProps, IconWeight } from "@phosphor-icons/react";
import type { Panel } from "../stores/app";

/** Iconos de acciones y UI compartidos (Phosphor). */
export type UiIconName =
  | "signOut"
  | "menu"
  | "refresh"
  | "close"
  | "expand"
  | "collapse"
  | "gridReset"
  | "drag"
  | "resize"
  | "sun"
  | "moon"
  | "pencil"
  | "caretDown"
  | "castle"
  | "mapPin"
  | "building"
  | "target"
  | "book"
  | "warning"
  | "check"
  | "clock"
  | "sword"
  | "bell"
  | "xCircle"
  | "plus"
  | "trash"
  | "funnel"
  | "link"
  | "lightning"
  | "pin"
  | "infinity"
  | "lock"
  | "unlock"
  | "user"
  | "users"
  | "tag"
  | "listChecks"
  | "wrench"
  | "nut"
  | "books"
  | "flask"
  | "handshake"
  | "scroll"
  | "floppyDisk"
  | "hourglass"
  | "truck"
  | "calendar"
  | "calendarBlank"
  | "calendarDots"
  | "chartBar"
  | "robot"
  | "search"
  | "envelope"
  | "circle"
  | "arrowSub"
  | "package"
  | "receipt"
  | "ear"
  | "question"
  | "star";

export type IconName = Panel | UiIconName;

export interface IconProps extends Omit<PhosphorIconProps, "ref"> {
  name: IconName;
  /** Tamaño en px (default 20). */
  size?: number;
  weight?: IconWeight;
}
