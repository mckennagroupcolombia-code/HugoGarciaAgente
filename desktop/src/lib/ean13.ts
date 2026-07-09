/** Generación y render de códigos de barras EAN-13 (compartido entre la herramienta
 * manual de arrastrar-al-lienzo y el registro persistente de códigos por producto). */

// ── EAN-13 encoding tables ──────────────────────────────────────────────────
const L = ["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"];
const G = ["0100111","0110011","0011011","0100001","0011101","0111001","0000101","0010001","0001001","0010111"];
const R = ["1110010","1100110","1101100","1000010","1011100","1001110","1010000","1000100","1001000","1110100"];
// Parity pattern per first digit (L=left-odd, G=left-even)
const PARITY = ["LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG","LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"];
// Guard bars: start(0-2), center(45-49), end(92-94)
const GUARD_IDX = new Set([0,1,2,45,46,47,48,49,92,93,94]);

export function calcCheck(d12: string): number {
  let s = 0;
  for (let i = 0; i < 12; i++) s += parseInt(d12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (s % 10)) % 10;
}

function buildBits(digits: string): string {
  const parity = PARITY[parseInt(digits[0])];
  let bits = "101";
  for (let i = 0; i < 6; i++) {
    const d = parseInt(digits[i + 1]);
    bits += parity[i] === "L" ? L[d] : G[d];
  }
  bits += "01010";
  for (let i = 0; i < 6; i++) bits += R[parseInt(digits[i + 7])];
  bits += "101";
  return bits; // 95 modules
}

export interface EAN13Result { svg: string; digits: string; }

export function generarEAN13(input: string): EAN13Result | null {
  const raw = input.replace(/\D/g, "");
  if (raw.length < 12 || raw.length > 13) return null;

  const digits = raw.length === 12 ? raw + calcCheck(raw) : raw;
  const bits = buildBits(digits);

  // Layout constants (all in px) — mw=3 gives 339×112px for good print resolution
  const mw = 3;       // module width
  const qzL = 11;     // quiet zone left modules
  const qzR = 7;      // quiet zone right modules
  const dataH = 80;   // data bar height
  const gExt = 12;    // guard bar extra height below data bars
  const textH = 20;   // text row height
  const padTop = 2;
  const totalW = (qzL + 95 + qzR) * mw;   // 339px
  const totalH = padTop + dataH + gExt + textH; // 108px

  let bars = "";
  for (let i = 0; i < 95; i++) {
    if (bits[i] === "1") {
      const h = GUARD_IDX.has(i) ? dataH + gExt : dataH;
      bars += `<rect x="${(qzL + i) * mw}" y="${padTop}" width="${mw}" height="${h}" fill="black"/>`;
    }
  }

  const textY = padTop + dataH + gExt + textH - 2;
  const fz = 17;
  // digit 1 left of start guard
  const xD1 = (qzL - 1) * mw;
  // digits 2-7 center under left data (modules qzL+3 … qzL+44)
  const xLeft = (qzL + 3 + 21) * mw;
  // digits 8-13 center under right data (modules qzL+50 … qzL+91)
  const xRight = (qzL + 50 + 21) * mw;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}">` +
    `<rect width="${totalW}" height="${totalH}" fill="white"/>` +
    bars +
    `<text x="${xD1}" y="${textY}" text-anchor="middle" font-family="monospace" font-size="${fz}" fill="black">${digits[0]}</text>` +
    `<text x="${xLeft}" y="${textY}" text-anchor="middle" font-family="monospace" font-size="${fz}" fill="black">${digits.slice(1, 7)}</text>` +
    `<text x="${xRight}" y="${textY}" text-anchor="middle" font-family="monospace" font-size="${fz}" fill="black">${digits.slice(7)}</text>` +
    `</svg>`;

  return { svg, digits };
}

export function svgToDataUrl(svg: string): string {
  try {
    return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
  } catch {
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }
}
