import { lazy, Suspense, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../icons";

const CrearProductosSiigoPanel = lazy(() => import("./CrearProductosSiigoPanel"));

/**
 * Botón flotante «Crear en Alegra», mismo patrón que la calculadora mágica
 * (portal + z-index alto), debajo del FAB de calculadora.
 * Minimizar colapsa a una barra sin desmontar el formulario.
 */
export default function CrearSiigoFab() {
  const [abierta, setAbierta] = useState(false);
  const [minimizada, setMinimizada] = useState(false);

  const cerrar = () => {
    setAbierta(false);
    setMinimizada(false);
  };

  const abrirORestaurar = () => {
    if (!abierta) {
      setAbierta(true);
      setMinimizada(false);
      return;
    }
    if (minimizada) {
      setMinimizada(false);
      return;
    }
    cerrar();
  };

  useEffect(() => {
    if (!abierta) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setAbierta(false);
      setMinimizada(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [abierta]);

  if (typeof document === "undefined") return null;

  const panelVisible = abierta && !minimizada;

  return createPortal(
    <div className="pointer-events-none fixed top-24 right-5 z-[900] flex flex-col items-end gap-3 sm:top-[6.75rem] sm:right-6">
      <button
        type="button"
        onClick={abrirORestaurar}
        className={`pointer-events-auto group relative flex h-14 w-14 items-center justify-center rounded-full border-2 shadow-paper-lg transition active:scale-95 ${
          abierta
            ? "border-sky-600 bg-sky-600 text-white"
            : "border-sky-500/70 bg-surface-panel text-sky-700 hover:border-sky-600 hover:bg-sky-600 hover:text-white dark:text-sky-300"
        }`}
        title="Crear productos y combos en Alegra"
        aria-label={
          minimizada
            ? "Restaurar crear en Alegra"
            : abierta
              ? "Cerrar crear en Alegra"
              : "Abrir crear en Alegra"
        }
        aria-expanded={panelVisible}
      >
        <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-sky-400 text-[10px] font-black text-white shadow-sm">
          +
        </span>
        <Icon name="package" size={22} weight={abierta ? "bold" : "regular"} />
      </button>

      {abierta && (
        <>
          <div
            className={`pointer-events-auto flex max-h-[min(82vh,44rem)] w-[min(calc(100vw-1.5rem),36rem)] flex-col overflow-hidden rounded-paper-lg border-2 border-sky-500/50 bg-surface-panel shadow-paper-lg ${
              minimizada ? "hidden" : ""
            }`}
            role="dialog"
            aria-label="Crear productos y combos en Alegra"
            aria-hidden={minimizada}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-sky-500/10 px-3 py-2">
              <div className="flex items-center gap-1.5 text-sky-700 dark:text-sky-300">
                <Icon name="package" size={14} weight="bold" />
                <span className="text-[11px] font-extrabold uppercase tracking-wide">
                  Crear en Alegra
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => setMinimizada(true)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-surface-hover hover:text-ink"
                  aria-label="Minimizar crear en Alegra"
                  title="Minimizar"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                    <path d="M5 12h14" strokeLinecap="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={cerrar}
                  className="rounded-lg px-2 py-0.5 text-sm text-muted hover:bg-surface-hover hover:text-ink"
                  aria-label="Cerrar crear en Alegra"
                >
                  ✕
                </button>
              </div>
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

          {minimizada && (
            <button
              type="button"
              onClick={() => setMinimizada(false)}
              className="pointer-events-auto flex max-w-[min(calc(100vw-2rem),18rem)] items-center gap-2 rounded-paper-lg border-2 border-sky-500/50 bg-sky-500/10 px-3 py-2 text-sky-700 shadow-paper-lg transition hover:brightness-[1.03] active:scale-[0.98] dark:text-sky-300"
              aria-label="Restaurar crear en Alegra"
              title="Clic para restaurar"
            >
              <Icon name="package" size={14} weight="bold" />
              <span className="min-w-0 truncate text-[11px] font-extrabold uppercase tracking-wide">
                Crear en Alegra
              </span>
              <svg className="ml-auto h-3.5 w-3.5 shrink-0 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </>
      )}
    </div>,
    document.body,
  );
}
