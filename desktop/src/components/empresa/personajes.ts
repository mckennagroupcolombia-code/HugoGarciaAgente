/**
 * Personajes en pixel art: cada avatar se arma apilando capas del generador LPC (cuerpo, cabeza,
 * pelo, ropa…) y recoloreando cada capa con las paletas del generador. Las capas y el catálogo los
 * prepara scripts/empresa_viva/armar_personajes.py en public/empresa/pixel/personajes/.
 *
 * Una tira por avatar: 25 columnas de 64×64 (caminar 0-8, quieto 9-10, sentado 11-13, gesto 14-16,
 * correr 17-24) y 4 filas (arriba, izquierda, abajo, derecha). Este módulo no sabe de Phaser:
 * devuelve un <canvas>; juego.ts lo registra como textura. Así el editor de avatar lo usa igual.
 */
import type { AvatarPixel, Dir } from "./tipos";

export const BASE_PIXEL = `${import.meta.env.BASE_URL}empresa/pixel/`;

interface CapaCat { z: number; archivos: Record<string, { archivo: string; anims: string[] }> }
export interface PiezaCat { id: string; nombre: string; capas: CapaCat[]; material?: Record<string, string> }
export interface Catalogo {
  cuadro: number;
  columnas: number;
  animaciones: Record<string, { col: number; n: number }>;
  paletas: Record<string, Record<string, string[]>>;
  bases: Record<string, string>;
  piezas: Record<string, PiezaCat[]>;
}

let catalogo: Promise<Catalogo> | null = null;
export function cargarCatalogo(): Promise<Catalogo> {
  catalogo ??= fetch(`${BASE_PIXEL}personajes/personajes.json`, { credentials: "same-origin" }).then((r) => {
    if (!r.ok) throw new Error(`personajes.json: HTTP ${r.status}`);
    return r.json() as Promise<Catalogo>;
  });
  return catalogo;
}

const imagenes = new Map<string, Promise<HTMLImageElement>>();
function imagen(archivo: string): Promise<HTMLImageElement> {
  let p = imagenes.get(archivo);
  if (!p) {
    p = new Promise((ok, mal) => {
      const im = new Image();
      im.onload = () => ok(im);
      im.onerror = () => mal(new Error(`no cargó ${archivo}`));
      im.src = `${BASE_PIXEL}personajes/${archivo}`;
    });
    imagenes.set(archivo, p);
    p.catch(() => imagenes.delete(archivo));
  }
  return p;
}

// ─── Opciones del editor (etiquetas de las paletas en español) ──────────────

export const PIELES: [string, string][] = [
  ["light", "Clara"], ["amber", "Miel"], ["olive", "Oliva"], ["taupe", "Canela"], ["bronze", "Bronce"],
  ["brown", "Morena"], ["black", "Oscura"],
];
export const OJOS: [string, string][] = [["brown", "Cafés"], ["blue", "Azules"], ["green", "Verdes"], ["gray", "Grises"]];
export const COLORES_PELO: [string, string][] = [
  ["black", "Negro"], ["raven", "Azabache"], ["dark_brown", "Castaño oscuro"], ["chestnut", "Castaño"],
  ["light_brown", "Castaño claro"], ["blonde", "Rubio"], ["platinum", "Platino"], ["redhead", "Pelirrojo"],
  ["carrot", "Zanahoria"], ["gray", "Canoso"], ["white", "Blanco"], ["pink", "Rosado"], ["purple", "Morado"], ["blue", "Azul"],
];
export const COLORES_TELA: [string, string][] = [
  ["white", "Blanco"], ["gray", "Gris"], ["charcoal", "Carbón"], ["black", "Negro"], ["navy", "Azul oscuro"],
  ["blue", "Azul"], ["sky", "Celeste"], ["teal", "Verde azulado"], ["forest", "Verde bosque"], ["green", "Verde"],
  ["yellow", "Amarillo"], ["orange", "Naranja"], ["red", "Rojo"], ["maroon", "Vinotinto"], ["rose", "Palo de rosa"],
  ["pink", "Rosado"], ["lavender", "Lavanda"], ["purple", "Morado"], ["tan", "Caqui"], ["brown", "Café"], ["leather", "Cuero"],
];

export const AVATAR_BASE: AvatarPixel = {
  cuerpo: "hombre", piel: "light", ojos: "brown", pelo: "corto", color_pelo: "dark_brown", barba: "",
  torso: "camiseta", color_torso: "blue", piernas: "jean", color_piernas: "navy", zapatos: "tenis",
  color_zapatos: "white", delantal: "", color_delantal: "tan", gafas: "",
};

function hashTexto(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Un avatar al azar pero estable para una semilla (clientes, o alguien que no ha elegido). */
export function avatarDeSemilla(semilla: string, cat?: Catalogo | null): AvatarPixel {
  const h = (k: number) => hashTexto(`${semilla}:${k}`);
  const elegir = <T,>(xs: T[], k: number) => xs[h(k) % xs.length];
  const mujer = h(0) % 2 === 0;
  const pelos = (cat?.piezas.pelo ?? []).map((p) => p.id).filter(Boolean);
  const largos = ["largo", "largo_liso", "ondulado", "cola", "mono", "bob", "melena", "trenza", "crespo_largo"];
  const cortos = ["corto", "despeinado", "raya", "puntas", "crespo", "afro", "flequillo"];
  const opcionesPelo = (pelos.length ? pelos : [...largos, ...cortos]).filter((p) => (mujer ? largos.includes(p) || p === "pixie" || p === "afro" : cortos.includes(p)));
  return {
    ...AVATAR_BASE,
    cuerpo: mujer ? "mujer" : "hombre",
    piel: elegir(PIELES, 1)[0],
    ojos: elegir(OJOS, 2)[0],
    pelo: elegir(opcionesPelo.length ? opcionesPelo : ["corto"], 3),
    color_pelo: elegir(COLORES_PELO.slice(0, 9), 4)[0],
    barba: !mujer && h(5) % 3 === 0 ? elegir(["sombra", "candado", "barba"], 6) : "",
    torso: elegir(mujer ? ["camiseta", "camiseta_v", "polo", "cardigan", "esqueleto", "buzo"] : ["camiseta", "polo", "camisa", "buzo", "polo_manga"], 7),
    color_torso: elegir(COLORES_TELA, 8)[0],
    piernas: elegir(mujer ? ["jean", "pantalon", "leggins", "falda"] : ["jean", "pantalon", "formal", "bermuda"], 9),
    color_piernas: elegir(["navy", "blue", "charcoal", "black", "tan", "gray", "brown"], 10),
    zapatos: elegir(["zapatos", "tenis"], 11),
    color_zapatos: elegir(["white", "black", "brown", "gray"], 12),
    gafas: h(13) % 5 === 0 ? elegir(["gafas", "redondas", "sol"], 14) : "",
  };
}

/** Completa lo que falte con la base (el servidor puede mandar avatares a medias o viejos). */
export function normalizarAvatar(a: Partial<AvatarPixel> | null | undefined, semilla: string, cat?: Catalogo | null): AvatarPixel {
  const base = avatarDeSemilla(semilla, cat);
  if (!a) return base;
  const out = { ...base, ...Object.fromEntries(Object.entries(a).filter(([, v]) => typeof v === "string")) } as AvatarPixel;
  if (out.cuerpo !== "hombre" && out.cuerpo !== "mujer") out.cuerpo = base.cuerpo;
  return out;
}

export function claveAvatar(a: AvatarPixel): string {
  return [a.cuerpo, a.piel, a.ojos, a.pelo, a.color_pelo, a.barba, a.torso, a.color_torso, a.piernas, a.color_piernas,
          a.zapatos, a.color_zapatos, a.delantal, a.color_delantal, a.gafas].join("|");
}

function hexA(h: string): number {
  return parseInt(h.replace("#", ""), 16);
}

/** Tabla de cambio de color: color de la paleta base → color de la paleta elegida (por material). */
function tabla(cat: Catalogo, cambios: Record<string, string | undefined>): Map<number, number> {
  const m = new Map<number, number>();
  for (const [material, destino] of Object.entries(cambios)) {
    if (!destino) continue;
    const base = cat.paletas[material]?.[cat.bases[material]];
    const dest = cat.paletas[material]?.[destino];
    if (!base || !dest) continue;
    base.forEach((c, i) => { if (dest[i]) m.set(hexA(c), hexA(dest[i])); });
  }
  return m;
}

function recolorear(ctx: CanvasRenderingContext2D, w: number, h: number, t: Map<number, number>) {
  if (!t.size) return;
  const d = ctx.getImageData(0, 0, w, h);
  const px = d.data;
  for (let i = 0; i < px.length; i += 4) {
    if (!px[i + 3]) continue;
    const c = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
    const n = t.get(c);
    if (n !== undefined) { px[i] = n >> 16; px[i + 1] = (n >> 8) & 255; px[i + 2] = n & 255; }
  }
  ctx.putImageData(d, 0, 0);
}

/** La tira completa del avatar en un canvas (1600×256). */
export async function componerAvatar(a: AvatarPixel): Promise<HTMLCanvasElement> {
  const cat = await cargarCatalogo();
  const W = cat.columnas * cat.cuadro, H = 4 * cat.cuadro;
  const capas: { z: number; archivo: string; cambios: Record<string, string | undefined> }[] = [];
  const agregar = (pieza: string, id: string, colores: Record<string, string | undefined>) => {
    if (!id) return;
    const p = cat.piezas[pieza]?.find((x) => x.id === id);
    if (!p) return;
    for (const c of p.capas) {
      const a_ = c.archivos[a.cuerpo] ?? Object.values(c.archivos)[0];
      if (!a_) continue;
      const cambios: Record<string, string | undefined> = {};
      for (const material of Object.values(p.material ?? {})) cambios[material] = colores[material];
      capas.push({ z: c.z, archivo: a_.archivo, cambios });
    }
  };
  agregar("cuerpo", a.cuerpo, { body: a.piel });
  agregar("cabeza", a.cuerpo, { body: a.piel, eye: a.ojos });
  agregar("zapatos", a.zapatos, { cloth: a.color_zapatos });
  agregar("piernas", a.piernas, { cloth: a.color_piernas });
  agregar("torso", a.torso, { cloth: a.color_torso });
  agregar("delantal", a.delantal, { cloth: a.color_delantal });
  agregar("barba", a.barba, { hair: a.color_pelo });
  agregar("pelo", a.pelo, { hair: a.color_pelo });
  agregar("gafas", a.gafas, {});
  capas.sort((x, y) => x.z - y.z);
  const ims = await Promise.all(capas.map((c) => imagen(c.archivo).catch(() => null)));
  const lienzo = document.createElement("canvas");
  lienzo.width = W; lienzo.height = H;
  const ctx = lienzo.getContext("2d", { willReadFrequently: true })!;
  const tmp = document.createElement("canvas");
  tmp.width = W; tmp.height = H;
  const tctx = tmp.getContext("2d", { willReadFrequently: true })!;
  capas.forEach((c, i) => {
    const im = ims[i];
    if (!im) return;
    tctx.clearRect(0, 0, W, H);
    tctx.drawImage(im, 0, 0);
    recolorear(tctx, W, H, tabla(cat, c.cambios));
    ctx.drawImage(tmp, 0, 0);
  });
  return lienzo;
}

export const FILA: Record<Dir, number> = { arriba: 0, izquierda: 1, abajo: 2, derecha: 3 };

/** Retrato (cabeza y hombros mirando al frente) para la barra del equipo y los diálogos. */
export function retrato(tira: HTMLCanvasElement, tam = 64): string {
  const c = document.createElement("canvas");
  c.width = tam; c.height = tam;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  // Cuadro «quieto» mirando abajo (col 9, fila 2): la cara está en el tercio de arriba.
  ctx.drawImage(tira, 9 * 64 + 16, 2 * 64 + 8, 32, 32, 0, 0, tam, tam);
  return c.toDataURL("image/png");
}
