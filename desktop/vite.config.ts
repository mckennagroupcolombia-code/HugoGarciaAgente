import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/app/",
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": "http://localhost:8081",
      "/app/api": "http://localhost:8081",
      "/chat": "http://localhost:8081",
      // Galería Publicaciones / catálogo (también hay ruta /api/publicaciones/imagen-archivo)
      "/imagenes-productos-catalogo": "http://localhost:8081",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // "hidden": genera el .map para depurar pero no lo referencia desde el JS
    // público (evita que el browser descargue ~6 MB extra).
    sourcemap: "hidden",
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "@tanstack/react-query", "zustand"],
        },
      },
    },
  },
});
