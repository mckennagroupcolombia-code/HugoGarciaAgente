/** C6H12O6 → C₆H₁₂O₆. Coeficientes (2H₂O, ·5H₂O) quedan en tamaño normal. */

const SUB: Record<string, string> = {
  "0": "₀",
  "1": "₁",
  "2": "₂",
  "3": "₃",
  "4": "₄",
  "5": "₅",
  "6": "₆",
  "7": "₇",
  "8": "₈",
  "9": "₉",
};

const UNSUB: Record<string, string> = {
  "₀": "0",
  "₁": "1",
  "₂": "2",
  "₃": "3",
  "₄": "4",
  "₅": "5",
  "₆": "6",
  "₇": "7",
  "₈": "8",
  "₉": "9",
};

const DIGITOS_SUB = /(?<=[A-Za-z)\]}])(\d+)/g;

function asciiDigitos(texto: string): string {
  return texto.replace(/[₀₁₂₃₄₅₆₇₈₉]/g, (ch) => UNSUB[ch] ?? ch);
}

export function formatearFormulaMolecular(texto: string): string {
  if (!texto) return texto;
  return asciiDigitos(texto).replace(DIGITOS_SUB, (digits) =>
    digits.replace(/[0-9]/g, (d) => SUB[d] ?? d),
  );
}
