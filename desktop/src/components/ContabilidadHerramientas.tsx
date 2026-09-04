import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { Icon } from "../icons";
import { CalculadoraPad } from "./CalculadoraMagica";
import FloatingToolWindow, { defaultFloatRect } from "./FloatingToolWindow";

const CrearProductosSiigoPanel = lazy(() => import("./CrearProductosSiigoPanel"));
const ModalHerramientasRentabilidad = lazy(() =>
  import("./RentabilidadPanel").then((m) => ({ default: m.ModalHerramientasRentabilidad })),
);

type Tool = "crear" | "facturas" | "calc";

function ToolBtn({
  active,
  title,
  onClick,
  tone,
  children,
}: {
  active: boolean;
  title: string;
  onClick: () => void;
  tone: "sky" | "ink" | "accent";
  children: ReactNode;
}) {
  const tones = {
    sky: active
      ? "border-sky-600 bg-sky-600 text-white"
      : "border-sky-600 bg-sky-600/15 text-sky-800 hover:bg-sky-600 hover:text-white dark:text-sky-200",
    ink: active
      ? "border-ink bg-ink text-white"
      : "border-ink/40 bg-surface-panel text-ink hover:border-ink hover:bg-ink hover:text-white",
    accent: active
      ? "border-accent bg-accent text-white"
      : "border-accent bg-accent text-white hover:opacity-90",
  };
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 shadow-sm transition active:scale-95 ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

/**
 * Iconos de herramientas Contabilidad (cabezote, a la izquierda de Temas).
 * Ventanas flotantes: arrastrables, redimensionables, posición recordada.
 * Stock y Rentabilidad se mantienen vivos vía ContabilidadPanel (keep-alive).
 */
export default function ContabilidadHerramientas({
  puedeCrearSiigo,
}: {
  puedeCrearSiigo: boolean;
}) {
  const [abiertas, setAbiertas] = useState<Set<Tool>>(() => new Set());

  const toggle = useCallback((t: Tool) => {
    setAbiertas((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }, []);

  const cerrar = useCallback((t: Tool) => {
    setAbiertas((prev) => {
      if (!prev.has(t)) return prev;
      const next = new Set(prev);
      next.delete(t);
      return next;
    });
  }, []);

  useEffect(() => {
    if (abiertas.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const orden: Tool[] = ["calc", "crear", "facturas"];
      for (const t of orden) {
        if (abiertas.has(t)) {
          cerrar(t);
          break;
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [abiertas, cerrar]);

  const open = (t: Tool) => abiertas.has(t);

  return (
    <>
      <div
        className="mr-0.5 flex max-w-[min(100vw-9rem,12rem)] shrink-0 items-center gap-0.5 overflow-x-auto overscroll-x-contain border-r border-border/80 pr-1 sm:max-w-none sm:gap-1 sm:pr-1.5"
        role="toolbar"
        aria-label="Herramientas Contabilidad"
      >
        {puedeCrearSiigo && (
          <ToolBtn
            active={open("crear")}
            title="Crear producto / combo en Alegra"
            tone="sky"
            onClick={() => toggle("crear")}
          >
            <Icon name="package" size={22} weight="bold" />
          </ToolBtn>
        )}
        <ToolBtn
          active={open("facturas")}
          title="Consultar factura"
          tone="ink"
          onClick={() => toggle("facturas")}
        >
          <Icon name="receipt" size={22} weight="bold" />
        </ToolBtn>
        <ToolBtn
          active={open("calc")}
          title="Calculadora"
          tone="accent"
          onClick={() => toggle("calc")}
        >
          <Icon name="calculator" size={22} weight="bold" />
        </ToolBtn>
      </div>

      {open("facturas") && (
        <Suspense fallback={null}>
          <ModalHerramientasRentabilidad
            flotante
            foco="facturas"
            onClose={() => cerrar("facturas")}
          />
        </Suspense>
      )}

      {open("calc") && (
        <FloatingToolWindow
          id="calc"
          title="Calculadora"
          titleExtra={
            <>
              <Icon name="star" size={14} weight="bold" className="text-accent" />
              <Icon name="calculator" size={14} weight="regular" className="text-accent" />
            </>
          }
          headerClassName="border-border bg-accent/10 text-accent"
          borderClassName="border-accent/50"
          defaultRect={defaultFloatRect("tl", 272, 420)}
          minWidth={240}
          minHeight={360}
          zIndex={900}
          onClose={() => cerrar("calc")}
        >
          <CalculadoraPad bare onClose={() => cerrar("calc")} />
        </FloatingToolWindow>
      )}

      {open("crear") && (
        <FloatingToolWindow
          id="crear-siigo"
          title="Crear en Alegra"
          titleExtra={<Icon name="package" size={14} weight="bold" className="text-sky-600 dark:text-sky-300" />}
          headerClassName="border-border bg-sky-500/10 text-sky-700 dark:text-sky-300"
          borderClassName="border-sky-500/50"
          defaultRect={defaultFloatRect("tr", 448, 560)}
          minWidth={320}
          minHeight={280}
          zIndex={890}
          onClose={() => cerrar("crear")}
        >
          <div className="p-3">
            <Suspense
              fallback={<p className="py-8 text-center text-sm text-muted">Cargando…</p>}
            >
              <CrearProductosSiigoPanel compact />
            </Suspense>
          </div>
        </FloatingToolWindow>
      )}
    </>
  );
}
