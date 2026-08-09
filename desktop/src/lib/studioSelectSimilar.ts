/**
 * Selección de objetos similares (tamaño + forma) en Studio web.
 * Compara familia visual del nodo y medidas renderizadas del lienzo.
 */

export type FormaStudio =
  | "seccion"
  | "tarjeta"
  | "icono"
  | "boton"
  | "badge"
  | "titulo"
  | "eyebrow"
  | "cuerpo"
  | "metrica-valor"
  | "metrica-etiqueta"
  | "kit-valor"
  | "otro";

export interface MedidaNodo {
  id: string;
  w: number;
  h: number;
}

export interface StudioSelectOpts {
  additive?: boolean;
}

/** Familia / silueta del objeto según su id de nodo del lienzo. */
export function formaNodo(id: string): FormaStudio {
  if (!id.includes(".")) return "seccion";
  if (id.includes("icono") || /(^|\.)icon$/.test(id)) return "icono";
  if (/(cta_principal|cta_secundario|boton_wa|boton_contacto|(^|\.)boton$)/.test(id)) {
    return "boton";
  }
  if (/^badge\.\d+$/.test(id) || id === "hero.badge") return "badge";
  if (/^metricas\.\d+\.valor$/.test(id)) return "metrica-valor";
  if (/^metricas\.\d+\.etiqueta$/.test(id)) return "metrica-etiqueta";
  if (/^hero\.kit\.\d+\.valor$/.test(id)) return "kit-valor";
  if (/^features\.\d+$/.test(id) || /^hero\.kit\.\d+$/.test(id)) return "tarjeta";
  if (/\.eyebrow$/.test(id) || id.endsWith("kit_label")) return "eyebrow";
  if (/\.titulo(_em|_l1|_l2)?$/.test(id)) return "titulo";
  if (/\.(subtitulo|texto)$/.test(id)) return "cuerpo";
  return "otro";
}

export function tamanoYFormaSimilares(
  a: { w: number; h: number },
  b: { w: number; h: number },
  tolerancia = 0.18,
): boolean {
  if (a.w < 2 || a.h < 2 || b.w < 2 || b.h < 2) return false;
  const dw = Math.abs(a.w - b.w) / Math.max(a.w, b.w);
  const dh = Math.abs(a.h - b.h) / Math.max(a.h, b.h);
  const arA = a.w / a.h;
  const arB = b.w / b.h;
  const dar = Math.abs(arA - arB) / Math.max(arA, arB);
  return dw <= tolerancia && dh <= tolerancia && dar <= tolerancia + 0.08;
}

export function medirNodosEnRaiz(root: ParentNode): MedidaNodo[] {
  const els = root.querySelectorAll<HTMLElement>("[data-node]");
  const out: MedidaNodo[] = [];
  els.forEach((el) => {
    const id = el.getAttribute("data-node");
    if (!id) return;
    const r = el.getBoundingClientRect();
    out.push({ id, w: r.width, h: r.height });
  });
  return out;
}

/** Ids con la misma forma y tamaño parecido al semilla (semilla primero). */
export function seleccionarSimilaresPorTamanoYForma(
  seedId: string,
  medidas: MedidaNodo[],
  tolerancia = 0.18,
): string[] {
  const uniq = new Map<string, MedidaNodo>();
  for (const m of medidas) {
    if (!uniq.has(m.id)) uniq.set(m.id, m);
  }
  const seed = uniq.get(seedId);
  if (!seed) return [seedId];
  const forma = formaNodo(seedId);
  const out: string[] = [];
  for (const m of uniq.values()) {
    if (formaNodo(m.id) !== forma) continue;
    if (!tamanoYFormaSimilares(seed, m, tolerancia)) continue;
    out.push(m.id);
  }
  return [seedId, ...out.filter((id) => id !== seedId)];
}

export function aplicarSeleccionNodo(
  prev: string[],
  id: string | null,
  opts?: StudioSelectOpts,
): string[] {
  if (!id) return [];
  if (opts?.additive) {
    return prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
  }
  if (prev.includes(id) && prev.length > 1) return prev;
  return [id];
}
