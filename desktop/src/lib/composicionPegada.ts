/**
 * Separa en filas una composición pegada como texto: la que llega de un COA del
 * proveedor, de una hoja de cálculo o de una IA. Acepta:
 *  - todo en un solo renglón, sin separadores:
 *    «α-Zingibereno25% – 40%ar-Curcumeno5% – 15%1,8-Cineol1% – 5%…»
 *  - un componente por línea: «Linalool 25 – 38 %», «Linalool: 25%», «Linalool | 25% | 78-70-6»
 *  - columnas de hoja de cálculo (tabuladas)
 *  - letras griegas en notación LaTeX ($\alpha$ → α) y «trazas».
 *
 * Sin LLM: reglas. El porcentaje manda: lo que va antes de cada porcentaje es el
 * componente. Devuelve [] si el texto no parece una lista (se pega normal).
 */

export type FilaPegada = { componente: string; porcentaje: string; cas: string };

const GRIEGAS: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", omega: "ω", mu: "μ", kappa: "κ", lambda: "λ", theta: "θ",
};

/** «$\alpha$-Pineno» → «α-Pineno»; quita los demás restos de LaTeX. */
export function limpiarLatex(texto: string): string {
  return texto
    .replace(/\$?\\(alpha|beta|gamma|delta|epsilon|omega|mu|kappa|lambda|theta)\$?/gi, (_, g: string) => GRIEGAS[g.toLowerCase()] ?? g)
    .replace(/\$/g, "")
    .replace(/\\,/g, " ")
    .replace(/[  ]+/g, " ");
}

const NUM = String.raw`\d+(?:[.,]\d+)?`;
const SIGNO = String.raw`(?:<|>|≤|≥|~|aprox\.?\s*)?`;
/** Porcentaje: rango («25% – 40%», «25 – 40 %», «25 a 40%»), valor («5%», «< 1 %») o «trazas». */
const PORCENTAJE = String.raw`(?:${SIGNO}\s*${NUM}\s*%?\s*(?:[–—-]|a|hasta)\s*${SIGNO}\s*${NUM}\s*%|${SIGNO}\s*${NUM}\s*%|trazas?\b)`;
const CAS = String.raw`\b\d{2,7}-\d{2}-\d\b`;

function limpiarNombre(nombre: string): string {
  return nombre.replace(/^[\s:;,|•·*\-–—]+|[\s:;,|•·*\-–—]+$/g, "").trim();
}

function normalizarPorcentaje(p: string): string {
  return p
    .replace(/\s*([–—-])\s*/g, " – ")
    .replace(/\s*%/g, " %")
    .replace(/\s+/g, " ")
    .replace(/ % – /, " – ") // «25 % – 40 %» → «25 – 40 %»
    .trim();
}

/** Una línea con columnas explícitas (tabulador o «|»). */
function porColumnas(linea: string): FilaPegada | null {
  const partes = linea.split(/\t|\|/).map((x) => x.trim());
  if (partes.length < 2 || !partes[0]) return null;
  const [componente, porcentaje = "", ...resto] = partes;
  const cas = resto.find((x) => new RegExp(CAS).test(x)) ?? "";
  return { componente, porcentaje, cas };
}

/** Texto corrido: cada porcentaje cierra un componente. */
function porPorcentajes(texto: string): FilaPegada[] {
  const re = new RegExp(String.raw`([^\n]*?\S)\s*[:=]?\s*(${PORCENTAJE})(?:\s*\(?\s*(?:CAS\s*)?(${CAS})\)?)?`, "gi");
  const filas: FilaPegada[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) {
    const componente = limpiarNombre(m[1]);
    if (componente) filas.push({ componente, porcentaje: normalizarPorcentaje(m[2]), cas: m[3] ?? "" });
  }
  return filas;
}

export function separarComposicion(textoCrudo: string): FilaPegada[] {
  const texto = limpiarLatex(textoCrudo).trim();
  if (!texto) return [];
  const lineas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // Columnas explícitas en todas las líneas (hoja de cálculo, «Linalool | 25%»).
  if (lineas.every((l) => /\t|\|/.test(l))) {
    const filas = lineas.map(porColumnas).filter((f): f is FilaPegada => Boolean(f));
    if (filas.length) return filas;
  }

  // Línea por línea; una línea sin porcentaje es un componente sin porcentaje («Aceite de cedro»).
  const filas: FilaPegada[] = [];
  for (const linea of lineas) {
    const encontradas = porPorcentajes(linea);
    if (encontradas.length) filas.push(...encontradas);
    else if (lineas.length > 1) filas.push({ componente: limpiarNombre(linea), porcentaje: "", cas: "" });
  }
  // Un solo renglón sin ningún porcentaje no es una lista: que se pegue normal.
  return filas.length >= 2 || filas.some((f) => f.porcentaje) ? filas : [];
}
