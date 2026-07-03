import { createPortal } from "react-dom";
import type { FormatoCanvas } from "../../lib/plantillasVisuales";
import SelectorFormatoCanvas from "./SelectorFormatoCanvas";

interface Props {
  abierta: boolean;
  formatoActual: FormatoCanvas;
  onCerrar: () => void;
  onElegir: (formato: FormatoCanvas, categoriaId: string) => void;
}

export default function CambiarFormatoModal({ abierta, formatoActual, onCerrar, onElegir }: Props) {
  if (!abierta) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[600] flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm"
      onClick={onCerrar}
    >
      <div
        className="flex max-h-[min(90vh,720px)] w-full max-w-4xl flex-col overflow-y-auto rounded-2xl border border-border bg-surface-panel p-5 shadow-paper-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="mb-4 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-xs text-ink-secondary">
          Formato actual: <strong>{formatoActual.nombre}</strong> ({formatoActual.ancho_px}×{formatoActual.alto_px} px).
          Al elegir uno nuevo, los elementos del lienzo se reescalan proporcionalmente para conservar el diseño.
        </p>
        <SelectorFormatoCanvas onElegir={onElegir} onCancelar={onCerrar} />
      </div>
    </div>,
    document.body,
  );
}
