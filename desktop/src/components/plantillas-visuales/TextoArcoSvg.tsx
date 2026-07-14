import { useId } from "react";
import { pesoFontWeightCss, type ElementoTexto } from "../../lib/plantillasVisuales";

/**
 * Texto sobre un arco (SVG textPath). `el.arco` va de -200 a 200:
 *   > 0 → curva hacia arriba (domo), < 0 → hacia abajo (valle), 0 → recto.
 * De 0 a ±100 la flecha (sagitta) crece hasta el semicírculo (diámetro = ancho
 * de la caja). De ±100 a ±200 el radio queda fijo en ancho/2 y el barrido crece
 * de 180° a 360°: ±200 = círculo completo (texto circular).
 * Mismo componente para el lienzo del editor y el render estático de export,
 * así el PNG exportado coincide con lo que se ve.
 */
export function geometriaArco(w: number, fontSize: number, arco: number) {
  const c = Math.max(-200, Math.min(200, arco));
  const a = Math.abs(c);
  const up = c > 0;
  const sag = (Math.min(a, 100) / 100) * (w / 2);
  // Radio del círculo que pasa por los extremos con esa flecha; más allá del
  // semicírculo el radio queda fijo y solo crece el ángulo barrido.
  const R = a > 100 ? w / 2 : sag > 0 ? sag / 2 + (w * w) / (8 * sag) : 0;
  const theta = R > 0
    ? a > 100
      ? Math.PI * (1 + (a - 100) / 100)
      : 2 * Math.asin(Math.min(1, w / 2 / R))
    : 0;
  const y0 = up ? sag + fontSize : fontSize;
  // Punto más bajo de la línea base del arco (medido desde el borde superior)
  const yBase = up ? fontSize + R * (1 - Math.cos(theta / 2)) : y0 + sag;
  const altoTotal = yBase + fontSize * (theta > Math.PI ? 1 : 0.45);
  return { c, sag, up, R, theta, y0, altoTotal };
}

export default function TextoArcoSvg({ el, escala = 1 }: { el: ElementoTexto; escala?: number }) {
  const uid = useId();
  const w = el.width * escala;
  const fs = el.fontSize * escala;
  const { sag, up, R, theta, altoTotal } = geometriaArco(w, fs, el.arco ?? 0);
  if (sag <= 0 || R <= 0) return null;
  // Path parametrizado desde el ápice (punto medio del arco). Un círculo
  // completo degeneraría el comando A (inicio = fin), así que se deja un
  // hueco microscópico en el barrido.
  const th = Math.min(theta, 2 * Math.PI - 0.002);
  const cy = up ? fs + R : fs + sag - R; // centro del círculo
  const sen = R * Math.sin(th / 2);
  const cos = R * Math.cos(th / 2);
  const x1 = w / 2 - sen;
  const x2 = w / 2 + sen;
  const y1 = up ? cy - cos : cy + cos;
  const large = th > Math.PI ? 1 : 0;
  const d = `M ${x1} ${y1} A ${R} ${R} 0 ${large} ${up ? 1 : 0} ${x2} ${y1}`;
  const pid = `arc-${el.id}-${uid}`;
  // El arco es de una sola línea: los saltos se colapsan a espacios
  const texto = (el.content || "").replace(/\s*\n\s*/g, " ").trim();
  const marcoAncho = (el.marcoAncho ?? 0) * escala;
  // Anillo concéntrico al círculo del texto (útil en marco 360°).
  const dibujarAnillo = marcoAncho > 0 && R > 0;
  const svgH = Math.max(el.height * escala, altoTotal, dibujarAnillo ? cy + R + marcoAncho : 0);
  return (
    <svg
      width={w}
      height={svgH}
      style={{ overflow: "visible", display: "block", pointerEvents: "none" }}
      aria-hidden
    >
      {dibujarAnillo && (
        <circle
          cx={w / 2}
          cy={cy}
          r={Math.max(0, R - fs * 0.15)}
          fill="none"
          stroke={el.marcoColor || el.color}
          strokeWidth={marcoAncho}
        />
      )}
      <path id={pid} d={d} fill="none" />
      <text
        fill={el.color}
        style={{
          fontFamily: el.fontFamily,
          fontWeight: pesoFontWeightCss(el.fontWeight),
          fontSize: `${fs}px`,
        }}
      >
        <textPath href={`#${pid}`} startOffset="50%" textAnchor="middle">
          {texto}
        </textPath>
      </text>
    </svg>
  );
}
