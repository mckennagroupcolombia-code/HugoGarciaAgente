/**
 * Modelo del Studio visual (lienzo) para el home Pureza.
 * Posición/escala/tamaño/efectos viven en layout.nodos; el copy sigue en config.pureza.
 */

import type { CSSProperties } from "react";

export type ShadowPreset = "none" | "sm" | "md" | "lg";

/** Única familia del Studio web / sitio: Montserrat. */
export const STUDIO_FONT_FAMILY = "'Montserrat', system-ui, -apple-system, 'Segoe UI', sans-serif";

export type MontserratWeight = 300 | 400 | 500 | 600 | 700 | 800 | 900;

export const MONTSERRAT_VARIANTES: {
  id: string;
  label: string;
  weight: MontserratWeight;
  italic?: boolean;
}[] = [
  { id: "light", label: "Light", weight: 300 },
  { id: "light-italic", label: "Light Italic", weight: 300, italic: true },
  { id: "regular", label: "Regular", weight: 400 },
  { id: "italic", label: "Italic", weight: 400, italic: true },
  { id: "medium", label: "Medium", weight: 500 },
  { id: "medium-italic", label: "Medium Italic", weight: 500, italic: true },
  { id: "semibold", label: "SemiBold", weight: 600 },
  { id: "semibold-italic", label: "SemiBold Italic", weight: 600, italic: true },
  { id: "bold", label: "Bold", weight: 700 },
  { id: "bold-italic", label: "Bold Italic", weight: 700, italic: true },
  { id: "extrabold", label: "ExtraBold", weight: 800 },
  { id: "extrabold-italic", label: "ExtraBold Italic", weight: 800, italic: true },
  { id: "black", label: "Black", weight: 900 },
  { id: "black-italic", label: "Black Italic", weight: 900, italic: true },
];

export function varianteIdDesdeNodo(n: {
  fontWeight?: number;
  fontItalic?: boolean;
}): string {
  const w = (n.fontWeight ?? 400) as MontserratWeight;
  const it = n.fontItalic === true;
  const hit = MONTSERRAT_VARIANTES.find((v) => v.weight === w && !!v.italic === it);
  if (hit) return hit.id;
  // nearest weight
  let best = MONTSERRAT_VARIANTES[2]; // regular
  let diff = Infinity;
  for (const v of MONTSERRAT_VARIANTES) {
    if (!!v.italic !== it) continue;
    const d = Math.abs(v.weight - w);
    if (d < diff) {
      diff = d;
      best = v;
    }
  }
  return best.id;
}

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function sanitizeHexColor(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!HEX_RE.test(s)) return undefined;
  return s.toLowerCase();
}

export interface LayoutNodo {
  dx?: number;
  dy?: number;
  /** Escala visual 0.5–2.5 (agrandar / reducir). */
  scale?: number;
  fontSize?: number;
  /** Peso Montserrat 300–900. */
  fontWeight?: MontserratWeight;
  /** Cursiva Montserrat. */
  fontItalic?: boolean;
  /** Color de texto (#hex). */
  color?: string;
  /** Relleno / fondo de caja (#hex). */
  background?: string;
  /** Color del trazo / borde (#hex). */
  borderColor?: string;
  /** Grosor del trazo en px. */
  borderWidth?: number;
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
  /**
   * Animación de entrada / bucle.
   * none omitido; fade* / slide* / zoom una vez; pulse / float en bucle.
   */
  animation?: AnimPreset;
  /** Duración en segundos (0.2–3). */
  animDuration?: number;
  /** Delay en segundos (0–2). */
  animDelay?: number;
  /** Solo iconos Phosphor (sin prefijo ph-). */
  icono?: string;
  hidden?: boolean;
}

export type AnimPreset =
  | "none"
  | "fadeIn"
  | "fadeUp"
  | "fadeDown"
  | "slideLeft"
  | "slideRight"
  | "zoomIn"
  | "pulse"
  | "float";

export const ANIM_OPTS: { id: AnimPreset; label: string; loop?: boolean }[] = [
  { id: "none", label: "Ninguna" },
  { id: "fadeIn", label: "Aparecer" },
  { id: "fadeUp", label: "Subir" },
  { id: "fadeDown", label: "Bajar" },
  { id: "slideLeft", label: "Desde izq." },
  { id: "slideRight", label: "Desde der." },
  { id: "zoomIn", label: "Zoom" },
  { id: "pulse", label: "Pulso", loop: true },
  { id: "float", label: "Flotar", loop: true },
];

const ANIM_KEYFRAMES: Record<Exclude<AnimPreset, "none">, string> = {
  fadeIn: "mck-studio-fade-in",
  fadeUp: "mck-studio-fade-up",
  fadeDown: "mck-studio-fade-down",
  slideLeft: "mck-studio-slide-left",
  slideRight: "mck-studio-slide-right",
  zoomIn: "mck-studio-zoom-in",
  pulse: "mck-studio-pulse",
  float: "mck-studio-float",
};

const ANIM_LOOP: Partial<Record<AnimPreset, boolean>> = {
  pulse: true,
  float: true,
};

/** CSS animation shorthand for a nodo (empty if none). */
export function animacionCss(n: LayoutNodo): string | undefined {
  const preset = n.animation;
  if (!preset || preset === "none" || !(preset in ANIM_KEYFRAMES)) return undefined;
  const name = ANIM_KEYFRAMES[preset as Exclude<AnimPreset, "none">];
  const dur = typeof n.animDuration === "number" ? n.animDuration : ANIM_LOOP[preset] ? 2.2 : 0.7;
  const delay = typeof n.animDelay === "number" ? n.animDelay : 0;
  const iter = ANIM_LOOP[preset] ? "infinite" : "1";
  const fill = ANIM_LOOP[preset] ? "none" : "both";
  const ease = ANIM_LOOP[preset] ? "ease-in-out" : "ease-out";
  return `${name} ${dur}s ${ease} ${delay}s ${iter} ${fill}`;
}

/** Keyframes + util — inyectar una vez en panel y sitio. */
export const STUDIO_ANIM_CSS = `
@keyframes mck-studio-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes mck-studio-fade-up { from { opacity: 0; transform: translateY(28px); } to { opacity: 1; transform: translateY(0); } }
@keyframes mck-studio-fade-down { from { opacity: 0; transform: translateY(-28px); } to { opacity: 1; transform: translateY(0); } }
@keyframes mck-studio-slide-left { from { opacity: 0; transform: translateX(-36px); } to { opacity: 1; transform: translateX(0); } }
@keyframes mck-studio-slide-right { from { opacity: 0; transform: translateX(36px); } to { opacity: 1; transform: translateX(0); } }
@keyframes mck-studio-zoom-in { from { opacity: 0; transform: scale(.86); } to { opacity: 1; transform: scale(1); } }
@keyframes mck-studio-pulse { 0%,100% { opacity: 1; } 50% { opacity: .55; } }
@keyframes mck-studio-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
@media (prefers-reduced-motion: reduce) {
  [style*="mck-studio-"] { animation: none !important; }
}
`;

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

export const ORDEN_CLASICO = [
  "hero",
  "features",
  "categorias",
  "destacados",
  "cta",
] as const;

export function layoutDefault(): WebLayout {
  return {
    orden: [...ORDEN_DEFAULT],
    nodos: {},
  };
}

export function layoutClasicoDefault(): WebLayout {
  return {
    orden: [...ORDEN_CLASICO],
    nodos: {},
  };
}

export function ensureLayout(raw: unknown): WebLayout {
  return ensureLayoutWithOrden(raw, ORDEN_DEFAULT);
}

export function ensureLayoutClasico(raw: unknown): WebLayout {
  return ensureLayoutWithOrden(raw, ORDEN_CLASICO);
}

function ensureLayoutWithOrden(
  raw: unknown,
  ordenDefault: readonly string[],
): WebLayout {
  const base = { orden: [...ordenDefault], nodos: {} as Record<string, LayoutNodo> };
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<WebLayout>;
  const orden = Array.isArray(r.orden)
    ? r.orden.filter((x): x is string => typeof x === "string")
    : [...base.orden];
  for (const id of ordenDefault) {
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
  "certificate",
  "headset",
  "clock",
] as const;

export const SHADOW_CSS: Record<ShadowPreset, string> = {
  none: "none",
  sm: "0 1px 3px rgba(0,0,0,.12), 0 1px 2px rgba(0,0,0,.08)",
  md: "0 6px 16px rgba(0,0,0,.14), 0 2px 6px rgba(0,0,0,.08)",
  lg: "0 16px 40px rgba(0,0,0,.18), 0 4px 12px rgba(0,0,0,.1)",
};

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
  if (
    n.fontWeight === 300 ||
    n.fontWeight === 400 ||
    n.fontWeight === 500 ||
    n.fontWeight === 600 ||
    n.fontWeight === 700 ||
    n.fontWeight === 800 ||
    n.fontWeight === 900
  ) {
    out.fontWeight = n.fontWeight;
  }
  if (n.fontItalic === true) out.fontItalic = true;
  const color = sanitizeHexColor(n.color);
  if (color) out.color = color;
  const background = sanitizeHexColor(n.background);
  if (background) out.background = background;
  const borderColor = sanitizeHexColor(n.borderColor);
  if (borderColor) out.borderColor = borderColor;
  if (typeof n.borderWidth === "number" && Number.isFinite(n.borderWidth)) {
    out.borderWidth = Math.round(clampNum(n.borderWidth, 0, 24));
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
  if (
    n.animation === "fadeIn" ||
    n.animation === "fadeUp" ||
    n.animation === "fadeDown" ||
    n.animation === "slideLeft" ||
    n.animation === "slideRight" ||
    n.animation === "zoomIn" ||
    n.animation === "pulse" ||
    n.animation === "float"
  ) {
    out.animation = n.animation;
  }
  if (typeof n.animDuration === "number" && Number.isFinite(n.animDuration)) {
    out.animDuration = Math.round(clampNum(n.animDuration, 0.2, 3) * 100) / 100;
  }
  if (typeof n.animDelay === "number" && Number.isFinite(n.animDelay)) {
    out.animDelay = Math.round(clampNum(n.animDelay, 0, 2) * 100) / 100;
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

export function mergeNodos(layout: WebLayout, ids: string[], patch: LayoutNodo): WebLayout {
  let next = layout;
  for (const id of ids) {
    next = mergeNodo(next, id, patch);
  }
  return next;
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
  if (cleaned.borderWidth === 0) delete cleaned.borderWidth;
  if (cleaned.shadow === "none") delete cleaned.shadow;
  if (cleaned.fontWeight === 400 && !cleaned.fontItalic) delete cleaned.fontWeight;
  if (cleaned.animation === "none") delete cleaned.animation;
  if (cleaned.animDuration === 0.7) delete cleaned.animDuration;
  if (cleaned.animDelay === 0) delete cleaned.animDelay;
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
  if (n.fontWeight || n.fontItalic) {
    style.fontFamily = STUDIO_FONT_FAMILY;
    if (n.fontWeight) style.fontWeight = n.fontWeight;
    if (n.fontItalic) style.fontStyle = "italic";
  }
  if (n.color) style.color = n.color;
  if (n.background) style.background = n.background;
  if (n.borderColor || (typeof n.borderWidth === "number" && n.borderWidth > 0)) {
    style.borderStyle = "solid";
    style.borderWidth = n.borderWidth ?? 1;
    style.borderColor = n.borderColor || "currentColor";
    style.boxSizing = "border-box";
  }
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
  const anim = animacionCss(n);
  if (anim) style.animation = anim;
  return style;
}

/**
 * Caja de texto del lienzo: se ajusta al glifo (no estira a todo el flex/grid).
 * Si el nodo ya tiene ancho guardado (resize manual), se respeta.
 */
export function estiloFitTexto(
  n: LayoutNodo,
  opts?: { className?: string; enabled?: boolean },
): CSSProperties {
  const core = estiloNodo(n);
  if (opts?.enabled === false || n.hidden) return core;
  if (n.width) return core;
  const hasMax = /\bmax-w-/.test(opts?.className || "");
  return {
    display: "inline-block",
    width: "fit-content",
    maxWidth: hasMax ? undefined : "100%",
    height: n.height ? core.height : "fit-content",
    alignSelf: "flex-start",
    justifySelf: "start",
    verticalAlign: "top",
    ...core,
  };
}

export type ContentPath =
  | { type: "string"; path: string[] }
  | { type: "metric"; index: number; field: "valor" | "etiqueta" }
  | { type: "paso"; index: number; field: "titulo" | "texto" | "icono" }
  | { type: "pilar"; index: number; field: "titulo" | "texto" | "icono" }
  | { type: "badge"; index: number }
  | { type: "cta"; field: "titulo" | "texto" | "boton" }
  | { type: "feature"; index: number; field: "titulo" | "texto" | "icono" }
  | { type: "kit"; index: number; field: "titulo" | "texto" | "valor" | "icono" }
  | { type: "section_hdr"; section: string; field: string }
  | { type: "cta_clasico"; field: string };

export const NODE_CONTENT: Record<string, ContentPath> = {
  "hero.eyebrow": { type: "string", path: ["hero", "eyebrow"] },
  "hero.titulo": { type: "string", path: ["hero", "titulo"] },
  "hero.titulo_em": { type: "string", path: ["hero", "titulo_em"] },
  "hero.subtitulo": { type: "string", path: ["hero", "subtitulo"] },
  "hero.cta_principal": { type: "string", path: ["hero", "cta_principal"] },
  "hero.cta_secundario": { type: "string", path: ["hero", "cta_secundario"] },
  "hero.badge": { type: "string", path: ["hero", "badge"] },
  "hero.titulo_l1": { type: "string", path: ["hero", "titulo_l1"] },
  "hero.titulo_l2": { type: "string", path: ["hero", "titulo_l2"] },
  "hero.kit_label": { type: "string", path: ["hero", "kit_label"] },
  "categorias.eyebrow": { type: "section_hdr", section: "categorias", field: "eyebrow" },
  "categorias.titulo": { type: "section_hdr", section: "categorias", field: "titulo" },
  "categorias.titulo_em": { type: "section_hdr", section: "categorias", field: "titulo_em" },
  "categorias.texto": { type: "section_hdr", section: "categorias", field: "texto" },
  "destacados.eyebrow": { type: "section_hdr", section: "destacados", field: "eyebrow" },
  "destacados.titulo": { type: "section_hdr", section: "destacados", field: "titulo" },
  "destacados.titulo_em": { type: "section_hdr", section: "destacados", field: "titulo_em" },
  "destacados.texto": { type: "section_hdr", section: "destacados", field: "texto" },
  "cta.eyebrow": { type: "cta_clasico", field: "eyebrow" },
  "cta.titulo_em": { type: "cta_clasico", field: "titulo_em" },
  "cta.boton_wa": { type: "cta_clasico", field: "boton_wa" },
  "cta.boton_contacto": { type: "cta_clasico", field: "boton_contacto" },
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
  m = /^features\.(\d+)\.(titulo|texto|icono)$/.exec(id);
  if (m) return { type: "feature", index: +m[1], field: m[2] as "titulo" | "texto" | "icono" };
  m = /^hero\.kit\.(\d+)\.(titulo|texto|valor|icono)$/.exec(id);
  if (m) return { type: "kit", index: +m[1], field: m[2] as "titulo" | "texto" | "valor" | "icono" };
  return null;
}

/** Aplica un valor de texto/icono según ContentPath sobre un draft de tema (pureza o clasico). */
export function applyContentPath(draft: Record<string, unknown>, path: ContentPath, value: string): void {
  if (path.type === "string") {
    let cur: Record<string, unknown> = draft;
    for (let i = 0; i < path.path.length - 1; i++) {
      cur = cur[path.path[i]] as Record<string, unknown>;
    }
    cur[path.path[path.path.length - 1]] = value;
  } else if (path.type === "metric") {
    const metricas = draft.metricas as { valor: string; etiqueta: string }[];
    metricas[path.index][path.field] = value;
  } else if (path.type === "paso") {
    const pasos = (draft.trazabilidad as { pasos: { titulo: string; texto: string; icono?: string }[] }).pasos;
    if (path.field === "icono") pasos[path.index].icono = value;
    else pasos[path.index][path.field] = value;
  } else if (path.type === "pilar") {
    const pilares = draft.pilares as { titulo: string; texto: string; icono?: string }[];
    if (path.field === "icono") pilares[path.index].icono = value;
    else pilares[path.index][path.field] = value;
  } else if (path.type === "badge") {
    (draft.badges_producto as string[])[path.index] = value;
  } else if (path.type === "cta") {
    (draft.cta as Record<string, string>)[path.field] = value;
  } else if (path.type === "feature") {
    const features = draft.features as { titulo: string; texto: string; icono?: string }[];
    if (path.field === "icono") features[path.index].icono = value;
    else features[path.index][path.field] = value;
  } else if (path.type === "kit") {
    const kit = (draft.hero as { kit: { titulo: string; texto: string; valor: string; icono?: string }[] }).kit;
    if (path.field === "icono") kit[path.index].icono = value;
    else kit[path.index][path.field] = value;
  } else if (path.type === "section_hdr") {
    (draft[path.section] as Record<string, string>)[path.field] = value;
  } else if (path.type === "cta_clasico") {
    (draft.cta as Record<string, string>)[path.field] = value;
  }
}

/** Tokens CSS que el iframe aplica al instante vía postMessage (sin publicar). */
export const RADIO_CSS_VARS: Record<string, string> = {
  pill: "999px",
  soft: "12px",
  sharp: "4px",
};

export const DENSIDAD_CSS_VARS: Record<
  string,
  { section_y: string; hero_pad: string; card_radius: string }
> = {
  compacta: { section_y: "48px", hero_pad: "56px 24px 40px", card_radius: "12px" },
  normal: { section_y: "72px", hero_pad: "84px 24px 64px", card_radius: "16px" },
  amplia: { section_y: "96px", hero_pad: "104px 24px 80px", card_radius: "20px" },
};

export function studioLivePayload(
  diseno: { radio: string; densidad: string; tagline: string },
  colores: Record<string, string>,
) {
  const dens = DENSIDAD_CSS_VARS[diseno.densidad] || DENSIDAD_CSS_VARS.normal;
  return {
    type: "mck-studio-live" as const,
    css: {
      "--studio-font-display": STUDIO_FONT_FAMILY,
      "--studio-radio-btn": RADIO_CSS_VARS[diseno.radio] || RADIO_CSS_VARS.pill,
      "--studio-section-y": dens.section_y,
      "--studio-hero-pad": dens.hero_pad,
      "--studio-card-radius": dens.card_radius,
      "--pz-acento": colores.acento || "#0c6069",
      "--pz-acento-oscuro": colores.acento_oscuro || "#04353b",
      "--pz-fondo": colores.fondo || "#f8f6f1",
      "--pz-tinta": colores.tinta || "#1c2b2a",
      "--pz-destacado": colores.destacado || "#b9862f",
    },
    tagline: diseno.tagline || "Proveemos a tus ideas",
  };
}

/** Firma de lo que exige recargar el iframe (textos/lienzo). Tokens van por postMessage. */
export function estructuraPreviewKey(cfg: {
  clasico: unknown;
  layout: unknown;
  layout_clasico: unknown;
  pureza: { colores?: unknown };
}): string {
  const { colores: _colores, ...purezaSinColor } = cfg.pureza;
  return JSON.stringify({
    clasico: cfg.clasico,
    layout: cfg.layout,
    layout_clasico: cfg.layout_clasico,
    pureza: purezaSinColor,
  });
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
