/**
 * Plantilla paramétrica «Ficha técnica MP» (layout tipo SCI).
 * Un color primario pinta bordes, títulos, iconos y el badge de peso.
 * El tamaño sale del formato de lienzo elegido (mm o px).
 */
import { generarEAN13, svgToDataUrl } from "./ean13";
import type { TipoEtiqueta } from "./etiquetasTipos";
import {
  ajustarTamanoTexto,
  FUENTE_MONTSERRAT_FAMILY,
  nuevoId,
  tipoEtiquetaToFormato,
  type ElementoImagen,
  type ElementoLinea,
  type ElementoRect,
  type ElementoTexto,
  type ElementoVisual,
  type FormatoCanvas,
  type PlantillaVisualDoc,
  type RolTextoCapa,
} from "./plantillasVisuales";

export const COLOR_FICHA_MP_DEFAULT = "#3d246b";
export const COLOR_FICHA_MP_TEXTO = "#1a1a1a";
export const COLOR_FICHA_MP_ALERTA = "#c41e3a";

export const COLORES_FICHA_MP_PRESET: { id: string; label: string; hex: string }[] = [
  { id: "violeta", label: "Violeta SCI", hex: "#3d246b" },
  { id: "teal", label: "Teal McKenna", hex: "#0f766e" },
  { id: "navy", label: "Azul marino", hex: "#1e3a5f" },
  { id: "verde", label: "Verde bosque", hex: "#14532d" },
  { id: "vino", label: "Vino", hex: "#9f1239" },
  { id: "terracota", label: "Terracota", hex: "#7c2d12" },
];

export type IconoFichaMp = "burbujas" | "gota" | "ph" | "matraz" | "mortero" | "frasco" | "alerta";

export interface FeatureFichaMp {
  titulo: string;
  icono: IconoFichaMp;
  subtitulo?: string;
  /** URL de galería (/api/etiquetas/recursos-png/…) que sustituye el icono dibujado. */
  iconoSrc?: string;
}

export interface DatosFichaTecnicaMp {
  abreviatura: string;
  nombre: string;
  tagline: string;
  concentracionLabel: string;
  concentracionValor: string;
  casLabel: string;
  cas: string;
  descripcion: string;
  features: FeatureFichaMp[];
  aplicacionesTitulo: string;
  aplicaciones: string;
  incorporacionTitulo: string;
  incorporacion: string;
  peso: string;
  marca: string;
  atencionTitulo: string;
  atencionTexto: string;
  almacenamiento: string;
  desarrolladoPor: string;
  empresa: string;
  nit: string;
  ciudad: string;
  web: string;
  ean13: string;
  /** Iconos de sección sustituidos desde la galería. */
  iconoAplicacionesSrc?: string;
  iconoIncorporacionSrc?: string;
  iconoAlmacenamientoSrc?: string;
  /** Pictograma GHS (data URL SVG). Vacío = rombo de atención por defecto. */
  ghsSrc?: string;
  ghsCodigo?: string;
}

export type LineaIndividualFichaMp =
  | "borde_exterior"
  | "divisoria_central"
  | "tagline"
  | "specs"
  | "desc"
  | "feats"
  | "aplicaciones"
  | "incorporacion"
  | "peso"
  | "cajas_specs"
  | "cajas_feats"
  | "marca"
  | "atencion"
  | "almacenamiento";

export const LISTA_LINEAS_FICHA_MP: {
  id: LineaIndividualFichaMp;
  label: string;
  seccion: "Estructura general" | "Columna Izquierda" | "Columna Derecha";
}[] = [
  { id: "borde_exterior", label: "Borde exterior perimetral", seccion: "Estructura general" },
  { id: "divisoria_central", label: "Línea divisoria central (vertical)", seccion: "Estructura general" },
  { id: "tagline", label: "Línea bajo Tagline / Subtítulo", seccion: "Columna Izquierda" },
  { id: "specs", label: "Línea bajo Concentración & CAS", seccion: "Columna Izquierda" },
  { id: "cajas_specs", label: "Bordes de cajas Concentración & CAS", seccion: "Columna Izquierda" },
  { id: "desc", label: "Línea bajo Descripción", seccion: "Columna Izquierda" },
  { id: "feats", label: "Línea bajo Atributos destacados", seccion: "Columna Izquierda" },
  { id: "cajas_feats", label: "Bordes de cajas de Atributos", seccion: "Columna Izquierda" },
  { id: "aplicaciones", label: "Línea bajo Aplicaciones", seccion: "Columna Izquierda" },
  { id: "incorporacion", label: "Línea bajo Modo de Empleo / Incorporación", seccion: "Columna Izquierda" },
  { id: "peso", label: "Líneas laterales del Contenido Neto", seccion: "Columna Izquierda" },
  { id: "marca", label: "Línea bajo Marca", seccion: "Columna Derecha" },
  { id: "atencion", label: "Línea bajo Advertencia / Atención", seccion: "Columna Derecha" },
  { id: "almacenamiento", label: "Línea bajo Almacenamiento", seccion: "Columna Derecha" },
];

/** Multiplicadores sobre el diseño de referencia (1 = original). */
export interface EstiloFichaMp {
  tipoTitulo: number;
  tipoNombre: number;
  tipoCuerpo: number;
  tipoCajas: number;
  tipoAdvertencia?: number;
  tipoMarca?: number;
  tamIconos: number;
  tamIconosBandas?: number;
  tamIconoAlmacen?: number;
  tamCajas: number;
  radioCajas: number;
  bordeCajas?: number;
  modoRellenoCajas?: "transparente" | "solido" | "suave" | "personalizado";
  colorFondoCajas?: string;
  tamGhs?: number;
  tamEan?: number;
  /** Visibilidad / ocultación de líneas divisorias o bordes globales */
  ocultarBordeExterior?: boolean;
  ocultarLineaDivisoriaCentral?: boolean;
  ocultarLineasFilas?: boolean;
  ocultarBordeCajas?: boolean;
  /** Mapa de líneas y bordes específicos eliminados/ocultos individualmente */
  lineasOcultas?: Partial<Record<LineaIndividualFichaMp, boolean>>;
  /** Estilo por campo de texto (tamaño relativo + negrita) al editar en el formulario. */
  campos?: Partial<Record<CampoTextoFichaMp, EstiloCampoTextoFichaMp>>;
}

export type CampoTextoFichaMp =
  | "abreviatura"
  | "nombre"
  | "tagline"
  | "concentracion"
  | "cas"
  | "descripcion"
  | "feat0"
  | "feat1"
  | "feat2"
  | "aplicaciones"
  | "incorporacion"
  | "peso"
  | "atencion"
  | "almacenamiento"
  | "marca";

export interface EstiloCampoTextoFichaMp {
  /** Multiplicador sobre el tamaño base del bloque (1 = sin cambio). */
  escala: number;
  bold: boolean;
}

export const CAMPOS_TEXTO_FICHA_MP: {
  id: CampoTextoFichaMp;
  label: string;
  boldDefault: boolean;
}[] = [
  { id: "abreviatura", label: "Abreviatura", boldDefault: true },
  { id: "nombre", label: "Nombre del producto", boldDefault: true },
  { id: "tagline", label: "Tagline", boldDefault: false },
  { id: "concentracion", label: "Concentración", boldDefault: true },
  { id: "cas", label: "CAS", boldDefault: true },
  { id: "descripcion", label: "Descripción", boldDefault: false },
  { id: "feat0", label: "Destacado 1", boldDefault: true },
  { id: "feat1", label: "Destacado 2", boldDefault: true },
  { id: "feat2", label: "Destacado 3", boldDefault: true },
  { id: "aplicaciones", label: "Aplicaciones", boldDefault: false },
  { id: "incorporacion", label: "Incorporación", boldDefault: false },
  { id: "peso", label: "Contenido neto", boldDefault: true },
  { id: "marca", label: "Marca", boldDefault: true },
  { id: "atencion", label: "Advertencia", boldDefault: false },
  { id: "almacenamiento", label: "Almacenamiento", boldDefault: false },
];

export const ESTILO_FICHA_MP_DEFAULT: EstiloFichaMp = {
  tipoTitulo: 1,
  tipoNombre: 1,
  tipoCuerpo: 1,
  tipoCajas: 1,
  tipoAdvertencia: 1,
  tipoMarca: 1,
  tamIconos: 1,
  tamIconosBandas: 1,
  tamIconoAlmacen: 1,
  tamCajas: 1,
  radioCajas: 1,
  bordeCajas: 1,
  modoRellenoCajas: "transparente",
  colorFondoCajas: "",
  tamGhs: 1,
  tamEan: 1,
  ocultarBordeExterior: false,
  ocultarLineaDivisoriaCentral: false,
  ocultarLineasFilas: false,
  ocultarBordeCajas: false,
  lineasOcultas: {},
  campos: {},
};

export function estiloCampoFichaMp(
  estilo: EstiloFichaMp,
  id: CampoTextoFichaMp,
): EstiloCampoTextoFichaMp {
  const meta = CAMPOS_TEXTO_FICHA_MP.find((c) => c.id === id);
  const raw = estilo.campos?.[id];
  const n = typeof raw?.escala === "number" ? raw.escala : Number(raw?.escala);
  const escala = Number.isFinite(n) ? Math.min(2.5, Math.max(0.4, n)) : 1;
  return {
    escala,
    bold: typeof raw?.bold === "boolean" ? raw.bold : Boolean(meta?.boldDefault),
  };
}

export const DATOS_FICHA_MP_VACIA: DatosFichaTecnicaMp = {
  abreviatura: "",
  nombre: "",
  tagline: "",
  concentracionLabel: "CONCENTRACIÓN",
  concentracionValor: "",
  casLabel: "CAS",
  cas: "",
  descripcion: "",
  features: [
    { titulo: "", icono: "burbujas" },
    { titulo: "", icono: "gota" },
    { titulo: "", icono: "ph", subtitulo: "pH" },
  ],
  aplicacionesTitulo: "APLICACIONES",
  aplicaciones: "",
  incorporacionTitulo: "INCORPORACIÓN",
  incorporacion: "",
  peso: "250 g",
  marca: "MCKENNA GROUP®",
  atencionTitulo: "ATENCIÓN",
  atencionTexto: "",
  almacenamiento: "",
  desarrolladoPor: "Desarrollado por:",
  empresa: "MCKENNA GROUP S.A.S.",
  nit: "NIT. 901316016-3",
  ciudad: "BOGOTÁ — COLOMBIA",
  web: "mckennagroup.co",
  ean13: "",
};

export function crearDatosFichaMpVacios(peso = "250 g"): DatosFichaTecnicaMp {
  return {
    ...DATOS_FICHA_MP_VACIA,
    peso,
    features: [
      { titulo: "", icono: "burbujas" },
      { titulo: "", icono: "gota" },
      { titulo: "", icono: "ph", subtitulo: "pH" },
    ],
  };
}

export function esFichaMpVacia(datos: DatosFichaTecnicaMp): boolean {
  return (
    !datos.nombre?.trim() &&
    !datos.abreviatura?.trim() &&
    !datos.descripcion?.trim() &&
    !datos.aplicaciones?.trim() &&
    !datos.incorporacion?.trim() &&
    !datos.atencionTexto?.trim() &&
    !datos.cas?.trim()
  );
}

export const DATOS_EJEMPLO_SCI: DatosFichaTecnicaMp = {
  abreviatura: "SCI",
  nombre: "COCOIL ISETIONATO DE SODIO",
  tagline: "Tensioactivo suave  •  Materia prima cosmética",
  concentracionLabel: "CONCENTRACIÓN",
  concentracionValor: "90%",
  casLabel: "CAS",
  cas: "61789-32-0",
  descripcion:
    "Derivado de ácidos grasos del coco. Se presenta en polvo o gránulos de color blanco a crema.",
  features: [
    { titulo: "ESPUMA CREMOSA", icono: "burbujas" },
    { titulo: "LIMPIEZA SUAVE", icono: "gota" },
    { titulo: "pH RECOMENDADO 5–7", icono: "ph", subtitulo: "pH" },
  ],
  aplicacionesTitulo: "APLICACIONES",
  aplicaciones: "Champú sólido  •  Barras syndet  •  Limpiadores faciales",
  incorporacionTitulo: "INCORPORACIÓN",
  incorporacion:
    "Dispersar con agitación moderada. Para formulación; no aplicar directamente.",
  peso: "250 g",
  marca: "MCKENNA GROUP®",
  atencionTitulo: "ATENCIÓN",
  atencionTexto:
    "Puede causar irritación ocular y respiratoria por exposición al polvo. Evite inhalar y use protección adecuada.",
  almacenamiento: "Conservar bien cerrado, en lugar fresco, seco y protegido de la luz.",
  desarrolladoPor: "Desarrollado por:",
  empresa: "MCKENNA GROUP S.A.S.",
  nit: "NIT. 901316016-3",
  ciudad: "BOGOTÁ — COLOMBIA",
  web: "mckennagroup.co",
  ean13: "7701602502633",
};

function svgDataUrl(inner: string, color: string, viewBox = "0 0 64 64"): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="none" ` +
    `stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">` +
    inner +
    `</svg>`;
  return svgToDataUrl(svg);
}

function iconoSvg(kind: IconoFichaMp, color: string): string {
  switch (kind) {
    case "burbujas":
      return svgDataUrl(
        `<circle cx="22" cy="40" r="11"/><circle cx="40" cy="28" r="9"/><circle cx="50" cy="44" r="6"/>` +
          `<circle cx="18" cy="22" r="4"/>`,
        color,
      );
    case "gota":
      return svgDataUrl(
        `<path d="M32 6C32 6 14 28 14 40a18 18 0 0 0 36 0C50 28 32 6 32 6z"/>` +
          `<path d="M32 26c6 4 8 10 6 18"/>`,
        color,
      );
    case "matraz":
      return svgDataUrl(
        `<path d="M26 6h12v16l12 26a10 10 0 0 1-9 14H23a10 10 0 0 1-9-14L26 22z"/>` +
          `<path d="M24 22h16"/><path d="M22 48h20"/>`,
        color,
      );
    case "mortero":
      return svgDataUrl(
        `<ellipse cx="30" cy="38" rx="18" ry="8"/>` +
          `<path d="M14 38v8c0 6 7 12 16 12s16-6 16-12v-8"/>` +
          `<path d="M46 10 L28 34"/>`,
        color,
      );
    case "frasco":
      return svgDataUrl(
        `<rect x="20" y="20" width="24" height="34" rx="4"/>` +
          `<rect x="24" y="10" width="16" height="12" rx="2"/>` +
          `<path d="M26 34h12"/>`,
        color,
      );
    case "alerta": {
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
        `<path d="M32 6 L58 32 L32 58 L6 32 Z" fill="none" stroke="${COLOR_FICHA_MP_ALERTA}" ` +
        `stroke-width="3.2" stroke-linejoin="round"/>` +
        `<rect x="29.2" y="18" width="5.6" height="22" rx="1.6" fill="#111111"/>` +
        `<circle cx="32" cy="48" r="3.2" fill="#111111"/>` +
        `</svg>`;
      return svgToDataUrl(svg);
    }
    case "ph":
      return "";
  }
}

function r(
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { fill?: string; stroke?: string; sw?: number; radius?: number; z?: number; nombre?: string },
): ElementoRect {
  return {
    id: nuevoId(),
    type: "rect",
    x,
    y,
    width: w,
    height: h,
    rotation: 0,
    zIndex: opts.z ?? 1,
    fill: opts.fill ?? "transparent",
    stroke: opts.stroke ?? "transparent",
    strokeWidth: opts.sw ?? 0,
    borderRadius: opts.radius ?? 0,
    nombreCapa: opts.nombre,
  };
}

function ln(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke: string,
  sw: number,
  nombre?: string,
): ElementoLinea {
  return {
    id: nuevoId(),
    type: "line",
    x: x1,
    y: y1,
    x2,
    y2,
    width: Math.max(1, Math.hypot(x2 - x1, y2 - y1)),
    height: Math.max(1, sw),
    rotation: 0,
    zIndex: 2,
    stroke,
    strokeWidth: sw,
    nombreCapa: nombre,
  };
}

function tx(opts: {
  x: number;
  y: number;
  w: number;
  content: string;
  size: number;
  color: string;
  weight?: string;
  align?: ElementoTexto["align"];
  lines?: number;
  lh?: number;
  z?: number;
  nombre?: string;
  role?: RolTextoCapa;
  h?: number;
}): ElementoTexto {
  const lh = opts.lh ?? 1.2;
  const lines = opts.lines ?? Math.max(1, (opts.content.match(/\n/g)?.length ?? 0) + 1);
  return {
    id: nuevoId(),
    type: "text",
    x: opts.x,
    y: opts.y,
    width: opts.w,
    height: opts.h ?? Math.ceil(opts.size * lh * lines * 1.08),
    rotation: 0,
    zIndex: opts.z ?? 3,
    content: opts.content,
    fontSize: ajustarTamanoTexto(opts.size),
    fontFamily: FUENTE_MONTSERRAT_FAMILY,
    fontWeight: opts.weight ?? "600",
    color: opts.color,
    align: opts.align ?? "left",
    lineHeight: lh,
    nombreCapa: opts.nombre,
    textRole: opts.role,
  };
}

function img(
  x: number,
  y: number,
  w: number,
  h: number,
  src: string,
  nombre?: string,
): ElementoImagen {
  return {
    id: nuevoId(),
    type: "image",
    x,
    y,
    width: w,
    height: h,
    rotation: 0,
    zIndex: 4,
    src,
    objectFit: "contain",
    nombreCapa: nombre,
  };
}

export function fusionarDatosFichaMp(parcial?: Partial<DatosFichaTecnicaMp>): DatosFichaTecnicaMp {
  const base = DATOS_EJEMPLO_SCI;
  if (!parcial) return { ...base, features: base.features.map((f) => ({ ...f })) };
  const features = (parcial.features?.length ? parcial.features : base.features).map((f, i) => ({
    ...(base.features[i] || base.features[0]),
    ...f,
  }));
  return {
    ...base,
    ...parcial,
    features,
  };
}

function clampEstilo(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(2.5, Math.max(0.4, n));
}

export function fusionarEstiloFichaMp(
  parcial?: Partial<EstiloFichaMp> | Record<string, unknown> | null,
): EstiloFichaMp {
  const d = ESTILO_FICHA_MP_DEFAULT;
  const p = (parcial && typeof parcial === "object" ? parcial : {}) as Partial<EstiloFichaMp>;
  const camposIn = p.campos && typeof p.campos === "object" ? p.campos : {};
  const campos: Partial<Record<CampoTextoFichaMp, EstiloCampoTextoFichaMp>> = {};
  for (const meta of CAMPOS_TEXTO_FICHA_MP) {
    const c = (camposIn as Record<string, unknown>)[meta.id];
    if (!c || typeof c !== "object") continue;
    const row = c as Partial<EstiloCampoTextoFichaMp>;
    campos[meta.id] = {
      escala: clampEstilo(row.escala, 1),
      bold: typeof row.bold === "boolean" ? row.bold : meta.boldDefault,
    };
  }
  const lineasIn = p.lineasOcultas && typeof p.lineasOcultas === "object" ? p.lineasOcultas : {};
  const lineasOcultas: Partial<Record<LineaIndividualFichaMp, boolean>> = {};
  for (const item of LISTA_LINEAS_FICHA_MP) {
    if ((lineasIn as Record<string, unknown>)[item.id] === true) {
      lineasOcultas[item.id] = true;
    }
  }

  return {
    tipoTitulo: clampEstilo(p.tipoTitulo, d.tipoTitulo),
    tipoNombre: clampEstilo(p.tipoNombre, d.tipoNombre),
    tipoCuerpo: clampEstilo(p.tipoCuerpo, d.tipoCuerpo),
    tipoCajas: clampEstilo(p.tipoCajas, d.tipoCajas),
    tipoAdvertencia: clampEstilo(p.tipoAdvertencia, d.tipoAdvertencia ?? 1),
    tipoMarca: clampEstilo(p.tipoMarca, d.tipoMarca ?? 1),
    tamIconos: clampEstilo(p.tamIconos, d.tamIconos),
    tamIconosBandas: clampEstilo(p.tamIconosBandas, d.tamIconosBandas ?? 1),
    tamIconoAlmacen: clampEstilo(p.tamIconoAlmacen, d.tamIconoAlmacen ?? 1),
    tamCajas: clampEstilo(p.tamCajas, d.tamCajas),
    radioCajas: clampEstilo(p.radioCajas, d.radioCajas),
    bordeCajas: clampEstilo(p.bordeCajas, d.bordeCajas ?? 1),
    modoRellenoCajas:
      p.modoRellenoCajas === "solido" ||
      p.modoRellenoCajas === "suave" ||
      p.modoRellenoCajas === "personalizado"
        ? p.modoRellenoCajas
        : "transparente",
    colorFondoCajas: typeof p.colorFondoCajas === "string" ? p.colorFondoCajas : "",
    tamGhs: clampEstilo(p.tamGhs, d.tamGhs ?? 1),
    tamEan: clampEstilo(p.tamEan, d.tamEan ?? 1),
    ocultarBordeExterior: Boolean(p.ocultarBordeExterior),
    ocultarLineaDivisoriaCentral: Boolean(p.ocultarLineaDivisoriaCentral),
    ocultarLineasFilas: Boolean(p.ocultarLineasFilas),
    ocultarBordeCajas: Boolean(p.ocultarBordeCajas),
    lineasOcultas,
    campos,
  };
}

export function esPlantillaFichaMp(doc: Pick<PlantillaVisualDoc, "ficha_mp">): boolean {
  return Boolean(doc.ficha_mp && typeof doc.ficha_mp === "object");
}

export function parsearFichaMpDePlantilla(
  doc: Pick<PlantillaVisualDoc, "ficha_mp" | "formato">,
): { color: string; tipoNombre: string; datos: DatosFichaTecnicaMp; estilo: EstiloFichaMp } | null {
  const raw = doc.ficha_mp;
  if (!raw || typeof raw !== "object") return null;
  const color =
    typeof raw.color === "string" && raw.color.trim() ? raw.color.trim() : COLOR_FICHA_MP_DEFAULT;
  const tipoNombre =
    (typeof raw.tipo_nombre === "string" && raw.tipo_nombre.trim()) ||
    doc.formato?.tipo_etiqueta ||
    "Ficha MP";
  const datosRaw =
    raw.datos && typeof raw.datos === "object"
      ? (raw.datos as Partial<DatosFichaTecnicaMp>)
      : undefined;
  return {
    color,
    tipoNombre,
    datos: fusionarDatosFichaMp(datosRaw),
    estilo: fusionarEstiloFichaMp(raw.estilo as Partial<EstiloFichaMp>),
  };
}

/** Lienzo demasiado chico para este layout (el texto queda ilegible). */
export function fichaMpFormatoAprietado(formato: FormatoCanvas): boolean {
  return Math.min(formato.ancho_px, formato.alto_px) < 280;
}

export function plantillaFichaTecnicaMp(opts: {
  formato: FormatoCanvas;
  categoria: string;
  carpeta?: string;
  colorPrimario?: string;
  datos?: Partial<DatosFichaTecnicaMp>;
}): PlantillaVisualDoc {
  const formato = opts.formato;
  const color = (opts.colorPrimario || COLOR_FICHA_MP_DEFAULT).trim() || COLOR_FICHA_MP_DEFAULT;
  const ink = COLOR_FICHA_MP_TEXTO;
  const d = fusionarDatosFichaMp(opts.datos);
  const W = Math.max(1, formato.ancho_px);
  const H = Math.max(1, formato.alto_px);
  const u = Math.min(W, H);
  const m = Math.max(8, u * 0.028);
  const sw = Math.max(1.1, u * 0.0032);
  const radius = Math.max(4, u * 0.018);
  const gap = Math.max(5, W * 0.012);
  const innerX = m;
  const innerY = m;
  const innerW = W - 2 * m;
  const innerH = H - 2 * m;
  const split = innerX + innerW * 0.645;
  const leftX = innerX + gap;
  const leftW = split - innerX - gap * 1.6;
  const rightX = split + gap;
  const rightW = innerX + innerW - gap - rightX;

  const fs = (pct: number, min = 5.5) => Math.max(min, u * pct);

  const els: ElementoVisual[] = [];

  els.push(
    r(2, 2, W - 4, H - 4, {
      fill: "#ffffff",
      stroke: color,
      sw,
      radius: Math.max(2, u * 0.008),
      z: 0,
      nombre: "Marco",
    }),
  );
  els.push(ln(split, innerY + gap * 0.4, split, innerY + innerH - gap * 0.4, color, sw, "Divisor"));

  const band = (from: number, to: number) => {
    const y0 = innerY + innerH * from;
    return { y: y0, h: innerH * (to - from) };
  };

  // ── Columna izquierda (bandas % del alto interior) ─────────────
  const hdr = band(0.01, 0.175);
  let y = hdr.y;
  const abbrSize = fs(0.078, 14);
  els.push(
    tx({
      x: leftX,
      y,
      w: leftW,
      content: d.abreviatura,
      size: abbrSize,
      color,
      weight: "800",
      align: "center",
      nombre: "Abreviatura",
      role: "titulo",
    }),
  );
  y += abbrSize * 1.12;

  const nameSize = fs(0.032, 8);
  els.push(
    tx({
      x: leftX,
      y,
      w: leftW,
      content: d.nombre,
      size: nameSize,
      color,
      weight: "700",
      align: "center",
      lines: d.nombre.length > 28 ? 2 : 1,
      nombre: "Nombre producto",
      role: "titulo",
    }),
  );
  y += nameSize * (d.nombre.length > 28 ? 2.4 : 1.35);

  const tagSize = fs(0.02, 6);
  els.push(
    tx({
      x: leftX,
      y,
      w: leftW,
      content: d.tagline,
      size: tagSize,
      color,
      weight: "500",
      align: "center",
      nombre: "Tagline",
      role: "subtitulo",
    }),
  );
  y += tagSize * 1.7;

  const spec = band(0.175, 0.248);
  const boxH = spec.h;
  const boxW = (leftW - gap) / 2;
  y = spec.y;
  els.push(
    r(leftX, y, boxW, boxH, {
      fill: "#ffffff",
      stroke: color,
      sw,
      radius,
      z: 1,
      nombre: "Caja concentración",
    }),
  );
  els.push(
    r(leftX + boxW + gap, y, boxW, boxH, {
      fill: "#ffffff",
      stroke: color,
      sw,
      radius,
      z: 1,
      nombre: "Caja CAS",
    }),
  );
  const specSize = fs(0.018, 5.5);
  const specPad = boxH * 0.12;
  els.push(
    tx({
      x: leftX + 4,
      y: y + specPad,
      w: boxW - 8,
      content: `${d.concentracionLabel}\n${d.concentracionValor}`,
      size: specSize,
      color,
      weight: "700",
      align: "center",
      lines: 2,
      lh: 1.25,
      h: boxH - specPad * 2,
      nombre: "Concentración",
    }),
  );
  els.push(
    tx({
      x: leftX + boxW + gap + 4,
      y: y + specPad,
      w: boxW - 8,
      content: `${d.casLabel}\n${d.cas}`,
      size: specSize,
      color,
      weight: "700",
      align: "center",
      lines: 2,
      lh: 1.25,
      h: boxH - specPad * 2,
      nombre: "CAS",
    }),
  );

  const descBand = band(0.255, 0.385);
  const descSize = fs(0.02, 6);
  els.push(
    tx({
      x: leftX,
      y: descBand.y,
      w: leftW,
      content: d.descripcion,
      size: descSize,
      color: ink,
      weight: "400",
      align: "center",
      lines: 5,
      lh: 1.28,
      h: descBand.h,
      nombre: "Descripción",
      role: "descripcion",
    }),
  );

  const feat = band(0.39, 0.535);
  const featH = feat.h;
  const featGap = gap * 0.7;
  const featW = (leftW - featGap * 2) / 3;
  const iconSide = Math.min(featW * 0.42, featH * 0.38);
  d.features.slice(0, 3).forEach((f, i) => {
    const fx = leftX + i * (featW + featGap);
    els.push(
      r(fx, feat.y, featW, featH, {
        fill: "#ffffff",
        stroke: color,
        sw,
        radius,
        z: 1,
        nombre: `Caja ${f.titulo}`,
      }),
    );
    if (f.icono === "ph") {
      const phSize = fs(0.042, 10);
      els.push(
        tx({
          x: fx,
          y: feat.y + featH * 0.12,
          w: featW,
          content: f.subtitulo || "pH",
          size: phSize,
          color,
          weight: "800",
          align: "center",
          nombre: "Icono pH",
        }),
      );
    } else {
      const src = iconoSvg(f.icono, color);
      if (src) {
        els.push(
          img(
            fx + (featW - iconSide) / 2,
            feat.y + featH * 0.1,
            iconSide,
            iconSide,
            src,
            `Icono ${f.titulo}`,
          ),
        );
      }
    }
    const capSize = fs(0.016, 5);
    els.push(
      tx({
        x: fx + 3,
        y: feat.y + featH * 0.58,
        w: featW - 6,
        content: f.titulo,
        size: capSize,
        color,
        weight: "700",
        align: "center",
        lines: 2,
        h: featH * 0.38,
        nombre: f.titulo,
      }),
    );
  });

  const rowIcon = Math.max(18, u * 0.055);
  const addSeccion = (
    from: number,
    to: number,
    titulo: string,
    cuerpo: string,
    icono: IconoFichaMp,
    capa: string,
  ) => {
    const b = band(from, to);
    els.push(ln(leftX, b.y, leftX + leftW, b.y, color, sw, `Línea ${capa}`));
    const iy = b.y + gap * 0.4;
    const src = iconoSvg(icono, color);
    if (src) els.push(img(leftX, iy, rowIcon, rowIcon, src, `Icono ${capa}`));
    const textX = leftX + rowIcon + gap * 0.6;
    const textW = leftW - rowIcon - gap * 0.6;
    const tSize = fs(0.02, 6);
    els.push(
      tx({
        x: textX,
        y: iy,
        w: textW,
        content: titulo,
        size: tSize,
        color,
        weight: "800",
        nombre: titulo,
      }),
    );
    const bodySize = fs(0.017, 5.5);
    const bodyY = iy + tSize * 1.2;
    els.push(
      tx({
        x: textX,
        y: bodyY,
        w: textW,
        content: cuerpo,
        size: bodySize,
        color: ink,
        weight: "400",
        lines: 3,
        lh: 1.25,
        h: Math.max(20, b.y + b.h - bodyY - gap * 0.5),
        nombre: `Texto ${capa}`,
      }),
    );
    els.push(ln(leftX, b.y + b.h, leftX + leftW, b.y + b.h, color, sw, `Línea fin ${capa}`));
  };

  addSeccion(0.55, 0.695, d.aplicacionesTitulo, d.aplicaciones, "matraz", "aplicaciones");
  addSeccion(0.71, 0.855, d.incorporacionTitulo, d.incorporacion, "mortero", "incorporacion");

  const badge = band(0.875, 0.98);
  const badgeH = Math.min(badge.h, Math.max(22, H * 0.05));
  const badgeW = Math.min(leftW * 0.42, Math.max(72, W * 0.18));
  const badgeX = leftX + (leftW - badgeW) / 2;
  const badgeY = badge.y + (badge.h - badgeH) / 2;
  els.push(
    r(badgeX, badgeY, badgeW, badgeH, {
      fill: color,
      stroke: color,
      sw: 0,
      radius: badgeH / 2,
      z: 2,
      nombre: "Badge peso",
    }),
  );
  els.push(
    tx({
      x: badgeX,
      y: badgeY + badgeH * 0.18,
      w: badgeW,
      content: d.peso,
      size: fs(0.028, 8),
      color: "#ffffff",
      weight: "800",
      align: "center",
      h: badgeH * 0.7,
      z: 5,
      nombre: "Peso",
    }),
  );

  // ── Columna derecha ────────────────────────────────────────────
  const brandB = band(0.015, 0.09);
  els.push(
    tx({
      x: rightX,
      y: brandB.y,
      w: rightW,
      content: d.marca,
      size: fs(0.022, 6.5),
      color,
      weight: "800",
      align: "center",
      nombre: "Marca",
    }),
  );

  const warnB = band(0.1, 0.4);
  const warnIcon = Math.max(22, Math.min(u * 0.07, warnB.h * 0.28));
  els.push(
    img(
      rightX + (rightW - warnIcon) / 2,
      warnB.y,
      warnIcon,
      warnIcon,
      iconoSvg("alerta", color),
      "Pictograma atención",
    ),
  );
  els.push(
    tx({
      x: rightX,
      y: warnB.y + warnIcon + gap * 0.25,
      w: rightW,
      content: d.atencionTitulo,
      size: fs(0.022, 6.5),
      color,
      weight: "800",
      align: "center",
      nombre: "Atención título",
    }),
  );
  els.push(
    tx({
      x: rightX,
      y: warnB.y + warnIcon + gap * 0.25 + fs(0.022, 6.5) * 1.3,
      w: rightW,
      content: d.atencionTexto,
      size: fs(0.016, 5),
      color: ink,
      weight: "400",
      align: "center",
      lines: 6,
      lh: 1.25,
      h: warnB.h * 0.5,
      nombre: "Atención texto",
    }),
  );

  const stor = band(0.415, 0.56);
  els.push(ln(rightX, stor.y, rightX + rightW, stor.y, color, sw, "Línea almacenamiento"));
  const jar = Math.max(16, u * 0.05);
  els.push(img(rightX, stor.y + gap * 0.4, jar, jar, iconoSvg("frasco", color), "Icono almacenamiento"));
  els.push(
    tx({
      x: rightX + jar + gap * 0.4,
      y: stor.y + gap * 0.4,
      w: rightW - jar - gap * 0.4,
      content: d.almacenamiento,
      size: fs(0.016, 5),
      color: ink,
      weight: "400",
      lines: 4,
      h: stor.h - gap,
      nombre: "Almacenamiento",
    }),
  );
  els.push(ln(rightX, stor.y + stor.h, rightX + rightW, stor.y + stor.h, color, sw, "Línea fin almacenamiento"));

  const meta = band(0.575, 0.78);
  const metaSize = fs(0.0145, 5);
  const metaBlock = [
    { t: d.desarrolladoPor, w: "400" as const, c: ink, n: "Desarrollado por" },
    { t: d.empresa, w: "800" as const, c: color, n: "Empresa" },
    { t: d.nit, w: "500" as const, c: ink, n: "NIT" },
    { t: d.ciudad, w: "700" as const, c: color, n: "Ciudad" },
    { t: d.web, w: "500" as const, c: color, n: "Web" },
  ];
  metaBlock.forEach((row, i) => {
    els.push(
      tx({
        x: rightX,
        y: meta.y + i * metaSize * 1.4,
        w: rightW,
        content: row.t,
        size: metaSize,
        color: row.c,
        weight: row.w,
        align: "center",
        nombre: row.n,
      }),
    );
  });

  const ean = generarEAN13(d.ean13);
  if (ean) {
    const bar = band(0.8, 0.98);
    els.push(img(rightX, bar.y, rightW, bar.h, svgToDataUrl(ean.svg), "Código de barras"));
  }

  return {
    id: nuevoId(),
    nombre: `${d.abreviatura} · ${d.peso}`.trim(),
    categoria: opts.categoria,
    carpeta: opts.carpeta || "",
    formato,
    fondo: "#ffffff",
    elementos: els,
  };
}

/** Carpeta de Studio con una ficha por cada formato de impresión. */
export const CARPETA_FORMATOS_ETIQUETA = "Formatos etiqueta";

export function nombrePlantillaFormatoEtiqueta(tipo: TipoEtiqueta): string {
  return `Ficha MP · ${tipo.nombre}`.trim();
}

/** Si el formato es una presentación (250 g, 30 mL), úsala en el badge de peso. */
export function pesoDesdeNombreFormato(nombre: string): string {
  const n = (nombre || "").trim();
  if (/^1\s*Lt$/i.test(n)) return "1 L";
  if (/^\d+([.,]\d+)?\s*(g|ml|mL|L|lt|kg)$/i.test(n)) return n;
  return DATOS_EJEMPLO_SCI.peso;
}

/** Una ficha técnica MP a la medida de un formato de Etiquetas → Imprimir. */
export function plantillaFormatoEtiqueta(
  tipo: TipoEtiqueta,
  opts?: { colorPrimario?: string; datos?: Partial<DatosFichaTecnicaMp> },
): PlantillaVisualDoc {
  const doc = plantillaFichaTecnicaMp({
    formato: tipoEtiquetaToFormato(tipo),
    categoria: "etiquetas",
    carpeta: CARPETA_FORMATOS_ETIQUETA,
    colorPrimario: opts?.colorPrimario,
    datos: {
      peso: pesoDesdeNombreFormato(tipo.nombre),
      ...opts?.datos,
    },
  });
  doc.nombre = nombrePlantillaFormatoEtiqueta(tipo);
  return doc;
}
