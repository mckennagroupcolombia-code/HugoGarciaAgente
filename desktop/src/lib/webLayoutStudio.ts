/**
 * Modelo del Studio visual (lienzo) para el home Pureza.
 * Posición/escala/tamaño/efectos viven en layout.nodos; el copy sigue en config.pureza.
 */

import type { CSSProperties } from "react";

export type ShadowPreset = "none" | "sm" | "md" | "lg";

export interface LayoutNodo {
  dx?: number;
  dy?: number;
  /** Escala visual 0.5–2.5 (agrandar / reducir). */
  scale?: number;
  fontSize?: number;
  /** Ancho fijo en px (opcional). */
  width?: number;
  /** Alto fijo en px (opcional). */
  height?: number;
  /** Rotación en grados (−45…45). */
  rotate?: number;
  /** Opacidad 0–1. */
  opacity?: number;
  /** Radio de borde en px. */
  borderRadius?: number;
  shadow?: ShadowPreset;
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

export const SHADOW_CSS: Record<ShadowPreset, string> = {
  none: "none",
  sm: "0 1px 3px rgba(0,0,0,.12), 0 1px 2px rgba(0,0,0,.08)",
  md: "0 6px 16px rgba(0,0,0,.14), 0 2px 6px rgba(0,0,0,.08)",
  lg: "0 16px 40px rgba(0,0,0,.18), 0 4px 12px rgba(0,0,0,.1)",
};

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

function clampNum(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function sanitizeNodo(n: LayoutNodo): LayoutNodo {
  const out: LayoutNodo = {};
  if (typeof n.dx === "number" && Number.isFinite(n.dx)) out.dx = Math.round(n.dx);
  if (typeof n.dy === "number" && Number.isFinite(n.dy)) out.dy = Math.round(n.dy);
  if (typeof n.scale === "number" && Number.isFinite(n.scale)) {
    out.scale = Math.round(clampNum(n.scale, 0.5, 2.5) * 100) / 100;
  }
  if (typeof n.fontSize === "number" && Number.isFinite(n.fontSize)) {
    out.fontSize = Math.round(clampNum(n.fontSize, 10, 96));
  }
  if (typeof n.width === "number" && Number.isFinite(n.width)) {
    out.width = Math.round(clampNum(n.width, 24, 1200));
  }
  if (typeof n.height === "number" && Number.isFinite(n.height)) {
    out.height = Math.round(clampNum(n.height, 16, 800));
  }
  if (typeof n.rotate === "number" && Number.isFinite(n.rotate)) {
    out.rotate = Math.round(clampNum(n.rotate, -45, 45) * 10) / 10;
  }
  if (typeof n.opacity === "number" && Number.isFinite(n.opacity)) {
    out.opacity = Math.round(clampNum(n.opacity, 0.05, 1) * 100) / 100;
  }
  if (typeof n.borderRadius === "number" && Number.isFinite(n.borderRadius)) {
    out.borderRadius = Math.round(clampNum(n.borderRadius, 0, 999));
  }
  if (n.shadow === "sm" || n.shadow === "md" || n.shadow === "lg") {
    out.shadow = n.shadow;
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
  const merged: LayoutNodo = { ...prev, ...patch };
  // Permitir borrar campos opcionales pasando undefined explícito
  for (const key of Object.keys(patch) as (keyof LayoutNodo)[]) {
    if (patch[key] === undefined) delete merged[key];
  }
  const next = sanitizeNodo(merged);
  const cleaned: LayoutNodo = { ...next };
  if (cleaned.scale === 1) delete cleaned.scale;
  if (cleaned.dx === 0) delete cleaned.dx;
  if (cleaned.dy === 0) delete cleaned.dy;
  if (cleaned.rotate === 0) delete cleaned.rotate;
  if (cleaned.opacity === 1) delete cleaned.opacity;
  if (cleaned.borderRadius === 0) delete cleaned.borderRadius;
  if (cleaned.shadow === "none") delete cleaned.shadow;
  const nodos = { ...layout.nodos };
  if (Object.keys(cleaned).length === 0) delete nodos[id];
  else nodos[id] = cleaned;
  return { ...layout, nodos };
}

export function estiloNodo(n: LayoutNodo): CSSProperties {
  const dx = n.dx ?? 0;
  const dy = n.dy ?? 0;
  const scale = n.scale ?? 1;
  const rotate = n.rotate ?? 0;
  const style: CSSProperties = {
    position: "relative",
  };
  if (n.hidden) {
    style.display = "none";
    return style;
  }
  const transforms: string[] = [];
  if (dx || dy) transforms.push(`translate(${dx}px, ${dy}px)`);
  if (rotate) transforms.push(`rotate(${rotate}deg)`);
  if (scale !== 1) transforms.push(`scale(${scale})`);
  if (transforms.length) {
    style.transform = transforms.join(" ");
    style.transformOrigin = "top left";
  }
  if (n.fontSize) style.fontSize = n.fontSize;
  if (n.width) {
    style.width = n.width;
    style.maxWidth = "100%";
  }
  if (n.height) {
    style.height = n.height;
    style.boxSizing = "border-box";
  }
  if (typeof n.opacity === "number") style.opacity = n.opacity;
  if (typeof n.borderRadius === "number") style.borderRadius = n.borderRadius;
  if (n.shadow && n.shadow !== "none") style.boxShadow = SHADOW_CSS[n.shadow];
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
