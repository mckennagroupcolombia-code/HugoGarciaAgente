import {
  esLienzoCircular,
  margenSeguroCircularPx,
  pesoFontWeightCss,
  type ElementoTexto,
  type PlantillaVisualDoc,
} from "../../lib/plantillasVisuales";

/**
 * Texto sobre un arco (SVG textPath). Modelo simple:
 *   `arco` ∈ [-200, 200]; 0 = recto.
 *   > 0 → curva hacia arriba (domo); < 0 → hacia abajo (valle).
 *   ±100 = semicírculo (diámetro ≈ ancho de la caja).
 *   ±200 = círculo casi completo.
 *
 * Misma geometría que `_texto_arco_raster` en plantillas_visuales.py.
 */
export function geometriaArco(w: number, fontSize: number, arco: number) {
  const c = Math.max(-200, Math.min(200, arco));
  const a = Math.abs(c);
  const up = c > 0;
  const sag = (Math.min(a, 100) / 100) * (w / 2);
  const R = a > 100 ? w / 2 : sag > 0 ? sag / 2 + (w * w) / (8 * sag) : 0;
  const theta = R > 0
    ? a > 100
      ? Math.PI * (1 + (a - 100) / 100)
      : 2 * Math.asin(Math.min(1, w / 2 / R))
    : 0;
  const y0 = up ? sag + fontSize : fontSize;
  const yBase = up ? fontSize + R * (1 - Math.cos(theta / 2)) : y0 + sag;
  const altoTotal = yBase + fontSize * (theta > Math.PI ? 1 : 0.45);
  return { c, sag, up, R, theta, y0, altoTotal };
}

/**
 * Alto de caja para layout / rotación / export.
 * Nunca usa valores corruptos (p. ej. 650k px de un measure bug antiguo).
 */
export function alturaCajaTexto(el: ElementoTexto, topeArtboard = 4000): number {
  const lh = el.lineHeight ?? 1.25;
  if (el.forma === "circulo") {
    return Math.max(8, Math.round(el.width));
  }
  if ((el.arco ?? 0) !== 0) {
    return Math.max(8, Math.ceil(geometriaArco(el.width, el.fontSize, el.arco ?? 0).altoTotal));
  }
  const raw = el.content ?? "";
  const lineasExplicitas = Math.max(1, raw.split("\n").length);
  const chars = Math.max(1, raw.replace(/\n/g, "").length);
  const anchoChar = Math.max(4.5, el.fontSize * 0.52);
  const anchoUtil = Math.max(el.width, 8);
  const lineasWrap = Math.max(1, Math.ceil((chars * anchoChar) / anchoUtil));
  const lineas = Math.max(lineasExplicitas, lineasWrap);
  const estimado = Math.max(
    Math.ceil(el.fontSize * lh * lineas) + 6,
    Math.ceil(el.fontSize * lh) + 4,
    16,
  );
  const tope = Math.max(topeArtboard * 4, el.fontSize * 80, estimado * 4);
  if (!Number.isFinite(el.height) || el.height <= 0 || el.height > tope) {
    return estimado;
  }
  return Math.max(el.height, Math.ceil(el.fontSize * lh) + 4);
}

/**
 * Recoge un título en arco para que las letras queden dentro del círculo
 * imprimible. El troquel corta todo lo que se sale del diámetro; el editor
 * muestra un cuadrado y eso no se nota hasta la impresión.
 */
export function ajustarArcoAZonaSeguraCircular(
  el: ElementoTexto,
  canvasW: number,
  canvasH: number,
  margenPx: number,
): ElementoTexto {
  const arco = el.arco ?? 0;
  if (arco === 0 || el.forma === "circulo") return el;
  const geo = geometriaArco(el.width, el.fontSize, arco);
  if (geo.R <= 0) return el;

  const cx = canvasW / 2;
  const cy = canvasH / 2;
  const rDie = Math.min(canvasW, canvasH) / 2;
  const rSafe = Math.max(20, rDie - margenPx);
  // 1.25 cubre tildes (KARITÉ) que 0.9 dejaba fuera del troquel al imprimir.
  const ascent = el.fontSize * 1.25;
  const cyLocal = geo.up ? el.fontSize + geo.R : el.fontSize + geo.sag - geo.R;
  const pcx = el.x + el.width / 2;
  const pcy = el.y + cyLocal;
  const rOuter = geo.R + ascent;
  const dist = Math.hypot(pcx - cx, pcy - cy);
  if (dist + rOuter <= rSafe + 0.4) return el;

  const rMax = Math.max(18, rSafe - ascent);
  const newW = Math.abs(arco) >= 100 ? 2 * rMax : Math.min(el.width, 2 * rMax);
  const newGeo = geometriaArco(newW, el.fontSize, arco);
  if (newGeo.R <= 0) return el;
  const newCyLocal = newGeo.up
    ? el.fontSize + newGeo.R
    : el.fontSize + newGeo.sag - newGeo.R;
  return {
    ...el,
    width: newW,
    height: Math.max(8, Math.ceil(newGeo.altoTotal)),
    x: cx - newW / 2,
    y: cy - newCyLocal,
  };
}

/** Reescribe altos absurdos (measure bug) y sincroniza arcos/círculos. */
export function sanitizarAltosTextoPlantilla(doc: PlantillaVisualDoc): PlantillaVisualDoc {
  const tope = Math.max(doc.formato.ancho_px || 0, doc.formato.alto_px || 0, 1);
  const circular = esLienzoCircular(doc);
  const margen = circular ? margenSeguroCircularPx(doc.formato) : 0;
  let changed = false;
  const elementos = doc.elementos.map((el) => {
    if (el.type !== "text") return el;
    let next = el;
    if (circular && (el.arco ?? 0) !== 0 && el.forma !== "circulo") {
      const ajustado = ajustarArcoAZonaSeguraCircular(el, doc.formato.ancho_px, doc.formato.alto_px, margen);
      if (
        ajustado.x !== el.x ||
        ajustado.y !== el.y ||
        ajustado.width !== el.width ||
        ajustado.height !== el.height
      ) {
        changed = true;
        next = ajustado;
      }
    }
    const nextH = alturaCajaTexto(next, tope);
    if (Math.abs(nextH - next.height) < 0.51) return next;
    const esArco = (next.arco ?? 0) !== 0 && next.forma !== "circulo";
    const esCirculo = next.forma === "circulo";
    const corrupto = !Number.isFinite(next.height) || next.height > tope * 4 || next.height > next.fontSize * 80;
    if (!esArco && !esCirculo && !corrupto) return next;
    changed = true;
    return { ...next, height: nextH };
  });
  return changed ? { ...doc, elementos } : doc;
}

export default function TextoArcoSvg({ el, escala = 1 }: { el: ElementoTexto; escala?: number }) {
  const w = el.width * escala;
  const fs = el.fontSize * escala;
  const { sag, up, R, theta, altoTotal } = geometriaArco(w, fs, el.arco ?? 0);
  if (sag <= 0 || R <= 0) return null;

  const th = Math.min(theta, 2 * Math.PI - 0.002);
  const cy = up ? fs + R : fs + sag - R;
  const sen = R * Math.sin(th / 2);
  const cos = R * Math.cos(th / 2);
  const x1 = w / 2 - sen;
  const x2 = w / 2 + sen;
  const y1 = up ? cy - cos : cy + cos;
  const large = th > Math.PI ? 1 : 0;
  const d = `M ${x1} ${y1} A ${R} ${R} 0 ${large} ${up ? 1 : 0} ${x2} ${y1}`;
  // ID estable (sin useId): html-to-image rompe textPath si el fragment tiene ":".
  const pid = `pv-arc-${String(el.id).replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const texto = (el.content || "").replace(/\s*\n\s*/g, " ").trim();
  const marcoAncho = (el.marcoAncho ?? 0) * escala;
  const dibujarAnillo = marcoAncho > 0 && Math.abs(el.arco ?? 0) >= 150;
  const hSvg = Math.max(alturaCajaTexto(el) * escala, altoTotal);

  return (
    <svg
      width={w}
      height={hSvg}
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
