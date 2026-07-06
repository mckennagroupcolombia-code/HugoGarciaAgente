import {
  pesoFontWeightCss,
  type ElementoVisual,
  type PlantillaVisualDoc,
} from "../../lib/plantillasVisuales";
import { estiloElemento } from "./VisualCanvasEditor";

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
   * Factor de resolución de exportación (2×, 3×, "Máxima"…). Se aplica como
   * `transform: scale()` sobre el lienzo a tamaño natural, en vez de dejar
   * que html-to-image estire un bitmap ya rasterizado a 1× — así el texto se
   * pinta nítido directamente a la resolución final, no borroso por upscale.
   */
  escala?: number;
  /** true en composiciones multi-pasada: el fondo ya lo pintó otro paso. */
  fondoTransparente?: boolean;
}

function ElementoEstatico({ el }: { el: ElementoVisual }) {
  if (el.type === "text") {
    const estilo: React.CSSProperties = {
      ...estiloElemento(el),
      color: el.color,
      fontSize: `${el.fontSize}px`,
      fontFamily: el.fontFamily,
      fontWeight: pesoFontWeightCss(el.fontWeight),
      textAlign: el.align,
      lineHeight: 1.2,
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
    };
    return <div style={estilo}>{el.content}</div>;
  }

  if (el.type === "rect") {
    const r = el.borderRadius || 0;
    return (
      <div
        style={{
          ...estiloElemento(el),
          background: el.fill,
          border: el.strokeWidth > 0 ? `${el.strokeWidth}px solid ${el.stroke}` : undefined,
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
  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        width: w * escala,
        height: h * escala,
      }}
    >
      <div
        style={{
          position: "relative",
          width: w,
          height: h,
          background: fondoTransparente ? "transparent" : doc.fondo || "#ffffff",
          transform: escala !== 1 ? `scale(${escala})` : undefined,
          transformOrigin: "top left",
        }}
      >
        {doc.elementos
          .filter((el) => el.visible !== false)
          .sort((a, b) => a.zIndex - b.zIndex)
          .map((el) => (
            <ElementoEstatico key={el.id} el={el} />
          ))}
      </div>
    </div>
  );
}
