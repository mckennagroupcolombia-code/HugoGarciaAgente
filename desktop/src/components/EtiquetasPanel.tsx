import { useState, useEffect, useRef, useCallback, type CSSProperties, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, resolvePanelApiUrl } from "../api/client";
import { useAuthStore } from "../stores/auth";
import { useTicketsAuth } from "../stores/ticketsAuth";
import {
  type CmykColor,
  cmykToHex,
  hexToCmyk,
  hexToHsl,
  hslToHex,
  clampCmyk,
  CMYK_NEGRO,
} from "../lib/cmykColor";
import { Icon } from "../icons";
import { ProseTextarea } from "./ProseTextarea";

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface PdfItem {
  nombre: string;
  ruta: string;
  ruta_completa: string;
  guardado?: boolean;
  subido_at?: string;
}

interface PdfsResp {
  pdfs: PdfItem[];
  guardados?: PdfItem[];
  total: number;
  carpeta_guardados?: string;
}

interface PrintResult {
  ok: boolean;
  log: string[];
  error?: string;
  solucion?: string;
  codigo?: string;
}

interface ErrorImpresora {
  error: string;
  solucion: string;
  codigo?: string;
}

const CODIGOS_INSTALAR_IMPRESORA = new Set([
  "no_registrada",
  "deshabilitada",
  "pausada",
  "sin_conexion",
  "elpu",
  "cups_inactivo",
  "sudo",
  "preflight",
]);

interface ImpResp {
  impresora: string;
  estado: string;
}

interface DiagCheck {
  nombre: string;
  ok: boolean;
  detalle: string;
}

interface DiagResp {
  checks: DiagCheck[];
  todo_ok: boolean;
  usb_detectado: string | null;
}

interface InstalResp {
  ok: boolean;
  log: string[];
  errores: string[];
}

interface PreviewResp {
  imagen: string;
  mime: string;
  error?: string;
}

interface DiscoItem {
  nombre: string;
  ruta: string;
  icono?: "home" | "disco" | "usb" | "sistema";
}

interface NavResp {
  ruta_actual: string;
  padre: string | null;
  modo_raiz?: boolean;
  discos?: DiscoItem[];
  carpetas: string[];
  pdfs: { nombre: string; ruta_completa: string; tamano_kb: number }[];
}

function iconoDisco(icono?: DiscoItem["icono"]): string {
  switch (icono) {
    case "home": return "🏠";
    case "usb": return "💾";
    case "sistema": return "🖥️";
    default: return "💿";
  }
}

interface ComboSiigo {
  code: string;
  name: string;
  precio_lista: number;
}

interface SpanPDF {
  id: string;
  pagina: number;
  texto_original: string;
  texto_editado: string;
  origin_x: number;
  origin_y: number;
  bbox: [number, number, number, number];
  font_name: string;
  font_file: string | null;
  font_size: number;
  color_hex: string;
  color_int: number;
  flags: number;
}

type MontserratVariant = "light" | "regular" | "medium" | "semibold" | "bold" | "extrabold" | "black";

const VARIANTES_MONTSERRAT: { id: MontserratVariant; label: string; weight: number }[] = [
  { id: "light", label: "Light", weight: 300 },
  { id: "regular", label: "Regular", weight: 400 },
  { id: "medium", label: "Medium", weight: 500 },
  { id: "semibold", label: "SemiBold", weight: 600 },
  { id: "bold", label: "Bold", weight: 700 },
  { id: "extrabold", label: "ExtraBold", weight: 800 },
  { id: "black", label: "Black", weight: 900 },
];

function varianteMontserratCampo(c: CampoTexto): MontserratVariant {
  if (c.font_variant) return c.font_variant;
  return c.bold ? "bold" : "light";
}

function pesoMontserratVariante(v: MontserratVariant): number {
  return VARIANTES_MONTSERRAT.find((x) => x.id === v)?.weight ?? 400;
}

interface CampoTexto {
  id: string;
  etiqueta: string;
  texto: string;
  x_pct: number;
  y_pct: number;
  font_size: number;
  /** Variante Montserrat (preferida sobre bold legacy) */
  font_variant?: MontserratVariant;
  bold: boolean;
  align: "left" | "center" | "right" | "justify";
  /** Alerta ortográfica del navegador (español) */
  ortografia?: boolean;
  fondo_blanco: boolean;
  /** Relleno del texto */
  color: string;
  color_cmyk?: CmykColor;
  /** Trazo/contorno del texto */
  color_trazo?: string;
  color_trazo_cmyk?: CmykColor;
  grosor_trazo?: number;
  /** Caja de texto redimensionable (% del lienzo) */
  ancho_caja_pct?: number;
  alto_caja_pct?: number;
}

interface RectanguloPlantilla {
  id: string;
  x_pct: number;
  y_pct: number;
  ancho_pct: number;
  alto_pct: number;
  relleno: boolean;
  color_relleno: string;
  color_relleno_cmyk?: CmykColor;
  color_trazo: string;
  color_trazo_cmyk?: CmykColor;
  grosor_trazo: number;
}

interface LineaPlantilla {
  id: string;
  x1_pct: number;
  y1_pct: number;
  x2_pct: number;
  y2_pct: number;
  grosor: number;
  color: string;
  color_cmyk?: CmykColor;
}

interface RecursoPng {
  id: string;
  nombre: string;
  ruta: string;
  ruta_completa: string;
  subido_at?: string;
  bytes?: number;
  thumb_b64?: string | null;
}

interface ImagenPlantilla {
  id: string;
  recurso_id: string;
  nombre: string;
  ruta_completa: string;
  x_pct: number;
  y_pct: number;
  ancho_pct: number;
  alto_pct?: number;
}

type OrientacionPlantilla = "horizontal" | "vertical";

interface PlantillaEtiqueta {
  id: string;
  nombre: string;
  tipo_etiqueta: string;
  orientacion?: OrientacionPlantilla;
  campos_texto: CampoTexto[];
  lineas: LineaPlantilla[];
  imagenes?: ImagenPlantilla[];
  rectangulos?: RectanguloPlantilla[];
  updated_at?: string;
}

type HerramientaPlantilla = "seleccionar" | "texto" | "linea" | "rectangulo";
type SeleccionPlantilla =
  | { tipo: "texto" | "linea" | "imagen" | "rectangulo"; id: string }
  | null;

interface DatosEtiqueta {
  siigo_code?: string;
  siigo_name?: string;
  nombre_etiqueta?: string;
  presentacion?: string;
  pdf_ruta?: string;
  pdf_nombre?: string;
  lote_defecto?: string;
  vencimiento_defecto?: string;
  tipo_etiqueta?: string;
  forma?: string;
  calidad?: string;
  rotacion?: string;
  lote_pos?: string;
  lote_font?: number;
  lote_x_pct?: number;
  lote_y_pct?: number;
  campos_texto?: CampoTexto[];
  lineas?: LineaPlantilla[];
  imagenes?: ImagenPlantilla[];
  rectangulos?: RectanguloPlantilla[];
  updated_at?: string;
}

interface ImpresionEtiquetaPayload {
  producto: string;
  forma: string;
  calidad: string;
  rotacion: string;
  cantidad: number;
  offset_v: number;
  offset_h: number;
  ruta_pdf: string;
  campos_texto?: CampoTexto[];
  lineas?: LineaPlantilla[];
  imagenes?: ImagenPlantilla[];
  rectangulos?: RectanguloPlantilla[];
  lote?: string;
  vencimiento?: string;
  lote_font: number;
  lote_x_pct: number;
  lote_y_pct: number;
}

function payloadDesdeFormularioEtiqueta(
  form: DatosEtiqueta,
  cantidad = 1,
  offsetV = 0,
  offsetH = 0,
): ImpresionEtiquetaPayload | null {
  if (!form.pdf_ruta || !form.tipo_etiqueta) return null;
  return {
    producto: form.tipo_etiqueta,
    forma: form.forma ?? "Diecut_Gap",
    calidad: form.calidad ?? "Normal",
    rotacion: rotacionValida(form.rotacion),
    cantidad,
    offset_v: offsetV,
    offset_h: offsetH,
    ruta_pdf: form.pdf_ruta,
    campos_texto: form.campos_texto?.length ? form.campos_texto : undefined,
    lineas: form.lineas?.length ? form.lineas : undefined,
    imagenes: form.imagenes?.length ? form.imagenes : undefined,
    rectangulos: form.rectangulos?.length ? form.rectangulos : undefined,
    lote: loteParaEtiqueta(form.lote_defecto),
    vencimiento: expParaEtiqueta(form.vencimiento_defecto),
    lote_font: form.lote_font ?? 7,
    lote_x_pct: form.lote_x_pct ?? 5,
    lote_y_pct: form.lote_y_pct ?? 88,
  };
}

// ── Constantes ────────────────────────────────────────────────────────────────

const ETIQUETAS_LISTA = [
  "30 mL", "5 mL", "125 g", "250 g", "1 Lt",
  "100 g", "Lactato", "Circular", "Circular 70", "5 g", "54mm",
];

/** Ancho × alto mm (misma tabla que Flask _ETIQUETAS). */
const ETIQUETAS_MM: Record<string, [number, number]> = {
  "30 mL": [102, 38], "5 mL": [66, 22], "125 g": [70, 70],
  "250 g": [76, 66], "1 Lt": [108, 76],
  "100 g": [69, 51], Lactato: [38, 140], Circular: [55, 55],
  "Circular 70": [70, 70], "5 g": [50, 42], "54mm": [54, 58],
};

function idPlantilla() {
  return Math.random().toString(36).slice(2, 11);
}

function nuevaImagenPlantilla(recurso: RecursoPng): ImagenPlantilla {
  return {
    id: idPlantilla(),
    recurso_id: recurso.id,
    nombre: recurso.nombre,
    ruta_completa: recurso.ruta_completa,
    x_pct: 35,
    y_pct: 35,
    ancho_pct: 28,
    alto_pct: 22,
  };
}

function plantillaVacia(nombre = "Nueva plantilla"): PlantillaEtiqueta {
  return {
    id: idPlantilla(),
    nombre,
    tipo_etiqueta: ETIQUETAS_LISTA[0],
    orientacion: "horizontal",
    campos_texto: [],
    lineas: [],
    imagenes: [],
    rectangulos: [],
  };
}

function nuevoRectangulo(x = 25, y = 25, w = 35, h = 22): RectanguloPlantilla {
  return {
    id: idPlantilla(),
    x_pct: x,
    y_pct: y,
    ancho_pct: w,
    alto_pct: h,
    relleno: true,
    color_relleno: "#ffffff",
    color_relleno_cmyk: { c: 0, m: 0, y: 0, k: 0 },
    color_trazo: "#000000",
    color_trazo_cmyk: CMYK_NEGRO,
    grosor_trazo: 1.2,
  };
}

function rectNormalizado(x1: number, y1: number, x2: number, y2: number, cuadrado: boolean) {
  let dx = x2 - x1;
  let dy = y2 - y1;
  if (cuadrado) {
    const s = Math.max(Math.abs(dx), Math.abs(dy));
    dx = dx < 0 ? -s : s;
    dy = dy < 0 ? -s : s;
  }
  const x = clampLotePct(dx >= 0 ? x1 : x1 + dx);
  const y = clampLotePct(dy >= 0 ? y1 : y1 + dy);
  const w = clampLotePct(Math.abs(dx));
  const h = clampLotePct(Math.abs(dy));
  return { x_pct: x, y_pct: y, ancho_pct: Math.max(1, w), alto_pct: Math.max(1, h) };
}

function orientacionPlantilla(p: PlantillaEtiqueta): OrientacionPlantilla {
  return p.orientacion === "vertical" ? "vertical" : "horizontal";
}

function dimensioensPlantillaMm(tipo: string, orientacion: OrientacionPlantilla): [number, number] {
  const base = ETIQUETAS_MM[tipo] ?? [76, 66];
  if (orientacion === "vertical") return [base[1], base[0]];
  return base;
}

function rotarPctCW(x: number, y: number) {
  return { x: clampLotePct(y), y: clampLotePct(100 - x) };
}

function rotarPctCCW(x: number, y: number) {
  return { x: clampLotePct(100 - y), y: clampLotePct(x) };
}

function rotarPlantillaContenido(
  p: PlantillaEtiqueta,
  sentido: "cw" | "ccw",
): Pick<PlantillaEtiqueta, "campos_texto" | "lineas" | "imagenes" | "rectangulos"> {
  const rot = sentido === "cw" ? rotarPctCW : rotarPctCCW;
  return {
    campos_texto: p.campos_texto.map((c) => {
      const { x, y } = rot(c.x_pct, c.y_pct);
      return { ...c, x_pct: x, y_pct: y };
    }),
    lineas: p.lineas.map((ln) => {
      const a = rot(ln.x1_pct, ln.y1_pct);
      const b = rot(ln.x2_pct, ln.y2_pct);
      return { ...ln, x1_pct: a.x, y1_pct: a.y, x2_pct: b.x, y2_pct: b.y };
    }),
    imagenes: (p.imagenes ?? []).map((im) => {
      const { x, y } = rot(im.x_pct, im.y_pct);
      return { ...im, x_pct: x, y_pct: y };
    }),
    rectangulos: (p.rectangulos ?? []).map((rc) => {
      const { x, y } = rot(rc.x_pct, rc.y_pct);
      return { ...rc, x_pct: x, y_pct: y };
    }),
  };
}

function rotacionDesdePlantilla(p: PlantillaEtiqueta): string {
  if (orientacionPlantilla(p) === "vertical") return "90";
  return rotacionDefaultEtiqueta(p.tipo_etiqueta);
}

function snapLineaRecta(x1: number, y1: number, x2: number, y2: number) {
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  if (dx >= dy) return { x2, y2: y1 };
  return { x2: x1, y2 };
}

type ArrastrePlantilla =
  | { tipo: "texto"; id: string; ox: number; oy: number }
  | { tipo: "imagen"; id: string; ox: number; oy: number }
  | { tipo: "rectangulo"; id: string; ox: number; oy: number }
  | {
      tipo: "linea";
      id: string;
      startX: number;
      startY: number;
      orig: { x1: number; y1: number; x2: number; y2: number };
    };

type AsaRedimensionId = "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";

type RedimensionPlantilla =
  | {
      tipo: "rectangulo" | "imagen" | "texto";
      id: string;
      asa: AsaRedimensionId;
      orig: { x: number; y: number; w: number; h: number };
    }
  | {
      tipo: "linea";
      id: string;
      punto: "inicio" | "fin";
      orig: { x1: number; y1: number; x2: number; y2: number };
    };

const ASAS_REDIMENSION: { id: AsaRedimensionId; pos: string; cursor: string }[] = [
  { id: "nw", pos: "left-0 top-0", cursor: "cursor-nw-resize" },
  { id: "ne", pos: "right-0 top-0", cursor: "cursor-ne-resize" },
  { id: "sw", pos: "left-0 bottom-0", cursor: "cursor-sw-resize" },
  { id: "se", pos: "right-0 bottom-0", cursor: "cursor-se-resize" },
];

function calcularCajaRedimension(
  orig: { x: number; y: number; w: number; h: number },
  asa: AsaRedimensionId,
  p: { x: number; y: number },
  lockRatio: boolean,
) {
  const x2 = orig.x + orig.w;
  const y2 = orig.y + orig.h;
  let x = orig.x;
  let y = orig.y;
  let w = orig.w;
  let h = orig.h;

  if (asa.includes("e")) w = p.x - orig.x;
  if (asa.includes("w")) { x = p.x; w = x2 - p.x; }
  if (asa.includes("s")) h = p.y - orig.y;
  if (asa.includes("n")) { y = p.y; h = y2 - p.y; }

  if (w < 0) { x += w; w = -w; }
  if (h < 0) { y += h; h = -h; }

  w = Math.max(2, w);
  h = Math.max(2, h);
  x = clampLotePct(x);
  y = clampLotePct(y);
  w = clampLotePct(w);
  h = clampLotePct(h);

  if (lockRatio && orig.w > 0 && orig.h > 0) {
    const ratio = orig.w / orig.h;
    if (asa === "e" || asa === "w") h = w / ratio;
    else if (asa === "n" || asa === "s") w = h * ratio;
    else if (w / h > ratio) h = w / ratio;
    else w = h * ratio;
    w = Math.max(2, clampLotePct(w));
    h = Math.max(2, clampLotePct(h));
    if (asa.includes("w")) x = clampLotePct(x2 - w);
    if (asa.includes("n")) y = clampLotePct(y2 - h);
  }

  return { x, y, w, h };
}

function SeparadorToolbar() {
  return <div className="mx-1.5 my-0.5 border-t border-border/80" />;
}

function BarraIconos({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-px p-1">{children}</div>;
}

function PanelSuperiorRellenosTrazos({
  campo,
  linea,
  rect,
  onPatchCampo,
  onPatchLinea,
  onPatchRect,
}: {
  campo?: CampoTexto;
  linea?: LineaPlantilla;
  rect?: RectanguloPlantilla;
  onPatchCampo: (patch: Partial<CampoTexto>) => void;
  onPatchLinea: (patch: Partial<LineaPlantilla>) => void;
  onPatchRect: (patch: Partial<RectanguloPlantilla>) => void;
}) {
  const haySeleccion = !!(campo || linea || rect);

  return (
    <div className="flex flex-shrink-0 flex-wrap items-start gap-x-4 gap-y-2 border-b border-border bg-surface-panel px-3 py-2">
      <span className="w-24 shrink-0 pt-0.5 text-[9px] font-bold uppercase tracking-wide text-muted">
        Rellenos y trazos
      </span>
      {!haySeleccion ? (
        <p className="text-[10px] text-muted">Selecciona texto, línea o rectángulo.</p>
      ) : campo ? (
        <div className="flex min-w-0 flex-1 flex-wrap items-start gap-4">
          <div className="min-w-[11rem] max-w-xs flex-1">
            <SelectorColorArcoiris
              label="Relleno texto"
              color={campo.color}
              colorCmyk={campo.color_cmyk}
              onChange={(hex, cmyk) => onPatchCampo({ color: hex, color_cmyk: cmyk })}
            />
          </div>
          <label className="flex min-w-[8rem] items-center gap-2 pt-5 text-[10px]">
            <span className="text-muted whitespace-nowrap">Trazo</span>
            <input
              type="range"
              min={0}
              max={4}
              step={0.2}
              value={campo.grosor_trazo ?? 0}
              onChange={(e) => onPatchCampo({ grosor_trazo: Number(e.target.value) })}
              className="w-20 accent-accent"
            />
            <span className="font-mono">{(campo.grosor_trazo ?? 0).toFixed(1)}</span>
          </label>
          <div className="min-w-[11rem] max-w-xs flex-1">
            <SelectorColorArcoiris
              label="Color trazo"
              color={campo.color_trazo ?? "#000000"}
              colorCmyk={campo.color_trazo_cmyk}
              onChange={(hex, cmyk) => onPatchCampo({ color_trazo: hex, color_trazo_cmyk: cmyk })}
            />
          </div>
        </div>
      ) : linea ? (
        <div className="flex min-w-0 flex-1 flex-wrap items-start gap-4">
          <label className="flex items-center gap-2 pt-1 text-[10px]">
            <span className="text-muted whitespace-nowrap">Grosor</span>
            <input
              type="range"
              min={0.5}
              max={4}
              step={0.1}
              value={linea.grosor}
              onChange={(e) => onPatchLinea({ grosor: Number(e.target.value) })}
              className="w-24 accent-accent"
            />
          </label>
          <div className="min-w-[11rem] max-w-sm flex-1">
            <SelectorColorArcoiris
              label="Color línea"
              color={linea.color}
              colorCmyk={linea.color_cmyk}
              onChange={(hex, cmyk) => onPatchLinea({ color: hex, color_cmyk: cmyk })}
            />
          </div>
        </div>
      ) : rect ? (
        <div className="flex min-w-0 flex-1 flex-wrap items-start gap-4">
          <label className="flex items-center gap-2 pt-1 text-[10px]">
            <input
              type="checkbox"
              checked={rect.relleno}
              onChange={(e) => onPatchRect({ relleno: e.target.checked })}
              className="accent-accent"
            />
            Relleno activo
          </label>
          {rect.relleno && (
            <div className="min-w-[11rem] max-w-xs flex-1">
              <SelectorColorArcoiris
                label="Color relleno"
                color={rect.color_relleno}
                colorCmyk={rect.color_relleno_cmyk}
                onChange={(hex, cmyk) => onPatchRect({ color_relleno: hex, color_relleno_cmyk: cmyk })}
              />
            </div>
          )}
          <label className="flex items-center gap-2 pt-1 text-[10px]">
            <span className="text-muted whitespace-nowrap">Trazo</span>
            <input
              type="range"
              min={0.5}
              max={4}
              step={0.1}
              value={rect.grosor_trazo}
              onChange={(e) => onPatchRect({ grosor_trazo: Number(e.target.value) })}
              className="w-20 accent-accent"
            />
          </label>
          <div className="min-w-[11rem] max-w-xs flex-1">
            <SelectorColorArcoiris
              label="Color trazo"
              color={rect.color_trazo}
              colorCmyk={rect.color_trazo_cmyk}
              onChange={(hex, cmyk) => onPatchRect({ color_trazo: hex, color_trazo_cmyk: cmyk })}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PanelSuperiorEdicion({
  campo,
  onPatch,
}: {
  campo?: CampoTexto;
  onPatch: (patch: Partial<CampoTexto>) => void;
}) {
  const variante = campo ? varianteMontserratCampo(campo) : "regular";

  return (
    <div className="flex flex-shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-surface px-3 py-2">
      <span className="w-24 shrink-0 text-[9px] font-bold uppercase tracking-wide text-muted">Edición</span>
      {!campo ? (
        <p className="text-[10px] text-muted">Selecciona un texto en el lienzo.</p>
      ) : (
        <>
          <input
            type="text"
            value={campo.texto}
            lang="es"
            spellCheck={campo.ortografia !== false}
            onChange={(e) => onPatch({ texto: e.target.value })}
            className="min-w-[10rem] flex-1 rounded border border-border bg-surface-panel px-2 py-1 text-xs outline-none focus:border-accent"
            placeholder="Contenido del texto"
          />
          <div className="flex max-w-full items-center gap-1 overflow-x-auto">
            {VARIANTES_MONTSERRAT.map((v) => (
              <button
                key={v.id}
                type="button"
                title={v.label}
                onClick={() => onPatch({ font_variant: v.id, bold: v.weight >= 700 })}
                className={`shrink-0 rounded px-2 py-1 text-[10px] transition ${
                  variante === v.id
                    ? "bg-accent text-white"
                    : "border border-border text-ink-secondary hover:bg-surface-hover"
                }`}
                style={{ fontFamily: '"Montserrat", sans-serif', fontWeight: v.weight }}
              >
                {v.label}
              </button>
            ))}
          </div>
          <label className="flex shrink-0 items-center gap-1.5 text-[10px]">
            <span className="text-muted">Pt</span>
            <input
              type="range"
              min={6}
              max={24}
              value={campo.font_size}
              onChange={(e) => onPatch({ font_size: Number(e.target.value) })}
              className="w-16 accent-accent"
            />
            <span className="w-5 font-mono">{campo.font_size}</span>
          </label>
          <div className="flex shrink-0 gap-0.5">
            {ALINEACIONES_TEXTO.map((a) => (
              <button
                key={a.id}
                type="button"
                title={a.title}
                onClick={() => onPatch({ align: a.id })}
                className={`rounded border px-1.5 py-0.5 text-sm font-bold ${
                  campo.align === a.id ? "border-accent bg-accent text-white" : "border-border"
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
          <label className="flex shrink-0 items-center gap-1 text-[10px]">
            <input
              type="checkbox"
              checked={campo.ortografia !== false}
              onChange={(e) => onPatch({ ortografia: e.target.checked })}
              className="accent-accent"
            />
            Ortografía
          </label>
        </>
      )}
    </div>
  );
}

function BtnIconoToolbar({
  activo,
  onClick,
  icon,
  title,
  disabled = false,
  danger = false,
}: {
  activo?: boolean;
  onClick: () => void;
  icon: ReactNode;
  title: string;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex aspect-square w-full items-center justify-center rounded-sm text-[15px] leading-none transition disabled:opacity-30 ${
        activo
          ? "bg-accent text-white shadow-inner ring-1 ring-accent/50"
          : danger
            ? "text-danger hover:bg-danger/15"
            : "text-ink-secondary hover:bg-surface-hover hover:text-ink"
      }`}
    >
      {icon}
    </button>
  );
}

function MarcoRedimensionable({
  activo,
  onMover,
  onRedimensionar,
  children,
}: {
  activo: boolean;
  onMover: (e: React.MouseEvent) => void;
  onRedimensionar: (e: React.MouseEvent, asa: AsaRedimensionId) => void;
  children?: React.ReactNode;
}) {
  if (!activo) return <>{children}</>;
  const marco = (
    <div className="pointer-events-auto absolute inset-0 box-border border-2 border-accent">
      <button
        type="button"
        title="Mover"
        className="absolute left-1 top-1 z-30 flex h-5 w-5 cursor-move items-center justify-center rounded border border-accent bg-white text-[9px] text-accent shadow-sm hover:bg-accent/10"
        onMouseDown={onMover}
      >
        ⠿
      </button>
      {ASAS_REDIMENSION.map((a) => (
        <button
          key={a.id}
          type="button"
          title={`Redimensionar esquina ${a.id}`}
          className={`absolute z-30 box-border h-3 w-3 border-2 border-accent bg-white shadow-sm hover:bg-accent/20 ${a.pos} ${a.cursor}`}
          onMouseDown={(e) => onRedimensionar(e, a.id)}
        />
      ))}
    </div>
  );
  if (!children) return marco;
  return (
    <div className="relative h-full w-full">
      {children}
      {marco}
    </div>
  );
}

/** Solo Suprimir (Delete) elimina el objeto; Retroceso edita texto. */
function esTeclaEliminarElemento(e: { key: string; code: string }) {
  return e.key === "Delete" || e.code === "Delete";
}

const ALINEACIONES_TEXTO: { id: CampoTexto["align"]; label: string; title: string }[] = [
  { id: "left", label: "⫷", title: "Izquierda" },
  { id: "center", label: "☰", title: "Centro" },
  { id: "right", label: "⫸", title: "Derecha" },
  { id: "justify", label: "≡", title: "Justificado" },
];

function enCampoEditable(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el?.closest("input, textarea, select, [contenteditable='true']");
}

function panelBearerToken(): string | null {
  const tickets = useTicketsAuth.getState();
  return tickets.apiToken || tickets.token || useAuthStore.getState().token || null;
}

function SelectorColorArcoiris({
  color,
  colorCmyk,
  onChange,
  label = "Color",
}: {
  color: string;
  colorCmyk?: CmykColor;
  onChange: (hex: string, cmyk: CmykColor) => void;
  label?: string;
}) {
  const arcoirisRef = useRef<HTMLDivElement>(null);
  const [arrastrandoHue, setArrastrandoHue] = useState(false);
  const hsl = hexToHsl(color);
  const cmyk = colorCmyk ?? hexToCmyk(color);

  function aplicarHex(hex: string) {
    onChange(hex, hexToCmyk(hex));
  }

  function hueDesdeClienteX(clientX: number) {
    const el = arcoirisRef.current;
    if (!el) return hsl.h;
    const r = el.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    return t * 360;
  }

  function aplicarHue(h: number) {
    const hex = hslToHex(h, Math.max(hsl.s, 85), Math.max(hsl.l, 45));
    aplicarHex(hex);
  }

  useEffect(() => {
    if (!arrastrandoHue) return;
    function onMove(e: MouseEvent) {
      aplicarHue(hueDesdeClienteX(e.clientX));
    }
    function onUp() {
      setArrastrandoHue(false);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [arrastrandoHue, hsl.s, hsl.l]);

  function patchCmyk(partial: Partial<CmykColor>) {
    const next: CmykColor = {
      c: clampCmyk(partial.c ?? cmyk.c),
      m: clampCmyk(partial.m ?? cmyk.m),
      y: clampCmyk(partial.y ?? cmyk.y),
      k: clampCmyk(partial.k ?? cmyk.k),
    };
    onChange(cmykToHex(next), next);
  }

  const inp = "w-11 rounded border border-border bg-surface px-1 py-0.5 text-center text-[11px]";
  const marcadorLeft = `${(hsl.h / 360) * 100}%`;

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</p>
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="h-10 w-10 flex-shrink-0 rounded-lg border-2 border-border shadow-inner"
          style={{ backgroundColor: color }}
          title="Color seleccionado"
        />
        <input
          type="color"
          value={color}
          onChange={(e) => aplicarHex(e.target.value)}
          className="h-10 w-14 cursor-pointer rounded border border-border bg-transparent p-0"
          title="Selector de color del sistema"
        />
      </div>
      <div className="relative">
        <div
          ref={arcoirisRef}
          role="slider"
          aria-label="Arcoíris de tonos"
          className="h-7 w-full cursor-crosshair rounded-md border border-border shadow-sm"
          style={{
            background:
              "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
          }}
          onMouseDown={(e) => {
            setArrastrandoHue(true);
            aplicarHue(hueDesdeClienteX(e.clientX));
          }}
        />
        <div
          className="pointer-events-none absolute top-1/2 h-5 w-1 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-white bg-ink shadow"
          style={{ left: marcadorLeft }}
        />
      </div>
      <p className="text-[10px] text-muted">Arrastra el arcoíris o usa el selector · CMYK para impresión</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-bold uppercase text-muted">CMYK</span>
        {(["c", "m", "y", "k"] as const).map((ch) => (
          <label key={ch} className="flex items-center gap-0.5 text-[10px] uppercase text-muted">
            {ch}
            <input
              type="number"
              min={0}
              max={100}
              value={cmyk[ch]}
              onChange={(e) => patchCmyk({ [ch]: Number(e.target.value) })}
              className={inp}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function ImgRecursoPng({
  nombre,
  thumbB64,
  className = "",
  style,
}: {
  nombre: string;
  thumbB64?: string | null;
  className?: string;
  style?: CSSProperties;
}) {
  const [src, setSrc] = useState<string | null>(
    thumbB64 ? `data:image/png;base64,${thumbB64}` : null,
  );
  useEffect(() => {
    if (thumbB64) {
      setSrc(`data:image/png;base64,${thumbB64}`);
      return;
    }
    let alive = true;
    const token = panelBearerToken();
    const url = resolvePanelApiUrl(
      `/api/etiquetas/recursos-png/archivo/${encodeURIComponent(nombre)}`,
    );
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (!alive || !blob) return;
        setSrc(URL.createObjectURL(blob));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [nombre, thumbB64]);
  if (!src) {
    return <div className={`bg-surface-hover ${className}`} style={style} />;
  }
  return <img src={src} alt={nombre} className={className} style={style} draggable={false} />;
}

function BotonSubirPngRecurso({
  onSubido,
  className = "",
  label = "📤 Subir PNG",
  compact = false,
}: {
  onSubido: (item: RecursoPng) => void;
  className?: string;
  label?: string;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [errorLocal, setErrorLocal] = useState<string | null>(null);

  const subirMut = useMutation({
    mutationFn: (file: File) => {
      const esPng = file.type === "image/png" || file.name.toLowerCase().endsWith(".png");
      if (!esPng) throw new Error("Solo se permiten archivos PNG.");
      const fd = new FormData();
      fd.append("archivo", file);
      return api.upload<RecursoPng & { ok: boolean }>("/api/etiquetas/recursos-png", fd);
    },
    onSuccess: (data) => {
      setErrorLocal(null);
      qc.invalidateQueries({ queryKey: ["etiquetas-recursos-png"] });
      onSubido(data);
    },
    onError: (err: Error) => setErrorLocal(err.message),
  });

  return (
    <div className={className}>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,.png"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) subirMut.mutate(f);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={subirMut.isPending}
        onClick={() => inputRef.current?.click()}
        className={`inline-flex items-center gap-1 rounded border border-border bg-surface font-semibold text-ink hover:border-accent hover:text-accent disabled:opacity-50 ${
          compact ? `h-8 px-2.5 ${RIB_FONT_BTN}` : "px-3 py-2 text-sm"
        }`}
      >
        {subirMut.isPending ? "Subiendo…" : label}
      </button>
      {errorLocal && <p className="mt-1 text-[10px] text-danger">{errorLocal}</p>}
    </div>
  );
}

/** Rotación por defecto al elegir formato (PDF apaisado → rollo estrecho). */
const ETIQUETAS_ROTACION_DEFAULT: Record<string, string> = {
  Lactato: "90",
};

function rotacionDefaultEtiqueta(tipo: string): string {
  return ETIQUETAS_ROTACION_DEFAULT[tipo] ?? "0";
}

/** Solo 0° y 90° están disponibles en el panel. */
function rotacionValida(r: string | undefined): string {
  return r === "90" ? "90" : "0";
}

const LOTE_PREFIJO = "LOT.";
const EXP_PREFIJO = "EXP.";

function conPrefijoLote(val: string | undefined): string {
  const v = (val ?? "").trim();
  if (!v) return LOTE_PREFIJO;
  if (v.toUpperCase().startsWith(LOTE_PREFIJO)) return v;
  if (v.toUpperCase().startsWith("LOT")) return LOTE_PREFIJO + v.slice(3).replace(/^[.\s]+/, "");
  return LOTE_PREFIJO + v;
}

function conPrefijoExp(val: string | undefined): string {
  const v = (val ?? "").trim();
  if (!v) return EXP_PREFIJO;
  if (v.toUpperCase().startsWith(EXP_PREFIJO)) return v;
  if (v.toUpperCase().startsWith("EXP")) return EXP_PREFIJO + v.slice(3).replace(/^[.\s]+/, "");
  return EXP_PREFIJO + v;
}

function editarConPrefijo(valor: string, prefijo: string): string {
  const upper = valor.toUpperCase();
  const prefUpper = prefijo.toUpperCase();
  if (!upper.startsWith(prefUpper)) {
    const stripped = valor.replace(new RegExp(`^${prefijo.replace(".", "\\.")}`, "i"), "");
    return prefijo + stripped;
  }
  if (valor.length < prefijo.length) return prefijo;
  return valor;
}

function loteParaEtiqueta(val: string | undefined): string | undefined {
  const v = (val ?? "").trim();
  if (!v || v === LOTE_PREFIJO) return undefined;
  return v;
}

function expParaEtiqueta(val: string | undefined): string | undefined {
  const v = (val ?? "").trim();
  if (!v || v === EXP_PREFIJO) return undefined;
  return v;
}

const FORMAS = [
  { label: "Troquelada — separación (gap)", value: "Diecut_Gap" },
  { label: "Troquelada — marca negra", value: "Diecut_Blackmark" },
  { label: "Continua — sin detección", value: "Contlabel_no_detection" },
];

const CALIDADES = [
  { label: "Máxima velocidad (Borrador)", value: "MaxSpeed" },
  { label: "Rápida", value: "Speed" },
  { label: "Normal", value: "Normal" },
  { label: "Alta calidad", value: "Quality" },
  { label: "Máxima calidad (Fotos / Logos)", value: "MaxQuality" },
];

const ROTACIONES = ["0", "90"];

const LOTE_POS_PCT: Record<string, { x: number; y: number }> = {
  "bottom-left": { x: 5, y: 88 },
  "bottom-right": { x: 58, y: 88 },
  "top-left": { x: 5, y: 6 },
  "top-right": { x: 58, y: 6 },
};

function lotePctInicial(pos: string | undefined, x?: number, y?: number): { x: number; y: number } {
  if (typeof x === "number" && typeof y === "number") return { x, y };
  return LOTE_POS_PCT[pos ?? "bottom-left"] ?? LOTE_POS_PCT["bottom-left"];
}

function clampLotePct(n: number): number {
  return Math.max(0, Math.min(98, Math.round(n * 10) / 10));
}

const PREVIEW_IMG_LARGE =
  "block max-h-[min(58vh,640px)] max-w-full w-auto h-auto rounded-lg shadow-md transition-opacity duration-200";
const PREVIEW_CONTAINER_LARGE =
  "flex items-center justify-center w-full h-full min-h-[min(52vh,460px)] p-3 sm:p-5";
/** Misma resolución que `_pdf_a_imagen` en Flask (180 DPI). */
const PREVIEW_DPI = 180;

type EditorRibbonTab = "inicio" | "lote" | "impresion" | "texto" | "editar-pdf";
type ImprimirRibbonTab = "inicio" | "lote" | "archivo";

/** Tipografía cinta — legible en pantalla */
const RIB_FONT_INP = "text-[13.3px]";
const RIB_FONT_LBL = "text-[12.1px]";
const RIB_FONT_GRP = "text-[10.9px]";
const RIB_FONT_TAB = "text-[14.5px]";
const RIB_FONT_BTN = "text-[13.3px]";
const RIB_FONT_META = "text-[12.1px]";
const RIB_FONT_HINT = "text-[10.9px]";

const RIB_INP =
  `h-9 min-w-[5rem] rounded border border-border bg-surface px-2.5 ${RIB_FONT_INP} text-ink outline-none focus:border-accent`;
const RIB_SEL = RIB_INP;
const RIB_LBL = `mb-0.5 block ${RIB_FONT_LBL} text-muted whitespace-nowrap`;

function RibbonGroup({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-shrink-0 flex-col justify-between border-r border-border/60 px-3 py-1.5 ${className}`}>
      <div className="flex min-h-[58px] flex-wrap items-end gap-2">{children}</div>
      <span className={`mt-1 pt-0.5 text-center ${RIB_FONT_GRP} font-semibold uppercase tracking-wider text-muted`}>
        {label}
      </span>
    </div>
  );
}

function BannerErrorImpresora({
  error,
  onCerrar,
  onInstalar,
}: {
  error: ErrorImpresora;
  onCerrar: () => void;
  onInstalar?: () => void;
}) {
  const mostrarInstalar = onInstalar && (!error.codigo || CODIGOS_INSTALAR_IMPRESORA.has(error.codigo));
  return (
    <div className="flex flex-shrink-0 items-start gap-3 border-b border-red-300 bg-red-50 px-4 py-3">
      <span className="mt-0.5 text-lg leading-none" aria-hidden>⚠️</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-red-800">{error.error}</p>
        <p className="mt-1 text-xs leading-relaxed text-red-700">
          <span className="font-semibold">Posible solución: </span>
          {error.solucion}
        </p>
      </div>
      <div className="flex flex-shrink-0 flex-col gap-1 sm:flex-row">
        {mostrarInstalar && (
          <button
            type="button"
            onClick={onInstalar}
            className="rounded border border-red-400 bg-white px-2.5 py-1 text-[10px] font-bold text-red-700 hover:bg-red-100"
          >
            Instalar impresora
          </button>
        )}
        <button
          type="button"
          onClick={onCerrar}
          className="rounded px-2 py-1 text-[10px] font-semibold text-red-600 hover:bg-red-100"
        >
          Cerrar
        </button>
      </div>
    </div>
  );
}

function errorDesdePrintResult(data: PrintResult): ErrorImpresora | null {
  if (data.ok) return null;
  return {
    error: data.error ?? "Error al imprimir",
    solucion: data.solucion ?? "Revisa la conexión USB y el estado de la impresora.",
    codigo: data.codigo,
  };
}

function errorDesdeExcepcion(msg: string): ErrorImpresora {
  const ml = msg.toLowerCase();
  if (ml.includes("no autorizado")) {
    return { error: msg, solucion: "Cierra sesión y vuelve a ingresar con tu token.", codigo: "auth" };
  }
  if (ml.includes("timeout")) {
    return { error: "La impresión tardó demasiado", solucion: "Verifica que la impresora esté encendida y vuelve a intentar.", codigo: "timeout" };
  }
  return { error: msg, solucion: "Revisa cable USB, rollo de etiquetas y pulsa «Instalar impresora».", codigo: "desconocido" };
}

function RibbonTabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: string; disabled?: boolean }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex flex-shrink-0 items-end gap-0 border-b border-border bg-surface-panel px-2 pt-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          disabled={t.disabled}
          onClick={() => onChange(t.id)}
          className={`relative rounded-t-md px-4 py-2.5 ${RIB_FONT_TAB} font-semibold transition disabled:opacity-40 ${
            active === t.id
              ? "z-10 -mb-px border border-border border-b-surface bg-surface text-accent"
              : "text-muted hover:bg-surface-hover/70 hover:text-ink"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function pctDesdePuntero(rect: DOMRect, clientX: number, clientY: number): { x: number; y: number } {
  const x = ((clientX - rect.left) / rect.width) * 100;
  const y = ((clientY - rect.top) / rect.height) * 100;
  return { x: clampLotePct(x), y: clampLotePct(y) };
}

function VistaPreviaConLote({
  imagen,
  mime = "image/png",
  loading,
  emptyText = "Selecciona un PDF para ver la vista previa",
  loteText,
  vencText,
  loteFont,
  xPct,
  yPct,
  onPositionChange,
  imgClassName = "block max-w-full max-h-full w-auto h-auto rounded-lg shadow transition-opacity duration-200",
  containerClassName = "flex items-center justify-center w-full h-full min-h-[8rem]",
}: {
  imagen?: string;
  mime?: string;
  loading?: boolean;
  emptyText?: string;
  loteText?: string;
  vencText?: string;
  loteFont: number;
  xPct: number;
  yPct: number;
  onPositionChange?: (x: number, y: number) => void;
  imgClassName?: string;
  containerClassName?: string;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgMetrics, setImgMetrics] = useState({ displayH: 0, naturalH: 0 });
  const [dragging, setDragging] = useState(false);

  const syncImgMetrics = useCallback(() => {
    const img = imgRef.current;
    if (!img || !img.naturalHeight) return;
    setImgMetrics({ displayH: img.offsetHeight, naturalH: img.naturalHeight });
  }, []);

  useEffect(() => {
    syncImgMetrics();
    const ro = new ResizeObserver(syncImgMetrics);
    if (stageRef.current) ro.observe(stageRef.current);
    return () => ro.disconnect();
  }, [syncImgMetrics, imagen]);

  const lineas = [loteText, vencText].filter(Boolean);
  const puedeArrastrar = Boolean(onPositionChange && lineas.length > 0 && imagen);
  const fontPx =
    imgMetrics.naturalH > 0 && imgMetrics.displayH > 0
      ? Math.max(6, loteFont * (PREVIEW_DPI / 72) * (imgMetrics.displayH / imgMetrics.naturalH))
      : Math.max(6, loteFont);

  const moverDesdeEvento = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!onPositionChange || !stageRef.current) return;
      const capa = stageRef.current.querySelector("[data-lote-capa]") as HTMLDivElement | null;
      if (!capa) return;
      const { x, y } = pctDesdePuntero(capa.getBoundingClientRect(), e.clientX, e.clientY);
      onPositionChange(x, y);
    },
    [onPositionChange],
  );

  const onCapaPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!puedeArrastrar) return;
    e.preventDefault();
    setDragging(true);
    moverDesdeEvento(e);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onCapaPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    e.preventDefault();
    moverDesdeEvento(e);
  };

  const onCapaPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className={containerClassName}>
      {imagen ? (
        <div ref={stageRef} className="relative inline-block max-w-full max-h-[min(58vh,640px)] leading-none">
          <img
            ref={imgRef}
            src={`data:${mime};base64,${imagen}`}
            alt="Vista previa"
            className={`${imgClassName} ${loading ? "opacity-50" : "opacity-100"}`}
            onLoad={syncImgMetrics}
            draggable={false}
          />
          {puedeArrastrar && (
            <div
              data-lote-capa
              role="presentation"
              title="Arrastra dentro de la etiqueta para ubicar lote y vencimiento"
              className={`absolute inset-0 z-10 overflow-hidden rounded-lg touch-none select-none ${
                dragging ? "cursor-grabbing" : "cursor-grab"
              }`}
              onPointerDown={onCapaPointerDown}
              onPointerMove={onCapaPointerMove}
              onPointerUp={onCapaPointerUp}
              onPointerCancel={onCapaPointerUp}
            >
              <div
                className="absolute m-0 p-0 text-black pointer-events-none"
                style={{
                  left: `${xPct}%`,
                  top: `${yPct}%`,
                  maxWidth: `${Math.max(10, 98 - xPct)}%`,
                  fontFamily: '"Montserrat", sans-serif',
                  fontWeight: 300,
                  fontSize: `${fontPx}px`,
                  lineHeight: 1.35,
                  background: "transparent",
                  outline: dragging ? "1px dashed var(--accent, #016d82)" : "none",
                }}
              >
                {lineas.map((l, i) => (
                  <div key={i} className="whitespace-nowrap leading-[1.35]">
                    {l}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : loading ? (
        <div className="flex flex-col items-center gap-3 text-muted">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          <span className="text-xs">Renderizando...</span>
        </div>
      ) : (
        <p className="text-xs text-muted text-center px-8">{emptyText}</p>
      )}
    </div>
  );
}

// ── Navegador de archivos ─────────────────────────────────────────────────────

function BotonSubirPdfEtiqueta({
  onSubido,
  className = "",
  label = "📤 Subir PDF",
  disabled = false,
  compact = false,
}: {
  onSubido: (item: PdfItem) => void;
  className?: string;
  label?: string;
  disabled?: boolean;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [errorLocal, setErrorLocal] = useState<string | null>(null);

  const subirMut = useMutation({
    mutationFn: (file: File) => {
      const esPdf =
        file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      if (!esPdf) throw new Error("Solo se permiten archivos PDF.");
      const fd = new FormData();
      fd.append("archivo", file);
      return api.upload<{
        ok: boolean;
        nombre: string;
        ruta: string;
        ruta_completa: string;
        guardado?: boolean;
      }>("/api/etiquetas/subir-pdf", fd);
    },
    onSuccess: (data) => {
      setErrorLocal(null);
      qc.invalidateQueries({ queryKey: ["etiquetas-pdfs"] });
      onSubido({
        nombre: data.nombre,
        ruta: data.ruta,
        ruta_completa: data.ruta_completa,
        guardado: true,
      });
    },
    onError: (err) => setErrorLocal(err.message),
  });

  function procesarArchivos(files: FileList | null) {
    const f = files?.[0];
    if (f) subirMut.mutate(f);
    if (inputRef.current) inputRef.current.value = "";
  }

  const btnCls = compact
    ? `inline-flex h-8 items-center gap-1 rounded border-2 border-accent bg-accent px-3 ${RIB_FONT_BTN} font-bold text-white disabled:opacity-50`
    : `inline-flex items-center gap-1.5 rounded-lg border-2 border-accent bg-accent px-3 py-1.5 text-sm font-bold text-white transition hover:bg-accent/90 disabled:opacity-50`;

  return (
    <div className={className}>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        className="hidden"
        onChange={(e) => procesarArchivos(e.target.files)}
      />
      <button
        type="button"
        disabled={disabled || subirMut.isPending}
        onClick={() => inputRef.current?.click()}
        className={btnCls}
      >
        {subirMut.isPending ? "Guardando…" : label}
      </button>
      {errorLocal && (
        <p className="mt-1 text-[11px] text-red-600">{errorLocal}</p>
      )}
    </div>
  );
}

function NavegadorArchivos({
  onSeleccionar,
  onCerrar,
}: {
  onSeleccionar: (item: { nombre: string; ruta_completa: string }) => void;
  onCerrar: () => void;
}) {
  const [rutaActual, setRutaActual] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["nav-archivos", rutaActual ?? "__raiz__"],
    queryFn: () =>
      api.get<NavResp>(
        `/api/etiquetas/navegar?ruta=${encodeURIComponent(rutaActual ?? "__raiz__")}`,
      ),
  });

  const pdfsVisibles = (data?.pdfs ?? []).filter(
    (p) => !busqueda.trim() || p.nombre.toLowerCase().includes(busqueda.toLowerCase()),
  );

  function irA(ruta: string | null) {
    setBusqueda("");
    setRutaActual(ruta);
  }

  const breadcrumb: { nombre: string; ruta: string }[] = [];
  if (data?.ruta_actual) {
    const partes = data.ruta_actual.split("/").filter(Boolean);
    let acum = "";
    for (const p of partes) {
      acum += "/" + p;
      breadcrumb.push({ nombre: p, ruta: acum });
    }
  }

  const discos = data?.discos ?? [];
  const enRaiz = !!data?.modo_raiz;
  const apiSinDiscos =
    !isLoading && !error && !enRaiz && rutaActual === null && !!data?.ruta_actual;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="flex h-[80vh] w-full max-w-xl flex-col rounded-2xl border-2 border-border bg-surface-panel shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5 flex-shrink-0 gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-ink">Explorar archivos PDF</h3>
            <p className="text-xs text-muted truncate">
              {enRaiz ? "Selecciona un disco o sube un PDF (queda guardado en Documentos)" : data?.ruta_actual}
            </p>
          </div>
          <BotonSubirPdfEtiqueta
            compact
            label="📤 Subir"
            onSubido={(item) => {
              onSeleccionar({ nombre: item.nombre, ruta_completa: item.ruta_completa });
              onCerrar();
            }}
          />
          <button onClick={onCerrar} className="rounded p-1 text-muted hover:text-ink flex-shrink-0">✕</button>
        </div>

        {(enRaiz || data?.ruta_actual) && (
          <div className="flex items-center gap-1 overflow-x-auto border-b border-border px-4 py-2 flex-shrink-0 text-xs">
            {data?.padre != null && (
              <button
                onClick={() => irA(data.padre === "__raiz__" ? null : data.padre)}
                className="mr-1 rounded px-1.5 py-0.5 text-muted hover:bg-surface-hover hover:text-ink"
              >
                ←
              </button>
            )}
            {!enRaiz && (
              <button
                onClick={() => irA(null)}
                className="mr-1 rounded px-1.5 py-0.5 font-semibold text-accent hover:bg-surface-hover"
              >
                💿 Este equipo
              </button>
            )}
            {enRaiz ? (
              <span className="rounded px-1.5 py-0.5 font-semibold text-ink">Discos y ubicaciones</span>
            ) : (
              breadcrumb.map((b, i) => (
                <span key={b.ruta} className="flex items-center gap-1">
                  {i > 0 && <span className="text-muted">/</span>}
                  <button
                    onClick={() => irA(b.ruta)}
                    className={`rounded px-1.5 py-0.5 transition hover:bg-surface-hover ${
                      i === breadcrumb.length - 1 ? "font-semibold text-ink" : "text-muted"
                    }`}
                  >
                    {b.nombre}
                  </button>
                </span>
              ))
            )}
          </div>
        )}

        <div className="px-4 pt-3 pb-2 flex-shrink-0">
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar PDF en esta carpeta..."
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent placeholder:text-muted/50"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {apiSinDiscos && (
            <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-200">
              El servidor aún no tiene la vista de discos. Reinicia el servicio:{" "}
              <code className="font-mono">sudo systemctl restart agente-pro</code>
              {" "}y recarga el panel (Ctrl+Shift+R).
            </div>
          )}
          {isLoading && (
            <div className="flex items-center justify-center py-8 text-sm text-muted gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              Cargando...
            </div>
          )}
          {error && <p className="py-4 text-center text-sm text-red-500">Error al leer directorio</p>}

          {!busqueda && enRaiz && discos.map((d) => (
            <button
              key={d.ruta}
              onClick={() => irA(d.ruta)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition hover:bg-surface-hover"
            >
              <span className="text-base">{iconoDisco(d.icono)}</span>
              <span className="font-medium text-ink">{d.nombre}</span>
            </button>
          ))}

          {!busqueda && !enRaiz && (data?.carpetas ?? []).map((c) => (
            <button
              key={c}
              onClick={() => irA(`${data!.ruta_actual}/${c}`)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition hover:bg-surface-hover"
            >
              <span className="text-base">📁</span>
              <span className="font-medium text-ink">{c}</span>
            </button>
          ))}

          {!busqueda && !enRaiz && (data?.carpetas ?? []).length > 0 && pdfsVisibles.length > 0 && (
            <div className="my-2 border-t border-border" />
          )}

          {!enRaiz && pdfsVisibles.map((p) => (
            <button
              key={p.ruta_completa}
              onClick={() => onSeleccionar({ nombre: p.nombre, ruta_completa: p.ruta_completa })}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition hover:bg-accent hover:text-white"
            >
              <span className="text-base">📄</span>
              <span className="flex-1 font-medium">{p.nombre}</span>
              <span className="text-xs opacity-60">{p.tamano_kb} KB</span>
            </button>
          ))}

          {!isLoading && !enRaiz && pdfsVisibles.length === 0 && (data?.carpetas ?? []).length === 0 && (
            <p className="py-6 text-center text-sm text-muted">Sin archivos PDF aquí</p>
          )}
          {!isLoading && enRaiz && discos.length === 0 && (
            <p className="py-6 text-center text-sm text-muted">No se detectaron discos montados</p>
          )}
          {!isLoading && busqueda && pdfsVisibles.length === 0 && (
            <p className="py-6 text-center text-sm text-muted">Sin resultados para "{busqueda}"</p>
          )}
        </div>

        <div className="border-t border-border px-5 py-3 flex-shrink-0">
          <button
            onClick={onCerrar}
            className="w-full rounded-lg border-2 border-border py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-hover"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Wizard instalación ────────────────────────────────────────────────────────

function InstaladorWizard({ onCerrar }: { onCerrar: () => void }) {
  const [instalLog, setInstalLog] = useState<string[]>([]);
  const [instalDone, setInstalDone] = useState(false);

  const { data: diagData, isLoading: diagLoading, refetch: refetchDiag } = useQuery({
    queryKey: ["etiquetas-diagnostico"],
    queryFn: () => api.get<DiagResp>("/api/etiquetas/diagnostico"),
  });

  const instalarMut = useMutation({
    mutationFn: () => api.post<InstalResp>("/api/etiquetas/instalar", {}),
    onSuccess: (data) => { setInstalLog(data.log ?? []); setInstalDone(true); refetchDiag(); },
    onError: (err) => { setInstalLog([`Error: ${err.message}`]); setInstalDone(true); },
  });

  const todoOk = diagData?.todo_ok ?? false;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-lg rounded-2xl border-2 border-border bg-surface-panel shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h3 className="text-base font-bold text-ink">Instalación de impresora</h3>
            <p className="text-xs text-muted">Epson ColorWorks CW-C4000u</p>
          </div>
          <button onClick={onCerrar} className="rounded-lg p-1.5 text-muted hover:bg-surface-hover hover:text-ink">✕</button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">Diagnóstico del sistema</p>
            {diagLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent inline-block" />
                Verificando componentes...
              </div>
            ) : (
              <div className="space-y-1.5">
                {diagData?.checks.map((c) => (
                  <div key={c.nombre} className="flex items-start gap-3 rounded-lg border border-border bg-surface px-3 py-2">
                    <span className="mt-0.5 text-base leading-none">{c.ok ? "✅" : "❌"}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-ink">{c.nombre}</p>
                      {c.detalle && <p className="truncate text-[10px] text-muted">{c.detalle}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {diagData?.usb_detectado && (
            <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-700">
              Impresora USB detectada: <span className="font-mono">{diagData.usb_detectado}</span>
            </div>
          )}

          {instalLog.length > 0 && (
            <div className="rounded-lg border border-border bg-surface">
              <p className="border-b border-border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-muted">Log de instalación</p>
              <div className="max-h-40 overflow-y-auto p-3 font-mono text-[11px] text-ink space-y-0.5">
                {instalLog.map((l, i) => (
                  <div key={i} className={l.startsWith("✗") || l.startsWith("⚠") ? "text-orange-600" : ""}>{l}</div>
                ))}
              </div>
            </div>
          )}

          {todoOk && !instalarMut.isPending && (
            <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm font-semibold text-green-700 text-center">
              ✅ Todo está correctamente instalado
            </div>
          )}
        </div>

        <div className="flex gap-3 border-t border-border px-6 py-4">
          <button onClick={onCerrar} className="flex-1 rounded-lg border-2 border-border py-2.5 text-sm font-semibold text-ink-secondary hover:bg-surface-hover">
            {instalDone || todoOk ? "Cerrar" : "Cancelar"}
          </button>
          {!todoOk && (
            <button
              onClick={() => { setInstalLog([]); setInstalDone(false); instalarMut.mutate(); }}
              disabled={instalarMut.isPending || diagLoading}
              className="flex-1 rounded-lg border-2 border-accent bg-accent py-2.5 text-sm font-bold text-white shadow-[0_3px_0_#045159] transition hover:bg-accent-hover active:translate-y-0.5 active:shadow-none disabled:opacity-40"
            >
              {instalarMut.isPending ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Instalando...
                </span>
              ) : "Instalar automáticamente"}
            </button>
          )}
          {todoOk && (
            <button onClick={() => refetchDiag()} className="flex-1 rounded-lg border-2 border-border py-2.5 text-sm font-semibold text-ink hover:bg-surface-hover">
              Actualizar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Hook debounce ─────────────────────────────────────────────────────────────

function useDebounce<T>(value: T, delay: number): T {
  const [deb, setDeb] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDeb(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return deb;
}

// ── Tab: edición directa de texto dentro del PDF ──────────────────────────────

interface EditarPDFTabProps {
  rutaPdf: string;
  onGuardado: (nuevaRuta: string, nuevoNombre: string) => void;
}

function EditarPDFTab({ rutaPdf, onGuardado }: EditarPDFTabProps) {
  const [spans, setSpans] = useState<SpanPDF[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [guardandoModo, setGuardandoModo] = useState<"original" | "nuevo">("nuevo");
  const [resultado, setResultado] = useState<{ ok: boolean; msg: string } | null>(null);

  const { isLoading, error, refetch } = useQuery({
    queryKey: ["extraer-texto-pdf", rutaPdf],
    queryFn: async () => {
      const data = await api.get<{ spans: SpanPDF[]; total: number }>(
        `/api/etiquetas/extraer-texto?ruta_pdf=${encodeURIComponent(rutaPdf)}`,
      );
      setSpans(data.spans);
      return data;
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const guardarMut = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; ruta: string; nombre: string; cambios: number }>(
        "/api/etiquetas/guardar-pdf-editado",
        { ruta_pdf: rutaPdf, spans, modo: guardandoModo },
      ),
    onSuccess: (res) => {
      setResultado({ ok: true, msg: `✅ Guardado: ${res.nombre} (${res.cambios} cambio${res.cambios !== 1 ? "s" : ""})` });
      onGuardado(res.ruta, res.nombre);
      refetch();
    },
    onError: (err) => {
      setResultado({ ok: false, msg: `❌ ${err.message}` });
    },
  });

  const cambiosCount = spans.filter((s) => s.texto_editado !== s.texto_original).length;

  function updateSpan(id: string, texto: string) {
    setSpans((prev) => prev.map((s) => (s.id === id ? { ...s, texto_editado: texto } : s)));
    setResultado(null);
  }

  function resetSpan(id: string) {
    setSpans((prev) => prev.map((s) => (s.id === id ? { ...s, texto_editado: s.texto_original } : s)));
  }

  function resetTodo() {
    setSpans((prev) => prev.map((s) => ({ ...s, texto_editado: s.texto_original })));
    setResultado(null);
  }

  const spansFiltrados = spans.filter(
    (s) => !busqueda || s.texto_original.toLowerCase().includes(busqueda.toLowerCase()),
  );

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted">
        <span className="h-7 w-7 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        <span className="text-xs">Extrayendo texto del PDF...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
        Error al leer el PDF: {(error as Error).message}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Barra superior */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar texto en la etiqueta..."
          className="flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-ink outline-none focus:border-accent placeholder:text-muted/50"
        />
        {cambiosCount > 0 && (
          <button onClick={resetTodo} className="text-xs text-muted hover:text-danger whitespace-nowrap">
            Revertir todo
          </button>
        )}
        <span className="text-[10px] text-muted whitespace-nowrap">{spans.length} textos</span>
      </div>

      {/* Lista de spans */}
      <div className="max-h-[340px] overflow-y-auto space-y-1 pr-1">
        {spansFiltrados.map((span) => {
          const modificado = span.texto_editado !== span.texto_original;
          return (
            <div
              key={span.id}
              className={`rounded-lg border px-3 py-2 transition ${
                modificado ? "border-accent/60 bg-accent/5" : "border-border bg-surface"
              }`}
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  {/* Badge de fuente + tamaño */}
                  <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-surface-hover text-muted">
                      {span.font_name.split("-").slice(-1)[0] || span.font_name}
                    </span>
                    <span className="text-[9px] text-muted">{span.font_size.toFixed(1)}pt</span>
                    <span
                      className="inline-block h-3 w-3 rounded-sm border border-border flex-shrink-0"
                      style={{ backgroundColor: span.color_hex }}
                      title={span.color_hex}
                    />
                    {!span.font_file && (
                      <span className="text-[9px] text-orange-500" title="Fuente no encontrada en el sistema — se usará Helvetica">⚠ fuente approx.</span>
                    )}
                  </div>
                  <ProseTextarea
                    value={span.texto_editado}
                    onChange={(e) => updateSpan(span.id, e.target.value)}
                    rows={span.texto_editado.split("\n").length}
                    className="w-full rounded border border-border bg-white px-2 py-1 text-xs text-ink outline-none focus:border-accent resize-none font-mono leading-relaxed"
                    style={{ minHeight: "28px" }}
                  />
                  {modificado && (
                    <p className="mt-0.5 text-[9px] text-muted line-through opacity-60 truncate">
                      Original: {span.texto_original}
                    </p>
                  )}
                </div>
                {modificado && (
                  <button
                    onClick={() => resetSpan(span.id)}
                    className="mt-5 flex-shrink-0 text-[10px] text-muted hover:text-danger"
                    title="Revertir este campo"
                  >
                    ↩
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {spansFiltrados.length === 0 && (
          <p className="py-6 text-center text-xs text-muted">
            {busqueda ? `Sin resultados para "${busqueda}"` : "Sin texto extraído"}
          </p>
        )}
      </div>

      {/* Resultado y botón guardar */}
      {resultado && (
        <p className={`rounded-lg px-3 py-2 text-xs font-medium ${resultado.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
          {resultado.msg}
        </p>
      )}

      <div className="flex items-center gap-2 border-t border-border pt-3">
        <div className="flex gap-1 flex-shrink-0">
          {(["nuevo", "original"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setGuardandoModo(m)}
              className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-semibold transition ${
                guardandoModo === m
                  ? "border-accent bg-accent text-white"
                  : "border-border text-muted hover:text-ink"
              }`}
            >
              {m === "nuevo" ? "Guardar como copia" : "Sobreescribir original"}
            </button>
          ))}
        </div>
        <button
          onClick={() => guardarMut.mutate()}
          disabled={cambiosCount === 0 || guardarMut.isPending}
          className="flex-1 rounded-lg border-2 border-accent bg-accent py-2 text-xs font-bold text-white shadow-[0_2px_0_#045159] hover:bg-accent-hover active:translate-y-0.5 active:shadow-none disabled:opacity-40 transition"
        >
          {guardarMut.isPending
            ? "Guardando..."
            : cambiosCount === 0
            ? "Sin cambios"
            : `Guardar ${cambiosCount} cambio${cambiosCount !== 1 ? "s" : ""} en PDF`}
        </button>
      </div>
    </div>
  );
}

// ── Editor de datos de etiqueta ───────────────────────────────────────────────

function nuevoCampo(): CampoTexto {
  return {
    id: Math.random().toString(36).slice(2, 9),
    etiqueta: "Campo nuevo",
    texto: "",
    x_pct: 5,
    y_pct: 10,
    font_size: 8,
    font_variant: "regular",
    bold: false,
    align: "left",
    ortografia: true,
    fondo_blanco: true,
    color: "#000000",
    color_trazo: "#000000",
    grosor_trazo: 0,
    ancho_caja_pct: 42,
    alto_caja_pct: 14,
  };
}

interface EditorProps {
  combo: ComboSiigo;
  datosIniciales: DatosEtiqueta;
  onGuardado: (datos: DatosEtiqueta) => void;
  onImprimir: (datos: DatosEtiqueta) => void;
  onCerrar: () => void;
}

function EditorEtiqueta({ combo, datosIniciales, onGuardado, onImprimir, onCerrar }: EditorProps) {
  const qc = useQueryClient();
  const [mostrarNavegador, setMostrarNavegador] = useState(false);
  const [tabEditor, setTabEditor] = useState<EditorRibbonTab>("inicio");
  const [campoExpandido, setCampoExpandido] = useState<string | null>(null);
  const [errorImpresion, setErrorImpresion] = useState<ErrorImpresora | null>(null);

  const lotePctInit = lotePctInicial(
    datosIniciales.lote_pos,
    datosIniciales.lote_x_pct,
    datosIniciales.lote_y_pct,
  );
  const [form, setForm] = useState<DatosEtiqueta>({
    siigo_code: combo.code,
    siigo_name: combo.name,
    nombre_etiqueta: datosIniciales.nombre_etiqueta ?? combo.name,
    presentacion: datosIniciales.presentacion ?? "",
    pdf_ruta: datosIniciales.pdf_ruta ?? "",
    pdf_nombre: datosIniciales.pdf_nombre ?? "",
    lote_defecto: conPrefijoLote(datosIniciales.lote_defecto),
    vencimiento_defecto: conPrefijoExp(datosIniciales.vencimiento_defecto),
    tipo_etiqueta: datosIniciales.tipo_etiqueta ?? ETIQUETAS_LISTA[0],
    forma: datosIniciales.forma ?? "Diecut_Gap",
    calidad: datosIniciales.calidad ?? "Normal",
    rotacion: rotacionValida(datosIniciales.rotacion),
    lote_pos: datosIniciales.lote_pos ?? "bottom-left",
    lote_font: datosIniciales.lote_font ?? 7,
    lote_x_pct: lotePctInit.x,
    lote_y_pct: lotePctInit.y,
    campos_texto: datosIniciales.campos_texto ?? [],
  });

  const set = (k: keyof DatosEtiqueta, v: unknown) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Debounce de campos_texto para el preview
  const camposDebounced = useDebounce(form.campos_texto, 700);
  const { data: previewData, isFetching: previewLoading } = useQuery({
    queryKey: ["editor-preview", form.pdf_ruta, camposDebounced],
    queryFn: () =>
      api.post<{ imagen: string; mime: string; error?: string }>("/api/etiquetas/preview", {
        ruta_pdf: form.pdf_ruta,
        campos_texto: camposDebounced,
      }),
    enabled: !!form.pdf_ruta,
    staleTime: 0,
  });

  const guardarMut = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; datos: DatosEtiqueta }>(`/api/etiquetas/datos/${combo.code}`, form),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["etiquetas-datos"] });
      onGuardado(res.datos);
    },
  });

  const imprimirEditorMut = useMutation({
    mutationFn: (payload: ImpresionEtiquetaPayload) =>
      api.post<PrintResult>("/api/etiquetas/imprimir", payload),
    onError: (err) => setErrorImpresion(errorDesdeExcepcion(err.message)),
  });

  function handleImprimirEditor() {
    const payload = payloadDesdeFormularioEtiqueta(form);
    if (!payload) return;
    void imprimirEditorMut.mutateAsync(payload).then((res) => {
      const err = errorDesdePrintResult(res);
      setErrorImpresion(err);
      if (!err) onImprimir(form);
    });
  }

  // ── Helpers campos de texto ───────────────────────────────────────────────

  function agregarCampo() {
    const c = nuevoCampo();
    set("campos_texto", [...(form.campos_texto ?? []), c]);
    setCampoExpandido(c.id);
  }

  function eliminarCampo(id: string) {
    set("campos_texto", (form.campos_texto ?? []).filter((c) => c.id !== id));
    if (campoExpandido === id) setCampoExpandido(null);
  }

  function actualizarCampo(id: string, patch: Partial<CampoTexto>) {
    set(
      "campos_texto",
      (form.campos_texto ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c)),
    );
  }

  function moverCampo(id: string, dir: -1 | 1) {
    const arr = [...(form.campos_texto ?? [])];
    const idx = arr.findIndex((c) => c.id === id);
    if (idx < 0) return;
    const to = idx + dir;
    if (to < 0 || to >= arr.length) return;
    [arr[idx], arr[to]] = [arr[to], arr[idx]];
    set("campos_texto", arr);
  }

  const campos = form.campos_texto ?? [];
  const ribbonTabs: { id: EditorRibbonTab; label: string; disabled?: boolean }[] = [
    { id: "inicio", label: "Inicio" },
    { id: "lote", label: "Lote" },
    { id: "impresion", label: "Impresión" },
    { id: "texto", label: "Overlay" },
    { id: "editar-pdf", label: "Editar PDF", disabled: !form.pdf_ruta },
  ];

  return (
    <>
      {mostrarNavegador && (
        <NavegadorArchivos
          onSeleccionar={(item) => {
            set("pdf_ruta", item.ruta_completa);
            set("pdf_nombre", item.nombre);
            setMostrarNavegador(false);
          }}
          onCerrar={() => setMostrarNavegador(false)}
        />
      )}

      <div className="fixed inset-0 z-40 flex flex-col bg-black/40">
        <div className="mx-auto flex h-full w-full max-w-[min(100vw,1440px)] flex-col overflow-hidden border-x border-border bg-surface-panel shadow-2xl">
          {/* Barra de título — estilo Word */}
          <div className="flex flex-shrink-0 items-center gap-3 border-b border-accent/30 bg-accent px-4 py-2 text-white">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">{combo.name}</p>
              <p className="font-mono text-[10px] opacity-75">{combo.code}</p>
            </div>
            {form.pdf_nombre && (
              <span className="hidden max-w-[200px] truncate text-[10px] opacity-80 sm:inline">
                📄 {form.pdf_nombre}
              </span>
            )}
            <button
              type="button"
              onClick={onCerrar}
              className="rounded-md p-1.5 text-white/90 transition hover:bg-white/15"
              title="Cerrar"
            >
              ✕
            </button>
          </div>

          {errorImpresion && (
            <BannerErrorImpresora
              error={errorImpresion}
              onCerrar={() => setErrorImpresion(null)}
            />
          )}

          {/* Cinta — pestañas */}
          <RibbonTabs tabs={ribbonTabs} active={tabEditor} onChange={setTabEditor} />

          {/* Cinta — herramientas por pestaña */}
          {tabEditor !== "texto" && tabEditor !== "editar-pdf" && (
            <div className="flex flex-shrink-0 overflow-x-auto border-b border-border bg-surface">
              {tabEditor === "inicio" && (
                <>
                  <RibbonGroup label="Archivo">
                    <BotonSubirPdfEtiqueta
                      compact
                      label="📤 Subir"
                      onSubido={(item) => {
                        set("pdf_ruta", item.ruta_completa);
                        set("pdf_nombre", item.nombre);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setMostrarNavegador(true)}
                      className={`inline-flex h-8 items-center gap-1 rounded border border-border bg-surface px-2.5 ${RIB_FONT_BTN} font-semibold text-ink hover:border-accent hover:text-accent`}
                    >
                      📂 Elegir PDF
                    </button>
                    {form.pdf_ruta && (
                      <button
                        type="button"
                        onClick={() => { set("pdf_ruta", ""); set("pdf_nombre", ""); }}
                        className={`h-8 rounded border border-border px-2 ${RIB_FONT_BTN} text-muted hover:text-danger`}
                        title="Quitar PDF"
                      >
                        ✕
                      </button>
                    )}
                    <span className={`max-w-[140px] truncate ${RIB_FONT_META} text-muted self-center`}>
                      {form.pdf_nombre || "Sin archivo"}
                    </span>
                  </RibbonGroup>
                  <RibbonGroup label="Identidad">
                    <div>
                      <label className={RIB_LBL}>Nombre</label>
                      <input
                        type="text"
                        value={form.nombre_etiqueta ?? ""}
                        onChange={(e) => set("nombre_etiqueta", e.target.value)}
                        className={RIB_INP}
                        placeholder="Nombre en etiqueta"
                      />
                    </div>
                    <div>
                      <label className={RIB_LBL}>Presentación</label>
                      <input
                        type="text"
                        value={form.presentacion ?? ""}
                        onChange={(e) => set("presentacion", e.target.value)}
                        className={RIB_INP}
                        placeholder="250 g"
                      />
                    </div>
                  </RibbonGroup>
                  <RibbonGroup label="Acciones">
                    <button
                      type="button"
                      onClick={() => guardarMut.mutate()}
                      disabled={guardarMut.isPending}
                      className={`inline-flex h-8 items-center gap-1 rounded border-2 border-accent bg-accent px-3 ${RIB_FONT_BTN} font-bold text-white disabled:opacity-50`}
                    >
                      <Icon name="floppyDisk" size={13} weight="bold" />
                      {guardarMut.isPending ? "…" : "Guardar"}
                    </button>
                    <button
                      type="button"
                      onClick={handleImprimirEditor}
                      disabled={!form.pdf_ruta || imprimirEditorMut.isPending}
                      className={`inline-flex h-8 items-center gap-1 rounded border-2 border-green-600 bg-green-600 px-3 ${RIB_FONT_BTN} font-bold text-white disabled:opacity-40`}
                    >
                      🖨 {imprimirEditorMut.isPending ? "…" : "Imprimir"}
                    </button>
                  </RibbonGroup>
                </>
              )}
              {tabEditor === "lote" && (
                <>
                  <RibbonGroup label="Texto">
                    <div>
                      <label className={RIB_LBL}>Lote</label>
                      <input
                        type="text"
                        value={form.lote_defecto ?? LOTE_PREFIJO}
                        onChange={(e) => set("lote_defecto", editarConPrefijo(e.target.value, LOTE_PREFIJO))}
                        className={RIB_INP}
                      />
                    </div>
                    <div>
                      <label className={RIB_LBL}>Vencimiento</label>
                      <input
                        type="text"
                        value={form.vencimiento_defecto ?? EXP_PREFIJO}
                        onChange={(e) => set("vencimiento_defecto", editarConPrefijo(e.target.value, EXP_PREFIJO))}
                        className={RIB_INP}
                      />
                    </div>
                  </RibbonGroup>
                  <RibbonGroup label="Posición">
                    <div>
                      <label className={RIB_LBL}>X %</label>
                      <input
                        type="number"
                        min={0}
                        max={98}
                        step={0.5}
                        value={form.lote_x_pct ?? 5}
                        onChange={(e) => { set("lote_x_pct", Number(e.target.value)); set("lote_pos", "custom"); }}
                        className={`${RIB_INP} w-16`}
                      />
                    </div>
                    <div>
                      <label className={RIB_LBL}>Y %</label>
                      <input
                        type="number"
                        min={0}
                        max={98}
                        step={0.5}
                        value={form.lote_y_pct ?? 88}
                        onChange={(e) => { set("lote_y_pct", Number(e.target.value)); set("lote_pos", "custom"); }}
                        className={`${RIB_INP} w-16`}
                      />
                    </div>
                    <p className={`max-w-[120px] self-center ${RIB_FONT_HINT} leading-tight text-muted`}>
                      Arrastra en la vista previa
                    </p>
                  </RibbonGroup>
                  <RibbonGroup label="Tipografía">
                    <div className="flex min-w-[140px] flex-col gap-0.5">
                      <label className={RIB_LBL}>Tamaño · Montserrat Light</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={5}
                          max={14}
                          step={1}
                          value={form.lote_font ?? 7}
                          onChange={(e) => set("lote_font", Number(e.target.value))}
                          className="w-24 accent-accent"
                        />
                        <span className={`${RIB_FONT_BTN} font-bold text-ink`}>{form.lote_font ?? 7}pt</span>
                      </div>
                    </div>
                  </RibbonGroup>
                </>
              )}
              {tabEditor === "impresion" && (
                <>
                  <RibbonGroup label="Formato">
                    <div>
                      <label className={RIB_LBL}>Tipo</label>
                      <select
                        value={form.tipo_etiqueta ?? ""}
                        onChange={(e) => {
                          const tipo = e.target.value;
                          set("tipo_etiqueta", tipo);
                          set("rotacion", rotacionDefaultEtiqueta(tipo));
                        }}
                        className={RIB_SEL}
                      >
                        {ETIQUETAS_LISTA.map((e) => <option key={e}>{e}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={RIB_LBL}>Sensor</label>
                      <select value={form.forma ?? "Diecut_Gap"} onChange={(e) => set("forma", e.target.value)} className={RIB_SEL}>
                        {FORMAS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                      </select>
                    </div>
                  </RibbonGroup>
                  <RibbonGroup label="Calidad">
                    <div>
                      <label className={RIB_LBL}>Impresión</label>
                      <select value={form.calidad ?? "Normal"} onChange={(e) => set("calidad", e.target.value)} className={RIB_SEL}>
                        {CALIDADES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={RIB_LBL}>Rotación</label>
                      <div className="flex gap-1">
                        {ROTACIONES.map((r) => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => set("rotacion", r)}
                            className={`h-9 min-w-[2.25rem] rounded border-2 ${RIB_FONT_BTN} font-bold ${form.rotacion === r ? "border-accent bg-accent text-white" : "border-border text-ink-secondary"}`}
                          >
                            {r}°
                          </button>
                        ))}
                      </div>
                    </div>
                  </RibbonGroup>
                </>
              )}
            </div>
          )}

          {/* Panel secundario: overlay / editar PDF */}
          {tabEditor === "texto" && (
            <div className="max-h-[38vh] flex-shrink-0 overflow-y-auto border-b border-border bg-surface px-4 py-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-bold text-ink">Campos de texto sobre la etiqueta</p>
                <button
                  type="button"
                  onClick={agregarCampo}
                  className={`rounded border-2 border-accent px-2.5 py-1 ${RIB_FONT_BTN} font-bold text-accent hover:bg-accent hover:text-white`}
                >
                  + Añadir campo
                </button>
              </div>
              {campos.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted">Sin campos. Pulsa «+ Añadir campo».</p>
              ) : (
                <div className="space-y-2">
                  {campos.map((campo, idx) => {
                    const expandido = campoExpandido === campo.id;
                    return (
                      <div key={campo.id} className="rounded-lg border border-border bg-surface-panel overflow-hidden">
                        <div
                          className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-surface-hover"
                          onClick={() => setCampoExpandido(expandido ? null : campo.id)}
                        >
                          <span className="text-sm">{expandido ? "▾" : "▸"}</span>
                          <span className="flex-1 truncate text-xs font-semibold">{campo.etiqueta || "Campo"}</span>
                          <button type="button" onClick={(e) => { e.stopPropagation(); moverCampo(campo.id, -1); }} disabled={idx === 0} className="p-1 text-muted disabled:opacity-30">↑</button>
                          <button type="button" onClick={(e) => { e.stopPropagation(); moverCampo(campo.id, 1); }} disabled={idx === campos.length - 1} className="p-1 text-muted disabled:opacity-30">↓</button>
                          <button type="button" onClick={(e) => { e.stopPropagation(); eliminarCampo(campo.id); }} className="p-1 text-muted hover:text-danger">✕</button>
                        </div>
                        {expandido && (
                          <div className="space-y-2 border-t border-border px-3 py-3">
                            <input type="text" value={campo.etiqueta} onChange={(e) => actualizarCampo(campo.id, { etiqueta: e.target.value })} className={RIB_INP} placeholder="Nombre del campo" />
                            <ProseTextarea value={campo.texto} onChange={(e) => actualizarCampo(campo.id, { texto: e.target.value })} rows={2} className="w-full rounded border border-border bg-surface px-2 py-1.5 text-xs resize-none" />
                            <div className="flex flex-wrap gap-3 text-xs">
                              <label className="flex items-center gap-1"><input type="checkbox" checked={campo.bold} onChange={(e) => actualizarCampo(campo.id, { bold: e.target.checked })} className="accent-accent" /> Negrita</label>
                              <label className="flex items-center gap-1"><input type="checkbox" checked={campo.fondo_blanco} onChange={(e) => actualizarCampo(campo.id, { fondo_blanco: e.target.checked })} className="accent-accent" /> Fondo blanco</label>
                              <input type="color" value={campo.color} onChange={(e) => actualizarCampo(campo.id, { color: e.target.value })} className="h-6 w-8" />
                              <span className="text-muted">X {campo.x_pct}% Y {campo.y_pct}%</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {tabEditor === "editar-pdf" && form.pdf_ruta && (
            <div className="max-h-[38vh] flex-shrink-0 overflow-y-auto border-b border-border bg-surface px-4 py-3">
              <EditarPDFTab
                rutaPdf={form.pdf_ruta}
                onGuardado={(nuevaRuta, nuevoNombre) => {
                  set("pdf_ruta", nuevaRuta);
                  set("pdf_nombre", nuevoNombre);
                }}
              />
            </div>
          )}

          {/* Lienzo — vista previa */}
          <div className="flex min-h-0 flex-1 flex-col bg-surface-hover/25">
            {form.pdf_ruta ? (
              <>
                <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-surface-panel/80 px-4 py-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Documento</span>
                  <span className="font-mono text-[10px] text-muted">
                    X {(form.lote_x_pct ?? 5).toFixed(1)}% · Y {(form.lote_y_pct ?? 88).toFixed(1)}%
                    {previewLoading && " · actualizando…"}
                  </span>
                </div>
                <div className="flex flex-1 items-center justify-center overflow-auto p-3">
                  <VistaPreviaConLote
                    imagen={previewData?.imagen}
                    mime={previewData?.mime}
                    loading={previewLoading}
                    loteText={loteParaEtiqueta(form.lote_defecto)}
                    vencText={expParaEtiqueta(form.vencimiento_defecto)}
                    loteFont={form.lote_font ?? 7}
                    xPct={form.lote_x_pct ?? 5}
                    yPct={form.lote_y_pct ?? 88}
                    imgClassName={PREVIEW_IMG_LARGE}
                    containerClassName={PREVIEW_CONTAINER_LARGE}
                    onPositionChange={(x, y) => {
                      setForm((f) => ({ ...f, lote_x_pct: x, lote_y_pct: y, lote_pos: "custom" }));
                    }}
                  />
                </div>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
                <p className="text-sm font-medium text-muted">Sin PDF asociado</p>
                <p className="text-xs text-muted">Pestaña <strong>Inicio</strong> → Archivo → Elegir PDF</p>
                <button type="button" onClick={() => { setTabEditor("inicio"); setMostrarNavegador(true); }} className="mt-2 rounded-lg border-2 border-accent px-4 py-2 text-xs font-bold text-accent hover:bg-accent hover:text-white">
                  📂 Elegir PDF
                </button>
              </div>
            )}
          </div>

          {/* Barra de estado */}
          <div className="flex flex-shrink-0 items-center gap-2 border-t border-border bg-surface-panel px-4 py-2">
            <button type="button" onClick={onCerrar} className="rounded border border-border px-3 py-1.5 text-xs font-semibold text-muted hover:bg-surface-hover">
              Cerrar
            </button>
            <div className="flex-1 truncate text-[10px] text-muted">
              {form.pdf_nombre ? `📄 ${form.pdf_nombre}` : "Editor de etiquetas"}
            </div>
            <button
              type="button"
              onClick={() => guardarMut.mutate()}
              disabled={guardarMut.isPending}
              className="inline-flex items-center gap-1 rounded border-2 border-accent bg-accent px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
            >
              <Icon name="floppyDisk" size={14} weight="bold" />
              Guardar
            </button>
            <button
              type="button"
              onClick={handleImprimirEditor}
              disabled={!form.pdf_ruta || imprimirEditorMut.isPending}
              className="rounded border-2 border-green-600 bg-green-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
            >
              🖨 Imprimir
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Tab: Configurar Productos ─────────────────────────────────────────────────

interface ConfiguradorProps {
  onImprimirProducto: (datos: DatosEtiqueta) => void;
}

function TabConfigurar({ onImprimirProducto }: ConfiguradorProps) {
  const qc = useQueryClient();
  const [busqueda, setBusqueda] = useState("");
  const busquedaDebounced = useDebounce(busqueda, 500);
  const [comboSeleccionado, setComboSeleccionado] = useState<ComboSiigo | null>(null);
  const [eliminandoSku, setEliminandoSku] = useState<string | null>(null);

  const { data: combosData, isLoading: cargandoCombos } = useQuery({
    queryKey: ["combos-siigo", busquedaDebounced],
    queryFn: () =>
      api.get<{ combos: ComboSiigo[]; total: number }>(
        `/api/etiquetas/combos-siigo${busquedaDebounced ? `?q=${encodeURIComponent(busquedaDebounced)}` : ""}`,
      ),
    staleTime: 5 * 60 * 1000,
  });

  const { data: datosData } = useQuery({
    queryKey: ["etiquetas-datos"],
    queryFn: () => api.get<{ datos: Record<string, DatosEtiqueta>; total: number }>("/api/etiquetas/datos"),
    staleTime: 30 * 1000,
  });

  const eliminarMut = useMutation({
    mutationFn: (sku: string) => api.delete(`/api/etiquetas/datos/${sku}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["etiquetas-datos"] }); setEliminandoSku(null); },
  });

  const combos = combosData?.combos ?? [];
  const datos = datosData?.datos ?? {};
  const totalConfigurados = Object.keys(datos).length;

  const combosConfigurados = combos.filter((c) => datos[c.code]);
  const combosNoConfigurados = combos.filter((c) => !datos[c.code]);

  const renderCombo = (c: ComboSiigo) => {
    const config = datos[c.code];
    const tieneConfig = !!config;
    const tienePdf = !!config?.pdf_nombre;

    return (
      <div
        key={c.code}
        className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 hover:bg-surface-hover transition cursor-pointer group"
        onClick={() => setComboSeleccionado(c)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-ink truncate">{config?.nombre_etiqueta || c.name}</span>
            {config?.presentacion && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-surface-hover text-muted font-mono">{config.presentacion}</span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-[10px] font-mono text-muted">{c.code}</span>
            {tieneConfig && (
              <>
                {tienePdf
                  ? <span className="text-[10px] text-green-600 font-medium">📄 {config.pdf_nombre}</span>
                  : <span className="text-[10px] text-orange-500">Sin PDF</span>}
                {config.lote_defecto && (
                  <span className="text-[10px] text-muted">{config.lote_defecto}</span>
                )}
              </>
            )}
            {!tieneConfig && <span className="text-[10px] text-muted">Sin configurar</span>}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {tieneConfig && tienePdf && (
            <button
              onClick={(e) => { e.stopPropagation(); onImprimirProducto(config); }}
              className="rounded-lg border border-green-500 bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-700 hover:bg-green-100 transition opacity-0 group-hover:opacity-100"
            >
              🖨
            </button>
          )}
          {tieneConfig && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (eliminandoSku === c.code) {
                  eliminarMut.mutate(c.code);
                } else {
                  setEliminandoSku(c.code);
                  setTimeout(() => setEliminandoSku(null), 3000);
                }
              }}
              className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition opacity-0 group-hover:opacity-100 ${
                eliminandoSku === c.code
                  ? "border-red-500 bg-red-500 text-white"
                  : "border-border text-muted hover:border-red-400 hover:text-red-500"
              }`}
              title={eliminandoSku === c.code ? "Clic para confirmar" : "Eliminar configuración"}
            >
              {eliminandoSku === c.code ? "¿Eliminar?" : "✕"}
            </button>
          )}
          <span className="text-xs text-muted group-hover:text-accent transition">Editar →</span>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Barra de búsqueda */}
      <div className="flex items-center gap-3">
        <div className="flex-1 relative">
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar producto SIIGO Combo..."
            className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-ink outline-none focus:border-accent placeholder:text-muted/50 pr-10"
          />
          {busqueda && (
            <button
              onClick={() => setBusqueda("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
            >
              ✕
            </button>
          )}
        </div>
        {cargandoCombos && (
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </span>
        )}
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-surface-panel px-4 py-3 text-center">
          <p className="text-xl font-extrabold text-ink">{combos.length}</p>
          <p className="text-xs text-muted mt-0.5">Combos SIIGO</p>
        </div>
        <div className="rounded-xl border border-border bg-surface-panel px-4 py-3 text-center">
          <p className="text-xl font-extrabold text-green-600">{totalConfigurados}</p>
          <p className="text-xs text-muted mt-0.5">Configurados</p>
        </div>
        <div className="rounded-xl border border-border bg-surface-panel px-4 py-3 text-center">
          <p className="text-xl font-extrabold text-orange-500">{combosNoConfigurados.length}</p>
          <p className="text-xs text-muted mt-0.5">Sin configurar</p>
        </div>
      </div>

      {/* Lista */}
      {combos.length === 0 && !cargandoCombos && (
        <div className="rounded-xl border-2 border-dashed border-border py-12 text-center">
          <p className="text-sm text-muted">
            {busqueda ? `Sin resultados para "${busqueda}"` : "No se encontraron combos SIIGO"}
          </p>
        </div>
      )}

      {combosConfigurados.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Configurados</p>
          {combosConfigurados.map(renderCombo)}
        </div>
      )}

      {combosNoConfigurados.length > 0 && (
        <div className="space-y-2">
          {combosConfigurados.length > 0 && (
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Sin configurar</p>
          )}
          {combosNoConfigurados.map(renderCombo)}
        </div>
      )}

      {/* Editor */}
      {comboSeleccionado && (
        <EditorEtiqueta
          combo={comboSeleccionado}
          datosIniciales={datos[comboSeleccionado.code] ?? {}}
          onGuardado={() => setComboSeleccionado(null)}
          onImprimir={(d) => { onImprimirProducto(d); setComboSeleccionado(null); }}
          onCerrar={() => setComboSeleccionado(null)}
        />
      )}
    </div>
  );
}

// ── Editor plantillas (dibujo simple) ─────────────────────────────────────────

function EditorPlantillaCanvas({
  anchoMm,
  altoMm,
  campos,
  lineas,
  imagenes,
  rectangulos,
  recursosThumb,
  herramienta,
  seleccion,
  fontSize,
  onSeleccion,
  onActivarSeleccion,
  onCamposChange,
  onLineasChange,
  onImagenesChange,
  onRectangulosChange,
  onSuprimirSeleccion,
}: {
  anchoMm: number;
  altoMm: number;
  campos: CampoTexto[];
  lineas: LineaPlantilla[];
  imagenes: ImagenPlantilla[];
  rectangulos: RectanguloPlantilla[];
  recursosThumb: Record<string, string | null | undefined>;
  herramienta: HerramientaPlantilla;
  seleccion: SeleccionPlantilla;
  fontSize: number;
  onSeleccion: (s: SeleccionPlantilla) => void;
  onActivarSeleccion?: () => void;
  onCamposChange: (c: CampoTexto[]) => void;
  onLineasChange: (l: LineaPlantilla[]) => void;
  onImagenesChange: (i: ImagenPlantilla[]) => void;
  onRectangulosChange: (r: RectanguloPlantilla[]) => void;
  onSuprimirSeleccion?: () => void;
}) {
  const lienzoRef = useRef<HTMLDivElement>(null);
  const textoEditRef = useRef<HTMLTextAreaElement>(null);
  const [dibujando, setDibujando] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [dibujandoRect, setDibujandoRect] = useState<{ x1: number; y1: number; x2: number; y2: number; proporcion?: boolean } | null>(null);
  const [arrastrando, setArrastrando] = useState<ArrastrePlantilla | null>(null);
  const [redimensionando, setRedimensionando] = useState<RedimensionPlantilla | null>(null);

  useEffect(() => {
    if (seleccion?.tipo === "texto") {
      requestAnimationFrame(() => {
        const el = textoEditRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      });
    }
  }, [seleccion?.id]);

  const pctDesdeEvento = useCallback((clientX: number, clientY: number) => {
    const el = lienzoRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return pctDesdePuntero(r, clientX, clientY);
  }, []);

  useEffect(() => {
    if (!dibujando && !dibujandoRect && !arrastrando && !redimensionando) return;
    function onMove(e: MouseEvent) {
      if (redimensionando) {
        const p = pctDesdeEvento(e.clientX, e.clientY);
        if (redimensionando.tipo === "linea") {
          const patch =
            redimensionando.punto === "inicio"
              ? { x1_pct: clampLotePct(p.x), y1_pct: clampLotePct(p.y) }
              : { x2_pct: clampLotePct(p.x), y2_pct: clampLotePct(p.y) };
          onLineasChange(lineas.map((ln) => (ln.id === redimensionando.id ? { ...ln, ...patch } : ln)));
        } else {
          const { x, y, w, h } = calcularCajaRedimension(
            redimensionando.orig,
            redimensionando.asa,
            p,
            e.shiftKey,
          );
          if (redimensionando.tipo === "rectangulo") {
            onRectangulosChange(
              rectangulos.map((rc) =>
                rc.id === redimensionando.id
                  ? { ...rc, x_pct: x, y_pct: y, ancho_pct: w, alto_pct: h }
                  : rc,
              ),
            );
          } else if (redimensionando.tipo === "imagen") {
            onImagenesChange(
              imagenes.map((im) =>
                im.id === redimensionando.id
                  ? { ...im, x_pct: x, y_pct: y, ancho_pct: w, alto_pct: h }
                  : im,
              ),
            );
          } else {
            onCamposChange(
              campos.map((c) =>
                c.id === redimensionando.id
                  ? { ...c, x_pct: x, y_pct: y, ancho_caja_pct: w, alto_caja_pct: h }
                  : c,
              ),
            );
          }
        }
      }
      if (dibujandoRect) {
        const p = pctDesdeEvento(e.clientX, e.clientY);
        setDibujandoRect((d) => (d ? { ...d, x2: p.x, y2: p.y, proporcion: e.shiftKey } : d));
      }
      if (dibujando) {
        const p = pctDesdeEvento(e.clientX, e.clientY);
        setDibujando((d) => {
          if (!d) return d;
          if (e.shiftKey) {
            const snap = snapLineaRecta(d.x1, d.y1, p.x, p.y);
            return { ...d, x2: snap.x2, y2: snap.y2 };
          }
          return { ...d, x2: p.x, y2: p.y };
        });
      }
      if (arrastrando) {
        const p = pctDesdeEvento(e.clientX, e.clientY);
        if (arrastrando.tipo === "texto") {
          onCamposChange(
            campos.map((c) =>
              c.id === arrastrando.id
                ? { ...c, x_pct: clampLotePct(p.x - arrastrando.ox), y_pct: clampLotePct(p.y - arrastrando.oy) }
                : c,
            ),
          );
        } else if (arrastrando.tipo === "imagen" || arrastrando.tipo === "rectangulo") {
          const patch = { x_pct: clampLotePct(p.x - arrastrando.ox), y_pct: clampLotePct(p.y - arrastrando.oy) };
          if (arrastrando.tipo === "imagen") {
            onImagenesChange(imagenes.map((im) => (im.id === arrastrando.id ? { ...im, ...patch } : im)));
          } else {
            onRectangulosChange(rectangulos.map((rc) => (rc.id === arrastrando.id ? { ...rc, ...patch } : rc)));
          }
        } else {
          const dx = p.x - arrastrando.startX;
          const dy = p.y - arrastrando.startY;
          onLineasChange(
            lineas.map((ln) =>
              ln.id === arrastrando.id
                ? {
                    ...ln,
                    x1_pct: clampLotePct(arrastrando.orig.x1 + dx),
                    y1_pct: clampLotePct(arrastrando.orig.y1 + dy),
                    x2_pct: clampLotePct(arrastrando.orig.x2 + dx),
                    y2_pct: clampLotePct(arrastrando.orig.y2 + dy),
                  }
                : ln,
            ),
          );
        }
      }
    }
    function onUp(e: MouseEvent) {
      if (dibujandoRect) {
        const box = rectNormalizado(dibujandoRect.x1, dibujandoRect.y1, dibujandoRect.x2, dibujandoRect.y2, e.shiftKey);
        if (box.ancho_pct > 1 && box.alto_pct > 1) {
          const rc = { ...nuevoRectangulo(box.x_pct, box.y_pct, box.ancho_pct, box.alto_pct) };
          onRectangulosChange([...rectangulos, rc]);
          onSeleccion({ tipo: "rectangulo", id: rc.id });
        }
        setDibujandoRect(null);
      }
      if (dibujando) {
        let { x1, y1, x2, y2 } = {
          x1: dibujando.x1,
          y1: dibujando.y1,
          x2: dibujando.x2,
          y2: dibujando.y2,
        };
        if (e.shiftKey) {
          const snap = snapLineaRecta(x1, y1, x2, y2);
          x2 = snap.x2;
          y2 = snap.y2;
        }
        const dx = Math.abs(x2 - x1);
        const dy = Math.abs(y2 - y1);
        if (dx > 1 || dy > 1) {
          const ln: LineaPlantilla = {
            id: idPlantilla(),
            x1_pct: x1,
            y1_pct: y1,
            x2_pct: x2,
            y2_pct: y2,
            grosor: 1.2,
            color: "#000000",
          };
          onLineasChange([...lineas, ln]);
          onSeleccion({ tipo: "linea", id: ln.id });
        }
        setDibujando(null);
      }
      setArrastrando(null);
      setRedimensionando(null);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dibujando, dibujandoRect, arrastrando, redimensionando, campos, lineas, imagenes, rectangulos, onCamposChange, onLineasChange, onImagenesChange, onRectangulosChange, onSeleccion, pctDesdeEvento]);

  function iniciarRedimension(e: React.MouseEvent, payload: RedimensionPlantilla) {
    e.stopPropagation();
    e.preventDefault();
    onActivarSeleccion?.();
    setArrastrando(null);
    setRedimensionando(payload);
  }

  function onLienzoMouseDown(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest("[data-pl-elem]")) return;
    const p = pctDesdeEvento(e.clientX, e.clientY);
    if (herramienta === "rectangulo") {
      setDibujandoRect({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
      onSeleccion(null);
    } else if (herramienta === "linea") {
      setDibujando({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
      onSeleccion(null);
    } else if (herramienta === "texto") {
      const c = nuevoCampo();
      c.x_pct = p.x;
      c.y_pct = p.y;
      c.texto = "Texto";
      c.font_size = fontSize;
      onCamposChange([...campos, c]);
      onSeleccion({ tipo: "texto", id: c.id });
    } else {
      onSeleccion(null);
    }
  }

  const lineasRender = dibujando
    ? [...lineas, { id: "__tmp", x1_pct: dibujando.x1, y1_pct: dibujando.y1, x2_pct: dibujando.x2, y2_pct: dibujando.y2, grosor: 1.2, color: "#0c6069" }]
    : lineas;

  const rectsRender = dibujandoRect
    ? (() => {
        const box = rectNormalizado(
          dibujandoRect.x1, dibujandoRect.y1, dibujandoRect.x2, dibujandoRect.y2,
          dibujandoRect.proporcion ?? false,
        );
        return [...rectangulos, {
          id: "__tmp",
          ...box,
          relleno: true,
          color_relleno: "rgba(12,96,105,0.15)",
          color_trazo: "#0c6069",
          grosor_trazo: 1.2,
        } as RectanguloPlantilla];
      })()
    : rectangulos;

  return (
    <div
      ref={lienzoRef}
      tabIndex={0}
      className="relative mx-auto w-full max-w-3xl cursor-crosshair select-none overflow-hidden rounded-xl border-2 border-dashed border-border bg-white shadow-inner outline-none focus:ring-2 focus:ring-accent/40"
      style={{ aspectRatio: `${anchoMm} / ${altoMm}` }}
      onMouseDown={(e) => { lienzoRef.current?.focus(); onLienzoMouseDown(e); }}
      onKeyDown={(e) => {
        if (!esTeclaEliminarElemento(e) || !seleccion || !onSuprimirSeleccion) return;
        if (enCampoEditable(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        onSuprimirSeleccion();
      }}
    >
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        {rectsRender.map((rc) => (
          <rect
            key={rc.id}
            x={rc.x_pct}
            y={rc.y_pct}
            width={rc.ancho_pct}
            height={rc.alto_pct}
            fill={rc.relleno ? rc.color_relleno : "none"}
            stroke={rc.color_trazo}
            strokeWidth={rc.grosor_trazo * 0.35}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {lineasRender.map((ln) => (
          <line
            key={ln.id}
            x1={ln.x1_pct}
            y1={ln.y1_pct}
            x2={ln.x2_pct}
            y2={ln.y2_pct}
            stroke={ln.color}
            strokeWidth={ln.grosor * 0.35}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        {rectangulos.map((rc) => (
          <rect
            key={`hit-rc-${rc.id}`}
            x={rc.x_pct}
            y={rc.y_pct}
            width={rc.ancho_pct}
            height={rc.alto_pct}
            fill="transparent"
            stroke="transparent"
            strokeWidth={8}
            vectorEffect="non-scaling-stroke"
            className="cursor-move"
            style={{ pointerEvents: "all" }}
            onMouseDown={(e) => {
              e.stopPropagation();
              onActivarSeleccion?.();
              onSeleccion({ tipo: "rectangulo", id: rc.id });
              const p = pctDesdeEvento(e.clientX, e.clientY);
              setArrastrando({ tipo: "rectangulo", id: rc.id, ox: p.x - rc.x_pct, oy: p.y - rc.y_pct });
            }}
          />
        ))}
        {lineas.map((ln) => (
          <line
            key={`hit-${ln.id}`}
            x1={ln.x1_pct}
            y1={ln.y1_pct}
            x2={ln.x2_pct}
            y2={ln.y2_pct}
            stroke="transparent"
            strokeWidth={14}
            vectorEffect="non-scaling-stroke"
            className="cursor-move"
            style={{ pointerEvents: "stroke" }}
            onMouseDown={(e) => {
              e.stopPropagation();
              onActivarSeleccion?.();
              onSeleccion({ tipo: "linea", id: ln.id });
              const p = pctDesdeEvento(e.clientX, e.clientY);
              setArrastrando({
                tipo: "linea",
                id: ln.id,
                startX: p.x,
                startY: p.y,
                orig: { x1: ln.x1_pct, y1: ln.y1_pct, x2: ln.x2_pct, y2: ln.y2_pct },
              });
            }}
          />
        ))}
      </svg>
      {campos.map((c) => {
        const sel = seleccion?.tipo === "texto" && seleccion.id === c.id;
        const gTrazo = c.grosor_trazo ?? 0;
        const colorTrazo = c.color_trazo ?? "#000000";
        const anchoCaja = c.ancho_caja_pct ?? 42;
        const altoCaja = c.alto_caja_pct ?? 14;
        const variante = varianteMontserratCampo(c);
        const estiloTexto: CSSProperties = {
          fontFamily: '"Montserrat", sans-serif',
          fontSize: `${Math.max(8, c.font_size * 1.35)}px`,
          fontWeight: pesoMontserratVariante(variante),
          color: c.color,
          WebkitTextStroke: gTrazo > 0 ? `${Math.max(0.4, gTrazo * 0.45)}px ${colorTrazo}` : undefined,
          paintOrder: gTrazo > 0 ? "stroke fill" : undefined,
          textAlign: c.align,
          background: c.fondo_blanco ? "rgba(255,255,255,0.92)" : "transparent",
          whiteSpace: "pre-wrap",
          lineHeight: 1.2,
          wordBreak: "break-word",
        };
        const onMoverTexto = (e: React.MouseEvent) => {
          e.stopPropagation();
          onActivarSeleccion?.();
          onSeleccion({ tipo: "texto", id: c.id });
          const p = pctDesdeEvento(e.clientX, e.clientY);
          setArrastrando({ tipo: "texto", id: c.id, ox: p.x - c.x_pct, oy: p.y - c.y_pct });
        };
        const onRedimTexto = (e: React.MouseEvent, asa: AsaRedimensionId) =>
          iniciarRedimension(e, {
            tipo: "texto",
            id: c.id,
            asa,
            orig: { x: c.x_pct, y: c.y_pct, w: anchoCaja, h: altoCaja },
          });

        return (
          <div
            key={c.id}
            data-pl-elem
            className={`absolute ${sel ? "z-10" : ""}`}
            style={{
              left: `${c.x_pct}%`,
              top: `${c.y_pct}%`,
              width: `${anchoCaja}%`,
              height: `${altoCaja}%`,
            }}
            onClick={(e) => {
              e.stopPropagation();
              onActivarSeleccion?.();
              onSeleccion({ tipo: "texto", id: c.id });
            }}
          >
            {sel ? (
              <div className="relative h-full w-full">
                <textarea
                  ref={textoEditRef}
                  value={c.texto}
                  placeholder="Escribe aquí…"
                  lang="es"
                  spellCheck={c.ortografia !== false}
                  className="box-border h-full w-full resize-none overflow-auto bg-transparent px-1.5 py-1 outline-none"
                  style={estiloTexto}
                  onMouseDown={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    onCamposChange(campos.map((x) => (x.id === c.id ? { ...x, texto: e.target.value } : x)))
                  }
                />
                <MarcoRedimensionable
                  activo
                  onMover={onMoverTexto}
                  onRedimensionar={onRedimTexto}
                />
              </div>
            ) : (
              <div
                className="box-border h-full w-full cursor-pointer overflow-hidden px-1.5 py-1"
                style={estiloTexto}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onActivarSeleccion?.();
                  onSeleccion({ tipo: "texto", id: c.id });
                }}
              >
                {c.texto || c.etiqueta || "Texto"}
              </div>
            )}
          </div>
        );
      })}
      {imagenes.map((im) => {
        const sel = seleccion?.tipo === "imagen" && seleccion.id === im.id;
        const altoIm = im.alto_pct ?? im.ancho_pct * 0.75;
        return (
          <div
            key={im.id}
            data-pl-elem
            className={`absolute ${sel ? "z-10" : ""}`}
            style={{
              left: `${im.x_pct}%`,
              top: `${im.y_pct}%`,
              width: `${im.ancho_pct}%`,
              height: `${altoIm}%`,
            }}
            onClick={(e) => {
              e.stopPropagation();
              onActivarSeleccion?.();
              onSeleccion({ tipo: "imagen", id: im.id });
            }}
          >
            {sel ? (
              <div className="relative h-full w-full">
                <ImgRecursoPng
                  nombre={im.nombre}
                  thumbB64={recursosThumb[im.recurso_id]}
                  className="pointer-events-none h-full w-full object-contain"
                />
                <MarcoRedimensionable
                  activo
                  onMover={(e) => {
                    e.stopPropagation();
                    const p = pctDesdeEvento(e.clientX, e.clientY);
                    setArrastrando({ tipo: "imagen", id: im.id, ox: p.x - im.x_pct, oy: p.y - im.y_pct });
                  }}
                  onRedimensionar={(e, asa) =>
                    iniciarRedimension(e, {
                      tipo: "imagen",
                      id: im.id,
                      asa,
                      orig: { x: im.x_pct, y: im.y_pct, w: im.ancho_pct, h: altoIm },
                    })
                  }
                />
              </div>
            ) : (
              <ImgRecursoPng
                nombre={im.nombre}
                thumbB64={recursosThumb[im.recurso_id]}
                className="pointer-events-none h-full w-full object-contain"
              />
            )}
          </div>
        );
      })}
      {rectangulos.map((rc) => {
        const sel = seleccion?.tipo === "rectangulo" && seleccion.id === rc.id;
        if (!sel) return null;
        return (
          <div
            key={`handles-rc-${rc.id}`}
            className="absolute z-10"
            style={{
              left: `${rc.x_pct}%`,
              top: `${rc.y_pct}%`,
              width: `${rc.ancho_pct}%`,
              height: `${rc.alto_pct}%`,
            }}
          >
            <MarcoRedimensionable
              activo
              onMover={(e) => {
                e.stopPropagation();
                const p = pctDesdeEvento(e.clientX, e.clientY);
                setArrastrando({ tipo: "rectangulo", id: rc.id, ox: p.x - rc.x_pct, oy: p.y - rc.y_pct });
              }}
              onRedimensionar={(e, asa) =>
                iniciarRedimension(e, {
                  tipo: "rectangulo",
                  id: rc.id,
                  asa,
                  orig: { x: rc.x_pct, y: rc.y_pct, w: rc.ancho_pct, h: rc.alto_pct },
                })
              }
            />
          </div>
        );
      })}
      {lineas.map((ln) => {
        const sel = seleccion?.tipo === "linea" && seleccion.id === ln.id;
        if (!sel) return null;
        const punto = (label: "inicio" | "fin", x: number, y: number) => (
          <button
            key={`${ln.id}-${label}`}
            type="button"
            title={label === "inicio" ? "Extremo inicio" : "Extremo fin"}
            className="pointer-events-auto absolute z-20 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-accent bg-white shadow-sm hover:scale-110"
            style={{ left: `${x}%`, top: `${y}%` }}
            onMouseDown={(e) =>
              iniciarRedimension(e, {
                tipo: "linea",
                id: ln.id,
                punto: label,
                orig: { x1: ln.x1_pct, y1: ln.y1_pct, x2: ln.x2_pct, y2: ln.y2_pct },
              })
            }
          />
        );
        return (
          <div key={`${ln.id}-handles`} className="pointer-events-none absolute inset-0">
            {punto("inicio", ln.x1_pct, ln.y1_pct)}
            {punto("fin", ln.x2_pct, ln.y2_pct)}
          </div>
        );
      })}
    </div>
  );
}

interface TabPlantillasProps {
  onUsarEnImpresion: (p: PlantillaEtiqueta) => void;
}

function TabPlantillas({ onUsarEnImpresion }: TabPlantillasProps) {
  const qc = useQueryClient();
  const panelRef = useRef<HTMLDivElement>(null);
  const seleccionRef = useRef<SeleccionPlantilla>(null);
  const [actual, setActual] = useState<PlantillaEtiqueta>(() => plantillaVacia());
  const [herramienta, setHerramienta] = useState<HerramientaPlantilla>("seleccionar");
  const [seleccion, setSeleccion] = useState<SeleccionPlantilla>(null);
  const [fontSize, setFontSize] = useState(9);
  seleccionRef.current = seleccion;

  const { data: plantillasData, isLoading } = useQuery({
    queryKey: ["etiquetas-plantillas"],
    queryFn: () => api.get<{ plantillas: PlantillaEtiqueta[] }>("/api/etiquetas/plantillas"),
  });

  const { data: recursosData, isLoading: cargandoRecursos } = useQuery({
    queryKey: ["etiquetas-recursos-png"],
    queryFn: () => api.get<{ recursos: RecursoPng[]; carpeta?: string }>("/api/etiquetas/recursos-png"),
  });

  const guardarMut = useMutation({
    mutationFn: (p: PlantillaEtiqueta) =>
      api.post<{ ok: boolean; plantilla: PlantillaEtiqueta }>("/api/etiquetas/plantillas", p),
    onSuccess: (res) => {
      setActual(res.plantilla);
      qc.invalidateQueries({ queryKey: ["etiquetas-plantillas"] });
    },
  });

  const eliminarMut = useMutation({
    mutationFn: (id: string) => api.delete(`/api/etiquetas/plantillas/${id}`),
    onSuccess: () => {
      setActual(plantillaVacia());
      setSeleccion(null);
      qc.invalidateQueries({ queryKey: ["etiquetas-plantillas"] });
    },
  });

  const plantillas = plantillasData?.plantillas ?? [];
  const recursos = recursosData?.recursos ?? [];
  const recursosThumb = Object.fromEntries(recursos.map((r) => [r.id, r.thumb_b64]));
  const orientacion = orientacionPlantilla(actual);
  const [aw, ah] = dimensioensPlantillaMm(actual.tipo_etiqueta, orientacion);
  const campoSel = seleccion?.tipo === "texto"
    ? actual.campos_texto.find((c) => c.id === seleccion.id)
    : undefined;
  const lineaSel = seleccion?.tipo === "linea"
    ? actual.lineas.find((l) => l.id === seleccion.id)
    : undefined;
  const imagenSel = seleccion?.tipo === "imagen"
    ? (actual.imagenes ?? []).find((i) => i.id === seleccion.id)
    : undefined;
  const rectSel = seleccion?.tipo === "rectangulo"
    ? (actual.rectangulos ?? []).find((r) => r.id === seleccion.id)
    : undefined;

  function setCampos(campos: CampoTexto[]) {
    setActual((p) => ({ ...p, campos_texto: campos }));
  }
  function setLineas(lineas: LineaPlantilla[]) {
    setActual((p) => ({ ...p, lineas }));
  }
  function setImagenes(imagenes: ImagenPlantilla[]) {
    setActual((p) => ({ ...p, imagenes }));
  }
  function setRectangulos(rectangulos: RectanguloPlantilla[]) {
    setActual((p) => ({ ...p, rectangulos }));
  }
  function patchCampo(id: string, patch: Partial<CampoTexto>) {
    setCampos(actual.campos_texto.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }
  function eliminarSeleccionado() {
    const sel = seleccionRef.current;
    if (!sel) return;
    if (sel.tipo === "texto") {
      setActual((p) => ({ ...p, campos_texto: p.campos_texto.filter((c) => c.id !== sel.id) }));
    } else if (sel.tipo === "linea") {
      setActual((p) => ({ ...p, lineas: p.lineas.filter((l) => l.id !== sel.id) }));
    } else if (sel.tipo === "imagen") {
      setActual((p) => ({ ...p, imagenes: (p.imagenes ?? []).filter((i) => i.id !== sel.id) }));
    } else {
      setActual((p) => ({ ...p, rectangulos: (p.rectangulos ?? []).filter((r) => r.id !== sel.id) }));
    }
    setSeleccion(null);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!esTeclaEliminarElemento(e)) return;
      if (enCampoEditable(e.target)) return;
      const sel = seleccionRef.current;
      if (!sel) return;
      e.preventDefault();
      e.stopPropagation();
      eliminarSeleccionado();
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => {
    if (!seleccion || seleccion.tipo === "texto") return;
    panelRef.current?.focus({ preventScroll: true });
  }, [seleccion]);

  function agregarRecursoAlLienzo(recurso: RecursoPng) {
    const im = nuevaImagenPlantilla(recurso);
    setImagenes([...(actual.imagenes ?? []), im]);
    setSeleccion({ tipo: "imagen", id: im.id });
    setHerramienta("seleccionar");
  }

  function patchImagen(id: string, patch: Partial<ImagenPlantilla>) {
    setImagenes((actual.imagenes ?? []).map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  function cambiarOrientacionPlantilla(nueva: OrientacionPlantilla) {
    if (nueva === orientacion) return;
    const rotado = rotarPlantillaContenido(actual, nueva === "vertical" ? "cw" : "ccw");
    setActual((p) => ({
      ...p,
      orientacion: nueva,
      ...rotado,
    }));
    setSeleccion(null);
    setHerramienta("seleccionar");
  }

  const plantillaExiste = actual.id && plantillas.some((p) => p.id === actual.id);

  function guardarPlantillaActual() {
    const nombre = actual.nombre.trim() || "Plantilla sin nombre";
    guardarMut.mutate({ ...actual, nombre });
  }

  function guardarComoPlantillaNueva() {
    const ts = new Date().toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" });
    const base = actual.nombre.trim() && actual.nombre !== "Nueva plantilla"
      ? actual.nombre.trim()
      : "Plantilla";
    guardarMut.mutate({
      ...actual,
      id: idPlantilla(),
      nombre: `${base} (${ts})`,
    });
  }

  function elegirHerramienta(h: HerramientaPlantilla) {
    setHerramienta(h);
  }

  function patchLinea(id: string, patch: Partial<LineaPlantilla>) {
    setLineas(actual.lineas.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function patchRect(id: string, patch: Partial<RectanguloPlantilla>) {
    setRectangulos((actual.rectangulos ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface-panel shadow-paper-sm outline-none"
      onKeyDown={(e) => {
        if (!esTeclaEliminarElemento(e) || !seleccion) return;
        if (enCampoEditable(e.target)) return;
        e.preventDefault();
        eliminarSeleccionado();
      }}
    >
      <div className="border-b border-accent/30 bg-accent px-4 py-2 text-white">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="min-w-0">
            <p className="text-sm font-bold">Plantillas de etiqueta</p>
            <p className="text-[11px] opacity-75">Dibuja líneas y textos · se aplican sobre el PDF al imprimir</p>
          </div>
          <input
            type="text"
            value={actual.nombre}
            onChange={(e) => setActual((p) => ({ ...p, nombre: e.target.value }))}
            className="ml-auto min-w-[10rem] rounded border border-white/30 bg-white/10 px-2 py-1 text-xs text-white placeholder:text-white/50 focus:border-white focus:outline-none"
            placeholder="Nombre plantilla"
          />
          <select
            value={actual.tipo_etiqueta}
            onChange={(e) => setActual((p) => ({ ...p, tipo_etiqueta: e.target.value }))}
            className="rounded border border-white/30 bg-white/10 px-2 py-1 text-xs text-white focus:border-white focus:outline-none"
          >
            {ETIQUETAS_LISTA.map((e) => <option key={e} className="text-ink">{e}</option>)}
          </select>
        </div>
      </div>

      <PanelSuperiorRellenosTrazos
        campo={campoSel}
        linea={lineaSel}
        rect={rectSel}
        onPatchCampo={(patch) => campoSel && patchCampo(campoSel.id, patch)}
        onPatchLinea={(patch) => lineaSel && patchLinea(lineaSel.id, patch)}
        onPatchRect={(patch) => rectSel && patchRect(rectSel.id, patch)}
      />

      <PanelSuperiorEdicion
        campo={campoSel}
        onPatch={(patch) => campoSel && patchCampo(campoSel.id, patch)}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside
          className="flex w-[4.25rem] flex-shrink-0 flex-col overflow-y-auto border-r border-border bg-surface-panel py-1"
          title="Herramientas"
        >
          <BarraIconos>
            <BtnIconoToolbar
              activo={herramienta === "seleccionar"}
              onClick={() => elegirHerramienta("seleccionar")}
              icon="↖"
              title="Seleccionar (V)"
            />
            <BtnIconoToolbar
              activo={herramienta === "texto"}
              onClick={() => { elegirHerramienta("texto"); setSeleccion(null); }}
              icon={<span className="font-serif font-bold">T</span>}
              title="Texto"
            />
            <BtnIconoToolbar
              activo={herramienta === "linea"}
              onClick={() => { elegirHerramienta("linea"); setSeleccion(null); }}
              icon="／"
              title="Línea libre (Shift = H/V)"
            />
            <BtnIconoToolbar
              activo={herramienta === "rectangulo"}
              onClick={() => { setHerramienta("rectangulo"); setSeleccion(null); }}
              icon="▭"
              title="Rectángulo — Shift = cuadrado"
            />
          </BarraIconos>

          <SeparadorToolbar />

          <BarraIconos>
            <BtnIconoToolbar
              onClick={() => { setActual(plantillaVacia()); setSeleccion(null); }}
              icon="📄"
              title="Nueva plantilla"
            />
            <BtnIconoToolbar
              activo={orientacion === "horizontal"}
              onClick={() => cambiarOrientacionPlantilla("horizontal")}
              icon="▬"
              title="Lienzo horizontal"
            />
            <BtnIconoToolbar
              activo={orientacion === "vertical"}
              onClick={() => cambiarOrientacionPlantilla("vertical")}
              icon="▮"
              title="Lienzo vertical"
            />
          </BarraIconos>

          <SeparadorToolbar />

          <BarraIconos>
            <BtnIconoToolbar
              disabled={guardarMut.isPending}
              onClick={guardarPlantillaActual}
              icon={guardarMut.isPending ? "…" : "💾"}
              title={plantillaExiste ? "Actualizar plantilla" : "Guardar plantilla"}
            />
            <BtnIconoToolbar
              disabled={guardarMut.isPending}
              onClick={guardarComoPlantillaNueva}
              icon="⧉"
              title="Guardar como nueva"
            />
            {seleccion ? (
              <BtnIconoToolbar
                onClick={eliminarSeleccionado}
                icon="🗑"
                title="Eliminar selección (Suprimir)"
                danger
              />
            ) : (
              <span aria-hidden className="aspect-square w-full" />
            )}
          </BarraIconos>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col items-center gap-3 overflow-y-auto p-4">
          <p className="text-center text-[11px] text-muted">
            {herramienta === "linea" && "Línea libre · Shift = recta H/V"}
            {herramienta === "texto" && "Clic = nuevo texto · arrastra cualquier elemento para moverlo"}
            {herramienta === "rectangulo" && "Arrastra ▭ rectángulo · Shift = cuadrado"}
            {herramienta === "seleccionar" && "Selecciona · esquinas redimensionan · ⠿ mueve · Suprimir elimina"}
            {" · "}{orientacion === "vertical" ? "▮ Vertical" : "▬ Horizontal"} · {aw}×{ah} mm
          </p>
          <EditorPlantillaCanvas
            anchoMm={aw}
            altoMm={ah}
            campos={actual.campos_texto}
            lineas={actual.lineas}
            imagenes={actual.imagenes ?? []}
            rectangulos={actual.rectangulos ?? []}
            recursosThumb={recursosThumb}
            herramienta={herramienta}
            seleccion={seleccion}
            fontSize={fontSize}
            onSeleccion={setSeleccion}
            onActivarSeleccion={() => setHerramienta("seleccionar")}
            onCamposChange={setCampos}
            onLineasChange={setLineas}
            onImagenesChange={setImagenes}
            onRectangulosChange={setRectangulos}
            onSuprimirSeleccion={eliminarSeleccionado}
          />
          {imagenSel && (
            <div className="w-full max-w-md rounded-lg border border-border bg-surface-panel p-3 text-xs">
              <p className="text-muted">Imagen: {imagenSel.nombre}</p>
              <label className="mt-2 flex items-center gap-2">
                <span className="text-muted">Ancho</span>
                <input
                  type="range"
                  min={5}
                  max={90}
                  value={imagenSel.ancho_pct}
                  onChange={(e) => patchImagen(imagenSel.id, { ancho_pct: Number(e.target.value) })}
                  className="flex-1 accent-accent"
                />
                <span>{imagenSel.ancho_pct}%</span>
              </label>
            </div>
          )}
          <div className="flex flex-wrap justify-center gap-2">
            {(actual.rectangulos ?? []).map((rc) => (
              <button
                key={rc.id}
                type="button"
                onClick={() => setSeleccion({ tipo: "rectangulo", id: rc.id })}
                className={`rounded border px-2 py-0.5 text-[10px] ${
                  seleccion?.id === rc.id ? "border-accent bg-accent/10" : "border-border"
                }`}
              >
                ▭ Rect
              </button>
            ))}
            {(actual.imagenes ?? []).map((im) => (
              <button
                key={im.id}
                type="button"
                onClick={() => setSeleccion({ tipo: "imagen", id: im.id })}
                className={`rounded border px-2 py-0.5 text-[10px] ${
                  seleccion?.id === im.id ? "border-accent bg-accent/10" : "border-border"
                }`}
              >
                🖼 {im.nombre}
              </button>
            ))}
            {actual.lineas.map((ln) => (
              <button
                key={ln.id}
                type="button"
                onClick={() => setSeleccion({ tipo: "linea", id: ln.id })}
                className={`rounded border px-2 py-0.5 text-[10px] ${
                  seleccion?.id === ln.id ? "border-accent bg-accent/10" : "border-border"
                }`}
              >
                Línea
              </button>
            ))}
          </div>
        </div>

        <aside className="flex w-52 flex-shrink-0 flex-col gap-4 overflow-y-auto border-l border-border bg-surface-panel p-3">
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-muted">Guardadas</p>
            <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-surface">
              {isLoading && <p className="p-3 text-xs text-muted">Cargando…</p>}
              {!isLoading && plantillas.length === 0 && (
                <p className="p-3 text-xs text-muted">Sin plantillas guardadas</p>
              )}
              {plantillas.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setActual({
                      ...plantillaVacia(),
                      ...p,
                      imagenes: p.imagenes ?? [],
                      rectangulos: p.rectangulos ?? [],
                    });
                    setSeleccion(null);
                  }}
                  className={`block w-full border-b border-border/50 px-3 py-2 text-left text-xs last:border-0 ${
                    actual.id === p.id ? "bg-accent/10 font-semibold text-accent" : "text-ink hover:bg-surface-hover"
                  }`}
                >
                  {p.nombre}
                  <span className="block text-[10px] font-normal text-muted">{p.tipo_etiqueta}</span>
                </button>
              ))}
            </div>
            {actual.id && plantillas.some((p) => p.id === actual.id) && (
              <button
                type="button"
                onClick={() => eliminarMut.mutate(actual.id)}
                className="mt-2 text-[11px] text-muted hover:text-danger"
              >
                Eliminar plantilla
              </button>
            )}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-1">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Biblioteca PNG</p>
              <BotonSubirPngRecurso compact label="+" onSubido={agregarRecursoAlLienzo} />
            </div>
            <p className="mb-2 text-[10px] text-muted">Clic para colocar en la etiqueta.</p>
            <div className="grid grid-cols-3 gap-1.5 overflow-y-auto rounded-lg border border-border bg-surface p-2">
              {cargandoRecursos && <p className="col-span-3 p-2 text-xs text-muted">Cargando…</p>}
              {!cargandoRecursos && recursos.length === 0 && (
                <div className="col-span-3 flex flex-col items-center gap-2 py-4">
                  <p className="text-[10px] text-muted">Sin PNG</p>
                  <BotonSubirPngRecurso label="Subir PNG" onSubido={agregarRecursoAlLienzo} />
                </div>
              )}
              {recursos.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  title={r.nombre}
                  onClick={() => agregarRecursoAlLienzo(r)}
                  className="aspect-square overflow-hidden rounded border border-border bg-white hover:border-accent hover:ring-1 hover:ring-accent"
                >
                  {r.thumb_b64 ? (
                    <img
                      src={`data:image/png;base64,${r.thumb_b64}`}
                      alt={r.nombre}
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <span className="flex h-full items-center justify-center text-[9px] text-muted">PNG</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>

      <div className="flex flex-shrink-0 justify-center border-t border-border bg-surface-panel px-4 py-4">
        <button
          type="button"
          onClick={() => onUsarEnImpresion(actual)}
          className="w-full max-w-md rounded-xl border-2 border-accent bg-accent py-3 text-center text-base font-bold text-white hover:bg-accent/90"
        >
          Usar plantilla en Impresión
        </button>
      </div>
    </div>
  );
}

// ── Tab: Imprimir ─────────────────────────────────────────────────────────────

type PrecargarImpresion = Partial<DatosEtiqueta>;

interface TabImprimirProps {
  precargar?: PrecargarImpresion | null;
  onPrecargarConsumido: () => void;
}

function TabImprimir({ precargar, onPrecargarConsumido }: TabImprimirProps) {
  const qc = useQueryClient();
  const [producto, setProducto] = useState(ETIQUETAS_LISTA[0]);
  const [forma, setForma] = useState(FORMAS[0].value);
  const [calidad, setCalidad] = useState("Normal");
  const [rotacion, setRotacion] = useState("0");
  const [cantidad, setCantidad] = useState(1);
  const [offsetV, setOffsetV] = useState(0.0);
  const [offsetH, setOffsetH] = useState(0.0);
  const [pdfSeleccionado, setPdfSeleccionado] = useState<{ nombre: string; ruta_completa: string } | null>(null);
  const [busquedaRapida, setBusquedaRapida] = useState("");
  const [mostrarNavegador, setMostrarNavegador] = useState(false);
  const [lote, setLote] = useState(LOTE_PREFIJO);
  const [vencimiento, setVencimiento] = useState(EXP_PREFIJO);
  const [lotePos, setLotePos] = useState("bottom-left");
  const [loteFont, setLoteFont] = useState(7);
  const [loteXPct, setLoteXPct] = useState(LOTE_POS_PCT["bottom-left"].x);
  const [loteYPct, setLoteYPct] = useState(LOTE_POS_PCT["bottom-left"].y);
  const [camposTexto, setCamposTexto] = useState<CampoTexto[]>([]);
  const [lineasPlantilla, setLineasPlantilla] = useState<LineaPlantilla[]>([]);
  const [imagenesPlantilla, setImagenesPlantilla] = useState<ImagenPlantilla[]>([]);
  const [rectangulosPlantilla, setRectangulosPlantilla] = useState<RectanguloPlantilla[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [mostrarInstalador, setMostrarInstalador] = useState(false);
  const [tabRibbon, setTabRibbon] = useState<ImprimirRibbonTab>("inicio");
  const [errorImpresion, setErrorImpresion] = useState<ErrorImpresora | null>(null);

  const camposDebounced = useDebounce(camposTexto, 700);
  const lineasDebounced = useDebounce(lineasPlantilla, 700);
  const imagenesDebounced = useDebounce(imagenesPlantilla, 700);
  const rectangulosDebounced = useDebounce(rectangulosPlantilla, 700);
  const ribbonTabsImprimir: { id: ImprimirRibbonTab; label: string }[] = [
    { id: "inicio", label: "Inicio" },
    { id: "lote", label: "Lote" },
    { id: "archivo", label: "Archivo" },
  ];

  // Precargar desde configuración de producto
  useEffect(() => {
    if (!precargar) return;
    if (precargar.tipo_etiqueta) setProducto(precargar.tipo_etiqueta);
    if (precargar.forma) setForma(precargar.forma);
    if (precargar.calidad) setCalidad(precargar.calidad);
    if (precargar.rotacion) setRotacion(rotacionValida(precargar.rotacion));
    if (precargar.lote_pos) setLotePos(precargar.lote_pos);
    if (precargar.lote_font) setLoteFont(precargar.lote_font);
    const pct = lotePctInicial(precargar.lote_pos, precargar.lote_x_pct, precargar.lote_y_pct);
    setLoteXPct(pct.x);
    setLoteYPct(pct.y);
    setLote(conPrefijoLote(precargar.lote_defecto));
    setVencimiento(conPrefijoExp(precargar.vencimiento_defecto));
    if (precargar.pdf_ruta && precargar.pdf_nombre) {
      setPdfSeleccionado({ nombre: precargar.pdf_nombre, ruta_completa: precargar.pdf_ruta });
    }
    if (precargar.campos_texto) setCamposTexto(precargar.campos_texto);
    if (precargar.lineas) setLineasPlantilla(precargar.lineas);
    if (precargar.imagenes) setImagenesPlantilla(precargar.imagenes);
    if (precargar.rectangulos) setRectangulosPlantilla(precargar.rectangulos);
    onPrecargarConsumido();
  }, [precargar]);

  const { data: estadoData, refetch: refetchImpresora } = useQuery({
    queryKey: ["etiquetas-impresora"],
    queryFn: () => api.get<ImpResp>("/api/etiquetas/impresora"),
    refetchInterval: 30000,
  });

  const { data: pdfsData, isLoading: cargandoPdfs } = useQuery({
    queryKey: ["etiquetas-pdfs"],
    queryFn: () => api.get<PdfsResp>("/api/etiquetas/pdfs"),
  });
  const [arrastrandoPdf, setArrastrandoPdf] = useState(false);

  const { data: previewData, isFetching: previewLoading } = useQuery({
    queryKey: ["etiquetas-preview", pdfSeleccionado?.ruta_completa, camposDebounced, lineasDebounced, imagenesDebounced, rectangulosDebounced],
    queryFn: () =>
      api.post<PreviewResp>("/api/etiquetas/preview", {
        ruta_pdf: pdfSeleccionado!.ruta_completa,
        campos_texto: camposDebounced.length ? camposDebounced : undefined,
        lineas: lineasDebounced.length ? lineasDebounced : undefined,
        imagenes: imagenesDebounced.length ? imagenesDebounced : undefined,
        rectangulos: rectangulosDebounced.length ? rectangulosDebounced : undefined,
      }),
    enabled: !!pdfSeleccionado,
    staleTime: 0,
  });

  const imprimirMut = useMutation({
    mutationFn: (payload: ImpresionEtiquetaPayload) =>
      api.post<PrintResult>("/api/etiquetas/imprimir", payload),
    onSuccess: (data) => {
      const ts = new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const err = errorDesdePrintResult(data);
      setErrorImpresion(err);
      setLog((prev) => [
        ...prev,
        ...(data.log ?? []).map((l) => `[${ts}] ${l}`),
        err
          ? `[${ts}] ❌ ${err.error}`
          : `[${ts}] ✅ Impresión enviada`,
      ]);
      refetchImpresora();
    },
    onError: (err) => {
      const ts = new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const det = errorDesdeExcepcion(err.message);
      setErrorImpresion(det);
      setLog((prev) => [...prev, `[${ts}] ❌ ${det.error}`]);
    },
  });

  const filtroPdf = (p: PdfItem) =>
    !busquedaRapida.trim() || p.nombre.toLowerCase().includes(busquedaRapida.toLowerCase());

  const pdfsGuardados = (pdfsData?.guardados ?? []).filter(filtroPdf);
  const rutasGuardadas = new Set(pdfsGuardados.map((p) => p.ruta_completa));
  const pdfsOtros = (pdfsData?.pdfs ?? []).filter(
    (p) => filtroPdf(p) && !rutasGuardadas.has(p.ruta_completa),
  );

  function seleccionarPdfSubido(item: PdfItem) {
    setPdfSeleccionado({ nombre: item.nombre, ruta_completa: item.ruta_completa });
    setTabRibbon("inicio");
  }

  const estadoTxt = estadoData?.estado ?? "";
  const impConectada = estadoTxt.length > 0 && !estadoTxt.toLowerCase().includes("error") && !estadoTxt.toLowerCase().includes("no encontrad");
  const impDeshabilitada = estadoTxt.toLowerCase().includes("deshabilitad") || estadoTxt.toLowerCase().includes("disabled");

  function handleImprimir() {
    if (!pdfSeleccionado) {
      const ts = new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      setLog((prev) => [...prev, `[${ts}] ⚠️  Selecciona un PDF primero`]);
      return;
    }
    const ts = new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const loteVal = loteParaEtiqueta(lote);
    const expVal = expParaEtiqueta(vencimiento);
    const loteInfo = (loteVal || expVal) ? ` · ${loteVal || "–"} / ${expVal || "–"}` : "";
    setLog((prev) => [...prev, `[${ts}] ${cantidad} cop. · ${producto} · ${calidad}${loteInfo} · pos ${loteXPct.toFixed(1)}%,${loteYPct.toFixed(1)}%...`]);
    setErrorImpresion(null);
    imprimirMut.mutate({
      producto,
      forma,
      calidad,
      rotacion,
      cantidad,
      offset_v: offsetV,
      offset_h: offsetH,
      ruta_pdf: pdfSeleccionado.ruta_completa,
      campos_texto: camposTexto.length ? camposTexto : undefined,
      lineas: lineasPlantilla.length ? lineasPlantilla : undefined,
      imagenes: imagenesPlantilla.length ? imagenesPlantilla : undefined,
      rectangulos: rectangulosPlantilla.length ? rectangulosPlantilla : undefined,
      lote: loteParaEtiqueta(lote),
      vencimiento: expParaEtiqueta(vencimiento),
      lote_font: loteFont,
      lote_x_pct: loteXPct,
      lote_y_pct: loteYPct,
    });
  }

  return (
    <>
      {mostrarNavegador && (
        <NavegadorArchivos
          onSeleccionar={(item) => { setPdfSeleccionado(item); setMostrarNavegador(false); setTabRibbon("inicio"); }}
          onCerrar={() => setMostrarNavegador(false)}
        />
      )}
      {mostrarInstalador && (
        <InstaladorWizard onCerrar={() => { setMostrarInstalador(false); refetchImpresora(); }} />
      )}

      <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface-panel shadow-paper-sm">
        {/* Barra de título — estilo Word */}
        <div className="flex flex-shrink-0 flex-wrap items-center gap-3 border-b border-accent/30 bg-accent px-4 py-2 text-white">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">Impresión de etiquetas</p>
            <p className="text-[10px] opacity-75">Epson ColorWorks CW-C4000u · MCKG Suite</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-[10px] font-semibold ${
            impDeshabilitada ? "bg-orange-200 text-orange-800"
            : impConectada ? "bg-green-200 text-green-800"
            : "bg-red-200 text-red-800"
          }`}>
            {impDeshabilitada ? "Desconectada" : impConectada ? "Impresora lista" : "Sin impresora"}
          </span>
          <button
            type="button"
            onClick={() => setMostrarInstalador(true)}
            className="rounded border border-white/30 px-2.5 py-1 text-[10px] font-semibold hover:bg-white/15"
          >
            🖨 Instalar
          </button>
        </div>

        {errorImpresion && (
          <BannerErrorImpresora
            error={errorImpresion}
            onCerrar={() => setErrorImpresion(null)}
            onInstalar={() => setMostrarInstalador(true)}
          />
        )}

        {!impConectada && estadoTxt && !errorImpresion && (
          <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-orange-200 bg-orange-50 px-4 py-2">
            <p className="text-xs text-orange-700">
              {impDeshabilitada ? "Conecta el cable USB e instala la impresora." : "Impresora no configurada."}
            </p>
            <button type="button" onClick={() => setMostrarInstalador(true)} className="rounded bg-orange-500 px-3 py-1 text-[10px] font-bold text-white hover:bg-orange-600">
              Configurar
            </button>
          </div>
        )}

        {/* Cinta — pestañas */}
        <RibbonTabs tabs={ribbonTabsImprimir} active={tabRibbon} onChange={setTabRibbon} />

        {/* Cinta — herramientas */}
        {tabRibbon !== "archivo" && (
          <div className="flex flex-shrink-0 overflow-x-auto border-b border-border bg-surface">
            {tabRibbon === "inicio" && (
              <>
                <RibbonGroup label="Formato">
                  <div>
                    <label className={RIB_LBL}>Producto</label>
                    <select
                      value={producto}
                      onChange={(e) => {
                        const tipo = e.target.value;
                        setProducto(tipo);
                        setRotacion(rotacionDefaultEtiqueta(tipo));
                      }}
                      className={RIB_SEL}
                    >
                      {ETIQUETAS_LISTA.map((e) => <option key={e}>{e}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={RIB_LBL}>Sensor</label>
                    <select value={forma} onChange={(e) => setForma(e.target.value)} className={RIB_SEL}>
                      {FORMAS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                  </div>
                </RibbonGroup>
                <RibbonGroup label="Calidad">
                  <div>
                    <label className={RIB_LBL}>Impresión</label>
                    <select value={calidad} onChange={(e) => setCalidad(e.target.value)} className={RIB_SEL}>
                      {CALIDADES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={RIB_LBL}>Rotación</label>
                    <div className="flex gap-1">
                      {ROTACIONES.map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setRotacion(r)}
                          className={`h-9 min-w-[2.25rem] rounded border-2 ${RIB_FONT_BTN} font-bold ${rotacion === r ? "border-accent bg-accent text-white" : "border-border text-ink-secondary"}`}
                        >
                          {r}°
                        </button>
                      ))}
                    </div>
                  </div>
                </RibbonGroup>
                <RibbonGroup label="Ajuste">
                  <div>
                    <label className={RIB_LBL}>Offset V</label>
                    <input type="number" step="0.1" value={offsetV} onChange={(e) => setOffsetV(parseFloat(e.target.value) || 0)} className={`${RIB_INP} w-14 text-center`} />
                  </div>
                  <div>
                    <label className={RIB_LBL}>Offset H</label>
                    <input type="number" step="0.1" value={offsetH} onChange={(e) => setOffsetH(parseFloat(e.target.value) || 0)} className={`${RIB_INP} w-14 text-center`} />
                  </div>
                </RibbonGroup>
                <RibbonGroup label="Cantidad">
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => setCantidad((c) => Math.max(1, c - 1))} className="h-7 w-7 rounded border border-border text-sm font-bold hover:bg-surface-hover">−</button>
                    <input
                      type="number"
                      min={1}
                      max={999}
                      value={cantidad}
                      onChange={(e) => setCantidad(Math.max(1, parseInt(e.target.value) || 1))}
                      className={`${RIB_INP} w-12 text-center font-bold`}
                    />
                    <button type="button" onClick={() => setCantidad((c) => Math.min(999, c + 1))} className="h-7 w-7 rounded border border-border text-sm font-bold hover:bg-surface-hover">+</button>
                  </div>
                </RibbonGroup>
                <RibbonGroup label="Archivo">
                  <BotonSubirPdfEtiqueta
                    compact
                    label="📤 Subir"
                    onSubido={seleccionarPdfSubido}
                  />
                  <button
                    type="button"
                    onClick={() => setTabRibbon("archivo")}
                    className={`inline-flex h-8 max-w-[180px] items-center gap-1 truncate rounded border border-border bg-surface px-2.5 ${RIB_FONT_BTN} font-semibold text-ink hover:border-accent`}
                  >
                    📄 {pdfSeleccionado?.nombre ?? "Elegir PDF…"}
                  </button>
                </RibbonGroup>
              </>
            )}
            {tabRibbon === "lote" && (
              <>
                <RibbonGroup label="Texto">
                  <div>
                    <label className={RIB_LBL}>Lote</label>
                    <input
                      type="text"
                      value={lote}
                      onChange={(e) => setLote(editarConPrefijo(e.target.value, LOTE_PREFIJO))}
                      placeholder="LOT.MCK-2026-001"
                      className={`${RIB_INP} min-w-[9rem]`}
                    />
                  </div>
                  <div>
                    <label className={RIB_LBL}>Vencimiento</label>
                    <input
                      type="text"
                      value={vencimiento}
                      onChange={(e) => setVencimiento(editarConPrefijo(e.target.value, EXP_PREFIJO))}
                      placeholder="EXP.12/2028"
                      className={`${RIB_INP} min-w-[9rem]`}
                    />
                  </div>
                </RibbonGroup>
                <RibbonGroup label="Posición">
                  <div>
                    <label className={RIB_LBL}>X %</label>
                    <input type="number" min={0} max={98} step={0.5} value={loteXPct} onChange={(e) => setLoteXPct(Number(e.target.value))} className={`${RIB_INP} w-16`} />
                  </div>
                  <div>
                    <label className={RIB_LBL}>Y %</label>
                    <input type="number" min={0} max={98} step={0.5} value={loteYPct} onChange={(e) => setLoteYPct(Number(e.target.value))} className={`${RIB_INP} w-16`} />
                  </div>
                  <p className={`max-w-[110px] self-center ${RIB_FONT_HINT} leading-tight text-muted`}>Arrastra en la vista previa</p>
                </RibbonGroup>
                <RibbonGroup label="Tipografía">
                  <div className="flex min-w-[150px] flex-col gap-0.5">
                    <label className={RIB_LBL}>Montserrat Light</label>
                    <div className="flex items-center gap-2">
                      <input type="range" min={5} max={14} step={1} value={loteFont} onChange={(e) => setLoteFont(Number(e.target.value))} className="w-24 accent-accent" />
                      <span className={`${RIB_FONT_BTN} font-bold text-ink`}>{loteFont}pt</span>
                    </div>
                  </div>
                </RibbonGroup>
              </>
            )}
          </div>
        )}

        {/* Panel Archivo — lista PDF bajo la cinta */}
        {tabRibbon === "archivo" && (
          <div
            className={`flex-shrink-0 border-b px-4 py-3 transition-colors ${
              arrastrandoPdf ? "border-accent bg-accent/5" : "border-border bg-surface"
            }`}
            onDragOver={(e) => { e.preventDefault(); setArrastrandoPdf(true); }}
            onDragLeave={() => setArrastrandoPdf(false)}
            onDrop={(e) => {
              e.preventDefault();
              setArrastrandoPdf(false);
              const f = e.dataTransfer.files?.[0];
              if (!f) return;
              const fd = new FormData();
              fd.append("archivo", f);
              void api.upload<{ nombre: string; ruta: string; ruta_completa: string }>(
                "/api/etiquetas/subir-pdf",
                fd,
              ).then((data) => {
                void qc.invalidateQueries({ queryKey: ["etiquetas-pdfs"] });
                seleccionarPdfSubido({
                  nombre: data.nombre,
                  ruta: data.ruta,
                  ruta_completa: data.ruta_completa,
                  guardado: true,
                });
              }).catch(() => {});
            }}
          >
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <BotonSubirPdfEtiqueta compact onSubido={seleccionarPdfSubido} />
              <button
                type="button"
                onClick={() => setMostrarNavegador(true)}
                className={`inline-flex h-8 items-center gap-1 rounded border border-border bg-surface-panel px-3 ${RIB_FONT_BTN} font-semibold hover:border-accent`}
              >
                📂 Explorar
              </button>
              <input
                type="text"
                placeholder="Buscar PDF…"
                value={busquedaRapida}
                onChange={(e) => setBusquedaRapida(e.target.value)}
                className={`${RIB_INP} min-w-[12rem] flex-1`}
              />
              {pdfSeleccionado && (
                <button type="button" onClick={() => setPdfSeleccionado(null)} className={`${RIB_FONT_BTN} text-muted hover:text-danger`}>
                  Quitar PDF
                </button>
              )}
            </div>
            <p className="mb-2 text-[11px] text-muted">
              Los PDF subidos se guardan en <strong>Documentos/Etiquetas McKenna</strong> y quedan disponibles siempre.
              {arrastrandoPdf && " · Suelta el archivo aquí"}
            </p>
            <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-surface-panel">
              {cargandoPdfs ? (
                <p className="p-3 text-xs text-muted">Cargando…</p>
              ) : pdfsGuardados.length === 0 && pdfsOtros.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-6">
                  <p className="text-xs text-muted">Sin PDF guardados</p>
                  <BotonSubirPdfEtiqueta label="📤 Subir primer PDF" onSubido={seleccionarPdfSubido} />
                </div>
              ) : (
                <>
                  {pdfsGuardados.length > 0 && (
                    <>
                      <p className="sticky top-0 border-b border-border bg-surface-panel px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-muted">
                        Guardados ({pdfsGuardados.length})
                      </p>
                      {pdfsGuardados.map((p) => (
                        <button
                          key={`g-${p.ruta_completa}`}
                          type="button"
                          onClick={() => seleccionarPdfSubido(p)}
                          className={`block w-full px-3 py-2 text-left text-xs transition ${
                            pdfSeleccionado?.ruta_completa === p.ruta_completa
                              ? "bg-accent text-white"
                              : "text-ink hover:bg-surface-hover"
                          }`}
                        >
                          📌 {p.nombre}
                        </button>
                      ))}
                    </>
                  )}
                  {pdfsOtros.length > 0 && (
                    <>
                      {pdfsGuardados.length > 0 && (
                        <p className="sticky top-0 border-b border-border bg-surface-panel px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-muted">
                          Otros en Documentos
                        </p>
                      )}
                      {pdfsOtros.map((p) => (
                        <button
                          key={p.ruta}
                          type="button"
                          onClick={() => seleccionarPdfSubido(p)}
                          className={`block w-full px-3 py-2 text-left text-xs transition ${
                            pdfSeleccionado?.ruta_completa === p.ruta_completa
                              ? "bg-accent text-white"
                              : "text-ink hover:bg-surface-hover"
                          }`}
                        >
                          {p.nombre}
                        </button>
                      ))}
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* Lienzo — vista previa */}
        <div className="flex min-h-[min(55vh,520px)] flex-col bg-surface-hover/20">
          <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-surface-panel/80 px-4 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Documento</span>
            <div className="flex items-center gap-2">
              {pdfSeleccionado && (
                <span className="font-mono text-[10px] text-muted">
                  X {loteXPct.toFixed(1)}% · Y {loteYPct.toFixed(1)}%
                </span>
              )}
              {previewLoading && (
                <span className="flex items-center gap-1 text-[10px] text-muted">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                  actualizando…
                </span>
              )}
            </div>
          </div>
          <div className="relative flex flex-1 items-center justify-center overflow-auto p-3">
            {pdfSeleccionado ? (
              <>
                <VistaPreviaConLote
                  imagen={previewData?.imagen}
                  mime={previewData?.mime}
                  loading={previewLoading}
                  emptyText="Generando vista previa..."
                  loteText={loteParaEtiqueta(lote)}
                  vencText={expParaEtiqueta(vencimiento)}
                  loteFont={loteFont}
                  xPct={loteXPct}
                  yPct={loteYPct}
                  imgClassName={PREVIEW_IMG_LARGE}
                  containerClassName={PREVIEW_CONTAINER_LARGE}
                  onPositionChange={(x, y) => {
                    setLoteXPct(x);
                    setLoteYPct(y);
                    setLotePos("custom");
                  }}
                />
                {previewLoading && previewData?.imagen && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-surface/40">
                    <span className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center gap-3 px-6 text-center">
                <span className="text-4xl opacity-40">🏷️</span>
                <p className="text-sm font-medium text-muted">Sin PDF seleccionado</p>
                <button type="button" onClick={() => setTabRibbon("archivo")} className="rounded-lg border-2 border-accent px-4 py-2 text-xs font-bold text-accent hover:bg-accent hover:text-white">
                  📂 Elegir PDF
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Barra inferior — imprimir */}
        <div className="flex flex-shrink-0 flex-col items-center gap-2 border-t border-border bg-surface-panel px-4 py-4">
          <p className="max-w-lg truncate text-center text-[11px] text-muted">
            {pdfSeleccionado ? `📄 ${pdfSeleccionado.nombre}` : "Selecciona un PDF en la pestaña Archivo"}
            {estadoData?.estado && ` · ${estadoData.estado.split("\n")[0]}`}
          </p>
          <button
            type="button"
            onClick={handleImprimir}
            disabled={imprimirMut.isPending || !pdfSeleccionado}
            className="w-full max-w-md rounded-xl border-2 border-green-600 bg-green-600 py-4 text-center text-lg font-extrabold tracking-wide text-white shadow-[0_4px_0_#15803d] transition hover:bg-green-700 active:translate-y-0.5 active:shadow-none disabled:opacity-40 disabled:shadow-none"
          >
            {imprimirMut.isPending ? "Imprimiendo…" : "🖨 IMPRIMIR"}
          </button>
        </div>

        {log.length > 0 && (
          <div className="flex-shrink-0 border-t border-border bg-surface px-4 py-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Log</span>
              <button type="button" onClick={() => setLog([])} className="text-[10px] text-muted hover:text-danger">Limpiar</button>
            </div>
            <div className="max-h-28 overflow-y-auto rounded bg-surface-panel p-2 font-mono text-[10px] text-ink space-y-0.5">
              {log.map((l, i) => (
                <div key={i} className={l.includes("❌") || l.includes("✗") ? "text-red-600" : l.includes("✅") ? "text-green-600" : l.includes("⚠") ? "text-orange-500" : ""}>
                  {l}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ── Panel principal ───────────────────────────────────────────────────────────

export default function EtiquetasPanel() {
  const [tab, setTab] = useState<"imprimir" | "configurar" | "plantillas">("imprimir");
  const [precargarImpresion, setPrecargarImpresion] = useState<PrecargarImpresion | null>(null);

  function irAImprimir(datos: DatosEtiqueta) {
    setPrecargarImpresion({
      tipo_etiqueta: datos.tipo_etiqueta,
      campos_texto: datos.campos_texto,
      lineas: datos.lineas,
      imagenes: datos.imagenes,
    });
    setTab("imprimir");
  }

  function irAImprimirPlantilla(p: PlantillaEtiqueta) {
    setPrecargarImpresion({
      tipo_etiqueta: p.tipo_etiqueta,
      rotacion: rotacionDesdePlantilla(p),
      campos_texto: p.campos_texto,
      lineas: p.lineas,
      imagenes: p.imagenes,
      rectangulos: p.rectangulos,
    });
    setTab("imprimir");
  }

  const tabCls = (t: typeof tab) =>
    `flex-1 rounded-lg py-2 text-sm font-semibold transition ${tab === t ? "bg-accent text-white shadow" : "text-ink-secondary hover:bg-surface-hover"}`;

  return (
    <div className={`space-y-4 px-1 sm:px-0 ${tab === "imprimir" || tab === "plantillas" ? "mx-auto max-w-[min(100%,1440px)]" : "mx-auto max-w-6xl space-y-5"}`}>
      {/* Tabs principales */}
      <div className="flex gap-2 rounded-xl border border-border bg-surface-panel p-1">
        <button onClick={() => setTab("imprimir")} className={tabCls("imprimir")}>
          🖨 Imprimir
        </button>
        <button onClick={() => setTab("plantillas")} className={tabCls("plantillas")}>
          📐 Plantillas
        </button>
        <button onClick={() => setTab("configurar")} className={tabCls("configurar")}>
          ⚙️ Configurar Productos
        </button>
      </div>

      {tab === "configurar" && (
        <div>
          <h2 className="text-lg font-bold text-ink">Configurar productos</h2>
          <p className="text-xs text-muted">Asocia PDF y datos por SKU SIIGO</p>
        </div>
      )}

      {tab === "imprimir" && (
        <TabImprimir
          precargar={precargarImpresion}
          onPrecargarConsumido={() => setPrecargarImpresion(null)}
        />
      )}
      {tab === "plantillas" && (
        <TabPlantillas onUsarEnImpresion={irAImprimirPlantilla} />
      )}
      {tab === "configurar" && (
        <TabConfigurar onImprimirProducto={irAImprimir} />
      )}
    </div>
  );
}
