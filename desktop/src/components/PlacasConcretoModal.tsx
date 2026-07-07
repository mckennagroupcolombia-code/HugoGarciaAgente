import { useEffect } from "react";
import { createPortal } from "react-dom";
import PlacasConcretoPanel from "./PlacasConcretoPanel";

/** Modal de pantalla completa que embebe la calculadora de Placas de Concreto como una app dentro de Procedimientos. */
export default function PlacasConcretoModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex flex-col bg-surface">
      <div
        className="flex shrink-0 items-center justify-between border-b border-border bg-surface-panel px-4 py-3 shadow-paper-sm"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <p className="text-sm font-extrabold text-ink">🧱 Placas de Concreto Pulido</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition hover:bg-surface-hover hover:text-ink"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div
        className="flex-1 overflow-y-auto px-4 py-5"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)" }}
      >
        <PlacasConcretoPanel />
      </div>
    </div>,
    document.body,
  );
}
