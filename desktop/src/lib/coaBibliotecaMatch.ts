/**
 * Empareja el nombre de materia prima detectado en un COA con PDFs de la biblioteca.
 * Evita asociaciones cruzadas (p. ej. Eritritol → Celulosa / Eritrosina) por "parecido" débil.
 */

export interface ArchivoBibliotecaMatch {
  nombre: string;
  categoria?: "ft" | "completo";
}

/** Pares EN/ES u ortografías equivalentes (misma sustancia). */
const SINONIMOS: ReadonlyArray<readonly [string, string]> = [
  ["eritritol", "erythritol"],
  ["celulosa", "cellulose"],
  ["niacinamida", "niacinamide"],
  ["glicerina", "glycerin"],
  ["glicerina", "glycerine"],
  ["hialuronico", "hyaluronic"],
  ["ascorbico", "ascorbic"],
  ["retinol", "retinol"],
  ["aloe", "aloe"],
  ["urea", "urea"],
  ["inulina", "inulin"],
  ["xilitol", "xylitol"],
  ["sorbitol", "sorbitol"],
  ["maltitol", "maltitol"],
  ["alulosa", "allulose"],
  ["alulosa", "psicose"],
  ["eritrosina", "erythrosine"],
];

/**
 * Sustancias distintas que NO deben asociarse aunque el OCR o el catálogo las mezclen.
 * Clave = token canónico; valor = set de tokens canónicos incompatibles.
 */
const CONFLICTOS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["eritritol", new Set(["celulosa", "eritrosina", "xilitol", "sorbitol", "maltitol", "alulosa"])],
  ["celulosa", new Set(["eritritol", "eritrosina", "alulosa"])],
  ["eritrosina", new Set(["eritritol", "celulosa", "xilitol"])],
  ["xilitol", new Set(["eritritol", "sorbitol", "maltitol"])],
  ["ascorbico", new Set(["citrico", "citric"])],
]);

const STOP_TOKENS = new Set([
  "colorante",
  "color",
  "acid",
  "acido",
  "sodium",
  "sodico",
  "potassium",
  "potasico",
  "anhydrous",
  "anhidro",
]);

const CANON = new Map<string, string>();
for (const [a, b] of SINONIMOS) {
  const root = a.length <= b.length ? a : b;
  CANON.set(a, root);
  CANON.set(b, root);
}

function canonToken(t: string): string {
  return CANON.get(t) || t;
}

export function normalizarTitulo(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\.(pdf|docx)$/i, "")
    .replace(
      /\b(ft|coa|sds|tds|completo|ficha tecnica|certificado de analisis|hoja de datos|msds|usp|bp|nf|fcc|ep|pharma|pharmaceutical|cosmetic|cosmetico|food|grade|grado|anhydrous|anhidro|monohydrate|monohidrato|powder|polvo|crystal|cristales|cristal|crystalline|microcrystalline|microcristalina|microcristalino)\b/gi,
      " ",
    )
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function tokensTitulo(s: string): string[] {
  return normalizarTitulo(s)
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .map(canonToken);
}

/** Token de sustancia principal: el más largo, ignorando relleno (colorante, ácido…). */
export function tokenSustanciaPrincipal(tokens: string[]): string | null {
  const utiles = tokens.filter((t) => !STOP_TOKENS.has(t) && t.length >= 4);
  if (!utiles.length) return null;
  return utiles.reduce((a, b) => (b.length > a.length ? b : a));
}

export function sustanciasEnConflicto(a: string, b: string): boolean {
  const aa = canonToken(a);
  const bb = canonToken(b);
  if (aa === bb) return false;
  return Boolean(CONFLICTOS.get(aa)?.has(bb) || CONFLICTOS.get(bb)?.has(aa));
}

export function tokenCerca(a: string, b: string): boolean {
  const aa = canonToken(a);
  const bb = canonToken(b);
  if (aa === bb) return true;
  if (sustanciasEnConflicto(aa, bb)) return false;

  const [short, long] = aa.length <= bb.length ? [aa, bb] : [bb, aa];
  // Contención solo si el token corto es casi todo el largo (evita falsos positivos)
  if (short.length >= 5 && long.includes(short) && short.length / long.length >= 0.7) {
    return true;
  }

  // Variantes EN/ES: prefijo largo + longitudes parecidas (niacinamide/niacinamida)
  const n = Math.min(aa.length, bb.length);
  if (
    n >= 6 &&
    aa.slice(0, 6) === bb.slice(0, 6) &&
    Math.abs(aa.length - bb.length) <= 3
  ) {
    return true;
  }
  return false;
}

/** La sustancia principal del COA debe coincidir con la del PDF (no basta un token secundario). */
export function sustanciasCompatibles(nombreProducto: string, tituloArchivo: string): boolean {
  const qTokens = tokensTitulo(nombreProducto);
  const cTokens = tokensTitulo(tituloArchivo);
  const qPrimary = tokenSustanciaPrincipal(qTokens);
  const cPrimary = tokenSustanciaPrincipal(cTokens);
  if (!qPrimary || !cPrimary) return false;
  if (sustanciasEnConflicto(qPrimary, cPrimary)) return false;
  if (!tokenCerca(qPrimary, cPrimary)) return false;
  // Si el nombre trae otra sustancia conflictiva distinta al PDF, rechazar
  for (const t of qTokens) {
    if (sustanciasEnConflicto(t, cPrimary) && !tokenCerca(t, cPrimary)) return false;
  }
  return true;
}

const SCORE_MINIMO_ASOCIACION = 55;

/** Devuelve el mejor documento de biblioteca para el nombre de materia prima detectado. */
export function encontrarDocumentoPorMateriaPrima(
  archivos: ArchivoBibliotecaMatch[],
  nombreProducto: string,
): { archivo: ArchivoBibliotecaMatch; score: number } | null {
  const query = normalizarTitulo(nombreProducto);
  if (!query) return null;
  const qTokens = tokensTitulo(nombreProducto);
  if (!qTokens.length) return null;
  const qPrimary = tokenSustanciaPrincipal(qTokens);
  if (!qPrimary) return null;

  let best: { archivo: ArchivoBibliotecaMatch; score: number } | null = null;

  for (const a of archivos) {
    if (!a.nombre.toLowerCase().endsWith(".pdf")) continue;
    const tituloArchivo = a.nombre.replace(/\.(pdf|docx)$/i, "");
    if (!sustanciasCompatibles(nombreProducto, tituloArchivo)) continue;

    const cand = normalizarTitulo(tituloArchivo);
    if (!cand) continue;

    let score = 0;
    const qCanon = qTokens.join(" ");
    const cTokens = tokensTitulo(tituloArchivo);
    const cCanon = cTokens.join(" ");
    if (cand === query || (qCanon && qCanon === cCanon)) score = 100;
    else if (cand.includes(query) || query.includes(cand)) {
      // Contención solo si la sustancia principal del más corto sigue siendo la misma
      score = query.length >= 5 && cand.length >= 5 ? 88 : 40;
    } else {
      if (!cTokens.length) continue;
      const overlap = qTokens.filter((t) => cTokens.some((c) => tokenCerca(t, c))).length;
      if (overlap === 0) continue;
      const denom = Math.max(qTokens.length, 1);
      score = Math.round((overlap / denom) * 80);
      if (overlap >= Math.min(qTokens.length, 2) && overlap / qTokens.length >= 0.6) {
        score = Math.max(score, 55);
      } else if (overlap >= 1 && qTokens.length === 1) {
        const q = qTokens[0];
        const fuerte = cTokens.some(
          (c) => c === q || (c.length >= 6 && q.length >= 6 && tokenCerca(c, q)),
        );
        score = fuerte ? Math.max(score, 70) : Math.min(score, 40);
      }
    }

    if (a.categoria === "completo") score += 3;

    if (!best || score > best.score) best = { archivo: a, score };
  }

  if (!best || best.score < SCORE_MINIMO_ASOCIACION) return null;
  return best;
}

/** Resuelve un nombre sugerido por la IA contra la lista real de PDFs (solo exacto o fuzzy fuerte). */
export function resolverArchivoBiblioteca(
  archivos: ArchivoBibliotecaMatch[],
  sugerido: string,
): ArchivoBibliotecaMatch | null {
  const s = sugerido.trim();
  if (!s) return null;
  const low = s.toLowerCase().replace(/\.pdf$/i, "");
  const exact = archivos.find((a) => {
    const n = a.nombre.toLowerCase();
    return n === s.toLowerCase() || n.replace(/\.pdf$/i, "") === low;
  });
  if (exact) return exact;
  return encontrarDocumentoPorMateriaPrima(archivos, s)?.archivo ?? null;
}

/**
 * Decide qué PDF abrir tras escanear un COA.
 * La sugerencia de Gemini solo se usa si coincide con el nombre de materia prima detectado.
 */
export function decidirAsociacionCoa(
  archivos: ArchivoBibliotecaMatch[],
  nombreProducto: string,
  sugeridoIa: string,
): { archivo: ArchivoBibliotecaMatch; score: number; fuente: "ia+nombre" | "nombre" } | null {
  const nombre = nombreProducto.trim();
  const sugerido = sugeridoIa.trim();

  if (sugerido && nombre) {
    const resuelto = resolverArchivoBiblioteca(archivos, sugerido);
    if (resuelto && sustanciasCompatibles(nombre, resuelto.nombre)) {
      const contraNombre = encontrarDocumentoPorMateriaPrima([resuelto], nombre);
      if (contraNombre && contraNombre.score >= SCORE_MINIMO_ASOCIACION) {
        return {
          archivo: resuelto,
          score: Math.max(contraNombre.score, 90),
          fuente: "ia+nombre",
        };
      }
    }
  }

  if (nombre) {
    const hit = encontrarDocumentoPorMateriaPrima(archivos, nombre);
    if (hit) return { archivo: hit.archivo, score: hit.score, fuente: "nombre" };
  }

  // Sin nombre legible: no asociar por catálogo solo (evita “el más cercano” incorrecto)
  return null;
}
