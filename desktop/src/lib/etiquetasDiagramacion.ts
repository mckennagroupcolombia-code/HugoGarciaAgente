/** Overrides de posición/color por bloque de texto en plantillas .ai (Studio). */

import type { EtiquetaStudioDatos } from "./etiquetasNormativa";

export type CampoDiagramacionId =
  | "titulo"
  | "subtitulo"
  | "b1"
  | "cas"
  | "concentracion"
  | "formula"
  | "peso"
  | "cuchara"
  | "legal"
  | "lote";

export type AlineacionTexto = "left" | "center" | "right" | "justify";

export interface CampoDiagramacion {
  /** Coordenada X (matrix SVG inner). */
  x?: number;
  /** Coordenada Y (matrix SVG inner). */
  y?: number;
  /** Color de relleno (#RRGGBB). */
  color?: string;
  /** Solo B1: ancho % hasta la línea vertical. */
  ancho_pct?: number;
  /** Escala tipográfica del bloque (0.6–1.8). */
  escala?: number;
  /** Alineación del texto en el bloque. */
  alineacion?: AlineacionTexto;
  visible?: boolean;
}

export const ALINEACIONES_TEXTO: {
  id: AlineacionTexto;
  label: string;
  title: string;
}[] = [
  { id: "left", label: "⫷", title: "Izquierda" },
  { id: "center", label: "☰", title: "Centro" },
  { id: "right", label: "⫸", title: "Derecha" },
  { id: "justify", label: "≡", title: "Justificado" },
];

export type DiagramacionEtiqueta = Partial<Record<CampoDiagramacionId, CampoDiagramacion>>;

/** Desplazamiento de líneas / recuadros decorativos (ids g0, g1… del SVG). */
export interface OffsetGrafico {
  x?: number;
  y?: number;
}

export type DiagramacionGraficos = Record<string, OffsetGrafico>;

export type SeleccionEditorId = CampoDiagramacionId | string;

export function esIdGrafico(id: string): boolean {
  return /^g\d+$/.test(id);
}

export function labelElementoEditor(id: string): string {
  if (esIdGrafico(id)) return `Gráfico · ${id}`;
  return labelCampoDiagramacion(id as CampoDiagramacionId);
}

/** Pixels por mm a 96 dpi (zoom 100% ≈ tamaño impresión en pantalla). */
export function mmAPx(mm: number, zoomPct = 100): number {
  return Math.round(mm * (96 / 25.4) * (zoomPct / 100));
}

/** Tamaño del canvas según formato de impresión (mm) y zoom. */
export function formatoCanvasPx(
  anchoMm: number,
  altoMm: number,
  zoomPct = 100,
): { width: number; height: number } {
  return {
    width: mmAPx(anchoMm, zoomPct),
    height: mmAPx(altoMm, zoomPct),
  };
}

export const CAMPOS_DIAGRAMACION: {
  id: CampoDiagramacionId;
  label: string;
  zona: string;
}[] = [
  { id: "titulo", label: "A1 · Título", zona: "Encabezado" },
  { id: "subtitulo", label: "A2 · Subtítulo", zona: "Encabezado" },
  { id: "lote", label: "Lote / Venc.", zona: "Encabezado" },
  { id: "b1", label: "B1 · Descripción", zona: "Columna izq." },
  { id: "cas", label: "C1 · CAS", zona: "Columna der." },
  { id: "concentracion", label: "C2 · Concentración", zona: "Columna der." },
  { id: "formula", label: "C3 · Fórmula", zona: "Columna der." },
  { id: "peso", label: "Peso neto", zona: "Pie" },
  { id: "cuchara", label: "Cuchara", zona: "Pie" },
  { id: "legal", label: "D1 · Legal", zona: "Pie" },
];

export function labelCampoDiagramacion(id: CampoDiagramacionId): string {
  return CAMPOS_DIAGRAMACION.find((c) => c.id === id)?.label ?? id;
}

export function b1AnchoPctEfectivo(
  diagramacion?: DiagramacionEtiqueta,
  legacy?: number,
): number {
  const fromDiag = diagramacion?.b1?.ancho_pct;
  const raw = fromDiag ?? legacy ?? 100;
  return Math.max(50, Math.min(100, Math.round(raw)));
}

export function patchDiagramacion(
  base: DiagramacionEtiqueta | undefined,
  campo: CampoDiagramacionId,
  patch: CampoDiagramacion,
): DiagramacionEtiqueta {
  return {
    ...(base ?? {}),
    [campo]: { ...(base?.[campo] ?? {}), ...patch },
  };
}

export function patchDiagramacionGraficos(
  base: DiagramacionGraficos | undefined,
  gid: string,
  patch: OffsetGrafico,
): DiagramacionGraficos {
  return {
    ...(base ?? {}),
    [gid]: { ...(base?.[gid] ?? {}), ...patch },
  };
}

export function escalaEfectiva(
  diagramacion: DiagramacionEtiqueta | undefined,
  campo: CampoDiagramacionId,
): number {
  const raw = diagramacion?.[campo]?.escala;
  if (raw == null || !Number.isFinite(raw)) return 1;
  return Math.max(0.6, Math.min(1.8, Math.round(raw * 100) / 100));
}

export type CampoTextoEditor = {
  multiline?: boolean;
  filas?: number;
  hint?: string;
  readonly?: boolean;
  getTexto: (d: EtiquetaStudioDatos) => string;
  patchTexto: (texto: string, d: EtiquetaStudioDatos) => Partial<EtiquetaStudioDatos>;
};

function stripPrefijo(texto: string, prefijo: string): string {
  const t = texto.trim();
  return t.toLowerCase().startsWith(prefijo.toLowerCase()) ? t.slice(prefijo.length).trim() : t;
}

/** Enlace capa diagramación ↔ campos de EtiquetaStudioDatos. */
export const TEXTO_POR_CAMPO: Partial<Record<CampoDiagramacionId, CampoTextoEditor>> = {
  titulo: {
    getTexto: (d) => d.nombre_producto ?? "",
    patchTexto: (t) => ({ nombre_producto: t }),
  },
  subtitulo: {
    multiline: true,
    filas: 2,
    getTexto: (d) => d.subtitulo ?? "",
    patchTexto: (t) => ({ subtitulo: t }),
  },
  b1: {
    multiline: true,
    filas: 6,
    getTexto: (d) => d.descripcion_etiqueta ?? "",
    patchTexto: (t) => ({ descripcion_etiqueta: t }),
  },
  cas: {
    hint: "Número CAS sin el prefijo # CAS:",
    getTexto: (d) => stripPrefijo(d.cas ?? "", "# CAS:").replace(/^#\s*/, ""),
    patchTexto: (t) => ({ cas: t.replace(/^#\s*/, "").trim() }),
  },
  concentracion: {
    hint: "Valor sin «Concentración:»",
    getTexto: (d) => stripPrefijo(d.concentracion ?? "", "Concentración:"),
    patchTexto: (t) => ({ concentracion: t.trim() }),
  },
  formula: {
    hint: "Fórmula sin «Fórmula molecular:»",
    getTexto: (d) => stripPrefijo(d.formula_molecular ?? "", "Fórmula molecular:"),
    patchTexto: (t) => ({ formula_molecular: t.trim() }),
  },
  peso: {
    hint: "Ej: 500 g",
    getTexto: (d) => `${d.contenido_neto ?? ""} ${d.unidad ?? ""}`.trim(),
    patchTexto: (t, d) => {
      const m = t.trim().match(/^([\d.,]+)\s*(.*)$/);
      if (!m) return { contenido_neto: t.trim(), unidad: d.unidad ?? "g" };
      return { contenido_neto: m[1], unidad: (m[2] || "g").trim() };
    },
  },
  cuchara: {
    multiline: true,
    filas: 2,
    getTexto: (d) => d.texto_cuchara ?? "",
    patchTexto: (t) => ({ texto_cuchara: t, incluye_cuchara: !!t.trim() }),
  },
  lote: {
    multiline: true,
    filas: 2,
    hint: "Línea 1: lote · Línea 2: vencimiento (AAAA-MM)",
    getTexto: (d) =>
      [d.lote ? `LOT. ${d.lote}` : "", d.vencimiento ? `EXP. ${d.vencimiento}` : ""]
        .filter(Boolean)
        .join("\n"),
    patchTexto: (t) => {
      const lineas = t.split("\n").map((l) => l.trim()).filter(Boolean);
      let lote = "";
      let venc = "";
      for (const ln of lineas) {
        const lot = ln.match(/^LOT\.?\s*:?\s*(.+)$/i);
        const exp = ln.match(/^EXP\.?\s*:?\s*(.+)$/i);
        if (lot) lote = lot[1].trim();
        else if (exp) venc = exp[1].trim();
        else if (!lote) lote = ln;
        else venc = ln;
      }
      return { lote, vencimiento: venc };
    },
  },
  legal: {
    multiline: true,
    filas: 3,
    hint: "Distribuidor · NIT · Ciudad (una línea cada uno)",
    getTexto: (d) =>
      [d.distribuidor ?? "", d.nit ? `NIT. ${d.nit}` : "", d.ciudad ?? ""]
        .filter(Boolean)
        .join("\n"),
    patchTexto: (t) => {
      const lineas = t.split("\n").map((l) => l.trim()).filter(Boolean);
      const distribuidor = lineas[0] ?? "";
      let nit = "";
      let ciudad = "";
      for (const ln of lineas.slice(1)) {
        const nm = ln.match(/^NIT\.?\s*:?\s*(.+)$/i);
        if (nm) nit = nm[1].trim();
        else ciudad = ln;
      }
      const patch: Partial<EtiquetaStudioDatos> = { distribuidor, ciudad };
      if (nit) patch.nit = nit;
      return patch;
    },
  },
};

export function editorTextoCampo(
  id: CampoDiagramacionId,
): CampoTextoEditor | undefined {
  return TEXTO_POR_CAMPO[id];
}
