import type { Config } from "tailwindcss";

/** Tokens alineados con `5S-plantilla-app/styles.css` (Montserrat, papel cálido, sombras suaves). */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Montserrat"', "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "Menlo", "monospace"],
      },
      borderRadius: {
        paper: "14px",
        "paper-lg": "22px",
        "paper-xl": "32px",
      },
      boxShadow: {
        paper: "0 4px 0 rgba(0,0,0,0.05), 0 12px 32px rgba(80,60,20,0.06)",
        "paper-sm": "0 2px 0 rgba(0,0,0,0.04)",
        "paper-lg": "0 8px 0 rgba(0,0,0,0.06), 0 24px 60px rgba(80,60,20,0.1)",
      },
      colors: {
        surface: {
          DEFAULT: "#fdfbf5",
          panel: "#ffffff",
          input: "#ffffff",
          hover: "#f5f1e6",
        },
        ink: {
          DEFAULT: "#1a1a1f",
          secondary: "#4a4a56",
          muted: "#8a8a94",
        },
        border: {
          DEFAULT: "#eae4d4",
          strong: "#d9d1bb",
        },
        muted: "#8a8a94",
        accent: {
          DEFAULT: "#1a1a1f",
          hover: "#2d2d38",
          sun: "#f4c44d",
          "sun-deep": "#e8a838",
          leaf: "#7cb86f",
          "leaf-deep": "#5a9a4d",
          sky: "#6fa8d6",
          "sky-deep": "#4a88bc",
          rose: "#e58c8c",
          plum: "#a68bc8",
        },
        success: "#5a9a4d",
        danger: "#c86a6a",
        warning: "#e8a838",
        /** Panel 5S (misma familia cromática que la plantilla). */
        c5s: {
          canvas: "#fdfbf5",
          panel: "#ffffff",
          "panel-deep": "#f5f1e6",
          line: "#eae4d4",
          "line-strong": "#d9d1bb",
          ink: "#1a1a1f",
          muted: "#8a8a94",
          accent: "#1a1a1f",
          "accent-hover": "#2d2d38",
          "accent-soft": "rgba(26,26,31,0.08)",
          "note-sky": "#e8f4fc",
          "note-amber": "#fdf6e4",
          "note-violet": "#f0e8fa",
          "note-cyan": "#e4f6f7",
          "note-fuchsia": "#fceef6",
          "note-orange": "#fff0e6",
          "note-indigo": "#e8ebfa",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
