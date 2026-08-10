/**
 * Modelo del Studio visual (lienzo) para el home Pureza.
 * Posición/escala/tamaño/efectos viven en layout.nodos; el copy sigue en config.pureza.
 */

import type { CSSProperties } from "react";

export type ShadowPreset = "none" | "sm" | "md" | "lg";

/** Única familia del Studio web / sitio: Montserrat. */
export const STUDIO_FONT_FAMILY = "'Montserrat', system-ui, -apple-system, 'Segoe UI', sans-serif";

export type FuenteNodo = "montserrat" | "system" | "serif" | "mono";

export const FUENTES_NODO: { id: FuenteNodo; label: string; css: string }[] = [
  { id: "montserrat", label: "Montserrat (marca)", css: STUDIO_FONT_FAMILY },
  { id: "system", label: "Sistema", css: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
  { id: "serif", label: "Serif (Georgia)", css: "Georgia, 'Times New Roman', serif" },
  { id: "mono", label: "Monoespaciada", css: "ui-monospace, Consolas, monospace" },
];

export const FUENTE_NODO_CSS: Record<FuenteNodo, string> = {
  montserrat: STUDIO_FONT_FAMILY,
  system: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, Consolas, monospace",
};

export type TransicionColor = "none" | "fast" | "normal" | "slow";

export const TRANSICION_COLOR_OPTS: { id: TransicionColor; label: string; css: string }[] = [
  { id: "none", label: "Ninguna", css: "0s" },
  { id: "fast", label: "Rápida (0.12s)", css: "0.12s" },
  { id: "normal", label: "Media (0.25s)", css: "0.25s" },
  { id: "slow", label: "Lenta (0.5s)", css: "0.5s" },
];

export const TRANSICION_COLOR_CSS: Record<TransicionColor, string> = {
  none: "0s",
  fast: "0.12s",
  normal: "0.25s",
  slow: "0.5s",
};

export const BTN_SIZE_PRESETS: {
  id: "sm" | "md" | "lg";
  label: string;
  fontSize: number;
  padX: number;
  padY: number;
}[] = [
  { id: "sm", label: "Compacto", fontSize: 10, padX: 12, padY: 6 },
  { id: "md", label: "Normal", fontSize: 12, padX: 16, padY: 10 },
  { id: "lg", label: "Grande", fontSize: 14, padX: 22, padY: 12 },
];

/** Botones del menú Clásico (un nodo Studio por enlace). */
export const HEADER_NAV_ITEMS: { id: string; label: string; active?: boolean }[] = [
  { id: "header.nav.inicio", label: "Inicio", active: true },
  { id: "header.nav.catalogo", label: "Catálogo" },
  { id: "header.nav.guias", label: "Guías" },
  { id: "header.nav.recetario", label: "Recetario" },
  { id: "header.nav.blog", label: "Blog" },
  { id: "header.nav.nosotros", label: "Nosotros" },
  { id: "header.nav.contacto", label: "Contacto" },
  { id: "header.nav.cuenta", label: "Iniciar sesión" },
];

export function esBotonHeader(id: string): boolean {
  return id === "header.btn_wa" || id === "header.nav" || id.startsWith("header.nav.");
}

/** Barra anuncio / header del sitio: flex real, no translate ni caja forzada. */
export function esNodoChromeSitio(id: string): boolean {
  return id === "anuncio" || id === "header" || id.startsWith("header.");
}

/** Isotipo del panel (:8081 /app), sin depender del sitio :8083. */
export function urlIsotipoStudio(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    const origin = window.location.origin;
    if (window.location.pathname.startsWith("/app")) {
      return `${origin}/app/img/isotipo.png`;
    }
    return `${origin}/img/isotipo.png`;
  }
  return "/app/img/isotipo.png";
}

/** Cajas de botón del home (header + CTAs del hero / banner). */
export const CTA_STUDIO_BASES = [
  "hero.cta_principal",
  "hero.cta_secundario",
  "cta.boton_wa",
  "cta.boton_contacto",
  "cta.boton",
] as const;

export function baseCtaStudio(id: string): string | null {
  for (const b of CTA_STUDIO_BASES) {
    if (id === b || id.startsWith(`${b}.`)) return b;
  }
  return null;
}

export function esCajaBotonStudio(id: string): boolean {
  if (esBotonHeader(id)) return true;
  return (CTA_STUDIO_BASES as readonly string[]).includes(id);
}

/** Caja visual de un botón (no el grupo menú): el recuadro debe = el fondo. */
export function esCajaHugStudio(id: string): boolean {
  if (id === "header.btn_wa") return true;
  if (id.startsWith("header.nav.")) return true;
  return (CTA_STUDIO_BASES as readonly string[]).includes(id);
}

/** Foto recortable/movible del lienzo (no es fondo CSS de la sección). */
export const NODOS_FOTO_STUDIO = [
  "hero.foto_izq",
  "hero.foto_der",
  "hero.foto",
  "categorias.foto",
  "cta.foto",
] as const;

export function esNodoFotoStudio(id: string): boolean {
  return (NODOS_FOTO_STUDIO as readonly string[]).includes(id);
}

export function mergeFotoNodo(layout: WebLayout, id: string, url: string): WebLayout {
  const cur = nodoOf(layout, id);
  return mergeNodo(layout, id, {
    backgroundImage: url || undefined,
    width: typeof cur.width === "number" ? cur.width : 260,
    height: typeof cur.height === "number" ? cur.height : 180,
  });
}

/** Inline-flex + max-content: el fondo pinta toda la caja; width/height al redimensionar. */
export function estiloCajaHug(n: LayoutNodo): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
    verticalAlign: "top",
    boxSizing: "border-box",
    width: typeof n.width === "number" ? n.width : "max-content",
    height: typeof n.height === "number" ? n.height : "auto",
    maxWidth: "100%",
  };
}

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

const FONDO_URL_RE = /^\/static\/uploads\/fondos\/[A-Za-z0-9._-]+$/;

export function sanitizeFondoUrl(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return FONDO_URL_RE.test(s) ? s : undefined;
}

/** Prefija `/static/...` con la base del sitio (8083 o mckennagroup.co). */
export function resolveFondoSrc(url: string, assetBase = ""): string {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  // Uploads del Studio: mismo origen del panel (:8081), no el sitio :8083.
  if (url.startsWith("/static/uploads/fondos/") && typeof window !== "undefined" && window.location?.origin) {
    const name = url.slice("/static/uploads/fondos/".length);
    if (name) {
      return `${window.location.origin}/api/web/tema/fondo-archivo/${encodeURIComponent(name)}`;
    }
  }
  if (!assetBase) return url;
  return `${assetBase.replace(/\/$/, "")}${url.startsWith("/") ? url : `/${url}`}`;
}

/** Slot de `clasico.fondos` / `pureza.fondos` según la sección del lienzo. */
export function slotFondoSeccion(
  nodeId: string,
  variante: "clasico" | "pureza" = "clasico",
): string | null {
  const sec = nodeId.includes(".") ? nodeId.split(".")[0]! : nodeId;
  if (variante === "clasico") {
    if (sec === "categorias" || sec === "cta") return sec;
    return null;
  }
  if (sec === "hero" || sec === "categorias" || sec === "cta") return sec;
  return null;
}

export interface LayoutNodo {
  dx?: number;
  dy?: number;
  /** Escala visual 0.5–2.5 (agrandar / reducir). */
  scale?: number;
  fontSize?: number;
  /** Familia del nodo (header / textos). Default visual: Montserrat. */
  fontFamily?: FuenteNodo;
  /** Peso 300–900. */
  fontWeight?: MontserratWeight;
  /** Cursiva. */
  fontItalic?: boolean;
  /** Padding horizontal de botón (px). */
  padX?: number;
  /** Padding vertical de botón (px). */
  padY?: number;
  /** Transición de color / fondo (hover). */
  transition?: TransicionColor;
  /** Color de texto al hover (#hex). */
  hoverColor?: string;
  /** Fondo al hover (#hex). */
  hoverBackground?: string;
  /** Color de texto (#hex). */
  color?: string;
  /** Relleno / fondo de caja (#hex). */
  background?: string;
  /** Imagen de fondo del nodo (`/static/uploads/fondos/...`). */
  backgroundImage?: string;
  /** Hero Clásico: % del fondo izquierdo (28–72). El derecho = 100 − este. */
  splitPct?: number;
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
    n.fontFamily === "montserrat" ||
    n.fontFamily === "system" ||
    n.fontFamily === "serif" ||
    n.fontFamily === "mono"
  ) {
    out.fontFamily = n.fontFamily;
  }
  if (typeof n.padX === "number" && Number.isFinite(n.padX)) {
    out.padX = Math.round(clampNum(n.padX, 0, 64));
  }
  if (typeof n.padY === "number" && Number.isFinite(n.padY)) {
    out.padY = Math.round(clampNum(n.padY, 0, 64));
  }
  if (n.transition === "none" || n.transition === "fast" || n.transition === "normal" || n.transition === "slow") {
    out.transition = n.transition;
  }
  const hoverC = sanitizeHexColor(n.hoverColor);
  if (hoverC) out.hoverColor = hoverC;
  const hoverBg = sanitizeHexColor(n.hoverBackground);
  if (hoverBg) out.hoverBackground = hoverBg;
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
  const backgroundImage = sanitizeFondoUrl(n.backgroundImage);
  if (backgroundImage) out.backgroundImage = backgroundImage;
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
  if (typeof n.splitPct === "number" && Number.isFinite(n.splitPct)) {
    out.splitPct = Math.round(clampNum(n.splitPct, HERO_SPLIT_MIN, HERO_SPLIT_MAX));
  }
  if (n.hidden === true) out.hidden = true;
  return out;
}

export const HERO_SPLIT_MIN = 28;
export const HERO_SPLIT_MAX = 72;

export function heroSplitPct(n: LayoutNodo | undefined): number {
  const v = n?.splitPct;
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.round(clampNum(v, HERO_SPLIT_MIN, HERO_SPLIT_MAX));
  }
  return 50;
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
  if (cleaned.splitPct === 50) delete cleaned.splitPct;
  const nodos = { ...layout.nodos };
  if (Object.keys(cleaned).length === 0) delete nodos[id];
  else nodos[id] = cleaned;
  return { ...layout, nodos };
}

/** Tope alineado con `_normalizar_layout` (abs < 4000). */
const NUDGE_LIM = 3999;

/** Paso de flechas: 1 px; Shift = 10 px. */
export function deltaFlecha(
  key: string,
  shift = false,
): { dx: number; dy: number } | null {
  const paso = shift ? 10 : 1;
  if (key === "ArrowLeft") return { dx: -paso, dy: 0 };
  if (key === "ArrowRight") return { dx: paso, dy: 0 };
  if (key === "ArrowUp") return { dx: 0, dy: -paso };
  if (key === "ArrowDown") return { dx: 0, dy: paso };
  return null;
}

export function nudgeNodos(
  layout: WebLayout,
  ids: string[],
  ddx: number,
  ddy: number,
): WebLayout {
  if (!ids.length || (!ddx && !ddy)) return layout;
  let next = layout;
  for (const id of ids) {
    if (!id) continue;
    const n = nodoOf(next, id);
    const dx = Math.max(NUDGE_LIM * -1, Math.min(NUDGE_LIM, Math.round((n.dx ?? 0) + ddx)));
    const dy = Math.max(NUDGE_LIM * -1, Math.min(NUDGE_LIM, Math.round((n.dy ?? 0) + ddy)));
    next = mergeNodo(next, id, { dx, dy });
  }
  return next;
}

export function estiloNodo(n: LayoutNodo, assetBase = "", chrome = false): CSSProperties {
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
  if (!chrome) {
    if (dx || dy) transforms.push(`translate(${dx}px, ${dy}px)`);
    if (rotate) transforms.push(`rotate(${rotate}deg)`);
    if (scale !== 1) transforms.push(`scale(${scale})`);
  }
  if (transforms.length) {
    style.transform = transforms.join(" ");
    style.transformOrigin = "top left";
  }
  if (n.fontSize) style.fontSize = n.fontSize;
  const fam = n.fontFamily && FUENTE_NODO_CSS[n.fontFamily];
  if (fam) style.fontFamily = fam;
  else if (n.fontWeight || n.fontItalic) style.fontFamily = STUDIO_FONT_FAMILY;
  if (n.fontWeight) style.fontWeight = n.fontWeight;
  if (n.fontItalic) style.fontStyle = "italic";
  if (typeof n.padX === "number" || typeof n.padY === "number") {
    const px = typeof n.padX === "number" ? n.padX : 16;
    const py = typeof n.padY === "number" ? n.padY : 10;
    (style as Record<string, string>)["--studio-pad-x"] = `${px}px`;
    (style as Record<string, string>)["--studio-pad-y"] = `${py}px`;
  }
  if (n.transition && n.transition !== "none") {
    const dur = TRANSICION_COLOR_CSS[n.transition];
    style.transition = `color ${dur}, background ${dur}`;
    (style as Record<string, string>)["--studio-tr"] = dur;
  } else if (n.transition === "none") {
    style.transition = "none";
    (style as Record<string, string>)["--studio-tr"] = "0s";
  }
  if (n.hoverColor) (style as Record<string, string>)["--studio-hover-color"] = n.hoverColor;
  if (n.hoverBackground) (style as Record<string, string>)["--studio-hover-bg"] = n.hoverBackground;
  if (n.color) style.color = n.color;
  if (n.background) style.backgroundColor = n.background;
  if (n.backgroundImage) {
    style.backgroundImage = `url("${resolveFondoSrc(n.backgroundImage, assetBase)}")`;
    style.backgroundSize = "cover";
    style.backgroundPosition = "center";
    style.backgroundRepeat = "no-repeat";
  }
  if (n.borderColor || (typeof n.borderWidth === "number" && n.borderWidth > 0)) {
    style.borderStyle = "solid";
    style.borderWidth = n.borderWidth ?? 1;
    style.borderColor = n.borderColor || "currentColor";
    style.boxSizing = "border-box";
  }
  if (n.width && !chrome) {
    style.width = n.width;
    style.maxWidth = "100%";
  }
  if (n.height) {
    (style as Record<string, string>)["--studio-logo-h"] = `${n.height}px`;
    if (!chrome) {
      style.height = n.height;
      style.boxSizing = "border-box";
    }
  }
  if (typeof n.opacity === "number") style.opacity = n.opacity;
  if (typeof n.borderRadius === "number") style.borderRadius = n.borderRadius;
  if (n.shadow && n.shadow !== "none") style.boxShadow = SHADOW_CSS[n.shadow];
  const anim = animacionCss(n);
  if (anim) style.animation = anim;
  return style;
}

/**
 * Caja de texto del lienzo: el recuadro sigue el glifo.
 * Un `width` guardado solo acota el wrap; el alto nunca se fuerza (evita cajas
 * altísimas). Tampoco se deja `display:inline` + `position:relative`: ese combo
 * hace que los controladores absolutos usen un containing block enorme.
 */
export function estiloFitTexto(
  n: LayoutNodo,
  opts?: { className?: string; enabled?: boolean; tag?: string; chrome?: boolean },
): CSSProperties {
  const core = estiloNodo(n, "", opts?.chrome === true);
  if (opts?.enabled === false || n.hidden) return core;
  const cls = opts?.className || "";
  const tag = (opts?.tag || "").toLowerCase();
  const hasMax = /\bmax-w-/.test(cls);
  const wantsBlock =
    tag === "p" ||
    tag === "div" ||
    tag === "h1" ||
    tag === "h2" ||
    tag === "h3" ||
    (/\bblock\b/.test(cls) && !/\binline\b/.test(cls));
  const { height: _altoIgnorado, ...rest } = core;
  return {
    ...rest,
    display: wantsBlock ? "flex" : "inline-flex",
    alignItems: "center",
    width: n.width != null ? n.width : wantsBlock && hasMax ? "100%" : "max-content",
    maxWidth: hasMax ? undefined : "100%",
    height: "auto",
    lineHeight: 1.15,
    alignSelf: "flex-start",
    justifySelf: "start",
    verticalAlign: "top",
    boxSizing: "border-box",
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
  anuncio: { type: "string", path: ["anuncio"] },
  "hero.eyebrow": { type: "string", path: ["hero", "eyebrow"] },
  "hero.titulo": { type: "string", path: ["hero", "titulo"] },
  "hero.titulo_em": { type: "string", path: ["hero", "titulo_em"] },
  "hero.subtitulo": { type: "string", path: ["hero", "subtitulo"] },
  "hero.cta_principal.texto": { type: "string", path: ["hero", "cta_principal"] },
  "hero.cta_secundario.texto": { type: "string", path: ["hero", "cta_secundario"] },
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
  "cta.boton_wa.texto": { type: "cta_clasico", field: "boton_wa" },
  "cta.boton_contacto.texto": { type: "cta_clasico", field: "boton_contacto" },
  "trazabilidad.eyebrow": { type: "string", path: ["trazabilidad", "eyebrow"] },
  "trazabilidad.titulo": { type: "string", path: ["trazabilidad", "titulo"] },
  "trazabilidad.texto": { type: "string", path: ["trazabilidad", "texto"] },
  "cta.titulo": { type: "cta", field: "titulo" },
  "cta.texto": { type: "cta", field: "texto" },
  "cta.boton.texto": { type: "cta", field: "boton" },
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

export function pathEsTextoEditable(path: ContentPath | null): boolean {
  if (!path) return false;
  if (path.type === "paso" || path.type === "pilar" || path.type === "feature" || path.type === "kit") {
    return path.field !== "icono";
  }
  return true;
}

/** Lee el texto actual según ContentPath (vacío si no hay). */
export function leerContentPath(
  draft: Record<string, unknown> | null | undefined,
  path: ContentPath,
): string {
  if (!draft) return "";
  try {
    if (path.type === "string") {
      let cur: unknown = draft;
      for (const k of path.path) {
        if (!cur || typeof cur !== "object") return "";
        cur = (cur as Record<string, unknown>)[k];
      }
      return typeof cur === "string" ? cur : "";
    }
    if (path.type === "metric") {
      const metricas = draft.metricas as { valor?: string; etiqueta?: string }[] | undefined;
      const v = metricas?.[path.index]?.[path.field];
      return typeof v === "string" ? v : "";
    }
    if (path.type === "paso") {
      const pasos = (draft.trazabilidad as { pasos?: Record<string, string>[] } | undefined)?.pasos;
      const v = pasos?.[path.index]?.[path.field];
      return typeof v === "string" ? v : "";
    }
    if (path.type === "pilar") {
      const pilares = draft.pilares as Record<string, string>[] | undefined;
      const v = pilares?.[path.index]?.[path.field];
      return typeof v === "string" ? v : "";
    }
    if (path.type === "badge") {
      const badges = draft.badges_producto as string[] | undefined;
      const v = badges?.[path.index];
      return typeof v === "string" ? v : "";
    }
    if (path.type === "cta") {
      const v = (draft.cta as Record<string, string> | undefined)?.[path.field];
      return typeof v === "string" ? v : "";
    }
    if (path.type === "feature") {
      const features = draft.features as Record<string, string>[] | undefined;
      const v = features?.[path.index]?.[path.field];
      return typeof v === "string" ? v : "";
    }
    if (path.type === "kit") {
      const kit = (draft.hero as { kit?: Record<string, string>[] } | undefined)?.kit;
      const v = kit?.[path.index]?.[path.field];
      return typeof v === "string" ? v : "";
    }
    if (path.type === "section_hdr") {
      const v = (draft[path.section] as Record<string, string> | undefined)?.[path.field];
      return typeof v === "string" ? v : "";
    }
    if (path.type === "cta_clasico") {
      const v = (draft.cta as Record<string, string> | undefined)?.[path.field];
      return typeof v === "string" ? v : "";
    }
  } catch {
    return "";
  }
  return "";
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

export const COLORES_CLASICO_DEFAULT: Record<string, string> = {
  acento: "#0c6069",
  acento_oscuro: "#045159",
  acento_claro: "#6aacb3",
  fondo: "#e3fcff",
  fondo_oscuro: "#022d33",
  tinta: "#022d33",
};

export const COLORES_PUREZA_DEFAULT: Record<string, string> = {
  acento: "#0c6069",
  acento_oscuro: "#04353b",
  fondo: "#f8f6f1",
  tinta: "#1c2b2a",
  destacado: "#b9862f",
};

export function cssVarsClasico(colores: Record<string, string>): Record<string, string> {
  const acento = colores.acento || COLORES_CLASICO_DEFAULT.acento;
  const acentoOscuro = colores.acento_oscuro || COLORES_CLASICO_DEFAULT.acento_oscuro;
  const acentoClaro = colores.acento_claro || COLORES_CLASICO_DEFAULT.acento_claro;
  const fondo = colores.fondo || COLORES_CLASICO_DEFAULT.fondo;
  const fondoOscuro = colores.fondo_oscuro || COLORES_CLASICO_DEFAULT.fondo_oscuro;
  const tinta = colores.tinta || COLORES_CLASICO_DEFAULT.tinta;
  return {
    "--green": acento,
    "--green-dark": acentoOscuro,
    "--green-deep": fondoOscuro,
    "--green-light": acentoClaro,
    "--green-ultra": fondo,
    "--green-pale": `color-mix(in srgb, ${acento} 22%, ${fondo})`,
    "--white": fondo,
    "--off-white": fondo,
    "--text-dark": tinta,
    "--text-mid": acentoOscuro,
    "--text-soft": acento,
    "--text-muted": `color-mix(in srgb, ${tinta} 55%, ${acentoClaro})`,
    "--border": `color-mix(in srgb, ${acento} 18%, transparent)`,
  };
}

export function cssVarsPureza(colores: Record<string, string>): Record<string, string> {
  return {
    "--pz-acento": colores.acento || COLORES_PUREZA_DEFAULT.acento,
    "--pz-acento-oscuro": colores.acento_oscuro || COLORES_PUREZA_DEFAULT.acento_oscuro,
    "--pz-fondo": colores.fondo || COLORES_PUREZA_DEFAULT.fondo,
    "--pz-tinta": colores.tinta || COLORES_PUREZA_DEFAULT.tinta,
    "--pz-destacado": colores.destacado || COLORES_PUREZA_DEFAULT.destacado,
  };
}

export function studioLivePayload(
  diseno: { radio: string; densidad: string; tagline: string },
  colores: Record<string, string>,
  tema: "clasico" | "pureza" = "pureza",
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
      ...(tema === "clasico" ? cssVarsClasico(colores) : cssVarsPureza(colores)),
    },
    tagline: diseno.tagline || "Proveemos a tus ideas",
  };
}

/** Firma de lo que exige recargar el iframe (textos/lienzo). Tokens van por postMessage. */
export function estructuraPreviewKey(cfg: {
  clasico: { colores?: unknown };
  layout: unknown;
  layout_clasico: unknown;
  pureza: { colores?: unknown };
}): string {
  const { colores: _pz, ...purezaSinColor } = cfg.pureza;
  const { colores: _cl, ...clasicoSinColor } = cfg.clasico;
  return JSON.stringify({
    clasico: clasicoSinColor,
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
