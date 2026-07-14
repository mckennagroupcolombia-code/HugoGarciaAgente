import {
  cloneElement,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  pesoFontWeightCss,
  type ElementoTexto,
} from "../../lib/plantillasVisuales";
import TextoArcoSvg from "./TextoArcoSvg";

type Props = {
  el: ElementoTexto;
  /** left/top ya con pasteboard aplicado */
  left: number;
  top: number;
  seleccionado: boolean;
  esPrincipal: boolean;
  mostrandoCaja: boolean;
  locked: boolean;
  editando: boolean;
  textoEdicion: string;
  onHover: (id: string | null) => void;
  onPointerDownMove: (e: ReactPointerEvent) => void;
  onIniciarEdicion: () => void;
  onTextoEdicionChange: (v: string) => void;
  onCommitEdicion: () => void;
  onCancelEdicion: () => void;
  /** Notifica el alto real del contenido para sincronizar el height guardado. */
  onAltoMedido?: (id: string, alto: number) => void;
  chrome: ReactNode;
};

/**
 * Capa de texto del lienzo: la caja interactiva crece con el glifo (height:auto)
 * y la edición se hace en un panel flotante (portal) para no pelear con zoom/drag.
 */
export default function TextoCapaLienzo({
  el,
  left,
  top,
  seleccionado,
  esPrincipal,
  mostrandoCaja,
  locked,
  editando,
  textoEdicion,
  onHover,
  onPointerDownMove,
  onIniciarEdicion,
  onTextoEdicionChange,
  onCommitEdicion,
  onCancelEdicion,
  onAltoMedido,
  chrome,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // La caja de texto se ciñe al CONTENIDO (no al height guardado): el marco
  // de selección debe corresponder a lo que realmente ocupa el texto.
  const [boxH, setBoxH] = useState(Math.max(el.height, el.fontSize * 1.2));
  const [flotante, setFlotante] = useState<{ left: number; top: number; width: number } | null>(
    null,
  );
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const node = wrapRef.current;
    if (!node || editando) return;
    const h = Math.max(Math.ceil(node.scrollHeight), Math.ceil(el.fontSize * 1.2));
    setBoxH((prev) => (prev === h ? prev : h));
    // Persistir el alto medido para que el height guardado coincida con el
    // contenido real. Solo con el elemento seleccionado: así abrir una
    // plantilla vieja no la marca como "con cambios" hasta que se interactúa.
    if (seleccionado && onAltoMedido && Math.abs(h - el.height) > 1) onAltoMedido(el.id, h);
  }, [el.content, el.width, el.fontSize, el.lineHeight, el.fontFamily, el.fontWeight, el.height, el.id, editando, seleccionado, onAltoMedido]);

  useEffect(() => {
    if (!editando) {
      setFlotante(null);
      return;
    }
    const node = wrapRef.current;
    if (!node) return;
    const r = node.getBoundingClientRect();
    setFlotante({
      left: Math.max(8, r.left),
      top: Math.max(8, r.top),
      width: Math.max(r.width, el.width, 220),
    });
    const t = window.setTimeout(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      const len = ta.value.length;
      try {
        ta.setSelectionRange(len, len);
      } catch {
        /* ignore */
      }
    }, 30);
    return () => window.clearTimeout(t);
  }, [editando, el.width]);

  const estilo: CSSProperties = {
    position: "absolute",
    left,
    top,
    width: el.width,
    // Crítico: no fijar height al valor guardado (suele ser una franja chica).
    height: "auto",
    minHeight: boxH,
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
    transformOrigin: "center center",
    zIndex: el.zIndex,
    color: el.color,
    fontSize: `${el.fontSize}px`,
    fontFamily: el.fontFamily,
    fontWeight: pesoFontWeightCss(el.fontWeight),
    textAlign: el.align,
    lineHeight: el.lineHeight ?? 1.2,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    overflow: "visible",
    cursor: locked ? "default" : seleccionado ? "text" : "move",
    touchAction: "none",
  };

  const chromeMedido: ReactNode =
    isValidElement(chrome)
      ? cloneElement(chrome as ReactElement<{ width?: number; height?: number }>, {
          width: el.width,
          height: boxH,
        })
      : chrome;

  return (
    <>
      <div
        ref={wrapRef}
        className="group/elem"
        style={estilo}
        onPointerEnter={(e) => {
          e.stopPropagation();
          if (!editando) onHover(el.id);
        }}
        onPointerLeave={() => onHover(null)}
        onPointerDown={(e) => {
          if (editando) {
            e.stopPropagation();
            return;
          }
          onPointerDownMove(e);
        }}
        onDoubleClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (locked) return;
          onIniciarEdicion();
        }}
      >
        {(seleccionado || mostrandoCaja) && !editando && (
          <div
            style={{
              position: "absolute",
              bottom: "100%",
              left: 0,
              marginBottom: 3,
              pointerEvents: "none",
              zIndex: 9999,
              whiteSpace: "nowrap",
            }}
            className="rounded bg-[#016d82]/95 px-1.5 py-0.5 text-[9px] font-semibold text-white shadow"
          >
            {esPrincipal ? "Doble clic o Enter para editar" : "Texto"}
          </div>
        )}
        <div style={{ pointerEvents: "none", width: "100%" }}>
          {(el.arco ?? 0) !== 0 ? <TextoArcoSvg el={el} /> : el.content}
        </div>
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: el.width,
            height: Math.max(boxH, el.height),
            pointerEvents: "none",
            overflow: "visible",
          }}
        >
          {chromeMedido}
        </div>
        {seleccionado && !editando && !locked && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onIniciarEdicion();
            }}
            className="absolute -right-1 -top-7 z-[10001] rounded border border-[#016d82] bg-white px-2 py-0.5 text-[10px] font-semibold text-[#016d82] shadow"
          >
            Editar
          </button>
        )}
      </div>

      {editando &&
        flotante &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: flotante.left,
              top: flotante.top,
              width: Math.min(flotante.width, window.innerWidth - 24),
              zIndex: 200000,
            }}
            className="rounded-md border-2 border-[#016d82] bg-white p-2 shadow-2xl"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[#016d82]">
                Editar texto
              </span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={onCancelEdicion}
                  className="rounded border border-border px-2 py-0.5 text-[10px] text-muted hover:bg-surface-hover"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={onCommitEdicion}
                  className="rounded border border-[#016d82] bg-[#016d82] px-2 py-0.5 text-[10px] font-semibold text-white"
                >
                  Listo
                </button>
              </div>
            </div>
            <textarea
              ref={taRef}
              value={textoEdicion}
              onChange={(e) => onTextoEdicionChange(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Escape") {
                  e.preventDefault();
                  onCancelEdicion();
                }
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  onCommitEdicion();
                }
              }}
              rows={Math.min(18, Math.max(6, textoEdicion.split("\n").length + 2))}
              style={{
                width: "100%",
                minHeight: 120,
                resize: "vertical",
                color: el.color,
                fontSize: Math.max(12, Math.min(el.fontSize, 18)),
                fontFamily: el.fontFamily,
                fontWeight: pesoFontWeightCss(el.fontWeight),
                textAlign: el.align,
                lineHeight: el.lineHeight ?? 1.3,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                border: "1px solid #cbd5e1",
                borderRadius: 4,
                padding: 8,
                outline: "none",
              }}
            />
            <p className="mt-1 text-[10px] text-slate-500">Ctrl+Enter guarda · Esc cancela</p>
          </div>,
          document.body,
        )}
    </>
  );
}
