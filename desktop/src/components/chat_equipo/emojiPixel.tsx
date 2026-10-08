import { useEffect, useRef, useState, type ReactNode } from "react";
import "./emojiPixel.css";

/**
 * Emojis en pixel art para los chats (7-oct-2026). Se envían como el emoji Unicode de siempre
 * (así llegan bien a WhatsApp, avisos y correos) y en los mensajes se DIBUJAN con estos sprites
 * dibujados en 12×12 y escalados con Scale2x a 24×24. Un emoji sin sprite se ve tal cual.
 */

const PALETA: Record<string, string> = {
  k: "#1a1c2c", // contorno
  y: "#ffcd2e", o: "#e8901c", // amarillo y su sombra
  w: "#ffffff", l: "#c2c3c7", d: "#5f574f",
  r: "#e43b44", R: "#a22633", p: "#ff77a8",
  b: "#29adff", B: "#1d5fa8",
  g: "#3ec54b", G: "#1e7a3a",
  n: "#a0623a", N: "#5a3423",
  s: "#f6c28b", S: "#d08850",
  v: "#8b5cf6",
};

// Cara base: círculo amarillo con sombra abajo a la derecha.
const CARA = [
  "...kkkkkk...",
  "..kyyyyyyk..",
  ".kyyyyyyyyk.",
  "kyyyyyyyyyyk",
  "kyyyyyyyyyyk",
  "kyyyyyyyyyyk",
  "kyyyyyyyyyok",
  "kyyyyyyyyyok",
  "kyyyyyyyyyok",
  ".kyyyyyyyok.",
  "..kooooook..",
  "...kkkkkk...",
];

/** Pinta encima de una base: cada pieza es [fila, columna, "pixeles"] y el espacio no pinta. */
function sobre(base: string[], piezas: [number, number, string][]): string[] {
  const g = base.map((f) => f.split(""));
  for (const [fila, col, px] of piezas) {
    [...px].forEach((c, i) => { if (c !== " ") g[fila][col + i] = c; });
  }
  return g.map((f) => f.join(""));
}

const OJOS: [number, number, string][] = [[3, 3, "k    k"], [4, 3, "k    k"]];
const SONRISA: [number, number, string][] = [[7, 3, "k    k"], [8, 4, "kkkk"]];

const SPRITES: Record<string, { nombre: string; px: string[] }> = {
  "😀": { nombre: "Feliz", px: sobre(CARA, [...OJOS, [6, 3, "kkkkkk"], [7, 3, "kwwwwk"], [8, 4, "kkkk"]]) },
  "😂": { nombre: "Risa", px: sobre(CARA, [[3, 2, " k    k "], [4, 2, "k k  k k"], [5, 1, "b        b"], [6, 1, "b kkkkkk b"], [7, 3, "kwwwwk"], [8, 4, "krrk"]]) },
  "😉": { nombre: "Guiño", px: sobre(CARA, [[3, 3, "k"], [4, 3, "k   kkk"], ...SONRISA]) },
  "😍": { nombre: "Enamorado", px: sobre(CARA, [[3, 2, "r r  r r"], [4, 2, "rrr  rrr"], [5, 3, "r    r"], [7, 3, "kwwwwk"], [8, 4, "kkkk"]]) },
  "😎": { nombre: "Genial", px: sobre(CARA, [[3, 1, "kkkkkkkkkk"], [4, 2, "kkk  kkk"], [5, 3, "k    k"], ...SONRISA]) },
  "😢": { nombre: "Triste", px: sobre(CARA, [...OJOS, [5, 3, "b"], [6, 3, "b"], [8, 4, "kkkk"], [9, 3, "k    k"]]) },
  "😮": { nombre: "Sorpresa", px: sobre(CARA, [...OJOS, [6, 5, "kk"], [7, 4, "k  k"], [8, 4, "k  k"], [9, 5, "kk"]]) },
  "😡": {
    nombre: "Enojo",
    px: sobre(CARA.map((f) => f.replace(/y/g, "r").replace(/o/g, "R")), [[2, 2, "k      k"], [3, 3, "k    k"], [4, 3, "k    k"], [7, 4, "kkkk"], [8, 3, "k    k"]]),
  },
  "👍": {
    nombre: "Me gusta",
    px: [
      "....kk......",
      "...kssk.....",
      "...kssk.....",
      "..ksssk.....",
      "kkkssskkkkk.",
      "kBksssssssk.",
      "kBksSkkkkkk.",
      "kBksssssssk.",
      "kBksSkkkkkk.",
      "kBksssssssk.",
      "kkkkSSSSSk..",
      "....kkkkk...",
    ],
  },
  "❤️": {
    nombre: "Corazón",
    px: [
      "............",
      "..kkk..kkk..",
      ".krrrkkrrrk.",
      "krwwrrrrrrrk",
      "krwrrrrrrrrk",
      "krrrrrrrrrRk",
      ".krrrrrrrRk.",
      "..krrrrrRk..",
      "...krrrRk...",
      "....krRk....",
      ".....kk.....",
      "............",
    ],
  },
  "⭐": {
    nombre: "Estrella",
    px: [
      ".....kk.....",
      "....kyyk....",
      "....kyyk....",
      "kkkkkyykkkkk",
      "kyyyyyyyyyyk",
      ".kyyyyyyyyk.",
      "..kyyyyyyk..",
      "..kyyyyyok..",
      ".kyyykkyyok.",
      ".kyyk..kyok.",
      "kyyk....kyok",
      "kkk......kkk",
    ],
  },
  "🔥": {
    nombre: "Fuego",
    px: [
      ".....k......",
      "....krk.....",
      "....krrk..k.",
      "...krrrk.krk",
      "..krrrrrkrrk",
      ".krrroorrrrk",
      ".krrooorrrk.",
      "krrooyyoorrk",
      "kroyyyyyyork",
      "kroyywwyyork",
      ".krooyyoork.",
      "..kkkkkkkk..",
    ],
  },
  "✅": {
    nombre: "Listo",
    px: [
      "kkkkkkkkkkkk",
      "kggggggggggk",
      "kgggggggggwk",
      "kggggggggwwk",
      "kgggggggwwgk",
      "kgwggggwwggk",
      "kgwwggwwgggk",
      "kggwwwwggggk",
      "kgggwwgggggk",
      "kggggggggggk",
      "kGGGGGGGGGGk",
      "kkkkkkkkkkkk",
    ],
  },
  "❌": {
    nombre: "No",
    px: [
      "kkk......kkk",
      "krrk....krrk",
      "krrrk..krrrk",
      ".krrrkkrrrk.",
      "..krrrrrrk..",
      "...krrrrk...",
      "...krrrrk...",
      "..krrrrrRk..",
      ".krrrkkrrRk.",
      "krrrk..krrRk",
      "krrk....kRRk",
      "kkk......kkk",
    ],
  },
  "⚠️": {
    nombre: "Ojo",
    px: [
      ".....kk.....",
      "....kyyk....",
      "....kyyk....",
      "...kyykyk...",
      "...kykkyk...",
      "..kyykkyyk..",
      "..kyykkyyk..",
      ".kyyykkyyyk.",
      ".kyyyyyyyyk.",
      "kyyyykkyyyok",
      "kyyyyyyyyyok",
      "kkkkkkkkkkkk",
    ],
  },
  "☕": {
    nombre: "Café",
    px: [
      "...l..l.....",
      "....l..l....",
      "...l..l.....",
      "............",
      "kkkkkkkkkk..",
      "kNNNNNNNNkkk",
      "kwwwwwwwwk.k",
      "kwwwwwwwwk.k",
      "kwwwwwwwlkkk",
      ".kwwwwwlk...",
      "..kkkkkk....",
      "kkkkkkkkkkk.",
    ],
  },
  "📦": {
    nombre: "Paquete",
    px: [
      "..kkkkkkkk..",
      ".knnnnyynnk.",
      "knnnnnyynnnk",
      "kkkkkkkkkkkk",
      "knnnnnyynnNk",
      "knnnnnyynnNk",
      "knnnnnnnnnNk",
      "knnwwwwnnnNk",
      "knnwkkwnnnNk",
      "knnwwwwnnnNk",
      "kNNNNNNNNNNk",
      "kkkkkkkkkkkk",
    ],
  },
  "💡": {
    nombre: "Idea",
    px: [
      "...kkkkkk...",
      "..kyyyyyyk..",
      ".kywwyyyyok.",
      ".kywyyyyyok.",
      ".kyyyyyyyok.",
      ".kyyyyyyyok.",
      "..kyyyyyok..",
      "...kyyyok...",
      "...kllllk...",
      "...kddddk...",
      "...kllllk...",
      "....kkkk....",
    ],
  },
  "⏰": {
    nombre: "Hora",
    px: [
      ".kk......kk.",
      "krrk.kk.krrk",
      "kRk.kwwk.kRk",
      "...kwwkwwk..",
      "..kwwwkwwwk.",
      "..kwwwkwwwk.",
      "..kwwwkkkwk.",
      "..kwwwwwwwk.",
      "..kwwwwwwlk.",
      "...kwwwwlk..",
      "..k.kkkk.k..",
      ".k........k.",
    ],
  },
  "👀": {
    nombre: "Mirando",
    px: [
      "............",
      "............",
      ".kkk....kkk.",
      "kwwwk..kwwwk",
      "kwwwk..kwwwk",
      "kwwkk..kwwkk",
      "kwwkk..kwwkk",
      "kwwwk..kwwwk",
      "kwwlk..kwwlk",
      ".kkk....kkk.",
      "............",
      "............",
    ],
  },
  "🎉": {
    nombre: "Fiesta",
    px: [
      ".......b..p.",
      "..g..y....y.",
      "........r...",
      "....kkk..g..",
      "...kyrk.p..b",
      "..kyyyrk....",
      "..kybyyrk.y.",
      ".kyyyyrbk...",
      ".kyryyyyk.g.",
      "kyyyyrkk....",
      "kybkkk..r...",
      "kkk.........",
    ],
  },
};

/**
 * Scale2x (algoritmo de escalado para pixel art): cada pixel se vuelve 2×2 y las diagonales se
 * suavizan. Así los dibujos de 12×12 se ven a 24×24, con el pixel más fino y más definidos
 * (pedido del 7-oct-2026: «el pixel es muy grande»), sin perder el estilo.
 */
function escala2x(px: string[]): string[] {
  const alto = px.length;
  const ancho = px[0].length;
  const g = (y: number, x: number) => (y >= 0 && y < alto && x >= 0 && x < ancho ? px[y][x] : ".");
  const out: string[][] = Array.from({ length: alto * 2 }, () => new Array<string>(ancho * 2));
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const e = g(y, x), b = g(y - 1, x), d = g(y, x - 1), f = g(y, x + 1), h = g(y + 1, x);
      out[2 * y][2 * x] = d === b && b !== f && d !== h ? d : e;
      out[2 * y][2 * x + 1] = b === f && b !== d && f !== h ? f : e;
      out[2 * y + 1][2 * x] = d === h && d !== b && h !== f ? d : e;
      out[2 * y + 1][2 * x + 1] = h === f && d !== h && b !== f ? f : e;
    }
  }
  return out.map((fila) => fila.join(""));
}
for (const s of Object.values(SPRITES)) s.px = escala2x(s.px);

/** El orden en que aparecen en el selector. */
export const EMOJIS_PIXEL = Object.keys(SPRITES);

const quitarVS = (e: string) => e.replace(/️/g, "");
const POR_BASE = new Map(EMOJIS_PIXEL.map((e) => [quitarVS(e), e]));
const escapar = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const RE_EMOJI = new RegExp(
  `(${[...POR_BASE.keys()].sort((a, b) => b.length - a.length).map(escapar).join("|")})️?`,
  "gu",
);

/** Un emoji pixel como SVG: cada racha horizontal de un color es un rectángulo. */
export function EmojiPixel({ e, tam = "1.3em", className = "" }: { e: string; tam?: string; className?: string }) {
  const sprite = SPRITES[POR_BASE.get(quitarVS(e)) ?? ""];
  if (!sprite) return <span className={className}>{e}</span>;
  const rects: ReactNode[] = [];
  sprite.px.forEach((fila, y) => {
    let x = 0;
    while (x < fila.length) {
      const c = fila[x];
      let fin = x + 1;
      while (fin < fila.length && fila[fin] === c) fin++;
      if (PALETA[c]) rects.push(<rect key={`${y}-${x}`} x={x} y={y} width={fin - x} height={1} fill={PALETA[c]} />);
      x = fin;
    }
  });
  return (
    <svg viewBox={`0 0 ${sprite.px[0].length} ${sprite.px.length}`} width={tam} height={tam} shapeRendering="crispEdges" role="img" aria-label={e}
      className={`mck-emoji-pixel ${className}`} style={{ display: "inline-block", verticalAlign: "-0.25em" }}>
      <title>{e}</title>
      {rects}
    </svg>
  );
}

/** Parte un texto y cambia los emojis que tienen sprite por su versión pixel. */
export function conEmojisPixel(texto: string, clave = "e"): ReactNode[] {
  const out: ReactNode[] = [];
  let ultimo = 0;
  let n = 0;
  for (const m of texto.matchAll(RE_EMOJI)) {
    const i = m.index ?? 0;
    if (i > ultimo) out.push(texto.slice(ultimo, i));
    out.push(<EmojiPixel key={`${clave}-${n++}`} e={m[1]} />);
    ultimo = i + m[0].length;
  }
  if (!out.length) return [texto];
  if (ultimo < texto.length) out.push(texto.slice(ultimo));
  return out;
}

/** El mensaje es solo emojis pixel (hasta 3): se muestra en grande, como en WhatsApp. */
export function soloEmojisPixel(texto: string): boolean {
  const t = texto.trim();
  if (!t) return false;
  const quedan = t.replace(RE_EMOJI, "").replace(/\s/g, "");
  return quedan === "" && (t.match(RE_EMOJI)?.length ?? 0) <= 3;
}

/** Cambia por pixel los textos sueltos de una lista de nodos (lo demás lo deja igual). */
export function nodosConEmojisPixel(nodos: ReactNode[], base = "n"): ReactNode[] {
  return nodos.flatMap((nodo, i) => (typeof nodo === "string" ? conEmojisPixel(nodo, `${base}${i}`) : [nodo]));
}

/** Carita pixel del botón de la barra de escritura. */
function IconoCarita() {
  return <EmojiPixel e="😀" tam="24px" />;
}

/** Botón 😀 de la barra de escritura y su cuadrícula de emojis pixel. */
export function SelectorEmojiPixel({ onElegir }: { onElegir: (e: string) => void }) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!abierto) return;
    const fuera = (ev: PointerEvent) => { if (!caja.current?.contains(ev.target as Node)) setAbierto(false); };
    const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") setAbierto(false); };
    document.addEventListener("pointerdown", fuera);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", fuera); document.removeEventListener("keydown", esc); };
  }, [abierto]);
  return (
    <span ref={caja} className="mck-emoji-selector">
      <button type="button" onClick={() => setAbierto((v) => !v)} title="Emojis" aria-label="Emojis" aria-expanded={abierto}
        className={`mck-btn-no-fx flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-accent/10 ${abierto ? "bg-accent/10" : ""}`}>
        <IconoCarita />
      </button>
      {abierto && (
        <span className="mck-emoji-panel" role="listbox" aria-label="Emojis pixel">
          {EMOJIS_PIXEL.map((e) => (
            <button key={e} type="button" role="option" aria-selected={false} title={SPRITES[e].nombre}
              className="mck-btn-no-fx mck-emoji-celda"
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => onElegir(e)}>
              <EmojiPixel e={e} tam="28px" />
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
