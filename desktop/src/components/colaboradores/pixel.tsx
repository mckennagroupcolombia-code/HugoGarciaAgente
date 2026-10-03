/**
 * Pixel art del tablero de Colaboradores: sprites, paleta y el círculo escalonado.
 *
 * Los íconos son sprites dibujados a mano en una cuadrícula (una letra = un
 * píxel, `.` = transparente) con la paleta PICO-8, y se pintan como SVG con
 * `crispEdges`: se ven nítidos a cualquier escala y no dependen de emojis (que
 * cambian según el teléfono y que la interfaz ya no usa como íconos).
 *
 * El pixel art es de todo MENOS de las letras (decisión 25-sep-2026, legibilidad): el
 * texto va en la fuente de la app; aquí no se carga ninguna fuente pixel.
 */
import type { ReactElement } from "react";

/** PICO-8: 16 colores pensados para leerse juntos. */
export const PALETA: Record<string, string> = {
  k: "#000000", B: "#1D2B53", P: "#7E2553", G: "#008751",
  n: "#AB5236", S: "#5F574F", s: "#C2C3C7", w: "#FFF1E8",
  r: "#FF004D", o: "#FFA300", y: "#FFEC27", g: "#00E436",
  b: "#29ADFF", v: "#83769C", p: "#FF77A8", c: "#FFCCAA",
};

export const SPRITES = {
  moneda: ["..kkkk..", ".kyyyyk.", "kyywyyok", "kyywyyok", "kyywyyok", "kyyyyyok", ".kooook.", "..kkkk.."],
  bolsa: ["..k..k..", "...kk...", "..kook..", ".kooyok.", "kooyyook", "koooyook", "kooyyook", ".kkkkkk."],
  reloj: ["..kkkk..", ".kwwwwk.", "kwwkwwwk", "kwwkwwwk", "kwwkkkwk", "kwwwwwwk", ".kwwwwk.", "..kkkk.."],
  datos: ["kkkkkkkk", "kwwwwwwk", "kwSSSSwk", "kwwwwwwk", "kwSSSSwk", "kwwwwwwk", "kwSSwwwk", "kkkkkkkk"],
  doc: ["kkkkk...", "kwwwkk..", "kwwwkwk.", "kwwwkkkk", "kwSSSSwk", "kwwwwwwk", "kwSSSSwk", "kkkkkkkk"],
  foto: ["kkkkkkkk", "kbbbbbbk", "kbbbbybk", "kbbbbbbk", "kbGbbbbk", "kGGGbGbk", "kGGGGGGk", "kkkkkkkk"],
  alerta: ["kkkkkkkk", "krrwwrrk", "krrwwrrk", "krrwwrrk", "krrwwrrk", "krrrrrrk", "krrwwrrk", "kkkkkkkk"],
  urna: ["..kkkk..", "..kwwk..", "kkkwwkkk", "kvvkkvvk", "kvvvvvvk", "kvvwwvvk", "kvvvvvvk", "kkkkkkkk"],
  pulgar: ["...kk...", "..kgk...", "..kgk...", "kkkggkkk", "kgkggggk", "kgkggggk", "kgkgggk.", "kkkkkk.."],
  trofeo: ["kkkkkkkk", "kyyyyyok", ".kyyyok.", "..kyok..", "...kk...", "...ok...", "..kook..", ".kkkkkk."],
  cofre: ["kkkkkkkk", "knnnnnnk", "kkkkkkkk", "knnyynnk", "knnkknnk", "knnnnnnk", "knnnnnnk", "kkkkkkkk"],
  bloques: ["...kkkk.", "...kyyk.", "...kyyk.", "kkkkkkkk", "krrkkbbk", "krrkkbbk", "kkkkkkkk", "........"],
  codigo: ["kkkkkkkk", "kwwwwwwk", "kwkwkkwk", "kwkwkkwk", "kwkwkkwk", "kwwwwwwk", "kwSwSSwk", "kkkkkkkk"],
  ventana: ["kkkkkkkk", "kbbbbbbk", "kkkkkkkk", "kwwwwwwk", "kwSSwwwk", "kwwwwwwk", "kkkkkkkk", "..kkkk.."],
  estrella: ["...kk...", "..kyyk..", "kkkyykkk", "kyyyyyyk", ".kyyyyk.", ".kykkyk.", "kyk..kyk", "kk....kk"],
  gema: ["..kkkk..", ".kbbwbk.", "kbbwbbbk", "kkkkkkkk", ".kbbbbk.", "..kbbk..", "...kk...", "........"],
  bandera: ["kk......", "krrrrk..", "krrrrrk.", "krrrrk..", "kk......", "k.......", "k.......", "k......."],
  camion: ["........", "kkkkk...", "kwwwkkk.", "kwwwkbbk", "kwwwkkkk", "kkkkkkkk", ".kSk.kSk", "..k...k."],
  // X = color del carril (se pasa en `colores`): la figura de cada quien.
  jugador: ["..kkkk..", "..kcck..", "..kcck..", "...kk...", ".kXXXXk.", "kXkXXkXk", "..kXXk..", "..k..k.."],
  control: [".kkkkkkkk.", "kssssssssk", "kskssssrsk", "kkkkssrgrk", "kskssssrsk", ".kkk..kkk."],
} satisfies Record<string, string[]>;

export type SpriteId = keyof typeof SPRITES;

/** Un sprite. `px` = tamaño en pantalla de cada píxel del dibujo. */
export function Sprite({ s, px = 2, colores, className, titulo }: {
  s: SpriteId | string[]; px?: number; colores?: Record<string, string>; className?: string; titulo?: string;
}) {
  const filas = Array.isArray(s) ? s : SPRITES[s];
  const w = Math.max(...filas.map((f) => f.length));
  const h = filas.length;
  // Cada tramo horizontal del mismo color es UN rect: menos nodos en el DOM.
  const rects: ReactElement[] = [];
  filas.forEach((fila, y) => {
    let x = 0;
    while (x < fila.length) {
      const ch = fila[x];
      let fin = x + 1;
      while (fin < fila.length && fila[fin] === ch) fin++;
      const color = colores?.[ch] ?? PALETA[ch];
      if (color) rects.push(<rect key={`${y}-${x}`} x={x} y={y} width={fin - x} height={1} fill={color} />);
      x = fin;
    }
  });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w * px} height={h * px} shapeRendering="crispEdges"
         className={`inline-block shrink-0 align-middle ${className ?? ""}`}
         role={titulo ? "img" : undefined} aria-hidden={titulo ? undefined : true}>
      {titulo && <title>{titulo}</title>}
      {rects}
    </svg>
  );
}

/**
 * Un círculo hecho de escalones, como se dibuja en pixel art: `clip-path` en
 * una cuadrícula de n×n. Cada fila abre hasta donde llega el círculo real.
 */
export function circuloPixel(n = 16): string {
  const r = n / 2;
  const filas = Array.from({ length: n }, (_, y) => {
    const dy = y + 0.5 - r;
    const hw = Math.sqrt(Math.max(0, r * r - dy * dy));
    return [Math.round(r - hw), Math.round(r + hw)] as const;
  });
  const pct = (v: number) => `${((v / n) * 100).toFixed(2)}%`;
  const pts: string[] = [];
  filas.forEach(([, x1], y) => pts.push(`${pct(x1)} ${pct(y)}`, `${pct(x1)} ${pct(y + 1)}`));
  for (let y = n - 1; y >= 0; y--) pts.push(`${pct(filas[y][0])} ${pct(y + 1)}`, `${pct(filas[y][0])} ${pct(y)}`);
  return `polygon(${pts.join(", ")})`;
}

