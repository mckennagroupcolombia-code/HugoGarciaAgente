/**
 * Modelo del Studio visual (lienzo) para el home Pureza.
 * Posición/escala viven en layout.nodos; el copy sigue en config.pureza.
 */

import type { CSSProperties } from "react";

export interface LayoutNodo {
  dx?: number;
  dy?: number;
  /** Escala visual 0.5–2.5 (agrandar / reducir). */
  scale?: number;
  fontSize?: number;
  /** Solo iconos Phosphor (sin prefijo ph-). */
  icono?: string;
  hidden?: boolean;
}

export interface WebLayout {
  orden: string[];
  nodos: Record<string, LayoutNodo>;
}

export const ORDEN_DEFAULT = [
  "hero",
  "metricas",
  "trazabilidad",
  "pilares",
  "categorias",
  "destacados",
  "cta",
] as const;

export const ICONOS_STUDIO = [
  "flask",
  "seal-check",
  "shield-check",
  "globe-hemisphere-west",
  "package",
  "truck",
  "path",
  "chats-circle",
  "star",
  "scales",
  "storefront",
  "whatsapp-logo",
  "file-text",
  "arrow-right",
  "circle",
] as const;

export function layoutDefault(): WebLayout {
  return {
    orden: [...ORDEN_DEFAULT],
    nodos: {},
  };
}

export function ensureLayout(raw: unknown): WebLayout {
  const base = layoutDefault();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<WebLayout>;
  const orden = Array.isArray(r.orden)
    ? r.orden.filter((x): x is string => typeof x === "string")
    : [...base.orden];
  for (const id of ORDEN_DEFAULT) {
    if (!orden.includes(id)) orden.push(id);
  }
  const nodos: Record<string, LayoutNodo> = {};
  if (r.nodos && typeof r.nodos === "object") {
    for (const [k, v] of Object.entries(r.nodos)) {
      if (!v || typeof v !== "object") continue;
      nodos[k] = sanitizeNodo(v as LayoutNodo);
    }
  }
  return { orden, nodos };
}

export function sanitizeNodo(n: LayoutNodo): LayoutNodo {
  const out: LayoutNodo = {};
  if (typeof n.dx === "number" && Number.isFinite(n.dx)) out.dx = Math.round(n.dx);
  if (typeof n.dy === "number" && Number.isFinite(n.dy)) out.dy = Math.round(n.dy);
  if (typeof n.scale === "number" && Number.isFinite(n.scale)) {
    out.scale = Math.min(2.5, Math.max(0.5, Math.round(n.scale * 100) / 100));
  }
  if (typeof n.fontSize === "number" && Number.isFinite(n.fontSize)) {
    out.fontSize = Math.min(96, Math.max(10, Math.round(n.fontSize)));
  }
  if (typeof n.icono === "string" && n.icono.trim()) {
    out.icono = n.icono.trim().replace(/^ph-/, "");
  }
  if (n.hidden === true) out.hidden = true;
  return out;
}

export function nodoOf(layout: WebLayout, id: string): LayoutNodo {
  return layout.nodos[id] || {};
}

export function mergeNodo(layout: WebLayout, id: string, patch: LayoutNodo): WebLayout {
  const prev = layout.nodos[id] || {};
  const next = sanitizeNodo({ ...prev, ...patch });
  const cleaned: LayoutNodo = { ...next };
  if (cleaned.scale === 1) delete cleaned.scale;
  if (cleaned.dx === 0) delete cleaned.dx;
  if (cleaned.dy === 0) delete cleaned.dy;
  const nodos = { ...layout.nodos };
  if (Object.keys(cleaned).length === 0) delete nodos[id];
  else nodos[id] = cleaned;
  return { ...layout, nodos };
}

export function estiloNodo(n: LayoutNodo): CSSProperties {
  const dx = n.dx ?? 0;
  const dy = n.dy ?? 0;
  const scale = n.scale ?? 1;
  const style: CSSProperties = {
    position: "relative",
  };
  if (n.hidden) {
    style.display = "none";
    return style;
  }
  if (dx || dy || scale !== 1) {
    style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
    style.transformOrigin = "top left";
  }
  if (n.fontSize) style.fontSize = n.fontSize;
  return style;
}

export type ContentPath =
  | { type: "string"; path: string[] }
  | { type: "metric"; index: number; field: "valor" | "etiqueta" }
  | { type: "paso"; index: number; field: "titulo" | "texto" | "icono" }
  | { type: "pilar"; index: number; field: "titulo" | "texto" | "icono" }
  | { type: "badge"; index: number }
  | { type: "cta"; field: "titulo" | "texto" | "boton" };

export const NODE_CONTENT: Record<string, ContentPath> = {
  "hero.eyebrow": { type: "string", path: ["hero", "eyebrow"] },
  "hero.titulo": { type: "string", path: ["hero", "titulo"] },
  "hero.titulo_em": { type: "string", path: ["hero", "titulo_em"] },
  "hero.subtitulo": { type: "string", path: ["hero", "subtitulo"] },
  "hero.cta_principal": { type: "string", path: ["hero", "cta_principal"] },
  "hero.cta_secundario": { type: "string", path: ["hero", "cta_secundario"] },
  "trazabilidad.eyebrow": { type: "string", path: ["trazabilidad", "eyebrow"] },
  "trazabilidad.titulo": { type: "string", path: ["trazabilidad", "titulo"] },
  "trazabilidad.texto": { type: "string", path: ["trazabilidad", "texto"] },
  "cta.titulo": { type: "cta", field: "titulo" },
  "cta.texto": { type: "cta", field: "texto" },
  "cta.boton": { type: "cta", field: "boton" },
};

export function contentPathForNode(id: string): ContentPath | null {
  if (NODE_CONTENT[id]) return NODE_CONTENT[id];
  let m = /^metricas\.(\d+)\.(valor|etiqueta)$/.exec(id);
  if (m) return { type: "metric", index: +m[1], field: m[2] as "valor" | "etiqueta" };
  m = /^trazabilidad\.paso\.(\d+)\.(titulo|texto|icono)$/.exec(id);
  if (m) return { type: "paso", index: +m[1], field: m[2] as "titulo" | "texto" | "icono" };
  m = /^pilares\.(\d+)\.(titulo|texto|icono)$/.exec(id);
  if (m) return { type: "pilar", index: +m[1], field: m[2] as "titulo" | "texto" | "icono" };
  m = /^badge\.(\d+)$/.exec(id);
  if (m) return { type: "badge", index: +m[1] };
  return null;
}

export function moverSeccion(orden: string[], id: string, dir: -1 | 1): string[] {
  const i = orden.indexOf(id);
  if (i < 0) return orden;
  const j = i + dir;
  if (j < 0 || j >= orden.length) return orden;
  const next = [...orden];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
