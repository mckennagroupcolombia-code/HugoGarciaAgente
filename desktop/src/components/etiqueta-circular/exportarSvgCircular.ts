/**
 * Exportación a SVG vectorial de la etiqueta circular (§16 del pliego).
 *
 * La etiqueta son DOS capas: un `<svg>` con los círculos y los cuatro textos
 * curvos, y encima una capa HTML con las bandas del bloque central. El PNG
 * las aplana rasterizando; aquí hay que pasarlas las dos a vectores.
 *
 * No se usa `html-to-image.toSvg`: ese envuelve el HTML en un `foreignObject`,
 * que no es vectorial de verdad (ningún RIP ni Illustrator lo remaqueta igual)
 * y donde Montserrat suele caer a la fuente del sistema. En su lugar se LEE EL
 * DOM YA MAQUETADO: los renglones se miden con `Range.getClientRects()` —el
 * mismo motor CSS que se ve en pantalla decidió dónde parte cada línea— y cada
 * renglón sale como un `<text>` suelto en su posición. Lo que se exporta es,
 * renglón por renglón, lo que hay en la pantalla.
 *
 * El SVG resultante lleva sus medidas físicas en milímetros (`width`/`height`),
 * así que se imprime al tamaño real sin que nadie tenga que escalarlo, y las
 * fuentes van incrustadas para que no dependa de la máquina que lo abra.
 */

/** Milímetros de un punto de diseño no: el viewBox va en px de diseño y las
 *  medidas físicas en el `width`/`height`, que es lo que mira la impresora. */
interface OpcionesSvgCircular {
  /** Diámetro físico de impresión, en milímetros. */
  diametroMm: number;
  /** Fuentes incrustadas (`@font-face` con la fuente en base64). */
  fuentesCss?: string;
}

interface Caja {
  x: number;
  y: number;
  w: number;
  h: number;
}

export async function svgEtiquetaCircular(
  nodo: HTMLElement,
  { diametroMm, fuentesCss = "" }: OpcionesSvgCircular,
): Promise<string> {
  if (typeof document === "undefined") throw new Error("La exportación a SVG solo funciona en el navegador");
  if (document.fonts) await document.fonts.ready;

  const base = nodo.getBoundingClientRect();
  const diametro = nodo.offsetWidth || Math.round(base.width);
  if (!diametro) throw new Error("La etiqueta no está montada");
  // El marco puede venir escalado desde afuera; todo se lleva a px de diseño.
  const k = base.width / diametro || 1;
  const rel = (r: DOMRect): Caja => ({
    x: (r.left - base.left) / k,
    y: (r.top - base.top) / k,
    w: r.width / k,
    h: r.height / k,
  });

  const piezas: string[] = [];

  // ── Capa SVG: círculos y textos curvos ──────────────────────────────────
  const svgFuente = nodo.querySelector("svg.ec-svg");
  if (svgFuente instanceof SVGSVGElement) piezas.push(capaCurva(svgFuente));

  // ── Capa HTML: bandas del bloque central ────────────────────────────────
  const centro = nodo.querySelector(".ec-centro");
  if (centro instanceof HTMLElement) piezas.push(...capaCentral(centro, rel));

  const mm = redondear(diametroMm);
  const estilo = fuentesCss ? `<style type="text/css"><![CDATA[\n${fuentesCss}\n]]></style>` : "";
  const r = diametro / 2;

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`
    + ` width="${mm}mm" height="${mm}mm" viewBox="0 0 ${diametro} ${diametro}">\n`
    + estilo
    // El troquel es redondo: fuera del círculo no hay etiqueta, ni siquiera
    // fondo blanco. Recortar aquí es lo que garantiza que nada salga cortado
    // a medias en el papel.
    + `<defs><clipPath id="ec-troquel"><circle cx="${r}" cy="${r}" r="${r}"/></clipPath></defs>\n`
    + `<g clip-path="url(#ec-troquel)">\n`
    + `<circle cx="${r}" cy="${r}" r="${r}" fill="#ffffff"/>\n`
    + piezas.join("\n")
    + `\n</g>\n</svg>\n`
  );
}

// ── Capa de los textos curvos ──────────────────────────────────────────────

/** Propiedades que en pantalla llegan por clase CSS y en un SVG suelto tienen
 *  que viajar escritas en el propio elemento. */
const PROPS_TEXTO = [
  "fill",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "letter-spacing",
] as const;
const PROPS_TRAZO = ["fill", "stroke", "stroke-width"] as const;

/**
 * Clona el `<svg>` interno con los estilos ya escritos en cada elemento. Los
 * `textPath` se conservan tal cual —son el único modo de que el texto curvo
 * siga siendo texto—, con `xlink:href` además de `href` porque Illustrator e
 * Inkscape todavía leen el viejo.
 */
function capaCurva(svgFuente: SVGSVGElement): string {
  const clon = svgFuente.cloneNode(true) as SVGSVGElement;
  const origen = svgFuente.querySelectorAll("*");
  const copia = clon.querySelectorAll("*");

  for (let i = 0; i < origen.length && i < copia.length; i++) {
    const de = origen[i];
    const a = copia[i];
    if (a.tagName === "title") {
      a.remove();
      continue;
    }
    const css = getComputedStyle(de);
    // Fuera lo de pantalla: la clase no viaja y el `style` solo traía el
    // tamaño del ajuste automático, que se copia abajo ya resuelto.
    a.removeAttribute("class");
    a.removeAttribute("style");
    for (const p of a.tagName === "text" ? PROPS_TEXTO : PROPS_TRAZO) {
      const v = p === "font-family" ? familiaSinComillas(css.fontFamily) : css.getPropertyValue(p);
      // `none` SÍ se escribe: es el valor de los dos círculos, que son aros.
      // Sin el atributo, el relleno por defecto de SVG es negro y la etiqueta
      // sale como un disco. Lo que no se escribe es `normal` (letter-spacing,
      // font-style), que es el valor por defecto y solo estorba.
      if (v && v !== "normal") a.setAttribute(p, v);
    }
    if (a.tagName === "text" && css.textTransform === "uppercase") {
      // `text-transform` no es propiedad SVG: lo que se ve en mayúsculas hay
      // que exportarlo en mayúsculas, o el archivo sale en minúsculas.
      for (const t of Array.from(a.querySelectorAll("textPath"))) {
        t.textContent = (t.textContent || "").toLocaleUpperCase("es");
      }
    }
    if (a.tagName === "textPath") {
      const href = a.getAttribute("href");
      // Illustrator e Inkscape todavía leen el `xlink:href` viejo.
      if (href) a.setAttribute("xlink:href", href);
    }
  }

  // Solo el contenido: el <svg> de pantalla trae `position:absolute` y un
  // viewBox que ya pone el de afuera. Se serializa como XML, no con
  // `innerHTML`: el serializador de HTML deja pasar comillas dentro de los
  // atributos y el archivo salía mal formado.
  const xml = new XMLSerializer();
  const dentro = Array.from(clon.childNodes)
    .map((n) => xml.serializeToString(n))
    .join("");
  return `<g>${dentro}</g>`;
}

/** `font-family` computada trae las familias con espacios entre comillas
 *  (`"Segoe UI"`), que en un atributo XML hay que escapar. En SVG la lista
 *  separada por comas no las necesita: se quitan y no hay nada que escapar. */
function familiaSinComillas(familia: string): string {
  return familia.replace(/["']/g, "");
}

// ── Capa del bloque central ────────────────────────────────────────────────

function capaCentral(centro: HTMLElement, rel: (r: DOMRect) => Caja): string[] {
  const piezas: string[] = [];

  // Franja decorativa de colores sobre las barras (§8): cada segmento es un
  // rectángulo de color, no una imagen.
  for (const seg of Array.from(centro.querySelectorAll<HTMLElement>(".ec-franja-color span"))) {
    const c = rel(seg.getBoundingClientRect());
    const color = getComputedStyle(seg).backgroundColor;
    if (c.w <= 0 || c.h <= 0) continue;
    piezas.push(
      `<rect x="${redondear(c.x)}" y="${redondear(c.y)}" width="${redondear(c.w)}" height="${redondear(c.h)}" fill="${color}"/>`,
    );
  }

  // Viñetas de la lista.
  for (const v of Array.from(centro.querySelectorAll<HTMLElement>(".ec-item-vineta"))) {
    const c = rel(v.getBoundingClientRect());
    if (c.w <= 0) continue;
    piezas.push(
      `<circle cx="${redondear(c.x + c.w / 2)}" cy="${redondear(c.y + c.h / 2)}" r="${redondear(c.w / 2)}"`
      + ` fill="${getComputedStyle(v).backgroundColor}"/>`,
    );
  }

  // Código de barras: el generador del repo ya devuelve un SVG de barras y
  // dígitos, así que entra anidado y sigue siendo vectorial (nada de píxeles).
  // Logo: va como imagen incrustada (los logos de DISEÑO CORPORATIVO son PNG).
  const logo = centro.querySelector<HTMLImageElement>("img.ec-logo-img");
  if (logo) {
    const incrustado = imagenIncrustada(logo, rel(logo.getBoundingClientRect()));
    if (incrustado) piezas.push(incrustado);
  }

  const img = centro.querySelector("img:not(.ec-logo-img)");
  if (img instanceof HTMLImageElement) {
    const anidado = barrasAnidadas(img, rel(img.getBoundingClientRect()));
    if (anidado) piezas.push(anidado);
  }

  // Textos rectos, renglón por renglón tal como los partió el navegador.
  for (const p of Array.from(centro.querySelectorAll<HTMLElement>("p, h1, span.ec-texto"))) {
    if (p.closest(".ec-franja-color")) continue;
    piezas.push(...textoDeParrafo(p, rel));
  }

  return piezas;
}

/** <image> con el logo dentro de su caja (`object-fit: contain`). Se pasa a
 *  data URL con un canvas para que el SVG no dependa del servidor; si el
 *  navegador no deja leer la imagen, se omite antes que romper el archivo. */
function imagenIncrustada(img: HTMLImageElement, c: Caja): string | null {
  const { naturalWidth: nw, naturalHeight: nh } = img;
  if (!nw || !nh || c.w <= 0 || c.h <= 0) return null;
  let href = img.currentSrc || img.src;
  if (!href.startsWith("data:")) {
    try {
      const lienzo = document.createElement("canvas");
      lienzo.width = nw;
      lienzo.height = nh;
      lienzo.getContext("2d")?.drawImage(img, 0, 0);
      href = lienzo.toDataURL("image/png");
    } catch {
      return null;
    }
  }
  return (
    `<image x="${redondear(c.x)}" y="${redondear(c.y)}" width="${redondear(c.w)}" height="${redondear(c.h)}"`
    + ` preserveAspectRatio="xMidYMid meet" href="${href}"/>`
  );
}

function barrasAnidadas(img: HTMLImageElement, c: Caja): string | null {
  const svg = svgDesdeDataUrl(img.currentSrc || img.src);
  if (!svg) return null;
  const w = Number(/\bwidth="(\d+(?:\.\d+)?)"/.exec(svg)?.[1]);
  const h = Number(/\bheight="(\d+(?:\.\d+)?)"/.exec(svg)?.[1]);
  const dentro = svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  if (!dentro.trim()) return null;
  const vista = w > 0 && h > 0 ? ` viewBox="0 0 ${w} ${h}"` : "";
  return (
    `<svg x="${redondear(c.x)}" y="${redondear(c.y)}" width="${redondear(c.w)}" height="${redondear(c.h)}"`
    + `${vista} preserveAspectRatio="xMidYMid meet" overflow="visible">${dentro}</svg>`
  );
}

function svgDesdeDataUrl(src: string): string | null {
  if (!src.startsWith("data:image/svg+xml")) return null;
  const coma = src.indexOf(",");
  if (coma < 0) return null;
  const cuerpo = src.slice(coma + 1);
  try {
    if (src.slice(0, coma).includes(";base64")) {
      return decodeURIComponent(escape(atob(cuerpo)));
    }
    return decodeURIComponent(cuerpo);
  } catch {
    return null;
  }
}

/**
 * Un párrafo, partido en los renglones que realmente se ven. Se recorre
 * carácter a carácter con un `Range`: los que comparten el borde superior de
 * su rectángulo son el mismo renglón. Es la única forma de saber dónde partió
 * el navegador sin volver a maquetar el texto por nuestra cuenta.
 */
function textoDeParrafo(p: HTMLElement, rel: (r: DOMRect) => Caja): string[] {
  const nodo = p.firstChild;
  const texto = p.textContent ?? "";
  if (!texto.trim()) return [];

  const css = getComputedStyle(p);
  if (css.visibility === "hidden" || css.display === "none" || Number(css.opacity) === 0) return [];
  const atributos =
    ` fill="${css.color}" font-family="${escaparXml(familiaSinComillas(css.fontFamily))}" font-size="${redondear(parseFloat(css.fontSize))}"`
    + ` font-weight="${css.fontWeight}"`
    + (css.letterSpacing && css.letterSpacing !== "normal" ? ` letter-spacing="${css.letterSpacing}"` : "");

  const renglones: { texto: string; caja: Caja }[] = [];

  if (nodo && nodo.nodeType === Node.TEXT_NODE && p.childNodes.length === 1) {
    const rango = document.createRange();
    let buffer = "";
    let borde: number | null = null;
    let caja: DOMRect | null = null;
    const cerrar = () => {
      const t = buffer.trim();
      if (t && caja) renglones.push({ texto: t, caja: rel(caja) });
      buffer = "";
      caja = null;
    };
    for (let i = 0; i < texto.length; i++) {
      rango.setStart(nodo, i);
      rango.setEnd(nodo, i + 1);
      const rects = rango.getClientRects();
      const r = rects.length ? rects[rects.length - 1] : null;
      if (!r || r.height === 0) {
        buffer += texto[i];
        continue;
      }
      const top = Math.round(r.top * 4) / 4;
      if (borde === null || Math.abs(top - borde) > 0.5) {
        cerrar();
        borde = top;
        caja = new DOMRect(r.left, r.top, r.width, r.height);
      } else if (caja) {
        const izq = Math.min(caja.left, r.left);
        const der = Math.max(caja.right, r.right);
        caja = new DOMRect(izq, Math.min(caja.top, r.top), der - izq, Math.max(caja.height, r.height));
      }
      buffer += texto[i];
    }
    cerrar();
  }

  if (renglones.length === 0) renglones.push({ texto: texto.trim(), caja: rel(p.getBoundingClientRect()) });

  // Cada renglón se ancla por su centro: así da igual cómo esté alineado el
  // párrafo (centrado, a la izquierda), el renglón cae donde está.
  return renglones.map(({ texto: t, caja: c }) =>
    `<text x="${redondear(c.x + c.w / 2)}" y="${redondear(c.y + c.h / 2)}" text-anchor="middle"`
    + ` dominant-baseline="central"${atributos}>${escaparXml(t)}</text>`,
  );
}

// ── Utilidades ─────────────────────────────────────────────────────────────

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

function escaparXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Nombre de archivo sin sorpresas para el sistema de archivos. */
export function nombreArchivoSvg(nombre: string): string {
  const limpio = (nombre || "etiqueta")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 _-]+/g, " ")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 60);
  return `${limpio || "etiqueta"}.svg`;
}
