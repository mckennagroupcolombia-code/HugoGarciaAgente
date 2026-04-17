import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#0d1117",
          panel: "#161b22",
          input: "#1c2128",
          hover: "#1f252d",
        },
        accent: {
          DEFAULT: "#1d6be5",
          hover: "#2b7af0",
        },
        muted: "#8b949e",
        border: "#30363d",
        success: "#3fb950",
        danger: "#f85149",
        warning: "#d29922",
      },
    },
  },
  plugins: [],
} satisfies Config;
