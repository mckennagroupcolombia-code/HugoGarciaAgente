/**
 * Smoke: asociación COA ↔ biblioteca (eritritol ≠ celulosa).
 * Ejecuta la lógica real: node --experimental-strip-types o vía assert espejo.
 * Preferir: cd desktop && npx --yes tsx -e "..." no siempre disponible → espejo del TS.
 *
 * node scripts/qa-coa-match.mjs
 */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const matchPath = join(__dirname, "../src/lib/coaBibliotecaMatch.ts");

let decidirAsociacionCoa;
let sustanciasCompatibles;

try {
  // Node 22+ strip-types
  const mod = await import(pathToFileURL(matchPath).href);
  decidirAsociacionCoa = mod.decidirAsociacionCoa;
  sustanciasCompatibles = mod.sustanciasCompatibles;
} catch {
  console.warn("No se pudo importar .ts directo; usando espejo mínimo");
  // Fallback mínimo con conflictos
  const CONFLICTOS = new Map([
    ["eritritol", new Set(["celulosa", "eritrosina"])],
    ["celulosa", new Set(["eritritol", "eritrosina"])],
  ]);
  const SINONIMOS = [
    ["eritritol", "erythritol"],
    ["celulosa", "cellulose"],
  ];
  const CANON = new Map();
  for (const [a, b] of SINONIMOS) {
    const root = a.length <= b.length ? a : b;
    CANON.set(a, root);
    CANON.set(b, root);
  }
  const canon = (t) => CANON.get(t) || t;
  const normalizar = (s) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\.(pdf|docx)$/i, "")
      .replace(
        /\b(ft|coa|sds|tds|completo|crystal|cristales|cristal|crystalline|microcrystalline|microcristalina|microcristalino|powder|polvo)\b/gi,
        " ",
      )
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const tokens = (s) =>
    normalizar(s)
      .split(/\s+/)
      .filter((t) => t.length > 1)
      .map(canon);
  const primary = (toks) => {
    const u = toks.filter((t) => t.length >= 4);
    return u.length ? u.reduce((a, b) => (b.length > a.length ? b : a)) : null;
  };
  const conflicto = (a, b) => {
    const aa = canon(a);
    const bb = canon(b);
    return Boolean(CONFLICTOS.get(aa)?.has(bb) || CONFLICTOS.get(bb)?.has(aa));
  };
  const cerca = (a, b) => {
    const aa = canon(a);
    const bb = canon(b);
    if (aa === bb) return true;
    if (conflicto(aa, bb)) return false;
    return false;
  };
  sustanciasCompatibles = (np, ta) => {
    const qp = primary(tokens(np));
    const cp = primary(tokens(ta));
    if (!qp || !cp || conflicto(qp, cp)) return false;
    return cerca(qp, cp);
  };
  decidirAsociacionCoa = (archivos, nombreProducto, sugeridoIa) => {
    const nombre = nombreProducto.trim();
    const sugerido = sugeridoIa.trim();
    if (sugerido && nombre) {
      const exact = archivos.find((a) => {
        const n = a.nombre.toLowerCase();
        const low = sugerido.toLowerCase().replace(/\.pdf$/i, "");
        return n === sugerido.toLowerCase() || n.replace(/\.pdf$/i, "") === low;
      });
      if (exact && sustanciasCompatibles(nombre, exact.nombre)) {
        return { archivo: exact, score: 95, fuente: "ia+nombre" };
      }
    }
    if (nombre) {
      for (const a of archivos) {
        if (sustanciasCompatibles(nombre, a.nombre)) {
          return { archivo: a, score: 70, fuente: "nombre" };
        }
      }
    }
    return null;
  };
}

const archivos = [
  { nombre: "FT CELULOSA MICROCRISTALINA.pdf", categoria: "ft" },
  { nombre: "FT COLORANTE ERITROSINA.pdf", categoria: "ft" },
  { nombre: "FT COA SDS ERITRITOL.pdf", categoria: "completo" },
];

assert.equal(
  sustanciasCompatibles("Erythritol Crystal", "FT CELULOSA MICROCRISTALINA"),
  false,
);
assert.equal(
  sustanciasCompatibles("Erythritol Crystal", "FT COLORANTE ERITROSINA"),
  false,
);
assert.equal(
  sustanciasCompatibles("Erythritol Crystal", "FT COA SDS ERITRITOL"),
  true,
);

{
  const r = decidirAsociacionCoa(
    archivos,
    "Erythritol Crystal",
    "FT CELULOSA MICROCRISTALINA.pdf",
  );
  assert.equal(r?.archivo.nombre, "FT COA SDS ERITRITOL.pdf");
  assert.equal(r?.fuente, "nombre");
}

{
  const sinEri = archivos.filter((a) => !/eritritol/i.test(a.nombre));
  const r = decidirAsociacionCoa(
    sinEri,
    "Erythritol Crystal",
    "FT CELULOSA MICROCRISTALINA.pdf",
  );
  assert.equal(r, null, "sin PDF de eritritol no debe asociar a celulosa");
}

{
  const r = decidirAsociacionCoa(
    archivos,
    "Erythritol",
    "FT COA SDS ERITRITOL.pdf",
  );
  assert.equal(r?.archivo.nombre, "FT COA SDS ERITRITOL.pdf");
  assert.equal(r?.fuente, "ia+nombre");
}

console.log("OK qa-coa-match: eritritol no se asocia a celulosa");
