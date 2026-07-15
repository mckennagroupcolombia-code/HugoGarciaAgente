import { useMemo } from "react";
import { pesoFontWeightCss, type ElementoTexto } from "../../lib/plantillasVisuales";
import {
  calcularTextoCirculo,
  LINE_HEIGHT_DEFECTO,
  type CirculoPorcion,
} from "../../lib/textoCirculo";

let _ctx: CanvasRenderingContext2D | null = null;
function medidorCanvas(font: string): (s: string) => number {
  if (!_ctx) _ctx = document.createElement("canvas").getContext("2d");
  const ctx = _ctx;
  if (!ctx) return (s) => s.length * 8;
  ctx.font = font;
  return (s) => ctx.measureText(s).width;
}

/**
 * Párrafo envuelto dentro de un círculo (o un tramo: superior / banda / inferior).
 * Cada línea usa la misma caja de alto `lhPx` para un interlineado uniforme.
 */
export default function TextoCirculoDom({ el, escala = 1 }: { el: ElementoTexto; escala?: number }) {
  const w = el.width * escala;
  const fs = el.fontSize * escala;
  const lh = el.lineHeight ?? LINE_HEIGHT_DEFECTO;
  const font = `${pesoFontWeightCss(el.fontWeight)} ${fs}px ${el.fontFamily}`;
  const holgura = (el.marcoAncho ?? 0) > 0 ? fs * 0.35 : 0;
  const porcion: CirculoPorcion = el.circuloPorcion ?? "completo";
  const layout = useMemo(
    () =>
      calcularTextoCirculo(
        el.content || "",
        w,
        fs,
        lh,
        el.align ?? "left",
        medidorCanvas(font),
        holgura,
        porcion,
      ),
    [el.content, w, fs, lh, el.align, font, holgura, porcion],
  );
  if (!layout) return null;
  const { lhPx } = layout;
  const alignLinea = el.align === "justify" ? "center" : el.align ?? "left";
  const marcoAncho = (el.marcoAncho ?? 0) * escala;
  const radioMarco = marcoAncho > 0 ? layout.radio + marcoAncho / 2 + fs * 0.1 : 0;

  const cajaLinea = (l: (typeof layout.lineas)[number]): React.CSSProperties => ({
    position: "absolute",
    left: l.xIni,
    top: l.yCenter - lhPx / 2,
    width: l.chord,
    height: lhPx,
    lineHeight: `${lhPx}px`,
    overflow: "hidden",
    boxSizing: "border-box",
    fontSize: `${fs}px`,
    fontFamily: el.fontFamily,
    fontWeight: pesoFontWeightCss(el.fontWeight),
    color: el.color,
  });

  return (
    <div
      style={{
        position: "relative",
        width: w,
        height: Math.max(layout.altoTotal, layout.radio + radioMarco, 2 * layout.radio),
        pointerEvents: "none",
      }}
      aria-hidden
    >
      {marcoAncho > 0 && (
        <div
          style={{
            position: "absolute",
            left: w / 2 - radioMarco,
            top: layout.radio - radioMarco,
            width: radioMarco * 2,
            height: radioMarco * 2,
            boxSizing: "border-box",
            border: `${marcoAncho}px solid ${el.marcoColor || el.color}`,
            borderRadius: "50%",
          }}
        />
      )}
      {layout.lineas.map((l, i) =>
        l.justificar ? (
          <div
            key={i}
            style={{
              ...cajaLinea(l),
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              whiteSpace: "pre",
            }}
          >
            {l.palabras.map((p, j) => (
              <span key={j}>{p}</span>
            ))}
          </div>
        ) : (
          <div
            key={i}
            style={{
              ...cajaLinea(l),
              display: "flex",
              alignItems: "center",
              justifyContent:
                alignLinea === "right"
                  ? "flex-end"
                  : alignLinea === "center"
                    ? "center"
                    : "flex-start",
              whiteSpace: "nowrap",
              textAlign: alignLinea as "left" | "center" | "right",
            }}
          >
            {l.texto}
          </div>
        ),
      )}
    </div>
  );
}
