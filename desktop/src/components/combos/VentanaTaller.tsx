import { Suspense, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Ventana emergente del taller de combos: el apartado que resuelve una pieza (Códigos EAN, Docs
 * técnicos, Crear en Alegra…) se abre ENCIMA del taller, que queda de fondo, en vez de navegar a
 * otra pantalla. Es el mismo componente del apartado: acá no nace otra forma de escribir.
 *
 * Solo se cierra con «Cerrar» (no con Escape ni clic fuera): varios de estos apartados guardan por
 * acciones o autoguardan, y un cierre accidental cortaría lo que se está haciendo.
 * `role="dialog"` + `aria-modal` hacen que el taller suspenda sus atajos (← → 1–6) mientras está abierta.
 */
export default function VentanaTaller({ titulo, combo, ayuda, ancho = "max-w-[1300px]", onCerrar, children }: {
  titulo: string;
  /** Para qué combo es (cabecera). */
  combo: string;
  /** Una línea de qué hacer aquí. */
  ayuda?: ReactNode;
  ancho?: string;
  onCerrar: () => void;
  children: ReactNode;
}) {
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-2 sm:p-3" role="dialog" aria-modal="true" aria-label={titulo}>
      <div className={`flex h-[94vh] w-full ${ancho} flex-col overflow-hidden rounded-xl border border-border bg-surface-panel shadow-xl`}>
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted">{titulo} · para {combo}</p>
            {ayuda && <p className="text-[12px] text-ink">{ayuda}</p>}
          </div>
          <button onClick={onCerrar} aria-label="Cerrar" className="shrink-0 rounded-md border border-border px-3 py-1 text-[12px] font-semibold text-ink hover:bg-surface-hover">
            Cerrar · volver al combo
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-surface p-3">
          <Suspense fallback={<p className="p-6 text-sm text-muted">Abriendo…</p>}>{children}</Suspense>
        </div>
      </div>
    </div>,
    document.body,
  );
}
