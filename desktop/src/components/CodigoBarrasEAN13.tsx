import { useEffect, useRef, useState } from "react";

// ── EAN-13 encoding tables ──────────────────────────────────────────────────
const L = ["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"];
const G = ["0100111","0110011","0011011","0100001","0011101","0111001","0000101","0010001","0001001","0010111"];
const R = ["1110010","1100110","1101100","1000010","1011100","1001110","1010000","1000100","1001000","1110100"];
// Parity pattern per first digit (L=left-odd, G=left-even)
const PARITY = ["LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG","LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"];
// Guard bars: start(0-2), center(45-49), end(92-94)
const GUARD_IDX = new Set([0,1,2,45,46,47,48,49,92,93,94]);

function calcCheck(d12: string): number {
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

interface EAN13Result { svg: string; digits: string; }

function generarEAN13(input: string): EAN13Result | null {
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

function svgToDataUrl(svg: string): string {
  try {
    return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
  } catch {
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }
}

// ── Component ───────────────────────────────────────────────────────────────
interface Props {
  onCerrar: () => void;
  onInsertar?: (svgDataUrl: string) => void;
}

export function CodigoBarrasEAN13({ onCerrar, onInsertar }: Props) {
  const [valor, setValor] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const raw = valor.replace(/\D/g, "").slice(0, 13);
  const resultado = raw.length >= 12 ? generarEAN13(raw) : null;
  const esValido = resultado !== null;

  // Check digit preview while typing
  const checkPreview = raw.length === 12 ? calcCheck(raw) : null;
  const errorCheck =
    raw.length === 13
      ? calcCheck(raw.slice(0, 12)) !== parseInt(raw[12])
        ? `Dígito verificador incorrecto (correcto: ${calcCheck(raw.slice(0, 12))})`
        : null
      : null;

  function onDragStart(e: React.DragEvent) {
    if (!resultado) return;
    e.dataTransfer.setData("application/ghs-icon", resultado.svg);
    e.dataTransfer.effectAllowed = "copy";
    const ghost = document.createElement("div");
    ghost.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:50px;height:20px;background:#e5e7eb;border-radius:4px;";
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 25, 10);
    setTimeout(() => ghost.remove(), 0);
  }

  return (
    <div
      className="fixed right-4 top-20 z-40 w-72 rounded-2xl border border-border bg-surface-panel shadow-paper-lg"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-bold text-ink">Código de barras EAN-13</span>
        <button
          type="button"
          onClick={onCerrar}
          className="rounded-md px-1.5 py-0.5 text-xs text-muted hover:bg-surface-hover"
        >
          ✕
        </button>
      </div>

      <div className="space-y-3 p-3">
        {/* Input */}
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">
            Código EAN-13
          </label>
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            maxLength={14}
            placeholder="7 700000 000000"
            value={valor}
            onChange={(e) => setValor(e.target.value.replace(/[^\d\s]/g, ""))}
            className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 font-mono text-sm tracking-widest text-ink focus:border-accent focus:outline-none"
          />
          <div className="mt-1 flex items-center justify-between">
            <span className="text-[10px] text-muted">{raw.length}/13 dígitos</span>
            {checkPreview !== null && (
              <span className="text-[10px] font-semibold text-accent">
                Dígito verificador: {checkPreview}
              </span>
            )}
            {errorCheck && (
              <span className="text-[10px] text-red-500">{errorCheck}</span>
            )}
          </div>
        </div>

        {/* Preview barcode */}
        <div className="flex min-h-[56px] items-center justify-center overflow-hidden rounded-xl border border-border bg-white p-2 dark:bg-zinc-50">
          {esValido && resultado ? (
            <div
              draggable
              onDragStart={onDragStart}
              title="Arrastra al lienzo"
              className="w-full cursor-grab active:cursor-grabbing [&>svg]:h-auto [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: resultado.svg }}
            />
          ) : (
            <span className="text-[10px] text-muted">
              {raw.length === 0
                ? "Ingresa 12 o 13 dígitos"
                : raw.length < 12
                ? `Faltan ${12 - raw.length} dígitos`
                : "Procesando…"}
            </span>
          )}
        </div>

        {esValido && resultado && (
          <p className="text-center font-mono text-[10px] tracking-widest text-muted">
            {resultado.digits}
          </p>
        )}

        {/* Acciones */}
        <div className="flex gap-2">
          {onInsertar && (
            <button
              type="button"
              disabled={!esValido}
              onClick={() => {
                if (!resultado) return;
                onInsertar(svgToDataUrl(resultado.svg));
              }}
              className="flex-1 rounded-lg bg-accent py-1.5 text-xs font-bold text-white disabled:opacity-40 hover:opacity-90"
            >
              ↳ Insertar en lienzo
            </button>
          )}
          <button
            type="button"
            disabled={!esValido}
            onClick={() => {
              if (!resultado) return;
              const a = document.createElement("a");
              a.href = svgToDataUrl(resultado.svg);
              a.download = `EAN13_${resultado.digits}.svg`;
              a.click();
            }}
            className="flex-1 rounded-lg border border-border py-1.5 text-xs text-ink-secondary disabled:opacity-40 hover:bg-surface-hover"
          >
            Descargar SVG
          </button>
        </div>

        <p className="text-[9px] text-muted">
          Con 12 dígitos el verificador se calcula automáticamente. Arrastra la previsualización al lienzo.
        </p>
      </div>
    </div>
  );
}
