/**
 * Entrada del build de colaboradores externos (vite.colab.config.ts → dist-colab/).
 *
 * Es otra aplicación, no el panel con partes ocultas: solo importa el apartado
 * Colaboradores y una Agenda mínima con Armando, así que el bundle no nombra
 * ni trae los demás módulos. El servidor la entrega a quien tiene el perfil
 * `colaborador_externo` (app/routes.py::serve_spa) y le niega el bundle del panel.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ColabApp from "./ColabApp";
import "./colab.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ColabApp />
    </QueryClientProvider>
  </StrictMode>,
);
