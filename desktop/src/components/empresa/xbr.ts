/**
 * 2xBR (Hyllian, nivel 2) en el navegador: lleva pixel art al doble suavizando bordes y diagonales.
 * El mismo algoritmo que scripts/empresa_viva/xbr.py (que escala el barrio al generarlo); aquí se usa
 * para los personajes, que se arman y recolorean por piezas en el navegador (personajes.ts) y por eso
 * no se pueden escalar antes. Distancias en YUV + alfa; mezclas en alfa premultiplicado.
 */

/** La imagen (un canvas) al doble con 2xBR. */
export function xbr2xCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const w = src.width, h = src.height;
  const datos = src.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const n = w * h;
  // Premultiplicado y en YUV+A, una vez por píxel.
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n), A = new Float32Array(n);
  const Y = new Float32Array(n), U = new Float32Array(n), V = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = datos[i * 4 + 3], k = a / 255;
    const r = datos[i * 4] * k, g = datos[i * 4 + 1] * k, b = datos[i * 4 + 2] * k;
    R[i] = r; G[i] = g; B[i] = b; A[i] = a;
    Y[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    U[i] = -0.169 * r - 0.331 * g + 0.5 * b;
    V[i] = 0.5 * r - 0.419 * g - 0.081 * b;
  }
  const df = (p: number, q: number) =>
    48 * Math.abs(Y[p] - Y[q]) + 7 * Math.abs(U[p] - U[q]) + 6 * Math.abs(V[p] - V[q]) + 48 * Math.abs(A[p] - A[q]);
  const eq = (p: number, q: number) =>
    Math.abs(Y[p] - Y[q]) <= 48 && Math.abs(U[p] - U[q]) <= 7 && Math.abs(V[p] - V[q]) <= 6 && Math.abs(A[p] - A[q]) <= 48;
  const ne = (p: number, q: number) => R[p] !== R[q] || G[p] !== G[q] || B[p] !== B[q] || A[p] !== A[q];

  const W2 = w * 2;
  const out = new Float32Array(W2 * h * 2 * 4);
  // Los cuatro píxeles de salida de cada E (0 arriba-izq, 1 arriba-der, 2 abajo-izq, 3 abajo-der)
  const E = new Float32Array(16);
  const mezcla = (k: number, p: number, peso: number) => {
    const o = k * 4;
    E[o] += (R[p] - E[o]) * peso; E[o + 1] += (G[p] - E[o + 1]) * peso;
    E[o + 2] += (B[p] - E[o + 2]) * peso; E[o + 3] += (A[p] - E[o + 3]) * peso;
  };
  const copia = (de: number, a: number) => { for (let c = 0; c < 4; c++) E[a * 4 + c] = E[de * 4 + c]; };
  const idx = (x: number, y: number) => (y < 0 ? 0 : y >= h ? h - 1 : y) * w + (x < 0 ? 0 : x >= w ? w - 1 : x);

  const filtro = (PE: number, PI: number, PH: number, PF: number, PG: number, PC: number, PD: number, PB: number,
                  _PA: number, _G5: number, _C4: number, _G0: number, _D0: number, _C1: number, _B1: number,
                  F4: number, I4: number, H5: number, I5: number, N1: number, N2: number, N3: number) => {
    if (!ne(PE, PH) || !ne(PE, PF)) return;
    const e = df(PE, PC) + df(PE, PG) + df(PI, H5) + df(PI, F4) + 4 * df(PH, PF);
    const i = df(PH, PD) + df(PH, I5) + df(PF, I4) + df(PF, PB) + 4 * df(PE, PI);
    const px = df(PE, PF) <= df(PE, PH) ? PF : PH;
    if (e < i && ((!eq(PF, PB) && !eq(PH, PD)) || (eq(PE, PI) && !eq(PF, I4) && !eq(PH, I5)) || eq(PE, PG) || eq(PE, PC))) {
      const ke = df(PF, PG), ki = df(PH, PC);
      const ex2 = ne(PE, PC) && ne(PB, PC), ex3 = ne(PE, PG) && ne(PD, PG);
      const izq = 2 * ke <= ki && ex3, arr = ke >= 2 * ki && ex2;
      if (izq && arr) { mezcla(N3, px, 0.75); mezcla(N2, px, 0.25); copia(N2, N1); }
      else if (izq) { mezcla(N3, px, 0.75); mezcla(N2, px, 0.25); }
      else if (arr) { mezcla(N3, px, 0.75); mezcla(N1, px, 0.25); }
      else mezcla(N3, px, 0.5);
    } else if (e <= i) mezcla(N3, px, 0.5);
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const A1 = idx(x - 1, y - 2), B1 = idx(x, y - 2), C1 = idx(x + 1, y - 2);
      const A0 = idx(x - 2, y - 1), PA = idx(x - 1, y - 1), PB = idx(x, y - 1), PC = idx(x + 1, y - 1), C4 = idx(x + 2, y - 1);
      const D0 = idx(x - 2, y), PD = idx(x - 1, y), PE = y * w + x, PF = idx(x + 1, y), F4 = idx(x + 2, y);
      const G0 = idx(x - 2, y + 1), PG = idx(x - 1, y + 1), PH = idx(x, y + 1), PI = idx(x + 1, y + 1), I4 = idx(x + 2, y + 1);
      const G5 = idx(x - 1, y + 2), H5 = idx(x, y + 2), I5 = idx(x + 1, y + 2);
      for (let k = 0; k < 4; k++) { E[k * 4] = R[PE]; E[k * 4 + 1] = G[PE]; E[k * 4 + 2] = B[PE]; E[k * 4 + 3] = A[PE]; }
      // Las cuatro esquinas (rotaciones del original); el orden importa: cada una puede pisar la anterior.
      filtro(PE, PI, PH, PF, PG, PC, PD, PB, PA, G5, C4, G0, D0, C1, B1, F4, I4, H5, I5, 1, 2, 3);
      filtro(PE, PC, PF, PB, PI, PA, PH, PD, PG, I4, A1, I5, H5, A0, D0, B1, C1, F4, C4, 0, 3, 1);
      filtro(PE, PA, PB, PD, PC, PG, PF, PH, PI, C1, G0, C4, F4, G5, H5, D0, A0, B1, A1, 2, 1, 0);
      filtro(PE, PG, PD, PH, PA, PI, PB, PF, PC, A0, I5, A1, B1, I4, F4, H5, G5, D0, G0, 3, 0, 2);
      const o0 = ((y * 2) * W2 + x * 2) * 4, o2 = o0 + W2 * 4;
      for (let c = 0; c < 4; c++) {
        out[o0 + c] = E[c]; out[o0 + 4 + c] = E[4 + c];
        out[o2 + c] = E[8 + c]; out[o2 + 4 + c] = E[12 + c];
      }
    }
  }
  const dst = document.createElement("canvas");
  dst.width = W2; dst.height = h * 2;
  const ctx = dst.getContext("2d")!;
  const img = ctx.createImageData(W2, h * 2);
  const d = img.data;
  for (let i = 0; i < W2 * h * 2; i++) {
    const a = out[i * 4 + 3];
    if (a <= 0) continue;
    const k = 255 / a;
    d[i * 4] = Math.min(255, out[i * 4] * k + 0.5);
    d[i * 4 + 1] = Math.min(255, out[i * 4 + 1] * k + 0.5);
    d[i * 4 + 2] = Math.min(255, out[i * 4 + 2] * k + 0.5);
    d[i * 4 + 3] = Math.min(255, a + 0.5);
  }
  ctx.putImageData(img, 0, 0);
  return dst;
}
