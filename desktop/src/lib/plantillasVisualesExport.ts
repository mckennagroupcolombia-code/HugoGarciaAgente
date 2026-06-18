import {
  pesoFontWeightCss,
  type ElementoVisual,
  type PlantillaVisualDoc,
} from "./plantillasVisuales";
import { resolverUrlImagenCanvas } from "./plantillasVisualesImagen";

async function cargarImagen(src: string): Promise<HTMLImageElement> {
  const url = await resolverUrlImagenCanvas(src);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
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
    if (r > 0) {
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
    ctx.beginPath();
    ctx.moveTo(el.x, el.y);
    ctx.lineTo(el.x2, el.y2);
    ctx.stroke();
  } else if (el.type === "text") {
    ctx.fillStyle = el.color || "#000";
    const fw = pesoFontWeightCss(el.fontWeight);
    ctx.font = `${fw} ${el.fontSize}px ${el.fontFamily || "sans-serif"}`;
    ctx.textBaseline = "top";
    const lineas = (el.content || "").split("\n");
    const lh = el.fontSize * 1.25;
    lineas.forEach((linea, i) => {
      const ly = el.y + i * lh;
      if (el.align === "center") {
        ctx.textAlign = "center";
        ctx.fillText(linea, el.x + el.width / 2, ly);
      } else if (el.align === "right") {
        ctx.textAlign = "right";
        ctx.fillText(linea, el.x + el.width, ly);
      } else {
        ctx.textAlign = "left";
        ctx.fillText(linea, el.x, ly);
      }
    });
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

export async function renderPlantillaToCanvas(
  doc: PlantillaVisualDoc,
): Promise<HTMLCanvasElement> {
  const { ancho_px: w, alto_px: h } = doc.formato;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas no disponible");

  const fondo = doc.fondo || "#ffffff";
  if (fondo === "transparent") {
    ctx.clearRect(0, 0, w, h);
  } else {
    ctx.fillStyle = fondo;
    ctx.fillRect(0, 0, w, h);
  }

  const sorted = [...doc.elementos].sort((a, b) => a.zIndex - b.zIndex);
  for (const el of sorted) {
    await dibujarElemento(ctx, el);
  }
  return canvas;
}

export async function exportarPlantillaBlob(
  doc: PlantillaVisualDoc,
  formato: "png" | "jpeg",
): Promise<Blob> {
  const canvas = await renderPlantillaToCanvas(doc);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Exportación fallida"))),
      formato === "jpeg" ? "image/jpeg" : "image/png",
      0.92,
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
