import type { Config } from "tailwindcss";

/** Paleta McKenna Group: verde teal (#0c6069) + Daily Quest amber en iframe. */
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
        paper:    "0 4px 0 rgba(2,45,51,0.06), 0 12px 32px rgba(12,96,105,0.08)",
        "paper-sm": "0 2px 0 rgba(2,45,51,0.04)",
        "paper-lg": "0 8px 0 rgba(2,45,51,0.07), 0 24px 60px rgba(12,96,105,0.12)",
      },
      colors: {
        /* ── Superficies ───────────────────────────── */
        surface: {
          DEFAULT: "#e8fafb",   // fondo de página (teal muy pálido)
          panel:   "#f4fdfe",   // tarjetas y paneles
          input:   "#ffffff",   // inputs
          hover:   "#cff0f4",   // hover state
        },
        /* ── Texto ─────────────────────────────────── */
        ink: {
          DEFAULT:   "#022D33", // texto primario (teal muy oscuro)
          secondary: "#0a4a52", // texto secundario
          muted:     "#2d7880", // texto muted
        },
        /* ── Bordes ────────────────────────────────── */
        border: {
          DEFAULT: "#9dcdd4",   // borde suave
          strong:  "#5fb3bc",   // borde marcado
        },
        muted: "#3a7e87",
        /* ── Acento principal: McKenna teal ─────────── */
        accent: {
          DEFAULT:  "#0c6069", // McKenna primary teal
          hover:    "#045159", // dark teal hover
          sun:      "#f4c44d", // dorado (logo McKenna M)
          "sun-deep":"#e8a838",
          leaf:     "#4a9a6a",
          "leaf-deep":"#2d7a4e",
          sky:      "#6aacb3",
          "sky-deep":"#3d8a93",
          rose:     "#e58c8c",
          plum:     "#a68bc8",
        },
        success: "#2a7d4e",
        danger:  "#c86a6a",
        warning: "#e8a838",
      },
    },
  },
  plugins: [],
} satisfies Config;
