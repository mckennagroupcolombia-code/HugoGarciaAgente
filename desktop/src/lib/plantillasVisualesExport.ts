import {
  esFuenteMontserrat,
  pesoFontWeightCss,
  type ElementoTexto,
  type ElementoVisual,
  type PlantillaVisualDoc,
} from "./plantillasVisuales";
import { esSrcImagenApi, resolverUrlImagenCanvas } from "./plantillasVisualesImagen";

/** Misma proporción que `line-height: normal` en el lienzo del editor. */
const LINE_HEIGHT_RATIO = 1.2;

export interface OpcionesExportPlantilla {
  /** Escala uniforme (1 = tamaño del lienzo, 2 = doble resolución, etc.). */
  escala?: number;
  forzarFondoOpaco?: boolean;
}

function clampEscalaExport(escala: number | undefined): number {
  const s = escala ?? 1;
  return Math.max(0.25, Math.min(8, s));
}

function fontFamilyCanvas(fontFamily: string): string {
  if (esFuenteMontserrat(fontFamily || "")) return "Montserrat";
  const raw = (fontFamily || "sans-serif").replace(/"/g, "").trim();
  return raw.split(",")[0]?.trim() || "sans-serif";
}

function fontCssTexto(el: ElementoTexto): string {
  const fw = pesoFontWeightCss(el.fontWeight);
  return `${fw} ${el.fontSize}px ${fontFamilyCanvas(el.fontFamily)}`;
}

async function asegurarFuentesLienzo(doc: PlantillaVisualDoc): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  await document.fonts.ready;
  const specs = new Set<string>();
  for (const el of doc.elementos) {
    if (el.type !== "text" || el.visible === false) continue;
    const fw = pesoFontWeightCss(el.fontWeight);
    const size = Math.max(4, Math.round(el.fontSize));
    specs.add(`${fw} ${size}px Montserrat`);
    specs.add(`${fw} ${size}px sans-serif`);
  }
  await Promise.all([...specs].map((spec) => document.fonts.load(spec).catch(() => undefined)));
}

function normalizarSrcImagen(src: string): string {
  const raw = (src || "").trim();
  if (!raw || raw.startsWith("data:") || raw.startsWith("blob:")) return raw;
  if (esSrcImagenApi(raw)) return raw;
  try {
    const u = new URL(raw, typeof window !== "undefined" ? window.location.origin : "http://local");
    if (
      u.pathname.includes("/recursos-png/") ||
      u.pathname.includes("/plantillas-visuales/assets/")
    ) {
      return u.pathname;
    }
  } catch {
    /* relativo */
  }
  return raw;
}

async function cargarImagen(src: string): Promise<HTMLImageElement> {
  const raw = normalizarSrcImagen(src);
  const url = await resolverUrlImagenCanvas(raw);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`No se pudo cargar: ${raw}`));
    img.src = url;
  });
}

/** Parte texto como `white-space: pre-wrap` dentro de un ancho máximo. */
function partirLineasTexto(
  ctx: CanvasRenderingContext2D,
  content: string,
  maxWidth: number,
): string[] {
  const ancho = Math.max(8, maxWidth);
  const out: string[] = [];

  for (const parrafo of (content || "").split("\n")) {
    if (!parrafo) {
      out.push("");
      continue;
    }
    let resto = parrafo;
    while (resto.length > 0) {
      if (ctx.measureText(resto).width <= ancho) {
        out.push(resto);
        break;
      }
      let corte = resto.length;
      let low = 0;
      let high = resto.length;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        const frag = resto.slice(0, mid);
        if (ctx.measureText(frag).width <= ancho) low = mid;
        else high = mid - 1;
      }
      corte = Math.max(1, low);
      if (corte < resto.length && resto[corte] !== " ") {
        const espacio = resto.lastIndexOf(" ", corte);
        if (espacio > 0) corte = espacio;
      }
      const linea = resto.slice(0, corte).trimEnd();
      out.push(linea || resto.slice(0, 1));
      resto = resto.slice(corte).trimStart();
    }
  }
  return out.length ? out : [""];
}

function dibujarLineaTexto(
  ctx: CanvasRenderingContext2D,
  linea: string,
  x: number,
  y: number,
  ancho: number,
  align: ElementoTexto["align"],
) {
  if (align === "justify" && linea.trim().includes(" ")) {
    const palabras = linea.trim().split(/\s+/);
    if (palabras.length > 1) {
      const textoAncho = palabras.reduce((s, p) => s + ctx.measureText(p).width, 0);
      const espacio = (ancho - textoAncho) / (palabras.length - 1);
      let cx = x;
      for (let i = 0; i < palabras.length; i++) {
        ctx.fillText(palabras[i], cx, y);
        cx += ctx.measureText(palabras[i]).width + espacio;
      }
      return;
    }
  }
  if (align === "center") {
    ctx.textAlign = "center";
    ctx.fillText(linea, x + ancho / 2, y);
  } else if (align === "right") {
    ctx.textAlign = "right";
    ctx.fillText(linea, x + ancho, y);
  } else {
    ctx.textAlign = "left";
    ctx.fillText(linea, x, y);
  }
}

function dibujarTexto(ctx: CanvasRenderingContext2D, el: ElementoTexto) {
  ctx.fillStyle = el.color || "#000";
  ctx.font = fontCssTexto(el);
  ctx.textBaseline = "top";
  const lh = el.fontSize * LINE_HEIGHT_RATIO;
  const ancho = Math.max(8, el.width || 0);
  const lineas = partirLineasTexto(ctx, el.content || "", ancho);
  lineas.forEach((linea, i) => {
    dibujarLineaTexto(ctx, linea, el.x, el.y + i * lh, ancho, el.align);
  });
}

async function dibujarElemento(
  ctx: CanvasRenderingContext2D,
  el: ElementoVisual,
): Promise<void> {
  ctx.save();
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  if (el.rotation) {
    ctx.translate(cx, cy);
    ctx.rotate((el.rotation * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }

  if (el.type === "rect") {
    const r = el.borderRadius || 0;
    ctx.fillStyle = el.fill || "transparent";
    ctx.strokeStyle = el.stroke || "transparent";
    ctx.lineWidth = el.strokeWidth || 0;
    if (r > 0 && typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(el.x, el.y, el.width, el.height, r);
      if (el.fill && el.fill !== "transparent") ctx.fill();
      if (el.stroke && el.strokeWidth > 0) ctx.stroke();
    } else {
      if (el.fill && el.fill !== "transparent") {
        ctx.fillRect(el.x, el.y, el.width, el.height);
      }
      if (el.stroke && el.strokeWidth > 0) {
        ctx.strokeRect(el.x, el.y, el.width, el.height);
      }
    }
  } else if (el.type === "line") {
    ctx.strokeStyle = el.stroke || "#000";
    ctx.lineWidth = el.strokeWidth || 1;
    ctx.lineCap = "butt";
    ctx.beginPath();
    ctx.moveTo(el.x, el.y);
    ctx.lineTo(el.x2 ?? el.x, el.y2 ?? el.y);
    ctx.stroke();
  } else if (el.type === "text") {
    dibujarTexto(ctx, el);
  } else if (el.type === "image" && el.src) {
    try {
      const img = await cargarImagen(el.src);
      if (el.objectFit === "cover") {
        const ratio = Math.max(el.width / img.width, el.height / img.height);
        const sw = img.width * ratio;
        const sh = img.height * ratio;
        const sx = el.x + (el.width - sw) / 2;
        const sy = el.y + (el.height - sh) / 2;
        ctx.drawImage(img, sx, sy, sw, sh);
      } else {
        ctx.drawImage(img, el.x, el.y, el.width, el.height);
      }
    } catch {
      ctx.fillStyle = "#e2e8f0";
      ctx.fillRect(el.x, el.y, el.width, el.height);
    }
  }
  ctx.restore();
}

function pintarFondo(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  fondo: string,
  forzarOpaco: boolean,
) {
  const f = (fondo || "#ffffff").trim();
  const transparente = !forzarOpaco && f.toLowerCase() in { transparent: 1, none: 1 };
  if (transparente) {
    ctx.clearRect(0, 0, w, h);
    return;
  }
  ctx.fillStyle = f.startsWith("#") ? f : "#ffffff";
  ctx.fillRect(0, 0, w, h);
}

export async function renderPlantillaToCanvas(
  doc: PlantillaVisualDoc,
  opts?: OpcionesExportPlantilla,
): Promise<HTMLCanvasElement> {
  await asegurarFuentesLienzo(doc);
  const escala = clampEscalaExport(opts?.escala);
  const { ancho_px: w, alto_px: h } = doc.formato;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * escala));
  canvas.height = Math.max(1, Math.round(h * escala));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas no disponible");

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.scale(escala, escala);

  pintarFondo(ctx, w, h, doc.fondo || "#ffffff", opts?.forzarFondoOpaco === true);

  const sorted = [...doc.elementos]
    .filter((el) => el.visible !== false)
    .sort((a, b) => a.zIndex - b.zIndex);
  for (const el of sorted) {
    await dibujarElemento(ctx, el);
  }
  return canvas;
}

function nombreArchivoPlantilla(nombre: string, ext: string): string {
  const safe = (nombre || "plantilla").replace(/[^\w\-]+/g, "_").slice(0, 60) || "plantilla";
  return `${safe}.${ext}`;
}

/** Sube el lienzo renderizado como JPG a la galería compartida del Studio. */
export async function guardarPlantillaJpgEnGaleria(
  doc: PlantillaVisualDoc,
  opts?: Pick<OpcionesExportPlantilla, "escala">,
): Promise<{ nombre: string }> {
  const { api } = await import("../api/client");
  const blob = await exportarPlantillaBlob(doc, "jpeg", opts);
  const fd = new FormData();
  fd.append(
    "archivo",
    new File([blob], nombreArchivoPlantilla(doc.nombre, "jpg"), { type: "image/jpeg" }),
  );
  const res = await api.upload<{ ok: boolean; nombre: string }>(
    "/api/etiquetas/recursos-png",
    fd,
  );
  return { nombre: res.nombre };
}

/** Renderiza el lienzo como PDF y lo guarda en la biblioteca de PDFs de Etiquetas. */
export async function guardarPlantillaPdfEnGaleria(
  doc: PlantillaVisualDoc,
): Promise<{ nombre: string }> {
  const { api } = await import("../api/client");
  const res = await api.post<{ ok: boolean; nombre: string; base64: string }>(
    "/api/plantillas-visuales/exportar",
    { plantilla: doc, formato: "pdf" },
  );
  const bin = atob(res.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const fd = new FormData();
  fd.append(
    "archivo",
    new File([bytes], nombreArchivoPlantilla(doc.nombre, "pdf"), { type: "application/pdf" }),
  );
  const up = await api.upload<{ ok: boolean; nombre: string }>("/api/etiquetas/subir-pdf", fd);
  return { nombre: up.nombre };
}

export async function guardarPlantillaEnGaleria(
  doc: PlantillaVisualDoc,
  formato: "jpeg" | "pdf",
  opts?: Pick<OpcionesExportPlantilla, "escala">,
): Promise<{ nombre: string }> {
  if (formato === "pdf") return guardarPlantillaPdfEnGaleria(doc);
  return guardarPlantillaJpgEnGaleria(doc, opts);
}

export async function exportarPlantillaBlob(
  doc: PlantillaVisualDoc,
  formato: "png" | "jpeg",
  opts?: OpcionesExportPlantilla,
): Promise<Blob> {
  const forzarOpaco = formato === "jpeg";
  const escala = clampEscalaExport(opts?.escala);
  const canvas = await renderPlantillaToCanvas(doc, {
    forzarFondoOpaco: forzarOpaco,
    escala,
  });
  const calidad = escala >= 3 ? 0.95 : 0.92;
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Exportación fallida"))),
      formato === "jpeg" ? "image/jpeg" : "image/png",
      formato === "jpeg" ? calidad : undefined,
    );
  });
}

export function descargarBlob(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}

export function descargarBase64(b64: string, nombre: string, mime: string): void {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  descargarBlob(new Blob([bytes], { type: mime }), nombre);
}
