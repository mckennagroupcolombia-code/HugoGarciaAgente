/**
 * Banco de pruebas del formulario de etiquetas — SOLO `npm run dev`.
 *
 * Monta el ProductLabelForm real sin el resto del panel para poder revisar la
 * alineación de una etiqueta con Playwright/Chromium y rasterizarla. No entra
 * al build (vite solo empaqueta index.html) y no da acceso a nada nuevo: las
 * llamadas a /api usan el mismo Bearer que ya exige el backend.
 *
 *   /app/dev/etiqueta.html?ficha=<id de etiquetas_fichas.json>
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../src/index.css";
import FormulariosEtiquetadosPanel from "../src/components/plantillas-visuales/FormulariosEtiquetadosPanel";

const q = new URLSearchParams(window.location.search);
const fichaId = q.get("ficha");
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <div style={{ padding: 16 }}>
        <FormulariosEtiquetadosPanel onVolver={() => undefined} entrada={fichaId ? { fichaId } : null} />
      </div>
    </QueryClientProvider>
  </StrictMode>,
);
