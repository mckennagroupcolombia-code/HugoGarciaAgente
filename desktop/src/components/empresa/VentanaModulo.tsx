/**
 * Un módulo de la app abierto DENTRO del juego: el objeto del barrio «se abre» (el Libro Mayor en
 * la biblioteca, Facturación en su escritorio…) y adentro está el módulo de verdad, con todo lo que
 * hace. Cerrar devuelve al barrio donde estaba; nada se recarga.
 *
 * - El módulo se monta con el mismo enrutador de la app (components/PanelRouter.tsx) y con un
 *   «panel local» (lib/panelLocal.tsx): los módulos con secciones ven SU panel, no «empresa-viva».
 * - Si desde adentro se va a otro módulo (una pestaña, un botón «Ir a…»), se abre aquí mismo y queda
 *   en las migas para volver. Lo que se navega por el store lo atrapa `interceptarPanel` mientras el
 *   clic salga de esta ventana (EmpresaViva.tsx).
 */
import { useEffect, useRef, useState } from "react";
import { PanelRouter } from "../PanelRouter";
import { PanelLocal } from "../../lib/panelLocal";
import type { Panel } from "../../stores/app";
import { infoModulo } from "./barrio";
import { BASE_PIXEL } from "./personajes";

type Frames = Record<string, { frame: { x: number; y: number; w: number; h: number } }>;
let atlas: Promise<{ frames: Frames; meta: { size: { w: number; h: number } } }> | null = null;
function cargarAtlas() {
  atlas ??= fetch(`${BASE_PIXEL}objetos.json?v=2`, { credentials: "same-origin" }).then((r) => r.json());
  return atlas;
}

/** El ícono pixel del objeto del módulo (del mismo atlas que usa el juego). */
export function IconoModulo({ icono, tam = 40 }: { icono: string | null; tam?: number }) {
  const [f, setF] = useState<{ x: number; y: number; w: number; h: number; W: number; H: number } | null>(null);
  useEffect(() => {
    let vivo = true;
    if (!icono) return;
    void cargarAtlas().then((a) => {
      const fr = a.frames[`ico_${icono}`]?.frame;
      if (vivo && fr) setF({ ...fr, W: a.meta.size.w, H: a.meta.size.h });
    }).catch(() => {});
    return () => { vivo = false; };
  }, [icono]);
  if (!f) return <span className="inline-block shrink-0" style={{ width: tam, height: tam }} />;
  const k = tam / f.w;
  return (
    <span aria-hidden className="ev-retrato inline-block shrink-0"
          style={{ width: tam, height: tam, backgroundImage: `url(${BASE_PIXEL}objetos.png?v=2)`, backgroundRepeat: "no-repeat",
                   backgroundSize: `${f.W * k}px ${f.H * k}px`, backgroundPosition: `-${f.x * k}px -${f.y * k}px` }} />
  );
}

/** Cualquier cuadro del atlas de objetos (p. ej. `casa_sofa`), escalado para caber en `tam` × `tam`. */
export function CuadroAtlas({ frame, tam = 40 }: { frame: string; tam?: number }) {
  const [f, setF] = useState<{ x: number; y: number; w: number; h: number; W: number; H: number } | null>(null);
  useEffect(() => {
    let vivo = true;
    void cargarAtlas().then((a) => {
      const fr = a.frames[frame]?.frame;
      if (vivo && fr) setF({ ...fr, W: a.meta.size.w, H: a.meta.size.h });
    }).catch(() => {});
    return () => { vivo = false; };
  }, [frame]);
  if (!f) return <span className="inline-block shrink-0" style={{ width: tam, height: tam }} />;
  const k = Math.min(tam / f.w, tam / f.h, 2);
  return (
    <span aria-hidden className="inline-flex shrink-0 items-end justify-center" style={{ width: tam, height: tam }}>
      <span className="ev-retrato inline-block"
            style={{ width: f.w * k, height: f.h * k, backgroundImage: `url(${BASE_PIXEL}objetos.png?v=2)`, backgroundRepeat: "no-repeat",
                     backgroundSize: `${f.W * k}px ${f.H * k}px`, backgroundPosition: `-${f.x * k}px -${f.y * k}px` }} />
    </span>
  );
}

export function VentanaModulo({ pila, iconoDe, onIr, onAtras, onCerrar, origen }: {
  /** Los módulos abiertos uno tras otro; el último es el que se ve. */
  pila: Panel[];
  iconoDe: (panel: string) => string | null;
  onIr: (p: Panel) => void;
  onAtras: () => void;
  onCerrar: () => void;
  /** Se pone en true mientras dura un clic o una tecla dentro de la ventana (ver EmpresaViva). */
  origen: React.MutableRefObject<boolean>;
}) {
  const actual = pila[pila.length - 1];
  const m = infoModulo(actual);
  const caja = useRef<HTMLDivElement>(null);
  const marcar = () => {
    origen.current = true;
    window.setTimeout(() => { origen.current = false; }, 0);
  };
  useEffect(() => { caja.current?.scrollTo({ top: 0 }); }, [actual]);

  return (
    <div className="absolute inset-0 z-[35] flex items-stretch justify-center bg-black/35 p-1.5 sm:p-3"
         onPointerDownCapture={marcar} onClickCapture={marcar} onKeyDownCapture={marcar} onChangeCapture={marcar}>
      <div className="ev-ventana flex min-h-0 w-full max-w-[110rem] flex-col p-2 sm:p-3" role="dialog" aria-label={`${m.nombre} (dentro del juego)`}>
        <div className="mb-2 flex shrink-0 items-center gap-2">
          <IconoModulo icono={iconoDe(actual)} tam={36} />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-[#b9c2ff]">
              {pila.length > 1 && pila.slice(0, -1).map((p, i) => (
                <span key={`${p}-${i}`} className="truncate">{infoModulo(p).nombre} ›</span>
              ))}
            </div>
            <div className="ev-nombre-dialogo truncate text-lg">{m.nombre}</div>
            <div className="truncate text-xs text-[#b9c2ff]">{m.etapa ? `${m.etapa}${m.tramo ? ` → ${m.tramo}` : ""} · ` : ""}{m.hace}</div>
          </div>
          {pila.length > 1 && (
            <button type="button" className="ev-boton mck-btn-no-fx shrink-0" onClick={onAtras} title="Volver al módulo anterior">← Atrás</button>
          )}
          <button type="button" className="ev-boton mck-btn-no-fx shrink-0" aria-pressed="true" onClick={onCerrar} title="Cerrar y seguir en el barrio">
            Volver al barrio
          </button>
        </div>
        {/* Adentro, el módulo con el tema de la app (no el del juego): se trabaja igual que siempre. */}
        <div ref={caja} className="mck-app-shell min-h-0 flex-1 overflow-auto rounded-md border-2 border-[#8a95d6] bg-surface text-ink [text-shadow:none]"
             style={{ fontFamily: "var(--mck-font-sans, var(--font-sans, ui-sans-serif, system-ui, sans-serif))", letterSpacing: "normal" }}>
          <div className="flex min-h-full flex-col">
            <PanelLocal.Provider value={{ panel: actual, irA: onIr }}>
              <PanelRouter key={actual} panel={actual} />
            </PanelLocal.Provider>
          </div>
        </div>
      </div>
    </div>
  );
}
