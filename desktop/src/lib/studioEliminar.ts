/**
 * Eliminar en Studio web = ocultar el bloque (hidden).
 * Así desaparece en lienzo y en el sitio (display:none), y Ctrl+Z lo devuelve.
 */

import {
  baseCtaStudio,
  ORDEN_CLASICO,
  ORDEN_DEFAULT,
  type LayoutNodo,
  type WebLayout,
} from "./webLayoutStudio";

const SECCIONES = new Set<string>([...ORDEN_DEFAULT, ...ORDEN_CLASICO]);

export function esSeccionStudio(id: string): boolean {
  return SECCIONES.has(id);
}

export function grupoIndexado(id: string): { prefix: string; index: number } | null {
  let m = /^hero\.kit\.(\d+)/.exec(id);
  if (m) return { prefix: "hero.kit.", index: +m[1] };
  m = /^features\.(\d+)/.exec(id);
  if (m) return { prefix: "features.", index: +m[1] };
  m = /^metricas\.(\d+)/.exec(id);
  if (m) return { prefix: "metricas.", index: +m[1] };
  m = /^pilares\.(\d+)/.exec(id);
  if (m) return { prefix: "pilares.", index: +m[1] };
  m = /^badge\.(\d+)/.exec(id);
  if (m) return { prefix: "badge.", index: +m[1] };
  m = /^trazabilidad\.paso\.(\d+)/.exec(id);
  if (m) return { prefix: "trazabilidad.paso.", index: +m[1] };
  return null;
}

const HIJOS: Record<string, string[]> = {
  "hero.kit.": ["", ".titulo", ".texto", ".valor", ".icono"],
  "features.": ["", ".titulo", ".texto", ".icono"],
  "metricas.": [".valor", ".etiqueta"],
  "pilares.": ["", ".titulo", ".texto", ".icono"],
  "badge.": [""],
  "trazabilidad.paso.": ["", ".titulo", ".texto", ".icono"],
};

/** Ids que hay que apagar para que el bloque entero desaparezca. */
export function idsAOcultar(ids: string[]): string[] {
  const out = new Set<string>();
  for (const id of ids.filter(Boolean)) {
    const g = grupoIndexado(id);
    if (g) {
      for (const suf of HIJOS[g.prefix] || [""]) {
        out.add(`${g.prefix}${g.index}${suf}`);
      }
      continue;
    }
    const cta = baseCtaStudio(id);
    if (cta && id === cta) {
      out.add(cta);
      out.add(`${cta}.texto`);
      out.add(`${cta}.icono`);
      continue;
    }
    out.add(id);
  }
  return [...out];
}

function marcarHidden(
  nodos: Record<string, LayoutNodo>,
  id: string,
): Record<string, LayoutNodo> {
  return { ...nodos, [id]: { ...(nodos[id] || {}), hidden: true } };
}

export function aplicarEliminacionStudio(
  ids: string[],
  layout: WebLayout | undefined | null,
  content: Record<string, unknown>,
): WebLayout {
  const base: WebLayout = layout && Array.isArray(layout.orden)
    ? { orden: [...layout.orden], nodos: { ...(layout.nodos || {}) } }
    : { orden: [], nodos: {} };

  const unique = idsAOcultar(ids);
  if (!unique.length) return base;

  let nodos = { ...base.nodos };
  const prevSec =
    content.secciones && typeof content.secciones === "object"
      ? { ...(content.secciones as Record<string, boolean>) }
      : {};

  for (const id of unique) {
    nodos = marcarHidden(nodos, id);
    if (esSeccionStudio(id)) prevSec[id] = false;
  }
  if (Object.keys(prevSec).length) content.secciones = prevSec;

  return { orden: base.orden, nodos };
}

export function aplicarRestaurarHoja(
  sid: string,
  layout: WebLayout,
  content: Record<string, unknown>,
): WebLayout {
  if (!esSeccionStudio(sid)) return layout;
  const prevSec =
    content.secciones && typeof content.secciones === "object"
      ? { ...(content.secciones as Record<string, boolean>) }
      : {};
  prevSec[sid] = true;
  content.secciones = prevSec;
  const prev = { ...(layout.nodos[sid] || {}) };
  delete prev.hidden;
  const nodos = { ...layout.nodos };
  if (Object.keys(prev).length) nodos[sid] = prev;
  else delete nodos[sid];
  return { orden: layout.orden, nodos };
}

export function hojaOculta(
  sid: string,
  layout: WebLayout,
  secciones?: Record<string, boolean> | null,
): boolean {
  if (layout.nodos[sid]?.hidden === true) return true;
  if (secciones && secciones[sid] === false) return true;
  return false;
}
