/**
 * Color de acento dominante de una imagen (el logo de la ficha de
 * etiqueta): el tono SATURADO más frecuente, ignorando transparencias,
 * blancos, negros y grises. Si el logo no tiene color (versión gris o
 * negra) se cae al tono opaco más frecuente que no sea blanco — un acento
 * gris es correcto para un logo gris.
 *
 * Devuelve #RRGGBB, o null si la imagen no se pudo leer (p. ej. un SVG sin
 * ancho/alto que el canvas no sabe rasterizar); en ese caso quien llama
 * conserva el acento que tenía.
 */
const LADO_MAX_MUESTREO = 96;
const MIN_PIXELES_BIN = 6;

function cargarImagen(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function hex2(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0").toUpperCase();
}

interface Bin {
  n: number;
  r: number;
  g: number;
  b: number;
}

export async function colorAcentoDesdeImagen(src: string): Promise<string | null> {
  const img = await cargarImagen(src);
  if (!img) return null;
  const anchoNat = img.naturalWidth || img.width;
  const altoNat = img.naturalHeight || img.height;
  if (!anchoNat || !altoNat) return null;
  const escala = Math.min(1, LADO_MAX_MUESTREO / Math.max(anchoNat, altoNat));
  const w = Math.max(1, Math.round(anchoNat * escala));
  const h = Math.max(1, Math.round(altoNat * escala));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  let data: Uint8ClampedArray;
  try {
    ctx.drawImage(img, 0, 0, w, h);
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return null;
  }

  const saturados = new Map<number, Bin>();
  const opacos = new Map<number, Bin>();
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 200) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 510;
    if (l > 0.92) continue; // blanco / fondo
    const s = max === min ? 0 : (max - min) / 255 / (1 - Math.abs(2 * l - 1));
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const destino = s >= 0.3 && l >= 0.12 && l <= 0.88 ? saturados : opacos;
    const bin = destino.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bin.n += 1;
    bin.r += r;
    bin.g += g;
    bin.b += b;
    destino.set(key, bin);
  }

  const elegir = (bins: Map<number, Bin>): Bin | null => {
    let mejor: Bin | null = null;
    for (const bin of bins.values()) if (!mejor || bin.n > mejor.n) mejor = bin;
    return mejor && mejor.n >= MIN_PIXELES_BIN ? mejor : null;
  };
  const bin = elegir(saturados) ?? elegir(opacos);
  if (!bin) return null;
  return `#${hex2(bin.r / bin.n)}${hex2(bin.g / bin.n)}${hex2(bin.b / bin.n)}`;
}
