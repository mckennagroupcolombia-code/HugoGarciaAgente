import {
  pesoFontWeightCss,
  type ElementoVisual,
  type PlantillaVisualDoc,
} from "../../lib/plantillasVisuales";
import { estiloElemento } from "./VisualCanvasEditor";
import { alturaCajaTexto } from "./TextoArcoSvg";
import { LINE_HEIGHT_DEFECTO } from "../../lib/textoCirculo";
import TextoCirculoDom from "./TextoCirculoDom";

/**
 * Render estático (sin interactividad) de una plantilla, con exactamente el
 * mismo DOM/CSS que ve el usuario en VisualCanvasEditor. El export PNG mide
 * aquí los saltos de línea reales y los pinta en canvas a 600 DPI.
 */
export interface Props {
  doc: PlantillaVisualDoc;
  /**
   * 1 = mismo layout que el editor (saltos, justify, métricas).
   * La resolución 600 DPI se pinta en canvas a partir de esos saltos.
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
    // Los arcos se rasterizan en canvas (html-to-image rompe textPath+rotate).
    if ((el.arco ?? 0) !== 0 && el.forma !== "circulo") return null;

    // Misma tipografía/caja que TextoCapaLienzo (sin antialias extra: cambia
    // métricas frente al lienzo y el PNG deja de coincidir).
    const base = estiloElementoEscalado(el, escala);
    const estilo: React.CSSProperties = {
      ...base,
      height: alturaCajaTexto(el) * escala,
      color: el.color,
      fontSize: `${el.fontSize * escala}px`,
      fontFamily: el.fontFamily,
      fontWeight: pesoFontWeightCss(el.fontWeight),
      textAlign: el.align,
      lineHeight: `${(el.lineHeight ?? LINE_HEIGHT_DEFECTO) * el.fontSize * escala}px`,
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
      overflow: "visible",
      boxSizing: "border-box",
    };
    if (el.forma === "circulo") {
      return (
        <div style={estilo}>
          <div style={{ pointerEvents: "none", width: "100%" }}>
            <TextoCirculoDom el={el} escala={escala} />
          </div>
        </div>
      );
    }
    return (
      <div style={estilo} data-export-text-id={el.id}>
        <div data-export-text-inner="" style={{ pointerEvents: "none", width: "100%" }}>
          {el.content}
        </div>
      </div>
    );
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

  // "line" e "image" no se dibujan aquí: el export los pinta directo en
  // canvas (líneas vectoriales e imágenes a resolución nativa).
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
        boxSizing: "border-box",
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
