import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  alinearElementos,
  boundsElemento,
  clonarElementoIndependiente,
  esFuenteMontserrat,
  FUENTE_MONTSERRAT_FAMILY,
  elementoImagenDefecto,
  elementoLineaDefecto,
  elementoRectDefecto,
  elementoTextoDefecto,
  TAMANO_TEXTO_DEFECTO,
  PASO_TAMANO_TEXTO,
  TAMANO_TEXTO_MIN,
  TAMANO_TEXTO_MAX,
  ajustarTamanoTexto,
  labelFormato,
  patchMoverElemento,
  posicionNuevoElemento,
  pesoMontserratVariante,
  snapLinea90,
  unionBounds,
  VARIANTES_MONTSERRAT,
  varianteDesdeFontWeight,
  zoomAjusteLienzo,
  pesoFontWeightCss,
  type AlineacionObjetos,
  type ElementoTexto,
  type ElementoVisual,
  type PlantillaVisualDoc,
} from "../../lib/plantillasVisuales";
import { dimensionesImagenParaLienzo } from "../../lib/plantillasVisualesImagen";
import {
  autoCorregirConSeleccion,
  autoCorregirTextoContenido,
} from "../../lib/autoCorregirTexto";
import GaleriaImagenesModal from "./GaleriaImagenesModal";
import ImagenCanvasElement from "./ImagenCanvasElement";
import SugerenciasTextoMagico from "./SugerenciasTextoMagico";

interface Props {
  doc: PlantillaVisualDoc;
  onChange: (doc: PlantillaVisualDoc) => void;
  onGuardar: () => void;
  onVolver: () => void;
  onExportar: (formato: "png" | "jpeg" | "pdf") => void;
  guardando?: boolean;
  exportando?: boolean;
}

function ToolBtn({
  title,
  onClick,
  children,
  danger,
  className = "",
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border text-[15px] leading-none transition ${
        danger
          ? "border-red-300/80 text-red-600 hover:border-red-400 hover:bg-red-50"
          : "border-border text-ink-secondary hover:border-accent/40 hover:bg-surface-hover hover:text-ink"
      } ${className}`}
    >
      {children}
    </button>
  );
}

function ToolSep({ className = "" }: { className?: string }) {
  return <div className={`bg-border ${className}`} />;
}

type DragMode = "move" | "resize-se" | "resize-line-end" | null;

function estiloElemento(el: ElementoVisual): React.CSSProperties {
  const base: React.CSSProperties = {
    position: "absolute",
    left: el.x,
    top: el.y,
    width: el.type === "line" ? Math.abs((el.x2 ?? el.x) - el.x) || el.width : el.width,
    height: el.type === "line" ? Math.abs((el.y2 ?? el.y) - el.y) || el.height : el.height,
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
    transformOrigin: "center center",
    zIndex: el.zIndex,
    cursor: el.locked ? "default" : "move",
  };
  return base;
}

function BotonCandadoElemento({
  locked,
  onToggle,
}: {
  locked?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      title={locked ? "Desbloquear posición" : "Bloquear posición"}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={`absolute left-0.5 top-0.5 z-30 flex h-2 w-2 items-center justify-center rounded-sm border p-0 text-[7px] leading-none shadow-sm transition ${
        locked
          ? "border-amber-300 bg-amber-50 text-amber-700 opacity-100 dark:border-amber-700 dark:bg-amber-950/80 dark:text-amber-200"
          : "border-border/80 bg-white/95 text-muted opacity-0 group-hover/elem:opacity-100 dark:bg-zinc-900/95"
      }`}
    >
      {locked ? "🔒" : "🔓"}
    </button>
  );
}

function mostrandoCajaArrastre(
  elId: string,
  sel: boolean,
  esPrincipal: boolean,
  drag: {
    ids: string[];
    mode: DragMode;
  } | null,
): boolean {
  return (
    sel &&
    esPrincipal &&
    !!drag &&
    drag.ids.includes(elId) &&
    (drag.mode === "move" || drag.mode === "resize-se")
  );
}

const OUTLINE_CAJA_ARRASTRE = "1px solid rgba(8, 145, 178, 0.45)";

export default function VisualCanvasEditor({
  doc,
  onChange,
  onGuardar,
  onVolver,
  onExportar,
  guardando,
  exportando,
}: Props) {
  const [seleccionIds, setSeleccionIds] = useState<string[]>([]);
  const [zoom, setZoom] = useState(1);
  const zoomManualRef = useRef(false);
  const [drag, setDrag] = useState<{
    ids: string[];
    mode: DragMode;
    startX: number;
    startY: number;
    origs: Map<string, ElementoVisual>;
  } | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [galeriaAbierta, setGaleriaAbierta] = useState(false);
  const suppressDeselectRef = useRef(false);
  const contenidoTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const contenidoSeleccionRef = useRef<{ start: number; end: number } | null>(null);

  const seleccionado = useMemo(() => {
    if (seleccionIds.length !== 1) return null;
    return doc.elementos.find((e) => e.id === seleccionIds[0]) ?? null;
  }, [doc.elementos, seleccionIds]);

  const seleccionPrincipalId = seleccionIds[seleccionIds.length - 1] ?? null;

  const maxZ = useMemo(
    () => doc.elementos.reduce((m, e) => Math.max(m, e.zIndex), 0),
    [doc.elementos],
  );

  const patchElementos = useCallback(
    (updater: (els: ElementoVisual[]) => ElementoVisual[]) => {
      onChange({ ...doc, elementos: updater(doc.elementos) });
    },
    [doc, onChange],
  );

  const patchElemento = useCallback(
    (id: string, patch: Partial<ElementoVisual>) => {
      patchElementos((els) =>
        els.map((e) => (e.id === id ? ({ ...e, ...patch } as ElementoVisual) : e)),
      );
    },
    [patchElementos],
  );

  const actualizarContenidoTexto = useCallback(
    (id: string, valor: string, selStart?: number, selEnd?: number) => {
      const start = selStart ?? valor.length;
      const end = selEnd ?? start;
      const { texto, selStart: ns, selEnd: ne } = autoCorregirConSeleccion(
        valor,
        start,
        end,
      );
      if (texto !== valor) {
        contenidoSeleccionRef.current = { start: ns, end: ne };
      }
      patchElemento(id, { content: texto });
    },
    [patchElemento],
  );

  useLayoutEffect(() => {
    const pos = contenidoSeleccionRef.current;
    const ta = contenidoTextareaRef.current;
    if (!pos || !ta) return;
    ta.setSelectionRange(pos.start, pos.end);
    contenidoSeleccionRef.current = null;
  }, [
    seleccionado?.type === "text" ? seleccionado.content : null,
    seleccionado?.id,
  ]);

  const alternarBloqueo = useCallback(
    (id: string) => {
      const el = doc.elementos.find((e) => e.id === id);
      if (!el) return;
      patchElemento(id, { locked: !el.locked });
    },
    [doc.elementos, patchElemento],
  );

  const agregarTexto = () => {
    const { x, y } = posicionNuevoElemento(doc.elementos.length, 40, 20);
    const base = elementoTextoDefecto(x, y);
    const el: ElementoTexto = {
      ...base,
      fontSize: TAMANO_TEXTO_DEFECTO,
      height: Math.ceil(TAMANO_TEXTO_DEFECTO * 1.6),
      zIndex: maxZ + 1,
    };
    patchElementos((els) => [...els, el]);
    setSeleccionIds([el.id]);
  };

  const agregarRect = () => {
    const { x, y } = posicionNuevoElemento(doc.elementos.length, 56, 96);
    const el = elementoRectDefecto(x, y);
    el.zIndex = maxZ + 1;
    patchElementos((els) => [...els, el]);
    setSeleccionIds([el.id]);
  };

  const agregarLinea = () => {
    const { x, y } = posicionNuevoElemento(doc.elementos.length, 40, 176);
    const el = elementoLineaDefecto(x, y);
    el.zIndex = maxZ + 1;
    patchElementos((els) => [...els, el]);
    setSeleccionIds([el.id]);
  };

  const insertarImagen = useCallback(
    (src: string) => {
      void (async () => {
        const { x, y } = posicionNuevoElemento(doc.elementos.length, 72, 72);
        const el = elementoImagenDefecto(src, x, y);
        try {
          const dims = await dimensionesImagenParaLienzo(src);
          el.width = dims.width;
          el.height = dims.height;
        } catch {
          /* mantiene tamaño por defecto */
        }
        el.zIndex = maxZ + 1;
        patchElementos((els) => [...els, el]);
        setSeleccionIds([el.id]);
      })();
    },
    [maxZ, patchElementos, doc.elementos.length],
  );

  const eliminarSeleccion = () => {
    if (!seleccionIds.length) return;
    const quitar = new Set(seleccionIds);
    patchElementos((els) => els.filter((e) => !quitar.has(e.id)));
    setSeleccionIds([]);
  };

  const duplicarSeleccion = () => {
    const ids =
      seleccionIds.length > 0 ? seleccionIds : seleccionado ? [seleccionado.id] : [];
    const fuente = doc.elementos.filter((e) => ids.includes(e.id));
    if (!fuente.length) return;
    const copias = fuente.map((el, i) => {
      const copia = clonarElementoIndependiente(el, { x: 20 + i * 8, y: 20 + i * 8 });
      copia.zIndex = maxZ + 1 + i;
      return copia;
    });
    patchElementos((els) => [...els, ...copias]);
    setSeleccionIds(copias.length === 1 ? [copias[0].id] : copias.map((c) => c.id));
  };

  const traerAdelante = () => {
    if (!seleccionIds.length) return;
    let z = maxZ;
    seleccionIds.forEach((id) => {
      z += 1;
      patchElemento(id, { zIndex: z });
    });
  };

  const aplicarAlineacion = useCallback(
    (tipo: AlineacionObjetos) => {
      const ids = seleccionIds.filter((id) => doc.elementos.some((e) => e.id === id));
      if (!ids.length) return;
      const seleccionados = doc.elementos.filter((e) => ids.includes(e.id));
      const ref =
        seleccionados.length === 1
          ? {
              left: 0,
              top: 0,
              right: doc.formato.ancho_px,
              bottom: doc.formato.alto_px,
            }
          : unionBounds(seleccionados.map(boundsElemento));
      patchElementos((els) => alinearElementos(els, ids, tipo, ref));
    },
    [doc.elementos, doc.formato.ancho_px, doc.formato.alto_px, patchElementos, seleccionIds],
  );

  const onPointerDownEl = (e: ReactPointerEvent, el: ElementoVisual, mode: DragMode) => {
    e.stopPropagation();

    if (e.shiftKey) {
      const nextIds = seleccionIds.includes(el.id)
        ? seleccionIds.filter((id) => id !== el.id)
        : [...seleccionIds, el.id];
      setSeleccionIds(nextIds);
      if (!nextIds.includes(el.id)) return;
    } else {
      setSeleccionIds([el.id]);
    }

    if (el.locked) return;

    const origs = new Map<string, ElementoVisual>();
    const found = doc.elementos.find((x) => x.id === el.id);
    if (found) origs.set(el.id, structuredClone(found));

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({
      ids: [el.id],
      mode,
      startX: e.clientX,
      startY: e.clientY,
      origs,
    });
  };

  useEffect(() => {
    if (!drag) return;
    const scale = zoom;
    function onMove(ev: PointerEvent) {
      const dx = (ev.clientX - drag!.startX) / scale;
      const dy = (ev.clientY - drag!.startY) / scale;
      if (drag!.mode === "move") {
        patchElementos((els) =>
          els.map((e) => {
            const o = drag!.origs.get(e.id);
            if (!o) return e;
            return { ...e, ...patchMoverElemento(o, dx, dy) } as ElementoVisual;
          }),
        );
        return;
      }
      const id = drag!.ids[0];
      const o = drag!.origs.get(id);
      if (!o) return;
      if (drag!.mode === "resize-line-end" && o.type === "line") {
        const ox2 = o.x2 ?? o.x + o.width;
        const oy2 = o.y2 ?? o.y;
        let nx2 = ox2 + dx;
        let ny2 = oy2 + dy;
        ({ x2: nx2, y2: ny2 } = snapLinea90(o.x, o.y, nx2, ny2, ev.ctrlKey));
        patchElemento(id, {
          x2: nx2,
          y2: ny2,
          width: Math.max(1, Math.hypot(nx2 - o.x, ny2 - o.y)),
        });
      } else if (drag!.mode === "resize-se" && o.type !== "line") {
        patchElemento(id, {
          width: Math.max(20, o.width + dx),
          height: Math.max(12, o.height + dy),
        });
      }
    }
    function onUp() {
      if (drag) suppressDeselectRef.current = true;
      setDrag(null);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, patchElemento, patchElementos, zoom]);

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      const tag = (ev.target as HTMLElement)?.tagName;
      const editando = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (ev.key === "Escape") {
        setSeleccionIds([]);
        return;
      }
      if ((ev.key === "Delete" || ev.key === "Backspace") && !editando && seleccionIds.length) {
        eliminarSeleccion();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [seleccionIds]);

  const canvasW = doc.formato.ancho_px;
  const canvasH = doc.formato.alto_px;
  const reglaPx = 18;
  const gridStepPx = 20;
  const rulerMinor = Math.max(6, Math.round(10 * zoom));
  const rulerMajor = Math.max(30, Math.round(50 * zoom));
  const formatoKey = `${doc.formato.id}-${canvasW}x${canvasH}`;

  const aplicarZoomAjuste = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    setZoom(zoomAjusteLienzo(canvasW, canvasH, vp.clientWidth, vp.clientHeight));
  }, [canvasW, canvasH]);

  useEffect(() => {
    zoomManualRef.current = false;
  }, [formatoKey]);

  useLayoutEffect(() => {
    if (zoomManualRef.current) return;
    aplicarZoomAjuste();
  }, [aplicarZoomAjuste, formatoKey]);

  useLayoutEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const ro = new ResizeObserver(() => {
      if (zoomManualRef.current) return;
      aplicarZoomAjuste();
    });
    ro.observe(vp);
    return () => ro.disconnect();
  }, [aplicarZoomAjuste]);

  const setZoomManual = useCallback((next: number | ((z: number) => number)) => {
    zoomManualRef.current = true;
    setZoom(next);
  }, []);

  const capasOrdenadas = useMemo(
    () => [...doc.elementos].sort((a, b) => b.zIndex - a.zIndex),
    [doc.elementos],
  );

  function labelCapa(el: ElementoVisual): string {
    if (el.type === "text") {
      const t = (el.content || "Texto").trim().replace(/\s+/g, " ");
      return t.length > 22 ? `${t.slice(0, 22)}…` : t;
    }
    if (el.type === "image") return "Imagen";
    if (el.type === "rect") return "Rectángulo";
    if (el.type === "line") return "Línea";
    return "Elemento";
  }

  const fondoTransparente =
    !doc.fondo || doc.fondo === "transparent" || doc.fondo === "none";

  function deseleccionarViewport(e: ReactMouseEvent) {
    if (suppressDeselectRef.current) {
      suppressDeselectRef.current = false;
      return;
    }
    if (e.target === viewportRef.current) setSeleccionIds([]);
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-[520px] flex-col gap-3 lg:flex-row">
      {/* Toolbar izquierda — solo iconos */}
      <aside className="order-1 flex shrink-0 flex-row flex-wrap items-start gap-1 rounded-xl border border-border bg-surface-panel p-1.5 lg:w-12 lg:flex-col lg:flex-nowrap">
        <ToolBtn title="Volver a biblioteca" onClick={onVolver}>
          <span className="text-lg">←</span>
        </ToolBtn>

        <ToolSep className="mx-1 hidden h-px w-6 lg:mx-0 lg:block lg:h-px lg:w-full" />

        <ToolBtn title="Agregar texto" onClick={agregarTexto}>
          <span className="font-bold">T</span>
        </ToolBtn>
        <ToolBtn title="Agregar rectángulo" onClick={agregarRect}>
          <span className="text-lg">▢</span>
        </ToolBtn>
        <ToolBtn title="Agregar línea" onClick={agregarLinea}>
          <span className="text-xl leading-none">─</span>
        </ToolBtn>
        <ToolBtn title="Agregar imagen" onClick={() => setGaleriaAbierta(true)}>
          <span className="text-base">🖼</span>
        </ToolBtn>
        <GaleriaImagenesModal
          abierta={galeriaAbierta}
          onCerrar={() => setGaleriaAbierta(false)}
          onElegir={insertarImagen}
        />

        {seleccionIds.length > 0 && (
          <>
            <ToolSep className="mx-1 hidden h-px w-6 lg:mx-0 lg:block lg:h-px lg:w-full" />

            <div
              className="grid grid-cols-3 gap-1 lg:grid-cols-1"
              title={
                seleccionIds.length > 1
                  ? "Alinear selección (Shift + clic para varios)"
                  : "Alinear al lienzo"
              }
            >
              {(
                [
                  ["izquierda", "⫷", "Alinear izquierda"],
                  ["centro-h", "↔", "Centro horizontal"],
                  ["derecha", "⫸", "Alinear derecha"],
                  ["arriba", "⫠", "Alinear arriba"],
                  ["centro-v", "↕", "Centro vertical"],
                  ["abajo", "⫡", "Alinear abajo"],
                ] as const
              ).map(([tipo, icono, titulo]) => (
                <button
                  key={tipo}
                  type="button"
                  title={titulo}
                  aria-label={titulo}
                  onClick={() => aplicarAlineacion(tipo)}
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-sm text-ink-secondary transition hover:border-accent/40 hover:bg-surface-hover hover:text-ink lg:h-10 lg:w-10"
                >
                  {icono}
                </button>
              ))}
            </div>

            <ToolBtn title="Duplicar selección" onClick={duplicarSeleccion}>
              <span className="text-base">⎘</span>
            </ToolBtn>
            <ToolBtn title="Traer al frente" onClick={traerAdelante}>
              <span className="text-base">⇡</span>
            </ToolBtn>
            <ToolBtn title="Eliminar selección" onClick={eliminarSeleccion} danger>
              <span className="text-base">✕</span>
            </ToolBtn>
          </>
        )}
      </aside>

      {/* Lienzo central — en móvil va debajo del panel de propiedades */}
      <div className="order-3 flex min-w-0 min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface-panel lg:order-2">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <input
            value={doc.nombre}
            onChange={(e) => onChange({ ...doc, nombre: e.target.value })}
            className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-semibold"
          />
          <span className="hidden text-xs text-muted sm:inline">{labelFormato(doc.formato)}</span>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setZoomManual((z) => Math.max(0.5, z - 0.1))} className="rounded border border-border px-2 py-1 text-sm hover:bg-surface-hover">−</button>
            <span className="w-12 text-center text-xs text-muted">{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => setZoomManual((z) => Math.min(4, z + 0.1))} className="rounded border border-border px-2 py-1 text-sm hover:bg-surface-hover">+</button>
            <button
              type="button"
              onClick={() => {
                zoomManualRef.current = false;
                aplicarZoomAjuste();
              }}
              className="rounded border border-border px-2 py-1 text-xs hover:bg-surface-hover"
              title="Ajustar lienzo al área visible"
            >
              Ajustar
            </button>
          </div>
          <button
            type="button"
            onClick={onGuardar}
            disabled={guardando}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Guardar"}
          </button>
          <div className="relative group">
            <button
              type="button"
              disabled={exportando}
              className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold hover:bg-surface-hover disabled:opacity-50"
            >
              {exportando ? "Exportando…" : "Exportar ▾"}
            </button>
            <div className="absolute right-0 top-full z-20 hidden min-w-[120px] rounded-lg border border-border bg-surface-panel py-1 shadow-paper group-hover:block group-focus-within:block">
              {(["png", "jpeg", "pdf"] as const).map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => onExportar(fmt)}
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-surface-hover"
                >
                  {fmt.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div
          ref={viewportRef}
          className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-zinc-200/70 p-2 dark:bg-zinc-900/60"
          onClick={deseleccionarViewport}
        >
          <div
            className="relative shrink-0"
            style={{
              width: canvasW * zoom + reglaPx,
              height: canvasH * zoom + reglaPx,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Regla horizontal */}
            <div
              className="absolute left-[18px] top-0 z-20 h-[18px] border-b border-border/70 bg-surface/90"
              style={{
                width: canvasW * zoom,
                backgroundImage: [
                  `repeating-linear-gradient(to right, rgba(15,23,42,0.24) 0 1px, transparent 1px ${rulerMajor}px)`,
                  `repeating-linear-gradient(to right, rgba(15,23,42,0.12) 0 1px, transparent 1px ${rulerMinor}px)`,
                ].join(", "),
              }}
            />
            {/* Regla vertical */}
            <div
              className="absolute left-0 top-[18px] z-20 w-[18px] border-r border-border/70 bg-surface/90"
              style={{
                height: canvasH * zoom,
                backgroundImage: [
                  `repeating-linear-gradient(to bottom, rgba(15,23,42,0.24) 0 1px, transparent 1px ${rulerMajor}px)`,
                  `repeating-linear-gradient(to bottom, rgba(15,23,42,0.12) 0 1px, transparent 1px ${rulerMinor}px)`,
                ].join(", "),
              }}
            />
            <div className="absolute left-0 top-0 z-20 h-[18px] w-[18px] border-b border-r border-border/70 bg-surface/90" />
            <div
              className="relative origin-top-left overflow-hidden rounded-sm shadow-2xl ring-1 ring-black/20"
              style={{
                position: "absolute",
                left: reglaPx,
                top: reglaPx,
                width: canvasW,
                height: canvasH,
                transform: `scale(${zoom})`,
                backgroundColor: fondoTransparente ? undefined : doc.fondo,
                backgroundImage: fondoTransparente
                  ? "repeating-conic-gradient(#cbd5e1 0% 25%, #f8fafc 0% 50%)"
                  : undefined,
                backgroundSize: fondoTransparente ? "10px 10px" : undefined,
              }}
            >
              {/* Cuadrícula casi invisible para guía de alineación */}
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  backgroundImage: [
                    "linear-gradient(to right, rgba(15,23,42,0.05) 1px, transparent 1px)",
                    "linear-gradient(to bottom, rgba(15,23,42,0.05) 1px, transparent 1px)",
                  ].join(", "),
                  backgroundSize: `${gridStepPx}px ${gridStepPx}px`,
                }}
              />
              {doc.elementos
                .slice()
                .sort((a, b) => a.zIndex - b.zIndex)
                .map((el) => {
                  const sel = seleccionIds.includes(el.id);
                  const esPrincipal = el.id === seleccionPrincipalId;
                  if (el.type === "text") {
                    const mostrandoCaja = mostrandoCajaArrastre(el.id, sel, esPrincipal, drag);
                    return (
                      <div
                        key={el.id}
                        className="group/elem"
                        style={{
                          ...estiloElemento(el),
                          color: el.color,
                          fontSize: `${el.fontSize}px`,
                          fontFamily: el.fontFamily,
                          fontWeight: pesoFontWeightCss(el.fontWeight),
                          textAlign: el.align,
                          whiteSpace: "pre-wrap",
                          outline: mostrandoCaja ? OUTLINE_CAJA_ARRASTRE : undefined,
                        }}
                        onPointerDown={(e) => onPointerDownEl(e, el, "move")}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          if (el.locked) return;
                          const txt = prompt("Editar texto:", el.content);
                          if (txt != null) {
                            patchElemento(el.id, {
                              content: autoCorregirTextoContenido(txt),
                            });
                          }
                        }}
                      >
                        <BotonCandadoElemento
                          locked={el.locked}
                          onToggle={() => alternarBloqueo(el.id)}
                        />
                        {el.content}
                        {(mostrandoCaja || (sel && esPrincipal)) && !el.locked && (
                          <span
                            className={`absolute bottom-0 right-0 h-3 w-3 cursor-se-resize rounded-sm bg-accent ${
                              mostrandoCaja ? "opacity-100" : "opacity-0 group-hover/elem:opacity-100"
                            }`}
                            onPointerDown={(e) => onPointerDownEl(e, el, "resize-se")}
                          />
                        )}
                      </div>
                    );
                  }
                  if (el.type === "rect") {
                    return (
                      <div
                        key={el.id}
                        className="group/elem"
                        style={{
                          ...estiloElemento(el),
                          background: el.fill,
                          border: `${el.strokeWidth}px solid ${el.stroke}`,
                          borderRadius: el.borderRadius,
                          outline: sel && esPrincipal ? "2px solid #0891b2" : undefined,
                        }}
                        onPointerDown={(e) => onPointerDownEl(e, el, "move")}
                      >
                        <BotonCandadoElemento
                          locked={el.locked}
                          onToggle={() => alternarBloqueo(el.id)}
                        />
                        {sel && esPrincipal && !el.locked && (
                          <span
                            className="absolute bottom-0 right-0 h-3 w-3 cursor-se-resize rounded-sm bg-accent"
                            onPointerDown={(e) => onPointerDownEl(e, el, "resize-se")}
                          />
                        )}
                      </div>
                    );
                  }
                  if (el.type === "line") {
                    const x2 = el.x2 ?? el.x + el.width;
                    const y2 = el.y2 ?? el.y;
                    const pad = Math.max(10, el.strokeWidth + 8);
                    const minX = Math.min(el.x, x2);
                    const minY = Math.min(el.y, y2);
                    const maxX = Math.max(el.x, x2);
                    const maxY = Math.max(el.y, y2);
                    const svgW = Math.max(maxX - minX + pad * 2, 1);
                    const svgH = Math.max(maxY - minY + pad * 2, 1);
                    const lx1 = el.x - minX + pad;
                    const ly1 = el.y - minY + pad;
                    const lx2 = x2 - minX + pad;
                    const ly2 = y2 - minY + pad;
                    const hitStroke = Math.max(14, el.strokeWidth + 10);
                    return (
                      <div
                        key={el.id}
                        className="group/elem"
                        style={{
                          position: "absolute",
                          left: minX - pad,
                          top: minY - pad,
                          width: svgW,
                          height: svgH,
                          zIndex: el.zIndex,
                        }}
                      >
                        <BotonCandadoElemento
                          locked={el.locked}
                          onToggle={() => alternarBloqueo(el.id)}
                        />
                        <svg
                          style={{
                            position: "absolute",
                            inset: 0,
                            overflow: "visible",
                            pointerEvents: el.locked ? "none" : "auto",
                          }}
                          aria-hidden
                        >
                          <line
                            x1={lx1}
                            y1={ly1}
                            x2={lx2}
                            y2={ly2}
                            stroke="transparent"
                            strokeWidth={hitStroke}
                            strokeLinecap="round"
                            style={{ cursor: el.locked ? "default" : "move" }}
                            onPointerDown={(e) => onPointerDownEl(e, el, "move")}
                          />
                          <line
                            x1={lx1}
                            y1={ly1}
                            x2={lx2}
                            y2={ly2}
                            stroke={el.stroke}
                            strokeWidth={el.strokeWidth}
                            strokeLinecap="butt"
                            pointerEvents="none"
                          />
                        </svg>
                        {sel && esPrincipal && !el.locked && (
                          <>
                            <span
                              className="absolute z-10 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-full border border-white/80 bg-accent/90 shadow-sm"
                              style={{ left: el.x - (minX - pad), top: el.y - (minY - pad) }}
                              onPointerDown={(e) => onPointerDownEl(e, el, "move")}
                            />
                            <span
                              className="absolute z-10 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 cursor-crosshair rounded-full border border-white/80 bg-accent/90 shadow-sm"
                              style={{ left: x2 - (minX - pad), top: y2 - (minY - pad) }}
                              onPointerDown={(e) => onPointerDownEl(e, el, "resize-line-end")}
                            />
                          </>
                        )}
                      </div>
                    );
                  }
                  if (el.type === "image") {
                    const mostrandoCaja = mostrandoCajaArrastre(el.id, sel, esPrincipal, drag);
                    return (
                      <div
                        key={el.id}
                        className="group/elem"
                        style={{
                          ...estiloElemento(el),
                          overflow: "visible",
                          outline: mostrandoCaja ? OUTLINE_CAJA_ARRASTRE : undefined,
                        }}
                        onPointerDown={(e) => onPointerDownEl(e, el, "move")}
                      >
                        <BotonCandadoElemento
                          locked={el.locked}
                          onToggle={() => alternarBloqueo(el.id)}
                        />
                        <div className="h-full w-full overflow-hidden">
                          <ImagenCanvasElement src={el.src} objectFit={el.objectFit} />
                        </div>
                        {(mostrandoCaja || (sel && esPrincipal)) && !el.locked && (
                          <span
                            className={`absolute bottom-0 right-0 h-3 w-3 cursor-se-resize rounded-sm bg-accent ${
                              mostrandoCaja ? "opacity-100" : "opacity-0 group-hover/elem:opacity-100"
                            }`}
                            onPointerDown={(e) => onPointerDownEl(e, el, "resize-se")}
                          />
                        )}
                      </div>
                    );
                  }
                  return null;
                })}
            </div>
          </div>
        </div>
      </div>

      {/* Propiedades — siempre visible; en móvil queda arriba del lienzo */}
      <aside className="order-2 max-h-[38vh] w-full shrink-0 overflow-y-auto rounded-xl border border-border bg-surface-panel p-4 lg:order-3 lg:max-h-[calc(100vh-8rem)] lg:w-64">
        <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">Propiedades</h3>

        {capasOrdenadas.length > 0 && (
          <div className="mb-4">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-muted">
              Capas ({capasOrdenadas.length})
            </p>
            <ul className="max-h-36 space-y-1 overflow-y-auto rounded-lg border border-border bg-surface p-1">
              {capasOrdenadas.map((el) => {
                const activa = seleccionIds.includes(el.id);
                const icon =
                  el.type === "text" ? "T" : el.type === "rect" ? "▢" : el.type === "line" ? "─" : "🖼";
                return (
                  <li key={el.id}>
                    <button
                      type="button"
                      onClick={(e) => {
                        if (e.shiftKey) {
                          setSeleccionIds((prev) =>
                            prev.includes(el.id)
                              ? prev.filter((id) => id !== el.id)
                              : [...prev, el.id],
                          );
                        } else {
                          setSeleccionIds([el.id]);
                        }
                      }}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition ${
                        activa
                          ? "bg-accent text-white"
                          : "text-ink-secondary hover:bg-surface-hover hover:text-ink"
                      }`}
                    >
                      <span className="shrink-0 font-bold opacity-80">{icon}</span>
                      <span className="min-w-0 truncate">
                        {el.locked ? "🔒 " : ""}
                        {labelCapa(el)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <label className="mb-3 block text-sm">
          <span className="mb-1 block text-xs text-muted">Fondo lienzo</span>
          <input
            type="color"
            value={doc.fondo.startsWith("#") ? doc.fondo : "#ffffff"}
            onChange={(e) => onChange({ ...doc, fondo: e.target.value })}
            className="h-9 w-full cursor-pointer rounded border border-border"
          />
        </label>

        {seleccionIds.length > 1 ? (
          <p className="text-sm text-muted">
            {seleccionIds.length} elementos seleccionados. Usa los botones de alineación a la
            izquierda; cada uno se edita y mueve de forma independiente.
          </p>
        ) : !seleccionado ? (
          <p className="text-sm text-muted">
            {capasOrdenadas.length > 0
              ? "Selecciona una capa de la lista o un elemento en el lienzo."
              : "Agrega un elemento y edítalo desde aquí."}
          </p>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold capitalize text-ink">{seleccionado.type}</p>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={duplicarSeleccion}
                  className="rounded border border-border px-2 py-0.5 text-[10px] hover:bg-surface-hover"
                  title="Duplicar"
                >
                  ⧉
                </button>
                <button
                  type="button"
                  onClick={traerAdelante}
                  className="rounded border border-border px-2 py-0.5 text-[10px] hover:bg-surface-hover"
                  title="Traer adelante"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={eliminarSeleccion}
                  className="rounded border border-red-200 px-2 py-0.5 text-[10px] text-red-600 hover:bg-red-50"
                  title="Eliminar"
                >
                  ✕
                </button>
              </div>
            </div>

            <label className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-2 py-1.5">
              <span className="text-xs text-muted">Bloquear posición</span>
              <button
                type="button"
                onClick={() => alternarBloqueo(seleccionado.id)}
                className={`rounded-md border px-2 py-0.5 text-xs ${
                  seleccionado.locked
                    ? "border-amber-300 bg-amber-50 text-amber-700"
                    : "border-border hover:bg-surface-hover"
                }`}
              >
                {seleccionado.locked ? "🔒 Bloqueado" : "🔓 Libre"}
              </button>
            </label>

            <div className="grid grid-cols-2 gap-2">
              {(["x", "y", "width", "height"] as const).map((k) => (
                <label key={k}>
                  <span className="text-xs text-muted">{k}</span>
                  <input
                    type="number"
                    disabled={seleccionado.locked && (k === "x" || k === "y")}
                    value={Math.round(seleccionado[k] as number)}
                    onChange={(e) =>
                      patchElemento(seleccionado.id, { [k]: Number(e.target.value) })
                    }
                    className="w-full rounded border border-border bg-surface px-2 py-1 text-xs disabled:opacity-50"
                  />
                </label>
              ))}
            </div>

            {seleccionado.type === "text" && (
              <>
                <label>
                  <span className="text-xs text-muted">Contenido</span>
                  <textarea
                    ref={contenidoTextareaRef}
                    rows={Math.min(16, Math.max(3, (seleccionado.content || "").split("\n").length))}
                    value={seleccionado.content}
                    onChange={(e) =>
                      actualizarContenidoTexto(
                        seleccionado.id,
                        e.target.value,
                        e.target.selectionStart,
                        e.target.selectionEnd,
                      )
                    }
                    onBlur={(e) =>
                      actualizarContenidoTexto(
                        seleccionado.id,
                        e.target.value,
                        e.target.selectionStart,
                        e.target.selectionEnd,
                      )
                    }
                    className="w-full rounded border border-border bg-surface px-2 py-1 text-xs leading-relaxed"
                  />
                  <SugerenciasTextoMagico
                    fragmento={seleccionado.content}
                    onElegir={(texto) =>
                      patchElemento(seleccionado.id, {
                        content: autoCorregirTextoContenido(texto),
                      })
                    }
                  />
                </label>
                <label>
                  <span className="text-xs text-muted">Tipografía</span>
                  <select
                    value={
                      esFuenteMontserrat(seleccionado.fontFamily)
                        ? FUENTE_MONTSERRAT_FAMILY
                        : seleccionado.fontFamily
                    }
                    onChange={(e) =>
                      patchElemento(seleccionado.id, {
                        fontFamily: e.target.value,
                      })
                    }
                    className="w-full rounded border border-border bg-surface px-2 py-1 text-xs"
                  >
                    <option value={FUENTE_MONTSERRAT_FAMILY}>Montserrat</option>
                    <option value="system-ui, sans-serif">System UI</option>
                  </select>
                </label>
                {esFuenteMontserrat(seleccionado.fontFamily) && (
                  <div>
                    <span className="mb-1 block text-xs text-muted">Variante Montserrat</span>
                    <div className="flex flex-wrap gap-1">
                      {VARIANTES_MONTSERRAT.map((v) => {
                        const activa =
                          varianteDesdeFontWeight(seleccionado.fontWeight) === v.id;
                        return (
                          <button
                            key={v.id}
                            type="button"
                            title={v.label}
                            onClick={() =>
                              patchElemento(seleccionado.id, {
                                fontWeight: String(pesoMontserratVariante(v.id)),
                              })
                            }
                            className={`rounded px-2 py-1 text-[10px] transition ${
                              activa
                                ? "bg-accent text-white"
                                : "border border-border text-ink-secondary hover:bg-surface-hover"
                            }`}
                            style={{
                              fontFamily: FUENTE_MONTSERRAT_FAMILY,
                              fontWeight: v.weight,
                            }}
                          >
                            {v.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <label>
                  <span className="text-xs text-muted">Tamaño</span>
                  <input
                    type="number"
                    min={TAMANO_TEXTO_MIN}
                    max={TAMANO_TEXTO_MAX}
                    step={PASO_TAMANO_TEXTO}
                    value={seleccionado.fontSize}
                    onChange={(e) =>
                      patchElemento(seleccionado.id, {
                        fontSize: ajustarTamanoTexto(Number(e.target.value)),
                      })
                    }
                    className="w-full rounded border border-border bg-surface px-2 py-1 text-xs"
                  />
                </label>
                <label>
                  <span className="text-xs text-muted">Color</span>
                  <input
                    type="color"
                    value={seleccionado.color}
                    onChange={(e) => patchElemento(seleccionado.id, { color: e.target.value })}
                    className="h-8 w-full cursor-pointer rounded border border-border"
                  />
                </label>
                <label>
                  <span className="text-xs text-muted">Alineación</span>
                  <select
                    value={seleccionado.align}
                    onChange={(e) =>
                      patchElemento(seleccionado.id, {
                        align: e.target.value as "left" | "center" | "right" | "justify",
                      })
                    }
                    className="w-full rounded border border-border bg-surface px-2 py-1 text-xs"
                  >
                    <option value="left">Izquierda</option>
                    <option value="center">Centro</option>
                    <option value="right">Derecha</option>
                    <option value="justify">Justificado</option>
                  </select>
                </label>
              </>
            )}

            {seleccionado.type === "rect" && (
              <>
                <label>
                  <span className="text-xs text-muted">Relleno</span>
                  <input
                    type="color"
                    value={seleccionado.fill.startsWith("#") ? seleccionado.fill : "#0891b2"}
                    onChange={(e) => patchElemento(seleccionado.id, { fill: e.target.value })}
                    className="h-8 w-full cursor-pointer rounded border border-border"
                  />
                </label>
                <label>
                  <span className="text-xs text-muted">Borde</span>
                  <input
                    type="color"
                    value={seleccionado.stroke.startsWith("#") ? seleccionado.stroke : "#0e7490"}
                    onChange={(e) => patchElemento(seleccionado.id, { stroke: e.target.value })}
                    className="h-8 w-full cursor-pointer rounded border border-border"
                  />
                </label>
                <label>
                  <span className="text-xs text-muted">Esquinas</span>
                  <select
                    value={seleccionado.borderRadius > 0 ? "redondeadas" : "rectas"}
                    onChange={(e) =>
                      patchElemento(seleccionado.id, {
                        borderRadius: e.target.value === "redondeadas"
                          ? Math.max(seleccionado.borderRadius || 8, 8)
                          : 0,
                      })
                    }
                    className="w-full rounded border border-border bg-surface px-2 py-1 text-xs"
                  >
                    <option value="rectas">Rectas</option>
                    <option value="redondeadas">Redondeadas</option>
                  </select>
                </label>
                {seleccionado.borderRadius > 0 && (
                  <label>
                    <span className="text-xs text-muted">Radio esquina (px)</span>
                    <input
                      type="number"
                      min={1}
                      max={Math.min(seleccionado.width, seleccionado.height) / 2}
                      value={seleccionado.borderRadius}
                      onChange={(e) =>
                        patchElemento(seleccionado.id, {
                          borderRadius: Math.max(0, Number(e.target.value)),
                        })
                      }
                      className="w-full rounded border border-border bg-surface px-2 py-1 text-xs"
                    />
                  </label>
                )}
              </>
            )}

            {seleccionado.type === "rect" && (
              <label>
                <span className="text-xs text-muted">Grosor borde</span>
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={seleccionado.strokeWidth}
                  onChange={(e) =>
                    patchElemento(seleccionado.id, {
                      strokeWidth: Math.max(0, Number(e.target.value)),
                    })
                  }
                  className="w-full rounded border border-border bg-surface px-2 py-1 text-xs"
                />
              </label>
            )}

            {seleccionado.type === "line" && (
              <label>
                <span className="text-xs text-muted">Grosor línea (0,15 – 5)</span>
                <input
                  type="number"
                  min={0.15}
                  max={5}
                  step={0.05}
                  value={seleccionado.strokeWidth}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    const clamped = Math.min(5, Math.max(0.15, Number.isFinite(v) ? v : 0.15));
                    patchElemento(seleccionado.id, { strokeWidth: clamped });
                  }}
                  className="w-full rounded border border-border bg-surface px-2 py-1 text-xs"
                />
              </label>
            )}

            {seleccionado.type === "line" && (
              <>
                <p className="text-[10px] leading-snug text-muted">
                  Mantén <kbd className="rounded border border-border px-1">Ctrl</kbd> al
                  arrastrar el extremo para alinear horizontal o vertical (90°).
                </p>
                <label>
                  <span className="text-xs text-muted">Color línea</span>
                  <input
                    type="color"
                    value={seleccionado.stroke.startsWith("#") ? seleccionado.stroke : "#334155"}
                    onChange={(e) => patchElemento(seleccionado.id, { stroke: e.target.value })}
                    className="h-8 w-full cursor-pointer rounded border border-border"
                  />
                </label>
              </>
            )}

            {seleccionado.type === "image" && (
              <label>
                <span className="text-xs text-muted">Ajuste imagen</span>
                <select
                  value={seleccionado.objectFit}
                  onChange={(e) =>
                    patchElemento(seleccionado.id, {
                      objectFit: e.target.value as "contain" | "cover",
                    })
                  }
                  className="w-full rounded border border-border bg-surface px-2 py-1 text-xs"
                >
                  <option value="contain">Contener</option>
                  <option value="cover">Cubrir</option>
                </select>
              </label>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
