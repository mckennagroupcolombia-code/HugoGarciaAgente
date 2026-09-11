/**
 * Emparejamiento por palabras clave entre el título de un código de barras
 * ("ACIDO SALICILICO 30mL", "PISTACHOS TOSTADOS  Kg") y los títulos de las
 * fichas técnicas ("ÁCIDO SALICÍLICO"). Se normaliza (sin tildes, minúsculas),
 * se descartan unidades/presentaciones y palabras vacías, y se comparan
 * raíces simples (sin la "s" final) admitiendo prefijos largos.
 */
// Sin letras sueltas: "C", "E", "D" distinguen VITAMINA C / VITAMINA E / D PANTENOL.
const PALABRAS_VACIAS = new Set([
  "de", "del", "la", "el", "los", "las", "y", "en", "con", "sin", "para", "por", "al", "the", "of",
]);
/** "500g", "30ml", "1kg", "50", "kg", "lt", "und"… — la presentación no identifica el producto. */
const PRESENTACION = /^(\d+([.,]\d+)?)(g|gr|grs|kg|mg|ml|l|lt|lts|oz|un|und|u|cc|pz|pzs|%)?$|^(g|gr|grs|kg|kilo|kilos|ml|lt|lts|l|litro|litros|gramo|gramos|und|unidad|unidades|pza|pzas)$/;

export function normalizarTexto(t: string): string {
  return (t || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function raiz(tok: string): string {
  return tok.length > 4 && tok.endsWith("s") ? tok.slice(0, -1) : tok;
}

/** Palabras clave de un título, en orden y sin repetidos. */
export function palabrasClave(titulo: string): string[] {
  const out: string[] = [];
  for (const tok of normalizarTexto(titulo).split(" ")) {
    if (!tok || PALABRAS_VACIAS.has(tok) || PRESENTACION.test(tok)) continue;
    const r = raiz(tok);
    if (!out.includes(r)) out.push(r);
  }
  return out;
}

function coincide(a: string, b: string): boolean {
  if (a === b) return true;
  // Prefijos largos: "salicilic" ~ "salicilico", "deshidratado" ~ "deshidratada".
  return a.length >= 5 && b.length >= 5 && (a.startsWith(b) || b.startsWith(a));
}

/** Peso de una palabra clave: 1 para todas (por defecto) o por rareza (ver
 *  `pesosPorRareza`). */
export type PesoPalabra = (tok: string) => number;

/** Peso por rareza en el catálogo de fichas (IDF): "goma", "aceite" o
 *  "citrato" aparecen en muchas fichas y pesan poco; "xantana", "coco" o
 *  "chia" identifican el producto y pesan mucho. Así "GOMA XANTANA" ya no
 *  se enlaza con "GOMA GUAR" solo porque comparten la palabra genérica.
 *  Una palabra que no existe en ningún título (típicamente la específica
 *  del producto, o una errata) recibe el peso máximo. */
export function pesosPorRareza(titulos: string[]): PesoPalabra {
  const df = new Map<string, number>();
  const n = Math.max(1, titulos.length);
  for (const t of titulos) for (const k of new Set(palabrasClave(t))) df.set(k, (df.get(k) ?? 0) + 1);
  const cache = new Map<string, number>();
  return (tok) => {
    const memo = cache.get(tok);
    if (memo !== undefined) return memo;
    let d = df.get(tok) ?? 0;
    if (d === 0) for (const [k, v] of df) if (coincide(tok, k)) d += v;
    const w = 1 + Math.log(n / (1 + d));
    cache.set(tok, w);
    return w;
  };
}

/** 0..1 — Jaccard ponderado entre las palabras clave de los dos títulos:
 *  peso de las que coinciden / peso de todas las de ambos lados. Título
 *  idéntico = 1; "MANTECA DE CACAO" vs "MANTECA DE CACAO REFINADA" ≈ 0.67
 *  con pesos iguales. */
export function puntuarTitulo(claves: string[], titulo: string, peso: PesoPalabra = () => 1): number {
  if (claves.length === 0) return 0;
  const otras = palabrasClave(titulo);
  if (otras.length === 0) return 0;
  const usadas = new Set<number>();
  let coincidentes = 0;
  let total = 0;
  for (const c of claves) {
    const w = peso(c);
    total += w;
    const idx = otras.findIndex((o, i) => !usadas.has(i) && coincide(c, o));
    if (idx >= 0) {
      usadas.add(idx);
      coincidentes += w;
    }
  }
  otras.forEach((o, i) => {
    if (!usadas.has(i)) total += peso(o);
  });
  return total > 0 ? coincidentes / total : 0;
}

export interface CandidataFicha {
  id: string;
  titulo: string;
  borrador?: boolean;
}

/** Puntaje mínimo para enlazar la ficha técnica sin preguntar. Calibrado
 *  contra el catálogo EAN real: 0.45 deja pasar "MENTOL CRISTAL" → "MENTOL"
 *  (0.47) y frena "GOMA XANTANA" → "GOMA GUAR" (0.31). */
export const UMBRAL_ENLACE_AUTOMATICO = 0.45;

export function mejorFichaParaTitulo<T extends CandidataFicha>(
  fichas: T[],
  titulo: string,
): { ficha: T; puntaje: number; claves: string[] } | null {
  const claves = palabrasClave(titulo);
  if (claves.length === 0) return null;
  const peso = pesosPorRareza(fichas.map((f) => f.titulo));
  let mejor: { ficha: T; puntaje: number; claves: string[] } | null = null;
  for (const f of fichas) {
    const p = puntuarTitulo(claves, f.titulo, peso);
    if (p <= 0) continue;
    const gana =
      !mejor ||
      p > mejor.puntaje ||
      (p === mejor.puntaje && !f.borrador && Boolean(mejor.ficha.borrador)) ||
      (p === mejor.puntaje && f.titulo.length < mejor.ficha.titulo.length);
    if (gana) mejor = { ficha: f, puntaje: p, claves };
  }
  return mejor;
}

/** ¿El producto del código de barras es otro que el de la etiqueta? Compara
 *  el título del código con la ficha técnica enlazada o, sin enlace, con el
 *  nombre escrito en la etiqueta. null = coinciden o no hay con qué comparar.
 *  Pesos iguales: "CITRATO POTASIO" vs "CITRATO DE MAGNESIO" = 0.33 (avisa);
 *  "CITRATO CALCIO 500g" vs "CITRATO DE CALCIO" = 1. */
export function discrepanciaProducto(
  tituloCodigo: string | undefined,
  tituloFicha: string | undefined,
  nombreProducto: string | undefined,
): { contra: string; origen: "ficha" | "nombre" } | null {
  const claves = palabrasClave(tituloCodigo || "");
  if (claves.length === 0) return null;
  const ficha = (tituloFicha || "").trim();
  const contra = ficha || (nombreProducto || "").trim();
  if (!contra) return null;
  if (puntuarTitulo(claves, contra) >= UMBRAL_ENLACE_AUTOMATICO) return null;
  return { contra: contra.replace(/\s+/g, " "), origen: ficha ? "ficha" : "nombre" };
}

/** Ordena por afinidad de palabras clave con la consulta; si ninguna
 *  coincide, cae al filtro clásico por subcadena. */
export function ordenarFichasPorConsulta<T extends CandidataFicha>(fichas: T[], consulta: string): T[] {
  const claves = palabrasClave(consulta);
  if (claves.length === 0) return fichas;
  const peso = pesosPorRareza(fichas.map((f) => f.titulo));
  const puntuadas = fichas
    .map((f) => ({ f, p: puntuarTitulo(claves, f.titulo, peso) }))
    .filter((x) => x.p > 0)
    .sort((a, b) => b.p - a.p || a.f.titulo.length - b.f.titulo.length);
  if (puntuadas.length > 0) return puntuadas.map((x) => x.f);
  const q = normalizarTexto(consulta);
  return fichas.filter((f) => normalizarTexto(f.titulo).includes(q));
}

/** Nombre de archivo seguro a partir de un título ("MANI NATURAL 500g" → "MANI_NATURAL_500g"). */
export function nombreArchivoDesdeTitulo(titulo: string): string {
  return (titulo || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^\w\-]+/g, "")
    .slice(0, 60);
}
