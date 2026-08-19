import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { getFontEmbedCSS } from "html-to-image";
import {
  esFuenteMontserrat,
  pesoFontWeightCss,
  EXPORT_ESCALA_MAX,
  esLienzoCircular,
  type ElementoTexto,
  type ElementoVisual,
  type PlantillaVisualDoc,
} from "./plantillasVisuales";
import { esSrcImagenApi, resolverUrlImagenCanvas } from "./plantillasVisualesImagen";
import {
  calcularTextoCirculo,
  LINE_HEIGHT_DEFECTO,
  type CirculoPorcion,
} from "./textoCirculo";
import PlantillaVisualEstaticoDom from "../components/plantillas-visuales/PlantillaVisualEstaticoDom";
import TextoArcoSvg, {
  alturaCajaTexto,
  sanitizarAltosTextoPlantilla,
} from "../components/plantillas-visuales/TextoArcoSvg";

/** Misma proporción que el interlineado por defecto del lienzo (1.25). */
const LINE_HEIGHT_RATIO = 1.25;

export interface OpcionesExportPlantilla {
  /** Escala uniforme (1 = tamaño del lienzo, 2 = doble resolución, etc.). */
  escala?: number;
  forzarFondoOpaco?: boolean;
}

function clampEscalaExport(escala: number | undefined): number {
  const s = escala ?? 1;
  return Math.max(0.25, Math.min(EXPORT_ESCALA_MAX, s));
}

type LineaMedida = { texto: string; justificar: boolean };

type MedidaTextoExport = {
  lineas: LineaMedida[];
  letterSpacing: string;
};

function aplicarLetterSpacing(
  ctx: CanvasRenderingContext2D,
  letterSpacing: string | undefined,
): void {
  if (!letterSpacing) return;
  const ctxLs = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if (typeof ctxLs.letterSpacing === "string") ctxLs.letterSpacing = letterSpacing;
}

function fontFamilyCanvas(fontFamily: string): string {
  if (esFuenteMontserrat(fontFamily || "")) return "Montserrat";
  const raw = (fontFamily || "sans-serif").replace(/"/g, "").trim();
  return raw.split(",")[0]?.trim() || "sans-serif";
}

function fontCssTexto(el: ElementoTexto): string {
  const fw = pesoFontWeightCss(el.fontWeight);
  return `${fw} ${el.fontSize}px ${fontFamilyCanvas(el.fontFamily)}`;
}

async function asegurarFuentesLienzo(doc: PlantillaVisualDoc, escala = 1): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  await document.fonts.ready;
  const specs = new Set<string>();
  for (const el of doc.elementos) {
    if (el.type !== "text" || el.visible === false) continue;
    const fw = pesoFontWeightCss(el.fontWeight);
    const size = Math.max(4, Math.round(el.fontSize * escala));
    const family = fontFamilyCanvas(el.fontFamily);
    specs.add(`${fw} ${size}px ${family}`);
    specs.add(`${fw} ${size}px Montserrat`);
    specs.add(`${fw} ${size}px sans-serif`);
  }
  await Promise.all([...specs].map((spec) => document.fonts.load(spec).catch(() => undefined)));
}

/** Alias explícito: el export DOM pinta tipografía ya multiplicada por escala. */
async function asegurarFuentesLienzoEscalado(doc: PlantillaVisualDoc, escala: number): Promise<void> {
  await asegurarFuentesLienzo(doc, escala);
}

export function normalizarSrcImagen(src: string): string {
  const raw = (src || "").trim();
  if (!raw || raw.startsWith("data:") || raw.startsWith("blob:")) return raw;
  if (esSrcImagenApi(raw)) return raw;
  try {
    const u = new URL(raw, typeof window !== "undefined" ? window.location.origin : "http://local");
    if (
      u.pathname.includes("/recursos-png/") ||
      u.pathname.includes("/plantillas-visuales/assets/")
    ) {
      return u.pathname;
    }
  } catch {
    /* relativo */
  }
  return raw;
}

/** Convierte un blob:/http(s) URL ya resuelto a un data: URI leyendo el blob directamente. */
async function urlAdataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Imagen no disponible (${res.status})`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("No se pudo leer la imagen"));
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

/**
 * Resuelve cada imagen del documento a un `data:` URI ya embebido. Esto evita
 * que html-to-image tenga que volver a hacer fetch de la URL (típicamente un
 * blob: del propio editor) al capturar — ese segundo fetch podía fallar (p.ej.
 * al no propagarse correctamente el tipo MIME) y dejaba la imagen reemplazada
 * por el placeholder de fallo.
 */
async function resolverImagenesPlantilla(
  doc: PlantillaVisualDoc,
): Promise<Map<string, string | null>> {
  const mapa = new Map<string, string | null>();
  const imagenes = doc.elementos.filter(
    (el): el is Extract<ElementoVisual, { type: "image" }> =>
      el.type === "image" && !!el.src && el.visible !== false,
  );
  await Promise.all(
    imagenes.map(async (el) => {
      try {
        const resuelto = await resolverUrlImagenCanvas(normalizarSrcImagen(el.src));
        if (!resuelto) {
          mapa.set(el.id, null);
          return;
        }
        mapa.set(el.id, resuelto.startsWith("data:") ? resuelto : await urlAdataUrl(resuelto));
      } catch {
        mapa.set(el.id, null);
      }
    }),
  );
  return mapa;
}

/**
 * html-to-image rechaza con el Event nativo `onerror`/`onload` del <img> o del
 * <svg> intermedio cuando algo falla (imagen que no carga, SVG demasiado
 * grande para decodificar, etc.), no con un `Error`. Sin normalizar esto, la
 * UI solo puede mostrar un mensaje genérico. Aquí se convierte a un Error
 * legible para poder diagnosticar la causa real.
 */
function normalizarErrorExportDom(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof DOMException !== "undefined" && err instanceof DOMException) {
    return new Error(`${err.name}: ${err.message}`);
  }
  if (typeof Event !== "undefined" && err instanceof Event) {
    const target = err.target as { src?: string } | null;
    const recurso = target?.src ? ` (recurso: ${target.src.slice(0, 160)})` : "";
    return new Error(
      `No se pudo generar la imagen de exportación${recurso}. Revisa la consola del navegador para más detalle.`,
    );
  }
  if (typeof err === "string") return new Error(err);
  return new Error("Error al exportar por una causa no identificada. Revisa la consola del navegador.");
}

function cargarImagenDesde(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("No se pudo decodificar la imagen"));
    img.src = src;
  });
}

/**
 * Dibuja una imagen directamente sobre el canvas, a su resolución nativa (con
 * `ctx.drawImage`), en vez de confiar en el bitmap que `html-to-image`
 * generaría dentro de un `foreignObject`. Ese `foreignObject` rasteriza el
 * `<img>` a la resolución de layout antes de escalar al tamaño final,
 * así que a "Alta"/"Máxima" el resultado quedaba pixelado.
 */
async function dibujarImagenEnCanvas(
  ctx: CanvasRenderingContext2D,
  el: Extract<ElementoVisual, { type: "image" }>,
  imagenesResueltas: Map<string, string | null>,
  escala: number,
): Promise<void> {
  const dataUrl = imagenesResueltas.get(el.id);
  if (!dataUrl) return;
  let img: HTMLImageElement;
  try {
    img = await cargarImagenDesde(dataUrl);
  } catch {
    return;
  }
  if (!img.naturalWidth || !img.naturalHeight) return;

  const cx = (el.x + el.width / 2) * escala;
  const cy = (el.y + el.height / 2) * escala;
  const w = el.width * escala;
  const h = el.height * escala;

  ctx.save();
  ctx.translate(cx, cy);
  if (el.rotation) ctx.rotate((el.rotation * Math.PI) / 180);
  ctx.beginPath();
  ctx.rect(-w / 2, -h / 2, w, h);
  ctx.clip();

  const escalaObjeto =
    el.objectFit === "cover"
      ? Math.max(w / img.naturalWidth, h / img.naturalHeight)
      : Math.min(w / img.naturalWidth, h / img.naturalHeight);
  const drawW = img.naturalWidth * escalaObjeto;
  const drawH = img.naturalHeight * escalaObjeto;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();
}

/**
 * Dibuja una línea directamente sobre el canvas con `ctx.moveTo`/`lineTo`, en
 * vez de confiar en el `<svg>` de una sola línea (alto/ancho de 1px en
 * líneas horizontales o verticales) que generaría `PlantillaVisualEstaticoDom`.
 * Ese `<svg>` diminuto, rasterizado dentro del `foreignObject` de
 * html-to-image, puede desplazarse medio píxel al escalar a "Alta"/"Máxima"
 * — imperceptible a 1×, pero a 4× ese medio píxel de doc-unit se vuelve 1-2
 * px reales, y con varias líneas el corrimiento no es igual en todas, así
 * que la distancia entre ellas se ve distinta que en el editor.
 */
function dibujarLineaEnCanvas(
  ctx: CanvasRenderingContext2D,
  el: Extract<ElementoVisual, { type: "line" }>,
  escala: number,
): void {
  const x2 = el.x2 ?? el.x + el.width;
  const y2 = el.y2 ?? el.y;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(el.x * escala, el.y * escala);
  ctx.lineTo(x2 * escala, y2 * escala);
  ctx.strokeStyle = el.stroke;
  ctx.lineWidth = Math.max(1, el.strokeWidth * escala);
  ctx.lineCap = "butt";
  ctx.stroke();
  ctx.restore();
}

function esTextoPlano(el: ElementoVisual): el is ElementoTexto {
  return el.type === "text" && el.forma !== "circulo" && (el.arco ?? 0) === 0;
}

function esTextoCirculo(el: ElementoVisual): el is ElementoTexto & { forma: "circulo" } {
  return el.type === "text" && el.forma === "circulo";
}

function conRotacionCaja(
  ctx: CanvasRenderingContext2D,
  el: ElementoVisual,
  escala: number,
  altoCaja: number,
  pintar: () => void,
): void {
  if (!el.rotation) {
    pintar();
    return;
  }
  const cx = (el.x + el.width / 2) * escala;
  const cy = (el.y + altoCaja / 2) * escala;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((el.rotation * Math.PI) / 180);
  ctx.translate(-cx, -cy);
  pintar();
  ctx.restore();
}

/**
 * Lee los saltos reales del motor CSS (el mismo que el lienzo) carácter a
 * carácter. html-to-image no sirve aquí: clona a un SVG foreignObject donde
 * Montserrat suele caer a sans-serif y el párrafo se remaqueta.
 */
function medirLineasCajaTexto(caja: HTMLElement, align: ElementoTexto["align"]): LineaMedida[] {
  const inner =
    (caja.querySelector("[data-export-text-inner]") as HTMLElement | null) ?? caja;
  const texto = inner.textContent ?? "";
  if (!texto) return [{ texto: "", justificar: false }];

  const textNode = inner.firstChild;
  if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
    return texto.split("\n").map((t, i, arr) => ({
      texto: t,
      justificar: align === "justify" && i < arr.length - 1 && /\s/.test(t.trim()),
    }));
  }

  const range = document.createRange();
  const frags: { ch: string; top: number; isBreak: boolean }[] = [];
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (ch === "\n") {
      frags.push({ ch, top: -1, isBreak: true });
      continue;
    }
    range.setStart(textNode, i);
    range.setEnd(textNode, i + 1);
    const rects = range.getClientRects();
    const rect = rects.length ? rects[rects.length - 1] : null;
    frags.push({ ch, top: rect && rect.height > 0 ? Math.round(rect.top * 4) / 4 : -1, isBreak: false });
  }

  const lineas: LineaMedida[] = [];
  let buf = "";
  let top: number | null = null;
  const flush = (finParrafo: boolean, permitirVacio: boolean) => {
    if (!buf && !permitirVacio) return;
    let t = buf.replace(/ +$/g, "");
    if (!finParrafo) t = t.replace(/^ +/g, "");
    lineas.push({
      texto: t,
      justificar: align === "justify" && !finParrafo && t.trim().includes(" "),
    });
    buf = "";
  };

  for (const f of frags) {
    if (f.isBreak) {
      flush(true, true);
      top = null;
      continue;
    }
    if (top !== null && f.top >= 0 && Math.abs(f.top - top) > 0.6) {
      flush(false, false);
    }
    if (buf === "" && f.top >= 0) top = f.top;
    buf += f.ch;
  }
  flush(true, lineas.length === 0 || buf.length > 0);
  return lineas.length ? lineas : [{ texto: "", justificar: false }];
}

async function medirTextosPlantilla(
  doc: PlantillaVisualDoc,
): Promise<Map<string, MedidaTextoExport>> {
  const medidas = new Map<string, MedidaTextoExport>();
  const textos = doc.elementos.filter(esTextoPlano);
  if (!textos.length) return medidas;

  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText =
    "position:fixed;left:0;top:0;opacity:0;pointer-events:none;z-index:-1;overflow:hidden;";
  document.body.appendChild(host);
  const raiz = createRoot(host);
  try {
    flushSync(() => {
      raiz.render(
        <PlantillaVisualEstaticoDom
          doc={{ ...doc, elementos: textos }}
          escala={1}
          fondoTransparente
        />,
      );
    });
    if (document.fonts) await document.fonts.ready;
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

    for (const el of textos) {
      const caja = host.querySelector(
        `[data-export-text-id="${el.id.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`,
      ) as HTMLElement | null;
      if (!caja) continue;
      const inner = caja.querySelector("[data-export-text-inner]") as HTMLElement | null;
      const letterSpacing = getComputedStyle(inner ?? caja).letterSpacing || "0px";
      medidas.set(el.id, {
        lineas: medirLineasCajaTexto(caja, el.align),
        letterSpacing,
      });
    }
  } finally {
    raiz.unmount();
    host.remove();
  }
  return medidas;
}

function dibujarRectEnCanvas(
  ctx: CanvasRenderingContext2D,
  el: Extract<ElementoVisual, { type: "rect" }>,
  escala: number,
): void {
  conRotacionCaja(ctx, el, escala, el.height, () => {
    const x = el.x * escala;
    const y = el.y * escala;
    const w = el.width * escala;
    const h = el.height * escala;
    const r = (el.borderRadius || 0) * escala;
    ctx.fillStyle = el.fill || "transparent";
    ctx.strokeStyle = el.stroke || "transparent";
    ctx.lineWidth = (el.strokeWidth || 0) * escala;
    if (r > 0 && typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      if (el.fill && el.fill !== "transparent") ctx.fill();
      if (el.stroke && el.strokeWidth > 0) ctx.stroke();
    } else {
      if (el.fill && el.fill !== "transparent") ctx.fillRect(x, y, w, h);
      if (el.stroke && el.strokeWidth > 0) ctx.strokeRect(x, y, w, h);
    }
  });
}

function dibujarTextoMedidoEnCanvas(
  ctx: CanvasRenderingContext2D,
  el: ElementoTexto,
  medida: MedidaTextoExport,
  escala: number,
): void {
  const boxH = alturaCajaTexto(el);
  conRotacionCaja(ctx, el, escala, boxH, () => {
    ctx.save();
    ctx.scale(escala, escala);
    ctx.fillStyle = el.color || "#000";
    ctx.font = fontCssTexto(el);
    ctx.textBaseline = "top";
    aplicarLetterSpacing(ctx, medida.letterSpacing);
    const lh = el.fontSize * (el.lineHeight ?? LINE_HEIGHT_DEFECTO);
    const halfLeading = (lh - el.fontSize) / 2;
    const ancho = Math.max(8, el.width || 0);
    medida.lineas.forEach((linea, i) => {
      const align = linea.justificar ? "justify" : el.align === "justify" ? "left" : el.align;
      dibujarLineaTexto(ctx, linea.texto, el.x, el.y + i * lh + halfLeading, ancho, align);
    });
    ctx.restore();
  });
}

function dibujarTextoCirculoEnCanvas(
  ctx: CanvasRenderingContext2D,
  el: ElementoTexto,
  escala: number,
): void {
  const boxH = alturaCajaTexto(el);
  conRotacionCaja(ctx, el, escala, boxH, () => {
    ctx.save();
    ctx.translate(el.x * escala, el.y * escala);
    ctx.scale(escala, escala);
    ctx.font = fontCssTexto(el);
    aplicarLetterSpacing(ctx, "0px");
    const holgura = (el.marcoAncho ?? 0) > 0 ? el.fontSize * 0.35 : 0;
    const porcion: CirculoPorcion = el.circuloPorcion ?? "completo";
    const layout = calcularTextoCirculo(
      el.content || "",
      el.width,
      el.fontSize,
      el.lineHeight ?? LINE_HEIGHT_DEFECTO,
      el.align ?? "left",
      (s) => ctx.measureText(s).width,
      holgura,
      porcion,
    );
    if (!layout) {
      ctx.restore();
      return;
    }
    if ((el.marcoAncho ?? 0) > 0) {
      const marcoAncho = el.marcoAncho ?? 0;
      const radioMarco = layout.radio + marcoAncho / 2 + el.fontSize * 0.1;
      ctx.beginPath();
      ctx.arc(el.width / 2, layout.radio, radioMarco, 0, Math.PI * 2);
      ctx.strokeStyle = el.marcoColor || el.color;
      ctx.lineWidth = marcoAncho;
      ctx.stroke();
    }
    ctx.fillStyle = el.color || "#000";
    ctx.textBaseline = "middle";
    const alignLinea = el.align === "justify" ? "center" : el.align ?? "left";
    for (const l of layout.lineas) {
      if (l.justificar && l.palabras.length > 1) {
        const textoAncho = l.anchos.reduce((s, a) => s + a, 0);
        const espacio = (l.chord - textoAncho) / (l.palabras.length - 1);
        let cx = l.xIni;
        for (let i = 0; i < l.palabras.length; i++) {
          ctx.textAlign = "left";
          ctx.fillText(l.palabras[i], cx, l.yCenter);
          cx += l.anchos[i] + espacio;
        }
      } else {
        ctx.textAlign =
          alignLinea === "right" ? "right" : alignLinea === "center" ? "center" : "left";
        const x =
          alignLinea === "right"
            ? l.xIni + l.chord
            : alignLinea === "center"
              ? l.xIni + l.chord / 2
              : l.xIni;
        ctx.fillText(l.texto, x, l.yCenter);
      }
    }
    ctx.restore();
  });
}

function cargarImagenDesdeSvgBlob(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo rasterizar el texto en arco"));
    };
    img.src = url;
  });
}

/**
 * Rasteriza el mismo TextoArcoSvg del lienzo (textPath nativo del navegador),
 * embebiendo tipografías, y aplica la rotación del elemento al componer.
 * Evita el aproximado letra-a-letra de Canvas 2D (distorsionaba el PNG).
 */
async function dibujarTextoArcoEnCanvas(
  ctx: CanvasRenderingContext2D,
  el: ElementoTexto,
  escala: number,
  fontEmbedCSS: string,
): Promise<void> {
  const boxH = alturaCajaTexto(el);
  if ((el.arco ?? 0) === 0 || boxH <= 0 || el.width <= 0) return;

  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:0;top:0;opacity:0;pointer-events:none;z-index:-1;width:${el.width}px;height:${boxH}px;overflow:visible;background:transparent;`;
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => {
      root.render(<TextoArcoSvg el={{ ...el, height: boxH }} escala={1} />);
    });
    if (document.fonts) await document.fonts.ready;
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

    const svgEl = host.querySelector("svg");
    if (!svgEl) return;
    svgEl.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svgEl.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");

    let xml = new XMLSerializer().serializeToString(svgEl);
    const css = (fontEmbedCSS || "").replace(/]]>/g, "]] >");
    if (css) {
      xml = xml.replace(
        /<svg([^>]*)>/i,
        `<svg$1><defs><style type="text/css"><![CDATA[${css}]]></style></defs>`,
      );
    }
    const w0 = el.width;
    const h0 = boxH;
    const w = w0 * escala;
    const h = h0 * escala;
    xml = xml.replace(/<svg([^>]*)>/i, (_m, attrs: string) => {
      const limpio = String(attrs)
        .replace(/\swidth="[^"]*"/gi, "")
        .replace(/\sheight="[^"]*"/gi, "")
        .replace(/\sviewBox="[^"]*"/gi, "");
      return `<svg${limpio} width="${w}" height="${h}" viewBox="0 0 ${w0} ${h0}">`;
    });

    const img = await cargarImagenDesdeSvgBlob(xml);
    const x = el.x * escala;
    const y = el.y * escala;
    const rot = el.rotation || 0;

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    if (rot) {
      ctx.translate(x + w / 2, y + h / 2);
      ctx.rotate((rot * Math.PI) / 180);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
    } else {
      ctx.drawImage(img, x, y, w, h);
    }
    ctx.restore();
  } finally {
    root.unmount();
    host.remove();
  }
}

/**
 * Export a 96 DPI idéntico al lienzo: los saltos de línea se leen del DOM
 * real (mismo motor CSS que el editor) y se pintan en canvas a la escala de
 * impresión. Evita html-to-image, que remaquetaba el texto al clonar a SVG.
 */
export async function renderPlantillaToCanvasDom(
  docIn: PlantillaVisualDoc,
  opts?: OpcionesExportPlantilla,
): Promise<HTMLCanvasElement> {
  if (typeof document === "undefined") throw new Error("Exportación no disponible en este entorno");

  const doc = sanitizarAltosTextoPlantilla(docIn);
  const escala = clampEscalaExport(opts?.escala);
  await asegurarFuentesLienzoEscalado(doc, 1);
  if (escala !== 1) await asegurarFuentesLienzoEscalado(doc, escala);

  const { ancho_px: w, alto_px: h } = doc.formato;
  const forzarOpaco = opts?.forzarFondoOpaco === true;
  const imagenesResueltas = await resolverImagenesPlantilla(doc);
  const medidasTexto = await medirTextosPlantilla(doc);

  const anchoFinal = Math.max(1, Math.round(w * escala));
  const altoFinal = Math.max(1, Math.round(h * escala));
  const canvas = document.createElement("canvas");
  canvas.width = anchoFinal;
  canvas.height = altoFinal;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo preparar el lienzo para exportar");

  const fondoTransparenteDoc = !doc.fondo || doc.fondo === "transparent" || doc.fondo === "none";
  if (forzarOpaco) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, anchoFinal, altoFinal);
  } else if (!fondoTransparenteDoc) {
    ctx.fillStyle = doc.fondo;
    ctx.fillRect(0, 0, anchoFinal, altoFinal);
  }

  const hayArco = doc.elementos.some(
    (el) => el.type === "text" && el.visible !== false && (el.arco ?? 0) !== 0 && el.forma !== "circulo",
  );
  let fontEmbedCSS = "";
  if (hayArco) {
    try {
      const probe = document.createElement("div");
      probe.setAttribute("aria-hidden", "true");
      probe.style.cssText =
        'position:fixed;left:0;top:0;opacity:0;pointer-events:none;z-index:-1;font-family:"Montserrat",system-ui,sans-serif;font-weight:400;font-size:16px;';
      probe.textContent = "Ag";
      document.body.appendChild(probe);
      if (document.fonts) await document.fonts.ready;
      fontEmbedCSS = await getFontEmbedCSS(probe);
      probe.remove();
    } catch {
      fontEmbedCSS = "";
    }
  }

  const ordenados = [...doc.elementos]
    .filter((el) => el.visible !== false)
    .sort((a, b) => a.zIndex - b.zIndex);

  try {
    for (const el of ordenados) {
      if (el.type === "line") {
        dibujarLineaEnCanvas(ctx, el, escala);
      } else if (el.type === "image") {
        await dibujarImagenEnCanvas(ctx, el, imagenesResueltas, escala);
      } else if (el.type === "rect") {
        dibujarRectEnCanvas(ctx, el, escala);
      } else if (el.type === "text") {
        if (esTextoCirculo(el)) {
          dibujarTextoCirculoEnCanvas(ctx, el, escala);
        } else if ((el.arco ?? 0) !== 0) {
          await dibujarTextoArcoEnCanvas(ctx, el, escala, fontEmbedCSS);
        } else {
          const medida = medidasTexto.get(el.id) ?? {
            lineas: [{ texto: el.content || "", justificar: false }],
            letterSpacing: "0px",
          };
          dibujarTextoMedidoEnCanvas(ctx, el, medida, escala);
        }
      }
    }
    if (esLienzoCircular(doc)) {
      const r = (Math.min(w, h) / 2) * escala;
      ctx.save();
      ctx.globalCompositeOperation = "destination-in";
      ctx.beginPath();
      ctx.arc((w * escala) / 2, (h * escala) / 2, r, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    return canvas;
  } catch (err) {
    throw normalizarErrorExportDom(err);
  }
}

async function cargarImagen(src: string): Promise<HTMLImageElement> {
  const raw = normalizarSrcImagen(src);
  const url = await resolverUrlImagenCanvas(raw);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`No se pudo cargar: ${raw}`));
    img.src = url;
  });
}

/** Parte texto como `white-space: pre-wrap` dentro de un ancho máximo. */
function partirLineasTexto(
  ctx: CanvasRenderingContext2D,
  content: string,
  maxWidth: number,
): string[] {
  const ancho = Math.max(8, maxWidth);
  const out: string[] = [];

  for (const parrafo of (content || "").split("\n")) {
    if (!parrafo) {
      out.push("");
      continue;
    }
    let resto = parrafo;
    while (resto.length > 0) {
      if (ctx.measureText(resto).width <= ancho) {
        out.push(resto);
        break;
      }
      let corte = resto.length;
      let low = 0;
      let high = resto.length;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        const frag = resto.slice(0, mid);
        if (ctx.measureText(frag).width <= ancho) low = mid;
        else high = mid - 1;
      }
      corte = Math.max(1, low);
      if (corte < resto.length && resto[corte] !== " ") {
        const espacio = resto.lastIndexOf(" ", corte);
        if (espacio > 0) corte = espacio;
      }
      const linea = resto.slice(0, corte).trimEnd();
      out.push(linea || resto.slice(0, 1));
      resto = resto.slice(corte).trimStart();
    }
  }
  return out.length ? out : [""];
}

function dibujarLineaTexto(
  ctx: CanvasRenderingContext2D,
  linea: string,
  x: number,
  y: number,
  ancho: number,
  align: ElementoTexto["align"],
) {
  if (align === "justify" && linea.trim().includes(" ")) {
    const palabras = linea.trim().split(/\s+/);
    if (palabras.length > 1) {
      ctx.textAlign = "left";
      const textoAncho = palabras.reduce((s, p) => s + ctx.measureText(p).width, 0);
      const espacio = (ancho - textoAncho) / (palabras.length - 1);
      let cx = x;
      for (let i = 0; i < palabras.length; i++) {
        ctx.fillText(palabras[i], cx, y);
        cx += ctx.measureText(palabras[i]).width + espacio;
      }
      return;
    }
  }
  if (align === "center") {
    ctx.textAlign = "center";
    ctx.fillText(linea, x + ancho / 2, y);
  } else if (align === "right") {
    ctx.textAlign = "right";
    ctx.fillText(linea, x + ancho, y);
  } else {
    ctx.textAlign = "left";
    ctx.fillText(linea, x, y);
  }
}

function dibujarTexto(ctx: CanvasRenderingContext2D, el: ElementoTexto) {
  ctx.fillStyle = el.color || "#000";
  ctx.font = fontCssTexto(el);
  ctx.textBaseline = "top";
  const lh = el.fontSize * (el.lineHeight ?? LINE_HEIGHT_RATIO);
  const ancho = Math.max(8, el.width || 0);
  const lineas = partirLineasTexto(ctx, el.content || "", ancho);
  lineas.forEach((linea, i) => {
    dibujarLineaTexto(ctx, linea, el.x, el.y + i * lh, ancho, el.align);
  });
}

async function dibujarElemento(
  ctx: CanvasRenderingContext2D,
  el: ElementoVisual,
): Promise<void> {
  ctx.save();
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  if (el.rotation) {
    ctx.translate(cx, cy);
    ctx.rotate((el.rotation * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }

  if (el.type === "rect") {
    const r = el.borderRadius || 0;
    ctx.fillStyle = el.fill || "transparent";
    ctx.strokeStyle = el.stroke || "transparent";
    ctx.lineWidth = el.strokeWidth || 0;
    if (r > 0 && typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(el.x, el.y, el.width, el.height, r);
      if (el.fill && el.fill !== "transparent") ctx.fill();
      if (el.stroke && el.strokeWidth > 0) ctx.stroke();
    } else {
      if (el.fill && el.fill !== "transparent") {
        ctx.fillRect(el.x, el.y, el.width, el.height);
      }
      if (el.stroke && el.strokeWidth > 0) {
        ctx.strokeRect(el.x, el.y, el.width, el.height);
      }
    }
  } else if (el.type === "line") {
    ctx.strokeStyle = el.stroke || "#000";
    ctx.lineWidth = el.strokeWidth || 1;
    ctx.lineCap = "butt";
    ctx.beginPath();
    ctx.moveTo(el.x, el.y);
    ctx.lineTo(el.x2 ?? el.x, el.y2 ?? el.y);
    ctx.stroke();
  } else if (el.type === "text") {
    dibujarTexto(ctx, el);
  } else if (el.type === "image" && el.src) {
    try {
      const img = await cargarImagen(el.src);
      if (el.objectFit === "cover") {
        const ratio = Math.max(el.width / img.width, el.height / img.height);
        const sw = img.width * ratio;
        const sh = img.height * ratio;
        const sx = el.x + (el.width - sw) / 2;
        const sy = el.y + (el.height - sh) / 2;
        ctx.drawImage(img, sx, sy, sw, sh);
      } else {
        ctx.drawImage(img, el.x, el.y, el.width, el.height);
      }
    } catch {
      ctx.fillStyle = "#e2e8f0";
      ctx.fillRect(el.x, el.y, el.width, el.height);
    }
  }
  ctx.restore();
}

function pintarFondo(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  fondo: string,
  forzarOpaco: boolean,
) {
  const f = (fondo || "#ffffff").trim();
  const transparente = !forzarOpaco && f.toLowerCase() in { transparent: 1, none: 1 };
  if (transparente) {
    ctx.clearRect(0, 0, w, h);
    return;
  }
  ctx.fillStyle = f.startsWith("#") ? f : "#ffffff";
  ctx.fillRect(0, 0, w, h);
}

/**
 * Render Canvas 2D aproximado (wrap/justify propios, sin motor de layout del
 * navegador). Solo se usa para miniaturas de la biblioteca — rápido y
 * suficientemente fiel a esa escala. La exportación real usa
 * `renderPlantillaToCanvasDom`, que captura el DOM real del editor.
 */
export async function renderPlantillaToCanvas(
  doc: PlantillaVisualDoc,
  opts?: OpcionesExportPlantilla,
): Promise<HTMLCanvasElement> {
  await asegurarFuentesLienzo(doc);
  const escala = clampEscalaExport(opts?.escala);
  const { ancho_px: w, alto_px: h } = doc.formato;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * escala));
  canvas.height = Math.max(1, Math.round(h * escala));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas no disponible");

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.scale(escala, escala);

  pintarFondo(ctx, w, h, doc.fondo || "#ffffff", opts?.forzarFondoOpaco === true);

  const sorted = [...doc.elementos]
    .filter((el) => el.visible !== false)
    .sort((a, b) => a.zIndex - b.zIndex);
  for (const el of sorted) {
    await dibujarElemento(ctx, el);
  }
  return canvas;
}

function nombreArchivoPlantilla(nombre: string, ext: string): string {
  const safe = (nombre || "plantilla").replace(/[^\w\-]+/g, "_").slice(0, 60) || "plantilla";
  return `${safe}.${ext}`;
}

/** Sube un blob de imagen (PNG o JPG) ya renderizado a la biblioteca de etiquetas. */
export type MetaFormatoPngEtiqueta = {
  carpeta?: string;
  tipo_etiqueta?: string;
  ancho_mm?: number;
  alto_mm?: number;
  dpi?: number;
  escala?: number;
};

export async function subirImagenBlobAEtiquetas(
  blob: Blob,
  nombreSugerido: string,
  meta?: MetaFormatoPngEtiqueta,
): Promise<{
  nombre: string;
  tipo_etiqueta?: string;
  ancho_mm?: number;
  alto_mm?: number;
}> {
  const { api } = await import("../api/client");
  const fd = new FormData();
  fd.append("archivo", new File([blob], nombreSugerido, { type: blob.type || "image/png" }));
  if (meta?.carpeta) fd.append("carpeta", meta.carpeta);
  if (meta?.tipo_etiqueta) fd.append("tipo_etiqueta", meta.tipo_etiqueta);
  if (meta?.ancho_mm != null && meta.ancho_mm > 0) fd.append("ancho_mm", String(meta.ancho_mm));
  if (meta?.alto_mm != null && meta.alto_mm > 0) fd.append("alto_mm", String(meta.alto_mm));
  if (meta?.dpi != null && meta.dpi > 0) fd.append("dpi", String(meta.dpi));
  if (meta?.escala != null && meta.escala > 0) fd.append("escala", String(meta.escala));
  const res = await api.upload<{
    ok: boolean;
    nombre: string;
    tipo_etiqueta?: string;
    ancho_mm?: number;
    alto_mm?: number;
  }>("/api/etiquetas/recursos-png", fd);
  return {
    nombre: res.nombre,
    tipo_etiqueta: res.tipo_etiqueta,
    ancho_mm: res.ancho_mm,
    alto_mm: res.alto_mm,
  };
}

/** Sube el lienzo renderizado como JPG a la galería compartida del Studio. */
export async function guardarPlantillaJpgEnGaleria(
  doc: PlantillaVisualDoc,
  opts?: Pick<OpcionesExportPlantilla, "escala">,
): Promise<{ nombre: string }> {
  const blob = await exportarPlantillaBlob(doc, "jpeg", opts);
  const esEtiqueta = Boolean(doc.formato.tipo_etiqueta || doc.formato.ancho_mm);
  return subirImagenBlobAEtiquetas(blob, nombreArchivoPlantilla(doc.nombre, "jpg"), {
    carpeta: esEtiqueta ? "ETIQUETAS STUDIO" : undefined,
    tipo_etiqueta: doc.formato.tipo_etiqueta || (esEtiqueta ? doc.formato.nombre : undefined),
    ancho_mm: doc.formato.ancho_mm,
    alto_mm: doc.formato.alto_mm,
    dpi: doc.formato.dpi,
    escala: opts?.escala,
  });
}

/** Sube un PDF (ya renderizado, en base64) a la biblioteca de PDFs de Etiquetas para poder imprimirlo. */
export async function subirPdfBase64AEtiquetas(
  base64: string,
  nombreSugerido: string,
): Promise<{ nombre: string; ruta: string; ruta_completa: string }> {
  const { api } = await import("../api/client");
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const fd = new FormData();
  fd.append("archivo", new File([bytes], nombreSugerido, { type: "application/pdf" }));
  const up = await api.upload<{ ok: boolean; nombre: string; ruta: string; ruta_completa: string }>(
    "/api/etiquetas/subir-pdf",
    fd,
  );
  return { nombre: up.nombre, ruta: up.ruta, ruta_completa: up.ruta_completa };
}

/** Renderiza el lienzo como PDF y lo guarda en la biblioteca de PDFs de Etiquetas. */
export async function guardarPlantillaPdfEnGaleria(
  doc: PlantillaVisualDoc,
): Promise<{ nombre: string; ruta: string; ruta_completa: string }> {
  const { api } = await import("../api/client");
  const res = await api.post<{ ok: boolean; nombre: string; base64: string }>(
    "/api/plantillas-visuales/exportar",
    { plantilla: doc, formato: "pdf" },
  );
  return subirPdfBase64AEtiquetas(res.base64, nombreArchivoPlantilla(doc.nombre, "pdf"));
}

export async function guardarPlantillaEnGaleria(
  doc: PlantillaVisualDoc,
  formato: "jpeg" | "pdf",
  opts?: Pick<OpcionesExportPlantilla, "escala">,
): Promise<{ nombre: string }> {
  if (formato === "pdf") return guardarPlantillaPdfEnGaleria(doc);
  return guardarPlantillaJpgEnGaleria(doc, opts);
}

export async function exportarPlantillaBlob(
  doc: PlantillaVisualDoc,
  formato: "png" | "jpeg",
  opts?: OpcionesExportPlantilla,
): Promise<Blob> {
  const forzarOpaco = formato === "jpeg";
  const escala = clampEscalaExport(opts?.escala);
  const canvas = await renderPlantillaToCanvasDom(doc, {
    forzarFondoOpaco: forzarOpaco,
    escala,
  });
  const calidad = escala >= 3 ? 0.95 : 0.92;
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Exportación fallida"))),
      formato === "jpeg" ? "image/jpeg" : "image/png",
      formato === "jpeg" ? calidad : undefined,
    );
  });
}

export function descargarBlob(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}

export function descargarBase64(b64: string, nombre: string, mime: string): void {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  descargarBlob(new Blob([bytes], { type: mime }), nombre);
}
