import { StrictMode, Component, type ReactNode, type ErrorInfo } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./index.css";
import { initFantasyPress } from "./lib/fantasyPress";

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
