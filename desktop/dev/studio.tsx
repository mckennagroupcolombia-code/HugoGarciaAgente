/**
 * Banco de pruebas de Studio visual — SOLO `npm run dev`.
 *
 * Monta el PlantillasVisualesPanel real dentro de un contenedor con scroll
 * propio, como el del panel, para revisar con Playwright/Chromium cuánto scroll
 * pide la pantalla. No entra al build (vite solo empaqueta index.html) y no da
 * acceso a nada nuevo: las llamadas a /api usan el mismo Bearer del backend.
 *
 *   /app/dev/studio.html
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../src/index.css";
import PlantillasVisualesPanel from "../src/components/plantillas-visuales/PlantillasVisualesPanel";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <div className="flex h-dvh flex-col overflow-hidden bg-surface">
        {/* Alto aproximado del encabezado + pestañas de Diseño en el panel real. */}
        <div className="h-[104px] shrink-0 border-b border-border" />
        <div id="scroll-panel" className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pb-2 pt-2">
          <PlantillasVisualesPanel />
        </div>
      </div>
    </QueryClientProvider>
  </StrictMode>,
);
