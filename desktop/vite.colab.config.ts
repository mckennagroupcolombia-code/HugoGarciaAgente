/**
 * Build de colaboradores externos → dist-colab/ (lo entrega app/routes.py a
 * quien tiene el perfil `colaborador_externo`; al resto, dist/).
 *
 * Reglas para que siga siendo «otra aplicación»:
 * - Una sola entrada (colaboradores.html → src/colab/main.tsx). Nada de App.tsx.
 * - Los stores de sesión del panel se reemplazan por alias: el original arrastra
 *   las reglas de acceso del equipo interno.
 * - Sin sourcemaps: llevarían el código fuente con sus comentarios.
 * - `scripts/verificar-build-colab.mjs` falla si se cuela algo del panel.
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import tailwindColab from "./tailwind.colab.config";

const aqui = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  base: "/app/",
  publicDir: false,
  resolve: {
    alias: [
      { find: /^\.\.\/stores\/ticketsAuth$/, replacement: aqui("./src/colab/stubs/ticketsAuth.ts") },
      { find: /^\.\.\/stores\/auth$/, replacement: aqui("./src/colab/stubs/auth.ts") },
    ],
  },
  css: {
    postcss: { plugins: [tailwindcss(tailwindColab), autoprefixer()] },
  },
  build: {
    outDir: "dist-colab",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: aqui("./colaboradores.html"),
    },
  },
});
