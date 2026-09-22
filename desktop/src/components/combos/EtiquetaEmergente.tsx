import { lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import type { EntradaFormularioEtiqueta } from "../etiqueta-ficha/ProductLabelForm";

/**
 * El editor de etiquetas del Studio (el mismo `ProductLabelForm`, con su lienzo,
 * formato y exportación) dentro de un emergente del taller de combos: se diseña
 * la etiqueta sin salir del combo. Al cerrar, el taller vuelve a leer el combo
 * para que la pieza se encienda si la etiqueta quedó conectada.
 *
 * Solo se cierra con «Cerrar» o con el «Volver» del propio editor: no con Escape
 * ni con un clic fuera, porque el editor autoguarda 1,5 s después de la última
 * tecla y un cierre accidental cortaría ese guardado.
 */

// Cargado aparte: el editor arrastra el lienzo y la exportación, y el taller no los necesita hasta abrirlo.
const ProductLabelForm = lazy(() => import("../etiqueta-ficha/ProductLabelForm"));

export default function EtiquetaEmergente({ entrada, combo, onCerrar, onAbrirEnStudio }: {
  entrada: EntradaFormularioEtiqueta;
  /** Para qué combo es (solo para la cabecera). */
  combo: string;
  onCerrar: () => void;
  /** Por si se prefiere la pantalla completa del Studio. */
  onAbrirEnStudio?: () => void;
}) {
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-2 sm:p-3" role="dialog" aria-modal="true" aria-label="Diseñar etiqueta">
      <div className="flex h-[96vh] w-full max-w-[1500px] flex-col overflow-hidden rounded-xl border border-border bg-surface-panel shadow-xl">
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted">Etiqueta · para {combo}</p>
            <p className="text-[11.5px] text-muted">Los cambios se guardan solos. Al cerrar vuelves al combo.</p>
          </div>
          {onAbrirEnStudio && (
            <button onClick={onAbrirEnStudio} className="shrink-0 rounded-md border border-border px-2 py-1 text-[11.5px] text-muted hover:bg-surface-hover hover:text-ink">
              Abrir en el Studio completo
            </button>
          )}
          <button onClick={onCerrar} aria-label="Cerrar" className="shrink-0 rounded-md border border-border px-2 py-1 text-[12px] text-ink hover:bg-surface-hover">Cerrar</button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface">
          <Suspense fallback={<p className="p-6 text-sm text-muted">Abriendo el editor de etiquetas…</p>}>
            <ProductLabelForm entrada={entrada} onVolver={onCerrar} />
          </Suspense>
        </div>
      </div>
    </div>,
    document.body,
  );
}
