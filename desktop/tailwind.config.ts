import type { Config } from "tailwindcss";

/** Paleta McKenna Group: verde teal (#0c6069) + Daily Quest. Colores vía CSS vars (modo oscuro en .dark). */
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
        paper:    "var(--mck-shadow-paper)",
        "paper-sm": "var(--mck-shadow-paper-sm)",
        "paper-lg": "var(--mck-shadow-paper-lg)",
      },
      colors: {
        surface: {
          DEFAULT: "rgb(var(--mck-surface) / <alpha-value>)",
          panel:   "rgb(var(--mck-surface-panel) / <alpha-value>)",
          input:   "rgb(var(--mck-surface-input) / <alpha-value>)",
          hover:   "rgb(var(--mck-surface-hover) / <alpha-value>)",
        },
        ink: {
          DEFAULT:   "rgb(var(--mck-ink) / <alpha-value>)",
          secondary: "rgb(var(--mck-ink-secondary) / <alpha-value>)",
          muted:     "rgb(var(--mck-ink-muted) / <alpha-value>)",
        },
        border: {
          DEFAULT: "rgb(var(--mck-border) / <alpha-value>)",
          strong:  "rgb(var(--mck-border-strong) / <alpha-value>)",
        },
        muted: "rgb(var(--mck-muted) / <alpha-value>)",
        accent: {
          DEFAULT:  "rgb(var(--mck-accent) / <alpha-value>)",
          hover:    "rgb(var(--mck-accent-hover) / <alpha-value>)",
          sun:      "rgb(var(--mck-accent-sun) / <alpha-value>)",
          "sun-deep":"rgb(var(--mck-accent-sun-deep) / <alpha-value>)",
          leaf:     "rgb(var(--mck-accent-leaf) / <alpha-value>)",
          "leaf-deep":"rgb(var(--mck-accent-leaf-deep) / <alpha-value>)",
          sky:      "rgb(var(--mck-accent-sky) / <alpha-value>)",
          "sky-deep":"rgb(var(--mck-accent-sky-deep) / <alpha-value>)",
          rose:     "rgb(var(--mck-accent-rose) / <alpha-value>)",
          plum:     "rgb(var(--mck-accent-plum) / <alpha-value>)",
        },
        success: "rgb(var(--mck-success) / <alpha-value>)",
        danger:  "rgb(var(--mck-danger) / <alpha-value>)",
        warning: "rgb(var(--mck-warning) / <alpha-value>)",
      },
    },
  },
  plugins: [],
} satisfies Config;
