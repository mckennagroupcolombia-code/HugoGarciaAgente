import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/app/",
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8081",
      "/app/api": "http://localhost:8081",
      "/chat": "http://localhost:8081",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
