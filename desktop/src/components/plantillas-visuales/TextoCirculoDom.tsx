import { useMemo } from "react";
import { pesoFontWeightCss, type ElementoTexto } from "../../lib/plantillasVisuales";
import { calcularTextoCirculo } from "../../lib/textoCirculo";

let _ctx: CanvasRenderingContext2D | null = null;
function medidorCanvas(font: string): (s: string) => number {
  if (!_ctx) _ctx = document.createElement("canvas").getContext("2d");
  const ctx = _ctx;
  if (!ctx) return (s) => s.length * 8;
  ctx.font = font;
  return (s) => ctx.measureText(s).width;
}

/**
 * Texto envuelto/justificado dentro de un círculo (el.forma === "circulo").
 * Cada línea es un div posicionado sobre la cuerda del círculo a su altura;
 * las justificadas reparten palabras con flex space-between — la misma
 * aritmética que el raster Python, así el export coincide con el editor.
 * Color, fuente y peso se heredan del contenedor del elemento.
 */
export default function TextoCirculoDom({ el, escala = 1 }: { el: ElementoTexto; escala?: number }) {
  const w = el.width * escala;
  const fs = el.fontSize * escala;
  const lh = el.lineHeight ?? 1.2;
  const lhPx = fs * lh;
  const font = `${pesoFontWeightCss(el.fontWeight)} ${fs}px ${el.fontFamily}`;
  // Con marco, el texto se retira un poco de la cuerda para no tocarlo.
  const holgura = (el.marcoAncho ?? 0) > 0 ? fs * 0.35 : 0;
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
      ),
    [el.content, w, fs, lh, el.align, font, holgura],
  );
  if (!layout) return null;
  const alignLinea = el.align === "justify" ? "center" : el.align ?? "left";
  // Marco circular opcional, concéntrico al círculo del texto y un pelo más
  // afuera para que los glifos del ecuador no lo toquen.
  const marcoAncho = (el.marcoAncho ?? 0) * escala;
  const radioMarco = marcoAncho > 0 ? layout.radio + marcoAncho / 2 + fs * 0.1 : 0;
  return (
    <div
      style={{
        position: "relative",
        width: w,
        height: Math.max(layout.altoTotal, layout.radio + radioMarco),
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
              position: "absolute",
              left: l.xIni,
              top: l.yCenter - lhPx / 2,
              width: l.chord,
              height: lhPx,
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
              position: "absolute",
              left: l.xIni,
              top: l.yCenter - lhPx / 2,
              width: l.chord,
              lineHeight: `${lhPx}px`,
              textAlign: alignLinea as "left" | "center" | "right",
              whiteSpace: "nowrap",
            }}
          >
            {l.texto}
          </div>
        ),
      )}
    </div>
  );
}
