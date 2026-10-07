import { StrictMode, Component, type ReactNode, type ErrorInfo } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./index.css";
// Después de index.css: la piel pixel (la base de todos) manda sobre las reglas base.
import "./theme/skin-pixel.css";
// Traducción de los ~750 colores escritos a mano en los paneles (generada: desktop/scripts/pixel).
import "./theme/skin-pixel-paleta.css";
// «Barbie Agenda» sobre la base pixel: rosa Barbie y tonos Peach (claro y oscuro).
import "./theme/skin-barbie-pixel.css";
// «Princesa Peach»: menú de videojuego retro en pastel (reemplaza a Sakura, 26-sep-2026).
import "./theme/skin-peach-pixel.css";
// El mapa (MapaVivo) en la gama de color de cada tema.
import "./theme/mapa-temas.css";
// Celular: compacta el cromo para que se vea la lista (va de último, manda sobre las pieles).
import "./theme/movil.css";
import { initFantasyPress } from "./lib/fantasyPress";
import { escucharMonedasDelServidor } from "./lib/celebracionAprobado";

// Un panel se carga en pedazos (lazy). Si al abrirlo su JS/CSS no llega —la cookie
// del panel venció a las 8 h (el servidor responde 403) o se recompiló dist/ y esta
// pestaña pide hashes viejos— se recarga la página una vez: vuelve al ingreso o toma
// el build nuevo, en vez de quedarse en «Error inesperado». Guarda de 30 s contra bucles.
const esFalloDeCarga = (msg: string) =>
  /preload CSS|dynamically imported module|Importing a module script failed|error loading dynamically/i.test(msg);
function recargarPorFalloDeCarga(): boolean {
  try {
    const ultima = Number(sessionStorage.getItem("mck-recarga-bundle") || 0);
    if (Date.now() - ultima < 30_000) return false;
    sessionStorage.setItem("mck-recarga-bundle", String(Date.now()));
  } catch {
    /* sin sessionStorage: recargar igual */
  }
  window.location.reload();
  return true;
}
window.addEventListener("vite:preloadError", (e) => {
  if (recargarPorFalloDeCarga()) e.preventDefault();
});

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[McKenna] App crash:", error, info.componentStack);
    if (esFalloDeCarga(error?.message || "")) recargarPorFalloDeCarga();
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", background: "#E8FAFB", flexDirection: "column", gap: "16px", padding: "24px", textAlign: "center" }}>
          <div style={{ fontSize: "36px", fontWeight: 900, color: "#0C6069", lineHeight: 1 }}>M</div>
          <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#022D33", margin: 0 }}>Error inesperado</h2>
          <p style={{ fontSize: "13px", color: "#2D7E86", maxWidth: "380px", margin: 0 }}>{this.state.error.message}</p>
          <button
            onClick={() => window.location.reload()}
            style={{ background: "#0C6069", color: "white", border: "none", borderRadius: "10px", padding: "10px 24px", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}
          >
            Recargar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);

initFantasyPress();
// Monedas que paga el servidor por las acciones de cada usuario: se ven en cualquier panel.
escucharMonedasDelServidor();
