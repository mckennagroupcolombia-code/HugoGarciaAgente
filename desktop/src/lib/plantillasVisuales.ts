/** Tipos y formatos base del Editor de Plantillas Visuales. */

import type { TipoEtiqueta } from "./etiquetasTipos";

/** Mismo DPI que el lienzo en pantalla (96 ≈ tamaño real al 100% zoom). */
export const ETIQUETA_IMPRESION_DPI = 96;
export const CANVAS_DPI = 96;
/** DPI nativo Epson ColorWorks CW-C4000 — export PNG para impresión física. */
export const ETIQUETA_EXPORT_DPI_IMPRESION = 600;
/** Tope de escala de exportación (600÷96 ≈ 6.25; margen para formatos raros). */
export const EXPORT_ESCALA_MAX = 10;

export type ElementoTipo = "text" | "rect" | "image" | "line";

export interface FormatoCanvas {
  id: string;
  nombre: string;
  ancho_px: number;
  alto_px: number;
  ancho_mm?: number;
  alto_mm?: number;
  dpi: number;
  /** Nombre del tipo en /api/etiquetas/tipos (vínculo con impresión). */
  tipo_etiqueta?: string;
}

export interface ElementoBase {
  id: string;
  type: ElementoTipo;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  locked?: boolean;
  /** undefined / true = visible en el lienzo; false = oculto (no se exporta). */
  visible?: boolean;
  /** Agrupa elementos para seleccionarlos y moverlos juntos. */
  groupId?: string;
}

export type RolTextoCapa = "descripcion" | "titulo" | "subtitulo" | "otro";

export interface ElementoTexto extends ElementoBase {
  type: "text";
  content: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  color: string;
  align: "left" | "center" | "right" | "justify";
  /** Multiplicador de interlineado (1 = sencillo). undefined = 1.2 (por defecto). */
  lineHeight?: number;
  /** Capa semántica en plantillas de etiqueta (p. ej. descripción materia prima = capa 1). */
  textRole?: RolTextoCapa;
  /** Curvatura del texto en arco: -200 a 200; ±100 = semicírculo, ±200 = círculo
   *  completo. Positivo domo (por arriba), negativo valle (por abajo); 0/undefined = recto. */
  arco?: number;
}

export interface ElementoRect extends ElementoBase {
  type: "rect";
  fill: string;
  stroke: string;
  strokeWidth: number;
  borderRadius: number;
}

export interface ElementoImagen extends ElementoBase {
  type: "image";
  src: string;
  objectFit: "contain" | "cover";
}

export interface ElementoLinea extends ElementoBase {
  type: "line";
  x2: number;
  y2: number;
  stroke: string;
  strokeWidth: number;
}

export type ElementoVisual = ElementoTexto | ElementoRect | ElementoImagen | ElementoLinea;

export interface PlantillaVisualDoc {
  id: string;
  nombre: string;
  categoria: string;
  /** Ruta de carpeta del Studio (p. ej. "Fragancias/Difusor"); "" = raíz. */
  carpeta?: string;
  formato: FormatoCanvas;
  fondo: string;
  elementos: ElementoVisual[];
  created_at?: string;
  updated_at?: string;
}

export interface CategoriaFormato {
  id: string;
  nombre: string;
  emoji: string;
  formatos: FormatoPreset[];
}

export interface FormatoPreset {
  id: string;
  nombre: string;
  descripcion?: string;
  ancho_px?: number;
  alto_px?: number;
  ancho_mm?: number;
  alto_mm?: number;
  dpi?: number;
  tipo_etiqueta?: string;
}

export function mmToPx(mm: number, dpi = CANVAS_DPI): number {
  return Math.round((mm / 25.4) * dpi);
}

/** Zoom para que el lienzo ocupe ~85 % del viewport del editor. */
export function zoomAjusteLienzo(
  anchoPx: number,
  altoPx: number,
  viewportW: number,
  viewportH: number,
  margen = 24,
): number {
  const w = Math.max(1, viewportW - margen * 2);
  const h = Math.max(1, viewportH - margen * 2);
  const scale = Math.min(w / Math.max(anchoPx, 1), h / Math.max(altoPx, 1));
  return Math.max(0.75, Math.min(scale, 4));
}

/** Tamaño de miniatura proporcional (p. ej. tarjetas de biblioteca). */
export function miniaturaLienzoPx(
  anchoPx: number,
  altoPx: number,
  maxAncho = 148,
  maxAlto = 112,
): { width: number; height: number } {
  const ratio = altoPx / Math.max(anchoPx, 1);
  let width = maxAncho;
  let height = Math.round(width * ratio);
  if (height > maxAlto) {
    height = maxAlto;
    width = Math.round(height / ratio);
  }
  return { width: Math.max(48, width), height: Math.max(36, height) };
}

export function presetToFormato(p: FormatoPreset, categoriaId: string): FormatoCanvas {
  const dpi = p.dpi ?? CANVAS_DPI;
  const ancho_px = p.ancho_px ?? (p.ancho_mm != null ? mmToPx(p.ancho_mm, dpi) : 800);
  const alto_px = p.alto_px ?? (p.alto_mm != null ? mmToPx(p.alto_mm, dpi) : 600);
  return {
    id: `${categoriaId}-${p.id}`,
    nombre: p.nombre,
    ancho_px,
    alto_px,
    ancho_mm: p.ancho_mm,
    alto_mm: p.alto_mm,
    dpi,
    tipo_etiqueta: p.tipo_etiqueta,
  };
}

/** Convierte un tipo de impresión de Etiquetas al lienzo del editor. */
export function tipoEtiquetaToFormato(t: TipoEtiqueta): FormatoCanvas {
  const dpi = ETIQUETA_IMPRESION_DPI;
  return {
    id: `etiquetas-${t.nombre}`,
    nombre: t.nombre,
    tipo_etiqueta: t.nombre,
    ancho_mm: t.ancho_mm,
    alto_mm: t.alto_mm,
    ancho_px: mmToPx(t.ancho_mm, dpi),
    alto_px: mmToPx(t.alto_mm, dpi),
    dpi,
  };
}

/** Presets de etiquetas sincronizados con /api/etiquetas/tipos. */
export function formatosEtiquetaDesdeTipos(tipos: TipoEtiqueta[]): FormatoPreset[] {
  return tipos.map((t) => ({
    id: t.nombre,
    nombre: t.nombre,
    descripcion: "Formato de impresión",
    ancho_mm: t.ancho_mm,
    alto_mm: t.alto_mm,
    dpi: ETIQUETA_IMPRESION_DPI,
    tipo_etiqueta: t.nombre,
  }));
}

/** Categorías del selector; la de etiquetas se arma con tipos de impresión en runtime. */
export const CATEGORIAS_FORMATO_BASE: CategoriaFormato[] = [
  {
    id: "meli",
    nombre: "Mercado Libre",
    emoji: "🛒",
    formatos: [
      { id: "1200", nombre: "Cuadrado 1200 × 1200", ancho_px: 1200, alto_px: 1200 },
      { id: "1600", nombre: "Cuadrado 1600 × 1600", ancho_px: 1600, alto_px: 1600 },
      { id: "800", nombre: "Miniatura 800 × 800", ancho_px: 800, alto_px: 800 },
      { id: "banner", nombre: "Banner tienda 1200 × 300", ancho_px: 1200, alto_px: 300 },
    ],
  },
  {
    id: "fichas",
    nombre: "Fichas técnicas",
    emoji: "📄",
    formatos: [
      { id: "a4", nombre: "A4 vertical", ancho_mm: 210, alto_mm: 297, dpi: 150 },
      { id: "a4h", nombre: "A4 horizontal", ancho_mm: 297, alto_mm: 210, dpi: 150 },
      { id: "carta", nombre: "Carta US", ancho_mm: 216, alto_mm: 279, dpi: 150 },
    ],
  },
  {
    id: "banners",
    nombre: "Banners web",
    emoji: "🖼️",
    formatos: [
      { id: "hero", nombre: "Hero 1920 × 600", ancho_px: 1920, alto_px: 600 },
      { id: "medio", nombre: "Banner medio 1200 × 400", ancho_px: 1200, alto_px: 400 },
      { id: "sidebar", nombre: "Sidebar 300 × 600", ancho_px: 300, alto_px: 600 },
    ],
  },
  {
    id: "redes",
    nombre: "Redes sociales",
    emoji: "📱",
    formatos: [
      { id: "ig-post", nombre: "Instagram post", ancho_px: 1080, alto_px: 1080 },
      { id: "ig-story", nombre: "Instagram story", ancho_px: 1080, alto_px: 1920 },
      { id: "fb-cover", nombre: "Facebook portada", ancho_px: 820, alto_px: 312 },
      { id: "fb-post", nombre: "Facebook post", ancho_px: 1200, alto_px: 630 },
    ],
  },
  {
    id: "documentos",
    nombre: "Documentos",
    emoji: "📋",
    formatos: [
      { id: "a4-doc", nombre: "Documento A4", ancho_mm: 210, alto_mm: 297, dpi: 150 },
      { id: "a5", nombre: "A5 folleto", ancho_mm: 148, alto_mm: 210, dpi: 150 },
    ],
  },
];

export function categoriasFormatoConEtiquetas(tipos: TipoEtiqueta[]): CategoriaFormato[] {
  return [
    {
      id: "etiquetas",
      nombre: "Etiquetas",
      emoji: "🏷️",
      formatos: formatosEtiquetaDesdeTipos(tipos),
    },
    ...CATEGORIAS_FORMATO_BASE,
  ];
}

/** @deprecated Usar categoriasFormatoConEtiquetas(tipos) */
export const CATEGORIAS_FORMATO: CategoriaFormato[] = categoriasFormatoConEtiquetas([]);

export function nuevoId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID().slice(0, 12);
  }
  return Math.random().toString(36).slice(2, 14);
}

/** Posición escalonada para que cada elemento nuevo no quede encima del anterior. */
export function posicionNuevoElemento(
  indice: number,
  baseX = 40,
  baseY = 40,
): { x: number; y: number } {
  const col = indice % 6;
  const row = Math.floor(indice / 6);
  return { x: baseX + col * 28, y: baseY + row * 32 };
}

/** Copia profunda con id nuevo; cada elemento queda totalmente independiente. */
export function clonarElementoIndependiente(
  el: ElementoVisual,
  offset = { x: 20, y: 20 },
): ElementoVisual {
  const copia = structuredClone(el) as ElementoVisual;
  copia.id = nuevoId();
  delete copia.groupId;
  copia.x += offset.x;
  copia.y += offset.y;
  if (copia.type === "line" && el.type === "line") {
    const x2 = el.x2 ?? el.x + el.width;
    const y2 = el.y2 ?? el.y;
    copia.x2 = x2 + offset.x;
    copia.y2 = y2 + offset.y;
    copia.width = Math.max(1, Math.hypot(copia.x2 - copia.x, copia.y2 - copia.y));
  }
  return copia;
}

/** Copia completa de plantilla: nuevo id, elementos independientes, misma geometría. */
export function duplicarPlantillaVisual(
  doc: PlantillaVisualDoc,
  nombre?: string,
): PlantillaVisualDoc {
  const copia = structuredClone(doc) as PlantillaVisualDoc;
  copia.id = nuevoId();
  const baseNombre = (doc.nombre || "Plantilla").trim() || "Plantilla";
  copia.nombre = (nombre?.trim() || `Copia de ${baseNombre}`).slice(0, 120);
  delete copia.created_at;
  delete copia.updated_at;

  const groupMap = new Map<string, string>();
  copia.elementos = doc.elementos.map((el) => {
    const clon = structuredClone(el) as ElementoVisual;
    clon.id = nuevoId();
    if (clon.groupId) {
      let gid = groupMap.get(clon.groupId);
      if (!gid) {
        gid = nuevoGroupId();
        groupMap.set(el.groupId!, gid);
      }
      clon.groupId = gid;
    }
    return clon;
  });
  return copia;
}

/** Cambia el formato de una plantilla ya guardada, reescalando la geometría de sus elementos. */
export function escalarPlantillaAFormato(
  doc: PlantillaVisualDoc,
  nuevoFormato: FormatoCanvas,
  categoria?: string,
): PlantillaVisualDoc {
  const sx = nuevoFormato.ancho_px / Math.max(1, doc.formato.ancho_px);
  const sy = nuevoFormato.alto_px / Math.max(1, doc.formato.alto_px);

  const copia = structuredClone(doc) as PlantillaVisualDoc;
  copia.formato = nuevoFormato;
  if (categoria) copia.categoria = categoria;
  copia.elementos = doc.elementos.map((el) => {
    const clon = structuredClone(el) as ElementoVisual;
    clon.x = el.x * sx;
    clon.y = el.y * sy;
    clon.width = el.width * sx;
    clon.height = el.height * sy;
    if (clon.type === "text" && el.type === "text") {
      clon.fontSize = ajustarTamanoTexto(el.fontSize * Math.sqrt(sx * sy));
    }
    if (clon.type === "line" && el.type === "line") {
      clon.x2 = el.x2 * sx;
      clon.y2 = el.y2 * sy;
    }
    return clon;
  });
  return copia;
}

export const FUENTE_MONTSERRAT_FAMILY = '"Montserrat", system-ui, sans-serif';

export type MontserratVariant =
  | "light"
  | "regular"
  | "medium"
  | "semibold"
  | "bold"
  | "extrabold"
  | "black";

export const VARIANTES_MONTSERRAT: readonly {
  id: MontserratVariant;
  label: string;
  weight: number;
}[] = [
  { id: "light", label: "Light", weight: 300 },
  { id: "regular", label: "Regular", weight: 400 },
  { id: "medium", label: "Medium", weight: 500 },
  { id: "semibold", label: "SemiBold", weight: 600 },
  { id: "bold", label: "Bold", weight: 700 },
  { id: "extrabold", label: "ExtraBold", weight: 800 },
  { id: "black", label: "Black", weight: 900 },
];

export function esFuenteMontserrat(fontFamily: string): boolean {
  return /montserrat/i.test(fontFamily || "");
}

export function pesoMontserratVariante(v: MontserratVariant): number {
  return VARIANTES_MONTSERRAT.find((x) => x.id === v)?.weight ?? 400;
}

export function varianteDesdeFontWeight(fontWeight: string | number | undefined): MontserratVariant {
  if (fontWeight === "bold") return "bold";
  if (fontWeight === "normal" || fontWeight === "lighter") return "regular";
  const n =
    typeof fontWeight === "number"
      ? fontWeight
      : parseInt(String(fontWeight || "400"), 10) || 400;
  let mejor: MontserratVariant = "regular";
  let diff = Infinity;
  for (const v of VARIANTES_MONTSERRAT) {
    const d = Math.abs(v.weight - n);
    if (d < diff) {
      diff = d;
      mejor = v.id;
    }
  }
  return mejor;
}

export function pesoFontWeightCss(fontWeight: string | number | undefined): number {
  if (fontWeight === "bold") return 700;
  if (fontWeight === "normal") return 400;
  const n =
    typeof fontWeight === "number"
      ? fontWeight
      : parseInt(String(fontWeight || "400"), 10);
  return Number.isFinite(n) && n > 0 ? n : 400;
}

/** Tamaño por defecto al crear un cuadro de texto (px en lienzo a 96 dpi). */
export const TAMANO_TEXTO_DEFECTO = 12;
export const PASO_TAMANO_TEXTO = 0.25;
export const TAMANO_TEXTO_MIN = 4;
export const TAMANO_TEXTO_MAX = 200;

/** Ajusta el tamaño al múltiplo más cercano de 0,25 px. */
export function ajustarTamanoTexto(n: number): number {
  const v = Number.isFinite(n) ? n : TAMANO_TEXTO_DEFECTO;
  const snap = Math.round(v / PASO_TAMANO_TEXTO) * PASO_TAMANO_TEXTO;
  return Math.min(TAMANO_TEXTO_MAX, Math.max(TAMANO_TEXTO_MIN, snap));
}

export function plantillaVacia(
  formato: FormatoCanvas,
  categoria: string,
  carpeta = "",
): PlantillaVisualDoc {
  return {
    id: nuevoId(),
    nombre: "Nuevo recurso",
    categoria,
    carpeta,
    formato,
    fondo: "#ffffff",
    elementos: [],
  };
}

export function elementoTextoDefecto(x = 40, y = 40): ElementoTexto {
  return {
    id: nuevoId(),
    type: "text",
    x,
    y,
    width: 200,
    height: Math.ceil(TAMANO_TEXTO_DEFECTO * 1.6),
    rotation: 0,
    zIndex: 1,
    content: "Texto aquí",
    fontSize: TAMANO_TEXTO_DEFECTO,
    fontFamily: FUENTE_MONTSERRAT_FAMILY,
    fontWeight: "600",
    color: "#0f172a",
    align: "left",
  };
}

export function elementoRectDefecto(x = 60, y = 120): ElementoRect {
  return {
    id: nuevoId(),
    type: "rect",
    x,
    y,
    width: 200,
    height: 80,
    rotation: 0,
    zIndex: 1,
    fill: "#0891b2",
    stroke: "#0e7490",
    strokeWidth: 0,
    borderRadius: 0,
  };
}

export function elementoLineaDefecto(x = 40, y = 220): ElementoLinea {
  return {
    id: nuevoId(),
    type: "line",
    x,
    y,
    x2: x + 200,
    y2: y,
    width: 200,
    height: 4,
    rotation: 0,
    zIndex: 1,
    stroke: "#334155",
    strokeWidth: 1,
  };
}

/** Con Ctrl: fuerza línea horizontal o vertical (90°) desde el punto de anclaje. */
export function snapLinea90(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  activo: boolean,
): { x2: number; y2: number } {
  if (!activo) return { x2, y2 };
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (Math.abs(dx) >= Math.abs(dy)) return { x2, y2: y1 };
  return { x2: x1, y2 };
}

export function elementoImagenDefecto(src: string, x = 80, y = 80): ElementoImagen {
  return {
    id: nuevoId(),
    type: "image",
    x,
    y,
    width: 120,
    height: 120,
    rotation: 0,
    zIndex: 2,
    src,
    objectFit: "contain",
  };
}

export function labelFormato(f: FormatoCanvas): string {
  const dims =
    f.ancho_mm != null && f.alto_mm != null
      ? `${f.ancho_mm}×${f.alto_mm} mm`
      : `${f.ancho_px}×${f.alto_px} px`;
  if (f.tipo_etiqueta) {
    return `${f.tipo_etiqueta} · ${dims}`;
  }
  return `${f.nombre} · ${dims}`;
}

/** Preset de escala para exportar PNG/JPG sin deformar el diseño. */
export interface PresetResolucionExport {
  id: string;
  label: string;
  escala: number;
  hint: string;
}

export function dimensionesExportPx(
  formato: FormatoCanvas,
  escala: number,
): { ancho: number; alto: number } {
  const s = Math.max(0.25, Math.min(EXPORT_ESCALA_MAX, escala));
  return {
    ancho: Math.max(1, Math.round(formato.ancho_px * s)),
    alto: Math.max(1, Math.round(formato.alto_px * s)),
  };
}

/** Escala para exportar a un DPI de impresión (p. ej. 600) desde el DPI del lienzo. */
export function escalaParaDpiImpresion(
  formato: FormatoCanvas,
  dpiObjetivo = ETIQUETA_EXPORT_DPI_IMPRESION,
): number {
  const base = formato.dpi || CANVAS_DPI;
  const s = dpiObjetivo / Math.max(1, base);
  return Math.round(Math.max(0.25, Math.min(EXPORT_ESCALA_MAX, s)) * 1000) / 1000;
}

export function presetsResolucionExport(formato: FormatoCanvas): PresetResolucionExport[] {
  const seen = new Set<number>();
  const out: PresetResolucionExport[] = [];
  const dpiBase = formato.dpi || CANVAS_DPI;
  const esEtiqueta = Boolean(formato.tipo_etiqueta || (formato.ancho_mm && formato.alto_mm));

  const push = (id: string, label: string, escala: number) => {
    const s = Math.round(escala * 1000) / 1000;
    if (seen.has(s) || s < 0.25 || s > EXPORT_ESCALA_MAX) return;
    seen.add(s);
    const dim = dimensionesExportPx(formato, s);
    let hint = `${dim.ancho}×${dim.alto} px`;
    if (formato.ancho_mm != null && formato.alto_mm != null && formato.ancho_mm > 0) {
      const dpi = Math.round((dim.ancho / formato.ancho_mm) * 25.4);
      hint = `${hint} · ~${dpi} DPI`;
    }
    out.push({ id, label, escala: s, hint });
  };

  push("1x", "1× Lienzo", 1);
  push("2x", "2× Alta", 2);
  for (const target of [300, 600]) {
    if (target !== dpiBase) {
      push(
        `dpi-${target}`,
        target === 600 ? "600 DPI Impresión" : "300 DPI",
        target / dpiBase,
      );
    }
  }
  if (!esEtiqueta) {
    push("3x", "3×", 3);
    push("4x", "4×", 4);
  }
  return out;
}

/** Preset por defecto al exportar PNG desde Studio (etiquetas → 600 DPI Epson). */
export function presetExportImpresionDefault(formato: FormatoCanvas): PresetResolucionExport {
  const presets = presetsResolucionExport(formato);
  return (
    presets.find((p) => p.id === "dpi-600")
    ?? presets.find((p) => p.id === "dpi-300")
    ?? presets[presets.length - 1]
    ?? { id: "1x", label: "1×", escala: 1, hint: "" }
  );
}

export type AlineacionObjetos =
  | "izquierda"
  | "centro-h"
  | "derecha"
  | "arriba"
  | "centro-v"
  | "abajo";

export interface RectBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function boundsElemento(el: ElementoVisual): RectBounds {
  if (el.type === "line") {
    const x2 = el.x2 ?? el.x + el.width;
    const y2 = el.y2 ?? el.y;
    return {
      left: Math.min(el.x, x2),
      top: Math.min(el.y, y2),
      right: Math.max(el.x, x2),
      bottom: Math.max(el.y, y2),
    };
  }
  return {
    left: el.x,
    top: el.y,
    right: el.x + el.width,
    bottom: el.y + el.height,
  };
}

export function unionBounds(bounds: RectBounds[]): RectBounds {
  return bounds.reduce(
    (acc, b) => ({
      left: Math.min(acc.left, b.left),
      top: Math.min(acc.top, b.top),
      right: Math.max(acc.right, b.right),
      bottom: Math.max(acc.bottom, b.bottom),
    }),
    bounds[0],
  );
}

/** ¿Se solapan dos cajas? (selección por ventana). */
export function rectsIntersectan(a: RectBounds, b: RectBounds): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** IDs cuyo bounds toca la ventana; expande grupos enteros. */
export function idsSeleccionVentana(
  elementos: ElementoVisual[],
  ventana: RectBounds,
): string[] {
  const tocados = new Set<string>();
  for (const el of elementos) {
    if (el.visible === false) continue;
    if (!rectsIntersectan(boundsElemento(el), ventana)) continue;
    if (el.groupId) {
      for (const id of idsGrupo(elementos, el.groupId)) tocados.add(id);
    } else {
      tocados.add(el.id);
    }
  }
  return [...tocados];
}

export function patchMoverElemento(
  el: ElementoVisual,
  dx: number,
  dy: number,
): Partial<ElementoVisual> {
  if (el.type === "line") {
    const x2 = el.x2 ?? el.x + el.width;
    const y2 = el.y2 ?? el.y;
    return {
      x: el.x + dx,
      y: el.y + dy,
      x2: x2 + dx,
      y2: y2 + dy,
    };
  }
  return { x: el.x + dx, y: el.y + dy };
}

export function alinearElementos(
  elementos: ElementoVisual[],
  ids: string[],
  tipo: AlineacionObjetos,
  ref: RectBounds,
): ElementoVisual[] {
  const selected = new Set(ids);
  const refCx = (ref.left + ref.right) / 2;
  const refCy = (ref.top + ref.bottom) / 2;

  return elementos.map((el) => {
    if (!selected.has(el.id)) return el;
    const b = boundsElemento(el);
    let dx = 0;
    let dy = 0;
    switch (tipo) {
      case "izquierda":
        dx = ref.left - b.left;
        break;
      case "derecha":
        dx = ref.right - b.right;
        break;
      case "centro-h":
        dx = refCx - (b.left + b.right) / 2;
        break;
      case "arriba":
        dy = ref.top - b.top;
        break;
      case "abajo":
        dy = ref.bottom - b.bottom;
        break;
      case "centro-v":
        dy = refCy - (b.top + b.bottom) / 2;
        break;
    }
    if (!dx && !dy) return el;
    return { ...el, ...patchMoverElemento(el, dx, dy) } as ElementoVisual;
  });
}

export function inferirRolTextoCapa(
  el: ElementoTexto,
  elementos: ElementoVisual[],
): RolTextoCapa | null {
  if (el.textRole) return el.textRole;
  const textos = elementos.filter((e): e is ElementoTexto => e.type === "text");
  if (textos.length === 0) return null;
  if (textos.length === 1) return "descripcion";

  const sortedByZ = [...textos].sort((a, b) => a.zIndex - b.zIndex);
  // El tamaño de fuente es la señal universal de jerarquía en una etiqueta
  // (el título es el texto más grande); el grosor solo desempata. Ordenar
  // por grosor primero hacía que una capa pequeña pero en negrita (CAS,
  // lote, código de barras) le ganara el puesto de "título" a la capa que
  // de verdad lo es, y entonces la descripción nunca encontraba el título.
  const sortedByFont = [...textos].sort((a, b) => {
    const wb = parseInt(b.fontWeight, 10) || 400;
    const wa = parseInt(a.fontWeight, 10) || 400;
    return b.fontSize - a.fontSize || wb - wa;
  });

  const candidatoDesc = sortedByZ[0];
  const pareceDescripcion =
    el.id === candidatoDesc.id &&
    (el.align === "justify" || (el.content?.trim().length ?? 0) > 80);
  if (pareceDescripcion) return "descripcion";
  if (el.id === sortedByFont[0]?.id) return "titulo";
  if (el.id === sortedByFont[1]?.id) return "subtitulo";
  return "otro";
}

export function esCapaDescripcionMateriaPrima(
  el: ElementoVisual,
  elementos: ElementoVisual[],
): boolean {
  if (el.type !== "text") return false;
  return inferirRolTextoCapa(el, elementos) === "descripcion";
}

export function contextoCapasParaDescripcion(
  elementos: ElementoVisual[],
  excluirId: string,
): { titulo?: string; subtitulo?: string } {
  const out: { titulo?: string; subtitulo?: string } = {};
  for (const e of elementos) {
    if (e.type !== "text" || e.id === excluirId) continue;
    const rol = inferirRolTextoCapa(e, elementos);
    const txt = (e.content || "").trim();
    if (!txt) continue;
    if (rol === "titulo") out.titulo = txt;
    if (rol === "subtitulo") out.subtitulo = txt;
  }
  return out;
}

export function labelRolTextoCapa(rol: RolTextoCapa | null): string {
  switch (rol) {
    case "descripcion":
      return "Descripción MP";
    case "titulo":
      return "Título";
    case "subtitulo":
      return "Subtítulo";
    default:
      return "Texto";
  }
}

export function nuevoGroupId(): string {
  return `g-${nuevoId()}`;
}

export function idsGrupo(elementos: ElementoVisual[], groupId: string): string[] {
  return elementos.filter((e) => e.groupId === groupId).map((e) => e.id);
}

export function resolverSeleccionAlClic(
  el: ElementoVisual,
  elementos: ElementoVisual[],
  prevIds: string[],
  shiftKey: boolean,
): string[] {
  if (shiftKey) {
    return prevIds.includes(el.id)
      ? prevIds.filter((id) => id !== el.id)
      : [...prevIds, el.id];
  }
  if (el.groupId) {
    return idsGrupo(elementos, el.groupId);
  }
  return [el.id];
}

export function agruparElementosPorIds(
  elementos: ElementoVisual[],
  ids: string[],
): ElementoVisual[] {
  const valid = new Set(ids.filter((id) => elementos.some((e) => e.id === id)));
  if (valid.size < 2) return elementos;
  const gid = nuevoGroupId();
  return elementos.map((e) => (valid.has(e.id) ? { ...e, groupId: gid } : e));
}

export function desagruparElementosPorIds(
  elementos: ElementoVisual[],
  ids: string[],
): ElementoVisual[] {
  const quitar = new Set(ids);
  return elementos.map((e) => {
    if (!quitar.has(e.id) || !e.groupId) return e;
    const { groupId: _g, ...rest } = e;
    return rest as ElementoVisual;
  });
}

export function seleccionTieneGrupo(
  elementos: ElementoVisual[],
  ids: string[],
): boolean {
  return ids.some((id) => elementos.find((e) => e.id === id)?.groupId);
}

/** Tras guardar: solo metadatos del servidor; geometría y capas quedan como en el lienzo. */
export function fusionarMetadatosPlantillaTrasGuardar(
  local: PlantillaVisualDoc,
  servidor: PlantillaVisualDoc,
): PlantillaVisualDoc {
  return {
    ...local,
    id: servidor.id || local.id,
    nombre: servidor.nombre ?? local.nombre,
    created_at: servidor.created_at ?? local.created_at,
    updated_at: servidor.updated_at ?? local.updated_at,
  };
}
