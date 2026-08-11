export type ThemeMode = "light" | "dark" | "system";

export type FontChoice =
  | "Montserrat"
  | "Inter"
  | "DM Sans"
  | "Nunito"
  | "Outfit"
  | "JetBrains Mono"
  | "Share Tech Mono"
  | "A Note"
  | "system-ui";

export type RadiusScale = "sm" | "md" | "lg";

export type FontScale = "sm" | "md" | "lg" | "xl";

export type MenuScale = "sm" | "md" | "lg";

export type UiSkin = "clasica" | "atelier" | "matrix" | "sakura" | "barbie";

export type ThemePackId = "matrix" | "sakura" | "barbie";

export type ThemeColorKey =
  | "surface"
  | "surfacePanel"
  | "surfaceInput"
  | "surfaceHover"
  | "ink"
  | "inkSecondary"
  | "muted"
  | "border"
  | "borderStrong"
  | "menuBg"
  | "menuText"
  | "menuActiveBg"
  | "menuActiveText"
  | "submenuBg"
  | "submenuText"
  | "title"
  | "subtitle"
  | "cardBg"
  | "sectionBg";

export type ThemeColorMap = Partial<Record<ThemeColorKey, string>>;

export interface UserThemePreset {
  id: string;
  name: string;
  mode: ThemeMode;
  fontSans: FontChoice;
  accentRgb: string;
  radius: RadiusScale;
  skin: UiSkin;
  fontScale: FontScale;
  menuScale: MenuScale;
  colors: ThemeColorMap;
}

export interface PanelThemeConfig {
  mode: ThemeMode;
  fontSans: FontChoice;
  accentRgb: string;
  radius: RadiusScale;
  skin: UiSkin;
  fontScale: FontScale;
  menuScale: MenuScale;
  colors: ThemeColorMap;
  customThemes: UserThemePreset[];
  activeCustomId: string | null;
}
