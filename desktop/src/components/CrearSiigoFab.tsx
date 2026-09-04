import { lazy, Suspense, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../icons";

const CrearProductosSiigoPanel = lazy(() => import("./CrearProductosSiigoPanel"));

/**
 * Botón flotante «Crear en Alegra», mismo patrón que la calculadora mágica
 * (portal + z-index alto), debajo del FAB de calculadora.
 */
export default function CrearSiigoFab() {
  const [abierta, setAbierta] = useState(false);

  useEffect(() => {
    if (!abierta) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierta(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [abierta]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="pointer-events-none fixed top-24 right-5 z-[900] flex flex-col items-end gap-3 sm:top-[6.75rem] sm:right-6">
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        className={`pointer-events-auto group relative flex h-14 w-14 items-center justify-center rounded-full border-2 shadow-paper-lg transition active:scale-95 ${
          abierta
            ? "border-sky-600 bg-sky-600 text-white"
            : "border-sky-500/70 bg-surface-panel text-sky-700 hover:border-sky-600 hover:bg-sky-600 hover:text-white dark:text-sky-300"
        }`}
        title="Crear productos y combos en Alegra"
        aria-label={abierta ? "Cerrar crear en Alegra" : "Abrir crear en Alegra"}
        aria-expanded={abierta}
      >
        <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-sky-400 text-[10px] font-black text-white shadow-sm">
          +
        </span>
        <Icon name="package" size={22} weight={abierta ? "bold" : "regular"} />
      </button>

      {abierta && (
        <div
          className="pointer-events-auto flex max-h-[min(82vh,44rem)] w-[min(calc(100vw-1.5rem),36rem)] flex-col overflow-hidden rounded-paper-lg border-2 border-sky-500/50 bg-surface-panel shadow-paper-lg"
          role="dialog"
          aria-label="Crear productos y combos en Alegra"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-sky-500/10 px-3 py-2">
            <div className="flex items-center gap-1.5 text-sky-700 dark:text-sky-300">
              <Icon name="package" size={14} weight="bold" />
              <span className="text-[11px] font-extrabold uppercase tracking-wide">
                Crear en Alegra
              </span>
            </div>
            <button
              type="button"
              onClick={() => setAbierta(false)}
              className="rounded-lg px-2 py-0.5 text-sm text-muted hover:bg-surface-hover hover:text-ink"
              aria-label="Cerrar crear en Alegra"
            >
              ✕
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <Suspense
              fallback={
                <p className="py-8 text-center text-sm text-muted">Cargando…</p>
              }
            >
              <CrearProductosSiigoPanel compact />
            </Suspense>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
