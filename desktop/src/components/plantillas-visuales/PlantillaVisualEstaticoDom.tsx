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
  /** id de elemento imagen -> URL ya resuelta (blob:/data:) o null si falló. */
  imagenesResueltas: Map<string, string | null>;
}

function ElementoEstatico({
  el,
  imagenesResueltas,
}: {
  el: ElementoVisual;
  imagenesResueltas: Map<string, string | null>;
}) {
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

  if (el.type === "line") {
    const x2 = el.x2 ?? el.x + el.width;
    const y2 = el.y2 ?? el.y;
    const minX = Math.min(el.x, x2);
    const minY = Math.min(el.y, y2);
    const w = Math.max(Math.abs(x2 - el.x), 1);
    const h = Math.max(Math.abs(y2 - el.y), 1);
    return (
      <svg
        style={{ position: "absolute", left: minX, top: minY, overflow: "visible", zIndex: el.zIndex }}
        width={w}
        height={h}
      >
        <line
          x1={el.x - minX}
          y1={el.y - minY}
          x2={x2 - minX}
          y2={y2 - minY}
          stroke={el.stroke}
          strokeWidth={el.strokeWidth}
          strokeLinecap="butt"
        />
      </svg>
    );
  }

  if (el.type === "image") {
    const src = el.src ? imagenesResueltas.get(el.id) : null;
    return (
      <div style={{ ...estiloElemento(el), overflow: "hidden" }}>
        {src ? (
          <img
            src={src}
            alt=""
            style={{
              display: "block",
              width: "100%",
              height: "100%",
              objectFit: el.objectFit,
              objectPosition: "center",
            }}
          />
        ) : null}
      </div>
    );
  }

  return null;
}

export default function PlantillaVisualEstaticoDom({ doc, imagenesResueltas }: Props) {
  const { ancho_px: w, alto_px: h } = doc.formato;
  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        width: w,
        height: h,
        background: doc.fondo || "#ffffff",
      }}
    >
      {doc.elementos
        .filter((el) => el.visible !== false)
        .sort((a, b) => a.zIndex - b.zIndex)
        .map((el) => (
          <ElementoEstatico key={el.id} el={el} imagenesResueltas={imagenesResueltas} />
        ))}
    </div>
  );
}
