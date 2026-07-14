import {
  pesoFontWeightCss,
  type ElementoVisual,
  type PlantillaVisualDoc,
} from "../../lib/plantillasVisuales";
import { estiloElemento } from "./VisualCanvasEditor";
import TextoArcoSvg from "./TextoArcoSvg";

/**
 * Render estático (sin interactividad) de una plantilla, con exactamente el
 * mismo DOM/CSS que ve el usuario en VisualCanvasEditor. Se usa para exportar
 * PNG/JPEG capturando este nodo con html-to-image, en vez de reimplementar el
 * layout de texto a mano en un <canvas> — así el archivo exportado coincide
 * con lo que se ve en el editor.
 */
export interface Props {
  doc: PlantillaVisualDoc;
  /**
   * 1 = mismo layout que el editor (recomendado con pixelRatio en export).
   * >1 solo si se captura sin pixelRatio (legado).
   */
  escala?: number;
  /** true en composiciones multi-pasada: el fondo ya lo pintó otro paso. */
  fondoTransparente?: boolean;
}

function estiloElementoEscalado(el: ElementoVisual, escala: number): React.CSSProperties {
  if (escala === 1) return estiloElemento(el);
  const base = estiloElemento(el);
  return {
    ...base,
    left: el.x * escala,
    top: el.y * escala,
    width:
      el.type === "line"
        ? Math.abs((el.x2 ?? el.x) - el.x) * escala || el.width * escala
        : el.width * escala,
    height:
      el.type === "line"
        ? Math.abs((el.y2 ?? el.y) - el.y) * escala || el.height * escala
        : el.height * escala,
  };
}

function ElementoEstatico({ el, escala }: { el: ElementoVisual; escala: number }) {
  if (el.type === "text") {
    const estilo: React.CSSProperties = {
      ...estiloElementoEscalado(el, escala),
      color: el.color,
      fontSize: `${el.fontSize * escala}px`,
      fontFamily: el.fontFamily,
      fontWeight: pesoFontWeightCss(el.fontWeight),
      textAlign: el.align,
      lineHeight: el.lineHeight ?? 1.2,
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
      overflow: "visible",
      WebkitFontSmoothing: "antialiased",
      MozOsxFontSmoothing: "grayscale",
      textRendering: "geometricPrecision",
    };
    if ((el.arco ?? 0) !== 0) {
      return (
        <div style={estilo}>
          <TextoArcoSvg el={el} escala={escala} />
        </div>
      );
    }
    return <div style={estilo}>{el.content}</div>;
  }

  if (el.type === "rect") {
    const r = (el.borderRadius || 0) * escala;
    const strokeW = (el.strokeWidth || 0) * escala;
    return (
      <div
        style={{
          ...estiloElementoEscalado(el, escala),
          background: el.fill,
          border: strokeW > 0 ? `${strokeW}px solid ${el.stroke}` : undefined,
          borderRadius: r,
        }}
      />
    );
  }

  // "line" e "image" no se dibujan aquí: html-to-image los rasteriza mal
  // dentro de su foreignObject (líneas de 1px que se desplazan al escalar,
  // imágenes cacheadas a la resolución de layout en vez de la nativa). Se
  // pintan aparte, directo sobre el canvas ya capturado, intercalados por
  // zIndex con estos pasos DOM (ver renderPlantillaToCanvasDom).
  return null;
}

export default function PlantillaVisualEstaticoDom({
  doc,
  escala = 1,
  fondoTransparente = false,
}: Props) {
  const { ancho_px: w, alto_px: h } = doc.formato;
  const ancho = Math.max(1, Math.round(w * escala));
  const alto = Math.max(1, Math.round(h * escala));
  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        width: ancho,
        height: alto,
        background: fondoTransparente ? "transparent" : doc.fondo || "#ffffff",
      }}
    >
      {doc.elementos
        .filter((el) => el.visible !== false)
        .sort((a, b) => a.zIndex - b.zIndex)
        .map((el) => (
          <ElementoEstatico key={el.id} el={el} escala={escala} />
        ))}
    </div>
  );
}
