import type { RegionDesenfoque } from "./plantillasVisualesExport";

/**
 * Detección automática de la marca por OCR, en el propio navegador
 * (tesseract.js): busca "MCKENNA GROUP" — el logo, y también la web y el
 * correo, que lo llevan pegado ("mckennagroup.co") — y devuelve las zonas a
 * desenfocar. El motor y el idioma se sirven desde /app/assets/ocr (los copia
 * scripts/copy-ocr-assets.mjs), así no depende de ningún CDN ni del servidor.
 */

type Caja = { x0: number; y0: number; x1: number; y1: number };
type Palabra = { text: string; bbox: Caja };

/** Ancho al que se lleva la etiqueta antes del OCR: a tamaño de exportación el
 *  trazo fino del logo no se reconoce; a ~2× sí. */
const ANCHO_OCR = 1900;

function normalizar(t: string) {
  return t
    .normalize("NFD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function distancia(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return d[a.length][b.length];
}

/** ¿`texto` contiene algo a ≤ `tol` ediciones de `patron`? Tolera una letra
 *  mal leída ("MCKENMA") sin abrir la puerta a palabras ajenas. */
function contieneAprox(texto: string, patron: string, tol: number) {
  if (texto.includes(patron)) return true;
  for (let len = patron.length - tol; len <= patron.length + tol; len++) {
    for (let i = 0; i + len <= texto.length; i++) {
      if (distancia(texto.slice(i, i + len), patron) <= tol) return true;
    }
  }
  return false;
}

function cajasDeMarca(lineas: Palabra[][]): Caja[] {
  const cajas: Caja[] = [];
  for (const palabras of lineas) {
    for (let i = 0; i < palabras.length; i++) {
      const t = normalizar(palabras[i].text);
      if (t.length < 6 || !contieneAprox(t, "mckenna", 1)) continue;
      const b = { ...palabras[i].bbox };
      const sig = palabras[i + 1];
      // Logo: "MCKENNA" y "GROUP" llegan como dos palabras de la misma línea.
      if (sig && !contieneAprox(t, "group", 1) && contieneAprox(normalizar(sig.text), "group", 1)) {
        b.x0 = Math.min(b.x0, sig.bbox.x0);
        b.y0 = Math.min(b.y0, sig.bbox.y0);
        b.x1 = Math.max(b.x1, sig.bbox.x1);
        b.y1 = Math.max(b.y1, sig.bbox.y1);
        i++;
      }
      cajas.push(b);
    }
  }
  return cajas;
}

/**
 * Tesseract toma los rellenos de color (botón de la web, franja del pie) por
 * imágenes y se salta el texto blanco que llevan encima. Esta versión deja en
 * blanco todo menos ese texto, que pasa a negro, para una segunda pasada.
 */
function soloTextoSobreRellenos(src: ImageData): ImageData {
  const { width: w, height: h, data } = src;
  const n = w * h;
  // "Relleno" = píxel de color o oscuro (la franja café de Semillas casi no
  // tiene saturación); 1 = relleno pleno, 0 = blanco/texto claro.
  const relleno = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const sat = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    const gris = (r * 299 + g * 587 + b * 114) / 1000;
    relleno[i] = Math.max(0, Math.min(1, Math.max(sat / 0.5, (200 - gris) / 100)));
  }
  // Fracción local de píxeles de relleno, con imagen integral.
  const W = w + 1;
  const integ = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let fila = 0;
    for (let x = 0; x < w; x++) {
      fila += relleno[y * w + x] > 0.7 ? 1 : 0;
      integ[(y + 1) * W + x + 1] = integ[y * W + x + 1] + fila;
    }
  }
  const rad = Math.max(6, Math.round(w * 0.008));
  const out = new ImageData(w, h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - rad);
    const y1 = Math.min(h, y + rad + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - rad);
      const x1 = Math.min(w, x + rad + 1);
      const suma = integ[y1 * W + x1] - integ[y0 * W + x1] - integ[y1 * W + x0] + integ[y0 * W + x0];
      const f = suma / ((y1 - y0) * (x1 - x0));
      const t = Math.max(0, Math.min(1, (f - 0.45) / 0.2));
      const i = y * w + x;
      const dentro = relleno[i] * 255;
      const v = 255 - t * (255 - dentro);
      const p = i * 4;
      out.data[p] = out.data[p + 1] = out.data[p + 2] = v;
      out.data[p + 3] = 255;
    }
  }
  return out;
}

function lienzoDe(img: ImageData): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  c.getContext("2d")?.putImageData(img, 0, 0);
  return c;
}

/** Une cajas que se pisan (las dos pasadas suelen ver el mismo texto). */
function unirSolapadas(cajas: Caja[]): Caja[] {
  const out: Caja[] = [];
  for (const c of cajas) {
    const otra = out.find((o) => c.x0 < o.x1 && c.x1 > o.x0 && c.y0 < o.y1 && c.y1 > o.y0);
    if (otra) {
      otra.x0 = Math.min(otra.x0, c.x0);
      otra.y0 = Math.min(otra.y0, c.y0);
      otra.x1 = Math.max(otra.x1, c.x1);
      otra.y1 = Math.max(otra.y1, c.y1);
    } else {
      out.push({ ...c });
    }
  }
  return out;
}

async function cargarImagen(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("No se pudo leer la imagen para el OCR"));
      i.src = url;
    });
  } finally {
    // La imagen ya está decodificada al resolver `onload`.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/**
 * Zonas (fracción 0–1) donde la imagen dice "MCKENNA GROUP". Lista vacía si el
 * OCR no encuentra la marca; lanza si el motor no carga.
 */
export async function detectarMarcaPorOcr(blob: Blob): Promise<RegionDesenfoque[]> {
  const img = await cargarImagen(blob);
  if (!img.naturalWidth || !img.naturalHeight) return [];
  const escala = ANCHO_OCR / img.naturalWidth;
  const w = ANCHO_OCR;
  const h = Math.max(1, Math.round(img.naturalHeight * escala));
  const base = document.createElement("canvas");
  base.width = w;
  base.height = h;
  const ctx = base.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("No se pudo preparar el lienzo del OCR");
  // Fondo blanco: los PNG de etiqueta traen esquinas transparentes.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const rellenos = lienzoDe(soloTextoSobreRellenos(ctx.getImageData(0, 0, w, h)));

  const { createWorker, PSM } = await import("tesseract.js");
  const dirOcr = new URL(`${import.meta.env.BASE_URL}assets/ocr`, window.location.href).href;
  const worker = await createWorker("eng", 1, {
    workerPath: `${dirOcr}/worker.min.js`,
    corePath: dirOcr,
    langPath: dirOcr,
    // El idioma se sirve sin comprimir (ver scripts/copy-ocr-assets.mjs).
    gzip: false,
  });
  try {
    const cajas: Caja[] = [];
    // Tres pasadas (~3 s en total); ninguna ve todo por sí sola. El modo
    // automático pierde el logo de trazo fino bajo el dibujo; el de texto
    // disperso lo encuentra pero se salta texto sobre rellenos.
    const pasadas = [
      { lienzo: base, modo: PSM.AUTO },
      { lienzo: base, modo: PSM.SPARSE_TEXT },
      { lienzo: rellenos, modo: PSM.AUTO },
    ];
    for (const { lienzo, modo } of pasadas) {
      await worker.setParameters({ tessedit_pageseg_mode: modo });
      const { data } = await worker.recognize(lienzo, {}, { blocks: true });
      const lineas = (data.blocks ?? []).flatMap((b) =>
        b.paragraphs.flatMap((p) => p.lines.map((l) => l.words as Palabra[])),
      );
      cajas.push(...cajasDeMarca(lineas));
    }
    return unirSolapadas(cajas).map((c) => {
      // Margen: el desenfoque debe tapar también el ® y los bordes del trazo.
      const alto = c.y1 - c.y0;
      const mx = alto * 0.7;
      const my = alto * 0.4;
      const x0 = Math.max(0, c.x0 - mx);
      const y0 = Math.max(0, c.y0 - my);
      const x1 = Math.min(w, c.x1 + mx);
      const y1 = Math.min(h, c.y1 + my);
      return { x: x0 / w, y: y0 / h, w: (x1 - x0) / w, h: (y1 - y0) / h };
    });
  } finally {
    await worker.terminate();
  }
}
