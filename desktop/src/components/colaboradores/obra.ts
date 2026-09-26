/**
 * La obra (26-sep-2026): en la vista «Edificio» de Colaboradores cada proyecto es un edificio y
 * cada caja un PISO que se construye a medida que se llena — terreno → cimientos → estructura →
 * fachada → terminado. Completar el paso (cómo, dónde, por qué, tiempo, dinero, fotos…) es
 * literalmente construir su piso.
 *
 * ⚠️ La MISMA regla vive en app/services/colaboradores.py (`piezas_obra` / `etapa_obra`), que la usa
 * para la calle de proyectos; tests/test_colaboradores.py fija los casos. Si cambia una, cambia la otra.
 */

export const ETAPAS_OBRA = ["Terreno", "Cimientos", "Estructura", "Fachada", "Terminado"] as const;

type NodoObra = {
  id: string; tipo: string; x: number; y: number;
  variables?: { como?: string; donde?: string; porque?: string };
  tiempo_min?: number; costo?: unknown; precio?: unknown; imagen?: string; adjuntos?: unknown[];
  datos?: unknown[]; consecuencias?: unknown[];
  asunto?: string; propuestas?: unknown[]; votos?: Record<string, string>; resuelto?: unknown;
  sku?: string; componentes?: unknown[]; url?: string; plataforma?: string;
};

/** Piezas que el piso tiene, las que le faltan y cuántas hacen falta para terminarlo. */
export function piezasObra(n: NodoObra): { tiene: string[]; faltan: string[]; meta: number } {
  const v = n.variables ?? {};
  const evidencia = Boolean(n.imagen || n.adjuntos?.length);
  let pares: [string, boolean][];
  let meta: number;
  if (n.tipo === "consenso") {
    pares = [["asunto", Boolean(n.asunto)], ["propuestas", (n.propuestas?.length ?? 0) >= 2],
             ["votos", Boolean(n.votos && Object.keys(n.votos).length)], ["decisión", Boolean(n.resuelto)]];
    meta = 4;
  } else if (n.tipo === "producto") {
    pares = [["SKU", Boolean(n.sku)], ["foto", evidencia], ["receta", Boolean(n.componentes?.length)], ["precio", Boolean(n.precio)]];
    meta = 4;
  } else if (n.tipo === "competencia") {
    pares = [["publicación", Boolean(n.url)], ["precio", Boolean(n.precio)], ["foto", evidencia || Boolean(n.plataforma)]];
    meta = 3;
  } else {
    pares = [["cómo", Boolean(v.como)], ["dónde", Boolean(v.donde)], ["por qué", Boolean(v.porque)],
             ["tiempo", n.tiempo_min != null], ["dinero", Boolean(n.costo || n.precio)], ["fotos", evidencia],
             ["detalle", Boolean(n.datos?.length || n.consecuencias?.length)]];
    meta = 5;
  }
  return { tiene: pares.filter(([, ok]) => ok).map(([k]) => k), faltan: pares.filter(([, ok]) => !ok).map(([k]) => k), meta };
}

/** 0 terreno · 1 cimientos · 2 estructura · 3 fachada · 4 terminado. */
export function etapaObra(n: NodoObra): number {
  const { tiene, meta } = piezasObra(n);
  if (!tiene.length) return 0;
  const frac = Math.min(1, tiene.length / meta);
  let etapa = frac >= 1 ? 4 : frac < 0.4 ? 1 : frac < 0.7 ? 2 : 3;
  if (n.tipo === "consenso" && !n.resuelto) etapa = Math.min(etapa, 3);   // sin decisión no se termina
  return etapa;
}

/**
 * El orden de los pisos: el de las flechas (el primer paso es la planta baja). Orden topológico;
 * a igualdad, de izquierda a derecha y de arriba abajo en el tablero. Lo que quede en un ciclo
 * va al final en ese mismo orden.
 */
export function ordenPisos<T extends NodoObra>(nodos: T[], flechas: { from: string; to: string }[]): T[] {
  const porPos = (a: T, b: T) => a.x - b.x || a.y - b.y;
  const entra = new Map(nodos.map((n) => [n.id, 0]));
  const sale = new Map<string, string[]>();
  for (const f of flechas) {
    if (!entra.has(f.from) || !entra.has(f.to) || f.from === f.to) continue;
    entra.set(f.to, (entra.get(f.to) ?? 0) + 1);
    sale.set(f.from, [...(sale.get(f.from) ?? []), f.to]);
  }
  const porId = new Map(nodos.map((n) => [n.id, n]));
  const listos = nodos.filter((n) => !entra.get(n.id)).sort(porPos);
  const orden: T[] = [];
  const hecho = new Set<string>();
  while (listos.length) {
    const n = listos.shift()!;
    orden.push(n); hecho.add(n.id);
    for (const d of sale.get(n.id) ?? []) {
      entra.set(d, (entra.get(d) ?? 1) - 1);
      if (entra.get(d) === 0) { listos.push(porId.get(d)!); listos.sort(porPos); }
    }
  }
  return [...orden, ...nodos.filter((n) => !hecho.has(n.id)).sort(porPos)];
}
