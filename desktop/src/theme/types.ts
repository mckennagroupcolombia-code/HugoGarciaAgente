export type ThemeMode = "light" | "dark" | "system";

export type FontChoice =
  | "Montserrat"
  | "Inter"
  | "DM Sans"
  | "Nunito"
  | "system-ui";

export type RadiusScale = "sm" | "md" | "lg";

export interface PanelThemeConfig {
  mode: ThemeMode;
  fontSans: FontChoice;
  accentRgb: string;
  radius: RadiusScale;
}
