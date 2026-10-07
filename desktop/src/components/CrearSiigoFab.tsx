import { lazy, Suspense, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../icons";

const CrearProductosSiigoPanel = lazy(() => import("./CrearProductosSiigoPanel"));

/**
 * Botón flotante «Crear en Alegra», mismo patrón que la calculadora mágica
 * (portal + z-index alto), debajo del FAB de calculadora.
 * Minimizar colapsa a una barra sin desmontar el formulario.
 * La ventana se abre al lado del botón y desde arriba de la pantalla, con casi todo el alto:
 * el formulario (~690 px) debe verse completo sin desplazar en un portátil de 768 px
 * (5-oct-2026). Debajo del botón solo quedaban ~590 px. En móvil ocupa el ancho y el alto
 * (tapa la barra inferior mientras está abierta; ✕ o — la cierran).
 * En escritorio se mueve arrastrando la barra del título y cambia de tamaño con la esquina
 * inferior derecha; se recuerda en este navegador y doble clic en la barra la devuelve a su
 * sitio (pedido del 5-oct-2026).
 */
type Geo = { left: number; top: number; width: number; height: number };

const CLAVE_GEO = "mck-crear-alegra-geo";
const MIN_W = 320;
const MIN_H = 260;

function leerGeo(): Geo | null {
  try {
    const g = JSON.parse(localStorage.getItem(CLAVE_GEO) || "null") as Geo | null;
    return g && [g.left, g.top, g.width, g.height].every((n) => Number.isFinite(n)) ? g : null;
  } catch {
    return null;
  }
}

function guardarGeo(g: Geo | null) {
  try {
    if (g) localStorage.setItem(CLAVE_GEO, JSON.stringify(g));
    else localStorage.removeItem(CLAVE_GEO);
  } catch {
    /* sin almacenamiento: solo esta vez */
  }
}

/** Que la ventana nunca quede por fuera de la pantalla. */
function encajar(g: Geo): Geo {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(Math.max(g.width, MIN_W), vw - 16);
  const height = Math.min(Math.max(g.height, MIN_H), vh - 16);
  return {
    width,
    height,
    left: Math.min(Math.max(g.left, 8), vw - width - 8),
    top: Math.min(Math.max(g.top, 8), vh - height - 8),
  };
}

function esEscritorio(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;
}
export default function CrearSiigoFab() {
  const [abierta, setAbierta] = useState(false);
  const [minimizada, setMinimizada] = useState(false);
  const [geo, setGeo] = useState<Geo | null>(leerGeo);
  const [escritorio, setEscritorio] = useState(esEscritorio);
  const ventanaRef = useRef<HTMLDivElement>(null);
  const arrastre = useRef<{ modo: "mover" | "tamano"; x: number; y: number; inicio: Geo } | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const cambio = () => setEscritorio(mq.matches);
    mq.addEventListener("change", cambio);
    return () => mq.removeEventListener("change", cambio);
  }, []);

  /** Arranca mover o redimensionar desde la posición real de la ventana. */
  const empezar = (modo: "mover" | "tamano") => (e: ReactPointerEvent<HTMLElement>) => {
    if (!escritorio || e.button !== 0 || !ventanaRef.current) return;
    if (modo === "mover" && (e.target as HTMLElement).closest("button")) return;
    const r = ventanaRef.current.getBoundingClientRect();
    arrastre.current = { modo, x: e.clientX, y: e.clientY, inicio: { left: r.left, top: r.top, width: r.width, height: r.height } };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* sin captura: igual sigue el arrastre mientras el puntero esté encima */
    }
    e.preventDefault();
  };
  const mover = (e: ReactPointerEvent<HTMLElement>) => {
    const a = arrastre.current;
    if (!a) return;
    const dx = e.clientX - a.x;
    const dy = e.clientY - a.y;
    setGeo(encajar(a.modo === "mover"
      ? { ...a.inicio, left: a.inicio.left + dx, top: a.inicio.top + dy }
      : { ...a.inicio, width: a.inicio.width + dx, height: a.inicio.height + dy }));
  };
  const soltar = () => {
    if (!arrastre.current) return;
    arrastre.current = null;
    setGeo((g) => {
      guardarGeo(g);
      return g;
    });
  };
  const restablecer = () => {
    setGeo(null);
    guardarGeo(null);
  };

  // Si la pantalla cambia de tamaño, la ventana guardada se vuelve a encajar.
  useEffect(() => {
    if (!geo) return;
    const alCambiar = () => setGeo((g) => (g ? encajar(g) : g));
    window.addEventListener("resize", alCambiar);
    return () => window.removeEventListener("resize", alCambiar);
  }, [geo]);

  const geoActiva = escritorio && geo ? encajar(geo) : null;

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
            ref={ventanaRef}
            className={`pointer-events-auto fixed flex flex-col overflow-hidden rounded-paper-lg border-2 border-sky-500/50 bg-surface-panel shadow-paper-lg ${
              geoActiva
                ? ""
                : "right-24 top-3 max-h-[calc(100dvh-1.5rem)] w-[min(calc(100vw-7.5rem),36rem)] max-md:inset-x-3 max-md:w-auto max-md:max-h-[calc(100dvh-1.5rem)]"
            } ${minimizada ? "hidden" : ""}`}
            style={geoActiva ? { left: geoActiva.left, top: geoActiva.top, width: geoActiva.width, height: geoActiva.height } : undefined}
            role="dialog"
            aria-label="Crear productos y combos en Alegra"
            aria-hidden={minimizada}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className={`flex shrink-0 select-none items-center justify-between gap-2 border-b border-border bg-sky-500/10 px-3 py-2 ${escritorio ? "cursor-move" : ""}`}
              onPointerDown={empezar("mover")}
              onPointerMove={mover}
              onPointerUp={soltar}
              onPointerCancel={soltar}
              onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest("button")) restablecer(); }}
              title={escritorio ? "Arrastra para mover · doble clic para volver al tamaño original" : undefined}
            >
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
            <div className="min-h-0 flex-1 overflow-y-auto p-3 max-md:p-2">
              <Suspense
                fallback={
                  <p className="py-8 text-center text-sm text-muted">Cargando…</p>
                }
              >
                <CrearProductosSiigoPanel compact />
              </Suspense>
            </div>
            {escritorio && (
              <div
                className="absolute bottom-0 right-0 h-5 w-5 cursor-se-resize touch-none"
                onPointerDown={empezar("tamano")}
                onPointerMove={mover}
                onPointerUp={soltar}
                onPointerCancel={soltar}
                title="Arrastra para cambiar el tamaño"
                aria-hidden
              >
                <svg viewBox="0 0 20 20" className="h-5 w-5 text-sky-600/70" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M18 8 8 18M18 13l-5 5" strokeLinecap="round" />
                </svg>
              </div>
            )}
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
